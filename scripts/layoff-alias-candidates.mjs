#!/usr/bin/env node
// AN ALIAS IS READ FROM THE TENANT'S OWN POSTINGS FIRST.
//
// The curation queue for public.layoff_employer_aliases (SPEC 2026-09-18,
// section 5 rule 3): every filer the matcher REFUSED and a person must decide
// -- single-token names that equal a board name, names two employers share,
// WARN matches that failed the state gate, SEC filers whose CIK is on no alias
// row -- printed with the candidate token(s), the vendor, the board's own
// display name and, in --live mode, THREE live posting titles and locations
// from that tenant. The owner ticks or rejects; every decision becomes a row
// with its evidence through --decisions. Modelled on batch 5 (migration
// 20260724183700: candidates generated mechanically, EVERY one corroborated
// against the tenant's own postings, rejections recorded), not on
// resolve-oracle-names.mjs.
//
// WHAT IT NEVER DOES. No trigram, Levenshtein, prefix-as-match,
// ticker-equals-token or slug title-casing decides anything here; the only
// heuristic is the near-miss GENERATOR lane 3 used to find candidates for a
// human (first token equal, at least five letters, one norm a token-prefix of
// the other), and it proposes, never accepts. alias_norm is computed by the
// SQL function layoff_norm (migration 20260918100100) running in pglite --
// never a JS port -- so what the owner ticks is what the matcher compares.
// Nothing here goes through check_rate_limit or the job-board function.
//
// MODES
//   --samples <dir>      offline: the saved lane samples (warn_matches_365d.json,
//                        warn_near_misses.json, item205_12mo.json) against the
//                        rows the mirror script emits for the catalogue
//   --live               read layoff_filings / layoff_board_names / layoff_matches /
//                        layoff_employer_aliases and three postings per candidate
//                        token through the REST API with the service key
//                        (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
//   --decisions <json>   turn the owner's ticks into INSERT rows for the next
//                        migration (stdout); refuses an accepted row whose
//                        evidence names no read, and warns when a batch has no
//                        rejection at all (the sign the eyeball was skipped)
//   --out <file>         also write the queue as JSON (the --decisions input shape)
//   --md <file>          also write the queue as a markdown tick-list
//   --limit-titles N     postings per token in --live mode (default 3)
//
// Decided pairs -- every row any migration inserted into layoff_employer_aliases,
// accepted or rejected -- are read from supabase/migrations and never proposed
// again.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { mirrorRows } from "./layoff-board-names-mirror.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const MIGRATIONS = resolve(REPO, "supabase/migrations");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };

// ── the normaliser: the SQL function, in pglite ──────────────────────────────
let normDb = null;
export async function sqlNorm() {
  if (normDb) return normDb;
  const db = new PGlite();
  const f = readdirSync(MIGRATIONS).find((x) => x.startsWith("20260918100100_"));
  if (!f) throw new Error("layoff_norm migration 20260918100100 not found");
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
  await db.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
  const cache = new Map();
  normDb = {
    norm: async (raw) => {
      if (cache.has(raw)) return cache.get(raw);
      const r = await db.query(`SELECT public.layoff_norm($1) AS n`, [raw]);
      cache.set(raw, r.rows[0].n);
      return r.rows[0].n;
    },
    close: () => db.close(),
  };
  return normDb;
}

/** The WARN-only pre-pass (SPEC 5) is the POLLER'S function, loaded from
 *  supabase/functions/layoff-filings/normalize.ts through the same tsx
 *  require the mirror script uses -- one implementation, so the alias_norm an
 *  owner ticks from a raw filer string is the filer_norm the poller stores.
 *  A second copy here once dropped parentheticals before the amendment affix
 *  and split at fewer dba forms, and "HGS CX Technologies, Inc. f/k/a HGS USA"
 *  normalised two different ways. */
