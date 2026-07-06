// Vendor-behavior pages: answers to the questions job seekers actually search
// ("does Workday read two-column resumes?"), sourced from the same documented
// parser behaviors the scanner's vendor checks run on every resume.

import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

import { VENDORS } from "@/data/ats-vendors";

export default function AtsVendorGuide() {
  const { vendor } = useParams();
  const data = vendor ? VENDORS[vendor] : undefined;
  if (!vendor || !data) return <Navigate to="/" replace />;

  const faqLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: data.behaviors.map((b) => ({
      "@type": "Question",
      name: b.q,
      acceptedAnswer: { "@type": "Answer", text: b.a },
    })),
  });

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`${data.headline} | Resume Booster`}
        description={data.behaviors[0].a.slice(0, 155)}
        path={`/ats/${vendor}`}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqLd }} />
      <Header />
      <main className="pt-20 pb-20">
        <div className="container max-w-3xl">
          <nav className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> / <span className="text-foreground">ATS guides</span> / <span className="text-foreground">{data.name}</span>
          </nav>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{data.headline}</h1>
          <p className="text-muted-foreground mb-8">
            These are the documented parsing behaviors our scanner tests every resume against — not speculation.
            The free scan below runs these exact checks on your file.
          </p>
          <div className="space-y-5 mb-10">
            {data.behaviors.map((b) => (
              <section key={b.q} className="rounded-2xl border border-border bg-card p-5">
                <h2 className="font-semibold text-foreground mb-2">{b.q}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{b.a}</p>
              </section>
            ))}
          </div>
          <section className="rounded-2xl border-2 border-primary bg-card p-6 text-center">
            <h2 className="text-xl font-bold mb-2">Test your resume against {data.name} — free</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Our free scan checks your actual file against {data.name}'s parsing behaviors (and Workday, Greenhouse,
              Lever, and iCIMS) plus 24+ other checks. No signup, resume never stored.
            </p>
            <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors">
              Run the free check <ArrowRight className="w-4 h-4" />
            </Link>
          </section>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            {Object.keys(VENDORS).filter((v) => v !== vendor).map((v) => (
              <Link key={v} to={`/ats/${v}`} className="px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                {VENDORS[v].name} guide →
              </Link>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
