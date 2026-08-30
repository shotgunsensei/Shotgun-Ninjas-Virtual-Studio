/* Shotgun Ninjas Virtual Studio — service worker.
 * Hand-rolled to keep the dep tree small. The CACHE_VERSION token is
 * replaced at build time by the snVirtualStudioPwaPlugin in vite.config.ts
 * so every new build invalidates the prior cache and triggers the in-app
 * "App Update Available" toast. */
const CACHE_VERSION = "__SN_SW_VERSION__";
const SHELL_CACHE = `sn-studio-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `sn-studio-runtime-${CACHE_VERSION}`;
const BASE = new URL(self.registration.scope).pathname;

// Build-time injected: only the entry JS/CSS referenced by index.html. Lazy
// Studio and panel chunks are cached on demand so visiting the landing page
// does not download the complete DAW in the background.
const BUILD_ASSETS = __SN_PRECACHE_URLS__;

// Always-precached app shell.
const SHELL_URLS = Array.from(new Set([
  BASE,
  BASE + "index.html",
  BASE + "manifest.webmanifest",
  BASE + "favicon.svg",
  BASE + "pwa-icon.svg",
  BASE + "pwa-icon-maskable.svg",
  ...BUILD_ASSETS.map((p) => BASE + p),
]));

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Treat the app shell atomically: an incomplete cache must not be
      // reported as offline-ready. Lazy chunks remain runtime-cached on use.
      const entries = await Promise.all(
        SHELL_URLS.map(async (url) => {
          const request = new Request(url, { cache: "reload" });
          const response = await fetch(request);
          if (!response.ok) throw new Error(`Failed to precache ${url}: ${response.status}`);
          return [url, response];
        }),
      );
      await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge old versioned caches.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              (k.startsWith("sn-studio-shell-") && k !== SHELL_CACHE) ||
              (k.startsWith("sn-studio-runtime-") && k !== RUNTIME_CACHE),
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      // Tell every controlled client the new SW is in charge so the
      // app can flip its "Offline Ready" indicator without a reload.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) c.postMessage({ type: "SW_ACTIVATED", version: CACHE_VERSION });
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/** True for things we never want to cache (user samples live in IndexedDB
 * as Blobs, and POSTs / streaming media are out of scope). */
function isUncacheable(request, url) {
  if (request.method !== "GET") return true;
  if (url.protocol === "blob:" || url.protocol === "data:") return true;
  if (url.origin !== self.location.origin) return true;
  // Vite HMR / dev endpoints — never intercept while developing.
  if (url.pathname.includes("/@vite/") || url.pathname.includes("/@react-refresh"))
    return true;
  if (url.pathname.endsWith(".hot-update.json")) return true;
  // Range requests should pass through. Factory instruments are immutable
  // build assets and may be runtime-cached after first use; user/imported
  // samples remain IndexedDB/network-owned and never enter Cache Storage.
  if (request.headers.get("range")) return true;
  if (isFactorySample(url)) return false;
  // Other audio/video requests and worklets should pass through.
  if (request.destination === "audio" || request.destination === "video") return true;
  if (url.pathname.includes("/api/")) return true;
  if (url.pathname.includes("/samples/") || url.pathname.includes("/user-samples/"))
    return true;
  return false;
}

function isFactorySample(url) {
  return url.pathname.includes("/samples/factory/vcsl/");
}

function normalizedPath(url) {
  return url.pathname.endsWith("/") ? url.pathname : url.pathname.replace(/\/$/, "");
}

function isShellUrl(url) {
  const path = normalizedPath(url);
  return SHELL_URLS.some((entry) => normalizedPath(new URL(entry, self.location.origin)) === path);
}

function isStaticAsset(request, url) {
  if (isShellUrl(url)) return true;
  if (isFactorySample(url)) {
    return request.destination === "" || request.destination === "audio";
  }
  const assetRoot = BASE + "assets/";
  if (url.pathname.startsWith(assetRoot)) {
    return ["script", "style", "worker", "font", "image", ""].includes(request.destination);
  }
  return ["manifest", "font", "image"].includes(request.destination);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (isUncacheable(request, url)) return;

  // Navigation: network-first with cached index.html fallback so the
  // app shell still boots when the user is offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(BASE + "index.html", fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached =
            (await cache.match(BASE + "index.html")) ||
            (await cache.match(BASE));
          if (cached) return cached;
          return new Response(
            "<h1>Offline</h1><p>Studio is offline and the cached shell is missing. Reconnect once to install it.</p>",
            { status: 503, headers: { "Content-Type": "text/html" } },
          );
        }
      })(),
    );
    return;
  }

  // Static app-shell assets only: cache-first with background refresh.
  // Do not cache arbitrary same-origin GETs; user projects and samples live
  // in IndexedDB and future runtime endpoints must stay network-owned.
  if (!isStaticAsset(request, url)) return;

  event.respondWith(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      const shellCached = await shellCache.match(request);
      if (shellCached) return shellCached;

      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            cache.put(request, res.clone()).catch(() => undefined);
          }
          return res;
        })
        .catch(() => null);
      if (cached) {
        // Fire-and-forget revalidation.
        network.catch(() => undefined);
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      return new Response("", { status: 504, statusText: "Offline" });
    })(),
  );
});
