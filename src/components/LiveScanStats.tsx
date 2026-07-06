import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Homepage transparency section: the real score statistics, fetched live
// from the same k-anonymous aggregate RPC that powers
// /research/ats-score-benchmarks. Nothing here is invented or hardcoded —
// if the RPC is unreachable or the corpus is too small, the section simply
// doesn't render rather than showing stale or made-up figures.
// (Histogram is plain CSS bars, not recharts, to keep the landing bundle light.)

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
}

// Below this, quoting medians would be noise, not transparency.
const MIN_CORPUS_N = 25;

export function LiveScanStats() {
  const [insights, setInsights] = useState<Insights | null>(null);

  useEffect(() => {
    let cancelled = false;
    // RPC created in migration 20260706120000; not yet in the generated
    // client types, hence the cast (same pattern as ScoreStudy).
    (supabase.rpc as unknown as (fn: string) => PromiseLike<{ data: unknown; error: unknown }>)(
      "get_public_scan_insights"
    ).then(
      ({ data, error }) => {
        if (cancelled) return;
        const d = data as Insights | null;
        if (!error && d?.overall && d.overall.n >= MIN_CORPUS_N) setInsights(d);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const o = insights?.overall;
  if (!insights || !o) return null;

  const maxBar = Math.max(...insights.histogram.map((h) => h.n), 1);
  const stats = [
    { label: "Median score", value: String(o.median), detail: "half of resumes score below this" },
    { label: "Middle half", value: `${o.p25}–${o.p75}`, detail: "25th–75th percentile range" },
    ...(o.pct_80_plus != null
      ? [{ label: "Scored 80+", value: `${o.pct_80_plus}%`, detail: "a score in the 80s is genuinely strong" }]
      : []),
    { label: "Completed scans", value: o.n.toLocaleString(), detail: `rolling ${insights.window_days}-day window` },
  ];

  return (
    <section className="py-14 border-t border-border" aria-label="Live scan statistics">
      <div className="container max-w-3xl">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold mb-2">How real resumes actually score</h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            Live from our scan corpus as of {insights.as_of} — the same numbers our{" "}
            <Link to="/research/ats-score-benchmarks" className="text-primary hover:underline">
              public benchmark study
            </Link>{" "}
            publishes. Aggregates only; no individual resume data.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card/50 p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-xs font-semibold text-foreground mt-0.5">{s.label}</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{s.detail}</p>
            </div>
          ))}
        </div>

        {insights.histogram.length > 0 && (
          <div className="rounded-2xl border border-border bg-card/50 p-4 mb-4">
            <div className="flex items-end gap-1 h-24" role="img" aria-label="Distribution of scan scores in 10-point bands">
              {insights.histogram.map((h) => (
                <div key={h.bucket} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-primary/70"
                    style={{ height: `${Math.max((h.n / maxBar) * 80, 2)}px` }}
                    title={`${h.bucket}–${h.bucket + 9}: ${h.n.toLocaleString()} scans`}
                  />
                  <span className="text-[10px] text-muted-foreground">{h.bucket}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 text-center">
              Score distribution in 10-point bands, every completed scan in the window
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center max-w-xl mx-auto">
          One honest caveat: people scan resumes when they suspect a problem, so this sample likely
          skews below the population of all working professionals.{" "}
          <Link to="/research/ats-score-benchmarks" className="text-primary hover:underline">
            See the full study
          </Link>{" "}
          for per-industry and experience-level breakdowns.
        </p>
      </div>
    </section>
  );
}
