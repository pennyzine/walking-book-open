"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Play, Pause, SkipBack, SkipForward, AlertCircle, Download } from "lucide-react"
import type { StoredAudiobook, SessionData } from "@/types/audiobook"
import { getAudioFile } from "@/lib/db"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { debugLog } from "@/lib/debug"

interface AudioPlayerProps {
  audiobook: StoredAudiobook
  session: SessionData
  onUpdateSession: (updates: Partial<SessionData>) => void
  isPlaying?: boolean
  onPlayingChange?: (playing: boolean) => void
  onPause?: () => void
}

export function AudioPlayer({
  audiobook,
  session,
  onUpdateSession,
  isPlaying: externalIsPlaying,
  onPlayingChange,
  onPause,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)

  const currentChunk = audiobook.manifest.chunks.find((c) => c.chunk_id === session.currentChunkId)

  useEffect(() => {
    let active = true
    let currentUrl: string | null = null

    async function loadAudio() {
      if (!currentChunk) return

      try {
        setIsLoading(true)
        setError(null)
        setIsPlaying(false)
        setCurrentTime(0)
        setDuration(0)
        setBlob(null)

        debugLog("[v0] Loading audio for chunk:", currentChunk.chunk_id, "file:", currentChunk.audio_file)
        const retrievedBlob = await getAudioFile(audiobook.id, currentChunk.audio_file)

        if (!active) return

        if (retrievedBlob) {
          debugLog("[v0] Audio blob retrieved - Size:", retrievedBlob.size, "Type:", retrievedBlob.type)

          if (retrievedBlob.size === 0) {
            debugLog("[v0] Blob is empty!")
            setError("Audio file is empty or corrupted")
            return
          }

          currentUrl = URL.createObjectURL(retrievedBlob)
          debugLog("[v0] Created blob URL:", currentUrl)
          setAudioUrl(currentUrl)
          setBlob(retrievedBlob)
        } else {
          debugLog("[v0] Audio blob not found for:", currentChunk.audio_file)
          setError("Audio file not found in database")
        }
      } catch (error) {
        if (active) {
          debugLog("[v0] Error loading audio:", error)
          setError(`Failed to load audio: ${error}`)
        }
      } finally {
        if (active) setIsLoading(false)
      }
    }

    loadAudio()

    return () => {
      active = false
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
    }
  }, [session.currentChunkId, audiobook.id, currentChunk])

  useEffect(() => {
    if (audioRef.current && audioUrl && session.currentTime > 0) {
      // Only set time if it's significantly different to avoid stutter
      if (Math.abs(audioRef.current.currentTime - session.currentTime) > 0.5) {
        audioRef.current.currentTime = session.currentTime
      }
    }
  }, [audioUrl, session.currentTime]) // Keep session.currentTime to allow external updates

  useEffect(() => {
    if (externalIsPlaying !== undefined && externalIsPlaying !== isPlaying) {
      togglePlay()
    }
  }, [externalIsPlaying])

  async function togglePlay() {
    if (!audioRef.current || !audioUrl) return

    try {
      if (isPlaying) {
        audioRef.current.pause()
        setIsPlaying(false)
        onPlayingChange?.(false)
        onPause?.()
      } else {
        if (audioRef.current.readyState === 0) {
          audioRef.current.load()
        }
        await audioRef.current.play()
        setIsPlaying(true)
        onPlayingChange?.(true)
      }
    } catch (error) {
      console.error("Play failed:", error)
      setIsPlaying(false)
      onPlayingChange?.(false)
      setError("Playback failed. The audio format might not be supported.")
    }
  }

  function handleTimeUpdate() {
    if (!audioRef.current) return
    setCurrentTime(audioRef.current.currentTime)
    // We'll keep updating session for now but maybe less frequently in a real app
    onUpdateSession({ currentTime: audioRef.current.currentTime })
  }

  function handleLoadedMetadata() {
    if (!audioRef.current) return
    setDuration(audioRef.current.duration)
    if (session.currentTime > 0) {
      audioRef.current.currentTime = session.currentTime
    }
  }

  function handleError(e: React.SyntheticEvent<HTMLAudioElement, Event>) {
    const target = e.currentTarget

    let errorMessage = "An error occurred while playing audio."
    if (target.error) {
      switch (target.error.code) {
        case target.error.MEDIA_ERR_ABORTED:
          errorMessage = "Playback aborted."
          break
        case target.error.MEDIA_ERR_NETWORK:
          errorMessage = "Network error while loading audio."
          break
        case target.error.MEDIA_ERR_DECODE:
          errorMessage = "Audio decoding failed. The file might be corrupted."
          break
        case target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = "Audio format not supported by browser."
          break
        default:
          errorMessage = `Audio error: ${target.error.message || "Unknown error"}`
      }
    }
    setError(errorMessage)
    setIsPlaying(false)
    onPlayingChange?.(false)
  }

  function handleSeek(value: number[]) {
    if (!audioRef.current) return
    audioRef.current.currentTime = value[0]
    setCurrentTime(value[0])
    onUpdateSession({ currentTime: value[0] })
  }

  function skipChunk(direction: "prev" | "next") {
    const currentIndex = audiobook.manifest.chunks.findIndex((c) => c.chunk_id === session.currentChunkId)
    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1
    if (newIndex >= 0 && newIndex < audiobook.manifest.chunks.length) {
      onUpdateSession({
        currentChunkId: audiobook.manifest.chunks[newIndex].chunk_id,
        currentTime: 0,
      })
      setIsPlaying(false)
      onPlayingChange?.(false)
    }
  }

  function formatTime(seconds: number) {
    if (!seconds || isNaN(seconds)) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  return (
    <div className="border-2 border-black-text p-4 rounded-lg bg-white">
      <h3 className="font-bold mb-4">Audio Player</h3>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2">
            <span>{error}</span>
            {blob && (
              <Button
                variant="outline"
                size="sm"
                className="w-fit mt-2 bg-transparent"
                onClick={() => {
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement("a")
                  a.href = url
                  a.download = currentChunk?.audio_file.split("/").pop() || "audio.mp3"
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Audio Chunk
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {audioUrl && !error && (
        <audio
          ref={audioRef}
          key={audioUrl} // Force re-render when URL changes to prevent stale state
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => setIsPlaying(false)}
          onError={handleError}
          playsInline
          preload="auto" // Changed to auto to ensure full loading
          crossOrigin="anonymous"
        />
      )}

      <div className="space-y-4">
        <div className="text-sm text-gray-600">
          {isLoading ? "Loading audio..." : currentChunk?.title || "No chapter selected"}
        </div>

        <Slider
          value={[currentTime]}
          max={duration || 100}
          step={0.1}
          onValueChange={handleSeek}
          disabled={isLoading || !!error}
          className="w-full"
        />

        <div className="flex justify-between text-xs text-gray-600">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => skipChunk("prev")}
            className="border-black-text"
            disabled={isLoading}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            onClick={togglePlay}
            className="h-12 w-12 border-2 border-black-text"
            disabled={isLoading || !!error}
          >
            {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => skipChunk("next")}
            className="border-black-text"
            disabled={isLoading}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
