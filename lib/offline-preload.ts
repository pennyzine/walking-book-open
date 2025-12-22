// Client-side (browser) offline preload manager.
//
// Goal: provide a persistent, subscribable status/progress indicator for preparing
// offline capabilities (service worker + PWA caches + Moonshine model warmup).
//
// IMPORTANT: This intentionally does NOT preload Whisper.

import { ensureMoonshineReady } from "@/lib/offline-stt/moonshine"

export type OfflinePreloadStatus = "idle" | "loading" | "ready" | "error"

export type OfflinePreloadState = {
  status: OfflinePreloadStatus
  progress: number // 0..100
  message?: string
  startedAt?: number
  completedAt?: number
  errorMessage?: string
}

const STORAGE_KEY = "walkingbook-offline-preload-state"
const EVENT_NAME = "walkingbook-offline-preload-change"

let inFlight: Promise<void> | null = null
let memoryState: OfflinePreloadState | null = null

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined"
}

function getDefaultState(): OfflinePreloadState {
  return { status: "idle", progress: 0 }
}

function extractNextStaticAssetsFromHtml(html: string): string[] {
  // Next can embed URLs in multiple places (tags + inline JSON).
  // Normalize common escape sequences so we can reliably regex match.
  const normalized = html.replaceAll("\\u002F", "/")
  const matches = normalized.match(/\/_next\/static\/[^"'()\s<>\\]+/g) ?? []
  return Array.from(new Set(matches))
}

export function getOfflinePreloadState(): OfflinePreloadState {
  if (!isBrowser()) return getDefaultState()

  if (memoryState) return memoryState

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return getDefaultState()
    const parsed = JSON.parse(raw) as Partial<OfflinePreloadState>
    const next: OfflinePreloadState = {
      status: parsed.status === "loading" || parsed.status === "ready" || parsed.status === "error" ? parsed.status : "idle",
      progress: clampProgress(typeof parsed.progress === "number" ? parsed.progress : 0),
      message: typeof parsed.message === "string" ? parsed.message : undefined,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : undefined,
      completedAt: typeof parsed.completedAt === "number" ? parsed.completedAt : undefined,
      errorMessage: typeof parsed.errorMessage === "string" ? parsed.errorMessage : undefined,
    }
    memoryState = next
    return next
  } catch {
    return getDefaultState()
  }
}

function setOfflinePreloadState(next: OfflinePreloadState) {
  const normalized: OfflinePreloadState = {
    ...next,
    progress: clampProgress(next.progress),
  }
  memoryState = normalized

  if (isBrowser()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // ignore storage failures
    }
    window.dispatchEvent(new CustomEvent<OfflinePreloadState>(EVENT_NAME, { detail: normalized }))
  }
}

export function subscribeOfflinePreloadState(onChange: (state: OfflinePreloadState) => void) {
  if (!isBrowser()) return () => {}
  const handler = (event: Event) => {
    const custom = event as CustomEvent<OfflinePreloadState>
    onChange(custom.detail)
  }
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener)
}

async function ensureServiceWorkerReady() {
  if (!isBrowser()) return
  if (!("serviceWorker" in navigator)) return

  // Wait for the SW to be ready and controlling this page.
  // This is important so that Moonshine CDN fetches get cached by the SW.
  try {
    await navigator.serviceWorker.ready
  } catch {
    // ignore
  }

  // A short grace period to allow activate/claim.
  // (sw.js calls skipWaiting() + clients.claim()).
  const started = performance.now()
  // Mobile browsers can be slower to activate/claim, especially right after install/update.
  while (!navigator.serviceWorker.controller && performance.now() - started < 5_000) {
    await new Promise((r) => setTimeout(r, 50))
  }

  // If we're still not controlled, offline setup can't reliably cache Next bundles
  // or /vendor Moonshine assets. Fail fast so we don't claim "ready" when offline
  // will actually be broken.
  if (!navigator.serviceWorker.controller) {
    throw new Error("Service worker is installed but not controlling yet. Reload once, then try enabling offline again.")
  }
}

async function warmPwaShellAssets() {
  if (!isBrowser()) return

  // Warm both:
  // - HTML shells for important routes (cached as navigations)
  // - the referenced `/_next/static/...` assets (JS/CSS/fonts) needed to render
  //
  // Without explicitly caching Next build assets, offline can return HTML but still
  // look "broken" because the client bundles can't load.
  const htmlRoutes = ["/", "/reader", "/voices", "/play", "/merge-comments", "/privacy", "/terms"]
  const staticUrls = ["/manifest.json", "/menu.svg", "/walkingbook-icon.svg"]
  const nextAssets = new Set<string>()

  await Promise.allSettled(
    htmlRoutes.map(async (url) => {
      try {
        const resp = await fetch(url, {
          cache: "reload",
          headers: { accept: "text/html" },
        })
        if (!resp.ok) return
        const contentType = resp.headers.get("content-type") ?? ""
        if (!contentType.includes("text/html")) return
        const html = await resp.text()
        for (const asset of extractNextStaticAssetsFromHtml(html)) {
          nextAssets.add(asset)
        }
      } catch {
        // ignore
      }
    }),
  )

  await Promise.allSettled(
    staticUrls.map(async (url) => {
      try {
        await fetch(url, { cache: "reload" })
      } catch {
        // ignore
      }
    }),
  )

  await Promise.allSettled(
    Array.from(nextAssets).map(async (url) => {
      try {
        await fetch(url, { cache: "reload" })
      } catch {
        // ignore
      }
    }),
  )
}

export async function startOfflinePreload(options?: {
  // Optional Next.js prefetch hook (from next/navigation router.prefetch).
  prefetchRoutes?: (paths: string[]) => Promise<unknown>
}): Promise<void> {
  if (!isBrowser()) return

  const current = getOfflinePreloadState()
  if (current.status === "ready") return
  if (inFlight) return inFlight

  const startedAt = Date.now()
  setOfflinePreloadState({
    status: "loading",
    progress: Math.max(0, current.progress || 0),
    message: "Preparing offline mode…",
    startedAt,
    completedAt: undefined,
    errorMessage: undefined,
  })

  inFlight = (async () => {
    try {
      setOfflinePreloadState({ ...getOfflinePreloadState(), status: "loading", progress: 5, message: "Checking offline support…" })
      await ensureServiceWorkerReady()
      setOfflinePreloadState({ ...getOfflinePreloadState(), status: "loading", progress: 15, message: "Warming app shell…" })
      await warmPwaShellAssets()

      if (options?.prefetchRoutes) {
        setOfflinePreloadState({ ...getOfflinePreloadState(), status: "loading", progress: 30, message: "Caching reader routes…" })
        await options.prefetchRoutes(["/", "/reader", "/voices", "/play", "/merge-comments", "/privacy", "/terms"])
      }

      // Moonshine: downloads + warms up model in a worker.
      setOfflinePreloadState({ ...getOfflinePreloadState(), status: "loading", progress: 55, message: "Downloading Moonshine model…" })
      await ensureMoonshineReady()

      setOfflinePreloadState({
        status: "ready",
        progress: 100,
        message: "Offline ready",
        startedAt,
        completedAt: Date.now(),
        errorMessage: undefined,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to prepare offline mode"
      setOfflinePreloadState({
        status: "error",
        progress: Math.min(getOfflinePreloadState().progress || 0, 95),
        message: "Offline setup failed",
        startedAt,
        completedAt: undefined,
        errorMessage: message,
      })
      throw err
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

