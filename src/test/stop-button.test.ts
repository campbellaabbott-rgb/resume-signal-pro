/**
 * TURNING THE AGENT OFF DID NOT STOP IT SENDING.
 *
 * MEASURED 2026-08-03 by reading the two gates side by side.
 *
 * `agent_mandates.active` is what a candidate toggles to switch the agent off,
 * and there is UI for it (MorningQueuePanel). apply-agent has always honoured
 * it — `.eq("active", true)` — so switching off correctly stopped NEW packets
 * being prepared.
 *
 * apply-broker never looked at it. Packets already released stayed claimable,
 * and the broker handed them to a worker that typed them into an employer's
 * form. So "off" meant "no new ones", while the existing queue kept draining
 * into real applications for as long as it took to empty — hours, and with no
 * way for the candidate to intervene.
 *
 * The person most likely to press stop is the person who just accepted a job,
 * or changed their mind about a company. For them the queue draining anyway is
 * not a delay, it is the failure.
 *
 * WHY THE BROKER IS THE RIGHT PLACE, and not merely an extra one: its own
 * comment has said for months that it is "the LAST gate before a packet is
 * handed to a worker that will type it into an employer's form", and that is
 * precisely why entitlement is re-checked there rather than trusted from prep
 * time. A candidate's instruction to stop deserves at least the standing of
 * their subscription status.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const broker = readFileSync(
  resolve(__dirname, "../../supabase/functions/apply-broker/index.ts"), "utf8");
const agent = readFileSync(
  resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("stop means stop, at every gate", () => {
  it("apply-agent still refuses to PREPARE for an inactive mandate", () => {
    expect(code(agent), "the prepare-side gate is gone")
      .toMatch(/\.eq\("active",\s*true\)/);
  });

  it("apply-broker refuses to RELEASE for an inactive mandate", () => {
    expect(code(broker), "the broker no longer checks active — a paused agent will keep sending")
      .toMatch(/mandate\.active !== true/);
  });

  it("the broker actually selects `active` — a check on an unselected column is always undefined", () => {
    // The subtle way this fix could look present and do nothing: PostgREST
    // returns only the columns named in select(), so `mandate.active` on a row
    // that never fetched it is undefined, the guard fires on every claim, and
    // the agent silently stops working entirely.
    const sel = broker.slice(broker.indexOf('from("agent_mandates")'), broker.indexOf(".eq(\"user_id\""));
    expect(sel, "`active` is checked but never selected").toMatch(/consent_to_processing,active|active,/);
  });

  it("fails CLOSED — null or missing does not send", () => {
    // `!== true` rather than `=== false`. A mandate row with a null `active`,
    // or one written before the column existed, must not send.
    expect(code(broker)).not.toMatch(/mandate\.active === false/);
  });

  it("releases the claim rather than dropping the packet", () => {
    // The packet must go back in the pool, not vanish: if the candidate turns
    // the agent on again it should still be there.
    const idx = code(broker).indexOf("mandate.active !== true");
    expect(code(broker).slice(idx, idx + 80)).toMatch(/await unclaim\(\)/);
  });

  it("is checked BEFORE the entitlement query, so a stop costs no extra work", () => {
    const c = code(broker);
    // Anchor on the CALL, not the identifier: `rowIsEntitled` also appears in
    // the import at the top of the file, and matching that made this assertion
    // compare the gate against line 1 and fail for the wrong reason.
    const gate = c.indexOf("mandate.active !== true");
    const entitlementCall = c.indexOf("if (!rowIsEntitled(");
    expect(gate, "the active gate is gone").toBeGreaterThan(-1);
    expect(entitlementCall, "the entitlement call site moved or was renamed").toBeGreaterThan(-1);
    expect(gate).toBeLessThan(entitlementCall);
  });
});
