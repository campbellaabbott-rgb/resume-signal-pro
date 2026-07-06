// Live data study (/research/ats-score-benchmarks): real score distributions
// from our own scan corpus, fetched from the k-anonymous aggregate RPC. This
// is the "original data" page — numbers no competitor or chatbot can cite
// without citing us. Every figure comes from the database at render time;
// nothing here is invented, and when the RPC is unreachable the page says so
// instead of showing stale or made-up stats.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

interface Insights {
  as_of: string;
  window_days: number;
  overall: {
    n: number;
    median: number;
    p25: number;
    p75: number;
    pct_80_plus: number | null;
    pct_under_50: number | null;
  } | null;
  histogram: Array<{ bucket: number; n: number }>;
  industries: Array<{ industry: string; n: number; median: number; p25: number; p75: number }>;
  experience: Array<{ level: string; n: number; median: number }>;
}

const label = (slug: string) => slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const FAQS = [
  {
    q: "What is a good ATS score?",
    a: "Judge your score against the live distribution on this page, not a folklore threshold: the median and quartiles above come from real scans in the last 180 days. Scoring above the 75th percentile means most resumes being checked right now score below yours; below the 25th percentile means parsing or keyword problems are very likely holding you back.",
  },
  {
    q: "Do ATS systems themselves show scores like this?",
    a: "Mostly no. Most ATS platforms rank and filter by recruiter searches rather than assigning a universal score. A resume score — ours included — is a diagnostic model of how well your resume will survive parsing and keyword search, not a number Workday or Greenhouse shows a recruiter.",
  },
  {
    q: "Where do these numbers come from?",
    a: "From completed scans run by real users on this site over a rolling 180-day window. Only aggregates are published: each industry or experience bucket must contain at least 25 scans before it appears, and no individual resume, score, or location is ever exposed.",
  },
  {
    q: "Why might this sample skew low or high?",
    a: "People who check their resume are often mid-job-search and suspect something is wrong, so the sample likely skews toward resumes with fixable problems. Treat the percentiles as a benchmark of active job seekers, not of every employed professional's resume.",
  },
];

