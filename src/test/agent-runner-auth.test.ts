/**
 * agent-runner was callable by anyone, and a gate without its caller is an
 * outage with good intentions.
 *
 * A POST with an empty body scanned the board, ran the fit scorer over every
 * candidate posting for every subscriber, and wrote queue rows. Hundreds of
 * reads and a scoring pass per request, free, from anywhere. It leaks nothing —
 * the response is counts — so this was a cost and abuse hole rather than a data
 * one. That still means anyone could schedule an outage for us at no cost.
 *
 * THE HALF THAT IS EASY TO FORGET. The nightly cron sent only
 * {"Content-Type": "application/json"} — no credential at all. Adding the gate
 * without rescheduling the cron would have refused the 06:10 UTC run every
 * night, and agent-runner writes no run stamp of its own, so the first symptom
 * would have been a subscriber noticing an empty morning queue.
 *
 * These assertions exist so the two halves cannot drift apart: the function
 * requires a key, and the schedule sends one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const runner = readFileSync(resolve(root, "supabase/functions/agent-runner/index.ts"), "utf8");

/** The LAST migration to schedule this job is the live one. */
function liveSchedule(jobName: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let live = "";
  for (const f of files) {
    const sql = readFileSync(resolve(MIGRATIONS, f), "utf8");
    if (sql.includes(`cron.schedule(\n      '${jobName}'`) || sql.includes(`cron.schedule('${jobName}'`)) live = sql;
  }
  return live;
}

describe("agent-runner requires a key", () => {
  it("reads x-maintenance-key and refuses without it", () => {
    expect(runner).toMatch(/req\.headers\.get\("x-maintenance-key"\)/);
    expect(runner, "no 403 path — the function is still open").toMatch(/"unauthorized"[\s\S]{0,40}403/);
  });

  it("only touches the vault when a key was actually presented", () => {
    // Otherwise an unauthenticated flood becomes an RPC flood, and refusing
    // becomes as expensive as serving.
    expect(runner).toMatch(/if \(!authorized && presented\)/);
  });

  it("the refusal names the build and nothing else", () => {
    // Enough to tell "the gate is live" from "the old open bundle is still
    // deployed". Never whether a key exists, never how long one should be.
    expect(runner).toMatch(/version: BUILD_VERSION/);
    expect(runner).toMatch(/const BUILD_VERSION = "/);
  });
});

describe("the nightly cron sends one", () => {
  const sched = liveSchedule("agent-runner-nightly");

  it("a schedule exists for it", () => {
    expect(sched.length, "no migration schedules agent-runner-nightly").toBeGreaterThan(0);
  });

  it("passes the vault key as x-maintenance-key", () => {
    expect(sched, "the cron would be refused every night by the gate above")
      .toMatch(/'x-maintenance-key'/);
    expect(sched).toMatch(/decrypted_secret FROM vault\.decrypted_secrets/);
  });

  it("fires NOTHING when no key exists, rather than 403ing nightly", () => {
    // A cron that fails every night is indistinguishable from one that works,
    // right up until somebody reads the logs of a job they believe is fine.
    expect(sched).toMatch(/WHERE EXISTS \(\s*SELECT 1 FROM vault\.decrypted_secrets/);
  });

  it("identifies itself, so a hand run and a scheduled one stay distinguishable", () => {
    expect(sched).toMatch(/"source":"cron"/);
  });
});

describe("the gated cron is observable", () => {
  // Gating a function whose caller cannot be observed is how a fix becomes an
  // outage nobody attributes to the fix. agent-runner is now the only caller
  // holding a key, and it wrote no run stamp — so a silent schedule failure
  // would look exactly like a quiet night with nothing to queue. The first
  // symptom would have been a subscriber noticing an empty morning queue.
  const board = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("the runner stamps every run", () => {
    expect(runner).toMatch(/k: "agent_runner_run"/);
    expect(runner).toMatch(/nextRunStamp\(/);
  });

  it("it distinguishes a scheduled run from a hand one", () => {
    // A manual run proves the function works and proves nothing at all about
    // the schedule. Conflating them is what made this unanswerable for
    // apply-agent until 20260802140000.
    expect(runner).toMatch(/body\?\.source === "cron" \? "cron" : "manual"/);
  });

  it("bookkeeping never fails the run", () => {
    expect(runner).toMatch(/run stamp failed/);
  });

  it("status reports it without a service key", () => {
    expect(board).toMatch(/"agent_runner_run"/);
    expect(board).toMatch(/agentRunner:/);
    expect(board, "no scheduleProven — the whole point is answering 'did the cron fire'")
      .toMatch(/scheduleProven: cronAt !== null && \(ageMin\(cronAt\) \?\? 1e9\) < 1500/);
  });

  it("does not report a sender the runner does not have", () => {
    // The stamp omits senderOnline/resumesBucket rather than defaulting them,
    // so this block must not invent them either. `false` here would be a fact
    // about something this job does not do.
    const block = board.slice(board.indexOf("agentRunner:"), board.indexOf("catalogSize:"));
    expect(block).not.toMatch(/senderOnline/);
    expect(block).not.toMatch(/resumesBucket/);
  });
});
