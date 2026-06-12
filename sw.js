/* OnTime service worker — app shell, offline-first */
const CACHE = 'ontime-v1.3.0';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // app shell: stale-while-revalidate — instant offline loads, and new
  // deploys are picked up automatically on the next launch
  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(e.request, { ignoreSearch: true });
        const net = fetch(e.request).then((res) => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }).catch(() => hit || c.match('./index.html'));
        return hit || net;
      })
    );
    return;
  }

  // fonts & other cross-origin: stale-while-revalidate
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(
      caches.open(CACHE + '-rt').then(async (c) => {
        const hit = await c.match(e.request);
        const net = fetch(e.request).then((res) => {
          c.put(e.request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
