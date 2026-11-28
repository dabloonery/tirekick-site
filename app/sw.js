// The phone workbench works offline: its own files are kept in a cache and served from it when there's no
// connection. Online, each file comes fresh from tirekick.app first (so an update shows on the next open) and the
// cache is refreshed. Only this site's own files: nothing else is fetched or cached.
const CACHE = "tirekick-app-v1";
const FILES = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "lib/theme.js", "lib/sites.js", "lib/shared.js", "lib/rules.js", "../fonts/bricolage-grotesque.woff2"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("tirekick-app-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});
