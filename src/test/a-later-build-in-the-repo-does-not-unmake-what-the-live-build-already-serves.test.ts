// @vitest-environment node
/**
 * A LATER BUILD IN THE REPO DOES NOT UNMAKE WHAT THE LIVE BUILD ALREADY SERVES
 * (fix/post-deploy, 2026-11-01).
 *
 * The one deploy put job-board .96 live on 2026-10-31. fix/pd-job-board then
 * stamped .98, so the ledger's job-board row reads state "deploy" (live .96,
 * main .98). Three rules asked "does job-board answer B or later?" with
 * `state === "live" || state === "live-ahead"`, which is false for any row
 * the repo is ahead of, however late its live build:
 *   - datedAtDeploy: CONNECTOR_SEARCH_LOG_CHANGED and PRIVACY_LAST_UPDATED,
 *     history since .96 (>= .93) serves, read as due again: the draft told the
 *     owner to re-date the Privacy page to the merge day, and a --message on
 *     any later day refused (exit 9);
 *   - holdStates: 20261011103000's job-board condition printed
 *     "job-board.2026-09-09.93 not live (answers job-board.2026-09-09.96)";
 *   - migrationPhases: an `after: fn:` or `slice:` rule already met by the
 *     live build waited for this message's deploy.
 * Each now asks the live build itself (answersAtLeast). A row with no live
 * build (no header, unreachable) or an older one still waits: the teeth.
 *
 * The fourth rule went the other way (review of fix/post-deploy): a `before`
 * function "went first" only while it served main's own build, so with .98 in
 * the repo the two name migrations that .95 and .96 deployed ahead of read
 * "before job-board" again, and with their repair (20261030100000) not
 * pending nothing stopped the message, which on main at .96 stops it. An
 * entry with `repairedBy` records that its function deployed first, at a
 * deploy the ledger recorded (verifiedDeploys: job-board .96 at f8d72a9b); a
 * later build in the repo does not undo that deploy, so the function went
 * first while its live build reaches that record's build. Live .92 (the one
 * deploy's own message) is short of it and still reads "before job-board".
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";
import { withWave4PruneHeld } from "./helpers/released-holds";

const ROOT = resolve(__dirname, "../..");
const policy = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const readRepo = (f: string) => { try { return readFileSync(resolve(ROOT, f), "utf8"); } catch { return null; } };

type Row = { fn: string; want: string | null; have: string | null | undefined; state: string };
const row = (fn: string, want: string, have: string | null | undefined): Row => ({ fn, want, have, state: L.rowState(want, have) });
// Production on 2026-11-01 with fix/pd-job-board merged: job-board .96 live, main .98.
// An explicit undefined is "no answer" (unreachable), so no default parameter swallows it.
const AHEAD = (...live: (string | null | undefined)[]) => [
  row("job-board", "job-board.2026-09-09.98", live.length ? live[0] : "job-board.2026-09-09.96"),
  row("agent-mcp", "agent-mcp.2026-10-11.38", "agent-mcp.2026-10-11.38"),
];

describe("the rows this test stands on", () => {
  it("a live .96 under a repo .98 is state deploy, which is what the old rules refused", () => {
    expect(AHEAD()[0].state).toBe("deploy");
    expect(AHEAD()[1].state).toBe("live");
  });
});

describe("answersAtLeast: the live build itself, whatever the repo carries", () => {
  it("a live build at or past the need answers it, in every state that names one", () => {
    expect(L.answersAtLeast(row("job-board", "job-board.2026-09-09.98", "job-board.2026-09-09.96"), "job-board.2026-09-09.93")).toBe(true);
    expect(L.answersAtLeast(row("job-board", "job-board.2026-09-09.96", "job-board.2026-09-09.96"), "job-board.2026-09-09.93")).toBe(true);
    expect(L.answersAtLeast(row("job-board", "job-board.2026-09-09.96", "job-board.2026-09-09.98"), "job-board.2026-09-09.93")).toBe(true);
  });
  it("an older live build, no live header, or no answer at all never does", () => {
    expect(L.answersAtLeast(row("job-board", "job-board.2026-09-09.98", "job-board.2026-09-09.92"), "job-board.2026-09-09.93")).toBe(false);
    expect(L.answersAtLeast(row("job-board", "job-board.2026-09-09.98", null), "job-board.2026-09-09.93")).toBe(false);
    expect(L.answersAtLeast(row("job-board", "job-board.2026-09-09.98", undefined), "job-board.2026-09-09.93")).toBe(false);
    expect(L.answersAtLeast(undefined, "job-board.2026-09-09.93")).toBe(false);
  });
  it("a rollback answers the need only when the build it rolls back to does too", () => {
    const rb = { fn: "job-board", want: "job-board.2026-09-09.96", have: "job-board.2026-09-09.99", state: "deploy (rollback)", rollbackFrom: "job-board.2026-09-09.99" };
    expect(L.answersAtLeast(rb, "job-board.2026-09-09.93")).toBe(true);
    expect(L.answersAtLeast(rb, "job-board.2026-09-09.97")).toBe(false);
  });
});

describe("datedAtDeploy: a date the live build made history stays history", () => {
  const files: Record<string, string> = { "src/config/a.ts": 'export const A_DAY = "2026-10-31";\n' };
  const read = (f: string) => files[f] ?? null;
  const A = { file: "src/config/a.ts", constant: "A_DAY", whenDeploying: "fn:job-board@2026-09-09.93", why: "the page names the day" };

  it("live .96 under repo .98: not due on any later day, and no refusal", () => {
    const d = L.datedAtDeploy({ datedAtDeploy: [A] }, AHEAD(), read, "2026-11-02");
    expect(d.errors).toEqual([]);
    expect(d.checks[0]).toMatchObject({ due: false, ok: true });
    expect(L.datedRefusals(d)).toEqual([]);
  });

  it("the teeth: live .92, no live header, or no answer under repo .98 are still due and refuse another day", () => {
    for (const jb of ["job-board.2026-09-09.92", null, undefined]) {
      const d = L.datedAtDeploy({ datedAtDeploy: [A] }, AHEAD(jb), read, "2026-11-02");
      expect(d.checks[0], String(jb)).toMatchObject({ due: true, ok: false });
      expect(L.datedRefusals(d).join("\n")).toMatch(/A_DAY reads 2026-10-31, not today \(2026-11-02, UTC\)/);
    }
  });

  it("the real policy: the two dates job-board .93 made history stay history with .96 live, and only audit-rest's .101 re-date is due", () => {
    const real = L.datedAtDeploy(policy, AHEAD(), readRepo, "2026-11-02");
    expect(real.errors).toEqual([]);
    type Check = { constant: string; due: boolean; need: string };
    const at93 = real.checks.filter((c: Check) => c.need === "job-board.2026-09-09.93");
    expect(at93.length).toBe(2);
    expect(at93.every((c: Check) => !c.due)).toBe(true);
    const msg: string[] = L.lovableMessage({ head: "abc12345", draftOf: "fix/post-deploy", phases: L.migrationPhases([], {}, []), toDeploy: [], dated: at93 });
    expect(msg.join("\n")).not.toMatch(/On the merge day, before merging, set/);
    expect(real.checks.filter((c: Check) => c.due).map((c: Check) => `${c.constant}@${c.need}`)).toEqual(["PRIVACY_LAST_UPDATED@job-board.2026-09-09.101"]);
  });
});

describe("holdStates: a condition the live build meets is met", () => {
  const HELD = ["20261011103000_a_chat_users_searches_are_kept_a_month_not_half_a_year.sql"];
  // The prune was released 2026-11-08; these cases read its hold as it stood.
  const held = withWave4PruneHeld(policy);

  it("live .96 under repo .98 and agent-mcp .38: both conditions met, the hold is releasable (as on main at .96)", () => {
    const h = L.holdStates(HELD, held, AHEAD()).holds[0];
    expect(h.conditions.map((c: { need: string; met: boolean }) => [c.need, c.met])).toEqual([
      ["job-board.2026-09-09.93", true],
      ["agent-mcp.2026-10-11.3", true],
    ]);
    expect(h.releasable).toBe(true);
  });

  it("the teeth: live .92 or no live header under repo .98 is not met", () => {
    for (const jb of ["job-board.2026-09-09.92", null]) {
      const h = L.holdStates(HELD, held, AHEAD(jb)).holds[0];
      expect(h.conditions[0].met, String(jb)).toBe(false);
      expect(h.releasable).toBe(false);
    }
  });
});

describe("migrationPhases: an after rule the live build meets applies before the functions", () => {
  const F = "20991231000000_waits_for_job_board.sql";
  const pol = (after: string) => ({ migrationOrder: { "20991231000000": { after } } });

  for (const after of ["fn:job-board@2026-09-09.95", "slice:job-board@2026-09-09.95"]) {
    it(`${after}: live .96 under repo .98 is met now; live .92 still waits for this deploy`, () => {
      const met = L.migrationPhases([F], pol(after), AHEAD());
      expect(met.errors).toEqual([]);
      expect(met.afterFunctions).toEqual([]);
      expect(met.pre).toEqual([{ file: F, note: "job-board already answers job-board.2026-09-09.96" }]);
      const waits = L.migrationPhases([F], pol(after), AHEAD("job-board.2026-09-09.92"));
      expect(waits.pre).toEqual([]);
      expect(waits.afterFunctions.map((p: { file: string }) => p.file)).toEqual([F]);
    });
  }
});

describe("migrationPhases: a before rule its function broke stays broken under a later build in the repo", () => {
  const onDisk = readdirSync(resolve(ROOT, "supabase/migrations"));
  const file = (stamp: string) => onDisk.find((f) => f.startsWith(`${stamp}_`)) as string;
  const NAMES = [file("20261025100000"), file("20261026100000")];
  const REARM = file("20261030100000");
  const MAIN_AT_96 = [row("job-board", "job-board.2026-09-09.96", "job-board.2026-09-09.96"), AHEAD()[1]];
  // These cases are production on 2026-11-01, when job-board .96 was the newest record. A later record moves the
  // bar (a live .96 then reads short of it), so they read the ledger as it stood; the last case reads today's record.
  const records = policy.verifiedDeploys as Array<{ functions?: Record<string, string> }>;
  const at96 = { ...policy, verifiedDeploys: records.slice(0, records.findIndex((d) => d.functions?.["job-board"] === "job-board.2026-09-09.96") + 1) };

  it("the files this stands on: both name migrations, and their repair, are on disk", () => {
    expect([...NAMES, REARM].every(Boolean)).toBe(true);
  });

  it("live .96 under repo .98, the repair not pending: both stop the message, as on main at .96", () => {
    const main = L.migrationPhases(NAMES, at96, MAIN_AT_96, onDisk);
    const ahead = L.migrationPhases(NAMES, at96, AHEAD(), onDisk);
    expect(main.errors.map((e: string) => e.slice(0, 14))).toEqual(["20261025100000", "20261026100000"]);
    expect(ahead.errors).toEqual(main.errors);
    expect(ahead.errors.every((e: string) => e.includes("already answers job-board.2026-09-09.96, and its repairedBy 20261030100000 is not pending")), ahead.errors.join("\n")).toBe(true);
  });

  it("live .96 under repo .98, the repair pending: no error, and the notes say job-board deployed first, as on main at .96", () => {
    const main = L.migrationPhases([...NAMES, REARM], at96, MAIN_AT_96, onDisk);
    const ahead = L.migrationPhases([...NAMES, REARM], at96, AHEAD(), onDisk);
    expect(ahead.errors).toEqual([]);
    expect(ahead.pre).toEqual(main.pre);
    expect(ahead.pre.slice(0, 2).map((p: { note: string }) => p.note)).toEqual([
      "job-board already answers job-board.2026-09-09.96: it deployed first, and 20261030100000 repairs that",
      "job-board already answers job-board.2026-09-09.96: it deployed first, and 20261030100000 repairs that",
    ]);
  });

  it("the record is the newest verified deploy's build: live .92 under repo .98 is short of .96 and reads 'before job-board' with no error", () => {
    expect(at96.verifiedDeploys.at(-1)?.functions?.["job-board"]).toBe("job-board.2026-09-09.96");
    const short = L.migrationPhases(NAMES, at96, AHEAD("job-board.2026-09-09.92"), onDisk);
    expect(short.errors).toEqual([]);
    expect(short.pre.map((p: { note: string }) => p.note)).toEqual(["before job-board", "before job-board"]);
    // A repair recorded with no verified deploy of the function keeps main's own rule: "deploy" reads "before".
    const unrecorded = { ...policy, verifiedDeploys: [] };
    expect(L.migrationPhases(NAMES, unrecorded, AHEAD(), onDisk).pre.map((p: { note: string }) => p.note)).toEqual(["before job-board", "before job-board"]);
    expect(L.migrationPhases(NAMES, unrecorded, MAIN_AT_96, onDisk).errors).toHaveLength(2);
  });

  it("the teeth the other way: a before rule with no repair recorded still reads 'before' a function this message deploys, and one whose live build cannot be read keeps its order", () => {
    const F = "20991231000000_goes_before_job_board.sql";
    const fresh = L.migrationPhases([F], { migrationOrder: { "20991231000000": { before: ["fn:job-board"] } } }, AHEAD(), [F]);
    expect(fresh.errors).toEqual([]);
    expect(fresh.pre).toEqual([{ file: F, note: "before job-board" }]);
    for (const jb of [null, undefined]) {
      const unread = L.migrationPhases([...NAMES, REARM], policy, AHEAD(jb), onDisk);
      expect(unread.errors, String(jb)).toEqual([]);
      expect(unread.pre.slice(0, 2).map((p: { note: string }) => p.note), String(jb)).toEqual(["before job-board", "before job-board"]);
    }
  });

  it("the bar is the real ledger's newest record, whatever build that is: a live build at it stops the message, one short of it reads 'before job-board'", () => {
    const newest = [...records].reverse().find((d) => d.functions?.["job-board"])?.functions?.["job-board"] as string;
    const n = Number(/\.(\d+)$/.exec(newest)?.[1]);
    const nth = (k: number) => newest.replace(/\d+$/, String(k));
    const under = (have: string) => [row("job-board", nth(n + 1), have), AHEAD()[1]];
    expect(under(newest)[0].state).toBe("deploy");
    const at = L.migrationPhases(NAMES, policy, under(newest), onDisk);
    expect(at.errors.map((e: string) => e.slice(0, 14))).toEqual(["20261025100000", "20261026100000"]);
    const short = L.migrationPhases(NAMES, policy, under(nth(n - 1)), onDisk);
    expect(short.errors).toEqual([]);
    expect(short.pre.map((p: { note: string }) => p.note)).toEqual(["before job-board", "before job-board"]);
  });
});
