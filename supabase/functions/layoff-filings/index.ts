// layoff-filings — the poller behind the per-employer filing line.
//
//   POST { action: "edgar" }                      hourly: the EDGAR latest-filings Atom channel
//   POST { action: "edgar_audit" }                daily: full-text search completeness audit, then
//                                                 up to ten stored rows re-read (S14X-278)
//   POST { action: "edgar_backfill", from, index } once, chunked, self-kicking
//   POST { action: "edgar_reread", after }       by hand: re-reads every stored 8-K row an older
//                                                 build or parser got wrong (S8-026, S8-108, S14X-149)
//   POST { action: "warn", cursor }               nightly: state WARN notices, slice-chained
//   POST { action: "matches" }                    layoff_matches_rebuild(), the matcher log line
//   POST { action: "partition" }                  refresh_layoff_partition(), the Ghost-Index writer
//   POST { action: "mirror", chain }              daily: the board catalogue into layoff_board_names,
//                                                 then (chain:true) the matcher and the partition
//   POST { action: "lca_wages" }                  once a quarter, by hand: the certified H-1B wage
//                                                 cells this bundle carries into oflc_lca_wages
//
// Its own function, never a job-board action: the job-board bundle sits at
// the 4.5 MB cap and a bundle over it silently serves the old version. It
// never passes through check_rate_limit or its global sibling; board
// browsing has already killed upload and checkout once through that budget.
//
// Auth is the shared-secret header pg_cron sends (x-layoff-cron): the value
// is compared to LAYOFF_CRON_SECRET when that env constant is set, else to
// the vault key through layoff_cron_key_matches() on the service client.
// Anything else is a 401 before any work. Writes go through the service
// client into the SECURITY DEFINER writers lane A shipped; nothing here
// reads layoff_filings for a surface.
//
// The cadence copy on the site derives from src/config/layoffs.ts, which
// mirrors the constants below and the cron rows in the migration that
// scheduled this function; the cross-runtime guard reads all three.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { getServiceClient } from "../_shared/supabase-client.ts";
import { Http } from "./http.ts";
import {
  atomPageUrl, AUDIT_REREAD_MAX, auditRereadPick, fetchFiling, ftsUrl, keep205, parseAtom, parseFtsHits, rereadCandidates,
} from "./edgar.ts";
import { PARSER_VERSION } from "./parse205.ts";
import type { AtomEntry, FtsHit } from "./edgar.ts";
import { addDays, prunedMonthFloor, todayIso } from "./normalize.ts";
import type { WarnRecord } from "./normalize.ts";
import {
  BLN_RUNS_URL, buildWarnRows, extractFailuresFrom, feedVerdict, fetchBlnRaw, isStale, latestRunJobsUrl, mapTable, tableFromCsv,
} from "./warn.ts";
import type { MapResult, Table } from "./warn.ts";
import { RAW_STATE_MAPS, FL as FL_MAP, TX as TX_MAP } from "./warn-maps/index.ts";
import type { StateMap } from "./warn-maps/types.ts";
import { fetchTwcYear } from "./tx-xlsx.ts";
import { fetchFlYear, flListingUrl } from "./fl-html.ts";
import { deployMirrorRows } from "./mirror-catalogue.ts";
import type { MirrorRow } from "./mirror-rows.ts";
import { decodeLcaCells, LCA_CHUNK_ROWS, newLcaTally, planLcaChunks, postLcaChunks, refuseLcaCells, twinVendorTokens } from "./lca-cells.ts";
import { JOB_SOURCES } from "./board-sources.ts";
import { stamped } from "../_shared/fn-build.ts";
import {
  LCA_CELL_COUNT, LCA_COVERAGE_FROM, LCA_COVERAGE_TO, LCA_FISCAL_QUARTER, LCA_PUBLISHED_ON, LCA_TOKEN_COUNT,
} from "./lca-payload.ts";

// .1 mirror; .1 of this date carries the certified H-1B wage cells, the action that loads them, the
// measured coverage span they are labelled by, and the staged swap that replaces a period whole;
// wave 3 adds the Oregon/Illinois/Massachusetts map fixes, S8-026/S8-108 and edgar_reread.
// .3 (wave 3 integration): board-data-ingest stamped .1 and tests-ci .2 (the x-fn-build header via
// _shared/fn-build.ts stamped()); the merged function carries both, so a build neither shipped alone.
// 2026-10-11.1 (wave 4): the catalogue copy labels the "Meta" SmartRecruiters board (Meta1) a staffing agency.
// 2026-10-11.2 (wave 4, recheck 3): the copy no longer labels twelve employers' own boards (State Farm,
// Principal, Goodwill of Colorado, HKBU, the Scottish Government's two, Nunavut, Emirates NBD's two,
// Emirates Islamic, Farrans, Calamos) as staffing agencies'.
// 2026-10-15.1: the catalogue copy carries JPMorgan Chase (oracle jpmc~~CX_1001) and its search key.
// Merged onto wave 4's copy, so the one build carries both lines; neither build has deployed.
// 2026-10-15.2: merged onto wave 4's 2026-10-11.2 copy, so it carries the JPMorgan line and the twelve
// boards without the agency label. 2026-10-15.1 named the copy before that merge and never deployed.
// 2026-10-15.2 also named trust/pages' copy before it merged oh/integration at 9005a76f: the five Reyes
// brand boards (three new) and the iCIMS brand field. Neither 2026-10-15.2 deployed.
// 2026-10-15.3: trust/pages merged onto oh/integration's 2026-10-15.2 copy, so the one build carries the
// twelve boards without the agency label, the JPMorgan line and the Reyes brand boards.
// 2026-10-26.1 (trust/round3): the copy carries 64 boards renamed to their employers' own names, 20
// employers' boards without the agency label and Jobandtalent's three with it, the Exelon brand boards
// in the four duplicate iCIMS hosts' places, the iCIMS org field and the Oracle pool sites.
// 2026-11-11.1 (board .102, catalogue lane): the copy drops 25 boards (OD1's six, nine twins, ten
// dead or duplicate boards), labels six agencies, repoints 13 boards, renames four and adds
// Convergint's Workday site; the alias copy drops broadbean and Mindrift.
// 2026-11-12.1 (bug round of 2026-11-08, part A, layoff-filings lane): four more states are read by our
// first read, a notice the state edited retires its old reading, rows an older parser read are read
// again, and wage cells the ledger refused are not served. The catalogue copy is .102's, unchanged.
// 2026-11-17.1 (board .103, catalogue lane): the copy drops 336 dead boards, lever:usasurveyjob and the
// five held Workable boards, repoints 34 boards to the vendor their employer now posts on, labels
// Distro an agency and names CardFlight's board SwipeSimple; the alias copy drops two held boards.
// The lane's tip adds row A: six AI-startup boards appended after Convergint.
// 2026-11-17.2 (board .103 integration, on review): the thirty repoints onto Ashby go back to their
// .102 records until the owner's OD14(b) answer (CardFlight's name with them), and DroneShield's
// board carries the name its postings print. 44,163 boards in the copy.
export const BUILD_VERSION = "2026-11-17.2";

// ── mirror constants (src/config/layoffs.ts names this file) ──────────────
export const LAYOFF_LOOKBACK_DAYS = 90;
export const LAYOFF_DISPLAY_MAX_AGE_DAYS = 90;
export const LAYOFF_WARN_MIN_WORKERS = 50;
export const LAYOFF_MIN_ARM_EMPLOYERS = 10;
export const LAYOFF_MAX_EMPLOYER_SHARE = 0.40;
export const LAYOFF_FEED_STALE_DAYS = 21;
export const LAYOFF_STALE_HOURS = { edgar: 6, warn: 48 };
export const LAYOFF_READ_CADENCE = { edgar: "hourly", warn: "nightly" };
/** Filings older than this by event_date are never inserted; the monthly rollup prunes the rest. */
export const LAYOFF_RETENTION_DAYS = 365;

