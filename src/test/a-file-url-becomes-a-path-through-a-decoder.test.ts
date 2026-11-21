// @vitest-environment node
/**
 * A FILE URL BECOMES A PATH THROUGH A DECODER, NEVER THROUGH ITS PATHNAME.
 *
 * WHAT WAS WRONG (2026-11-18). Four sites turned a module-relative file URL
 * into a filesystem path by reading the URL's pathname property: the layoff
 * samples folder (supabase/functions/layoff-filings/fixtures.ts), the repo
 * root in lca_test.ts and mirror_test.ts beside it, and sources.ts in
 * scripts/stage-icims.mjs. A pathname is percent-encoded, so a checkout under
 * a folder named "New Folder With Items" became ".../New%20Folder%20With%20
 * Items/...", which does not exist. Every agent worktree here sits under that
 * folder, so scripts/deno-tests.sh failed 26 tests across three layoff-filings
 * files, one of them spawning a node child into a cwd that did not exist. That
 * blocked the pre-push hook on the first push from every such worktree. From a
 * path without spaces all of it passed, which is how it went unseen.
 *
 * THE RULE. fileURLToPath from node:url (Deno serves node:url too, with no
 * lock entry and no network fetch) or std's fromFileUrl.
 *
 * WHAT THIS FILE HOLDS IN PLACE. Every source file under the trees below is
 * read, and the shape (a URL built against the module's own URL, then its
 * pathname taken) fails on any hit. The read is RAW, comments included: a
 * guard that FORBIDS a shape can only fail loud on a comment, never pass
 * blind, so explain the rule in prose without spelling the shape. The walk
 * asserts it read the four files that carried it, so it cannot pass by
 * reading nothing. A URL kept in a variable and read later is not caught.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(__dirname, "../..");
const TREES = ["supabase/functions", "scripts", "src", "worker", "tests"];
// vendor/ is third-party code copied in whole (the SheetJS build); dist is built output.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "vendor"]);
const SOURCE = /\.(?:[cm]?[jt]sx?|sh)$/;

/** The module's own URL, a closing paren (a trailing comma allowed), then the pathname. */
const SHAPE = /import\.meta\.url\s*,?\s*\)\s*\??\.pathname\b/g;

/** The four files that carried the shape; the walk must have read each one. */
const ONCE_BROKEN = [
  "supabase/functions/layoff-filings/fixtures.ts",
  "supabase/functions/layoff-filings/lca_test.ts",
  "supabase/functions/layoff-filings/mirror_test.ts",
  "scripts/stage-icims.mjs",
];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

// The bad shape is assembled from pieces so this file never spells it.
const MOD = ["import", "meta", "url"].join(".");
const PATHNAME = ["path", "name"].join("");
const BAD_ONE_LINE = `const REPO = new URL("../../../", ${MOD}).${PATHNAME};`;
const BAD_SPLIT = `const D = new URL(\n  "../data/",\n  ${MOD},\n)\n  .${PATHNAME};`;
const BAD_SELF = `const HERE = new URL(${MOD}).${PATHNAME};`;
const GOOD = `const REPO = fileURLToPath(new URL("../../../", ${MOD})).replace(/\\/$/, "");`;

describe("a file URL becomes a path through a decoder", () => {
  it("the shape matcher catches the shape on one line, split across lines, and on the module URL itself, and passes the decoded form", () => {
    for (const bad of [BAD_ONE_LINE, BAD_SPLIT, BAD_SELF]) expect(bad.match(SHAPE), bad).not.toBeNull();
    expect(GOOD.match(SHAPE)).toBeNull();
  });

  it("the pathname of a URL under a spaced folder is not a path; the decoder's answer is", () => {
    const here = "file:///Users/someone/New%20Folder%20With%20Items/repo/supabase/functions/x/y_test.ts";
    const up = new URL("../../../", here);
    expect(up.pathname).toBe("/Users/someone/New%20Folder%20With%20Items/repo/");
    expect(fileURLToPath(up)).toBe("/Users/someone/New Folder With Items/repo/");
  });

  it("no source file under supabase/functions, scripts, src, worker or tests takes a module-relative URL's pathname", () => {
    const files: string[] = [];
    for (const tree of TREES) walk(resolve(ROOT, tree), files);
    const read = new Set(files.map((f) => relative(ROOT, f)));

    // Precondition: the walk reached the trees and the files that once carried the shape.
    expect(files.length).toBeGreaterThan(2000);
    for (const rel of ONCE_BROKEN) expect(read.has(rel), `${rel} was not read`).toBe(true);

    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(SHAPE)) hits.push(`${relative(ROOT, file)}:${lineOf(text, m.index ?? 0)}`);
    }
    expect(
      hits,
      "a URL's pathname keeps %20 for a space; use fileURLToPath (node:url) or std's fromFileUrl",
    ).toEqual([]);
  });
});