let pollerPrePass = null;
export function loadPollerPrePass() {
  if (!pollerPrePass) {
    const require = createRequire(`${REPO}/package.json`);
    const { register } = require("tsx/cjs/api");
    const unregister = register();
    try {
      pollerPrePass = require(`${REPO}/supabase/functions/layoff-filings/normalize.ts`).warnPrePass;
    } finally {
      unregister();
    }
  }
  return pollerPrePass;
}
/** `impl` is the poller's function; a vitest (which cannot host tsx's loader) passes it in. */
export function warnPrePass(raw, impl = loadPollerPrePass()) {
  return impl(String(raw).replace(/&amp;/g, "&").replace(/<[^>]*>/g, " "));
}

// ── decided pairs, from every migration that inserted alias rows ─────────────
/** One row per VALUES tuple of an INSERT INTO public.layoff_employer_aliases, read
 *  from the comment-stripped SQL (a guard reads code, never prose). */
export function parseAliasRows(sql, file = "") {
  const rows = [];
  if (!/INSERT INTO public\.layoff_employer_aliases/.test(sql)) return rows;
  const code = sql.replace(/--[^\n]*/g, "");
  const re = /\(\s*(NULL|'(?:[^']|'')*')\s*,\s*(NULL|\d+)\s*,\s*'((?:[^']|'')*)'\s*,\s*'(filer|subsidiary_site)'\s*,\s*(NULL|ARRAY\[[^\]]*\](?:::char\(2\)\[\])?)\s*,\s*'(accepted|rejected)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(code))) {
    rows.push({
      norm: m[1] === "NULL" ? null : m[1].slice(1, -1).replace(/''/g, "'"),
      cik: m[2] === "NULL" ? null : Number(m[2]),
      token: m[3].replace(/''/g, "'"),
      relation: m[4],
      decision: m[6],
      evidence: m[7].replace(/''/g, "'"),
      decided_by: m[8].replace(/''/g, "'"),
      file,
    });
  }
  return rows;
}

export function decidedPairs() {
  const out = new Map(); // key -> row; plus t:<token> -> row[]
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    for (const rec of parseAliasRows(readFileSync(resolve(MIGRATIONS, f), "utf8"), f)) {
      const { norm, cik, token } = rec;
      if (norm !== null) out.set(`n:${norm}|${token}`, rec);
      if (cik !== null) out.set(`c:${cik}|${token}`, rec);
      const byToken = out.get(`t:${token}`) ?? [];
      byToken.push(rec);
      out.set(`t:${token}`, byToken);
    }
  }
  return out;
}

// ── candidate generation ─────────────────────────────────────────────────────
const isSingle = (norm) => norm && !norm.includes(" ");

/** lane 3's near-miss generator: first token equal, >= 5 letters, one a token-prefix of the other. */
function nearMissTokens(norm, boardsByFirst) {
  if (!norm) return [];
  const first = norm.split(" ")[0];
  if (first.length < 5) return [];
  const out = [];
  for (const b of boardsByFirst.get(first) ?? []) {
    if (b.norm === norm) continue;
    if (norm.startsWith(b.norm + " ") || b.norm.startsWith(norm + " ")) out.push(b);
  }
  return out;
}

function groupBoards(boards) {
  const byNorm = new Map();
  const byFirst = new Map();
  for (const b of boards) {
    if (!b.norm) continue;
    if (!byNorm.has(b.norm)) byNorm.set(b.norm, []);
    byNorm.get(b.norm).push(b);
    const first = b.norm.split(" ")[0];
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first).push(b);
  }
  return { byNorm, byFirst };
}
/** The employer key the matcher groups on (migration 20260918100400): the
 *  token's first '~' segment -- the tenant on workday and oracle, the slug
 *  elsewhere -- except under a vendor path every client shares: UKG's
 *  recruiting / recruiting2 (the client is the second segment) and the EU
 *  pods of greenhouse and lever (eu~<slug>: the whole token). Two clients
 *  under one path are two employers, and a name they share is ambiguous. */
export const employerOf = (token) => {
  const seg = String(token).split("~");
  if (seg[0] === "recruiting" || seg[0] === "recruiting2") return `${seg[0]}~${seg[1] ?? ""}`;
  if (seg[0] === "eu") return String(token);
  return seg[0];
};

