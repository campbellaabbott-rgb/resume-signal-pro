// TWO ARMS SIDE BY SIDE, NEVER A RATIO -- AND A REASON WHEN THERE IS NO NUMBER.
//
// The Ghost Job Index's one section on layoff filings. It reads exactly one
// RPC, get_layoff_partition, which answers with the two rows the partition
// writer keeps (filed first, then control): the day-30 chain the category
// curve already publishes, partitioned on whether the employer had a
// qualifying filing in the LAYOFF_LOOKBACK_DAYS before the role's own
// posted_at. The sentence prints ONLY when BOTH rows are sufficient -- the
// category gate (n at the cap, half-width) on each, plus the employer floor
// and the share cap on the filed arm. `separated` (do the two S(30)
// intervals overlap?) is computed and printed, never gated on: an overlap is
// a finding, and the likelier one at launch.
//
// THE UNAVAILABLE STATE IS RENDERED, NEVER ABSENT (the leaderboard rule): a
// section that does not appear is indistinguishable from one that found
// nothing, on a page whose subject is whether numbers can be trusted. So
// when either arm fails its gate the section prints its title, the reason in
// words with the bar it did not clear, the sample so far where the row has
// one, and the same provenance the sentence would carry -- cadence, newest
// filing, read time, computed time. What it never prints in that state is a
// share, an interval, or either arm's figure. And in no state does it print
// one arm divided by the other: a quotient of two ceilings is not a number.
//
// Every threshold on screen is a placeholder rendered from
// src/config/layoffs.ts, which mirrors the SQL; every date is the RPC's own
// (date-only strings printed verbatim, timestamps in the reader's locale);
// the cadence words describe the cron rows and nothing faster. This file
// never calls get_employer_layoff_filings -- a per-posting surface and the
// aggregate never share a reader.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  LAYOFF_LOOKBACK_DAYS,
  LAYOFF_MAX_EMPLOYER_SHARE,
  LAYOFF_MIN_ARM_EMPLOYERS,
  LAYOFF_PARTITION_MAX_HALF_WIDTH_30,
  LAYOFF_PARTITION_MIN_N_AT_RISK_30,
  LAYOFF_READ_CADENCE,
  LAYOFF_INSUFFICIENT_REASONS,
  type LayoffInsufficientReason,
} from "@/config/layoffs";

/** One arm of the partition, as the reader states it. Numbers are coerced
 *  at the boundary; anything unparseable is null and null draws nothing. */
export interface LayoffPartitionArm {
  arm: "filed" | "control";
  sufficient: boolean;
  reason: LayoffInsufficientReason | null;
  takenDown30: number | null;
  stillOpen30: number | null;
  stillOpen30Lo: number | null;
  stillOpen30Hi: number | null;
  halfWidth30: number | null;
  nAtRisk30: number | null;
  employersN: number | null;
  cohortFrom: string | null;
  cohortTo: string | null;
  separated: boolean | null;
  newestFilingEventDate: string | null;
  warnLagP50Days: number | null;
  warnLagN: number | null;
  computedAt: string | null;
  filingsReadAt: string | null;
}

const numOr = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};
const dateOr = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null);

export function readPartitionArm(raw: unknown): LayoffPartitionArm | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const arm = r.lp_arm;
  if (arm !== "filed" && arm !== "control") return null;
  const reasonRaw = r.lp_reason;
  const reason = typeof reasonRaw === "string" && (LAYOFF_INSUFFICIENT_REASONS as readonly string[]).includes(reasonRaw)
    ? (reasonRaw as LayoffInsufficientReason)
    : null;
  const lo = numOr(r.lp_still_open_30_lo);
  const hi = numOr(r.lp_still_open_30_hi);
  const hw = numOr(r.lp_half_width_30);
  return {
    arm,
    sufficient: r.lp_sufficient_30 === true,
    reason,
    takenDown30: numOr(r.lp_taken_down_30),
    stillOpen30: numOr(r.lp_still_open_30),
    stillOpen30Lo: lo,
    stillOpen30Hi: hi,
    halfWidth30: hw ?? (lo !== null && hi !== null ? (hi - lo) / 2 : null),
    nAtRisk30: numOr(r.lp_n_at_risk_30),
    employersN: numOr(r.lp_employers_n),
    cohortFrom: dateOr(r.lp_cohort_from),
    cohortTo: dateOr(r.lp_cohort_to),
    separated: typeof r.lp_separated === "boolean" ? r.lp_separated : null,
    newestFilingEventDate: dateOr(r.lp_newest_filing_event_date),
    warnLagP50Days: numOr(r.lp_warn_lag_p50_days),
    warnLagN: numOr(r.lp_warn_lag_n),
    computedAt: typeof r.lp_computed_at === "string" ? r.lp_computed_at : null,
    filingsReadAt: typeof r.lp_filings_read_at === "string" ? r.lp_filings_read_at : null,
  };
}

