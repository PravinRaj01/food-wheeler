/* Food Wheeler service worker.
 *
 * Source of truth is scripts/sw.template.js; scripts/build-sw.mjs stamps the
 * build id in and writes public/sw.js (gitignored) before every dev/build.
 * Adapted from the Bill-a project's service worker.
 *
 * What it does - and, deliberately, what it doesn't:
 *  - Caches static assets (Next's content-hashed /_next/static/*, icons,
 *    manifest) and keeps a copy of the Decide and Explore app shells, so a
 *    cold start with no network still opens the app.
 *  - Network-first for navigations: a fresh page always wins when the
 *    network is there; the cached shell is the fallback.
 *  - NEVER touches: non-GET requests, /api/* (this app has none locally -
 *    the AI backend is a separate cross-origin Cloud Run service and this
 *    worker never intercepts cross-origin requests at all), or Next's
 *    RSC/prefetch requests.
 *  - The cached shells are wiped on sign-out (the page posts "clear-pages").
 *  - A new version installs but stays WAITING rather than taking over
 *    silently (no skipWaiting() on install) - components/sw-register.tsx
 *    shows a "New version ready" prompt and only swaps it in once the user
 *    asks, via a "SKIP_WAITING" message. A brand-new install (no previous
 *    worker controlling the page yet) is unaffected by this and activates
 *    immediately either way - only an *update* ever waits.
 */

const BUILD_ID = "__BUILD_ID__";

const STATIC = "foodwheeler-static-v1"; // content-hashed files: safe across deploys
const PAGES = `foodwheeler-pages-${BUILD_ID}`; // HTML shells: replaced every deploy

const SHELL_ROUTES = ["/", "/decide", "/explore", "/settings"];
const OFFLINE_URL = "/offline";
const STATIC_FILES = new Set(["/icon-192.png", "/icon-512.png", "/maskable-512.png", "/manifest.webmanifest"]);
const MAX_STATIC_ENTRIES = 200;
const SLOW_NETWORK_MS = 4000;

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES]);
      for (const name of await caches.keys()) {
        if (name.startsWith("foodwheeler-") && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
      await Promise.all([...SHELL_ROUTES, OFFLINE_URL].map(cachePage));
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "clear-pages") event.waitUntil(caches.delete(PAGES));
  if (data.type === "cache-page" && SHELL_ROUTES.includes(data.path)) event.waitUntil(cachePage(data.path));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never intercept cross-origin requests - the AI backend on Cloud Run,
  // OSM tiles, Google Fonts, etc. all go straight to the network.
  if (url.origin !== self.location.origin) return;

  const p = url.pathname;
  if (p.startsWith("/api/")) return;
  if (url.searchParams.has("_rsc") || req.headers.has("rsc") || req.headers.has("next-router-prefetch")) return;

  if (p.startsWith("/_next/static/") || STATIC_FILES.has(p)) {
    event.respondWith(cacheFirst(event, STATIC, p.startsWith("/_next/static/")));
  } else if (req.mode === "navigate") {
    event.respondWith(navigate(event, url));
  }
});

// ---------------------------------------------------------------------------

async function cacheFirst(event, cacheName, trim) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.ok) {
    await cache.put(event.request, res.clone());
    if (trim) event.waitUntil(trimCache(cache, MAX_STATIC_ENTRIES));
  }
  return res;
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) await cache.delete(key);
}

async function navigate(event, url) {
  const cache = await caches.open(PAGES);
  const isShell = SHELL_ROUTES.includes(url.pathname);

  const networkRace = Promise.race([
    fetch(event.request),
    new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), SLOW_NETWORK_MS)),
  ]);

  try {
    const res = await networkRace;
    if (res.ok && isShell) event.waitUntil(cache.put(event.request, res.clone()));
    return res;
  } catch {
    const hit = await cache.match(url.pathname);
    if (hit) return hit;
    const offlineHit = await cache.match(OFFLINE_URL);
    if (offlineHit) return offlineHit;
    // No cache, no network, not even the offline page cached yet (e.g. the
    // very first visit happened offline): let the browser show its own
    // offline page rather than fake a 200 with nothing useful in it.
    return fetch(event.request);
  }
}

async function cachePage(path) {
  try {
    const res = await fetch(path);
    if (res.ok) (await caches.open(PAGES)).put(path, res);
  } catch {
    // offline at install time - fine, it'll cache on first real visit
  }
}
