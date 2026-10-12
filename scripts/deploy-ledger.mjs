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
//   node scripts/deploy-ledger.mjs --message  # also print the Lovable message (only from origin/main)
//   node scripts/deploy-ledger.mjs --draft    # a labelled preview of it from any checkout (not sendable)
//   node scripts/deploy-ledger.mjs --json     # machine-readable
//   node scripts/deploy-ledger.mjs --against <git-ref> [--against <git-ref> ...] [--main <git-ref>] [--head <git-ref>]
//                                             # integration check, no network (exit 3 on a violation)
//   node scripts/deploy-ledger.mjs --overlap <git-ref> [<git-ref> ...] [--main <git-ref>]
//                                             # parallel branches' shared files and functions, no network
//                                             # (exit 4 when one is not declared in sharedFiles)
//
// Read-only: OPTIONS preflights (no function logic runs), `git fetch origin
// main` and git/file reads; --against makes no network call at all. Policy
// (never-apply, hold-until-verified, migration order, reservations) lives in
// docs/deploy-ledger.json; the rules are in docs/DEPLOY-LEDGER.md. Exit 2:
// MUST BUMP. Exit 3: --against found a function whose code moved without a
// later build. Exit 4: a function's preflight did not answer, so the ledger
// could not check it. Exit 5: --message refused, HEAD is not origin/main.
// Exit 6: a migrationOrder rule cannot be met. Exit 7: an unapplied
// migration defines or alters an object that an applied migration with a
// LATER stamp defines (a late-stamped deploy would revert it). Exit 8: a
// function's live build is later than the one main carries (main is behind
// production). In --overlap mode, exit 4 means two refs change a file or a
// function that sharedFiles gives no owner.
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

// ── --overlap: parallel branches must not share files unless one owns them ───
/**
 * The workstream that owns a path, from docs/deploy-ledger.json `sharedFiles`
 * (path -> workstream). A key ending in "/" covers every path under it, so
 * "supabase/functions/agent-mcp/" declares that function's whole folder; a
 * function is also declared by "fn:<name>". The longest matching key wins.
 * Pure. Returns the owner string, or null when nothing declares the path.
 */
export function sharedOwner(sharedFiles, path) {
  const map = sharedFiles && typeof sharedFiles === "object" ? sharedFiles : {};
  let best = null;
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith("_") || typeof v !== "string" || !v) continue;
    const hit = k === path || (k.endsWith("/") && path.startsWith(k));
    if (hit && (!best || k.length > best.k.length)) best = { k, v };
  }
  return best ? best.v : null;
}

/**
 * THE OVERLAP RULE (docs/DEPLOY-LEDGER.md §6). Parallel branches must change
 * disjoint files, or the ledger must name who owns each file they share.
 * `changes` is one entry per ref: { ref, files: [path], functions: [name] },
 * each the ref's own diff from its merge-base with main. A file or a function
 * changed by two or more refs is an overlap; it is DECLARED only when
 * `sharedFiles` names an owner and that owner is a workstream in
 * `reservations` (an owner nobody reserved is a typo, not a decision). Pure:
 * no git, no network.
 *
 *   returns { files: [{ path, refs, owner, declared }], functions: [{ fn, refs, owner, declared }], undeclared: number }
 */
export function overlapReport(changes, policy = {}) {
  const known = new Set(Object.keys(policy?.reservations ?? {}));
  const judge = (owner) => owner !== null && known.has(owner);
  const multi = (key) => {
    const by = new Map();
    for (const c of changes ?? []) for (const x of new Set(c[key] ?? [])) by.set(x, [...(by.get(x) ?? []), c.ref]);
    return [...by.entries()].filter(([, refs]) => refs.length > 1).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  };
  const files = multi("files").map(([path, refs]) => {
    const owner = sharedOwner(policy?.sharedFiles, path);
    return { path, refs, owner, declared: judge(owner) };
  });
  const functions = multi("functions").map(([fn, refs]) => {
    const owner = sharedOwner(policy?.sharedFiles, `fn:${fn}`) ?? sharedOwner(policy?.sharedFiles, `supabase/functions/${fn}/`);
    return { fn, refs, owner, declared: judge(owner) };
  });
  return { files, functions, undeclared: [...files, ...functions].filter((x) => !x.declared).length };
}

