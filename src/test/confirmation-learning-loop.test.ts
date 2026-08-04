/**
 * THE GUESS HAS TO BECOME A MEASUREMENT, AND SOMETHING HAS TO CARRY IT.
 *
 * Every phrase in CONFIRMED_RE is written from what confirmation pages usually
 * say, not from what one actually said. When a real one misses, the worker does
 * the right thing for the candidate — parks the row, never retries — and records
 * what the page said in `blockers`.
 *
 * And that was the end of it. The one piece of evidence that would fix the guess
 * sat in a jsonb column nobody aggregates. So the failure mode is not a crash:
 * it is a vendor whose real wording is not on the list, EVERY send to it parking
 * for review, the agent appearing to do nothing unattended, and the sentence
 * that would fix it already in the database being read by no one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const sqlFile = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("FUNCTION public.agent_confirmation_gaps"))
  .sort()
  .pop()!;
const sql = readFileSync(resolve(DIR, sqlFile), "utf8");
const bare = sql.replace(/--[^\n]*/g, "");
const hb = readFileSync(
  resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");

describe("the evidence is collected", () => {
  it("reads the blocker the worker actually writes", () => {
    // agent_mark_uncertain writes kind 'uncertain-submit'. A mismatch here would
    // return an empty set forever and read as "no problems".
    expect(bare).toMatch(/'uncertain-submit'/);
  });

  it("extracts the page's words from the recorded reason", () => {
    expect(bare).toMatch(/page said: "/);
  });

  it("groups by wording so one bad phrase reads as one problem", () => {
    expect(bare).toMatch(/GROUP BY wording/);
    expect(bare).toMatch(/count\(\*\)/);
  });

  it("drops empty wording rather than reporting a blank as a finding", () => {
    expect(bare).toMatch(/length\(btrim\(wording\)\) > 0/);
  });
});

describe("it cannot leak who applied where", () => {
  it("returns ONLY wording, a count and a timestamp", () => {
    // This is what makes it safe to expose without a session. The stored detail
    // ALSO contains the apply URL, and returning that would tie a submission to
    // a candidate on a publicly-readable endpoint.
    const sig = bare.slice(bare.indexOf("RETURNS TABLE"), bare.indexOf("LANGUAGE sql"));
    expect(sig).toMatch(/wording text/);
    expect(sig).toMatch(/occurrences bigint/);
    expect(sig).toMatch(/last_seen timestamptz/);
    for (const forbidden of ["user_id", "posting", "url", "email", "resume"]) {
      expect(sig.toLowerCase(), `${forbidden} must not be returned`).not.toContain(forbidden);
    }
  });

  it("the URL sits before the capture marker, so it cannot be captured", () => {
    // The reason is built as `... url: <u> — page said: "<said>"`. Capturing
    // from AFTER `page said: "` is what drops the URL. If somebody widened the
    // capture to the whole detail, this is the guard that should fail.
    expect(bare).not.toMatch(/substring\(b->>'detail' from '\(/);
    expect(bare).toMatch(/substring\(b->>'detail' from 'page said: "\(\.\*\)'\)/);
  });

  it("is revoked from PUBLIC before anything is granted", () => {
    // A GRANT without a REVOKE leaves PUBLIC access — that is how 107 of 121
    // definer functions ended up anon-callable.
    const rev = bare.indexOf("REVOKE ALL ON FUNCTION public.agent_confirmation_gaps");
    const grant = bare.indexOf("GRANT EXECUTE ON FUNCTION public.agent_confirmation_gaps");
    expect(rev).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(rev);
  });
});

describe("the heartbeat carries it somewhere a person will see it", () => {
  it("reports the gaps on every run", () => {
    expect(hb).toMatch(/confirmationGaps\s*$/m);
    expect(hb).toMatch(/const confirmationGaps = await evaluateConfirmationGaps\(supabase\)/);
  });

  it("reports zero as a STATE, not as silence", () => {
    // A field that only appears when something is wrong is indistinguishable
    // from a field that stopped being computed.
    expect(hb).toMatch(/'none-yet'/);
    expect(hb).toMatch(/'unrecognised-wording'/);
  });

  it("a missing RPC degrades to a reason, never to a failed heartbeat", () => {
    // The migration lands on a different schedule from the function bundle, so
    // there is always a window where the RPC does not exist yet. That window
    // must not turn a healthy platform red.
    const fn = hb.slice(hb.indexOf("async function evaluateConfirmationGaps"),
                        hb.indexOf("async function evaluateSenderState"));
    expect(fn).toMatch(/'rpc-missing'/);
    expect(fn).toMatch(/catch/);
    expect(fn).not.toMatch(/throw/);
  });

  it("bounds what it prints, so one enormous page cannot bloat every response", () => {
    const fn = hb.slice(hb.indexOf("async function evaluateConfirmationGaps"),
                        hb.indexOf("async function evaluateSenderState"));
    expect(fn).toMatch(/slice\(0, 10\)/);
    expect(fn).toMatch(/slice\(0, 200\)/);
  });
});
