"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

interface EditableGreetingProps {
  /** Current committed name (empty string means unset). */
  name: string
  /** Called when the user commits a new name. */
  onCommit: (nextName: string) => void
  className?: string
  placeholder?: string
  placeholderClassName?: string
}

export function EditableGreeting({
  name,
  onCommit,
  className,
  placeholder = "Your Name",
  placeholderClassName,
}: EditableGreetingProps) {
  const committed = (name ?? "").trim()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(committed)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isEditing) return
    setDraft(committed)
  }, [committed, isEditing])

  useEffect(() => {
    if (!isEditing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  function commit(next: string) {
    const trimmed = next.trim()
    onCommit(trimmed)
    setIsEditing(false)
  }

  const showPlaceholder = committed.length === 0
  const draftWidthCh = Math.min(Math.max(8, (draft?.length ?? 0) + 1), 24)

  return (
    <div className={cn("font-sans inline-flex items-baseline flex-wrap max-w-full", className)}>
      <span className="mr-1">Hello,</span>
      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit(draft)
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setDraft(committed)
              setIsEditing(false)
            }
          }}
          style={{ width: `${draftWidthCh}ch`, maxWidth: "60vw" }}
          className={cn("bg-transparent outline-none border-b border-current/40 min-w-0 max-w-full", "placeholder:opacity-50")}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className={cn("inline-flex items-baseline gap-0.5 bg-transparent text-left min-w-0 max-w-full")}
          aria-label={showPlaceholder ? "Set your name" : "Edit your name"}
        >
          {showPlaceholder ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block w-[2px] h-[1em] bg-current align-[-0.1em] animate-pulse"
              />
              <span className={cn("opacity-50", placeholderClassName)}>{placeholder}</span>
            </>
          ) : (
            <span className="min-w-0 max-w-full truncate">{committed}</span>
          )}
        </button>
      )}
      {!showPlaceholder && <span>!</span>}
    </div>
  )
}

