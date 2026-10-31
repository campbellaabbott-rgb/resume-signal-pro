/**
 * THE BUY LINE SAYS ALL SALES ARE FINAL, AND NAMES NO PLACE IT DOES NOT SELL
 * (homepage and pricing spec of 2026-10-17: "Before you buy"; switch-over
 * README, step 8; the owner, 2026-10-27, on the EU, the EEA, the UK and
 * India: "Keep selling as today").
 *
 * PurchaseTerms is the block above every buy button. It names the Terms, the
 * renewal and the seller (once the owner gives the seller's name), and says,
 * above every payment and every plan and never above a sign-up, "All sales
 * are final.", the same sentence the pricing page uses.
 *
 * Wave 4's region line ("not sold in the EU, the EEA, the UK or India yet")
 * and its time-zone notice are gone with the territory refusal: a buyer there
 * checks out as on main, so no block names a place as unsold, wherever the
 * browser's time zone is.
 *
 * With the EU/UK switch on, a plan's block shows the service-start box ("if I
 * withdraw within 14 days, I pay for the days already used") and
 * withdraw-subscription refunds an EU or UK plan in full or pro rata, so the
 * plan's block no longer says "All sales are final.": the box states its
 * terms. A payment's block keeps the sentence, beside the box in which the
 * buyer gives up the withdrawal right once the report starts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
const state = vi.hoisted(() => ({ euUkOn: false }));
vi.mock("@/lib/purchase-terms", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, useEuUkBoxShown: () => state.euUkOn, askServerForEuUkSwitch: () => {} };
});

import { PurchaseTerms } from "@/components/PurchaseTerms";

afterEach(() => { cleanup(); state.euUkOn = false; vi.restoreAllMocks(); });

const ROOT = resolve(__dirname, "../..");
const LOCALES = resolve(ROOT, "src/i18n/locales");
const three = () => render(
  <MemoryRouter>
    <PurchaseTerms kind="payment" />
    <PurchaseTerms kind="subscription" plan="pro" />
    <PurchaseTerms kind="signup" />
  </MemoryRouter>,
);
const blocks = () => [...document.querySelectorAll<HTMLElement>("[data-testid='purchase-terms']")];

describe("above every payment and plan, never above a sign-up", () => {
  it("says all sales are final", () => {
    three();
    const [pay, plan, signup] = blocks();
    expect(pay.querySelector("[data-final-sale]")?.textContent).toBe("All sales are final.");
    expect(plan.querySelector("[data-final-sale]")?.textContent).toBe("All sales are final.");
    expect(signup.querySelector("[data-final-sale]")).toBeNull();
  });

  it("names no place as unsold to any buyer, wherever the browser's time zone is", () => {
    const realOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    for (const zone of ["Europe/Berlin", "Europe/London", "Asia/Kolkata", "America/Chicago"]) {
      vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...realOptions.call(this), timeZone: zone };
      });
      three();
      for (const b of blocks()) {
        expect(b.querySelector("[data-region-line]"), zone).toBeNull();
        expect(b.querySelector("[data-region-notice]"), zone).toBeNull();
        expect(b.textContent ?? "", zone).not.toMatch(/Not sold in|EU, the EEA, the UK or India|tax registration/);
      }
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("says nothing about a territory with EU and UK sales on, either", () => {
    state.euUkOn = true;
    three();
    for (const b of blocks()) expect(b.querySelector("[data-region-line]")).toBeNull();
  });

  it("with EU and UK sales on, a plan carries no unqualified final-sale line, and its box states the withdrawal terms", () => {
    state.euUkOn = true;
    render(
      <MemoryRouter>
        <PurchaseTerms kind="subscription" plan="pro" />
        <PurchaseTerms kind="subscription" plan="agent" />
      </MemoryRouter>,
    );
    for (const b of blocks()) {
      expect(b.querySelector("[data-final-sale]")).toBeNull();
      expect(b.textContent).not.toMatch(/All sales are final/);
      expect(b.textContent).toMatch(/withdraw/i);
    }
  });

  it("with EU and UK sales on, a payment keeps the final-sale line beside the box that waives the withdrawal right", () => {
    state.euUkOn = true;
    render(<MemoryRouter><PurchaseTerms kind="payment" /></MemoryRouter>);
    const [pay] = blocks();
    expect(pay.querySelector("[data-final-sale]")?.textContent).toBe("All sales are final.");
    expect(pay.querySelector("input[type='checkbox']")).not.toBeNull();
  });
});

describe("in every language", () => {
  const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
  const pt = (f: string) => (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).purchaseTerms ?? {}) as Record<string, string>;

  it("the final-sale sentence exists in all nine locales, and the region line in none", () => {
    expect(files.length).toBe(9);
    for (const f of files) {
      expect(pt(f).finalSale, `${f} purchaseTerms.finalSale`).toBeTruthy();
      expect(pt(f).regionLine, `${f} purchaseTerms.regionLine`).toBeUndefined();
    }
  });

  it("the final-sale sentence is the one the pricing page uses, where its strings are on this tree", () => {
    const dir = resolve(ROOT, "src/i18n/shards/pricing");
    let shards: string[] = [];
    try { shards = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { /* the pricing page ships with hp/integration */ }
    for (const f of shards) {
      const sale = JSON.parse(readFileSync(resolve(dir, f), "utf8")).pricingPlans?.buy?.finalSale;
      expect(pt(f).finalSale, f).toBe(sale);
    }
  });
});
