// @vitest-environment node
/**
 * PRO IS THE WRITING TOOLS, THE FULL ANALYSIS AND NO DAILY CAP ON SCANS, IN
 * ONE LIST THE PAGES AND THE SERVER BOTH READ (owner decision 2026-10-17).
 *
 * WHAT WAS WRONG. The Pro card promised "Unlimited scans", batch prep and
 * "Freelance Boost and Transition Pro included"; Stripe's page carried its
 * own sentence typed in the checkout, so the card and the receipt could
 * disagree, and Freelance Boost is not part of Pro (it is no longer sold).
 *
 * WHAT HOLDS NOW:
 *   - PRO_PERK_ITEMS says exactly the decision: everything in a free account
 *     plus the writing tools (5 sets a day, 60 a month), the $5 Full Analysis
 *     included, no daily cap on scans, cancel anytime; never "unlimited",
 *     never Freelance Boost or Transition Pro;
 *   - the one-off products Pro includes are the Full Analysis alone;
 *   - create-subscription-checkout, run, sends Stripe the description built
 *     from those very items;
 *   - every page that lists or summarises Pro reads the list (or its
 *     one-sentence summary) instead of typing its own words.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import type { EdgeHandler } from "./helpers/edge-harness";
import { PRO_INCLUDED_PRODUCT_IDS, PRO_PERK_ITEMS, PRO_PERKS, PRO_SUMMARY, proIncludes, proStripeDescription } from "@/config/pro-perks";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => codeOf(readFileSync(resolve(ROOT, f), "utf8"));
const BUYER = { id: "00000000-0000-4000-8000-00000000b501", email: "buyer@example.com" };
let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-subscription-checkout"]);
}, 240_000);

describe("the list says exactly what Pro is", () => {
  it("the writing tools with their numbers, the Full Analysis included, no daily cap on scans, cancel anytime", () => {
    expect(PRO_PERKS).toEqual([
      "Everything in a free account, plus the writing tools",
      "A tailored résumé, cover letter and interview prep for your jobs: up to 5 sets a day and 60 a month",
      "The $5 Full Analysis included",
      "No daily cap on scans",
      "Cancel anytime from your account",
    ]);
    expect(PRO_SUMMARY.text).toBe("Everything in a free account, plus the writing tools, the $5 Full Analysis included and no daily cap on scans");
  });

  it("never says unlimited, and names no product Pro does not include", () => {
    for (const line of [...PRO_PERKS, PRO_SUMMARY.text, proStripeDescription()]) {
      expect(line).not.toMatch(/unlimited/i);
      expect(line).not.toMatch(/freelance|transition pro|batch/i);
    }
  });

  it("each line has its own key, and a line whose words changed has a new one", () => {
    const keys = PRO_PERK_ITEMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    // The old keys carried the old words; a locale value is never edited.
    expect(keys).not.toContain("proPlan.perks.unlimitedScans");
    expect(keys).not.toContain("proPlan.perks.includedOneOffs");
    expect(keys).not.toContain("proPlan.perks.batchPrep");
  });

  it("Pro includes the Full Analysis, and nothing else a checkout sells", () => {
    expect([...PRO_INCLUDED_PRODUCT_IDS]).toEqual(["fullAnalysis"]);
    expect(proIncludes("fullAnalysis")).toBe(true);
    for (const id of ["freelanceBoost", "freelanceTransitionPro", "coverLetter", "applyAssistant"]) expect(proIncludes(id), id).toBe(false);
  });
});

describe("the server reads the same list", () => {
  it("create-subscription-checkout sends Stripe the description built from the items, run", async () => {
    world = freshWorld({ "jwt-buyer": BUYER });
    const res = await post(h["create-subscription-checkout"], "create-subscription-checkout", { language: "en", autoRenewConsent: true }, { bearer: "jwt-buyer" });
    expect(res.status).toBe(200);
    const items = world.stripe.created[0].line_items as Array<{ price_data: { product_data: { description: string } } }>;
    const description = items[0].price_data.product_data.description;
    expect(description).toBe(proStripeDescription(PRO_PERK_ITEMS));
    for (const p of PRO_PERKS) expect(description).toContain(p);
  });

  it("create-product-checkout mints a member's grant only for what Pro includes", () => {
    const src = code("supabase/functions/create-product-checkout/index.ts");
    expect(src).toMatch(/standing\.consumables && proIncludes\(productId\)/);
    expect(src).toMatch(/from "\.\.\/_shared\/pro-perks\.ts"/);
  });
});

describe("every page that lists Pro reads the list", () => {
  const PAGES: Array<[string, RegExp]> = [
    ["src/components/ProSubscriptionCard.tsx", /PRO_PERK_ITEMS\.map/],
    ["src/components/FAQ.tsx", /PRO_SUMMARY\.key, PRO_SUMMARY\.text/],
    ["src/components/RateLimitUpsell.tsx", /PRO_SUMMARY\.key, PRO_SUMMARY\.text/],
  ];
  it.each(PAGES)("%s reads it", (file, reads) => {
    const src = code(file);
    expect(src).toMatch(/from "@\/config\/pro-perks"/);
    expect(src).toMatch(reads);
  });

  it("no page that sells Pro types its own perk words", () => {
    for (const file of [...PAGES.map(([f]) => f), "src/pages/Pricing.tsx"]) {
      const src = code(file);
      expect(src, file).not.toMatch(/unlimited scans|scans without a daily limit|Freelance Boost and Transition Pro included|every paid tool/i);
    }
  });
});
