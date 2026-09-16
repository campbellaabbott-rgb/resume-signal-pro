// The six-hour Agent Pass — ONE place its numbers are spelled in the runtime
// that charges. Every other runtime either MIRRORS these (src/config/products.ts
// PASS, pinned by src/test/pricing-truth.test.ts, which reads this file) or
// COPIES them in at grant (the agent_passes row carries its own price, hours,
// applications, quota, rate and shelf date), so a later change here never
// rewrites a pass already sold. Never spell one of these numbers a second
// time — not in SQL, not in a comment, not in copy (project_claim_drift: the
// copy goes false when the thing it describes moves runtimes).
//
// Import-free on purpose, like agent-entitlement.ts: importable by the Deno
// functions and by the Node test suite alike.
//
// Provenance for every value: owner decision 2026-09-16 (memory
// project_agent_pass) — "connect their agent as easy as possible; sell one
// pass for access with your agent" — as built out in scratchpad/pass/SPEC.md
// section 0.1. The one exception is marked GUESS below.

/**
 * Cents, because Stripe's price_data.unit_amount is cents and the cross-runtime
 * guard asserts the frontend's priceUsd times one hundred against it. NEVER the
 * product's identity: Freelance Boost bills the same amount, so the webhook
 * dispatches on metadata.product_type (PASS_PRODUCT_TYPE), never on the amount.
 */
export const PASS_PRICE_CENTS = 2900;

/**
 * Length of the session. The clock starts at the first ALLOWED keyed /mcp/
 * call other than key_status, on read inside api_key_check — never at purchase
 * (a kick at purchase bought exactly zero seconds: the buyer has no mandate yet).
 */
export const PASS_SESSION_HOURS = 6;

/**
 * Applications accepted inside the session; also the send ceiling for the pass
 * tier (TIER_SEND_CEILING). Consumed only at accepted: true inside the enqueue
 * RPC; unused ones lapse with the clock — no rollover, no credit ledger.
 */
export const PASS_APPLICATIONS = 10;

/**
 * Daily call quota and per-minute rate while the pass is live on an /mcp/
 * endpoint. Served as OUT values by api_key_check (an overlay by user_id) —
 * never written to api_keys, so there is no revert step to forget and a key
 * rotation mid-pass keeps the pass.
 */
export const PASS_QUOTA_PER_DAY = 10000;
export const PASS_RATE_PER_MIN = 300;

/**
 * GUESS — no measured basis. How long an unactivated pass keeps before it
 * closes lazily (close_reason shelf_expired). Chosen only because it is the
 * one rhythm the site already states (the posting window, the /v1 free changes
 * window). Copied to agent_passes.shelf_expires_at at grant. Re-decide from
 * activated_at minus purchased_at on the first fifty passes (SPEC section 8).
 */
export const PASS_SHELF_LIFE_DAYS = 30;

/**
 * THE identity of the purchase: Stripe metadata.product_type at checkout,
 * used_stripe_sessions.product_type when the webhook claims the session, the
 * short-circuit in triggerProductDelivery before the resume-session path.
 */
export const PASS_PRODUCT_TYPE = "agent_pass";

/**
 * What api_key_check answers as key_tier while a pass is live on an /mcp/
 * endpoint. Never a column write; never a paid /v1 tier (see key-tier.ts).
 */
export const PASS_TIER = "pass";

/** Stripe price_data.product_data.name — what the receipt says. */
export const PASS_PRODUCT_NAME = "Resume Booster Agent Pass — six hours";
