#!/usr/bin/env node
/**
 * THE PERK ROW AUDIT: DRAW, JUDGE, WRITE BACK.
 *
 * A perk key shows on company profiles only after its row audit (plan
 * 2026-10-11, D2 and D19): 60 random publishable claim rows, at least 57
 * judged right, plus the owner's spot check; then a monthly re-audit of 60
 * rows across the published keys (at least 5 each). Every publish flag
 * expires 45 days after its last audit, in the reader itself, so nothing
 * stays published because nobody ran this.
 *
 * A ROW IS RIGHT only if the quoted line says the HIRING EMPLOYER (not an
 * agency, a franchisor or a customer) offers the perk in that posting, and
 * the spot check of up to 3 other postings among its k agrees.
 *
 *   node scripts/perk-audit.mjs status
 *   node scripts/perk-audit.mjs draw --perk health [--rows 60]
 *       writes ~/.config/resumebooster/perk-audits/perk-audit-health-<date>.json:
 *       each row with its employer, quote, posting link and spot check, and
 *       empty verdicts. Judges set "judges": [{"by": "...", "correct": true|false,
 *       "note": "..."}]; the owner sets "owner": true|false on the rows they check.
 *   node scripts/perk-audit.mjs reaudit-draw [--total 60] [--per-key 5]
 *       one file across every published key, for the monthly re-audit.
 *   node scripts/perk-audit.mjs show --file <path>
 *   node scripts/perk-audit.mjs record --file <path>
 *       writes the judgement back: a launch file publishes its key at 57 of 60
 *       (with at least 10 owner-checked rows), anything less unpublishes it; a
 *       re-audit file pauses every perk when the pool is under 57 of 60, and
 *       unpublishes a key with 2 or more wrong in its stratum.
 *   node scripts/perk-audit.mjs withdraw --perk health [--note ...]
 *   node scripts/perk-audit.mjs pause --publish on|off [--sweep on|off] [--note ...]
 *
 * THE OWNER-KEY PATH. Everything goes to the employer-profiles function with
 * x-admin-key: ADMIN_API_KEY from the environment, or the file
 * ~/.config/resumebooster/admin-api-key. The key is never printed. The
 * function refuses anyone else before building a client.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = join(homedir(), ".config", "resumebooster");

/** The keys a profile may ever show (supabase/functions/_shared/perks-extract.ts CANDIDATE_KEYS). */
export const CANDIDATE_KEYS = ["health", "dental", "vision", "life_dis", "retire", "pto", "parental", "equity", "visa_not_offered"];
export const LAUNCH_ROWS = 60;
export const LAUNCH_MAX_WRONG_PER_60 = 3;
export const OWNER_CHECKS_PER_KEY = 10;
export const REAUDIT_MIN_PER_KEY = 5;
export const RULE =
  "A row is right only if the quoted line says the hiring employer (not an agency, a franchisor or a customer) offers the perk " +
  "in that posting, and the spot check of up to 3 other postings among its k agrees. Not mentioned is never not offered.";

// ── the verdict arithmetic (pure; src/test/the-perk-audit-script-counts-what-its-judges-said.test.ts) ──

/**
 * One row's verdict: the owner's word when the owner checked it; otherwise
 * right only if every judge said right (one dissent is wrong); null when
 * nobody judged it.
 */
export function rowVerdict(row) {
  if (typeof row.owner === "boolean") return row.owner;
  const judges = Array.isArray(row.judges) ? row.judges.filter((j) => typeof j?.correct === "boolean") : [];
  if (typeof row.verdict === "boolean") judges.push({ correct: row.verdict });
  if (!judges.length) return null;
  return judges.every((j) => j.correct === true);
}

/** The counts a review file supports, per key and pooled, and what is still unjudged. */
export function tally(file) {
  const byKey = {};
  const unjudged = [];
  let owner = 0;
  for (const [i, row] of (file.rows ?? []).entries()) {
    const v = rowVerdict(row);
    if (v === null) { unjudged.push(i + 1); continue; }
    const k = (byKey[row.perk] ??= { judged: 0, correct: 0, ownerChecked: 0 });
    k.judged++;
    if (v) k.correct++;
    if (typeof row.owner === "boolean") { k.ownerChecked++; owner++; }
  }
  const judged = Object.values(byKey).reduce((n, k) => n + k.judged, 0);
  const correct = Object.values(byKey).reduce((n, k) => n + k.correct, 0);
  return { byKey, judged, correct, owner, unjudged };
}

/** At most 3 wrong in 60, the same rule employer_perk_audit_record applies (wrong * 20 <= judged). */
export const passesLaunch = (judged, correct) => judged >= LAUNCH_ROWS && (judged - correct) * 20 <= judged;

/**
 * The calls a judged file turns into, in order, or the reason it cannot be
 * recorded. Nothing is sent for a file with an unjudged row.
 */
