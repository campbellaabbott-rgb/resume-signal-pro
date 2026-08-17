import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE AGENT WENT SILENT ON THE DAY THE CARD WAS FIRST CHARGED.
 *
 * `checkout.session.completed` seeds the entitlement cache once, at purchase,
 * with `current_period_end` set to the END OF THE 7-DAY TRIAL. Nothing refreshed
 * it afterwards. `rowIsEntitled()` compares that timestamp to now, so on day 8 —
 * the moment the first real $99 charge succeeds — the cached row expired and
 * every consumer began skipping the customer.
 *
 * It failed silently in three places at once: apply-agent skipped with a BARE
 * `continue` and no counter, apply-broker unclaimed, and the digest email was
 * suppressed. The run reported `{mandates: N, prepared: 0}` — byte-identical to
 * "nobody matched any jobs today". The customer got no queue, no email and no
 * error on the first day they actually paid, and it only recovered if they
 * happened to load /account, which re-seeds the row as a side effect.
 *
 * Two halves are locked here, because fixing either alone leaves the trap:
 *   1. stripe-webhook LISTENS to the lifecycle events that change entitlement.
 *   2. apply-agent COUNTS the skip, so the next occurrence is visible instead of
 *      looking like a quiet night.
 *
 * These are source-shape assertions rather than behavioral ones: edge functions
 * are Deno and are not importable from the vitest (jsdom) environment. They are
 * deliberately written against the specific regressions — deleting a case, or
 * reverting the counter to a bare `continue` — not against incidental text.
 */
const FN = resolve(__dirname, "../../supabase/functions");
const webhook = readFileSync(resolve(FN, "stripe-webhook/index.ts"), "utf8");
const applyAgent = readFileSync(resolve(FN, "apply-agent/index.ts"), "utf8");
const shared = readFileSync(resolve(FN, "_shared/agent.ts"), "utf8");

/**
 * The body of refreshAgentEntitlement, and ONLY that body.
 *
 * Every assertion below is scoped through this rather than searching the whole
 * file, because the first draft did the latter and one of its three checks
 * passed vacuously: `/async function refreshAgentEntitlement[\s\S]*?customers\.retrieve\(/`
 * is lazy but unbounded, so when the call was deleted from the function the
 * match simply ran on to the unrelated `customers.retrieve` at line ~601 and
 * still succeeded. Break-testing is what exposed it — the mutation was applied
 * and the suite stayed green. Bounded at the first line that starts a new
 * top-level declaration.
 */
const refresherBody = (() => {
  const start = webhook.indexOf("async function refreshAgentEntitlement");
  if (start === -1) return "";
  const rest = webhook.slice(start);
  // The function's closing brace is the first `\n}` at column 0.
  const end = rest.search(/\n\}/);
  return end === -1 ? rest : rest.slice(0, end + 2);
})();

/** The events that can change whether somebody is entitled. */
const LIFECYCLE_EVENTS = [
  "invoice.payment_succeeded",   // the renewal — the day-8 case itself
  "invoice.payment_failed",      // card declined; subscription heads for past_due
  "customer.subscription.updated", // trial->active, ->past_due, ->canceled
  "customer.subscription.deleted", // cancellation
];

describe("stripe-webhook refreshes agent entitlement on renewal", () => {
  for (const evt of LIFECYCLE_EVENTS) {
    it(`handles ${evt}`, () => {
      expect(
        webhook.includes(`case "${evt}"`),
        `stripe-webhook does not handle ${evt}. Without it the cached ` +
          `entitlement is never refreshed after checkout, and a subscriber's ` +
          `agent goes silent when their trial period end passes.`,
      ).toBe(true);
    });
  }

  it("routes those events through the entitlement refresher", () => {
    expect(refresherBody, "refreshAgentEntitlement not found").not.toBe("");
    expect(
      webhook.includes("refreshAgentEntitlement("),
      "the lifecycle cases must call refreshAgentEntitlement",
    ).toBe(true);
    // The refresher has to actually re-read Stripe, not just log.
    expect(
      refresherBody.includes("checkAgentByEmail("),
      "refreshAgentEntitlement must call checkAgentByEmail — that is what " +
        "re-reads Stripe and rewrites the cache",
    ).toBe(true);
  });

  it("resolves an email when the event carries only a customer id", () => {
    // Subscription events have no email at all; an invoice's customer_email can
    // be null. Without the customer lookup the refresh silently no-ops on
    // exactly the events that matter most.
    expect(
      refresherBody.includes("customers.retrieve("),
      "refreshAgentEntitlement must fall back to stripe.customers.retrieve",
    ).toBe(true);
    expect(
      refresherBody.includes("deleted?: boolean"),
      "a deleted customer returns { deleted: true } with no email and must be " +
        "handled rather than read as an empty address",
    ).toBe(true);
  });

  it("never lets a refresh failure 500 the webhook", () => {
    // A throw here would make Stripe retry a delivery that already succeeded.
    expect(refresherBody, "refreshAgentEntitlement not found").not.toBe("");
    expect(
      /try\s*\{[\s\S]*\}\s*catch/.test(refresherBody),
      "refreshAgentEntitlement must swallow its own errors",
    ).toBe(true);
  });

  it("asks one shared question about what an agent subscription is", () => {
    // The price check used to be inline in _shared/agent.ts only. The webhook
    // needs the same rule, and a second copy is how the readers of
    // agent_subscribers drifted apart the first time.
    expect(shared.includes("export function isAgentPriced")).toBe(true);
    expect(
      webhook.includes("isAgentPriced"),
      "stripe-webhook must reuse isAgentPriced rather than re-deriving the rule",
    ).toBe(true);
  });
});

describe("apply-agent makes a lapsed entitlement visible", () => {
  it("declares the skippedNotEntitled counter", () => {
    expect(
      /skippedNotEntitled:\s*0/.test(applyAgent),
      "summary must declare skippedNotEntitled",
    ).toBe(true);
  });

  it("increments it instead of skipping silently", () => {
    // THE REGRESSION THIS CATCHES, precisely: `if (!rowIsEntitled(sub)) continue;`
    // with nothing counted. Scoped to the statement so an unrelated edit
    // elsewhere cannot satisfy or break it by accident.
    const m = /if \(!rowIsEntitled\(sub\)\)([\s\S]{0,220}?)\n\s*\}/.exec(applyAgent);
    expect(m, "the rowIsEntitled guard was not found — has it been renamed?").toBeTruthy();
    expect(
      m![1].includes("summary.skippedNotEntitled++"),
      "the entitlement skip must increment summary.skippedNotEntitled. A bare " +
        "`continue` makes a paying customer's silent lapse look identical to " +
        "'no matching jobs today' — which is how the day-8 expiry hid.",
    ).toBe(true);
  });

  it("keeps it beside the other explainable-zero counters", () => {
    // Not decorative: these are what let "0 applications" be explained. If this
    // one drifts out of the summary object the counter increments into nothing.
    for (const k of ["skippedPaused", "skippedBlockedCompany", "skippedEmployerCooldown", "skippedNotEntitled"]) {
      expect(applyAgent.includes(`${k}: 0`), `${k} missing from the summary`).toBe(true);
    }
  });
});
