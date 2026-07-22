// The Pay Transparency Index — a public data page ranking fields, hiring
// systems, and large employers by how much of their postings state pay and
// work mode. Every number is computed live from postings' own text and ATS
// fields; nothing is estimated and no placement is purchasable (the /trust
// fence). EN-only like the other data pages.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeDollarSign, Scale, MapPin } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

interface PayData {
  categories: Array<{ category: string; total: number; pay_pct: number }>;
  top_companies: Array<{ company: string; company_token: string; total: number; pay_pct: number }>;
  overall: { total: number; pay_pct: number };
}
interface Coverage {
  by_source: Array<{ source: string; total: number; pay_pct: number; mode_pct: number }>;
  overall: { total: number; pay_pct: number; mode_n: number; mode_pct: number };
}

const CATEGORY_LABELS: Record<string, string> = {
  engineering: "Engineering & IT", data_ai: "Data & AI", design: "Design", marketing: "Marketing",
  sales: "Sales & Partnerships", finance: "Finance & Accounting", healthcare: "Healthcare",
  education: "Education", legal: "Legal", people_hr: "People & HR", operations: "Operations & Logistics",
  customer: "Customer Support", admin: "Administrative", hospitality_retail: "Hospitality & Retail",
  science: "Science & Research", construction: "Construction & Trades", creative: "Media & Creative",
};

export default function PayTransparencyIndex() {
  const [pay, setPay] = useState<PayData | null>(null);
  const [cov, setCov] = useState<Coverage | null>(null);

  useEffect(() => {
    void Promise.resolve(rpc("get_pay_transparency")).then((r) => {
      if (r.data && typeof r.data === "object") setPay(r.data as PayData);
    }).catch(() => {});
    void Promise.resolve(rpc("get_transparency_coverage")).then((r) => {
      if (r.data && typeof r.data === "object") setCov(r.data as Coverage);
    }).catch(() => {});
  }, []);

  const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString() : "—");

  return (
    <>
      <SEO
        title="Pay Transparency Index — who actually states salaries?"
        description="A live ranking of fields, hiring systems, and large employers by the share of job postings that state pay — counted from companies' own posting text and ATS fields. No estimates, no modeled ranges."
        path="/pay-transparency"
      />
      <Header />
      <main className="min-h-screen pt-20">
        <section className="py-16 md:py-20 bg-gradient-to-b from-primary/5 via-background to-background">
          <div className="container max-w-4xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
              <BadgeDollarSign className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-primary">Pay Transparency Index</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Who actually states salaries?</h1>
            <p className="text-lg text-muted-foreground mb-6 max-w-3xl">
              Counted from job postings' own text and the employers' ATS fields — never estimated, never modeled.
              {pay?.overall && (
                <> Right now <strong className="text-foreground">{pay.overall.pay_pct}%</strong> of the{" "}
                <strong className="text-foreground">{fmt(pay.overall.total)}</strong> live postings we track state pay.</>
              )}
            </p>
            <p className="text-[13px] text-muted-foreground flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-primary shrink-0" />
              Placement here cannot be bought. The only way onto this page is to state pay in your own postings — see our{" "}
              <Link to="/trust" className="text-primary hover:underline">data-independence policy</Link>.
            </p>
          </div>
        </section>

        <section className="py-12">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-bold mb-2">By field</h2>
            <p className="text-sm text-muted-foreground mb-5">Share of live postings stating pay, per field (fields with 200+ postings).</p>
            <div className="space-y-2">
              {(pay?.categories ?? []).map((c) => (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-sm truncate">{CATEGORY_LABELS[c.category] ?? c.category}</span>
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(c.pay_pct, 100)}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-sm text-right tabular-nums">{c.pay_pct}% <span className="text-muted-foreground text-[11px]">of {fmt(c.total)}</span></span>
                </div>
              ))}
              {!pay && <p className="text-sm text-muted-foreground">Loading…</p>}
            </div>
          </div>
        </section>

        <section className="py-12 border-t border-border bg-muted/20">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-bold mb-2">Most transparent large employers</h2>
            <p className="text-sm text-muted-foreground mb-5">Companies with 50+ live postings, ranked by the share stating pay.</p>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {(pay?.top_companies ?? []).map((c) => (
                <Link
                  key={c.company_token}
                  to={`/jobs/company/${encodeURIComponent(c.company_token)}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/50 transition-colors"
                >
                  <span className="text-sm font-semibold truncate">{c.company}</span>
                  <span className="text-sm tabular-nums text-primary shrink-0">{c.pay_pct}% <span className="text-muted-foreground text-[11px]">of {c.total}</span></span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="container max-w-4xl">
            <h2 className="text-2xl font-bold mb-2">By hiring system</h2>
            <p className="text-sm text-muted-foreground mb-5">
              How much each applicant-tracking system's postings state pay and a definitive work mode (remote / hybrid / on-site).
              This is also a coverage disclosure: where these numbers are low, our filters honestly show fewer results.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4 font-medium">System</th>
                    <th className="py-2 pr-4 font-medium text-right">Postings</th>
                    <th className="py-2 pr-4 font-medium text-right">State pay</th>
                    <th className="py-2 font-medium text-right">State work mode</th>
                  </tr>
                </thead>
                <tbody>
                  {(cov?.by_source ?? []).map((r) => (
                    <tr key={r.source} className="border-b border-border/50">
                      <td className="py-2 pr-4 capitalize">{r.source}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{fmt(r.total)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.pay_pct}%</td>
                      <td className="py-2 text-right tabular-nums">{r.mode_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!cov && <p className="text-sm text-muted-foreground mt-3">Loading…</p>}
            </div>
          </div>
        </section>

        <section className="py-12 border-t border-border">
          <div className="container max-w-4xl">
            <h2 className="text-xl font-bold mb-3 flex items-center gap-2"><MapPin className="w-5 h-5 text-primary" /> How this is measured</h2>
            <div className="text-sm text-muted-foreground space-y-2 max-w-3xl">
              <p>A posting "states pay" when its own description text or its ATS's structured compensation field contains a salary figure or range — the company's verbatim words. We never estimate, model, or convert pay.</p>
              <p>A posting has a "work mode" when the employer's ATS field says remote/hybrid/on-site, or the title/location states it explicitly. Postings that don't say carry no tag — we show nothing rather than a guess.</p>
              <p>
                Browse <Link to="/jobs?mode=remote" className="text-primary hover:underline">remote roles</Link>,{" "}
                <Link to="/jobs?mode=hybrid" className="text-primary hover:underline">hybrid roles</Link>, or see the{" "}
                <Link to="/ghost-job-index" className="text-primary hover:underline">Ghost Job Index</Link> and{" "}
                <Link to="/data-api" className="text-primary hover:underline">Hiring Data &amp; API</Link>.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