export interface LayoffPartitionReading {
  filed: LayoffPartitionArm | null;
  control: LayoffPartitionArm | null;
}

export function readPartition(rows: unknown): LayoffPartitionReading {
  const out: LayoffPartitionReading = { filed: null, control: null };
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const arm = readPartitionArm(raw);
    if (arm) out[arm.arm] = arm;
  }
  return out;
}

/** Sufficient means BOTH arms say so and both carry the figures the
 *  sentence needs; anything less is the unavailable state, and the reason it
 *  prints is the filed arm's (the control's only when the filed arm passed). */
export function partitionSentenceFigures(p: LayoffPartitionReading): {
  rFiled: number; hwFiled: number; nFiled: number; eFiled: number;
  rControl: number; hwControl: number; nControl: number;
  cohortFrom: string; cohortTo: string; separated: boolean | null;
} | null {
  const f = p.filed, c = p.control;
  if (!f || !c || !f.sufficient || !c.sufficient) return null;
  if (f.takenDown30 === null || f.halfWidth30 === null || f.nAtRisk30 === null || f.employersN === null) return null;
  if (c.takenDown30 === null || c.halfWidth30 === null || c.nAtRisk30 === null) return null;
  if (!f.cohortFrom || !f.cohortTo) return null;
  const pc = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);
  return {
    rFiled: pc(f.takenDown30), hwFiled: Math.round(f.halfWidth30 * 100), nFiled: Math.round(f.nAtRisk30), eFiled: Math.round(f.employersN),
    rControl: pc(c.takenDown30), hwControl: Math.round(c.halfWidth30 * 100), nControl: Math.round(c.nAtRisk30),
    cohortFrom: f.cohortFrom, cohortTo: f.cohortTo, separated: f.separated ?? c.separated,
  };
}

/** Which arm's reason the unavailable state names. */
export function partitionUnavailableReason(p: LayoffPartitionReading): { reason: LayoffInsufficientReason; arm: LayoffPartitionArm | null } {
  const f = p.filed, c = p.control;
  if (!f) return { reason: "stale", arm: null };
  if (!f.sufficient) return { reason: f.reason ?? "n", arm: f };
  if (!c) return { reason: "stale", arm: null };
  return { reason: c.reason ?? "n", arm: c };
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown } | undefined>;
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

const fmtN = (n: number) => n.toLocaleString();
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

