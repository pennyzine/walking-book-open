"use client"

import { useState, useRef, useEffect, type MouseEvent } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mic, Square, Save, Trash2, X } from "lucide-react"
import type { StoredAudiobook, SessionData, VoiceEdit } from "@/types/audiobook"
import { toast } from "sonner"
import { Textarea } from "@/components/ui/textarea"
import { getEditTypeLabel } from "@/lib/edit-utils"
import { debugLog } from "@/lib/debug"

interface VoiceEditorProps {
  audiobook: StoredAudiobook
  session: SessionData
  onUpdateSession: (updates: Partial<SessionData>) => void
  viewingEditId?: string | null
  cursorPosition?: { chunkIndex: number; chunkId: string; segmentIndex: number } | null
  onClose?: () => void
  autoStartRecording?: boolean
}

export function VoiceEditor({
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

  const recognitionRef = useRef<any>(null)
  const isRecordingRef = useRef(false)
  const hasAttemptedAutoStartRef = useRef(false)
  const pauseAudioRef = useRef<HTMLAudioElement | null>(null)
  const editSavedAudioRef = useRef<HTMLAudioElement | null>(null)
  const resumePromptAudioRef = useRef<HTMLAudioElement | null>(null)
  const accumulatedTranscriptRef = useRef<string>("") // Track transcript from PREVIOUS recognition sessions
  const currentSessionTranscriptRef = useRef<string>("") // Track transcript from CURRENT session (for onend to read)
  const editCommandRecognitionRef = useRef<any>(null) // For listening for "Edit" command when viewing
  const [isListeningForEditCommand, setIsListeningForEditCommand] = useState(false)
  const hasAnnouncedRecordingStartRef = useRef(false)
  const recognitionRestartAttemptsRef = useRef(0)
  const hasPlayedStartBeepRef = useRef(false)

  useEffect(() => {
    // Don't play any audio when opening voice editor - just prepare the audio elements for later use
    const audio = new Audio("/audio/voice-editor-pause.wav")
    audio.preload = "auto"
    pauseAudioRef.current = audio

    const editSavedAudio = new Audio("/audio/voice-editor-saved.wav")
    editSavedAudio.preload = "auto"
    editSavedAudioRef.current = editSavedAudio

    const resumePromptAudio = new Audio("/audio/voice-editor-resume.wav")
    resumePromptAudio.preload = "auto"
    resumePromptAudioRef.current = resumePromptAudio

    return () => {
      if (pauseAudioRef.current) {
        pauseAudioRef.current.pause()
        pauseAudioRef.current = null
      }
      if (editSavedAudioRef.current) {
        editSavedAudioRef.current.pause()
        editSavedAudioRef.current = null
      }
      if (resumePromptAudioRef.current) {
        resumePromptAudioRef.current.pause()
        resumePromptAudioRef.current = null
      }
    }
  }, [])

  const edits = session.edits || []

  useEffect(() => {
    if (viewingEditId) {
      // Start listening for "Edit" voice command when viewing an existing edit
      startListeningForEditCommand()
    }

    return () => {
      if (editCommandRecognitionRef.current) {
        try {
          editCommandRecognitionRef.current.stop()
        } catch (err) {}
        editCommandRecognitionRef.current = null
      }
    }
  }, [viewingEditId])

  // Listen for "Edit" voice command when viewing an existing edit
  function startListeningForEditCommand() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    setIsListeningForEditCommand(true)
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = "en-US"

    recognition.onresult = (event: any) => {
      const lastResult = event.results[event.results.length - 1]
      if (lastResult.isFinal) {
        const transcript = lastResult[0].transcript.toLowerCase()
        debugLog("[v0] Edit command heard:", transcript)

        if (transcript.includes("edit")) {
          // Stop listening for edit command and start recording
          if (editCommandRecognitionRef.current) {
            try {
              editCommandRecognitionRef.current.stop()
            } catch (err) {}
            editCommandRecognitionRef.current = null
          }
          setIsListeningForEditCommand(false)
          // Clear existing transcript and start fresh recording
          setTranscript("")
          accumulatedTranscriptRef.current = ""
          startRecording()
        } else if (transcript.includes("save")) {
          // Save the edit via voice command
          if (editCommandRecognitionRef.current) {
            try {
              editCommandRecognitionRef.current.stop()
            } catch (err) {}
            editCommandRecognitionRef.current = null
          }
          setIsListeningForEditCommand(false)
          // Save if there's content in the text field
          void saveEdit(undefined, { closeAfterSave: true })
        }
      }
    }

    recognition.onerror = (event: any) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        debugLog("[v0] Edit command listening error:", event.error)
      }
    }

    recognition.onend = () => {
      // Keep listening if still in edit view mode and not recording
      if (viewingEditId && !isRecordingRef.current && !pendingEdit) {
        setTimeout(() => {
          if (viewingEditId && !isRecordingRef.current && editCommandRecognitionRef.current) {
            try {
              recognition.start()
            } catch (err) {
              debugLog("[v0] Failed to restart edit command listening:", err)
            }
          }
        }, 100)
      }
    }

    editCommandRecognitionRef.current = recognition
    try {
      recognition.start()
    } catch (err) {
      debugLog("[v0] Failed to start edit command listening:", err)
      setIsListeningForEditCommand(false)
    }
  }

  useEffect(() => {
    if (autoStartRecording && !viewingEditId && !isRecording && !hasAttemptedAutoStartRef.current) {
      hasAttemptedAutoStartRef.current = true

      // Start recording after a short delay to let the UI settle
      const timer = setTimeout(() => {
        if (!isRecordingRef.current && !recognitionRef.current) {
          startRecording()
        }
      }, 300)

      return () => clearTimeout(timer)
    }
  }, [autoStartRecording, viewingEditId])

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        isRecordingRef.current = false
        try {
          recognitionRef.current.stop()
        } catch (err) {
          console.error("Error stopping recognition on unmount:", err)
        }
        recognitionRef.current = null
      }
      if (editCommandRecognitionRef.current) {
        try {
          editCommandRecognitionRef.current.stop()
        } catch (err) {}
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
  const safeChunkIndex = Math.min(
    Math.max(baseChunkIndex >= 0 ? baseChunkIndex : 0, 0),
    Math.max(audiobook.manifest.chunks.length - 1, 0),
  )
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
    if (lastHydratedEditIdRef.current === viewingEdit.id) {
      return
    }
    lastHydratedEditIdRef.current = viewingEdit.id
    setTranscript(viewingEdit.transcription)
    setEditType(viewingEdit.editType)
  }, [viewingEdit])

  function startRecording() {
    if (recognitionRef.current || isRecordingRef.current) {
      debugLog("[v0] Recognition already active, skipping start")
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      setIsSupported(false)
      toast.error("Speech recognition is not supported in your browser")
      return
    }

    // Reset tracking for new recording session (not restart)
    accumulatedTranscriptRef.current = ""
    currentSessionTranscriptRef.current = ""
    hasAnnouncedRecordingStartRef.current = false
    recognitionRestartAttemptsRef.current = 0
    hasPlayedStartBeepRef.current = false

    // Play audio prompt first, then start recognition after it finishes
    const beginRecognition = () => {
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true // Show live transcription as user speaks
      recognition.lang = "en-US"

      recognition.onstart = () => {
        debugLog("[v0] Speech recognition started successfully")
        setIsRecording(true)
        isRecordingRef.current = true

        // Audible cue (once per session): recognition is actually live.
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

        // Avoid repeated "start" feedback on mobile: Web Speech often ends/restarts mid-session.
        if (!hasAnnouncedRecordingStartRef.current) {
          hasAnnouncedRecordingStartRef.current = true
          toast.success("Recording started - say “I’m done” to stop")
        }
      }

      setupRecognitionHandlers(recognition)
    }

    if (pauseAudioRef.current) {
      pauseAudioRef.current.currentTime = 0
      pauseAudioRef.current.onended = () => {
        beginRecognition()
      }
      pauseAudioRef.current.play().catch((err) => {
        console.error("Failed to play start audio:", err)
        // Start recognition anyway if audio fails
        beginRecognition()
      })
    } else {
      beginRecognition()
    }
  }

  function setupRecognitionHandlers(recognition: any) {
    recognition.onresult = (event: any) => {
      // Use resultIndex to only process NEW results (prevents mobile duplication)
      let newFinalText = ""
      let interimText = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript

        // Skip zero-confidence results (Android Chrome issue)
        if (result[0].confidence === 0) continue

        if (result.isFinal) {
          newFinalText += text
        } else {
          interimText = text
        }
      }

      // Append new finals to session transcript
      if (newFinalText) {
        const prev = currentSessionTranscriptRef.current
        currentSessionTranscriptRef.current = prev + (prev ? " " : "") + newFinalText
      }

      // Full transcript = accumulated + session finals + current interim
      const parts: string[] = []
      if (accumulatedTranscriptRef.current) parts.push(accumulatedTranscriptRef.current)
      if (currentSessionTranscriptRef.current) parts.push(currentSessionTranscriptRef.current)
      if (interimText) parts.push(interimText)
      const fullTranscript = parts.join(" ").trim()

      // Check for "I'm done" command
      const lower = fullTranscript.toLowerCase()
      if (lower.includes("i'm done") || lower.includes("im done") || lower.includes("i am done")) {
        const cleaned = fullTranscript
          .replace(/i'm done\.?/gi, "")
          .replace(/im done\.?/gi, "")
          .replace(/i am done\.?/gi, "")
          .trim()
        setTranscript(cleaned)
        accumulatedTranscriptRef.current = cleaned
        stopRecording()
        return
      }

      setTranscript(fullTranscript)
    }

    recognition.onerror = (event: any) => {
      debugLog("[v0] Speech recognition error:", event.error)
      if (event.error === "audio-capture") {
        toast.error("Could not access microphone. Please check that no other app is using it.")
        stopRecording()
      } else if (event.error === "not-allowed") {
        toast.error("Microphone permission denied. Please allow microphone access.")
        stopRecording()
      } else if (event.error === "aborted") {
        debugLog("[v0] Recognition aborted (normal)")
      } else if (event.error === "no-speech") {
        debugLog("[v0] No speech detected (continuing)")
      } else {
        toast.error(`Recognition error: ${event.error}`)
        stopRecording()
      }
    }

    recognition.onend = () => {
      debugLog("[v0] Recognition ended, isRecordingRef:", isRecordingRef.current)
      if (isRecordingRef.current && recognitionRef.current) {
        // Add this session's transcript to accumulated before restart
        const sessionText = currentSessionTranscriptRef.current.trim()
        if (sessionText) {
          const prev = accumulatedTranscriptRef.current
          accumulatedTranscriptRef.current = prev + (prev ? " " : "") + sessionText
        }
        // Clear current session for next restart
        currentSessionTranscriptRef.current = ""

        setTimeout(() => {
          if (isRecordingRef.current && recognitionRef.current) {
            try {
              debugLog("[v0] Restarting recognition...")
              recognitionRestartAttemptsRef.current = 0
              recognition.start()
            } catch (err) {
              debugLog("[v0] Failed to restart recognition:", err)
              // On some browsers this can intermittently fail (or require a longer cooldown).
              // Do NOT stop the whole recording session; keep waiting for “I’m done”.
              const attempts = (recognitionRestartAttemptsRef.current ?? 0) + 1
              recognitionRestartAttemptsRef.current = attempts
              if (attempts <= 5) {
                setTimeout(() => {
                  if (!isRecordingRef.current || recognitionRef.current !== recognition) return
                  try {
                    recognition.start()
                  } catch (err2) {
                    debugLog("[v0] Restart retry failed:", err2)
                  }
                }, 300 + attempts * 250)
              }
            }
          }
        }, 100)
      }
    }

    recognitionRef.current = recognition
    try {
      debugLog("[v0] Starting speech recognition...")
      recognition.start()
    } catch (err) {
      debugLog("[v0] Failed to start recognition:", err)
      toast.error("Failed to start recording. Make sure no other app is using your microphone.")
      recognitionRef.current = null
      setIsSupported(false)
    }
  }

  function stopRecording() {
    debugLog("[v0] Stopping recording...")
    isRecordingRef.current = false
    setIsRecording(false)

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (err) {
        debugLog("[v0] Error stopping recognition:", err)
      }
      recognitionRef.current = null
    }

    // Keep accumulatedTranscriptRef until save, in case we need it

    // Use ref value instead of state (state might not be updated yet)
    const hasTranscript = accumulatedTranscriptRef.current.trim() || transcript.trim()
    if (hasTranscript) {
      toast.success("Recording stopped")
      playEditSavedAndPromptResume()
    }
  }

  async function playEditSavedAndPromptResume() {
    // Use accumulated transcript which has the latest value
    const editText = accumulatedTranscriptRef.current.trim() || transcript.trim()
    setPendingEdit(editText)

    if (editSavedAudioRef.current) {
      editSavedAudioRef.current.currentTime = 0

      editSavedAudioRef.current.onended = async () => {
        debugLog("[v0] Edit saved audio ended, saving edit now")
        await saveEdit(editText, { closeAfterSave: true })
      }

      editSavedAudioRef.current.play()
    }
  }

  async function saveEdit(
    editInput?: string | MouseEvent<HTMLButtonElement>,
    options?: { closeAfterSave?: boolean },
  ) {
    try {
      const closeAfterSave = options?.closeAfterSave ?? true
      debugLog("[v0] saveEdit called, pendingEdit:", pendingEdit, "transcript:", transcript)
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
        debugLog("[v0] No transcription to save!")
        toast.error("No transcription to save")
        return
      }

      debugLog("[v0] Saving transcription:", finalTranscription)
      let updatedEdits: VoiceEdit[]

      if (viewingEditId) {
        updatedEdits = edits.map((edit) =>
          edit.id === viewingEditId
            ? {
                ...edit,
                transcription: finalTranscription,
                editType,
              }
            : edit,
        )
        toast.success("Edit updated successfully")
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
        debugLog("[v0] Created new edit:", newEdit)
        toast.success("Edit saved successfully")
      }

      debugLog("[v0] Calling onUpdateSession with", updatedEdits.length, "edits")
      await onUpdateSession({ edits: updatedEdits })
      debugLog("[v0] onUpdateSession completed successfully")
      setPendingEdit(null)
      if (closeAfterSave) {
        onClose?.()
      }
    } catch (error) {
      debugLog("[v0] Error saving edit:", error)
      toast.error("Failed to save edit")
    }
  }

  function startResumeConfirmationListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    debugLog("[v0] Starting resume confirmation listening")
    setIsAwaitingResumeConfirmation(true)
    const recognition = new SpeechRecognition()
    recognition.continuous = true // Use continuous for better mobile support
    recognition.interimResults = false
    recognition.lang = "en-US"

    let hasResponded = false
    let restartAttempts = 0
    const maxRestartAttempts = 3

    // Timeout to stop listening after 10 seconds if no response - save edit anyway
    const timeoutId = setTimeout(() => {
      if (!hasResponded) {
        debugLog("[v0] Resume confirmation timeout, edit already saved, staying paused")
        try {
          recognition.stop()
        } catch (err) {}
        toast.info("Staying paused")
        setIsAwaitingResumeConfirmation(false)
      }
    }, 10000)

    recognition.onresult = (event: any) => {
      const lastResult = event.results[event.results.length - 1]
      if (lastResult.isFinal) {
        const transcript = lastResult[0].transcript.toLowerCase()
        debugLog("[v0] Resume confirmation heard:", transcript)

        if (
          transcript.includes("yes") ||
          transcript.includes("yeah") ||
          transcript.includes("yep") ||
          transcript.includes("sure") ||
          transcript.includes("okay") ||
          transcript.includes("ok")
        ) {
          hasResponded = true
          clearTimeout(timeoutId)
          try {
            recognition.stop()
          } catch (err) {}
          saveEdit(undefined, { closeAfterSave: true }).then(() => {
            setIsAwaitingResumeConfirmation(false)
            toast.success("Resuming playback...")
            if (onClose) {
              onClose()
            }
          })
        } else if (transcript.includes("no") || transcript.includes("nope") || transcript.includes("nah")) {
          hasResponded = true
          clearTimeout(timeoutId)
          try {
            recognition.stop()
          } catch (err) {}
          // Save the edit but don't resume playback
          saveEdit(undefined, { closeAfterSave: true }).then(() => {
            toast.info("Edit saved, staying paused")
            setIsAwaitingResumeConfirmation(false)
          })
        }
      }
    }

    recognition.onerror = (event: any) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        debugLog("[v0] Resume confirmation error:", event.error)
      }
    }

    recognition.onend = () => {
      // Restart if no response yet and within retry limit
      if (!hasResponded && restartAttempts < maxRestartAttempts) {
        restartAttempts++
        debugLog("[v0] Restarting resume confirmation listening, attempt:", restartAttempts)
        setTimeout(() => {
          if (!hasResponded) {
            try {
              recognition.start()
            } catch (err) {
              debugLog("[v0] Failed to restart resume confirmation:", err)
              setIsAwaitingResumeConfirmation(false)
            }
          }
        }, 100)
      } else if (!hasResponded) {
        setIsAwaitingResumeConfirmation(false)
      }
    }

    try {
      recognition.start()
    } catch (err) {
      debugLog("[v0] Failed to start resume confirmation:", err)
      clearTimeout(timeoutId)
      setIsAwaitingResumeConfirmation(false)
    }
  }

  async function deleteEdit() {
    if (!viewingEditId) return

    const updatedEdits = edits.filter((edit) => edit.id !== viewingEditId)
    onUpdateSession({ edits: updatedEdits })
    toast.success("Edit deleted")
    if (onClose) onClose()
  }

  if (!isSupported) {
    return (
      <div className="border-2 border-black-text p-4 rounded-lg bg-[color:var(--color-orange)]/10">
        <p className="text-sm text-black-text/70">Speech recognition is not supported in your browser.</p>
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
            <h3 className="text-lg font-semibold mb-4 pr-10">Voice Editor</h3>

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
              <Select value={editType} onValueChange={(v: any) => setEditType(v)}>
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
                  Say &quot;I&apos;m done&quot; to stop recording
                </p>
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
                  onClick={isRecording ? stopRecording : startRecording}
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
                    void saveEdit(event, { closeAfterSave: true })
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
