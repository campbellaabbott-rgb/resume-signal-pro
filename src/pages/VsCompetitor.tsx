// Honest comparison pages, one per competitor, driven by src/data/competitors.
// Same credibility rules as the whole site: our claims are verifiable in one
// free scan; competitor claims are public/stable characteristics, as-of-dated;
// every page names where the competitor wins.

import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowRight, Check, Minus } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { COMPETITORS } from "@/data/competitors";

export default function VsCompetitor() {
  const { slug } = useParams();
  const c = slug ? COMPETITORS[slug] : undefined;
  if (!slug || !c) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`Resume Booster vs ${c.name} — An Honest Comparison`}
        description={`How Resume Booster's free diagnostic scan compares to ${c.name}: free-tier depth, score transparency, verified output — and where ${c.name} is genuinely stronger.`}
        path={`/vs/${slug}`}
      />
      <Header />
      <main className="pt-28 pb-20">
        <div className="container max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Resume Booster vs {c.name}</h1>
          <p className="text-muted-foreground mb-2">
            {c.intro} An honest comparison — including the rows where {c.name} is stronger. Every claim in our column
            is verifiable by running one free scan; claims about {c.name} reflect their public product as of mid-2026
            and may change.
          </p>
          <p className="text-xs text-muted-foreground mb-8">
            {c.name} is a trademark of its owner; we're not affiliated.
          </p>

          <div className="space-y-3 mb-10">
            {c.rows.map((r) => (
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
                      {c.name}
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

          <nav className="mt-6 flex flex-wrap gap-2 text-xs" aria-label="Other comparisons">
            {Object.values(COMPETITORS).filter((o) => o.slug !== slug).map((o) => (
              <Link key={o.slug} to={`/vs/${o.slug}`} className="px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                vs {o.name} →
              </Link>
            ))}
          </nav>
        </div>
      </main>
      <Footer />
    </div>
  );
}
