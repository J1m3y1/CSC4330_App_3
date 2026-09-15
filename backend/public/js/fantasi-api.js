/**
 * fantasi-api.js — shared API client
 * Include this before any page-specific script.
 * Reads BASE_URL from a <meta name="api-base"> tag so it works in both
 * development (http://localhost:5000) and production (same-origin /api).
 */
'use strict';

// Wrapped in an IIFE so none of these top-level names (api, showFieldError,
// clearFieldError, showToast, etc.) leak into the shared global scope. This
// file is loaded as a classic <script src>, not a module, so without this
// wrapper every one of these declarations becomes a real global — and every
// page that does `const { api, showFieldError, ... } = window.FantasiAPI`
// then redeclares those exact identifiers at its own top level. Two
// top-level const/function declarations with the same name in the same
// global scope is a SyntaxError, which silently kills the *entire* script
// block it's in (parse-time failure, not a runtime one) — including every
// click handler defined below it. That was the actual cause of pages'
// buttons appearing completely dead with no console output.
(function () {

const _base = (() => {
  const meta = document.querySelector('meta[name="api-base"]');
  return meta ? meta.content.replace(/\/$/, '') : '/api';
})();

/**
 * Core fetch wrapper.
 * - Always sends credentials (httpOnly cookies forwarded automatically).
 * - On 401 with code TOKEN_EXPIRED, attempts one silent token refresh then retries.
 * - Returns { ok, status, data } — never throws for HTTP errors, only for network failures.
 */
async function _fetch(method, path, body, isRetry = false) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${_base}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = null; }

  // Silent refresh on expired access token
  if (res.status === 401 && data?.code === 'TOKEN_EXPIRED' && !isRetry) {
    const refreshed = await _fetch('POST', '/auth/refresh', undefined, true);
    if (refreshed.ok) return _fetch(method, path, body, true);
  }

  return { ok: res.ok, status: res.status, data };
}

