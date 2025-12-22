import JSZip from "jszip"
import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  LineRuleType,
  Packer,
  type ICommentOptions,
  CommentRangeStart,
  CommentRangeEnd,
  CommentReference,
  Tab,
} from "docx"
import type { StoredAudiobook, SessionData, VoiceEdit, TimestampSegment } from "@/types/audiobook"
import { getEditTypeLabel } from "@/lib/edit-utils"
import { debugLog } from "@/lib/debug"

const DEFAULT_FONT_SIZE = 24 // 12pt expressed in half-points
const DEFAULT_PARAGRAPH_SPACING = {
  line: 360, // 1.5 line height
  lineRule: LineRuleType.AUTO,
} as const

function createParagraphWithSpacing(options: ConstructorParameters<typeof Paragraph>[0]) {
  // `docx`'s Paragraph constructor accepts a few shapes across versions; ensure we only spread objects.
  if (!options) {
    return new Paragraph({ spacing: DEFAULT_PARAGRAPH_SPACING })
  }
  if (typeof options === "string") {
    return new Paragraph({ text: options, spacing: DEFAULT_PARAGRAPH_SPACING })
  }
  return new Paragraph({ ...options, spacing: DEFAULT_PARAGRAPH_SPACING })
}

function sanitizeSessionForExport(session: SessionData): SessionData {
  const sanitizedEdits = (session.edits || []).map(({ audioBlob: _audioBlob, ...rest }) => ({
    ...rest,
  })) as SessionData["edits"]

  return {
    ...session,
    edits: sanitizedEdits,
  }
}

function formatEditDescriptions(edits: VoiceEdit[]): string[] {
  return edits.map((edit) => {
    const label = getEditTypeLabel(edit.editType)
    const transcription = (edit.transcription || "").trim()
    return transcription ? `${label}: ${transcription}` : label
  })
}

function buildCommentParagraph(editDescriptions: string[]) {
  const introText = editDescriptions.length > 1 ? "Suggested edits:" : "Suggested edit:"
  const children: TextRun[] = [new TextRun({ text: introText })]

  editDescriptions.forEach((description) => {
    children.push(new TextRun({ break: 1 }))
    children.push(new TextRun({ text: description }))
  })

  return new Paragraph({ children })
}

function findChunkAndSegment(audiobook: StoredAudiobook, edit: VoiceEdit): { segmentText?: string } {
  const chunks = audiobook.manifest.chunks
  let chunkIndex = typeof edit.chunkIndex === "number" ? edit.chunkIndex : -1
  if (chunkIndex < 0) {
    chunkIndex = chunks.findIndex((chunk) => chunk.chunk_id === edit.chunkId)
  }
  const segment = chunkIndex >= 0 ? chunks[chunkIndex]?.timestamps[edit.segmentIndex] : undefined
  const segmentText = segment?.text

  return { segmentText }
}

function buildChunkIndexById(chunks: StoredAudiobook["manifest"]["chunks"]) {
  const map = new Map<string, number>()
  chunks.forEach((chunk, idx) => {
    map.set(chunk.chunk_id, idx)
  })
  return map
}

function resolveEditChunkIndex(edit: VoiceEdit, chunkIndexById: Map<string, number>): number {
  if (typeof edit.chunkIndex === "number" && edit.chunkIndex >= 0) return edit.chunkIndex
  if (typeof edit.chunkId === "string") {
    const idx = chunkIndexById.get(edit.chunkId)
    if (typeof idx === "number" && idx >= 0) return idx
  }
  return 0
}

function getVersionHistoryEntries(versionHistory: StoredAudiobook["versionHistory"] | unknown): Array<[string, string]> {
  if (!versionHistory) return []
  if (versionHistory instanceof Map) {
    return Array.from(versionHistory.entries()).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  }
  if (typeof versionHistory === "object") {
    return Object.entries(versionHistory as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    )
  }
  return []
}

