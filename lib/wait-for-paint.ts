/**
 * Yield long enough for the browser to paint React state updates.
 *
 * `requestAnimationFrame` callbacks run *before* a paint. Waiting for a single rAF
 * does not guarantee the user sees updated UI if heavy work starts immediately after.
 * Waiting for two rAFs ensures there is at least one paint between the awaits.
 */
export async function waitForPaint(frames: number = 2): Promise<void> {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame === "undefined") return
  const count = Math.max(1, Math.floor(frames))
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  }
}