// ── budgets ────────────────────────────────────────────────────────────────
const SEC_CONTACT = Deno.env.get("LAYOFF_CONTACT_EMAIL") ?? "campbellabbott@gmail.com";
const USER_AGENT = `ResumeSignalPro layoff-filings (${SEC_CONTACT})`;
const WALL_CLOCK_MS = 45_000;
const ATOM_MAX_PAGES = 4;
const FTS_MAX_PAGES = 5;
const AUDIT_DAYS = 3;
const BACKFILL_CHUNK = 25;
const WARN_STATES_PER_SLICE = 8;
const UPSERT_CHUNK = 200;
/** Rows per layoff_board_names_mirror call; the operator script's default, one run_started_at across every chunk. */
const MIRROR_CHUNK = 2000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-layoff-cron",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const waitUntil = (p: Promise<unknown>) => {
  const guarded = p.catch((e) => console.warn("[layoff-filings] background task failed:", e));
  try {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(guarded);
  } catch { /* fire-and-forget fallback */ }
};

function secHttp(intervalMs: number): Http {
  return new Http({
    userAgent: USER_AGENT,
    minIntervalMs: { "sec.gov": intervalMs },
    defaultIntervalMs: 1000,
    timeoutMs: 25_000,
  });
}

// ── auth ───────────────────────────────────────────────────────────────────

async function cronAuthorised(req: Request, client: SupabaseLike): Promise<boolean> {
  const sent = req.headers.get("x-layoff-cron");
  if (!sent || sent.length < 16) return false;
  const env = Deno.env.get("LAYOFF_CRON_SECRET");
  if (env && env.length >= 16) return sent === env;
  try {
    const { data, error } = await client.rpc("layoff_cron_key_matches", { p_key: sent });
    if (error) { console.warn("[layoff-filings] cron key check failed:", error.message); return false; }
    return data === true;
  } catch (e) {
    console.warn("[layoff-filings] cron key check threw:", e);
    return false;
  }
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

// ── the read log and the writers ───────────────────────────────────────────

type LogKind = "edgar_atom" | "edgar_fts_audit" | "edgar_backfill" | "warn" | "mirror" | "lca_wages";

async function readLog(
  client: SupabaseLike,
  kind: LogKind,
  v: { fetched: number; kept: number; newRows: number; ok: boolean; ms: number; note: string | null },
): Promise<void> {
  try {
    // Every note names the build that wrote it, first, so the GET can say
    // which build ran the newest chain (the read-only verifier's clock).
    const note = [`build=${BUILD_VERSION}`, v.note].filter(Boolean).join("; ").slice(0, 500);
    const { error } = await client.from("layoff_read_log").insert({
      kind, fetched: v.fetched, kept: v.kept, new_rows: v.newRows, ok: v.ok, ms: v.ms, note,
    });
    if (error) console.warn("[layoff-filings] read log insert failed:", error.message);
  } catch (e) {
    console.warn("[layoff-filings] read log insert threw:", e);
  }
}

interface UpsertTally { inserted: number; updated: number; refused: number; reasons: string[] }

async function upsertRows(client: SupabaseLike, rows: Record<string, unknown>[]): Promise<UpsertTally> {
  const t: UpsertTally = { inserted: 0, updated: 0, refused: 0, reasons: [] };
  // THE ONE WRITE CHOKE POINT REFUSES A PRUNED MONTH (S14X-158). The EDGAR
  // backfill searches a year by FILING date while an 8-K's event_date is its
  // report date, so a filing inside the window can name a month the monthly
  // prune already rolled up; stored, it would be counted twice.
  const floor = prunedMonthFloor(todayIso(new Date()), LAYOFF_RETENTION_DAYS);
  const writable = rows.filter((r) => {
    if (!(typeof r.event_date === "string" && r.event_date < floor)) return true;
    t.refused += 1;
    if (t.reasons.length < 20) t.reasons.push(`${r.filing_id ?? "?"}: event_date ${r.event_date} is before ${floor}, a month already rolled up`);
    return false;
  });
  for (let i = 0; i < writable.length; i += UPSERT_CHUNK) {
    const chunk = writable.slice(i, i + UPSERT_CHUNK);
    const { data, error } = await client.rpc("layoff_filings_upsert", { p_rows: chunk });
    if (error) throw new Error(`layoff_filings_upsert: ${error.message}`);
    const r = Array.isArray(data) ? data[0] : data;
    t.inserted += Number(r?.lu_inserted ?? 0);
    t.updated += Number(r?.lu_updated ?? 0);
    t.refused += Number(r?.lu_refused ?? 0);
    const reasons: string[] = Array.isArray(r?.lu_refused_reasons) ? r.lu_refused_reasons : [];
    const ids: string[] = Array.isArray(r?.lu_refused_ids) ? r.lu_refused_ids : [];
    reasons.forEach((reason, k) => { if (t.reasons.length < 20) t.reasons.push(`${ids[k] ?? "?"}: ${reason}`); });
  }
  return t;
}

/** Which of these filing ids already exist. */
async function existingIds(client: SupabaseLike, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await client.from("layoff_filings").select("filing_id").in("filing_id", ids.slice(i, i + 500));
    if (error) throw new Error(`layoff_filings select: ${error.message}`);
    for (const r of data ?? []) out.add(r.filing_id);
  }
  return out;
}

async function rebuildMatches(client: SupabaseLike): Promise<string> {
  const t0 = Date.now();
  const { data, error } = await client.rpc("layoff_matches_rebuild");
  if (error) {
    const line = `[layoff-filings] kind=matcher ok=false error=${JSON.stringify(error.message)} ms=${Date.now() - t0}`;
    console.error(line);
    return line;
  }
  const r = Array.isArray(data) ? data[0] : data;
  const line =
    `[layoff-filings] kind=matcher exact_multitoken=${r?.lm_exact_multitoken ?? 0} alias=${r?.lm_alias ?? 0}` +
    ` refused_single=${r?.lm_refused_single ?? 0} refused_ambiguous=${r?.lm_refused_ambiguous ?? 0}` +
    ` refused_state_gate=${r?.lm_refused_state_gate ?? 0} refused_rejected=${r?.lm_refused_rejected ?? 0}` +
    ` unmatched=${r?.lm_unmatched ?? 0} filings=${r?.lm_filings ?? 0} ms=${r?.lm_ms ?? Date.now() - t0}`;
  console.log(line);
  return line;
}

async function refreshPartition(client: SupabaseLike): Promise<string> {
  const t0 = Date.now();
  const { data, error } = await client.rpc("refresh_layoff_partition");
  if (error) {
    const line = `[layoff-filings] kind=partition ok=false error=${JSON.stringify(error.message)} ms=${Date.now() - t0}`;
    console.error(line);
    return line;
  }
  const rows: Array<Record<string, unknown>> = Array.isArray(data) ? data : data ? [data] : [];
  const arms = rows.map((r) =>
    `${r.lw_arm}:n=${r.lw_n_at_risk_30 ?? 0},employers=${r.lw_employers_n ?? 0},sufficient=${r.lw_sufficient_30 ?? false},reason=${r.lw_insufficient_reason ?? "-"}`
  ).join(" ");
  const line = `[layoff-filings] kind=partition ${arms} ms=${Date.now() - t0}`;
  console.log(line);
  return line;
}

async function lastOkRead(client: SupabaseLike, kind: LogKind): Promise<string | null> {
  const { data } = await client.from("layoff_read_log").select("read_at").eq("kind", kind).eq("ok", true)
    .order("read_at", { ascending: false }).limit(1);
  const v = Array.isArray(data) ? data[0]?.read_at : null;
  return typeof v === "string" ? v : null;
}

// ── EDGAR: the hourly Atom read ────────────────────────────────────────────

interface EdgarTally {
  fetched: number; kept: number; newRows: number; amend: number; amendUnresolved: number; parsedPct: number;
  refused: number; notes: string[];
}