function pickBestOriginalTextFromVersionHistory(versionHistory: StoredAudiobook["versionHistory"] | unknown): string | undefined {
  const entries = getVersionHistoryEntries(versionHistory).filter(([, text]) => text.trim().length > 0)
  if (entries.length === 0) return undefined

  const byKey = new Map(entries)
  const lowerByKey = new Map(entries.map(([k, v]) => [k.toLowerCase(), v]))
  const preferredKeys = [
    "1",
    "v1",
    "original",
    "orig",
    "manuscript",
    "text",
    "0",
    "v0",
    "base",
  ]

  for (const key of preferredKeys) {
    const direct = byKey.get(key) ?? lowerByKey.get(key)
    if (direct && direct.trim()) return direct
  }

  // Fallback: choose the longest text (most likely the full manuscript).
  return entries.reduce((best, cur) => (cur[1].length > best.length ? cur[1] : best), entries[0]![1])
}

function buildManuscriptTextFromManifest(audiobook: StoredAudiobook): string {
  // Approximate a continuous manuscript from timestamp text.
  // This isn’t format-perfect, but it reliably contains the same segment text used for anchoring comments.
  const parts: string[] = []
  for (const chunk of audiobook.manifest.chunks) {
    const chunkTitle = (chunk.title || "").trim()
    if (chunkTitle) {
      parts.push(chunkTitle, "")
    }
    const segmentText = chunk.timestamps
      .map((seg) => (typeof seg.text === "string" ? seg.text : "").trim())
      .filter(Boolean)
      .join(" ")
    if (segmentText) parts.push(segmentText)
    // Separate chunks with a blank line so we get stable paragraph ranges.
    parts.push("")
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function createWalkingBookDocument(paragraphs: Paragraph[], comments: ICommentOptions[]) {
  return new Document({
    styles: {
      default: {
        document: {
          run: {
            size: DEFAULT_FONT_SIZE,
          },
          paragraph: {
            spacing: DEFAULT_PARAGRAPH_SPACING,
          },
        },
      },
    },
    comments: {
      children: comments,
    },
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  })
}
import { getAudioFile } from "./db"

/**
 * Normalize text for matching (same as the Colab TextHasher.normalize_text)
 */
function normalizeTextForMatching(text: string): string {
  let normalized = text.toLowerCase()
  normalized = normalized.replace(/\s+/g, " ")
  normalized = normalized.replace(/[^\w\s]/g, "")
  return normalized.trim()
}

function normalizeTextForMatchingWithMap(text: string): { normalized: string; normToOrig: number[] } {
  // Mirrors normalizeTextForMatching, but also returns an index map from normalized chars -> original char index.
  const normToOrig: number[] = []
  let normalized = ""
  let lastWasSpace = false

  for (let i = 0; i < text.length; i++) {
    const ch = (text[i] ?? "").toLowerCase()
    if (!ch) continue

    // whitespace collapse
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        normalized += " "
        normToOrig.push(i)
        lastWasSpace = true
      }
      continue
    }
    lastWasSpace = false

    // keep only \w characters (letters/digits/_)
    if (/[\w]/.test(ch)) {
      normalized += ch
      normToOrig.push(i)
    }
    // else: drop punctuation (matches normalizeTextForMatching's removal)
  }

  // trim leading/trailing spaces but keep mapping consistent
  // leading
  while (normalized.startsWith(" ")) {
    normalized = normalized.slice(1)
    normToOrig.shift()
  }
  // trailing
  while (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1)
    normToOrig.pop()
  }

  return { normalized, normToOrig }
}

function findNormalizedStartIndexByOriginalOffset(normToOrig: number[], originalOffset: number): number {
  // normToOrig is monotonic increasing; find first normalized index whose original index >= originalOffset.
  let lo = 0
  let hi = normToOrig.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const value = normToOrig[mid] ?? 0
    if (value < originalOffset) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Add text to runs array while preserving single line breaks and tabs
 */
function addTextWithLineBreaks(runs: any[], text: string) {
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Handle tabs within the line
    if (line.includes("\t")) {
      const parts = line.split("\t")
      for (let j = 0; j < parts.length; j++) {
        // Add text part if not empty
        if (parts[j]) {
          runs.push(new TextRun({ text: parts[j] }))
        }
        // Add Tab object after each part except the last
        if (j < parts.length - 1) {
          runs.push(new TextRun({ children: [new Tab()] }))
        }
      }
    } else if (line) {
      // No tabs - just add the line as-is
      runs.push(new TextRun({ text: line }))
    }

    // Add line break after each line except the last
    if (i < lines.length - 1) {
      runs.push(new TextRun({ break: 1 }))
    }
  }
}

