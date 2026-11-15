// THE DAILY CLOSED-BUT-BAKED CHECK, AND THE OWNER'S STOP RULE (B01; owner
// decision 2026-11-07, option A).
//
// The owner kept JobPosting markup on the condition that a daily check
// measures how many of the live posting pages are for postings their employer
// has already closed, and that a stop rule turns the markup off when that
// share stays high. Neither existed (G4J-01, SD-01): measured 2026-11-07, about
// 7% of the baked pages were already closed at the employer.
//
// WHAT IT DOES, GET ONLY: reads the live /sitemap.xml and /prerender-ledger.json,
// takes every posting page the sitemap names that the ledger calls live, and
// asks each posting's employer system about it (scripts/employer-reads.mjs).
// The posting's apply address comes from its ledger entry; for an entry
// written before the ledger carried it, from the page's own "Apply on" link.
//
// THE MEASURE: closedShare = closed / (open + closed), so only postings with a
// definite employer answer count; a run where more than 20% of the answers are
// unknown is NOT JUDGED (exit 4). The record, {date, checked, open, closed,
// unknown, closedShare, unknownShare, wilson95, byVendor, closedPaths}, is
// printed and, with --history, kept beside the previous ones, one per UTC date.
//
// THE RULE, AS THE OWNER MADE IT EXACT: the STOP rule fires on two
// consecutive daily checks over 5% (this run and the previous judged run on
// an earlier date), or on any manual action from Google, which no script can
// see. Firing exits 3, and the workflow opens an issue: the remedy is to set
// JOB_POSTING_MARKUP to false in src/config/seo-switches.ts and publish.
//
// Usage:
//   node scripts/posting-closure-check.mjs [--site URL] [--history FILE]
//        [--out FILE] [--budget-ms N] [--date YYYY-MM-DD] [--json]
// Exit: 0 judged and the rule did not fire; 3 the rule fired; 4 not judged
// (over 20% unknown, or nothing to check); 2 the sitemap or ledger could not
// be read.

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { idFromPostingPath, readEmployers, summarizeEmployerReads, wilson95 } from "./employer-reads.mjs";

/** The owner's line: a closed share over this is "over". */
export const STOP_SHARE = 0.05;
/** More unknown answers than this share and the run is not judged. */
export const MAX_UNKNOWN_SHARE = 0.2;
/** The whole check's ceiling. */
export const CHECK_BUDGET_MS = 600_000;

/**
 * One run's record from its employer answers. `answers` maps a posting path
 * to { vendor, state }.
 */
export function closureRecord(date, answers) {
  const list = [...answers.entries()].map(([path, r]) => ({ path, ...r }));
  const s = summarizeEmployerReads(list);
  const definite = s.open + s.closed;
  const [lo, hi] = wilson95(s.closed, definite);
  const round = (x) => Math.round(x * 10000) / 10000;
  return {
    date,
    checked: s.checked,
    open: s.open,
    closed: s.closed,
    unknown: s.unknown,
    closedShare: definite ? round(s.closed / definite) : null,
    unknownShare: s.checked ? round(s.unknown / s.checked) : null,
    wilson95: [round(lo), round(hi)],
    byVendor: s.byVendor,
    closedPaths: list.filter((r) => r.state === "closed").map((r) => r.path).sort(),
  };
}

/** Whether a record was judged: something checked, and no more than 20% unknown. */
export const judged = (rec) => !!rec && rec.checked > 0 && rec.closedShare !== null && (rec.unknownShare ?? 1) <= MAX_UNKNOWN_SHARE;
/** Whether a judged record is over the owner's line. */
export const over = (rec) => judged(rec) && rec.closedShare > STOP_SHARE;

/**
 * THE STOP RULE ON THE HISTORY. `history` is every record kept, one per UTC
 * date; `date` is today's. Fires (code 3) when today's run is over 5% and the
 * previous judged run on an earlier date was too: that pair is two
 * consecutive daily checks. A run that was not judged is skipped over rather
 * than read as under the line (it measured nothing), and today's own
 * unjudged run is code 4.
 */
export function stopRuleVerdict(history, date) {
  const recs = (Array.isArray(history) ? history : []).filter((r) => r && typeof r.date === "string").sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const today = recs.filter((r) => r.date === date).pop() ?? null;
  const previous = recs.filter((r) => r.date < date && judged(r)).pop() ?? null;
  const pct = (r) => (r && r.closedShare !== null ? `${(r.closedShare * 100).toFixed(1)}%` : "n/a");
  if (!today) return { code: 4, fired: false, today: null, previous, message: `no check recorded for ${date}` };
  if (!judged(today)) {
    return { code: 4, fired: false, today, previous, message: `${date}: not judged (${today.unknown} of ${today.checked} answers unknown, over ${MAX_UNKNOWN_SHARE * 100}%)` };
  }
  if (over(today) && over(previous)) {
    return {
      code: 3, fired: true, today, previous,
      message: `STOP RULE FIRED: ${pct(today)} closed on ${date} and ${pct(previous)} on ${previous.date}, two consecutive daily checks over ${STOP_SHARE * 100}%. Set JOB_POSTING_MARKUP to false in src/config/seo-switches.ts and publish.`,
    };
  }
  const why = over(today)
    ? `over the line today; the previous judged check (${previous ? `${previous.date}, ${pct(previous)}` : "none yet"}) was not`
    : `under the line`;
  return { code: 0, fired: false, today, previous, message: `${date}: ${pct(today)} closed (${today.closed} of ${today.open + today.closed} with a definite answer; 95% CI ${(today.wilson95[0] * 100).toFixed(1)}-${(today.wilson95[1] * 100).toFixed(1)}%), ${why}` };
}

