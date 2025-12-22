"use client"

import { useCallback, useEffect, useState } from "react"

import {
  applyEnvironment,
  DEFAULT_ENVIRONMENT,
  ENV_CHANGE_EVENT,
  loadEnvironment,
  saveEnvironment,
  type ReaderEnvironmentSettings,
} from "@/lib/preferences"

export function useReaderEnvironment() {
  const [environment, setEnvironment] = useState<ReaderEnvironmentSettings>(DEFAULT_ENVIRONMENT)

  useEffect(() => {
    const initial = loadEnvironment()
    setEnvironment(initial)
    applyEnvironment(initial)

    function handleChange(event: Event) {
      const detail = (event as CustomEvent<ReaderEnvironmentSettings>).detail
      if (detail) {
        setEnvironment(detail)
      }
    }

    window.addEventListener(ENV_CHANGE_EVENT, handleChange as EventListener)
    return () => {
      window.removeEventListener(ENV_CHANGE_EVENT, handleChange as EventListener)
    }
  }, [])

  const updateEnvironment = useCallback((updates: Partial<ReaderEnvironmentSettings>) => {
    setEnvironment((prev) => {
      const next = saveEnvironment({ ...prev, ...updates })
      return next
    })
  }, [])

  const resetEnvironment = useCallback(() => {
    setEnvironment(saveEnvironment(DEFAULT_ENVIRONMENT))
  }, [])

  return {
    environment,
    updateEnvironment,
    resetEnvironment,
  }
}
