/**
 * THE DAILY CAP COULD BE OVERSHOT — THE STOP BUTTON BUG, SECOND VERSE.
 *
 * `agent_sent_today` counted only what had already LANDED. decideRelease checks
 * that number and releases up to the cap, but a released packet is a commitment
 * queued for a worker, and between release and submission it was invisible.
 *
 *   :23  0 submitted -> release 10       (PACKETS_PER_MANDATE)
 *   1:23 worker still grinding through APPLY_GAP_MS 20s and
 *        APPLY_EMPLOYER_GAP_MS 120s, still ~0 submitted -> release 10 MORE
 *   2:23 again
 *
 * The worker only has to be SLOW. `sender-offline` refuses on a 15-minute
 * heartbeat gap, and one that submits steadily-but-slowly heartbeats fine. So
 * 30+ could go out against a cap of 20, and the cap is the thing protecting a
 * candidate's reputation with employers.
 *
 * SAME SHAPE AS THE STOP BUTTON: apply-agent honoured `active`, apply-broker did
 * not, and a paused agent drained anyway. The broker calls itself the LAST gate
 * and re-checks entitlement, active and consent there. The cap was never on
 * that list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260804060000_daily_cap_counts_commitments.sql"), "utf8");

/** The claim function body, so assertions cannot accidentally match the other one. */
const claimBody = sql.slice(sql.indexOf("FUNCTION public.agent_claim_submission"));
const countBody = sql.slice(
  sql.indexOf("FUNCTION public.agent_sent_today"),
  sql.indexOf("FUNCTION public.agent_claim_submission"),
);

/**
 * THE COUNTING HALF WAS ALREADY FIXED, and I diagnosed it from a superseded
 * migration file. 20260803120000_cap_counts_released_not_only_sent.sql landed on
 * 3 August and already counts in-flight releases; daily-cap-integrity.test.ts
 * covers it. I read 20260730050000 — an EARLIER definition of the same function
 * — and reported current behaviour from it.
 *
 * A migration file is not the schema. The schema is the last migration that
 * touched the object, and reading any earlier one describes a state that has
 * not existed for a day. So this file tests only what 20260804060000 adds: the
 * gate at claim time, which genuinely did not exist.
 */
describe("the cap is re-checked at the last gate", () => {
  it("the claim function consults the mandate's cap", () => {
    expect(claimBody).toMatch(/auto_apply_daily_cap/);
  });

  it("counts SUBMITTED at the gate, not in-flight", () => {
    // The packet being claimed is itself in flight. Counting in-flight here
    // would make every packet count against itself and nothing would ever be
    // claimable — a total outage that looks like an empty queue.
    const i = claimBody.indexOf("THE CAP, AT THE LAST GATE");
    expect(i).toBeGreaterThan(-1);
    const clause = claimBody.slice(i);
    expect(clause).toMatch(/d\.submitted_at >= date_trunc\('day', now\(\)\)/);
    expect(clause.slice(0, clause.indexOf("ORDER BY"))).not.toMatch(/d\.released_at/);
  });

  it("a missing mandate does not strand packets", () => {
    expect(claimBody).toMatch(/NOT EXISTS \(\s*\n?\s*SELECT 1 FROM public\.agent_mandates/);
  });
});

/**
 * THE ONE I NEARLY SHIPPED. My first draft wrote the cap clause as
 * `AND (...) IS NULL OR (...) < cap` with no wrapping parentheses. SQL parses
 * `A AND B OR C` as `(A AND B) OR C`, so whenever the cap clause was true the
 * ENTIRE preceding WHERE became optional — status, released_at, submitted_at,
 * claimable_at, attempts, all of it. A claim gate that hands out unreleased and
 * already-submitted packets.
 *
 * It would have passed every other assertion in this file.
 */
describe("operator precedence cannot widen the claim gate", () => {
  it("every condition is AND-ed at the top level, with the OR contained", () => {
    const where = claimBody.slice(claimBody.indexOf("WHERE c.status"), claimBody.indexOf("ORDER BY"));
    // Strip comments first: the prose above deliberately mentions OR.
    const bare = where.replace(/--.*$/gm, "");
    // Any OR must sit inside parentheses. A top-level OR — one at paren depth
    // zero relative to the WHERE — is the bug.
    let depth = 0;
    let topLevelOr = false;
    for (let i = 0; i < bare.length; i++) {
      const ch = bare[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && bare.startsWith("OR", i) && /\s/.test(bare[i - 1] ?? " ")) {
        topLevelOr = true;
        break;
      }
    }
    expect(topLevelOr, "a top-level OR makes every other claim condition optional").toBe(false);
  });

  it("the guards that must survive are all still present", () => {
    // Named individually rather than counted, so a rewrite that drops one is
    // caught by name instead of by an arithmetic coincidence.
    for (const guard of [
      /c\.status = 'ready'/,
      /c\.released_at IS NOT NULL/,
      /c\.submitted_at IS NULL/,
      /c\.claimable_at IS NULL OR c\.claimable_at <= now\(\)/,
      /c\.attempts < 3/,
    ]) {
      expect(claimBody, `claim guard missing: ${guard}`).toMatch(guard);
    }
  });
});
