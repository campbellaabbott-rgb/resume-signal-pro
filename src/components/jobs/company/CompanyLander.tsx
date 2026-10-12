// THE COMPANY PAGE, COMPOSED.
//
// /jobs/company/:token is rendered by src/pages/Jobs.tsx, which this group
// does not edit. The design system group's wiring pass swaps the page's
// lander regions for the exports below one at a time (header, rail and
// accordion, empty states), so each export is a region with its own props,
// and CompanyLander composes them the way the page will: the header full
// width; then, on a desktop, the list beside the About rail; on a phone, the
// list with the About accordion after its third card and similar employers
// after its first page (design spec 5.3).
//
// THE PAGE DECIDES ONCE. buildLanderModel (src/lib/company/lander-model.ts)
// picks the variant, the one open-roles figure, the name and the sections;
// every region here renders from that model, so the answer line, the results
// line and the rail cannot disagree. useCompanyProfile reads the employer
// readers once per token (each asked once while in flight, so the rail and
// the accordion mounted together make one request each) and asks none of
// them on a board name two hiring systems share.
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCompanyIntel } from "@/components/jobs/CompanyIntelPanel";
import { useEmployerPerks } from "@/components/jobs/CompanyPerks";
import { useCompanyFinancials } from "@/components/jobs/PublicCompanyCard";
import { useLcaFiledWages } from "@/components/jobs/LcaFiledWagesLine";
import { SimilarCompaniesView, useSimilarCompanies } from "@/components/jobs/SimilarCompanies";
import type { LayoffFiling } from "@/components/jobs/LayoffFilingLine";
import type { LanderModel, OpenRolesValue } from "@/lib/company/lander-model";
import { ago as fmtAgo, count as fmtCount } from "@/lib/company/format";
import { tPlural } from "@/lib/company/plural";
import { CompanyHeader, type WorkModeSplit } from "./CompanyHeader";
import { CollisionBoardsPanel, CollisionHeader } from "./CollisionHeader";
import { UsajobsHubHeader } from "./UsajobsHubHeader";
import { CompanyEmptyState } from "./CompanyEmptyState";
import { AboutEmployerAccordion, AboutEmployerRail, type AboutEmployerProps, type CompanyProfileData } from "./AboutEmployer";
import type { HiringRecordInput } from "./HiringRecordCard";
import type { PayStated } from "./PaySummary";

export type { CompanyProfileData } from "./AboutEmployer";

/** The employer readers for one token, gated by the model's sections. */
export function useCompanyProfile(token: string | null | undefined, model: LanderModel): CompanyProfileData {
  const s = model.sections;
  const employer = model.variant !== "collision" && model.variant !== "uncarried";
  const intel = useCompanyIntel(token, employer);
  const perks = useEmployerPerks(token, employer && s.perks);
  const financials = useCompanyFinancials(token, employer && s.sec);
  const lca = useLcaFiledWages(token, null, null, employer && s.publicRecords && !s.hiringRecordFloorOnly);
  const similar = useSimilarCompanies(token, employer && s.similar, 6);
  return { intel, perks, financials, lca, similar };
}

export interface CompanyLanderHeaderProps {
  model: LanderModel;
  token: string;
  /** The page's sourceLabel: the vendor's own name for a source key, or null. */
  labelOf: (source: string) => string | null;
  /** The board's hiring system, when its rows share one. */
  source: string | null;
  profile?: CompanyProfileData | null;
  workMode?: WorkModeSplit | null;
  payStated?: PayStated | null;
  employerChipTip?: string;
  boardReadAt: string | null;
  onWatch: () => void;
  /** Collision pages: set the vendor filter to one board. */
  onShowOnly: (source: string) => void;
  onCopyLink?: () => void;
  /** Collision pages: the rail region shows the boards at lg and up, so the header lists them for phones only. */
  boardsInPanel?: boolean;
}

/** The header region: the variant's own header. */
export function CompanyLanderHeader(p: CompanyLanderHeaderProps) {
  if (p.model.variant === "collision") {
    return <CollisionHeader token={p.token} boards={p.model.boards} labelOf={p.labelOf} onShowOnly={p.onShowOnly} onWatch={p.onWatch} onCopyLink={p.onCopyLink} boardsInPanel={p.boardsInPanel} />;
  }
  if (p.model.variant === "usajobs") {
    return <UsajobsHubHeader model={p.model} onWatch={p.onWatch} onCopyLink={p.onCopyLink} />;
  }
  if (p.model.variant === "uncarried") return <UncarriedHeader token={p.token} />;
  return (
    <CompanyHeader
      model={p.model}
      token={p.token}
      system={p.source ? p.labelOf(p.source) : null}
      countries={(p.profile?.intel.intel?.countries ?? []).map((c) => c.country)}
      workMode={p.workMode}
      payStated={p.payStated}
      employerChipTip={p.employerChipTip}
      boardReadAt={p.boardReadAt}
      onWatch={p.onWatch}
      onCopyLink={p.onCopyLink}
    />
  );
}

function UncarriedHeader({ token }: { token: string }) {
  const { t } = useTranslation();
  return (
    <header data-company-header="uncarried" className="mb-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground break-words sm:text-3xl">
        {t("companyProfile.uncarried.title", "We don't read a board called “{{token}}” yet", { token })}
      </h1>
    </header>
  );
}

/**
 * The results line: "Showing 65 of 1,653 open roles · this board read 46 min
 * ago". The total is the page's one open-roles figure; with a visitor filter
 * on, it is the filtered count and the line says "matching roles". The read
 * time is this board's own, never the board-wide median (CP24), and nothing
 * else is spliced into the line.
 */
