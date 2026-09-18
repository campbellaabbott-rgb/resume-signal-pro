// State WARN notices: a header-keyed table from any feed (Big Local News'
// raw per-state file, the TWC xlsx, the Florida listing) goes through one
// state map to WarnRecords, then through the shared fold and the row
// builder that the upsert RPC accepts. The state agency is the source on
// every row; Big Local News is the courier and is credited in the read log,
// never as a source_name.
//
// Nothing in this file talks to the database. index.ts owns the writes and
// the log line, so the whole pipeline runs in tests on the saved samples.

import { csvObjects, normHeader } from "./csv.ts";
import type { Http } from "./http.ts";
import {
  addDays, amendKind, dedupeKey, eventTypeOf, firstDateIn, foldAmendments, readCount, readDate,
  stripAmendAffix, temporaryOf, warnPrePass,
} from "./normalize.ts";
import type { FoldedRecord, VisibleBasis, WarnRecord } from "./normalize.ts";
import { resolveHeaders } from "./warn-maps/types.ts";
import type { StateMap } from "./warn-maps/types.ts";

export interface Table {
  header: string[];
  rows: Record<string, string>[];
}

export interface MapOutcome {
  records: WarnRecord[];
  /** Rows the map could not turn into a notice, by reason. */
  dropped: { noFiler: number; noVisibleDate: number; notWarn: number };
  header: string[];
}

export type MapResult = ({ ok: true } & MapOutcome) | { ok: false; reason: string; header: string[] };

/** Find the header row in a raw table: the first row that names one of the map's filer columns. */
export function tableFromCsv(text: string, map: StateMap): Table {
  const all = csvObjects(text);
  const cands = new Set(map.columns.filer);
  if (all.header.some((h) => cands.has(h))) return all;
  // Ohio's file opens with two junk lines; walk down to the real header.
  const lines = text.replace(/\0/g, "").split(/\r?\n/);
  for (let i = 1; i < Math.min(lines.length, 10); i++) {
    const probe = csvObjects(lines.slice(i).join("\n"));
    if (probe.header.some((h) => cands.has(h))) return probe;
  }
  return all;
}

/** Apply one state map to a header-keyed table. */
export function mapTable(map: StateMap, table: Table, feed: WarnRecord["feed"], sourceUrl?: string): MapResult {
  const header = table.header.map(normHeader);
  const res = resolveHeaders(map, header);
  if (!res.ok) return { ok: false, reason: `header_mismatch:${res.missing.join("+")}`, header };
  const p = res.pick;
  const get = (role: keyof StateMap["columns"], row: Record<string, string>): string => {
    const h = p[role];
    return h == null ? "" : (row[h] ?? "").trim();
  };
  const dropped = { noFiler: 0, noVisibleDate: 0, notWarn: 0 };
  const records: WarnRecord[] = [];
  for (const row of table.rows) {
    if (map.keepRow && !map.keepRow(row)) { dropped.notWarn += 1; continue; }
    const filerCell = get("filer", row);
    if (filerCell === "") { dropped.noFiler += 1; continue; }
    const cell = map.filerCell
      ? map.filerCell(filerCell)
      : { filerRaw: filerCell.replace(/\s+/g, " ").trim(), filerForNorm: filerCell, siteFromCell: null };
    const amend = amendKind(cell.filerRaw);
    const filerRaw = stripAmendAffix(cell.filerRaw);
    const filerForNorm = warnPrePass(cell.filerForNorm);
    if (filerForNorm === "") { dropped.noFiler += 1; continue; }
    const visibleDate = readDate(get("visible", row));
    if (visibleDate == null) { dropped.noVisibleDate += 1; continue; }
    // "Notification Date(s)" can list several; the first is the notice date.
    const noticeDate = p.noticeDate ? firstDateIn(get("noticeDate", row)) : null;
    let workers: number | null = null;
    for (const h of map.columns.workers ?? []) {
      if (!header.includes(h)) continue;
      workers = readCount(row[h]);
      if (workers != null) break;
    }
    const effectiveCell = get("effective", row);
    const effectiveDate = effectiveCell === "" ? null : firstDateIn(effectiveCell);
    const kindCell = get("kind", row);
    const eventType = map.eventType ? map.eventType(kindCell, row) : eventTypeOf(kindCell);
    const isTemporary = temporaryOf(get("temporary", row), kindCell);
    const site = get("site", row) || cell.siteFromCell || null;
    const city = get("city", row) || null;
    const county = get("county", row) || null;
    const pdf = get("pdf", row);
    records.push({
      state: map.state,
      feed,
      sourceName: map.sourceName,
      sourceUrl: sourceUrl ?? map.sourceUrl,
      filerRaw,
      filerForNorm,
      amend,
      siteRaw: site ? site.replace(/\s+/g, " ").trim() : null,
      siteCity: city,
      siteCounty: county,
      workers,
      noticeDate,
      visibleDate,
      visibleBasis: map.visibleBasis,
      effectiveDate,
      effectiveRaw: effectiveCell === "" ? null : effectiveCell.replace(/\s+/g, " ").trim(),
      eventType,
      isTemporary,
      noticePdfUrl: /^https:\/\//i.test(pdf) ? pdf : null,
      blnHashId: null,
    });
  }
  return { ok: true, records, dropped, header };
}

