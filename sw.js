const CACHE_NAME = "memory-foundry-shell-v1.3.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=1.3.0",
  "./src/app.js?v=1.3.0",
  "./src/core.js?v=1.3.0",
  "./src/exercise-types.js?v=1.3.0",
  "./src/exercise-registry.js?v=1.3.0",
  "./src/library.js?v=1.3.0",
  "./src/constitution-mock.js?v=1.3.0",
  "./src/storage.js?v=1.3.0",
  "./data/builtin-packs.json?v=1.3.0",
  "./manifest.webmanifest?v=1.3.0",
  "./icons/icon-192.png?v=1.3.0",
  "./icons/icon-512.png?v=1.3.0"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match("./index.html"));
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const update = fetch(request).then(async response => {
    if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await update) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") event.respondWith(networkFirst(event.request));
  else if (new URL(event.request.url).pathname.endsWith("/data/builtin-packs.json")) event.respondWith(networkFirst(event.request));
  else event.respondWith(staleWhileRevalidate(event.request));
});
