import { openDB, type DBSchema } from "idb"
import type { StoredAudiobook, SessionData } from "@/types/audiobook"
import { debugLog } from "@/lib/debug"

type StoredAudiobookInDb = Omit<StoredAudiobook, "audioFiles" | "versionHistory"> & {
  // Serialized versions of Maps (Maps can't be stored directly in IndexedDB values).
  audioFiles: Record<string, unknown>
  versionHistory: Record<string, string>
}

interface AudiobookDB extends DBSchema {
  audiobooks: {
    key: string
    value: StoredAudiobookInDb
  }
  audioFiles: {
    key: [string, string]
    value: {
      audiobookId: string
      fileName: string
      arrayBuffer: ArrayBuffer
      mimeType: string
    }
    indexes: {
      audiobookId: string
    }
  }
  sessions: {
    key: string
    value: SessionData & { audiobookId: string }
  }
}

async function getDB() {
  return await openDB<AudiobookDB>("audiobook-editor", 3, {
    upgrade(db, oldVersion, newVersion, transaction) {
      // Audiobooks store
      if (!db.objectStoreNames.contains("audiobooks")) {
        db.createObjectStore("audiobooks", { keyPath: "id" })
      }

      // Audio files store
      if (db.objectStoreNames.contains("audioFiles")) {
        db.deleteObjectStore("audioFiles")
      }

      const audioStore = db.createObjectStore("audioFiles", { keyPath: ["audiobookId", "fileName"] })
      audioStore.createIndex("audiobookId", "audiobookId")

      // Sessions store
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "audiobookId" })
      }
    },
  })
}

export async function saveAudiobook(audiobook: StoredAudiobook) {
  const db = await getDB()

  // Convert Maps to plain objects for IndexedDB storage.
  // Audio blobs are stored in the separate `audioFiles` store, so `audioFiles` is informational only.
  const serialized: StoredAudiobookInDb = {
    ...audiobook,
    versionHistory: audiobook.versionHistory instanceof Map
      ? Object.fromEntries(audiobook.versionHistory)
      : (audiobook.versionHistory as unknown as Record<string, string>),
    audioFiles: audiobook.audioFiles instanceof Map
      ? Object.fromEntries(audiobook.audioFiles)
      : (audiobook.audioFiles as unknown as Record<string, unknown>),
  }

  await db.put("audiobooks", serialized)
}

function reviveAudiobookMaps(audiobook: StoredAudiobookInDb): StoredAudiobook {
  return {
    ...audiobook,
    versionHistory:
      audiobook.versionHistory instanceof Map
        ? audiobook.versionHistory
        : new Map(
            Object.entries(audiobook.versionHistory || {}).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
    audioFiles:
      // Audio is stored in the `audioFiles` object store; keep this map empty.
      new Map<string, Blob>(),
  }
}

function stripSessionRecord(record?: (SessionData & { audiobookId: string }) | undefined): SessionData | undefined {
  if (!record) return undefined
  const { audiobookId: _ignored, ...session } = record
  return session as SessionData
}

export async function getAudiobook(id: string): Promise<StoredAudiobook | undefined> {
  const db = await getDB()
  const audiobook = await db.get("audiobooks", id)

  if (!audiobook) return undefined

  const revived = reviveAudiobookMaps(audiobook)
  const savedSession = stripSessionRecord(await db.get("sessions", id))

  return {
    ...revived,
    session: savedSession ?? revived.session,
  }
}

export async function getAllAudiobooks(): Promise<StoredAudiobook[]> {
  const db = await getDB()
  const audiobooks = await db.getAll("audiobooks")

  return await Promise.all(
    audiobooks.map(async (audiobook) => {
      const revived = reviveAudiobookMaps(audiobook)
      const savedSession = stripSessionRecord(await db.get("sessions", audiobook.id))
      return {
        ...revived,
        session: savedSession ?? revived.session,
      }
    }),
  )
}

export async function deleteAudiobook(id: string) {
  const db = await getDB()
  await db.delete("audiobooks", id)

  // Delete associated audio files
  const audioFiles = await db.getAllFromIndex("audioFiles", "audiobookId", id)
  for (const file of audioFiles) {
    // @ts-ignore
    await db.delete("audioFiles", [id, file.fileName])
  }

  // Delete session
  await db.delete("sessions", id)
}

export async function saveAudioFile(audiobookId: string, fileName: string, blob: Blob) {
  const db = await getDB()
  debugLog(`[v0] Saving audio file: ${fileName}, size: ${blob.size}, type: ${blob.type}`)
  const arrayBuffer = await blob.arrayBuffer()
  await db.put("audioFiles", {
    audiobookId,
    fileName,
    arrayBuffer,
    mimeType: blob.type,
  })
  debugLog(`[v0] Audio file saved successfully`)
}

export async function getAudioFile(audiobookId: string, fileName: string) {
  const db = await getDB()
  debugLog(`[v0] Retrieving audio file: ${fileName} for audiobook: ${audiobookId}`)
  const result = await db.get("audioFiles", [audiobookId, fileName])
  if (result) {
    debugLog(`[v0] Audio file retrieved: size=${result.arrayBuffer.byteLength}, type=${result.mimeType}`)
  } else {
    debugLog(`[v0] Audio file NOT FOUND in DB`)
  }
  return result ? new Blob([result.arrayBuffer], { type: result.mimeType }) : undefined
}

export async function saveSession(audiobookId: string, session: SessionData) {
  const db = await getDB()
  await db.put("sessions", { ...session, audiobookId })
}

export async function getSession(audiobookId: string): Promise<SessionData | undefined> {
  const db = await getDB()
  const result = await db.get("sessions", audiobookId)
  if (!result) return undefined
  const { audiobookId: _, ...session } = result
  return session as SessionData
}

export async function clearAllData() {
  const db = await getDB()

  // Clear all audiobooks
  await db.clear("audiobooks")

  // Clear all audio files
  await db.clear("audioFiles")

  // Clear all sessions
  await db.clear("sessions")

  debugLog("[v0] All data cleared from IndexedDB")
}
