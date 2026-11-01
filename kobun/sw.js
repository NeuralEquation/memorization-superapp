const CACHE = 'kotonoha-337-v3:' + self.registration.scope;
const FILES = ['./', './index.html', './style.css', './engine.js', './data-store.js', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const ownIndex = new URL('./index.html', self.registration.scope).href;
  for (const key of await caches.keys()) {
    if (!key.startsWith('kotonoha-337-') || key === CACHE) continue;
    if (await (await caches.open(key)).match(ownIndex)) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const u = new URL(event.request.url);
  if (event.request.method !== 'GET' || u.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(found => found || fetch(event.request)));
});