export function LayoffPartitionSection() {
  const { t } = useTranslation();
  /** undefined = in flight; null = the read failed (our side); rows otherwise. */
  const [partition, setPartition] = useState<LayoffPartitionReading | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await rpc("get_layoff_partition");
        if (cancelled) return;
        if (res?.error || !Array.isArray(res?.data)) { setPartition(null); return; }
        setPartition(readPartition(res.data));
      } catch {
        if (!cancelled) setPartition(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const cadenceWord = (c: string) =>
    c === "hourly" ? t("ghostIndex.layoffCadenceHourly", "hourly")
      : c === "nightly" ? t("ghostIndex.layoffCadenceNightly", "nightly")
        : c;
  const provenance = (arm: LayoffPartitionArm | null) => {
    const parts = [
      t("ghostIndex.layoffCadence", "Filings read {{cadenceEdgar}} from SEC EDGAR and {{cadenceWarn}} from state notices as consolidated by Big Local News", {
        cadenceEdgar: cadenceWord(LAYOFF_READ_CADENCE.edgar), cadenceWarn: cadenceWord(LAYOFF_READ_CADENCE.warn),
      }),
    ];
    if (arm?.newestFilingEventDate && arm.filingsReadAt) {
      parts.push(t("ghostIndex.layoffNewest", "newest filing held is dated {{newestFiling}}, read {{filingsReadAt}}", {
        newestFiling: arm.newestFilingEventDate, filingsReadAt: stamp(arm.filingsReadAt),
      }));
    }
    if (arm?.computedAt) parts.push(t("ghostIndex.layoffComputed", "computed {{computedAt}}", { computedAt: stamp(arm.computedAt) }));
    return `${parts.join("; ")}.`;
  };
  const lag = (arm: LayoffPartitionArm | null) =>
    arm && arm.warnLagP50Days !== null && (arm.warnLagN ?? 0) > 0 && arm.computedAt
      ? t("ghostIndex.layoffLag", "State notices reach the consolidated feed a median {{p50}} days after the notice date (measured {{measuredOn}}).", {
        p50: Math.round(arm.warnLagP50Days), measuredOn: stamp(arm.computedAt),
      })
      : null;

  const title = (
    <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
      <Briefcase className="w-4 h-4 text-primary" /> {t("ghostIndex.layoffTitle", "Roles at employers with a recent layoff filing")}
    </h2>
  );

  if (partition === undefined) {
    return (
      <div className="mb-8" data-layoff-partition="reading">
        {title}
        <span aria-hidden="true" className="inline-block h-4 w-64 rounded bg-muted animate-pulse align-middle" />
      </div>
    );
  }

  const figures = partition ? partitionSentenceFigures(partition) : null;

  if (figures) {
    const separatedSentence = figures.separated === null
      ? ""
      : figures.separated
        ? t("ghostIndex.layoffSeparated", "The two ranges do not overlap.")
        : t("ghostIndex.layoffOverlap", "The two ranges overlap, so this read does not tell them apart.");
    return (
      <div className="mb-8" data-layoff-partition="sentence">
        {title}
        <p className="text-sm text-muted-foreground">
          {t("ghostIndex.layoffSentence",
            "At employers that filed a layoff notice with a state workforce agency, or reported a workforce reduction in an SEC 8-K, in the {{lookback}} days before a role was posted, up to {{rFiled}}% of dated roles posted {{cohortFrom}} to {{cohortTo}} were taken down for good within 30 days (n={{nFiled}} roles at {{eFiled}} employers, ±{{hwFiled}} points); across the rest of the board, up to {{rControl}}% (n={{nControl}}, ±{{hwControl}}). {{separatedSentence}} Counted only on boards we read to the end. A takedown is not a hire, and a filing is a fact about an employer on one date — not a verdict on any role.",
            {
              lookback: LAYOFF_LOOKBACK_DAYS,
              rFiled: figures.rFiled, cohortFrom: figures.cohortFrom, cohortTo: figures.cohortTo,
              nFiled: fmtN(figures.nFiled), eFiled: fmtN(figures.eFiled), hwFiled: figures.hwFiled,
              rControl: figures.rControl, nControl: fmtN(figures.nControl), hwControl: figures.hwControl,
              separatedSentence,
            })}{" "}
          {provenance(partition!.filed)}
          {lag(partition!.filed) && <> {lag(partition!.filed)}</>}
        </p>
      </div>
    );
  }

  // THE UNAVAILABLE STATE. A failed read is our side and is named as such;
  // an answered read names the gate the filed arm (or, failing that, the
  // control arm) did not clear, with the bar it was measured against.
  const why = partition ? partitionUnavailableReason(partition) : { reason: "stale" as const, arm: null };
  const arm = why.arm;
  const reason = !partition
    ? t("ghostIndex.layoffReasonUnread", "the reading did not answer on this visit")
    : why.reason === "employers"
      ? t("ghostIndex.layoffReasonEmployers", "fewer than {{minEmployers}} employers with a qualifying filing have roles on boards we read to the end", { minEmployers: LAYOFF_MIN_ARM_EMPLOYERS })
      : why.reason === "share"
        ? t("ghostIndex.layoffReasonShare", "one employer holds more than {{maxShare}}% of the roles in that group", { maxShare: Math.round(LAYOFF_MAX_EMPLOYER_SHARE * 100) })
        : why.reason === "n"
          ? t("ghostIndex.layoffReasonN", "fewer than {{minN}} such roles reached our 30-day cap", { minN: LAYOFF_PARTITION_MIN_N_AT_RISK_30 })
          : why.reason === "width"
            ? t("ghostIndex.layoffReasonWidth", "the interval is wider than ±{{maxHw}} points", { maxHw: Math.round(LAYOFF_PARTITION_MAX_HALF_WIDTH_30 * 100) })
            : why.reason === "arithmetic"
              ? t("ghostIndex.layoffReasonArithmetic", "the three shares in that group did not add up to one on this read, so it is withheld")
              : arm?.computedAt
                ? t("ghostIndex.layoffReasonStale", "the reading has not been recomputed since {{computedAt}}", { computedAt: stamp(arm.computedAt) })
                : t("ghostIndex.layoffReasonUnwritten", "the reading has not been computed yet");
  // The sample so far, from the filed arm, where the row carries it.
  const filed = partition?.filed ?? null;
  const sample = filed && filed.nAtRisk30 !== null && filed.employersN !== null
    ? t("ghostIndex.layoffSampleSoFar", "So far {{nFiled}} such roles at {{eFiled}} employers have reached our 30-day cap.", {
      nFiled: fmtN(Math.round(filed.nAtRisk30)), eFiled: fmtN(Math.round(filed.employersN)),
    })
    : null;
  return (
    <div className="mb-8" data-layoff-partition="unavailable">
      {title}
      <p className="text-sm text-muted-foreground">
        {t("ghostIndex.layoffUnavailable", "No reading yet: {{reason}}. That is a fact about our sample, not about any employer.", { reason })}
        {sample && <> {sample}</>}
        {partition && <> {provenance(filed ?? partition.control)}</>}
        {lag(filed) && <> {lag(filed)}</>}
      </p>
    </div>
  );
}

export default LayoffPartitionSection;