/**
 * @param filings [{filing_id, source, filer_raw, filer_for_norm, filer_norm, cik, state, event_date, workers, matched:boolean}]
 * @param boards  [{vendor, company_token, display_name, norm}]
 */
export function buildQueue(filings, boards, decided, { gateKnown = true } = {}) {
  const { byNorm, byFirst } = groupBoards(boards);
  let exactPendingGate = 0;
  const cands = new Map(); // key employer-group -> candidate
  const push = (key, patch) => {
    const c = cands.get(key) ?? { key, filers: new Map(), pairs: new Map(), classes: new Set(), states: new Set(), notices: 0, workers: 0, latest: "", ciks: new Set() };
    Object.assign(c, patch?.(c) ?? {});
    cands.set(key, c);
    return c;
  };
  const addFiling = (c, f) => {
    const k = f.filer_norm;
    const e = c.filers.get(k) ?? { norm: k, raws: new Set(), sources: new Set() };
    e.raws.add(f.filer_raw); e.sources.add(f.source);
    c.filers.set(k, e);
    c.notices++; c.workers += Number(f.workers ?? 0) || 0;
    if (f.state) c.states.add(f.state);
    if (f.cik) c.ciks.add(f.cik);
    if (f.event_date > c.latest) c.latest = f.event_date;
  };
  const addPair = (c, f, b, cls, note) => {
    const keyed = f.source === "sec_8k_205" ? { cik: f.cik, norm: null } : { cik: null, norm: f.filer_norm };
    const dk = keyed.norm !== null ? `n:${keyed.norm}|${b.company_token}` : `c:${keyed.cik}|${b.company_token}`;
    // decided under this key, or under the other key for the same employer (a
    // cik-keyed rejection covers the WARN spelling of the same filer and back)
    const prior = decided.get(dk)
      ?? (decided.get(`t:${b.company_token}`) ?? []).find((r) => (r.norm !== null && r.norm === f.filer_norm) || (r.cik !== null && (r.cik === f.cik || c.ciks.has(r.cik))));
    const pk = `${keyed.norm ?? ""}|${keyed.cik ?? ""}|${b.company_token}`;
    const p = c.pairs.get(pk) ?? { alias_norm: keyed.norm, cik: keyed.cik, company_token: b.company_token, vendor: b.vendor, display_name: b.display_name, classes: new Set(), notes: new Set(), decided: prior ? prior.decision : null, decided_in: prior ? prior.file : null };
    p.classes.add(cls);
    if (note) p.notes.add(note);
    c.pairs.set(pk, p);
    c.classes.add(cls);
  };
  for (const f of filings) {
    if (f.matched) continue;
    const norm = f.filer_norm;
    if (!norm) continue;
    const exact = byNorm.get(norm) ?? [];
    const employers = new Set(exact.map((b) => employerOf(b.company_token)));
    if (exact.length && isSingle(norm)) {
      const c = push(`single:${norm}`); addFiling(c, f);
      for (const b of exact) addPair(c, f, b, "single_token_exact", null);
      continue;
    }
    if (exact.length && employers.size >= 2) {
      const c = push(`ambiguous:${norm}`); addFiling(c, f);
      for (const b of exact) addPair(c, f, b, "ambiguous_norm", `${employers.size} employers share this name`);
      continue;
    }
    if (exact.length && employers.size === 1 && f.source === "state_warn") {
      if (!gateKnown) { exactPendingGate++; continue; }   // rule 2 takes it once a live posting in the state exists
      const c = push(`gate:${norm}`); addFiling(c, f);
      for (const b of exact) addPair(c, f, b, "state_gate_failed", `no live posting in ${f.state}`);
      continue;
    }
    const near = nearMissTokens(norm, byFirst);
    if (near.length) {
      const c = push(`near:${norm.split(" ")[0]}`); addFiling(c, f);
      for (const b of near) addPair(c, f, b, "near_miss_prefix", `board norm "${b.norm}"`);
    }
  }
  // drop candidates whose every pair is already decided
  const queue = [];
  for (const c of cands.values()) {
    const open = [...c.pairs.values()].filter((p) => !p.decided);
    if (!open.length) continue;
    queue.push({
      key: c.key,
      classes: [...c.classes],
      filers: [...c.filers.values()].map((e) => ({ norm: e.norm, raw: [...e.raws], sources: [...e.sources] })),
      notices: c.notices, workers: c.workers, states: [...c.states].sort(), latest: c.latest, ciks: [...c.ciks],
      pairs: [...c.pairs.values()].map((p) => ({ ...p, classes: [...p.classes], notes: [...p.notes] })),
    });
  }
  const rank = { single_token_exact: 0, ambiguous_norm: 1, state_gate_failed: 2, near_miss_prefix: 3 };
  queue.sort((a, b) => Math.min(...a.classes.map((x) => rank[x])) - Math.min(...b.classes.map((x) => rank[x])) || b.notices - a.notices || a.key.localeCompare(b.key));
  queue.exactPendingGate = exactPendingGate;
  return queue;
}

