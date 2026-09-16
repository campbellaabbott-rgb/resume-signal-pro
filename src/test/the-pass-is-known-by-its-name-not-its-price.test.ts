/**
 * THE PASS IS KNOWN BY ITS NAME, NOT ITS PRICE.
 *
 * The $99 Agent plan is recognised by unit_amount because it has no Price ID
 * (project_agent_entitlement) — and that rule already means any $99
 * subscription on the account reads as the agent. The pass bills the same
 * amount as Freelance Boost, so an amount match would not be a hypothetical
 * collision: a Freelance Boost sale would mint a pass, and a pass would land
 * in the freelance intake. The purchase is therefore identified ONLY by
 * metadata.product_type, read from _shared/pass.ts in every runtime that
 * names it. SPEC section 6 guard 7.
 *
 * Properties, over comment-stripped code (the BOARD = RAW.replace idiom):
 *   1. stripe-webhook never compares amount_total (or any amount) to
 *      PASS_PRICE_CENTS; the pass branch keys on PASS_PRODUCT_TYPE.
 *   2. triggerProductDelivery's PASS_PRODUCT_TYPE short-circuit sits AFTER the
 *      used_stripe_sessions claim and BEFORE the "No resume session ID" path,
 *      so a pass is neither an orphan to reconcile-stripe nor a generation
 *      failure to the retry queue.
 *   3. the grant runs inside the paid gate, before the delivery claim, through
 *      agent_pass_grant with every number handed in from pass.ts by name.
 *   4. create-pass-checkout: mode payment, price_data.unit_amount from
 *      PASS_PRICE_CENTS, metadata.product_type from PASS_PRODUCT_TYPE, the
 *      {CHECKOUT_SESSION_ID} placeholder verbatim, the buyer from the verified
 *      token (never the body), both refusals before Stripe, and none of the
 *      pass numbers spelled.
 *   5. agent-pass-status repairs from the session only when paid, this user's
 *      and a pass by product_type, through the same RPC.
 * Each property is proven to fail on a mutated copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ");

const WEBHOOK = strip(read("supabase/functions/stripe-webhook/index.ts"));
const CHECKOUT = strip(read("supabase/functions/create-pass-checkout/index.ts"));
const STATUS = strip(read("supabase/functions/agent-pass-status/index.ts"));
const PASS_TS = read("supabase/functions/_shared/pass.ts");

const NUMBER_NAMES = ["PASS_PRICE_CENTS", "PASS_SESSION_HOURS", "PASS_APPLICATIONS", "PASS_QUOTA_PER_DAY", "PASS_RATE_PER_MIN", "PASS_SHELF_LIFE_DAYS"];
const numberOf = (name: string): number => {
  const m = new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`).exec(PASS_TS);
  if (!m) throw new Error(`${name} not found in pass.ts`);
  return Number(m[1]);
};

/** Any comparison of an amount to the price constant, in either operand order. */
const AMOUNT_MATCH = /(?:amount_total|unit_amount|amount_cents|amount)\b[^;\n]{0,40}(?:===|==|!==|!=|<=|>=|<|>)\s*PASS_PRICE_CENTS|PASS_PRICE_CENTS\s*(?:===|==|!==|!=|<=|>=|<|>)[^;\n]{0,40}\b(?:amount_total|unit_amount|amount_cents|amount)\b/;

/**
 * No line of code that names the pass carries one of its numbers — the same
 * rule guard 3 applies to agent-mcp. The whole file is not scanned because a
 * function legitimately spells other numbers (a rate bucket's ceiling, an
 * HTTP status) that can coincide with a pass number.
 */
const PASS_LINE = /\bpass\b|[a-z]Pass\b|\bPass[A-Z]|PASS_|\bpass[A-Z]/;
function passNumbersSpelled(code: string): string[] {
  const values = new Map(NUMBER_NAMES.map((n) => [numberOf(n), n]));
  const hits: string[] = [];
  for (const line of code.split("\n")) {
    if (!PASS_LINE.test(line)) continue;
    for (const m of line.matchAll(/(?<![\w.$])(\d+)(?![\w.])/g)) {
      const name = values.get(Number(m[1]));
      if (name) hits.push(`${name} on: ${line.trim().slice(0, 100)}`);
    }
  }
  return hits;
}

