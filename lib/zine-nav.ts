export type ZineNavLink = {
  label: string
  href: string
  external?: boolean
  activeMatch?: (pathname?: string | null) => boolean
}

export const ZINE_NAV_LINKS: ZineNavLink[] = [
  { label: "Quick Start Guide", href: "/?quickstart=1" },
  {
    label: "Reader",
    href: "/reader",
    activeMatch: (pathname) => pathname === "/reader" || (pathname?.startsWith("/reader/") ?? false),
  },
  { label: "Voices", href: "/voices" },
  {
    label: "Merge Comments",
    href: "/merge-comments",
    activeMatch: (pathname) => pathname?.startsWith("/merge-comments") ?? false,
  },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  {
    label: "Contact",
    href: "mailto:kate@sixpenny.org",
    external: true,
  },
]
