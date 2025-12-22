"use client"

import JSZip from "jszip"
import * as fuzzball from "fuzzball"

export type MergeCommentItem = {
  anchor_text?: string
  comment_text?: string
  author?: string
  edit_type_label?: string | null
}

export type MergeResult = {
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
  // Match the Merge Comments page behavior: fuzzball.partial_ratio(anchor, paragraph)
  // Important: disable full_process to avoid punctuation/quote normalization creating bogus matches.
  return {
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

  const prefix = normAnchor.slice(0, 80).trim()
  if (prefix.length >= 12) {
    const idx = normPara.indexOf(prefix)
    if (idx >= 0) return normToOrig[idx] ?? null
  }

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
  const cleanAnchor = cleanAnchorText(anchorText)
  if (!cleanAnchor) return { bestIndex: -1, bestScore: 0, bestMethod: "partial_ratio" }

  let bestScore = 0
  let bestIndex = -1
  let bestMethod = "partial_ratio"

  for (let i = 0; i < paragraphs.length; i++) {
    const rawParagraphText = paragraphTexts[i] ?? ""
    if (!rawParagraphText.trim()) continue
    const { score, method } = scoreMatch(cleanAnchor, rawParagraphText)
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

async function ensureCommentsXml(zip: JSZip): Promise<{ doc: Document; originalText?: string }> {
  const existing = zip.file("word/comments.xml")
  if (existing) {
    const text = await existing.async("text")
    return { doc: parseXmlOrThrow(text, "word/comments.xml"), originalText: text }
  }

  const empty =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + `<w:comments xmlns:w="${W_NS}"></w:comments>`
  return { doc: parseXmlOrThrow(empty, "word/comments.xml"), originalText: empty }
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
  const children = Array.from(paragraph.childNodes).filter((n) => n.nodeType === Node.ELEMENT_NODE) as Element[]
  return children.filter((el) => {
    if (el.namespaceURI !== W_NS) return false
    const tag = el.localName
    if (tag === "pPr") return false
    if (tag === "commentRangeStart") return false
    if (tag === "commentRangeEnd") return false
    if (tag === "r") {
      const hasCommentReference = el.getElementsByTagNameNS(W_NS, "commentReference").length > 0
      if (hasCommentReference) return false
    }
    return true
  })
}

function getChildTextLength(node: Element): number {
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

  const anchorNode =
    target ??
    (() => {
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

export async function mergeDocxAddNativeCommentsInPlace(
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

