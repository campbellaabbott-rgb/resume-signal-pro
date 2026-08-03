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

/**
 * THE GATE HAS TO BE OBSERVABLE OR IT IS STILL AN ASSUMPTION.
 *
 * The stop-button fix shipped and could not be confirmed. job-board publishes
 * its version in `status`; apply-agent puts its version in its own 403 for
 * exactly this purpose. apply-broker — the LAST gate before a packet reaches an
 * employer's form — answered every unauthenticated caller with a bare
 * `{"error":"unauthorized"}`.
 *
 * So the most safety-critical component in the chain was the only one whose
 * deployed state could not be checked without the worker credential, which
 * lives on one laptop. The deploy report read "paused-agent release refusal
 * live" — true, and derived from the source that was deployed rather than from
 * asking the broker. Those are different kinds of statement, and for a control
 * whose whole job is to make something stop, the difference matters.
 */
describe("the broker says which build is deployed", () => {
  it("puts the version in its 401", () => {
    expect(code(broker), "an unauthenticated caller cannot tell which build is live")
      .toMatch(/error: "unauthorized", version: BUILD_VERSION/);
  });

  it("declares BUILD_VERSION before the refusal uses it", () => {
    // `const` is not hoisted: a use above the declaration is a ReferenceError
    // at request time, turning every 401 into a 500.
    const c = code(broker);
    expect(c.indexOf("const BUILD_VERSION")).toBeLessThan(c.indexOf('error: "unauthorized"'));
  });

  it("still says nothing about the secret itself", () => {
    // A version is not a credential. A missing secret already returns 503
    // further up and must keep doing so — the 401 must not become a way to
    // probe whether a key is configured.
    const c = code(broker);
    const idx = c.indexOf('error: "unauthorized"');
    expect(c.slice(idx, idx + 120)).not.toMatch(/expected|presented|APPLY_WORKER_SECRET/);
    // The unconfigured case keeps its own distinct status, so the 401 never
    // becomes a way to probe whether a key exists.
    expect(c).toMatch(/broker not configured/);
    expect(c).toMatch(/503/);
  });
});
