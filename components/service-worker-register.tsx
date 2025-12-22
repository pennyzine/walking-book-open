"use client"

import { useEffect } from "react"
import { debugLog } from "@/lib/debug"

const SW_RELOAD_ONCE_KEY = "walkingbook-sw-reload-once"

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          debugLog("ServiceWorker registration successful with scope: ", registration.scope)
          // On first install (or after an update), the SW won't control the current page
          // until the next navigation. Without a controller, none of our runtime caching
          // (Next bundles, /vendor Moonshine assets) happens, making offline look broken.
          if (!navigator.serviceWorker.controller) {
            try {
              if (sessionStorage.getItem(SW_RELOAD_ONCE_KEY) !== "1") {
                sessionStorage.setItem(SW_RELOAD_ONCE_KEY, "1")
                window.location.reload()
                return
              }
            } catch {
              // If storage is unavailable, avoid infinite reloads.
            }
          }

          try {
            void registration.update()
          } catch {
            // ignore
          }
        })
        .catch((err) => {
          debugLog("ServiceWorker registration failed: ", err)
        })
    }
  }, [])

  return null
}