export function CompanyResultsLine({ model, shown, matching, boardReadAt }: {
  model: LanderModel;
  shown: number;
  /** The filtered list's own total, when a visitor filter is on. */
  matching?: { value: number; floor: boolean } | null;
  boardReadAt: string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const total: { value: number; floor: boolean } | null = model.visitorFiltered ? (matching ?? null) : (model.openRoles as OpenRolesValue | null);
  if (!total || shown <= 0) return null;
  const vars = { shown: fmtCount(shown, { lng: lang }), total: fmtCount(total.value, { floor: total.floor, lng: lang }) };
  const head = model.visitorFiltered
    ? tPlural(t, "companyProfile.results.showingMatching", total.value, vars, "Showing {{shown}} of {{total}} matching role", "Showing {{shown}} of {{total}} matching roles")
    : tPlural(t, "companyProfile.results.showing", total.value, vars, "Showing {{shown}} of {{total}} open role", "Showing {{shown}} of {{total}} open roles");
  const read = boardReadAt ? fmtAgo(boardReadAt, { lng: lang }) : "";
  return (
    <p className="text-meta text-muted-foreground" data-company-results="" aria-live="off">
      <span className="text-foreground">{head}</span>
      {read && <> · {t("companyProfile.results.boardRead", "this board read {{ago}}", { ago: read })}</>}
    </p>
  );
}

/**
 * The desktop rail: the employer profile, or on a board name two hiring
 * systems share (which has no employer profile) the boards themselves.
 */
export function CompanyLanderRail(p: AboutEmployerProps & { labelOf?: (source: string) => string | null; onShowOnly?: (source: string) => void }) {
  if (p.model.variant === "collision") {
    return p.labelOf && p.onShowOnly
      ? <CollisionBoardsPanel token={p.token} boards={p.model.boards} labelOf={p.labelOf} onShowOnly={p.onShowOnly} />
      : null;
  }
  return <AboutEmployerRail {...p} />;
}

/** The phone accordion after the third card. */
export function CompanyLanderAccordion(p: AboutEmployerProps) {
  return <AboutEmployerAccordion {...p} />;
}

/** Similar employers after the first page of results, on a phone. */
export function CompanySimilarAfterFirstPage({ model, profile }: { model: LanderModel; profile: CompanyProfileData }) {
  if (!model.sections.similar || model.variant === "zero") return null;
  return <SimilarCompaniesView rows={profile.similar} variant="inline" limit={6} />;
}

/**
 * The empty list column of a zero or uncarried page, under the company
 * header: the header already answers "No open roles right now · board read …"
 * and carries Watch, so the column adds the way out (similar employers, the
 * whole board) without repeating either.
 */
export function CompanyLanderEmpty({ model, token, profile, boardReadAt }: {
  model: LanderModel;
  token: string;
  profile: CompanyProfileData;
  boardReadAt: string | null;
}) {
  return <CompanyEmptyState model={model} token={token} boardReadAt={boardReadAt} similar={profile.similar} underHeader />;
}

export interface CompanyLanderProps extends Omit<CompanyLanderHeaderProps, "profile"> {
  record: HiringRecordInput | null;
  layoffRows: LayoffFiling[];
  howApplying?: ReactNode;
  /** The company variant of the filter bar (the design system's FilterBar). */
  filterBar?: ReactNode;
  /** The rendered job cards, in order. */
  cards: ReactNode[];
  /** "Load more" and anything after the list. */
  loadMore?: ReactNode;
  /** The filtered list's total, when a visitor filter is on. */
  matching?: { value: number; floor: boolean } | null;
  /** A job opened on a desktop: it takes the rail's place, with its own "Back to {name}". */
  detail?: ReactNode;
}

/**
 * The whole page body, in the order the spec gives:
 *   phone   header · filters · results line · cards 1-3 · About accordion ·
 *           cards 4+ · similar employers · load more
 *   desktop header · [ filters · results line · list | About rail or the
 *           opened job ]
 */
export function CompanyLander(p: CompanyLanderProps) {
  const profile = useCompanyProfile(p.token, p.model);
  const empty = p.model.variant === "zero" || p.model.variant === "uncarried";
  const about: AboutEmployerProps = {
    model: p.model, token: p.token, profile, record: p.record, layoffRows: p.layoffRows,
    payStated: p.payStated, howApplying: p.howApplying,
  };
  return (
    <div data-company-lander={p.model.variant}>
      <CompanyLanderHeader {...p} profile={profile} boardsInPanel />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          {!empty && p.filterBar}
          {empty ? (
            <CompanyLanderEmpty model={p.model} token={p.token} profile={profile} boardReadAt={p.boardReadAt} />
          ) : (
            <>
              <CompanyResultsLine model={p.model} shown={p.cards.length} matching={p.matching} boardReadAt={p.boardReadAt} />
              <div className="space-y-3" data-company-list="">
                {p.cards.slice(0, 3)}
                <div className="lg:hidden"><CompanyLanderAccordion {...about} /></div>
                {p.cards.slice(3)}
              </div>
              <div className="lg:hidden"><CompanySimilarAfterFirstPage model={p.model} profile={profile} /></div>
              {p.loadMore}
            </>
          )}
        </div>
        {p.model.variant !== "uncarried" && (
          <div className="hidden lg:block">
            {/* Only an opened job sticks: the profile rail is taller than the
                screen, and a sticky element taller than the viewport hides its
                own lower sections until the list ends. */}
            <div className={p.detail ? "sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-3" : "space-y-3"}>
              {p.detail ?? (
                <CompanyLanderRail
                  {...about}
                  profile={p.model.variant === "zero" ? { ...profile, similar: [] } : profile}
                  labelOf={p.labelOf}
                  onShowOnly={p.onShowOnly}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
