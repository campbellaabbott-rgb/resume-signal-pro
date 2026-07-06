// Programmatic SEO: one page per detected industry, generated from the SAME
// data the scanner actually uses — keyword tables, recognized titles,
// certifications, O*NET-sourced skills. This is data, not blogspam: every
// list on this page is live product truth, and it updates when the engine does.

import { useMemo } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { ONET_EXPECTATIONS } from "../../supabase/functions/free-keyword-scan/onet-expectations";
import { SUB_INDUSTRY_TAXONOMY } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { rolesForIndustry } from "@/data/roles";

const label = (slug: string) => slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Keyword chips: short tokens are abbreviations (OR, ICU, EHR, GAAP) — render
// them uppercase; "Or" alone reads like a stray conjunction. Longer terms keep
// CSS title-casing.
const displayKeyword = (k: string) => (k.length <= 4 && !k.includes(" ") ? k.toUpperCase() : k);

import { SCREENER_NOTES } from "@/data/screener-notes";

export default function IndustryKeywords() {
  const { slug } = useParams();
  const data = slug ? INDUSTRY_KEYWORDS[slug] : undefined;
  const onet = slug ? ONET_EXPECTATIONS[slug] : undefined;

  const structured = useMemo(() => {
    if (!slug || !data) return null;
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${label(slug)} Resume Keywords & ATS Expectations`,
      description: `The keywords, titles, and certifications ATS systems and recruiters look for on ${label(slug)} resumes — from the detection engine of a real resume scanner.`,
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://resumebooster.work/" },
          { "@type": "ListItem", position: 2, name: "Industries", item: "https://resumebooster.work/industries" },
          { "@type": "ListItem", position: 3, name: label(slug), item: `https://resumebooster.work/industries/${slug}` },
        ],
      },
    });
  }, [slug, data]);

  if (!slug || !data) return <Navigate to="/industries" replace />;

  const name = label(slug);
  const keywords = [...new Set(data.primary)].slice(0, 24);
  const titles = [...new Set(data.titles)].slice(0, 18);
  const certs = [...new Set(data.certifications)].slice(0, 12);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`${name} Resume Keywords — What ATS Systems Look For`}
        description={`${keywords.slice(0, 6).join(", ")} and more: the actual keywords, job titles, and certifications our resume scanner's ${name.toLowerCase()} detection engine checks for. Free scan included.`}
        path={`/industries/${slug}`}
      />
      {structured && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structured }} />}
      <Header />
      <main className="pt-28 pb-20">
        <div className="container max-w-3xl">
          <nav className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> / <Link to="/industries" className="hover:text-foreground">Industries</Link> / <span className="text-foreground">{name}</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold mb-3">{name} Resume Keywords & ATS Expectations</h1>
          <p className="text-muted-foreground mb-8">
            This isn't an article — it's the live data our resume scanner uses to analyze {name.toLowerCase()} resumes.
            When the engine improves, this page updates with it.
          </p>

          {onet && (
            <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-6">
              <h2 className="font-semibold text-foreground mb-1">Core skills per the U.S. Department of Labor</h2>
              <p className="text-xs text-muted-foreground mb-3">
                Source: O*NET {onet.code} — {onet.occupation} (onetonline.org, public domain)
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {onet.skills.map((s) => (
                  <span key={s} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium capitalize">{s}</span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {onet.technologies.map((t) => (
                  <span key={t} className="px-2.5 py-1 rounded-full border border-border text-xs text-foreground">{t}</span>
                ))}
              </div>
            </section>
          )}

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-2">Keywords ATS systems expect on {name.toLowerCase()} resumes</h2>
            <p className="text-sm text-muted-foreground mb-3">
              These terms carry the most weight in our {name.toLowerCase()} detection and scoring:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((k) => (
                <span key={k} className={`px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-foreground ${k.length <= 4 && !k.includes(" ") ? "" : "capitalize"}`}>{displayKeyword(k)}</span>
              ))}
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-2">Job titles recruiters recognize in this field</h2>
            <div className="flex flex-wrap gap-1.5">
              {titles.map((t) => (
                <span key={t} className="px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-muted-foreground capitalize">{t}</span>
              ))}
            </div>
          </section>

          {certs.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-2">Certifications that anchor a {name.toLowerCase()} resume</h2>
              <div className="flex flex-wrap gap-1.5">
                {certs.map((c) => (
                  <span key={c} className="px-2.5 py-1 rounded-lg bg-success/5 border border-success/25 text-sm text-foreground uppercase">{c}</span>
                ))}
              </div>
            </section>
          )}

          {(SUB_INDUSTRY_TAXONOMY[slug]?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-2">Specializations our scanner distinguishes within {name.toLowerCase()}</h2>
              <div className="space-y-2">
                {SUB_INDUSTRY_TAXONOMY[slug].map((sub) => (
                  <div key={sub.id} className="rounded-xl border border-border bg-card p-3">
                    <p className="text-sm font-medium text-foreground">{sub.label}</p>
                    <p className="text-xs text-muted-foreground capitalize">Signals: {sub.signals.slice(0, 6).join(", ")}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {SCREENER_NOTES[slug] && (
            <section className="rounded-2xl border border-warning/30 bg-warning/5 p-5 mb-8">
              <h2 className="font-semibold text-foreground mb-1 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-warning" />What screeners check first in {name.toLowerCase()}</h2>
              <p className="text-sm text-muted-foreground">{SCREENER_NOTES[slug]}</p>
            </section>
          )}

          <section className="rounded-2xl border-2 border-primary bg-card p-6 text-center">
            <h2 className="text-xl font-bold mb-2">See how your resume scores against this data — free</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              A full diagnostic report in seconds: which of these keywords you're missing, how the big ATS platforms parse
              your file, your weakest bullets rewritten, and a fix plan. No signup, resume never stored.
            </p>
            <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors">
              Scan my resume free <ArrowRight className="w-4 h-4" />
            </Link>
          </section>

          {rolesForIndustry(slug).length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-2">Role-specific keyword guides</h2>
              <div className="flex flex-wrap gap-1.5">
                {rolesForIndustry(slug).map((r) => (
                  <Link key={r.slug} to={`/roles/${r.slug}`} className="px-3 py-1.5 rounded-full border border-primary/40 text-primary text-sm hover:bg-primary/10 transition-colors">
                    {r.title} resume keywords →
                  </Link>
                ))}
              </div>
            </section>
          )}

          <nav className="mt-8 flex flex-wrap gap-2 text-xs" aria-label="Related industries">
            {Object.keys(INDUSTRY_KEYWORDS).filter((s2) => s2 !== slug).sort().slice(0, 8).map((s2) => (
              <Link key={s2} to={`/industries/${s2}`} className="px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors capitalize">
                {label(s2)} keywords →
              </Link>
            ))}
            <Link to="/industries" className="px-3 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition-colors">All industries</Link>
          </nav>

          <p className="text-[11px] text-muted-foreground mt-8">
            Methodology: keyword and title lists come directly from the detection tables our scanner runs on every {name.toLowerCase()} resume,
            validated by a pinned regression suite. O*NET data is public domain from the U.S. Department of Labor.
            See <Link to="/methodology" className="underline hover:text-foreground">our methodology</Link>.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
