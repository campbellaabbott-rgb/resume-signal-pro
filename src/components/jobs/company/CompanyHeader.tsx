// THE COMPANY PAGE'S HEADER.
//
// PHONE FIRST (design spec 5.4, audit CP5): on a 375px screen the first job
// card sat 1,268-1,634px down, under intel, SEC figures, a claim link, badges,
// the whole Hiring Health card and the watch row. Now the phone header is the
// name (H1), one answer line, at most ONE status element (the "Actively
// hiring" chip, the agency banner, the collision line or the USAJOBS line),
// and one compact actions row: Watch, which wraps instead of widening the
// page (CP11), and a ⋯ menu holding Claim and Copy link. The breadcrumb, the
// subtitle and the facts come in at sm and up; on a phone they live in the
// "About this employer" accordion after the third card.
//
// ONE OPEN-ROLES FIGURE (CP7, CP10, CP3). The answer line prints the model's
// OpenRolesValue in one plural sentence, formatted in the reader's language,
// with its date basis named for what it dates: "1,653 open roles · read 46 min
// ago" (this board's feed read), "21,067+ open roles · counted 1 hr ago" (a
// count computed apart from the read), or "10,000+ open roles · we count up to
// 10,000 · read 5 min ago" at the list's cap. A figure with no date prints no
// line at all. No "verified", no "{{roleWord}}" filled with English.
//
// EVERY FACT IS DATED. The pay share prints the date its pair was read, and
// the work-mode split the read it was counted from; a fact without one is left
// out rather than printed bare.
//
// THE NAME NEVER COMES FROM THE TOKEN (CP15, CP16). The model hands a name
// from data or none; none renders a skeleton bar the height of the H1. A
// generic board label ("Corporate") never enters a sentence or a possessive:
// the H1 says 'Roles on the "Corporate" board (UKG)'.
//
// THE EMPLOYER CHIP APPEARS ONCE, HERE (CP26), and only when the gated
// verdict allows it; cards on a company page carry no employer badge.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, BookmarkCheck, ChevronRight, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { CompanyClaim } from "@/components/jobs/CompanyClaim";
import { possessive } from "@/lib/company-display";
import { ago as fmtAgo, count as fmtCount, date as fmtDate } from "@/lib/format";
import { tPlural } from "@/lib/company/plural";
import { SERVED_WINDOW_DAYS, type LanderModel, type OpenRolesValue } from "@/lib/company/lander-model";
import { AgencyBanner } from "./AgencyBanner";
import { Chip } from "@/components/ui/chip";

/** A measured work-mode split; "not stated" is counted, never folded into a mode. */
export interface WorkModeSplit { remote: number; hybrid: number; onsite: number; unstated: number }

/** The words for a figure's date: "read 46 min ago" or "counted 1 hr ago". Empty when it has none. */
export function openRolesBasis(t: TFunction, v: Pick<OpenRolesValue, "asOf" | "basis">, lang: string): string {
  const when = v.asOf ? fmtAgo(v.asOf, { lng: lang }) : "";
  if (!when) return "";
  return v.basis === "counted"
    ? t("companyProfile.countedAgo", "counted {{ago}}", { ago: when })
    : t("companyProfile.readAgo", "read {{ago}}", { ago: when });
}

/**
 * "1,653 roles dated in the last 30 days · read 46 min ago" / "10,000+ roles
 * dated in the last 30 days · we count up to 10,000 · read 5 min ago". Null
 * when there is no figure, and null when the figure has no date: a count that
 * cannot say when it was true is not printed.
 *
 * THE FIGURE STATES ITS BASIS (Track 1, A3). The list serves roles dated in
 * the last 30 days, and the page used to call them all of the employer's open
 * roles (Stripe 260 against 727 on its own board, 2026-10-11). An undated role
 * is served by the day we first saw it, so where the reply says how many carry
 * no date (undated), they are split off: "240 roles dated in the last 30 days
 * (20 more carry no date)". A floor is never split.
 */
