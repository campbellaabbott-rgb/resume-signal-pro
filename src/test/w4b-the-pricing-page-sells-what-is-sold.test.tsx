/**
 * THE PRICING PAGE SELLS WHAT IS SOLD, NAMES EACH PRODUCT WHOLE, AND MAKES NO
 * PROMISE NOBODY KEEPS (S12-045, S12-008, the product line's cut).
 *
 * WHAT WAS WRONG.
 *   S12-045  Buttons were "Get " + the product's first word ("Get ATS",
 *            "Get Cover", "Get Premium"), and the FAQ ended in a fragment
 *            ("... free scan to see your score first.").
 *   S12-008  The $7 Apply Assistant carried a "Human-Reviewed" badge (nobody
 *            reviews it) and ATS Defense a "30-day re-optimize guarantee"
 *            with no terms and no mechanism, beside Terms that say every
 *            sale is final.
 *   cut      The Premium Package led the ladder as "Best Value", and the
 *            collapsed catalogue sold every product the line cut.
 *
 * Mounted for real, plus a guard over the catalogue and the product cards
 * (the claim literals live only in this file).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false, planTier: null, cancelAtPeriodEnd: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

import Pricing from "../pages/Pricing";
import { HIDDEN_PRODUCT_IDS, PRODUCTS } from "@/config/products";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(cleanup);

const mount = () => render(<MemoryRouter initialEntries={["/pricing"]}><Pricing /></MemoryRouter>);
const ROOT = resolve(__dirname, "../..");

describe("/pricing offers only what is still sold", () => {
  it("no cut or retired product appears anywhere on the page", () => {
    mount();
    const text = document.body.textContent ?? "";
    for (const id of HIDDEN_PRODUCT_IDS) expect(text, `${id} is offered`).not.toContain(PRODUCTS[id].name);
    expect(text).not.toMatch(/Best Value|Premium Packages|See every tool/);
  });

  it("the ladder is the free scan, the $5 Full Analysis and Freelance Boost", () => {
    mount();
    expect(document.querySelector("[data-ladder='fullAnalysis']")?.textContent).toContain(`$${PRODUCTS.fullAnalysis.priceUsd}`);
    expect(screen.getByText(PRODUCTS.freelanceBoost.name)).toBeInTheDocument();
  });
});

describe("each product is named whole (S12-045)", () => {
  it("the buttons say the product's full name, never its first word alone", () => {
    mount();
    expect(screen.getByRole("link", { name: /Get Full Resume Analysis/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Get Freelance Boost/ })).toBeInTheDocument();
    for (const stub of [/^Get Full$/, /^Get Freelance$/, /^Get ATS$/, /^Get Cover$/]) {
      expect(screen.queryAllByRole("button").concat(screen.queryAllByRole("link")).some((b) => stub.test((b.textContent ?? "").trim())), String(stub)).toBe(false);
    }
  });

  it("the FAQ's free-scan line is a sentence, not a fragment", () => {
    mount();
    const para = [...document.querySelectorAll("p")].find((p) => /free scan/.test(p.textContent ?? "") && /score first/.test(p.textContent ?? ""));
    expect(para?.textContent).toMatch(/Not sure yet\? Run the free scan to see your score first\./);
    expect(para?.textContent).not.toMatch(/Every tool is a one-time purchase/);
  });
});

describe("no promise nobody keeps (S12-008)", () => {
  const CLAIMS = [/human-reviewed/i, /re-optimi[sz]e guarantee/i, /\d+-day guarantee/i];

  it("the catalogue carries no reviewed-by-a-person badge and no undefined guarantee", () => {
    const src = codeOf(readFileSync(resolve(ROOT, "src/config/products.ts"), "utf8"));
    for (const c of CLAIMS) expect(src, String(c)).not.toMatch(c);
    for (const p of Object.values(PRODUCTS)) {
      const said = [p.name, p.description, ...p.features, "badge" in p ? String(p.badge) : ""].join(" ");
      for (const c of CLAIMS) expect(said, `${p.name}: ${c}`).not.toMatch(c);
    }
  });

  it("no product card or sale surface says them either", () => {
    const files = ["src/pages/Pricing.tsx", "src/components/ProSubscriptionCard.tsx", "src/components/MiniPricingCards.tsx",
      "src/components/AddOnsShowcase.tsx", "src/components/FinalCTA.tsx", "src/components/RateLimitUpsell.tsx",
      "src/config/pro-perks.ts", "supabase/functions/create-subscription-checkout/index.ts", "supabase/functions/_shared/product-cuts.ts"];
    for (const f of files) {
      const src = codeOf(readFileSync(resolve(ROOT, f), "utf8"));
      for (const c of CLAIMS) expect(src, `${f}: ${c}`).not.toMatch(c);
    }
  });

  it("the rendered page says none of them (the guard reads a page that runs)", () => {
    mount();
    expect(document.body.textContent?.length ?? 0).toBeGreaterThan(500);
    for (const c of CLAIMS) expect(document.body.textContent ?? "", String(c)).not.toMatch(c);
  });
});
