/**
 * THE STICKY BAR PRICED "PREMIUM PACKAGES" AT A HIDDEN $3 PRODUCT
 * (owner decision 1 of 2026-10-08; review of the wave 3 scan + AI branch).
 *
 * The homepage's sticky bar said "Premium packages from $3 — Full rewrites +
 * LinkedIn optimization + job-specific tailoring". $3 is the hidden keyword
 * fix, which the owner removed and /pricing (where the bar's button goes)
 * does not sell, and $3 buys none of what the line listed.
 *
 * The bar now names the Full Analysis at the price checkout charges, and
 * says what that product does.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })) },
}));

import { StickyBottomCTA } from "@/components/StickyBottomCTA";
import { PRODUCTS } from "@/config/products";

describe("the homepage's sticky bar", () => {
  it("prices only a product /pricing sells, and claims only what it delivers", () => {
    const { container } = render(<MemoryRouter><StickyBottomCTA /></MemoryRouter>);
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
      window.dispatchEvent(new Event("scroll"));
    });
    const text = container.textContent ?? "";
    expect(text, "the bar shows past the hero").not.toBe("");
    const prices = [...text.matchAll(/\$\s?(\d+)/g)].map((m) => Number(m[1]));
    expect(prices.length).toBeGreaterThan(0);
    expect(new Set(prices)).toEqual(new Set([PRODUCTS.fullAnalysis.priceUsd]));
    expect(prices, "the hidden keyword fix").not.toContain(PRODUCTS.basicKeywordFix.priceUsd);
    expect(text).not.toMatch(/premium packages|rewrites|linkedin/i);
    expect(text).toContain("Full Analysis");
  });
});
