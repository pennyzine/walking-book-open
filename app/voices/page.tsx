"use client"

import { useState } from "react"
import { Cloud } from "lucide-react"

import { InfoPageTemplate } from "@/components/info-page-template"
import { Button } from "@/components/ui/button"
import { VoiceCard } from "@/components/voice-card"
import { COLAB_RECORDER_NOTEBOOK_URL } from "@/lib/constants"
import { VOICE_ROSTER } from "@/lib/voices"

const VOICE_PARAGRAPHS = [
  "Choose from 18 different voices that cover all kinds of writing: rom-com, literary, mystery, one is even old English gentleman (not really a writing style). They really do sound like someone reading aloud.",
  "When you're ready to record, jump into the hosted Colab notebook to make your tape, then come back here to take a journey with Walking Book!",
]

export default function VoicesPage() {
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null)

  return (
    <InfoPageTemplate
      eyebrow="Voice Lab"
      metaLabel="Kokoro TTS"
      title="Tap a voice card to listen"
      paragraphs={VOICE_PARAGRAPHS}
      accentWord="Voices"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black-text/10 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-black-text/60">Roster</p>
            <p className="text-base text-black-text/80">Tap a persona to cue a preview.</p>
          </div>
          <Button asChild variant="houseSecondary" className="rounded-full uppercase tracking-[0.35em] text-xs font-semibold">
            <a href={COLAB_RECORDER_NOTEBOOK_URL} target="_blank" rel="noreferrer">
              <Cloud className="h-4 w-4" />
              Launch notebook
            </a>
          </Button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {VOICE_ROSTER.map((voice, index) => (
            <VoiceCard
              key={voice.voiceId}
              voice={voice}
              index={index}
              isActive={activeVoiceId === voice.voiceId}
              setActiveVoiceId={setActiveVoiceId}
            />
          ))}
        </div>
      </div>
    </InfoPageTemplate>
  )
}
