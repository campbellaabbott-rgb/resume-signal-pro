// Hiring Data & API — the B2B data product page. The dataset we already
// publish for free (lifecycle-tracked postings, fills vs re-listing churn,
// salary ranges, daily accuracy audits) is licensable in bulk; this page
// states what's in it, what's deliberately NOT in it (zero jobseeker data —
// résumés are never stored), the access tiers, and the integrity fence:
// data access never includes editing rights. EN-only, like the other data
// pages (Ghost Job Index / Hiring Trends precedent). Access requests are a
// mailto for now — no self-serve keys until there's a customer to justify it.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Database, ShieldCheck, Scale, Newspaper, FlaskConical, Building2, CheckCircle2, XCircle, Mail } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString() : "—");

const CONTACT = "resumeboostersupp@gmail.com";

export default function DataApi() {
  const [stats, setStats] = useState<{ total_open?: number; total_companies?: number; total_company_names?: number; closed_90d?: number; tracking_days?: number; observed_days?: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await Promise.resolve(rpc("get_stats_cache")).catch(() => ({ data: null }));
        const cache = data as { ghost_stats?: { total_open?: number; total_companies?: number; total_company_names?: number; closed_90d?: number; tracking_days?: number; observed_days?: number } } | null;
        if (cache?.ghost_stats) setStats(cache.ghost_stats);
      } catch { /* stats are decorative here; the page stands without them */ }
    })();
  }, []);

  const inDataset = [
    { title: "Lifecycle-tracked postings", body: "Every opening from companies' official applicant-tracking feeds (Greenhouse, Lever, Ashby, SmartRecruiters, Workday and more) — with first-seen, company-stated post date where the vendor provides one, and the exact close date when it comes down." },
    { title: "Fills vs. re-listing churn", body: "When a posting closes we record whether it genuinely closed or was re-listed under a new ID. That distinction — companies that fill roles vs. companies that churn them — exists almost nowhere else." },
    { title: "Stated salary ranges", body: "Salary ranges extracted from posting text where the company itself states them, normalized by currency and period. Never estimated, never modeled." },
    { title: "Daily accuracy audits", body: "We sample random live postings every day and re-check them against the companies' own systems, stratified per hiring system. The audit trail ships with the data." },
  ];

  const notInDataset = [
    { title: "Zero jobseeker data", body: "Résumés are never stored — that is a product promise to our users, and it means there is nothing about job seekers to license. This dataset is about employers' public postings only." },
    { title: "No scraped aggregators", body: "Nothing comes from job aggregators, search-engine scrapes, or third-party lists. Only companies' own official career-site feeds." },
    { title: "No modeled guesses", body: "No estimated salaries, no inferred headcounts, no synthetic history. Fields we can't observe are null, not imputed." },
  ];

  const tiers = [
    {
      icon: Newspaper,
      name: "Journalists",
      price: "Free",
      body: "Working on a story about ghost jobs, hiring slowdowns, or salary transparency? We'll pull the numbers for you, explain exactly how they're computed, and you cite Resume Booster as the source.",
      cta: "Request data for a story",
      subject: "Press data request",
    },
    {
      icon: FlaskConical,
      name: "Academic & nonprofit research",
      price: "At cost",
      body: "Bulk exports of the lifecycle corpus for labor-market research, with full methodology documentation. Priced to cover preparation, not to profit from research.",
      cta: "Describe your research",
      subject: "Research data request",
    },
    {
      icon: Building2,
      name: "Commercial license",
      price: "Custom",
      body: "Recurring feeds or API access to postings, closures, fills and churn signals for commercial use. Tell us the shape of what you need and we'll quote it.",
      cta: "Talk to us",
      subject: "Commercial data license",
    },
  ];

  return (
    <>
      <SEO
        title="Hiring Data & API — lifecycle-tracked job posting data | Resume Booster"
        description="License the dataset behind our live board: lifecycle-tracked postings from official company career sites, genuine fills vs re-listing churn, stated salary ranges, and daily accuracy audits. Free for journalists with attribution."
        path="/data-api"
      />
      <Header />

      <main className="min-h-screen pt-20">
        {/* Hero */}
        <section className="py-16 md:py-24 bg-gradient-to-b from-primary/5 via-background to-background">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
                <Database className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-primary">Hiring Data &amp; API</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold mb-6">
                The job-posting dataset that tracks <span className="text-primary">what actually happens</span>
              </h1>
              <p className="text-xl text-muted-foreground mb-8">
                Most job data stops at "posted." Ours follows every posting to the end: when it closed, whether it was
                genuinely filled or quietly re-listed, and what the company said it paid — collected only from
                companies' own official career sites and audited against them daily.
              </p>
              <div className="flex flex-wrap justify-center gap-4 text-sm">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border">
                  <span className="font-bold text-foreground">{fmt(stats?.total_open)}</span>
                  <span className="text-muted-foreground">open postings tracked now</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border">
                  <span className="font-bold text-foreground">{fmt(stats?.total_company_names ?? stats?.total_companies)}</span>
                  <span className="text-muted-foreground">
                    {stats?.total_company_names ? "companies" : "employer feeds"}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border">
                  <span className="font-bold text-foreground">{fmt(stats?.closed_90d)}</span>
                  {/* 90 was the REQUESTED window; the log began 2026-07-14. The
                      same payload carries the real depth, so use it and never
                      print a window we did not watch. */}
                  <span className="text-muted-foreground">
                    closures logged in {fmt(stats?.observed_days ?? stats?.tracking_days)} days
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What's in it / what's not */}
        <section className="py-16">
          <div className="container">
            <div className="grid lg:grid-cols-2 gap-10 max-w-6xl mx-auto">
              <div>
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 text-primary" /> What's in the dataset
                </h2>
                <div className="space-y-4">
                  {inDataset.map((item) => (
                    <div key={item.title} className="p-5 rounded-xl bg-card border border-border">
                      <h3 className="font-semibold mb-1">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">{item.body}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <XCircle className="w-6 h-6 text-muted-foreground" /> What's deliberately not
                </h2>
                <div className="space-y-4">
                  {notInDataset.map((item) => (
                    <div key={item.title} className="p-5 rounded-xl bg-card border border-border">
                      <h3 className="font-semibold mb-1">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">{item.body}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 p-5 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Scale className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold">The integrity fence</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Buying data access never includes editing rights. No license, at any price, changes what our data
                    says about any company — including the licensee. See our{" "}
                    <Link to="/trust" className="text-primary hover:underline">data-independence policy</Link>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tiers */}
        <section className="py-16 border-t border-border bg-muted/20">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">Access</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                No self-serve keys yet — every request gets a human reply, usually within a day.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {tiers.map((tier) => {
                const Icon = tier.icon;
                return (
                  <div key={tier.name} className="p-6 rounded-2xl bg-card border border-border flex flex-col">
                    <div className="p-3 rounded-xl bg-primary/10 w-fit mb-4">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold">{tier.name}</h3>
                    <div className="text-2xl font-bold text-primary mb-3">{tier.price}</div>
                    <p className="text-sm text-muted-foreground mb-6 flex-1">{tier.body}</p>
                    <a
                      href={`mailto:${CONTACT}?subject=${encodeURIComponent(tier.subject)}`}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                    >
                      <Mail className="w-4 h-4" /> {tier.cta}
                    </a>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-sm text-muted-foreground mt-8">
              Free press access requires attribution to Resume Booster with a link. That's the whole price.
            </p>
          </div>
        </section>

        {/* Methodology cross-links */}
        <section className="py-16">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <ShieldCheck className="w-10 h-10 text-primary mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-4">Kick the tires first</h2>
              <p className="text-muted-foreground mb-8">
                A live slice of this dataset is already public. Check the numbers yourself before you ask for the rest.
              </p>
              <div className="flex flex-wrap justify-center gap-3 text-sm">
                <Link to="/ghost-job-index" className="px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">Ghost Job Index</Link>
                <Link to="/hiring-trends" className="px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">Weekly Hiring Trends</Link>
                <Link to="/entry-level-index" className="px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">Entry-Level Index</Link>
                <Link to="/jobs" className="px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">The live board</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