/**
 * The functions a set of changed paths reaches at `ref`: every function whose
 * own folder changed, and every function that imports a changed _shared
 * module there (the same reach the ledger's MUST BUMP and --against use).
 */
function functionsTouched(ref, files) {
  const out = new Set();
  for (const f of files) {
    const m = /^supabase\/functions\/([^/]+)\//.exec(f);
    if (m && m[1] !== "_shared") out.add(m[1]);
  }
  const shared = files.filter((f) => f.startsWith("supabase/functions/_shared/"));
  if (shared.length) {
    // One `git grep` at the ref for the import specifiers, not a read of every
    // function's files (that took minutes on job-board's 4 MB catalogue).
    // --text: a file holding a NUL byte is still searched.
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "--text", "-l", "-F", ...shared.flatMap((p) => ["-e", `../_shared/${p.slice("supabase/functions/_shared/".length)}`]), ref, "--", "supabase/functions"],
        { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
    } catch { /* exit 1: no function imports them */ }
    for (const l of hits.split("\n")) {
      const m = /^[^:]+:supabase\/functions\/([^/]+)\//.exec(l);
      if (m && m[1] !== "_shared") out.add(m[1]);
    }
  }
  return [...out].sort();
}

/** --overlap: git reads only. Each ref is diffed from its merge-base with `mainRef`. Returns the undeclared count. */
export function runOverlap(refs, mainRef, policy) {
  const changes = refs.map((ref) => {
    git("rev-parse", "--verify", `${ref}^{commit}`); // an unknown ref is an error, not an empty pass
    const base = git("merge-base", ref, mainRef);
    const files = git("diff", "--name-only", base, ref).split("\n").filter(Boolean);
    return { ref, base, files, functions: functionsTouched(ref, files) };
  });
  const r = overlapReport(changes, policy);
  console.log(`OVERLAP across ${refs.length} ref(s), each diffed from its merge-base with ${mainRef} (git only, no network)`);
  for (const c of changes) console.log(`  ${c.ref}: ${c.files.length} files, ${c.functions.length} functions (since ${c.base.slice(0, 8)})`);
  const line = (x, name) => {
    const who = x.declared ? `owned by ${x.owner}` : x.owner ? `sharedFiles names "${x.owner}", which no reservation is` : "no owner in sharedFiles";
    console.log(`  ${x.declared ? "DECLARED  " : "UNDECLARED"} ${name.padEnd(48)} ${who}; changed by ${x.refs.join(", ")}`);
  };
  console.log(`Files changed by more than one ref: ${r.files.length}`);
  for (const x of r.files) line(x, x.path);
  console.log(`Functions changed by more than one ref: ${r.functions.length}`);
  for (const x of r.functions) line(x, x.fn);
  console.log(r.undeclared
    ? `${r.undeclared} undeclared overlap(s): give each file one owner in docs/deploy-ledger.json sharedFiles, or move the change to one branch (docs/DEPLOY-LEDGER.md §6).`
    : `No undeclared overlap.`);
  return r.undeclared;
}

/**
 * One preflight's x-fn-build: the header's value, null when the function
 * answered without one, undefined when nothing answered (a network error or
 * the 20 s clock). A function that did not answer is tried once more before it
 * is reported "unreachable", and an unreachable row is a gap, never a pass
 * (S11-048: with every preflight failing, the ledger listed 0 to deploy,
 * exited 0, and section 49 printed PASS).
 */
export async function liveBuild(base, fn, { tries = 2, timeoutMs = 20_000, pauseMs = 1_500 } = {}) {
  for (let t = 0; t < tries; t++) {
    if (t > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    try {
      const r = await fetch(`${base}/functions/v1/${fn}`, { method: "OPTIONS", signal: AbortSignal.timeout(timeoutMs) });
      return r.headers.get("x-fn-build");
    } catch { /* tried again, then unreachable */ }
  }
  return undefined;
}

/** A row's state from what the repo carries (`want`) and what the preflight answered (`have`). Pure. */
export function rowState(want, have) {
  if (!want) return "no-marker";
  if (have === undefined) return "unreachable";
  if (!have) return "deploy (no live header)";
  return buildAtLeast(have, want) ? (have === want ? "live" : "live-ahead") : "deploy";
}

async function pool(items, n, f) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

// ── migrations ──────────────────────────────────────────────────────────────
/** The staged-runner record Lovable writes (drizzle/migrations): how many stubs, and the newest. */
// ── late stamps (spec 2026-10-11 §3.3) ──────────────────────────────────────
const SQL_NAME = String.raw`(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;
const DEFINES = new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TABLE|VIEW|TYPE|SEQUENCE|INDEX|TRIGGER)\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${SQL_NAME}`, "gi");
const ALTERS = new RegExp(String.raw`\b(?:ALTER|DROP)\s+(?:MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TABLE|VIEW|TYPE|SEQUENCE|INDEX|TRIGGER)\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${SQL_NAME}`, "gi");

