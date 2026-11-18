/**
 * IS THIS JOB REAL? WHAT WE SAW OF ONE POSTING, SAID NO MORE STRONGLY THAN
 * WE SAW IT.
 *
 * The database half is posting_truth(p_ids) and company_facts(p_tokens)
 * (20261206100000). This module turns their rows into the answer a check
 * prints, and it is pure: no client, no clock but the one handed in, so the
 * Node suite runs it exactly as Deno does.
 *
 * THE STATES, from what our own records hold, by id only:
 *   open               listed at our last read and inside the 30-day window.
 *                      Worded by how the board is read: only a board read to
 *                      its end, whose newest read completed, may say the read
 *                      listed the posting (the hiring-record gate's own
 *                      feed-read rule, GD6). Any other board says it is read
 *                      in parts and makes no claim about this posting.
 *   going_down         stamped missing at our last read, no trusted closure.
 *   closed             a trusted closure. A closure the collector could date
 *                      only by the lap that first saw it gone says so.
 *   aged_out           still advertised when its date passed our window.
 *   not_carried        a board we read, and no record of this id; the
 *                      sentence names the window fence and, where the board
 *                      is read in parts or capped, the part we never read.
 *   board_not_carried  a board we do not read.
 *   withheld           a source or employer this API does not hand on.
 *   unknown_id         not an id we issue.
 * A re-post is answered only when the SAME id came back after a trusted
 * closure. No title is matched against another posting.
 *
 * THE AGE is the employer's date only (date-classes.ts): our discovery stamp
 * is never read, and a posting with no employer date has no age.
 *
 * EVERY EMPLOYER NUMBER GOES THROUGH THE HIRING-RECORD GATE
 * (_shared/hiring-record-gate.ts, the page's own rules, held byte-identical
 * there). A figure the gate refuses is not printed; the gate's reason is, with
 * a sentence. On top of the gate, a day-30 share whose record holds no
 * takedown event at all is refused with the gate's own term 'events': a
 * share of 100% still advertised drawn from no event is the S(30)
 * positive-control failure (dominos, 2026-09-27). Facts the database had no
 * budget to compute this minute answer not_computed_yet: the employer_compute
 * bucket is one global budget, shared by every surface that prints them.
 */
import {
  feedReadStatable,
  fillGateCopy,
  FULL_READ_BUCKET,
  HIRING_RECORD_GATE_COPY,
  hiringRecordGate,
  type HiringRecordRow,
} from "../_shared/hiring-record-gate.ts";
import { postingAge, type PostingAge } from "./date-classes.ts";

export const POSTING_TRUTH_RPC = "posting_truth";
export const COMPANY_FACTS_RPC = "company_facts";
export const EXPENSIVE_TAKE_RPC = "api_expensive_take";
/** The one global bucket for uncached employer facts (api_expensive_take). */
export const EMPLOYER_COMPUTE_BUCKET = "employer_compute";
/** The bucket's cap a minute, fixed in 20261206100000; a test holds the two equal. */
export const EMPLOYER_COMPUTE_PER_MINUTE = 10;
/** Ids one check may name; posting_truth reads the first ten and no more. */
export const POSTING_TRUTH_MAX_IDS = 10;
export const NOT_COMPUTED_YET = "not_computed_yet";
/** What an employer figure covers: one board token, never a sum across an employer's boards. */
export const EMPLOYER_SCOPE = "all roles on this board";

export type TruthState =
  | "open" | "going_down" | "closed" | "aged_out" | "not_carried" | "board_not_carried" | "withheld" | "unknown_id";

export const TRUTH_STATES: readonly TruthState[] = [
  "open", "going_down", "closed", "aged_out", "not_carried", "board_not_carried", "withheld", "unknown_id",
];

