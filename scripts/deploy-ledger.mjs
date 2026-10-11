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
//   node scripts/deploy-ledger.mjs --against <git-ref> [--against <git-ref> ...] [--main <git-ref>] [--head <git-ref>]
//                                             # integration check, no network (exit 3 on a violation)
//
// Read-only: OPTIONS preflights (no function logic runs) and git/file reads;
// --against makes no network call at all. Policy (never-apply,
// hold-until-verified, reservations) lives in docs/deploy-ledger.json; the
// rules are in docs/DEPLOY-LEDGER.md. Exit 2: MUST BUMP. Exit 3: --against
// found a function whose code moved without a later build.
//
// Importing this module runs nothing: the report runs only when the file is
// the entry point, so the pure rules below are testable without git or a
// network (src/test/an-integration-reused-a-build-string-on-different-code.test.ts).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, never URL.pathname: the repo path has spaces (%20 breaks fs).
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FN_DIR = join(ROOT, "supabase/functions");
const MIG_DIR = join(ROOT, "supabase/migrations");
const DRIZZLE_DIR = join(ROOT, "drizzle/migrations");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).trim();

// ── functions ───────────────────────────────────────────────────────────────
/** The build string a function's preflight should answer, read from its source. */
export function buildOf(fn, src) {
  if (!src) return null;
  const esc = fn.replace(/[-]/g, "\\-");
  const lit = new RegExp(`["'\`](${esc}\\.\\d{4}-\\d{2}-\\d{2}\\.[A-Za-z0-9-]+)["'\`]`).exec(src);
  if (lit) return readable(lit[1]);
  const tpl = /\$\{FN_NAME\}\.(\d{4}-\d{2}-\d{2}\.[A-Za-z0-9-]+)/.exec(src);
  const name = /const FN_NAME\s*=\s*["']([^"']+)["']/.exec(src);
  if (tpl && name && name[1] === fn) return readable(`${fn}.${tpl[1]}`);
  const bv = /const BUILD_VERSION\s*=\s*["'](\d{4}-\d{2}-\d{2}\.[A-Za-z0-9-]+)["']/.exec(src);
  if (bv) return readable(`${fn}.${bv[1]}`);
  return null;
}

/**
 * A build the ledger can order: "fn.YYYY-MM-DD.N" where N is a plain number
 * with no leading zero. "fn.2026-10-09.04" names the same position as ".4"
 * under a numeric comparison, so it would pass as a new build on moved code
 * (and read live-ahead in the live report, never deployed): it is unreadable.
 */
const BUILD_TAIL = /\.(\d{4}-\d{2}-\d{2})\.(0|[1-9]\d*)$/;
export function readableBuild(b) {
  return typeof b === "string" && BUILD_TAIL.test(b);
}
const readable = (b) => (readableBuild(b) ? b : null);

/** a >= b for readable builds of one function (date first, then the numeric N); false for anything else. */
export function buildAtLeast(a, b) {
  if (!a || !b) return false;
  const pa = BUILD_TAIL.exec(a), pb = BUILD_TAIL.exec(b);
  if (!pa || !pb) return false;
  if (a.slice(0, a.length - pa[0].length) !== b.slice(0, b.length - pb[0].length)) return false;
  if (pa[1] !== pb[1]) return pa[1] > pb[1];
  return Number(pa[2]) >= Number(pb[2]);
}

/**
 * True when a diff of `fn`'s index.ts only RELABELS the build: every changed
 * line carries the function's own marker (the literal "fn.YYYY-MM-DD.N", the
 * `${FN_NAME}.YYYY-MM-DD.N` template, or the value of `const BUILD_VERSION =`),
 * and with that marker masked the removed lines and the added lines are the
 * same lines. Such a difference moves no behaviour, so the --against rule does
 * not ask it for a later build (an integration may give a function a stamp
 * that sorts below a branch's when a guard forbids the branch's date, as the
 * pass checkout's does). A line that changes anything besides the marker
 * (code beside the declaration, a comment turned into code) is moved code.
 */
export function onlyMarkerLines(fn, diffLines) {
  const esc = fn.replace(/[-]/g, "\\-");
  const SEQ = "\\d{4}-\\d{2}-\\d{2}\\.[A-Za-z0-9-]+";
  const masks = [
    [new RegExp(`(?<![A-Za-z0-9_-])${esc}\\.${SEQ}`, "g"), "<BUILD>"],
    [new RegExp(`\\$\\{FN_NAME\\}\\.${SEQ}`, "g"), "<BUILD>"],
    [new RegExp(`(const\\s+BUILD_VERSION\\s*=\\s*["'\`])${SEQ}`, "g"), "$1<BUILD>"],
  ];
  const changed = diffLines.filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+) /.test(l));
  if (!changed.length) return false;
  const side = { "-": [], "+": [] };
  for (const l of changed) {
    let body = l.slice(1);
    let hit = false;
    for (const [re, to] of masks) body = body.replace(re, (...m) => { hit = true; return to.replace("$1", m[1]); });
    if (!hit) return false;
    side[l[0]].push(body);
  }
  const removed = side["-"].sort(), added = side["+"].sort();
  return removed.length === added.length && removed.every((x, i) => x === added[i]);
}