// ── offline: the saved lane samples ─────────────────────────────────────────
async function loadSamples(dir, { norm }) {
  const J = (f) => JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  // the boards are the same rows the deploy mirrors: the catalogue through
  // catalog.ts plus the facet-name rows, normalised by the SQL function
  const boards = [];
  for (const r of mirrorRows().rows) boards.push({ vendor: r.vendor, company_token: r.company_token, display_name: r.display_name, norm: await norm(r.display_name) });
  const filings = [];
  const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - 365);
  const since = cutoff.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const seenWarn = new Set();
  const warnRow = async (company, state, date, jobs) => {
    const pre = warnPrePass(company);
    const key = `${state}|${pre}|${date}`;
    if (seenWarn.has(key)) return;
    seenWarn.add(key);
    filings.push({ filing_id: `warn:${key}`, source: "state_warn", filer_raw: company, filer_for_norm: pre, filer_norm: await norm(pre), cik: null, state, event_date: date, workers: jobs, matched: false });
  };
  for (const r of J("warn_matches_365d.json")) {
    if (r.is_superseded === "True" || r.is_amendment === "True") continue;
    if (!r.notice_date || r.notice_date < since || r.notice_date > today) continue;
    await warnRow(r.company, r.postal_code, r.notice_date, Number(r.jobs) || null);
  }
  for (const [company, state, date] of J("warn_near_misses.json")) {
    if (!date || date < since || date > today) continue;
    await warnRow(company, state, date, null);
  }
  const twelve = J("item205_12mo.json");
  for (const [adsh, h] of Object.entries(twelve)) {
    if (h.form !== "8-K" || !(h.items ?? []).includes("2.05")) continue;
    const name = String(h.display_names?.[0] ?? "").replace(/\s+\([^)]*\)\s*\(CIK[^)]*\)\s*$/, "").replace(/\s+\(CIK[^)]*\)\s*$/, "").trim();
    const cik = Number(h.ciks?.[0]);
    filings.push({ filing_id: `sec:${adsh}`, source: "sec_8k_205", filer_raw: name, filer_for_norm: name, filer_norm: await norm(name), cik, state: null, event_date: h.period_ending, workers: null, matched: false });
  }
  return { filings, boards };
}

