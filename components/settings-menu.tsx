"use client"

import { useState } from "react"
import { Settings } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  DEFAULT_ENVIRONMENT,
  RISOGRAPH_ACCENT_SWATCHES,
  RISOGRAPH_BACKGROUND_SWATCHES,
  RISOGRAPH_HIGHLIGHT_SWATCHES,
  READER_FONT_OPTIONS,
  type ReaderEnvironmentSettings,
  type ReaderFontChoice,
} from "@/lib/preferences"

interface SettingsMenuProps {
  preferences: ReaderEnvironmentSettings
  onChange: (updates: Partial<ReaderEnvironmentSettings>) => void
  triggerLabel?: string
  variant?: "light" | "dark"
  onReset?: () => void
  showLabel?: boolean
  layout?: "compact" | "stacked"
}

interface SettingsPanelProps {
  preferences: ReaderEnvironmentSettings
  onChange: (updates: Partial<ReaderEnvironmentSettings>) => void
  theme?: "light" | "dark"
  onReset?: () => void
  layout?: "compact" | "stacked"
}

export function SettingsMenu({
  preferences,
  onChange,
  triggerLabel = "Settings",
  variant = "light",
  onReset,
  showLabel = true,
  layout = "compact",
}: SettingsMenuProps) {
  const [open, setOpen] = useState(false)

  const buttonClasses =
    variant === "dark"
      ? "flex items-center gap-2 px-4 py-3 border-2 border-white-text text-white-text bg-transparent hover:bg-white-text/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      : "flex items-center gap-2 px-4 py-3 border-2 border-black-text bg-white text-black-text hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  const iconColor = variant === "dark" ? "text-white-text" : "text-black-text"
  const panelClass =
    // House modal card: thin black outline + house white surface.
    "bg-white-text text-black-text border border-black-text rounded-2xl shadow-[6px_6px_0_0_rgba(35,31,32,0.12)] p-4 sm:p-6"

  return (
    <div className="relative">
      <button onClick={() => setOpen((prev) => !prev)} className={buttonClasses}>
        <Settings className={`h-5 w-5 ${iconColor}`} />
        {showLabel && <span className="font-sans font-medium text-sm hidden md:inline">{triggerLabel}</span>}
      </button>

      {open && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className={cn("w-full max-w-[420px]", panelClass, "overflow-hidden")}>
            <div className="border-b border-black-text/10 px-1 pb-3">
              <div className="text-xs font-sans font-semibold uppercase tracking-[0.35em] text-black-text/70">
                Settings
              </div>
            </div>
            <div className="max-h-[min(80vh,calc(100dvh-5rem))] overflow-y-auto pt-4">
              <SettingsForm
                preferences={preferences}
                onChange={onChange}
                onClose={() => setOpen(false)}
                onReset={onReset}
                // House modal surface is always light.
                theme="light"
                layout={layout}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsPanel({
  preferences,
  onChange,
  onReset,
  theme = "dark",
  layout = "stacked",
}: SettingsPanelProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border-2 p-4 space-y-4",
        theme === "dark"
          ? "border-white-text/15 bg-white-text/5"
          : "border-black-text/10 bg-white/70 shadow-sm backdrop-blur-sm",
      )}
    >
      <SettingsForm preferences={preferences} onChange={onChange} onReset={onReset} theme={theme} layout={layout} />
    </div>
  )
}

interface SettingsFormProps {
  preferences: ReaderEnvironmentSettings
  onChange: (updates: Partial<ReaderEnvironmentSettings>) => void
  onClose?: () => void
  onReset?: () => void
  theme: "light" | "dark"
  layout?: "compact" | "stacked"
}

