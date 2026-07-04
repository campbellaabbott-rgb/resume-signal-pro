import { ScanSearch, FileSearch, ListChecks, Users, MessageSquare, ShieldCheck, BarChart3, GitCompare, Globe2 } from "lucide-react";

// Pre-scan expectation setter: exactly what the free report contains, shown
// before anyone uploads. Every item here must correspond to a real report
// section — this list is a promise, keep it honest.
const DELIVERABLES = [
  { icon: ScanSearch, title: "ATS score with full audit", desc: "0–100 score plus a point-by-point breakdown of exactly where it comes from." },
  { icon: FileSearch, title: "Your resume, X-rayed", desc: "Your actual document annotated line by line — weak bullets, missing numbers, power words." },
  { icon: ListChecks, title: "3 weakest bullets, rewritten", desc: "Quoted from your resume, graded A–F, and rewritten so you can paste the fix." },
  { icon: Users, title: "A recruiter panel verdict", desc: "Three hiring-committee personas react to your resume — screener, hiring manager, HR." },
  { icon: MessageSquare, title: "Interview questions it will trigger", desc: "The exact questions a recruiter will ask based on your gaps, claims, and transitions." },
  { icon: ShieldCheck, title: "Workday, Greenhouse, Lever & iCIMS checks", desc: "How each major ATS parses your specific formatting — and what to fix." },
  { icon: BarChart3, title: "Peer benchmark for your industry", desc: "Where your score sits against candidates in your field, on a real distribution." },
  { icon: GitCompare, title: "A fix plan with projected score", desc: "Prioritized fixes with time estimates — check them off and see your projected score." },
] as const;

export function WhatYouGetSection() {
  return (
    <section className="py-10" aria-labelledby="what-you-get-heading">
      <div className="container max-w-5xl">
        <div className="text-center mb-8">
          <h2 id="what-you-get-heading" className="text-2xl md:text-3xl font-bold mb-2">
            What you get with the free scan
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            No signup, no payment, no resume stored. One upload returns all of this:
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {DELIVERABLES.map((d) => (
            <div key={d.title} className="rounded-2xl border border-border bg-card/60 p-4 hover:border-primary/40 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <d.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">{d.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{d.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Globe2 className="w-3.5 h-3.5 text-primary" />
            59 industries covered — from software to skilled trades
          </span>
          <span>·</span>
          <span>10 languages</span>
          <span>·</span>
          <span>Career-change and new-grad aware</span>
          <span>·</span>
          <span>7 free scans/day (15 with a free account)</span>
        </div>
      </div>
    </section>
  );
}
