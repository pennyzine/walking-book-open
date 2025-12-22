"use client"

import { Pause, Play } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { formatVoiceDisplayName, VOICE_AUDIO_BASE_PATH, type VoiceProfile } from "@/lib/voices"

type VoiceCardProps = {
  voice: VoiceProfile
  index: number
  isActive: boolean
  setActiveVoiceId: Dispatch<SetStateAction<string | null>>
}

export function VoiceCard({ voice, index, isActive, setActiveVoiceId }: VoiceCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const displayNumber = `#${String(index + 1).padStart(2, "0")}`
  const voiceDisplayName = formatVoiceDisplayName(voice.voiceId)

  const handleToggle = () => {
    setActiveVoiceId((current) => (current === voice.voiceId ? null : voice.voiceId))
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isActive) {
      audio.currentTime = 0
      const playPromise = audio.play()
      if (playPromise !== undefined) {
        playPromise.catch(() => setActiveVoiceId(null))
      }
    } else {
      audio.pause()
      audio.currentTime = 0
    }
  }, [isActive, setActiveVoiceId])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const handleEnded = () => setActiveVoiceId((current) => (current === voice.voiceId ? null : current))
    audio.addEventListener("ended", handleEnded)
    return () => audio.removeEventListener("ended", handleEnded)
  }, [setActiveVoiceId, voice.voiceId])

  return (
    <div className="flex flex-col gap-4 border-2 border-black-text bg-white-text p-4 rounded-2xl shadow-[6px_6px_0_0_rgba(35,31,32,0.12)]">
      <div className="flex items-center justify-between text-black-text">
        <span className="text-xs font-mono uppercase tracking-[0.4em] text-black-text/60">{displayNumber}</span>
        <Button
          type="button"
          onClick={handleToggle}
          aria-pressed={isActive}
          aria-label={`${isActive ? "Pause" : "Play"} ${voiceDisplayName}`}
          variant={isActive ? "houseSecondary" : "house"}
          size="sm"
          className="uppercase tracking-[0.25em] text-xs font-semibold"
        >
          {isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {isActive ? "Pause" : "Play"}
        </Button>
      </div>

      <h3 className="text-xl font-semibold text-black-text">{voiceDisplayName}</h3>

      <audio
        ref={audioRef}
        src={`${VOICE_AUDIO_BASE_PATH}/${voice.voiceId}.mp3`}
        preload="none"
        className="hidden"
        aria-hidden="true"
      />
    </div>
  )
}
