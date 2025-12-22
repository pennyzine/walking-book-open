import { exportAsZip, exportAsDocx, exportCommentsJson, exportSessionData } from "@/lib/export"
import type { StoredAudiobook, SessionData } from "@/types/audiobook"

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Some browsers will cancel or truncate downloads if the object URL is revoked immediately.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function safeFilenamePart(value: string | undefined | null, fallback: string) {
  const raw = (value ?? "").trim()
  if (!raw) return fallback
  // Replace characters that are invalid or problematic on common filesystems.
  const cleaned = raw.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim()
  return cleaned || fallback
}

async function runDownload(
  audiobook: StoredAudiobook,
  session: SessionData,
  action: () => Promise<Blob> | Blob,
  filenameBuilder: (book: StoredAudiobook) => string,
) {
  const blob = await action()
  triggerBlobDownload(blob, filenameBuilder(audiobook))
}

export async function downloadZip(audiobook: StoredAudiobook, session: SessionData) {
  await runDownload(audiobook, session, () => exportAsZip(audiobook, session), (book) => {
    const title = safeFilenamePart(book.metadata?.title, "walkingbook")
    return `${title}_with_session.zip`
  })
}

export async function downloadDocx(audiobook: StoredAudiobook, session: SessionData) {
  await runDownload(
    audiobook,
    session,
    () => exportAsDocx(audiobook, session),
    (book) => {
      const title = safeFilenamePart(book.metadata?.title, "document")
      return `${title}_with_edits.docx`
    },
  )
}

export async function downloadCommentsJson(audiobook: StoredAudiobook, session: SessionData) {
  await runDownload(audiobook, session, () => exportCommentsJson(audiobook, session), (book) => {
    const title = safeFilenamePart(book.metadata?.title, "document")
    return `${title}_comments.json`
  })
}

export async function downloadSessionBackup(audiobook: StoredAudiobook, session: SessionData) {
  await runDownload(
    audiobook,
    session,
    () => exportSessionData(audiobook, session),
    (book) => {
      const title = safeFilenamePart(book.metadata?.title, "document")
      return `${title}_session-backup.json`
    },
  )
}
