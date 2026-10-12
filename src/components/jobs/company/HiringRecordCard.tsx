// THE HIRING RECORD, LED BY ONE PLAIN LINE.
//
// The Hiring Health card it replaces was three italic paragraphs (about 150
// words) of "we hold no closure record..." around one fact, and with the
// shared gate's refusals it grew longer (audit CP17). This card says one thing
// first -- the gated verdict in a sentence, or "No reliable hiring signal
// yet" -- and puts every refusal behind its own "Why?", in the gate's own
// words (the existing jobsPage.hhGate.* keys).
//
// EVERY FIGURE PASSES THROUGH THE SHARED GATE (src/lib/hiring-record-gate.ts,
// byte-identical with the edge functions' copy). The card asks
// hiringRecordGate for the row itself and prints only what it allows: no
// fourteen-day share or median on a board we confirm only by re-reading it in
// full (lap), no ninety-day counts where hundreds came down and none came
// back (relist detection unproven) or below the depth floor. The verdict
// arrives already gated from the page (gatedHiringRecord, activelyHiringVerdict);
// this file re-derives no bar.
//
// WORDS (CP22, CP9, CP8, plan D10). A takedown is "taken down (not
// relisted)", never "filled": we see a posting leave, not a hire. Each count
// is one plural sentence, never a prefix, a number and a suffix. The growth
// line names what it counts -- rows served on our daily read, counted
// differently from open roles -- and a rise under the bar reads "Not a rise of
// 25% or more: 69 on Oct 4, 72 on Oct 11", never "No rise" over a rise. The
// card does not repeat the open-roles figure: the header owns that number.
import { Activity, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  FILL_RATE_MIN_TRACKING_DAYS,
  HIRING_RECORD_GATE_COPY,
  coverageBand,
  hiringRecordGate,
  type HiringRecordGateCopyKey,
  type HiringRecordRow,
} from "@/lib/hiring-record-gate";
import { count as fmtCount, date as fmtDate, dateTime as fmtDateTime } from "@/lib/company/format";
import { tPlural } from "@/lib/company/plural";
import type { ActivelyHiringInput, GatedRecordInput, GrowthVerdictInput } from "@/lib/company/lander-model";
import { CompanyChip, ProfileSection, WhyDisclosure } from "./parts";

/** One row of get_company_fill_curve, as much of it as the card prints. */
export interface RecordCurve extends HiringRecordRow {
  open_roles?: number | null;
  fill_rate_14?: number | null;
  fill_rate_14_lo?: number | null;
  fill_rate_14_hi?: number | null;
  dated_n?: number | null;
}

/** One row of get_company_growth, as much of it as the card prints. */
export interface RecordGrowthRow {
  baseline_day: string | null;
  baseline_served: number | null;
  latest_day: string | null;
  latest_served: number | null;
  rate: number | null;
}

/** The page's constants the copy prints. Each is a mirror the page's own guards pin to its migration. */
export interface RecordBars {
  /** GROWTH_MIN_RATE as a whole percent (25). */
  growthMinRatePct: number;
  /** GROWTH_WINDOW_DAYS (7). */
  growthWindowDays: number;
  /** ACTIVELY_HIRING_WINDOW_DAYS (90). */
  closedWindowDays: number;
  /** URGENT_FILL_MAX_DAYS (14): the share's horizon. */
  shareDays: number;
  /** FILL_SUPPORT_MAX_DAYS (30): the median's support. */
  supportDays: number;
}

export interface HiringRecordInput {
  curve: RecordCurve | null;
  /** gatedHiringRecord(curve), from the page. */
  gated: GatedRecordInput;
  /** activelyHiringVerdict(gated.verdict, growthVerdict(row)), from the page. */
  actively: ActivelyHiringInput;
  /** admittedBy(gated.verdict, growth verdict), from the page. */
  admitted: "closes" | "grew" | "both" | null;
  /** relistCaution(curve), from the page. */
  relistCaution: boolean;
  growth: {
    verdict: GrowthVerdictInput;
    row: RecordGrowthRow | null;
    /** growthWhy(growthUnknownReason(row)), from the page: the reason in words, when the verdict is unknown. */
    why: string | null;
  };
  bars: RecordBars;
  /** When the fill curve was computed (the figures' date basis), when known. */
  computedAt?: string | null;
}

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
  return NaN;
};
const pct = (x: unknown) => Math.round(num(x) * 100);

