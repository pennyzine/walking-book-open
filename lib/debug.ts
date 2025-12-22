// Lightweight debug logging for the public, privacy-first build.
//
// Enable in the browser by setting:
//   localStorage.setItem("walkingbook-debug", "1")
//
// This avoids noisy console output for normal users while keeping an escape hatch
// for support and OSS debugging.

const DEBUG_KEY = "walkingbook-debug"

function isDebugEnabled() {
  if (typeof window === "undefined") {
    return process.env.NODE_ENV !== "production"
  }
  try {
    return window.localStorage.getItem(DEBUG_KEY) === "1"
  } catch {
    return false
  }
}

export function debugLog(...args: unknown[]) {
  if (!isDebugEnabled()) return
  console.log(...args)
}