// ── rows for the upsert ────────────────────────────────────────────────────

const EVENT_BASIS_FOR: Record<VisibleBasis, string> = {
  state_received: "warn_received",
  state_processed: "warn_processed",
  state_posted: "warn_posted",
  our_first_fetch: "warn_posted",
};

export interface BuiltRows {
  rows: Record<string, unknown>[];
  /** Notices dated after our read; refused before the upsert sees them. */
  futureDated: number;
  /** Notices older than the retention window; never inserted. */
  tooOld: number;
  superseded: number;
  rescinded: number;
  latestPublicDate: string | null;
}

/**
 * Records → upsert rows. Dedupe key, amendment fold, retention and the
 * future-date refusal happen here; the ancestor of a chain is ordered before
 * its amendments so the supersedes_id reference resolves in one batch, and
 * an amendment whose ancestor fell outside the window carries no reference.
 */
export async function buildWarnRows(
  records: WarnRecord[],
  readAt: Date,
  retentionDays: number,
): Promise<BuiltRows> {
  const readIso = readAt.toISOString().slice(0, 10);
  const floor = addDays(readIso, -retentionDays);
  const keyed: Array<WarnRecord & { filingId: string }> = [];
  for (const r of records) {
    const key = await dedupeKey({
      state: r.state, filerForNorm: r.filerForNorm, siteRaw: r.siteRaw, siteCity: r.siteCity,
      noticeDate: r.noticeDate, visibleDate: r.visibleDate, effectiveDate: r.effectiveDate, workers: r.workers,
    });
    keyed.push({ ...r, filingId: `warn:${key}` });
  }
  const folded = foldAmendments(keyed);
  let futureDated = 0, tooOld = 0, superseded = 0, rescinded = 0;
  let latest: string | null = null;
  const kept: FoldedRecord[] = [];
  for (const r of folded) {
    const eventDate = r.noticeDate ?? r.visibleDate;
    if (r.visibleDate <= readIso && (latest == null || r.visibleDate > latest)) latest = r.visibleDate;
    if (eventDate > readIso || r.visibleDate > readIso) { futureDated += 1; continue; }
    if (eventDate < floor) { tooOld += 1; continue; }
    kept.push(r);
  }
  const ids = new Set(kept.map((r) => r.filingId));
  kept.sort((a, b) => Number(a.supersedesId != null) - Number(b.supersedesId != null));
  const rows = kept.map((r) => {
    if (r.status === "superseded") superseded += 1;
    if (r.status === "rescinded") rescinded += 1;
    const eventDate = r.noticeDate ?? r.visibleDate;
    return {
      filing_id: r.filingId,
      source: "state_warn",
      filer_raw: r.filerRaw,
      filer_for_norm: r.filerForNorm,
      event_date: eventDate,
      event_basis: r.noticeDate ? "warn_notice_date" : EVENT_BASIS_FOR[r.visibleBasis],
      public_date: r.visibleDate,
      public_basis: r.visibleBasis,
      source_read_at: readAt.toISOString(),
      source_url: r.sourceUrl,
      source_name: r.sourceName,
      status: r.status,
      supersedes_id: r.supersedesId != null && ids.has(r.supersedesId) ? r.supersedesId : null,
      state: r.state,
      feed: r.feed,
      bln_hash_id: r.blnHashId,
      site_raw: r.siteRaw,
      site_city: r.siteCity,
      site_county: r.siteCounty,
      workers: r.workers,
      effective_date: r.effectiveDate,
      effective_raw: r.effectiveRaw,
      event_type: r.eventType,
      is_temporary: r.isTemporary,
      notice_pdf_url: r.noticePdfUrl,
    };
  });
  return { rows, futureDated, tooOld, superseded, rescinded, latestPublicDate: latest };
}

