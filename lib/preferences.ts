import { getReadableTextColor, hexToRgba } from "@/lib/utils"

export const ENV_STORAGE_KEY = "walkingbook-environment"
const LEGACY_NAME_KEY = "walkingbook-username"
export const ENV_CHANGE_EVENT = "walkingbook-env-change"

const READER_FONT_IDS = ["serif", "sans", "dyslexic"] as const
export type ReaderFontChoice = (typeof READER_FONT_IDS)[number]

const SPEECH_ENGINE_IDS = ["web-speech", "moonshine"] as const
export type SpeechEngineChoice = (typeof SPEECH_ENGINE_IDS)[number]

export interface ReaderFontOption {
  id: ReaderFontChoice
  label: string
  description: string
  stack: string
}

export interface ReaderEnvironmentSettings {
  userName: string
  backgroundColor: string
  highlightColor: string
  accentColor: string
  fontFamily: ReaderFontChoice
  // Which speech-to-text engine to use for the Voice Editor.
  // Moonshine is only selectable when the offline Moonshine model has been downloaded.
  speechEngine: SpeechEngineChoice
}

interface ColorSwatch {
  label: string
  value: string
}

// House colors (avoid pure black/white)
export const HOUSE_BLACK = "#231F20"
export const HOUSE_WHITE = "#F6F8EF"

export const RISOGRAPH_BACKGROUND_SWATCHES: ColorSwatch[] = [
  { label: "House White", value: HOUSE_WHITE },
  { label: "House Black", value: HOUSE_BLACK },
  { label: "Fog Gray", value: "#F2F1EC" },
  { label: "Mint Wash", value: "#DEFAE7" },
  { label: "Cream Paper", value: "#FFF5D9" },
  { label: "Rose Dust", value: "#FFE4EC" },
  { label: "Sky Stencil", value: "#E3F4FF" },
]

export const RISOGRAPH_HIGHLIGHT_SWATCHES: ColorSwatch[] = [
  { label: "Neon Fern", value: "#C1F27F" },
  { label: "Lemon Frost", value: "#FFF898" },
  { label: "Pink Bloom", value: "#FFBCF8" },
  { label: "Seafoam Wink", value: "#76F1B3" },
  { label: "Rose Milk", value: "#FFE4E3" },
  { label: "Peach Taffy", value: "#FFAD89" },
  { label: "Glacial Mint", value: "#1EFFE4" },
]

export const RISOGRAPH_ACCENT_SWATCHES: ColorSwatch[] = [
  { label: "Sage Bright", value: "#C3CD92" },
  { label: "Pink Bloom", value: "#FFBCF8" },
  { label: "Blueprint", value: "#3478ED" },
  { label: "Coral Signal", value: "#FA8888" },
  { label: "Soft Violet", value: "#8283FD" },
  { label: "Sunbleached", value: "#F5FFC9" },
  { label: "Lagoon", value: "#24B0C1" },
]

export const READER_FONT_OPTIONS: ReaderFontOption[] = [
  {
    id: "serif",
    label: "Serif",
    description: "Bookish Shippori Mincho body copy",
    stack: '"Shippori Mincho B1", "Times New Roman", serif',
  },
  {
    id: "sans",
    label: "Sans Serif",
    description: "Roboto",
    stack: '"Roboto", "system-ui", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    id: "dyslexic",
    label: "Open Dyslexic",
    description: "Heavier bottoms to guide reading",
    stack: '"OpenDyslexic", "Atkinson Hyperlegible", sans-serif',
  },
]

const FONT_STACK_LOOKUP: Record<ReaderFontChoice, string> = READER_FONT_OPTIONS.reduce(
  (acc, option) => {
    acc[option.id] = option.stack
    return acc
  },
  {} as Record<ReaderFontChoice, string>,
)

export function getReaderFontStack(choice: ReaderFontChoice) {
  return FONT_STACK_LOOKUP[choice] ?? FONT_STACK_LOOKUP.serif
}

export const DEFAULT_ENVIRONMENT: ReaderEnvironmentSettings = {
  userName: "",
  backgroundColor: "#F2F1EC", // Fog Gray
  highlightColor: "#FFAD89", // Peach Taffy
  accentColor: "#C3CD92", // Sage Bright
  fontFamily: "sans",
  speechEngine: "web-speech",
}

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined"
}

function isDocumentAvailable() {
  return typeof document !== "undefined"
}

