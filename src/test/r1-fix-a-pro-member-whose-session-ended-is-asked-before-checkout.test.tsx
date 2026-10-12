/**
 * R1 FIX (S12-087): A PRO MEMBER WHOSE SESSION ENDED IS ASKED BEFORE STRIPE
 * CHARGES THEM.
 *
 * R1 stopped sending a stored address with a signed-out checkout (it could be
 * the previous person's). That also silenced the server's signed-out Pro
 * branch, so a member whose session had expired was sent straight to Stripe
 * for a tool their plan includes. The page now asks once per tab, when this
 * browser held a session that ended without a deliberate sign-out, and still
 * sends no address; the next press buys as a guest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), session: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: () => ({ insert: async () => ({ error: null }) }),
    auth: { getSession: async () => ({ data: { session: h.session } }) },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast, dismiss() {}, toasts: [] }), toast: h.toast }));

import { useProductCheckout } from "@/hooks/use-product-checkout";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.session = null;
  h.invoke.mockReset().mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_x" }, error: null });
  h.toast.mockReset();
  vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const checkoutCalls = () => h.invoke.mock.calls.filter((c) => c[0] === "create-product-checkout");

describe("a buy press after a session ended here", () => {
  it("asks to sign in first and starts nothing, sending no address; the next press buys as a guest", async () => {
    localStorage.setItem("rb_last_email", "member@example.com");
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls(), "a signed-out Pro member was sent to Stripe without a word").toHaveLength(0);
    expect(JSON.stringify(h.toast.mock.calls[0]?.[0])).toMatch(/Have Pro\? Sign in first/);
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls()).toHaveLength(1);
    expect((checkoutCalls()[0][1] as { body: { email?: string } }).body.email, "a stored address went with a signed-out checkout").toBeUndefined();
  });

  it("does not ask a browser with no ended session (a deliberate sign-out leaves no address)", async () => {
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls()).toHaveLength(1);
  });

  it("does not ask a signed-in member: their account decides", async () => {
    localStorage.setItem("rb_last_email", "member@example.com");
    h.session = { access_token: "t", user: { email: "member@example.com" } };
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls()).toHaveLength(1);
    expect((checkoutCalls()[0][1] as { body: { email?: string } }).body.email).toBe("member@example.com");
  });
});
