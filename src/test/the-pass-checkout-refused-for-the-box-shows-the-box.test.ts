/**
 * THE PASS CHECKOUT REFUSED FOR THE BOX SHOWS THE BOX (review of S11-142).
 *
 * A consent refusal (400 { consentRequired }) is the server saying its EU/UK
 * switch is on; consentWasRequired() reads it that way and reveals the box.
 * The $29 pass checkout (startPassCheckout) read only the refusal's sentence,
 * so a visitor whose page loaded before the owner flipped EU_UK_SALES was
 * told "Please tick the box above the button to continue." beside a button
 * with no box, until a full reload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));

import { startPassCheckout } from "@/pages/AgentConnect";
import { euUkBoxShown, resetPurchaseTermsForTests, serverBoxWording } from "@/lib/purchase-terms";

afterEach(() => { resetPurchaseTermsForTests(); invoke.mockReset(); });

const REFUSAL = {
  error: "Please tick the box above the button to continue.",
  consentRequired: "withdrawal_waiver_required",
  consentBox: "withdrawalWaiver",
  consentText: "I want my pass to start now, and I understand that I lose my 14-day right to withdraw once it has started.",
};
const http400 = (body: unknown) => ({
  status: 400,
  clone: () => ({ json: async () => body }),
  json: async () => body,
});

describe("startPassCheckout refused for the EU/UK box", () => {
  it("shows the box, keeps the server's wording, and still answers the refusal's sentence", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: http400(REFUSAL) } });
    expect(euUkBoxShown()).toBe(false);
    expect(await startPassCheckout()).toBe(REFUSAL.error);
    expect(euUkBoxShown(), "the refusal named the box and the page still did not show it").toBe(true);
    expect(serverBoxWording("withdrawalWaiver")).toBe(REFUSAL.consentText);
  });

  it("another refusal shows no box", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: http400({ error: "This account already has a live pass.", alreadyLive: true }) } });
    expect(await startPassCheckout()).toBe("This account already has a live pass.");
    expect(euUkBoxShown()).toBe(false);
  });
});
