// Minimal service worker — caches the static page shell for a faster repeat
// visit and basic offline access. Deliberately does NOT touch /api/ requests:
// those must always hit the network so session state and data stay live.
const CACHE_NAME = 'fantasi-shell-v1';
const SHELL_URLS = [
  '/LandingPage/Landing.html',
  '/LandingPage/Safety.html',
  '/LandingPage/Terms.html',
  '/LandingPage/PrivacyPolicy.html',
  '/SignInProcess/SignIn.html',
  '/SignInProcess/forgot-password.html',
  '/SignUpProcess/SignUp.html',
  '/SignUpProcess/pending-approval.html',
  '/SignUpProcess/Accepted.html',
  '/Dashboard/Discover.html',
  '/Dashboard/Search.html',
  '/Dashboard/Messages.html',
  '/Dashboard/Chatrooms.html',
  '/Dashboard/Forum.html',
  '/Dashboard/Interests.html',
  '/Dashboard/Privacy.html',
  '/Dashboard/Membership.html',
  '/Profile/Profile.html',
  '/Profile/ViewProfile.html',
  '/Profile/profile-setup.html',
  '/js/fantasi-api.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        // Not cache.addAll(SHELL_URLS) — that does plain fetches, which can
        // precache a bodyless 304 for the same reason described below, just
        // at install time instead of at request time.
        SHELL_URLS.map((url) => fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never intercept third-party requests (fonts, CDNs) — a
                                                     // service-worker-initiated fetch is subject to connect-src,
                                                     // not style-src/font-src, so this silently broke Adobe Fonts
  if (url.pathname.startsWith('/api/')) return; // never cache API responses

  event.respondWith(
    caches.match(request).then((cached) => {
      // `cache: 'reload'` forces a real round-trip instead of letting the
      // browser's own HTTP cache satisfy this with a bodyless 304 (valid
      // whenever it already holds a matching ETag from an earlier fetch) —
      // a 304 has no body, so serving it straight to the page silently
      // executed as an empty script with no error of any kind.
      const network = fetch(request, { cache: 'reload' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached); // offline — fall back to cache if we have it
      return cached || network;
    })
  );
});
