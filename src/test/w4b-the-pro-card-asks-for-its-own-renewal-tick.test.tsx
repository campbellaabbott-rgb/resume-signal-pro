/**
 * THE PRO CARD ASKS FOR ITS OWN RENEWAL TICK (owner decision 2026-10-17;
 * California's automatic renewal law as amended by AB 2863).
 *
 * The Pro card's Terms line carries a separate box agreeing to the automatic
 * renewal: unticked when it renders, required, and apart from the Terms
 * sentence. Mounted for real (purchases open, as once a seller is named):
 *   - the box is there only for Pro, never beside a one-time payment, the
 *     agent's trial line or a sign-up;
 *   - a signed-in buyer's "Go Pro" stays disabled until it is ticked;
 *   - the press sends autoRenewConsent: true only when the pressed line's box
 *     was ticked, spends it (the box clears), and a checkout that started
 *     nothing gives it back;
 *   - a press beside an unticked box sends no autoRenewConsent at all, so the
 *     server's 400 is what the buyer would meet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "m@example.com" }, session: { access_token: "jwt" } }) }));
vi.mock("@/lib/checkout-territory", () => ({ inSalesTerritory: () => false, territoryHint: () => ({}), buyerTimeZone: () => "" }));
vi.mock("@/lib/purchases-open", () => ({ purchasesOpen: () => true }));
const sent = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }));
vi.mock("@/hooks/use-pro-subscription", async () => {
  const terms = await import("@/lib/purchase-terms");
  return {
    useProSubscription: () => ({
      pro: { active: false, status: null, currentPeriodEnd: null, loading: false, trialing: false, linkPending: false, cancelAtPeriodEnd: false, planTier: null },
      // What the real hook does with the press: read the Terms fields before any await.
      subscribe: async () => { sent.bodies.push({ ...terms.purchaseTerms() }); },
      manage: vi.fn(), actionLoading: false, knownEmail: "m@example.com", refresh: vi.fn(), justSubscribed: false, notConfirmedYet: false,
    }),
  };
});

import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import { purchaseTerms, purchaseTermsUnused, resetPurchaseTermsForTests } from "@/lib/purchase-terms";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeEach(() => { sent.bodies.length = 0; resetPurchaseTermsForTests(); });
afterEach(cleanup);

const box = () => document.querySelector<HTMLInputElement>("[data-auto-renew-box] input[type=checkbox]");
const goPro = () => screen.getByRole("button", { name: /Go Pro/ });

describe("the box", () => {
  it("is on Pro's Terms line, unticked and required, with the price and the way to cancel", () => {
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    const input = box();
    expect(input).not.toBeNull();
    expect(input!.checked).toBe(false);
    expect(input!.required).toBe(true);
    const label = document.querySelector("[data-auto-renew-box]")!.textContent ?? "";
    expect(label).toMatch(/renews automatically every month at \$45 until I cancel/);
    expect(label).toMatch(/cancel any time from my account/);
    // Separate from the Terms sentence: its own element, not the agree line.
    expect(label).not.toMatch(/Terms of Service/);
  });

  it("is never beside a one-time payment, the agent's line or a sign-up", () => {
    render(<MemoryRouter><PurchaseTerms kind="payment" /><PurchaseTerms kind="subscription" plan="agent" /><PurchaseTerms kind="signup" /></MemoryRouter>);
    expect(document.querySelectorAll("[data-auto-renew-box]")).toHaveLength(0);
  });
});

describe("the press", () => {
  it("Go Pro stays disabled until the box is ticked", () => {
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    expect(goPro()).toBeDisabled();
    fireEvent.click(box()!);
    expect(box()!.checked).toBe(true);
    expect(goPro()).not.toBeDisabled();
  });

  it("sends autoRenewConsent only with the box ticked, spends it, and a checkout that started nothing gives it back", async () => {
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    fireEvent.click(box()!);
    await act(async () => { fireEvent.click(goPro()); });
    expect(sent.bodies).toHaveLength(1);
    expect(sent.bodies[0].autoRenewConsent).toBe(true);
    expect(box()!.checked, "the tick is spent by the press").toBe(false);
    await act(async () => { purchaseTermsUnused(); });
    expect(box()!.checked, "a checkout that started nothing gives the tick back").toBe(true);
  });

  it("a press beside an unticked box sends no autoRenewConsent", async () => {
    render(<MemoryRouter><PurchaseTerms kind="subscription" plan="pro" /><button type="button" onClick={() => sent.bodies.push({ ...purchaseTerms() })}>buy</button></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "buy" }));
    expect(sent.bodies[0]).not.toHaveProperty("autoRenewConsent");
  });
});