// ── the Big Local News raw feed ────────────────────────────────────────────

export interface RawFetch {
  status: number;
  etag: string | null;
  changed: boolean;
  text: string | null;
}

/** GET one raw state file; an unchanged ETag is a 304 and no body. */
export async function fetchBlnRaw(http: Http, map: StateMap, knownEtag: string | null): Promise<RawFetch> {
  const r = await http.getText(map.blnRawUrl, knownEtag ? { "If-None-Match": knownEtag } : undefined);
  const etag = r.headers.get("etag");
  if (r.status === 304) return { status: 304, etag: etag ?? knownEtag, changed: false, text: null };
  if (r.status !== 200) return { status: r.status, etag, changed: false, text: null };
  return { status: 200, etag, changed: etag == null || etag !== knownEtag, text: r.text };
}

/** The states whose Extract job failed in the latest Big Local News etl.yml run. */
export function extractFailuresFrom(jobsJson: unknown): { failed: Set<string>; seen: Set<string> } | null {
  const jobs = (jobsJson as { jobs?: Array<{ name?: string; conclusion?: string | null }> } | null)?.jobs;
  if (!Array.isArray(jobs)) return null;
  const failed = new Set<string>();
  const seen = new Set<string>();
  for (const j of jobs) {
    const m = /^Extract \((\w\w)\)$/.exec(j.name ?? "");
    if (!m) continue;
    const st = m[1].toUpperCase();
    seen.add(st);
    if (j.conclusion != null && j.conclusion !== "success") failed.add(st);
  }
  return { failed, seen };
}

export const BLN_RUNS_URL =
  "https://api.github.com/repos/biglocalnews/warn-github-flow/actions/workflows/etl.yml/runs?per_page=1&status=completed";

/** The latest completed etl.yml run's jobs URL, from the runs listing. */
export function latestRunJobsUrl(runsJson: unknown): string | null {
  const runs = (runsJson as { workflow_runs?: Array<{ jobs_url?: string }> } | null)?.workflow_runs;
  const u = runs?.[0]?.jobs_url;
  return typeof u === "string" && /^https:\/\/api\.github\.com\//.test(u) ? u : null;
}

/**
 * What one feed's outcome means for the slice that read it. A map never
 * verified against a saved file that refuses the header it meets has done
 * what it promised (nothing stored, the header in the health note): a note,
 * not a failed read. A verified map that refuses -- the state changed its
 * header -- and every fetch or write error are failures.
 */
export function feedVerdict(r: { ok: boolean; refused: boolean }, map: Pick<StateMap, "verifiedAgainstSample">): "ok" | "refused" | "failed" {
  if (r.ok) return "ok";
  if (r.refused && !map.verifiedAgainstSample) return "refused";
  return "failed";
}

/** A feed is stale when its extract failed or its newest public date is more than the bar behind our read. */
export function isStale(latestPublicDate: string | null, extractFailed: boolean | null, readIso: string, staleDays: number): boolean {
  if (extractFailed) return true;
  if (latestPublicDate == null) return true;
  return latestPublicDate < addDays(readIso, -staleDays);
}