/** The text of a top-level function, to its closing brace at column zero. */
function functionText(code: string, fn: string): string {
  const m = new RegExp(`\\n(?:async )?function ${fn}\\(`).exec(code);
  if (!m) throw new Error(`function ${fn} is not declared`);
  const end = code.indexOf("\n}\n", m.index);
  return code.slice(m.index, end < 0 ? code.length : end + 2);
}

describe("stripe-webhook recognises the pass by product_type only", () => {
  it("imports the identity and every number from pass.ts by name", () => {
    expect(WEBHOOK).toMatch(/import \{[^}]*\bPASS_PRODUCT_TYPE\b[^}]*\} from "\.\.\/_shared\/pass\.ts"/);
    for (const n of NUMBER_NAMES.filter((x) => x !== "PASS_PRICE_CENTS")) {
      expect(WEBHOOK, `${n} must be handed to the grant by name`).toMatch(new RegExp(`\\b${n}\\b`));
    }
  });

  it("never compares an amount to PASS_PRICE_CENTS", () => {
    expect(WEBHOOK).not.toMatch(AMOUNT_MATCH);
    // The existing $99 rule is left exactly where it was; it is not this
    // guard's business, but its presence proves the detector is looking at
    // the right kind of line.
    expect(WEBHOOK).toMatch(/\(session\.amount_total \?\? 0\) === AGENT_PRICE_CENTS/);
  });

  it("the pass branch of the handler keys on PASS_PRODUCT_TYPE, inside the paid gate, before the delivery claim", () => {
    const handler = WEBHOOK.slice(WEBHOOK.indexOf('case "checkout.session.completed":'), WEBHOOK.indexOf('case "payment_intent.payment_failed":'));
    // The gate is 'paid', widened by the shared settlement predicate for the
    // one no-cost shape (a 100%-off pass) — never by an amount comparison.
    const paidGate = handler.indexOf("if (session.payment_status === 'paid' || passSessionSettled(session))");
    const passBranch = handler.indexOf("if (session.metadata?.product_type === PASS_PRODUCT_TYPE)");
    const grant = handler.indexOf("await grantAgentPass(session, supabase)");
    const delivery = handler.indexOf("await triggerProductDelivery(session, supabase, supabaseUrl, passGrant)");
    expect(paidGate).toBeGreaterThan(-1);
    expect(passBranch).toBeGreaterThan(paidGate);
    expect(grant).toBeGreaterThan(passBranch);
    expect(delivery).toBeGreaterThan(grant);
  });

  it("the grant hands every number in by name and binds the pass to a user id, never an email", () => {
    const fn = functionText(WEBHOOK, "grantAgentPass");
    expect(fn).toMatch(/\.rpc\("agent_pass_grant", \{/);
    expect(fn).toMatch(/p_user_id: userId,/);
    expect(fn).toMatch(/session\.client_reference_id \?\? session\.metadata\?\.user_id/);
    for (const [param, name] of [
      ["p_session_hours", "PASS_SESSION_HOURS"], ["p_applications_total", "PASS_APPLICATIONS"],
      ["p_rate_per_min", "PASS_RATE_PER_MIN"], ["p_daily_quota", "PASS_QUOTA_PER_DAY"], ["p_shelf_days", "PASS_SHELF_LIFE_DAYS"],
    ]) {
      expect(fn).toMatch(new RegExp(`${param}: ${name},`));
    }
    expect(fn).not.toMatch(/p_user_id: (?:customerEmail|email|session\.customer_email)/);
    // A session with no user id is refused — not granted to whoever the
    // email says.
    expect(fn).toMatch(/return \{ granted: false, reason: "no_user_id/);
  });

  it("triggerProductDelivery short-circuits the pass after the claim and before the resume-session path", () => {
    const fn = functionText(WEBHOOK, "triggerProductDelivery");
    const claim = fn.indexOf(".from('used_stripe_sessions')");
    const freelance = fn.indexOf("productType === 'freelance_boost'");
    const pass = fn.indexOf("if (productType === PASS_PRODUCT_TYPE)");
    const resume = fn.indexOf("if (!resumeSessionId)");
    expect(claim).toBeGreaterThan(-1);
    expect(pass).toBeGreaterThan(claim);
    expect(pass).toBeGreaterThan(freelance);
    expect(pass).toBeLessThan(resume);
    // The branch closes the ONE delivery row from what the grant did, so a
    // refused grant is a visible generation_failed and a granted one is not a
    // 'payment_received' left to read as stuck.
    const branch = fn.slice(pass, resume);
    expect(branch).toMatch(/status: 'delivered'/);
    expect(branch).toMatch(/status: 'generation_failed'/);
    expect(branch).toMatch(/return \{ success: granted, productType, deferred: PASS_PRODUCT_TYPE/);
    // The refused-grant row is written OUTSIDE retry-failed-deliveries'
    // selection (retry_count < max_retries), or the sweeper overwrites the
    // grant reason with "Resume session ID not available" (review A-6).
    const failedRow = /status: 'generation_failed'[^}]*\}/.exec(branch)?.[0] ?? "";
    expect(failedRow).toMatch(/max_retries: 0\b/);
    expect(failedRow).toMatch(/generation_error: `agent_pass_grant: /);
  });

  it("the no-cost acceptance is the shared predicate, imported by both the webhook and the status reader, and narrow", () => {
    const SETTLE = strip(read("supabase/functions/_shared/pass-settlement.ts"));
    expect(WEBHOOK).toMatch(/import \{ passSessionSettled \} from "\.\.\/_shared\/pass-settlement\.ts"/);
    expect(STATUS).toMatch(/import \{ passSessionSettled \} from "\.\.\/_shared\/pass-settlement\.ts"/);
    // Narrow: payment mode, a zero total, the pass product type — all three.
    expect(SETTLE).toMatch(/session\.mode === "payment"/);
    expect(SETTLE).toMatch(/\(session\.amount_total \?\? 0\) === 0/);
    expect(SETTLE).toMatch(/session\.metadata\?\.product_type === PASS_PRODUCT_TYPE/);
    expect(SETTLE).not.toMatch(AMOUNT_MATCH);
    // The status reader still refuses on the same read, in the same order.
    const fn = functionText(STATUS, "repairFromSession");
    expect(fn).toMatch(/session\.payment_status !== "paid" && !passSessionSettled\(session\)/);
  });
});

describe("create-pass-checkout sells one pass, identified by its name", () => {
  it("is a one-time payment whose only price line is derived from PASS_PRICE_CENTS", () => {
    expect(CHECKOUT).toMatch(/mode: "payment",/);
    expect(CHECKOUT).toMatch(/unit_amount: PASS_PRICE_CENTS,/);
    expect(CHECKOUT).toMatch(/name: PASS_PRODUCT_NAME,/);
    expect(CHECKOUT).toMatch(/product_type: PASS_PRODUCT_TYPE,/);
    expect(CHECKOUT).toMatch(/client_reference_id: user\.id,/);
    expect(CHECKOUT).toMatch(/user_id: user\.id,/);
    expect(CHECKOUT).toMatch(/success_url: `\$\{origin\}\/agents\/pass\?session_id=\{CHECKOUT_SESSION_ID\}`,/);
    expect(CHECKOUT).not.toMatch(/recurring:/);
    expect(CHECKOUT).not.toMatch(/price: "price_/);
  });

  it("spells none of the pass numbers on a line that names the pass — nor do the webhook and the status reader", () => {
    expect(passNumbersSpelled(CHECKOUT)).toEqual([]);
    expect(passNumbersSpelled(WEBHOOK)).toEqual([]);
    expect(passNumbersSpelled(STATUS)).toEqual([]);
  });

  it("takes the buyer from the verified token, never from the body, and refuses subscribers and open passes before Stripe", () => {
    expect(CHECKOUT).toMatch(/authClient\.auth\.getUser\(\)/);
    expect(CHECKOUT).not.toMatch(/req\.json\(\)/);
    expect(CHECKOUT).not.toMatch(/body\.email/);
    const subscribed = CHECKOUT.indexOf("alreadySubscribed: true");
    const open = CHECKOUT.indexOf("alreadyLive: true");
    const stripeCall = CHECKOUT.indexOf("stripe.checkout.sessions.create(");
    expect(subscribed).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(subscribed);
    expect(stripeCall).toBeGreaterThan(open);
    expect(CHECKOUT).toMatch(/checkAgentByEmail\(stripe, service, user\.email\)/);
    // The open-pass read follows the lazy close, so a pass that ended
    // yesterday never blocks a purchase today.
    expect(CHECKOUT.indexOf("await lazyClosePasses(service, user.id)")).toBeLessThan(open);
  });

  it("meters its own bucket by its own name and never the cross-function budget", () => {
    expect(CHECKOUT).toMatch(/p_function: "create-pass-checkout"/);
    expect(CHECKOUT).not.toMatch(/check_global_rate_limit/);
  });
});

describe("agent-pass-status repairs a late webhook only for a paid pass of this user", () => {
  it("checks paid, product_type and ownership before the same idempotent grant", () => {
    const fn = functionText(STATUS, "repairFromSession");
    const paid = fn.indexOf('session.payment_status !== "paid"');
    const type = fn.indexOf("session.metadata?.product_type !== PASS_PRODUCT_TYPE");
    const owner = fn.indexOf("owner !== userId");
    const grant = fn.indexOf('.rpc("agent_pass_grant", {');
    expect(paid).toBeGreaterThan(-1);
    expect(type).toBeGreaterThan(paid);
    expect(owner).toBeGreaterThan(type);
    expect(grant).toBeGreaterThan(owner);
    expect(fn).not.toMatch(AMOUNT_MATCH);
    // Only when no row carries the session already.
    expect(STATUS).toMatch(/\.eq\("stripe_session_id", sessionId\)\.maybeSingle\(\);\s*if \(!bySession\) \{/);
  });

  it("takes the user from the verified token and never auto-mints a key", () => {
    expect(STATUS).toMatch(/authClient\.auth\.getUser\(\)/);
    expect(STATUS).not.toMatch(/api_key_issue/);
    expect(STATUS).toMatch(/\.from\("api_keys"\)/);
  });
});

describe("teeth", () => {
  it("an amount comparison in either order is caught, and a `??` fallback is not", () => {
    expect("if (session.amount_total === PASS_PRICE_CENTS) {").toMatch(AMOUNT_MATCH);
    expect("const isPass = PASS_PRICE_CENTS === (session.amount_total ?? 0);").toMatch(AMOUNT_MATCH);
    expect("unit_amount: PASS_PRICE_CENTS,").not.toMatch(AMOUNT_MATCH);
    expect("p_amount_cents: session.amount_total ?? PASS_PRICE_CENTS,").not.toMatch(AMOUNT_MATCH);
  });

  it("a webhook copy that matches the pass on its amount fails", () => {
    const mutated = WEBHOOK.replace(
      "if (session.metadata?.product_type === PASS_PRODUCT_TYPE)",
      "if ((session.amount_total ?? 0) === PASS_PRICE_CENTS)",
    );
    expect(mutated).not.toBe(WEBHOOK);
    expect(mutated).toMatch(AMOUNT_MATCH);
  });

  it("a copy whose short-circuit sits after the resume-session check fails the order property", () => {
    const fn = functionText(WEBHOOK, "triggerProductDelivery");
    const pass = fn.indexOf("if (productType === PASS_PRODUCT_TYPE)");
    const resume = fn.indexOf("if (!resumeSessionId)");
    expect(pass).toBeLessThan(resume);
    const branch = fn.slice(pass, resume);
    // Move the whole branch to just after the resume-session check.
    const after = fn.replace(branch, "").replace("if (!resumeSessionId) {", "if (!resumeSessionId) {\n" + branch);
    expect(after).not.toBe(fn);
    expect(after.indexOf("if (productType === PASS_PRODUCT_TYPE)")).toBeGreaterThan(after.indexOf("if (!resumeSessionId)"));
  });

  it("a checkout copy that spells the price on the pass's line is reported by name", () => {
    const v = numberOf("PASS_PRICE_CENTS");
    const mutated = CHECKOUT.replace("unit_amount: PASS_PRICE_CENTS,", `unit_amount: ${v} as typeof PASS_PRICE_CENTS,`);
    expect(mutated).not.toBe(CHECKOUT);
    const hits = passNumbersSpelled(mutated);
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatch(/^PASS_PRICE_CENTS on: /);
    // The same number on a line that does not name the pass is not its business.
    expect(passNumbersSpelled(`const ceiling = ${v};`)).toEqual([]);
  });
});
