"use client"

import { useState, useRef, useEffect, type MouseEvent } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mic, Square, Save, Trash2, X } from "lucide-react"
import type { StoredAudiobook, SessionData, VoiceEdit } from "@/types/audiobook"
import { toast } from "sonner"
import { Textarea } from "@/components/ui/textarea"
import { getEditTypeLabel } from "@/lib/edit-utils"
import { ensureMoonshineReady, transcribeWithMoonshineFromBlob } from "@/lib/offline-stt/moonshine"

interface VoiceEditorProps {
  audiobook: StoredAudiobook
  session: SessionData
  onUpdateSession: (updates: Partial<SessionData>) => void
  viewingEditId?: string | null
  cursorPosition?: { chunkIndex: number; chunkId: string; segmentIndex: number } | null
  onClose?: () => void
  autoStartRecording?: boolean
}

export function VoiceEditorOfflineMoonshine({
  audiobook,
  session,
  onUpdateSession,
  viewingEditId,
  cursorPosition,
  onClose,
  autoStartRecording = false,
}: VoiceEditorProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [editType, setEditType] = useState<"last-line" | "last-paragraph" | "custom">("last-line")
  const [isSupported, setIsSupported] = useState(true)
  const [isAwaitingResumeConfirmation, setIsAwaitingResumeConfirmation] = useState(false)
  const [pendingEdit, setPendingEdit] = useState<string | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)

  const isRecordingRef = useRef(false)
  const hasAttemptedAutoStartRef = useRef(false)
  const pauseAudioRef = useRef<HTMLAudioElement | null>(null)
  const editSavedAudioRef = useRef<HTMLAudioElement | null>(null)
  const resumePromptAudioRef = useRef<HTMLAudioElement | null>(null)
  const accumulatedTranscriptRef = useRef<string>("")

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceRafRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const silenceMsRef = useRef(0)
  const hasHeardSpeechRef = useRef(false)
  const lastSpeechAtRef = useRef<number | null>(null)
  const editCommandRecognitionRef = useRef<SpeechRecognition | null>(null)
  const doneCommandRecognitionRef = useRef<SpeechRecognition | null>(null)
  const doneCommandTriggeredRef = useRef(false)
  const [isListeningForEditCommand, setIsListeningForEditCommand] = useState(false)
  const hasTriggeredAutoSaveRef = useRef(false)
  const isMountedRef = useRef(true)
  const hasPlayedStartBeepRef = useRef(false)
  const hasPlayedStopCueRef = useRef(false)

  async function playSavedCueThenWait(maxWaitMs = 1200): Promise<void> {
    const audio = editSavedAudioRef.current
    if (!audio) return

    try {
      audio.currentTime = 0
      audio.onended = null

      await new Promise<void>((resolve) => {
        let settled = false
        const settle = () => {
          if (settled) return
          settled = true
          audio.onended = null
          resolve()
        }

        // Fallback so we never hang if `ended` doesn't fire.
        const timeoutId = window.setTimeout(settle, maxWaitMs)
        audio.onended = () => {
          window.clearTimeout(timeoutId)
          settle()
        }

        try {
          const p = audio.play()
          if (p && typeof (p as Promise<void>).catch === "function") {
            ;(p as Promise<void>).catch(() => {
              // Autoplay rejection or other playback errors: don't block closing.
              window.clearTimeout(timeoutId)
              settle()
            })
          }
        } catch {
          window.clearTimeout(timeoutId)
          settle()
        }
      })
    } catch {
      // ignore
    }
  }

  async function saveThenCueThenClose(editText?: string): Promise<void> {
    const saved = await saveEdit(editText ?? undefined, { closeAfterSave: false })
    if (!saved) return
    await playSavedCueThenWait()
    onClose?.()
  }

  function playAudioBestEffort(audio: HTMLAudioElement | null) {
    if (!audio) return
    try {
      audio.currentTime = 0
      audio.onended = null
      const p = audio.play()
      if (p && typeof (p as Promise<void>).catch === "function") {
        ;(p as Promise<void>).catch(() => {
          // ignore autoplay rejections
        })
      }
    } catch {
      // ignore playback errors
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    const pauseAudio = new Audio("/audio/voice-editor-pause.wav")
    pauseAudio.preload = "auto"
    pauseAudioRef.current = pauseAudio

    const editSavedAudio = new Audio("/audio/voice-editor-saved.wav")
    editSavedAudio.preload = "auto"
    editSavedAudioRef.current = editSavedAudio

    const resumePromptAudio = new Audio("/audio/voice-editor-resume.wav")
    resumePromptAudio.preload = "auto"
    resumePromptAudioRef.current = resumePromptAudio

    return () => {
      isMountedRef.current = false
      pauseAudioRef.current?.pause()
      pauseAudioRef.current = null
      editSavedAudioRef.current?.pause()
      editSavedAudioRef.current = null
      resumePromptAudioRef.current?.pause()
      resumePromptAudioRef.current = null
    }
  }, [])

  const edits = session.edits || []

  useEffect(() => {
    if (viewingEditId) {
      startListeningForEditCommand()
    }

    return () => {
      if (editCommandRecognitionRef.current) {
        try {
          editCommandRecognitionRef.current.stop()
        } catch {}
        editCommandRecognitionRef.current = null
      }
    }
  }, [viewingEditId])

  function startListeningForEditCommand() {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) return

    setIsListeningForEditCommand(true)
    const recognition: SpeechRecognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = "en-US"

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const lastResult = event.results[event.results.length - 1]
      if (lastResult.isFinal) {
        const heard = lastResult[0].transcript.toLowerCase()
        if (heard.includes("edit")) {
          try {
            editCommandRecognitionRef.current?.stop()
          } catch {}
          editCommandRecognitionRef.current = null
          setIsListeningForEditCommand(false)
          setTranscript("")
          accumulatedTranscriptRef.current = ""
          startRecording()
        } else if (heard.includes("save")) {
          try {
            editCommandRecognitionRef.current?.stop()
          } catch {}
          editCommandRecognitionRef.current = null
          setIsListeningForEditCommand(false)
          // Hands-free save should match the same UX ordering as button save:
          // save -> saved cue -> close (reader resumes in its onClose handler).
          void saveThenCueThenClose()
        }
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        console.error("[moonshine] Edit command listening error:", event.error)
      }
    }

    recognition.onend = () => {
      if (viewingEditId && !isRecordingRef.current && !pendingEdit) {
        setTimeout(() => {
          if (viewingEditId && !isRecordingRef.current && editCommandRecognitionRef.current) {
            try {
              recognition.start()
            } catch (err) {
              console.error("[moonshine] Failed to restart edit command listening:", err)
            }
          }
        }, 100)
      }
    }

    editCommandRecognitionRef.current = recognition
    try {
      recognition.start()
    } catch (err) {
      console.error("[moonshine] Failed to start edit command listening:", err)
      setIsListeningForEditCommand(false)
    }
  }

  useEffect(() => {
    if (autoStartRecording && !viewingEditId && !isRecording && !hasAttemptedAutoStartRef.current) {
      hasAttemptedAutoStartRef.current = true
      const timer = setTimeout(() => {
        if (!isRecordingRef.current && !mediaRecorderRef.current) {
          startRecording()
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [autoStartRecording, viewingEditId, isRecording])

  useEffect(() => {
    return () => {
      isRecordingRef.current = false
      if (silenceRafRef.current !== null) {
        cancelAnimationFrame(silenceRafRef.current)
        silenceRafRef.current = null
      }
      if (mediaRecorderRef.current) {
        try {
          if (mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop()
          }
        } catch (err) {
          console.error("Error stopping recorder on unmount:", err)
        }
        mediaRecorderRef.current = null
      }
      if (mediaStreamRef.current) {
        try {
          for (const track of mediaStreamRef.current.getTracks()) track.stop()
        } catch (err) {
          console.error("Error stopping media tracks on unmount:", err)
        }
        mediaStreamRef.current = null
      }
      if (audioContextRef.current) {
        try {
          void audioContextRef.current.close()
        } catch (err) {
          console.error("Error closing AudioContext on unmount:", err)
        }
        audioContextRef.current = null
        analyserRef.current = null
      }
      if (editCommandRecognitionRef.current) {
        try {
          editCommandRecognitionRef.current.stop()
        } catch {}
        editCommandRecognitionRef.current = null
      }
    }
  }, [])

  const editChunkIndex =
    cursorPosition?.chunkIndex ?? audiobook.manifest.chunks.findIndex((c) => c.chunk_id === session.currentChunkId)
  const editChunkId = cursorPosition?.chunkId || session.currentChunkId
  const currentChunk = audiobook.manifest.chunks[editChunkIndex >= 0 ? editChunkIndex : 0]

  const editSegmentIndex = cursorPosition
    ? cursorPosition.segmentIndex
    : (currentChunk?.timestamps.findIndex((seg, idx) => {
        const nextSeg = currentChunk.timestamps[idx + 1]
        return session.currentTime >= seg.start_time && (!nextSeg || session.currentTime < nextSeg.start_time)
      }) ?? 0)

  const viewingEdit = viewingEditId ? edits.find((e) => e.id === viewingEditId) : null
  const lastHydratedEditIdRef = useRef<string | null>(null)
  const chunkIndexFromEdit =
    viewingEdit && typeof viewingEdit.chunkIndex === "number" && viewingEdit.chunkIndex >= 0
      ? viewingEdit.chunkIndex
      : viewingEdit
        ? audiobook.manifest.chunks.findIndex((chunk) => chunk.chunk_id === viewingEdit.chunkId)
        : -1
  const baseChunkIndex = chunkIndexFromEdit >= 0 ? chunkIndexFromEdit : editChunkIndex
  const safeChunkIndex = Math.min(Math.max(baseChunkIndex >= 0 ? baseChunkIndex : 0, 0), Math.max(audiobook.manifest.chunks.length - 1, 0))
  const baseSegmentIndex =
    viewingEdit && typeof viewingEdit.segmentIndex === "number" ? viewingEdit.segmentIndex : editSegmentIndex
  const selectedChunk = audiobook.manifest.chunks[safeChunkIndex] ?? audiobook.manifest.chunks[0]
  const maxSegmentIndex = Math.max((selectedChunk?.timestamps.length ?? 1) - 1, 0)
  const safeSegmentIndex = Math.min(Math.max(baseSegmentIndex >= 0 ? baseSegmentIndex : 0, 0), maxSegmentIndex)
  const attachedSegmentText = selectedChunk?.timestamps[safeSegmentIndex]?.text || ""
  const resolvedChunkId =
    (viewingEdit?.chunkId && viewingEdit.chunkId.length > 0
      ? viewingEdit.chunkId
      : selectedChunk?.chunk_id || editChunkId || session.currentChunkId) ?? session.currentChunkId

  useEffect(() => {
    if (!viewingEdit) {
      lastHydratedEditIdRef.current = null
      return
    }
    if (lastHydratedEditIdRef.current === viewingEdit.id) return
    lastHydratedEditIdRef.current = viewingEdit.id
    setTranscript(viewingEdit.transcription)
    setEditType(viewingEdit.editType)
  }, [viewingEdit])

  async function startRecording() {
    if (mediaRecorderRef.current || isRecordingRef.current || isTranscribing) return
    hasTriggeredAutoSaveRef.current = false
    hasPlayedStartBeepRef.current = false
    hasPlayedStopCueRef.current = false

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setIsSupported(false)
      toast.error("Audio recording is not supported in your browser")
      return
    }

    setTranscript("")
    accumulatedTranscriptRef.current = ""
    recordedChunksRef.current = []
    hasHeardSpeechRef.current = false
    silenceMsRef.current = 0
    lastFrameTimeRef.current = null
    lastSpeechAtRef.current = null

    // Kick off download + warmup in the background.
    void ensureMoonshineReady().catch(() => {
      // We'll surface an error if/when transcription actually fails.
    })

    const beginRecording = async () => {
      let stream: MediaStream
      try {
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      } catch (err) {
        console.error("Failed to getUserMedia:", err)
        toast.error("Could not access microphone. Please check permissions.")
        return
      }

      mediaStreamRef.current = stream

      const preferredMimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      const mimeType = preferredMimeTypes.find((t) => {
        try {
          return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)
        } catch {
          return false
        }
      })

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordedChunksRef.current.push(event.data)
      }

      recorder.onerror = (event) => {
        console.error("Recorder error:", event)
        toast.error("Recording failed")
        stopRecording()
      }

      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType || "audio/webm" })
        recordedChunksRef.current = []

        if (!blob.size) {
          toast.error("No audio captured")
          return
        }

        setIsTranscribing(true)
        toast.info("Transcribing offline (Moonshine)…")
        try {
          const text = (await transcribeWithMoonshineFromBlob(blob)).trim()
          if (!text) {
            toast.error("No transcription detected")
            return
          }
          setTranscript(text)
          accumulatedTranscriptRef.current = text
          toast.success("Transcription complete")
          // Required order: save -> saved cue -> close (reader resumes in its onClose handler).
          await saveThenCueThenClose(text)
        } catch (err) {
          console.error("Moonshine transcription failed:", err)
          toast.error("Offline transcription failed")
        } finally {
          if (isMountedRef.current) {
            setIsTranscribing(false)
          }
        }
      }

      try {
        recorder.start(250)
      } catch (err) {
        console.error("Failed to start recorder:", err)
        toast.error("Failed to start recording")
        return
      }

      setIsRecording(true)
      isRecordingRef.current = true
      doneCommandTriggeredRef.current = false
      // Audible cue (once per session): recording is actually live.
      if (!hasPlayedStartBeepRef.current) {
        hasPlayedStartBeepRef.current = true
        try {
          const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
          const AudioContextCtor = w.AudioContext ?? w.webkitAudioContext
          if (AudioContextCtor) {
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
              } catch {}
            }
          }
        } catch {
          // ignore (some browsers block audio without user gesture)
        }
      }
      toast.success("Recording started — speak naturally")
      startDoneCommandListening()
      startSilenceMonitor(stream)
    }

    const start = () => {
      void beginRecording()
    }

    // Mirror Web Speech UX: play the pause cue first, then start recording.
    // Never block recording if audio playback is rejected by the browser.
    const pauseAudio = pauseAudioRef.current
    if (pauseAudio) {
      try {
        pauseAudio.currentTime = 0
        pauseAudio.onended = () => start()
        const p = pauseAudio.play()
        if (p && typeof (p as Promise<void>).catch === "function") {
          ;(p as Promise<void>).catch(() => start())
        }
      } catch {
        start()
      }
    } else {
      start()
    }
  }

  function startSilenceMonitor(stream: MediaStream) {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const AudioContextCtor = w.AudioContext ?? w.webkitAudioContext
    if (!AudioContextCtor) return

    const SILENCE_RMS_THRESHOLD = 0.015
    // Auto-stop shortly after the user stops speaking (feels responsive on mobile).
    const SILENCE_STOP_MS = 1800
    const MIN_RECORD_MS = 1200
    const MAX_RECORD_MS = 60_000

    const startedAt = performance.now()

    try {
      const ctx: AudioContext = new AudioContextCtor()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      const buffer = new Float32Array(analyser.fftSize)

      const tick = (now: number) => {
        if (!isRecordingRef.current) return

        const last = lastFrameTimeRef.current ?? now
        const dt = now - last
        lastFrameTimeRef.current = now

        analyser.getFloatTimeDomainData(buffer)
        let sum = 0
        for (let i = 0; i < buffer.length; i++) {
          const v = buffer[i]
          sum += v * v
        }
        const rms = Math.sqrt(sum / buffer.length)

        const elapsed = now - startedAt
        if (rms >= SILENCE_RMS_THRESHOLD) {
          hasHeardSpeechRef.current = true
          silenceMsRef.current = 0
          lastSpeechAtRef.current = now
        } else if (hasHeardSpeechRef.current && elapsed >= MIN_RECORD_MS) {
          silenceMsRef.current += dt
          const lastSpeechAt = lastSpeechAtRef.current
          const silenceSinceLastSpeech = typeof lastSpeechAt === "number" ? now - lastSpeechAt : silenceMsRef.current
          if (silenceSinceLastSpeech >= SILENCE_STOP_MS) {
            stopRecording()
            return
          }
        }

        if (elapsed >= MAX_RECORD_MS) {
          stopRecording()
          return
        }

        silenceRafRef.current = requestAnimationFrame(tick)
      }

      silenceRafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      console.warn("Silence monitor unavailable:", err)
    }
  }

  function stopRecording(options?: { fromUserGesture?: boolean }) {
    isRecordingRef.current = false
    setIsRecording(false)

    if (doneCommandRecognitionRef.current) {
      try {
        doneCommandRecognitionRef.current.stop()
      } catch {}
      doneCommandRecognitionRef.current = null
    }

    if (silenceRafRef.current !== null) {
      cancelAnimationFrame(silenceRafRef.current)
      silenceRafRef.current = null
    }

    if (mediaRecorderRef.current) {
      const recorder = mediaRecorderRef.current
      mediaRecorderRef.current = null
      try {
        if (recorder.state !== "inactive") recorder.stop()
      } catch (err) {
        console.error("[moonshine] Error stopping recorder:", err)
      }
    }

    if (mediaStreamRef.current) {
      try {
        for (const track of mediaStreamRef.current.getTracks()) track.stop()
      } catch (err) {
        console.error("[moonshine] Error stopping media tracks:", err)
      }
      mediaStreamRef.current = null
    }

    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close()
      } catch {}
      audioContextRef.current = null
      analyserRef.current = null
    }
  }

  function startDoneCommandListening() {
    // Optional: mirror Web Speech behavior ("I'm done") when SpeechRecognition is available.
    // If SpeechRecognition isn't available or errors, we keep the existing silence auto-stop.
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) return
    if (doneCommandRecognitionRef.current) return

    let restartAttempts = 0
    const maxRestartAttempts = 3
    const recognition: SpeechRecognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = "en-US"

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const lastResult = event.results[event.results.length - 1]
      if (!lastResult?.isFinal) return
      const heard = (lastResult[0]?.transcript ?? "").toLowerCase()
      if (heard.includes("i'm done") || heard.includes("im done") || heard.includes("i am done")) {
        doneCommandTriggeredRef.current = true
        try {
          recognition.stop()
        } catch {}
        doneCommandRecognitionRef.current = null
        stopRecording()
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // If SpeechRecognition can't access the mic concurrently, just fall back to silence detection.
      if (event.error !== "aborted" && event.error !== "no-speech") {
        console.warn("[moonshine] Done command listening error:", event.error)
      }
      try {
        recognition.stop()
      } catch {}
      doneCommandRecognitionRef.current = null
    }

    recognition.onend = () => {
      if (!isRecordingRef.current) return
      if (doneCommandTriggeredRef.current) return
      if (restartAttempts >= maxRestartAttempts) return
      restartAttempts++
      setTimeout(() => {
        if (!isRecordingRef.current) return
        if (doneCommandTriggeredRef.current) return
        if (doneCommandRecognitionRef.current !== recognition) return
        try {
          recognition.start()
        } catch {
          doneCommandRecognitionRef.current = null
        }
      }, 150)
    }

    doneCommandRecognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      doneCommandRecognitionRef.current = null
    }
  }

  async function playEditSavedAndPromptResume() {
    const editText = accumulatedTranscriptRef.current.trim() || transcript.trim()
    setPendingEdit(editText)

    // IMPORTANT: Never gate saving on audio playback.
    //
    // On mobile (and especially when we auto-stop via silence detection), the browser can block
    // `audio.play()` because it isn't a direct user gesture. Previously we only saved on
    // `onended`, which made Moonshine appear "broken" (transcript shows, but nothing persists).
    if (!hasTriggeredAutoSaveRef.current) {
      hasTriggeredAutoSaveRef.current = true
      void saveEdit(editText, { closeAfterSave: true })
    }

    // Best-effort chime (non-blocking).
    playAudioBestEffort(editSavedAudioRef.current)
  }

  async function saveEdit(
    editInput?: string | MouseEvent<HTMLButtonElement>,
    options?: { closeAfterSave?: boolean },
  ): Promise<boolean> {
    try {
      const closeAfterSave = options?.closeAfterSave ?? true
      const manualText = typeof editInput === "string" ? editInput : undefined
      const candidates = [manualText, pendingEdit, transcript]
      let finalTranscription = ""

      for (const value of candidates) {
        if (typeof value === "string") {
          const trimmed = value.trim()
          if (trimmed) {
            finalTranscription = trimmed
            break
          }
        }
      }

      if (!finalTranscription) {
        toast.error("No transcription to save")
        return false
      }

      let updatedEdits: VoiceEdit[]
      const wasUpdate = Boolean(viewingEditId)
      if (wasUpdate) {
        updatedEdits = edits.map((edit) =>
          edit.id === viewingEditId ? { ...edit, transcription: finalTranscription, editType } : edit,
        )
      } else {
        const newEdit: VoiceEdit = {
          id: `edit-${Date.now()}`,
          timestamp: Date.now(),
          chunkId: resolvedChunkId,
          chunkIndex: safeChunkIndex,
          segmentIndex: safeSegmentIndex,
          editType,
          transcription: finalTranscription,
          createdAt: new Date().toISOString(),
        }
        updatedEdits = [...edits, newEdit]
      }

      await onUpdateSession({ edits: updatedEdits })
      // Show the "saved" message after persistence succeeds (matches Web Speech UX).
      toast.success(wasUpdate ? "Edit updated successfully" : "Edit saved successfully")
      setPendingEdit(null)
      hasTriggeredAutoSaveRef.current = false
      if (closeAfterSave) {
        onClose?.()
      }
      return true
    } catch (error) {
      console.error("[moonshine] Error saving edit:", error)
      toast.error("Failed to save edit")
      return false
    }
  }

  async function deleteEdit() {
    if (!viewingEditId) return
    const updatedEdits = edits.filter((edit) => edit.id !== viewingEditId)
    try {
      await onUpdateSession({ edits: updatedEdits })
      toast.success("Edit deleted")
      onClose?.()
    } catch (error) {
      console.error("[moonshine] Error deleting edit:", error)
      toast.error("Failed to delete edit")
    }
  }

  if (!isSupported) {
    return (
      <div className="border-2 border-black-text p-4 rounded-lg bg-[color:var(--color-orange)]/10">
        <p className="text-sm text-black-text/70">Offline voice transcription is not supported in your browser.</p>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black-text/50">
      <div className="relative max-w-md w-full max-h-[80vh] overflow-hidden bg-white-text text-black-text border-2 border-black-text rounded-2xl shadow-[6px_6px_0_0_rgba(35,31,32,0.12)]">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1 rounded-full hover:bg-black-text/5 transition-colors"
          aria-label="Close editor"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="max-h-[80vh] overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-1 pr-10">Voice Editor</h3>
            <p className="text-xs text-black-text/60 mb-4">Offline transcription: Moonshine (worker)</p>

            <div className="space-y-6">
          {isAwaitingResumeConfirmation && (
            <div className="p-4 bg-[color:var(--color-orange)]/10 border-2 border-black-text/40 rounded-md">
              <div className="flex items-center justify-center gap-2">
                <div className="w-3 h-3 bg-[color:var(--color-orange)] rounded-full animate-pulse" />
                <span className="text-sm font-medium">Listening for yes or no...</span>
              </div>
            </div>
          )}

          {pendingEdit && (
            <div className="p-4 bg-[color:var(--color-orange)]/10 border-2 border-[color:var(--color-orange)] rounded-md">
              <p className="text-sm font-medium">Edit ready to save. Say &quot;yes&quot; to save and resume.</p>
            </div>
          )}

          {attachedSegmentText && (
            <div className="p-3 bg-black-text/5 border-2 border-black-text/20 rounded-md">
              <p className="text-xs font-medium mb-1 text-[color:var(--color-orange)]">Attached to</p>
              <p className="text-sm text-black-text/70 italic line-clamp-3">&ldquo;{attachedSegmentText}&rdquo;</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 min-w-0">
            <div>
              <label className="text-sm font-medium mb-2 block">Edit Type</label>
              <Select value={editType} onValueChange={(v) => setEditType(v as typeof editType)}>
                <SelectTrigger className="w-full border-black-text">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last-line">Line Edit</SelectItem>
                  <SelectItem value="last-paragraph">Section Edit</SelectItem>
                  <SelectItem value="custom">Dev Edit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isRecording && (
              <div className="p-4 bg-[color:var(--color-orange)]/10 border-2 border-[color:var(--color-orange)] rounded-md">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-3 h-3 bg-[color:var(--color-orange)] rounded-full animate-pulse" />
                  <span className="text-sm font-medium">Listening...</span>
                </div>
                <p className="text-xs text-black-text/70 text-center mt-2">
                  Transcription starts after you stop speaking.
                </p>
              </div>
            )}

            {isTranscribing && (
              <div className="p-4 bg-black-text/5 border-2 border-black-text/20 rounded-md">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-3 h-3 bg-[color:var(--color-orange)] rounded-full animate-pulse" />
                  <span className="text-sm font-medium">Transcribing in background…</span>
                </div>
              </div>
            )}

            {viewingEditId && isListeningForEditCommand && !isRecording && !pendingEdit && (
              <div className="p-4 bg-[color:var(--color-orange)]/10 border-2 border-[color:var(--color-orange)] rounded-md">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-3 h-3 bg-[color:var(--color-orange)] rounded-full animate-pulse" />
                  <span className="text-sm font-medium">Voice commands ready</span>
                </div>
                <p className="text-xs text-black-text/70 text-center mt-2">
                  Say &quot;Edit&quot; to re-record or &quot;Save&quot; to save changes
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Transcript / Edit Text</label>
              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="w-full border-black-text min-h-[120px]"
                placeholder="Record with your voice or type your edits here..."
              />
            </div>

            <div className="flex gap-2 min-w-0">
              {!viewingEditId && (
                <Button
                  onClick={isRecording ? () => stopRecording({ fromUserGesture: true }) : startRecording}
                  className="flex-1 min-w-0 border-2 border-black-text"
                  variant={isRecording ? "destructive" : "default"}
                >
                  {isRecording ? (
                    <>
                      <Square className="mr-2 h-4 w-4" />
                      Stop Recording
                    </>
                  ) : (
                    <>
                      <Mic className="mr-2 h-4 w-4" />
                      Record Voice
                    </>
                  )}
                </Button>
              )}

              {transcript && !isRecording && (
                <Button
                  onClick={(event) => {
                    // Required order: save -> cue -> close.
                    void (async () => {
                      // Prefer the explicit current transcript if it exists to avoid any timing issues.
                      const manualText = transcript.trim()
                      await saveThenCueThenClose(manualText || undefined)
                    })()
                  }}
                  className="flex-1 min-w-0 border-2 border-black-text bg-[color:var(--color-orange)]"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {viewingEditId ? "Update Edit" : "Save Edit"}
                </Button>
              )}

              {viewingEditId && (
                <Button
                  onClick={deleteEdit}
                  variant="destructive"
                  className="flex-1 min-w-0 border-2 border-black-text"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Edit
                </Button>
              )}
            </div>
          </div>

          {!viewingEditId && edits.length > 0 && (
            <div className="mt-6">
              <h4 className="font-medium mb-2 text-sm">Recent Edits ({edits.length})</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {edits
                  .slice(-5)
                  .reverse()
                  .map((edit) => (
                    <div key={edit.id} className="text-xs p-2 border border-black-text rounded">
                      <div className="flex justify-between mb-1">
                        <span className="font-medium">{getEditTypeLabel(edit.editType)}</span>
                        <span className="text-black-text/60">{new Date(edit.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-black-text/70 truncate">{edit.transcription}</div>
                    </div>
                  ))}
              </div>
            </div>
          )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

