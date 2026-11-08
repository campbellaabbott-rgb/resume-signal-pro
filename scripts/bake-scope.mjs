#!/usr/bin/env node
/**
 * DOES THIS CHANGE TOUCH THE BAKE? The question .github/workflows/ci.yml asks
 * before it runs the `built-output` job on a pull request.
 *
 * WHY THE QUESTION EXISTS (owner decision 2026-11-08, cost audit item "the
 * built-output live bake on every PR"). `built-output` builds the site, which
 * runs scripts/prerender-seo.mjs against LIVE production (about 1,100-1,200
 * production reads, up to 721 of them job-board calls, plus 372-492
 * get_company_intel RPCs), and then runs the guards on dist/. It ran on every
 * push to main and on every pull request event: 76 of 127 CI runs in thirty
 * days were pull requests. The owner kept the live bake on main pushes and on
 * the pull requests that change the bake's own code, and nowhere else. A pull
 * request that changes nothing the bake runs or reads is judged by the same
 * job once it reaches main.
 *
 * WHAT COUNTS AS THE BAKE'S CODE, computed from the tree, never typed out, so
 * a new import of the bake is in scope the day it is written:
 *   - every module the bake and the build plugin import, followed through
 *     relative and "@/" imports from scripts/prerender-*.mjs and vite.config.ts;
 *   - every guard on built output (a test that skips through skipWithoutDist,
 *     the same selection the built-output job runs), its helper, and what they
 *     import;
 *   - every repository path the bake scripts name in a string (the legal pages
 *     it reads as text, the catalogue, the locales folder, the seed lists),
 *     whether or not the file exists today, so a pull request that deletes one
 *     still runs the bake;
 *   - FIXED_INPUTS below: what the build reads without importing it.
 * Over-inclusion is safe (one more live bake); under-inclusion is the risk,
 * which is why anything uncertain answers live=true.
 *
 * Usage, as the CI step runs it: the changed paths on stdin, one per line;
 * prints exactly `live=true` or `live=false` on stdout and its reason on
 * stderr. No list of changes, an unreadable tree, or any error: live=true.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Read by the build or the bake without an import: the HTML template every
 * baked page is cut from, the committed .env that names the production
 * project the live bake reads, the install that decides what builds, this
 * workflow and this script, and public/, where the bake reads its own
 * committed outputs back (the sitemap, llms.txt, the ledger) as fallbacks.
 * A path ending in "/" covers its folder.
 */
export const FIXED_INPUTS = [
  "index.html",
  ".env",
  "package.json",
  "package-lock.json",
  ".github/workflows/ci.yml",
  "scripts/bake-scope.mjs",
  "public/",
];

const RESOLVE_EXTS = ["", ".ts", ".tsx", ".mjs", ".js", ".json", "/index.ts", "/index.tsx", "/index.mjs", "/index.js"];
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

function resolveImport(root, from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(root, "src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of RESOLVE_EXTS) if (isFile(base + ext)) return base + ext;
  return null;
}

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'`]([^"'`]+)["'`]/g;
// A repository path written as a string: a file or folder under one of the
// top-level folders the bake reads from.
const PATH_LITERAL = /["'`]((?:src|public|scripts|supabase)\/[A-Za-z0-9_./@-]+)["'`]/g;
// join(root, "a", "b", ...): the literal segments, up to the first non-literal.
const ROOT_JOIN = /join\(\s*root\s*,\s*((?:["'][^"']+["']\s*,?\s*)+)/g;

/** The dist guards: test files that skip through skipWithoutDist (the built-output job's selection). */
export function distGuards(root = ROOT) {
  const dir = join(root, "src/test");
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => join(dir, f))
    .filter((p) => /skipIf\(skipWithoutDist\(/.test(readFileSync(p, "utf8")));
}

/**
 * The bake's inputs: { files, dirs }, repo-relative with forward slashes; a
 * dir entry ends in "/".
 */
export function bakeInputs(root = ROOT) {
  const files = new Set();
  const dirs = new Set();
  const rel = (p) => relative(root, p).split("\\").join("/");
  const addPath = (p) => {
    const clean = p.replace(/\/+$/, "");
    if (isDir(join(root, clean))) dirs.add(`${clean}/`);
    else files.add(clean);
  };
  for (const f of FIXED_INPUTS) (f.endsWith("/") ? dirs.add(f) : files.add(f));

  const scripts = join(root, "scripts");
  const bakeScripts = isDir(scripts)
    ? readdirSync(scripts).filter((f) => /^prerender-.*\.mjs$/.test(f)).map((f) => join(scripts, f))
    : [];
  const helper = join(root, "src/test/helpers/built-output.ts");
  const seeds = [...bakeScripts, join(root, "vite.config.ts"), ...distGuards(root), ...(isFile(helper) ? [helper] : [])].filter(isFile);

  // Paths the bake scripts name as text.
  for (const s of bakeScripts) {
    const src = readFileSync(s, "utf8");
    for (const m of src.matchAll(PATH_LITERAL)) addPath(m[1]);
    for (const m of src.matchAll(ROOT_JOIN)) {
      const joined = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]).join("/").replace(/^\.\//, "");
      const abs = join(root, joined);
      // A folder only below the top level: join(root, "scripts", name) would
      // otherwise put every script in scope. A named file that is gone today
      // stays in scope, so deleting it still runs the bake.
      if (isFile(abs)) files.add(joined);
      else if (isDir(abs)) { if (joined.includes("/")) dirs.add(`${joined}/`); }
      else if (/\.[A-Za-z0-9]+$/.test(joined) && !/(^|\/)\.[^/]*$/.test(joined)) files.add(joined);
    }
  }

  // Every module reached by import.
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    files.add(rel(f));
    if (!/\.(ts|tsx|mts|mjs|js)$/.test(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(IMPORT)) {
      const hit = resolveImport(root, f, m[1]);
      if (hit && !seen.has(hit)) queue.push(hit);
    }
  }
  return { files, dirs };
}

/** The changed paths that are the bake's inputs. */
export function bakeTouches(changed, inputs) {
  return changed
    .map((p) => p.trim().replace(/^\.\//, ""))
    .filter(Boolean)
    .filter((p) => inputs.files.has(p) || [...inputs.dirs].some((d) => p.startsWith(d)));
}

/** The CI verdict for one list of changed paths: live is true unless the list is known and touches nothing. */
export function bakeVerdict(changedText, root = ROOT) {
  const changed = String(changedText ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (changed.length === 0) return { live: true, why: "no list of changed paths: the live bake runs" };
  const hits = bakeTouches(changed, bakeInputs(root));
  return hits.length
    ? { live: true, why: `the bake's code changed: ${hits.slice(0, 12).join(", ")}${hits.length > 12 ? ` and ${hits.length - 12} more` : ""}` }
    : { live: false, why: `none of the ${changed.length} changed path(s) is the bake's code: the live bake runs on main after the merge` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let text = "";
  try { text = readFileSync(0, "utf8"); } catch { text = ""; }
  let verdict;
  try { verdict = bakeVerdict(text); } catch (e) { verdict = { live: true, why: `could not read the bake's inputs (${e instanceof Error ? e.message : String(e)}): the live bake runs` }; }
  process.stderr.write(`[bake-scope] ${verdict.why}\n`);
  process.stdout.write(`live=${verdict.live ? "true" : "false"}\n`);
}