async function processAccessions(
  http: Http, client: SupabaseLike, targets: Array<{ cik: number; adsh: string; name?: string; coCiks?: number[] }>, readAt: Date,
  deadline: number, noteEach: string | null, tally: EdgarTally,
): Promise<{ stoppedEarly: boolean; processed: number }> {
  let processed = 0;
  for (const t of targets) {
    if (Date.now() > deadline) return { stoppedEarly: true, processed };
    const f = await fetchFiling(http, t.cik, t.adsh, readAt, t.name, t.coCiks ?? []);
    processed += 1;
    if (!f.row) { tally.notes.push(`${t.adsh}:${f.note ?? "no_row"}`); continue; }
    const up = await upsertRows(client, [f.row]);
    tally.newRows += up.inserted;
    tally.refused += up.refused;
    if (up.refused > 0) tally.notes.push(...up.reasons);
    if (f.amend) tally.amend += 1;
    if (f.amendUnresolved) tally.amendUnresolved += 1;
    if (f.parsedPct) tally.parsedPct += 1;
    if (f.note) tally.notes.push(`${t.adsh}:${f.note}`);
    if (noteEach) tally.notes.push(`${t.adsh}:${noteEach}`);
  }
  return { stoppedEarly: false, processed };
}

async function runEdgar(client: SupabaseLike): Promise<Response> {
  const t0 = Date.now();
  const deadline = t0 + WALL_CLOCK_MS;
  const readAt = new Date();
  const http = secHttp(500);
  const tally: EdgarTally = { fetched: 0, kept: 0, newRows: 0, amend: 0, amendUnresolved: 0, parsedPct: 0, refused: 0, notes: [] };
  let ok = true;
  let stoppedEarly = false;
  try {
    const lastOk = await lastOkRead(client, "edgar_atom");
    const kept: AtomEntry[] = [];
    for (let page = 0; page < ATOM_MAX_PAGES; page++) {
      const r = await http.getText(atomPageUrl(page * 100), { Accept: "application/atom+xml" });
      if (r.status !== 200) throw new Error(`atom page ${page} status ${r.status}`);
      const entries = parseAtom(r.text);
      tally.fetched += entries.length;
      kept.push(...keep205(entries));
      if (entries.length < 100) break;
      const oldest = entries[entries.length - 1]?.acceptedAt;
      // Page 2 only when the oldest entry on this page is still newer than
      // the last read that succeeded — the overlap is what makes a missed
      // hour harmless, not a deeper walk every time.
      if (!lastOk || !oldest || Date.parse(oldest) <= Date.parse(lastOk)) break;
    }
    tally.kept = kept.length;
    const ids = kept.map((e) => `sec:${e.adsh}`);
    const have = await existingIds(client, ids);
    const fresh = kept.filter((e) => !have.has(`sec:${e.adsh}`) && e.cik > 0);
    const r = await processAccessions(
      http, client, fresh.map((e) => ({ cik: e.cik, adsh: e.adsh, name: e.filerName, coCiks: e.coCiks })), readAt, deadline, null, tally,
    );
    stoppedEarly = r.stoppedEarly;
    if (tally.newRows > 0) await rebuildMatches(client);
  } catch (e) {
    ok = false;
    tally.notes.push(`error:${(e as Error).message}`);
  }
  const ms = Date.now() - t0;
  const line =
    `[layoff-filings] kind=edgar_atom fetched=${tally.fetched} kept=${tally.kept} new=${tally.newRows} amend=${tally.amend}` +
    ` amend_unresolved=${tally.amendUnresolved} parsed_pct=${tally.parsedPct} ms=${ms} ok=${ok}` +
    (stoppedEarly ? " stopped_early=true" : "") + (tally.notes.length ? ` notes=${JSON.stringify(tally.notes.slice(0, 8))}` : "");
  (ok ? console.log : console.error)(line);
  await readLog(client, "edgar_atom", {
    fetched: tally.fetched, kept: tally.kept, newRows: tally.newRows, ok, ms,
    note: [stoppedEarly ? "stopped_early" : null, ...tally.notes.slice(0, 6)].filter(Boolean).join("; ") || null,
  });
  return json({ ok, kind: "edgar_atom", ...tally, ms, stoppedEarly, version: BUILD_VERSION }, ok ? 200 : 500);
}

// ── EDGAR: the full-text audit and the backfill ────────────────────────────

async function ftsPage(http: Http, startdt: string, enddt: string, from: number): Promise<FtsHit[] | null> {
  const r = await http.getJson(ftsUrl(startdt, enddt, from));
  if (r.status !== 200) return null;
  return parseFtsHits(r.json);
}

async function runEdgarAudit(client: SupabaseLike): Promise<Response> {
  const t0 = Date.now();
  const deadline = t0 + WALL_CLOCK_MS;
  const readAt = new Date();
  const http = secHttp(500);
  const today = todayIso(readAt);
  const tally: EdgarTally = { fetched: 0, kept: 0, newRows: 0, amend: 0, amendUnresolved: 0, parsedPct: 0, refused: 0, notes: [] };
  let ok = true;
  let ftsOnly = 0;
  let stoppedEarly = false;
  const reread = { read: 0, replaced: 0, flipped: 0, unread: 0, notes: [] as string[] };
  try {
    const hits = new Map<string, FtsHit>();
    for (let page = 0; page < FTS_MAX_PAGES; page++) {
      const p = await ftsPage(http, addDays(today, -AUDIT_DAYS), today, page * 100);
      if (p == null) break; // a non-hits body is the end of the results, not a throttle
      tally.fetched += p.length;
      for (const h of p) hits.set(h.adsh, h);
      if (p.length < 100) break;
    }
    tally.kept = hits.size;
    const have = await existingIds(client, [...hits.keys()].map((a) => `sec:${a}`));
    const missing = [...hits.values()].filter((h) => !have.has(`sec:${h.adsh}`) && h.cik > 0);
    ftsOnly = missing.length;
    const r = await processAccessions(
      http, client, missing.map((h) => ({ cik: h.cik, adsh: h.adsh, name: h.displayName ?? undefined, coCiks: h.coCiks })), readAt, deadline, "fts_only", tally,
    );
    stoppedEarly = r.stoppedEarly;
    // THE DAILY SHARE OF THE RE-READ (S14X-278). edgar_reread was a hand-run
    // action, so a placeholder, a status update or a row an older parser read
    // stayed as stored. The audit now reads at most AUDIT_REREAD_MAX of them a
    // day with what is left of its wall clock; a failure here is a note, never
    // the audit's verdict (its alarm is fts_only).
    if (!stoppedEarly) {
      try {
        const stored = await storedSecRows(client, addDays(today, -LAYOFF_DISPLAY_MAX_AGE_DAYS));
        for (const row of auditRereadPick(stored, today, AUDIT_REREAD_MAX)) {
          if (Date.now() > deadline) { stoppedEarly = true; break; }
          await rereadOne(http, client, row, readAt, reread);
        }
      } catch (e) {
        reread.notes.push(`reread_error:${(e as Error).message}`);
      }
    }
    if (tally.newRows > 0 || reread.replaced > 0) await rebuildMatches(client);
  } catch (e) {
    ok = false;
    tally.notes.push(`error:${(e as Error).message}`);
  }
  const ms = Date.now() - t0;
  // fts_only > 0 is the alert: the Atom channel missed what the index holds.
  // Equality is not expected the other way (the index runs ~97.7 % complete).
  const line =
    `[layoff-filings] kind=edgar_fts_audit fetched=${tally.fetched} kept=${tally.kept} fts_only=${ftsOnly} new=${tally.newRows}` +
    ` reread=${reread.read} reread_replaced=${reread.replaced} ms=${ms} ok=${ok}` + (stoppedEarly ? " stopped_early=true" : "") + (tally.notes.length ? ` notes=${JSON.stringify(tally.notes.slice(0, 8))}` : "");
  (ok ? console.log : console.error)(line);
  await readLog(client, "edgar_fts_audit", {
    fetched: tally.fetched, kept: tally.kept, newRows: tally.newRows, ok, ms,
    note: [
      `fts_only=${ftsOnly}`, `reread=${reread.read}`, `reread_replaced=${reread.replaced}`, stoppedEarly ? "stopped_early" : null,
      ...tally.notes.slice(0, 4), ...reread.notes.slice(0, 2),
    ].filter(Boolean).join("; "),
  });
  return json({
    ok, kind: "edgar_fts_audit", ftsOnly, ...tally, reread: { read: reread.read, replaced: reread.replaced, flipped: reread.flipped, unread: reread.unread },
    ms, version: BUILD_VERSION,
  }, ok ? 200 : 500);
}

