/**
 * A PRO GRANT IS A ONE-USE TOKEN THAT COULD BE USED FOREVER.
 *
 * create-product-checkout mints a `pro_grants` row instead of a Stripe session
 * when the caller's subscription already covers the product — the paid path
 * without the payment. verify-product-purchase redeems it: it looked the grant
 * up by id, re-checked the subscription, wrote `consumed_at`, and handed back a
 * synthetic paid session.
 *
 * `consumed_at` was written and never read. So the grant id — which lives in a
 * success URL a person can bookmark, re-open, forward, or simply reload — kept
 * working. Every redemption minted the product again. The column existed, was
 * maintained, and enforced nothing; a reader would see it being set and assume
 * the token was single-use.
 *
 * Two distinct holes, and closing one does not close the other:
 *
 *   REPLAY is sequential — the same id used tomorrow. Closed by making
 *   consumed_at part of the LOOKUP, so a spent grant is simply not found.
 *
 *   DOUBLE-CLAIM is concurrent — two requests in the same instant. Both pass
 *   any SELECT, because neither has written yet. Only an UPDATE that filters
 *   and writes in one statement can settle it, and only if the code checks
 *   whether it actually updated a row.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY. The consume stays AFTER the subscription
 * re-check. Consuming first would mean a subscriber whose card failed an hour
 * ago loses the grant to the 402 that refuses them — burned by the check that
 * turned them away. Fail first, spend last.
 *
 * ALSO HERE: company-claim answering "Company not found on the board" when its
 * own existence query errored. Same shape as the search tier returning [] on a
 * deadline and the heartbeat checks that vanished on a timeout — a failure
 * dressed as an answer. This one is aimed at an employer trying to claim their
 * real listing, and it tells them they do not exist. They leave; a retry would
 * have worked.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
/** Comments stripped — this file quotes the broken shapes to explain them. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const VERIFY = code(read("supabase/functions/verify-product-purchase/index.ts"));
const CLAIM = code(read("supabase/functions/company-claim/index.ts"));

describe("a spent grant is not found, and two callers cannot both spend it", () => {
  const grantBlock = VERIFY.slice(
    VERIFY.indexOf('.from("pro_grants")'),
    VERIFY.indexOf("Pro grant verified"),
  );

  it("has a grant block to inspect", () => {
    expect(grantBlock.length, "the pro_grants redemption path is gone or renamed").toBeGreaterThan(300);
  });

  it("looks the grant up unconsumed, so a replayed id finds nothing", () => {
    const lookup = grantBlock.slice(0, grantBlock.indexOf(".maybeSingle()"));
    expect(lookup, "the SELECT ignores consumed_at — a bookmarked success URL mints the product again")
      .toMatch(/\.is\("consumed_at", null\)/);
  });

  it("consumes with a filtered UPDATE, not a bare write", () => {
    const update = grantBlock.slice(grantBlock.indexOf(".update({ consumed_at"));
    expect(update, "the consume does not filter on consumed_at — two concurrent requests both succeed")
      .toMatch(/\.is\("consumed_at", null\)/);
  });

  it("checks whether the consume actually claimed the row", () => {
    // .update().is(...) is atomic on its own, but a caller that ignores the
    // result cannot tell winning from losing — which is the whole point of
    // making it atomic. It must select back and refuse on zero rows.
    const update = grantBlock.slice(grantBlock.indexOf(".update({ consumed_at"));
    expect(update, "the UPDATE returns nothing, so the loser of a race is granted the product too")
      .toMatch(/\.select\("id"\)/);
    expect(update, "a zero-row consume is not refused").toMatch(/consumed\.length === 0/);
  });

  it("spends the grant only after the subscription re-check has passed", () => {
    // Otherwise the 402 for a lapsed subscriber burns the grant on its way out.
    const subCheck = VERIFY.indexOf("Subscription is not active");
    const consume = VERIFY.indexOf('.update({ consumed_at');
    expect(subCheck, "the subscription re-check is gone").toBeGreaterThan(-1);
    expect(consume, "the consume is gone").toBeGreaterThan(-1);
    expect(consume, "a lapsed subscriber's grant is burned by the refusal").toBeGreaterThan(subCheck);
  });
});

describe("could not check is not the same as not there", () => {
  it("separates an errored existence check from a genuine absence", () => {
    const block = CLAIM.slice(
      CLAIM.indexOf('.from("job_board_postings")') - 400,
      CLAIM.indexOf("Company not found on the board.") + 80,
    );
    expect(block, "the existence check discards its error").toMatch(/error: cErr/);
    expect(block, "an errored check still answers 404 — a real employer is told they do not exist")
      .toMatch(/if \(cErr\) return json\([\s\S]{0,160}?503\)/);
    expect(block, "the genuine-absence answer is gone").toMatch(/Company not found on the board\.[\s\S]{0,40}404/);
  });
});
