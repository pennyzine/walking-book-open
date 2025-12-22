"use client"

import type React from "react"
import { Suspense, useEffect, useRef, useState } from "react"
import { createPortal, flushSync } from "react-dom"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ArrowDown, RefreshCw, X } from "lucide-react"
import { loadWalkingBookZip } from "@/lib/zip-loader"
import { getAllAudiobooks, clearAllData } from "@/lib/db"
import type { StoredAudiobook } from "@/types/audiobook"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { MenuDropdown } from "@/components/menu-dropdown"
import { ACTIVE_AUDIOBOOK_STORAGE_KEY, COLAB_NOTEBOOK_URL } from "@/lib/constants"
import { waitForPaint } from "@/lib/wait-for-paint"
import {
  getOfflinePreloadState,
  startOfflinePreload,
  subscribeOfflinePreloadState,
  type OfflinePreloadState,
} from "@/lib/offline-preload"

export default function HomePage() {
  type PlayMode = "online" | "offline"
  const PLAY_MODE_STORAGE_KEY = "walkingbook-play-mode"
  const OFFLINE_ONBOARDING_DONE_KEY = "walkingbook-offline-onboarding-done"
  const QUICKSTART_GUIDE_URL = "https://gamma.app/embed/k6wvng7wkviltr2"
  const QUICKSTART_LOAD_FALLBACK_MS = 4000

  const [audiobooks, setAudiobooks] = useState<StoredAudiobook[]>([])
  const [loading, setLoading] = useState(false)
  const [showQuickstartEmbed, setShowQuickstartEmbed] = useState(false)
  const [quickstartIframeLoaded, setQuickstartIframeLoaded] = useState(false)
  const [quickstartIframeFailed, setQuickstartIframeFailed] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const [playMode, setPlayMode] = useState<PlayMode>("online")
  const [offlinePreload, setOfflinePreload] = useState<OfflinePreloadState>(() => getOfflinePreloadState())
  const [showEnableOfflineDialog, setShowEnableOfflineDialog] = useState(false)
  const [isStartingOfflinePreload, setIsStartingOfflinePreload] = useState(false)
  const autoCloseOfflineDialogOnReadyRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    const saved = localStorage.getItem(PLAY_MODE_STORAGE_KEY)
    if (saved === "online" || saved === "offline") {
      setPlayMode(saved)
    }
  }, [])

  useEffect(() => {
    setOfflinePreload(getOfflinePreloadState())
    return subscribeOfflinePreloadState((state) => {
      setOfflinePreload(state)
      if (state.status !== "idle") {
        setIsStartingOfflinePreload(false)
      }
    })
  }, [])

  useEffect(() => {
    loadAudiobooks()
  }, [])

  async function loadAudiobooks() {
    const books = await getAllAudiobooks()
    setAudiobooks(books)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith(".walkingbook") && !file.name.endsWith(".zip")) {
      toast.error("Please upload a .walkingbook file")
      return
    }

    // Force the loading UI to paint immediately (zip parsing can block the main thread).
    flushSync(() => setLoading(true))
    // Let React paint the loading state before heavy work starts (zip parsing can block the main thread).
    await waitForPaint()

    try {
      await clearAllData()
      const audiobookId = await loadWalkingBookZip(file)
      localStorage.setItem(ACTIVE_AUDIOBOOK_STORAGE_KEY, audiobookId)
      toast.success("Audiobook loaded successfully")
      router.push("/reader")
    } catch (error) {
      console.error("Error loading audiobook:", error)
      toast.error("Failed to load audiobook")
    } finally {
      setLoading(false)
      e.target.value = ""
    }
  }

  useEffect(() => {
    if (playMode !== "offline") return
    // If the user previously enabled offline mode, keep ensuring the pack is ready.
    if (offlinePreload.status !== "idle" && offlinePreload.status !== "error") return
    void startOfflinePreload({
      prefetchRoutes: async (paths) => Promise.allSettled(paths.map((p) => router.prefetch(p))),
    }).catch(() => {
      // State is already updated to "error" by the preload manager.
      // Avoid unhandled promise rejections here.
    })
  }, [offlinePreload.status, playMode, router])

  async function handlePlayClick() {
    if (playMode === "offline") {
      setLoading(true)
      try {
        await startOfflinePreload({
          prefetchRoutes: async (paths) => Promise.allSettled(paths.map((p) => router.prefetch(p))),
        })
      } catch {
        // If download fails, keep current online reader available as fallback.
        setLoading(false)
        router.push("/reader")
        return
      }
      setLoading(false)
    }

    if (audiobooks.length > 0) {
      const mostRecent = audiobooks[0]
      localStorage.setItem(ACTIVE_AUDIOBOOK_STORAGE_KEY, mostRecent.id)
      router.push(
        `/reader?id=${encodeURIComponent(mostRecent.id)}`,
      )
      return
    }

    localStorage.removeItem(ACTIVE_AUDIOBOOK_STORAGE_KEY)
    router.push("/reader")
  }

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!showEnableOfflineDialog) return
    if (!autoCloseOfflineDialogOnReadyRef.current) return
    if (offlinePreload.status !== "ready") return
    setShowEnableOfflineDialog(false)
  }, [offlinePreload.status, showEnableOfflineDialog])

  useEffect(() => {
    if (!showQuickstartEmbed) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    setQuickstartIframeLoaded(false)
    setQuickstartIframeFailed(false)

    const timer = window.setTimeout(() => {
      // If the embed is blocked (CSP, X-Frame-Options, Cloudflare challenge), onLoad may never fire.
      setQuickstartIframeFailed(true)
    }, QUICKSTART_LOAD_FALLBACK_MS)

    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previousOverflow
    }
  }, [QUICKSTART_LOAD_FALLBACK_MS, showQuickstartEmbed])

  const quickstartOverlay =
    showQuickstartEmbed && isMounted
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black-text/80 backdrop-blur-sm px-4 py-10"
            onClick={() => setShowQuickstartEmbed(false)}
          >
            <div
              className="relative w-full"
              style={{ maxWidth: "min(90vw, calc(80vh * 4 / 3))" }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close quickstart overlay"
                className="absolute -top-4 -left-4 md:-top-6 md:-left-6 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white-text/40 bg-white-text/10 text-white-text transition hover:bg-white-text/20"
                onClick={() => setShowQuickstartEmbed(false)}
              >
                <X className="h-5 w-5" />
              </button>
              <div className="w-full h-[75vh] max-h-[85vh] md:h-auto md:aspect-[4/3] bg-black-text/60 rounded-2xl overflow-hidden shadow-2xl border border-white-text/15">
                <iframe
                  src={QUICKSTART_GUIDE_URL}
                  style={{ width: "100%", height: "100%" }}
                  allow="fullscreen"
                  allowFullScreen
                  title="Walking Book Quick Start"
                  onLoad={() => setQuickstartIframeLoaded(true)}
                  // Not consistently supported across browsers, but harmless and useful where available.
                  onError={() => setQuickstartIframeFailed(true)}
                />
              </div>
              {!quickstartIframeLoaded && quickstartIframeFailed && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    className="text-xs md:text-sm text-[#F6F8EF]/80 underline underline-offset-4 hover:text-[#F6F8EF]"
                    onClick={() => window.open(QUICKSTART_GUIDE_URL, "_blank", "noopener,noreferrer")}
                  >
                    Open in a new tab
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null

  const offlineEnableOverlay =
    showEnableOfflineDialog && isMounted
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black-text/80 backdrop-blur-sm px-4 py-10"
            onClick={() => setShowEnableOfflineDialog(false)}
          >
            <div
              className="relative w-full max-w-lg rounded-2xl overflow-hidden border-2 border-black-text bg-white-text text-black-text shadow-[6px_6px_0_0_rgba(35,31,32,0.12)] font-sans"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close offline mode prompt"
                className="absolute top-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-black-text/20 bg-white-text text-black-text transition hover:bg-black-text/5"
                onClick={() => setShowEnableOfflineDialog(false)}
              >
                <X className="h-5 w-5" />
              </button>

              <div className="p-6 md:p-8">
                <div className="text-xs font-sans font-semibold uppercase tracking-[0.35em] text-black-text/70">
                  Settings
                </div>
                <h2 className="mt-3 text-2xl md:text-3xl font-black tracking-tight text-black-text font-sans">
                  Enable Offline Mode
                </h2>
                <p className="mt-3 text-sm md:text-base text-black-text/70 font-sans leading-relaxed">
                  This will prepare the app for offline use and download the open-source Moonshine speech model. If you
                  save this page to your Home Screen it will become an app.
                </p>

                {(isStartingOfflinePreload ||
                  offlinePreload.status === "loading" ||
                  offlinePreload.status === "ready" ||
                  offlinePreload.status === "error") && (
                  <div className="mt-6">
                    <div className="h-2 w-full rounded-full bg-black-text/10 overflow-hidden">
                      <div
                        className="h-full bg-black-text transition-[width] duration-300"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(100, offlinePreload.status === "idle" ? 3 : offlinePreload.progress),
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-black-text/70">
                      <span>
                        {offlinePreload.status === "idle"
                          ? "Starting offline setup…"
                          : (offlinePreload.message ?? "Preparing offline…")}
                      </span>
                      <span className="tabular-nums">
                        {offlinePreload.status === "ready"
                          ? "100%"
                          : offlinePreload.status === "idle"
                            ? "—"
                            : `${offlinePreload.progress}%`}
                      </span>
                    </div>
                    {offlinePreload.status === "error" && offlinePreload.errorMessage && (
                      <div className="mt-2 text-xs text-red-700">{offlinePreload.errorMessage}</div>
                    )}
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-3">
                  <Button
                    type="button"
                    variant="house"
                    className="rounded-full"
                    disabled={offlinePreload.status === "loading" || isStartingOfflinePreload}
                    onClick={() => {
                      localStorage.setItem(OFFLINE_ONBOARDING_DONE_KEY, "1")
                      setPlayMode("offline")
                      localStorage.setItem(PLAY_MODE_STORAGE_KEY, "offline")
                      if (offlinePreload.status === "ready") {
                        setShowEnableOfflineDialog(false)
                        return
                      }
                      // Immediately reflect "starting" so users don't double-tap and wonder if it's working.
                      setIsStartingOfflinePreload(true)
                      toast.info("Preparing offline…")
                      void startOfflinePreload({
                        prefetchRoutes: async (paths) => Promise.allSettled(paths.map((p) => router.prefetch(p))),
                      }).catch(() => {
                        // Avoid unhandled promise rejection; UI reads status from shared state.
                      }).finally(() => {
                        // If the preload manager didn't transition us out of idle for some reason,
                        // don't leave the UI stuck in a "starting" state.
                        setIsStartingOfflinePreload(false)
                      })
                    }}
                  >
                    {offlinePreload.status === "loading" || isStartingOfflinePreload
                      ? "Starting…"
                      : offlinePreload.status === "ready"
                        ? "Use Offline Mode"
                        : offlinePreload.status === "error"
                          ? "Try Again"
                          : "Enable Offline Mode"}
                  </Button>

                  <Button
                    type="button"
                    variant="houseSecondary"
                    className="rounded-full"
                    onClick={() => setShowEnableOfflineDialog(false)}
                  >
                    {offlinePreload.status === "ready" ? "Done" : "Not now"}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <Suspense fallback={null}>
        <QuickstartListener onShowQuickstart={() => setShowQuickstartEmbed(true)} />
      </Suspense>
      <div className="h-[100dvh] flex flex-col overflow-hidden bg-[#231F20]">
      <header className="px-6 pt-8 pb-4 md:px-12 md:pt-12 md:h-[20vh] md:flex md:items-center">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 md:flex md:items-center md:justify-between md:w-full">
          <div className="min-w-0">
            <h1
              className="text-[#F6F8EF] text-3xl md:text-[4.5rem] lg:text-[6rem] xl:text-[7.5rem] font-bold md:font-black font-sans md:tracking-tight"
              style={{ fontFamily: "Univers, sans-serif", fontWeight: 700 }}
            >
              Walking Book
            </h1>
          </div>

          <div className="flex items-start gap-4 md:gap-8">
            {/* Mobile menu stays compact; desktop menu moves top-right and is 2× larger. */}
            <div className="md:hidden">
              <MenuDropdown variant="dark" />
            </div>
            <div className="hidden md:block">
              <MenuDropdown variant="dark" className="p-3">
                <img src="/menu.svg" alt="" aria-hidden="true" className="h-[3.2rem] w-[3.2rem]" />
              </MenuDropdown>
            </div>
          </div>

          <p className="md:hidden col-span-2 mt-8 mb-8 text-[#F6F8EF] text-base font-sans leading-normal">
            <span className="font-bold">Your book on tape. Narrated for your walk.</span>{" "}
            <span className="font-normal">
              Turn your draft into a private audio tape with one of 18 lifelike voices. Listen, walk, and record notes
              by voice. 100% private. Keep your creative process human.
            </span>
          </p>
        </div>
      </header>

      {/* Desktop intro spans full 3-column width and wraps naturally as the viewport changes. */}
      <div className="hidden md:grid md:h-[20vh] md:px-12 md:items-center md:grid-cols-3 md:gap-10">
        <p className="col-span-3 text-[#F6F8EF] text-lg md:text-xl font-sans leading-normal">
          <span className="font-bold">Your book on tape. Narrated for your walk.</span>{" "}
          <span className="font-normal">
            Turn your draft into a private audio tape with one of 18 lifelike voices. Listen, walk, and record notes by
            voice. 100% private. Keep your creative process human.
          </span>
        </p>
      </div>

      <div className="flex-1 min-h-0 md:flex-none md:h-[40vh] relative overflow-hidden">
        <img
          src="/images/street-art-hero.jpg"
          alt="Street art with colorful flowers on stone wall"
          className="w-full h-full object-cover object-[30%_25%] md:absolute md:top-1/2 md:left-0 md:-translate-y-[40%] md:w-[100%] md:h-auto"
        />
        <div className="absolute top-6 right-6 md:top-12 md:right-12 z-10 flex flex-col items-end">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-[#F6F8EF] bg-[#231F20] px-4 py-2 text-[#F6F8EF] text-xs md:text-sm font-semibold backdrop-blur-sm transition-transform hover:scale-105 focus-visible:scale-105 hover:opacity-90"
            onClick={() => {
              autoCloseOfflineDialogOnReadyRef.current = getOfflinePreloadState().status !== "ready"
              setShowEnableOfflineDialog(true)
            }}
          >
            Use Offline <ArrowDown className="h-4 w-4" />
          </button>
          {offlinePreload.status === "loading" && (
            <div className="mt-2 text-[11px] md:text-xs text-[#F6F8EF]/80 text-right">Downloading…</div>
          )}
        </div>
        <button
          type="button"
          aria-label="Show Walking Book quickstart"
          className="absolute bottom-6 left-6 md:bottom-12 md:left-12 transition-transform hover:scale-105 focus-visible:scale-105"
          onClick={() => setShowQuickstartEmbed(true)}
        >
          <img
            src="/images/walkgingbookquickstart.png"
            alt="Walking Book quickstart guide"
            className="w-28 md:w-40 quickstart-spin drop-shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
          />
        </button>
      </div>

      <div className="flex h-24 md:h-[20vh] border-t border-[#F6F8EF]/20 relative">
        <button
          className="group flex-1 bg-[#231F20] text-[#F6F8EF] font-sans text-2xl md:text-3xl font-bold hover:bg-[#2a2627] transition-colors"
          onClick={() =>
            window.open(
              COLAB_NOTEBOOK_URL,
              "_blank",
              "noopener,noreferrer",
            )
          }
        >
          <span className="inline-block transition-transform group-hover:scale-105 group-focus-visible:scale-105">
            Create
          </span>
        </button>

        <div className="w-[2px] md:w-[4px] bg-[#F6F8EF]" />

        <div className="flex-1 relative">
          <button
            className="group w-full h-full bg-[#231F20] text-[#F6F8EF] font-sans text-2xl md:text-3xl font-bold hover:bg-[#2a2627] transition-colors relative flex items-center justify-center"
            onClick={handlePlayClick}
            disabled={loading}
          >
            <span className="inline-block transition-transform group-hover:scale-105 group-focus-visible:scale-105">
              {loading ? "Loading" : "Play"}
            </span>
            {loading && (
              <div className="absolute right-[12.5%] flex items-center">
                <RefreshCw className="w-6 h-6 md:w-8 md:h-8 animate-spin" />
              </div>
            )}
            {playMode === "offline" && offlinePreload.status === "loading" && (
              <div className="absolute left-4 bottom-2 text-[11px] md:text-xs text-[#F6F8EF]/70">
                Downloading offline pack…
              </div>
            )}
          </button>
        </div>
      </div>

      <Input
        id="file-upload"
        type="file"
        accept=".walkingbook,.zip"
        onChange={handleFileUpload}
        disabled={loading}
        className="hidden"
      />
    </div>

    {quickstartOverlay}
    {offlineEnableOverlay}
    </>
  )
}

function QuickstartListener({ onShowQuickstart }: { onShowQuickstart: () => void }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    if (searchParams?.get("quickstart") === "1") {
      handledRef.current = true
      onShowQuickstart()
      router.replace("/", { scroll: false })
    }
  }, [searchParams, onShowQuickstart, router])

  return null
}
