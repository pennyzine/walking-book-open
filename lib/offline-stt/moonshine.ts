// Browser-only Moonshine STT helper backed by a Web Worker.
// This keeps ONNX inference off the main thread for a smooth UI.

const DEFAULT_MODEL_URL = "model/tiny"
const DEFAULT_PRECISION = "quantized"
const TARGET_SAMPLE_RATE = 16000

type WorkerOutgoing =
  | { type: "loaded"; requestId: number }
  | { type: "warmed"; requestId: number }
  | { type: "result"; requestId: number; text: string }
  | { type: "error"; requestId: number; message: string }

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

let worker: Worker | null = null
let nextRequestId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL("./moonshine-worker.ts", import.meta.url), { type: "module" })
  w.onmessage = (event: MessageEvent<WorkerOutgoing>) => {
    const msg = event.data
    const entry = pending.get(msg.requestId)
    if (!entry) return
    pending.delete(msg.requestId)
    if (msg.type === "error") {
      entry.reject(new Error(msg.message))
      return
    }
    if (msg.type === "result") {
      entry.resolve(msg.text)
      return
    }
    entry.resolve(true)
  }
  worker = w
  return w
}

function callWorker(message: Record<string, unknown>, transfer?: Transferable[]) {
  const requestId = nextRequestId++
  const w = getWorker()
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    w.postMessage({ ...message, requestId }, transfer ?? [])
  })
}

export async function ensureMoonshineReady(options?: { modelURL?: string; precision?: string }) {
  const modelURL = options?.modelURL ?? DEFAULT_MODEL_URL
  const precision = options?.precision ?? DEFAULT_PRECISION

  await callWorker({ type: "load", modelURL, precision })
  // Warmup helps ensure the first interactive transcription doesn't feel "stuck".
  await callWorker({ type: "warmup" })
}

export async function transcribeWithMoonshineFromBlob(
  blob: Blob,
  options?: { modelURL?: string; precision?: string },
): Promise<string> {
  const modelURL = options?.modelURL ?? DEFAULT_MODEL_URL
  const precision = options?.precision ?? DEFAULT_PRECISION

  const audio = await decodeAudioBlobTo16kMono(blob)
  await callWorker({ type: "load", modelURL, precision })
  const text = (await callWorker({ type: "transcribe", audioBuffer: audio.buffer }, [audio.buffer])) as string
  return text
}

async function decodeAudioBlobTo16kMono(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
    OfflineAudioContext?: typeof OfflineAudioContext
    webkitOfflineAudioContext?: typeof OfflineAudioContext
  }
  const AudioContextCtor = w.AudioContext ?? w.webkitAudioContext
  if (!AudioContextCtor) {
    throw new Error("AudioContext is not supported in this browser.")
  }

  const audioContext: AudioContext = new AudioContextCtor()
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0))

    if (decoded.numberOfChannels === 1 && decoded.sampleRate === TARGET_SAMPLE_RATE) {
      return decoded.getChannelData(0)
    }

    // Resample + downmix to mono using OfflineAudioContext for consistent 16kHz input.
    const duration = decoded.duration
    const frameCount = Math.max(1, Math.ceil(duration * TARGET_SAMPLE_RATE))
    const offlineCtor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext
    if (!offlineCtor) {
      // Fallback: take channel 0 without resampling (reduced accuracy but avoids total failure).
      return decoded.getChannelData(0)
    }

    const offline: OfflineAudioContext = new offlineCtor(1, frameCount, TARGET_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start(0)

    const rendered = await offline.startRendering()
    return rendered.getChannelData(0)
  } finally {
    try {
      await audioContext.close()
    } catch {
      // ignore
    }
  }
}

