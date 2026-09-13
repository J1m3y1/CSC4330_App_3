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
      form.append('id_document', idFile);
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
  },

  // ── Phone verification (Twilio Verify) ──────────────────────────────────────
  // Public endpoints — called before an account exists, during sign-up.
  phone: {
    sendCode:   (phone)       => api.post('/phone/send-code', { phone }),
    verifyCode: (phone, code) => api.post('/phone/verify-code', { phone, code }),
  },

  // ── Profile ────────────────────────────────────────────────────────────────
  profile: {
    me:     ()         => api.get('/profile/me'),
    update: (data)     => api.patch('/profile/me', data),
    get:    (id)       => api.get(`/profile/${id}`),
    block:  (id)       => api.post(`/profile/${id}/block`),
    unblock:(id)       => api.delete(`/profile/${id}/block`),
    blocked:()         => api.get('/profile/blocked'),
    requestPhoto:      (id) => api.post(`/profile/${id}/photo-request`),
    photoRequests:     ()   => api.get('/profile/photo-requests'),
    respondPhotoRequest: (viewerId, status) => api.post(`/profile/photo-requests/${viewerId}/respond`, { status }),
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
async function requireSession(redirectTo = '/SignInProcess/SignIn.html') {
  const { ok, data } = await api.auth.me();
  if (!ok) {
    window.location.href = redirectTo;
    return null;
  }
  return data; // returns the logged-in user object
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
}

/**
 * Call at the top of every dashboard page's script, guarded by
 * `if (!window.FantasiAPI)` first — if this script failed to load at all,
 * nothing inside it (including this function) can run, so that check has to
 * live in the page itself. See any dashboard page's boot script for the
 * exact pattern. Returns the logged-in user, or null after already
 * redirecting to sign-in — callers should stop their own init on null.
 */
async function initDashboard(redirectTo = '/SignInProcess/SignIn.html') {
  const user = await requireSession(redirectTo);
  if (user) populateSidebarAccount(user);
  return user;
}

// ── Show inline error under a form field ──────────────────────────────────────
function showFieldError(inputEl, message) {
  clearFieldError(inputEl);
  inputEl.style.borderColor = 'var(--bordeaux-bright, #711A2E)';
  const err = document.createElement('span');
  err.className = 'api-field-error';
  err.style.cssText = 'display:block;font-size:11px;color:#c0415a;margin-top:4px;';
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

window.FantasiAPI = {
  api, requireSession, showFieldError, clearFieldError, showToast,
  initDashboard, populateSidebarAccount, initials, capitalize,
  requestMembershipUpgrade,
};

})();
