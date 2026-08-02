/**
 * Entitlement for the Apply Agent — the gate that decides whether software
 * sends job applications in a real person's name.
 *
 * THE BUG THIS LOCKS SHUT, found 2026-08-02. Four functions read
 * agent_subscribers. agent-runner and send-agent-digest checked status and
 * period end. apply-agent and apply-broker checked only that a row EXISTED:
 *
 *     .select("email").eq("email", m.email).maybeSingle();  if (!sub) continue;
 *
 * The two that asked the easier question are the two that prepare and release
 * applications to employers; the two that asked the right one only queue rows
 * and send email. And rows were cheap: agent-access is unauthenticated, takes
 * the email from the request body, and upserted a row whatever Stripe said —
 * including status "inactive" for an address with no Stripe presence at all.
 * Verified live: an anonymous POST returns 200 with no auth header.
 *
 * So the price of an agent subscription was one unauthenticated HTTP request.
 * Nothing had been sent, because no worker was online — which made this a bug
 * rather than an incident, and made it invisible. An open gate with nothing
 * behind it looks exactly like a closed one.
 *
 * Both halves are tested here: the predicate itself, and the structural fact
 * that no consumer has quietly gone back to asking whether a row exists.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  entitledFromRows,
  isEntitled,
  normalizeEmail,
  rowIsEntitled,
  type SubscriberRow,
} from "../../supabase/functions/_shared/agent-entitlement";

const NOW = Date.parse("2026-08-02T12:00:00Z");
const future = new Date(NOW + 30 * 86400_000).toISOString();
const past = new Date(NOW - 86400_000).toISOString();

describe("rowIsEntitled", () => {
  it("refuses a missing row", () => {
    expect(rowIsEntitled(null, NOW)).toBe(false);
    expect(rowIsEntitled(undefined, NOW)).toBe(false);
  });

  // THE ACTUAL LEAK. A row exists — planted by one unauthenticated POST to
  // agent-access, or simply by loading the Account page — and says inactive.
  // The old check returned true for this.
  it("refuses a row that exists but is inactive", () => {
    expect(rowIsEntitled({ email: "a@b.com", status: "inactive", current_period_end: null }, NOW)).toBe(false);
  });

  it("refuses every non-live Stripe status", () => {
    for (const status of ["canceled", "unpaid", "past_due", "incomplete", "incomplete_expired", "paused", ""]) {
      expect(rowIsEntitled({ status, current_period_end: future }, NOW), status).toBe(false);
    }
  });

  it("accepts active and trialing", () => {
    // The acceptance half matters as much as the rejection half: a predicate
    // that refuses everything looks identical to a working gate until the day
    // someone pays and gets nothing.
    expect(rowIsEntitled({ status: "active", current_period_end: future }, NOW)).toBe(true);
    expect(rowIsEntitled({ status: "trialing", current_period_end: future }, NOW)).toBe(true);
  });

  it("accepts an active row with no period end recorded", () => {
    expect(rowIsEntitled({ status: "active", current_period_end: null }, NOW)).toBe(true);
  });

  it("refuses an active row whose period has ended", () => {
    // No grace period, unlike _shared/pro.ts. Sending an application is not
    // reversible; briefly withholding a feature is.
    expect(rowIsEntitled({ status: "active", current_period_end: past }, NOW)).toBe(false);
  });

  it("refuses at the exact instant the period ends", () => {
    expect(rowIsEntitled({ status: "active", current_period_end: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it("treats an unparseable period end as not entitled", () => {
    // NaN comparisons are false, so `ends <= now` would have PASSED this row.
    expect(rowIsEntitled({ status: "active", current_period_end: "not a date" }, NOW)).toBe(false);
  });

  it("is not fooled by a status that merely contains an active word", () => {
    expect(rowIsEntitled({ status: "inactive_active", current_period_end: future }, NOW)).toBe(false);
  });
});

describe("entitledFromRows", () => {
  const rows: SubscriberRow[] = [
    { email: "Paid@Example.com", status: "active", current_period_end: future },
    { email: "trial@example.com", status: "trialing", current_period_end: null },
    { email: "lapsed@example.com", status: "active", current_period_end: past },
    { email: "planted@example.com", status: "inactive", current_period_end: null },
    { email: "", status: "active", current_period_end: future },
  ];

  it("returns only the entitled, normalised", () => {
    const set = entitledFromRows(rows, NOW);
    expect([...set].sort()).toEqual(["paid@example.com", "trial@example.com"]);
  });

  it("survives a null result set", () => {
    // A failed query must not read as "everyone is entitled".
    expect(entitledFromRows(null, NOW).size).toBe(0);
    expect(entitledFromRows(undefined, NOW).size).toBe(0);
  });
});

describe("normalizeEmail", () => {
  it("matches how checkAgentByEmail stores the address", () => {
    // The consumers used to compare a raw mandate email against a stored
    // lower-cased one. That fails closed, so it was never noticed — a
    // subscriber with a capitalised address simply got nothing.
    expect(normalizeEmail("  Alex@Example.COM ")).toBe("alex@example.com");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });
});

describe("no consumer asks the easier question", () => {
  const root = resolve(__dirname, "../..");
  const CONSUMERS = [
    "supabase/functions/apply-agent/index.ts",
    "supabase/functions/apply-broker/index.ts",
    "supabase/functions/agent-runner/index.ts",
    "supabase/functions/send-agent-digest/index.ts",
  ];

  it.each(CONSUMERS)("%s reads the entitlement columns and the shared predicate", (rel) => {
    const src = readFileSync(resolve(root, rel), "utf8");
    expect(src, "must import the one definition").toContain("_shared/agent-entitlement.ts");

    // Every read of the table must select the columns entitlement depends on.
    // `select("email")` is the exact shape of the bug.
    let i = src.indexOf('.from("agent_subscribers")');
    expect(i, "no read of agent_subscribers found").toBeGreaterThan(-1);
    while (i !== -1) {
      const window = src.slice(i, i + 260);
      expect(window, `${rel}: selects too little to judge entitlement`).toContain("ENTITLEMENT_COLUMNS");
      expect(window, `${rel}: selecting only email is the bug`).not.toMatch(/\.select\(\s*"email"\s*\)/);
      i = src.indexOf('.from("agent_subscribers")', i + 1);
    }
  });

  it("nobody hand-rolls the status list any more", () => {
    // Four copies of `status === "active" || status === "trialing"` is how the
    // definitions drifted apart. There must be exactly one, in the shared file.
    for (const rel of CONSUMERS) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src, `${rel} re-implements the status check`).not.toMatch(/status\s*===\s*"trialing"/);
    }
  });
});

describe("a manual grant is honoured on READ, not only on write", () => {
  const root = resolve(__dirname, "../..");
  const shared = readFileSync(resolve(root, "supabase/functions/_shared/agent.ts"), "utf8");

  // FOUND LIVE 2026-08-02. Two paths answer "is this person entitled" and they
  // read different sources. agent-runner / apply-agent / apply-broker read the
  // agent_subscribers table, where a comp actually lives. checkAgentByEmail
  // asked STRIPE. So a comped account was entitled everywhere except the one
  // place that mattered: MorningQueuePanel disables its Resume button on
  // `agentActive === false`, and Resume is what sets agent_mandates.active.
  // The person could not switch their own agent on, and the button was simply
  // grey — no error, no explanation.
  it("falls back to the subscribers table when Stripe says no", () => {
    expect(shared).toMatch(/if \(!result\.active\)/);
    expect(shared).toContain("rowIsEntitled(manual)");
    expect(shared).toMatch(/status: "comped"/);
  });

  it("ONLY honours rows Stripe does not own", () => {
    // Without `stripe_customer_id IS NULL` this would resurrect every lapsed
    // subscriber whose cached row still read active — the opposite mistake,
    // and a far worse one than the bug it fixes.
    const block = shared.slice(shared.indexOf("if (!result.active)"), shared.indexOf("const cached"));
    expect(block).toMatch(/\.is\("stripe_customer_id", null\)/);
  });

  it("returns before the cache write, so the grant is not overwritten", () => {
    const block = shared.slice(shared.indexOf("if (!result.active)"), shared.indexOf("const cached"));
    expect(block).toContain("return {");
  });

  it("a failed lookup does not upgrade anyone", () => {
    const block = shared.slice(shared.indexOf("if (!result.active)"), shared.indexOf("const cached"));
    expect(block, "the catch must not set active").not.toMatch(/catch[\s\S]*active: true/);
  });
});

describe("agent-access cannot mint a row for an address Stripe has never seen", () => {
  const root = resolve(__dirname, "../..");
  const shared = readFileSync(resolve(root, "supabase/functions/_shared/agent.ts"), "utf8");

  it("upserts only when a Stripe customer was found", () => {
    // The endpoint is unauthenticated and takes the email from the body. An
    // unconditional upsert let anyone create an agent_subscribers row for any
    // address. Harmless once status is checked — but there is no reason to
    // leave an anonymous row-creation primitive lying next to an entitlement
    // table, and it was not harmless for the two consumers that only checked
    // existence.
    expect(shared).toMatch(/if \(result\.stripeCustomerId\)/);
    expect(shared).toMatch(/\.upsert\(\{ email: normalized/);
  });

  it("still downgrades an existing row when Stripe no longer knows the customer", () => {
    // UPDATE, not upsert: it must reach a row that is already there without
    // creating one that is not. A customer deleted outright must not stay
    // entitled just because we declined to write.
    expect(shared).toMatch(/\.update\(cached\)\s*\n?\s*\.eq\("email", normalized\)/);
  });

  it("never revokes a grant Stripe did not make", () => {
    // A row with a null stripe_customer_id is a manual grant — a comp, an
    // internal test account, support making someone whole. Stripe having no
    // record of that address is not a reason to revoke it, and without this
    // clause the downgrade path silently ate such rows the next time anyone
    // loaded the Account page. The symptom would have surfaced far away from
    // the cause: the agent just quietly stops doing anything.
    expect(shared).toMatch(/\.not\("stripe_customer_id", "is", null\)/);
  });
});

/**
 * THE SET IS NORMALISED; THE LOOKUP WAS NOT.
 *
 * entitledFromRows lowercases and trims every key it stores. Both consumers
 * then asked for it with the raw mandate address:
 *
 *     if (!entitled.has(m.email)) continue;                    // agent-runner
 *     if (!m.email || !entitled.has(m.email) || suppressed...  // send-agent-digest
 *
 * A paying subscriber whose mandate row holds "Name@Gmail.com" is therefore
 * absent from the set, and is dropped — out of the morning queue, and out of
 * the digest. Neither logs anything. agent-runner reported the result as
 * `{"ok":true,"mandates":0}`, which is the same thing it reports when nobody
 * has created a mandate at all, so the failure is not merely silent: it is
 * disguised as the ordinary empty case.
 *
 * send-agent-digest shows it was a slip and not a decision — the suppression
 * check on the SAME LINE lowercases the address the entitlement check beside it
 * did not.
 */
