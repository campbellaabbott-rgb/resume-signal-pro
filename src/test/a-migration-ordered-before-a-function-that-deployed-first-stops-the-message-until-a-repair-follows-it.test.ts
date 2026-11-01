// @vitest-environment node
/**
 * A MIGRATION ORDERED BEFORE A FUNCTION THAT DEPLOYED FIRST STOPS THE MESSAGE
 * UNTIL A REPAIR FOLLOWS IT (2026-10-31, review of fix/name-sync-rerun).
 *
 * The ledger ordered 20261025100000 and 20261026100000 `before: fn:job-board`.
 * Lovable deployed job-board .96 without them, and the next --draft still
 * printed "(before job-board)" beside both, in a message that deploys no
 * function: a step that can never be met, and no check noticed that the
 * order had already broken (the .96 lane ran version 6 without their names).
 *
 * Now a `before` whose function already answers main's build (or a later one)
 * is an error that stops the message (exit 6), unless the entry names the
 * pending migration that repairs it, `repairedBy`, ordered after it by its
 * own afterMigrations. Then the note says what is true: the function already
 * answers that build, it deployed first, and which file repairs that. A
 * function this message deploys keeps "before <fn>".
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const POLICY = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const fileOf = (stamp: string) => {
  const f = readdirSync(MIG_DIR).find((m) => m.startsWith(`${stamp}_`));
  if (!f) throw new Error(`no migration ${stamp}`);
  return f;
};

type Row = { fn: string; want: string | null; have: string | null; state: string };
const jb = (have: string | null, want = "job-board.2026-09-09.96", state = L.rowState(want, have)): Row[] => [{ fn: "job-board", want, have, state }];
const LIVE = jb("job-board.2026-09-09.96");
const a = "20261025100000_a.sql", b = "20261026100000_b.sql", n = "20261030100000_n.sql";
const P = (order: Record<string, unknown>) => ({ migrationOrder: order, holdUntilVerified: [], neverApply: [] });
const REPAIRED = P({
  "20261025100000": { before: ["fn:job-board"], repairedBy: "20261030100000" },
  "20261026100000": { before: ["fn:job-board"], repairedBy: "20261030100000" },
  "20261030100000": { afterMigrations: ["20261025100000", "20261026100000"] },
});

describe("a before rule whose function already answers main's build", () => {
  it("is an error that names the function and its live build, and the note no longer says 'before job-board'", () => {
    const p = L.migrationPhases([a], P({ "20261025100000": { before: ["fn:job-board"] } }), LIVE);
    expect(p.errors).toEqual([
      `${a} must apply before job-board, but job-board already answers job-board.2026-09-09.96 and this message deploys none: it deployed first. Name the pending migration that repairs that (migrationOrder 20261025100000 repairedBy, ordered after it by its afterMigrations), or drop the rule if it waits for a build main does not carry yet`,
    ]);
    expect(p.pre[0].note).toBe("job-board already answers job-board.2026-09-09.96: it deployed first");
  });

  it("a live-ahead function deployed first too", () => {
    const p = L.migrationPhases([a], P({ "20261025100000": { before: ["fn:job-board"] } }), jb("job-board.2026-09-09.97"));
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toMatch(/job-board already answers job-board\.2026-09-09\.97 and this message deploys none: it deployed first/);
  });

  it("with a pending repair ordered after it, the message names the repair and stops for nothing", () => {
    const p = L.migrationPhases([a, b, n], REPAIRED, LIVE);
    expect(p.errors).toEqual([]);
    expect(p.pre.map((m: { file: string; note: string }) => [m.file, m.note])).toEqual([
      [a, "job-board already answers job-board.2026-09-09.96: it deployed first, and 20261030100000 repairs that"],
      [b, "job-board already answers job-board.2026-09-09.96: it deployed first, and 20261030100000 repairs that"],
      [n, "after 20261025100000 and 20261026100000; it waits for nothing else"],
    ]);
  });

  it("a repair that is not pending repairs nothing in this message", () => {
    const p = L.migrationPhases([a, b], REPAIRED, LIVE);
    expect(p.errors).toEqual([
      `${a} must apply before job-board, but job-board already answers job-board.2026-09-09.96, and its repairedBy 20261030100000 is not pending, so nothing in this message repairs that`,
      `${b} must apply before job-board, but job-board already answers job-board.2026-09-09.96, and its repairedBy 20261030100000 is not pending, so nothing in this message repairs that`,
    ]);
  });

  it("a function this message deploys keeps 'before <fn>', and an unread one too", () => {
    const deploying = L.migrationPhases([a, b, n], REPAIRED, jb("job-board.2026-09-09.92"));
    expect(deploying.errors).toEqual([]);
    expect(deploying.pre[0].note).toBe("before job-board");
    const alone = L.migrationPhases([a], P({ "20261025100000": { before: ["fn:job-board"] } }), jb("job-board.2026-09-09.92"));
    expect(alone.errors).toEqual([]);
    expect(alone.pre[0].note).toBe("before job-board");
    const unread = L.migrationPhases([a], P({ "20261025100000": { before: ["fn:job-board"] } }), jb(null, "job-board.2026-09-09.96", "unreachable"));
    expect(unread.errors).toEqual([]);
    expect(unread.pre[0].note).toBe("before job-board");
  });
});

describe("repairedBy is checked as a rule", () => {
  const err = (order: Record<string, unknown>) => L.migrationPhases([], P(order), LIVE).errors;

  it("is one 14-digit stamp", () => {
    expect(err({ "20261025100000": { before: ["fn:job-board"], repairedBy: ["20261030100000"] } }))
      .toEqual(["migrationOrder 20261025100000: repairedBy must be one 14-digit migration stamp"]);
  });

  it("repairs a before rule, so an entry without one is an error", () => {
    expect(err({ "20261025100000": { repairedBy: "20261030100000" }, "20261030100000": { afterMigrations: ["20261025100000"] } }))
      .toEqual(["migrationOrder 20261025100000: repairedBy names 20261030100000, but the entry has no before rule for it to repair"]);
  });

  it("names a migration whose afterMigrations names this one, or the repair could apply first", () => {
    expect(err({ "20261025100000": { before: ["fn:job-board"], repairedBy: "20261030100000" } }))
      .toEqual(["migrationOrder 20261025100000: repairedBy names 20261030100000, whose afterMigrations does not name 20261025100000, so it could apply first"]);
    expect(err({ "20261025100000": { before: ["fn:job-board"], repairedBy: "20261030100000" }, "20261030100000": { afterMigrations: ["20261026100000"] } }))
      .toEqual(["migrationOrder 20261025100000: repairedBy names 20261030100000, whose afterMigrations does not name 20261025100000, so it could apply first"]);
  });
});

describe("the live policy after the one deploy (job-board .96 serving, the two name files not applied)", () => {
  const names = () => ["20261025100000", "20261026100000", "20261030100000"].map(fileOf);

  it("both name files name the re-arm as their repair, and keep their before rule", () => {
    for (const s of ["20261025100000", "20261026100000"]) {
      expect(POLICY.migrationOrder[s].before).toEqual(["fn:job-board"]);
      expect(POLICY.migrationOrder[s].repairedBy).toBe("20261030100000");
    }
  });

  it("the message's first step says job-board went first and the re-arm repairs it, with no error", () => {
    const [f1, f2, f3] = names();
    const phases = L.migrationPhases([f1, f2, f3], POLICY, LIVE);
    expect(phases.errors).toEqual([]);
    const msg: string[] = L.lovableMessage({ head: "abc12345", draftOf: "fix/name-sync-rerun", phases, toDeploy: [] });
    const step = msg.findIndex((l) => /^1\. Apply these 3 migrations, in this order/.test(l));
    expect(step, msg.join("\n")).toBeGreaterThan(0);
    expect(msg.slice(step + 1, step + 4)).toEqual([
      `   1. ${f1} (job-board already answers job-board.2026-09-09.96: it deployed first, and 20261030100000 repairs that)`,
      `   2. ${f2} (job-board already answers job-board.2026-09-09.96: it deployed first, and 20261030100000 repairs that)`,
      `   3. ${f3} (after 20261025100000 and 20261026100000; it waits for nothing else)`,
    ]);
    expect(msg.join("\n")).not.toMatch(/\(before job-board\)/);
  });

  it("without the re-arm pending (the incident as it stood), the ledger stops the message for both", () => {
    const [f1, f2] = names();
    const phases = L.migrationPhases([f1, f2], POLICY, LIVE);
    expect(phases.errors).toHaveLength(2);
    expect(phases.errors.every((e: string) => /already answers job-board\.2026-09-09\.96, and its repairedBy 20261030100000 is not pending/.test(e))).toBe(true);
  });
});
