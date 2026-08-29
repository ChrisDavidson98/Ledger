/* ---------------------------------------------------------------
   sw.js — offline app shell.

   The reason this exists: cell coverage on a golf course is bad,
   and an app that will not load on the 7th tee is an app nobody
   uses. Round data already lives in localStorage; this caches the
   code so the page opens with no signal at all.
--------------------------------------------------------------- */

const CACHE = 'ledger-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/app.js',
  './src/model.js',
  './src/baseline.js',
  './src/storage.js',
  './src/courses.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Network-first so a deploy is picked up promptly, falling back to
  // cache the moment the network is unavailable or slow to fail.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && request.url.startsWith(self.location.origin)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
