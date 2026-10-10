#!/usr/bin/env node
// THE DEPLOY LEDGER: what production is missing, computed, never typed.
//
// Every deploy mistake of October 2026 was a hand-written list: a migration no
// message named (20261001090000 sat unapplied for a week), a superseded file
// that must never apply (20260928003117), functions changed without a build
// bump (generate-resume-roast, send-scan-report), a message naming builds the
// branch no longer carried. This script reads the repo and production and
// prints the gap, plus the Lovable message that closes it.
//
//   node scripts/deploy-ledger.mjs            # report for HEAD
//   node scripts/deploy-ledger.mjs --message  # also print the Lovable message
//   node scripts/deploy-ledger.mjs --json     # machine-readable
//
// Read-only: OPTIONS preflights (no function logic runs) and git/file reads.
// Policy (never-apply, hold-until-verified, reservations) lives in
// docs/deploy-ledger.json; the rules are in docs/DEPLOY-LEDGER.md.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, never URL.pathname: the repo path has spaces (%20 breaks fs).
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FN_DIR = join(ROOT, "supabase/functions");
const MIG_DIR = join(ROOT, "supabase/migrations");
const DRIZZLE_DIR = join(ROOT, "drizzle/migrations");
const POLICY = JSON.parse(readFileSync(join(ROOT, "docs/deploy-ledger.json"), "utf8"));
const BASE = POLICY.supabaseUrl;
const args = new Set(process.argv.slice(2));
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();

// ── functions ───────────────────────────────────────────────────────────────
/** The build string a function's preflight should answer, read from its source. */
export function buildOf(fn, src) {
  const esc = fn.replace(/[-]/g, "\\-");
  const lit = new RegExp(`["'\`](${esc}\\.\\d{4}-\\d{2}-\\d{2}\\.[A-Za-z0-9-]+)["'\`]`).exec(src);
  if (lit) return lit[1];
  const tpl = /\$\{FN_NAME\}\.(\d{4}-\d{2}-\d{2}\.[A-Za-z0-9-]+)/.exec(src);
  const name = /const FN_NAME\s*=\s*["']([^"']+)["']/.exec(src);
  if (tpl && name && name[1] === fn) return `${fn}.${tpl[1]}`;
  const bv = /const BUILD_VERSION\s*=\s*["'](\d{4}-\d{2}-\d{2}\.[A-Za-z0-9-]+)["']/.exec(src);
  if (bv) return `${fn}.${bv[1]}`;
  return null;
}

/** a >= b for builds "fn.YYYY-MM-DD.N" (numeric N), else equality. */
export function buildAtLeast(a, b) {
  if (!a || !b) return false;
  const pa = /\.(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9-]+)$/.exec(a), pb = /\.(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9-]+)$/.exec(b);
  if (!pa || !pb || a.slice(0, a.length - pa[0].length) !== b.slice(0, b.length - pb[0].length)) return a === b;
  if (pa[1] !== pb[1]) return pa[1] > pb[1];
  return /^\d+$/.test(pa[2]) && /^\d+$/.test(pb[2]) ? Number(pa[2]) >= Number(pb[2]) : pa[2] === pb[2];
}

function sharedImports(fn) {
  const dir = join(FN_DIR, fn);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const out = new Set();
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/from\s+["']\.\.\/_shared\/([^"']+)["']/g)) out.add(`supabase/functions/_shared/${m[1]}`);
  }
  return [...out];
}

function changedSinceStamp(fn, build) {
  // The commit that introduced the current build string; anything in the
  // function's own folder or its _shared imports changed after it is code the
  // stamp does not prove deployed.
  let c = "";
  try { c = git("log", "-1", "--format=%H", `-S${build.slice(fn.length + 1)}`, "--", `supabase/functions/${fn}/index.ts`); } catch { /* none */ }
  if (!c) return { since: null, changed: [] };
  const paths = [`supabase/functions/${fn}`, ...sharedImports(fn)];
  let changed = [];
  try { changed = git("diff", "--name-only", `${c}..HEAD`, "--", ...paths).split("\n").filter(Boolean); } catch { /* none */ }
  return { since: c.slice(0, 8), changed };
}

async function live(fn) {
  try {
    const r = await fetch(`${BASE}/functions/v1/${fn}`, { method: "OPTIONS", signal: AbortSignal.timeout(20_000) });
    return r.headers.get("x-fn-build");
  } catch { return undefined; }
}

async function pool(items, n, f) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

// ── migrations ──────────────────────────────────────────────────────────────
function migrations() {
  const repo = readdirSync(MIG_DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const lovableAuthored = (f) => /^\d{14}_[0-9a-f]{8}-[0-9a-f]{4}-/.test(f);
  const applied = new Set();
  const byTitle = new Map(repo.map((f) => [f.replace(/^\d{14}_/, ""), f]));
  for (const d of readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql"))) {
    const src = readFileSync(join(DRIZZLE_DIR, d), "utf8");
    const staged = /_mig_stage WHERE name = '([^']+)'/.exec(src);
    if (staged) { applied.add(staged[1]); continue; }
    const stamped = /^\d{4}_(\d{14}_.+\.sql)$/.exec(d);
    if (stamped && repo.includes(stamped[1])) { applied.add(stamped[1]); continue; }
    const title = d.replace(/^\d{4}_/, "");
    if (byTitle.has(title)) applied.add(byTitle.get(title));
  }
  const baseline = POLICY.drizzleBaseline;
  const pending = repo.filter((f) => f >= baseline && !lovableAuthored(f) && !applied.has(f)
    && !POLICY.neverApply.some((n) => f.startsWith(n)) && !POLICY.appliedOutsideDrizzle.some((n) => f.startsWith(n)));
  const hold = pending.filter((f) => POLICY.holdUntilVerified.some((h) => f.startsWith(h.stamp)));
  return { pending: pending.filter((f) => !hold.includes(f)), hold, neverApplyPresent: repo.filter((f) => POLICY.neverApply.some((n) => f.startsWith(n))) };
}

