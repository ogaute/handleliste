// App-shell cache so the page opens offline. Data offline is handled by Firestore's local cache.
const CACHE = "handleliste-v3";
const SHELL = ["./", "index.html", "firebase-config.js", "seed.json", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png"];
// The Firebase SDK is loaded from another origin. Keep the version in sync with the imports in index.html.
const SDK_ORIGIN = "https://www.gstatic.com";
const SDK = ["app", "auth", "firestore"].map((n) => `${SDK_ORIGIN}/firebasejs/10.14.1/firebase-${n}.js`);
const NET_TIMEOUT = 2500;   // ms to wait for the network before showing the cached copy

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(SHELL);
    await Promise.all(SDK.map((u) => c.add(u).catch(() => {})));   // best effort; also cached when first used
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// SDK files have the version in the URL and never change: cache first.
async function sdkFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) cache.put(req.url, r.clone());
  return r;
}
// Own files: network first so updates arrive, but on a slow or dead connection fall back to the cache.
function networkFirst(e) {
  const req = e.request;
  const net = fetch(req, { cache: "no-cache" }).then(async (r) => {
    if (r.ok) await (await caches.open(CACHE)).put(req, r.clone());
    return r;
  });
  e.waitUntil(net.catch(() => {}));   // finish updating the cache even if the timeout answered first
  return caches.match(req).then((cached) => {
    if (!cached) return net;
    return Promise.race([net.catch(() => cached), new Promise((res) => setTimeout(() => res(cached), NET_TIMEOUT))]);
  });
}
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === SDK_ORIGIN && url.pathname.startsWith("/firebasejs/")) e.respondWith(sdkFirst(e.request));
  else if (url.origin === location.origin) e.respondWith(networkFirst(e));
});