/** One sentence per case. Placeholders are {{name}}, filled by the gate's fillGateCopy. */
export const TRUTH_COPY = {
  openFullRead: "We read the employer's whole board {{ago}} and this posting was listed.",
  openFullReadIncomplete:
    "This board is read in full, but our newest read of it did not complete, so we do not say when this posting was last listed.",
  openInParts: "This board is read in parts; we last read part of it {{ago}}.",
  openInPartsNoRead: "This board is read in parts, and we have no record of when we last read it.",
  openNoRead: "We have no record of when we last read this employer's board, so we do not say when this posting was last listed.",
  sameIdCameBack: "It came down once before, and this same posting came back.",
  goingDown: "Missing from the employer's system at our last read; we have not yet confirmed it came down.",
  closed: "Came down from the employer's system by {{closedAt}}.",
  closedSeenLate:
    "We first saw it gone from the employer's system on {{seenGoneAt}}; it came down on or before that day.",
  agedOut: "Still advertised by the employer when its own date passed our 30-day window on {{agedAt}}; we have not read it since.",
  agedOutUndated:
    "Still advertised by the employer when it passed our 30-day window on {{agedAt}}; the employer gives it no date, and we have not read it since.",
  agedOutPending: "Still advertised by the employer at our last read, but past our 30-day window, so we no longer list it.",
  notCarriedFullRead:
    "We have no record of this id on a board we read: it may have closed more than 180 days ago, or we never listed it (dated more than 30 days ago).",
  notCarriedInParts:
    "We have no record of this id on a board we read: it may have closed more than 180 days ago, or we never listed it (dated more than 30 days ago, or past the part of a large board we read).",
  boardNotCarried: "We don't read this employer's board, so we have no record of this posting.",
  unknownId: "That is not a posting id we issue. Send an id as /v1/jobs returns it: <source>:<company_token>:<external id>.",
} as const;

/** The employer block's own sentences, for refusals the gate's copy does not word. */
export const EMPLOYER_COPY = {
  notComputedYet:
    "We have not worked out this employer's record in the last six hours, and the budget for working records out is spent for this minute. Ask again in a minute.",
  day30Unproven:
    "We do not state how long this employer's roles stay up: its record does not yet pass our test for a share still advertised at day 30. This is a limit of our record, not a fact about the employer.",
  noEvents:
    "We do not state how long this employer's roles stay up: we have seen none of its roles taken down in the period the share would cover, so a share would say nothing. This is a limit of our record, not a fact about the employer.",
} as const;

/** One row of posting_truth (20261206100000). Timestamps arrive as strings. */
export interface PostingTruthRow {
  pt_id: string;
  pt_source: string | null;
  pt_token: string | null;
  pt_title: string | null;
  pt_company: string | null;
  pt_row_found: boolean;
  pt_listed: boolean;
  pt_in_window: boolean;
  pt_missing_since: string | null;
  pt_posted_at: string | null;
  pt_has_closure: boolean;
  pt_closed_at: string | null;
  pt_seen_gone_at: string | null;
  pt_aged_at: string | null;
  pt_board_known: boolean;
  pt_bucket: string | null;
  pt_read_at: string | null;
  pt_read_state: string | null;
  pt_capped: boolean | null;
}

export interface BoardRead {
  /** The observability bucket; null when the board has none. */
  bucket: string | null;
  /** Our newest read of the board, and how it went (ok, empty, truncated, error, dark). */
  readAt: string | null;
  readState: string | null;
  /** The last stated total is Workday's 2,000 cap; null when no complete read stated one. */
  capped: boolean | null;
  /** True unless the board is read to its end and its newest read completed. */
  inParts: boolean;
}

export interface PostingTruth {
  id: string;
  state: TruthState;
  sentence: string;
  source: string | null;
  companyToken: string | null;
  title: string | null;
  company: string | null;
  /** From the employer's date only; null where we hold no record of the posting. */
  age: PostingAge | null;
  read: BoardRead | null;
  /** A trusted takedown's date. */
  closedAt: string | null;
  /** True when the only date we hold is the day we first saw it gone. */
  closedAtIsObservation: boolean;
  agedAt: string | null;
  /** Id-based only: the same id served again after a trusted closure. */
  relisted: { sameIdCameBack: boolean } | null;
}