const api = {
  get:    (path)        => _fetch('GET',    path),
  post:   (path, body)  => _fetch('POST',   path, body),
  patch:  (path, body)  => _fetch('PATCH',  path, body),
  put:    (path, body)  => _fetch('PUT',    path, body),
  delete: (path)        => _fetch('DELETE', path),

  // ── Auth ───────────────────────────────────────────────────────────────────
  auth: {
    // Registration always carries a required ID file, so it's multipart —
    // can't go through the JSON-only _fetch helper (same reason
    // profile.uploadAvatar below bypasses it).
    async register(data, idFile) {
      const form = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && value !== null) form.append(key, value);
      });
      // Only present in the fallback path (Veriff not configured) — a
      // Veriff-verified applicant sends veriff_session_id in `data` above
      // instead, and no file at all (see authController.register).
      if (idFile) form.append('id_document', idFile);
      const res = await fetch(`${_base}/auth/register`, {
        method: 'POST', credentials: 'include', body: form,
      });
      const responseData = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data: responseData };
    },
    login:    (data)  => api.post('/auth/login',    data),
    logout:   ()      => api.post('/auth/logout'),
    me:       ()      => api.get('/auth/me'),
    refresh:  ()      => api.post('/auth/refresh'),
    forgot:   (email) => api.post('/auth/forgot-password', { email }),
    reset:    (token, password) => api.post('/auth/reset-password', { token, password }),
    changePassword: (currentPassword, newPassword) =>
      api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword }),
    markWelcomeSeen: () => api.post('/auth/welcome-seen'),
  },

  // ── Phone verification (Twilio Verify) ──────────────────────────────────────
  // Public endpoints — called before an account exists, during sign-up.
  phone: {
    sendCode:   (phone)       => api.post('/phone/send-code', { phone }),
    verifyCode: (phone, code) => api.post('/phone/verify-code', { phone, code }),
  },

  // ── Identity verification (Veriff) ──────────────────────────────────────────
  // Public endpoints — called before an account exists, during sign-up.
  veriff: {
    createSession: (email, full_name) => api.post('/veriff/create-session', { email, full_name }),
    status:        (sessionId)        => api.get(`/veriff/session/${sessionId}/status`),
  },

  // ── Profile ────────────────────────────────────────────────────────────────
  profile: {
    me:     ()         => api.get('/profile/me'),
    update: (data)     => api.patch('/profile/me', data),
    introVideo: {
      upload: async (file) => {
        const form = new FormData();
        form.append('video', file);
        const res = await fetch(`${_base}/profile/intro-video`, { method: 'POST', credentials: 'include', body: form });
        return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
      },
      remove: () => api.delete('/profile/intro-video'),
      streamUrl: (id) => `${_base}/profile/${id}/intro-video`,
    },
    get:    (id)       => api.get(`/profile/${id}`),
    block:  (id)       => api.post(`/profile/${id}/block`),
    unblock:(id)       => api.delete(`/profile/${id}/block`),
    blocked:()         => api.get('/profile/blocked'),
    requestPhoto:      (id) => api.post(`/profile/${id}/photo-request`),
    photoRequests:     ()   => api.get('/profile/photo-requests'),
    respondPhotoRequest: (viewerId, status) => api.post(`/profile/photo-requests/${viewerId}/respond`, { status }),
    requestView:       (id) => api.post(`/profile/${id}/view-request`),
    viewRequests:      ()   => api.get('/profile/view-requests'),
    respondViewRequest: (requesterId, status) => api.post(`/profile/view-requests/${requesterId}/respond`, { status }),
    note: {
      get:    (id)       => api.get(`/profile/${id}/note`),
      save:   (id, body) => api.put(`/profile/${id}/note`, { body }),
      delete: (id)       => api.delete(`/profile/${id}/note`),
    },
    boostStatus: () => api.get('/profile/boost'),
    boost:       () => api.post('/profile/boost'),
    report: (id, reason) => api.post(`/profile/${id}/report`, { reason }),
    privacyRequest: (type, reason) => api.post('/profile/privacy-requests', { type, reason }),

    // Geofenced privacy — Black tier only
    geofences: {
      list:   ()                                    => api.get('/profile/geofences'),
      add:    (label, address, radius_miles)        => api.post('/profile/geofences', { label, address, radius_miles }),
      delete: (id)                                  => api.delete(`/profile/geofences/${id}`),
    },

    async uploadAvatar(file) {
      const form = new FormData();
      form.append('avatar', file);
      const res = await fetch(`${_base}/profile/avatar`, {
        method: 'POST', credentials: 'include', body: form,
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    },

    // ── Interest tags (rated, with Gold+/Black custom tags) ─────────────────────
    interestTags: {
      get: () => api.get('/profile/interest-tags'),
      set: (interests) => api.put('/profile/interest-tags', { interests }),
    },

    // ── Photo gallery ──────────────────────────────────────────────────────────
    photos: {
      list:   ()          => api.get('/profile/photos'),
      delete: (photoId)   => api.delete(`/profile/photos/${photoId}`),
      setPrimary: (photoId) => api.patch(`/profile/photos/${photoId}/primary`),
      reorder: (photoIds)  => api.patch('/profile/photos/reorder', { photo_ids: photoIds }),
      async add(file) {
        const form = new FormData();
        form.append('photo', file);
        const res = await fetch(`${_base}/profile/photos`, {
          method: 'POST', credentials: 'include', body: form,
        });
        const data = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, data };
      },
    },

    // ── Photo verification (live selfie vs. own profile photos) ──────────────
    photoVerification: {
      challenge: () => api.get('/profile/photo-verification/challenge'),
      status:    () => api.get('/profile/photo-verification/status'),
      async submit(selfieBlob, challengeCode) {
        const form = new FormData();
        form.append('selfie', selfieBlob, 'selfie.jpg');
        form.append('challenge_code', challengeCode);
        const res = await fetch(`${_base}/profile/photo-verification`, {
          method: 'POST', credentials: 'include', body: form,
        });
        const data = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, data };
      },
    },
  },

  // ── Membership ────────────────────────────────────────────────────────────
  // Fantasi is a private-invitation platform with no payment processor of its
  // own (mainstream processors don't underwrite this kind of content, and a
  // dedicated high-risk processor isn't wired up yet) — a member requests a
  // tier, an admin reviews it and grants manually.
  membership: {
    get:     ()               => api.get('/membership'),
    request: (tier, note)     => api.post('/membership/request', { tier, note }),
    cancel:  ()                => api.post('/membership/cancel'),
    // Admin-only manual grant — used both standalone and to approve a request above.
    grant:   (userId, tier)   => api.post('/membership/grant', { user_id: userId, tier }),
  },

  // ── Discover ──────────────────────────────────────────────────────────────
  discover: {
    filterOptions: () => api.get('/discover/filter-options'),
    saved: {
      list: () => api.get('/discover/saved'),
      create: (name, filters) => api.post('/discover/saved', { name, filters }),
      remove: (id) => api.delete(`/discover/saved/${encodeURIComponent(id)}`),
    },
    browse: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return api.get(`/discover${qs ? '?' + qs : ''}`);
    },
    search: (q, params = {}) => {
      const qs = new URLSearchParams({ q, ...params }).toString();
      return api.get(`/discover/search?${qs}`);
    },
  },

  // ── Messages ──────────────────────────────────────────────────────────────
  messages: {
    conversations: ()                 => api.get('/messages/conversations'),
    thread:        (partnerId, page)  => api.get(`/messages/${partnerId}?page=${page || 1}`),
    send:          (partnerId, body)  => api.post(`/messages/${partnerId}`, { body }),
    delete:        (messageId)        => api.delete(`/messages/${messageId}`),
    getSettings:   (partnerId)        => api.get(`/messages/${partnerId}/settings`),
    setSettings:   (partnerId, disappearing_seconds) => api.put(`/messages/${partnerId}/settings`, { disappearing_seconds }),
  },

  // ── Chatrooms ─────────────────────────────────────────────────────────────
  chatrooms: {
    list:    ()                     => api.get('/chatrooms'),
    create:  (name, description, min_tier) => api.post('/chatrooms', { name, description, min_tier }),
    messages:(roomId, page)         => api.get(`/chatrooms/${roomId}/messages?page=${page || 1}`),
    post:    (roomId, body)         => api.post(`/chatrooms/${roomId}/messages`, { body }),
    delete:  (roomId, messageId)    => api.delete(`/chatrooms/${roomId}/messages/${messageId}`),
  },

  // ── Interests (likes / views) ────────────────────────────────────────────────
  interests: {
    like:     (id) => api.post(`/interests/likes/${id}`),
    unlike:   (id) => api.delete(`/interests/likes/${id}`),
    liked:    ()   => api.get('/interests/liked'),
    likedMe:  ()   => api.get('/interests/liked-me'),
    viewedMe: ()   => api.get('/interests/viewed-me'),
  },

  // ── Forum ─────────────────────────────────────────────────────────────────
  // Feed viewing/liking/commenting is open to any approved member; only
  // posting/reposting requires Gold or Black (enforced server-side).
  forum: {
    feed:        (page = 1, limit = 20) => api.get(`/forum/posts?page=${page}&limit=${limit}`),
    createPost:  (body, repost_of_id, mentioned_user_ids) =>
      api.post('/forum/posts', { body: body || undefined, repost_of_id: repost_of_id || undefined, mentioned_user_ids }),
    deletePost:  (id) => api.delete(`/forum/posts/${id}`),
    like:        (id) => api.post(`/forum/posts/${id}/like`),
    unlike:      (id) => api.delete(`/forum/posts/${id}/like`),
    comments:    (id) => api.get(`/forum/posts/${id}/comments`),
    addComment:  (id, body) => api.post(`/forum/posts/${id}/comments`, { body }),
    deleteComment: (id) => api.delete(`/forum/comments/${id}`),
    mentionCandidates: (q) => api.get(`/forum/mention-candidates?q=${encodeURIComponent(q)}`),
    notifications:     () => api.get('/forum/notifications'),
    unreadCount:       () => api.get('/forum/notifications/unread-count'),
    markNotificationsRead: () => api.post('/forum/notifications/read'),
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  admin: {
    pending:              ()             => api.get('/admin/pending'),
    approveUser:          (id)           => api.post(`/admin/users/${id}/approve`),
    rejectUser:           (id)           => api.post(`/admin/users/${id}/reject`),
    reports:              (status)       => api.get(`/admin/reports?status=${status || 'pending'}`),
    resolveReport:        (id, status)   => api.post(`/admin/reports/${id}/resolve`, { status }),
    privacyRequests:      (status)       => api.get(`/admin/privacy-requests?status=${status || 'pending'}`),
    resolvePrivacyRequest:(id, status)   => api.post(`/admin/privacy-requests/${id}/resolve`, { status }),
    membershipRequests:      (status)    => api.get(`/admin/membership-requests?status=${status || 'pending'}`),
    resolveMembershipRequest:(id, status)=> api.post(`/admin/membership-requests/${id}/resolve`, { status }),

    photoVerifications:       (status)    => api.get(`/admin/photo-verifications?status=${status || 'pending'}`),
    photoVerificationSelfieUrl: (id)      => `${_base}/admin/photo-verifications/${id}/selfie`,
    resolvePhotoVerification: (id, status)=> api.post(`/admin/photo-verifications/${id}/resolve`, { status }),

    stats:      ()          => api.get('/admin/stats'),
    users:      (params = {}) => {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
      ).toString();
      return api.get(`/admin/users${qs ? '?' + qs : ''}`);
    },
    suspendUser:    (id)         => api.post(`/admin/users/${id}/suspend`),
    reactivateUser: (id)         => api.post(`/admin/users/${id}/reactivate`),
    updateUserRole: (id, role)   => api.patch(`/admin/users/${id}/role`, { role }),

    chatrooms:       ()                                  => api.get('/admin/chatrooms'),
    createChatroom:  (name, description, min_tier)       => api.post('/chatrooms', { name, description, min_tier }),
    updateChatroom:  (id, fields)                        => api.patch(`/chatrooms/${id}`, fields),
  },
};

