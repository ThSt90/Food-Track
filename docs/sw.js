/* Foody – Service Worker: App-Hülle und Bilder offline verfügbar. Online hat immer die neueste Version Vorrang. */
const SHELL = "foody-shell-v1", IMG = "foody-img-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL && k !== IMG) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === "navigate") { const idx = await caches.match("index.html") || await caches.match("./"); if (idx) return idx; }
        throw err;
      }
    })());
  } else if (url.pathname.includes("/storage/v1/object/public/")) {
    e.respondWith((async () => {
      const c = await caches.open(IMG), hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});
