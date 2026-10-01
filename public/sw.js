const CACHE_NAME = "partswala-v1";
const URLS_TO_CACHE = ["/", "/products", "/login"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const requestUrl = new URL(e.request.url);
  if (requestUrl.origin !== self.location.origin || e.request.headers.has("Authorization") || requestUrl.pathname.startsWith("/api/")) return;
  if (!URLS_TO_CACHE.includes(requestUrl.pathname)) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === "basic" && !res.headers.has("Set-Cookie")) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});