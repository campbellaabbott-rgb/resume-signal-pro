// Guide article page (/guides/:slug), rendered from src/data/guides.ts.
// Article JSON-LD + FAQPage where the guide has FAQs; same content is
// prerendered to static HTML at build time.

import { useMemo } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { GUIDES } from "@/data/guides";

export default function GuideArticle() {
  const { slug } = useParams();
  const g = slug ? GUIDES[slug] : undefined;

  const jsonLd = useMemo(() => {
    if (!g) return null;
    const blocks: object[] = [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: g.h1,
        description: g.description,
        dateModified: g.updated,
        author: { "@type": "Organization", name: "Resume Booster", url: "https://resumebooster.work" },
        publisher: { "@type": "Organization", name: "Resume Booster" },
        mainEntityOfPage: `https://resumebooster.work/guides/${g.slug}`,
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://resumebooster.work/" },
          { "@type": "ListItem", position: 2, name: "Guides", item: "https://resumebooster.work/guides" },
          { "@type": "ListItem", position: 3, name: g.h1, item: `https://resumebooster.work/guides/${g.slug}` },
        ],
      },
    ];
    if (g.faqs?.length) {
      blocks.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: g.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      });
    }
    return blocks.map((b) => JSON.stringify(b));
  }, [g]);

  if (!slug || !g) return <Navigate to="/guides" replace />;

  return (
    <div className="min-h-screen bg-background">
      <SEO title={g.title} description={g.description} path={`/guides/${g.slug}`} />
      {jsonLd?.map((b, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: b }} />
      ))}
      <Header />
      <main className="pt-20 pb-20">
        <article className="container max-w-3xl">
          <nav className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> / <Link to="/guides" className="hover:text-foreground">Guides</Link> / <span className="text-foreground">{g.h1}</span>
          </nav>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{g.h1}</h1>
          <p className="text-xs text-muted-foreground mb-6">
            {g.minutes} min read · Updated {g.updated} · Grounded in the checks our scanner runs on every resume
          </p>

          {/* Answer-first: the extractable 2–3 sentence answer, before the depth */}
          <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-8">
            <h2 className="text-sm font-semibold text-foreground mb-1.5">The short answer</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{g.tldr}</p>
          </section>

          {g.sections.map((s) => (
            <section key={s.h2} className="mb-8">
              <h2 className="text-xl font-bold mb-3">{s.h2}</h2>
              {s.paras.map((p, i) => (
                <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-3">{p}</p>
              ))}
              {s.bullets && (
                <ul className="space-y-1.5 mt-1">
                  {s.bullets.map((b) => (
                    <li key={b} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-success mt-0.5">✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {g.faqs && g.faqs.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-bold mb-4">Common questions</h2>
              <div className="space-y-3">
                {g.faqs.map((f) => (
                  <div key={f.q} className="rounded-2xl border border-border bg-card p-4">
                    <h3 className="font-semibold text-foreground text-sm mb-1.5">{f.q}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{f.a}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border-2 border-primary bg-card p-6 text-center mb-8">
            <h2 className="text-xl font-bold mb-2">See where your resume actually stands — free</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              The full diagnostic in about 20 seconds: parsing, keywords, structure, and red flags — with every
              finding quoted from your actual document. No signup, resume never stored.
            </p>
            <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors">
              Run the free scan <ArrowRight className="w-4 h-4" />
            </Link>
          </section>

          <nav className="flex flex-wrap gap-2 text-xs" aria-label="Related">
            {g.related.map((r) => (
              <Link key={r.href} to={r.href} className="px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                {r.label} →
              </Link>
            ))}
          </nav>
        </article>
      </main>
      <Footer />
    </div>
  );
}