/**
 * Find the position of a segment in the original text
 */
function findSegmentInOriginal(
  segmentText: string,
  originalText: string,
  startOffset = 0,
): { start: number; end: number; originalText: string } | null {
  const normalizedSegment = normalizeTextForMatching(segmentText)
  if (!normalizedSegment) return null

  // Normalize original text once for efficient searching while preserving a mapping back to original indices.
  const { normalized: normalizedOriginal, normToOrig } = normalizeTextForMatchingWithMap(originalText)
  if (!normalizedOriginal) return null

  const normStart = findNormalizedStartIndexByOriginalOffset(normToOrig, Math.max(0, startOffset))

  // Primary: exact normalized substring match from the current offset onward (searches the full remainder).
  let normIndex = normalizedOriginal.indexOf(normalizedSegment, normStart)

  // Fallback: try a shorter prefix if the segment includes characters that normalize away differently.
  if (normIndex < 0) {
    const prefix = normalizedSegment.slice(0, 140).trim()
    if (prefix.length >= 24) {
      const prefixIndex = normalizedOriginal.indexOf(prefix, normStart)
      if (prefixIndex >= 0) {
        normIndex = prefixIndex
      }
    }
  }

  if (normIndex < 0) return null

  const startOrig = normToOrig[normIndex] ?? null
  const endOrigInclusive = normToOrig[normIndex + normalizedSegment.length - 1] ?? null
  if (startOrig === null || endOrigInclusive === null) return null

  const endOrig = Math.min(originalText.length, endOrigInclusive + 1)
  return {
    start: startOrig,
    end: endOrig,
    originalText: originalText.substring(startOrig, endOrig),
  }
}

export async function exportAsZip(audiobook: StoredAudiobook, session: SessionData): Promise<Blob> {
  const zip = new JSZip()

  // Add metadata
  zip.file("metadata.json", JSON.stringify(audiobook.metadata, null, 2))

  // Add manifest
  zip.file("manifest.json", JSON.stringify(audiobook.manifest, null, 2))

  const sessionForExport = sanitizeSessionForExport(session)
  zip.file("session.json", JSON.stringify(sessionForExport, null, 2))

  // Add version history
  const versionFolder = zip.folder("version_history")
  if (versionFolder) {
    for (const [version, content] of audiobook.versionHistory) {
      versionFolder.file(`${version}.txt`, content)
    }
  }

  // Add audio files
  const audioFolder = zip.folder("audio")
  if (audioFolder) {
    for (const chunk of audiobook.manifest.chunks) {
      const audioBlob = await getAudioFile(audiobook.id, chunk.audio_file)
      if (audioBlob) {
        const fileName = chunk.audio_file.replace("audio/", "")
        audioFolder.file(fileName, audioBlob)
      }
    }
  }

  // Add voice edit recordings if any exist
  if (session.edits.length > 0) {
    const editsFolder = zip.folder("edits")
    if (editsFolder) {
      for (const edit of session.edits) {
        if (edit.audioBlob) {
          editsFolder.file(`edit_${edit.id}.webm`, edit.audioBlob)
        }
      }
    }
  }

  return await zip.generateAsync({ type: "blob" })
}

/**
 * Export using the original text from version history (preferred method)
 */
