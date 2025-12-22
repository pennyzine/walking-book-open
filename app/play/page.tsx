import Link from "next/link"

import { MenuDropdown } from "@/components/menu-dropdown"

const ACCENT_COLORS = [
  { name: "orange", solid: "var(--color-orange)", soft: "#FF751F1a" },
  { name: "white", solid: "var(--color-white-text)", soft: "#F6F8EF14" },
] as const

const accentFor = (index: number) => ACCENT_COLORS[index % ACCENT_COLORS.length]

const PLAY_STEPS = [
  {
    title: "Resume instantly",
    detail: "Open the menu from anywhere to jump back into the most recent tape you loaded.",
  },
  {
    title: "Reference your edits",
    detail: "Session logs keep every punch-in, so you can relive notes before exporting.",
  },
  {
    title: "Download when ready",
    detail: "Exports bundle audio stems, manifest, session, and edit history in one file.",
  },
]

export default function PlayPage() {
  return (
    <div className="min-h-screen bg-[#231F20] text-[#F6F8EF] flex flex-col">
      <header className="px-6 py-6 md:px-12 md:py-10 border-b border-white-text/10 flex items-center justify-between">
        <Link
          href="/"
          className="text-2xl md:text-4xl font-bold font-sans tracking-tight hover:opacity-80 transition-opacity"
        >
          Walking Book
        </Link>
        <MenuDropdown variant="dark" />
      </header>

      <main className="flex-1 px-6 py-10 md:px-16 md:py-16 space-y-12">
        <div className="flex gap-3 md:gap-4">
          {ACCENT_COLORS.map((accent) => (
            <span
              key={accent.name}
              className="h-2 w-full rounded-full border border-white-text/10"
              style={{ backgroundColor: accent.solid }}
            />
          ))}
        </div>

        <section
          className="max-w-3xl space-y-6 border-l-4 pl-6 md:pl-10"
          style={{ borderColor: "var(--color-orange)", backgroundColor: "#FF751F14" }}
        >
          <p className="text-sm uppercase tracking-[0.4em] text-white-text/60">Play</p>
          <h1 className="text-4xl md:text-6xl font-bold font-sans">Press play from any device</h1>
          <p className="text-lg md:text-xl font-sans text-white-text/80 leading-relaxed">
            Upload a tape once and it lives entirely offline in your browser. The player respects every screen size:
            portrait mobile layouts keep thumbs near primary controls and desktop builds stretch out with edit logs.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          {PLAY_STEPS.map((step, index) => {
            const accent = accentFor(index)
            return (
              <div
                key={step.title}
                className="border-2 rounded-3xl p-6 md:p-8 text-white-text"
                style={{ borderColor: accent.solid, backgroundColor: accent.soft }}
              >
                <p className="text-sm uppercase tracking-[0.3em] mb-3 opacity-70">{step.title}</p>
                <p className="font-sans text-base md:text-lg leading-relaxed">{step.detail}</p>
              </div>
            )
          })}
        </section>

        <section className="border border-white-text/15 rounded-3xl p-6 md:p-10 bg-gradient-to-r from-[#FF751F1f] via-[#FF751F18] to-[#F6F8EF14] flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold font-sans">Need to upload a new tape?</h2>
            <p className="text-base md:text-lg font-sans text-white-text/80 leading-relaxed">
              Use the menu &rarr; Upload Tape control. We wipe the previous session for you so you start fresh every time.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-6 py-3 border-2 border-white-text rounded-full font-sans text-sm uppercase tracking-[0.4em] hover:bg-white-text hover:text-black-text transition-colors"
          >
            Go Home
          </Link>
        </section>
      </main>
    </div>
  )
}
