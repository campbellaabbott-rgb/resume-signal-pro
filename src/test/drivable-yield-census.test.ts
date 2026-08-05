/**
 * The census script's idea of "drivable" must match the worker's.
 *
 * `src/test/sendable-mirror.test.ts` already pins the edge bundle's
 * SENDABLE_VENDORS to the worker's ADAPTERS. This is the THIRD copy: a plain
 * .mjs script with no TypeScript pipeline, so it cannot import either.
 *
 * The cost of drift here is different from the other two and slower to notice.
 * A stale list does not break anything visibly — it aims a sweep at a vendor
 * the agent cannot apply to, and the output looks exactly like a successful
 * discovery run. That is a wasted corpus and a set of boards proposed for the
 * catalog on a premise that stopped being true.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";

const script = readFileSync(resolve(__dirname, "../../scripts/census-drivable-yield.mjs"), "utf8");

const declared = (() => {
  const m = script.match(/const DRIVABLE = \[([^\]]*)\]/);
  expect(m, "DRIVABLE is no longer declared as a literal array").toBeTruthy();
  return [...m![1]!.matchAll(/"([a-z0-9_-]+)"/g)].map((x) => x[1]!);
})();

describe("the census ranks exactly the vendors the agent can drive", () => {
  it("matches SENDABLE_VENDORS", () => {
    expect([...declared].sort()).toEqual([...SENDABLE_VENDORS].sort());
  });

  it("found something — an empty match would compare [] to [] and pass", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("carries a feed rule for every vendor it ranks", () => {
    // A vendor in DRIVABLE with no FEED entry is silently skipped in stage 2,
    // so it would rank as "no boards in this corpus" — a zero produced by a
    // missing branch, indistinguishable from a measurement.
    for (const v of declared) {
      expect(script, `no FEED entry for ${v}`).toMatch(new RegExp(`\\n\\s+${v}: \\{ path:`));
    }
  });
});

describe("the guards that stop a zero being mistaken for a finding", () => {
  it("refuses to run when a drivable vendor parses to zero boards", () => {
    // sources.ts holds TWO entry forms. Reading only the constructor form
    // parses ~12,000 entries — comfortably past any total-row floor — and
    // contains not one board for any of these four. The first version of this
    // script did exactly that and printed a table of zeros.
    expect(script).toMatch(/ZERO for \$\{vendor\}/);
  });

  it("parses both entry forms in sources.ts", () => {
    expect(script).toMatch(/\\bs\\\(/);            // s("Name", "vendor", "token")
    expect(script).toMatch(/name:\\s\*"/);         // { name: …, source: …, token: … }
  });

  it("divides by PRODUCING boards, not carried ones", () => {
    // 1,073 of 2,368 Personio boards produce nothing — stale tenants outside
    // the 30-day window, measured, not a bug. Dividing by carried boards would
    // report roughly half Personio's real yield and mis-rank the sweep.
    expect(script).toMatch(/perProducingBoard/);
    expect(script).toMatch(/producing\.length \? postings \/ producing\.length : 0/);
  });

  it("never reports an uncounted feed as a board with no jobs", () => {
    // Personio serves XML. `count: () => null` means "not counted", and a 0
    // would rank it last on evidence it never produced.
    expect(script).toMatch(/count: \(\) => null/);
    expect(script).toMatch(/jobs === null/);
  });

  it("reports the CNAMEs it could not fingerprint", () => {
    // 418 careers CNAMEs resolved on .de and 2 matched. Without the misses,
    // that reads as a fact about German employers instead of a fact about a
    // four-entry pattern table.
    expect(script).toMatch(/const misses = new Map\(\)/);
    expect(script).toMatch(/no fingerprint for/);
  });

  it("retries the facets RPC rather than printing zeros on one flake", () => {
    expect(script).toMatch(/attempt < 5/);
    expect(script).toMatch(/did not return a usable payload/);
  });
});