export default function ScoreStudy() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    // RPC created in migration 20260706120000; not yet in the generated
    // client types, hence the cast.
    (supabase.rpc as unknown as (fn: string) => PromiseLike<{ data: unknown; error: unknown }>)(
      "get_public_scan_insights"
    ).then(
      ({ data, error }) => {
        if (cancelled) return;
        const d = data as Insights | null;
        if (error || !d?.overall?.n) {
          setStatus("unavailable");
        } else {
          setInsights(d);
          setStatus("ready");
        }
      },
      () => !cancelled && setStatus("unavailable")
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const jsonLd = useMemo(() => {
    const blocks: object[] = [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "ATS resume score benchmarks from real scans",
        description:
          "Live score distributions from real resume scans: overall median and quartiles, per-industry benchmarks, and experience-level medians over a rolling 180-day window.",
        author: { "@type": "Organization", name: "Resume Booster", url: "https://resumebooster.work" },
        publisher: { "@type": "Organization", name: "Resume Booster" },
        mainEntityOfPage: "https://resumebooster.work/research/ats-score-benchmarks",
      },
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "Resume Booster ATS score benchmarks",
        description:
          "Aggregated ATS score distributions (median, quartiles, decile histogram) from real resume scans, by industry and experience level. Rolling 180-day window; buckets published only at n ≥ 25.",
        creator: { "@type": "Organization", name: "Resume Booster", url: "https://resumebooster.work" },
        url: "https://resumebooster.work/research/ats-score-benchmarks",
        isAccessibleForFree: true,
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQS.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ];
    return blocks.map((b) => JSON.stringify(b));
  }, []);

  const o = insights?.overall ?? null;

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="What's a Good ATS Score? Live Benchmarks From Real Scans"
        description="Real ATS score benchmarks, updated live from our scan corpus: overall median and quartiles, per-industry distributions, and experience-level medians — not folklore thresholds."
        path="/research/ats-score-benchmarks"
      />
      {jsonLd.map((b, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: b }} />
      ))}
      <Header />
      <main className="pt-28 pb-20">
        <article className="container max-w-3xl">
          <nav className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> /{" "}
            <Link to="/guides" className="hover:text-foreground">Guides</Link> /{" "}
            <span className="text-foreground">ATS score benchmarks</span>
          </nav>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            What's a good ATS score? Live benchmarks from real scans
          </h1>
          <p className="text-xs text-muted-foreground mb-6">
            Computed live from our scan corpus (rolling {insights?.window_days ?? 180}-day window
            {insights ? `, as of ${insights.as_of}` : ""}) · No individual resume data — aggregates only, minimum 25
            scans per bucket
          </p>

          <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-8">
            <h2 className="text-sm font-semibold text-foreground mb-1.5">The short answer</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {o ? (
                <>
                  Across the last {o.n.toLocaleString()} completed scans, the median resume scored{" "}
                  <strong className="text-foreground">{o.median}</strong>, with the middle half of resumes landing
                  between {o.p25} and {o.p75}.{" "}
                  {o.pct_80_plus != null && (
                    <>Only {o.pct_80_plus}% scored 80 or higher — so a score in the 80s is genuinely strong, not table stakes. </>
                  )}
                  There is no universal pass mark: use the distribution below to see where you actually stand.
                </>
              ) : (
                <>
                  There is no universal "good" ATS score — the honest benchmark is where you fall in the
                  distribution of real resumes being scanned right now. This page computes that distribution live
                  from our scan corpus: overall median and quartiles, per-industry benchmarks, and
                  experience-level medians.
                </>
              )}
            </p>
          </section>

          {status === "loading" && (
            <p className="text-sm text-muted-foreground mb-8">Loading live benchmark data…</p>
          )}
          {status === "unavailable" && (
            <p className="text-sm text-muted-foreground mb-8">
              The live numbers are temporarily unavailable. Rather than show stale or estimated figures, this page
              only ever displays statistics computed directly from the scan corpus — try again shortly.
            </p>
          )}

          {insights && (
            <>
              <section className="mb-10">
                <h2 className="text-xl font-bold mb-3">How real resumes score</h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Each bar is a 10-point score band; together they show every completed scan in the current window.
                  If the shape surprises you, remember who runs a resume checker: mostly active job seekers who
                  suspect something is wrong — employed professionals with polished resumes are underrepresented.
                </p>
                <div className="h-64 rounded-2xl border border-border bg-card p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={insights.histogram.map((h) => ({ ...h, name: `${h.bucket}–${h.bucket + 9}` }))}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip formatter={(v: number) => [`${v} scans`, "Count"]} />
                      <Bar dataKey="n" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {insights.industries.length > 0 && (
                <section className="mb-10">
                  <h2 className="text-xl font-bold mb-3">Benchmarks by industry</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    Median and middle-half range (25th–75th percentile) per detected industry. Industries appear
                    once they have at least 25 completed scans in the window, so smaller fields may be missing.
                  </p>
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="p-3 font-medium">Industry</th>
                          <th className="p-3 font-medium text-right">Median</th>
                          <th className="p-3 font-medium text-right">Middle half</th>
                          <th className="p-3 font-medium text-right">Scans</th>
                        </tr>
                      </thead>
                      <tbody>
                        {insights.industries.map((row) => (
                          <tr key={row.industry} className="border-b border-border last:border-0">
                            <td className="p-3 text-foreground">{label(row.industry)}</td>
                            <td className="p-3 text-right font-semibold text-foreground">{row.median}</td>
                            <td className="p-3 text-right text-muted-foreground">
                              {row.p25}–{row.p75}
                            </td>
                            <td className="p-3 text-right text-muted-foreground">{row.n.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {insights.experience.length > 0 && (
                <section className="mb-10">
                  <h2 className="text-xl font-bold mb-3">By experience level</h2>
                  <div className="flex flex-wrap gap-3">
                    {insights.experience.map((row) => (
                      <div key={row.level} className="rounded-2xl border border-border bg-card px-5 py-4">
                        <p className="text-xs text-muted-foreground capitalize mb-1">{label(row.level)}</p>
                        <p className="text-2xl font-bold text-foreground">{row.median}</p>
                        <p className="text-xs text-muted-foreground">median · {row.n.toLocaleString()} scans</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <section className="mb-10">
            <h2 className="text-xl font-bold mb-3">How to read these numbers honestly</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              Two caveats we insist on. First, this sample self-selects: people scan resumes when they suspect a
              problem, so the distribution likely sits below the true population of working professionals. Second,
              any resume score — ours included — is a model with error bars, not a measurement;{" "}
              <Link to="/guides/what-resume-score-means" className="text-primary hover:underline">
                what a resume score actually means
              </Link>{" "}
              explains how to read one without being fooled by false precision.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              What the data is good for: ranking yourself against real peers instead of a made-up "75 is passing"
              threshold, and seeing that industry context matters — the same resume quality scores differently
              against different keyword expectations. Our{" "}
              <Link to="/methodology" className="text-primary hover:underline">methodology</Link> covers how the
              score itself is computed.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-bold mb-4">Common questions</h2>
            <div className="space-y-3">
              {FAQS.map((f) => (
                <div key={f.q} className="rounded-2xl border border-border bg-card p-4">
                  <h3 className="font-semibold text-foreground text-sm mb-1.5">{f.q}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-primary/25 bg-primary/5 p-6 text-center mb-6">
            <h2 className="text-lg font-bold mb-2">See where your resume lands in this distribution — free</h2>
            <p className="text-sm text-muted-foreground mb-4">
              The full diagnostic in about 20 seconds: your score with an audit trail, missing keywords, and
              per-vendor parsing checks. No signup, resume never stored.
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Run the free scan
            </Link>
          </section>

          <nav className="flex flex-wrap gap-2 text-xs">
            <Link to="/guides/what-resume-score-means" className="px-3 py-1.5 rounded-full border border-primary/40 text-primary">
              What a resume score actually means →
            </Link>
            <Link to="/guides/why-resumes-get-rejected" className="px-3 py-1.5 rounded-full border border-primary/40 text-primary">
              Why resumes get rejected →
            </Link>
            <Link to="/industries" className="px-3 py-1.5 rounded-full border border-primary/40 text-primary">
              Keywords by industry →
            </Link>
          </nav>
        </article>
      </main>
      <Footer />
    </div>
  );
}