/**
 * THE ONE SPLIT of the page's figure into roles dated in the window and roles
 * with no date. The header's answer line and the results line both read it,
 * so one page cannot call an undated role dated in one line and split it off
 * in the other (2026-10-18 review: exacare-inc, 8 dated and 2 undated, read
 * "8 roles dated" above "Showing 10 of 10 roles dated"). A floor is never
 * split, and a count of undated roles the figure cannot hold is ignored.
 */
export function openRolesSplit(v: Pick<OpenRolesValue, "value" | "floor">, undated?: number | null): { dated: number; undated: number } {
  const u = !v.floor && typeof undated === "number" && Number.isFinite(undated) && undated > 0 && undated <= v.value ? undated : 0;
  return { dated: v.value - u, undated: u };
}

export function openRolesLine(t: TFunction, v: OpenRolesValue | null, lang: string, undated?: number | null): string | null {
  if (!v) return null;
  const dated = openRolesBasis(t, v, lang);
  if (!dated) return null;
  const { dated: datedN, undated: u } = openRolesSplit(v, undated);
  const n = fmtCount(datedN, { floor: v.floor, lng: lang });
  const head = tPlural(t, "companyProfile.openRoles", datedN, { n, days: SERVED_WINDOW_DAYS }, "{{n}} role dated in the last {{days}} days", "{{n}} roles dated in the last {{days}} days")
    + (u > 0 ? ` ${t("companyProfile.undatedMore", "({{u}} more carry no date)", { u: fmtCount(u, { lng: lang }) })}` : "");
  if (v.capped) return `${head} · ${t("companyProfile.openRolesCapped", "we count up to {{cap}}", { cap: fmtCount(v.value, { lng: lang }) })} · ${dated}`;
  return `${head} · ${dated}`;
}

/**
 * "Their board listed 727 roles in all when we read it 2 hr ago." The
 * employer's own total from the last complete read, printed only when the
 * model let it through (fresh, complete, not a vendor's cap); null otherwise.
 */
export function boardTotalLine(t: TFunction, model: Pick<LanderModel, "boardTotal">, lang: string): string | null {
  const b = model.boardTotal;
  if (!b) return null;
  const ago = fmtAgo(b.readAt, { lng: lang });
  if (!ago) return null;
  return tPlural(t, "companyProfile.boardTotal", b.total, { total: fmtCount(b.total, { lng: lang }), ago },
    "Their board listed {{total}} role in all when we read it {{ago}}.",
    "Their board listed {{total}} roles in all when we read it {{ago}}.");
}

/**
 * THE ZERO PAGE'S ANSWER (Track 1, A3). "No open roles right now" was said of
 * boards that list older roles (BASS ABA: none served, 31 on its own board,
 * 38 to 101 days old, 2026-10-11). Now:
 *   older  -> "None of the 31 roles on BASS ABA's board is dated in the last
 *             30 days (read Oct 12). We show roles dated in the last 30 days."
 *   empty  -> "No roles on BASS ABA's job board when we read it 5 hr ago."
 *   unread -> "We have not read BASS ABA's whole board recently."
 *   null (the curve has not answered) -> "No roles dated in the last 30 days",
 *             which the list itself supports.
 * A generic board label ("Corporate") never takes a possessive.
 */
export function zeroAnswer(t: TFunction, model: Pick<LanderModel, "zeroReading" | "boardTotal" | "name">, lang: string): string {
  const { name, generic } = model.name;
  const own = !!name && !generic;
  const companyPossessive = own ? possessive(name!) : "";
  const b = model.boardTotal;
  if (model.zeroReading === "older" && b) {
    const vars = { total: fmtCount(b.total, { lng: lang }), date: fmtDate(b.readAt, { lng: lang }), company: name ?? "", companyPossessive, days: SERVED_WINDOW_DAYS };
    const head = own
      ? tPlural(t, "companyProfile.zero.older", b.total, vars, "The {{total}} role on {{companyPossessive}} board is not dated in the last {{days}} days (read {{date}}).", "None of the {{total}} roles on {{companyPossessive}} board is dated in the last {{days}} days (read {{date}}).")
      : tPlural(t, "companyProfile.zero.olderBoard", b.total, vars, "The {{total}} role on this board is not dated in the last {{days}} days (read {{date}}).", "None of the {{total}} roles on this board is dated in the last {{days}} days (read {{date}}).");
    return `${head} ${t("companyProfile.zero.basis", "We show roles dated in the last {{days}} days.", { days: SERVED_WINDOW_DAYS })}`;
  }
  if (model.zeroReading === "empty" && b) {
    const ago = fmtAgo(b.readAt, { lng: lang });
    return own
      ? t("companyProfile.zero.empty", "No roles on {{companyPossessive}} job board when we read it {{ago}}.", { company: name, companyPossessive, ago })
      : t("companyProfile.zero.emptyBoard", "No roles on this board when we read it {{ago}}.", { ago });
  }
  if (model.zeroReading === "unread") {
    return own
      ? t("companyProfile.zero.unread", "We have not read {{companyPossessive}} whole board recently.", { company: name, companyPossessive })
      : t("companyProfile.zero.unreadBoard", "We have not read this whole board recently.");
  }
  return t("companyProfile.zero.answer", "No roles dated in the last {{days}} days", { days: SERVED_WINDOW_DAYS });
}

