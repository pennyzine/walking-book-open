import fs from "node:fs"
import path from "node:path"

function pngDimensions(buf) {
  const sig = buf.subarray(0, 8)
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!sig.equals(pngSig)) throw new Error("Not a PNG file")
  const ihdrType = buf.subarray(12, 16).toString("ascii")
  if (ihdrType !== "IHDR") throw new Error("PNG missing IHDR")
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  return { width: w, height: h }
}

function buildIcoFromPngs(pngs) {
  // ICO can embed PNG images directly. We pack multiple PNG blobs into one .ico.
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(count, 4)

  const entries = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const payloads = []

  pngs.forEach(({ buf, width, height }, i) => {
    const eOff = i * 16
    entries.writeUInt8(width >= 256 ? 0 : width, eOff + 0) // 0 means 256
    entries.writeUInt8(height >= 256 ? 0 : height, eOff + 1)
    entries.writeUInt8(0, eOff + 2) // palette colors
    entries.writeUInt8(0, eOff + 3) // reserved
    entries.writeUInt16LE(1, eOff + 4) // color planes
    entries.writeUInt16LE(32, eOff + 6) // bits per pixel (informational for PNG)
    entries.writeUInt32LE(buf.length, eOff + 8)
    entries.writeUInt32LE(offset, eOff + 12)

    payloads.push(buf)
    offset += buf.length
  })

  return Buffer.concat([header, entries, ...payloads])
}

function main() {
  const repoRoot = process.cwd()
  const pub = path.join(repoRoot, "public")

  const inputs = [
    path.join(pub, "icon-16.png"),
    path.join(pub, "icon-32.png"),
    path.join(pub, "icon-48.png"),
  ]

  const pngs = inputs.map((p) => {
    const buf = fs.readFileSync(p)
    const { width, height } = pngDimensions(buf)
    return { path: p, buf, width, height }
  })

  const expected = new Map([
    ["icon-16.png", 16],
    ["icon-32.png", 32],
    ["icon-48.png", 48],
  ])
  for (const p of pngs) {
    const base = path.basename(p.path)
    const exp = expected.get(base)
    if (!exp || p.width !== exp || p.height !== exp) {
      throw new Error(`Expected ${base} to be ${exp}x${exp}, got ${p.width}x${p.height}`)
    }
  }

  // Smallest first is conventional.
  pngs.sort((a, b) => a.width - b.width)
  const ico = buildIcoFromPngs(pngs)
  const outPath = path.join(pub, "favicon.ico")
  fs.writeFileSync(outPath, ico)
  process.stdout.write(`Wrote ${path.relative(repoRoot, outPath)} with ${pngs.length} images\\n`)
}

main()
