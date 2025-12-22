import JSZip from "jszip"
import type { WalkingBookMetadata, ManifestData, StoredAudiobook, SessionData } from "@/types/audiobook"
import { saveAudiobook, saveAudioFile, saveSession } from "./db"
import { debugLog } from "@/lib/debug"

export async function loadWalkingBookZip(file: File): Promise<string> {
  debugLog("[v0] loadWalkingBookZip started")
  const zip = await JSZip.loadAsync(file)
  debugLog("[v0] Zip loaded")

  // Extract metadata
  const metadataFile = zip.file("metadata.json")
  if (!metadataFile) throw new Error("Invalid walkingbook file: missing metadata.json")
  const metadata: WalkingBookMetadata = JSON.parse(await metadataFile.async("text"))
  debugLog("[v0] Metadata extracted", metadata.title)

  // Extract manifest
  const manifestFile = zip.file("manifest.json")
  if (!manifestFile) throw new Error("Invalid walkingbook file: missing manifest.json")
  const manifest: ManifestData = JSON.parse(await manifestFile.async("text"))
  debugLog("[v0] Manifest extracted", manifest.chunks.length, "chunks")

  // Extract version history
  const versionHistory = new Map<string, string>()
  const versionFolder = zip.folder("version_history")
  if (versionFolder) {
    const versionFiles = Object.keys(zip.files).filter((name) => name.startsWith("version_history/"))
    for (const fileName of versionFiles) {
      const file = zip.file(fileName)
      if (file) {
        const content = await file.async("text")
        const version = fileName.replace("version_history/", "").replace(".txt", "")
        versionHistory.set(version, content)
      }
    }
  }

  // Generate unique ID
  const audiobookId = `${metadata.title}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "_")

  // Extract audio files
  debugLog("[v0] Processing audio files...")
  for (const chunk of manifest.chunks) {
    const audioFile = zip.file(chunk.audio_file)
    if (audioFile) {
      debugLog(`[v0] Found audio file in ZIP: ${chunk.audio_file}`)
      const arrayBuffer = await audioFile.async("arraybuffer")
      const mimeType = getMimeType(chunk.audio_file)
      debugLog(
        `[v0] Extracted ${chunk.audio_file}: arrayBuffer size=${arrayBuffer.byteLength}, will use type=${mimeType}`,
      )

      if (arrayBuffer.byteLength === 0) {
        console.warn(`WARNING: ${chunk.audio_file} has 0 bytes, skipping`)
        continue
      }

      const typedBlob = new Blob([arrayBuffer], { type: mimeType })
      debugLog(`[v0] Created blob: size=${typedBlob.size}, type=${typedBlob.type}`)

      await saveAudioFile(audiobookId, chunk.audio_file, typedBlob)
      debugLog(`[v0] Saved ${chunk.audio_file} to IndexedDB`)
    } else {
      console.warn(`[v0] Missing audio file in ZIP: ${chunk.audio_file}`)
    }
  }
  debugLog("[v0] All audio files processed")

  let initialSession: SessionData
  const sessionFile = zip.file("session.json")
  if (sessionFile) {
    debugLog("[v0] Found session.json in ZIP, loading previous session")
    initialSession = JSON.parse(await sessionFile.async("text"))
    // Ensure all required fields exist
    initialSession.textScrollPosition = initialSession.textScrollPosition || 0
    debugLog("[v0] Loaded session with", initialSession.edits?.length || 0, "edits")

    // Restore edit audio blobs from the edits folder
    if (initialSession.edits && initialSession.edits.length > 0) {
      debugLog("[v0] Restoring edit audio blobs...")
      for (const edit of initialSession.edits) {
        const editAudioFile = zip.file(`edits/edit_${edit.id}.webm`)
        if (editAudioFile) {
          const arrayBuffer = await editAudioFile.async("arraybuffer")
          edit.audioBlob = new Blob([arrayBuffer], { type: "audio/webm" })
          debugLog(`[v0] Restored audio blob for edit ${edit.id}`)
        } else {
          console.warn(`[v0] No audio file found for edit ${edit.id}`)
        }
      }
    }
  } else {
    debugLog("[v0] No session.json found, creating new session")
    initialSession = {
      userName: "",
      currentChunkId: manifest.chunks[0]?.chunk_id || "",
      currentTime: 0,
      lastUpdated: new Date().toISOString(),
      edits: [],
      textScrollPosition: 0,
    }
  }

  // Save to IndexedDB
  const storedAudiobook: StoredAudiobook = {
    id: audiobookId,
    metadata,
    manifest,
    audioFiles: new Map(),
    versionHistory,
    session: initialSession,
    uploadedAt: new Date().toISOString(),
  }

  debugLog("[v0] Saving audiobook to DB...")
  await saveAudiobook(storedAudiobook)
  await saveSession(audiobookId, initialSession)
  debugLog("[v0] Saved to DB")

  return audiobookId
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext === "mp3") return "audio/mpeg"
  if (ext === "wav") return "audio/wav"
  if (ext === "m4a") return "audio/mp4"
  if (ext === "ogg") return "audio/ogg"
  if (ext === "aac") return "audio/aac"
  return "application/octet-stream"
}
