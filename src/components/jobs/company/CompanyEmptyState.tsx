// A COMPANY PAGE WITH NOTHING TO LIST STILL OFFERS A WAY OUT.
//
// /jobs/company/blackstone (0 open roles) printed "No verified openings match
// all of that -- Loosening one filter helps: Remove Blackstone", although the
// visitor had set no filter, beside a detail pane saying "Select a posting"
// with nothing to select, and no similar employers (audit CP13). An
// uncarried token got the same filter-error copy.
//
//   - ZERO: the board is carried and has no open roles. The list column says
//     so with the board's own read time, offers Watch, and lists three
//     employers hiring in the same field. The page hides the detail pane.
//   - UNCARRIED: we do not read a board by this name. The page says that,
//     offers a search of the live board and the companies directory.
//
// Neither ever uses filter copy: the company scope is not a filter the
// visitor set.
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SERVED_WINDOW_DAYS, type LanderModel } from "@/lib/company/lander-model";
import { ago as fmtAgo } from "@/lib/company/format";
import { SimilarCompaniesView, type SimilarRow } from "@/components/jobs/SimilarCompanies";

export function CompanyEmptyState({ model, token, boardReadAt, similar = [], onWatch, underHeader = false }: {
  model: LanderModel;
  token: string;
  boardReadAt: string | null;
  similar?: SimilarRow[];
  /** Offer Watch here. Leave it out when the page header (which has its own Watch) is on screen. */
  onWatch?: () => void;
  /** The company header above already says "No open roles right now · board read …": the title is kept for screen readers only. */
  underHeader?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const navigate = useNavigate();
  const [q, setQ] = useState("");

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
  const read = boardReadAt ? fmtAgo(boardReadAt, { lng: lang }) : "";
  const title = !name || model.name.generic
    ? t("companyProfile.zero.titleBoard", "No roles on this board dated in the last {{days}} days", { days: SERVED_WINDOW_DAYS })
    : t("companyProfile.zero.title", "No roles at {{name}} dated in the last {{days}} days", { name, days: SERVED_WINDOW_DAYS });

  return (
    <section data-company-empty="zero" aria-labelledby="company-empty-title" className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className={underHeader ? "sr-only" : undefined}>
        <h2 id="company-empty-title" className="text-base font-semibold text-foreground">{title}</h2>
        {read && (
          <p className="text-meta text-muted-foreground">{t("companyProfile.boardReadAgo", "board read {{ago}}", { ago: read })}</p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("companyProfile.zero.body", "Watch this board and your account will count its new postings when they appear.")}
      </p>
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
