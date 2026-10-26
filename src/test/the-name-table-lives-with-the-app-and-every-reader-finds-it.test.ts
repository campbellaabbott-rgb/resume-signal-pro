// @vitest-environment node
/**
 * THE NAME TABLE LIVES WITH THE APP, AND EVERY READER STILL FINDS IT
 * (trust/pages, merging oh/integration at 9005a76f, 2026-10-26).
 *
 * The mirror of company_name_overrides sat in the edge functions' shared
 * folder, imported by no edge function. Every file in that folder counts
 * toward every function's upload, comments included, and with this branch's
 * 88 names job-board's tally came to 174 bytes under its guard. It moved to
 * src/lib beside company-display.ts, its one importer in the app.
 *
 * A move like that can leave a reader looking at a path that no longer
 * exists. Section 76 reads the table's TEXT by path and prints INFO, not
 * FAIL, when it finds nothing, so a stale path would pass every deploy while
 * judging no name. Checked here: section 76 reads a file that exists and gets
 * exactly the module's table; no edge function imports the module (or the
 * deploy bundle would lack it); and the shared folder no longer holds a copy.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { EMPLOYER_NAME_OVERRIDES } from "../lib/employer-names";

const ROOT = resolve(__dirname, "../..");
const SECTION_76 = resolve(ROOT, "scripts/verify-deploy.d/76-wave3-seo-content.sh");
const FUNCTIONS = resolve(ROOT, "supabase/functions");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("the override table, after it left the shared folder", () => {
  const section = readFileSync(SECTION_76, "utf8");
  const path = /const overrides = new Map\(\[\.\.\.\(\(srcOf\("([^"]+)"\)/.exec(section)?.[1] ?? "";

  it("section 76 reads it from a file that exists", () => {
    expect(path, "section 76 no longer reads the override table through srcOf").not.toBe("");
    expect(existsSync(resolve(ROOT, path)), `section 76 reads ${path}, which does not exist`).toBe(true);
  });

  it("and its parser gets exactly the table the app and the bake use", () => {
    // Section 76's own two regexes, applied to the file it names.
    const text = readFileSync(resolve(ROOT, path), "utf8");
    const body = (text.match(/EMPLOYER_NAME_OVERRIDES[^=]*= new Map\(\[([\s\S]*?)\n\]\);/) || [])[1] || "";
    const parsed = new Map([...body.matchAll(/\["([^"]+)", "([^"]*)"\]/g)].map((m) => [m[1], m[2]]));
    expect(parsed.size).toBeGreaterThan(400);
    expect(Object.fromEntries([...parsed].sort())).toEqual(Object.fromEntries([...EMPLOYER_NAME_OVERRIDES].sort()));
  });

  it("no edge function imports it, so no deploy bundle is missing it", () => {
    const importers = filesUnder(FUNCTIONS)
      .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
      .filter((f) => /from\s+["'][^"']*employer-names(\.ts)?["']/.test(readFileSync(f, "utf8")));
    expect(importers.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it("the shared folder holds no second copy for the tally to count", () => {
    const shared = readdirSync(join(FUNCTIONS, "_shared"));
    expect(shared.filter((n) => /^employer-names/.test(n))).toEqual([]);
  });
});
