// Index for the 59 programmatic industry pages — a real directory, generated
// from the scanner's live detection tables.

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";

const label = (slug: string) => slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function IndustriesIndex() {
  const slugs = Object.keys(INDUSTRY_KEYWORDS).sort();
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Resume Keywords by Industry — 59 Fields Covered"
        description="ATS keywords, recognized job titles, and expected certifications for 59 industries — straight from the detection engine of a real resume scanner. Nursing to software to skilled trades."
        path="/industries"
      />
      <Header />
      <main className="pt-28 pb-20">
        <div className="container max-w-4xl">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Resume keywords, by industry</h1>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            Every page below is generated from the live data our scanner uses — the keywords it weights, the titles it
            recognizes, the certifications it anchors on, and (where available) skills sourced from the U.S. Department
            of Labor's O*NET database. {slugs.length} industries, updated whenever the engine improves.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {slugs.map((slug) => (
              <Link
                key={slug}
                to={`/industries/${slug}`}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground hover:border-primary/50 transition-colors"
              >
                <span className="capitalize">{label(slug)}</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
