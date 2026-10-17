/**
 * EVERY OFFER LEFT ON A PAGE IS ONE STILL SOLD, AND THE FREE REPORT'S SIGN-UP
 * LINK LANDS WHERE THE REPORT IS KEPT (the product line's cut, 2026-10-12;
 * S12-025's homepage half).
 *
 * WHAT WAS WRONG.
 *   cut      Four components still listed products by a hand-typed id list:
 *            the product picker (ProductSelectionModal, mounted on the
 *            homepage and in the header), the scan-pack dialog (mounted in
 *            the header), the homepage's featured cards and the $5 add-ons.
 *            Each would have offered a product whose checkout now answers 410.
 *   S12-025  "Don't lose this score" sent a visitor to /auth with nowhere to
 *            come back to; the homepage keeps no copy of the report, so they
 *            came back to nothing. The account page is where the scans run
 *            before signing up are imported, with their checklists.
 *   S12-059  A buyer in the EU, the EEA or the UK learned that sales there
 *            wait for the VAT registration only after pressing a buy button.
 *            The Terms line above every buy button now says it first.
 *
 * Mounted for real, with only the network faked.
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
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
let territory = false;
vi.mock("@/lib/checkout-territory", () => ({ inSalesTerritory: () => territory, territoryHint: () => ({}), buyerTimeZone: () => "" }));
// The Terms line asks create-checkout for the EU/UK switch once: never the network here.
vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in this test"); }));

import { ProductSelectionModal } from "@/components/ProductSelectionModal";
import { ScanPackPurchase } from "@/components/ScanPackPurchase";
import { MiniPricingCards } from "@/components/MiniPricingCards";
import { AddOnsShowcase } from "@/components/AddOnsShowcase";
import { FREE_REPORT_SIGNUP_NEXT, FreeReportSignupNudge } from "@/components/FreeReportSignupNudge";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import { HIDDEN_PRODUCT_IDS, PRODUCTS } from "@/config/products";
import { safeNextPath } from "@/lib/auth-fragment";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => { cleanup(); territory = false; });

const ROOT = resolve(__dirname, "../..");
const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("the components that list products by hand offer only what is still sold", () => {
  it("the product picker lists the Full Analysis and no cut product", () => {
    inRouter(<ProductSelectionModal open onOpenChange={() => {}} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain(PRODUCTS.fullAnalysis.name);
    for (const id of HIDDEN_PRODUCT_IDS) expect(text, `${id} is offered`).not.toContain(PRODUCTS[id].name);
  });

  it("the scan-pack dialog says packs are no longer sold and offers no purchase", () => {
    inRouter(<ScanPackPurchase open onOpenChange={() => {}} />);
    expect(document.querySelector("[data-scan-packs-retired]")).not.toBeNull();
    expect(screen.getByText("Scan packs are no longer sold")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buy/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("the featured cards and the $5 add-ons, all cut, render nothing", () => {
    const { container } = inRouter(<><MiniPricingCards /><AddOnsShowcase variant="full" /><AddOnsShowcase variant="compact" /></>);
    expect(container.textContent).toBe("");
  });
});

describe("the free report's sign-up link lands on the account page (S12-025)", () => {
  it("the link names /account as next, and the sign-in page honours it", () => {
    inRouter(<FreeReportSignupNudge />);
    const link = screen.getByRole("link", { name: "Create free account" });
    const href = link.getAttribute("href") ?? "";
    const next = new URL(href, "https://resumebooster.work").searchParams.get("next");
    expect(new URL(href, "https://resumebooster.work").pathname).toBe("/auth");
    expect(next).toBe(FREE_REPORT_SIGNUP_NEXT);
    expect(safeNextPath(next)).toBe("/account");
  });

  it("the homepage renders it for a signed-out visitor, and links to /auth nowhere else without a next", () => {
    const index = codeOf(readFileSync(resolve(ROOT, "src/pages/Index.tsx"), "utf8"));
    expect(index).toMatch(/\{!session && <FreeReportSignupNudge \/>\}/);
    expect(index).not.toMatch(/to=\{?["'`]\/auth["'`]\}?/);
  });
});

describe("the Terms line above a buy button says when sales here wait for VAT (S12-059)", () => {
  it("a browser in the territory reads it above a payment and a plan, never above a sign-up", () => {
    territory = true;
    inRouter(<><PurchaseTerms kind="payment" /><PurchaseTerms kind="subscription" plan="pro" /><PurchaseTerms kind="signup" /></>);
    const notices = document.querySelectorAll("[data-region-notice]");
    expect(notices).toHaveLength(2);
    expect(notices[0].textContent).toMatch(/Not yet sold in the EU, the EEA or the UK: sales there wait until we are registered for VAT/);
    const terms = [...document.querySelectorAll("[data-testid='purchase-terms']")];
    expect(terms[2].querySelector("[data-region-notice]")).toBeNull();
  });

  it("control: a browser outside it reads no notice", () => {
    inRouter(<><PurchaseTerms kind="payment" /><PurchaseTerms kind="subscription" plan="pro" /></>);
    expect(document.querySelectorAll("[data-region-notice]")).toHaveLength(0);
  });
});
