// Live openings inside the scan report: the board's top matches for THIS
// resume, fit-ranked by the same deterministic scorer the report's numbers
// come from. Zero AI cost — one list query + one fit-batch. The free scan's
// output stops at "here's your score" for everyone else; ours ends with
// jobs you can act on today.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Briefcase, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { rolesForIndustry } from "@/data/roles";
import { INDUSTRY_TO_CATEGORY } from "@/lib/job-board-categories";

interface MatchJob {
  id: string;
  company: string;
  title: string;
  location: string;
  salary?: string | null;
  applyUrl: string;
  fit: number | null;
}


export function LiveMatches({ resumeText, industry }: { resumeText: string; industry: string }) {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<MatchJob[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const topRole = rolesForIndustry(industry)[0]?.title;
        const category = INDUSTRY_TO_CATEGORY[industry];
        // Role query first (most specific); category fallback; never both.
        const body = topRole
          ? { action: "list", q: topRole, limit: 30 }
          : { action: "list", category, limit: 30 };
        let { data: res } = await supabase.functions.invoke("job-board", { body });
        let jobs: Array<Record<string, unknown>> = (res as { jobs?: [] })?.jobs ?? [];
        if (jobs.length < 5 && topRole && category) {
          ({ data: res } = await supabase.functions.invoke("job-board", { body: { action: "list", category, limit: 30 } }));
          jobs = (res as { jobs?: [] })?.jobs ?? [];
        }
        if (jobs.length === 0) {
          if (!cancelled) setMatches([]);
          return;
        }
        const { data: fitRes } = await supabase.functions.invoke("job-board", {
          body: { action: "fit-batch", resumeText, ids: jobs.map((j) => j.id) },
        });
        const fits = ((fitRes as { fits?: Record<string, number | null> })?.fits) ?? {};
        const ranked = jobs
          .map((j) => ({
            id: String(j.id),
            company: String(j.company),
            title: String(j.title),
            location: String(j.location ?? ""),
            salary: (j.salary as string | null) ?? null,
            applyUrl: String(j.applyUrl),
            fit: fits[String(j.id)] ?? null,
          }))
          .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1))
          .slice(0, 5);
        if (!cancelled) setMatches(ranked);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [industry]);

  // Quietly absent on failure — the report must never look broken because
  // the board hiccupped.
  if (failed || (matches !== null && matches.length === 0)) return null;

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <Briefcase className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-foreground">{t("freeResults.matches.title", "Live openings matching this resume")}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {t("freeResults.matches.subtitle", "Ranked by the same deterministic fit scoring as your report — from live company job boards, continuously re-verified against each company's official feed.")}
      </p>

      {matches === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("freeResults.matches.loading", "Ranking live openings against your resume…")}
        </div>
      ) : (
        <>
          <ul className="space-y-2 mb-3">
            {matches.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2">
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-medium text-foreground leading-snug">{m.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.company}
                    {m.location ? ` · ${m.location}` : ""}
                    {m.salary ? <span className="text-success font-medium"> · {m.salary}</span> : null}
                  </p>
                </div>
                {typeof m.fit === "number" && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold shrink-0 ${m.fit >= 20 ? "bg-success/10 text-success" : m.fit >= 10 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
                    {t("jobsPage.fitBadge", "fit {{pct}}%", { pct: m.fit })}
                  </span>
                )}
                <a
                  href={m.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                >
                  {t("freeResults.matches.apply", "Apply")}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            ))}
          </ul>
          <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            {t("freeResults.matches.seeAll", "See all matches on the job board — save searches, track applications")}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </>
      )}
    </div>
  );
}
