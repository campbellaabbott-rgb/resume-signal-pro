/**
 * A REFUSED CHECKOUT SAYS WHY IN ITS OWN WORDS (S12-170).
 *
 * WHAT WAS WRONG. A retired product's 410 carries a sentence for the buyer
 * ("... is no longer sold, and nothing was charged ..."), but the generic
 * error parser drops any message over 200 characters and knows no 410, so
 * the page toasted "Something went wrong — try again": the retry the 410
 * exists to stop. The territory's 451 and the fair-use 429 had the same fate.
 *
 * WHAT HOLDS NOW, through the real hook with only the network faked: the
 * refusal's own sentence is the toast, under a title for its kind; a product
 * the catalogue hides is refused before any network call; and every checkout
 * body carries the browser's time zone.
 *
 * Since 2026-10-17 no product is sold through this hook (Freelance Boost and
 * Transition Pro were cut too), so Freelance Boost stands in, unhidden here,
 * for a product a page still offers; and the seller gate's 409 is shown in
 * its own words too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { FunctionsHttpError } from "@supabase/supabase-js";

const h = vi.hoisted(() => ({ invoke: vi.fn(), toasts: [] as Array<{ title?: string; description?: string }> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string; description?: string }) => { h.toasts.push(t); } }), toast: () => {} }));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackButtonClick: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", () => ({ useFunnelTracking: () => ({ trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/hooks/use-checkout-prefetch", () => ({ useCheckoutPrefetch: () => ({ prefetch: vi.fn(), prefetchProps: {} }) }));
vi.mock("@/lib/checkout-territory", () => ({ territoryHint: () => ({ timeZone: "America/Chicago" }), inSalesTerritory: () => false, buyerTimeZone: () => "America/Chicago" }));

vi.mock("@/config/products", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/products")>();
  return { ...real, isProductHidden: (id: string) => id !== "freelanceBoost" && real.isProductHidden(id as never) };
});

import { useProductCheckout } from "@/hooks/use-product-checkout";
import { cutSentence } from "../../supabase/functions/_shared/product-cuts";

const refusedWith = (status: number, body: Record<string, unknown>) => {
  const res = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return { data: null, error: new FunctionsHttpError(res) };
};

beforeEach(() => { h.invoke.mockReset(); h.toasts.length = 0; });
afterEach(cleanup);

describe("a checkout's refusal is shown in its own words", () => {
  it("a 410 for a product the page still offered: the sentence, whole, under 'No longer sold'", async () => {
    const sentence = cutSentence("coverLetter", "en");
    expect(sentence.length, "the sentence is longer than the generic parser keeps").toBeGreaterThan(150);
    h.invoke.mockResolvedValue(refusedWith(410, { retired: true, cut: true, reason: "product_retired", error: sentence }));
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("freelanceBoost"); });
    expect(h.toasts.at(-1)).toMatchObject({ title: "No longer sold", description: sentence });
    expect(h.toasts.some((t) => /something went wrong/i.test(String(t.title) + String(t.description)))).toBe(false);
  });

  it("the territory's 451", async () => {
    const { territorySentence } = await import("../../supabase/functions/_shared/sales-territory");
    const sentence = territorySentence("time_zone", "en");
    h.invoke.mockResolvedValue(refusedWith(451, { territoryRefused: true, reason: "tax_territory", signal: "time_zone", error: sentence }));
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("freelanceBoost"); });
    expect(h.toasts.at(-1)).toMatchObject({ title: "Not yet sold where you are", description: sentence });
  });

  it("the seller gate's 409: its sentence under 'Purchases open soon', never 'Something went wrong'", async () => {
    const { sellerGate } = await import("../../supabase/functions/_shared/seller-gate");
    const answer = sellerGate({ body: { language: "de" } }, { legalName: "", postalAddress: "" })!;
    h.invoke.mockResolvedValue(refusedWith(answer.status, answer.body));
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("freelanceBoost"); });
    expect(h.toasts.at(-1)).toMatchObject({ title: "Purchases open soon", description: answer.body.message });
    expect(answer.body.message).toMatch(/Käufe/);
    expect(h.toasts.some((t) => /something went wrong/i.test(String(t.title) + String(t.description)))).toBe(false);
  });

  it("the fair-use 429", async () => {
    h.invoke.mockResolvedValue(refusedWith(429, { fairUse: true, reason: "pro_grant_cap", error: "Pro includes up to 10 of these a day and 60 a month." }));
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("freelanceBoost"); });
    expect(h.toasts.at(-1)?.description).toBe("Pro includes up to 10 of these a day and 60 a month.");
  });

  it("a product the catalogue hides is refused before any network call", async () => {
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("atsDefense"); });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.toasts.at(-1)?.title).toBe("No longer sold");
  });

  it("every checkout body carries the browser's time zone", async () => {
    h.invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/x" }, error: null });
    const assign = vi.fn();
    const loc = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...loc, assign, pathname: "/pricing", search: "" } });
    try {
      const { result } = renderHook(() => useProductCheckout());
      await act(async () => { await result.current.purchaseProduct("freelanceBoost"); });
      expect(h.invoke.mock.calls[0][1].body.timeZone).toBe("America/Chicago");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: loc });
    }
  });
});