/** Jobs › Companies › {name}, at sm and up. */
export function CompanyBreadcrumb({ name }: { name: string | null }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("companyProfile.breadcrumbLabel", "Breadcrumb")} className="hidden sm:block text-meta text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        <li><Link to="/jobs" className="underline decoration-border-strong underline-offset-2 hover:text-primary hover:decoration-primary">{t("companyProfile.breadcrumbJobs", "Jobs")}</Link></li>
        <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
        <li><Link to="/companies" className="underline decoration-border-strong underline-offset-2 hover:text-primary hover:decoration-primary">{t("companyProfile.breadcrumbCompanies", "Companies")}</Link></li>
        {name && (
          <>
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li aria-current="page" className="min-w-0 truncate text-foreground">{name}</li>
          </>
        )}
      </ol>
    </nav>
  );
}

/** Watch (wraps, never widens the page) and a ⋯ menu. Shared by every header variant. */
export function HeaderActions({ watchLabel, menuLabel, onWatch, onClaim, onCopyLink, note }: {
  watchLabel: string;
  /** "More actions for {name}". */
  menuLabel: string;
  onWatch: () => void;
  /** Present only where a claim is offered (never on a collision, USAJOBS or agency page). */
  onClaim?: () => void;
  onCopyLink?: () => void;
  note?: ReactNode;
}) {
  const { t } = useTranslation();
  const copy = onCopyLink ?? (() => {
    const href = typeof window !== "undefined" ? window.location.href : "";
    const done = () => toast({ title: t("companyProfile.actions.copied", "Link copied") });
    try {
      void navigator.clipboard?.writeText(href).then(done, () => { /* clipboard refused: nothing to say */ });
    } catch { /* no clipboard */ }
  });
  return (
    <div className="flex items-center gap-2" data-company-actions="">
      {/* Watch wraps its own label instead of pushing the ⋯ menu to a row of its own (CP11). */}
      <button
        type="button"
        onClick={onWatch}
        className="inline-flex min-h-9 min-w-0 max-w-full shrink items-center gap-1.5 whitespace-normal rounded-md border border-border-strong bg-secondary px-3 py-1.5 text-left text-sm font-medium text-secondary-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <BookmarkCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{watchLabel}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={menuLabel}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-strong bg-card text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {onClaim && (
            <DropdownMenuItem onSelect={onClaim}>{t("companyProfile.actions.claim", "Claim this profile")}</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={copy}>{t("companyProfile.actions.copyLink", "Copy link")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {note ? <span className="hidden sm:inline text-xs text-subtle-foreground">{note}</span> : null}
    </div>
  );
}

/** The H1 while the name has not arrived: a bar the height of the heading, and words for a screen reader. */
function NameSkeleton() {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden="true" className="block h-8 w-40 max-w-full rounded-md bg-muted animate-pulse motion-reduce:animate-none sm:h-9" />
      <span className="sr-only">{t("companyProfile.nameLoading", "Loading the employer's name")}</span>
    </>
  );
}