export function planRecord(file) {
  const t = tally(file);
  if (t.unjudged.length) return { error: `rows ${t.unjudged.join(", ")} carry no verdict; judge every row first` };
  const note = (k) => `${file.mode} audit drawn ${file.drawnAt ?? "?"}: ${k.correct} of ${k.judged} right, ${k.ownerChecked} owner-checked`;
  if (file.mode === "launch") {
    const keys = Object.keys(t.byKey);
    if (keys.length !== 1 || keys[0] !== file.perk) return { error: `a launch file judges one key (${file.perk}), found ${keys.join(", ") || "none"}` };
    const k = t.byKey[file.perk];
    if (k.judged < LAUNCH_ROWS) return { error: `a launch audit judges at least ${LAUNCH_ROWS} rows, this file has ${k.judged}` };
    if (passesLaunch(k.judged, k.correct) && k.ownerChecked < OWNER_CHECKS_PER_KEY) {
      return { error: `the owner has checked ${k.ownerChecked} rows; a key publishes only after at least ${OWNER_CHECKS_PER_KEY}` };
    }
    return {
      calls: [{ action: "audit_record", perk: file.perk, mode: "launch", judged: k.judged, correct: k.correct, note: note(k) }],
      publishes: passesLaunch(k.judged, k.correct),
    };
  }
  if (file.mode === "reaudit") {
    const calls = [];
    const pooledFails = t.judged >= LAUNCH_ROWS && !passesLaunch(t.judged, t.correct);
    if (pooledFails) calls.push({ action: "audit_pause", publish: true, note: `monthly re-audit pooled ${t.correct} of ${t.judged}: every perk paused pending per-key review` });
    for (const [perk, k] of Object.entries(t.byKey)) {
      if (k.judged < REAUDIT_MIN_PER_KEY) return { error: `${perk} has ${k.judged} judged rows; a re-audit stratum needs at least ${REAUDIT_MIN_PER_KEY}` };
      calls.push({ action: "audit_record", perk, mode: "reaudit", judged: k.judged, correct: k.correct, note: note(k) });
    }
    return { calls, pooled: { judged: t.judged, correct: t.correct, paused: pooledFails } };
  }
  return { error: `unknown mode ${file.mode}` };
}

/** One drawn row, shaped for a judge: everything needed to decide, nothing decided. */
export function reviewRow(r, perk) {
  return {
    perk,
    employer: r.employer ?? null,
    company_token: r.company_token,
    source: r.source,
    country: r.country,
    k: r.k,
    n: r.n,
    claim: `${perk}: stated in at least ${r.k} of ${r.n} open ${r.country} postings we could read`,
    quote: r.quote ?? null,
    posting: r.quote_title ? `${r.quote_title} -- ${r.quote_link ?? ""}` : (r.quote_link ?? null),
    postingLink: r.quote_link ?? null,
    spotCheck: (r.spot_check ?? []).map((s) => ({ title: s.title ?? null, link: s.link ?? null, quote: s.quote ?? null })),
    judges: [],
    owner: null,
    note: "",
  };
}

// ── the owner-key path ───────────────────────────────────────────────────────

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const env = join(ROOT, ".env");
  if (!existsSync(env)) return "";
  const line = readFileSync(env, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).replace(/^"|"$/g, "").trim() : "";
}

function adminKey() {
  if (process.env.ADMIN_API_KEY) return process.env.ADMIN_API_KEY.trim();
  const f = join(PRIVATE, "admin-api-key");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  throw new Error(`no ADMIN_API_KEY in the environment and no ${f}`);
}

async function ask(body) {
  const base = envValue("VITE_SUPABASE_URL") || JSON.parse(readFileSync(join(ROOT, "docs/deploy-ledger.json"), "utf8")).supabaseUrl;
  const publishable = envValue("VITE_SUPABASE_PUBLISHABLE_KEY");
  const res = await fetch(`${base}/functions/v1/employer-profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey(), ...(publishable ? { apikey: publishable } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(`employer-profiles ${body.action} -> ${res.status}: ${json.error ?? text.slice(0, 300)}`);
  return json;
}

// ── the commands ─────────────────────────────────────────────────────────────

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else out._.push(a);
  }
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);
const onOff = (v, name) => {
  if (v === undefined) return undefined;
  if (v === "on" || v === "true") return true;
  if (v === "off" || v === "false") return false;
  throw new Error(`--${name} takes on or off`);
};

function writeReview(name, doc, dir) {
  const out = resolve(dir ?? join(PRIVATE, "perk-audits"), name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  return out;
}

function show(file) {
  const t = tally(file);
  console.log(`${file.mode} audit of ${file.perk ?? "published keys"}, drawn ${file.drawnAt}: ${file.rows.length} rows`);
  console.log(RULE);
  for (const [i, r] of file.rows.entries()) {
    const v = rowVerdict(r);
    console.log(`\n#${i + 1} [${v === null ? "unjudged" : v ? "right" : "WRONG"}] ${r.employer ?? r.company_token} (${r.source}:${r.company_token}) -- ${r.claim}`);
    console.log(`   "${r.quote}"`);
    console.log(`   ${r.postingLink ?? "(no live posting)"}`);
    for (const s of r.spotCheck) console.log(`   spot: "${s.quote ?? "(no quote)"}" ${s.link ?? ""}`);
  }
  console.log(`\njudged ${t.judged}, right ${t.correct}, owner-checked ${t.owner}, unjudged ${t.unjudged.length}`);
}

