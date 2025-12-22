export type VoiceProfile = {
  voiceId: string
  label: string
  persona: string
  duration: string
}

export const VOICE_AUDIO_BASE_PATH = "/voices"

export const VOICE_ROSTER: VoiceProfile[] = [
  { voiceId: "af_alloy", label: "American Female Alloy", persona: "Velvety late-night documentary", duration: "0:12" },
  { voiceId: "af_aoede", label: "American Female Aoede", persona: "Soft indie storyteller", duration: "0:11" },
  { voiceId: "af_bella", label: "American Female Bella", persona: "Bright podcast host", duration: "0:10" },
  { voiceId: "af_jessica", label: "American Female Jessica", persona: "Gentle essayist energy", duration: "0:09" },
  { voiceId: "af_nicole", label: "American Female Nicole", persona: "Calm newsreader clarity", duration: "0:10" },
  { voiceId: "af_river", label: "American Female River", persona: "Intimate memoir pacing", duration: "0:12" },
  { voiceId: "af_sarah", label: "American Female Sarah", persona: "Upbeat teacher cadence", duration: "0:08" },
  { voiceId: "af_sky", label: "American Female Sky", persona: "Dreamy ambient poet", duration: "0:11" },
  { voiceId: "am_adam", label: "American Male Adam", persona: "Reliable documentary anchor", duration: "0:10" },
  { voiceId: "am_eric", label: "American Male Eric", persona: "Polished broadcaster", duration: "0:09" },
  { voiceId: "am_fenrir", label: "American Male Fenrir", persona: "Smoky noir narrator", duration: "0:13" },
  { voiceId: "am_michael", label: "American Male Michael", persona: "Expressive storyteller", duration: "0:11" },
  { voiceId: "am_onyx", label: "American Male Onyx", persona: "Deep cinematic rumble", duration: "0:12" },
  { voiceId: "bf_alice", label: "British Female Alice", persona: "Warm northern lilt", duration: "0:09" },
  { voiceId: "bf_emma", label: "British Female Emma", persona: "Confident stage reader", duration: "0:10" },
  { voiceId: "bf_lily", label: "British Female Lily", persona: "Delicate poetry cadence", duration: "0:08" },
  { voiceId: "bm_george", label: "British Male George", persona: "Measured BBC tone", duration: "0:11" },
  { voiceId: "bm_lewis", label: "British Male Lewis", persona: "Rich baritone presence", duration: "0:12" },
]

export function formatVoiceDisplayName(voiceId: string) {
  const [prefix, suffix] = voiceId.split("_")
  if (!prefix) return voiceId.toUpperCase()
  if (!suffix) return prefix.toUpperCase()
  return `${prefix.toUpperCase()} ${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`
}
