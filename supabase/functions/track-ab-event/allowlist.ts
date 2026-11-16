// THE EVENTS THE SITE SENDS, AND NOTHING ELSE (S14X-154).
//
// WHAT WAS WRONG. The function checked only that a body had a test, a
// variant, a visitor and a type of view or conversion, so any caller could
// write rows under any test name the owner's dashboards read, purchases
// included: a POST of {conversion_funnel, purchase_completed, conversion}
// was a sale in the funnel, and an A/B conversion was a win for whichever
// variant the caller named.
//
// WHAT HOLDS NOW. Each test the browser sends is listed here with the event
// types it sends and the shape of its variants; anything else is refused
// before any count or write. A conversion of a purchase test (the funnel's
// purchase_completed, product_conversion, every A/B test) is a purchase, and
// the budget records it only when its Stripe Checkout session is one the
// site minted or redeemed (budget.ts, ab_purchase_known).
//
// THE LIST IS HELD TO THE SOURCE. A guard in src/test
// (every-event-the-site-sends-is-on-the-writers-list.test.ts) derives every
// test name the browser sends from src/, and holds the names here to exactly
// that set, the funnel stages, cohort sources and A/B variants below to the
// browser's own lists, and every literal variant the browser sends to the
// pattern here. A new event is added in both places or the guard fails.
//
// Pure data and two pure functions, so the Deno test and the vitest guard
// both import it.

export type EventType = "view" | "conversion";

export interface EventRule {
  /** The variants a view of this test may carry; absent when the browser sends no view. */
  view?: RegExp;
  /** The variants a conversion may carry; absent when the browser sends no conversion. */
  conversion?: RegExp;
  /** A conversion of this test is a purchase, recorded only for a session the site knows. */
  purchase?: boolean;
}

/** src/hooks/use-funnel-tracking.ts FUNNEL_STAGES. */
export const FUNNEL_STAGES = [
  "landing_view", "upload_started", "upload_completed", "scan_started", "scan_completed",
  "results_viewed", "product_clicked", "checkout_started", "purchase_completed",
] as const;

/** src/hooks/use-cohort-tracking.ts TRAFFIC_SOURCES. */
export const TRAFFIC_SOURCES = ["organic", "paid", "social", "referral", "direct", "email"] as const;

/** src/hooks/use-ab-test.ts AB_TESTS: each running test and its variants. */
export const AB_TEST_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  social_proof_placement: ["control", "above_fold", "inline_hero"],
  hero_layout: ["compact", "original", "ultra_compact", "social_first", "benefit_led"],
  free_content_depth: ["control", "gated"],
};

/** src/hooks/use-ab-test.ts clickTestName: a CTA click is a view under its own test name. */
export const clickTestName = (testName: string): string => `${testName}__click`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const oneOf = (values: readonly string[]): RegExp => new RegExp(`^(?:${values.map(escape).join("|")})$`);

/** A lower-case snake word, the shape of every named variant the browser sends. */
const WORD = /^[a-z][a-z0-9_]{0,29}$/;
/** A product key or kind: fullAnalysis, pro, scan_credits_variable. */
const PRODUCT = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;
/** crashVariant(place, message): the place, cut to 21, then a colon and 8 hex (older builds sent the place alone). */
const CRASH = /^[A-Za-z0-9_. -]{1,21}(?::[0-9a-f]{8})?$/;
/** `${page}:${milestone}%`, cut to 30 (older builds sent the milestone alone). */
const SCROLL = /^(?:[A-Za-z0-9_-]{1,30}(?::\d{0,3}%?)?|\d{1,3}%)$/;
/** `${page}:${30s|2m}`, cut to 30. */
const TIME = /^(?:[A-Za-z0-9_-]{1,30}(?::\d{0,3}[sm]?)?|\d{1,3}[sm])$/;

const RULES: Array<[string, EventRule]> = [
  ["conversion_funnel", { view: oneOf(FUNNEL_STAGES.filter((s) => s !== "purchase_completed")), conversion: oneOf(["purchase_completed"]), purchase: true }],
  ["product_conversion", { view: PRODUCT, conversion: PRODUCT, purchase: true }],
  ["cohort_analysis", { view: oneOf(TRAFFIC_SOURCES), conversion: oneOf(TRAFFIC_SOURCES) }],
  ["auth_funnel", { conversion: WORD }],
  ["job_board", { view: WORD }],
  ["job_page", { view: oneOf(["posting_view", "score_against_job"]) }],
  ["client_error", { view: CRASH }],
  ["nav", { view: /^nav_[a-z0-9_]{1,26}$/ }],
  ["scroll_depth", { view: SCROLL }],
  ["time_on_page", { view: TIME }],
  ["share_scorecard", { conversion: oneOf(["download", "copy", "linkedin_share"]) }],
  ["optimization_features", { view: WORD, conversion: WORD }],
  ["cache_reanalyze", { conversion: oneOf(["button_click"]) }],
  ["agents", { view: WORD }],
  ...Object.entries(AB_TEST_VARIANTS).flatMap(([name, variants]): Array<[string, EventRule]> => [
    [name, { view: oneOf(variants), conversion: oneOf(variants), purchase: true }],
    [clickTestName(name), { view: oneOf(variants) }],
  ]),
];

/** Every test the browser sends, and its rule. A Map, so no inherited key is ever a test. */
export const EVENT_RULES: ReadonlyMap<string, EventRule> = new Map(RULES);

/** True when the browser sends this test, with this type, in this variant's shape. */
export function admits(testName: unknown, variant: unknown, eventType: unknown): boolean {
  if (typeof testName !== "string" || typeof variant !== "string") return false;
  if (eventType !== "view" && eventType !== "conversion") return false;
  const pattern = EVENT_RULES.get(testName)?.[eventType];
  return pattern !== undefined && pattern.test(variant);
}

/** True when this event is a purchase: a conversion of a purchase test. */
export function isPurchase(testName: string, eventType: string): boolean {
  return eventType === "conversion" && EVENT_RULES.get(testName)?.purchase === true;
}

const STRIPE_CHECKOUT = /^cs_(test|live)_/;

/**
 * The Stripe Checkout session a purchase names, as the writer reads it (the
 * migration that defines ab_purchase_known redefines the writer beside it):
 * stripeSessionId, else sessionId, except in the conversion funnel, whose
 * sessionId is the funnel's tab id.
 */
export function stripeSessionOf(testName: string, metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (typeof m.stripeSessionId === "string" && STRIPE_CHECKOUT.test(m.stripeSessionId)) return m.stripeSessionId;
  if (testName !== "conversion_funnel" && typeof m.sessionId === "string" && STRIPE_CHECKOUT.test(m.sessionId)) return m.sessionId;
  return null;
}
