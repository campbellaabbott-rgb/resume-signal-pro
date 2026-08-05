/**
 * A COLLISION IS ONLY FATAL WHEN IT DOES NOT BUY REACH.
 *
 * The merge guard drops an incoming board whose employer name is already in the
 * catalog. That is right for a catalog judged on tidiness and wrong for one
 * judged on what the agent can act on: 38 of the 57 Pinpoint boards found on
 * 2026-08-05 collided with employers we ALREADY carried on a WALLED vendor.
 * Accenture, Next and HelloFresh publish to Pinpoint and to Workday, and we
 * were keeping the Workday copy — the one the agent can never apply to.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const merge = readFileSync(resolve(__dirname, "../../scripts/merge-all.mjs"), "utf8");
const code = merge.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the merge prefers a drivable vendor on collision", () => {
  it("admits a colliding board only when it buys reach", () => {
    expect(code).toMatch(/const buysReach = DRIVABLE\.has\(vendor\) && \[\.\.\.carriers\]\.every\(\(v\) => !DRIVABLE\.has\(v\)\)/);
    expect(code).toMatch(/if \(!buysReach\) \{ dropped\.nameCollision\+\+; continue; \}/);
  });

  it("still drops a collision that buys nothing", () => {
    // Two boards on the SAME walled vendor must not both enter just because the
    // rule loosened. The `every` is what keeps that true.
    expect(code).not.toMatch(/DRIVABLE\.has\(vendor\)\s*\)\s*\{\s*dropped\.collisionAdmitted/);
  });

  it("never replaces the existing entry", () => {
    // Dropping the walled token would orphan-prune its postings — a Workday
    // board can carry hundreds against Pinpoint's handful, so the board would
    // shrink to make the agent look better and trip the high-water guard.
    expect(code).not.toMatch(/existingTokens\.delete|splice\(|filter\(\(e\) => e\.name/);
  });

  it("counts what it admitted, so the change is visible in the run output", () => {
    expect(code).toMatch(/collisionAdmittedForReach/);
  });
});

describe("DRIVABLE does not drift from the rest of the system", () => {
  it("matches the vendor list agent_reach() measures", () => {
    // This script is Node and the RPC is SQL, so the two lists can only be kept
    // in step by an assertion. If reach gains a vendor and this does not, every
    // future census silently drops boards for the new one.
    const m = code.match(/const DRIVABLE = new Set\(\[([^\]]+)\]\)/);
    expect(m, "DRIVABLE not found").toBeTruthy();
    const here = new Set([...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]));

    const migDir = resolve(__dirname, "../../supabase/migrations");
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const f = readdirSync(migDir).filter((x) => x.endsWith(".sql"))
      .filter((x) => readFileSync(resolve(migDir, x), "utf8").includes("v_vendors")).sort().pop()!;
    const sql = readFileSync(resolve(migDir, f), "utf8");
    const arr = sql.slice(sql.indexOf("v_vendors"));
    const there = new Set([...arr.slice(0, arr.indexOf(";")).matchAll(/'([a-z]+)'/g)].map((x) => x[1]));

    expect(there.size, `parsed no vendors from ${f}`).toBeGreaterThan(0);
    expect([...here].sort(), `merge-all DRIVABLE disagrees with ${f}`).toEqual([...there].sort());
  });
});
