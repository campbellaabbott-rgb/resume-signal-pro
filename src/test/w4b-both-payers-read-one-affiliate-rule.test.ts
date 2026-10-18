/**
 * BOTH PAYERS READ ONE AFFILIATE RULE (payments-delivery's handoff, applied at
 * integration).
 *
 * stripe-webhook and verify-product-purchase each record a referred sale's
 * commission, and each kept its own copy of the rule: a list of "small" tools
 * paid $1, everything else $5, a named amount paid exactly. The copies had
 * drifted before (the webhook's list once lacked two products and paid the $7
 * Apply Assistant at the $5 tier). checkout-catalogue wrote the rule once, in
 * _shared/affiliate-commission.ts (commissionCentsFor); both payers now call
 * it and keep no list of their own.
 *
 * The rule itself, run: a referral marked "none" pays $0, the Pro checkout's
 * named $10 pays 1000, and a session minted before the rule is paid by the
 * rule it was sold under. The webhook's handler test
 * (w4b-payments-the-webhook-records-retired-sales-ends-retired-plans-and-says-what-happened.test.ts,
 * cs_live_referred_pro_1/2) runs the shipped webhook through this call.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commissionCentsFor, PRO_FIRST_MONTH_COMMISSION_CENTS, withReferralCommission } from "../../supabase/functions/_shared/affiliate-commission";
import { codeOf } from "./helpers/strip-comments";

const src = (fn: string) => codeOf(readFileSync(resolve(__dirname, "../../supabase/functions", fn, "index.ts"), "utf8"));

describe("the two payers", () => {
  it.each(["stripe-webhook", "verify-product-purchase"])("%s computes the commission with commissionCentsFor and keeps no list of its own", (fn) => {
    const code = src(fn);
    expect(code).toMatch(/import \{ commissionCentsFor \} from "\.\.\/_shared\/affiliate-commission\.ts"/);
    expect(code).toMatch(/const commissionCents = commissionCentsFor\(session\.metadata\)/);
    expect(code).not.toMatch(/lowCommission/);
    expect(code).not.toMatch(/\? 100 : 500/);
  });
});

describe("the rule they read", () => {
  it("pays a referred first Pro month the flat amount the Pro checkout names", () => {
    const md = withReferralCommission({ referral_code: "AFF1", product_type: "pro_subscription" }, "pro_first_month");
    expect(commissionCentsFor(md)).toBe(PRO_FIRST_MONTH_COMMISSION_CENTS);
  });

  it("records every other referred checkout at $0", () => {
    expect(commissionCentsFor({ referral_commission: "none", product_type: "full_analysis" })).toBe(0);
    expect(commissionCentsFor(withReferralCommission({ referral_code: "AFF1", product_type: "full_analysis" }, "none"))).toBe(0);
  });

  it("pays a session minted before the rule by the rule it was sold under", () => {
    expect(commissionCentsFor({ product_type: "cover_letter" })).toBe(100);
    expect(commissionCentsFor({ product_type: "premium_package" })).toBe(500);
    expect(commissionCentsFor({ product_type: "full_analysis" })).toBe(0);
  });
});