/**
 * The objects one migration defines, and every object it defines, alters or
 * drops, by bare lower-case name (a function by its name alone, whatever its
 * arguments: two overloads are one name here, which can only over-report).
 * Comments are removed first, so a name written in prose is no object. Pure.
 */
export function objectsOf(sql) {
  const code = String(sql ?? "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const defines = new Set([...code.matchAll(DEFINES)].map((m) => m[1].toLowerCase()));
  const touches = new Set([...defines, ...[...code.matchAll(ALTERS)].map((m) => m[1].toLowerCase())]);
  return { defines, touches };
}

/**
 * THE LATE-STAMP RULE (spec 2026-10-11 §3.3). A migration stamp need not sort
 * in deploy order: wave 4's 20261011* deploys after profiles' 20261012*. An
 * unapplied migration that defines or alters an object an APPLIED migration
 * with a later stamp defines would put the older definition back. `pending`
 * and `applied` are file names; `sqlOf(file)` reads one. Returns every such
 * pair with the objects they share, in file order. Pure apart from sqlOf.
 */
export function lateStampViolations(pending, applied, sqlOf) {
  const stamp = (f) => f.slice(0, 14);
  const memo = new Map();
  const objs = (f) => { if (!memo.has(f)) memo.set(f, objectsOf(sqlOf(f))); return memo.get(f); };
  const out = [];
  for (const p of [...pending].sort()) {
    for (const a of [...applied].sort()) {
      if (stamp(a) <= stamp(p)) continue;
      const shared = [...objs(p).touches].filter((o) => objs(a).defines.has(o)).sort();
      if (shared.length) out.push({ pending: p, applied: a, objects: shared });
    }
  }
  return out;
}

/** Rows whose live build is LATER than the one main carries: main is behind production (exit 8). Pure. */
export function liveAheadRows(rows) {
  return (rows ?? []).filter((r) => r.state === "live-ahead");
}

function stubRecord() {
  const stubs = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")).sort();
  return { count: stubs.length, newest: stubs[stubs.length - 1] ?? null };
}

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
  const never = (f) => policy.neverApply.some((n) => f.startsWith(n));
  return {
    pending: pending.filter((f) => !hold.includes(f)), hold, neverApplyPresent: repo.filter(never),
    // Everything else on disk is applied: recorded by the runner, applied outside it, before the baseline, or written by Lovable as it applied.
    applied: repo.filter((f) => !pending.includes(f) && !never(f)),
  };
}

// ── order inside one deploy ─────────────────────────────────────────────────
const AFTER_FN = /^fn:([a-z0-9-]+)@(\d{4}-\d{2}-\d{2}\.(?:0|[1-9]\d*))$/;
const BEFORE_FN = /^fn:([a-z0-9-]+)$/;

/**
 * THE ORDER INSIDE ONE DEPLOY (S11-049). Lovable works the message top to
 * bottom, and in wave 2 it stopped for hours between steps. A migration the
 * live code cannot survive, or one that new code must be serving before it
 * runs, has to sit in the right step, not in one block before every function.
 * docs/deploy-ledger.json `migrationOrder` names, per migration stamp:
 *
 *   after:  "fn:<name>@<YYYY-MM-DD.N>"  apply once <name> answers that build or later
 *           "frontend"                  apply once the frontend is published
 *   before: ["fn:<name>", ...]          apply before <name> deploys (printed beside
 *                                       it; an `after` that puts it later is an error)
 *
 * A migration with no `after` goes before the functions, as every migration
 * did. An `after` function that already answers the named build (or later)
 * makes the migration wait for nothing. A rule that cannot be met (main
 * carries an earlier build, or no such function) is an error, never a guess.
 * Pure: `rows` are the report's rows ({ fn, want, have, state }).
 *
 *   returns { pre, afterFunctions, afterFrontend, errors }, each phase
 *   [{ file, note }] in filename order
 */
