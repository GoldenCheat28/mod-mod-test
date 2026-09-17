const CACHE = "ore-upgrader-v2";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./items.js",
  "./cases.js",
  "./daily.js",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Сеть в приоритете, кэш — только как резерв для офлайна.
// Так обновления игры подхватываются сразу, а не застревают в старом кэше.
self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