export interface TruthOptions {
  now?: Date;
  /** Sources this API does not hand on, and the one sentence that says why. */
  withheldSources: readonly string[];
  withheldReason: string;
  /** Board tokens whose postings come from a withheld source; null when unknown. */
  withheldTokens?: ReadonlySet<string> | null;
}

const SOURCE_SHAPE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** `<source>:<company_token>:<external id>`, as /v1/jobs returns it; null for anything else. */
export function parsePostingId(id: unknown): { source: string; token: string; native: string } | null {
  if (typeof id !== "string" || id.length > 512) return null;
  const [source, token, ...rest] = id.split(":");
  const native = rest.join(":");
  if (!source || !token || !native) return null;
  const s = source.toLowerCase();
  if (!SOURCE_SHAPE.test(s) || /\s/.test(token)) return null;
  return { source: s, token, native };
}

const bare = (id: string, state: TruthState, sentence: string, source: string | null, token: string | null): PostingTruth => ({
  id, state, sentence, source, companyToken: token, title: null, company: null, age: null, read: null,
  closedAt: null, closedAtIsObservation: false, agedAt: null, relisted: null,
});

/**
 * What can be said before the database is asked: an id we do not issue, or
 * one from a source or employer this API withholds. Null when the database
 * must answer.
 */
export function preCheck(id: string, opts: TruthOptions): PostingTruth | null {
  const p = parsePostingId(id);
  if (!p) return bare(String(id), "unknown_id", TRUTH_COPY.unknownId, null, null);
  const barred = opts.withheldSources.map((s) => s.trim().toLowerCase());
  if (barred.includes(p.source) || opts.withheldTokens?.has(p.token)) {
    return bare(id, "withheld", opts.withheldReason, p.source, p.token);
  }
  return null;
}

/** The ids posting_truth must be asked about, in the order given, each once. */
export function idsToAsk(ids: readonly string[], opts: TruthOptions): string[] {
  return [...new Set(ids)].filter((id) => preCheck(id, opts) === null);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** "less than an hour ago", "5 hours ago", "3 days ago"; null for no stamp. */
export function agoText(iso: string | null | undefined, now: Date): string | null {
  if (typeof iso !== "string") return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const ms = Math.max(0, now.getTime() - at);
  if (ms < HOUR_MS) return "less than an hour ago";
  if (ms < 2 * DAY_MS) {
    const h = Math.floor(ms / HOUR_MS);
    return h === 1 ? "1 hour ago" : `${h} hours ago`;
  }
  return `${Math.floor(ms / DAY_MS)} days ago`;
}

const dayOf = (iso: string | null): string | null =>
  typeof iso === "string" && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso)).toISOString().slice(0, 10) : null;

/** How the board is read, as the open sentence may say it. */
export function boardRead(row: Pick<PostingTruthRow, "pt_bucket" | "pt_read_at" | "pt_read_state" | "pt_capped">): BoardRead {
  const statable = row.pt_capped !== true
    && feedReadStatable({ observability_bucket: row.pt_bucket, feed_state: row.pt_read_state })
    && typeof row.pt_read_at === "string";
  return {
    bucket: row.pt_bucket ?? null,
    readAt: row.pt_read_at ?? null,
    readState: row.pt_read_state ?? null,
    capped: row.pt_capped ?? null,
    inParts: !statable,
  };
}

function openSentence(read: BoardRead, now: Date): string {
  const ago = agoText(read.readAt, now);
  if (!read.inParts && ago) return fillGateCopy(TRUTH_COPY.openFullRead, { ago });
  if (read.bucket === FULL_READ_BUCKET && read.capped !== true) {
    return ago ? TRUTH_COPY.openFullReadIncomplete : TRUTH_COPY.openNoRead;
  }
  return ago ? fillGateCopy(TRUTH_COPY.openInParts, { ago }) : TRUTH_COPY.openInPartsNoRead;
}

