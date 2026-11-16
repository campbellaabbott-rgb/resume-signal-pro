// THE HIRING RECORD AS THE SITE WOULD PRINT IT (M2-01).
//
// employer_hiring_record printed every column of get_company_hiring_health:
// takedown EVENTS over ninety days and two medians, on every board. The site
// prints ROLES (filled_roles_90d, relisted_roles_90d) and one median, from
// get_company_fill_curve, and only where its gate admits them: a board read to
// its end, watched long enough, whose re-list test works. On lap-read boards,
// unproven reads and the tokens two hiring systems share it prints the gate's
// sentence instead, and it retired the two event medians on 2026-09-06. The
// connector was the one surface still printing them.
//
// So this module turns one fill-curve row into the figures the site would
// print and the gate's own words for the ones it would not, through the
// shared gate (../_shared/hiring-record-gate.ts, byte-identical to the
// site's). A read that failed, or a row the reader did not answer, prints the
// gate's 'unread' sentence and no figure. A token in the collision list
// (./board-collisions.ts, byte-identical to src/lib/board-collisions.ts) gets
// the site's refusal and nothing else. Pure, so a test calls it directly.
import {
  FILL_RATE_MIN_TRACKING_DAYS,
  HIRING_RECORD_GATE_COPY,
  fillGateCopy,
  hiringRecordGate,
  type HiringRecordGate,
  type HiringRecordGateCopyKey,
  type HiringRecordRow,
} from "../_shared/hiring-record-gate.ts";
import { collidedBoards } from "./board-collisions.ts";

/** What each half of the gate said: "ok", or the gate's reason. */
export interface RecordGate {
  counts: string;
  median: string;
  /** The gate's sentence for each refused half (HIRING_RECORD_GATE_COPY), or null when nothing is refused or the reason has no sentence. */
  sentence: string | null;
}

/** The unknown_reason of a token two hiring systems carry: the connector's own, decided before any reader. */
export const SHARED_TOKEN = "shared_token";

/** The days the site's censored median names (Jobs.tsx FILL_SUPPORT_MAX_DAYS). */
export const FILL_SUPPORT_DAYS = 30;
/** The site's sentence for a median that never reached half (jobsPage.hhMedianCensored). */
export const MEDIAN_CENSORED_COPY = "We did not see half of them come down inside {{d}} days, so there is no typical figure to give.";

/**
 * The site's refusal for a shared token (jobsPage.collision.body), its first
 * sentence word for word, then what it means here.
 */
export const SHARED_TOKEN_COPY =
  "Nothing we hold says whether these boards belong to one employer, and often they do not. " +
  "So no hiring record, growth reading or filing is given for this token, because we could not say which employer it would describe; " +
  "the roles of both boards stay in search.";

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};

/** The figures a refusal sentence quotes, as the site fills them (HiringRecordCard countsWhy and paceWhy). */
function copyOf(key: HiringRecordGateCopyKey | null, row: HiringRecordRow, g: HiringRecordGate): string | null {
  if (!key) return null;
  const d = num(row.tracking_days) || 0;
  const byKey: Partial<Record<HiringRecordGateCopyKey, Record<string, string | number>>> = {
    coverage: { pct: Math.round(num(row.dated_coverage) * 100) },
    paceTracking: { d, min: FILL_RATE_MIN_TRACKING_DAYS },
    countsTracking: { d, min: g.countsMinTrackingDays },
    countsTrackingLap: { d, min: g.countsMinTrackingDays },
    relist: { n: (num(row.filled_roles_90d) || 0).toLocaleString("en-US"), d },
  };
  return fillGateCopy(HIRING_RECORD_GATE_COPY[key], byKey[key] ?? {});
}

const joined = (parts: Array<string | null>): string | null => {
  const kept = [...new Set(parts.filter((p): p is string => !!p))];
  return kept.length ? kept.join(" ") : null;
};

/** No fill-curve row was read for this board: its record is unknown, and its note says why. */
export const NOT_JUDGED: RecordGate = { counts: "no row", median: "no row", sentence: null };

/** The read failed or did not answer this token: no figure, and the gate's 'unread' sentence. */
export const UNREAD: RecordGate = { counts: "unread", median: "unread", sentence: HIRING_RECORD_GATE_COPY.unread };

/**
 * One board's gated figures. `row` is its get_company_fill_curve row, or null
 * when the read failed or did not answer it (fail closed).
 */
export function gatedRecord(row: HiringRecordRow | null | undefined): { fields: Record<string, number | string>; gate: RecordGate } {
  if (!row) return { fields: {}, gate: UNREAD };
  const g = hiringRecordGate(row);
  const fields: Record<string, number | string> = {};
  let counts: string;
  let countsSentence: string | null = null;
  if (g.counts90.ok) {
    fields.filled_roles_90d = Math.round(num(row.filled_roles_90d));
    fields.relisted_roles_90d = Math.round(num(row.relisted_roles_90d));
    counts = "ok";
  } else {
    counts = g.counts90.reason ?? "unread";
    countsSentence = copyOf(g.countsCopy, row, g);
  }
  // The median prints where the site prints it: a whole day; or, where it is
  // censored, the site's sentence only when the thirty-day share bounds it
  // (neverHalf), and nothing otherwise.
  let median: string;
  let paceSentence: string | null = null;
  if (!g.median.ok) {
    median = g.median.reason ?? "unread";
    paceSentence = copyOf(g.paceCopy, row, g);
  } else if (row.median_censored === true) {
    if (g.neverHalf.ok) {
      fields.median_note = fillGateCopy(MEDIAN_CENSORED_COPY, { d: FILL_SUPPORT_DAYS });
      median = "ok";
    } else median = g.neverHalf.reason ?? "unread";
  } else {
    fields.median_days_to_fill = Math.round(num(row.median_days_to_fill));
    median = "ok";
  }
  return { fields, gate: { counts, median, sentence: joined([countsSentence, paceSentence]) } };
}

/** The boards behind a shared token, as the catalogue names them, or null for any other token. */
export function sharedTokenBoards(token: string): Array<{ source: string; name: string }> | null {
  return collidedBoards(token);
}
