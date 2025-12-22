"use client"

import JSZip from "jszip"
import * as fuzzball from "fuzzball"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { InfoPageTemplate } from "@/components/info-page-template"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ACTIVE_AUDIOBOOK_STORAGE_KEY } from "@/lib/constants"
import { getAudiobook } from "@/lib/db"
import { exportAsDocx, exportCommentsJson } from "@/lib/export"
import { triggerBlobDownload } from "@/lib/downloads"
import type { SessionData, StoredAudiobook } from "@/types/audiobook"

type MergeCommentItem = {
  anchor_text?: string
  comment_text?: string
  author?: string
  edit_type_label?: string | null
}

type MergeResult = {
  mergedCount: number
  totalCount: number
  details: Array<{
    index: number
    score: number
    anchorPreview: string
    targetPreview: string
    method: string
    approxStart: number | null
    anchorNodeIndex: number
    startMethod: "substring" | "prefix" | "fuzzy" | "none"
  }>
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
const XML_NS = "http://www.w3.org/XML/1998/namespace"

function cleanAnchorText(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function scoreMatch(anchorText: string, paragraphText: string): { score: number; method: string } {
  // Match the Python notebook exactly: fuzzywuzzy.fuzz.partial_ratio(anchor, paragraph)
  // Important: fuzzywuzzy.partial_ratio does NOT apply its full text processing pipeline.
  // Fuzzball defaults can normalize punctuation/quotes (e.g. turning “‘In.’” into “in”),
  // which creates bogus 100% matches. Disable that to match Python behavior.
  return {
    // Also disable force_ascii so unicode quotes stay distinct (closer to Python behavior).
    score: fuzzball.partial_ratio(anchorText, paragraphText, { full_process: false, force_ascii: false }),
    method: "partial_ratio",
  }
}

function parseXmlOrThrow(xmlText: string, label: string): Document {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, "application/xml")
  const parseError = doc.getElementsByTagName("parsererror")[0]
  if (parseError) {
    throw new Error(`Could not parse ${label}.`)
  }
  return doc
}

function serializeXmlWithOriginalHeader(doc: Document, originalText?: string) {
  const serializer = new XMLSerializer()
  let body = serializer.serializeToString(doc)
  // Prevent double XML declarations (invalid XML).
  body = body.replace(/^\s*<\?xml[^>]*\?>\s*/i, "")

  const headerFromOriginal = originalText?.match(/^\s*<\?xml[^>]*\?>/i)?.[0]?.trim()
  const header = headerFromOriginal || `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  return `${header}\n${body}`
}

function getParagraphText(paragraph: Element, xml: Document) {
  const walker = xml.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT)
  let text = ""
  while (walker.nextNode()) {
    const el = walker.currentNode as Element
    if (el.namespaceURI !== W_NS) continue
    const tag = el.localName
    if (tag === "t") {
      text += el.textContent ?? ""
    } else if (tag === "tab") {
      text += "\t"
    } else if (tag === "br" || tag === "cr") {
      text += "\n"
    }
  }
  return text
}

function normalizeForFuzzyIndexing(text: string): { normalized: string; normToOrig: number[] } {
  // Normalization that is close to how humans perceive matches, while still letting us map back
  // to an approximate position in the original paragraph.
  // - Lowercase
  // - Collapse whitespace
  // - Normalize curly quotes to straight quotes
  const normToOrig: number[] = []
  let normalized = ""
  let lastWasSpace = false

  const push = (ch: string, origIndex: number) => {
    normalized += ch
    normToOrig.push(origIndex)
  }

  for (let i = 0; i < text.length; i++) {
    const raw = text[i] ?? ""
    const isSpace = /\s/.test(raw)
    if (isSpace) {
      if (!lastWasSpace) {
        push(" ", i)
        lastWasSpace = true
      }
      continue
    }
    lastWasSpace = false

    let ch = raw
    // Apostrophe / single quotes seen in Word exports.
    if (ch === "’" || ch === "‘" || ch === "ʼ" || ch === "＇" || ch === "‛") ch = "'"
    else if (ch === "“" || ch === "”") ch = "\""
    else if (ch === "–" || ch === "—") ch = "-"

    push(ch.toLowerCase(), i)
  }

  return { normalized: normalized.trim(), normToOrig }
}

function normalizeForFuzzySearch(text: string): string {
  return normalizeForFuzzyIndexing(text).normalized
}

function findApproxMatchStartIndex(paragraphText: string, anchorText: string): number | null {
  const { normalized: normPara, normToOrig } = normalizeForFuzzyIndexing(paragraphText)
  const normAnchor = normalizeForFuzzySearch(anchorText)
  if (!normAnchor) return null

  const direct = normPara.indexOf(normAnchor)
  if (direct >= 0) {
    return normToOrig[direct] ?? null
  }

  // Fallback: try a shorter prefix (handles small quote/punct differences).
  const prefix = normAnchor.slice(0, 80).trim()
  if (prefix.length >= 12) {
    const idx = normPara.indexOf(prefix)
    if (idx >= 0) return normToOrig[idx] ?? null
  }

  // Last resort: fuzzy window scan to estimate where the anchor starts.
  // This is only used for anchoring placement; paragraph selection still uses exact partial_ratio.
  const scanNeedle = normAnchor.length > 220 ? normAnchor.slice(0, 220) : normAnchor
  const windowLen = Math.min(Math.max(scanNeedle.length, 80), 260)
  const step = 5

  let bestScore = 0
  let bestPos = -1
  for (let pos = 0; pos <= Math.max(0, normPara.length - 1); pos += step) {
    const window = normPara.slice(pos, pos + windowLen)
    if (!window) break
    const score = fuzzball.partial_ratio(scanNeedle, window, { full_process: false })
    if (score > bestScore) {
      bestScore = score
      bestPos = pos
      if (bestScore >= 98) break
    }
  }

  if (bestPos >= 0 && bestScore >= 60) {
    return normToOrig[bestPos] ?? null
  }

  return null
}

function findBestParagraphMatch(paragraphs: Element[], paragraphTexts: string[], anchorText: string) {
  // Python notebook behavior:
  // - anchor_text is whitespace-collapsed
  // - paragraph text is used as-is (no quote normalization)
  const cleanAnchor = cleanAnchorText(anchorText)
  if (!cleanAnchor) return { bestIndex: -1, bestScore: 0, bestMethod: "partial_ratio" }

  let bestScore = 0
  let bestIndex = -1
  let bestMethod = "partial_ratio"

  for (let i = 0; i < paragraphs.length; i++) {
    const rawParagraphText = paragraphTexts[i] ?? ""
    if (!rawParagraphText.trim()) continue

    // Keep scoring close to notebook behavior (no quote normalization).
    const paragraphText = rawParagraphText

    const { score, method } = scoreMatch(cleanAnchor, paragraphText)
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
      bestMethod = method
    }
  }

  return { bestIndex, bestScore, bestMethod }
}

function getMaxCommentId(commentsDoc: Document): number {
  const nodes = Array.from(commentsDoc.getElementsByTagNameNS(W_NS, "comment"))
  let max = 0
  for (const node of nodes) {
    const idAttr = node.getAttributeNS(W_NS, "id") ?? node.getAttribute("w:id")
    const id = Number.parseInt(idAttr ?? "0", 10)
    if (Number.isFinite(id) && id > max) max = id
  }
  return max
}

function ensureCommentsPartInContentTypes(contentTypesDoc: Document) {
  const overrides = Array.from(contentTypesDoc.getElementsByTagName("Override"))
  const exists = overrides.some((o) => o.getAttribute("PartName") === "/word/comments.xml")
  if (exists) return

  const override = contentTypesDoc.createElementNS(CONTENT_TYPES_NS, "Override")
  override.setAttribute("PartName", "/word/comments.xml")
  override.setAttribute(
    "ContentType",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
  )

  contentTypesDoc.documentElement.appendChild(override)
}

function ensureCommentsRelationship(documentRelsDoc: Document): string {
  const rels = Array.from(documentRelsDoc.getElementsByTagName("Relationship"))

  const existing = rels.find(
    (r) => r.getAttribute("Type") === "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  )
  if (existing) {
    return existing.getAttribute("Id") || "rIdComments"
  }

  let maxNum = 0
  for (const r of rels) {
    const id = r.getAttribute("Id") || ""
    const m = id.match(/^rId(\d+)$/)
    if (m) {
      const n = Number.parseInt(m[1] ?? "0", 10)
      if (Number.isFinite(n) && n > maxNum) maxNum = n
    }
  }

  const newId = `rId${maxNum + 1}`
  const rel = documentRelsDoc.createElementNS(REL_NS, "Relationship")
  rel.setAttribute("Id", newId)
  rel.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments")
  rel.setAttribute("Target", "comments.xml")

  documentRelsDoc.documentElement.appendChild(rel)
  return newId
}

function ensureCommentsXml(zip: JSZip): Promise<{ doc: Document; originalText?: string }> {
  const existing = zip.file("word/comments.xml")
  if (existing) {
    return existing
      .async("text")
      .then((text) => ({ doc: parseXmlOrThrow(text, "word/comments.xml"), originalText: text }))
  }

  const empty =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + `<w:comments xmlns:w="${W_NS}"></w:comments>`
  return Promise.resolve({ doc: parseXmlOrThrow(empty, "word/comments.xml"), originalText: empty })
}

function addNativeComment(commentsDoc: Document, id: number, author: string, isoDate: string, text: string) {
  const commentsRoot = commentsDoc.getElementsByTagNameNS(W_NS, "comments")[0] || commentsDoc.documentElement

  const comment = commentsDoc.createElementNS(W_NS, "w:comment")
  comment.setAttributeNS(W_NS, "w:id", String(id))
  comment.setAttributeNS(W_NS, "w:author", author)
  comment.setAttributeNS(W_NS, "w:date", isoDate)

  const p = commentsDoc.createElementNS(W_NS, "w:p")

  const rRef = commentsDoc.createElementNS(W_NS, "w:r")
  const annotationRef = commentsDoc.createElementNS(W_NS, "w:annotationRef")
  rRef.appendChild(annotationRef)

  const rText = commentsDoc.createElementNS(W_NS, "w:r")
  const t = commentsDoc.createElementNS(W_NS, "w:t")
  t.setAttributeNS(XML_NS, "xml:space", "preserve")
  t.textContent = text
  rText.appendChild(t)

  p.appendChild(rRef)
  p.appendChild(rText)

  comment.appendChild(p)
  commentsRoot.appendChild(comment)
}

function insertAfter(parent: Node, node: Node, after: Node) {
  const next = after.nextSibling
  if (next) parent.insertBefore(node, next)
  else parent.appendChild(node)
}

function createSpaceRun(doc: Document) {
  const r = doc.createElementNS(W_NS, "w:r")
  const t = doc.createElementNS(W_NS, "w:t")
  t.setAttributeNS(XML_NS, "xml:space", "preserve")
  t.textContent = " "
  r.appendChild(t)
  return r
}

function getDirectChildAnchorCandidates(paragraph: Element): Element[] {
  // Direct children only, so we can safely insertBefore/after them.
  const children = Array.from(paragraph.childNodes).filter((n) => n.nodeType === Node.ELEMENT_NODE) as Element[]
  return children.filter((el) => {
    if (el.namespaceURI !== W_NS) return false
    const tag = el.localName
    if (tag === "pPr") return false
    if (tag === "commentRangeStart") return false
    if (tag === "commentRangeEnd") return false
    // Avoid anchoring around an existing comment reference run.
    if (tag === "r") {
      const hasCommentReference = el.getElementsByTagNameNS(W_NS, "commentReference").length > 0
      if (hasCommentReference) return false
    }
    return true
  })
}

function getChildTextLength(node: Element): number {
  // Count text contribution of a child node in a paragraph (including nested runs).
  // Must mirror getParagraphText's rules for w:t, w:tab, w:br/cr.
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_ELEMENT)
  let len = 0
  while (walker.nextNode()) {
    const el = walker.currentNode as Element
    if (el.namespaceURI !== W_NS) continue
    const tag = el.localName
    if (tag === "t") {
      len += (el.textContent ?? "").length
    } else if (tag === "tab" || tag === "br" || tag === "cr") {
      len += 1
    }
  }
  return len
}

function findBestAnchorCandidateIndexForOffset(paragraph: Element, offset: number): number {
  const candidates = getDirectChildAnchorCandidates(paragraph)
  if (candidates.length === 0) return 0

  let cursor = 0
  for (let i = 0; i < candidates.length; i++) {
    const nodeLen = getChildTextLength(candidates[i]!)
    if (offset < cursor + Math.max(1, nodeLen)) return i
    cursor += Math.max(1, nodeLen)
  }
  return candidates.length - 1
}

function createCommentReferenceRun(doc: Document, commentId: number) {
  const run = doc.createElementNS(W_NS, "w:r")
  const rPr = doc.createElementNS(W_NS, "w:rPr")
  const rStyle = doc.createElementNS(W_NS, "w:rStyle")
  rStyle.setAttributeNS(W_NS, "w:val", "CommentReference")
  rPr.appendChild(rStyle)
  run.appendChild(rPr)

  const ref = doc.createElementNS(W_NS, "w:commentReference")
  ref.setAttributeNS(W_NS, "w:id", String(commentId))
  run.appendChild(ref)
  return run
}

function insertCommentAnchorIntoParagraph(doc: Document, paragraph: Element, commentId: number, anchorIndex: number) {
  const candidates = getDirectChildAnchorCandidates(paragraph)
  const target = candidates[anchorIndex] ?? null

  const anchorNode = target ?? (() => {
    const run = createSpaceRun(doc)
    paragraph.appendChild(run)
    return run
  })()

  const rangeStart = doc.createElementNS(W_NS, "w:commentRangeStart")
  rangeStart.setAttributeNS(W_NS, "w:id", String(commentId))

  const rangeEnd = doc.createElementNS(W_NS, "w:commentRangeEnd")
  rangeEnd.setAttributeNS(W_NS, "w:id", String(commentId))

  const refRun = createCommentReferenceRun(doc, commentId)

  paragraph.insertBefore(rangeStart, anchorNode)
  insertAfter(paragraph, rangeEnd, anchorNode)
  insertAfter(paragraph, refRun, rangeEnd)
}

async function mergeDocxAddNativeCommentsInPlace(
  docxFile: File,
  commentsFile: File,
): Promise<{ blob: Blob; result: MergeResult }> {
  const zip = await JSZip.loadAsync(await docxFile.arrayBuffer())

  const documentXmlFile = zip.file("word/document.xml")
  if (!documentXmlFile) {
    throw new Error("This DOCX is missing word/document.xml.")
  }

  const commentsJson = JSON.parse(await commentsFile.text()) as unknown
  if (!Array.isArray(commentsJson)) {
    throw new Error("Comments JSON must be an array.")
  }
  const items = commentsJson as MergeCommentItem[]

  const documentXmlText = await documentXmlFile.async("text")
  const documentDoc = parseXmlOrThrow(documentXmlText, "word/document.xml")

  const paragraphs = Array.from(documentDoc.getElementsByTagNameNS(W_NS, "p"))
  const paragraphTexts = paragraphs.map((p) => getParagraphText(p, documentDoc))

  const { doc: commentsDoc, originalText: commentsXmlOriginal } = await ensureCommentsXml(zip)
  let nextCommentId = getMaxCommentId(commentsDoc) + 1

  let mergedCount = 0
  const details: MergeResult["details"] = []
  const nowIso = new Date().toISOString()

  // Track used anchor positions per paragraph so comments don't stack on the same node.
  const usedAnchorIndicesByParagraph = new Map<number, Set<number>>()

  for (let i = 0; i < items.length; i++) {
    const item = items[i] ?? {}
    const anchor = item.anchor_text ?? ""
    const commentText = item.comment_text ?? ""
    const author = (item.author ?? "Reviewer").trim() || "Reviewer"
    const editTypeLabel = item.edit_type_label ?? null

    const { bestIndex, bestScore, bestMethod } = findBestParagraphMatch(paragraphs, paragraphTexts, anchor)
    if (bestIndex < 0) continue

    const paragraph = paragraphs[bestIndex]
    if (!paragraph) continue

    const prefix = editTypeLabel ? `[${editTypeLabel}] ` : ""
    const fullCommentText = `${prefix}${commentText}`

    const commentId = nextCommentId++
    addNativeComment(commentsDoc, commentId, author, nowIso, fullCommentText)

    // Try to anchor the comment near where the anchor_text starts within the matched paragraph.
    const paraText = paragraphTexts[bestIndex] ?? ""
    let startMethod: MergeResult["details"][number]["startMethod"] = "none"
    let approxStart: number | null = null

    const { normalized: normPara } = normalizeForFuzzyIndexing(paraText)
    const normAnchor = normalizeForFuzzySearch(anchor)
    if (normAnchor && normPara.includes(normAnchor)) {
      startMethod = "substring"
      approxStart = findApproxMatchStartIndex(paraText, anchor)
    } else {
      const prefix = normAnchor ? normAnchor.slice(0, 80).trim() : ""
      if (prefix && normPara.includes(prefix)) {
        startMethod = "prefix"
        approxStart = findApproxMatchStartIndex(paraText, anchor)
      } else {
        startMethod = "fuzzy"
        approxStart = findApproxMatchStartIndex(paraText, anchor)
        if (approxStart === null) startMethod = "none"
      }
    }

    let anchorIdx = findBestAnchorCandidateIndexForOffset(paragraph, approxStart ?? 0)

    const used = usedAnchorIndicesByParagraph.get(bestIndex) ?? new Set<number>()
    while (used.has(anchorIdx)) {
      anchorIdx++
    }
    used.add(anchorIdx)
    usedAnchorIndicesByParagraph.set(bestIndex, used)

    insertCommentAnchorIntoParagraph(documentDoc, paragraph, commentId, anchorIdx)

    mergedCount++
    details.push({
      index: i,
      score: bestScore,
      anchorPreview: cleanAnchorText(anchor).slice(0, 80),
      targetPreview: cleanAnchorText(paragraphTexts[bestIndex] ?? "").slice(0, 80),
      method: bestMethod,
      approxStart,
      anchorNodeIndex: anchorIdx,
      startMethod,
    })
  }

  // Update rels + content types to include comments.xml
  const contentTypesFile = zip.file("[Content_Types].xml")
  if (!contentTypesFile) {
    throw new Error("This DOCX is missing [Content_Types].xml.")
  }
  const contentTypesText = await contentTypesFile.async("text")
  const contentTypesDoc = parseXmlOrThrow(contentTypesText, "[Content_Types].xml")
  ensureCommentsPartInContentTypes(contentTypesDoc)

  const documentRelsPath = "word/_rels/document.xml.rels"
  const documentRelsFile = zip.file(documentRelsPath)
  const relsText =
    (documentRelsFile
      ? await documentRelsFile.async("text")
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"></Relationships>`) ||
    ""
  const relsDoc = parseXmlOrThrow(relsText, documentRelsPath)
  ensureCommentsRelationship(relsDoc)

  zip.file("word/document.xml", serializeXmlWithOriginalHeader(documentDoc, documentXmlText))
  zip.file("word/comments.xml", serializeXmlWithOriginalHeader(commentsDoc, commentsXmlOriginal))
  zip.file("[Content_Types].xml", serializeXmlWithOriginalHeader(contentTypesDoc, contentTypesText))
  zip.file(documentRelsPath, serializeXmlWithOriginalHeader(relsDoc, relsText))

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Generated file was not a valid DOCX (zip header missing).")
  }

  // Verify the resulting zip + key parts parse.
  const verifyZip = await JSZip.loadAsync(bytes)
  const verifiedContentTypes = verifyZip.file("[Content_Types].xml")
  const verifiedRels = verifyZip.file("word/_rels/document.xml.rels")
  const verifiedDoc = verifyZip.file("word/document.xml")
  const verifiedComments = verifyZip.file("word/comments.xml")
  if (!verifiedContentTypes || !verifyZip.file("_rels/.rels") || !verifiedDoc || !verifiedRels || !verifiedComments) {
    throw new Error("Generated file was missing required DOCX parts.")
  }

  parseXmlOrThrow(await verifiedContentTypes.async("text"), "[Content_Types].xml (output)")
  parseXmlOrThrow(await verifiedRels.async("text"), "word/_rels/document.xml.rels (output)")
  parseXmlOrThrow(await verifiedDoc.async("text"), "word/document.xml (output)")
  parseXmlOrThrow(await verifiedComments.async("text"), "word/comments.xml (output)")

  // `bytes.buffer` can be a SharedArrayBuffer in some environments; BlobPart doesn't accept it.
  // Use a Uint8Array copy (always a valid BlobPart).
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })

  return {
    blob,
    result: {
      mergedCount,
      totalCount: items.length,
      details,
    },
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function MergeCommentsClient() {
  const [docxFile, setDocxFile] = useState<File | null>(null)
  const [uploadedCommentsFile, setUploadedCommentsFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MergeResult | null>(null)

  const [sessionAudiobook, setSessionAudiobook] = useState<StoredAudiobook | null>(null)
  const [sessionData, setSessionData] = useState<SessionData | null>(null)
  const [busySessionExport, setBusySessionExport] = useState<"docx" | "comments" | null>(null)
  const [commentsSource, setCommentsSource] = useState<"session" | "upload">("upload")

  const sessionCommentsFile = useMemo(() => {
    if (!sessionAudiobook || !sessionData) return null
    const commentsBlob = exportCommentsJson(sessionAudiobook, sessionData)
    const safeTitle = (sessionAudiobook.metadata?.title || "document").replace(/[^\w\-]+/g, "_")
    return new File([commentsBlob], `${safeTitle}_comments.json`, { type: "application/json" })
  }, [sessionAudiobook, sessionData])

  const effectiveCommentsFile = useMemo(() => {
    if (commentsSource === "session") return sessionCommentsFile
    return uploadedCommentsFile
  }, [commentsSource, sessionCommentsFile, uploadedCommentsFile])

  const canRun = useMemo(() => !!docxFile && !!effectiveCommentsFile && !busy, [docxFile, effectiveCommentsFile, busy])

  useEffect(() => {
    let cancelled = false

    async function loadCurrentSession() {
      if (typeof window === "undefined") return

      const activeId = localStorage.getItem(ACTIVE_AUDIOBOOK_STORAGE_KEY)
      if (!activeId) return

      try {
        const book = await getAudiobook(activeId)
        const session = book?.session ?? null
        if (cancelled) return

        if (!book || !session) return

        setSessionAudiobook(book)
        setSessionData(session)

        // Default to session comments when available; user can switch to upload.
        setCommentsSource("session")
      } catch (error) {
        console.warn("Failed to load current session for merge page", error)
      }
    }

    void loadCurrentSession()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleDownloadSessionComments() {
    if (!sessionAudiobook || !sessionData) return
    if (busySessionExport) return
    setBusySessionExport("comments")
    try {
      const blob = exportCommentsJson(sessionAudiobook, sessionData)
      const safeTitle = (sessionAudiobook.metadata?.title || "document").replace(/[^\w\-]+/g, "_")
      triggerBlobDownload(blob, `${safeTitle}_comments.json`)
      toast.success("Comments JSON download started.")
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to export comments JSON")
    } finally {
      setBusySessionExport(null)
    }
  }

  async function handleDownloadSessionDocxWithComments() {
    if (!sessionAudiobook || !sessionData) return
    if (busySessionExport) return
    setBusySessionExport("docx")
    try {
      const blob = await exportAsDocx(sessionAudiobook, sessionData)
      const safeTitle = (sessionAudiobook.metadata?.title || "document").replace(/[^\w\-]+/g, "_")
      triggerBlobDownload(blob, `${safeTitle}_with_edits.docx`)
      toast.success("DOCX download started.")
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to export DOCX")
    } finally {
      setBusySessionExport(null)
    }
  }

  async function handleMerge() {
    if (!docxFile || !effectiveCommentsFile) return

    setBusy(true)
    setResult(null)
    try {
      const { blob, result } = await mergeDocxAddNativeCommentsInPlace(docxFile, effectiveCommentsFile)
      setResult(result)

      const base = docxFile.name.replace(/\.docx$/i, "")
      const outputName = `${base || "document"}_merged.docx`
      downloadBlob(blob, outputName)

      toast.success(`Merged ${result.mergedCount} comment(s). Download started.`)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : "Failed to merge comments")
    } finally {
      setBusy(false)
    }
  }

  return (
    <InfoPageTemplate
      eyebrow="Add comments"
      metaLabel="Runs entirely on your device"
      title="Merge your comments"
      paragraphs={[
        "Make a Microsoft Word (.docx) file with your Walking Book edits inserted as comments. Comments with show in a .docx in Google Docs and Pages too!",
        "You can also upload a file and choose which comments to merge. It all runs on your device (works offline).",
      ]}
      accentWord="Merge"
    >
      <div className="min-w-0 space-y-6">
        {sessionAudiobook && sessionData && (
          <div className="rounded-2xl border border-black-text/10 bg-white/70 p-4">
            <div className="text-xs uppercase tracking-[0.35em] text-black-text/60">Current session</div>
            <div className="mt-2 text-sm text-black-text">
              Active tape: <b>{sessionAudiobook.metadata?.title || sessionAudiobook.id}</b>
            </div>
            <div className="mt-1 text-xs text-black-text/60">
              {sessionData.edits?.length ?? 0} edit(s) in this session.
            </div>
            <div className="mt-3 text-sm text-black-text/80">
              If you just want a Word file with your session comments already included, use the quick download below (no merge required).
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                onClick={handleDownloadSessionDocxWithComments}
                disabled={busy || busySessionExport !== null}
              >
                {busySessionExport === "docx" ? "Preparing DOCX…" : "Download DOCX with Comments"}
              </Button>
              <Button
                variant="secondary"
                onClick={handleDownloadSessionComments}
                disabled={busy || busySessionExport !== null}
              >
                {busySessionExport === "comments" ? "Preparing JSON…" : "Download Comments JSON"}
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-black-text/10 bg-white/70 p-4">
          <div className="text-xs uppercase tracking-[0.35em] text-black-text/60">Merge into an existing DOCX</div>
          <div className="mt-2 text-sm text-black-text/80">
            Use this if you have an original manuscript DOCX and want to inject the comments JSON into that specific file.
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <div className="text-xs uppercase tracking-[0.35em] text-black-text/60">DOCX document</div>
            <Input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setDocxFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            {docxFile && <div className="break-words text-xs text-black-text/60">Selected: {docxFile.name}</div>}
          </div>

          <div className="min-w-0 space-y-2">
            <div className="text-xs uppercase tracking-[0.35em] text-black-text/60">Comments JSON</div>
            {sessionCommentsFile ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={commentsSource === "session" ? "default" : "secondary"}
                    onClick={() => setCommentsSource("session")}
                    disabled={busy}
                  >
                    Use session comments
                  </Button>
                  <Button
                    variant={commentsSource === "upload" ? "default" : "secondary"}
                    onClick={() => setCommentsSource("upload")}
                    disabled={busy}
                  >
                    Upload different JSON
                  </Button>
                </div>

                {commentsSource === "session" ? (
                  <div className="break-words text-xs text-black-text/60">
                    Using: {sessionCommentsFile.name} (from current session)
                  </div>
                ) : (
                  <>
                    <Input
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => setUploadedCommentsFile(e.target.files?.[0] ?? null)}
                      disabled={busy}
                    />
                    {uploadedCommentsFile && (
                      <div className="break-words text-xs text-black-text/60">Selected: {uploadedCommentsFile.name}</div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                <Input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => setUploadedCommentsFile(e.target.files?.[0] ?? null)}
                  disabled={busy}
                />
                {uploadedCommentsFile && (
                  <div className="break-words text-xs text-black-text/60">Selected: {uploadedCommentsFile.name}</div>
                )}
              </>
            )}
          </div>
        </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={handleMerge} disabled={!canRun}>
              {busy ? "Merging…" : "Merge & Download DOCX"}
            </Button>
          </div>
        </div>

        {result && (
          <div className="rounded-2xl border border-black-text/10 bg-white/70 p-4">
            <div className="text-xs uppercase tracking-[0.35em] text-black-text/60">Result</div>
            <div className="mt-2 text-sm text-black-text">
              Merged <b>{result.mergedCount}</b> of <b>{result.totalCount}</b> comment(s).
            </div>
            {result.details.length > 0 && (
              <div className="mt-3 space-y-2 text-xs text-black-text/70 break-words">
                {result.details.slice(0, 10).map((item) => (
                  <div key={`${item.index}-${item.score}`} className="border-t border-black-text/10 pt-2">
                    <div>
                      <b>Comment {item.index + 1}</b> — match score {item.score}% ({item.method})
                    </div>
                    <div className="text-[0.7rem] text-black-text/50">
                      anchor placement: {item.startMethod}, approxStart={String(item.approxStart)}, nodeIndex={item.anchorNodeIndex}
                    </div>
                    <div>
                      <b>Anchor</b>: {item.anchorPreview}
                    </div>
                    <div>
                      <b>Target</b>: {item.targetPreview}
                    </div>
                  </div>
                ))}
                {result.details.length > 10 && <div>…and {result.details.length - 10} more.</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </InfoPageTemplate>
  )
}
