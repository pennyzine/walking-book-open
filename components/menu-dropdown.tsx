"use client"

import { usePathname, useRouter } from "next/navigation"
import type { ChangeEvent, ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Download, GitFork, Loader2, MessageSquareText, Trash2, UploadCloud, X } from "lucide-react"
import { toast } from "sonner"

import { clearAllData, getAllAudiobooks, getAudiobook, saveSession } from "@/lib/db"
import type { SessionData, StoredAudiobook } from "@/types/audiobook"
import { clearEnvironmentPreferences } from "@/lib/preferences"
import { registerMenuController } from "@/lib/menu-controller"
import { downloadCommentsJson, downloadDocx } from "@/lib/downloads"
import { exportCommentsJson } from "@/lib/export"
import { mergeDocxAddNativeCommentsInPlace, type MergeResult } from "@/lib/comment-merge"
import { sanitizeSessionData } from "@/lib/session-utils"
import { ZINE_NAV_LINKS, type ZineNavLink } from "@/lib/zine-nav"
import { useReaderEnvironment } from "@/hooks/use-reader-environment"
import { Input } from "@/components/ui/input"
import { ACTIVE_AUDIOBOOK_STORAGE_KEY } from "@/lib/constants"

interface MenuDropdownProps {
  variant?: "light" | "dark"
  className?: string
  children?: ReactNode
}

const NAV_LINKS = ZINE_NAV_LINKS.filter((link) => link.href !== "/merge-comments")
const GITHUB_REPO_URL = "https://github.com/pennyzine/walking-book-reader-open"

