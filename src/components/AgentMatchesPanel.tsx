// THE 60-SECOND PAYOFF: the scan finishes, and the agent shows what it would
// DO — real roles from the live board matching this CV, split into "I can
// submit these end-to-end" and "I'll prep you for these".
//
// Composition, not invention: the board's search already accepts
// `sendableOnly` (server-side .in("source", SENDABLE_VENDORS)), the scan
// already extracts the visitor's role and keywords, and /agent is the
// existing one-screen setup. This panel only wires the three together at the
// moment the visitor is most convinced the machine read their CV.
//
// HONESTY RULES, same as everywhere on this board:
//  - Only real postings, fetched live. An error or empty result renders the
//    panel's absence, never placeholders.
//  - The sendable count states its scope ("matching this search"), and the
//    capped flag renders as "+" — the count is never bigger than its claim.
//  - Query built from the CV's own extracted role/keywords, shown to the
//    visitor so the match is inspectable, not oracular.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bot, Zap, ArrowRight, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface MatchJob {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  salary?: string | null;
  work_mode?: string | null;
  url?: string | null;
}

interface Props {
  /** The scan's read of the visitor's current role — the strongest search key. */
  currentRole?: string;
  /** Fallback when no role was detected: top extracted keywords. */
  keywords?: string[];
}

export function AgentMatchesPanel({ currentRole, keywords }: Props) {
  const { t, i18n } = useTranslation();
  const [jobs, setJobs] = useState<MatchJob[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
  const [q, setQ] = useState<string>("");

  useEffect(() => {
    const query = (currentRole ?? "").trim() || (keywords ?? []).slice(0, 2).join(" ").trim();
    if (query.length < 3) return; // nothing credible to search with — no panel
    setQ(query);
    let dead = false;
    void supabase.functions.invoke("job-board", {
      body: { q: query, sendableOnly: true, limit: 5, page: 1 },
    }).then(({ data }) => {
      if (dead || !data || typeof data !== "object") return;
      const d = data as { jobs?: MatchJob[]; total?: number | null; countCapped?: boolean };
      const rows = Array.isArray(d.jobs) ? d.jobs.filter((j) => j && j.id && j.title && j.company) : [];
      if (rows.length === 0) return; // absence, not an empty shell
      setJobs(rows.slice(0, 5));
      setTotal(typeof d.total === "number" && d.total > 0 ? d.total : null);
      setCapped(d.countCapped === true);
    }).catch(() => { /* panel stays absent */ });
    return () => { dead = true; };
  }, [currentRole, keywords]);

  if (!jobs) return null;

  const nf = (n: number) => n.toLocaleString(i18n.language);

  return (
    <section className="container max-w-3xl mb-8" data-agent-matches>
      <div className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-5 md:p-6">
        <div className="flex items-start gap-3 mb-4">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15 shrink-0">
            <Bot className="w-5 h-5 text-primary" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-foreground leading-tight">
              {total !== null
                ? t("agentMatches.headlineCounted", "I found {{total}}{{plus}} openings matching “{{q}}” that I can submit end-to-end", {
                    total: nf(total), plus: capped ? "+" : "", q })
                : t("agentMatches.headline", "Openings matching “{{q}}” that I can submit end-to-end", { q })}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {t("agentMatches.sub", "Live postings from employers' own boards, on systems where I can complete the application for you. Here are the top matches:")}
            </p>
          </div>
        </div>

        <ul className="space-y-2 mb-4">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground truncate">{j.title}</span>
                <span className="block text-[12px] text-muted-foreground truncate">
                  {j.company}
                  {j.location ? <> · <MapPin className="inline w-3 h-3 -mt-0.5" /> {j.location}</> : null}
                  {j.work_mode ? <> · {j.work_mode}</> : null}
                  {j.salary ? <> · {j.salary}</> : null}
                </span>
              </span>
              <Zap className="w-4 h-4 text-primary shrink-0" aria-label={t("agentMatches.sendableBadge", "Agent can submit this one")} />
            </li>
          ))}
        </ul>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <Link
            to="/agent"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            {t("agentMatches.ctaSetup", "Set the agent on these")}
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to={`/jobs?q=${encodeURIComponent(q)}&agentOnly=1`}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-border bg-card/60 text-sm font-medium text-foreground hover:border-primary/50 transition-colors"
          >
            {t("agentMatches.ctaBrowse", "Browse all of them")}
          </Link>
        </div>
      </div>
    </section>
  );
}
