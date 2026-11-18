// @vitest-environment node
//
// Node, not jsdom: this file runs a verifier block in bash through
// child_process.
/**
 * THE CENSUS LINE FAILS WHILE A CLIENT-CALLABLE DEFINER IS ON NO LIST
 * (S14X-094).
 *
 * Section 40 reads client_callable_census() with the publishable key. When
 * the census counted SECURITY DEFINER functions a stranger can call that no
 * list names, the section printed INFO and the run stayed green: two such
 * functions were live on 2026-11-15, and every deploy check passed. The
 * census block is cut out of scripts/verify-deploy.d/40-db-exposure.sh and
 * run in bash with R answering a fixture in the live shape:
 *   - two unlisted: the line is a FAIL that gives the count and says how the
 *     owner names them (admin-ops client_callable_unlisted_names);
 *   - none unlisted: the PASS stays (the positive control);
 *   - an answer without the count: a FAIL, never a quiet INFO;
 *   - every other census line keeps its verdict.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/40-db-exposure.sh"), "utf8");
/** From the census read to the blank line that ends its block. */
const BLOCK = (() => {
  const start = SECTION.indexOf("R client_callable_census");
  if (start < 0) throw new Error("section 40 has no census read");
  const end = SECTION.indexOf("\n\n", start);
  return SECTION.slice(start, end < 0 ? undefined : end);
})();

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function run(census: unknown): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd40c-"));
  dirs.push(dir);
  writeFileSync(join(dir, "census.json"), typeof census === "string" ? census : JSON.stringify(census));
  const prelude = `set -u\nK=pk_test; B=https://p.supabase.co\nR() { cat ${JSON.stringify(join(dir, "census.json"))}; }\n`;
  writeFileSync(join(dir, "run.sh"), prelude + BLOCK.split("/tmp/").join(`${dir}/`));
  const out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  return out.split("\n").filter(Boolean);
}

// client_callable_census as anon on 2026-11-15T22:12Z, lists emptied as they were.
const LIVE = {
  closed: 56, definers: 294, allowlisted: 64, closed_missing: 0, client_callable: 66,
  closed_still_callable: [], request_address_source: "cf", allowlisted_not_callable: [],
  closed_tables_still_open: [], unlisted_client_callable: 2, signed_in_only_open_to_anon: [],
};
const line = (lines: string[]) => lines.find((l) => /client-callable definer function/.test(l)) ?? "";

describe("section 40's census line", () => {
  it("is a FAIL while two client-callable definers are on no list, and says how the owner names them", () => {
    const lines = run(LIVE);
    const l = line(lines);
    expect(l, lines.join("\n")).toMatch(/^FAIL {2}2 client-callable definer function\(s\) appear in no list/);
    expect(l).toMatch(/66 of 294 definers are client-callable/);
    expect(l).toMatch(/admin-ops client_callable_unlisted_names names them/);
    expect(lines.filter((x) => x.startsWith("INFO")), "the count is never only a note").toEqual([]);
  });

  it("passes when the census counts none (the positive control)", () => {
    const lines = run({ ...LIVE, unlisted_client_callable: 0 });
    expect(line(lines), lines.join("\n")).toBe("PASS  no client-callable definer function outside the lists (66 client-callable of 294 definers)");
    expect(lines.filter((x) => x.startsWith("FAIL")), lines.join("\n")).toEqual([]);
  });

  it("is a FAIL when the answer carries no count at all", () => {
    const noCount: Record<string, unknown> = { ...LIVE };
    delete noCount.unlisted_client_callable;
    const l = line(run(noCount));
    expect(l).toMatch(/^FAIL /);
  });

  it("leaves every other census verdict as it was", () => {
    const lines = run(LIVE);
    for (const re of [/^PASS {2}the census names 56 closed signatures, 0 missing/, /^PASS {2}no closed function is callable/, /^PASS {2}PostgREST hands SQL the address of the caller/]) {
      expect(lines.some((l) => re.test(l)), `${re}\n${lines.join("\n")}`).toBe(true);
    }
    expect(run('{"code":"PGRST202"}')[0]).toMatch(/^FAIL {2}client_callable_census as anon/);
  });
});