export interface CompanyHeaderProps {
  model: LanderModel;
  token: string;
  /** The hiring system's own name (the page's sourceLabel), or null. */
  system: string | null;
  /** Up to three country codes with the most open roles (from the intel reader). */
  countries?: string[];
  workMode?: WorkModeSplit | null;
  payStated?: { k: number; n: number; asOf: string | null } | null;
  /** When the work-mode split was counted; this board's own read when absent. */
  workModeAsOf?: string | null;
  /** The chip's basis, the page's hiringBadgeTip. */
  employerChipTip?: string;
  /** This board's own last read. */
  boardReadAt: string | null;
  /**
   * The employer's headcount, only with the day it was true (datedHeadcount,
   * owner decision D11): no row carries that date today, so none prints.
   */
  headcount?: { n: number; asOf: string; basis: "yc_self_reported" | "public_records" | string | null } | null;
  onWatch: () => void;
  onCopyLink?: () => void;
}

export function CompanyHeader({ model, token, system, countries = [], workMode, payStated, workModeAsOf, employerChipTip, boardReadAt, headcount, onWatch, onCopyLink }: CompanyHeaderProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const [claimOpen, setClaimOpen] = useState(false);
  const { name, generic } = model.name;
  const zero = model.variant === "zero";

  const h1 = !name
    ? <NameSkeleton />
    : generic
      ? (system
          ? t("companyProfile.h1GenericSystem", "Roles on the “{{label}}” board ({{system}})", { label: name, system })
          : t("companyProfile.h1Generic", "Roles on the “{{label}}” board", { label: name }))
      : name;

  // The zero page says what the last complete read of the board saw (A3);
  // only the list's own "none dated in our window" carries the list's read.
  const zeroLine = zero ? zeroAnswer(t, model, lang) : null;
  const answer = zero
    ? (model.zeroReading === null && boardReadAt && fmtAgo(boardReadAt, { lng: lang })
        ? `${zeroLine} · ${t("companyProfile.boardReadAgo", "board read {{ago}}", { ago: fmtAgo(boardReadAt, { lng: lang }) })}`
        : zeroLine)
    : openRolesLine(t, model.openRoles, lang, model.undatedOpen);
  const totalLine = zero ? null : boardTotalLine(t, model, lang);

  // Not on the zero variant: "Live jobs straight from X's own hiring system"
  // under "No open roles right now" promises jobs the page does not have.
  const subtitle = !name || zero ? null : generic
    ? t("companyProfile.subtitleGeneric", "Live jobs straight from this board's own hiring system.")
    : t("companyProfile.subtitle", "Live jobs straight from {{companyPossessive}} own hiring system.", { company: name, companyPossessive: possessive(name) });

  const status = model.variant === "agency"
    ? <AgencyBanner />
    : model.sections.employerChip
      ? (
        <Chip variant="signal" icon={<Activity />} title={employerChipTip} data-employer-chip="">
          {t("jobsPage.hiringBadge2", "Actively hiring")}
        </Chip>
      )
      : null;

  const listFormat = (items: string[]) => {
    try {
      const LF = (Intl as unknown as { ListFormat: new (l: string, o: Record<string, string>) => { format: (x: string[]) => string } }).ListFormat;
      return new LF(lang, { style: "short", type: "conjunction" }).format(items);
    } catch { return items.join(", "); }
  };
  const countryNames = countries.slice(0, 3).map((c) => {
    try { return new Intl.DisplayNames([lang], { type: "region" }).of(c) ?? c; } catch { return c; }
  });
  // Each fact appears only when the page already holds its data.
  const facts: Array<[key: string, label: string, value: string]> = [];
  if (system) facts.push(["system", t("companyProfile.facts.systemLabel", "Hiring system"), system]);
  if (countryNames.length > 0) facts.push(["countries", t("companyProfile.facts.countriesLabel", "Most roles in"), listFormat(countryNames)]);
  const workModeRead = openRolesBasis(t, { asOf: workModeAsOf ?? boardReadAt, basis: workModeAsOf ? "counted" : "read" }, lang);
  if (workMode && workModeRead && workMode.remote + workMode.hybrid + workMode.onsite + workMode.unstated > 0) {
    facts.push(["workMode", t("companyProfile.facts.workModeLabel", "Work mode"), `${t("companyProfile.facts.workMode", "{{remote}} remote · {{hybrid}} hybrid · {{onsite}} on-site · {{unstated}} not stated", {
      remote: fmtCount(workMode.remote, { lng: lang }), hybrid: fmtCount(workMode.hybrid, { lng: lang }),
      onsite: fmtCount(workMode.onsite, { lng: lang }), unstated: fmtCount(workMode.unstated, { lng: lang }),
    })} · ${workModeRead}`]);
  }
  const payRead = payStated?.asOf ? fmtDate(payStated.asOf, { lng: lang }) : "";
  if (headcount && model.sections.perks && headcount.n > 0 && /^\d{4}-\d{2}-\d{2}$/.test(headcount.asOf)) {
    const band = headcount.n >= 1000 ? t("jobsPage.intel.bandEnterprise", "enterprise")
      : headcount.n >= 100 ? t("jobsPage.intel.bandMid", "mid-market")
      : t("jobsPage.intel.bandSmall", "startup-size");
    facts.push(["headcount", t("companyProfile.facts.headcountLabel", "Headcount"), `${t("jobsPage.intel.employees", "≈{{n}} employees ({{basis}}) · {{band}}", {
      n: fmtCount(headcount.n, { lng: lang }),
      basis: headcount.basis === "yc_self_reported" ? t("jobsPage.intel.basisYc", "YC profile") : t("jobsPage.intel.basisPr", "public records"),
      band,
    })} · ${t("jobsPage.intel.asOf", "as of {{date}}", { date: fmtDate(headcount.asOf, { lng: lang }) })}`]);
  }
  if (payStated && payStated.n > 0 && payRead) {
    facts.push(["pay", t("companyProfile.facts.payLabel", "Pay stated on"), `${t("companyProfile.facts.payValue", "{{k}} of {{n}}", { k: fmtCount(payStated.k, { lng: lang }), n: fmtCount(payStated.n, { lng: lang }) })} · ${t("companyProfile.pay.read", "read {{date}}", { date: payRead })}`]);
  }

  const displayName = name ?? token;
  const watchLabel = !name
    ? t("companyProfile.actions.watchThis", "Watch this board")
    : generic
      ? t("companyProfile.actions.watchGeneric", "Watch the “{{label}}” board", { label: name })
      : t("jobsPage.watchCta", "Watch {{company}}", { company: name });

  return (
    <header data-company-header={model.variant} className="mb-4 space-y-3">
      <CompanyBreadcrumb name={name} />
      <div className="flex items-start gap-3">
        {name && !generic && (
          <span aria-hidden="true" className="hidden sm:inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-lg font-semibold text-muted-foreground">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground break-words sm:text-3xl">{h1}</h1>
          {answer
            ? <p className="text-sm font-medium text-foreground sm:text-base" data-company-answer="">{answer}</p>
            : !model.openRoles && (model.answerable || !name) ? <span aria-hidden="true" className="block h-5 w-56 max-w-full rounded-md bg-muted animate-pulse motion-reduce:animate-none" /> : null}
          {answer && totalLine && <p className="text-meta text-muted-foreground" data-company-board-total="">{totalLine}</p>}
          {subtitle && <p className="hidden sm:block text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {status}
      {/* At sm and up the facts and the actions share one row, so the first
          card stays inside the desktop fold budget. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-2">
        {facts.length > 0 && (
          <dl className="hidden sm:flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted-foreground" aria-label={t("companyProfile.factsLabel", "About this board")}>
            {facts.map(([k, label, value]) => (
              <div key={k} data-fact={k} className="flex flex-wrap gap-x-1">
                <dt className="font-medium text-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <HeaderActions
          watchLabel={watchLabel}
          menuLabel={t("companyProfile.actions.more", "More actions for {{name}}", { name: displayName })}
          onWatch={onWatch}
          onClaim={model.sections.claim && name ? () => setClaimOpen(true) : undefined}
          onCopyLink={onCopyLink}
        />
      </div>
      {model.sections.claim && name && (
        <CompanyClaim companyToken={token} companyName={name} variant="menu" open={claimOpen} onOpenChange={setClaimOpen} />
      )}
    </header>
  );
}