function normalizeHex(value: string, fallback: string) {
  return /^#([0-9a-fA-F]{6})$/.test(value) ? value : fallback
}

function isValidFontChoice(value: unknown): value is ReaderFontChoice {
  return typeof value === "string" && (READER_FONT_IDS as readonly string[]).includes(value)
}

function isValidSpeechEngine(value: unknown): value is SpeechEngineChoice {
  return typeof value === "string" && (SPEECH_ENGINE_IDS as readonly string[]).includes(value)
}

export function loadEnvironment(): ReaderEnvironmentSettings {
  if (!isBrowser()) return DEFAULT_ENVIRONMENT

  try {
    const stored = localStorage.getItem(ENV_STORAGE_KEY)
    if (!stored) {
      const legacyName = localStorage.getItem(LEGACY_NAME_KEY) || ""
      const defaults = { ...DEFAULT_ENVIRONMENT, userName: legacyName }
      return defaults
    }

    const parsed = JSON.parse(stored) as Partial<ReaderEnvironmentSettings>
    return {
      userName: parsed.userName ?? "",
      backgroundColor: normalizeHex(parsed.backgroundColor ?? "", DEFAULT_ENVIRONMENT.backgroundColor),
      highlightColor: normalizeHex(
        // Support legacy `textColor` values while introducing highlight palettes
        (parsed as any).highlightColor ?? (parsed as any).textColor ?? "",
        DEFAULT_ENVIRONMENT.highlightColor,
      ),
      accentColor: normalizeHex(parsed.accentColor ?? "", DEFAULT_ENVIRONMENT.accentColor),
      fontFamily: isValidFontChoice(parsed.fontFamily) ? parsed.fontFamily : DEFAULT_ENVIRONMENT.fontFamily,
      speechEngine: isValidSpeechEngine((parsed as any).speechEngine)
        ? ((parsed as any).speechEngine as SpeechEngineChoice)
        : DEFAULT_ENVIRONMENT.speechEngine,
    }
  } catch (error) {
    console.warn("Failed to parse environment settings, using defaults", error)
    return DEFAULT_ENVIRONMENT
  }
}

export function applyEnvironment(settings: ReaderEnvironmentSettings) {
  if (!isDocumentAvailable()) return

  const root = document.documentElement
  root.style.setProperty("--reader-bg", settings.backgroundColor)
  root.style.setProperty("--reader-highlight", settings.highlightColor)
  const readable = getReadableTextColor(settings.backgroundColor)
  root.style.setProperty("--reader-text", readable === "#FFFFFF" ? HOUSE_WHITE : HOUSE_BLACK)
  root.style.setProperty("--reader-accent", settings.accentColor)
  root.style.setProperty("--reader-accent-soft", hexToRgba(settings.accentColor, 0.18))
  root.style.setProperty("--reader-font-family", getReaderFontStack(settings.fontFamily))
}

export function saveEnvironment(settings: ReaderEnvironmentSettings): ReaderEnvironmentSettings {
  if (!isBrowser()) return settings
  const next = {
    ...settings,
    backgroundColor: normalizeHex(settings.backgroundColor, DEFAULT_ENVIRONMENT.backgroundColor),
    highlightColor: normalizeHex(settings.highlightColor, DEFAULT_ENVIRONMENT.highlightColor),
    accentColor: normalizeHex(settings.accentColor, DEFAULT_ENVIRONMENT.accentColor),
    fontFamily: isValidFontChoice(settings.fontFamily) ? settings.fontFamily : DEFAULT_ENVIRONMENT.fontFamily,
    speechEngine: isValidSpeechEngine((settings as any).speechEngine)
      ? ((settings as any).speechEngine as SpeechEngineChoice)
      : DEFAULT_ENVIRONMENT.speechEngine,
  }

  localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem(LEGACY_NAME_KEY, next.userName ?? "")
  applyEnvironment(next)

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ReaderEnvironmentSettings>(ENV_CHANGE_EVENT, { detail: next }))
  }

  return next
}

export function clearEnvironmentPreferences() {
  if (!isBrowser()) return
  localStorage.removeItem(ENV_STORAGE_KEY)
  localStorage.removeItem(LEGACY_NAME_KEY)
  applyEnvironment(DEFAULT_ENVIRONMENT)

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ReaderEnvironmentSettings>(ENV_CHANGE_EVENT, { detail: DEFAULT_ENVIRONMENT }),
    )
  }
}
