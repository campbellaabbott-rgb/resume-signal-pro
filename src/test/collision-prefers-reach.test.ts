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
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";

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
  it("matches the vendor list the product publishes", () => {
    // This script is Node and cannot import the Deno shared module, so the two
    // lists can only be kept in step by an assertion. If reach gains a vendor
    // and this does not, every future census silently drops boards for it.
    //
    // ANCHORED ON SENDABLE_VENDORS, not on SQL. It used to parse
    // agent_reach()'s ARRAY[...] out of a migration; that function was dropped
    // 2026-08-06 because it could never answer, and its copy of this list sat
    // in a SQL body no test could reach. sendable-mirror.test.ts pins
    // SENDABLE_VENDORS to the worker's actual adapters, so this now chains to
    // the registry that decides what really gets driven.
    const m = code.match(/const DRIVABLE = new Set\(\[([^\]]+)\]\)/);
    expect(m, "DRIVABLE not found").toBeTruthy();
    const here = [...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);

    expect(here.length, "parsed no vendors from merge-all").toBeGreaterThan(0);
    expect(SENDABLE_VENDORS.length, "parsed no vendors from the shared list").toBeGreaterThan(0);
    expect([...here].sort(), "merge-all DRIVABLE disagrees with SENDABLE_VENDORS")
      .toEqual([...SENDABLE_VENDORS].sort());
  });});


// ── D6 (2026-11-08): size, identity and overlap ─────────────────────────────

const ROOT = resolve(__dirname, "../..");
const CARRIED = [
  "export const JOB_SOURCES = [",
  '  { name: "Visa", source: "smartrecruiters", token: "visa" },',
  '  { name: "Thales", source: "smartrecruiters", token: "thales" },',
  '  { name: "Thales", source: "lever", token: "thalesgroup" },',
  '  { name: "Alliance", source: "breezy", token: "alliance" },',
  '  { name: "Denver", source: "bamboohr", token: "denver" },',
  '  { name: "Global", source: "lever", token: "global" },',
  '  { name: "Emerson", source: "workday", token: "emerson~wd1~Emerson" },',
  '  { name: "Amgen", source: "lever", token: "amgen" },',
  "];",
  "",
].join("\n");
const SAMPLE = [{ t: "Data Engineer", c: "Austin" }, { t: "Nurse", c: "Leeds" }, { t: "Analyst", c: "Paris" }];