export function migrationPhases(pending, policy, rows) {
  const order = policy?.migrationOrder ?? {};
  const byFn = new Map((rows ?? []).map((r) => [r.fn, r]));
  const out = { pre: [], afterFunctions: [], afterFrontend: [], errors: [] };
  const rules = Object.entries(order).filter(([k]) => !k.startsWith("_"));
  for (const [stamp, e] of rules) {
    if (!/^\d{14}$/.test(stamp)) out.errors.push(`migrationOrder key "${stamp}" is not a 14-digit migration stamp`);
    if (e?.after !== undefined && e.after !== "frontend" && !AFTER_FN.test(String(e.after))) {
      out.errors.push(`migrationOrder ${stamp}: after "${e.after}" is neither "frontend" nor "fn:<name>@<YYYY-MM-DD.N>"`);
    }
    for (const b of Array.isArray(e?.before) ? e.before : []) if (!BEFORE_FN.test(String(b))) out.errors.push(`migrationOrder ${stamp}: before "${b}" is not "fn:<name>"`);
  }
  for (const file of pending) {
    // Only a whole stamp matches: a short key would claim every file it prefixes.
    const e = rules.find(([stamp]) => /^\d{14}$/.test(stamp) && file.startsWith(`${stamp}_`))?.[1] ?? null;
    const before = (Array.isArray(e?.before) ? e.before : []).map((b) => BEFORE_FN.exec(String(b))?.[1]).filter(Boolean);
    const beforeNote = before.length ? `before ${before.join(" and ")}` : "";
    for (const fn of before) if (!byFn.has(fn)) out.errors.push(`${file} must apply before ${fn}, but main has no function ${fn}`);
    if (!e?.after) { out.pre.push({ file, note: beforeNote }); continue; }
    if (e.after === "frontend") {
      if (before.length) out.errors.push(`${file} waits for the frontend, yet it must apply before ${before.join(" and ")}`);
      out.afterFrontend.push({ file, note: "after the frontend is published" });
      continue;
    }
    const m = AFTER_FN.exec(String(e.after));
    if (!m) { out.pre.push({ file, note: beforeNote }); continue; } // its rule is reported above
    const [, fn, b] = m;
    const need = `${fn}.${b}`;
    const r = byFn.get(fn);
    if (!r) { out.errors.push(`${file} waits for ${need}, but main has no function ${fn}`); continue; }
    if (!r.want || !buildAtLeast(r.want, need)) { out.errors.push(`${file} waits for ${need}, but main carries ${r.want ?? "no build the ledger can read"}: that step can never come`); continue; }
    if (before.includes(fn)) { out.errors.push(`${file} must apply both before and after ${fn}`); continue; }
    if ((r.state === "live" || r.state === "live-ahead") && buildAtLeast(r.have, need)) {
      out.pre.push({ file, note: [beforeNote, `${fn} already answers ${r.have}`].filter(Boolean).join("; ") });
      continue;
    }
    // Deploying in this message, or its live build could not be read: wait for it.
    out.afterFunctions.push({ file, note: [beforeNote, `once ${fn} answers ${need} or later`].filter(Boolean).join("; ") });
  }
  return out;
}

/**
 * THE CHECKOUT A MESSAGE MAY COME FROM (S11-127). Lovable pulls GitHub main,
 * so a message must name main's commit and list main's pending migrations. A
 * checkout behind origin/main re-lists migrations Lovable already applied (the
 * 503fff27 checkout still listed 132000, 140000 and 141000); one ahead of it
 * names a commit Lovable cannot pull. Pure.
 *
 * The commit is not the whole question: every input below is read from the
 * working tree, so a checkout at origin/main with an edited function, an
 * untracked migration or an edited policy printed a message naming main's
 * commit and listing what main does not have (review of S11-127). `dirty`
 * is the git status of DEPLOY_INPUTS.
 *
 *   returns null when HEAD is origin/main and its inputs are clean, else the refusal sentence
 */
