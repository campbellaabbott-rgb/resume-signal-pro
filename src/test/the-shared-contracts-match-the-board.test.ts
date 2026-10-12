/**
 * THE COMPONENT CONTRACTS RE-DECLARE A FEW BOARD TYPES, AND MUST NOT DRIFT.
 *
 * src/components/jobs/contracts.ts cannot import src/pages/Jobs.tsx (circular,
 * and it would drag the board into every component's chunk), so it repeats
 * the verdict unions and the gated-record shape. These assertions are checked
 * by the type checker (`npm run typecheck` includes src/test): a union that
 * gains or loses a member on either side stops compiling. The runtime half
 * checks that no component module reaches into the page.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type * as Page from "@/pages/Jobs";
import type * as C from "@/components/jobs/contracts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>(_: T) => _;

assertType<Equal<C.HiringRecordVerdict, Page.HiringRecordVerdict>>(true);
assertType<Equal<C.GrowthVerdict, Page.GrowthVerdict>>(true);
assertType<Equal<C.GatedHiringRecord, Page.GatedHiringRecord>>(true);
// GrowthReading is a subset of the page's GrowthRow: every field but the
// (narrowed) verdict has the page's own type.
type GrowthKeys = Exclude<keyof C.GrowthReading, "verdict">;
type GrowthFieldsMatch = { [K in GrowthKeys]: Equal<C.GrowthReading[K], Page.GrowthRow[K]> }[GrowthKeys];
assertType<GrowthFieldsMatch>(true);

const ROOT = resolve(__dirname, "../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("no component or library module imports the board page", () => {
  const files = [...walk(resolve(ROOT, "src/components")), ...walk(resolve(ROOT, "src/lib"))];

  it("the sweep reads what it says", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("src/components/jobs/contracts.ts"))).toBe(true);
  });

  it("nothing under src/components or src/lib imports @/pages/Jobs", () => {
    const offenders = files.filter((f) => /from\s+["']@\/pages\/Jobs["']|import\(\s*["']@\/pages\/Jobs["']\s*\)/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
