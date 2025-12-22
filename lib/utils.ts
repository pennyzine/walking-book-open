import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function hexToRgba(hex: string, alpha = 1): string {
  const sanitized = hex.replace("#", "")
  if (![3, 6].includes(sanitized.length)) {
    // House Black fallback (avoid pure black)
    return `rgba(35, 31, 32, ${alpha})`
  }

  const fullHex = sanitized.length === 3 ? sanitized.split("").map((c) => c + c).join("") : sanitized
  const bigint = Number.parseInt(fullHex, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function getReadableTextColor(hex: string): string {
  const sanitized = hex.replace("#", "")
  if (![3, 6].includes(sanitized.length)) {
    // House Black fallback (avoid pure black)
    return "#231F20"
  }
  const fullHex = sanitized.length === 3 ? sanitized.split("").map((c) => c + c).join("") : sanitized
  const bigint = Number.parseInt(fullHex, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? "#1F1F1F" : "#FFFFFF"
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const sanitized = hex.replace("#", "")
  if (![3, 6].includes(sanitized.length)) return null
  const fullHex = sanitized.length === 3 ? sanitized.split("").map((c) => c + c).join("") : sanitized
  const bigint = Number.parseInt(fullHex, 16)
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  }
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * Mix two hex colors by weight.
 * `weight` is how much of `foreground` to keep (0..1). 0 = background, 1 = foreground.
 */
export function mixHexColors(foreground: string, background: string, weight = 0.5): string {
  const fg = hexToRgb(foreground)
  const bg = hexToRgb(background)
  if (!fg || !bg) return foreground
  const w = Math.max(0, Math.min(1, weight))
  const r = clampChannel(fg.r * w + bg.r * (1 - w))
  const g = clampChannel(fg.g * w + bg.g * (1 - w))
  const b = clampChannel(fg.b * w + bg.b * (1 - w))
  return `rgb(${r}, ${g}, ${b})`
}
