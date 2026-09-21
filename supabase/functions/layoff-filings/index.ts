// layoff-filings — the poller behind the per-employer filing line.
//
//   POST { action: "edgar" }                      hourly: the EDGAR latest-filings Atom channel
//   POST { action: "edgar_audit" }                daily: full-text search completeness audit
//   POST { action: "edgar_backfill", from, index } once, chunked, self-kicking
//   POST { action: "warn", cursor }               nightly: state WARN notices, slice-chained
//   POST { action: "matches" }                    layoff_matches_rebuild(), the matcher log line
//   POST { action: "partition" }                  refresh_layoff_partition(), the Ghost-Index writer
//   POST { action: "mirror", chain }              daily: the board catalogue into layoff_board_names,
//                                                 then (chain:true) the matcher and the partition
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
  atomPageUrl, fetchFiling, ftsUrl, keep205, parseAtom, parseFtsHits,
} from "./edgar.ts";
import type { AtomEntry, FtsHit } from "./edgar.ts";
import { addDays, todayIso } from "./normalize.ts";
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

export const BUILD_VERSION = "2026-09-21.1";

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

type LogKind = "edgar_atom" | "edgar_fts_audit" | "edgar_backfill" | "warn" | "mirror";

async function readLog(
  client: SupabaseLike,
  kind: LogKind,
  v: { fetched: number; kept: number; newRows: number; ok: boolean; ms: number; note: string | null },
): Promise<void> {
  try {
    const { error } = await client.from("layoff_read_log").insert({
      kind, fetched: v.fetched, kept: v.kept, new_rows: v.newRows, ok: v.ok, ms: v.ms, note: v.note?.slice(0, 500) ?? null,
    });
    if (error) console.warn("[layoff-filings] read log insert failed:", error.message);
  } catch (e) {
    console.warn("[layoff-filings] read log insert threw:", e);
  }
}

interface UpsertTally { inserted: number; updated: number; refused: number; reasons: string[] }

async function upsertRows(client: SupabaseLike, rows: Record<string, unknown>[]): Promise<UpsertTally> {
  const t: UpsertTally = { inserted: 0, updated: 0, refused: 0, reasons: [] };
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
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
    if (tally.newRows > 0) await rebuildMatches(client);
  } catch (e) {
    ok = false;
    tally.notes.push(`error:${(e as Error).message}`);
  }
  const ms = Date.now() - t0;
  // fts_only > 0 is the alert: the Atom channel missed what the index holds.
  // Equality is not expected the other way (the index runs ~97.7 % complete).
  const line =
    `[layoff-filings] kind=edgar_fts_audit fetched=${tally.fetched} kept=${tally.kept} fts_only=${ftsOnly} new=${tally.newRows}` +
    ` ms=${ms} ok=${ok}` + (stoppedEarly ? " stopped_early=true" : "") + (tally.notes.length ? ` notes=${JSON.stringify(tally.notes.slice(0, 8))}` : "");
  (ok ? console.log : console.error)(line);
  await readLog(client, "edgar_fts_audit", {
    fetched: tally.fetched, kept: tally.kept, newRows: tally.newRows, ok, ms,
    note: [`fts_only=${ftsOnly}`, stoppedEarly ? "stopped_early" : null, ...tally.notes.slice(0, 5)].filter(Boolean).join("; "),
  });
  return json({ ok, kind: "edgar_fts_audit", ftsOnly, ...tally, ms, version: BUILD_VERSION }, ok ? 200 : 500);
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
  changed: boolean;
  rows: number;
  newRows: number;
  line: string;
}