/** Whether the card has anything to say: a curve row with roles or a closure record, or a growth reading. */
export function hiringRecordRenders(input: HiringRecordInput | null | undefined): boolean {
  if (!input || !input.curve) return false;
  const c = input.curve;
  return num(c.open_roles) > 0 || (num(c.filled_roles_90d) || 0) + (num(c.relisted_roles_90d) || 0) > 0 || input.growth.row != null;
}

/** The lead line: the gated verdict as one sentence, or the plain "no signal". */
export function recordLead(t: TFunction, input: HiringRecordInput, lang: string): string {
  const c = input.curve;
  const g = input.growth.row;
  const filled = num(c?.filled_roles_90d);
  const days = input.bars.closedWindowDays;
  if (input.actively === "positive") {
    const grewText = g
      ? t("companyProfile.record.leadGrew", "Its board served {{pct}}% more roles on {{latestDay}} than on {{baselineDay}}.", {
          pct: pct(g.rate), latestDay: fmtDate(g.latest_day ?? "", { lng: lang }), baselineDay: fmtDate(g.baseline_day ?? "", { lng: lang }),
        })
      : "";
    const closesText = Number.isFinite(filled)
      ? tPlural(t, "companyProfile.record.leadCloses", filled, { n: fmtCount(filled, { lng: lang }), days },
          "We watched {{n}} of its roles come off the board and stay off in the last {{days}} days.",
          "We watched {{n}} of its roles come off the board and stay off in the last {{days}} days.")
      : "";
    if (input.admitted === "both" && grewText && closesText) return `${closesText} ${grewText}`;
    if (input.admitted === "grew" && grewText) return grewText;
    if (closesText) return closesText;
    if (grewText) return grewText;
  }
  if (input.actively === "negative") {
    return t("companyProfile.record.leadNegative", "We read this board and saw neither a rise of {{minRate}}% or more in roles served nor a pattern of roles taken down and left down.", { minRate: input.bars.growthMinRatePct });
  }
  return t("companyProfile.record.leadUnknown", "No reliable hiring signal yet");
}

// THE GATE NAMES THE SENTENCE (Track 1, A1/GD5). Each refusal the shared gate
// makes carries the key of the sentence that explains it (countsCopy,
// paceCopy), so a lap-read board, an unproven read, a re-post test that reads
// other sites and a reply missing a column each say their own reason here.
function countsWhy(t: TFunction, c: RecordCurve, copy: HiringRecordGateCopyKey | null, minDays: number, lang: string): string {
  const d = num(c.tracking_days) || 0;
  switch (copy) {
    case "relist": return t("jobsPage.hhGate.relist", HIRING_RECORD_GATE_COPY.relist, { n: fmtCount(num(c.filled_roles_90d) || 0, { lng: lang }), d });
    case "relistLap": return t("jobsPage.hhGate.relistLap", HIRING_RECORD_GATE_COPY.relistLap);
    case "unprovenReadCounts": return t("jobsPage.hhGate.unprovenReadCounts", HIRING_RECORD_GATE_COPY.unprovenReadCounts);
    case "otherSites": return t("jobsPage.hhGate.otherSites", HIRING_RECORD_GATE_COPY.otherSites);
    case "unread": return t("jobsPage.hhGate.unread", HIRING_RECORD_GATE_COPY.unread);
    case "countsTrackingLap": return t("jobsPage.hhGate.countsTrackingLap", HIRING_RECORD_GATE_COPY.countsTrackingLap, { d, min: minDays });
    default: return t("jobsPage.hhGate.countsTracking", HIRING_RECORD_GATE_COPY.countsTracking, { d, min: minDays });
  }
}

function paceWhy(t: TFunction, c: RecordCurve, reason: string | null): string {
  const tracking = num(c.tracking_days) || 0;
  if (reason === "lap") return t("jobsPage.hhGate.lap", HIRING_RECORD_GATE_COPY.lap);
  if (reason === "unproven read") return t("jobsPage.hhGate.unprovenRead", HIRING_RECORD_GATE_COPY.unprovenRead);
  if (reason === "interval") return t("jobsPage.hhGate.interval", HIRING_RECORD_GATE_COPY.interval);
  if (reason === "coverage") return t("jobsPage.hhGate.coverage", HIRING_RECORD_GATE_COPY.coverage, { pct: pct(c.dated_coverage) });
  if (reason === "tracking" && tracking > 0) return t("jobsPage.hhGate.paceTracking", HIRING_RECORD_GATE_COPY.paceTracking, { d: tracking, min: FILL_RATE_MIN_TRACKING_DAYS });
  return tracking > 0
    ? t("jobsPage.hhPaceThin", "Not enough of this company's roles have finished yet to say how fast it moves — {{d}}d of tracking so far.", { d: tracking })
    : t("jobsPage.hhPaceThinUntracked", "Not enough of this company's roles have finished yet to say how fast it moves.");
}