async function exportAsDocxWithOriginalText(
  audiobook: StoredAudiobook,
  session: SessionData,
  originalText: string,
): Promise<Blob> {
  try {
    const paragraphs: Paragraph[] = []
    const comments: ICommentOptions[] = []
    let commentId = 1
    const chunkIndexById = buildChunkIndexById(audiobook.manifest.chunks)
    const editsByLocation = new Map<string, typeof session.edits>()
    for (const edit of session.edits) {
      const resolvedChunkIndex = resolveEditChunkIndex(edit, chunkIndexById)
      const key = `${resolvedChunkIndex}-${edit.segmentIndex}`
      if (!editsByLocation.has(key)) {
        editsByLocation.set(key, [])
      }
      editsByLocation.get(key)!.push(edit)
    }

    const segmentPositions: Array<{ start: number; end: number; originalText: string; edits: typeof session.edits }> =
      []
    let searchOffset = 0
    let fallbackMatches = 0
    let missingPositions = 0

    for (let chunkIndex = 0; chunkIndex < audiobook.manifest.chunks.length; chunkIndex++) {
      const chunk = audiobook.manifest.chunks[chunkIndex]
      for (let i = 0; i < chunk.timestamps.length; i++) {
        const segment = chunk.timestamps[i]
        const key = `${chunkIndex}-${i}`
        const segmentEdits = editsByLocation.get(key)

        // Only track segments that have edits
        if (segmentEdits && segmentEdits.length > 0) {
          const segmentText = segment.text || ""

          const startChar = segment.original_start_char
          const endChar = segment.original_end_char
          const hasCharPositions = typeof startChar === "number" && typeof endChar === "number"
          const canTrustCharPositions =
            hasCharPositions &&
            startChar >= 0 &&
            endChar > startChar &&
            endChar <= originalText.length &&
            segmentText.trim().length > 0

          if (canTrustCharPositions) {
            const originalSegmentText = originalText.substring(startChar, endChar)
            // Validate that the claimed range actually matches the segment text for this source string.
            // If not, fall back to content-based matching (this happens when we’re using a manifest-built text).
            const looksValid =
              normalizeTextForMatching(originalSegmentText) === normalizeTextForMatching(segmentText) ||
              originalSegmentText.includes(segmentText)
            if (looksValid) {
              segmentPositions.push({
                start: startChar,
                end: endChar,
                originalText: originalSegmentText,
                edits: segmentEdits,
              })
              searchOffset = Math.max(searchOffset, endChar)
              continue
            }
          }

          const fallbackPosition =
            segmentText.trim().length > 0 ? findSegmentInOriginal(segmentText, originalText, searchOffset) : null

          if (fallbackPosition) {
            segmentPositions.push({
              start: fallbackPosition.start,
              end: fallbackPosition.end,
              originalText: fallbackPosition.originalText,
              edits: segmentEdits,
            })
            searchOffset = fallbackPosition.end
            fallbackMatches++
          } else {
            missingPositions++
          }
        }
      }
    }

    // Sort by position to ensure correct order
    segmentPositions.sort((a, b) => a.start - b.start)
    if (missingPositions > 0) {
      debugLog(
        `Unable to locate ${missingPositions} edited segment(s) in export text (fallbackMatches=${fallbackMatches}).`,
      )
    }

    // Split original text into paragraphs while preserving positions
    const paragraphRegex = /\n\n+/g
    const paragraphRanges: Array<{ start: number; end: number; text: string }> = []
    let lastIndex = 0
    let match

    // Find all paragraph breaks and create ranges
    while ((match = paragraphRegex.exec(originalText)) !== null) {
      if (lastIndex < match.index) {
        // Don't filter out whitespace-only paragraphs - preserve all formatting
        paragraphRanges.push({
          start: lastIndex,
          end: match.index,
          text: originalText.substring(lastIndex, match.index),
        })
      }
      lastIndex = match.index + match[0].length
    }

    // Add the last paragraph if there is one
    if (lastIndex < originalText.length) {
      // Don't filter - preserve all formatting including trailing whitespace
      paragraphRanges.push({
        start: lastIndex,
        end: originalText.length,
        text: originalText.substring(lastIndex),
      })
    }

    debugLog(`Total paragraphs found: ${paragraphRanges.length}`)
    debugLog(`First 3 paragraphs:`)
    paragraphRanges.slice(0, 3).forEach((p, idx) => {
      debugLog(`  ${idx}: ${p.start}-${p.end} (${p.text.substring(0, 30).replace(/\n/g, "\\n")}...)`)
    })

    // Process each paragraph and add edits where needed
    for (const paraRange of paragraphRanges) {
      // Check if any edited segments fall within this paragraph
      const editsInParagraph = segmentPositions.filter(
        (seg) => seg.start >= paraRange.start && seg.start < paraRange.end,
      )

      if (editsInParagraph.length > 0) {
        debugLog(`Paragraph ${paraRange.start}-${paraRange.end} has ${editsInParagraph.length} edit(s)`)
        // Build paragraph with edits
        const runs: any[] = []
        let lastPos = paraRange.start

        for (const editSeg of editsInParagraph) {
          // Add text before the edit
          if (editSeg.start > lastPos) {
            const beforeText = originalText.substring(lastPos, editSeg.start)
            if (beforeText) {
              addTextWithLineBreaks(runs, beforeText)
            }
          }

          // Create comment for this edit
          const userName = session.userName || "Guest"
          const editDescriptions = formatEditDescriptions(editSeg.edits)

          debugLog(`Creating comment ${commentId} for position ${editSeg.start}-${editSeg.end}`)

          comments.push({
            id: commentId,
            author: userName,
            date: new Date(),
            children: [buildCommentParagraph(editDescriptions)],
          })

          // Add comment range markers around the edited text
          runs.push(new CommentRangeStart(commentId))
          addTextWithLineBreaks(runs, editSeg.originalText)
          runs.push(new CommentRangeEnd(commentId))
          runs.push(new TextRun({ children: [new CommentReference(commentId)] }))

          commentId++
          lastPos = editSeg.end
        }

        // Add any remaining text in the paragraph
        if (lastPos < paraRange.end) {
          const remainingText = originalText.substring(lastPos, paraRange.end)
          if (remainingText) {
            addTextWithLineBreaks(runs, remainingText)
          }
        }

        paragraphs.push(createParagraphWithSpacing({ children: runs }))
      } else {
        // No edits in this paragraph, add it as-is (preserving line breaks)
        const runs: any[] = []
        // Use originalText.substring for consistency with edited paragraphs
        const paraText = originalText.substring(paraRange.start, paraRange.end)
        addTextWithLineBreaks(runs, paraText)
        paragraphs.push(createParagraphWithSpacing({ children: runs }))
      }
    }

    // Create document with properly structured comments
    debugLog(`Creating document with ${paragraphs.length} paragraphs and ${comments.length} comments`)

    const doc = createWalkingBookDocument(paragraphs, comments)

    return await Packer.toBlob(doc)
  } catch (error) {
    console.error("Error in exportAsDocxWithOriginalText:", error)
    // Fall back to chunked export on error
    return exportAsDocxChunked(audiobook, session)
  }
}

