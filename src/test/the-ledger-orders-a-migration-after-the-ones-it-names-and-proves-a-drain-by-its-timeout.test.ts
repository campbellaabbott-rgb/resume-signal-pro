// @vitest-environment node
/**
 * THE LEDGER ORDERS A MIGRATION AFTER THE ONES IT NAMES, AND PROVES A DRAIN BY
 * ITS TIMEOUT (2026-10-31, the name-sync follow-up).
 *
 * Two gaps the follow-up to the one deploy found in docs/deploy-ledger.json:
 *
 * 1. migrationOrder could order a migration around functions and the
 *    frontend, never after another migration. 20261030100000 refuses unless
 *    20261025100000 and 20261026100000 are applied, and waits for nothing
 *    else. `afterMigrations` names them: a file in the same step follows them
 *    (filename order, so each must sort earlier), one in a later step, held
 *    or never to apply is an error that stops the message, and the note says
 *    which still go first and that the file waits for nothing else.
 *
 * 2. appliedByBehaviour proved a stub-less migration by its cron jobs being
 *    active, and 20261014120000 re-schedules a job 20261014100000 (applied)
 *    already scheduled: rb-auth-mail-drain being active proves nothing about
 *    it. Its trace is the statement_timeout its command begins with ('10s',
 *    which no other file writes), and get_cron_health reports it as
 *    ch_timeout. `cronTimeouts` names that: a job whose timeout differs
 *    leaves the migration pending, with the reason.
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
const live: Row[] = [
  { fn: "job-board", want: "job-board.2026-09-09.96", have: "job-board.2026-09-09.96", state: "live" },
  { fn: "agent-mcp", want: "agent-mcp.2026-10-11.38", have: "agent-mcp.2026-10-11.38", state: "live" },
];
const deploying: Row[] = [{ fn: "job-board", want: "job-board.2026-09-09.97", have: "job-board.2026-09-09.96", state: "deploy" }];

describe("afterMigrations: a migration ordered after the ones it names", () => {
  const P = (rule: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ migrationOrder: { "20261030100000": rule }, holdUntilVerified: [], neverApply: [], ...extra });
  const a = "20261025100000_a.sql", b = "20261026100000_b.sql", n = "20261030100000_n.sql";

  it("follows both in the same step, and its note names them and says it waits for nothing else", () => {
    const p = L.migrationPhases([a, b, n], P({ afterMigrations: ["20261025100000", "20261026100000"] }), live);
    expect(p.errors).toEqual([]);
    expect(p.pre.map((m: { file: string }) => m.file)).toEqual([a, b, n]);
    expect(p.pre[2].note).toBe("after 20261025100000 and 20261026100000; it waits for nothing else");
  });

  it("names only the ones still pending, and says nothing once all are applied", () => {
    expect(L.migrationPhases([b, n], P({ afterMigrations: ["20261025100000", "20261026100000"] }), live).pre[1].note)
      .toBe("after 20261026100000; it waits for nothing else");
    expect(L.migrationPhases([n], P({ afterMigrations: ["20261025100000", "20261026100000"] }), live).pre[0].note).toBe("");
  });

  it("keeps a function rule's own words beside it", () => {
    const p = L.migrationPhases([a, n], P({ afterMigrations: ["20261025100000"], before: ["fn:job-board"] }), deploying);
    expect(p.errors).toEqual([]);
    expect(p.pre[1].note).toBe("after 20261025100000; before job-board");
  });

  it("is an error, never a guess, when a named file waits for a later step than this one", () => {
    const pol = { ...P({ afterMigrations: ["20261025100000"] }), migrationOrder: { "20261025100000": { after: "fn:job-board@2026-09-09.97" }, "20261030100000": { afterMigrations: ["20261025100000"] } } };
    const p = L.migrationPhases([a, n], pol, deploying);
    expect(p.errors).toEqual([`${n} must apply after 20261025100000, which waits for a later step (once job-board answers job-board.2026-09-09.97 or later)`]);
  });

  it("is an error when a named stamp does not sort before it, is held, is never applied, or is no stamp", () => {
    const err = (rule: Record<string, unknown>, extra = {}) => L.migrationPhases([n], P(rule, extra), live).errors;
    expect(err({ afterMigrations: ["20261031100000"] })).toEqual(["migrationOrder 20261030100000: afterMigrations names 20261031100000, which does not sort before it, so filename order cannot put it first"]);
    expect(err({ afterMigrations: ["20261025100000"] }, { holdUntilVerified: [{ stamp: "20261025100000" }] })).toEqual(["migrationOrder 20261030100000: afterMigrations names 20261025100000, which is held (holdUntilVerified), so this file could apply before it"]);
    expect(err({ afterMigrations: ["20261025100000"] }, { neverApply: ["20261025100000"] })).toEqual(["migrationOrder 20261030100000: afterMigrations names 20261025100000, which must never apply (neverApply)"]);
    expect(err({ afterMigrations: [] })).toEqual(["migrationOrder 20261030100000: afterMigrations must list one or more 14-digit migration stamps"]);
    expect(err({ afterMigrations: "20261025100000" })).toEqual(["migrationOrder 20261030100000: afterMigrations must list one or more 14-digit migration stamps"]);
  });
});

describe("cronTimeouts: a stub-less migration proved by the timeout its command begins with", () => {
  const policy = { appliedByBehaviour: { "20261014120000": { cronJobs: ["rb-auth-mail-drain"], cronTimeouts: { "rb-auth-mail-drain": "10s" } } } };
  const pending = ["20261014120000_drain.sql"];
  const row = (ch_timeout: string | null) => [{ ch_jobname: "rb-auth-mail-drain", ch_active: true, ch_timeout, ch_runs: 360 }];

  it("is applied when the job is active and reports the timeout", () => {
    const r = L.behaviourApplied(pending, policy, row("10s"));
    expect(r.pending).toEqual([]);
    expect(r.proven).toEqual([{ file: pending[0], jobs: ["rb-auth-mail-drain"], timeouts: { "rb-auth-mail-drain": "10s" } }]);
  });

  it("stays pending, with the reason, when the active job carries another timeout or none (20261014100000's command alone)", () => {
    expect(L.behaviourApplied(pending, policy, row(null)).unproven).toEqual([{ file: pending[0], why: "get_cron_health reports rb-auth-mail-drain's statement_timeout as none, not 10s" }]);
    expect(L.behaviourApplied(pending, policy, row("15s")).unproven[0].why).toBe("get_cron_health reports rb-auth-mail-drain's statement_timeout as 15s, not 10s");
  });
});

describe("the three stub-less files the one deploy applied are read applied, and the message lists the names and the re-arm", () => {
  // get_cron_health, read with a GET on 2026-10-31 at about 19:33Z.
  const CRON_2026_10_31 = [
    { ch_jobname: "employer-perks-rollup", ch_schedule: "13,43 0,1 * * *", ch_active: true, ch_timeout: "110s" },
    { ch_jobname: "employer-perks-sweep", ch_schedule: "* * * * *", ch_active: true, ch_timeout: "15s" },
    { ch_jobname: "mail-watch", ch_schedule: "*/15 * * * *", ch_active: true, ch_timeout: null },
    { ch_jobname: "rb-auth-mail-drain", ch_schedule: "10 seconds", ch_active: true, ch_timeout: "10s" },
  ];
  const stubless = ["20261011142000", "20261012111000", "20261014120000"].map(fileOf);
  // Read inside each test, so a missing file fails that test and not the whole file's collection.
  const nameFiles = () => ["20261025100000", "20261026100000", "20261030100000"].map(fileOf);

  it("the policy proves each by what only it schedules", () => {
    const names = nameFiles();
    const r = L.behaviourApplied([...stubless, ...names], POLICY, CRON_2026_10_31);
    expect(r.unproven).toEqual([]);
    expect(r.proven.map((p: { file: string }) => p.file)).toEqual(stubless);
    expect(r.pending).toEqual(names);
    expect(POLICY.appliedByBehaviour["20261014120000"].cronTimeouts).toEqual({ "rb-auth-mail-drain": "10s" });
  });

  it("each job is scheduled by its file and no other, and only 20261014120000's drain begins with the '10s' timeout", () => {
    const all = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
    const schedulers = (job: string) => all.filter((f) => new RegExp(`cron\\.schedule\\(\\s*'${job}'`).test(readFileSync(resolve(MIG_DIR, f), "utf8")));
    expect(schedulers("mail-watch")).toEqual([fileOf("20261011142000")]);
    expect(schedulers("employer-perks-sweep")).toEqual([fileOf("20261012111000")]);
    expect(schedulers("employer-perks-rollup")).toEqual([fileOf("20261012111000")]);
    expect(schedulers("rb-auth-mail-drain").sort()).toEqual([fileOf("20261014100000"), fileOf("20261014120000")]);
    const drain = (stamp: string) => readFileSync(resolve(MIG_DIR, fileOf(stamp)), "utf8");
    expect(drain("20261014120000")).toMatch(/\$cmd\$SET statement_timeout = '10s';/);
    expect(drain("20261014100000")).not.toMatch(/statement_timeout/);
  });

  it("the message's first step is the two name files and then the re-arm, with wave 4's hold still not in this session", () => {
    const names = nameFiles();
    const pending = L.behaviourApplied([...stubless, ...names], POLICY, CRON_2026_10_31).pending;
    const phases = L.migrationPhases(pending, POLICY, live);
    expect(phases.errors).toEqual([]);
    const holds = L.holdStates([fileOf("20261011103000")], POLICY, live);
    const msg: string[] = L.lovableMessage({ head: "abc12345", draftOf: "fix/name-sync-rerun", phases, hold: [fileOf("20261011103000")], holds: holds.holds, toDeploy: [] });
    const step = msg.findIndex((l) => /^1\. Apply these 3 migrations, in this order/.test(l));
    expect(step, msg.join("\n")).toBeGreaterThan(0);
    expect(msg.slice(step + 1, step + 4)).toEqual([
      `   1. ${names[0]} (before job-board)`,
      `   2. ${names[1]} (before job-board)`,
      `   3. ${names[2]} (after 20261025100000 and 20261026100000; it waits for nothing else)`,
    ]);
    expect(msg[step + 4]).toMatch(/^ {3}RELEASABLE, still held: 20261011103000_.*do not apply it from this one\.$/);
    expect(msg.some((l) => /Deploy these \d+ edge functions/.test(l))).toBe(false);
  });
});