function SettingsForm({ preferences, onChange, onClose, onReset, theme, layout = "stacked" }: SettingsFormProps) {
  const labelClass = theme === "dark" ? "text-white-text/80" : "text-black-text/70"
  const helperClass = theme === "dark" ? "text-white-text/60" : "text-black-text/50"
  const buttonClass =
    theme === "dark"
      ? "w-full px-3 py-2 rounded-lg border-2 border-white-text bg-white text-black-text font-semibold"
      : "w-full px-3 py-2 rounded-lg border-2 border-black-text bg-black-text text-white-text font-semibold"
  const resetClass =
    theme === "dark"
      ? "w-full text-center text-xs uppercase tracking-[0.3em] text-white-text/70 hover:text-white-text transition-colors"
      : "w-full text-center text-xs uppercase tracking-[0.3em] text-black-text/60 hover:text-black-text transition-colors"
  const dividerClass = theme === "dark" ? "border-white-text/15" : "border-black-text/10"
  const [activeSection, setActiveSection] = useState<"background" | "highlight" | "accent">("background")

  const sections = [
    {
      key: "background" as const,
      label: "Background",
      options: RISOGRAPH_BACKGROUND_SWATCHES,
      value: preferences.backgroundColor,
      onSelect: (value: string) => onChange({ backgroundColor: value }),
    },
    {
      key: "highlight" as const,
      label: "Highlight",
      options: RISOGRAPH_HIGHLIGHT_SWATCHES,
      value: preferences.highlightColor,
      onSelect: (value: string) => onChange({ highlightColor: value }),
    },
    {
      key: "accent" as const,
      label: "Accent",
      options: RISOGRAPH_ACCENT_SWATCHES,
      value: preferences.accentColor,
      onSelect: (value: string) => onChange({ accentColor: value }),
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] mb-2">
          <span className={labelClass}>Reader Name</span>
          <span className={helperClass}>Personal</span>
        </div>
        <Input
          value={preferences.userName}
          onChange={(event) => onChange({ userName: event.target.value })}
          placeholder="Add your name"
          className={
            theme === "dark"
              ? "bg-white-text/10 border-white-text/20 text-white-text placeholder:text-white-text/40"
              : "bg-white-text border-black-text/20 text-black-text placeholder:text-black-text/50"
          }
        />
      </div>

      {layout === "compact" ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                className={cn(
                  "flex-1 text-xs uppercase tracking-[0.25em] py-2 rounded-lg border",
                  activeSection === section.key
                    ? theme === "dark"
                      ? "border-white-text text-white-text"
                      : "border-black-text text-black-text"
                    : theme === "dark"
                      ? "border-white-text/20 text-white-text/60"
                      : "border-black-text/20 text-black-text/60",
                )}
                onClick={() => setActiveSection(section.key)}
              >
                {section.label}
              </button>
            ))}
          </div>
          {sections
            .filter((section) => section.key === activeSection)
            .map((section) => (
              <ColorOptionGroup
                key={section.key}
                label={section.label}
                options={section.options}
                value={section.value}
                onSelect={section.onSelect}
                theme={theme}
                compact
              />
            ))}
        </div>
      ) : (
        sections.map((section) => (
          <ColorOptionGroup
            key={section.key}
            label={section.label}
            options={section.options}
            value={section.value}
            onSelect={section.onSelect}
            theme={theme}
          />
        ))
      )}

      <FontOptionGroup
        theme={theme}
        value={preferences.fontFamily}
        onSelect={(nextFont) => onChange({ fontFamily: nextFont })}
      />

      {(onClose || onReset) && (
        <div className={`space-y-2 pt-2 border-t ${dividerClass}`}>
          {onClose && (
            <button type="button" className={buttonClass} onClick={onClose}>
              Done
            </button>
          )}
          {onReset && (
            <button
              type="button"
              className={resetClass}
              onClick={() => {
                onReset()
              }}
            >
              Reset to house palette
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface ColorOptionGroupProps {
  label: string
  options: { label: string; value: string }[]
  value: string
  onSelect: (value: string) => void
  theme: "light" | "dark"
  compact?: boolean
}

function ColorOptionGroup({ label, options, value, onSelect, theme, compact = false }: ColorOptionGroupProps) {
  const labelClass = theme === "dark" ? "text-white-text/80" : "text-black-text/70"
  const helperClass = theme === "dark" ? "text-white-text/60" : "text-black-text/50"

  const activeBorder = theme === "dark" ? "border-white-text" : "border-black-text"
  const baseBorder = theme === "dark" ? "border-white-text/15" : "border-black-text/10"

  const activeBg = theme === "dark" ? "bg-white-text/10" : "bg-black-text/5"

  const selectedOption = options.find((option) => option.value === value)

  return (
    <div>
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] mb-2">
        <span className={labelClass}>{label}</span>
        <span className={helperClass}>{selectedOption?.label ?? "Custom"}</span>
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2")}>
        {options.map((option) => {
          const isActive = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              className={cn(
                "flex items-center gap-3 rounded-xl border-2 px-3 py-2 transition-colors",
                baseBorder,
                isActive && `${activeBorder} ${activeBg}`,
                theme === "dark" ? "text-white-text" : "text-black-text",
              )}
              onClick={() => onSelect(option.value)}
            >
              <span
                className="inline-flex h-7 w-7 shrink-0 rounded-full border border-black-text/10"
                style={{ backgroundColor: option.value }}
                aria-hidden="true"
              />
              <span className="text-xs font-medium">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface FontOptionGroupProps {
  value: ReaderFontChoice
  onSelect: (value: ReaderFontChoice) => void
  theme: "light" | "dark"
}

function FontOptionGroup({ value, onSelect, theme }: FontOptionGroupProps) {
  const labelClass = theme === "dark" ? "text-white-text/80" : "text-black-text/70"
  const helperClass = theme === "dark" ? "text-white-text/60" : "text-black-text/50"
  const baseBorder =
    theme === "dark" ? "border-white-text/20 text-white-text/70" : "border-black-text/20 text-black-text/60"
  const activeClasses =
    theme === "dark"
      ? "border-white-text text-white-text bg-white-text/10"
      : "border-black-text text-black-text bg-black-text/5"
  const selectedFont = READER_FONT_OPTIONS.find((option) => option.id === value) ?? READER_FONT_OPTIONS[0]

  return (
      <div className="space-y-2">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em]">
        <span className={labelClass}>Font</span>
        <span className={helperClass}>{selectedFont.label}</span>
      </div>
        <div className="-mx-2 overflow-x-auto pb-1">
          <div className="flex gap-2 px-2">
            {READER_FONT_OPTIONS.map((option) => {
              const isActive = option.id === value
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelect(option.id)}
                  className={cn(
                    "flex-shrink-0 min-w-[140px] rounded-xl border-2 px-4 py-2 text-[0.6rem] uppercase tracking-[0.25em] whitespace-nowrap text-center transition-colors",
                    baseBorder,
                    isActive && activeClasses,
                  )}
                  style={{ fontFamily: option.stack, fontSize: option.id === "dyslexic" ? "0.42rem" : undefined }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      <p className={`text-xs leading-tight ${helperClass}`}>{selectedFont.description}</p>
    </div>
  )
}

export function getFallbackEnvironment(): ReaderEnvironmentSettings {
  return DEFAULT_ENVIRONMENT
}
