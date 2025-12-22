import { InfoPageTemplate } from "@/components/info-page-template"

const TERMS_SECTIONS = [
  {
    title: "Acceptable use",
    body: "Do not upload tapes you do not own. Walking Book is meant for personal or team-owned manuscripts and recordings.",
  },
  {
    title: "No warranty",
    body: "We provide the editor as-is. Always keep your own backups via the Export controls before wiping data or uploading a new tape.",
  },
  {
    title: "Updates",
    body: "We may ship design or feature changes without notice. When we introduce additional services, new terms will appear here first.",
  },
]

const TERMS_PARAGRAPHS = [
  "By using Walking Book you agree to keep your own backups, respect other authors, and use the software in good faith. These terms are intentionally lightweight while the project is in public preview.",
  "This is a quick ledger of how we expect the work to circulate while the tools mature.",
]

export default function TermsPage() {
  return (
    <InfoPageTemplate
      eyebrow="Terms"
      metaLabel="Hey, Beautiful!"
      title="House rules for the preview"
      paragraphs={TERMS_PARAGRAPHS}
      accentWord="Terms"
    >
      <div className="space-y-5">
        <p className="text-xs font-sans uppercase tracking-[0.3em] text-black-text">House rules</p>
        <div className="grid gap-4 md:grid-cols-3">
          {TERMS_SECTIONS.map((section) => {
            return (
              <article
                key={section.title}
                className="border-2 border-black-text bg-white-text p-5 shadow-[6px_6px_0_0_rgba(35,31,32,0.12)]"
              >
                <h3 className="font-sans text-lg font-semibold text-black-text">{section.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-foreground/80">{section.body}</p>
              </article>
            )
          })}
        </div>
      </div>
    </InfoPageTemplate>
  )
}
