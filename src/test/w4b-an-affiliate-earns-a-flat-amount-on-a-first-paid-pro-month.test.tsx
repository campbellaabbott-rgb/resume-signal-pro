/**
 * AN AFFILIATE EARNS A FLAT AMOUNT ON A REFERRED CUSTOMER'S FIRST PAID PRO
 * MONTH (owner decision 2026-10-12, the affiliate re-base; S12-133's source
 * of truth).
 *
 * WHAT CHANGED. The old flat rates paid on the one-off catalogue the product
 * line cut; Pro paid nothing. Now one amount is paid, on Pro's first month,
 * and nothing else earns. Commissions already earned stay earned, and a
 * session minted before this rule shipped (no marker) is paid by the rule it
 * was sold under.
 *
 * WHAT HOLDS, run and read:
 *   - commissionCentsFor (_shared/affiliate-commission.ts) decides every case;
 *   - the page's figure is the server's (src/config/affiliate-commission.ts
 *     held equal), and the page names no cut product and no percentage;
 *   - only the Pro checkout stamps the first-month rule and NAMES its amount
 *     (referral_commission_cents), which is what stripe-webhook and
 *     verify-product-purchase pay; every other checkout stamps "none";
 *   - the payers' fallback lists are the legacy rule's, so a session from
 *     before the deploy is paid as it was promised.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  commissionCentsFor, LEGACY_OTHER_CENTS, LEGACY_SMALL_TOOL_CENTS, LEGACY_SMALL_TOOL_PRODUCT_TYPES,
  PRO_FIRST_MONTH_COMMISSION_CENTS, PRO_FIRST_MONTH_MARKER, PRO_PRODUCT_TYPE, withReferralCommission,
} from "../../supabase/functions/_shared/affiliate-commission";
import { policyMetadata } from "../../supabase/functions/_shared/checkout-policy";
import { AFFILIATE_PRO_FIRST_MONTH_CENTS, COMMISSIONED_CHECKOUTS, REFERRAL_CHECKOUTS } from "@/config/affiliate-commission";
import { codeOf } from "./helpers/strip-comments";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel: vi.fn(), rpc: async () => ({ data: [], error: null }), functions: { invoke: async () => ({ data: { data: [] }, error: null }) } },
}));

import Affiliates from "../pages/Affiliates";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => codeOf(readFileSync(resolve(ROOT, p), "utf8"));

describe("the rule the server pays by", () => {
  it("a referred first paid Pro month earns the flat amount the Pro checkout names; nothing else does", () => {
    expect(PRO_FIRST_MONTH_COMMISSION_CENTS).toBe(1000);
    // What create-subscription-checkout writes on a referred session, as the payer reads it.
    const pro = { ...withReferralCommission(policyMetadata({ referralCode: "ab12cd34" }), PRO_FIRST_MONTH_MARKER), product_type: PRO_PRODUCT_TYPE };
    expect(pro).toMatchObject({ referral_code: "ab12cd34", referral_commission: "pro_first_month", referral_commission_cents: "1000" });
    expect(commissionCentsFor(pro)).toBe(PRO_FIRST_MONTH_COMMISSION_CENTS);
    // Every other checkout: "none", and no amount named.
    const other = { ...policyMetadata({ referralCode: "ab12cd34" }), product_type: "freelance_boost" };
    expect(other).not.toHaveProperty("referral_commission_cents");
    expect(commissionCentsFor(other)).toBe(0);
    // "none" wins over a named amount; a marker with no amount pays nothing.
    expect(commissionCentsFor({ referral_commission: "none", referral_commission_cents: "1000", product_type: PRO_PRODUCT_TYPE })).toBe(0);
    expect(commissionCentsFor({ referral_commission: PRO_FIRST_MONTH_MARKER, product_type: PRO_PRODUCT_TYPE })).toBe(0);
    // A "none" checkout names no amount, even over metadata that carried one.
    expect(withReferralCommission({ referral_code: "ab12cd34", referral_commission_cents: "1000" }, "none")).toEqual({ referral_code: "ab12cd34", referral_commission: "none" });
    // An unreferred session is left as it was: nothing to record or pay.
    expect(withReferralCommission({ terms_version: "x" }, PRO_FIRST_MONTH_MARKER)).toEqual({ terms_version: "x" });
  });

  it("a session from before the rule (no marker) is paid by the rule it was sold under", () => {
    expect(commissionCentsFor({ product_type: "premium_package" })).toBe(LEGACY_OTHER_CENTS);
    expect(commissionCentsFor({ product_type: "cover_letter" })).toBe(LEGACY_SMALL_TOOL_CENTS);
    expect(commissionCentsFor({ product_type: "full_analysis" })).toBe(0);
    expect(commissionCentsFor({ product_type: PRO_PRODUCT_TYPE }), "Pro never paid under the old rule").toBe(0);
    expect(commissionCentsFor(null)).toBe(0);
  });

  it("the page's figure is the server's", () => {
    expect(AFFILIATE_PRO_FIRST_MONTH_CENTS).toBe(PRO_FIRST_MONTH_COMMISSION_CENTS);
  });

  it("the checkout's metadata carries the rule's name: Pro's, or none", () => {
    expect(withReferralCommission(policyMetadata({ referralCode: "abc" }), PRO_FIRST_MONTH_MARKER)).toMatchObject({ referral_code: "abc", referral_commission: "pro_first_month" });
    expect(policyMetadata({ referralCode: "abc" })).toMatchObject({ referral_commission: "none" });
    expect(policyMetadata({})).not.toHaveProperty("referral_commission");
  });
});

describe("which checkouts carry the code and which pay on it", () => {
  const FN = resolve(ROOT, "supabase/functions");
  const minters = readdirSync(FN).filter((d) => /^create-.*checkout$/.test(d) && d !== "create-test-checkout");
  const src = (d: string) => { try { return code(`supabase/functions/${d}/index.ts`); } catch { return ""; } };

  it("every live checkout carries the referral code", () => {
    expect(minters.filter((d) => /\bpolicyMetadata\(/.test(src(d))).sort()).toEqual([...REFERRAL_CHECKOUTS].sort());
  });

  it("only the Pro checkout stamps the first-month rule", () => {
    const paying = minters.filter((d) => /\bwithReferralCommission\(\s*policyMetadata\([^)]*\),\s*PRO_FIRST_MONTH_MARKER\)/.test(src(d))).sort();
    expect(paying).toEqual([...COMMISSIONED_CHECKOUTS].sort());
    for (const d of minters) expect(src(d), d).not.toMatch(/commissioned:\s*true/);
  });

  it("the Pro checkout names the flat amount on its session (the stamp above writes it)", () => {
    expect(withReferralCommission({ referral_code: "abc", referral_commission: "none" }, PRO_FIRST_MONTH_MARKER).referral_commission_cents).toBe(String(PRO_FIRST_MONTH_COMMISSION_CENTS));
  });

  for (const file of ["supabase/functions/stripe-webhook/index.ts", "supabase/functions/verify-product-purchase/index.ts"]) {
    it(`${file} pays by commissionCentsFor, or by "none", a named amount, then the legacy rule's own list and amounts`, () => {
      const s = code(file);
      if (/\bcommissionCentsFor\(/.test(s)) return;
      if (/referral_commission_cents/.test(s)) {
        // "none" is read before the named amount, so a "none" session never pays.
        const none = s.search(/referral_commission === "none" \? 0/);
        const named = s.search(/namedCommission !== null \? namedCommission/);
        expect(none, "reads none").toBeGreaterThan(-1);
        expect(named, "pays a named amount").toBeGreaterThan(none);
      }
      const list = /const (?:lowCommission|lowCommissionProducts) = \[([^\]]*)\];/.exec(s);
      expect(list, "the server computes the commission neither way; re-check the rule").toBeTruthy();
      expect([...list![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...LEGACY_SMALL_TOOL_PRODUCT_TYPES].sort());
      const amounts = /\.includes\(productType \|\| ''\) \? (\d+) : (\d+);/.exec(s);
      expect([Number(amounts![1]), Number(amounts![2])]).toEqual([LEGACY_SMALL_TOOL_CENTS, LEGACY_OTHER_CENTS]);
    });
  }
});

describe("the affiliate page promises what the server pays", () => {
  it("quotes the flat first-month amount, names no cut product and no percentage", () => {
    render(<MemoryRouter><Affiliates /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(text).toContain("$10 for each referred first paid month of Pro");
    expect(text).toMatch(/Commissions you have already earned are paid as before/);
    // Freelance Boost and Transition Pro: cut on 2026-10-17 (owner decision).
    for (const cut of ["Premium Resume Package", "ATS Defense", "Career Snapshot", "Graduate Game Plan", "scan pack", "interview coach", "$5 per tool sale", "smaller tools", "Freelance Boost", "Transition Pro"]) {
      expect(text, cut).not.toContain(cut);
    }
    expect(text).not.toMatch(/20%/);
  });
});
