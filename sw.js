// Offline app shell: after the first visit the app opens and works with no signal.
// Updates arrive on their own (see fetch); bump VERSION only to force a clean re-cache.
const VERSION = 'fw-v1';
const FILES = [
  './', './index.html', './app.js', './schema.js', './validate.js', './store.js', './report.js', './package.js', './ui.js', './install.js', './media.js', './transfer.js', './office.js',
  './vendor/fflate.min.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Stale-while-revalidate: answer from cache instantly (works with no signal), and when
// online refresh the cached copy in the background so the next launch has any update.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    if (hit) {
      e.waitUntil(fresh);
      return hit;
    }
    return fresh;
  }));
});
