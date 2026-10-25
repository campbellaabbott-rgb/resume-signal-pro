/**
 * THE SCANNER SELLS THE FULL ANALYSIS ONLY ONCE ITS DELIVERY WAS WATCHED
 * (homepage and pricing spec of 2026-10-17, gates G1 and G2; the ResumeUploader
 * gate the switch-over README gives hp/scanner).
 *
 * The uploader's two Full Analysis controls (the "Or get the complete
 * analysis" link under the free scan, and the priced button when no free scan
 * is offered) rendered as soon as the seller was named (G1). No real purchase
 * has yet been watched from payment to the delivered report, so the owner's
 * G2 switch, FULL_ANALYSIS_ON_SALE in src/config/sales-gate.ts, is closed, and
 * a named seller alone must not put the $5 button back. One condition now
 * holds both: the seller is named AND the switch is on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const seller = vi.hoisted(() => ({ legalName: "", postalAddress: "" }));
const gate = vi.hoisted(() => ({ fullAnalysisOnSale: false }));
vi.mock("@/config/seller", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/seller")>();
  return { ...real, SELLER: seller, sellerIdentity: (x = seller) => real.sellerIdentity(x) };
});
vi.mock("@/config/sales-gate", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    get FULL_ANALYSIS_ON_SALE() {
      return gate.fullAnalysisOnSale;
    },
  };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";
import { PRODUCTS } from "@/config/products";

afterEach(() => {
  cleanup();
  seller.legalName = "";
  seller.postalAddress = "";
  gate.fullAnalysisOnSale = false;
});
const nameSeller = () => {
  seller.legalName = "Example Seller LLC";
  seller.postalAddress = "1 Example Street, Springfield";
};

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts";
const PRICE = new RegExp(`\\$${PRODUCTS.fullAnalysis.priceUsd}\\b`);
const pricedButtons = () => screen.queryAllByRole("button").filter((b) => PRICE.test(b.textContent ?? "") && !b.closest('[data-scan-button="true"]'));
const soon = () => document.querySelector("[data-purchases-open-soon]");

function uploader(withFreeScan: boolean) {
  render(
    <MemoryRouter>
      <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={withFreeScan ? vi.fn() : undefined} isLoading={false} hasContent resumeText={RESUME} />
    </MemoryRouter>,
  );
}

describe("the uploader's Full Analysis controls need G1 and G2", () => {
  for (const withFreeScan of [true, false]) {
    const where = withFreeScan ? "under the free scan" : "with no free scan";
    it(`${where}: a named seller with G2 closed shows no priced control, and purchases open soon`, () => {
      nameSeller();
      uploader(withFreeScan);
      expect(pricedButtons()).toEqual([]);
      expect(soon()).not.toBeNull();
    });

    it(`${where}: G2 open with no seller named shows no priced control`, () => {
      gate.fullAnalysisOnSale = true;
      uploader(withFreeScan);
      expect(pricedButtons()).toEqual([]);
      expect(soon()).not.toBeNull();
    });

    it(`${where}: control, a named seller with G2 open shows the one priced control and its terms`, () => {
      nameSeller();
      gate.fullAnalysisOnSale = true;
      uploader(withFreeScan);
      expect(pricedButtons().length).toBe(1);
      expect(soon()).toBeNull();
    });
  }

  it("the free scan itself is untouched by either gate", () => {
    uploader(true);
    expect(document.querySelector('[data-scan-button="true"] button')).not.toBeNull();
  });

  it("the condition is read from the owner's switch, never typed in the component", () => {
    const code = readFileSync(resolve(__dirname, "../components/ResumeUploader.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The one gate every Full Analysis control reads (src/lib/purchases-open.ts).
    expect(code).toMatch(/import \{[^}]*\bfullAnalysisOnSale\b[^}]*\} from "@\/lib\/purchases-open"/);
    expect(code).not.toMatch(/\bpurchasesOpen\(/);
    // No Full Analysis control is gated on the seller alone any more.
    expect(code).not.toMatch(/purchasesOpen\(\) && \(/);
    expect(code).not.toMatch(/&& purchasesOpen\(\) &&/);
  });
});