/**
 * THE --against RULE (docs/DEPLOY-LEDGER.md §2). For every function whose code
 * differs between a ref and HEAD (`changed`), HEAD's build must sort at or
 * after the ref's (buildAtLeast) AND be a different string: the same string on
 * different code is the October collision class (three branches shipped
 * send-search-digest.2026-10-09.1 on three different bundles). `allowEqual`
 * names strings a ref may share with HEAD: at most the one job-board version
 * reserved to the workstream both the ref and HEAD belong to, while main does
 * not carry it (sharedReservation). Pure: no git, no network.
 *
 *   entries: [{ fn, ref: build|null, head: build|null, changed: boolean }]
 *   returns: [{ fn, ref, head, reason }]
 */
export function againstViolations(entries, { allowEqual = new Set() } = {}) {
  const out = [];
  for (const e of entries) {
    if (!e.changed) continue;
    if (!readableBuild(e.head)) { out.push({ ...pick(e), reason: "its code changed and it carries no build the ledger can read" }); continue; }
    if (!e.ref) continue; // a new function, or a marker added: nothing earlier to sort after
    if (e.head === e.ref) {
      if (!allowEqual.has(e.head)) out.push({ ...pick(e), reason: "same build string on different code" });
      continue;
    }
    if (!buildAtLeast(e.head, e.ref)) out.push({ ...pick(e), reason: "HEAD's build sorts before the ref's" });
  }
  return out;
}
const pick = (e) => ({ fn: e.fn, ref: e.ref ?? null, head: e.head ?? null });

/** Job-board versions reserved to any workstream (docs/deploy-ledger.json reservations), as full build strings. */
export function reservedJobBoardBuilds(policy) {
  return new Set(Object.values(policy?.reservations ?? {})
    .map((r) => r?.jobBoard)
    .filter((v) => typeof v === "string" && readableBuild(`job-board.${v}`))
    .map((v) => `job-board.${v}`));
}

/**
 * The workstream a branch belongs to: the reservation whose `branches` list
 * names it (an entry ending in "/" is a prefix, any other an exact name), with
 * any "origin/" or "refs/heads/" in front of the name ignored. null for a
 * commit id or a branch no reservation names.
 */
