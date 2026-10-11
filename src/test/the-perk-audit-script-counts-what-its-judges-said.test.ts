// @vitest-environment node
/**
 * THE PERK AUDIT SCRIPT COUNTS WHAT ITS JUDGES SAID, AND SENDS NOTHING ELSE.
 *
 * scripts/perk-audit.mjs turns a judged review file into the calls that
 * publish or unpublish a perk key (through employer-profiles, with the
 * owner's key). The arithmetic is the whole safety of D2 and D19, so it is
 * run here, not read:
 *   - a row is right only if every judge said right; the owner's word, where
 *     the owner checked a row, overrides the judges; an unjudged row stops
 *     the whole file;
 *   - a launch publishes at 57 of 60 and only with at least 10 owner-checked
 *     rows; 56 of 60 records an unpublish; fewer than 60 rows records nothing;
 *   - a monthly re-audit under 57 of 60 pooled pauses every perk first, then
 *     records each key's stratum (at least 5 rows), where two wrong unpublish;
 *   - the script's candidate list is the extractor's, and a drawn row reaches
 *     the judge with its employer, quote, link and spot check, undecided.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANDIDATE_KEYS, LAUNCH_ROWS, OWNER_CHECKS_PER_KEY, passesLaunch, planRecord, reviewRow, rowVerdict, tally,
} from "../../scripts/perk-audit.mjs";
import { CANDIDATE_KEYS as EXTRACTOR_CANDIDATES } from "../../supabase/functions/_shared/perks-extract";

type Row = { perk: string; judges?: Array<{ by?: string; correct: boolean }>; owner?: boolean | null; verdict?: boolean };
const judged = (perk: string, right: boolean, owner?: boolean): Row =>
  ({ perk, judges: [{ by: "judge-a", correct: right }, { by: "judge-b", correct: right }], owner: owner ?? null });
const launchFile = (perk: string, wrong: number, ownerChecked: number, total = 60) => ({
  mode: "launch", perk, drawnAt: "2026-10-13T10:00:00Z",
  rows: Array.from({ length: total }, (_, i) => judged(perk, i >= wrong, i >= total - ownerChecked ? true : undefined)),
});

describe("one row's verdict", () => {
  it("is right only when every judge says right, and the owner's word overrides", () => {
    expect(rowVerdict({ perk: "health", judges: [{ correct: true }, { correct: true }] })).toBe(true);
    expect(rowVerdict({ perk: "health", judges: [{ correct: true }, { correct: false }] })).toBe(false);
    expect(rowVerdict({ perk: "health", judges: [{ correct: false }], owner: true })).toBe(true);
    expect(rowVerdict({ perk: "health", judges: [{ correct: true }], owner: false })).toBe(false);
    expect(rowVerdict({ perk: "health", judges: [] })).toBeNull();
    expect(rowVerdict({ perk: "health", owner: null })).toBeNull();
  });
});

describe("a launch file", () => {
  it("57 of 60 with 10 owner checks publishes", () => {
    const plan = planRecord(launchFile("health", 3, OWNER_CHECKS_PER_KEY));
    expect(plan.error).toBeUndefined();
    expect(plan.publishes).toBe(true);
    expect(plan.calls).toEqual([expect.objectContaining({ action: "audit_record", perk: "health", mode: "launch", judged: 60, correct: 57 })]);
  });

  it("56 of 60 is recorded, and unpublishes", () => {
    const plan = planRecord(launchFile("health", 4, OWNER_CHECKS_PER_KEY));
    expect(plan.publishes).toBe(false);
    expect(plan.calls?.[0]).toMatchObject({ judged: 60, correct: 56 });
  });

  it("a pass without 10 owner-checked rows is not sent", () => {
    expect(planRecord(launchFile("health", 0, OWNER_CHECKS_PER_KEY - 1)).error).toMatch(/owner has checked 9 rows/);
  });

  it("fewer than 60 rows, an unjudged row, or a second key: nothing is sent", () => {
    expect(planRecord(launchFile("health", 0, 10, 59)).error).toMatch(/at least 60/);
    const f = launchFile("health", 0, 10);
    f.rows[7] = { perk: "health", judges: [], owner: null };
    expect(planRecord(f).error).toMatch(/rows 8 carry no verdict/);
    const g = launchFile("health", 0, 10);
    g.rows[0] = judged("dental", true);
    expect(planRecord(g).error).toMatch(/judges one key/);
  });

  it("the threshold is the database's: at most one wrong in twenty, over at least 60", () => {
    expect(passesLaunch(60, 57)).toBe(true);
    expect(passesLaunch(60, 56)).toBe(false);
    expect(passesLaunch(59, 59)).toBe(false);
    expect(passesLaunch(80, 76)).toBe(true);
    expect(LAUNCH_ROWS).toBe(60);
  });
});

describe("a monthly re-audit file", () => {
  const reaudit = (wrongByKey: Record<string, number>, perKey = 10) => ({
    mode: "reaudit", drawnAt: "2026-11-13T10:00:00Z",
    rows: Object.entries(wrongByKey).flatMap(([perk, wrong]) => Array.from({ length: perKey }, (_, i) => judged(perk, i >= wrong))),
  });

  it("under 57 of 60 pooled pauses every perk before recording each stratum", () => {
    const plan = planRecord(reaudit({ health: 2, dental: 1, vision: 1, retire: 0, pto: 0, parental: 0 }));
    expect(plan.pooled).toEqual({ judged: 60, correct: 56, paused: true });
    expect(plan.calls?.[0]).toMatchObject({ action: "audit_pause", publish: true });
    expect(plan.calls?.slice(1).map((c: { perk: string; correct: number }) => [c.perk, c.correct])).toEqual([
      ["health", 8], ["dental", 9], ["vision", 9], ["retire", 10], ["pto", 10], ["parental", 10],
    ]);
  });

  it("57 of 60 pooled pauses nothing, and still records each stratum", () => {
    const plan = planRecord(reaudit({ health: 1, dental: 1, vision: 1, retire: 0, pto: 0, parental: 0 }));
    expect(plan.pooled?.paused).toBe(false);
    expect(plan.calls?.every((c: { action: string }) => c.action === "audit_record")).toBe(true);
  });

  it("a stratum under 5 rows is not sent", () => {
    expect(planRecord(reaudit({ health: 0 }, 4)).error).toMatch(/needs at least 5/);
  });
});

describe("the script's lists and rows", () => {
  it("names the extractor's candidate keys, no more and no fewer", () => {
    expect([...CANDIDATE_KEYS].sort()).toEqual([...EXTRACTOR_CANDIDATES].sort());
  });

  it("a drawn row reaches the judge with its employer, claim, quote, link and spot check, undecided", () => {
    const r = reviewRow({
      source: "greenhouse", company_token: "acme", country: "US", k: 6, n: 6, employer: "Acme",
      quote: "Medical, dental and vision insurance", quote_title: "Engineer", quote_link: "https://jobs.example.com/1",
      spot_check: [{ title: "Engineer 2", link: "https://jobs.example.com/2", quote: "Medical, dental and vision insurance" }],
    }, "health");
    expect(r).toMatchObject({
      perk: "health", employer: "Acme", claim: "health: stated in at least 6 of 6 open US postings we could read",
      quote: "Medical, dental and vision insurance", postingLink: "https://jobs.example.com/1", judges: [], owner: null,
    });
    expect(r.spotCheck).toHaveLength(1);
    expect(rowVerdict(r)).toBeNull();
    expect(tally({ rows: [r] }).unjudged).toEqual([1]);
  });

  it("never prints or sends the owner's key anywhere but its header", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/perk-audit.mjs"), "utf8");
    expect(src).toMatch(/"x-admin-key": adminKey\(\)/);
    expect(src).not.toMatch(/console\.(log|error)\([^)]*adminKey/);
    expect(src).toMatch(/functions\/v1\/employer-profiles/);
    expect(src, "the script asks only the function, never an RPC").not.toMatch(/rest\/v1\/rpc|\.rpc\(/);
  });
});
