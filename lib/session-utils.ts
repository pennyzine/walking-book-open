import type { ChunkData, SessionData, VoiceEdit } from "@/types/audiobook"
import { VALID_EDIT_TYPES } from "@/lib/edit-utils"

export function clampNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min
  }
  return Math.min(Math.max(value, min), max)
}

export function sanitizeEdits(edits: VoiceEdit[] | undefined, chunks: ChunkData[]): VoiceEdit[] {
  if (!Array.isArray(edits) || edits.length === 0) {
    return []
  }

  const fallbackChunkId = chunks[0]?.chunk_id || ""
  const maxChunkIndex = Math.max(chunks.length - 1, 0)

  return edits.map((rawEdit, index) => {
    let chunkIndex = typeof rawEdit.chunkIndex === "number" && rawEdit.chunkIndex >= 0 ? rawEdit.chunkIndex : -1

    if (chunkIndex < 0 && typeof rawEdit.chunkId === "string") {
      chunkIndex = chunks.findIndex((chunk) => chunk.chunk_id === rawEdit.chunkId)
    }

    if (chunkIndex < 0) {
      chunkIndex = 0
    }

    chunkIndex = clampNumber(chunkIndex, 0, maxChunkIndex)
    const chunk = chunks[chunkIndex]
    const segmentCount = chunk?.timestamps.length ?? 1
    const maxSegmentIndex = Math.max(segmentCount - 1, 0)

    const segmentIndex = clampNumber(rawEdit.segmentIndex, 0, maxSegmentIndex)

    const editType =
      typeof rawEdit.editType === "string" && VALID_EDIT_TYPES.includes(rawEdit.editType) ? rawEdit.editType : "last-line"

    const timestamp = typeof rawEdit.timestamp === "number" ? rawEdit.timestamp : Date.now()
    const transcription = typeof rawEdit.transcription === "string" ? rawEdit.transcription : ""
    const createdAt =
      typeof rawEdit.createdAt === "string" && rawEdit.createdAt.length > 0
        ? rawEdit.createdAt
        : new Date(timestamp).toISOString()

    const audioBlob =
      typeof Blob !== "undefined" && rawEdit.audioBlob instanceof Blob ? rawEdit.audioBlob : undefined

    return {
      id: typeof rawEdit.id === "string" && rawEdit.id.length > 0 ? rawEdit.id : `imported-edit-${Date.now()}-${index}`,
      timestamp,
      chunkId: chunk?.chunk_id || rawEdit.chunkId || fallbackChunkId,
      chunkIndex,
      segmentIndex,
      editType,
      transcription,
      createdAt,
      ...(audioBlob ? { audioBlob } : {}),
    }
  })
}

export function sanitizeSessionData(session: SessionData, chunks: ChunkData[]): SessionData {
  const safeChunks = chunks ?? []
  const fallbackChunkId = safeChunks[0]?.chunk_id || ""

  const sanitized: SessionData = {
    ...session,
    userName: typeof session.userName === "string" ? session.userName : "",
    currentChunkId: session.currentChunkId || fallbackChunkId,
    currentAudioFile: typeof session.currentAudioFile === "string" ? session.currentAudioFile : undefined,
    currentTime: clampNumber(session.currentTime, 0, Number.MAX_SAFE_INTEGER),
    textScrollPosition: clampNumber(session.textScrollPosition ?? 0, 0, 100),
    edits: sanitizeEdits(session.edits, safeChunks),
  }

  if (typeof sanitized.cursorPosition !== "number") {
    delete sanitized.cursorPosition
  }

  if (typeof sanitized.lastUpdated !== "string" || sanitized.lastUpdated.length === 0) {
    sanitized.lastUpdated = new Date().toISOString()
  }

  return sanitized
}
