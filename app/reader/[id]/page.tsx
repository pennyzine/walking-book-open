"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ACTIVE_AUDIOBOOK_STORAGE_KEY } from "@/lib/constants"

interface ReaderRouteProps {
  params: {
    id: string
  }
}

export default function LegacyReaderRedirect({ params }: ReaderRouteProps) {
  const router = useRouter()
  const { id } = params

  useEffect(() => {
    if (!id) return
    try {
      localStorage.setItem(ACTIVE_AUDIOBOOK_STORAGE_KEY, id)
    } catch (error) {
      console.warn("Failed to persist active audiobook id", error)
    }
    const search = new URLSearchParams({ id }).toString()
    router.replace(`/reader?${search}`)
  }, [id, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#231F20] text-white-text">
      <p className="font-sans opacity-80">Opening reader…</p>
    </div>
  )
}
