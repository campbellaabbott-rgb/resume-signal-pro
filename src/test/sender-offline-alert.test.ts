/**
 * THE AGENT CAN STOP WITHOUT ANYTHING SAYING SO.
 *
 * The apply worker runs on a laptop. Measured 2026-08-04 via `pmset -g custom`:
 * AC power had `displaysleep 10, sleep 1`, held up only by powerd's "prevent
 * sleep while display is on" assertion — so the Mac slept about ELEVEN MINUTES
 * after the last keystroke, and roughly three on battery. `sleep 0` fixes it,
 * and is exactly the kind of setting a macOS update reverts silently.
 *
 * When it reverts, the worker stops and NOTHING says so. The board is fine, the
 * scanner is fine, checkout is fine. To a candidate it reads as "no matching
 * jobs today" — the failure mode the heartbeat table's own header calls the one
 * a paid product must not have: taking money and quietly doing nothing.
 *
 * WHY A BOOLEAN COULD NOT CARRY THIS. `agent_sender_online()` returns false for
 * two unrelated situations — never installed, and installed then died. Alerting
 * on it would either page about a machine that never existed or stay silent when
 * the real one stopped. Same answer, two states, so it is not a measurement.
 * `agent_sender_state()` returns the inputs and the rule lives in the function
 * where every outcome is nameable.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fn = readFileSync(
  resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");
const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260804020000_sender_offline_is_distinguishable.sql"), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the sender-offline rule names every state", () => {
  const REASONS = [
    "never-installed",            // nothing was ever armed — silence is correct
    "online",                     // heartbeat is fresh
    "offline-nothing-at-stake",   // laptop shut, no mandate, nobody harmed
    "offline-with-work-outstanding", // THE alert
    "rpc-missing",                // migration not applied yet
  ];
  for (const r of REASONS) {
    it(`emits the reason "${r}"`, () => {
      expect(fn, `the ${r} state collapsed into another`).toContain(`'${r}'`);
    });
  }

  it("alerts on exactly one of them", () => {
    // If shouldAlert were computed from anything looser (e.g. `!== 'online'`),
    // a never-installed worker would page on every deploy.
    expect(code(fn)).toMatch(/shouldAlert:\s*reason === 'offline-with-work-outstanding'/);
  });

  it("requires everSeen before it can be offline — never-installed cannot alert", () => {
    expect(code(fn)).toMatch(/const isOffline = everSeen &&/);
  });

  it("a missing RPC does not look like a healthy sender", () => {
    // Before the migration lands the rpc errors. Returning null or a bare
    // false there would read as "sender fine" forever.
    // SCOPED TO THE SENDER'S OWN FUNCTION. A bare indexOf finds the FIRST
    // "rpc-missing" in the file, and another evaluator now degrades the same
    // way — so this was silently checking a different function's neighbours,
    // which is how an ambiguous anchor turns into a vacuous assertion.
    const body = code(fn).slice(code(fn).indexOf("async function evaluateSenderState"));
    const i = body.indexOf("rpc-missing");
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(Math.max(0, i - 200), i)).toMatch(/shouldAlert:\s*false/);
  });
});

describe("it cannot become a noise machine", () => {
  it("dedupes to 1 per 6 hours", () => {
    // Runs on a 10-minute cron: a weekend outage is ~200 sends without this.
    const c = code(fn);
    const i = c.indexOf("'alert:sender-offline'");
    expect(i, "the dedupe key is gone").toBeGreaterThan(-1);
    expect(c.slice(i, i + 200)).toMatch(/p_max_requests:\s*1/);
    expect(c.slice(i, i + 200)).toMatch(/p_window_minutes:\s*360/);
  });

  it("the dedupe key stays OUT of the cross-function request budget", () => {
    // migration 20260803170000 scoped that budget to the five entry points.
    // An `alert:*` key inside it would let alerting starve résumé upload.
    const budget = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20260803170000_rate_budget_counts_only_what_it_gates.sql"),
      "utf8");
    expect(budget).not.toContain("alert:sender-offline");
  });

  it("has a floor on the threshold, so a bad env var cannot page every 10 minutes", () => {
    expect(code(fn)).toMatch(/Math\.max\(\s*300,/);
  });

  it("does not fold the sender into overall platform status", () => {
    // The scanner and board are healthy when the sender is down. Marking the
    // platform 'down' would page the wrong people about the wrong thing.
    const c = code(fn);
    const i = c.indexOf("evaluateSenderState(supabase)");
    expect(i).toBeGreaterThan(-1);
    expect(c.slice(i, i + 300)).not.toMatch(/overallStatus\s*=/);
  });
});

/**
 * AN ALERT THAT HAS NEVER FIRED IS AN ASSUMPTION. With zero mandates today this
 * rule is correctly silent, which also means waiting cannot confirm it works. So
 * the inputs ship in the response body on every run and can be curled.
 */
describe("the rule is checkable without waiting for an outage", () => {
  it("returns senderState in the heartbeat response", () => {
    // Trailing comma allowed: this is a field in an object literal, and pinning
    // it as the LAST field made an unrelated addition after it look like a
    // regression in the sender.
    expect(code(fn), "the state is computed but never surfaced").toMatch(/^\s*senderState,?$/m);
  });

  it("surfaces the threshold it judged against, not just the verdict", () => {
    expect(code(fn)).toMatch(/thresholdSeconds:\s*SENDER_OFFLINE_SECONDS/);
  });
});

describe("the SQL measures the right things", () => {
  it("separates ever_seen from offline_seconds", () => {
    expect(sql).toMatch(/ever_seen\s+boolean/);
    expect(sql).toMatch(/offline_seconds\s+integer/);
  });

  it("counts packets from agent_submissions, not the morning queue", () => {
    // agent_queue is the shortlist; agent_submissions is what apply-broker
    // hands to a worker. Counting the wrong one makes pending_packets always 0
    // and the alert never fires for the reason it exists.
    expect(sql).toMatch(/FROM public\.agent_submissions WHERE status = 'ready'/);
    expect(sql).not.toMatch(/FROM public\.agent_queue/);
  });

  it("is service_role only — worker liveness is infrastructure state", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.agent_sender_state\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.agent_sender_state\(\) TO service_role/);
  });

  it("leaves the release gate alone", () => {
    // agent_sender_online() is what apply-agent uses to refuse releasing to a
    // dead sender. This is additive; replacing it would change send behaviour.
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.agent_sender_online/);
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*agent_sender_online/);
  });
});
