// Simple offline caching
const CACHE_NAME = "gymblocks-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./main.js",
  "./manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const fresh = await fetch(e.request);
      return fresh;
    } catch (err) {
      return new Response("Offline", {status: 503, statusText: "Offline"});
    }
  })());
});
