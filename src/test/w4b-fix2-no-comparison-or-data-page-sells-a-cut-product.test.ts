// @vitest-environment node
/**
 * NO COMPARISON OR DATA PAGE SELLS A CUT PRODUCT (wave 4 round 2 recheck;
 * owner decision 2 of 2026-10-17 carried through).
 *
 * WHAT WAS WRONG. Round 1 (47d2b685) cleaned src/data/guides.ts and guarded
 * GUIDES only. /vs/teal, rendered by VsCompetitor.tsx and baked for crawlers
 * by the prerender from the same data, still counted "Freelance Boost for
 * project-based careers" among our "Dedicated products" and scored it a win,
 * while /freelance-boost says it is no longer sold.
 *
 * WHAT HOLDS NOW: no string in COMPETITORS, and no string literal in any
 * src/data file (the changelog, a dated record of what shipped, aside), names
 * a cut product; the row describes what is sold.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMPETITORS } from "@/data/competitors";

const CUT = /\b(?:Freelance Boost|Transition Pro|Career Path(?: Simulator)?|Keyword Fix|ATS Defense|Premium Package|Career Snapshot|Graduate Game Plan|Interview Coach|Scan Packs?|Resume Roast|Recruiter View|Elevator Pitch)\b/;
const DATA = resolve(__dirname, "../data");

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
};
/** The string literals of a source file, comments removed first. */
const literals = (src: string): string[] => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  return [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
};

describe("no comparison or data page sells a cut product", () => {
  it("no competitor row names one", () => {
    const bad = Object.values(COMPETITORS).flatMap((c) => strings(c).filter((s) => CUT.test(s)).map((s) => `${c.slug}: ${s}`));
    expect(bad).toEqual([]);
  });

  it("the Teal row describes what is sold", () => {
    const row = COMPETITORS.teal.rows.find((r) => /career-changer/i.test(r.dim));
    expect(row?.us).toMatch(/career-change bridge in every scan/);
    expect(row?.us).not.toMatch(/Dedicated products/);
  });

  it("no string literal in src/data names one", () => {
    const files = readdirSync(DATA).filter((n) => /\.tsx?$/.test(n) && n !== "changelog.ts");
    expect(files).toContain("competitors.ts");
    const bad = files.flatMap((n) => literals(readFileSync(join(DATA, n), "utf8")).filter((s) => CUT.test(s)).map((s) => `${n}: ${s.slice(0, 120)}`));
    expect(bad).toEqual([]);
  });
});