async function runEdgarBackfill(client: SupabaseLike, body: Record<string, unknown>, selfKick: (b: Record<string, unknown>) => void): Promise<Response> {
  const t0 = Date.now();
  const deadline = t0 + WALL_CLOCK_MS;
  const readAt = new Date();
  const http = secHttp(250);
  const today = todayIso(readAt);
  const from = Math.max(0, Number(body.from) || 0);
  const index = Math.max(0, Number(body.index) || 0);
  const tally: EdgarTally = { fetched: 0, kept: 0, newRows: 0, amend: 0, amendUnresolved: 0, parsedPct: 0, refused: 0, notes: [] };
  let ok = true;
  let next: Record<string, unknown> | null = null;
  try {
    const page = await ftsPage(http, addDays(today, -LAYOFF_RETENTION_DAYS), today, from);
    if (page == null || page.length === 0) {
      tally.notes.push("end_of_results");
    } else {
      tally.fetched = page.length;
      const sorted = page.sort((a, b) => a.adsh.localeCompare(b.adsh));
      const have = await existingIds(client, sorted.map((h) => `sec:${h.adsh}`));
      const pending = sorted.slice(index).filter((h) => !have.has(`sec:${h.adsh}`) && h.cik > 0);
      const chunk = pending.slice(0, BACKFILL_CHUNK);
      tally.kept = chunk.length;
      const r = await processAccessions(
        http, client, chunk.map((h) => ({ cik: h.cik, adsh: h.adsh, name: h.displayName ?? undefined, coCiks: h.coCiks })), readAt, deadline, "backfill", tally,
      );
      const consumed = r.stoppedEarly ? r.processed : chunk.length;
      if (r.stoppedEarly || pending.length > chunk.length) {
        // Resume inside this page: the index is the position of the last
        // processed hit in the sorted page plus one. A slice that processed
        // nothing does not kick itself again — that is a stall to read in
        // the log, not a loop.
        const last = chunk[consumed - 1];
        const pos = last ? sorted.findIndex((h) => h.adsh === last.adsh) + 1 : index;
        if (consumed > 0) next = { action: "edgar_backfill", from, index: pos };
        else tally.notes.push("no_progress");
      } else if (page.length >= 100) {
        next = { action: "edgar_backfill", from: from + 100, index: 0 };
      }
    }
    if (tally.newRows > 0) await rebuildMatches(client);
  } catch (e) {
    ok = false;
    tally.notes.push(`error:${(e as Error).message}`);
  }
  const ms = Date.now() - t0;
  const line =
    `[layoff-filings] kind=edgar_backfill from=${from} index=${index} fetched=${tally.fetched} kept=${tally.kept} new=${tally.newRows}` +
    ` amend=${tally.amend} amend_unresolved=${tally.amendUnresolved} parsed_pct=${tally.parsedPct} ms=${ms} ok=${ok}` +
    (next ? ` next=${JSON.stringify(next)}` : " next=none") + (tally.notes.length ? ` notes=${JSON.stringify(tally.notes.slice(0, 6))}` : "");
  (ok ? console.log : console.error)(line);
  await readLog(client, "edgar_backfill", {
    fetched: tally.fetched, kept: tally.kept, newRows: tally.newRows, ok, ms,
    note: [`from=${from}`, `index=${index}`, next ? `next=${next.from}/${next.index}` : "done", ...tally.notes.slice(0, 4)].join("; "),
  });
  if (ok && next) selfKick(next);
  return json({ ok, kind: "edgar_backfill", from, index, next, ...tally, ms, version: BUILD_VERSION }, ok ? 200 : 500);
}

// ── EDGAR: the re-read of rows an older build stored wrong ─────────────────
//
// The candidates (edgar.ts rereadCandidates) are placeholders, status updates
// stored as workforce events, and rows an older parser version read. The
// daily audit reads a bounded share of them; edgar_reread reads them all.