/** One merge in a scratch checkout: its log, and the catalogue it left. */
function runMerge(script: "merge-all" | "merge-oracle", input: unknown, extra: { counts?: Record<string, number>; postings?: Record<string, unknown[]>; args?: string[] } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "d6-")));
  try {
    mkdirSync(join(dir, "supabase/functions/job-board"), { recursive: true });
    writeFileSync(join(dir, "supabase/functions/job-board/sources.ts"), CARRIED);
    writeFileSync(join(dir, "in.json"), JSON.stringify(input));
    const args = [resolve(ROOT, `scripts/${script}.mjs`), "in.json"];
    if (extra.counts) { writeFileSync(join(dir, "counts.json"), JSON.stringify(extra.counts)); args.push("--carrier-counts", "counts.json"); }
    if (extra.postings) { writeFileSync(join(dir, "postings.json"), JSON.stringify(extra.postings)); args.push("--carrier-postings", "postings.json"); }
    args.push(...(extra.args ?? []));
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" } });
    return { status: r.status, log: r.stdout + r.stderr, after: readFileSync(join(dir, "supabase/functions/job-board/sources.ts"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const hit = (token: string, name: string, inWindow30: number, more: Record<string, unknown> = {}) =>
  ({ token, name, count: inWindow30, inWindow30, dateBasis: "postedOn", sample: SAMPLE, ...more });

describe("D6: a collision that buys no reach may still buy size", () => {
  it("admits a board whose in-window count is at least twice what the carrier serves, and keeps the carrier", () => {
    const r = runMerge("merge-all", { workday: [hit("visa~wd5~Jobs", "Visa", 60)] }, { counts: { visa: 30 }, postings: { "smartrecruiters:visa": [] }, args: ["--apply"] });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/"collisionAdmittedForSize":1/);
    expect(r.log).toContain("smartrecruiters:visa serves 30");
    expect(r.after).toContain('{ name: "Visa", source: "workday", token: "visa~wd5~Jobs" }');
    expect(r.after, "the smaller board is never retired").toContain('{ name: "Visa", source: "smartrecruiters", token: "visa" }');
  });

  it("drops one under twice, as a collision", () => {
    const r = runMerge("merge-all", { workday: [hit("visa~wd5~Jobs", "Visa", 59)] }, { counts: { visa: 30 }, postings: { "smartrecruiters:visa": [] } });
    expect(r.log).toMatch(/"nameCollision":1/);
    expect(r.log).not.toMatch(/collisionAdmittedForSize/);
  });

  it("prints every carrier's size and judges against their sum", () => {
    const r = runMerge("merge-all", { workday: [hit("thales~wd3~Careers", "Thales", 100)] }, { counts: { thales: 20, thalesgroup: 31 } });
    expect(r.log).toContain("smartrecruiters:thales serves 20, lever:thalesgroup serves 31");
    expect(r.log).toMatch(/"nameCollision":1/);
  });

  it("holds a board whose carrier's count cannot be read, never reading it as zero", () => {
    const r = runMerge("merge-all", { workday: [hit("amgen~wd1~Careers", "Amgen", 500)] }, { counts: {} });
    expect(r.log).toMatch(/"collisionHeld":1/);
    expect(r.log).toContain("lever:amgen serves unread");
    expect(r.log).not.toMatch(/collisionAdmittedForSize/);
  });

  it("holds a size admission whose postings the carrier already serves above 30%", () => {
    const served = [{ t: "Data Engineer", c: "Austin" }, { t: "Nurse", c: "Leeds" }];
    const r = runMerge("merge-all", { workday: [hit("visa~wd5~Jobs", "Visa", 600)] }, { counts: { visa: 30 }, postings: { "smartrecruiters:visa": served } });
    expect(r.log).toMatch(/"collisionHeld":1/);
    expect(r.log).toContain("67% of 3 sampled postings already served (by title and city)");
  });

  it("holds a size admission with no sample of its own to compare", () => {
    const r = runMerge("merge-all", { workday: [{ token: "visa~wd5~Jobs", name: "Visa", count: 600, inWindow30: 600, dateBasis: "postedOn" }] }, { counts: { visa: 30 }, postings: { "smartrecruiters:visa": [] } });
    expect(r.log).toMatch(/"collisionHeld":1/);
    expect(r.log).toContain("no sample of its own postings to compare");
  });
});

describe("D6: a shared name is not always a shared employer", () => {
  it("holds a generic name that its own data does not tell apart", () => {
    // (Global is a generic word the census name rule holds before D6 sees it.)
    const r = runMerge("merge-all", { lever: [hit("alli", "Alliance", 900), hit("denv", "Denver", 900), hit("emersonx", "Emerson", 900)] }, { counts: { alliance: 1, denver: 1, "emerson~wd1~emerson": 1 } });
    expect(r.log).toMatch(/"collisionHeld":3/);
    for (const n of ["Alliance", "Denver", "Emerson"]) expect(r.log).toContain(`"${n}" is a generic name`);
  });

  it("does not hold a short real name: Visa, Thales and Amgen are judged by size", () => {
    const r = runMerge("merge-all", { workday: [hit("visa~wd5~Jobs", "Visa", 3), hit("amgen~wd1~Careers", "Amgen", 3)] }, { counts: { visa: 30, amgen: 30 } });
    expect(r.log).not.toMatch(/generic name/);
    expect(r.log).toMatch(/"nameCollision":2/);
  });

  it("merges a board under the name its own data gives it, beside the carrier of the shared one", () => {
    const r = runMerge("merge-all", { greenhouse: [{ token: "emersonelectric", name: "Emerson", distinctName: "Emerson Electric", count: 40 }] }, { args: ["--apply"] });
    expect(r.status, r.log).toBe(0);
    expect(r.after).toContain('{ name: "Emerson Electric", source: "greenhouse", token: "emersonelectric" }');
    expect(r.after).toContain('{ name: "Emerson", source: "workday", token: "emerson~wd1~Emerson" }');
  });

  it("holds a board whose own name is carried too", () => {
    const r = runMerge("merge-all", { greenhouse: [{ token: "denverhealth", name: "Denver", distinctName: "Amgen", count: 40 }] });
    expect(r.log).toMatch(/"collisionHeld":1/);
    expect(r.log).toContain('its own name "Amgen" is carried too');
  });

  it("merge-oracle judges a collision by the same rule", () => {
    const r = runMerge("merge-oracle", { resolved: [
      { name: "Emerson", token: "hdjq~us2~CX_1", count: 900, distinctName: "Emerson Electric" },
      { name: "Emerson Careers", token: "zzzz~us2~CX_1", count: 900 },
      { name: "Thales", token: "thal~eu1~CX_1", count: 10 },
    ] }, { counts: { thales: 20, thalesgroup: 31 }, args: ["--cap", "0"] });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toContain('"Emerson" (hdjq~us2~CX_1) names itself "Emerson Electric" in its own data');
    expect(r.log).toMatch(/held for review collisionHeld: 1 — Emerson \(zzzz~us2~CX_1\): "Emerson" is a generic name/);
    expect(r.log).toContain("smartrecruiters:thales serves 20, lever:thalesgroup serves 31: dropped");
  });
});
