"use client"

import { useState, useRef, type ChangeEvent } from "react"
import { Download, Loader2 } from "lucide-react"
import type { StoredAudiobook, SessionData } from "@/types/audiobook"
import { downloadCommentsJson, downloadDocx, downloadSessionBackup, downloadZip } from "@/lib/downloads"
import { toast } from "sonner"

interface ExportControlsProps {
  audiobook: StoredAudiobook
  session: SessionData
  onSessionImport?: (session: SessionData) => Promise<void> | void
}

export function ExportControls({ audiobook, session, onSessionImport }: ExportControlsProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExportZip() {
    if (isExporting) return // Prevent double-execution
    setIsExporting(true)
    setShowMenu(false)
    try {
      await downloadZip(audiobook, session)
      toast.success("Exported as ZIP with session log")
    } catch (error) {
      console.error("Export error:", error)
      toast.error("Failed to export")
    } finally {
      setIsExporting(false)
    }
  }

  async function handleExportDocx() {
    if (isExporting) return // Prevent double-execution
    setIsExporting(true)
    setShowMenu(false)
    try {
      await downloadDocx(audiobook, session)
      toast.success("Exported as Word document with edits")
    } catch (error) {
      console.error("Export error:", error)
      toast.error("Failed to export")
    } finally {
      setIsExporting(false)
    }
  }

  async function handleExportCommentsJson() {
    if (isExporting) return
    setIsExporting(true)
    setShowMenu(false)
    try {
      await downloadCommentsJson(audiobook, session)
      toast.success("Downloaded comments JSON")
    } catch (error) {
      console.error("Comments export error:", error)
      toast.error("Failed to export comments")
    } finally {
      setIsExporting(false)
    }
  }

  async function handleExportSessionBackup() {
    if (isExporting) return
    setIsExporting(true)
    setShowMenu(false)
    try {
      await downloadSessionBackup(audiobook, session)
      toast.success("Session backup downloaded")
    } catch (error) {
      console.error("Session backup export error:", error)
      toast.error("Failed to export session backup")
    } finally {
      setIsExporting(false)
    }
  }

  async function handleSessionUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (isExporting) {
      event.target.value = ""
      return
    }

    setIsExporting(true)
    setShowMenu(false)

    try {
      const text = await file.text()
      const payload = JSON.parse(text)

      let importedSession: SessionData | undefined
      if (payload?.session && typeof payload.session === "object") {
        if (payload.audiobookId && payload.audiobookId !== audiobook.id) {
          throw new Error("This backup belongs to a different audiobook.")
        }
        importedSession = payload.session as SessionData
      } else if (payload && typeof payload === "object") {
        if (payload.audiobookId && payload.audiobookId !== audiobook.id) {
          throw new Error("This backup belongs to a different audiobook.")
        }

        const looksLikeSession =
          typeof payload.userName === "string" &&
          typeof payload.currentChunkId === "string" &&
          Array.isArray(payload.edits)

        if (looksLikeSession) {
          importedSession = payload as SessionData
        }
      }

      if (!importedSession) {
        throw new Error("Invalid session backup format.")
      }

      if (!Array.isArray(importedSession.edits)) {
        importedSession = { ...importedSession, edits: [] }
      }

      if (!onSessionImport) {
        throw new Error("Session upload is not available in this view.")
      }

      await onSessionImport(importedSession)
      toast.success("Session restored")
    } catch (error) {
      console.error("Session import error:", error)
      toast.error(error instanceof Error ? error.message : "Failed to import session backup")
    } finally {
      setIsExporting(false)
      event.target.value = ""
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        disabled={isExporting}
        className="flex items-center gap-2 px-4 py-3 border-2 border-black-text bg-white hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isExporting ? (
          <Loader2 className="h-5 w-5 animate-spin text-black-text" />
        ) : (
          <Download className="h-5 w-5 text-black-text" />
        )}
        <span className="font-sans font-medium text-black-text text-sm hidden md:inline">Download</span>
      </button>

      {showMenu && (
        <div className="absolute right-0 bottom-full mb-2 bg-white border-2 border-black-text rounded shadow-lg min-w-[200px] z-50">
          <button
            onClick={handleExportZip}
            disabled={isExporting}
            className="w-full text-left px-4 py-3 hover:bg-gray-100 font-sans text-sm border-b border-black-text disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export as ZIP
            <div className="text-xs text-gray-500">With session log</div>
          </button>
          <button
            onClick={handleExportDocx}
            disabled={isExporting}
            className="w-full text-left px-4 py-3 hover:bg-gray-100 font-sans text-sm border-b border-black-text disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export as Word
            <div className="text-xs text-gray-500">With edit comments</div>
          </button>
          <button
            onClick={handleExportCommentsJson}
            disabled={isExporting}
            className="w-full text-left px-4 py-3 hover:bg-gray-100 font-sans text-sm border-b border-black-text disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Comments JSON
            <div className="text-xs text-gray-500">Anchor + note text</div>
          </button>
          <button
            onClick={handleExportSessionBackup}
            disabled={isExporting}
            className="w-full text-left px-4 py-3 hover:bg-gray-100 font-sans text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Session Backup
            <div className="text-xs text-gray-500">Progress & preferences</div>
          </button>
          {onSessionImport && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isExporting}
              className="w-full text-left px-4 py-3 hover:bg-gray-100 font-sans text-sm border-t border-black-text disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Upload Backup
              <div className="text-xs text-gray-500">Restore name and comments</div>
            </button>
          )}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleSessionUpload}
      />
    </div>
  )
}