/**
 * Export using chunked text (fallback when no version history available)
 */
async function exportAsDocxChunked(audiobook: StoredAudiobook, session: SessionData): Promise<Blob> {
  const paragraphs: Paragraph[] = []
  const comments: ICommentOptions[] = []
  let commentId = 1
  const chunkIndexById = buildChunkIndexById(audiobook.manifest.chunks)

  const getFirstNonEmptyTranscription = (edits: typeof session.edits) =>
    edits
      .map((edit) => (edit.transcription || "").trim())
      .find((text) => text.length > 0)

  // Title page
  paragraphs.push(
    createParagraphWithSpacing({
      text: audiobook.metadata.title,
      heading: "Heading1",
      alignment: AlignmentType.CENTER,
    }),
    createParagraphWithSpacing({
      text: `by ${audiobook.metadata.author}`,
      alignment: AlignmentType.CENTER,
    }),
    createParagraphWithSpacing({ text: "" }),
    createParagraphWithSpacing({ text: "" }),
  )

  const editsByLocation = new Map<string, typeof session.edits>()
  for (const edit of session.edits) {
    const resolvedChunkIndex = resolveEditChunkIndex(edit, chunkIndexById)
    const key = `${resolvedChunkIndex}-${edit.segmentIndex}`
    if (!editsByLocation.has(key)) {
      editsByLocation.set(key, [])
    }
    editsByLocation.get(key)!.push(edit)
  }

  // Add content with edits as comments
  for (let chunkIndex = 0; chunkIndex < audiobook.manifest.chunks.length; chunkIndex++) {
    const chunk = audiobook.manifest.chunks[chunkIndex]

    // Add chapter heading if chunk has a title
    if (chunk.title) {
      paragraphs.push(
        createParagraphWithSpacing({ text: "" }),
        createParagraphWithSpacing({
          text: chunk.title,
          heading: "Heading2",
        }),
        createParagraphWithSpacing({ text: "" }),
      )
    }

    for (let i = 0; i < chunk.timestamps.length; i++) {
      const segment: TimestampSegment | undefined = chunk.timestamps[i]
      const key = `${chunkIndex}-${i}`
      const segmentEdits = editsByLocation.get(key) || []

      if (!segment && segmentEdits.length === 0) {
        debugLog(`Skipping empty segment ${key} in chunk ${chunkIndex}`)
        continue
      }

      const hasSegmentText = typeof segment?.text === "string" && segment.text.length > 0
      const rawSegmentText = hasSegmentText && segment ? segment.text : ""
      const editFallbackText = getFirstNonEmptyTranscription(segmentEdits)
      const missingTextPlaceholder = "Edited passage (text unavailable)"
      const textForEditedSegment = rawSegmentText || editFallbackText || missingTextPlaceholder

      const runs: any[] = []

      if (segmentEdits.length > 0) {
        // Create comment for this segment
        const userName = session.userName || "Guest"
        const editDescriptions = formatEditDescriptions(segmentEdits)

        comments.push({
          id: commentId,
          author: userName,
          date: new Date(),
          children: [buildCommentParagraph(editDescriptions)],
        })

        // Add comment range markers around the segment text
        runs.push(new CommentRangeStart(commentId))
        addTextWithLineBreaks(runs, textForEditedSegment)
        runs.push(new CommentRangeEnd(commentId))
        runs.push(new TextRun({ children: [new CommentReference(commentId)] }))

        commentId++
      } else {
        // No edits for this segment, just add the text
        if (rawSegmentText.length === 0) {
          // Nothing to add for this segment; skip adding an empty paragraph
          continue
        }
        addTextWithLineBreaks(runs, rawSegmentText)
      }

      paragraphs.push(createParagraphWithSpacing({ children: runs }))
    }
  }

  // Create document with properly structured comments
  debugLog(`Creating chunked document with ${paragraphs.length} paragraphs and ${comments.length} comments`)

  const doc = createWalkingBookDocument(paragraphs, comments)

  // Generate blob
  return await Packer.toBlob(doc)
}