type BusyAction = "wipe" | "upload" | "eject" | null
export function MenuDropdown({ variant = "dark", className = "", children }: MenuDropdownProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [hasAudiobooks, setHasAudiobooks] = useState(false)
  const [latestAudiobook, setLatestAudiobook] = useState<StoredAudiobook | null>(null)
  const [commentStudioAudiobook, setCommentStudioAudiobook] = useState<StoredAudiobook | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [isCommentStudioOpen, setIsCommentStudioOpen] = useState(false)
  const [commentDocxFile, setCommentDocxFile] = useState<File | null>(null)
  const [commentJsonUploadFile, setCommentJsonUploadFile] = useState<File | null>(null)
  const [commentJsonSource, setCommentJsonSource] = useState<"session" | "upload">("session")
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentQuickBusy, setCommentQuickBusy] = useState<"docx" | "comments" | null>(null)
  const [commentMergeResult, setCommentMergeResult] = useState<MergeResult | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  const { updateEnvironment } = useReaderEnvironment()
  const triggerButtonRef = useRef<HTMLButtonElement>(null)
  const sessionUploadInputRef = useRef<HTMLInputElement>(null)
  const commentStudioSectionRef = useRef<HTMLDivElement>(null)

  const triggerHover = variant === "light" ? "hover:bg-black-text/10" : "hover:bg-white-text/10"
  // `menu.svg` is already a light/off-white icon. Only invert it when we need a dark icon.
  const triggerIconFilter = variant === "light" ? "invert" : ""

  const scrollCommentStudioIntoView = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (!commentStudioSectionRef.current) return
      commentStudioSectionRef.current.scrollIntoView({ behavior, block: "start" })
    },
    [],
  )

  useEffect(() => {
    const unregister = registerMenuController((options) => {
      // If this MenuDropdown is hidden (e.g. desktop menu on mobile), let another
      // registered controller handle the open request.
      const trigger = triggerButtonRef.current
      const isVisible = !!trigger && trigger.offsetParent !== null
      if (!isVisible) return false

      setIsPanelOpen(true)
      const target = options?.section ?? null
      if (!target) return true

      if (target === "comment-studio") {
        setIsCommentStudioOpen(true)
        return true
      }

      // For other sections, just open the panel.
      return true
    })

    return unregister
  }, [])

  useEffect(() => {
    if (!isPanelOpen || !isCommentStudioOpen) return
    const frame = requestAnimationFrame(() => {
      scrollCommentStudioIntoView()
    })
    return () => cancelAnimationFrame(frame)
  }, [isPanelOpen, isCommentStudioOpen, scrollCommentStudioIntoView])

  const refreshAudiobooks = useCallback(async () => {
    try {
      const books = await getAllAudiobooks()
      const sorted = [...books].sort((a: StoredAudiobook, b: StoredAudiobook) => {
        const aTime = new Date(a.uploadedAt ?? 0).getTime()
        const bTime = new Date(b.uploadedAt ?? 0).getTime()
        return bTime - aTime
      })
      setHasAudiobooks(sorted.length > 0)
      setLatestAudiobook(sorted[0] ?? null)
    } catch (error) {
      console.error("Failed to load audiobooks", error)
    }
  }, [])

  const refreshCommentStudioAudiobook = useCallback(
    async (fallbackLatest: StoredAudiobook | null) => {
      // Use the same "active tape" selection as the merge-comments page.
      if (typeof window === "undefined") {
        setCommentStudioAudiobook(fallbackLatest)
        return
      }

      const activeId = window.localStorage.getItem(ACTIVE_AUDIOBOOK_STORAGE_KEY)
      if (!activeId) {
        setCommentStudioAudiobook(fallbackLatest)
        return
      }

      try {
        const active = await getAudiobook(activeId)
        setCommentStudioAudiobook(active ?? fallbackLatest)
      } catch (error) {
        console.warn("Failed to load active tape for Comment Studio", error)
        setCommentStudioAudiobook(fallbackLatest)
      }
    },
    [],
  )

  useEffect(() => {
    refreshAudiobooks()
  }, [refreshAudiobooks])

  useEffect(() => {
    if (!isPanelOpen) return
    refreshAudiobooks()
  }, [isPanelOpen, refreshAudiobooks])

  useEffect(() => {
    if (!isPanelOpen || !isCommentStudioOpen) return
    void refreshCommentStudioAudiobook(latestAudiobook)
  }, [isPanelOpen, isCommentStudioOpen, latestAudiobook, refreshCommentStudioAudiobook])

  useEffect(() => {
    if (!isPanelOpen) {
      setIsCommentStudioOpen(false)
    }
  }, [isPanelOpen])

  useEffect(() => {
    if (!isPanelOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPanelOpen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isPanelOpen])

  useEffect(() => {
    setIsPanelOpen(false)
  }, [pathname])

  const closePanel = () => {
    setIsPanelOpen(false)
    setIsCommentStudioOpen(false)
  }

  async function handleWipeData() {
    if (busyAction || !confirm("Are you sure you want to wipe all data? This cannot be undone.")) {
      return
    }

    try {
      setBusyAction("wipe")
      await clearAllData()
      clearEnvironmentPreferences()
      toast.success("All data cleared successfully")
      await refreshAudiobooks()
      router.push("/")
      closePanel()
    } catch (error) {
      console.error("Error wiping data:", error)
      toast.error("Failed to clear data")
    } finally {
      setBusyAction(null)
    }
  }

  function handleSessionUploadClick() {
    if (!hasAudiobooks) {
      toast.info("Load a tape before restoring a session.")
      return
    }
    sessionUploadInputRef.current?.click()
  }

  function normalizeTitle(value?: string | null) {
    return value?.trim().toLowerCase() ?? ""
  }

  function extractSessionFromPayload(payload: unknown, audiobook: StoredAudiobook): SessionData {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid session backup format.")
    }

    const data = payload as { session?: SessionData; audiobookId?: string; audiobookTitle?: string }
    const payloadTitle = normalizeTitle(data.audiobookTitle)
    const currentTitle = normalizeTitle(audiobook.metadata?.title)

    if (payloadTitle && currentTitle && payloadTitle !== currentTitle) {
      throw new Error(
        data.audiobookTitle
          ? `This backup belongs to “${data.audiobookTitle}”. Load that book first.`
          : "This backup belongs to a different tape.",
      )
    } else if (!payloadTitle && data.audiobookId && data.audiobookId !== audiobook.id) {
      throw new Error("This backup belongs to a different tape.")
    }

    if (data.session && typeof data.session === "object") {
      return data.session
    }

    const looksLikeSession =
      typeof (data as SessionData).userName === "string" && typeof (data as SessionData).currentChunkId === "string"
    if (looksLikeSession) {
      return data as SessionData
    }

    throw new Error("Invalid session backup format.")
  }

  function findMatchingAudiobook(
    books: StoredAudiobook[],
    payloadTitle?: string | null,
    fallbackId?: string | null,
  ): StoredAudiobook | undefined {
    if (!books.length) return undefined
    const normalizedPayload = normalizeTitle(payloadTitle)
    if (normalizedPayload) {
      const byTitle = books.find((book) => normalizeTitle(book.metadata?.title) === normalizedPayload)
      if (byTitle) {
        return byTitle
      }
    }
    if (fallbackId) {
      const byId = books.find((book) => book.id === fallbackId)
      if (byId) {
        return byId
      }
    }
    return books[0]
  }

  async function handleSessionUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!hasAudiobooks) {
      toast.error("Load a tape before restoring a session.")
      event.target.value = ""
      return
    }

    try {
      setBusyAction("upload")
      const books = await getAllAudiobooks()
      if (!books.length) {
        throw new Error("No tapes available. Upload your Walking Book first.")
      }
      const text = await file.text()
      const payload = JSON.parse(text)
      const targetAudiobook =
        findMatchingAudiobook(books, payload?.audiobookTitle, payload?.audiobookId) ?? latestAudiobook ?? books[0]
      if (!targetAudiobook) {
        toast.error("Could not find a tape for this session. Upload your Walking Book first.")
        return
      }

      const rawSession = extractSessionFromPayload(payload, targetAudiobook)
      const normalizedSession = sanitizeSessionData(
        {
          ...rawSession,
          edits: Array.isArray(rawSession.edits) ? rawSession.edits : [],
        },
        targetAudiobook.manifest.chunks,
      )

      await saveSession(targetAudiobook.id, normalizedSession)
      updateEnvironment({ userName: normalizedSession.userName })
      toast.success(`Session restored to ${targetAudiobook.metadata.title}`)
      await refreshAudiobooks()
      closePanel()
      const sessionUrl = `/reader?id=${encodeURIComponent(targetAudiobook.id)}&restored=${Date.now()}`
      router.push(sessionUrl)
    } catch (error) {
      console.error("Session upload error:", error)
      toast.error(error instanceof Error ? error.message : "Failed to upload session")
    } finally {
      setBusyAction(null)
      event.target.value = ""
    }
  }

  function handleCommentStudioToggle() {
    setIsCommentStudioOpen((prev) => !prev)
    const book = commentStudioAudiobook ?? latestAudiobook
    setCommentJsonSource(book?.session ? "session" : "upload")
  }

  const sessionCommentsFile = useMemo(() => {
    const book = commentStudioAudiobook ?? latestAudiobook
    if (!book?.session) return null
    try {
      const blob = exportCommentsJson(book, book.session)
      const safeTitle = (book.metadata?.title || "document").replace(/[^\w\-]+/g, "_")
      return new File([blob], `${safeTitle}_comments.json`, { type: "application/json" })
    } catch {
      return null
    }
  }, [commentStudioAudiobook, latestAudiobook])

  const effectiveCommentJsonFile = useMemo(() => {
    if (commentJsonSource === "session") return sessionCommentsFile
    return commentJsonUploadFile
  }, [commentJsonSource, sessionCommentsFile, commentJsonUploadFile])

  function handleNavigate(link: ZineNavLink) {
    closePanel()
    const { href, external } = link
    if (external) {
      window.open(href, "_blank", "noopener,noreferrer")
      return
    }
    if (href.startsWith("mailto:")) {
      window.location.href = href
      return
    }
    router.push(href)
  }

  const sectionLabelClass = "text-xs font-sans font-semibold uppercase text-black-text/70"
  const actionButtonClass =
    "w-full flex items-start justify-between gap-4 rounded-2xl border-2 border-black-text bg-white-text px-4 py-3 text-left text-black-text shadow-[6px_6px_0_0_rgba(35,31,32,0.12)] transition hover:bg-white-text/90 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white-text"
  const actionTitleClass = "font-sans text-xs font-bold uppercase"
  const actionDescriptionClass = "mt-1 text-sm text-black-text/70"

  const quickActions: Array<{
    key: string
    label: string
    description: string
    icon: LucideIcon
    onClick: () => void
    disabled?: boolean
  }> = [
    {
      key: "comment-studio",
      label: isCommentStudioOpen ? "Close Comment Studio" : "Comment Studio",
      description: "Merge / export Word comments",
      icon: MessageSquareText,
      onClick: handleCommentStudioToggle,
    },
    {
      key: "session-upload",
      label: busyAction === "upload" ? "Uploading..." : "Upload Session",
      description: latestAudiobook ? "Restore session backup" : "Load a tape first",
      icon: UploadCloud,
      onClick: handleSessionUploadClick,
      disabled: busyAction === "upload" || !latestAudiobook,
    },
    {
      key: "wipe",
      label: busyAction === "wipe" ? "Wiping..." : "Wipe All",
      description: "Erase every tape and preference",
      icon: Trash2,
      onClick: handleWipeData,
      disabled: busyAction !== null,
    },
  ]

  return (
    <div className="relative">
      <button
        ref={triggerButtonRef}
        onClick={() => setIsPanelOpen(true)}
        className={`p-2 rounded transition-colors ${triggerHover} ${className}`}
        aria-label="Open menu"
      >
        {children ? (
          children
        ) : (
          <img
            src="/menu.svg"
            alt=""
            aria-hidden="true"
            className={`h-8 w-8 ${triggerIconFilter}`}
          />
        )}
      </button>

      {isPanelOpen && (
        <>
          <div className="fixed inset-0 bg-black-text/60 z-40" onClick={closePanel} aria-hidden="true" />

          <aside
            className="fixed right-0 top-0 h-full w-full max-w-sm z-50 flex flex-col border-l-2 border-black-text bg-[color:var(--color-orange)] text-black-text"
          >
            <div className="flex items-center justify-between px-6 py-5 border-b-2 border-black-text">
              <div>
                <p className="text-xs font-sans font-semibold uppercase text-black-text/70">Menu</p>
                <p className="text-2xl font-bold font-sans text-black-text">Walking Book</p>
              </div>
              <button
                onClick={closePanel}
                className="p-2 rounded-full border-2 border-black-text bg-white-text hover:bg-white-text/90 transition-colors"
                aria-label="Close menu"
              >
                <X className="h-6 w-6 text-black-text" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
              <section>
                <div className={sectionLabelClass}>Navigate</div>
                <div className="mt-3 border-y-2 border-black-text divide-y-2 divide-black-text">
                  {NAV_LINKS.map((link) => {
                    const normalizedHref =
                      link.href.startsWith("/") && !link.href.includes("?") ? link.href : null
                    const isActive = link.activeMatch
                      ? link.activeMatch(pathname)
                      : normalizedHref
                        ? pathname?.startsWith(normalizedHref)
                        : false

                    const handleClick = () => handleNavigate(link)

                    return (
                      <button
                        key={link.label}
                        onClick={handleClick}
                        className={`group w-full flex items-center justify-between py-3 text-left transition-colors ${
                          isActive ? "text-black-text font-semibold" : "text-black-text/80 hover:text-black-text"
                        }`}
                      >
                        <span className="font-sans text-xs uppercase group-hover:underline">{link.label}</span>
                        <span className="text-xs text-black-text/70" aria-hidden="true">
                          ↗
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section>
                <div className={sectionLabelClass}>Tools</div>
                <div className="mt-3 space-y-3">
                  {quickActions.map(({ key, label, description, icon: Icon, onClick, disabled }) => {
                    const showSpinner = key === "session-upload" && busyAction === "upload"
                    return (
                      <button
                        key={key}
                        onClick={onClick}
                        disabled={disabled}
                        className={actionButtonClass}
                      >
                        <div>
                          <p className={actionTitleClass}>{label}</p>
                          <p className={actionDescriptionClass}>{description}</p>
                        </div>
                        {showSpinner ? (
                          <Loader2 className="h-5 w-5 text-black-text/70 animate-spin" aria-hidden="true" />
                        ) : (
                          <Icon className="h-5 w-5 text-black-text/70" aria-hidden="true" />
                        )}
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => window.open(GITHUB_REPO_URL, "_blank", "noopener,noreferrer")}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-black-text px-4 py-3 font-sans text-xs font-bold uppercase tracking-[0.3em] text-white-text transition-opacity hover:opacity-90"
                >
                  <GitFork className="h-4 w-4" aria-hidden="true" />
                  Fork on GitHub
                </button>
              </section>

              {isCommentStudioOpen && (
                <section
                  ref={commentStudioSectionRef}
                  className="border-2 border-black-text rounded-2xl p-4 space-y-4 bg-white-text shadow-[6px_6px_0_0_rgba(35,31,32,0.12)]"
                >
                  {/*
                    Important: Comment Studio should follow the "active tape" (same as /merge-comments),
                    not just "latest uploaded tape", otherwise merges/exports can target the wrong session.
                  */}
                  {(() => {
                    const book = commentStudioAudiobook ?? latestAudiobook
                    const title = book?.metadata?.title
                    return (
                      <div className={sectionLabelClass}>
                        Comment Studio{title ? `: ${title}` : ""}
                      </div>
                    )
                  })()}

                  <div className="text-xs text-black-text/70">
                    Export session comments or merge a comments JSON into an existing DOCX (runs on your device).
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-sans font-semibold uppercase text-black-text/70">Quick export</div>
                    <div className="grid gap-2">
                      <button
                        type="button"
                        className="w-full text-left px-4 py-3 rounded-xl border-2 border-black-text bg-black-text text-white-text hover:bg-black-text/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!(commentStudioAudiobook ?? latestAudiobook)?.session || commentBusy || commentQuickBusy !== null}
                        onClick={async () => {
                          const book = commentStudioAudiobook ?? latestAudiobook
                          if (!book?.session) return
                          try {
                            setCommentQuickBusy("docx")
                            await downloadDocx(book, book.session)
                            toast.success("DOCX download ready")
                          } catch (error) {
                            console.error(error)
                            toast.error("Failed to export DOCX")
                          } finally {
                            setCommentQuickBusy(null)
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-white-text">
                            {commentQuickBusy === "docx" ? "Preparing..." : "Download DOCX with comments"}
                          </span>
                          <Download className="h-4 w-4 text-white-text/70" />
                        </div>
                        <div className="text-xs text-white-text/60 mt-1">
                          {(commentStudioAudiobook ?? latestAudiobook)?.session
                            ? "Instant Word file with your session edits as comments"
                            : "Load a tape with a session first"}
                        </div>
                      </button>

                      <button
                        type="button"
                        className="w-full text-left px-4 py-3 rounded-xl border-2 border-black-text bg-white-text hover:bg-black-text/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!(commentStudioAudiobook ?? latestAudiobook)?.session || commentBusy || commentQuickBusy !== null}
                        onClick={async () => {
                          const book = commentStudioAudiobook ?? latestAudiobook
                          if (!book?.session) return
                          try {
                            setCommentQuickBusy("comments")
                            await downloadCommentsJson(book, book.session)
                            toast.success("Comments JSON downloaded")
                          } catch (error) {
                            console.error(error)
                            toast.error("Failed to export comments JSON")
                          } finally {
                            setCommentQuickBusy(null)
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-black-text">
                            {commentQuickBusy === "comments" ? "Preparing..." : "Download comments file"}
                          </span>
                          <Download className="h-4 w-4 text-black-text/70" />
                        </div>
                        <div className="text-xs text-black-text/60 mt-1">
                          Use this file to merge comments into any DOCX below
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-black-text/10 pt-3">
                    <div className="text-xs font-sans font-semibold uppercase text-black-text/70">Merge into a DOCX</div>

                    <div className="space-y-2">
                      <div className="text-xs text-black-text/60 uppercase tracking-[0.3em]">DOCX document</div>
                      <Input
                        type="file"
                        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        disabled={commentBusy}
                        onChange={(e) => setCommentDocxFile(e.target.files?.[0] ?? null)}
                      />
                      {commentDocxFile && (
                        <div className="text-xs text-black-text/60 break-words">Selected: {commentDocxFile.name}</div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-black-text/60 uppercase tracking-[0.3em]">Comments source</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg border-2 border-black-text text-xs font-semibold bg-black-text text-white-text hover:bg-black-text/90 disabled:opacity-50"
                          disabled={!sessionCommentsFile || commentBusy}
                          onClick={() => setCommentJsonSource("session")}
                        >
                          Use Current Comments
                        </button>
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg border-2 border-black-text text-xs font-semibold bg-white-text hover:bg-black-text/5 disabled:opacity-50"
                          disabled={commentBusy}
                          onClick={() => setCommentJsonSource("upload")}
                        >
                          Upload Other Comments File
                        </button>
                      </div>

                      {commentJsonSource === "session" ? (
                        <div className="text-xs text-black-text/60 break-words">
                          {sessionCommentsFile ? `Using: ${sessionCommentsFile.name}` : "No session comments available."}
                        </div>
                      ) : (
                        <>
                          <Input
                            type="file"
                            accept=".json,application/json"
                            disabled={commentBusy}
                            onChange={(e) => setCommentJsonUploadFile(e.target.files?.[0] ?? null)}
                          />
                          {commentJsonUploadFile && (
                            <div className="text-xs text-black-text/60 break-words">
                              Selected: {commentJsonUploadFile.name}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className="w-full rounded-xl border-2 border-black-text bg-black-text px-4 py-3 text-left text-white-text font-semibold transition hover:bg-black-text/90 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!commentDocxFile || !effectiveCommentJsonFile || commentBusy}
                      onClick={async () => {
                        if (!commentDocxFile || !effectiveCommentJsonFile) return
                        try {
                          setCommentBusy(true)
                          setCommentMergeResult(null)
                          const { blob, result } = await mergeDocxAddNativeCommentsInPlace(
                            commentDocxFile,
                            effectiveCommentJsonFile,
                          )
                          setCommentMergeResult(result)
                          const base = commentDocxFile.name.replace(/\.docx$/i, "")
                          const outputName = `${base || "document"}_merged.docx`
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement("a")
                          a.href = url
                          a.download = outputName
                          document.body.appendChild(a)
                          a.click()
                          a.remove()
                          window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
                          toast.success(`Merged ${result.mergedCount} comment(s).`)
                        } catch (error) {
                          console.error(error)
                          toast.error(error instanceof Error ? error.message : "Failed to merge comments")
                        } finally {
                          setCommentBusy(false)
                        }
                      }}
                    >
                      {commentBusy ? "Merging..." : "Merge & Download DOCX"}
                    </button>

                    {commentMergeResult && (
                      <div className="rounded-xl border border-black-text/10 bg-black-text/5 p-3 text-xs text-black-text/80">
                        Merged <b>{commentMergeResult.mergedCount}</b> of <b>{commentMergeResult.totalCount}</b>{" "}
                        comment(s).
                      </div>
                    )}

                    <button
                      type="button"
                      className="w-full text-left px-4 py-3 rounded-xl border-2 border-black-text bg-white-text hover:bg-black-text/5 transition-colors"
                      onClick={() => {
                        closePanel()
                        router.push("/merge-comments")
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-black-text">Open full Comment Studio page</span>
                        <span className="text-xs text-black-text/60">↗</span>
                      </div>
                      <div className="text-xs text-black-text/60 mt-1">More detail + result preview</div>
                    </button>
                  </div>
                </section>
              )}
            </div>
          </aside>

          <input
            ref={sessionUploadInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleSessionUpload}
            className="hidden"
          />
        </>
      )}
    </div>
  )
}
