/**
 * The apply-agent run stamp — the field that answers "does the schedule fire?"
 *
 * WHY THIS EXISTS. apply-agent is scheduled hourly at :23, but the cron body is
 * wrapped in `WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name =
 * 'apply_agent_maintenance_key')`. With no key in the vault it fires NOTHING.
 *
 * That is the right design — a cron collecting a 403 twenty-four times a day is
 * indistinguishable from a working one until somebody reads the logs — but it
 * has a cost: "armed and working" and "never armed at all" leave IDENTICAL
 * traces from outside. No packets, no errors, no rows. On 2026-08-02 the
 * question "has this ever actually run?" could not be answered without Supabase
 * dashboard access, which nobody debugging from a terminal has.
 *
 * `lastCronAt` is the field that separates them, and it is only worth having if
 * it CANNOT be written by anything except a real cron firing. A manual run that
 * advanced it would answer an easier question than the one being asked — "was
 * this function invoked" instead of "does the schedule work" — and would report
 * a healthy schedule because somebody curled it by hand. That is worse than no
 * field, because it would be believed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nextRunStamp,
  priorCronAt,
  scheduleProven,
  SCHEDULE_PROVEN_WITHIN_MIN,
  type RunFacts,
} from "../../supabase/functions/_shared/run-stamp";

const T0 = "2026-08-02T06:23:00.000Z";
const T1 = "2026-08-02T07:23:00.000Z";
const T_MANUAL = "2026-08-02T07:40:00.000Z";

const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  trigger: "cron", now: T0, buildVersion: "2026-08-02.1",
  senderOnline: false, resumesBucket: "already present",
  mandates: 0, prepared: 0, released: 0, ms: 120,
  ...over,
});

describe("a cron firing", () => {
  it("sets lastCronAt to now", () => {
    const s = nextRunStamp(null, facts({ trigger: "cron", now: T0 }));
    expect(s.lastCronAt).toBe(T0);
    expect(s.trigger).toBe("cron");
    expect(s.at).toBe(T0);
  });

  it("advances lastCronAt on each subsequent firing", () => {
    const first = nextRunStamp(null, facts({ trigger: "cron", now: T0 }));
    const second = nextRunStamp(first, facts({ trigger: "cron", now: T1 }));
    expect(second.lastCronAt).toBe(T1);
  });
});

describe("a manual run — THE property this file exists for", () => {
  it("does NOT set lastCronAt when there has never been a cron run", () => {
    // The dangerous case. If this returned T_MANUAL, curling the function by
    // hand would report a working schedule on a project whose vault key is
    // missing, and the missing key would never be found.
    const s = nextRunStamp(null, facts({ trigger: "manual", now: T_MANUAL }));
    expect(s.lastCronAt).toBeNull();
    expect(s.at).toBe(T_MANUAL);
    expect(s.trigger).toBe("manual");
    expect(scheduleProven(s.lastCronAt, Date.parse(T_MANUAL))).toBe(false);
  });

  it("carries a real cron timestamp forward without touching it", () => {
    const cronRun = nextRunStamp(null, facts({ trigger: "cron", now: T0 }));
    const manual = nextRunStamp(cronRun, facts({ trigger: "manual", now: T_MANUAL }));
    expect(manual.lastCronAt).toBe(T0); // NOT T_MANUAL, and not lost either
    expect(manual.at).toBe(T_MANUAL);
  });

  it("still records everything else about itself", () => {
    // A manual run is real evidence about the FUNCTION, just not the schedule.
    const s = nextRunStamp(null, facts({
      trigger: "manual", now: T_MANUAL, senderOnline: true,
      mandates: 3, prepared: 7, released: 2, ms: 4200,
    }));
    expect(s).toMatchObject({ senderOnline: true, mandates: 3, prepared: 7, released: 2, ms: 4200 });
  });
});

describe("priorCronAt reads an untyped JSON column defensively", () => {
  it("returns null for anything that is not a non-empty string", () => {
    for (const bad of [null, undefined, {}, { lastCronAt: null }, { lastCronAt: "" },
                       { lastCronAt: 123 }, "not an object", []]) {
      expect(priorCronAt(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("returns the timestamp when one is there", () => {
    expect(priorCronAt({ lastCronAt: T0 })).toBe(T0);
  });
});

describe("scheduleProven", () => {
  const now = Date.parse("2026-08-02T08:00:00.000Z");

  it("is false when the cron has never run", () => {
    expect(scheduleProven(null, now)).toBe(false);
  });

  it("is true for a recent firing", () => {
    expect(scheduleProven("2026-08-02T07:23:00.000Z", now)).toBe(true);
  });

  it("tolerates one missed hourly tick without crying wolf", () => {
    // 100 minutes: the previous hour was missed, the one before landed.
    expect(scheduleProven("2026-08-02T06:20:00.000Z", now)).toBe(true);
  });

  it("is false once the gap exceeds the window", () => {
    const stale = new Date(now - (SCHEDULE_PROVEN_WITHIN_MIN + 1) * 60_000).toISOString();
    expect(scheduleProven(stale, now)).toBe(false);
  });

  it("treats an unparseable timestamp as unproven", () => {
    // NaN comparisons are false, so a naive `now - t < window` would have
    // returned FALSE here anyway — but for the wrong reason, and the opposite
    // sign of that mistake reports a working cron on garbage input.
    expect(scheduleProven("whenever", now)).toBe(false);
  });
});

describe("an optional fact the caller supplies must reach the stamp", () => {
  // SHIPPED BROKEN 2026-08-06. apply-agent passed `wakeConfig: wakeConfig()`
  // and the constructor dropped it. Optional field on RunStamp, so tsc had
  // nothing to object to; the status endpoint read `null` on every run and
  // "wake is not configured" got reported as a fact off the back of it.
  //
  // The bug is not wakeConfig. The bug is that a field can be added to RunFacts,
  // passed by a caller, and silently discarded — with the type checker, the test
  // suite and the dashboard all agreeing that everything is fine.
  const WAKE = { url: true, token: true, body: "json" };

  it("carries wakeConfig through", () => {
    expect(nextRunStamp(null, facts({ wakeConfig: WAKE })).wakeConfig).toEqual(WAKE);
  });

  it("carries a NEGATIVE wakeConfig through, which is the one that matters", () => {
    // An unconfigured wake must arrive as `{url:false,...}` and not as absence.
    // Absence is what a dropped field looks like, and the two must never agree.
    const off = { url: false, token: false, body: "default" };
    expect(nextRunStamp(null, facts({ wakeConfig: off })).wakeConfig).toEqual(off);
  });

  it("still omits it when the caller genuinely has no wake to describe", () => {
    // agent-runner has no sender. Omitted, not defaulted — same rule as senderOnline.
    expect("wakeConfig" in nextRunStamp(null, facts({ wakeConfig: undefined }))).toBe(false);
  });

  it("EVERY optional fact in RunFacts is read by the constructor", () => {
    // The class-level guard. Adding `foo?:` to RunFacts and forgetting to emit
    // it fails here, rather than three weeks later via a dashboard that has been
    // quietly reporting null.
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/_shared/run-stamp.ts"), "utf8");
    const block = src.slice(src.indexOf("export type RunFacts"),
                            src.indexOf("export function priorCronAt"));
    const body = src.slice(src.indexOf("export function nextRunStamp"));
    const optional = [...block.matchAll(/^\s*(\w+)\?:/gm)].map((m) => m[1]);

    expect(optional.length, "no optional fields parsed — the regex broke, not the code").toBeGreaterThan(2);
    for (const field of optional) {
      expect(body, `RunFacts.${field} is accepted and never emitted`).toContain(`facts.${field}`);
    }
  });
});

describe("the wiring is actually in place", () => {
  it("apply-agent stamps every run through the shared helper", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
    expect(src).toContain('from "../_shared/run-stamp.ts"');
    expect(src).toContain("nextRunStamp(prevRow?.v");
    // The trigger must come from the request body, not be hard-coded.
    expect(src).toMatch(/body\.source === "cron" \? "cron" : "manual"/);
  });

  it("the cron migration sends the marker that makes lastCronAt possible", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const mig = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20260802140000_cron_identifies_itself.sql"),
      "utf8");
    expect(mig).toContain(`'{"source":"cron"}'::jsonb`);
    // And it must keep the vault gate — rescheduling must not accidentally arm
    // a job that posts hourly with a null key and collects a 403 every time.
    expect(mig).toContain("apply_agent_maintenance_key");
    expect(mig).toMatch(/WHERE EXISTS/);
  });

  it("the 403 carries the build version, and nothing else", () => {
    // The refusal is the ONLY thing an unauthenticated caller can observe from
    // apply-agent, so it has to carry the one fact that separates "this did not
    // deploy" from "the vault key is missing". Without it, the single most
    // urgent question about a silent agent was the one question you needed a
    // credential to ask.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
    const refusal = src.slice(src.indexOf("maintenance action"), src.indexOf("maintenance action") + 400);
    expect(refusal).toContain("version: BUILD_VERSION");

    // And it must never leak the credential itself, in any form. `expected` is
    // the variable holding the real MAINTENANCE_KEY.
    expect(refusal, "the refusal must not echo the key").not.toMatch(/\bexpected\b/);
    expect(refusal).not.toContain("MAINTENANCE_KEY");
    expect(refusal, "must not confirm whether a key is even configured").not.toMatch(/\bkey\s*[,:]/);
  });

  it("accepts the vault key, and costs an anonymous caller no database work", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");

    // The env key still works — nothing that worked before may stop.
    expect(src).toMatch(/envKey !== "" && presented === envKey/);
    // And the self-armed vault key is accepted, via the boolean-only check.
    expect(src).toContain("agent_maintenance_key_matches");

    // THE GUARD THAT KEEPS IT CHEAP. The vault lookup must be reachable only
    // when a key was actually presented; otherwise every unauthenticated
    // request becomes a database round trip, and the 403 path is the one an
    // anonymous caller can hit freely.
    expect(src).toMatch(/if \(!authorized && presented\)/);
  });

  it("job-board status exposes it without authentication", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    expect(src).toContain("apply_agent_run");
    expect(src).toContain("applyAgent:");
    expect(src).toContain("scheduleProven");
  });
});

describe("the wake configuration is observable before it matters", () => {
  // wakeSender short-circuits on `needed === false` and never reads
  // WORKER_START_URL, so with an empty queue the entire configuration was
  // invisible. The only moment it reported "no-url" was the moment a paying
  // customer's packets were already sitting unsent — the silent-gate shape this
  // repo keeps having to remove.
  const shared = readFileSync(
    resolve(__dirname, "../../supabase/functions/_shared/wake-sender.ts"), "utf8");
  const agent = readFileSync(
    resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
  const board = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

  it("reports booleans and a shape, never the URL or the token", () => {
    // A URL names the host and a token is a credential; the board serves this
    // to anyone.
    const fn = shared.slice(shared.indexOf("export function wakeConfig"));
    expect(fn).toMatch(/url: \(Deno\.env\.get\("WORKER_START_URL"\) \?\? ""\)\.trim\(\) !== ""/);
    expect(fn).toMatch(/token: \(Deno\.env\.get\("WORKER_START_TOKEN"\) \?\? ""\)\.trim\(\) !== ""/);
    // The real guarantee is the TYPE: these fields cannot carry a string, so
    // no future edit can leak the URL or the token through them without
    // changing the contract in a way the compiler reports.
    //
    // The first version of this assertion was a regex forbidding `return` near
    // `Deno.env.get(...)`, which matched the perfectly correct return statement
    // and failed. A test that cannot tell the safe shape from the unsafe one is
    // worse than none.
    expect(shared).toMatch(/export type WakeConfig = \{\s*url: boolean;\s*token: boolean;/);
  });

  it("distinguishes an unset body from an unparseable one", () => {
    // GitHub rejects a dispatch without `ref` with 422, and the DEFAULT body is
    // a human-readable reason it will not accept — so "default" on a GitHub
    // host is a misconfiguration that only ever shows up as a failed wake.
    expect(shared).toMatch(/"default" \| "json" \| "invalid"/);
  });

  it("is stamped every run, not only when there is work", () => {
    expect(agent).toMatch(/wakeConfig: wakeConfig\(\)/);
  });

  it("is served by the board so the check is a curl", () => {
    expect(board).toMatch(/wakeConfig: v\.wakeConfig \?\? null/);
  });
});
