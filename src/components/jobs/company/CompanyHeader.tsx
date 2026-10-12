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
// with its date basis: "1,653 open roles · read 46 min ago", or "10,000+ open
// roles · we count up to 10,000" at the list's cap. No "verified", no
// "{{roleWord}}" filled with English.
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
import { ago as fmtAgo, count as fmtCount } from "@/lib/company/format";
import { tPlural } from "@/lib/company/plural";
import type { LanderModel, OpenRolesValue } from "@/lib/company/lander-model";
import { AgencyBanner } from "./AgencyBanner";
import { CompanyChip } from "./parts";

/** A measured work-mode split; "not stated" is counted, never folded into a mode. */
export interface WorkModeSplit { remote: number; hybrid: number; onsite: number; unstated: number }

/** "1,653 open roles · read 46 min ago" / "10,000+ open roles · we count up to 10,000". Null when there is no figure. */
export function openRolesLine(t: TFunction, v: OpenRolesValue | null, lang: string): string | null {
  if (!v) return null;
  const n = fmtCount(v.value, { floor: v.floor, lng: lang });
  const head = tPlural(t, "companyProfile.openRoles", v.value, { n }, "{{n}} open role", "{{n}} open roles");
  if (v.capped) return `${head} · ${t("companyProfile.openRolesCapped", "we count up to {{cap}}", { cap: fmtCount(v.value, { lng: lang }) })}`;
  if (v.asOf) {
    const when = fmtAgo(v.asOf, { lng: lang });
    if (when) return `${head} · ${t("companyProfile.readAgo", "read {{ago}}", { ago: when })}`;
  }
  return head;
}

/** Jobs › Companies › {name}, at sm and up. */
export function CompanyBreadcrumb({ name }: { name: string | null }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("companyProfile.breadcrumbLabel", "Breadcrumb")} className="hidden sm:block mb-2 text-meta text-muted-foreground">
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
    <div className="flex flex-wrap items-center gap-2" data-company-actions="">
      <button
        type="button"
        onClick={onWatch}
        className="inline-flex min-h-9 max-w-full items-center gap-1.5 whitespace-normal rounded-md border border-border-strong bg-secondary px-3 py-1.5 text-left text-sm font-medium text-secondary-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
  /** The chip's basis, the page's hiringBadgeTip. */
  employerChipTip?: string;
  /** This board's own last read. */
  boardReadAt: string | null;
  onWatch: () => void;
  onCopyLink?: () => void;
}

export function CompanyHeader({ model, token, system, countries = [], workMode, payStated, employerChipTip, boardReadAt, onWatch, onCopyLink }: CompanyHeaderProps) {
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

  const answer = zero
    ? (boardReadAt && fmtAgo(boardReadAt, { lng: lang })
        ? `${t("companyProfile.zero.answer", "No open roles right now")} · ${t("companyProfile.boardReadAgo", "board read {{ago}}", { ago: fmtAgo(boardReadAt, { lng: lang }) })}`
        : t("companyProfile.zero.answer", "No open roles right now"))
    : openRolesLine(t, model.openRoles, lang);

  const subtitle = !name ? null : generic
    ? t("companyProfile.subtitleGeneric", "Live jobs straight from this board's own hiring system.")
    : t("companyProfile.subtitle", "Live jobs straight from {{companyPossessive}} own hiring system.", { company: name, companyPossessive: possessive(name) });

  const status = model.variant === "agency"
    ? <AgencyBanner />
    : model.sections.employerChip
      ? (
        <CompanyChip tone="signal" icon={<Activity />} title={employerChipTip} data-employer-chip="">
          {t("jobsPage.hiringBadge2", "Actively hiring")}
        </CompanyChip>
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
  if (workMode && workMode.remote + workMode.hybrid + workMode.onsite + workMode.unstated > 0) {
    facts.push(["workMode", t("companyProfile.facts.workModeLabel", "Work mode"), t("companyProfile.facts.workMode", "{{remote}} remote · {{hybrid}} hybrid · {{onsite}} on-site · {{unstated}} not stated", {
      remote: fmtCount(workMode.remote, { lng: lang }), hybrid: fmtCount(workMode.hybrid, { lng: lang }),
      onsite: fmtCount(workMode.onsite, { lng: lang }), unstated: fmtCount(workMode.unstated, { lng: lang }),
    })]);
  }
  if (payStated && payStated.n > 0) {
    facts.push(["pay", t("companyProfile.facts.payLabel", "Pay stated on"), t("companyProfile.facts.payValue", "{{k}} of {{n}}", { k: fmtCount(payStated.k, { lng: lang }), n: fmtCount(payStated.n, { lng: lang }) })]);
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
            : model.answerable || !name ? <span aria-hidden="true" className="block h-5 w-56 max-w-full rounded-md bg-muted animate-pulse motion-reduce:animate-none" /> : null}
          {subtitle && <p className="hidden sm:block text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {status}
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
        note={t("jobsPage.watchNote", "Your account will count their new postings since your last look.")}
      />
      {model.sections.claim && name && (
        <CompanyClaim companyToken={token} companyName={name} variant="menu" open={claimOpen} onOpenChange={setClaimOpen} />
      )}
    </header>
  );
}