export function HiringRecordCard({ input, floorOnly = false, headingLevel = 2 }: {
  input: HiringRecordInput | null;
  /** USAJOBS: only the tracking-floor reason prints. */
  floorOnly?: boolean;
  headingLevel?: 2 | 3;
}) {
  const { t, i18n } = useTranslation();
  if (!input || !hiringRecordRenders(input)) return null;
  const lang = i18n.language || "en";
  const c = input.curve!;
  const gate = hiringRecordGate(c);
  const filled = num(c.filled_roles_90d);
  const relisted = num(c.relisted_roles_90d);
  const tracking = num(c.tracking_days) || 0;
  const g = input.growth.row;
  const lead = recordLead(t, input, lang);
  const positive = input.actively === "positive";
  const why = t("companyProfile.record.why", "Why?");
  const title = t("companyProfile.record.title", "Hiring record");

  const counts = (() => {
    if (gate.counts90.ok) {
      if (filled > 0) {
        return (
          <li data-record="counts">
            {tPlural(t, "companyProfile.record.takenDown", filled, { n: fmtCount(filled, { lng: lang }), d: tracking },
              "{{n}} role taken down (not relisted) in {{d}} days of tracking",
              "{{n}} roles taken down (not relisted) in {{d}} days of tracking")}
          </li>
        );
      }
      return (
        <li>
          <WhyDisclosure label={why} stub={t("companyProfile.record.noTakedowns", "No roles taken down and left down to count yet.")} data-hh-gate="none">
            {relisted > 0
              ? t("jobsPage.hhRelistsOnly", "Every posting of theirs we have watched leave came back re-listed, so we have no clean take-down to count — at least {{n}} re-listings logged, and that count is a floor because we log one return per title per day.", { n: fmtCount(relisted, { lng: lang }) })
              : t("jobsPage.hhNoClosureRecord", "We hold no closure record for this employer: not one of their postings has been observed coming off the board. On a board bigger than one visit can read, no closure is observable to us until we complete a provable full pass and then watch a role go after it; on a board we do read in full, it means nothing came down while we watched. We cannot tell those apart from here, so this is a gap on our side and not a sign they are not hiring.")}
          </WhyDisclosure>
        </li>
      );
    }
    if (gate.counts90.reason === "unread" || gate.counts90.reason === "no row") return null;
    return (
      <li>
        <WhyDisclosure label={why} stub={t("companyProfile.record.countsWithheld", "We do not print how many roles came down and stayed down.")} data-hh-gate={gate.counts90.reason ?? undefined}>
          {countsWhy(t, c, gate.countsCopy, gate.countsMinTrackingDays, lang)}
        </WhyDisclosure>
      </li>
    );
  })();

  // The "up to" figure is the gate's ceiling: the fill share where the re-post
  // test files fills as fills, and every takedown (1 - S14) where it reads
  // other sites or cannot say, which has no fill interval to print.
  const pace = gate.share14.ok ? (
    <li data-record="pace" data-ceiling={gate.ceilingBasis ?? undefined}>
      {gate.ceilingBasis === "fills"
        ? t("jobsPage.hhFillRateDated", "Up to {{pct}}% of its roles come down for good within {{d}} days ({{lo}}–{{hi}}% either way), measured over the {{n}} roles that carry the company's own posting date.", {
            pct: pct(c.fill_rate_14), d: input.bars.shareDays, lo: pct(c.fill_rate_14_lo), hi: pct(c.fill_rate_14_hi), n: fmtCount(num(c.dated_n) || 0, { lng: lang }),
          })
        : t("jobsPage.hhTakedownRateDated", "Up to {{pct}}% of its roles came down within {{d}} days, counting every takedown, measured over the {{n}} roles that carry the company's own posting date.", {
            pct: pct(gate.ceiling14 ?? 0), d: input.bars.shareDays, n: fmtCount(num(c.dated_n) || 0, { lng: lang }),
          })}
      {/* The bound "fewer than half came down" is read from S through the
          gate (neverHalf); a censored fill median alone says nothing here. */}
      {!gate.median.ok ? null : c.median_censored ? (gate.neverHalf.ok ? (
        <> {t("jobsPage.hhMedianCensored", "We did not see half of them come down inside {{d}} days, so there is no typical figure to give.", { d: input.bars.supportDays })}</>
      ) : null) : (
        <> {t("companyProfile.record.median", "Half of these roles were taken down by day {{n}}.", { n: Math.round(num(c.median_days_to_fill)) })}</>
      )}
      {coverageBand(num(c.dated_coverage)) === "qualified" && (
        <> {t("jobsPage.fillCoverageQualifier", "Across the {{pct}}% of these roles that carry a posting date from the company itself.", { pct: pct(c.dated_coverage) })}</>
      )}
    </li>
  ) : (
    <li>
      <WhyDisclosure label={why} stub={t("companyProfile.record.paceWithheld", "We do not state how fast roles come down here.")} data-hh-gate={gate.share14.reason ?? undefined}>
        {paceWhy(t, c, gate.share14.reason)}
      </WhyDisclosure>
    </li>
  );

  const growthFigures = g ? {
    a: fmtCount(num(g.baseline_served) || 0, { lng: lang }),
    b: fmtCount(num(g.latest_served) || 0, { lng: lang }),
    d1: fmtDate(g.baseline_day ?? "", { lng: lang }),
    d2: fmtDate(g.latest_day ?? "", { lng: lang }),
  } : null;
  const growth = input.growth.verdict === "grew" && growthFigures ? (
    <li data-record="growth">
      {t("companyProfile.record.growthGrew", "A rise of {{pct}}% in rows served: {{a}} on {{d1}}, {{b}} on {{d2}}.", { ...growthFigures, pct: pct(g!.rate) })}
      <span className="block text-xs text-subtle-foreground">{t("companyProfile.record.growthLabel", "Rows served on our daily read, counted differently from open roles.")}</span>
    </li>
  ) : input.growth.verdict === "no-growth" && growthFigures ? (
    <li data-record="growth">
      {t("companyProfile.record.growthNone", "Not a rise of {{minRate}}% or more: {{a}} on {{d1}}, {{b}} on {{d2}}.", { ...growthFigures, minRate: input.bars.growthMinRatePct })}
      <span className="block text-xs text-subtle-foreground">{t("companyProfile.record.growthLabel", "Rows served on our daily read, counted differently from open roles.")}</span>
    </li>
  ) : (
    <li>
      <WhyDisclosure label={why} stub={t("companyProfile.record.growthUnread", "No posting rate for this board yet.")} data-growth="unknown">
        {t("jobsPage.hhGrowthUnread", "No posting rate for this board yet: {{reason}}. A gap in our record, not a sign they are not hiring.", { reason: input.growth.why ?? "" })}
      </WhyDisclosure>
    </li>
  );

  const floorReason = floorOnly && !gate.counts90.ok && gate.counts90.reason === "tracking" ? counts : null;

  return (
    <ProfileSection
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {title}
          {input.gated.withheld && (
            <CompanyChip tone="neutral" icon={<Info />} data-hh-withheld={input.gated.withheld}>
              {t("jobsPage.hhGate.withheldBadge", HIRING_RECORD_GATE_COPY.withheldBadge)}
            </CompanyChip>
          )}
        </span>
      }
      data-hiring-record={input.actively}
      headingLevel={headingLevel}
    >
      <p className="flex items-start gap-2 text-sm font-medium text-foreground" data-record-lead="">
        <Activity className={positive ? "mt-0.5 h-4 w-4 shrink-0 text-signal" : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"} aria-hidden="true" />
        <span>{lead}</span>
      </p>
      {floorOnly ? (
        floorReason ? <ul className="space-y-2">{floorReason}</ul> : null
      ) : (
        <ul className="space-y-2">
          {counts}
          {gate.counts90.ok && input.relistCaution && (
            <li className="text-foreground" data-record="relist-caution">
              {t("jobsPage.repostTipRoles", "In the last {{days}} days, {{n}} roles we watched come down here came back under the same posting or had another posting with the same title live when they came down; {{f}} came down and have not come back.", {
                days: input.bars.closedWindowDays, n: fmtCount(relisted || 0, { lng: lang }), f: fmtCount(filled || 0, { lng: lang }),
              })}
            </li>
          )}
          {pace}
          {growth}
        </ul>
      )}
      <p className="text-xs text-subtle-foreground">
        {t("jobsPage.hhFootnoteCurve", "Computed from the full lifecycle of this company's official postings — when they open and when they come down — not a one-time snapshot. Roles still up, and roles that passed our 30-day cap, are counted as unfinished rather than left out.")}
        {input.computedAt ? <> {t("companyProfile.record.asOf", "Figures as of {{when}}.", { when: fmtDateTime(input.computedAt, { lng: lang }) })}</> : null}
      </p>
    </ProfileSection>
  );
}