/** Active SEC rows inside the display window, with what the candidate rule reads. */
async function storedSecRows(client: SupabaseLike, floor: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await client.from("layoff_filings")
    .select("filing_id,cik,adsh,filer_raw,section_text,parse_confidence,is_workforce_event,parser_version")
    .eq("source", "sec_8k_205").eq("status", "active").gte("event_date", floor)
    .order("filing_id", { ascending: true }).limit(2000);
  if (error) throw new Error(`layoff_filings select: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

interface RereadTally { read: number; replaced: number; flipped: number; unread: number; notes: string[] }

/** Read one stored row's document again; the row is replaced only when the document was read. */
async function rereadOne(http: Http, client: SupabaseLike, r: Record<string, unknown>, readAt: Date, tally: RereadTally): Promise<void> {
  tally.read += 1;
  const f = await fetchFiling(http, Number(r.cik), String(r.adsh), readAt, String(r.filer_raw ?? ""));
  if (!f.row || !(Number(f.row.parse_confidence) > 0)) { tally.unread += 1; tally.notes.push(`${r.adsh}:${f.note ?? "unread"}`); return; }
  const up = await upsertRows(client, [f.row]);
  tally.replaced += up.inserted + up.updated;
  if (r.is_workforce_event === true && f.row.is_workforce_event === false) tally.flipped += 1;
  if (up.refused > 0) tally.notes.push(...up.reasons);
}

// Every ingest path skips a filing_id it holds, so a row an older build wrote
// is never re-evaluated: a status update stays a workforce event (S8-026) and
// a throttled read stays "(document not read)" (S8-108). Active rows inside
// the display window only; a re-read replaces a row only when it read the
// document, so a good row is never overwritten by a failed read.
async function runEdgarReread(client: SupabaseLike, body: Record<string, unknown>, selfKick: (b: Record<string, unknown>) => void): Promise<Response> {
  const t0 = Date.now();
  const deadline = t0 + WALL_CLOCK_MS;
  const readAt = new Date();
  const http = secHttp(500);
  const after = typeof body.after === "string" ? body.after : "";
  const floor = addDays(todayIso(readAt), -LAYOFF_DISPLAY_MAX_AGE_DAYS);
  const tally = { candidates: 0, read: 0, replaced: 0, flipped: 0, unread: 0, notes: [] as string[] };
  let ok = true;
  let next: Record<string, unknown> | null = null;
  try {
    const todo = rereadCandidates(await storedSecRows(client, floor), after);
    tally.candidates = todo.length;
    for (const r of todo) {
      if (Date.now() > deadline) {
        if (tally.read > 0) next = { action: "edgar_reread", after: String(todo[tally.read - 1].filing_id) };
        break;
      }
      await rereadOne(http, client, r, readAt, tally);
    }
    if (tally.replaced > 0) await rebuildMatches(client);
  } catch (e) {
    ok = false;
    tally.notes.push(`error:${(e as Error).message}`);
  }
  const ms = Date.now() - t0;
  console.log(`[layoff-filings] kind=edgar_reread after=${after || "-"} candidates=${tally.candidates} read=${tally.read} replaced=${tally.replaced} flipped=${tally.flipped} unread=${tally.unread} ms=${ms} ok=${ok}` + (next ? ` next=${JSON.stringify(next)}` : " next=none"));
  // Logged under the backfill kind: the read log's kind check admits no new kind without a migration.
  await readLog(client, "edgar_backfill", {
    fetched: tally.read, kept: tally.candidates, newRows: 0, ok, ms,
    note: [`reread after=${after || "-"}`, `replaced=${tally.replaced}`, `flipped=${tally.flipped}`, `unread=${tally.unread}`, next ? `next=${next.after}` : "done", ...tally.notes.slice(0, 4)].join("; "),
  });
  if (ok && next) selfKick(next);
  return json({ ok, kind: "edgar_reread", after, next, ...tally, ms, version: BUILD_VERSION }, ok ? 200 : 500);
}

// ── WARN: the nightly slice chain ──────────────────────────────────────────

type WarnFeed = { key: string; state: string; feed: WarnRecord["feed"]; map: StateMap };

const WARN_FEEDS: WarnFeed[] = [
  { key: "TX:tx_twc_xlsx", state: "TX", feed: "tx_twc_xlsx", map: TX_MAP },
  { key: "FL:fl_react_html", state: "FL", feed: "fl_react_html", map: FL_MAP },
  ...RAW_STATE_MAPS.map((m): WarnFeed => ({ key: `${m.state}:bln_raw`, state: m.state, feed: "bln_raw", map: m })),
];

interface FeedHealthRow {
  feed: string; state: string; last_ok_at?: string | null; last_attempt_at?: string | null; latest_public_date?: string | null;
  rows_last_run?: number | null; etag?: string | null; extract_failed?: boolean | null; stale?: boolean; note?: string | null;
}

async function feedHealth(client: SupabaseLike, feed: string, state: string): Promise<FeedHealthRow | null> {
  const { data } = await client.from("layoff_feed_health").select("*").eq("feed", feed).eq("state", state).maybeSingle();
  return (data as FeedHealthRow | null) ?? null;
}

async function upsertFeedHealth(client: SupabaseLike, row: FeedHealthRow): Promise<void> {
  const { error } = await client.from("layoff_feed_health").upsert(row, { onConflict: "feed,state" });
  if (error) console.warn("[layoff-filings] feed health upsert failed:", error.message);
}

/** The Big Local News etl.yml run's failed extracts, written per state; two GETs to api.github.com. */
async function recordExtractFailures(client: SupabaseLike, http: Http): Promise<string> {
  const now = new Date().toISOString();
  try {
    const runs = await http.getJson(BLN_RUNS_URL, { Accept: "application/vnd.github+json" });
    const jobsUrl = runs.status === 200 ? latestRunJobsUrl(runs.json) : null;
    if (!jobsUrl) throw new Error(`runs status ${runs.status}`);
    const jobs = await http.getJson(jobsUrl, { Accept: "application/vnd.github+json" });
    const f = jobs.status === 200 ? extractFailuresFrom(jobs.json) : null;
    if (!f) throw new Error(`jobs status ${jobs.status}`);
    for (const st of f.seen) {
      await upsertFeedHealth(client, { feed: "bln_raw", state: st, extract_failed: f.failed.has(st), last_attempt_at: now });
    }
    await upsertFeedHealth(client, {
      feed: "bln_etl", state: "", last_ok_at: now, last_attempt_at: now, stale: false, extract_failed: f.failed.size > 0,
      note: `failed=[${[...f.failed].sort().join(",")}] seen=${f.seen.size}`,
    });
    return `extract_failed=[${[...f.failed].sort().join(",")}]`;
  } catch (e) {
    await upsertFeedHealth(client, { feed: "bln_etl", state: "", last_attempt_at: now, note: `error: ${(e as Error).message}`.slice(0, 200) });
    return `extract_failed=unknown(${(e as Error).message})`;
  }
}

/** California parity: the EDD file's Last-Modified beside the BLN raw read; promotes nothing by itself. */
async function caParityHead(client: SupabaseLike, http: Http): Promise<void> {
  const now = new Date().toISOString();
  try {
    const r = await http.head("https://edd.ca.gov/siteassets/files/jobs_and_training/warn/warn_report1.xlsx");
    const lm = r.headers.get("last-modified");
    await upsertFeedHealth(client, {
      feed: "ca_edd_xlsx", state: "CA", last_attempt_at: now, last_ok_at: r.status === 200 ? now : undefined, etag: lm,
      stale: false, note: `status=${r.status} last_modified=${lm ?? "-"}`,
    });
  } catch (e) {
    await upsertFeedHealth(client, { feed: "ca_edd_xlsx", state: "CA", last_attempt_at: now, note: `error: ${(e as Error).message}`.slice(0, 200) });
  }
}

interface FeedOutcome {
  ok: boolean;
  /** The map did not recognise the file's header: nothing was stored and the header is in the health note. */
  refused: boolean;
  /** A first-read state's feed waited for its writer (S14X-036): nothing was fetched. */
  held?: boolean;
  changed: boolean;
  rows: number;
  newRows: number;
  line: string;
}

/**
 * Is the migration that keeps a first read's date and retires an edited
 * notice applied (20261112182000)? Its retire RPC, asked with no span,
 * retires nothing and answers; before the migration it is PGRST202.
 */
async function warnRetireReady(client: SupabaseLike): Promise<boolean> {
  try {
    const { error } = await client.rpc("layoff_warn_retire_unseen", { p_state: "", p_feed: "", p_seen: [], p_from: null, p_to: null });
    return !error;
  } catch {
    return false;
  }
}

/**
 * AN EDITED NOTICE RETIRES ITS OLD READING (S14X-069). After a complete read
 * of a whole-history feed, the feed's active rows the read did not produce,
 * dated inside the read's span, are superseded (the writer's breaker holds a
 * read that would retire too many). Only Big Local News' raw files hold a
 * state's whole history: the two direct feeds read one year's file at a
 * time, so a row absent from tonight's read may sit in the other year's file.
 */
async function retireUnseen(client: SupabaseLike, f: WarnFeed, rows: Record<string, unknown>[], ready: boolean): Promise<string | null> {
  if (f.feed !== "bln_raw" || rows.length === 0) return null;
  if (!ready) return "retire_unavailable";
  const dates = rows.map((r) => String(r.event_date)).sort();
  const { data, error } = await client.rpc("layoff_warn_retire_unseen", {
    p_state: f.state, p_feed: f.feed, p_seen: rows.map((r) => String(r.filing_id)), p_from: dates[0], p_to: dates[dates.length - 1],
  });
  if (error) return `retire_error=${error.message}`.slice(0, 120);
  const r = Array.isArray(data) ? data[0] : data;
  if (r?.lr_refused) return `retire_held=${Number(r.lr_candidates ?? 0)}/${Number(r.lr_active ?? 0)}`;
  return Number(r?.lr_retired ?? 0) > 0 ? `retired=${Number(r.lr_retired)}` : null;
}

async function readOneFeed(client: SupabaseLike, http: Http, f: WarnFeed, readAt: Date, ready: boolean): Promise<FeedOutcome> {
  const t0 = Date.now();
  const readIso = todayIso(readAt);
  const prior = await feedHealth(client, f.feed, f.state);
  const extractFailed = f.feed === "bln_raw" ? (prior?.extract_failed ?? null) : null;
  const base = `[layoff-filings] kind=warn state=${f.state} feed=${f.feed}`;
  // A FIRST-READ STATE WAITS FOR ITS WRITER (S14X-036). Before
  // 20261112182000 the upsert overwrites public_date on every read, so a
  // notice dated by our first read would be re-dated every night. Until the
  // migration answers, such a feed is held: nothing fetched, nothing stored,
  // a note -- as before this build, when its map refused the file.
  if (f.map.visibleBasis === "our_first_fetch" && !ready) {
    const note = "first_fetch_held: the writer that keeps a first read's date is not applied";
    await upsertFeedHealth(client, { feed: f.feed, state: f.state, last_attempt_at: readAt.toISOString(), note });
    console.log(`${base} held rows=0 new=0 ms=${Date.now() - t0} ok=true note=${JSON.stringify(note)}`);
    return { ok: true, refused: false, held: true, changed: false, rows: 0, newRows: 0, line: `${base} held` };
  }
  const finish = async (v: {
    ok: boolean; refused?: boolean; changed: boolean; rows: number; newRows: number; superseded: number; rescinded: number;
    latest: string | null; etag: string | null; note: string | null; tag: string;
  }): Promise<FeedOutcome> => {
    const latest = v.latest ?? prior?.latest_public_date ?? null;
    const stale = isStale(latest, extractFailed, readIso, LAYOFF_FEED_STALE_DAYS);
    await upsertFeedHealth(client, {
      feed: f.feed, state: f.state, last_attempt_at: readAt.toISOString(),
      ...(v.ok ? { last_ok_at: readAt.toISOString() } : {}),
      ...(v.changed ? { latest_public_date: latest, rows_last_run: v.rows } : {}),
      // A validator is stored only for a read that was ok (S8-107).
      ...(v.ok && v.etag ? { etag: v.etag } : {}),
      stale, note: v.note,
    });
    const ms = Date.now() - t0;
    const line = `${base} ${v.tag} rows=${v.rows} new=${v.newRows} superseded=${v.superseded} rescinded=${v.rescinded}` +
      ` latest_public=${latest ?? "-"} extract_failed=${extractFailed ?? "-"} stale=${stale} ms=${ms} ok=${v.ok}` +
      (v.note ? ` note=${JSON.stringify(v.note)}` : "");
    (v.ok ? console.log : console.error)(line);
    return { ok: v.ok, refused: v.refused === true, changed: v.changed, rows: v.rows, newRows: v.newRows, line };
  };
  // A REFUSED FILE IS READ AGAIN, NEVER TAKEN AS UNCHANGED (S8-107). A
  // refusal used to store the file's validator, so the next night's 304
  // recorded the feed ok with no note and a broken verified feed read green
  // until isStale tripped 21 days later. A refusal no longer stores one, and
  // a row written before that change (or a map fixed since) is re-read
  // without the conditional header instead of trusting a 304.
  const priorRefused = !!prior?.note && /^header_mismatch/.test(prior.note);
  const validator = priorRefused ? null : (prior?.etag ?? null);
  const unchanged = (v: string | null, tag: string): Promise<FeedOutcome> =>
    finish({ ok: true, changed: false, rows: prior?.rows_last_run ?? 0, newRows: 0, superseded: 0, rescinded: 0, latest: null, etag: v, note: null, tag });
  try {
    let table: Table | null = null;
    let tag = "";
    let etag: string | null = null;
    let sourceUrl: string | undefined;
    if (f.feed === "tx_twc_xlsx") {
      const year = readAt.getUTCFullYear();
      const cur = await fetchTwcYear(http, year, validator);
      if (cur.status === 304) return unchanged(cur.lastModified, "last_modified=unchanged");
      if (cur.status !== 200 || !cur.table) throw new Error(`twc xlsx status ${cur.status}`);
      table = cur.table;
      etag = cur.lastModified;
      tag = `last_modified=${cur.lastModified ?? "-"}`;
      // The previous year's file once a night in January–March keeps the
      // 365-day window whole across the year boundary.
      if (readAt.getUTCMonth() <= 2) {
        const prev = await fetchTwcYear(http, year - 1, null);
        if (prev.status === 200 && prev.table) table.rows.push(...prev.table.rows);
      }
    } else if (f.feed === "fl_react_html") {
      const year = readAt.getUTCFullYear();
      const cur = await fetchFlYear(http, year);
      if (cur.status !== 200) throw new Error(`fl listing status ${cur.status}`);
      table = cur.table;
      sourceUrl = flListingUrl(year);
      tag = `pages=${cur.pages}`;
      if (readAt.getUTCMonth() <= 2) {
        const prev = await fetchFlYear(http, year - 1);
        if (prev.status === 200) table.rows.push(...prev.table.rows);
      }
    } else {
      const raw = await fetchBlnRaw(http, f.map, validator);
      if (raw.status === 304 || (raw.status === 200 && !raw.changed)) return unchanged(raw.etag, "etag=unchanged");
      if (raw.status !== 200 || raw.text == null) throw new Error(`bln raw status ${raw.status}`);
      table = tableFromCsv(raw.text, f.map);
      etag = raw.etag;
      tag = "etag=changed";
    }
    const mapped: MapResult = mapTable(f.map, table, f.feed, sourceUrl, readAt);
    if (!mapped.ok) {
      // A file whose header the map does not recognise stores nothing; the
      // header it showed goes to the health row so the map can be pinned.
      // NO ETAG (S8-107): stored, the next night's 304 recorded the feed ok
      // with no note, and a broken verified feed read green for 21 days.
      return finish({
        ok: false, refused: true, changed: true, rows: table.rows.length, newRows: 0, superseded: 0, rescinded: 0, latest: null, etag: null,
        note: `${mapped.reason} header=${JSON.stringify(mapped.header).slice(0, 300)}`, tag,
      });
    }
    const built = await buildWarnRows(mapped.records, readAt, LAYOFF_RETENTION_DAYS);
    const up = built.rows.length > 0 ? await upsertRows(client, built.rows) : { inserted: 0, updated: 0, refused: 0, reasons: [] };
    const retired = await retireUnseen(client, f, built.rows, ready);
    const noteParts = [
      retired,
      f.map.verifiedAgainstSample ? null : "map_unverified",
      built.futureDated ? `future_dated=${built.futureDated}` : null,
      built.noticeAfterStamp ? `notice_after_stamp=${built.noticeAfterStamp}` : null,
      mapped.dropped.noFiler ? `no_filer=${mapped.dropped.noFiler}` : null,
      mapped.dropped.noVisibleDate ? `no_visible_date=${mapped.dropped.noVisibleDate}` : null,
      mapped.dropped.notWarn ? `not_warn=${mapped.dropped.notWarn}` : null,
      up.refused ? `refused=${up.refused} ${up.reasons.slice(0, 3).join(" | ")}` : null,
    ].filter(Boolean);
    return finish({
      ok: true, changed: true, rows: built.rows.length, newRows: up.inserted, superseded: built.superseded, rescinded: built.rescinded,
      latest: built.latestPublicDate, etag, note: noteParts.length ? noteParts.join("; ") : null, tag: `${tag} in_window=${built.rows.length} too_old=${built.tooOld}`,
    });
  } catch (e) {
    return finish({
      ok: false, changed: false, rows: 0, newRows: 0, superseded: 0, rescinded: 0, latest: null, etag: null,
      note: `error: ${(e as Error).message}`.slice(0, 300), tag: "fetch=failed",
    });
  }
}

async function runWarn(client: SupabaseLike, body: Record<string, unknown>, selfKick: (b: Record<string, unknown>) => void): Promise<Response> {
  const t0 = Date.now();
  const deadline = t0 + WALL_CLOCK_MS;
  const readAt = new Date();
  const http = new Http({ userAgent: USER_AGENT, defaultIntervalMs: 1000, minIntervalMs: { "api.github.com": 1000, "raw.githubusercontent.com": 500 }, timeoutMs: 30_000 });
  const cursor = body.cursor == null ? 0 : Math.max(0, Number(body.cursor) || 0);
  const notes: string[] = [];
  let attempted = 0, rowsMapped = 0, newRows = 0;
  let allOk = true;
  let next = cursor;
  try {
    const end = Math.min(WARN_FEEDS.length, cursor + WARN_STATES_PER_SLICE);
    // One probe per slice: is 20261112182000 (the writer that keeps a first
    // read's date, and the retire) applied?
    const ready = await warnRetireReady(client);
    for (let i = cursor; i < end; i++) {
      if (Date.now() > deadline) { notes.push("wall_clock"); break; }
      const f = WARN_FEEDS[i];
      const r = await readOneFeed(client, http, f, readAt, ready);
      attempted += 1;
      rowsMapped += r.rows;
      newRows += r.newRows;
      if (r.held) notes.push(`held=${f.key}`);
      if (!r.ok) {
        // Every state map is now pinned to a saved file of its own (S14X-036),
        // so a refused header is a state that changed its file: a failed
        // read, which the heartbeat's liveness check is there to see. The
        // verdict still names an unverified map's refusal a note, for a map
        // added later before its sample is saved.
        const v = feedVerdict(r, f.map);
        if (v === "refused") notes.push(`refused=${f.key}`);
        else { allOk = false; notes.push(`failed=${f.key}`); }
      }
      next = i + 1;
    }
  } catch (e) {
    allOk = false;
    notes.push(`error:${(e as Error).message}`);
  }
  const done = next >= WARN_FEEDS.length;
  if (done) {
    // The Big Local News run reader (two GitHub GETs) runs after the last
    // feed, never before the first: put ahead of the loop with two 30 s
    // timeouts it could eat the slice's whole wall clock, and a first slice
    // that attempts no feed never kicks the next one -- the night's matcher
    // and partition refresh would be skipped with only a wall_clock note.
    // extract_failed is read from the prior health row on the next read.
    notes.push(await recordExtractFailures(client, http));
    await caParityHead(client, http);
    await rebuildMatches(client);
    await refreshPartition(client);
  }
  const ms = Date.now() - t0;
  const line = `[layoff-filings] kind=warn slice cursor=${cursor} next=${done ? "done" : next} states=${attempted} rows=${rowsMapped} new=${newRows}` +
    ` ms=${ms} ok=${allOk}` + (notes.length ? ` notes=${JSON.stringify(notes)}` : "");
  (allOk ? console.log : console.error)(line);
  await readLog(client, "warn", {
    fetched: attempted, kept: rowsMapped, newRows, ok: allOk, ms,
    note: [`cursor=${cursor}`, done ? "done" : `next=${next}`, ...notes].join("; "),
  });
  if (!done && attempted > 0) selfKick({ action: "warn", cursor: next });
  return json({ ok: allOk, kind: "warn", cursor, next: done ? null : next, states: attempted, rows: rowsMapped, newRows, ms, notes, version: BUILD_VERSION }, allOk ? 200 : 500);
}

// ── the mirror: the catalogue's names into layoff_board_names ──────────────
//
// The matcher's exact rule compares a filer's name against
// layoff_board_names.display_norm, and until 2026-09-21 that table was
// written only by scripts/layoff-board-names-mirror.mjs --apply, which needs
// the service key this project does not hold outside the platform. The
// table stayed empty; every two-word filer answered no rows. So the deploy
// writes it: this action builds the rows the script builds (one rule,
// mirror-rows.ts) from the catalogue this bundle imports, and posts them to
// layoff_board_names_mirror in chunks that all carry ONE run_started_at,
// pruning on the last chunk only, so a token that left the catalogue leaves
// the mirror and a run that fails part-way prunes nothing. display_norm is
// computed by the writer with layoff_norm; nothing here normalises a name.
//
// With chain:true the matcher and the partition writer run after a good
// mirror, so one POST brings every surface current. The daily cron passes
// chain:false and lets the existing matcher row, minutes later, do that.
// The two chained calls report a failure in their line (" ok=false"), never
// by throwing, so the response carries chainOk (null when nothing chained)
// and answers 500 when either failed: a caller reading ok:true / HTTP 200
// must be able to trust that the surfaces it asked for are current.

interface MirrorTally {
  rows: number; catalogue: number; facet: number; facetSkipped: number;
  chunks: number; chunksDone: number; upserted: number; pruned: number; total: number;
}

async function runMirror(client: SupabaseLike, body: Record<string, unknown>): Promise<Response> {
  const t0 = Date.now();
  const runStartedAt = new Date().toISOString();
  const chain = body.chain === true;
  const built = deployMirrorRows();
  const chunks: MirrorRow[][] = [];
  for (let i = 0; i < built.rows.length; i += MIRROR_CHUNK) chunks.push(built.rows.slice(i, i + MIRROR_CHUNK));
  const tally: MirrorTally = {
    rows: built.rows.length, catalogue: built.catalogue, facet: built.facet, facetSkipped: built.facetSkipped,
    chunks: chunks.length, chunksDone: 0, upserted: 0, pruned: 0, total: 0,
  };
  let ok = true;
  let note: string | null = null;
  try {
    if (chunks.length === 0) throw new Error("the catalogue built zero rows; nothing written, nothing pruned");
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLast = i === chunks.length - 1;
      const { data, error } = await client.rpc("layoff_board_names_mirror", { p_rows: chunk, p_run_started_at: runStartedAt, p_prune: isLast });
      if (error) throw new Error(`layoff_board_names_mirror chunk ${i + 1}/${chunks.length}: ${error.message}`);
      const r = Array.isArray(data) ? data[0] : data;
      tally.chunksDone += 1;
      tally.upserted += Number(r?.lb_upserted ?? 0);
      tally.pruned = Number(r?.lb_pruned ?? 0);
      tally.total = Number(r?.lb_total ?? 0);
    }
  } catch (e) {
    ok = false;
    note = `error:${(e as Error).message}`;
  }
  const ms = Date.now() - t0;
  const line =
    `[layoff-filings] kind=mirror rows=${tally.rows} catalogue=${tally.catalogue} facet=${tally.facet} facet_skipped=${tally.facetSkipped}` +
    ` chunks=${tally.chunksDone}/${tally.chunks} upserted=${tally.upserted} pruned=${tally.pruned} total=${tally.total}` +
    ` run_started_at=${runStartedAt} ms=${ms} ok=${ok}` + (note ? ` note=${JSON.stringify(note)}` : "");
  (ok ? console.log : console.error)(line);
  // fetched = rows built, kept = rows in the table after the run (what the
  // matcher can now compare against), new_rows = rows upserted this run.
  await readLog(client, "mirror", {
    fetched: tally.rows, kept: tally.total, newRows: tally.upserted, ok, ms,
    note: [`pruned=${tally.pruned}`, `chunks=${tally.chunksDone}/${tally.chunks}`, `catalogue=${tally.catalogue}`, `facet=${tally.facet}`, note].filter(Boolean).join("; "),
  });
  const chained: string[] = [];
  if (ok && chain) {
    chained.push(await rebuildMatches(client));
    chained.push(await refreshPartition(client));
  }
  const chainOk: boolean | null = chained.length === 0 ? null : chained.every((l) => !/ ok=false/.test(l));
  if (chainOk === false) console.error(`[layoff-filings] kind=mirror chain ok=false run_started_at=${runStartedAt}`);
  return json({ ok, kind: "mirror", ...tally, runStartedAt, chained, chainOk, ms, note, version: BUILD_VERSION }, ok && chainOk !== false ? 200 : 500);
}

// ── the H-1B wage cells: the quarter this bundle carries ───────────────────
//
// Same wall as the mirror, same answer. public.oflc_lca_wages_load is granted
// to service_role and nothing else, and no service-role key exists outside the
// platform, so the operator loader can read the Department's 250 MB file and
// post none of it. The bundle carries the folded cells instead (lca-payload.ts,
// gzipped and base64'd), this action decodes them, checks every one against the
// shape the table would refuse, and posts them through the definer in chunks
// that all carry ONE run stamp with the swap on the LAST chunk only -- the
// contract migration 20260925150412 exists to state: a period replaces itself
// and never half of itself.
//
// Nothing here is scheduled. A quarter arrives about five weeks after it ends,
// as a new file with a new digest, so the load is a deploy followed by one
// POST, and a second POST of the same bundle is a no-op that re-upserts the
// same cells under a new stamp and prunes nothing.
//
// The decode happens BEFORE the first chunk is sent: a payload that fails its
// own checks must cost nothing. And no chunk before the last touches the live
// table -- the rows are staged under the run stamp and the live period is
// replaced from the stage in one statement on the last call -- so the state
// this lane must never reach, a half-replaced period served as a whole one, is
// not reachable by an interrupted run rather than merely unlikely.

interface LcaTally {
  cells: number; tokens: number; chunks: number; chunksDone: number;
  upserted: number; pruned: number; total: number; totalTokens: number;
  refusedLedger: number; refusedTwin: number;
}

async function runLcaWages(client: SupabaseLike): Promise<Response> {
  const t0 = Date.now();
  const runStartedAt = new Date().toISOString();
  const tally: LcaTally = {
    cells: 0, tokens: 0, chunks: 0, chunksDone: 0, upserted: 0, pruned: 0, total: 0, totalTokens: 0,
    refusedLedger: 0, refusedTwin: 0,
  };
  // THE POSTING TALLY IS OURS, AND postLcaChunks MUTATES IT AS IT GOES. A tally the callee built and
  // returned was lost on the throw, so the one run where the record matters -- a chunk that failed
  // half way -- logged chunks=0 and upserted=0 while thousands of rows sat staged. The mirror lane
  // keeps its tally in the caller for exactly this reason.
  const posted = newLcaTally(0);
  let ok = true;
  let note: string | null = null;
  try {
    // The ledger and the twin-vendor tokens are refused before a chunk is
    // planned, so the swap on the last chunk takes their cells out of the
    // live table too (S8-024, S8-105).
    const refusal = refuseLcaCells(await decodeLcaCells(), twinVendorTokens(JOB_SOURCES));
    const rows = refusal.kept;
    tally.refusedLedger = refusal.ledger;
    tally.refusedTwin = refusal.twin;
    const plan = planLcaChunks(rows, runStartedAt, LCA_CHUNK_ROWS);
    tally.cells = rows.length;
    tally.tokens = new Set(rows.map((r) => r.company_token)).size;
    tally.chunks = plan.length;
    await postLcaChunks(client, plan, posted);
  } catch (e) {
    ok = false;
    note = `error:${(e as Error).message}`;
  }
  tally.chunksDone = posted.chunksDone;
  tally.upserted = posted.upserted;
  tally.pruned = posted.pruned;
  tally.total = posted.total;
  tally.totalTokens = posted.tokens;
  const ms = Date.now() - t0;
  const line =
    `[layoff-filings] kind=lca_wages cells=${tally.cells} tokens=${tally.tokens}` +
    ` chunks=${tally.chunksDone}/${tally.chunks} upserted=${tally.upserted} pruned=${tally.pruned}` +
    ` total=${tally.total} total_tokens=${tally.totalTokens} refused_ledger=${tally.refusedLedger} refused_twin=${tally.refusedTwin}` +
    ` quarter=${JSON.stringify(LCA_FISCAL_QUARTER)}` +
    ` coverage=${LCA_COVERAGE_FROM}..${LCA_COVERAGE_TO}` +
    ` published=${LCA_PUBLISHED_ON} run_started_at=${runStartedAt} ms=${ms} ok=${ok}` +
    (note ? ` note=${JSON.stringify(note)}` : "");
  (ok ? console.log : console.error)(line);
  // fetched = cells the bundle carries, kept = rows the LIVE table holds now (the previous period's
  // until the swap on the last chunk lands, which is the honest answer to "what can the reader
  // answer with"), new_rows = rows this run staged. chunks says how far it got even when it threw.
  await readLog(client, "lca_wages", {
    fetched: tally.cells, kept: tally.total, newRows: tally.upserted, ok, ms,
    note: [
      `quarter=${LCA_FISCAL_QUARTER}`, `coverage=${LCA_COVERAGE_FROM}..${LCA_COVERAGE_TO}`,
      `published=${LCA_PUBLISHED_ON}`,
      `pruned=${tally.pruned}`, `chunks=${tally.chunksDone}/${tally.chunks}`, `tokens=${tally.totalTokens}`, note,
    ].filter(Boolean).join("; "),
  });
  return json({
    ok, kind: "lca_wages", ...tally, runStartedAt, ms, note,
    quarter: LCA_FISCAL_QUARTER, publishedOn: LCA_PUBLISHED_ON,
    coverageFrom: LCA_COVERAGE_FROM, coverageTo: LCA_COVERAGE_TO,
    expected: { cells: LCA_CELL_COUNT, tokens: LCA_TOKEN_COUNT },
    version: BUILD_VERSION,
  }, ok ? 200 : 500);
}

/**
 * WHAT THE READ-ONLY VERIFIER CAN JUDGE FROM OUTSIDE: when the newest
 * complete nightly WARN chain and the newest FTS audit finished, and which
 * build wrote each (the read log's build= prefix). A line about a notice the
 * nightly read must store is judged only once a chain of this build has run.
 * A timestamp, a build and two counts leave; no row, no note text, no error.
 */
async function lastRuns(): Promise<Record<string, unknown> | null> {
  const client = getServiceClient();
  if (!client) return null;
  try {
    const newest = async (kind: string, want: (note: string) => boolean) => {
      const { data } = await client.from("layoff_read_log").select("read_at, note").eq("kind", kind).order("read_at", { ascending: false }).limit(30);
      const r = (Array.isArray(data) ? data : []).find((x: { note?: unknown }) => want(String(x?.note ?? "")));
      return r ? { at: String(r.read_at), note: String(r.note ?? "") } : null;
    };
    const build = (note: string) => /(?:^|; )build=([^;\s]+)/.exec(note)?.[1] ?? null;
    const count = (note: string, k: string) => { const m = new RegExp(`(?:^|; )${k}=(\\d+)(?:;|$)`).exec(note); return m ? Number(m[1]) : null; };
    const warn = await newest("warn", (n) => /(?:^|; )done(?:;|$)/.test(n));
    const audit = await newest("edgar_fts_audit", () => true);
    return {
      warnDone: warn ? { at: warn.at, build: build(warn.note) } : null,
      audit: audit ? { at: audit.at, build: build(audit.note), reread: count(audit.note, "reread"), rereadReplaced: count(audit.note, "reread_replaced") } : null,
    };
  } catch {
    return null;
  }
}

// ── the handler ────────────────────────────────────────────────────────────

serve(stamped(`layoff-filings.${BUILD_VERSION}`, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method === "GET") return json({ ok: true, function: "layoff-filings", version: BUILD_VERSION, parser: PARSER_VERSION, runs: await lastRuns() });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const client = getServiceClient();
  if (!client) return json({ error: "service client unavailable" }, 500);
  if (!(await cronAuthorised(req, client))) return json({ error: "unauthorised" }, 401);

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) ?? {}; } catch { /* an empty body is a bad action, not a crash */ }
  const action = String(body.action ?? "");

  const secret = req.headers.get("x-layoff-cron") ?? "";
  const selfKick = (next: Record<string, unknown>) => {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/layoff-filings`;
    waitUntil((async () => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-layoff-cron": secret },
        body: JSON.stringify(next),
      });
      try { await r.body?.cancel(); } catch { /* released */ }
      console.log(`[layoff-filings] self-kick ${JSON.stringify(next)} -> ${r.status}`);
    })());
  };

  try {
    switch (action) {
      case "edgar": return await runEdgar(client);
      case "edgar_audit": return await runEdgarAudit(client);
      case "edgar_backfill": return await runEdgarBackfill(client, body, selfKick);
      case "edgar_reread": return await runEdgarReread(client, body, selfKick);
      case "warn": return await runWarn(client, body, selfKick);
      case "matches": return json({ ok: true, line: await rebuildMatches(client), version: BUILD_VERSION });
      case "partition": return json({ ok: true, line: await refreshPartition(client), version: BUILD_VERSION });
      case "mirror": return await runMirror(client, body);
      case "lca_wages": return await runLcaWages(client);
      default: return json({ error: `unknown action ${JSON.stringify(action)}` }, 400);
    }
  } catch (e) {
    console.error("[layoff-filings] unhandled:", e);
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
}));