// ── Auth guard — redirect unauthenticated users to sign-in ────────────────────
// Call on every protected page: requireSession('/SignInProcess/SignIn.html')
let _cachedViewer = null;
async function requireSession(redirectTo = '/SignInProcess/SignIn.html') {
  const { ok, data } = await api.auth.me();
  if (!ok) {
    window.location.href = redirectTo;
    return null;
  }
  _cachedViewer = data; // used by watermarkPhoto below
  return data; // returns the logged-in user object
}

// ── Photo watermarking (screenshot deterrent) ─────────────────────────────────
// No web technique can actually block a screenshot or a photo of the screen —
// this doesn't prevent one. What it does is make a leaked image traceable
// back to whoever was looking at it: a faint, tiled overlay naming the
// current viewer, plus disabling easy drag/right-click-save. Call
// watermarkPhoto(el) right after setting a background-image of ANOTHER
// member's photo on el — never on the viewer's own photos, which don't need
// tracing back to themselves.
(function injectWatermarkStyle() {
  if (document.getElementById('fantasi-watermark-style')) return;
  const style = document.createElement('style');
  style.id = 'fantasi-watermark-style';
  style.textContent = `
    .fantasi-watermark-overlay{ position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:3; }
    .fantasi-watermark-overlay span{
      position:absolute; white-space:nowrap; font-size:10px; font-family:sans-serif;
      color:rgba(255,255,255,0.16); transform:rotate(-30deg); letter-spacing:0.02em;
    }
  `;
  document.head.appendChild(style);
})();

function watermarkPhoto(el) {
  if (!el || el.dataset.fantasiWatermarked) return;
  const label = _cachedViewer?.email || _cachedViewer?.display_name;
  if (!label) return; // no viewer identity resolved yet — skip rather than show a blank mark
  el.dataset.fantasiWatermarked = '1';

  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.style.userSelect = 'none';
  el.style.webkitUserSelect = 'none';
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('dragstart', (e) => e.preventDefault());

  const overlay = document.createElement('div');
  overlay.className = 'fantasi-watermark-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  // Several tiled copies, not just one centered mark, so cropping out part
  // of the image doesn't remove every trace of it.
  [[10, 4], [38, 52], [64, 10], [86, 56]].forEach(([top, left]) => {
    const span = document.createElement('span');
    span.textContent = label;
    span.style.top = `${top}%`;
    span.style.left = `${left}%`;
    overlay.appendChild(span);
  });
  el.appendChild(overlay);
}