export function workstreamOf(policy, refName) {
  const name = String(refName ?? "").replace(/^refs\/(heads|remotes)\//, "").replace(/^origin\//, "");
  if (!name) return null;
  for (const [ws, r] of Object.entries(policy?.reservations ?? {})) {
    for (const b of Array.isArray(r?.branches) ? r.branches : []) {
      if (typeof b === "string" && b && (b.endsWith("/") ? name.startsWith(b) && name.length > b.length : name === b)) return ws;
    }
  }
  return null;
}

/**
 * THE ONE STRING A REF MAY SHARE WITH HEAD (docs/DEPLOY-LEDGER.md §2): the
 * job-board version reserved to the workstream that owns the ref, and only
 * when HEAD belongs to that same workstream and main does not already carry
 * that version or a later one. Another workstream's reservation, a version
 * main has deployed (wave 2's .91), or a ref no reservation names shares
 * nothing. Pure: `head` and `mainJobBoard` are passed in.
 *
 *   returns: a Set holding zero or one full build string
 */
export function sharedReservation(policy, { ref, head, mainJobBoard = null }) {
  const ws = workstreamOf(policy, ref);
  if (!ws || workstreamOf(policy, head) !== ws) return new Set();
  const v = policy.reservations[ws]?.jobBoard;
  const build = typeof v === "string" ? `job-board.${v}` : null;
  if (!readableBuild(build)) return new Set();
  if (mainJobBoard && buildAtLeast(mainJobBoard, build)) return new Set();
  return new Set([build]);
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

function changedSinceStamp(fn, build, policy) {
  // The commit that introduced the current build string; anything in the
  // function's own folder or its _shared imports changed after it is code the
  // stamp does not prove deployed.
  let c = "";
  try { c = git("log", "-1", "--format=%H", `-S${build.slice(fn.length + 1)}`, "--", `supabase/functions/${fn}/index.ts`); } catch { /* none */ }
  if (!c) return { since: null, changed: [] };
  // A verified deploy that shipped this very build from a later commit proves
  // everything up to that commit is live: Lovable deploys the function as main
  // holds it, not as it was when the stamp was written. Only changes after the
  // newest such deploy are unproven (docs/deploy-ledger.json verifiedDeploys).
  for (const d of [...(policy?.verifiedDeploys ?? [])].reverse()) {
    if (d.functions?.[fn] !== build) continue;
    if (isAncestor(c, d.commit)) c = git("rev-parse", d.commit);
    break;
  }
  const paths = [`supabase/functions/${fn}`, ...sharedImports(fn)];
  let changed = [];
  try { changed = git("diff", "--name-only", `${c}..HEAD`, "--", ...paths).split("\n").filter(Boolean); } catch { /* none */ }
  return { since: c.slice(0, 8), changed };
}

/**
 * A stamp in the source proves nothing unless the function sends it: the
 * ledger reads x-fn-build from the preflight, so a BUILD_VERSION that only
 * reaches a JSON body (layoff-filings) would read "to deploy" forever.
 */
function sendsBuildHeader(fn) {
  const dir = join(FN_DIR, fn);
  const own = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f));
  const shared = sharedImports(fn).map((p) => join(ROOT, p)).filter((p) => existsSync(p));
  return [...own, ...shared].some((p) => /x-fn-build/i.test(readFileSync(p, "utf8")));
}