async function main(argv) {
  const a = args(argv);
  const cmd = a._[0];
  if (cmd === "status") {
    const r = await ask({ action: "audit_status" });
    const d = r.data ?? {};
    console.log(`build ${r.build}, extractor v${r.extractorVersion}`);
    for (const k of d.keys ?? []) {
      if (!CANDIDATE_KEYS.includes(k.perk)) continue;
      console.log(`${k.perk.padEnd(17)} ${k.published ? "PUBLISHED" : "unpublished"}  rows ${k.rows}  audited ${k.last_audited_at ?? "never"}  expires ${k.expires_at ?? "-"}  ${k.audit_mode ?? ""} ${k.audit_correct ?? ""}/${k.audit_judged ?? ""}`);
    }
    console.log(`config ${JSON.stringify(d.config)}`);
    console.log(`queue ${JSON.stringify(d.queue)}  postings ${JSON.stringify(d.postings)}`);
    console.log(`rollup ${JSON.stringify(d.rollup)}`);
    for (const run of (d.runs ?? []).slice(0, 8)) console.log(`run ${run.kind} ${run.started_at} ok=${run.ok} ${run.note ?? ""}`);
    return;
  }
  if (cmd === "draw") {
    const perk = String(a.perk ?? "");
    if (!CANDIDATE_KEYS.includes(perk)) throw new Error(`--perk must be one of ${CANDIDATE_KEYS.join(", ")}`);
    const rows = a.rows ? Number(a.rows) : LAUNCH_ROWS;
    const r = await ask({ action: "audit_draw", perk, rows });
    const doc = { kind: "perk-row-audit", mode: "launch", perk, drawnAt: new Date().toISOString(), build: r.build, rule: RULE, rows: (r.data?.rows ?? []).map((x) => reviewRow(x, perk)) };
    const out = writeReview(`perk-audit-${perk}-${today()}.json`, doc, a.dir);
    console.log(`${doc.rows.length} rows of ${perk} -> ${out}`);
    if (doc.rows.length < LAUNCH_ROWS) console.log(`only ${doc.rows.length} publishable rows exist; a launch audit needs ${LAUNCH_ROWS} (let the sweep and rollup run longer)`);
    return;
  }
  if (cmd === "reaudit-draw") {
    const status = await ask({ action: "audit_status" });
    const live = (status.data?.keys ?? []).filter((k) => k.published && CANDIDATE_KEYS.includes(k.perk)).map((k) => k.perk);
    if (!live.length) { console.log("no key is published; nothing to re-audit"); return; }
    const total = Number(a.total ?? LAUNCH_ROWS);
    const per = Math.max(Number(a["per-key"] ?? REAUDIT_MIN_PER_KEY), Math.ceil(total / live.length));
    const rows = [];
    for (const perk of live) {
      const r = await ask({ action: "audit_draw", perk, rows: per });
      rows.push(...(r.data?.rows ?? []).map((x) => reviewRow(x, perk)));
    }
    const doc = { kind: "perk-row-audit", mode: "reaudit", perk: null, keys: live, drawnAt: new Date().toISOString(), build: status.build, rule: RULE, rows };
    const out = writeReview(`perk-reaudit-${today()}.json`, doc, a.dir);
    console.log(`${rows.length} rows across ${live.join(", ")} -> ${out}`);
    return;
  }
  if (cmd === "show") {
    show(JSON.parse(readFileSync(String(a.file), "utf8")));
    return;
  }
  if (cmd === "record") {
    const file = JSON.parse(readFileSync(String(a.file), "utf8"));
    const plan = planRecord(file);
    if (plan.error) throw new Error(plan.error);
    for (const call of plan.calls) {
      const r = await ask(call);
      console.log(`${call.action} ${call.perk ?? ""} -> ${JSON.stringify(r.data)}`);
    }
    if (file.mode === "launch") console.log(plan.publishes ? `${file.perk} is published for 45 days` : `${file.perk} stays unpublished`);
    else console.log(`pooled ${plan.pooled.correct} of ${plan.pooled.judged}${plan.pooled.paused ? ": every perk is paused" : ""}`);
    return;
  }
  if (cmd === "withdraw") {
    const r = await ask({ action: "audit_record", perk: String(a.perk ?? ""), mode: "withdraw", judged: 0, correct: 0, note: a.note ? String(a.note) : "withdrawn by the owner" });
    console.log(JSON.stringify(r.data));
    return;
  }
  if (cmd === "pause") {
    const body = { action: "audit_pause", publish: onOff(a.publish, "publish"), sweep: onOff(a.sweep, "sweep"), note: a.note ? String(a.note) : undefined };
    const r = await ask(body);
    console.log(JSON.stringify(r.data));
    return;
  }
  console.log("usage: node scripts/perk-audit.mjs status | draw --perk KEY [--rows 60] | reaudit-draw | show --file F | record --file F | withdraw --perk KEY | pause --publish on|off [--sweep on|off]");
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`perk-audit: ${e.message}`);
    process.exitCode = 1;
  });
}