/** The history with today's record put in (one per UTC date): a judged record for a date is kept over an unjudged one. */
export function withRecord(history, rec) {
  const rest = (Array.isArray(history) ? history : []).filter((r) => r && r.date !== rec.date);
  const prior = (Array.isArray(history) ? history : []).find((r) => r && r.date === rec.date);
  const keep = prior && judged(prior) && !judged(rec) ? prior : rec;
  return [...rest, keep].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-60);
}

/** The posting paths a sitemap names. */
export function sitemapPostingPaths(xml) {
  return [...String(xml ?? "").matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim().replace(/^https?:\/\/[^/]+/, ""))
    .filter((p) => idFromPostingPath(p));
}

/** The apply address a baked posting page links ("Apply on X's own site"), or null. */
export function applyUrlOfPage(html) {
  const m = /<a href="([^"]+)" rel="noopener noreferrer nofollow">Apply on /.exec(String(html ?? ""));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : null;
}

const arg = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

/** The whole check. Returns { code, record, verdict, history }. */
export async function runClosureCheck({ site = "https://resumebooster.work", date = new Date().toISOString().slice(0, 10), history = [], budgetMs = CHECK_BUDGET_MS, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  const get = async (url) => {
    try {
      const r = await fetchImpl(url, { headers: { "User-Agent": "resumebooster-posting-closure-check/1.0" }, signal: AbortSignal.timeout(30_000) });
      return r.status === 200 ? await r.text() : null;
    } catch { return null; }
  };
  const [xml, ledgerText] = await Promise.all([get(`${site}/sitemap.xml`), get(`${site}/prerender-ledger.json`)]);
  let ledger = null;
  try { ledger = ledgerText ? JSON.parse(ledgerText) : null; } catch { ledger = null; }
  if (!xml || !ledger || typeof ledger.postings !== "object") return { code: 2, record: null, verdict: { message: "the live sitemap or ledger could not be read" }, history };
  const paths = sitemapPostingPaths(xml).filter((p) => ledger.postings[p]?.state === "live");
  // The apply address: the ledger's, else the page's own link (one GET of our page).
  const rows = [];
  for (let i = 0; i < paths.length; i += 8) {
    const batch = paths.slice(i, i + 8);
    rows.push(...await Promise.all(batch.map(async (path) => {
      const e = ledger.postings[path] ?? {};
      const applyUrl = typeof e.applyUrl === "string" ? e.applyUrl : applyUrlOfPage(await get(`${site}${path}`));
      return { path, id: idFromPostingPath(path), applyUrl };
    })));
  }
  log(`checking ${rows.length} live posting pages at their employers`);
  const results = await readEmployers(rows, { fetchImpl, budgetMs, stated: false });
  const answers = new Map(rows.map((r) => [r.path, results.get(r.id) ?? { vendor: "?", state: "unknown", why: "unread" }]));
  const record = closureRecord(date, answers);
  const next = withRecord(history, record);
  const verdict = stopRuleVerdict(next, date);
  return { code: verdict.code, record, verdict, history: next };
}

const isMain = (() => {
  try { return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  const site = (arg(argv, "--site") ?? process.env.CLOSURE_SITE ?? "https://resumebooster.work").replace(/\/+$/, "");
  const historyFile = arg(argv, "--history");
  const outFile = arg(argv, "--out");
  const date = arg(argv, "--date") ?? new Date().toISOString().slice(0, 10);
  const budgetMs = Number(arg(argv, "--budget-ms") ?? CHECK_BUDGET_MS);
  let history = [];
  if (historyFile && existsSync(historyFile)) {
    try { history = JSON.parse(readFileSync(historyFile, "utf8")); } catch { history = []; }
  }
  // ONE RUN PER UTC DATE: a later slot the same day re-reads the verdict it
  // already has instead of measuring again, unless that run was not judged.
  const already = history.find((r) => r && r.date === date);
  let out;
  if (already && judged(already)) {
    const verdict = stopRuleVerdict(history, date);
    out = { code: verdict.code, record: already, verdict, history };
    console.log(`posting closure: ${date} was already measured today; re-reading its verdict`);
  } else {
    out = await runClosureCheck({ site, date, history, budgetMs, log: (m) => console.log(`posting closure: ${m}`) });
  }
  if (out.record) {
    const r = out.record;
    console.log(`posting closure: ${r.date} checked ${r.checked}: ${r.open} open, ${r.closed} closed, ${r.unknown} unknown; closed share ${r.closedShare === null ? "n/a" : `${(r.closedShare * 100).toFixed(1)}%`} (95% CI ${(r.wilson95[0] * 100).toFixed(1)}-${(r.wilson95[1] * 100).toFixed(1)}%), unknown ${r.unknownShare === null ? "n/a" : `${(r.unknownShare * 100).toFixed(1)}%`}`);
    for (const [v, c] of Object.entries(r.byVendor)) console.log(`posting closure:   ${v.padEnd(16)} open ${c.open}, closed ${c.closed}, unknown ${c.unknown}`);
    for (const p of r.closedPaths) console.log(`posting closure:   closed at the employer: ${p}`);
    if (argv.includes("--json")) console.log(`POSTING_CLOSURE_JSON ${JSON.stringify(r)}`);
    if (outFile) { mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, JSON.stringify(r, null, 2)); }
    if (historyFile) { mkdirSync(dirname(historyFile), { recursive: true }); writeFileSync(historyFile, JSON.stringify(out.history, null, 2)); }
  }
  console.log(`posting closure: ${out.verdict.message}`);
  process.exit(out.code);
}
