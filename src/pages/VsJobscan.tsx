// Honest comparison page. Same rules as everything on this site: every claim
// about US must be verifiable in the product; claims about Jobscan stick to
// their public, stable characteristics (pricing model, JD-required workflow)
// with an as-of date — no invented numbers, no trash talk.

import { Link } from "react-router-dom";
import { ArrowRight, Check, Minus } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const ROWS: Array<{ dim: string; us: string; them: string; usWins?: boolean }> = [
  { dim: "Free tier", us: "Full diagnostic report — score with audit trail, bullets graded and rewritten, recruiter panel, interview questions, per-vendor ATS checks. 7 scans/day (15 with a free account).", them: "Limited free match reports per month; most findings gated behind the paid plan.", usWins: true },
  { dim: "Works without a job posting", us: "Yes — expectations sourced per-occupation from the U.S. Department of Labor's O*NET database, with the source cited in your report.", them: "Built around pasting a job description; far less useful without one.", usWins: true },
  { dim: "Score honesty", us: "Score shown with its modeling band, a point-by-point audit trail, and a reproducible report ID — same document, same result.", them: "A single match-rate percentage.", usWins: true },
  { dim: "Verified output", us: "Every quoted line in the report is checked against your actual resume before rendering; unverifiable claims are removed.", them: "No equivalent claim made.", usWins: true },
  { dim: "Languages", us: "10 languages, including full Spanish detection.", them: "English-focused.", usWins: true },
  { dim: "Pricing model", us: "Free scan; paid tools $3–29 one-time; optional all-access subscription.", them: "Subscription (roughly $50/month at full price, as of mid-2026).", usWins: true },
  { dim: "Track many applications against JDs", us: "Basic application tracker; deeper per-JD workflow is on our roadmap.", them: "Mature multi-job tracking workflow — their strongest feature.", usWins: false },
  { dim: "Track record", us: "Newer platform (that's exactly why the free tier is this generous).", them: "A decade in market with a large content library.", usWins: false },
];

export default function VsJobscan() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Resume Booster vs Jobscan — An Honest Comparison"
        description="How Resume Booster's free diagnostic scan compares to Jobscan: free-tier depth, score transparency, no-JD scanning, verified output, and where Jobscan is genuinely stronger."
        path="/vs/jobscan"
      />
      <Header />
      <main className="pt-28 pb-20">
        <div className="container max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Resume Booster vs Jobscan</h1>
          <p className="text-muted-foreground mb-2">
            An honest comparison — including the rows where Jobscan is stronger. Every claim in our column is
            verifiable by running one free scan; claims about Jobscan reflect their public product as of mid-2026
            and may change.
          </p>
          <p className="text-xs text-muted-foreground mb-8">
            Jobscan is a registered trademark of its owner; we're not affiliated.
          </p>

          <div className="space-y-3 mb-10">
            {ROWS.map((r) => (
              <div key={r.dim} className="rounded-2xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{r.dim}</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className={`rounded-xl p-3 ${r.usWins ? "bg-success/5 border border-success/25" : "bg-background/40 border border-border"}`}>
                    <p className="text-[11px] font-semibold text-foreground mb-1 flex items-center gap-1.5">
                      {r.usWins ? <Check className="w-3.5 h-3.5 text-success" /> : <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
                      Resume Booster
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{r.us}</p>
                  </div>
                  <div className={`rounded-xl p-3 ${!r.usWins ? "bg-primary/5 border border-primary/25" : "bg-background/40 border border-border"}`}>
                    <p className="text-[11px] font-semibold text-foreground mb-1 flex items-center gap-1.5">
                      {!r.usWins ? <Check className="w-3.5 h-3.5 text-primary" /> : <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
                      Jobscan
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{r.them}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <section className="rounded-2xl border-2 border-primary bg-card p-6 text-center">
            <h2 className="text-xl font-bold mb-2">The comparison that matters: run both, free</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Our free scan gives you the full diagnostic — no signup, no gating, resume never stored.
              Compare the reports yourself; that's the honest test.
            </p>
            <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors">
              Run the free scan <ArrowRight className="w-4 h-4" />
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
