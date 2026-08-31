import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A MILL BANNED BY EVIDENCE NEARLY CAME BACK FIVE DAYS LATER.
 *
 * 2026-08-10: three Workable boards were convicted by a description screen —
 * placement ads, on-behalf language — and dropped from a merge by hand.
 * 2026-08-30: Workable throttled descriptions again, the mill screen degraded
 * to its titles-only fallback, and it CLEARED two of the same three boards.
 * Nothing in the pipeline remembered the conviction, because the ban had only
 * ever lived in a human decision on a particular Tuesday.
 *
 * The fix is MILL_BLOCK in merge-all.mjs: a token-keyed set consulted before
 * any screen result, so a conviction survives the screen that produced it.
 * This test pins the set's existence, its enforcement, and the three boards
 * whose return trip motivated it.
 */
const MERGE = readFileSync(
  resolve(__dirname, "../../scripts/merge-all.mjs"),
  "utf8",
);

describe("a mill banned once stays banned", () => {
  it("keeps a durable token blocklist", () => {
    expect(MERGE).toMatch(/const MILL_BLOCK = new Set\(\[/);
  });

  it("consults it in the drop loop, counted under its own reason", () => {
    // A drop folded into blockedName would be invisible in the merge output;
    // a conviction must say it is one.
    expect(MERGE).toMatch(
      /if \(MILL_BLOCK\.has\(tokenKey\)\) \{ dropped\.confirmedMill/,
    );
  });

  it("holds the JUNK ledger — the agency convictions were released by charter", () => {
    // 2026-08-31: the operator widened the board to CARRY staffing agencies,
    // so the 2026-08-10 agency convictions (solution-sft, gotham, ubteam and
    // the rest) were deliberately released — that was a policy reversal, not
    // a screen failure. What must never leave this set is the junk: boards
    // whose postings are not real openings under ANY charter — duplicate-
    // title spam and the double-counting all-jobs board. A titles-only
    // degradation must still never re-admit those.
    const set = /const MILL_BLOCK = new Set\(\[[\s\S]*?\]\);/.exec(MERGE)?.[0] ?? "";
    expect(set, "MILL_BLOCK not found").not.toBe("");
    expect(set).toContain('"workable:next-job-abroad"');
    expect(set).toContain('"rippling:barrys-careers"');
    expect(set).toContain('"greenhouse:n2alljobs"');
    expect(set, "agency convictions are RELEASED — re-adding one reverses the charter").not.toContain('"workable:ubteam"');
  });

  it("blocks by vendor-qualified token, never by name", () => {
    // Names get cleaned up, translated and re-resolved; tokens do not. A ban
    // keyed on anything that drifts is a ban that expires silently.
    const set = /const MILL_BLOCK = new Set\(\[[\s\S]*?\]\);/.exec(MERGE)?.[0] ?? "";
    for (const entry of set.matchAll(/"([^"]+)"/g)) {
      expect(entry[1]).toMatch(/^[a-z]+:[a-z0-9._-]+$/i);
    }
  });
});
