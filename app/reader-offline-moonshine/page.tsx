"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function ReaderOfflineMoonshineRedirect() {
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get("id")
    const restored = params.get("restored")

    const qs = new URLSearchParams()
    if (id) qs.set("id", id)
    if (restored) qs.set("restored", restored)

    router.replace(qs.toString() ? `/reader?${qs.toString()}` : "/reader")
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#231F20] text-white-text">
      <p className="font-sans opacity-80">Opening reader…</p>
    </div>
  )
}
