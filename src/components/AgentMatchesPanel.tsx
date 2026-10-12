// THE 60-SECOND PAYOFF: the scan finishes, and the page shows real roles from
// the live board matching this CV.
//
// Since the apply pivot (owner decision 2026-10-11) the panel no longer
// splits roles into "the agent can submit these" and the rest, and no longer
// sends anyone to set up an agent: the server-side apply agent is switched
// off and nothing here submits an application. It shows the matching roles,
// sends the visitor to the board for all of them, and to /agents to apply
// yourself with your own AI's help.
//
// HONESTY RULES, same as everywhere on this board:
//  - Only real postings, fetched live. An error or empty result renders the
//    panel's absence, never placeholders.
//  - The count states its scope ("matching this search"), and the capped
//    flag renders as "+" — the count is never bigger than its claim.
//  - Query built from the CV's own extracted role/keywords, shown to the
//    visitor so the match is inspectable, not oracular.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Search, ArrowRight, MapPin } from "lucide-react";
import { invokeJobBoard } from "@/lib/invoke-job-board";

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
    void invokeJobBoard({
      body: { q: query, limit: 5, page: 1 },
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
            <Search className="w-5 h-5 text-primary" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-foreground leading-tight">
              {total !== null
                ? t("agentMatches.headlineCounted2", "{{total}}{{plus}} live openings match “{{q}}”", {
                    total: nf(total), plus: capped ? "+" : "", q })
                : t("agentMatches.headline2", "Live openings matching “{{q}}”", { q })}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {t("agentMatches.sub2", "Live postings from employers' own hiring systems. You apply on the employer's own site, with your own AI's help if you like. Here are the top matches:")}
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
            </li>
          ))}
        </ul>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <Link
            to={`/jobs?q=${encodeURIComponent(q)}`}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            {t("agentMatches.ctaBrowse", "Browse all of them")}
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/agents"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-border bg-card/60 text-sm font-medium text-foreground hover:border-primary/50 transition-colors"
          >
            {t("agentMatches.ctaYourAi", "Apply with your own AI's help")}
          </Link>
        </div>
      </div>
    </section>
  );
}