/**
 * Main export function - uses original text from version history if available
 */
export async function exportAsDocx(audiobook: StoredAudiobook, session: SessionData): Promise<Blob> {
  try {
    // Prefer the tape’s original manuscript text (version_history/*.txt), but don’t assume it’s keyed as "1"/"v1".
    const fromVersionHistory = pickBestOriginalTextFromVersionHistory(audiobook.versionHistory)
    const originalText = fromVersionHistory?.trim()
      ? fromVersionHistory
      : buildManuscriptTextFromManifest(audiobook) || undefined

    // If we have a continuous text source, generate a manuscript-like DOCX with comments anchored into it.
    if (originalText && originalText.trim()) {
      return exportAsDocxWithOriginalText(audiobook, session, originalText)
    }

    // Otherwise fall back to chunked export (one segment per paragraph).
    return exportAsDocxChunked(audiobook, session)
  } catch (error) {
    console.error("Error in exportAsDocx:", error)
    // Ultimate fallback
    return exportAsDocxChunked(audiobook, session)
  }
}

export function exportCommentsJson(audiobook: StoredAudiobook, session: SessionData): Blob {
  const sanitizedSession = sanitizeSessionForExport(session)
  const author = sanitizedSession.userName?.trim() || "Reader"

  const commentsPayload = sanitizedSession.edits.map((edit) => {
    const { segmentText } = findChunkAndSegment(audiobook, edit)
    return {
      anchor_text: segmentText || edit.transcription || "",
      comment_text: edit.transcription || "",
      author,
      edit_type: edit.editType,
      edit_type_label: getEditTypeLabel(edit.editType),
    }
  })

  return new Blob([JSON.stringify(commentsPayload, null, 2)], { type: "application/json" })
}

export function exportSessionData(audiobook: StoredAudiobook, session: SessionData): Blob {
  const payload = {
    type: "walkingbook-session",
    version: 1,
    audiobookId: audiobook.id,
    audiobookTitle: audiobook.metadata.title,
    exportedAt: new Date().toISOString(),
    session: sanitizeSessionForExport(session),
  }

  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
}