// ── live: the database through the REST API with the service key ────────────
async function rest(path, { select, filters = [], range } = {}) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("--live needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const qs = new URLSearchParams();
  if (select) qs.set("select", select);
  for (const [k, v] of filters) qs.append(k, v);
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  if (range) headers.range = range;
  const res = await fetch(`${url}/rest/v1/${path}?${qs}`, { headers });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function restAll(path, o) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(path, { ...o, range: `${from}-${from + 999}` });
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}
async function loadLive({ norm }) {
  const boardsRaw = await restAll("layoff_board_names", { select: "vendor,company_token,display_name,display_norm" });
  const boards = boardsRaw.map((b) => ({ vendor: b.vendor, company_token: b.company_token, display_name: b.display_name, norm: b.display_norm }));
  const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - 365);
  const filingsRaw = await restAll("layoff_filings", { select: "filing_id,source,filer_raw,filer_norm,cik,state,event_date,workers,status", filters: [["event_date", `gte.${cutoff.toISOString().slice(0, 10)}`], ["status", "eq.active"]] });
  const matched = new Set((await restAll("layoff_matches", { select: "filing_id" })).map((m) => m.filing_id));
  const filings = filingsRaw.map((f) => ({ ...f, filer_for_norm: null, matched: matched.has(f.filing_id) }));
  void norm;
  return { filings, boards };
}
async function liveTitles(token, n) {
  const rows = await rest("job_board_postings", {
    select: "title,location,posted_at",
    filters: [["company_token", `eq.${token}`], ["missing_since", "is.null"], ["order", "posted_at.desc.nullslast"], ["limit", String(n)]],
  });
  return rows.map((r) => `${r.title}${r.location ? ` — ${r.location}` : ""}`);
}

