import { Scale, ShieldCheck, FileSearch, Globe2 } from "lucide-react";

// Credibility section. Every claim here is verifiable inside the product
// itself — no invented testimonials, no unsourced percentages. If a claim
// can't be checked by clicking around the site, it doesn't belong here.
const TRUST_POINTS = [
  {
    icon: Scale,
    title: "Every point accounted for",
    body: "Your ATS score comes with a full audit trail — keyword coverage, format, quantified impact — each with earned points that sum to your total. No black box.",
  },
  {
    icon: FileSearch,
    title: "Quotes verified against your resume",
    body: "Before your report renders, every claimed quote from your resume is checked against the actual text. Anything the AI can't back up is removed.",
  },
  {
    icon: ShieldCheck,
    title: "Your resume is never stored",
    body: "Free scans run in memory. Accounts keep your scores, credits, and purchases — never your documents.",
  },
  {
    icon: Globe2,
    title: "59 industries, 10 languages",
    body: "From software to skilled trades, with detection tested against a pinned regression suite that runs on every change — including the hard cases most tools misread.",
  },
];

export function SocialProof() {
  return (
    <section className="py-20 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-transparent pointer-events-none" />

      <div className="container relative">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Built to be checked</h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            We don't do fake testimonials or invented statistics. Every claim below is verifiable in the product itself.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {TRUST_POINTS.map((point) => (
            <div
              key={point.title}
              className="relative p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/20 transition-colors"
            >
              <div className="p-2 rounded-lg bg-primary/10 w-fit mb-4">
                <point.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-2">{point.title}</p>
              <p className="text-foreground/80 leading-relaxed text-sm">{point.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