async function readOneFeed(client: SupabaseLike, http: Http, f: WarnFeed, readAt: Date): Promise<FeedOutcome> {
  const t0 = Date.now();
  const readIso = todayIso(readAt);
  const prior = await feedHealth(client, f.feed, f.state);
  const extractFailed = f.feed === "bln_raw" ? (prior?.extract_failed ?? null) : null;
  const base = `[layoff-filings] kind=warn state=${f.state} feed=${f.feed}`;
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
      ...(v.etag ? { etag: v.etag } : {}),
      stale, note: v.note,
    });
    const ms = Date.now() - t0;
    const line = `${base} ${v.tag} rows=${v.rows} new=${v.newRows} superseded=${v.superseded} rescinded=${v.rescinded}` +
      ` latest_public=${latest ?? "-"} extract_failed=${extractFailed ?? "-"} stale=${stale} ms=${ms} ok=${v.ok}` +
      (v.note ? ` note=${JSON.stringify(v.note)}` : "");
    (v.ok ? console.log : console.error)(line);
    return { ok: v.ok, refused: v.refused === true, changed: v.changed, rows: v.rows, newRows: v.newRows, line };
  };
  try {
    let table: Table | null = null;
    let tag = "";
    let etag: string | null = null;
    let sourceUrl: string | undefined;
    if (f.feed === "tx_twc_xlsx") {
      const year = readAt.getUTCFullYear();
      const cur = await fetchTwcYear(http, year, prior?.etag ?? null);
      if (cur.status === 304) {
        return finish({ ok: true, changed: false, rows: prior?.rows_last_run ?? 0, newRows: 0, superseded: 0, rescinded: 0, latest: null, etag: cur.lastModified, note: null, tag: `last_modified=unchanged` });
      }
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
      const raw = await fetchBlnRaw(http, f.map, prior?.etag ?? null);
      if (raw.status === 304 || (raw.status === 200 && !raw.changed)) {
        return finish({ ok: true, changed: false, rows: prior?.rows_last_run ?? 0, newRows: 0, superseded: 0, rescinded: 0, latest: null, etag: raw.etag, note: null, tag: "etag=unchanged" });
      }
      if (raw.status !== 200 || raw.text == null) throw new Error(`bln raw status ${raw.status}`);
      table = tableFromCsv(raw.text, f.map);
      etag = raw.etag;
      tag = "etag=changed";
    }
    const mapped: MapResult = mapTable(f.map, table, f.feed, sourceUrl);
    if (!mapped.ok) {
      // A file whose header the map does not recognise stores nothing; the
      // header it showed goes to the health row so the map can be pinned.
      return finish({
        ok: false, refused: true, changed: true, rows: table.rows.length, newRows: 0, superseded: 0, rescinded: 0, latest: null, etag,
        note: `${mapped.reason} header=${JSON.stringify(mapped.header).slice(0, 300)}`, tag,
      });
    }
    const built = await buildWarnRows(mapped.records, readAt, LAYOFF_RETENTION_DAYS);
    const up = built.rows.length > 0 ? await upsertRows(client, built.rows) : { inserted: 0, updated: 0, refused: 0, reasons: [] };
    const noteParts = [
      f.map.verifiedAgainstSample ? null : "map_unverified",
      built.futureDated ? `future_dated=${built.futureDated}` : null,
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
    for (let i = cursor; i < end; i++) {
      if (Date.now() > deadline) { notes.push("wall_clock"); break; }
      const f = WARN_FEEDS[i];
      const r = await readOneFeed(client, http, f, readAt);
      attempted += 1;
      rowsMapped += r.rows;
      newRows += r.newRows;
      if (!r.ok) {
        // A map that was never verified against a saved file and refuses
        // the header it meets is doing what it promised: nothing stored, the
        // header in the health note for the owner to pin. That is a note on
        // the slice, not a failed read -- otherwise the seven unverified
        // states would mark every nightly run ok=false from night one and
        // the heartbeat's liveness check would fire permanently, masking a
        // real fetch or write failure. A verified map that refuses (the
        // state changed its header) and any fetch/write error stay failures.
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

// ── the handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method === "GET") return json({ ok: true, function: "layoff-filings", version: BUILD_VERSION, parser: "parse205_v2_ts" });
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
      case "warn": return await runWarn(client, body, selfKick);
      case "matches": return json({ ok: true, line: await rebuildMatches(client), version: BUILD_VERSION });
      case "partition": return json({ ok: true, line: await refreshPartition(client), version: BUILD_VERSION });
      case "mirror": return await runMirror(client, body);
      default: return json({ error: `unknown action ${JSON.stringify(action)}` }, 400);
    }
  } catch (e) {
    console.error("[layoff-filings] unhandled:", e);
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
