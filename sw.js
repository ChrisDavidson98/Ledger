/* ---------------------------------------------------------------
   sw.js — offline app shell.

   The reason this exists: cell coverage on a golf course is bad,
   and an app that will not load on the 7th tee is an app nobody
   uses. Round data already lives in localStorage; this caches the
   code so the page opens with no signal at all.
--------------------------------------------------------------- */

/* Bumped whenever SHELL changes, so activate clears the old copy. */
const CACHE = 'ledger-v2';

/*
 * Every module app.js imports, because they are static imports: one
 * of them missing from the cache is not a degraded feature, it is a
 * blank screen on the 7th tee. The list had fallen behind the code —
 * four modules were only ever cached by having been fetched once,
 * which a phone opened offline for the first time never has.
 */
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './src/app.js',
  './src/model.js',
  './src/baseline.js',
  './src/storage.js',
  './src/courses.js',
  './src/handicap.js',
  './src/import.js',
  './src/seed.js',
  './src/sync.js',
  './src/brief.js',
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