/** The answer for one id from its posting_truth row. */
export function truthFromRow(id: string, row: PostingTruthRow, opts: TruthOptions): PostingTruth {
  const now = opts.now ?? new Date();
  const p = parsePostingId(id);
  const source = row.pt_source ?? p?.source ?? null;
  const token = row.pt_token ?? p?.token ?? null;
  const read = boardRead(row);
  const base = {
    id, source, companyToken: token, title: row.pt_title ?? null, company: row.pt_company ?? null, read,
    closedAt: null as string | null, closedAtIsObservation: false, agedAt: null as string | null,
  };
  const age = postingAge(source, row.pt_posted_at, now);
  const record = { ...base, age, relisted: { sameIdCameBack: false } };

  if (row.pt_row_found && row.pt_listed && row.pt_in_window) {
    const cameBack = row.pt_has_closure === true;
    const sentence = openSentence(read, now) + (cameBack ? ` ${TRUTH_COPY.sameIdCameBack}` : "");
    return { ...record, state: "open", sentence, relisted: { sameIdCameBack: cameBack } };
  }
  if (row.pt_row_found && row.pt_listed) {
    return { ...record, state: "aged_out", sentence: TRUTH_COPY.agedOutPending, agedAt: row.pt_aged_at ?? null };
  }
  if (row.pt_has_closure) {
    if (row.pt_closed_at) {
      return { ...record, state: "closed", closedAt: row.pt_closed_at,
        sentence: fillGateCopy(TRUTH_COPY.closed, { closedAt: dayOf(row.pt_closed_at) ?? "" }) };
    }
    return { ...record, state: "closed", closedAt: row.pt_seen_gone_at ?? null, closedAtIsObservation: true,
      sentence: fillGateCopy(TRUTH_COPY.closedSeenLate, { seenGoneAt: dayOf(row.pt_seen_gone_at) ?? "" }) };
  }
  if (row.pt_row_found) {
    return { ...record, state: "going_down", sentence: TRUTH_COPY.goingDown };
  }
  if (row.pt_aged_at) {
    const template = age.dateClass === "none" ? TRUTH_COPY.agedOutUndated : TRUTH_COPY.agedOut;
    return { ...record, state: "aged_out", agedAt: row.pt_aged_at,
      sentence: fillGateCopy(template, { agedAt: dayOf(row.pt_aged_at) ?? "" }) };
  }
  if (row.pt_board_known) {
    const sentence = read.bucket === FULL_READ_BUCKET && read.capped !== true
      ? TRUTH_COPY.notCarriedFullRead
      : TRUTH_COPY.notCarriedInParts;
    return { ...base, state: "not_carried", sentence, age: null, relisted: null };
  }
  return { ...bare(id, "board_not_carried", TRUTH_COPY.boardNotCarried, source, token) };
}

/**
 * Every id, in the order asked and each once: the ones preCheck answers in
 * place, the rest from posting_truth's rows. posting_truth answers every id it
 * is asked about, so an id its rows do not answer is a failed read, and this
 * throws rather than invent a state for it.
 */
export function truthsOf(ids: readonly string[], rows: readonly PostingTruthRow[], opts: TruthOptions): PostingTruth[] {
  const byId = new Map(rows.map((r) => [r.pt_id, r]));
  return [...new Set(ids)].map((id) => {
    const pre = preCheck(id, opts);
    if (pre) return pre;
    const row = byId.get(id);
    if (!row) throw new Error(`posting_truth returned no row for ${id}`);
    return truthFromRow(id, row, opts);
  });
}

/** One row of company_facts (20261206100000). */
export interface CompanyFactsRow {
  cf_token: string;
  cf_state: string;
  cf_facts: unknown;
  cf_computed_at: string | null;
}

export interface Day30Share {
  /** The share of roles still advertised at day 30, with its interval. */
  share: number;
  lo: number;
  hi: number;
  cohortFrom: string | null;
  cohortTo: string | null;
  events: number;
  takenDown: number | null;
  relists: number | null;
  n: number | null;
}