describe("isEntitled asks the set the way the set was built", () => {
  const set = entitledFromRows([{ email: "user@example.com", status: "active", current_period_end: future }], NOW);

  it("matches the exact address", () => {
    expect(isEntitled(set, "user@example.com")).toBe(true);
  });

  // The bug, as data. Every one of these is the same person.
  it.each(["User@Example.com", "USER@EXAMPLE.COM", "  user@example.com  ", "User@Example.com "])(
    "matches %j, which the raw lookup dropped", (variant) => {
      expect(set.has(variant), "precondition: the raw lookup really does miss").toBe(false);
      expect(isEntitled(set, variant)).toBe(true);
    });

  it("still refuses an address that is genuinely absent", () => {
    expect(isEntitled(set, "someone-else@example.com")).toBe(false);
  });

  it("refuses empty and non-string input rather than matching an empty key", () => {
    for (const junk of ["", "   ", null, undefined, 42, {}]) {
      expect(isEntitled(set, junk), String(junk)).toBe(false);
    }
    // An entitled set built from a blank address must not create a key that a
    // blank lookup then matches.
    const blank = entitledFromRows([{ email: "", status: "active", current_period_end: future }], NOW);
    expect(isEntitled(blank, "")).toBe(false);
  });
});

describe("no consumer re-derives the comparison", () => {
  // Written against the CLASS, not the two known instances. The last time a
  // guard here was written against specific filenames, the identical bug in a
  // sibling file survived the fix.
  const CONSUMERS = [
    "supabase/functions/agent-runner/index.ts",
    "supabase/functions/send-agent-digest/index.ts",
  ];
  const root = resolve(__dirname, "../..");

  it.each(CONSUMERS)("%s never queries the entitled set with a raw address", (rel) => {
    const src = readFileSync(resolve(root, rel), "utf8");
    // Strip comments — the prose above each fix quotes the old broken line, and
    // a guard that cannot tell code from a description of code is not a guard.
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    const raw = [...code.matchAll(/entitled\.has\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(raw, `${rel} calls entitled.has(...) directly; use isEntitled(entitled, email)`).toEqual([]);
  });

  it.each(CONSUMERS)("%s imports the shared helper", (rel) => {
    const src = readFileSync(resolve(root, rel), "utf8");
    expect(src).toMatch(/import\s*\{[^}]*\bisEntitled\b[^}]*\}\s*from\s*"\.\.\/_shared\/agent-entitlement\.ts"/);
  });
});
