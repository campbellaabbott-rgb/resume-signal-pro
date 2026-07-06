// Guides hub (/guides) — index of the data-grounded articles.

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { GUIDES } from "@/data/guides";

export default function GuidesIndex() {
  const guides = Object.values(GUIDES);
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Resume & ATS Guides — From Real Scanner Data"
        description="How ATS systems actually work, how resumes really get rejected, and how to fix yours — every guide grounded in the checks our scanner runs, not folklore."
        path="/guides"
      />
      <Header />
      <main className="pt-20 pb-20">
        <div className="container max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Resume &amp; ATS guides</h1>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            No recycled folklore: every guide below is grounded in the checks our scanner runs on real resumes and
            the documented behavior of real ATS parsers. Where the popular advice is wrong, we say so.
          </p>
          <div className="space-y-3">
            <Link
              to="/research/ats-score-benchmarks"
              className="block rounded-2xl border border-primary/40 bg-primary/5 p-5 hover:border-primary transition-colors"
            >
              <h2 className="font-semibold text-foreground mb-1 flex items-center justify-between gap-3">
                What's a good ATS score? Live benchmarks from real scans
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </h2>
              <p className="text-sm text-muted-foreground">
                Original data, computed live from our scan corpus: overall median and quartiles, per-industry
                benchmarks, and experience-level medians — not folklore thresholds.
              </p>
              <p className="text-xs text-muted-foreground mt-2">Live data study · Updates as scans complete</p>
            </Link>
            {guides.map((g) => (
              <Link
                key={g.slug}
                to={`/guides/${g.slug}`}
                className="block rounded-2xl border border-border bg-card p-5 hover:border-primary/50 transition-colors"
              >
                <h2 className="font-semibold text-foreground mb-1 flex items-center justify-between gap-3">
                  {g.h1}
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </h2>
                <p className="text-sm text-muted-foreground">{g.description}</p>
                <p className="text-xs text-muted-foreground mt-2">{g.minutes} min read · Updated {g.updated}</p>
              </Link>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