// ── Dashboard boot helper ──────────────────────────────────────────────────────
// Every dashboard page needs the same three things: redirect out if the API
// client itself failed to load (fixes the guard "fails open" bug — see B7 in
// the audit), confirm the session, and fill in the sidebar's mini-account
// block. Call this once at the top of each page's script instead of
// repeating the pattern.
function initials(nameOrEmail) {
  const s = (nameOrEmail || '').trim();
  return s ? s.charAt(0).toUpperCase() : '?';
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function populateSidebarAccount(user) {
  const nameEl   = document.querySelector('.mini-account-name');
  const tierEl   = document.querySelector('.mini-account-tier');
  const avatarEl = document.querySelector('.mini-avatar');

  if (nameEl) nameEl.textContent = user.display_name || user.email;
  if (tierEl) tierEl.textContent = `${capitalize(user.membership_tier)} Member`;
  if (avatarEl) {
    avatarEl.textContent = '';
    if (user.avatar_url) {
      avatarEl.style.backgroundImage = `url(${user.avatar_url})`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = initials(user.display_name || user.email);
    }
  }

  injectAccountMenu(user);
  injectTopbar(user);
  injectAdminNavItem(user);
}

// Admin Panel link in the sidebar — shown only when the server-confirmed
// `user.role` (from requireAuth's DB lookup in middleware/auth.js, never
// trusted from the client) is 'admin'. This is a pure UI convenience: every
// /api/admin/* route is independently gated by requireAdmin server-side
// (routes/admin.js), and Admin.html itself re-checks role and shows a
// "denied" screen if it doesn't match — so hiding/showing this link can
// never be the only thing standing between a non-admin and admin data.
function injectAdminNavItem(user) {
  if (user.role !== 'admin') return;
  const nav = document.querySelector('.sidebar-nav');
  if (!nav || nav.querySelector('.nav-item[href="/AdminPage/Admin.html"]')) return;

  const link = document.createElement('a');
  link.className = 'nav-item';
  link.href = '/AdminPage/Admin.html';
  link.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 30 30" fill="none"><path d="M15 3L26 7v8c0 8-5 13-11 16-6-3-11-8-11-16V7l11-4z" stroke="currentColor" stroke-width="1"/><path d="M11 15l3 3 6-6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Admin Panel
  `;
  nav.appendChild(link);
}

// ── Account dropdown (self-contained, like watermarkPhoto above) ──────────────
// Turns the sidebar's mini-account block into a click target that opens a
// flyout menu — injected once here rather than duplicated into all ten
// dashboard pages' markup, so there's exactly one place this ever needs to
// change. Every destination links to a page or section that's actually
// built (no "Boost visibility" / "Background screening" placeholders for
// features that don't exist) and Sign Out — previously not reachable from
// any page's UI at all — finally has a home.
(function injectAccountMenuStyle() {
  if (document.getElementById('fantasi-account-menu-style')) return;
  const style = document.createElement('style');
  style.id = 'fantasi-account-menu-style';
  style.textContent = `
    .fantasi-am-trigger{ cursor:pointer; border-radius:6px; padding:6px; margin:-6px; transition:background .2s ease; position:relative; }
    .fantasi-am-trigger:hover{ background:rgba(199,166,92,0.06); }
    .fantasi-am-chevron{ margin-left:auto; color:var(--smoke-dim, #5C564C); transition:transform .25s ease; flex-shrink:0; }
    .fantasi-am-trigger.open .fantasi-am-chevron{ transform:rotate(180deg); }
    .fantasi-am-panel{
      display:none; position:absolute;
      background:var(--noir-soft, #100E11); border:1px solid var(--line-strong, rgba(199,166,92,0.30));
      border-radius:8px; box-shadow:0 24px 60px rgba(0,0,0,0.5); overflow:hidden; z-index:200;
    }
    .fantasi-am-panel.show{ display:block; }
    .fantasi-am-panel-up{ left:0; right:0; bottom:100%; margin-bottom:10px; }
    .fantasi-am-panel-down{ right:0; top:100%; margin-top:10px; width:360px; max-width:calc(100vw - 32px); max-height:calc(100dvh - 110px); overflow-y:auto; }
    .fantasi-am-panel-down .fantasi-am-card{ padding:24px; }
    .fantasi-am-panel-down .fantasi-am-actions{ padding:16px 24px; }
    .fantasi-am-panel-down .fantasi-am-item{ padding:12px 14px; }
    .fantasi-am-card{ padding:18px 18px 16px; border-bottom:1px solid var(--line, rgba(199,166,92,0.14)); }
    .fantasi-am-card-top{ display:flex; align-items:center; gap:12px; }
    .fantasi-am-avatar{
      width:44px; height:44px; border-radius:50%; flex-shrink:0; background-size:cover; background-position:center;
      background:linear-gradient(135deg, var(--gold-bright, #E4C687), var(--gold-dim, #7C6636));
      display:flex; align-items:center; justify-content:center;
      font-family:var(--font-display, serif); font-style:italic; font-size:18px; color:var(--noir, #0B0A0C);
    }
    .fantasi-am-name{ font-family:var(--font-serif, serif); font-size:15px; color:var(--cream, #F2ECDF); }
    .fantasi-am-badges{ display:flex; gap:6px; margin-top:5px; flex-wrap:wrap; }
    .fantasi-am-badge{
      font-family:var(--font-sans, sans-serif); font-size:9px; letter-spacing:0.05em; text-transform:uppercase;
      padding:3px 8px; border-radius:20px; border:1px solid var(--line-strong, rgba(199,166,92,0.30)); color:var(--smoke, #8D8579);
    }
    .fantasi-am-badge.tier-free{ color:var(--smoke, #8D8579); }
    .fantasi-am-badge.tier-silver{ background:rgba(166,171,177,0.15); border-color:transparent; color:var(--silver-bright, #D4D7DB); }
    .fantasi-am-badge.tier-gold{ background:rgba(199,166,92,0.15); border-color:transparent; color:var(--gold-bright, #E4C687); }
    .fantasi-am-badge.tier-black{ background:rgba(228,198,135,0.08); border-color:rgba(228,198,135,0.3); color:var(--gold-bright, #E4C687); }
    .fantasi-am-badge.verified{ display:flex; align-items:center; gap:3px; border-color:transparent; background:rgba(127,191,143,0.12); color:var(--online, #7FBF8F); }
    .fantasi-am-upgrade{
      display:block; margin-top:12px; font-family:var(--font-sans, sans-serif); font-size:11.5px;
      color:var(--gold-bright, #E4C687); letter-spacing:0.02em;
    }
    .fantasi-am-upgrade:hover{ text-decoration:underline; }
    .fantasi-am-actions{ padding:12px 18px; border-bottom:1px solid var(--line, rgba(199,166,92,0.14)); }
    .fantasi-am-edit-btn{
      display:block; width:100%; text-align:center; padding:9px; border-radius:5px; border:1px solid var(--gold, #C7A65C);
      font-family:var(--font-sans, sans-serif); font-size:11px; letter-spacing:0.06em; text-transform:uppercase;
      color:var(--noir, #0B0A0C); background:var(--gold, #C7A65C); transition:background .25s ease, border-color .25s ease;
    }
    .fantasi-am-edit-btn:hover{ background:var(--gold-bright, #E4C687); border-color:var(--gold-bright, #E4C687); }
    .fantasi-am-tools{ padding:8px; border-bottom:1px solid var(--line, rgba(199,166,92,0.14)); }
    .fantasi-am-item{
      display:flex; align-items:center; gap:10px; width:100%; padding:9px 10px; border-radius:5px;
      font-family:var(--font-sans, sans-serif); font-size:12.5px; color:var(--cream, #F2ECDF); text-align:left;
      transition:background .2s ease;
    }
    .fantasi-am-item:hover{ background:rgba(199,166,92,0.08); }
    .fantasi-am-item svg{ flex-shrink:0; color:var(--gold-dim, #7C6636); }
    .fantasi-am-item.danger{ color:#c0415a; }
    .fantasi-am-item.danger svg{ color:#c0415a; }
    .fantasi-am-menu{ padding:8px; }

    /* ---- top header bar (sits above the sidebar, not instead of it) ---- */
    .fantasi-topbar{
      position:sticky; top:0; z-index:150; height:96px; display:flex; align-items:center; gap:26px;
      padding:0 28px; background:var(--noir-soft, #100E11); border-bottom:1px solid var(--line, rgba(199,166,92,0.14));
    }
    .fantasi-topbar-logo{ display:flex; align-items:center; flex-shrink:0; }
    .fantasi-topbar-logo img{ height:65px; width:auto; }
    .fantasi-topbar-actions{ display:flex; align-items:center; gap:16px; flex-shrink:0; margin-left:auto; }
    .fantasi-topbar-upgrade{
      padding:14px 28px; border-radius:24px; background:var(--gold, #C7A65C); color:var(--noir, #0B0A0C);
      font-family:var(--font-sans, sans-serif); font-size:13px; letter-spacing:0.04em; text-transform:uppercase; font-weight:500;
      transition:background .25s ease; white-space:nowrap;
    }
    .fantasi-topbar-upgrade:hover{ background:var(--gold-bright, #E4C687); }
    .fantasi-topbar-boost{
      padding:14px 28px; border-radius:24px; border:1px solid var(--line-strong, rgba(199,166,92,0.30));
      font-family:var(--font-sans, sans-serif); font-size:13px; letter-spacing:0.04em; text-transform:uppercase;
      color:var(--cream, #F2ECDF); transition:border-color .25s ease, color .25s ease, background .25s ease;
      white-space:nowrap;
    }
    .fantasi-topbar-boost:hover:not(:disabled){ border-color:var(--gold, #C7A65C); color:var(--gold-bright, #E4C687); }
    .fantasi-topbar-boost.active{ border-color:var(--gold, #C7A65C); color:var(--gold-bright, #E4C687); background:rgba(199,166,92,0.08); }
    .fantasi-topbar-boost:disabled{ opacity:0.5; cursor:not-allowed; }
    .fantasi-topbar-account{ position:relative; display:flex; align-items:center; gap:12px; cursor:pointer; padding:8px 12px; border-radius:26px; }
    .fantasi-topbar-account:hover{ background:rgba(199,166,92,0.06); }
    .fantasi-topbar-avatar{
      width:52px; height:52px; border-radius:50%; flex-shrink:0; background-size:cover; background-position:center;
      background:linear-gradient(135deg, var(--gold-bright, #E4C687), var(--gold-dim, #7C6636));
      display:flex; align-items:center; justify-content:center;
      font-family:var(--font-display, serif); font-style:italic; font-size:20px; color:var(--noir, #0B0A0C);
    }
    .fantasi-topbar-account-name{ font-family:var(--font-sans, sans-serif); font-size:16px; color:var(--cream, #F2ECDF); }
    @media (max-width:760px){
      .fantasi-topbar{ gap:10px; padding:0 14px; }
      .fantasi-topbar-account-name{ display:none; }
      .fantasi-topbar-upgrade{ display:none; }
    }

    /* ---- mobile nav drawer (stands in for the sidebar below 980px, where
       every page hides it) — the only way to reach Discover/Search/Interests/
       Messages/Chatrooms/Forum/Profile/Privacy/Membership/Safety on mobile,
       now that the topbar itself carries no nav links of its own. ---- */
    .fantasi-mnav-toggle{
      display:none; flex-direction:column; justify-content:center; align-items:center; gap:5px;
      width:30px; height:26px; background:none; border:none; padding:0; cursor:pointer; flex-shrink:0;
    }
    .fantasi-mnav-toggle span{
      display:block; width:100%; height:1.5px; background:var(--cream, #F2ECDF);
      transition:transform .3s ease, opacity .3s ease;
    }
    .fantasi-mnav-toggle.open span:nth-child(1){ transform:translateY(6.5px) rotate(45deg); }
    .fantasi-mnav-toggle.open span:nth-child(2){ opacity:0; }
    .fantasi-mnav-toggle.open span:nth-child(3){ transform:translateY(-6.5px) rotate(-45deg); }
    .fantasi-mnav-backdrop{
      position:fixed; inset:0; z-index:295; background:rgba(11,10,12,0.72); backdrop-filter:blur(4px);
      opacity:0; pointer-events:none; transition:opacity .35s ease;
    }
    .fantasi-mnav-backdrop.open{ opacity:1; pointer-events:auto; }
    .fantasi-mnav-drawer{
      position:fixed; top:0; left:0; bottom:0; z-index:296; width:min(280px, 82vw);
      background:var(--noir-soft, #100E11); border-right:1px solid var(--line-strong, rgba(199,166,92,0.30));
      overflow-y:auto; padding:24px 0;
      transform:translateX(-100%); transition:transform .4s cubic-bezier(.2,.6,.2,1);
      box-shadow:30px 0 60px rgba(0,0,0,0.4);
    }
    .fantasi-mnav-drawer.open{ transform:translateX(0); }
    .fantasi-mnav-drawer .sidebar-nav{ padding:0 14px; }
    body.fantasi-mnav-open{ overflow:hidden; }
    @media (max-width:980px){
      .fantasi-mnav-toggle{ display:flex; }
    }
  `;
  document.head.appendChild(style);
})();

// Builds one self-contained account panel (unattached). Called once for the
// sidebar's flyout-up version and again for the topbar's dropdown-down
// version — each trigger gets its own independent panel instance, so
// internal lookups use classes, not ids, since two copies of this markup
// can now exist in the document at once.
function buildAccountPanel(user) {
  const tier = user.membership_tier || 'free';
  const NEXT_TIER = { free: 'Silver', silver: 'Gold', gold: 'Black' };

  const panel = document.createElement('div');
  panel.className = 'fantasi-am-panel';
  panel.innerHTML = `
    <div class="fantasi-am-card">
      <div class="fantasi-am-card-top">
        <div class="fantasi-am-avatar"></div>
        <div>
          <div class="fantasi-am-name"></div>
          <div class="fantasi-am-badges">
            <span class="fantasi-am-badge tier-${tier}">${capitalize(tier)} Member</span>
            <span class="fantasi-am-badge verified"><svg width="9" height="9" viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Verified</span>
          </div>
        </div>
      </div>
      ${NEXT_TIER[tier] ? `<a class="fantasi-am-upgrade" href="/Dashboard/Membership.html">Upgrade to ${NEXT_TIER[tier]} &rarr;</a>` : ''}
    </div>
    <div class="fantasi-am-actions">
      <a class="fantasi-am-edit-btn" href="/Profile/Profile.html">Edit Profile</a>
    </div>
    <div class="fantasi-am-tools">
      <a class="fantasi-am-item" href="/Profile/Profile.html#section-privacy">
        <svg width="14" height="14" viewBox="0 0 30 30" fill="none"><rect x="7" y="13" width="16" height="12" rx="0.5" stroke="currentColor" stroke-width="1"/><path d="M10.5 13V9.5a4.5 4.5 0 0 1 9 0V13" stroke="currentColor" stroke-width="1"/></svg>
        Privacy &amp; Discretion
      </a>
      <a class="fantasi-am-item" href="/Profile/Profile.html#section-verification">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4L16 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Verification Status
      </a>
    </div>
    <div class="fantasi-am-menu">
      <a class="fantasi-am-item" href="mailto:support@fantasi.app">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-4 3v-3H4a2 2 0 0 1-2-2V5z" stroke="currentColor" stroke-width="1.3"/></svg>
        Help &amp; Support
      </a>
      <button type="button" class="fantasi-am-item fantasi-am-signout danger">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M8 4H4v12h4M13 14l4-4-4-4M17 10H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Sign Out
      </button>
    </div>
  `;

  const avatarEl = panel.querySelector('.fantasi-am-avatar');
  panel.querySelector('.fantasi-am-name').textContent = user.display_name || user.email;
  if (user.avatar_url) {
    avatarEl.style.backgroundImage = `url(${user.avatar_url})`;
  } else {
    avatarEl.textContent = initials(user.display_name || user.email);
  }

  panel.querySelector('.fantasi-am-signout').addEventListener('click', async (e) => {
    e.stopPropagation();
    await api.auth.logout();
    window.location.href = '/SignInProcess/SignIn.html';
  });

  return panel;
}

// Wires a trigger element to open/close a given panel, inserted just before
// the trigger (flyout upward — the sidebar's mini-account sits at the very
// bottom of the page) or just after it (dropdown downward — the topbar's
// account trigger sits at the very top). `scopeEl` is what an outside click
// checks against to decide whether to close the panel.
function wireAccountTrigger(trigger, panel, scopeEl, direction) {
  trigger.classList.add('fantasi-am-trigger');
  trigger.setAttribute('role', 'button');
  trigger.setAttribute('tabindex', '0');
  panel.classList.add(direction === 'down' ? 'fantasi-am-panel-down' : 'fantasi-am-panel-up');

  const chevron = document.createElement('span');
  chevron.className = 'fantasi-am-chevron';
  chevron.innerHTML = '<svg width="11" height="11" viewBox="0 0 20 20" fill="none"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  trigger.appendChild(chevron);

  if (direction === 'down') trigger.appendChild(panel);
  else trigger.before(panel);

  function closePanel() {
    panel.classList.remove('show');
    trigger.classList.remove('open');
  }
  function togglePanel(e) {
    e.stopPropagation();
    panel.classList.toggle('show');
    trigger.classList.toggle('open');
  }
  trigger.addEventListener('click', togglePanel);
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(e); }
    else if (e.key === 'Escape') closePanel();
  });
  document.addEventListener('click', (e) => { if (!scopeEl.contains(e.target)) closePanel(); });
}

function injectAccountMenu(user) {
  const trigger = document.querySelector('.mini-account');
  const foot    = trigger?.closest('.sidebar-foot');
  if (!trigger || !foot || trigger.dataset.fantasiAmReady) return;
  trigger.dataset.fantasiAmReady = '1';

  foot.style.position = 'relative';
  const panel = buildAccountPanel(user);
  wireAccountTrigger(trigger, panel, foot, 'up');
}

// ── Top header bar ──────────────────────────────────────────────────────────────
// Sits above the sidebar (not instead of it) on every logged-in page — an
// Upgrade CTA, real Boost (temporary top-of-Discover placement, see
// profileController.js — no payment processor exists to gate it behind, so
// it's open to every tier and rationed by a 24h cooldown instead), and a
// second account trigger sharing buildAccountPanel with the sidebar's.
// Carries no nav links of its own (that used to duplicate three of the
// sidebar's ten items) — full navigation lives in the sidebar on desktop and
// in injectMobileNavDrawer()'s clone of it on mobile.
function injectTopbar(user) {
  if (document.getElementById('fantasi-topbar')) return;

  const bar = document.createElement('div');
  bar.className = 'fantasi-topbar';
  bar.id = 'fantasi-topbar';
  bar.innerHTML = `
    <a class="fantasi-topbar-logo" href="/Dashboard/Discover.html">
      <img src="/LandingPage/videos/fantasi-logo-gold.png" alt="Fantasi">
    </a>
    <div class="fantasi-topbar-actions"></div>
  `;
  document.body.insertBefore(bar, document.body.firstChild);

  const actions = bar.querySelector('.fantasi-topbar-actions');
  const tier = user.membership_tier || 'free';
  if (tier !== 'black') {
    const upgradeLink = document.createElement('a');
    upgradeLink.className = 'fantasi-topbar-upgrade';
    upgradeLink.href = '/Dashboard/Membership.html';
    upgradeLink.textContent = 'Upgrade';
    actions.appendChild(upgradeLink);
  }

  const boostBtn = document.createElement('button');
  boostBtn.type = 'button';
  boostBtn.className = 'fantasi-topbar-boost';
  boostBtn.textContent = 'Boost';
  actions.appendChild(boostBtn);

  let boostTimer = null;
  function renderBoostState(status) {
    clearInterval(boostTimer);
    const boostedUntil = status.boosted_until ? new Date(status.boosted_until).getTime() : null;
    const canBoostAt   = status.can_boost_at   ? new Date(status.can_boost_at).getTime()   : null;

    function tick() {
      const now = Date.now();
      if (boostedUntil && boostedUntil > now) {
        boostBtn.textContent = `Boosted · ${Math.ceil((boostedUntil - now) / 60000)}m left`;
        boostBtn.classList.add('active');
        boostBtn.disabled = true;
      } else if (canBoostAt && canBoostAt > now) {
        boostBtn.textContent = `Boost (${Math.ceil((canBoostAt - now) / 3600000)}h)`;
        boostBtn.classList.remove('active');
        boostBtn.disabled = true;
      } else {
        boostBtn.textContent = 'Boost';
        boostBtn.classList.remove('active');
        boostBtn.disabled = false;
        clearInterval(boostTimer);
      }
    }
    tick();
    boostTimer = setInterval(tick, 30000);
  }

  api.profile.boostStatus().then(({ ok, data }) => { if (ok) renderBoostState(data); });

  boostBtn.addEventListener('click', async () => {
    boostBtn.disabled = true;
    const { ok, data } = await api.profile.boost();
    if (ok) showToast('Boost activated — 30 minutes of priority placement in Discover.', 'info');
    else showToast(data?.error || 'Could not activate boost.', 'error');
    renderBoostState(data);
  });

  const accountTrigger = document.createElement('div');
  accountTrigger.className = 'fantasi-topbar-account';
  accountTrigger.innerHTML = `
    <div class="fantasi-topbar-avatar"></div>
    <span class="fantasi-topbar-account-name"></span>
  `;
  actions.appendChild(accountTrigger);

  const topAvatarEl = accountTrigger.querySelector('.fantasi-topbar-avatar');
  accountTrigger.querySelector('.fantasi-topbar-account-name').textContent = user.display_name || user.email;
  if (user.avatar_url) topAvatarEl.style.backgroundImage = `url(${user.avatar_url})`;
  else topAvatarEl.textContent = initials(user.display_name || user.email);

  const topPanel = buildAccountPanel(user);
  wireAccountTrigger(accountTrigger, topPanel, accountTrigger, 'down');

  // Push the sidebar (and its own sticky positioning) below the topbar
  // instead of editing every page's own stylesheet for one shared bar.
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    const barHeight = bar.getBoundingClientRect().height || 58;
    sidebar.style.top = `${barHeight}px`;
    sidebar.style.height = `calc(100vh - ${barHeight}px)`;
  }

  injectMobileNavDrawer(bar);
}

// Every dashboard page hides `.sidebar` below ~900-980px with nothing put in
// its place — on a phone that meant Chatrooms, Forum, Safety, and (for
// non-upgradeable Black members) Membership were completely unreachable,
// reduced to whatever three links the topbar happened to keep. This clones
// the page's own `.sidebar-nav` into a slide-in drawer instead of hardcoding
// a second copy of the link list, so it can never drift out of sync with
// whatever the sidebar actually has (including the admin link
// injectAdminNavItem appends — the clone happens at open time, not here, so
// it always reflects the current DOM regardless of call order).
function injectMobileNavDrawer(topbar) {
  const sidebarNav = document.querySelector('.sidebar-nav');
  if (!sidebarNav || document.getElementById('fantasi-mnav-toggle')) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'fantasi-mnav-toggle';
  toggle.className = 'fantasi-mnav-toggle';
  toggle.setAttribute('aria-label', 'Open menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<span></span><span></span><span></span>';
  const logo = topbar.querySelector('.fantasi-topbar-logo');
  logo.after(toggle);

  const backdrop = document.createElement('div');
  backdrop.className = 'fantasi-mnav-backdrop';
  const drawer = document.createElement('nav');
  drawer.className = 'fantasi-mnav-drawer';
  drawer.setAttribute('aria-label', 'Navigation');
  document.body.append(backdrop, drawer);

  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('fantasi-mnav-open');
  }
  function openDrawer() {
    drawer.innerHTML = '';
    drawer.appendChild(sidebarNav.cloneNode(true));
    drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', closeDrawer));
    drawer.classList.add('open');
    backdrop.classList.add('open');
    toggle.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('fantasi-mnav-open');
  }

  toggle.addEventListener('click', () => { drawer.classList.contains('open') ? closeDrawer() : openDrawer(); });
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 980) closeDrawer(); });
}

/**
 * Call at the top of every dashboard page's script, guarded by
 * `if (!window.FantasiAPI)` first — if this script failed to load at all,
 * nothing inside it (including this function) can run, so that check has to
 * live in the page itself. See any dashboard page's boot script for the
 * exact pattern. Returns the logged-in user, or null after already
 * redirecting to sign-in — callers should stop their own init on null.
 *
 * Also redirects a member who hasn't seen the first-sign-in welcome
 * interstitial (users.welcome_seen_at is NULL) to Dashboard/Welcome.html
 * before they reach any real dashboard page. Welcome.html itself calls
 * requireSession() directly instead of this function — bypassing this
 * check entirely — so it can't redirect to itself.
 */
async function initDashboard(redirectTo = '/SignInProcess/SignIn.html') {
  const user = await requireSession(redirectTo);
  if (!user) return null;
  if (!user.welcome_seen_at) {
    window.location.href = '/Dashboard/Welcome.html';
    return null;
  }
  populateSidebarAccount(user);
  return user;
}

// ── Show inline error under a form field ──────────────────────────────────────
function showFieldError(inputEl, message) {
  clearFieldError(inputEl);
  inputEl.style.borderColor = 'var(--bordeaux-bright, #711A2E)';
  const err = document.createElement('span');
  err.className = 'api-field-error';
  err.style.cssText = 'display:block;font-family:sans-serif;font-size:11px;color:#c0415a;margin-top:4px;';
  err.textContent = message;
  inputEl.parentNode.appendChild(err);
}

function clearFieldError(inputEl) {
  inputEl.style.borderColor = '';
  const existing = inputEl.parentNode.querySelector('.api-field-error');
  if (existing) existing.remove();
}

// ── Show a toast notification ─────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const colours = { info: '#3b5', error: '#c0415a', warning: '#C7A65C' };
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:28px; left:50%; transform:translateX(-50%);
    background:${colours[type] || colours.info}; color:#fff;
    padding:12px 24px; font-size:13px; letter-spacing:.04em;
    z-index:99999; pointer-events:none; opacity:0;
    transition:opacity .3s ease; border-radius:2px;
    font-family: var(--font-sans, sans-serif);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

// ── Request an upgrade (private-invitation model) ──────────────────────────────
// Shared by Membership.html and Accepted.html. No payment is taken here —
// this submits a request that an admin reviews and grants from the admin
// panel. Returns { submitted } so callers can show a "request received" state.
async function requestMembershipUpgrade(tier, note) {
  const { ok, data } = await api.membership.request(tier, note);
  if (!ok) {
    showToast(data?.error || 'Could not submit request.', 'error');
    return { submitted: false };
  }
  showToast('Request received — our team will follow up.', 'info');
  return { submitted: true };
}

// ── US states/cities (shared single source, like the interest tags above) ──────
// Major cities only, not exhaustive — good enough for a "State, City" picker
// without shipping a full gazetteer. Used by SignUp.html, profile-setup.html,
// and the Discover/Search location filters instead of each maintaining its
// own copy (SignUp.html previously had its own hardcoded ~120 *world* cities
// with no state grouping at all).
const US_STATES_CITIES = {
  'Alabama': ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison'],
  'Alaska': ['Anchorage', 'Fairbanks', 'Juneau', 'Wasilla', 'Sitka'],
  'Arizona': ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Glendale', 'Gilbert', 'Tempe', 'Peoria', 'Flagstaff'],
  'Arkansas': ['Little Rock', 'Fayetteville', 'Fort Smith', 'Springdale', 'Jonesboro', 'Rogers', 'Conway'],
  'California': ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim', 'Santa Ana', 'Riverside', 'Irvine', 'Beverly Hills', 'Malibu', 'Santa Monica'],
  'Colorado': ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Boulder', 'Pueblo', 'Arvada', 'Westminster'],
  'Connecticut': ['Bridgeport', 'New Haven', 'Stamford', 'Hartford', 'Waterbury', 'Norwalk', 'Danbury', 'Greenwich'],
  'Delaware': ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Bear'],
  'District of Columbia': ['Washington'],
  'Florida': ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Tallahassee', 'Fort Lauderdale', 'West Palm Beach', 'Naples', 'Key West', 'Sarasota'],
  'Georgia': ['Atlanta', 'Augusta', 'Columbus', 'Savannah', 'Athens', 'Sandy Springs', 'Roswell', 'Macon', 'Alpharetta'],
  'Hawaii': ['Honolulu', 'Hilo', 'Kailua', 'Kapolei', 'Kahului'],
  'Idaho': ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Coeur d’Alene'],
  'Illinois': ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Rockford', 'Springfield', 'Peoria', 'Elgin', 'Evanston'],
  'Indiana': ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Bloomington', 'Fishers'],
  'Iowa': ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Ames'],
  'Kansas': ['Wichita', 'Overland Park', 'Kansas City', 'Topeka', 'Olathe', 'Lawrence'],
  'Kentucky': ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington'],
  'Louisiana': ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles', 'Kenner', 'Bossier City'],
  'Maine': ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn'],
  'Maryland': ['Baltimore', 'Columbia', 'Germantown', 'Silver Spring', 'Annapolis', 'Rockville', 'Bethesda'],
  'Massachusetts': ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'Somerville', 'Newton', 'Brookline'],
  'Michigan': ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Flint', 'Dearborn'],
  'Minnesota': ['Minneapolis', 'St. Paul', 'Rochester', 'Duluth', 'Bloomington', 'Edina'],
  'Mississippi': ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi'],
  'Missouri': ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', 'Independence', 'Clayton'],
  'Montana': ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Helena'],
  'Nebraska': ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island'],
  'Nevada': ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Summerlin'],
  'New Hampshire': ['Manchester', 'Nashua', 'Concord', 'Portsmouth'],
  'New Jersey': ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton', 'Hoboken', 'Princeton'],
  'New Mexico': ['Albuquerque', 'Las Cruces', 'Santa Fe', 'Rio Rancho'],
  'New York': ['New York City', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse', 'Albany', 'Brooklyn', 'Manhattan', 'Southampton', 'The Hamptons'],
  'North Carolina': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Asheville', 'Cary', 'Wilmington'],
  'North Dakota': ['Fargo', 'Bismarck', 'Grand Forks', 'Minot'],
  'Ohio': ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Dublin'],
  'Oklahoma': ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond'],
  'Oregon': ['Portland', 'Salem', 'Eugene', 'Bend', 'Beaverton', 'Lake Oswego'],
  'Pennsylvania': ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading', 'Harrisburg', 'King of Prussia'],
  'Rhode Island': ['Providence', 'Warwick', 'Cranston', 'Newport'],
  'South Carolina': ['Charleston', 'Columbia', 'Greenville', 'Myrtle Beach', 'Hilton Head Island', 'Mount Pleasant'],
  'South Dakota': ['Sioux Falls', 'Rapid City', 'Aberdeen'],
  'Tennessee': ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Franklin', 'Murfreesboro'],
  'Texas': ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Plano', 'Frisco', 'The Woodlands', 'Highland Park'],
  'Utah': ['Salt Lake City', 'West Valley City', 'Provo', 'Park City', 'Sandy'],
  'Vermont': ['Burlington', 'South Burlington', 'Rutland', 'Montpelier'],
  'Virginia': ['Virginia Beach', 'Richmond', 'Norfolk', 'Arlington', 'Alexandria', 'McLean', 'Charlottesville'],
  'Washington': ['Seattle', 'Spokane', 'Tacoma', 'Bellevue', 'Vancouver', 'Redmond', 'Kirkland'],
  'West Virginia': ['Charleston', 'Huntington', 'Morgantown', 'Wheeling'],
  'Wisconsin': ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine'],
  'Wyoming': ['Cheyenne', 'Casper', 'Jackson', 'Laramie'],
};

// Populates a <select> of states, and wires a second <select> of that
// state's cities to repopulate whenever the state changes. Optionally
// pre-selects a "City, State" string (best-effort parse — falls back to
// leaving both blank rather than guessing wrong). Returns a function that
// reads the current selection back out as "City, State, United States",
// the same format profiles.location already stores, so geocoding and the
// existing ILIKE location filter keep working unchanged.
function wireLocationSelects(stateEl, cityEl, initialValue) {
  const states = Object.keys(US_STATES_CITIES);
  stateEl.innerHTML = '<option value="">State…</option>' +
    states.map(s => `<option value="${s}">${s}</option>`).join('');

  function populateCities(state, selectedCity) {
    const cities = US_STATES_CITIES[state] || [];
    cityEl.innerHTML = '<option value="">City…</option>' +
      cities.map(c => `<option value="${c}"${c === selectedCity ? ' selected' : ''}>${c}</option>`).join('');
    cityEl.disabled = cities.length === 0;
  }

  stateEl.addEventListener('change', () => populateCities(stateEl.value));
  populateCities('');

  if (initialValue) {
    const parts = initialValue.split(',').map(s => s.trim());
    const matchedState = states.find(s => parts.includes(s));
    if (matchedState) {
      stateEl.value = matchedState;
      populateCities(matchedState, parts[0]);
    }
  }

  return function currentLocation() {
    if (!stateEl.value) return '';
    return cityEl.value ? `${cityEl.value}, ${stateEl.value}, United States` : `${stateEl.value}, United States`;
  };
}

window.FantasiAPI = {
  api, requireSession, showFieldError, clearFieldError, showToast,
  initDashboard, populateSidebarAccount, initials, capitalize,
  requestMembershipUpgrade, watermarkPhoto,
  US_STATES_CITIES, wireLocationSelects,
};

})();
