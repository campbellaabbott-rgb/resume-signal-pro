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
 *   10-17    Freelance Boost and Transition Pro are cut too (owner decision
 *            2026-10-17), and the Full Analysis and Pro show a buy button
 *            only once a seller is named; until then the page says purchases
 *            open soon (B&P 17538(d)).
 *
 * Since the homepage switch-over (docs/homepage-pricing/README.md, step 4)
 * /pricing is src/pages/pricing/PricingPage.tsx. The old page's ladder, its
 * "Get <product>" links and its FAQ line went with src/pages/Pricing.tsx;
 * hp-pricing-decisions tests 1, 3 and 12 hold the new page's cards, gates and
 * structured data. Kept here: no cut or retired product, no buy button while
 * no seller is named (both paid cards say purchases open soon; with a TEST
 * seller and both switches the buttons return), each product named whole on
 * its button, and no promise nobody keeps.
 *
 * Mounted for real, plus a guard over the catalogue and the product cards
 * (the claim literals live only in this file).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readdirSync, readFileSync } from "node:fs";
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
  PRO_CONFIRM_INTERVAL_MS: 3000,
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false, planTier: null, cancelAtPeriodEnd: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn(), justSubscribed: false, notConfirmedYet: false }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

import PricingPage from "../pages/pricing/PricingPage";
import type { SaleGateInput } from "@/components/pricing/sale-gates";
import { HIDDEN_PRODUCT_IDS, PRODUCTS } from "@/config/products";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => cleanup());

/** An obviously fake identity, used only inside tests (owner decision: never invented in src). */
const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const OPEN: SaleGateInput = { seller: TEST_SELLER, fullAnalysisDelivered: true, proWatched: true };

const mount = (gateInput?: SaleGateInput) =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/pricing"]}>
        <PricingPage gateInput={gateInput} />
      </MemoryRouter>
    </HelmetProvider>,
  );
const ROOT = resolve(__dirname, "../..");
const buyControls = () => [...document.querySelectorAll<HTMLElement>("[data-buy]")];

describe("/pricing offers only what is still sold", () => {
  it("no cut or retired product appears anywhere on the page, closed or open", () => {
    for (const input of [undefined, OPEN]) {
      mount(input);
      const text = document.body.textContent ?? "";
      for (const id of HIDDEN_PRODUCT_IDS) expect(text, `${id} is offered`).not.toContain(PRODUCTS[id].name);
      expect(text).not.toMatch(/Best Value|Premium Packages|See every tool|Transition Pro/);
      expect(document.querySelector("a[href='/freelance-boost']")).toBeNull();
      cleanup();
    }
  });

  it("the Full Analysis card prices the $5 report", () => {
    mount(OPEN);
    expect(document.querySelector("[data-plan='full-analysis']")?.textContent).toContain(`$${PRODUCTS.fullAnalysis.priceUsd}`);
  });
});

describe("no buy button while no seller is named (owner decision 2026-10-17)", () => {
  it("the Full Analysis card and the Pro card say purchases open soon, and offer no button to buy", () => {
    mount();
    for (const plan of ["full-analysis", "pro"]) {
      const card = document.querySelector(`[data-plan='${plan}']`)!;
      expect(card.querySelector("[data-gate='seller']")?.textContent, plan).toMatch(/Purchases open soon/);
    }
    expect(buyControls()).toEqual([]);
    expect(document.querySelector("[data-testid='purchase-terms']"), "no Terms line above a button that is not there").toBeNull();
  });

  it("control: once a seller is named and both switches are open, both buttons are back", () => {
    mount(OPEN);
    expect(buyControls().map((b) => b.getAttribute("data-buy")).sort()).toEqual(["full-analysis", "pro"]);
    expect(document.querySelector("[data-gate]")).toBeNull();
  });
});

describe("each product is named whole (S12-045)", () => {
  it("the buttons say the product's full name, never its first word alone", () => {
    mount(OPEN);
    const labels = buyControls().map((b) => (b.textContent ?? "").trim());
    expect(labels.some((l) => /Full Analysis/.test(l)), labels.join(" | ")).toBe(true);
    expect(labels.some((l) => /^Go Pro\b/.test(l)), labels.join(" | ")).toBe(true);
    for (const stub of [/^Get Full$/, /^Get Freelance$/, /^Get ATS$/, /^Get Cover$/, /^Buy the Full$/]) {
      expect(labels.some((l) => stub.test(l)), String(stub)).toBe(false);
    }
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
    const pricing = ["src/pages/pricing/PricingPage.tsx", ...readdirSync(resolve(ROOT, "src/components/pricing")).filter((f) => /\.tsx?$/.test(f)).map((f) => `src/components/pricing/${f}`)];
    const files = [...pricing, "src/i18n/shards/pricing/en.json", "src/components/ProSubscriptionCard.tsx", "src/components/MiniPricingCards.tsx",
      "src/components/AddOnsShowcase.tsx", "src/components/FinalCTA.tsx", "src/components/RateLimitUpsell.tsx",
      "src/config/pro-perks.ts", "supabase/functions/create-subscription-checkout/index.ts", "supabase/functions/_shared/product-cuts.ts"];
    for (const f of files) {
      const src = codeOf(readFileSync(resolve(ROOT, f), "utf8"));
      for (const c of CLAIMS) expect(src, `${f}: ${c}`).not.toMatch(c);
    }
  });

  it("the rendered page says none of them (the guard reads a page that runs)", () => {
    for (const input of [undefined, OPEN]) {
      mount(input);
      expect(document.body.textContent?.length ?? 0).toBeGreaterThan(500);
      for (const c of CLAIMS) expect(document.body.textContent ?? "", String(c)).not.toMatch(c);
      cleanup();
    }
  });
});
