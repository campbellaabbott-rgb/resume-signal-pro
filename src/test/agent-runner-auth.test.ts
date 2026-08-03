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
