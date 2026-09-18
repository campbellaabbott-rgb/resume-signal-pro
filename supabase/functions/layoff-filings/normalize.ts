// The WARN pre-pass and the pieces every state map shares: date reading,
// the filer string handed to SQL for normalising, the dedupe key, the
// event-type vocabulary, and how an amendment finds its ancestor.
//
// Two normalisers live in this product and they have different jobs.
//   * layoff_norm(text) in SQL is THE matcher's normaliser. The poller never
//     computes filer_norm; it sends filer_for_norm (this file's pre-pass
//     output) and the upsert normalises it in SQL so the filer side and the
//     board side of every comparison were stripped by one function.
//   * keyNorm() below exists only so that two readings of the SAME notice —
//     Big Local News' raw copy and the state's own file — hash to one
//     dedupe key. It is a port of the same rules, and if it ever drifted from
//     the SQL function nothing would match wrongly: the matcher does not read
//     it. The worst case is one notice stored twice, which the state gate
//     and the reader's newest-per-token rule absorb.

export type EventType = "closure" | "layoff" | "relocation" | "unknown";
export type VisibleBasis = "state_received" | "state_processed" | "state_posted" | "our_first_fetch";
export type AmendKind = "update" | "correction" | "amended" | "revised" | "rescinded" | null;

/** A notice as one state map produced it, before folding and before SQL. */
export interface WarnRecord {
  state: string;
  feed: "bln_raw" | "tx_twc_xlsx" | "fl_react_html";
  sourceName: string;
  sourceUrl: string;
  filerRaw: string;
  filerForNorm: string;
  amend: AmendKind;
  siteRaw: string | null;
  siteCity: string | null;
  siteCounty: string | null;
  workers: number | null;
  noticeDate: string | null;
  visibleDate: string;
  visibleBasis: VisibleBasis;
  effectiveDate: string | null;
  effectiveRaw: string | null;
  eventType: EventType;
  isTemporary: boolean | null;
  noticePdfUrl: string | null;
  blnHashId: string | null;
}

// ── dates ──────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1980 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Excel serial day (1900 system) to ISO; the BLN raw Texas file carries these. */
export function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 30000 || n > 80000) return null;
  const ms = Math.round((n - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Read a date the way the state files spell them: ISO, ISO with a time,
 * M/D/YYYY, MM-DD-YY, "September 14, 2026", a JS Date (xlsx cells), or an
 * Excel serial. Unreadable input is null, never a guess.
 */
export function readDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // xlsx cells are local-midnight Dates; take the calendar fields as written.
    return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === "number") return excelSerialToIso(v);
  const s = String(v).trim();
  if (s === "") return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s.*)?$/.exec(s);
  if (m) return iso(+m[3], +m[1], +m[2]);
  m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})$/.exec(s);
  if (m) { const yy = +m[3]; return iso(yy >= 70 ? 1900 + yy : 2000 + yy, +m[1], +m[2]); }
  m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  if (/^\d{5}$/.test(s)) return excelSerialToIso(+s);
  return null;
}

/** The first readable date inside a free-text cell ("beginning 11/16/2026, ending 4/1/2027"). */
export function firstDateIn(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date || typeof v === "number") return readDate(v);
  const s = String(v);
  const direct = readDate(s);
  if (direct) return direct;
  const m = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|[A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/.exec(s);
  return m ? readDate(m[1]) : null;
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
}

// ── numbers ────────────────────────────────────────────────────────────────

/** A worker count; NULL when the cell does not state one (never 0 for "blank"). */
export function readCount(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  const s = String(v).replace(/,/g, "").trim();
  const m = /^(\d+)(?:\.0+)?$/.exec(s);
  if (!m) return null;
  const n = +m[1];
  return n > 0 && n < 1_000_000 ? n : null;
}

// ── the filer string ───────────────────────────────────────────────────────

