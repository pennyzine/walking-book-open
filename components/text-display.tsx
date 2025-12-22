"use client"

import type React from "react"
import { useEffect, useState, useRef, useMemo } from "react"
import type { StoredAudiobook, SessionData } from "@/types/audiobook"
import { cn, hexToRgba } from "@/lib/utils"
import { debugLog } from "@/lib/debug"

interface HighlightedSegment {
  chunkIndex: number
  segmentIndex: number
}

interface TextDisplayProps {
  audiobook: StoredAudiobook
  session: SessionData
  onCursorPositionChange?: (
    chunkIndex: number,
    segmentIndex: number,
    segmentData: { start_time: number; end_time: number },
    audioFile: string,
  ) => void
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
  accentColor?: string
  highlightColor?: string
  textColor?: string
  fontFamily?: string
  highlightedSegment?: HighlightedSegment | null
}

export function TextDisplay({
  audiobook,
  session,
  onCursorPositionChange,
  scrollContainerRef,
  accentColor = "#FF6A00",
  highlightColor = "#FFF799",
  textColor = "#2B2B2B",
  fontFamily = 'var(--reader-font-family, "Shippori Mincho B1", serif)',
  highlightedSegment = null,
}: TextDisplayProps) {
  const [cursorPosition, setCursorPosition] = useState<{ chunkIndex: number; segmentIndex: number }>({
    chunkIndex: audiobook.manifest.chunks.findIndex((c) => c.chunk_id === session.currentChunkId),
    segmentIndex: 0,
  })
  const activeSegmentRef = useRef<HTMLParagraphElement>(null)

  const accentForeground = accentColor
  const highlightForeground = highlightColor
  const highlightSoft = useMemo(() => hexToRgba(highlightForeground, 0.3), [highlightForeground])
  const highlightSoftStrong = useMemo(() => hexToRgba(highlightForeground, 0.5), [highlightForeground])

  // Calculate current reading position across all chunks
  const getCurrentGlobalPosition = () => {
    const currentChunkIndex = audiobook.manifest.chunks.findIndex((c) => c.audio_file === session.currentAudioFile)
    if (currentChunkIndex === -1) {
      // Fallback to chunk_id if no audio file match
      const fallbackIndex = audiobook.manifest.chunks.findIndex((c) => c.chunk_id === session.currentChunkId)
      if (fallbackIndex === -1) return { chunkIndex: 0, segmentIndex: 0 }

      const currentChunk = audiobook.manifest.chunks[fallbackIndex]
      const segmentIndex = currentChunk.timestamps.findIndex((seg, idx) => {
        const nextSeg = currentChunk.timestamps[idx + 1]
        return session.currentTime >= seg.start_time && (!nextSeg || session.currentTime < nextSeg.start_time)
      })
      return { chunkIndex: fallbackIndex, segmentIndex: segmentIndex !== -1 ? segmentIndex : 0 }
    }

    const currentChunk = audiobook.manifest.chunks[currentChunkIndex]
    const segmentIndex = currentChunk.timestamps.findIndex((seg, idx) => {
      const nextSeg = currentChunk.timestamps[idx + 1]
      return session.currentTime >= seg.start_time && (!nextSeg || session.currentTime < nextSeg.start_time)
    })

    return {
      chunkIndex: currentChunkIndex,
      segmentIndex: segmentIndex !== -1 ? segmentIndex : 0,
    }
  }

  const currentPosition = getCurrentGlobalPosition()

  // Auto-scroll to active segment when playing
  useEffect(() => {
    if (activeSegmentRef.current && scrollContainerRef?.current) {
      const container = scrollContainerRef.current
      const element = activeSegmentRef.current
      const containerRect = container.getBoundingClientRect()
      const elementRect = element.getBoundingClientRect()

      // Check if element is not in view
      if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
        element.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }
  }, [currentPosition.chunkIndex, currentPosition.segmentIndex, scrollContainerRef])

  // Update cursor position to follow playback
  useEffect(() => {
    setCursorPosition({
      chunkIndex: currentPosition.chunkIndex,
      segmentIndex: currentPosition.segmentIndex,
    })
  }, [currentPosition.chunkIndex, currentPosition.segmentIndex])

  const handleSegmentClick = (chunkIndex: number, segmentIndex: number) => {
    const chunk = audiobook.manifest.chunks[chunkIndex]
    debugLog("[v0] TEXT-DISPLAY: Segment clicked!", chunkIndex, segmentIndex, "audioFile:", chunk?.audio_file)
    setCursorPosition({ chunkIndex, segmentIndex })
    if (onCursorPositionChange && chunk && chunk.timestamps[segmentIndex]) {
      const segmentData = chunk.timestamps[segmentIndex]
      onCursorPositionChange(chunkIndex, segmentIndex, segmentData, chunk.audio_file)
    } else {
      debugLog("[v0] TEXT-DISPLAY: Could not find segment data for chunkIndex", chunkIndex, segmentIndex)
    }
  }

  return (
    <div className="space-y-8 text-lg leading-relaxed" style={{ color: textColor, fontFamily }}>
      {audiobook.manifest.chunks.map((chunk, chunkIdx) => {
        const heading = getTrackHeading(chunk.title, chunkIdx)
        return (
          <div key={`${chunk.audio_file}-${chunkIdx}`}>
            {heading && (
              <h2 className="font-sans text-lg font-medium mb-4" style={{ color: textColor }}>
                {heading}
              </h2>
            )}
            <div className="space-y-4">
              {chunk.timestamps.map((segment, segmentIdx) => {
                const hasEdit = session.edits.some((e) => e.chunkIndex === chunkIdx && e.segmentIndex === segmentIdx)
                const isCurrentlyReading =
                  chunkIdx === currentPosition.chunkIndex && segmentIdx === currentPosition.segmentIndex
                const isCursorHere =
                  chunkIdx === cursorPosition.chunkIndex && segmentIdx === cursorPosition.segmentIndex
                const isManuallyHighlighted =
                  highlightedSegment?.chunkIndex === chunkIdx && highlightedSegment?.segmentIndex === segmentIdx

                return (
                  <p
                    key={`${chunk.audio_file}-${chunkIdx}-${segmentIdx}`}
                    ref={isCurrentlyReading ? activeSegmentRef : null}
                    onClick={() => handleSegmentClick(chunkIdx, segmentIdx)}
                    className={cn(
                      "transition-all duration-200 cursor-pointer px-3 py-2 rounded relative border-l-4",
                      hasEdit && "underline decoration-2",
                      !isCurrentlyReading && !isCursorHere && "border-transparent hover:bg-white",
                    )}
                    data-chunk-index={chunkIdx}
                    data-segment-index={segmentIdx}
                    style={{
                      boxShadow: isManuallyHighlighted ? `0 0 0 2px ${accentForeground}` : undefined,
                      borderColor: isCurrentlyReading || isCursorHere ? accentForeground : "transparent",
                      backgroundColor: isCurrentlyReading
                        ? highlightSoftStrong
                        : isCursorHere
                          ? highlightSoft
                          : "transparent",
                      color: textColor,
                      textDecorationColor: hasEdit ? accentForeground : undefined,
                    }}
                  >
                    {segment.text}
                  </p>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function getTrackHeading(title: string | undefined, index: number) {
  if (!title || !title.trim()) {
    return `Track ${index + 1}`
  }

  const replaced = title.replace(/\bpart\b/gi, (match) => {
    const isUpper = match === match.toUpperCase()
    const isLower = match === match.toLowerCase()
    if (isUpper) {
      return "TRACK"
    }
    if (isLower) {
      return "track"
    }
    return "Track"
  })

  return replaced
}