// ── report ──────────────────────────────────────────────────────────────────
const head = git("rev-parse", "--short", "HEAD");
const fns = readdirSync(FN_DIR).filter((d) => d !== "_shared" && existsSync(join(FN_DIR, d, "index.ts"))).sort();
const rows = await pool(fns, 8, async (fn) => {
  const src = readFileSync(join(FN_DIR, fn, "index.ts"), "utf8");
  const want = buildOf(fn, src);
  const have = await live(fn);
  const drift = want ? changedSinceStamp(fn, want) : { since: null, changed: [] };
  const state = !want ? "no-marker" : have === undefined ? "unreachable" : !have ? "deploy (no live header)"
    : buildAtLeast(have, want) ? (have === want ? "live" : "live-ahead") : "deploy";
  return { fn, want, have: have ?? null, state, changedSinceStamp: drift.changed, stampCommit: drift.since };
});
const mig = migrations();
const toDeploy = rows.filter((r) => r.state.startsWith("deploy"));
// Changed-since-stamp matters only when that stamp is ALREADY LIVE: a build
// not yet deployed ships whatever the branch holds. Own-folder changes after a
// live stamp cannot be told apart from what is deployed (MUST bump); changes
// only in a _shared import may be harmless (an added export) — CHECK.
const liveStamped = rows.filter((r) => (r.state === "live" || r.state === "live-ahead") && r.changedSinceStamp.length > 0);
const unbumped = liveStamped.filter((r) => r.changedSinceStamp.some((p) => p.startsWith(`supabase/functions/${r.fn}/`)));
const sharedOnly = liveStamped.filter((r) => !unbumped.includes(r));
const noMarker = rows.filter((r) => r.state === "no-marker");

if (args.has("--json")) {
  console.log(JSON.stringify({ head, toDeploy, unbumped, sharedOnly, noMarker, migrations: mig, rows }, null, 2));
  process.exit(0);
}
console.log(`DEPLOY LEDGER at ${head} (${new Date().toISOString()})\n`);
console.log(`Functions: ${rows.length} (${rows.filter((r) => r.state === "live").length} live at the repo build, ${toDeploy.length} to deploy, ${noMarker.length} without a build marker)`);
for (const r of toDeploy) console.log(`  DEPLOY  ${r.fn.padEnd(32)} live ${r.have ?? "-"}  ->  ${r.want}`);
if (unbumped.length) {
  console.log(`\nMUST BUMP: the live stamp predates code in the function's own folder (a deploy could not be told apart from what is live):`);
  for (const r of unbumped) console.log(`  ${r.fn.padEnd(32)} live+repo ${r.want} (${r.stampCommit}) ; changed: ${r.changedSinceStamp.slice(0, 4).join(", ")}${r.changedSinceStamp.length > 4 ? " ..." : ""}`);
}
if (sharedOnly.length) {
  console.log(`\nCHECK: only a _shared import changed after the live stamp (bump if the change reaches this function's behaviour):`);
  for (const r of sharedOnly) console.log(`  ${r.fn.padEnd(32)} ${r.changedSinceStamp.map((p) => p.replace("supabase/functions/_shared/", "")).join(", ")}`);
}
if (noMarker.length) console.log(`\nNo build marker (a deploy of these cannot be verified): ${noMarker.map((r) => r.fn).join(", ")}`);
console.log(`\nMigrations pending (in apply order): ${mig.pending.length}`);
for (const f of mig.pending) console.log(`  ${f}`);
if (mig.hold.length) { console.log(`Held until the step before is verified live:`); for (const f of mig.hold) console.log(`  HOLD  ${f}`); }
if (mig.neverApplyPresent.length) console.log(`NEVER apply (superseded): ${mig.neverApplyPresent.join(", ")}`);

if (args.has("--message")) {
  console.log(`\n──────── Lovable message ────────\n`);
  console.log(`Pull GitHub main at commit **${head}** (or later ONLY if the deploy ledger is re-run on it).\n`);
  if (mig.pending.length) {
    console.log(`1. Apply these ${mig.pending.length} migrations, in this order, one at a time (each is self-verifying and safe to re-run):`);
    mig.pending.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
    if (mig.hold.length) console.log(`   Do NOT apply yet: ${mig.hold.join(", ")}.`);
    if (mig.neverApplyPresent.length) console.log(`   NEVER apply: ${mig.neverApplyPresent.join(", ")} (superseded).`);
  }
  if (toDeploy.length) {
    console.log(`2. Deploy these ${toDeploy.length} edge functions. An OPTIONS request to each must answer this x-fn-build:`);
    for (const r of toDeploy) console.log(`   - ${r.fn}: ${r.want}`);
  }
  console.log(`3. Publish the frontend.`);
}
if (unbumped.length) process.exitCode = 2;
