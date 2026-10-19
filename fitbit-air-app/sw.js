// Offline-Cache für die App-Dateien. API-Aufrufe werden nie gecacht.
const CACHE = "air-recovery-v2";
const ASSETS = [
  "./", "index.html", "styles.css", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-512.png",
  "js/main.js", "js/config.js", "js/scoring.js", "js/normalize.js", "js/api.js",
  "js/auth.js", "js/store.js", "js/charts.js", "js/demo.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Netzwerk zuerst, damit Updates sofort ankommen; offline aus dem Cache.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
