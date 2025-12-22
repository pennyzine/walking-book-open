import { InfoPageTemplate } from "@/components/info-page-template"

const POLICIES = [
  {
    title: "Local-first data",
    body: "Audio files, manifests, and edit sessions stay inside your browser's IndexedDB. We never upload tapes unless you export and share them yourself.",
  },
  {
    title: "No tracking pixels",
    body: "We only collect anonymous uptime metrics for the web app. There are no advertising IDs, fingerprinting scripts, or session replays.",
  },
  {
    title: "Simple exports",
    body: "When you request a download, the bundle is generated client-side and handed directly to you. We do not proxy those files through external servers.",
  },
]

const PRIVACY_PARAGRAPHS = [
  "Walking Book is architected to run entirely on-device. Clearing data from the menu fully wipes IndexedDB storage so you control how long a tape lives on your hardware.",
  "We design with the paranoia of writers worried about forced AI training: fewer servers, no trackers, and transparent exits when you are done experimenting.",
]

export default function PrivacyPage() {
  return (
    <InfoPageTemplate
      eyebrow="Privacy"
      metaLabel="Local-first log"
      title="We keep your tapes private"
      paragraphs={PRIVACY_PARAGRAPHS}
      accentWord="Privacy"
    >
      <div className="space-y-5">
        <p className="text-xs font-sans uppercase tracking-[0.3em] text-black-text">Policies</p>
        <div className="grid gap-4 md:grid-cols-3">
          {POLICIES.map((policy) => {
            return (
              <article
                key={policy.title}
                className="border-2 border-black-text bg-white-text p-5 shadow-[6px_6px_0_0_rgba(35,31,32,0.12)]"
              >
                <h3 className="font-sans text-lg font-semibold text-black-text">{policy.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-foreground/80">{policy.body}</p>
              </article>
            )
          })}
        </div>
      </div>
    </InfoPageTemplate>
  )
}
