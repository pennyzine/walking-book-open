// Web Worker for Moonshine offline transcription.
// Runs ONNX inference off the main thread to keep the UI responsive.
//
// Note: MoonshineJS fetches model + onnxruntime WASM assets from CDN by default.
// The app's service worker is responsible for caching those URLs for offline use.
//
// IMPORTANT: We dynamically import Moonshine from CDN to avoid bundler (Turbopack)
// trying to resolve onnxruntime `.wasm` files at build time.

type MoonshineModule = {
  MoonshineModel: new (modelURL: string, precision?: string) => {
    loadModel: () => Promise<void>
    generate: (audio: Float32Array) => Promise<string | undefined>
  }
  Settings: {
    VERBOSE_LOGGING: boolean
    BASE_ASSET_PATH: Record<string, string>
  }
}

type MoonshineModelInstance = InstanceType<MoonshineModule["MoonshineModel"]>

type LoadMessage = {
  type: "load"
  requestId: number
  modelURL: string
  precision?: string
}

type WarmupMessage = {
  type: "warmup"
  requestId: number
}

type TranscribeMessage = {
  type: "transcribe"
  requestId: number
  audioBuffer: ArrayBuffer
}

type Incoming = LoadMessage | WarmupMessage | TranscribeMessage

type Outgoing =
  | { type: "loaded"; requestId: number }
  | { type: "warmed"; requestId: number }
  | { type: "result"; requestId: number; text: string }
  | { type: "error"; requestId: number; message: string }

let model: MoonshineModelInstance | null = null
let modelKey: string | null = null
let loadPromise: Promise<void> | null = null

let moonshineImportPromise: Promise<MoonshineModule> | null = null

async function getMoonshine(): Promise<MoonshineModule> {
  if (moonshineImportPromise) return moonshineImportPromise
  // Load Moonshine from our own origin (copied into /public by postinstall).
  // We still use a dynamic import with webpackIgnore to prevent bundlers from trying to bundle/transform it.
  const moonshineUrl = new URL("/vendor/moonshine/moonshine.min.js", self.location.origin).toString()
  moonshineImportPromise = import(
    /* webpackIgnore: true */
    /* @vite-ignore */
    moonshineUrl
  ) as unknown as Promise<MoonshineModule>
  return moonshineImportPromise
}

function getModelKey(modelURL: string, precision: string) {
  return `${modelURL}::${precision}`
}

async function ensureLoaded(modelURL: string, precision: string) {
  const { MoonshineModel, Settings } = await getMoonshine()

  // Self-host all runtime assets (models + onnxruntime-web wasm files) from this app's origin.
  // Moonshine treats `modelURL` as relative to Settings.BASE_ASSET_PATH.MOONSHINE.
  Settings.BASE_ASSET_PATH = {
    ...Settings.BASE_ASSET_PATH,
    MOONSHINE: new URL("/vendor/moonshine/", self.location.origin).toString(),
    ONNX_RUNTIME: new URL("/vendor/onnxruntime-web/dist/", self.location.origin).toString(),
  }

  const nextKey = getModelKey(modelURL, precision)
  if (!model || modelKey !== nextKey) {
    // Ensure we keep logs quiet in production.
    Settings.VERBOSE_LOGGING = false
    model = new MoonshineModel(modelURL, precision)
    modelKey = nextKey
    loadPromise = null
  }

  if (!loadPromise) {
    loadPromise = model.loadModel()
  }
  await loadPromise
}

function post(msg: Outgoing) {
  ;(self as unknown as { postMessage: (message: Outgoing) => void }).postMessage(msg)
}

self.onmessage = (event: MessageEvent<Incoming>) => {
  const msg = event.data
  ;(async () => {
    try {
      if (msg.type === "load") {
        await ensureLoaded(msg.modelURL, msg.precision ?? "quantized")
        post({ type: "loaded", requestId: msg.requestId })
        return
      }

      if (!model) {
        throw new Error("Moonshine model not initialized. Call load first.")
      }

      if (msg.type === "warmup") {
        // 1 second of silence at 16kHz. This forces the first inference path.
        const silence = new Float32Array(16_000)
        await model.generate(silence)
        post({ type: "warmed", requestId: msg.requestId })
        return
      }

      if (msg.type === "transcribe") {
        const audio = new Float32Array(msg.audioBuffer)
        const text = (await model.generate(audio)) ?? ""
        post({ type: "result", requestId: msg.requestId, text })
        return
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      post({ type: "error", requestId: msg.requestId, message })
    }
  })()
}

