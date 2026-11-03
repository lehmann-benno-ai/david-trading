// Network first, cached copy when offline. Market data (/api) and private pages are never cached.
const CACHE = "david-v1";
const SHELL = ["/", "/style.css", "/app.js", "/broker.js", "/pwa.js", "/lightweight-charts.js", "/login.html", "/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") ||
      u.pathname.startsWith("/private/") || u.pathname.startsWith("/david")) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && r.type === "basic") { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(u.pathname === "/" ? "/" : e.request, copy)); }
    return r;
  }).catch(() => caches.match(u.pathname === "/" ? "/" : e.request).then((r) => r || caches.match("/"))));
});