export const DEPLOY_INPUTS = ["supabase/functions", "supabase/migrations", "drizzle/migrations", "docs/deploy-ledger.json", "scripts/deploy-ledger.mjs"];
export function checkoutRefusal({ head, originMain, fetched = true, behind = 0, ahead = 0, dirty = [] }) {
  if (!fetched) return "git fetch origin failed, so the ledger cannot tell whether this checkout is GitHub main";
  if (!originMain) return "origin/main could not be read";
  if (head === originMain) {
    if (!dirty.length) return null;
    return `HEAD is origin/main ${String(originMain).slice(0, 8)} but ${dirty.length} deploy input(s) differ from that commit: ${dirty.slice(0, 8).join(", ")}${dirty.length > 8 ? ", ..." : ""} (commit, stash or remove them)`;
  }
  const where = behind && ahead ? `${behind} commit(s) behind and ${ahead} ahead of` : behind ? `${behind} commit(s) behind` : ahead ? `${ahead} commit(s) ahead of` : "not";
  return `HEAD ${String(head).slice(0, 8)} is ${where} origin/main ${String(originMain).slice(0, 8)}`;
}

/**
 * The Lovable message, as lines. Pure: everything it prints is passed in.
 * Five steps, each printed only when it has work (the frontend always):
 *   1. migrations before the functions   2. the functions
 *   3. migrations that wait for a function   4. the frontend
 *   5. migrations that wait for the frontend
 * Functions whose preflight never answered head the message as a STOP: the
 * ledger could not say whether they are live (S11-048).
 */
export function lovableMessage({ head, draftOf = null, phases, hold = [], neverApply = [], toDeploy = [], unreachable = [] }) {
  const L = [];
  if (draftOf) L.push(`DRAFT from ${draftOf} at ${head}: NOT a deploy message. Lovable pulls GitHub main; regenerate this at the merge commit on main.`, "");
  else L.push(`Pull GitHub main at commit **${head}** (or later ONLY if the deploy ledger is re-run on it).`, "");
  if (unreachable.length) {
    L.push(`STOP: could not check ${unreachable.length} function(s), so this message may leave them out. Their preflight did not answer, twice. Re-run the deploy ledger before sending: ${unreachable.map((r) => r.fn).join(", ")}.`, "");
  }
  let step = 0;
  const migs = (list, lead) => {
    L.push(`${++step}. ${lead}`);
    list.forEach((m, i) => L.push(`   ${i + 1}. ${m.file}${m.note ? ` (${m.note})` : ""}`));
  };
  const holdLines = () => {
    if (hold.length) L.push(`   Do NOT apply yet: ${hold.join(", ")}.`);
    if (neverApply.length) L.push(`   NEVER apply: ${neverApply.join(", ")} (superseded).`);
  };
  if (phases.pre.length) {
    migs(phases.pre, phases.pre.length === 1 ? `Apply this migration (it is self-verifying and safe to re-run):` : `Apply these ${phases.pre.length} migrations, in this order, one at a time (each is self-verifying and safe to re-run):`);
    holdLines();
  } else if (hold.length || neverApply.length) {
    L.push(`${++step}. Apply no migration before the functions.`);
    holdLines();
  }
  if (toDeploy.length) {
    L.push(`${++step}. Deploy these ${toDeploy.length} edge functions. An OPTIONS request to each must answer this x-fn-build:`);
    for (const r of toDeploy) L.push(`   - ${r.fn}: ${r.want}`);
  }
  const these = (n) => (n === 1 ? "this migration" : `these ${n} migrations, in this order`);
  if (phases.afterFunctions.length) {
    migs(phases.afterFunctions, `Only once the function each one names answers its build (check with an OPTIONS request), apply ${these(phases.afterFunctions.length)}:`);
  }
  L.push(`${++step}. Publish the frontend.`);
  if (phases.afterFrontend.length) {
    migs(phases.afterFrontend.map((m) => ({ file: m.file })), `Only once the frontend is published, apply ${these(phases.afterFrontend.length)}:`);
  }
  return L;
}

