"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { MenuDropdown } from "@/components/menu-dropdown"

type InfoPageTemplateProps = {
  eyebrow?: string
  metaLabel?: string
  title: string
  paragraphs: string[]
  accentWord?: string
  children?: ReactNode
}

export function InfoPageTemplate({
  eyebrow,
  metaLabel,
  title,
  paragraphs,
  accentWord,
  children,
}: InfoPageTemplateProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white-text text-black-text">
      <header className="bg-[color:var(--color-dark-sidebar)] text-white-text">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 md:px-12">
          <Link href="/" className="font-sans text-3xl font-bold tracking-tight md:text-5xl">
            Walking Book
          </Link>
          <MenuDropdown variant="dark" />
        </div>
      </header>

      <main className="flex-1 px-6 py-10 md:px-12 md:py-16">
        <section className="mx-auto w-full max-w-5xl">
          {(eyebrow || metaLabel) && (
            <div className="flex flex-wrap items-baseline justify-between gap-3 text-[0.65rem] font-sans tracking-[0.12em] text-black-text">
              <span>{eyebrow}</span>
              {metaLabel && <span>{metaLabel}</span>}
            </div>
          )}

          <div className="mt-6 space-y-6">
            <h1 className="font-sans text-4xl font-bold leading-tight text-black-text md:text-6xl">
              {title}
            </h1>
            <div className="grid gap-6 text-lg leading-relaxed text-foreground/80 md:grid-cols-2">
              {paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </div>

          {accentWord && (
            <div className="mt-6 mb-6 max-w-full whitespace-nowrap text-[clamp(3.75rem,18vw,10rem)] font-serif font-semibold leading-none text-[color:var(--color-orange)] opacity-25 md:mt-12 md:mb-0 md:text-[clamp(2.5rem,12vw,10rem)]">
              {accentWord}
            </div>
          )}

          {children && <div className="mt-10 border-t border-border/60 pt-8">{children}</div>}
        </section>
      </main>
    </div>
  )
}
