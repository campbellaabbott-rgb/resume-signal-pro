// THE BUILDER API CARD — a demand test, not a product (owner decision
// 2026-10-11, economics decision 4(a)).
//
// /data-api shows one "Builder API (planned)" card at this price with a way
// to ask for it. There is NO checkout behind it: billing is built only after
// at least one written request arrives. So the card must never carry a buy
// button, a Stripe link or a sign-up flow, and its copy says "planned".
// src/test/the-builder-card-asks-for-interest-and-sells-nothing.test.tsx
// mounts the page and holds it to that.

/** The planned monthly price, in US dollars. Interpolated, never typed into copy. */
export const BUILDER_PLAN_PRICE_USD = 49;

/** The page anchor the /v1 402 answers point at (/data-api#builder). */
export const BUILDER_PLAN_ANCHOR = "builder";

/** The subject line of the request email, so the owner can count requests. */
export const BUILDER_PLAN_MAIL_SUBJECT = "Builder API plan";