// ── report ──────────────────────────────────────────────────────────────────
async function main(argv) {
  const POLICY = JSON.parse(readFileSync(join(ROOT, "docs/deploy-ledger.json"), "utf8"));
  const args = new Set(argv);

  if (argv.includes("--overlap")) {
    // Every argument after --overlap up to the next flag is a ref; --main names the base.
    const at = argv.indexOf("--overlap");
    const refs = [];
    for (let i = at + 1; i < argv.length && !argv[i].startsWith("--"); i++) refs.push(argv[i]);
    if (!refs.length) { console.error("--overlap needs at least one git ref"); process.exit(1); }
    const mi = argv.indexOf("--main");
    const bad = runOverlap(refs, mi >= 0 && argv[mi + 1] ? argv[mi + 1] : "origin/main", POLICY);
    process.exit(bad ? 4 : 0);
  }

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
    const have = await liveBuild(BASE, fn);
    const drift = want ? changedSinceStamp(fn, want, POLICY) : { since: null, changed: [] };
    const state = rowState(want, have);
    return { fn, want, have: have ?? null, state, changedSinceStamp: drift.changed, stampCommit: drift.since, ...(stamp && !want ? { stampNotSent: stamp } : {}) };
  });
  const mig = migrations(POLICY);
  const stubs = stubRecord();
  const toDeploy = rows.filter((r) => r.state.startsWith("deploy"));
  const unreachable = rows.filter((r) => r.state === "unreachable");
  // Changed-since-stamp matters only when that stamp is ALREADY LIVE: a build
  // not yet deployed ships whatever the branch holds. Own-folder changes after a
  // live stamp cannot be told apart from what is deployed (MUST bump); changes
  // only in a _shared import may be harmless (an added export) — CHECK.
  const liveStamped = rows.filter((r) => (r.state === "live" || r.state === "live-ahead") && r.changedSinceStamp.length > 0);
  const unbumped = liveStamped.filter((r) => r.changedSinceStamp.some((p) => p.startsWith(`supabase/functions/${r.fn}/`)));
  const sharedOnly = liveStamped.filter((r) => !unbumped.includes(r));
  const noMarker = rows.filter((r) => r.state === "no-marker");
  const phases = migrationPhases(mig.pending, POLICY, rows);
  const late = lateStampViolations([...mig.pending, ...mig.hold], mig.applied, (f) => readFileSync(join(MIG_DIR, f), "utf8"));
  const liveAhead = liveAheadRows(rows);

  // Is this checkout GitHub main? (S11-127) Fetched, never assumed.
  let fetched = true;
  try { execFileSync("git", ["fetch", "--quiet", "origin", "main"], { cwd: ROOT, stdio: "ignore", timeout: 60_000 }); } catch { fetched = false; }
  let originMain = null, behind = 0, ahead = 0;
  try { originMain = git("rev-parse", "origin/main"); } catch { /* unreadable */ }
  const headFull = git("rev-parse", "HEAD");
  if (originMain) { try { [behind, ahead] = git("rev-list", "--left-right", "--count", `origin/main...HEAD`).split(/\s+/).map(Number); } catch { /* unknown */ } }
  // Every input this report reads from the working tree, as git sees it.
  let dirty = [];
  try {
    // Untrimmed: a porcelain line opens with its two status columns, the first often a space.
    dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...DEPLOY_INPUTS], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter(Boolean).map((l) => l.slice(3));
  } catch { dirty = ["(git status failed)"]; }
  const refusal = checkoutRefusal({ head: headFull, originMain, fetched, behind, ahead, dirty });
  const checkout = { head: headFull, originMain, behind, ahead, refusal };

  // Exit: 5 refused (not main), 6 an order rule cannot be met, 7 a late-stamped
  // migration would revert a later one, 8 main is behind a live build, 4 a
  // function could not be checked, 2 MUST BUMP. (3 is --against's.)
  const exitFor = (withMessage) => (withMessage && refusal ? 5 : phases.errors.length ? 6 : late.length ? 7 : liveAhead.length ? 8
    : unreachable.length ? 4 : unbumped.length ? 2 : 0);

  if (args.has("--json")) {
    // The applied list is the late-stamp rule's input, not the report: hundreds of
    // names would push the JSON past the 64 KB a pipe takes before exit cuts it
    // off (section 49 reads it through one), so only its length is printed.
    const { applied, ...migOut } = mig;
    console.log(JSON.stringify({ head, checkout, stubs, toDeploy, unreachable, unbumped, sharedOnly, noMarker, migrations: { ...migOut, appliedCount: applied.length }, phases, late, liveAhead, rows }, null, 2));
    process.exit(exitFor(false));
  }
  console.log(`DEPLOY LEDGER at ${head} (${new Date().toISOString()})\n`);
  console.log(refusal ? `Checkout: NOT GitHub main (${refusal}).` : `Checkout: HEAD is origin/main.`);
  console.log(`Staged-runner record: ${stubs.count} stubs, newest ${stubs.newest ?? "none"}.\n`);
  console.log(`Functions: ${rows.length} (${rows.filter((r) => r.state === "live").length} live at the repo build, ${toDeploy.length} to deploy, ${unreachable.length} could not be checked, ${noMarker.length} without a build marker)`);
  for (const r of toDeploy) console.log(`  DEPLOY  ${r.fn.padEnd(32)} live ${r.have ?? "-"}  ->  ${r.want}`);
  if (unreachable.length) {
    console.log(`\nCOULD NOT CHECK (the preflight did not answer, twice): re-run the ledger. Each of these may be a function to deploy:`);
    for (const r of unreachable) console.log(`  UNREACHABLE  ${r.fn.padEnd(32)} the checkout carries ${r.want}`);
  }
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
  const pr = (label, list) => { if (list.length) { console.log(`  ${label}:`); for (const m of list) console.log(`    ${m.file}${m.note ? ` (${m.note})` : ""}`); } };
  pr("before the functions", phases.pre);
  pr("after the functions they wait for", phases.afterFunctions);
  pr("after the frontend", phases.afterFrontend);
  if (mig.hold.length) { console.log(`Held until the step before is verified live:`); for (const f of mig.hold) console.log(`  HOLD  ${f}`); }
  if (mig.neverApplyPresent.length) console.log(`NEVER apply (superseded): ${mig.neverApplyPresent.join(", ")}`);
  if (phases.errors.length) {
    console.log(`\nORDER RULES THAT CANNOT BE MET (docs/deploy-ledger.json migrationOrder): no message until they are fixed:`);
    for (const e of phases.errors) console.log(`  ${e}`);
  }
  if (late.length) {
    console.log(`\nLATE STAMPS: an unapplied migration defines or alters what an applied migration with a later stamp defines; applying it would put the older definition back (no message until each is resolved):`);
    for (const v of late) console.log(`  ${v.pending}  touches  ${v.objects.join(", ")}  defined by the later ${v.applied}`);
  }
  if (liveAhead.length) {
    console.log(`\nMAIN IS BEHIND PRODUCTION: these functions answer a build later than the one main carries (a deploy from main would roll them back):`);
    for (const r of liveAhead) console.log(`  ${r.fn.padEnd(32)} main ${r.want}  live ${r.have}`);
  }

  const wantMessage = args.has("--message") || args.has("--draft");
  if (wantMessage) {
    console.log(`\n──────── Lovable message ────────\n`);
    if (phases.errors.length) {
      console.log(`REFUSED: the order rules above cannot be met, so no order can be printed.`);
    } else if (late.length) {
      console.log(`REFUSED: a late-stamped migration above would revert a later one; resolve it before any message is printed.`);
    } else if (args.has("--message") && refusal) {
      console.log(`REFUSED: ${refusal}. Lovable pulls GitHub main, so a message from this checkout would name the wrong commit or re-list migrations already applied. Check out origin/main and re-run (or pass --draft for a labelled preview that is not a deploy message).`);
    } else {
      let branch = "";
      try { branch = git("rev-parse", "--abbrev-ref", "HEAD"); } catch { /* detached */ }
      const draftOf = args.has("--message") ? null : (branch && branch !== "HEAD" ? branch : head);
      for (const l of lovableMessage({ head, draftOf, phases, hold: mig.hold, neverApply: mig.neverApplyPresent, toDeploy, unreachable })) console.log(l);
    }
  }
  process.exitCode = exitFor(args.has("--message"));
}

// The entry point, compared by real path (a symlinked checkout must still run).
const isEntry = (() => { try { return realpathSync(resolve(process.argv[1] ?? "")) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isEntry) await main(process.argv.slice(2));
