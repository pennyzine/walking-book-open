const STATIC_CACHE = "walkingbook-static-v9"
const RUNTIME_CACHE = "walkingbook-runtime-v2"
const NEXT_CACHE = "walkingbook-next-v1"
const VENDOR_CACHE = "walkingbook-vendor-v1"
const OFFLINE_FALLBACK_PATH = "/"
const OFFLINE_ROUTE_PREFIXES = ["/reader", "/reader-offline", "/reader-offline-moonshine", "/merge-comments"]

const ASSETS_TO_CACHE = [
  "/",
  "/voices",
  "/reader",
  "/reader-offline",
  "/reader-offline-moonshine",
  "/merge-comments",
  "/play",
  "/privacy",
  "/terms",
  "/manifest.json",
  "/menu.svg",
  "/og-v2.png",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/walkingbook-icon.svg",
  "/apple-icon.png",
  "/icon-light-32x32.png",
  "/icon-dark-32x32.png",
  "/images/street-art-hero.jpg",
  "/images/record-walkginbook.png",
  "/images/mountain-hero.png",
  "/images/walkgingbookquickstart.png",
  "/fonts/UniversBold.ttf",
  "/fonts/UniversRegular.ttf",
  "/audio/voice-editor-pause.wav",
  "/audio/voice-editor-saved.wav",
  "/audio/voice-editor-resume.wav",
]

const NEXT_ASSET_PREFIXES = ["/_next/static/", "/_next/image", "/_next/data/"]

self.addEventListener("install", (event) => {
  self.skipWaiting()
  // IMPORTANT:
  // `cache.addAll()` fails the entire SW install if ANY request 404s/500s.
  // That makes the whole app appear "offline broken" (even `/` won't be cached).
  //
  // Precache best-effort instead so a single missing asset doesn't brick offline.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      await Promise.allSettled(
        ASSETS_TO_CACHE.map(async (path) => {
          try {
            const request = new Request(path, { cache: "reload" })
            const response = await fetch(request)
            if (shouldCacheResponse(response)) {
              await cache.put(request, response)
            }
          } catch {
            // ignore individual precache failures
          }
        }),
      )
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return
  }

  const url = new URL(event.request.url)

  // Skip other cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return
  }

  if (url.pathname.startsWith("/vendor/")) {
    event.respondWith(cacheFirst(event.request, VENDOR_CACHE))
    return
  }

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(event.request))
    return
  }

  if (isNextAsset(url.pathname)) {
    event.respondWith(cacheFirst(event.request, NEXT_CACHE))
    return
  }

  if (ASSETS_TO_CACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE))
    return
  }

  event.respondWith(networkWithCacheFallback(event.request))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (![STATIC_CACHE, RUNTIME_CACHE, NEXT_CACHE, VENDOR_CACHE].includes(cacheName)) {
            return caches.delete(cacheName)
          }
        }),
      )
    }).then(() => self.clients.claim()),
  )
})

async function cacheFirst(request, cacheName, allowOpaque = false) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }

  try {
    const response = await fetch(request)
    if (shouldCacheResponse(response, allowOpaque)) {
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    if (cacheName === STATIC_CACHE) {
      const fallback = await cache.match(OFFLINE_FALLBACK_PATH)
      if (fallback) return fallback
    }
    throw error
  }
}

async function networkWithCacheFallback(request) {
  try {
    const response = await fetch(request)
    if (shouldCacheResponse(response)) {
      const cache = await caches.open(RUNTIME_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cache = await caches.open(RUNTIME_CACHE)
    const cached = await cache.match(request)
    if (cached) {
      return cached
    }

    if (request.mode === "navigate") {
      const fallback = await caches.match(OFFLINE_FALLBACK_PATH)
      if (fallback) return fallback
    }

    return new Response("Offline", { status: 503, statusText: "Offline" })
  }
}

async function handleNavigationRequest(request) {
  const url = new URL(request.url)
  const cache = await caches.open(RUNTIME_CACHE)
  const normalizedRequest = createNormalizedRequest(url)
  const [cachedExact, cachedNormalized] = await Promise.all([cache.match(request), cache.match(normalizedRequest)])
  if (cachedExact) {
    return cachedExact
  }
  if (cachedNormalized) {
    return cachedNormalized
  }

  try {
    const response = await fetch(request)
    if (shouldCacheResponse(response)) {
      cache.put(request, response.clone())
      cache.put(normalizedRequest, response.clone())
    }
    return response
  } catch (error) {
    const offlineShell = await matchOfflineRouteFallback(url.pathname)
    if (offlineShell) {
      return offlineShell
    }

    const fallback = await caches.match(OFFLINE_FALLBACK_PATH)
    if (fallback) {
      return fallback
    }

    return new Response("Offline", { status: 503, statusText: "Offline" })
  }
}

function shouldCacheResponse(response, allowOpaque = false) {
  return (
    response &&
    response.status === 200 &&
    (response.type === "basic" || response.type === "cors" || (allowOpaque && response.type === "opaque"))
  )
}

function isNextAsset(pathname) {
  return NEXT_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function createNormalizedRequest(url) {
  return new Request(url.origin + url.pathname, {
    method: "GET",
    mode: "same-origin",
    credentials: "include",
  })
}

async function matchOfflineRouteFallback(pathname) {
  for (const prefix of OFFLINE_ROUTE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      const cache = await caches.open(STATIC_CACHE)
      const cached = await cache.match(prefix)
      if (cached) {
        return cached
      }
    }
  }
  return null
}
