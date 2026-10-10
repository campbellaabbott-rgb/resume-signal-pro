/**
 * A RETRY AND A DAY-OLD TAB BOUND A PURCHASE TO THE WRONG RÉSUMÉ.
 *
 * WHAT WAS WRONG (sweep 2026-10-08).
 *   S8-056  "Try again" on /payment-failed called purchaseProduct with no
 *           inputs, so the retry bound the homepage scan the tab held: an
 *           Account apply kit for job X, cancelled and retried, was bought for
 *           job Y's posting, or for nothing.
 *   S8-057  The tab's stored-copy id carried no age. A purchase made more than
 *           24 hours after the scan bound a copy the retention job had already
 *           deleted, and the webhook had no résumé to deliver from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import en from "../i18n/locales/en.json";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: async () => ({ data: null, error: null }) }, rpc: async () => ({ data: null, error: null }) },
}));
const purchaseProduct = vi.fn(async () => null);
vi.mock("@/hooks/use-product-checkout", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-product-checkout")>()),
  useProductCheckout: () => ({ purchaseProduct, isLoading: false, currentProduct: null }),
}));

import { CHECKOUT_RETRY_KEY, STORED_COPY_MAX_AGE_MS, preStoredResumeFor, rememberPreStoredResume } from "@/hooks/use-product-checkout";
import PaymentFailed from "../pages/PaymentFailed";

const ID = "8a6f7d3e-1b2c-4d5e-9f00-112233445566";
const INPUTS = { resumeText: "A résumé long enough to be stored for a purchase. ".repeat(3), jobDescription: "Job X" };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}
const mount = (path: string) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<><PaymentFailed /><Where /></>} /></Routes></MemoryRouter>,
);

beforeEach(() => { sessionStorage.clear(); purchaseProduct.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("a stored copy the store has deleted is never bound (S8-057)", () => {
  it("is matched within the store's day and not after it", () => {
    vi.useFakeTimers({ now: new Date("2026-10-09T08:00:00Z") });
    rememberPreStoredResume(ID, INPUTS);
    expect(preStoredResumeFor(INPUTS)).toBe(ID);
    vi.setSystemTime(Date.now() + STORED_COPY_MAX_AGE_MS + 1000);
    expect(preStoredResumeFor(INPUTS), "a copy older than the store keeps it was bound").toBeUndefined();
  });
});

describe("Try again after backing out of Stripe (S8-056)", () => {
  it("retries with the stored copy and the job the cancelled checkout was bound to", async () => {
    sessionStorage.setItem(CHECKOUT_RETRY_KEY, JSON.stringify({ productId: "applyAssistant", sessionId: ID, jobTitle: "Analyst", jobCompany: "X Corp", path: "/account", at: Date.now() }));
    mount("/payment-failed?product=applyAssistant");
    fireEvent.click(screen.getByRole("button", { name: en.paymentFailed.tryAgain }));
    await waitFor(() => expect(purchaseProduct).toHaveBeenCalled());
    expect(purchaseProduct.mock.calls[0]).toEqual(["applyAssistant", expect.objectContaining({ sessionId: ID, jobTitle: "Analyst", jobCompany: "X Corp" })]);
  });

  it("with no record of what it was bound to, goes back to buy rather than binding the tab's scan", async () => {
    mount("/payment-failed?product=coverLetter");
    fireEvent.click(screen.getByRole("button", { name: en.paymentFailed.tryAgain }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/pricing"));
    expect(purchaseProduct).not.toHaveBeenCalled();
  });
});