export interface EmployerFacts {
  companyToken: string;
  scope: typeof EMPLOYER_SCOPE;
  computedAt: string | null;
  /** Printed only where the gate admits it; otherwise null and unknownReason says why. */
  stillAdvertisedAtDay30: Day30Share | null;
  unknownReason: string | null;
  /** The refusal in words; null when the share is printed. */
  sentence: string | null;
  /** The median day to takedown, where the gate admits it and the record reached one half. */
  medianDaysToTakedown: number | null;
  medianCensored: boolean | null;
  medianUnknownReason: string | null;
}

const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};
const numOrNull = (v: unknown): number | null => (Number.isFinite(num(v)) ? num(v) : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The sentence for a refused day-30 share, by the gate's reason. */
export function day30RefusalSentence(reason: string): string {
  if (reason === NOT_COMPUTED_YET) return EMPLOYER_COPY.notComputedYet;
  if (reason === "lap") return HIRING_RECORD_GATE_COPY.lap;
  if (reason === "unproven read") return HIRING_RECORD_GATE_COPY.unprovenRead;
  if (reason === "interval") return HIRING_RECORD_GATE_COPY.interval;
  if (reason === "unread" || reason === "no row") return HIRING_RECORD_GATE_COPY.unread;
  if (reason === "events") return EMPLOYER_COPY.noEvents;
  return EMPLOYER_COPY.day30Unproven;
}

/**
 * The employer block for one board token, from its company_facts row, through
 * the hiring-record gate. Nothing the gate refuses is printed.
 */
export function employerFactsOf(token: string, row: CompanyFactsRow | null | undefined): EmployerFacts {
  const refused = (reason: string, computedAt: string | null, median?: Partial<EmployerFacts>): EmployerFacts => ({
    companyToken: token, scope: EMPLOYER_SCOPE, computedAt, stillAdvertisedAtDay30: null,
    unknownReason: reason, sentence: day30RefusalSentence(reason),
    medianDaysToTakedown: null, medianCensored: null, medianUnknownReason: reason,
    ...median,
  });
  if (!row || row.cf_state === NOT_COMPUTED_YET || !isRecord(row.cf_facts)) {
    return refused(NOT_COMPUTED_YET, null);
  }
  const facts = row.cf_facts as HiringRecordRow & Record<string, unknown>;
  const computedAt = strOrNull(row.cf_computed_at);
  const gate = hiringRecordGate(facts);

  // The median, by the gate's own decision for it.
  let medianDaysToTakedown: number | null = null;
  let medianCensored: boolean | null = null;
  let medianUnknownReason: string | null = gate.median.reason;
  if (gate.median.ok) {
    medianCensored = facts.median_censored === true;
    const m = num(facts.median_days_to_fill);
    if (!medianCensored && Number.isFinite(m)) medianDaysToTakedown = m;
    else if (!medianCensored) medianUnknownReason = "unread";
  }
  const median = { medianDaysToTakedown, medianCensored, medianUnknownReason };

  if (!gate.share30.ok) return refused(gate.share30.reason ?? "insufficient", computedAt, median);

  const share = num(facts.still_open_30);
  const lo = num(facts.still_open_30_lo);
  const hi = num(facts.still_open_30_hi);
  const events = num(facts.events_30);
  if (!Number.isFinite(events) || events <= 0) return refused("events", computedAt, median);
  if (!Number.isFinite(share) || !Number.isFinite(lo) || !Number.isFinite(hi)) return refused("unread", computedAt, median);

  return {
    companyToken: token, scope: EMPLOYER_SCOPE, computedAt,
    stillAdvertisedAtDay30: {
      share, lo, hi,
      cohortFrom: strOrNull(facts.cohort_from), cohortTo: strOrNull(facts.cohort_to),
      events, takenDown: numOrNull(facts.taken_down_30), relists: numOrNull(facts.relists_30), n: numOrNull(facts.n_at_risk_30),
    },
    unknownReason: null, sentence: null,
    ...median,
  };
}
