"use client"

import type React from "react"

import { Suspense, useEffect, useState, useRef, useCallback, useLayoutEffect, useMemo } from "react"
import { flushSync } from "react-dom"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { getAudiobook, getSession, saveSession, getAudioFile, clearAllData } from "@/lib/db"
import type { StoredAudiobook, SessionData, VoiceEdit } from "@/types/audiobook"
import { TextDisplay } from "@/components/text-display"
import { VoiceEditor } from "@/components/voice-editor"
import { VoiceEditorOfflineMoonshine } from "@/components/voice-editor-offline-moonshine"
import { MenuDropdown } from "@/components/menu-dropdown"
import { EditableGreeting } from "@/components/editable-greeting"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { Play, Pause, Settings as SettingsIcon, X, RefreshCw, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useReaderEnvironment } from "@/hooks/use-reader-environment"
import { cn, getReadableTextColor, hexToRgba, mixHexColors } from "@/lib/utils"
import {
  loadEnvironment,
  type ReaderEnvironmentSettings,
  HOUSE_BLACK,
  HOUSE_WHITE,
  RISOGRAPH_ACCENT_SWATCHES,
  RISOGRAPH_BACKGROUND_SWATCHES,
  RISOGRAPH_HIGHLIGHT_SWATCHES,
  READER_FONT_OPTIONS,
  getReaderFontStack,
} from "@/lib/preferences"
import { sanitizeSessionData } from "@/lib/session-utils"
import { getEditTypeLabel } from "@/lib/edit-utils"
import { loadWalkingBookZip } from "@/lib/zip-loader"
import { waitForPaint } from "@/lib/wait-for-paint"
import { toast } from "sonner"
import { ACTIVE_AUDIOBOOK_STORAGE_KEY, COLAB_NOTEBOOK_URL } from "@/lib/constants"
import { downloadSessionBackup } from "@/lib/downloads"
import { getOfflinePreloadState, subscribeOfflinePreloadState, type OfflinePreloadState } from "@/lib/offline-preload"
import { openCommentStudioPanel } from "@/lib/menu-controller"

// Mobile detection hook
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      // Check for touch capability and screen size
      const hasTouchScreen = "ontouchstart" in window || navigator.maxTouchPoints > 0
      const isSmallScreen = window.innerWidth < 768
      setIsMobile(hasTouchScreen && isSmallScreen)
    }

    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  return isMobile
}

function ReaderPageSuspenseFallback() {
  return <LoadingScreen message="Loading reader..." />
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<ReaderPageSuspenseFallback />}>
      <ReaderPageContent />
    </Suspense>
  )
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen flex flex-col items-center justify-center gap-6 bg-[#231F20] text-white-text px-6 text-center font-sans"
    >
      <Loader2 className="h-10 w-10 animate-spin text-white-text" aria-hidden="true" />
      <p className="opacity-80 text-lg">{message}</p>
    </div>
  )
}

function ReaderPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isMobile = useIsMobile()
  const [activeAudiobookId, setActiveAudiobookId] = useState<string | null>(null)
  const [isInitializingActiveId, setIsInitializingActiveId] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [isChoosingFile, setIsChoosingFile] = useState(false)
  const emptyStateFileInputRef = useRef<HTMLInputElement>(null)
  const id = activeAudiobookId
  // When a session backup is restored we navigate to the same reader route with a
  // different query param (e.g. `&restored=...`). If we only reload on `id` changes,
  // the UI won't reflect the restored session until a full page reload.
  const restoredKey = searchParams?.get("restored") ?? null
  const [audiobook, setAudiobook] = useState<StoredAudiobook | null>(null)
  const [sessionData, setSessionData] = useState<SessionData | null>(null)
  const sessionDataRef = useRef<SessionData | null>(null)
  const [showVoiceEditor, setShowVoiceEditor] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [textProgress, setTextProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null)
  const [viewingEdit, setViewingEdit] = useState<string | null>(null)
  const textContainerRef = useRef<HTMLDivElement>(null)
  const textScrollRef = useRef<HTMLDivElement>(null)
  const mobileSettingsMenuRef = useRef<HTMLDivElement>(null)
  const scrollSyncingRef = useRef(false)
  const textScrollSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTextScrollProgressRef = useRef(0)
  const lastSavedTextScrollProgressRef = useRef<number | null>(null)
  const hasAppliedInitialScrollRef = useRef(false)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cursorPosition, setCursorPosition] = useState<{
    chunkIndex: number
    chunkId: string
    segmentIndex: number
  } | null>(null)
  const [autoStartRecording, setAutoStartRecording] = useState(false)
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null)
  const [lastTapTime, setLastTapTime] = useState<number>(0)
  const [isListeningForEdit, setIsListeningForEdit] = useState(false)
  const editListeningRecognitionRef = useRef<any>(null)
  const [editCommandHeard, setEditCommandHeard] = useState(false)
  const [isMicPermissionDialogOpen, setIsMicPermissionDialogOpen] = useState(false)
  const hasShownMicPermissionDialogRef = useRef(false)
  const [shouldPlayAfterSeek, setShouldPlayAfterSeek] = useState(false)
  const [loadedAudioFile, setLoadedAudioFile] = useState<string | null>(null)
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0)
  const { environment, updateEnvironment, resetEnvironment } = useReaderEnvironment()
  const [isSidebarSettingsOpen, setIsSidebarSettingsOpen] = useState(false)
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false)
  const [highlightedSegment, setHighlightedSegment] = useState<{ chunkIndex: number; segmentIndex: number } | null>(null)
  const [offlinePreload, setOfflinePreload] = useState<OfflinePreloadState>(() => getOfflinePreloadState())
  const [isEjectDialogOpen, setIsEjectDialogOpen] = useState(false)
  const [ejectInProgress, setEjectInProgress] = useState<"backup" | "eject" | null>(null)
  const hasDefaultedSpeechEngineRef = useRef(false)

  useEffect(() => {
    setOfflinePreload(getOfflinePreloadState())
    return subscribeOfflinePreloadState((state) => setOfflinePreload(state))
  }, [])

  useEffect(() => {
    // After the offline pack (Moonshine model) is downloaded, default the Voice Editor
    // transcription engine to Moonshine once. Users can still change it in Settings.
    if (typeof window === "undefined") return
    if (offlinePreload.status !== "ready") return

    const DEFAULTED_KEY = "walkingbook-defaulted-speech-engine-to-moonshine"
    if (hasDefaultedSpeechEngineRef.current) return
    hasDefaultedSpeechEngineRef.current = true

    try {
      const alreadyDefaulted = localStorage.getItem(DEFAULTED_KEY) === "1"
      if (alreadyDefaulted) return

      if (environment.speechEngine !== "moonshine") {
        updateEnvironment({ speechEngine: "moonshine" })
      }

      localStorage.setItem(DEFAULTED_KEY, "1")
    } catch {
      // ignore storage failures; this is just a convenience default
    }
  }, [environment.speechEngine, offlinePreload.status, updateEnvironment])

  useEffect(() => {
    const paramId = searchParams?.get("id")
    if (paramId) {
      setActiveAudiobookId(paramId)
      if (typeof window !== "undefined") {
        localStorage.setItem(ACTIVE_AUDIOBOOK_STORAGE_KEY, paramId)
      }
      setIsInitializingActiveId(false)
      return
    }

    if (typeof window !== "undefined") {
      const storedId = localStorage.getItem(ACTIVE_AUDIOBOOK_STORAGE_KEY)
      setActiveAudiobookId(storedId)
    } else {
      setActiveAudiobookId(null)
    }
    setIsInitializingActiveId(false)
  }, [searchParams])

  const readerBackground = environment.backgroundColor
  const highlightColor = environment.highlightColor
  const accentColor = environment.accentColor
  const toHouseTextColor = (bg: string) => (getReadableTextColor(bg) === "#FFFFFF" ? HOUSE_WHITE : HOUSE_BLACK)
  const highlightTextColor = toHouseTextColor(highlightColor)
  const accentTextColor = toHouseTextColor(accentColor)
  const accentSoft = hexToRgba(accentColor, 0.15)
  const accentSoftStrong = hexToRgba(accentColor, 0.3)
  const readerTextColor = toHouseTextColor(readerBackground)
  const readerFontFamily = getReaderFontStack(environment.fontFamily)

  const audioCurrentTime = sessionData?.currentTime ?? 0
  const accentControlSoft = hexToRgba(accentTextColor, 0.2)
  const highlightControlSoft = hexToRgba(highlightTextColor, 0.2)

  const activeAudioChunk = useMemo(() => {
    if (!audiobook) return null
    const byIndex = audiobook.manifest.chunks[currentChunkIndex]
    if (byIndex) return byIndex
    const byId = sessionData?.currentChunkId
      ? audiobook.manifest.chunks.find((chunk) => chunk.chunk_id === sessionData.currentChunkId)
      : null
    return byId ?? audiobook.manifest.chunks[0] ?? null
  }, [audiobook, currentChunkIndex, sessionData?.currentChunkId])

  const chunkDurations = useMemo(() => {
    if (!audiobook) return []
    return audiobook.manifest.chunks.map((chunk) => {
      const timestamps = chunk?.timestamps ?? []
      let maxEnd = 0
      for (const seg of timestamps) {
        if (typeof seg?.end_time === "number" && Number.isFinite(seg.end_time)) {
          maxEnd = Math.max(maxEnd, seg.end_time)
        }
      }
      // Fallback to element duration if available (rarely better than metadata, but helps if timestamps are missing).
      if (!maxEnd) {
        const elementDuration =
          typeof audioRef.current?.duration === "number" && Number.isFinite(audioRef.current.duration)
            ? audioRef.current.duration
            : 0
        maxEnd = elementDuration || 0
      }
      return maxEnd
    })
  }, [audiobook, currentAudioUrl])

  const totalAudioDuration = useMemo(() => {
    if (!chunkDurations.length) return 0
    return chunkDurations.reduce((sum, d) => sum + (Number.isFinite(d) ? d : 0), 0)
  }, [chunkDurations])

  const audioDurationForActiveChunk = useMemo(() => {
    if (!chunkDurations.length) return 0
    return chunkDurations[currentChunkIndex] ?? 0
  }, [chunkDurations, currentChunkIndex])

  const currentGlobalAudioTime = useMemo(() => {
    if (!chunkDurations.length) return audioCurrentTime
    let prior = 0
    for (let i = 0; i < currentChunkIndex; i++) {
      prior += chunkDurations[i] ?? 0
    }
    return prior + (audioCurrentTime || 0)
  }, [audioCurrentTime, chunkDurations, currentChunkIndex])

  function formatHoursMinutes(seconds: number) {
    if (!seconds || Number.isNaN(seconds) || seconds < 0) return "0:00"
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}:${minutes.toString().padStart(2, "0")}`
  }
  useEffect(() => {
    if (!isMobileSettingsOpen) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (!mobileSettingsMenuRef.current) return
      if (mobileSettingsMenuRef.current.contains(target)) return
      setIsMobileSettingsOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("touchstart", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("touchstart", handlePointerDown)
    }
  }, [isMobileSettingsOpen])
  const handleEnvironmentChange = useCallback(
    (updates: Partial<ReaderEnvironmentSettings>) => {
      updateEnvironment(updates)
    },
    [updateEnvironment],
  )

  useEffect(() => {
    return () => {
      if (textScrollSaveTimeoutRef.current) {
        clearTimeout(textScrollSaveTimeoutRef.current)
      }
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!sessionData) {
      hasAppliedInitialScrollRef.current = false
    }
  }, [sessionData])

  useEffect(() => {
    sessionDataRef.current = sessionData
  }, [sessionData])

  const updateSession = useCallback(
    async (updates: Partial<SessionData>) => {
      console.log("[v0] updateSession called with:", Object.keys(updates))
      const baseSession = sessionDataRef.current ?? sessionData
      if (!baseSession || !audiobook || !id) {
        console.log("[v0] updateSession: missing sessionData or audiobook, returning early!")
        return
      }
      const updatedSession = { ...baseSession, ...updates, lastUpdated: new Date().toISOString() }
      const sanitizedSession = sanitizeSessionData(updatedSession, audiobook.manifest.chunks)
      console.log("[v0] updateSession: edits count =", sanitizedSession.edits?.length)
      setSessionData(sanitizedSession)
      sessionDataRef.current = sanitizedSession
      await saveSession(id, sanitizedSession)
      console.log("[v0] updateSession: saveSession completed")
    },
    [audiobook, id, sessionData],
  )

  const commitUserName = useCallback(
    (nextName: string) => {
      handleEnvironmentChange({ userName: nextName })
      void updateSession({ userName: nextName })
    },
    [handleEnvironmentChange, updateSession],
  )

  useEffect(() => {
    if (!id) {
      setAudiobook(null)
      setSessionData(null)
      sessionDataRef.current = null
      return
    }
    loadData()
  }, [id, restoredKey])

  async function loadData() {
    if (!id) return
    const book = await getAudiobook(id)
    if (!book) {
      setAudiobook(null)
      setSessionData(null)
      sessionDataRef.current = null
      setActiveAudiobookId(null)
      if (typeof window !== "undefined") {
        localStorage.removeItem(ACTIVE_AUDIOBOOK_STORAGE_KEY)
      }
      return
    }
    setAudiobook(book)

    const savedEnv = loadEnvironment()
    const savedName = savedEnv.userName

    let sessionData = await getSession(id)

    if (!sessionData) {
      sessionData = {
        userName: savedName || "",
        currentChunkId: book.manifest.chunks[0]?.chunk_id || "",
        currentAudioFile: book.manifest.chunks[0]?.audio_file || "",
        currentTime: 0,
        lastUpdated: new Date().toISOString(),
        edits: [],
        textScrollPosition: 0,
      }
    } else if (savedName && sessionData.userName !== savedName) {
      sessionData = { ...sessionData, userName: savedName }
    }

    const sanitizedSession = sanitizeSessionData(sessionData, book.manifest.chunks)

    await saveSession(id, sanitizedSession)

    setSessionData(sanitizedSession)
    // Keep the ref in sync immediately so updates can't "no-op" if triggered
    // before the `useEffect([sessionData])` runs (e.g. fast voice-editor flows).
    sessionDataRef.current = sanitizedSession
    setTextProgress(sanitizedSession.textScrollPosition || 0)
  }

  const handleEmptyStateUploadClick = useCallback(() => {
    if (isImporting) return
    // Some browsers/providers can take seconds before `onChange` fires for very large files.
    // Show immediate feedback as soon as the user taps "Upload".
    flushSync(() => setIsChoosingFile(true))
    emptyStateFileInputRef.current?.click()
  }, [isImporting])

  const handleLoadSampleTape = useCallback(async () => {
    if (isImporting) return
    if (typeof window === "undefined") return

    // Force the loading UI to paint immediately (zip parsing can block the main thread).
    flushSync(() => {
      setIsChoosingFile(false)
      setIsImporting(true)
    })
    await waitForPaint()

    try {
      await clearAllData()
      const samplePath = "/Bernice_Bobs_Her_Hair_by_F_Scott_Fitzgerald_v1_walkingbook.zip"
      const response = await fetch(samplePath)
      if (!response.ok) {
        throw new Error(`Failed to fetch sample tape (${response.status})`)
      }
      const blob = await response.blob()
      const file = new File([blob], "Bernice_Bobs_Her_Hair_by_F_Scott_Fitzgerald_v1_walkingbook.zip", {
        type: blob.type || "application/zip",
      })

      const audiobookId = await loadWalkingBookZip(file)
      localStorage.setItem(ACTIVE_AUDIOBOOK_STORAGE_KEY, audiobookId)
      setActiveAudiobookId(audiobookId)
      router.replace("/reader")
      toast.success("Sample tape loaded")
    } catch (error) {
      console.error("Error loading sample tape:", error)
      toast.error("Failed to load sample tape")
    } finally {
      setIsImporting(false)
    }
  }, [isImporting, router])

  useEffect(() => {
    if (!isChoosingFile) return
    if (typeof window === "undefined") return
    const handleFocus = () => {
      // When the file picker closes, the window typically regains focus.
      // If the user cancelled, clear the "Opening file…" state.
      window.setTimeout(() => {
        const hasFile = (emptyStateFileInputRef.current?.files?.length ?? 0) > 0
        if (!hasFile && !isImporting) {
          setIsChoosingFile(false)
        }
      }, 0)
    }
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [isChoosingFile, isImporting])

  async function handleEmptyStateFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith(".walkingbook") && !file.name.endsWith(".zip")) {
      toast.error("Please upload a .walkingbook file")
      event.target.value = ""
      setIsChoosingFile(false)
      return
    }

    // Force the loading UI to paint immediately (zip parsing can block the main thread).
    flushSync(() => {
      setIsChoosingFile(false)
      setIsImporting(true)
    })
    // Let React paint the "Loading zip…" UI before heavy work starts (zip parsing can block the main thread).
    await waitForPaint()

    try {
      await clearAllData()
      const audiobookId = await loadWalkingBookZip(file)
      if (typeof window !== "undefined") {
        localStorage.setItem(ACTIVE_AUDIOBOOK_STORAGE_KEY, audiobookId)
      }
      setActiveAudiobookId(audiobookId)
      router.replace("/reader")
      toast.success("Audiobook loaded successfully")
    } catch (error) {
      console.error("Error loading audiobook:", error)
      toast.error("Failed to load audiobook")
    } finally {
      setIsImporting(false)
      event.target.value = ""
    }
  }

  useEffect(() => {
    if (!sessionData) return
    if (!id) return
    if (environment.userName === undefined) return
    if (environment.userName === sessionData.userName) return

    const updatedSession = { ...sessionData, userName: environment.userName }
    setSessionData(updatedSession)
    sessionDataRef.current = updatedSession
    void saveSession(id, updatedSession)
  }, [environment.userName, sessionData, id])

  useEffect(() => {
    if (!id || !audiobook) return
    const savedPosition = localStorage.getItem(`walkingbook_position_${id}`)
    if (savedPosition) {
      const { audioFile, position, chunkIndex } = JSON.parse(savedPosition)
      if (audioFile) {
        getAudioFile(audiobook.id, audioFile).then((audioBlob) => {
          if (audioBlob) {
            const url = URL.createObjectURL(audioBlob)
            setPendingSeekTime(position)
            setCurrentAudioUrl(url)
            setLoadedAudioFile(audioFile)
            setCurrentChunkIndex(chunkIndex || 0)
            const chunk = audiobook.manifest.chunks[chunkIndex || 0]
            if (chunk) {
              updateSession({ currentChunkId: chunk.chunk_id, currentAudioFile: audioFile, cursorPosition: position })
            }
          }
        })
      }
    }
  }, [audiobook, id])

  useEffect(() => {
    async function loadAudio() {
      if (!audiobook) return

      let audioFileToLoad = sessionData?.currentAudioFile

      if (!audioFileToLoad) {
        audioFileToLoad = audiobook.manifest.chunks[0]?.audio_file
        if (!audioFileToLoad) {
          return
        }
        await updateSession({
          currentChunkId: audiobook.manifest.chunks[0]?.chunk_id || "",
          currentAudioFile: audioFileToLoad,
          cursorPosition: 0,
        })
      }

      if (loadedAudioFile === audioFileToLoad) return

      const audioBlob = await getAudioFile(audiobook.id, audioFileToLoad)
      if (audioBlob) {
        if (currentAudioUrl) {
          URL.revokeObjectURL(currentAudioUrl)
        }
        const url = URL.createObjectURL(audioBlob)
        setCurrentAudioUrl(url)
        setLoadedAudioFile(audioFileToLoad)
        if (!sessionData?.currentAudioFile) {
          setCurrentChunkIndex(0)
        }
      }
    }
    loadAudio()
  }, [audiobook, sessionData?.currentAudioFile, loadedAudioFile, currentAudioUrl, updateSession])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentAudioUrl) return

    const handleCanPlay = () => {
      if (pendingSeekTime !== null) {
        audio.currentTime = pendingSeekTime
        setPendingSeekTime(null)
      }

      if (shouldPlayAfterSeek) {
        setShouldPlayAfterSeek(false)
        setIsPlaying(true)
        audio.play().catch((err) => {
          console.error("Error playing audio:", err)
          setIsPlaying(false)
        })
      }
    }

    audio.addEventListener("canplay", handleCanPlay)

    if (audio.readyState >= 3 && (pendingSeekTime !== null || shouldPlayAfterSeek)) {
      handleCanPlay()
    }

    return () => audio.removeEventListener("canplay", handleCanPlay)
  }, [currentAudioUrl, pendingSeekTime, shouldPlayAfterSeek])

  useEffect(() => {
    if (sessionData?.currentAudioFile && sessionData?.currentTime !== undefined && audiobook?.id) {
      localStorage.setItem(
        `walkingbook_position_${audiobook.id}`,
        JSON.stringify({
          audioFile: sessionData.currentAudioFile,
          chunkIndex: currentChunkIndex,
          position: sessionData.currentTime,
        }),
      )
    }
  }, [sessionData?.currentAudioFile, sessionData?.currentTime, audiobook?.id, currentChunkIndex])

  useEffect(() => {
    return () => {
      if (editListeningRecognitionRef.current) {
        try {
          editListeningRecognitionRef.current.stop()
        } catch (err) {
          console.error("Error cleaning up edit command listener:", err)
        }
        editListeningRecognitionRef.current = null
      }
    }
  }, [])

  const primeMicrophonePermission = useCallback(async () => {
    if (typeof window === "undefined") return false
    if (!navigator.mediaDevices?.getUserMedia) return false
    const STORAGE_KEY = "walkingbook-mic-permission-primed"
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return true
    } catch {
      // ignore storage failures
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) track.stop()
      try {
        localStorage.setItem(STORAGE_KEY, "1")
      } catch {
        // ignore
      }
      return true
    } catch {
      return false
    }
  }, [])

  // Proactively request mic permission when the reader opens (mobile-first).
  // This avoids the permission prompt appearing only after the user taps Play.
  useEffect(() => {
    if (!isMobile) return
    // Important: don't request mic permission on the empty (upload) state,
    // otherwise it can interfere with the file picker gesture on mobile.
    if (!audiobook) return
    if (typeof window === "undefined") return
    const STORAGE_KEY = "walkingbook-mic-permission-primed"
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return
    } catch {
      // ignore storage failures
    }

    if (!navigator.mediaDevices?.getUserMedia) return

    let cancelled = false
    // If the mic is already granted, prime immediately (no prompt).
    // If it would prompt, show an explicit dialog as soon as the reader opens.
    const maybePrimeOrPrompt = async () => {
      if (cancelled) return
      try {
        const permissions = (navigator as any).permissions
        if (permissions?.query) {
          const status = await permissions.query({ name: "microphone" })
          if (cancelled) return
          if (status?.state === "granted") {
            await primeMicrophonePermission()
            return
          }
        }
      } catch {
        // ignore; fall back to the dialog / gesture-based prompt
      }

      if (!hasShownMicPermissionDialogRef.current) {
        hasShownMicPermissionDialogRef.current = true
        setIsMicPermissionDialogOpen(true)
      }
    }

    void maybePrimeOrPrompt()

    // Fallback: many browsers require a user gesture; if the user dismisses the dialog,
    // the first gesture will still prime permission (and avoid later delays).
    const onFirstGesture = () => {
      void primeMicrophonePermission()
      window.removeEventListener("pointerdown", onFirstGesture)
    }
    window.addEventListener("pointerdown", onFirstGesture, { passive: true })
    return () => {
      cancelled = true
      window.removeEventListener("pointerdown", onFirstGesture)
    }
  }, [isMobile, audiobook, primeMicrophonePermission])

  // Media Session API for headphone controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return

    const handleMediaSessionPause = () => {
      console.log("[MediaSession] Pause triggered from headphones")
      if (audioRef.current && isPlaying) {
        audioRef.current.pause()
        setIsPlaying(false)
        try {
          navigator.mediaSession.playbackState = "paused"
        } catch {}

        // Set cursor position for editing
        if (audiobook && sessionData) {
          const chunk = audiobook.manifest.chunks[currentChunkIndex]
          if (chunk) {
            const segmentIndex = chunk.timestamps.findIndex((seg, idx) => {
              const nextSeg = chunk.timestamps[idx + 1]
              return (
                sessionData.currentTime >= seg.start_time && (!nextSeg || sessionData.currentTime < nextSeg.start_time)
              )
            })
            setCursorPosition({
              chunkIndex: currentChunkIndex,
              chunkId: chunk.chunk_id,
              segmentIndex: segmentIndex !== -1 ? segmentIndex : 0,
            })
          }
        }

        // Start listening for edit command on mobile headphone pause
        if (isMobile) {
          startListeningForEditCommand()
        }
      }
    }

    const handleMediaSessionPlay = () => {
      console.log("[MediaSession] Play triggered from headphones")
      if (audioRef.current && !isPlaying) {
        setIsPlaying(true)
        audioRef.current.play().catch((err) => {
          console.error("Error playing audio:", err)
          setIsPlaying(false)
        })
        try {
          navigator.mediaSession.playbackState = "playing"
        } catch {}
      }
    }

    try {
      navigator.mediaSession.setActionHandler("pause", handleMediaSessionPause)
      navigator.mediaSession.setActionHandler("play", handleMediaSessionPlay)

      // Update media session metadata if audiobook is loaded
      if (audiobook) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: audiobook.metadata.title,
          artist: "Walking Book",
          album: audiobook.metadata.title,
        })
      }
    } catch (err) {
      console.error("Error setting up Media Session handlers:", err)
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler("pause", null)
        navigator.mediaSession.setActionHandler("play", null)
      } catch (err) {
        console.error("Error cleaning up Media Session handlers:", err)
      }
    }
  }, [isMobile, isPlaying, audiobook, sessionData, currentChunkIndex])

  const getTotalSegments = () => {
    if (!audiobook) return 0
    return audiobook.manifest.chunks.reduce((total, chunk) => total + chunk.timestamps.length, 0)
  }

  const getEditPosition = (chunkIndex: number, segmentIndex: number) => {
    if (!audiobook) return 0
    let position = 0
    for (let i = 0; i < chunkIndex && i < audiobook.manifest.chunks.length; i++) {
      position += audiobook.manifest.chunks[i].timestamps.length
    }
    return ((position + segmentIndex) / getTotalSegments()) * 100
  }

  const handleCursorPositionChange = useCallback(
    async (
      chunkIndex: number,
      segmentIndex: number,
      segmentData: { start_time: number; end_time: number },
      audioFile: string,
    ) => {
      if (!audiobook || !sessionData) return

      const currentTime = Date.now()
      const isDoubleTap = currentTime - lastTapTime < 300
      setLastTapTime(currentTime)

      const clickedChunk = audiobook.manifest.chunks[chunkIndex]
      if (!clickedChunk) return

      const isDifferentAudio = loadedAudioFile !== audioFile

      if (!isDifferentAudio && audioRef.current) {
        audioRef.current.currentTime = segmentData.start_time

        if (isDoubleTap) {
          setIsPlaying(true)
          try {
            await audioRef.current.play()
          } catch (err) {
            console.error("Error playing audio:", err)
            setIsPlaying(false)
          }
        }

        setCurrentChunkIndex(chunkIndex)
        updateSession({
          currentChunkId: clickedChunk.chunk_id,
          currentAudioFile: audioFile,
          cursorPosition: segmentData.start_time,
        })
      } else {
        if (audioRef.current) {
          audioRef.current.pause()
          setIsPlaying(false)
        }

        setPendingSeekTime(segmentData.start_time)
        setLoadedAudioFile(null)
        setCurrentChunkIndex(chunkIndex)

        await updateSession({
          currentChunkId: clickedChunk.chunk_id,
          currentAudioFile: audioFile,
          cursorPosition: segmentData.start_time,
        })
      }

      localStorage.setItem(
        `walkingbook_position_${audiobook.id}`,
        JSON.stringify({
          audioFile,
          chunkIndex,
          position: segmentData.start_time,
        }),
      )
    },
    [audiobook, sessionData, lastTapTime, loadedAudioFile, updateSession],
  )

  function handlePlayPause(_event?: React.MouseEvent, triggerEditListening = true) {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)

      if (audiobook && sessionData) {
        const chunk = audiobook.manifest.chunks[currentChunkIndex]
        if (chunk) {
          const segmentIndex = chunk.timestamps.findIndex((seg, idx) => {
            const nextSeg = chunk.timestamps[idx + 1]
            return (
              sessionData.currentTime >= seg.start_time && (!nextSeg || sessionData.currentTime < nextSeg.start_time)
            )
          })
          setCursorPosition({
            chunkIndex: currentChunkIndex,
            chunkId: chunk.chunk_id,
            segmentIndex: segmentIndex !== -1 ? segmentIndex : 0,
          })
        }
      }

      // Only trigger edit listening on mobile when pause is pressed
      // On desktop, user must click the pencil button to start voice edit
      if (isMobile && triggerEditListening) {
        startListeningForEditCommand()
      }
    } else {
      // On iOS/Safari, the first play can feel slow if we wait for "readyState".
      // Attempt play immediately if we have a src; the browser will buffer/decode as needed.
      // If there is no src yet, trigger a load and let the user tap again once ready.
      if (!currentAudioUrl) {
        if (audiobook && sessionData) {
          const audioFileToLoad = sessionData.currentAudioFile || audiobook.manifest.chunks[0]?.audio_file
          if (audioFileToLoad) {
            updateSession({ currentAudioFile: audioFileToLoad })
          }
        }
        return
      }

      setIsPlaying(true)
      audioRef.current.play().catch((err) => {
        console.error("Error playing audio:", err)
        setIsPlaying(false)
      })
    }
  }

  function startListeningForEditCommand() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.error("Speech recognition not supported")
      return
    }

    setIsListeningForEdit(true)
    setEditCommandHeard(false)

    const playListeningChime = () => {
      try {
        const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
        const AudioContextCtor = w.AudioContext ?? w.webkitAudioContext
        if (!AudioContextCtor) return
        const ctx = new AudioContextCtor()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "sine"
        osc.frequency.value = 880
        gain.gain.value = 0.0001
        osc.connect(gain)
        gain.connect(ctx.destination)
        const now = ctx.currentTime
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
        osc.start(now)
        osc.stop(now + 0.12)
        osc.onended = () => {
          try {
            void ctx.close()
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = "en-US"
    recognition.onstart = () => {
      // Audible cue: the browser has actually started listening.
      playListeningChime()
    }

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase()

      if (transcript.includes("edit")) {
        setEditCommandHeard(true)
        setShowVoiceEditor(true)
        setAutoStartRecording(true)
      }
      setIsListeningForEdit(false)
    }

    recognition.onerror = (event: any) => {
      console.error("Edit command listening error:", event.error)
      setIsListeningForEdit(false)
    }

    recognition.onend = () => {
      setIsListeningForEdit(false)
    }

    editListeningRecognitionRef.current = recognition

    try {
      recognition.start()
      // Give user 5 seconds to say "edit" (extra time for headphone users)
      setTimeout(() => {
        if (editListeningRecognitionRef.current) {
          try {
            editListeningRecognitionRef.current.stop()
          } catch (err) {}
          editListeningRecognitionRef.current = null
        }
      }, 5000)
    } catch (err) {
      console.error("Failed to start edit command listening:", err)
      setIsListeningForEdit(false)
    }
  }

  const stopListeningForEditDialog = useCallback(() => {
    if (editListeningRecognitionRef.current) {
      try {
        editListeningRecognitionRef.current.stop()
      } catch (err) {
        console.error("Failed to stop edit command listening:", err)
      }
      editListeningRecognitionRef.current = null
    }
    setIsListeningForEdit(false)
  }, [])

  function handleVoiceEditorClose() {
    setShowVoiceEditor(false)
    setViewingEdit(null)
    setAutoStartRecording(false)
    setCursorPosition(null)
    // Resume playback
    if (audioRef.current) {
      setIsPlaying(true)
      audioRef.current.play().catch((err) => {
        console.error("Error resuming playback:", err)
        setIsPlaying(false)
      })
    }
  }

  const moonshineEnabled = offlinePreload.status === "ready"
  const useMoonshineEditor = moonshineEnabled && environment.speechEngine === "moonshine"

  const scheduleTextScrollSave = useCallback(
    (progress: number) => {
      const clamped = Math.max(0, Math.min(100, progress))
      pendingTextScrollProgressRef.current = clamped

      if (textScrollSaveTimeoutRef.current) {
        return
      }

      textScrollSaveTimeoutRef.current = setTimeout(() => {
        const valueToSave = pendingTextScrollProgressRef.current
        if (
          lastSavedTextScrollProgressRef.current === null ||
          Math.abs(lastSavedTextScrollProgressRef.current - valueToSave) > 0.1
        ) {
          updateSession({ textScrollPosition: valueToSave })
          lastSavedTextScrollProgressRef.current = valueToSave
        }
        textScrollSaveTimeoutRef.current = null
      }, 150)
    },
    [updateSession],
  )

  const scrollToSegment = useCallback(
    (chunkIndex: number, segmentIndex: number) => {
      const container = textScrollRef.current
      if (!container) return
      const safeChunkIndex = Math.max(0, chunkIndex)
      const safeSegmentIndex = Math.max(0, segmentIndex)
      const selector = `[data-chunk-index="${safeChunkIndex}"][data-segment-index="${safeSegmentIndex}"]`
      const target = container.querySelector<HTMLElement>(selector)
      if (!target) return
      target.scrollIntoView({ behavior: "smooth", block: "center" })
      setHighlightedSegment({ chunkIndex: safeChunkIndex, segmentIndex: safeSegmentIndex })
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedSegment(null)
      }, 4000)
    },
    [setHighlightedSegment],
  )

  const focusEdit = useCallback(
    (edit: VoiceEdit) => {
      if (!audiobook) return
      const chunkIdxFromEdit =
        typeof edit.chunkIndex === "number" && edit.chunkIndex >= 0
          ? edit.chunkIndex
          : audiobook.manifest.chunks.findIndex((chunk) => chunk.chunk_id === edit.chunkId)
      const safeChunkIndex = chunkIdxFromEdit >= 0 ? chunkIdxFromEdit : 0
      const safeSegmentIndex = typeof edit.segmentIndex === "number" ? edit.segmentIndex : 0
      scrollToSegment(safeChunkIndex, safeSegmentIndex)
    },
    [audiobook, scrollToSegment],
  )

  const handleSliderChange = useCallback(
    (value: number) => {
      const clamped = Math.max(0, Math.min(100, value))
      setTextProgress(clamped)
      scheduleTextScrollSave(clamped)

      const container = textScrollRef.current
      if (container) {
        const maxScroll = container.scrollHeight - container.clientHeight
        scrollSyncingRef.current = true
        container.scrollTop = (clamped / 100) * (maxScroll > 0 ? maxScroll : 0)
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            scrollSyncingRef.current = false
          })
        } else {
          scrollSyncingRef.current = false
        }
      }
    },
    [scheduleTextScrollSave],
  )

  const handleSliderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const slider = event.currentTarget
      const pointerId = event.pointerId
      slider.focus()
      slider.setPointerCapture?.(pointerId)

      const updateFromClientX = (clientX: number) => {
        const rect = slider.getBoundingClientRect()
        if (!rect.width) return
        const percent = ((clientX - rect.left) / rect.width) * 100
        handleSliderChange(percent)
      }

      updateFromClientX(event.clientX)

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        updateFromClientX(moveEvent.clientX)
      }

      const endPointerInteraction = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        slider.releasePointerCapture?.(pointerId)
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", endPointerInteraction)
        window.removeEventListener("pointercancel", endPointerInteraction)
      }

      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", endPointerInteraction)
      window.addEventListener("pointercancel", endPointerInteraction)
    },
    [handleSliderChange],
  )

  const handleSliderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const smallStep = 2
      const largeStep = 10
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault()
        handleSliderChange(textProgress - (event.shiftKey ? largeStep : smallStep))
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault()
        handleSliderChange(textProgress + (event.shiftKey ? largeStep : smallStep))
      } else if (event.key === "Home") {
        event.preventDefault()
        handleSliderChange(0)
      } else if (event.key === "End") {
        event.preventDefault()
        handleSliderChange(100)
      }
    },
    [handleSliderChange, textProgress],
  )

  useEffect(() => {
    const container = textScrollRef.current
    if (!container) return

    const handleScroll = () => {
      if (scrollSyncingRef.current) return
      const maxScroll = container.scrollHeight - container.clientHeight
      const progress = maxScroll > 0 ? (container.scrollTop / maxScroll) * 100 : 0
      setTextProgress(progress)
      scheduleTextScrollSave(progress)
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", handleScroll)
    }
  }, [scheduleTextScrollSave])

  useEffect(() => {
    if (hasAppliedInitialScrollRef.current) return
    if (!sessionData) return
    const container = textScrollRef.current
    if (!container) return

    const targetProgress = sessionData.textScrollPosition ?? 0
    const maxScroll = container.scrollHeight - container.clientHeight
    scrollSyncingRef.current = true
    container.scrollTop = (targetProgress / 100) * (maxScroll > 0 ? maxScroll : 0)
    setTextProgress(targetProgress)
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        scrollSyncingRef.current = false
      })
    } else {
      scrollSyncingRef.current = false
    }
    hasAppliedInitialScrollRef.current = true
  }, [sessionData])

  useEffect(() => {
    if (sessionData?.textScrollPosition === undefined || sessionData.textScrollPosition === null) return
    lastSavedTextScrollProgressRef.current = sessionData.textScrollPosition
    pendingTextScrollProgressRef.current = sessionData.textScrollPosition
  }, [sessionData?.textScrollPosition])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      updateSession({ currentTime: audio.currentTime })
    }

    audio.addEventListener("timeupdate", handleTimeUpdate)
    return () => audio.removeEventListener("timeupdate", handleTimeUpdate)
  }, [sessionData?.currentAudioFile, updateSession])

  const handleAudioSeek = useCallback(
    (nextGlobalTime: number) => {
      if (!audioRef.current) return
      const clamped = Math.max(0, Math.min(nextGlobalTime, totalAudioDuration || Number.MAX_SAFE_INTEGER))

      // Map global time -> (chunkIndex, localTime)
      const durations = chunkDurations
      if (!durations.length) {
        const localFallback = Math.max(0, clamped)
        audioRef.current.currentTime = localFallback
        updateSession({ currentTime: localFallback, cursorPosition: localFallback })
        return
      }

      let cumulative = 0
      let targetChunkIndex = 0
      for (let i = 0; i < durations.length; i++) {
        const d = durations[i] ?? 0
        if (clamped <= cumulative + d || i === durations.length - 1) {
          targetChunkIndex = i
          break
        }
        cumulative += d
      }
      const localTime = Math.max(0, clamped - cumulative)

      if (!audiobook) return
      const targetChunk = audiobook.manifest.chunks[targetChunkIndex]
      if (!targetChunk) return

      if (targetChunkIndex === currentChunkIndex) {
        audioRef.current.currentTime = localTime
        updateSession({ currentTime: localTime, cursorPosition: localTime })
        return
      }

      // Seeking across tracks: pause current audio, load the target track, then seek.
      try {
        audioRef.current.pause()
      } catch {}
      const shouldResume = isPlaying
      setIsPlaying(false)
      setPendingSeekTime(localTime)
      setLoadedAudioFile(null)
      setCurrentChunkIndex(targetChunkIndex)
      setShouldPlayAfterSeek(shouldResume)
      updateSession({
        currentChunkId: targetChunk.chunk_id,
        currentAudioFile: targetChunk.audio_file,
        currentTime: localTime,
        cursorPosition: localTime,
      })
    },
    [audiobook, chunkDurations, currentChunkIndex, isPlaying, totalAudioDuration, updateSession],
  )

  const handleAudioSliderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!totalAudioDuration || totalAudioDuration <= 0) return
      event.preventDefault()
      const slider = event.currentTarget
      const pointerId = event.pointerId
      slider.focus()
      slider.setPointerCapture?.(pointerId)

      const updateFromClientX = (clientX: number) => {
        const rect = slider.getBoundingClientRect()
        if (!rect.width) return
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        handleAudioSeek(percent * totalAudioDuration)
      }

      updateFromClientX(event.clientX)

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        updateFromClientX(moveEvent.clientX)
      }

      const endPointerInteraction = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        slider.releasePointerCapture?.(pointerId)
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", endPointerInteraction)
        window.removeEventListener("pointercancel", endPointerInteraction)
      }

      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", endPointerInteraction)
      window.addEventListener("pointercancel", endPointerInteraction)
    },
    [handleAudioSeek, totalAudioDuration],
  )

  const handleAudioSliderKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!totalAudioDuration || totalAudioDuration <= 0) return
      const smallStep = 5
      const largeStep = 15
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault()
        handleAudioSeek(currentGlobalAudioTime - (event.shiftKey ? largeStep : smallStep))
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault()
        handleAudioSeek(currentGlobalAudioTime + (event.shiftKey ? largeStep : smallStep))
      } else if (event.key === "Home") {
        event.preventDefault()
        handleAudioSeek(0)
      } else if (event.key === "End") {
        event.preventDefault()
        handleAudioSeek(totalAudioDuration)
      }
    },
    [currentGlobalAudioTime, handleAudioSeek, totalAudioDuration],
  )

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = async () => {
      if (!audiobook || !sessionData) return

      const nextChunkIndex = currentChunkIndex + 1
      const nextChunk = audiobook.manifest.chunks[nextChunkIndex]

      if (nextChunk) {
        const audioBlob = await getAudioFile(audiobook.id, nextChunk.audio_file)
        if (audioBlob) {
          if (currentAudioUrl) {
            URL.revokeObjectURL(currentAudioUrl)
          }
          const url = URL.createObjectURL(audioBlob)
          setPendingSeekTime(0)
          setShouldPlayAfterSeek(true)
          setCurrentAudioUrl(url)
          setLoadedAudioFile(nextChunk.audio_file)
          setCurrentChunkIndex(nextChunkIndex)
          await updateSession({
            currentChunkId: nextChunk.chunk_id,
            currentAudioFile: nextChunk.audio_file,
            currentTime: 0,
            cursorPosition: 0,
          })
        }
      } else {
        setIsPlaying(false)
      }
    }

    audio.addEventListener("ended", handleEnded)
    return () => audio.removeEventListener("ended", handleEnded)
  }, [audiobook, sessionData, currentAudioUrl, updateSession, currentChunkIndex])

  function handleEditClick(edit: VoiceEdit) {
    stopListeningForEditDialog()
    focusEdit(edit)
    setViewingEdit(edit.id)
    setAutoStartRecording(false)
    setShowVoiceEditor(true)
  }

  const openEjectDialog = useCallback(() => {
    if (!audiobook) return
    if (typeof window === "undefined") return
    // Pause playback to avoid lingering audio while the dialog is open.
    try {
      audioRef.current?.pause()
    } catch {}
    setIsPlaying(false)
    setIsEjectDialogOpen(true)
  }, [audiobook])

  const performEject = useCallback(
    async ({ downloadBackup }: { downloadBackup: boolean }) => {
      if (!audiobook) return
      if (typeof window === "undefined") return
      if (ejectInProgress) return

      try {
        if (downloadBackup) {
          const session = sessionDataRef.current
          if (!session) {
            toast.error("No session data available to back up yet.")
          } else {
            setEjectInProgress("backup")
            await downloadSessionBackup(audiobook, session)
            toast.success("Session backup downloaded. You can restore it later from the menu (Upload Session).")
          }
        }
      } catch (error) {
        console.error("Failed to download session backup before eject:", error)
        toast.error("Could not download session backup")
        // Continue eject anyway.
      }

      try {
        setEjectInProgress("eject")
        await clearAllData()
        localStorage.removeItem(ACTIVE_AUDIOBOOK_STORAGE_KEY)
        localStorage.removeItem(`walkingbook_position_${audiobook.id}`)
        toast.success("Tape ejected. You can upload a new one anytime.")
        setIsEjectDialogOpen(false)
        router.push("/")
      } catch (error) {
        console.error("Error ejecting tape:", error)
        toast.error("Could not eject tape")
      } finally {
        setEjectInProgress(null)
      }
    },
    [audiobook, ejectInProgress, router],
  )

  if (isInitializingActiveId) {
    return <LoadingScreen message="Loading reader..." />
  }

  if (!id) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-[#231F20] px-6 text-center text-[#F6F8EF]">
        <div className="space-y-4 max-w-xl">
          <h1 className="font-sans text-4xl font-black tracking-tight">Load your Walking Book</h1>
          <p className="font-sans text-lg text-white-text/80">
            Import your Walking Book tape to listen and edit on your device. If you haven't made it you can do it{" "}
            <a
              href={COLAB_NOTEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:opacity-90"
            >
              here
            </a>
            . The reader runs entirely in your browser and your tape never leaves your device.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleEmptyStateUploadClick}
            disabled={isImporting}
            aria-busy={isChoosingFile || isImporting}
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-sans text-base font-semibold uppercase tracking-wider text-black-text transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isImporting ? (
              <>
                <RefreshCw className="h-5 w-5 animate-spin" />
                Loading zip…
              </>
            ) : isChoosingFile ? (
              <>
                <RefreshCw className="h-5 w-5 animate-spin" />
                Opening file…
              </>
            ) : (
              <>Upload &amp; open reader</>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleLoadSampleTape()}
            disabled={isImporting}
            className="text-sm text-white-text/80 underline underline-offset-4 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Try the Bernice sample tape
          </button>
          <p className="text-sm text-white-text/60">The tape is a .zip file that you should leave unzipped.</p>
        </div>
        <Input
          ref={emptyStateFileInputRef}
          id="walkingbook-upload-empty"
          type="file"
          accept=".walkingbook,.zip"
          // Android/Chrome can block opening the file picker when the input is `display:none`.
          // Keep it visually hidden but still "present" for reliable `.click()` behavior.
          className="sr-only"
          onChange={handleEmptyStateFileChange}
          disabled={isImporting}
        />
      </div>
    )
  }

  if (!audiobook || !sessionData) {
    return <LoadingScreen message="Preparing your book..." />
  }

  const editsWithPositions = sessionData.edits.map((edit) => {
    const chunkIdxFromEdit =
      typeof edit.chunkIndex === "number" && edit.chunkIndex >= 0
        ? edit.chunkIndex
        : audiobook.manifest.chunks.findIndex((chunk) => chunk.chunk_id === edit.chunkId)
    const safeChunkIndex = chunkIdxFromEdit >= 0 ? chunkIdxFromEdit : 0
    const safeSegmentIndex = typeof edit.segmentIndex === "number" ? edit.segmentIndex : 0
    return {
      ...edit,
      chunkIndex: safeChunkIndex,
      segmentIndex: safeSegmentIndex,
      position: getEditPosition(safeChunkIndex, safeSegmentIndex),
    }
  })

  return (
    <div
      className="h-[100dvh] flex flex-col md:flex-row overflow-hidden"
      style={{ backgroundColor: readerBackground, color: readerTextColor }}
    >
      {currentAudioUrl && <audio ref={audioRef} src={currentAudioUrl} preload="auto" playsInline />}

      <div className="md:hidden bg-[color:var(--color-dark-sidebar)] text-white-text p-4 flex items-center justify-between">
        <Link href="/">
          <h1 className="font-sans text-2xl font-bold cursor-pointer hover:opacity-80 transition-opacity">
            Walking Book
          </h1>
        </Link>
        <MenuDropdown variant="dark" className="p-1">
          <img src="/menu.svg" alt="" aria-hidden="true" className="h-8 w-8" />
        </MenuDropdown>
      </div>

      <div className="hidden md:flex md:w-[320px] bg-[color:var(--color-dark-sidebar)] text-white-text p-8 flex-col">
        <Link href="/">
          <h1 className="font-sans text-3xl font-bold mb-8 cursor-pointer hover:opacity-80 transition-opacity">
            Walking Book
          </h1>
        </Link>

        <div className="flex-1 flex flex-col items-center justify-center">
          <button
            onClick={handlePlayPause}
            className="w-24 h-24 rounded-full border-4 border-white-text flex items-center justify-center cursor-pointer hover:bg-white-text/10 transition-colors"
          >
            {isPlaying ? <Pause className="h-12 w-12 fill-white-text" /> : <Play className="h-12 w-12 fill-white-text" />}
          </button>
        </div>

        <div className="mt-auto space-y-6">
          <div className="space-y-2">
            <div
              className="w-full h-1 bg-white-text/30 rounded-full relative cursor-pointer touch-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white-text/70"
              role="slider"
              aria-valuemin={0}
              aria-valuemax={Math.round(totalAudioDuration || 0)}
              aria-valuenow={Math.round(currentGlobalAudioTime)}
              aria-label="Book audio position"
              tabIndex={0}
              onPointerDown={handleAudioSliderPointerDown}
              onKeyDown={handleAudioSliderKeyDown}
            >
              <div
                className="h-full bg-white-text rounded-full relative transition-all"
                style={{
                  width: `${totalAudioDuration > 0 ? Math.min(100, Math.max(0, (currentGlobalAudioTime / totalAudioDuration) * 100)) : 0}%`,
                }}
              >
                <span
                  aria-hidden="true"
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white-text rounded-full shadow-sm pointer-events-none"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-sans leading-none text-white-text/70">
              <span>{formatHoursMinutes(currentGlobalAudioTime)}</span>
              <span>{formatHoursMinutes(totalAudioDuration)}</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <MenuDropdown variant="dark" />
              <button
                type="button"
                onClick={() => setIsSidebarSettingsOpen((prev) => !prev)}
                className={cn(
                  "p-1 flex items-center justify-center transition-opacity hover:opacity-80",
                  isSidebarSettingsOpen
                    ? "text-white-text"
                    : "text-white-text",
                )}
                aria-expanded={isSidebarSettingsOpen}
                aria-label="Toggle reader preferences"
              >
                <SettingsIcon className="h-12 w-12 scale-[0.64] origin-center" strokeWidth={1.4} />
              </button>
            </div>
            <div
              className={cn(
                "origin-bottom overflow-hidden transform transition-all duration-500 ease-out",
                isSidebarSettingsOpen ? "max-h-[min(520px,70vh)] scale-y-100 opacity-100" : "max-h-0 scale-y-95 opacity-0",
              )}
              style={{ transformOrigin: "bottom center" }}
              aria-hidden={!isSidebarSettingsOpen}
            >
              <div className="mt-4 rounded-2xl border border-white-text/15 bg-white-text/5 px-3 py-3 shadow-2xl backdrop-blur-sm">
                <div className="max-h-[min(420px,60vh)] overflow-y-auto pr-1 overflow-x-hidden">
                  <SidebarSettingsBar
                    preferences={environment}
                    onChange={handleEnvironmentChange}
                    onReset={resetEnvironment}
                    onDone={() => setIsSidebarSettingsOpen(false)}
                    moonshineEnabled={moonshineEnabled}
                  />
                </div>
              </div>
            </div>
            <EditableGreeting
              name={environment.userName || sessionData.userName || ""}
              onCommit={commitUserName}
              className="text-sm"
              placeholderClassName="text-white-text/50"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col md:grid md:grid-cols-[1fr_auto] overflow-hidden min-h-0">
          <div ref={textContainerRef} className="relative flex-1 overflow-hidden min-h-0">
            {/* Mobile layout: text area + dedicated edits rail (white column) */}
            <div className="flex h-full min-h-0">
              {/* Mobile left title rail */}
              <aside className="md:hidden w-5 flex-shrink-0 border-r border-black-text/10">
                <div
                  className="h-full w-5 flex items-center justify-center select-none pointer-events-none"
                  style={{
                    backgroundColor: accentColor,
                    color: accentTextColor,
                    writingMode: "vertical-rl",
                    transform: "rotate(180)",
                  }}
                  aria-hidden="true"
                >
                  <span className="font-sans text-[0.7rem] tracking-wide px-1">{audiobook.metadata.title}</span>
                </div>
              </aside>

              <div className="relative flex-1 min-w-0 overflow-hidden">
                <div ref={textScrollRef} className="h-full overflow-y-auto p-6 md:p-12">
                  <TextDisplay
                    audiobook={audiobook}
                    session={sessionData}
                    onCursorPositionChange={handleCursorPositionChange}
                    scrollContainerRef={textScrollRef}
                    accentColor={accentColor}
                    highlightColor={highlightColor}
                    textColor={readerTextColor}
                    fontFamily={readerFontFamily}
                    highlightedSegment={highlightedSegment}
                  />
                </div>
              </div>

              {/* Mobile right edits rail (white column) */}
              <aside className="md:hidden w-10 flex-shrink-0 bg-white border-l border-black-text/10">
                <div className="h-full flex flex-col">
                  <div className="flex-1 overflow-y-auto py-5">
                    <div className="flex flex-col items-center gap-4 px-1">
                      {editsWithPositions.map((edit, index) => (
                        <button
                          key={edit.id}
                          onClick={() => handleEditClick(edit)}
                          className="w-7 h-7 rounded-full border-2 border-black-text flex items-center justify-center font-sans text-[0.65rem] font-bold transition-transform active:scale-95"
                          style={{ backgroundColor: accentColor, color: accentTextColor }}
                          aria-label={`Edit ${index + 1}`}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Mobile edit button lives in bottom row of edits column */}
                  <div className="border-t border-black-text/10 p-2">
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          stopListeningForEditDialog()
                          setAutoStartRecording(true)
                          setShowVoiceEditor(true)
                        }}
                        className="p-1 text-[color:var(--color-black-text)]"
                        aria-label="Add new edit"
                        title="Add new edit"
                      >
                        <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor" aria-hidden="true">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>

          <div
            className="hidden md:flex md:flex-col min-h-0 overflow-hidden border-l-2 border-black-text p-6 w-[320px]"
            style={{ backgroundColor: mixHexColors(highlightColor, HOUSE_WHITE, 0.125) }}
          >
            {/* Edit Log Header */}
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-6 rounded-sm" style={{ backgroundColor: accentColor }} />
              <h2 className="font-sans text-lg font-bold text-black-text">Edit Log</h2>
            </div>

            {/* Edit Cards */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
              {editsWithPositions.length === 0 ? (
                <div
                  className="text-center text-gray-500 py-8 rounded-lg border"
                  style={{ backgroundColor: accentSoftStrong, borderColor: accentSoftStrong }}
                >
                  <p className="text-sm">No edits yet</p>
                  <p className="text-xs mt-1">Click the pencil to add your first edit</p>
                </div>
              ) : (
                editsWithPositions.map((edit, index) => (
                  <button
                    key={edit.id}
                    onClick={() => handleEditClick(edit)}
                    className="w-full text-left p-4 border-2 rounded-lg transition-all hover:brightness-110"
                    style={{ borderColor: HOUSE_BLACK, backgroundColor: accentSoftStrong }}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-sans text-xs font-bold border border-black-text"
                        style={{ backgroundColor: accentColor, color: accentTextColor }}
                      >
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-700">{getEditTypeLabel(edit.editType)}</span>
                          <span className="text-xs text-gray-400">
                            {new Date(edit.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-sm font-serif text-gray-800 line-clamp-2">{edit.transcription}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Bottom Action Buttons */}
            <div className="mt-6 pt-4 border-t border-black-text/10 flex items-center justify-end gap-3">
              {/* Pencil/Edit Button - matches Download button style */}
              <button
                onClick={() => {
                  stopListeningForEditDialog()
                  setAutoStartRecording(true)
                  setShowVoiceEditor(true)
                }}
                className="flex items-center gap-2 px-4 py-3 border-2 rounded-lg bg-black-text text-white-text transition-opacity hover:opacity-80"
                style={{ borderColor: HOUSE_BLACK }}
                title="Add new edit"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
                <span className="font-sans font-medium text-sm">Edit</span>
              </button>

              {/* Eject Button */}
              <button
                type="button"
                onClick={openEjectDialog}
                className="flex items-center gap-2 px-4 py-3 border-2 border-black-text bg-white hover:bg-gray-50 rounded-lg transition-colors"
                title="Eject tape"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-black-text" fill="currentColor" aria-hidden="true">
                  <path d="M5 19h14v-2H5v2zm7-14L5 15h14L12 5z" />
                </svg>
                <span className="font-sans font-medium text-black-text text-sm">Eject</span>
              </button>
            </div>
          </div>
        </div>

        <div className="md:hidden px-4 py-4" style={{ backgroundColor: highlightColor, color: highlightTextColor }}>
          {/* Row 1: Play + scrubber (scrubber centered on play midline) */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePlayPause}
              className="w-16 flex items-center justify-start transition-transform active:scale-95 flex-shrink-0"
              style={{ color: highlightTextColor }}
              aria-label={isPlaying ? "Pause narration" : "Play narration"}
            >
              {isPlaying ? (
                <span className="flex items-center gap-2" aria-hidden="true">
                  <span className="block h-6 w-2 rounded-sm" style={{ backgroundColor: "currentColor" }} />
                  <span className="block h-6 w-2 rounded-sm" style={{ backgroundColor: "currentColor" }} />
                </span>
              ) : (
                <svg
                  viewBox="8 0 16 24"
                  className="block h-6 w-6 origin-left scale-[2]"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M9.25 6.95c0-1.22 1.33-1.98 2.39-1.35l8.28 4.95c1.02.61 1.02 2.09 0 2.7l-8.28 4.95c-1.06.63-2.39-.12-2.39-1.35V6.95z" />
                </svg>
              )}
            </button>

            <div className="flex-1">
              <div
                className="w-full h-[2px] rounded-full relative cursor-pointer touch-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/20"
                style={{ backgroundColor: highlightControlSoft }}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={Math.round(totalAudioDuration || 0)}
                aria-valuenow={Math.round(currentGlobalAudioTime)}
                aria-label="Book audio position"
                tabIndex={0}
                onPointerDown={handleAudioSliderPointerDown}
                onKeyDown={handleAudioSliderKeyDown}
              >
                <div
                  className="h-full rounded-full relative transition-all"
                  style={{
                    width: `${totalAudioDuration > 0 ? Math.min(100, Math.max(0, (currentGlobalAudioTime / totalAudioDuration) * 100)) : 0}%`,
                    backgroundColor: highlightTextColor,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pointer-events-none"
                    style={{ backgroundColor: highlightTextColor }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: timestamps under the scrubber, aligned to scrubber start */}
          <div
            className="-mt-1.5 flex items-center justify-between text-xs font-sans leading-none"
            style={{ color: highlightTextColor, opacity: 0.75, marginLeft: "5rem" }}
          >
            <span>{formatHoursMinutes(currentGlobalAudioTime)}</span>
            <span>{formatHoursMinutes(totalAudioDuration)}</span>
          </div>
        </div>

        <div
          className="md:hidden border-t border-black-text/10 p-4 flex flex-nowrap items-center gap-3 justify-between"
          style={{ backgroundColor: accentColor, color: accentTextColor }}
        >
          <EditableGreeting
            name={environment.userName || sessionData.userName || ""}
            onCommit={commitUserName}
            className="text-base flex-1 min-w-0 truncate"
            placeholderClassName="opacity-50"
          />
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="relative" ref={mobileSettingsMenuRef}>
              <button
                type="button"
                onClick={() => setIsMobileSettingsOpen((prev) => !prev)}
                aria-label="Open reader settings"
                className="flex items-center justify-center rounded-lg border-2 border-black-text bg-white px-4 py-3 text-black-text transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black-text/20 focus-visible:ring-offset-2"
                aria-expanded={isMobileSettingsOpen}
                aria-haspopup="menu"
              >
                <SettingsIcon className="h-5 w-5" />
              </button>
              {isMobileSettingsOpen && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Reader settings"
                  className="fixed inset-0 z-50 flex items-center justify-center px-3 py-4"
                >
                  <div
                    className="absolute inset-0 bg-black-text/50"
                    aria-hidden="true"
                    onClick={() => setIsMobileSettingsOpen(false)}
                  />
                  <div
                    role="menu"
                    className="relative w-[min(420px,calc(100vw-24px))] h-[min(85dvh,calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] rounded-2xl border-2 border-black-text bg-white-text text-black-text shadow-[6px_6px_0_0_rgba(35,31,32,0.12)] overflow-hidden"
                  >
                    <div className="p-4 h-full overflow-y-auto">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-sans font-semibold uppercase tracking-[0.35em] text-black-text/70">
                          Settings
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsMobileSettingsOpen(false)}
                          className="rounded-full border border-black-text/20 bg-white-text p-1.5 text-black-text transition-colors hover:bg-black-text/5"
                          aria-label="Close reader preferences"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3">
                        <SidebarSettingsBar
                          preferences={environment}
                          onChange={handleEnvironmentChange}
                          onReset={resetEnvironment}
                          onDone={() => setIsMobileSettingsOpen(false)}
                          variant="light"
                          moonshineEnabled={moonshineEnabled}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={openEjectDialog}
              aria-label="Eject tape"
              className="flex items-center justify-center rounded-lg border-2 border-black-text bg-white px-4 py-3 text-black-text transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black-text/20 focus-visible:ring-offset-2"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M5 19h14v-2H5v2zm7-14L5 15h14L12 5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {showVoiceEditor && (
        useMoonshineEditor ? (
          <VoiceEditorOfflineMoonshine
            audiobook={audiobook}
            session={sessionData}
            onUpdateSession={async (updates) => {
              await updateSession(updates)
            }}
            viewingEditId={viewingEdit}
            cursorPosition={cursorPosition}
            onClose={() => {
              const wasViewingExistingEdit = viewingEdit !== null
              setShowVoiceEditor(false)
              setViewingEdit(null)
              setAutoStartRecording(false)
              setCursorPosition(null)
              // Only resume playback if we were creating a new edit (not viewing an existing one)
              if (!wasViewingExistingEdit && audioRef.current) {
                setIsPlaying(true)
                audioRef.current.play().catch((err) => {
                  console.error("Error resuming playback:", err)
                  setIsPlaying(false)
                })
              }
            }}
            autoStartRecording={autoStartRecording}
          />
        ) : (
          <VoiceEditor
            audiobook={audiobook}
            session={sessionData}
            onUpdateSession={async (updates) => {
              await updateSession(updates)
            }}
            viewingEditId={viewingEdit}
            cursorPosition={cursorPosition}
            onClose={() => {
              const wasViewingExistingEdit = viewingEdit !== null
              setShowVoiceEditor(false)
              setViewingEdit(null)
              setAutoStartRecording(false)
              setCursorPosition(null)
              // Only resume playback if we were creating a new edit (not viewing an existing one)
              if (!wasViewingExistingEdit && audioRef.current) {
                setIsPlaying(true)
                audioRef.current.play().catch((err) => {
                  console.error("Error resuming playback:", err)
                  setIsPlaying(false)
                })
              }
            }}
            autoStartRecording={autoStartRecording}
          />
        )
      )}

      <Dialog
        open={isMicPermissionDialogOpen}
        onOpenChange={(open) => {
          setIsMicPermissionDialogOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md bg-white-text text-black-text border-2 border-black-text rounded-2xl shadow-[6px_6px_0_0_rgba(35,31,32,0.12)] font-sans">
          <DialogHeader>
            <DialogTitle className="font-sans text-2xl font-bold">Enable microphone?</DialogTitle>
            <DialogDescription className="font-sans text-black-text/70">
              Walking Book can record voice edits. Enable the mic now so editing is instant later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              className="w-full rounded-full border-2 border-black-text bg-black-text px-4 py-3 font-sans text-sm font-semibold text-white-text"
              onClick={() => {
                void primeMicrophonePermission().finally(() => setIsMicPermissionDialogOpen(false))
              }}
            >
              Enable microphone
            </button>
            <button
              type="button"
              className="w-full rounded-full border-2 border-black-text bg-white px-4 py-3 font-sans text-sm font-semibold text-black-text"
              onClick={() => setIsMicPermissionDialogOpen(false)}
            >
              Not now
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isListeningForEdit}
        onOpenChange={(open) => {
          if (!open) {
            stopListeningForEditDialog()
          }
        }}
      >
        <DialogContent className="relative sm:max-w-md" showCloseButton={false}>
          <DialogClose
            asChild
            onClick={(event) => {
              event.preventDefault()
              stopListeningForEditDialog()
            }}
          >
            <button
              type="button"
              className="absolute right-4 top-4 rounded-full border border-black-text/20 bg-white-text/90 p-2 text-black-text shadow-lg hover:bg-white-text"
              aria-label="Close listening prompt"
            >
              <X className="h-6 w-6" />
            </button>
          </DialogClose>
          <DialogHeader>
            <DialogTitle>Listening...</DialogTitle>
            <DialogDescription>Say "edit" to add a note, or stay silent to continue.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-6">
            <div className="w-16 h-16 rounded-full bg-red-500 animate-pulse flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-red-300 animate-ping" />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isEjectDialogOpen}
        onOpenChange={(open) => {
          if (ejectInProgress) return
          setIsEjectDialogOpen(open)
        }}
      >
        <DialogContent
          className="sm:max-w-md bg-white-text text-black-text border-2 border-black-text rounded-2xl shadow-[6px_6px_0_0_rgba(35,31,32,0.12)] font-sans"
        >
          <DialogHeader>
            <div className="text-xs font-sans font-semibold uppercase tracking-[0.35em] text-black-text/70">
              Tape
            </div>
            <DialogTitle className="font-sans text-2xl font-bold">Eject tape?</DialogTitle>
            <DialogDescription className="font-sans text-black-text/70">
              Do you want to download a session backup first? Later, you can restore it from the menu (Upload Session).
              For Word comment workflows, use Comment Studio in the menu.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              className="w-full rounded-full border-2 border-black-text bg-black-text px-4 py-3 font-sans text-sm font-semibold text-white-text disabled:opacity-60"
              disabled={ejectInProgress !== null}
              onClick={() => void performEject({ downloadBackup: true })}
            >
              {ejectInProgress === "backup" ? "Downloading backup..." : ejectInProgress === "eject" ? "Ejecting..." : "Download backup & eject"}
            </button>
            <button
              type="button"
              className="w-full rounded-full border-2 border-black-text bg-white px-4 py-3 font-sans text-sm font-semibold text-black-text disabled:opacity-60"
              disabled={ejectInProgress !== null}
              onClick={() => void performEject({ downloadBackup: false })}
            >
              {ejectInProgress === "eject" ? "Ejecting..." : "Eject without backup"}
            </button>
            <button
              type="button"
              className="w-full rounded-full border-2 border-black-text bg-[color:var(--color-orange)] px-4 py-3 font-sans text-sm font-semibold text-black-text disabled:opacity-60"
              disabled={ejectInProgress !== null}
              onClick={() => {
                setIsEjectDialogOpen(false)
                const opened = openCommentStudioPanel()
                if (!opened) {
                  router.push("/merge-comments")
                }
              }}
            >
              Open Comment Studio
            </button>
            <button
              type="button"
              className="w-full rounded-full px-4 py-2 font-sans text-xs font-semibold uppercase tracking-[0.3em] text-black-text/70 hover:text-black-text disabled:opacity-60"
              disabled={ejectInProgress !== null}
              onClick={() => setIsEjectDialogOpen(false)}
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type SidebarSectionKey = "background" | "highlight" | "accent"

interface SidebarSettingsBarProps {
  preferences: ReaderEnvironmentSettings
  onChange: (updates: Partial<ReaderEnvironmentSettings>) => void
  onReset?: () => void
  onDone?: () => void
  moonshineEnabled?: boolean
  variant?: "dark" | "light"
}

function SidebarSettingsBar({
  preferences,
  onChange,
  onReset,
  onDone,
  moonshineEnabled = false,
  variant = "dark",
}: SidebarSettingsBarProps) {
  const [activeSection, setActiveSection] = useState<SidebarSectionKey>("background")
  const patchAreaRef = useRef<HTMLDivElement | null>(null)
  const targetRefs = useRef<Record<SidebarSectionKey, HTMLButtonElement | null>>({
    background: null,
    highlight: null,
    accent: null,
  })
  const jackRefs = useRef<Record<SidebarSectionKey, HTMLSpanElement | null>>({
    background: null,
    highlight: null,
    accent: null,
  })
  const swatchRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map())
  const [dragState, setDragState] = useState<{
    from: SidebarSectionKey
    fromPoint: { x: number; y: number }
    toPoint: { x: number; y: number }
  } | null>(null)
  const [positionsVersion, setPositionsVersion] = useState(0)

  const sections = [
    {
      key: "background" as const,
      label: "Background",
      options: RISOGRAPH_BACKGROUND_SWATCHES,
      value: preferences.backgroundColor,
      onSelect: (value: string) => onChange({ backgroundColor: value }),
    },
    {
      key: "highlight" as const,
      label: "Highlight",
      options: RISOGRAPH_HIGHLIGHT_SWATCHES,
      value: preferences.highlightColor,
      onSelect: (value: string) => onChange({ highlightColor: value }),
    },
    {
      key: "accent" as const,
      label: "Accent",
      options: RISOGRAPH_ACCENT_SWATCHES,
      value: preferences.accentColor,
      onSelect: (value: string) => onChange({ accentColor: value }),
    },
  ]

  const currentSection = sections.find((section) => section.key === activeSection) ?? sections[0]
  const selectedFont = READER_FONT_OPTIONS.find((option) => option.id === preferences.fontFamily) ?? READER_FONT_OPTIONS[0]

  const isDark = variant === "dark"
  const styles = {
    textPrimary: isDark ? "text-white-text" : "text-gray-900",
    labelRow: isDark ? "text-white-text/60" : "text-gray-600",
    statusText: isDark ? "text-white-text/40" : "text-gray-400",
    sectionLabel: isDark ? "text-white-text/50" : "text-gray-500",
    input: isDark
      ? "bg-white-text/10 text-white-text placeholder:text-white-text/40 border-white-text/20"
      : "bg-white text-gray-900 placeholder:text-gray-500 border-black-text/10",
    sectionButtonActive: isDark
      ? "border-white-text text-white-text bg-white-text/10"
      : "border-black-text text-black-text bg-gray-100",
    sectionButtonInactive: isDark
      ? "border-white-text/30 text-white-text/60 hover:border-white-text/60"
      : "border-black-text/20 text-gray-500 hover:border-black-text/40",
    colorOptionActive: isDark
      ? "border-white-text bg-white-text/15 shadow-lg text-white-text"
      : "border-black-text bg-white shadow-sm text-gray-900",
    colorOptionInactive: isDark
      ? "border-white-text/20 text-white-text/70 hover:border-white-text/40"
      : "border-black-text/10 text-gray-600 hover:border-black-text/30",
    colorSwatchBorder: isDark ? "border-white-text/30" : "border-black-text/10",
    fontButtonActive: isDark
      ? "border-white-text bg-white-text/15 text-white-text"
      : "border-black-text bg-gray-100 text-black-text",
    fontButtonInactive: isDark
      ? "border-white-text/20 text-white-text/70 hover:border-white-text/40"
      : "border-black-text/10 text-gray-600 hover:border-black-text/30",
    fontDescription: isDark ? "text-white-text/50" : "text-gray-500",
    footerBorder: isDark ? "border-white-text/10" : "border-black-text/10",
    doneButton: isDark
      ? "border-white-text text-white-text hover:bg-white-text hover:text-black-text"
      : "border-black-text text-black-text hover:bg-black-text hover:text-white-text",
    resetButton: isDark ? "text-white-text/60 hover:text-white-text" : "text-gray-500 hover:text-gray-900",
  }

  const palette = useMemo(() => {
    const combined = [...RISOGRAPH_BACKGROUND_SWATCHES, ...RISOGRAPH_HIGHLIGHT_SWATCHES, ...RISOGRAPH_ACCENT_SWATCHES]
    const seen = new Set<string>()
    const unique: { label: string; value: string }[] = []
    for (const option of combined) {
      if (seen.has(option.value)) continue
      seen.add(option.value)
      unique.push(option)
    }
    return unique
  }, [])

  const assignedBySection = useMemo(
    () => ({
      background: preferences.backgroundColor,
      highlight: preferences.highlightColor,
      accent: preferences.accentColor,
    }),
    [preferences.backgroundColor, preferences.highlightColor, preferences.accentColor],
  )

  function getRelativeCenter(element: HTMLElement) {
    const container = patchAreaRef.current
    if (!container) return null
    const cr = container.getBoundingClientRect()
    const er = element.getBoundingClientRect()
    return { x: er.left - cr.left + er.width / 2, y: er.top - cr.top + er.height / 2 }
  }

  function bezierPath(from: { x: number; y: number }, to: { x: number; y: number }) {
    const dx = to.x - from.x
    const c1 = { x: from.x + dx * 0.35, y: from.y }
    const c2 = { x: from.x + dx * 0.65, y: to.y }
    return `M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`
  }

  useLayoutEffect(() => {
    const container = patchAreaRef.current
    if (!container) return
    const bump = () => setPositionsVersion((v) => v + 1)
    bump()
    window.addEventListener("resize", bump)
    const ro = new ResizeObserver(() => bump())
    ro.observe(container)
    return () => {
      window.removeEventListener("resize", bump)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!dragState) return
    const handleMove = (event: PointerEvent) => {
      const container = patchAreaRef.current
      if (!container) return
      const cr = container.getBoundingClientRect()
      setDragState((prev) => {
        if (!prev) return prev
        return { ...prev, toPoint: { x: event.clientX - cr.left, y: event.clientY - cr.top } }
      })
    }
    const handleUp = (event: PointerEvent) => {
      // If pointer ends over a swatch, assign it.
      const entries = Array.from(swatchRefs.current.entries())
      for (const [value, el] of entries) {
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) {
          const section = dragState.from
          const update =
            section === "background"
              ? { backgroundColor: value }
              : section === "highlight"
                ? { highlightColor: value }
                : { accentColor: value }
          onChange(update)
          break
        }
      }
      setDragState(null)
    }
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }
  }, [dragState, onChange])

  return (
    <div className={cn("flex flex-col gap-4", styles.textPrimary)}>
      <div className="space-y-3">
        <div
          className={cn(
            "flex items-center justify-between text-[0.55rem] uppercase tracking-[0.35em]",
            styles.sectionLabel,
          )}
        >
          <span>Colors</span>
          <span className={styles.statusText}>Patch</span>
        </div>

        <div ref={patchAreaRef} className="relative touch-none">
          {/* Connectors */}
          <svg
            key={positionsVersion}
            className="pointer-events-none absolute inset-0 w-full h-full z-20"
            aria-hidden="true"
          >
            {(["background", "highlight", "accent"] as SidebarSectionKey[]).map((key) => {
              const fromEl = jackRefs.current[key] ?? targetRefs.current[key]
              const toValue = assignedBySection[key]
              const toEl = swatchRefs.current.get(toValue) ?? null
              if (!fromEl || !toEl) return null
              const from = getRelativeCenter(fromEl)
              const to = getRelativeCenter(toEl)
              if (!from || !to) return null
              const stroke = assignedBySection[key]
              return (
                <g key={key}>
                  <path d={bezierPath(from, to)} stroke={stroke} strokeWidth={3} fill="none" opacity={0.85} />
                  <circle cx={from.x} cy={from.y} r={3.5} fill={stroke} />
                  <circle cx={to.x} cy={to.y} r={3.5} fill={stroke} />
                </g>
              )
            })}
            {dragState && (
              <g>
                <path
                  d={bezierPath(dragState.fromPoint, dragState.toPoint)}
                  stroke={assignedBySection[dragState.from]}
                  strokeWidth={3}
                  fill="none"
                  opacity={0.9}
                />
                <circle cx={dragState.fromPoint.x} cy={dragState.fromPoint.y} r={3.5} fill={assignedBySection[dragState.from]} />
              </g>
            )}
          </svg>

          {/* Targets */}
          <div className="flex flex-wrap items-center gap-2 relative z-10">
            {sections.map((section) => (
              <button
                key={section.key}
                ref={(el) => {
                  targetRefs.current[section.key] = el
                }}
                type="button"
                onClick={() => setActiveSection(section.key)}
                onPointerDown={(event) => {
                  event.preventDefault()
                  // Start a "cable" drag from this target.
                  const el = event.currentTarget as HTMLButtonElement
                  const jack = jackRefs.current[section.key]
                  const from = getRelativeCenter((jack ?? el) as HTMLElement)
                  if (!from) return
                  setActiveSection(section.key)
                  const container = patchAreaRef.current
                  const cr = container?.getBoundingClientRect()
                  const to = cr ? { x: event.clientX - cr.left, y: event.clientY - cr.top } : from
                  setDragState({ from: section.key, fromPoint: from, toPoint: to })
                }}
                className={cn(
                  "flex-[1_1_140px] whitespace-nowrap rounded-full border px-3 py-2 text-[0.55rem] uppercase tracking-[0.3em] transition-colors flex items-center justify-center gap-2 touch-none select-none",
                  activeSection === section.key ? styles.sectionButtonActive : styles.sectionButtonInactive,
                )}
                aria-pressed={activeSection === section.key}
              >
                <span
                  ref={(el) => {
                    jackRefs.current[section.key] = el
                  }}
                  className={cn("h-3.5 w-3.5 rounded-full border", styles.colorSwatchBorder)}
                  style={{ backgroundColor: assignedBySection[section.key] }}
                  aria-hidden="true"
                />
                <span>{section.label}</span>
              </button>
            ))}
          </div>

          {/* Palette */}
          <div className="mt-5 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-4 gap-2.5 md:gap-3 px-1.5 md:px-2 place-items-center relative z-10">
            {palette.map((option) => {
              const isSelectedForAny = Object.values(assignedBySection).includes(option.value)
              return (
                <button
                  key={option.value}
                  ref={(el) => {
                    swatchRefs.current.set(option.value, el)
                  }}
                  type="button"
                  className={cn(
                    "h-9 w-9 rounded-full border-2 transition-transform hover:scale-105 touch-manipulation",
                    isDark ? "border-white-text/20 hover:border-white-text" : "border-black-text/20 hover:border-black-text",
                    isSelectedForAny && (isDark ? "border-white-text" : "border-black-text"),
                  )}
                  style={{ backgroundColor: option.value }}
                  aria-label={`Set ${currentSection.label} to ${option.label}`}
                  onClick={() => currentSection.onSelect(option.value)}
                />
              )
            })}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div
          className={cn(
            "flex items-center justify-between text-[0.55rem] uppercase tracking-[0.35em]",
            styles.sectionLabel,
          )}
        >
          <span>Font</span>
          <span>{selectedFont.label}</span>
        </div>
        <div className="-mx-2 overflow-x-auto pb-1">
          <div className="flex gap-2 px-2">
            {READER_FONT_OPTIONS.map((option) => {
              const isActive = option.id === preferences.fontFamily
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onChange({ fontFamily: option.id })}
                  className={cn(
                    "flex-shrink-0 min-w-[130px] rounded-2xl border px-3 py-2 text-[0.55rem] uppercase tracking-[0.25em] whitespace-nowrap text-center transition-colors",
                    isActive ? styles.fontButtonActive : styles.fontButtonInactive,
                  )}
                  style={{ fontFamily: option.stack, fontSize: option.id === "dyslexic" ? "0.385rem" : undefined }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
        <p className={cn("text-[0.55rem] uppercase tracking-[0.2em]", styles.fontDescription)}>
          {selectedFont.description}
        </p>
      </div>

      {moonshineEnabled && (
        <div className="space-y-2">
          <div
            className={cn(
              "flex items-center justify-between text-[0.55rem] uppercase tracking-[0.35em]",
              styles.sectionLabel,
            )}
          >
            <span>Speech</span>
            <span>{preferences.speechEngine === "moonshine" ? "Moonshine" : "Web Speech"}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onChange({ speechEngine: "web-speech" })}
              className={cn(
                "flex-1 rounded-2xl border px-3 py-2 text-[0.55rem] uppercase tracking-[0.25em] transition-colors",
                preferences.speechEngine === "web-speech" ? styles.fontButtonActive : styles.fontButtonInactive,
              )}
            >
              Web Speech
            </button>
            <button
              type="button"
              onClick={() => onChange({ speechEngine: "moonshine" })}
              className={cn(
                "flex-1 rounded-2xl border px-3 py-2 text-[0.55rem] uppercase tracking-[0.25em] transition-colors",
                preferences.speechEngine === "moonshine" ? styles.fontButtonActive : styles.fontButtonInactive,
              )}
            >
              Moonshine
            </button>
          </div>
          <p className={cn("text-[0.55rem] uppercase tracking-[0.2em]", styles.fontDescription)}>
            Switch how voice edits are transcribed.
          </p>
        </div>
      )}

      {(onReset || onDone) && (
        <div className={cn("space-y-2 border-t pt-3", styles.footerBorder)}>
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className={cn(
                "w-full rounded-full border px-4 py-2 text-[0.6rem] uppercase tracking-[0.35em] transition-colors",
                styles.doneButton,
              )}
            >
              Done
            </button>
          )}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className={cn(
                "w-full text-center text-[0.55rem] uppercase tracking-[0.35em] transition-colors",
                styles.resetButton,
              )}
            >
              Reset palette
            </button>
          )}
        </div>
      )}
    </div>
  )
}