const AMEND_LEAD =
  /^\s*(?:(update|updated|amended|amendment|correction|corrected|revised|revision|rescinded|rescission)\b[\s#:\-]*(?:\d+|to|of)?[\s:\-]*)+/i;
const AMEND_TRAIL =
  /\s*[-–—(]\s*(rescinded|rescission|amended|amendment|updated?|update\s*\d*|correction|revised)\s*\)?\s*$/i;
/** "Public Storage Correction to 7/22/26 WARN" — the affix trails without a dash. */
const AMEND_TRAIL_TO = /\s+(correction|corrected|amendment|revision)\s+(?:to|of)\b.*$/i;

/** Classify an amendment affix on the filer string (the OH "UPDATE 2 …" / "… - Rescinded" shapes). */
export function amendKind(raw: string): AmendKind {
  const lead = leadAffix(raw);
  const trail = AMEND_TRAIL.exec(raw) ?? AMEND_TRAIL_TO.exec(raw);
  const word = (lead?.[1] ?? trail?.[1] ?? "").toLowerCase();
  if (word === "") return null;
  if (word.startsWith("rescind") || word.startsWith("rescis")) return "rescinded";
  if (word.startsWith("correct")) return "correction";
  if (word.startsWith("amend")) return "amended";
  if (word.startsWith("revis")) return "revised";
  return "update";
}

/**
 * A leading "Update"/"Updated" counts as an affix only when the state
 * spelled it in capitals or followed it with a number or punctuation — an
 * employer called "Updated Living LLC" keeps its name.
 */
function leadAffix(raw: string): RegExpExecArray | null {
  const m = AMEND_LEAD.exec(raw);
  if (!m) return null;
  const w = m[1];
  if (/^updated?$/i.test(w) && w !== w.toUpperCase() && !/^\s*updated?\s*[\d#:\-]/i.test(raw)) return null;
  return m;
}

/** Strip only the amendment affixes; the employer's own words stay. */
export function stripAmendAffix(raw: string): string {
  const lead = leadAffix(raw);
  const s = lead ? raw.slice(lead[0].length) : raw;
  return s.replace(AMEND_TRAIL, "").replace(AMEND_TRAIL_TO, "").trim();
}

/**
 * The WARN pre-pass from SPEC §5: drop parentheticals, split at dba/d/b/a/aka
 * and keep the left part, strip the amendment affixes. The state-specific
 * address and site strips are done by the map before this runs.
 */
export function warnPrePass(raw: string): string {
  let s = stripAmendAffix(raw.replace(/\s+/g, " ").trim());
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.split(/\s+(?:dba|d\/b\/a|d\.b\.a\.?|aka|a\/k\/a|f\/k\/a|fka)\s+/i)[0];
  return s.replace(/\s+/g, " ").trim();
}

const SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "llc", "ltd", "limited", "plc", "co", "company",
  "lp", "llp", "sa", "nv", "ag", "se", "the", "and",
]);

/** ASCII-fold a string (NFKD, then drop combining marks). */
export function asciiFold(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * The key normaliser (see the header): NFKD→ascii, lowercase, drop a trailing
 * /DE/-style tag (that shape only — a slash inside a name is a name), & →
 * and, non-alphanumerics → space, pop trailing tokens in the suffix set, drop
 * a leading "the", collapse whitespace.
 */
export function keyNorm(s: string): string {
  let n = asciiFold(s).toLowerCase();
  n = n.replace(/\/[a-z]{2,4}\/?\s*$/, "");
  n = n.replace(/&/g, " and ");
  n = n.replace(/[^a-z0-9 ]+/g, " ");
  const t = n.split(/\s+/).filter(Boolean);
  while (t.length > 0 && SUFFIXES.has(t[t.length - 1])) t.pop();
  while (t.length > 0 && t[0] === "the") t.shift();
  return t.join(" ");
}

export function siteNorm(s: string | null | undefined): string {
  if (!s) return "";
  return asciiFold(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

// ── event type ─────────────────────────────────────────────────────────────

/** The verbatim closure/layoff cell to the four-word vocabulary. */
export function eventTypeOf(v: unknown): EventType {
  const s = String(v ?? "").toLowerCase();
  if (/relocat/.test(s)) return "relocation";
  if (/closure|closing|closed|plant clos/.test(s)) return "closure";
  if (/layoff|lay-off|lay off|reduction|mass/.test(s)) return "layoff";
  return "unknown";
}

/** Permanent/temporary wording to a nullable boolean; NULL when the cell says neither. */
export function temporaryOf(...cells: unknown[]): boolean | null {
  const s = cells.map((c) => String(c ?? "")).join(" ").toLowerCase();
  if (/temporar/.test(s)) return true;
  if (/permanent/.test(s)) return false;
  return null;
}

// ── dedupe key ─────────────────────────────────────────────────────────────

/**
 * The per-notice key: state, key-normalised filer, site, the notice date or
 * the visible date, the effective date, the count — hashed. Two feeds that
 * read the same notice (BLN raw tx.csv and the TWC xlsx) collapse onto one
 * row. WebCrypto in Deno offers no SHA-224, so this is SHA-256 cut to 224
 * bits: the spec's key WIDTH, computed on OUR normalisation as the spec asks.
 */
export async function dedupeKey(r: {
  state: string; filerForNorm: string; siteRaw: string | null; siteCity: string | null;
  noticeDate: string | null; visibleDate: string; effectiveDate: string | null; workers: number | null;
}): Promise<string> {
  const parts = [
    r.state.toUpperCase(),
    keyNorm(r.filerForNorm),
    siteNorm(r.siteRaw ?? r.siteCity ?? ""),
    r.noticeDate ?? r.visibleDate,
    r.effectiveDate ?? "",
    r.workers == null ? "" : String(r.workers),
  ];
  const buf = new TextEncoder().encode(parts.join("\u001f"));
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 56);
}

// ── amendment folding ──────────────────────────────────────────────────────

export type FilingStatus = "active" | "amended" | "superseded" | "rescinded" | "amendment";

export interface FoldedRecord extends WarnRecord {
  filingId: string;
  status: FilingStatus;
  supersedesId: string | null;
}

/**
 * Fold amendments onto their ancestor by (state, key-normalised filer, site).
 * Rows are walked in date order: every non-amendment row opens a chain of
 * its own, and an amendment attaches to the NEAREST EARLIER original (an
 * "UPDATE 2" in July amends June's notice, not January's). Inside a chain
 * the newest row shows (status active) and every earlier row is superseded,
 * so an update surfaces once with the newest count and never as a second
 * event; a rescinded row is stored as rescinded and hides its chain. A
 * second distinct notice at the same site is a chain of its own and stays
 * active. An amendment with no earlier original in the file is a filing on
 * its own and carries no reference.
 */
export function foldAmendments(records: Array<WarnRecord & { filingId: string }>): FoldedRecord[] {
  const groups = new Map<string, Array<WarnRecord & { filingId: string }>>();
  for (const r of records) {
    const k = [r.state.toUpperCase(), keyNorm(r.filerForNorm), siteNorm(r.siteRaw ?? r.siteCity ?? "")].join("|");
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const out: FoldedRecord[] = [];
  for (const g of groups.values()) {
    const byId = new Map<string, WarnRecord & { filingId: string }>();
    for (const r of g) byId.set(r.filingId, r);
    const rows = [...byId.values()].sort((a, b) =>
      (a.noticeDate ?? a.visibleDate).localeCompare(b.noticeDate ?? b.visibleDate) || a.visibleDate.localeCompare(b.visibleDate)
    );
    // Chains: an original opens one; an amendment joins the open chain, or
    // opens its own when nothing earlier is an original.
    const chains: Array<Array<WarnRecord & { filingId: string }>> = [];
    for (const r of rows) {
      if (r.amend == null || chains.length === 0) chains.push([r]);
      else chains[chains.length - 1].push(r);
    }
    for (const chain of chains) {
      const ancestor = chain[0];
      const newest = chain[chain.length - 1];
      for (const r of chain) {
        const isAncestor = r === ancestor;
        const supersedesId = isAncestor ? null : ancestor.filingId;
        let status: FilingStatus;
        if (r.amend === "rescinded") status = "rescinded";
        else if (r === newest) status = "active";
        else status = "superseded";
        out.push({ ...r, status, supersedesId });
      }
    }
  }
  return out;
}