// ── output ───────────────────────────────────────────────────────────────────
function toMarkdown(queue, { live }) {
  const lines = [];
  lines.push(`# Layoff alias candidates — ${queue.length} employers to tick`, "");
  lines.push("Tick a pair to accept it, cross it to reject it; every decision becomes a row (accepted or rejected) with the evidence you read. Expect roughly 30% rejected; a batch with none is the sign the eyeball was skipped.", "");
  for (const c of queue) {
    const src = [...new Set(c.filers.flatMap((f) => f.sources))].join("+");
    lines.push(`## ${c.filers.map((f) => f.raw[0]).slice(0, 3).join(" / ")}${c.filers.length > 3 ? ` (+${c.filers.length - 3} spellings)` : ""}`);
    lines.push(`${src} · notices ${c.notices}${c.workers ? ` · workers ${c.workers}` : ""}${c.states.length ? ` · states ${c.states.join(",")}` : ""} · latest ${c.latest}${c.ciks.length ? ` · cik ${c.ciks.join(",")}` : ""} · class ${c.classes.join(",")}`);
    for (const f of c.filers) lines.push(`- filer_norm \`${f.norm}\` ← ${f.raw.slice(0, 4).map((r) => JSON.stringify(r)).join(", ")}${f.raw.length > 4 ? ` (+${f.raw.length - 4})` : ""}`);
    for (const p of c.pairs) {
      if (p.decided) { lines.push(`- (decided ${p.decided} in ${p.decided_in}) → \`${p.company_token}\``); continue; }
      const key = p.alias_norm !== null ? `alias_norm \`${p.alias_norm}\`` : `cik ${p.cik}`;
      lines.push(`- [ ] ${key} → \`${p.company_token}\` (${p.vendor}, board name ${JSON.stringify(p.display_name)}) relation filer${p.notes.length ? ` — ${p.notes.join("; ")}` : ""}`);
      if (p.titles) for (const t of p.titles) lines.push(`      · ${t}`);
      else if (!live) lines.push("      · titles: run with --live to read three from this tenant");
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ── decisions → migration rows ───────────────────────────────────────────────
const EVIDENCE_OK = /^(titles:|tenant path:|company_financials 20260722234500|migration \d{14})/;
export async function decisionsToSql(decisions, { norm }) {
  const q = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
  const rows = [];
  let accepted = 0, rejected = 0;
  const problems = [];
  for (const d of decisions) {
    const decision = d.decision;
    if (!["accepted", "rejected"].includes(decision)) { problems.push(`${d.company_token}: decision must be accepted or rejected`); continue; }
    if (!d.company_token) { problems.push("a decision without company_token"); continue; }
    const evidence = String(d.evidence ?? "").trim();
    if (decision === "accepted" && !EVIDENCE_OK.test(evidence)) {
      problems.push(`${d.company_token}: an accepted row's evidence must start with "titles:", "tenant path:", "company_financials 20260722234500" or "migration <stamp>" (got ${JSON.stringify(evidence.slice(0, 60))})`);
      continue;
    }
    if (evidence.length < 12) { problems.push(`${d.company_token}: evidence too short`); continue; }
    const aliasNorm = d.filer ? await norm(warnPrePass(d.filer)) : d.alias_norm ?? null;
    const cik = d.cik ? Number(d.cik) : null;
    if (aliasNorm === null && cik === null) { problems.push(`${d.company_token}: give a filer string (WARN) or a cik (SEC)`); continue; }
    const scope = Array.isArray(d.state_scope) && d.state_scope.length ? `ARRAY[${d.state_scope.map(q).join(", ")}]::char(2)[]` : "NULL";
    rows.push(`  (${q(aliasNorm)}, ${cik ?? "NULL"}, ${q(d.company_token)}, ${q(d.relation ?? "filer")}, ${scope}, ${q(decision)}, ${q(evidence)}, ${q(d.decided_by ?? "owner")})`);
    if (decision === "accepted") accepted++; else rejected++;
  }
  if (problems.length) throw new Error(`refusing to emit:\n  ${problems.join("\n  ")}`);
  const warn = rejected === 0 ? "-- WARNING: this batch rejects nothing; a batch with 0 rejections is the sign the eyeball was skipped.\n" : "";
  const sql = `${warn}-- accepted ${accepted}, rejected ${rejected} (${accepted + rejected ? Math.round((100 * rejected) / (accepted + rejected)) : 0}% rejected)\nINSERT INTO public.layoff_employer_aliases (alias_norm, cik, company_token, relation, state_scope, decision, evidence, decided_by)\nVALUES\n${rows.join(",\n")}\nON CONFLICT (COALESCE(alias_norm, ''), COALESCE(cik, 0::bigint), company_token) DO NOTHING;\n`;
  return { sql, accepted, rejected, warned: rejected === 0 };
}

// ── main ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { norm, close } = await sqlNorm();
  try {
    if (opt("--decisions", null)) {
      const decisions = JSON.parse(readFileSync(opt("--decisions"), "utf8"));
      const { sql, accepted, rejected, warned } = await decisionsToSql(decisions, { norm });
      process.stdout.write(sql);
      console.error(`[layoff-alias-candidates] decisions accepted=${accepted} rejected=${rejected}${warned ? " WARNING=no-rejections" : ""}`);
    } else {
      const live = flag("--live");
      const decided = decidedPairs();
      const { filings, boards } = live ? await loadLive({ norm }) : await loadSamples(opt("--samples", resolve(HERE, "data/layoffs")), { norm });
      const queue = buildQueue(filings, boards, decided, { gateKnown: live });
      if (live) {
        const n = Number(opt("--limit-titles", "3"));
        for (const c of queue) for (const p of c.pairs) if (!p.decided) p.titles = await liveTitles(p.company_token, n);
      }
      const byClass = {};
      for (const c of queue) for (const k of c.classes) byClass[k] = (byClass[k] ?? 0) + 1;
      const pairs = queue.reduce((n, c) => n + c.pairs.filter((p) => !p.decided).length, 0);
      console.error(`[layoff-alias-candidates] mode=${live ? "live" : "samples"} filings=${filings.length} boards=${boards.length} decided_pairs=${[...decided.keys()].filter((k) => !k.startsWith("t:")).length} queue_employers=${queue.length} open_pairs=${pairs} ${Object.entries(byClass).map(([k, v]) => `${k}=${v}`).join(" ")}${live ? "" : ` exact_multitoken_pending_state_gate=${queue.exactPendingGate} (rule 2 takes these live; no tick)`}`);
      if (opt("--out", null)) writeFileSync(opt("--out"), JSON.stringify(queue, null, 1));
      const md = toMarkdown(queue, { live });
      if (opt("--md", null)) writeFileSync(opt("--md"), md); else process.stdout.write(md);
    }
  } finally {
    await close();
  }
}
