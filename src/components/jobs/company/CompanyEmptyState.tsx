// A COMPANY PAGE WITH NOTHING TO LIST STILL OFFERS A WAY OUT.
//
// /jobs/company/blackstone (0 open roles) printed "No verified openings match
// all of that -- Loosening one filter helps: Remove Blackstone", although the
// visitor had set no filter, beside a detail pane saying "Select a posting"
// with nothing to select, and no similar employers (audit CP13). An
// uncarried token got the same filter-error copy.
//
//   - ZERO: the board is carried and this page lists no roles. The list
//     column says only that (the header's own line), offers Watch (promising
//     what it counts only where the model allows), and lists three employers
//     hiring in the same field. The page hides the detail pane.
//   - UNCARRIED: we do not read a board by this name. The page says that,
//     offers a search of the live board and the companies directory.
//
// Neither ever uses filter copy: the company scope is not a filter the
// visitor set.
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LanderModel } from "@/lib/company/lander-model";
import { SimilarCompaniesView, type SimilarRow } from "@/components/jobs/SimilarCompanies";
import { invokeJobBoard } from "@/lib/invoke-job-board";
import { boardBudgetRefusal } from "@/lib/board-budget";
import { useCompanyBoardHref } from "@/lib/seo/lander-manifest";

/** Folded for a name match: lower case, no accents, letters and digits only ("Domino's" -> "dominos"). */
const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The carried boards an uncarried address probably meant (S12-129): the
 * board's own name suggester asked with the address's words, keeping only
 * names that begin with them ("intel" -> Intel, not "Artificial
 * Intelligence Lab"). At most three, never the address's own token.
 */
export function didYouMeanRows(token: string, rows: Array<{ token?: unknown; name?: unknown }>): Array<{ token: string; name: string }> {
  const want = fold(token.replace(/[-_~.]+/g, " "));
  if (want.length < 2) return [];
  const out: Array<{ token: string; name: string }> = [];
  for (const r of rows) {
    if (typeof r.token !== "string" || typeof r.name !== "string" || !r.token || !r.name.trim()) continue;
    if (r.token === token || !fold(r.name).startsWith(want)) continue;
    if (out.some((o) => o.token === r.token)) continue;
    out.push({ token: r.token, name: r.name.trim() });
    if (out.length === 3) break;
  }
  return out;
}

function useDidYouMean(token: string, enabled: boolean): Array<{ token: string; name: string }> {
  const [rows, setRows] = useState<Array<{ token: string; name: string }>>([]);
  useEffect(() => {
    setRows([]);
    if (!enabled || boardBudgetRefusal()) return;
    const q = token.replace(/[-_~.]+/g, " ").trim().slice(0, 80);
    if (q.length < 2) return;
    let cancelled = false;
    // Asked inside a promise, so a reader that throws as it is called is a
    // failed suggestion, never a broken page.
    Promise.resolve()
      .then(() => invokeJobBoard({ body: { action: "company-suggest", q } }))
      .then((res) => {
        const list = (res?.data as { companies?: Array<{ token?: unknown; name?: unknown }> } | null)?.companies;
        if (!cancelled && Array.isArray(list)) setRows(didYouMeanRows(token, list));
      })
      .catch(() => { /* the search box below still answers */ });
    return () => { cancelled = true; };
  }, [token, enabled]);
  return rows;
}

export function CompanyEmptyState({ model, token, boardReadAt, similar = [], onWatch, underHeader = false }: {
  model: LanderModel;
  token: string;
  boardReadAt: string | null;
  similar?: SimilarRow[];
  /** Offer Watch here. Leave it out when the page header (which has its own Watch) is on screen. */
  onWatch?: () => void;
  /** The company header above already says the zero page's line: the title is kept for screen readers only. */
  underHeader?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const companyHref = useCompanyBoardHref();
  const suggestions = useDidYouMean(token, model.variant === "uncarried");

  if (model.variant === "uncarried") {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const term = q.trim();
      navigate(term ? `/jobs?q=${encodeURIComponent(term)}` : "/jobs");
    };
    return (
      <section data-company-empty="uncarried" aria-labelledby="company-empty-title" className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 id="company-empty-title" className="text-base font-semibold text-foreground">
          {t("companyProfile.uncarried.searchTitle", "Look for this employer on the live board")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("companyProfile.uncarried.body", "Search the live board for this employer, or browse the companies we read.")}
        </p>
        {suggestions.length > 0 && (
          <div data-company-did-you-mean="">
            <p className="text-sm font-medium text-foreground">{t("companyProfile.uncarried.didYouMean", "Did you mean one of these boards?")}</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {suggestions.map((s) => (
                <li key={s.token}>
                  <Link to={companyHref(s.token)} className="text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form role="search" onSubmit={submit} className="flex flex-wrap gap-2">
          <label htmlFor="company-empty-search" className="sr-only">{t("companyProfile.uncarried.searchLabel", "Search jobs")}</label>
          <input
            id="company-empty-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("companyProfile.uncarried.searchPlaceholder", "Employer or job title")}
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {t("companyProfile.uncarried.searchButton", "Search")}
          </button>
        </form>
        <Link to="/companies" className="inline-block text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
          {t("companyProfile.uncarried.companiesLink", "Browse the companies we read")}
        </Link>
      </section>
    );
  }

  if (model.variant !== "zero") return null;
  const name = model.name.name;
  // The heading is the page's own line, true of every zero page. "No roles
  // at X dated in the last 30 days" with "board read 5 min ago" under it was
  // false where a sibling site serves the employer's roles, which that read
  // found (the 2026-10-25 corpus, lander-model's zeroReadingOf).
  const title = t("companyProfile.zero.answer", "No roles are listed on this page right now.");

  return (
    <section data-company-empty="zero" aria-labelledby="company-empty-title" className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className={underHeader ? "sr-only" : undefined}>
        <h2 id="company-empty-title" className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      {/* The watch counts only postings stored under this token: the promise
          is made only where the model says the inputs agree with it
          (lander-model's watchPromiseOf; round 3 review, 2026-10-25). */}
      {model.watchPromise && (
        <p className="text-sm text-muted-foreground">
          {t("companyProfile.zero.body", "Watch this board and your account will count its new postings when they appear.")}
        </p>
      )}
      {onWatch && (
        <button
          type="button"
          onClick={onWatch}
          className="inline-flex min-h-9 max-w-full items-center whitespace-normal rounded-md border border-border-strong bg-secondary px-3 py-1.5 text-left text-sm font-medium text-secondary-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {name && !model.name.generic
            ? t("jobsPage.watchCta", "Watch {{company}}", { company: name })
            : t("companyProfile.actions.watchThis", "Watch this board")}
        </button>
      )}
      {model.sections.similar && <SimilarCompaniesView rows={similar} variant="inline" limit={3} headingLevel={3} />}
      <Link to="/jobs" className="inline-block text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
        {t("companyProfile.zero.allRoles", "Search all open roles")}
      </Link>
    </section>
  );
}
