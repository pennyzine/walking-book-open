import { cp, mkdir } from "node:fs/promises"
import path from "node:path"

/**
 * Copies Moonshine + ONNX Runtime assets into /public so they can be served from
 * the app's own origin (no runtime CDN JS dependency).
 *
 * This runs in `postinstall` so Vercel/CI builds always have the assets.
 */
async function main() {
  const projectRoot = process.cwd()

  const moonshineSrc = path.join(projectRoot, "node_modules", "@moonshine-ai", "moonshine-js", "dist")
  const ortSrc = path.join(projectRoot, "node_modules", "onnxruntime-web", "dist")

  const moonshineDest = path.join(projectRoot, "public", "vendor", "moonshine")
  const ortDest = path.join(projectRoot, "public", "vendor", "onnxruntime-web", "dist")

  await mkdir(moonshineDest, { recursive: true })
  await mkdir(ortDest, { recursive: true })

  // Moonshine ESM bundle + bundled default model files.
  await cp(path.join(moonshineSrc, "moonshine.min.js"), path.join(moonshineDest, "moonshine.min.js"))
  await cp(path.join(moonshineSrc, "model"), path.join(moonshineDest, "model"), { recursive: true })

  // ONNX Runtime Web WASM + JS shims (Moonshine points ort.env.wasm.wasmPaths here).
  await cp(ortSrc, ortDest, { recursive: true })
}

main().catch((err) => {
  console.error("[copy-moonshine-assets] failed:", err)
  process.exitCode = 1
})

