import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A CAP IS NOT A COUNT — IN THE RAIL EITHER.
 *
 * The board's counters stop at COUNT_CAP and the list header has said
 * "10,000+" since the cap shipped. The per-field counts did not: with one
 * filter active, the industry chips and the "All fields" dropdown printed the
 * capped value bare — "Operations & Logistics 10,000" beside an unfiltered
 * 161,294 (measured live 2026-09-03 23:30Z, click-through of every control).
 *
 * The capped counter returns EXACTLY the cap, so equality identifies a capped
 * value with no new plumbing; >= would relabel real unfiltered totals. The
 * client mirrors the server constant, and this guard keeps them equal across
 * runtimes (the "no subscriptions" incident: copy went false when the thing it
 * described moved).
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SERVER = strip(read("supabase/functions/job-board/index.ts"));
const JOBS = strip(read("src/pages/Jobs.tsx"));
const MULTI = strip(read("src/components/board/MultiSelectFilter.tsx"));
const num = (src: string, name: string) => Number(src.match(new RegExp(`const ${name} = ([0-9_]+);`))![1].replace(/_/g, ""));

describe("a cap is not a count — in the rail either", () => {
  it("the client mirrors the server's COUNT_CAP exactly", () => {
    expect(num(JOBS, "BOARD_COUNT_CAP")).toBe(num(SERVER, "COUNT_CAP"));
  });

  it("a capped value is recognised by EQUALITY, never by >=", () => {
    expect(JOBS).toMatch(/const fmtFacet = \(n: number\) => \(n === BOARD_COUNT_CAP \? `\$\{n\.toLocaleString\(\)\}\+` : n\.toLocaleString\(\)\);/);
    expect(JOBS).not.toMatch(/n >= BOARD_COUNT_CAP/);
  });

  it("every category count the rail prints goes through fmtFacet", () => {
    // .36: the rail reads railCounts (filteredCats ?? data.categories) so it survives other filters.
    // .37: and a count the server's facet deadline never produced prints NOTHING
    // rather than a zero — see an-uncounted-industry-is-not-an-empty-one.
    expect(JOBS).toMatch(/\{typeof n === "number" && <span className="opacity-70">\{fmtFacet\(n\)\}<\/span>\}/);
    expect(JOBS).toMatch(/\{fmtFacet\(n as number\)\}/);
    expect(JOBS, "a bare category count survived").not.toMatch(/\(data\?\.categories\?\.\[c\] \?\? 0\)\.toLocaleString\(\)/);
    expect(JOBS, "a bare category count survived").not.toMatch(/\(n as number\)\.toLocaleString\(\)/);
  });

  it("the dropdown carries the flag and renders the plus", () => {
    expect(JOBS).toMatch(/capped: \(filteredCats\?\.\[c\] \?\? data\?\.categories\?\.\[c\]\) === BOARD_COUNT_CAP,/);
    expect(MULTI).toMatch(/count\?: number; capped\?: boolean/);
    expect(MULTI).toMatch(/\{o\.count\.toLocaleString\(\)\}\{o\.capped \? "\+" : ""\}/);
  });
});