// ── --against: git reads only ───────────────────────────────────────────────
// A path absent at the ref (a new function) is null, quietly.
const showAt = (ref, p) => { try { return execFileSync("git", ["show", `${ref}:${p}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const filesAt = (ref, dir) => { try { return git("ls-tree", "-r", "--name-only", ref, "--", dir).split("\n").filter(Boolean); } catch { return []; } };
function importsAt(ref, fn) {
  const out = new Set();
  for (const f of filesAt(ref, `supabase/functions/${fn}`).filter((x) => x.endsWith(".ts"))) {
    for (const m of (showAt(ref, f) ?? "").matchAll(/from\s+["']\.\.\/_shared\/([^"']+)["']/g)) out.add(`supabase/functions/_shared/${m[1]}`);
  }
  return out;
}
/** Does fn's code (its folder, or a _shared module it imports at either end) differ between ref and HEAD, its own marker line aside? */
function codeChanged(ref, fn, headRef = "HEAD") {
  const index = `supabase/functions/${fn}/index.ts`;
  const paths = [`supabase/functions/${fn}`, ...new Set([...importsAt(ref, fn), ...importsAt(headRef, fn)])];
  const names = git("diff", "--name-only", ref, headRef, "--", ...paths).split("\n").filter(Boolean);
  if (!names.length) return false;
  if (names.some((n) => n !== index)) return true;
  return !onlyMarkerLines(fn, git("diff", "-U0", ref, headRef, "--", index).split("\n"));
}
function isAncestor(a, b) {
  try { execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: ROOT, stdio: "ignore" }); return true; } catch { return false; }
}
export function runAgainst(refs, mainRef, policy, headRef = "HEAD") {
  const fns = filesAt(headRef, "supabase/functions")
    .map((p) => /^supabase\/functions\/([^/]+)\/index\.ts$/.exec(p)?.[1])
    .filter((f) => f && f !== "_shared")
    .sort();
  let bad = 0;
  // HEAD's branch name, so its workstream can be read; a detached HEAD has none.
  let headName = headRef;
  if (headRef === "HEAD") { try { headName = git("rev-parse", "--abbrev-ref", "HEAD"); } catch { headName = ""; } }
  const mainJobBoard = buildOf("job-board", showAt(mainRef, "supabase/functions/job-board/index.ts"));
  for (const ref of refs) {
    git("rev-parse", "--verify", `${ref}^{commit}`); // an unknown ref is an error, not an empty pass
    const deployable = isAncestor(ref, mainRef);
    const allowEqual = deployable ? new Set() : sharedReservation(policy, { ref, head: headName, mainJobBoard });
    const entries = fns.map((fn) => {
      const changed = codeChanged(ref, fn, headRef);
      const p = `supabase/functions/${fn}/index.ts`;
      return { fn, changed, ref: changed ? buildOf(fn, showAt(ref, p)) : null, head: changed ? buildOf(fn, showAt(headRef, p)) : null };
    });
    const moved = entries.filter((e) => e.changed);
    const v = againstViolations(entries, { allowEqual });
    const shared = moved.filter((e) => e.head && e.head === e.ref && allowEqual.has(e.head));
    console.log(`AGAINST ${ref}${deployable ? ` (contained in ${mainRef})` : ""}: ${moved.length} functions' code differs from ${headRef}; ${v.length} violation(s)`);
    for (const e of shared) console.log(`  RESERVED  ${e.fn.padEnd(32)} ${e.head} (${workstreamOf(policy, ref)}'s reservation, shared with its own undeployed branch; docs/deploy-ledger.json)`);
    for (const x of v) console.log(`  VIOLATION ${x.fn.padEnd(32)} ref ${x.ref ?? "-"}  HEAD ${x.head ?? "-"}  (${x.reason})`);
    bad += v.length;
  }
  return bad;
}

async function live(base, fn) {
  try {
    const r = await fetch(`${base}/functions/v1/${fn}`, { method: "OPTIONS", signal: AbortSignal.timeout(20_000) });
    return r.headers.get("x-fn-build");
  } catch { return undefined; }
}

async function pool(items, n, f) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

// ── migrations ──────────────────────────────────────────────────────────────
function migrations(policy) {
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
  const baseline = policy.drizzleBaseline;
  const pending = repo.filter((f) => f >= baseline && !lovableAuthored(f) && !applied.has(f)
    && !policy.neverApply.some((n) => f.startsWith(n)) && !policy.appliedOutsideDrizzle.some((n) => f.startsWith(n)));
  const hold = pending.filter((f) => policy.holdUntilVerified.some((h) => f.startsWith(h.stamp)));
  return { pending: pending.filter((f) => !hold.includes(f)), hold, neverApplyPresent: repo.filter((f) => policy.neverApply.some((n) => f.startsWith(n))) };
}

// ── report ──────────────────────────────────────────────────────────────────
async function main(argv) {
  const POLICY = JSON.parse(readFileSync(join(ROOT, "docs/deploy-ledger.json"), "utf8"));
  const args = new Set(argv);

  const against = argv.flatMap((a, i) => (a === "--against" && argv[i + 1] ? [argv[i + 1]] : []));
  if (argv.includes("--against")) {
    if (!against.length) { console.error("--against needs a git ref"); process.exit(1); }
    const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
    // --main: the ref whose commits may be deployed (a ref it contains shares no build with HEAD).
    // --head: judge another commit in place of HEAD (read-only; e.g. a commit before a restamp).
    const bad = runAgainst(against, opt("--main", "origin/main"), POLICY, opt("--head", "HEAD"));
    process.exit(bad ? 3 : 0);
  }

  const BASE = POLICY.supabaseUrl;
  const head = git("rev-parse", "--short", "HEAD");
  const fns = readdirSync(FN_DIR).filter((d) => d !== "_shared" && existsSync(join(FN_DIR, d, "index.ts"))).sort();
  const rows = await pool(fns, 8, async (fn) => {
    const src = readFileSync(join(FN_DIR, fn, "index.ts"), "utf8");
    const stamp = buildOf(fn, src);
    const want = stamp && sendsBuildHeader(fn) ? stamp : null;
    const have = await live(BASE, fn);
    const drift = want ? changedSinceStamp(fn, want, POLICY) : { since: null, changed: [] };
    const state = !want ? "no-marker" : have === undefined ? "unreachable" : !have ? "deploy (no live header)"
      : buildAtLeast(have, want) ? (have === want ? "live" : "live-ahead") : "deploy";
    return { fn, want, have: have ?? null, state, changedSinceStamp: drift.changed, stampCommit: drift.since, ...(stamp && !want ? { stampNotSent: stamp } : {}) };
  });
  const mig = migrations(POLICY);
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
  if (noMarker.length) console.log(`\nNo build marker (a deploy of these cannot be verified): ${noMarker.map((r) => r.stampNotSent ? `${r.fn} (carries ${r.stampNotSent} but never sends x-fn-build)` : r.fn).join(", ")}`);
  console.log(`\nMigrations pending (in apply order): ${mig.pending.length}`);
  for (const f of mig.pending) console.log(`  ${f}`);
  if (mig.hold.length) { console.log(`Held until the step before is verified live:`); for (const f of mig.hold) console.log(`  HOLD  ${f}`); }
  if (mig.neverApplyPresent.length) console.log(`NEVER apply (superseded): ${mig.neverApplyPresent.join(", ")}`);

  if (args.has("--message")) {
    console.log(`\n──────── Lovable message ────────\n`);
    console.log(`Pull GitHub main at commit **${head}** (or later ONLY if the deploy ledger is re-run on it).\n`);
    let step = 0;
    if (mig.pending.length) {
      console.log(`${++step}. Apply these ${mig.pending.length} migrations, in this order, one at a time (each is self-verifying and safe to re-run):`);
      mig.pending.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
      if (mig.hold.length) console.log(`   Do NOT apply yet: ${mig.hold.join(", ")}.`);
      if (mig.neverApplyPresent.length) console.log(`   NEVER apply: ${mig.neverApplyPresent.join(", ")} (superseded).`);
    }
    if (toDeploy.length) {
      console.log(`${++step}. Deploy these ${toDeploy.length} edge functions. An OPTIONS request to each must answer this x-fn-build:`);
      for (const r of toDeploy) console.log(`   - ${r.fn}: ${r.want}`);
    }
    console.log(`${++step}. Publish the frontend.`);
  }
  if (unbumped.length) process.exitCode = 2;
}

// The entry point, compared by real path (a symlinked checkout must still run).
const isEntry = (() => { try { return realpathSync(resolve(process.argv[1] ?? "")) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isEntry) await main(process.argv.slice(2));
