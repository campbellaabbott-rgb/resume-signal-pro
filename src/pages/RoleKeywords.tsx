// Role-level programmatic SEO: one page per recognized job title, framed
// around the role but powered by the same live detection data as the industry
// pages. Same credibility rule: every list is product truth, not blogspam.

import { useMemo } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { INDUSTRY_KEYWORDS, SUB_INDUSTRY_TAXONOMY } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { ONET_EXPECTATIONS } from "../../supabase/functions/free-keyword-scan/onet-expectations";
import { ROLE_PAGES, rolesForIndustry } from "@/data/roles";

const industryLabel = (slug: string) => slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const displayKeyword = (k: string) => (k.length <= 4 && !k.includes(" ") ? k.toUpperCase() : k);

export default function RoleKeywords() {
  const { slug } = useParams();
  const role = slug ? ROLE_PAGES[slug] : undefined;
  const data = role ? INDUSTRY_KEYWORDS[role.industry] : undefined;

  const structured = useMemo(() => {
    if (!role) return null;
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${role.title} Resume Keywords & ATS Expectations`,
      description: `The keywords, certifications, and skills ATS systems and recruiters look for on ${role.title.toLowerCase()} resumes — from the detection engine of a real resume scanner.`,
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://resumebooster.work/" },
          { "@type": "ListItem", position: 2, name: "Industries", item: "https://resumebooster.work/industries" },
          { "@type": "ListItem", position: 3, name: industryLabel(role.industry), item: `https://resumebooster.work/industries/${role.industry}` },
          { "@type": "ListItem", position: 4, name: role.title, item: `https://resumebooster.work/roles/${role.slug}` },
        ],
      },
    });
  }, [role]);

  if (!slug || !role || !data) return <Navigate to="/industries" replace />;

  const indName = industryLabel(role.industry);
  const keywords = [...new Set(data.primary)].slice(0, 20);
  const certs = [...new Set(data.certifications)].slice(0, 10);
  const onet = ONET_EXPECTATIONS[role.industry];
  const siblingRoles = rolesForIndustry(role.industry).filter((r) => r.slug !== role.slug);
  const relatedTitles = [...new Set(data.titles)].filter((t) => t.toLowerCase() !== role.title.toLowerCase()).slice(0, 10);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`${role.title} Resume Keywords — What ATS Systems Look For`}
        description={`${keywords.slice(0, 5).join(", ")} and more: the keywords, certifications, and titles our scanner checks on ${role.title.toLowerCase()} resumes. Free ATS scan included.`}
        path={`/roles/${role.slug}`}
      />
      {structured && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structured }} />}
      <Header />
      <main className="pt-20 pb-20">
        <div className="container max-w-3xl">
          <nav className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> / <Link to="/industries" className="hover:text-foreground">Industries</Link> / <Link to={`/industries/${role.industry}`} className="hover:text-foreground">{indName}</Link> / <span className="text-foreground">{role.title}</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold mb-3">{role.title} Resume Keywords & ATS Expectations</h1>
          <p className="text-muted-foreground mb-8">
            This is the live data our resume scanner uses when it detects a {role.title.toLowerCase()} resume — the
            keyword tables, certifications, and titles from our {indName.toLowerCase()} detection engine. When the
            engine improves, this page updates with it.
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
            <h2 className="text-xl font-bold mb-2">Keywords ATS systems expect on a {role.title.toLowerCase()} resume</h2>
            <p className="text-sm text-muted-foreground mb-3">
              These terms carry the most weight in our scoring for this field:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((k) => (
                <span key={k} className={`px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-foreground ${k.length <= 4 && !k.includes(" ") ? "" : "capitalize"}`}>{displayKeyword(k)}</span>
              ))}
            </div>
          </section>

          {certs.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-2">Certifications that anchor a {role.title.toLowerCase()} resume</h2>
              <div className="flex flex-wrap gap-1.5">
                {certs.map((c) => (
                  <span key={c} className="px-2.5 py-1 rounded-lg bg-success/5 border border-success/25 text-sm text-foreground uppercase">{c}</span>
                ))}
              </div>
            </section>
          )}

          {relatedTitles.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-2">Adjacent titles recruiters search alongside "{role.title}"</h2>
              <p className="text-sm text-muted-foreground mb-3">
                If your experience fits one of these, using the recognized title verbatim helps recruiter searches find you:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {relatedTitles.map((t) => (
                  <span key={t} className="px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-muted-foreground capitalize">{t}</span>
                ))}
              </div>
            </section>
          )}

          {(SUB_INDUSTRY_TAXONOMY[role.industry]?.length ?? 0) > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-bold mb-2 flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-success" />Specializations our scanner distinguishes in {indName.toLowerCase()}</h2>
              <div className="space-y-2">
                {SUB_INDUSTRY_TAXONOMY[role.industry].map((sub) => (
                  <div key={sub.id} className="rounded-xl border border-border bg-card p-3">
                    <p className="text-sm font-medium text-foreground">{sub.label}</p>
                    <p className="text-xs text-muted-foreground capitalize">Signals: {sub.signals.slice(0, 6).join(", ")}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border-2 border-primary bg-card p-6 text-center">
            <h2 className="text-xl font-bold mb-2">Scan your {role.title.toLowerCase()} resume against this data — free</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              A full diagnostic report in seconds: which of these keywords you're missing, how ATS platforms parse
              your file, your weakest bullets rewritten, and a fix plan. No signup, resume never stored.
            </p>
            <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors">
              Scan my resume free <ArrowRight className="w-4 h-4" />
            </Link>
          </section>

          <nav className="mt-8 flex flex-wrap gap-2 text-xs" aria-label="Related pages">
            {siblingRoles.map((r) => (
              <Link key={r.slug} to={`/roles/${r.slug}`} className="px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                {r.title} keywords →
              </Link>
            ))}
            <Link to={`/industries/${role.industry}`} className="px-3 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition-colors">
              All {indName} keywords →
            </Link>
          </nav>

          <p className="text-[11px] text-muted-foreground mt-8">
            Methodology: these lists come directly from the detection tables our scanner runs on every {indName.toLowerCase()} resume,
            validated by a pinned regression suite. O*NET data is public domain from the U.S. Department of Labor.
            See <Link to="/methodology" className="underline hover:text-foreground">our methodology</Link>.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
