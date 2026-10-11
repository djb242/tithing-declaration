// Offline: the app's own files are cached so it opens without a connection.
// Only these files — never anything from Google or Microsoft, and never data.
const CACHE = 'td-v6';
const FILES = ['./', 'index.html', 'styles.css', 'privacy.html', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png',
  ...['app', 'calendar', 'config', 'dates', 'doc', 'google', 'ics', 'importer', 'match', 'messages', 'microsoft', 'plan', 'store', 'sync', 'wizard'].map((m) => `src/${m}.js`)];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Network first, and revalidated with the server every time, so an update
// shows up on the next open instead of after the host's 10-minute cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
