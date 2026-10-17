/**
 * R1 FIX (S12-087; lead decision G of the third fixer round): A PRO MEMBER
 * WHOSE SESSION ENDED IS ASKED BEFORE STRIPE CHARGES THEM, AND NOBODY ELSE IS.
 *
 * R1 stopped sending a stored address with a signed-out checkout (it could be
 * the previous person's). That also silenced the server's signed-out Pro
 * branch, so a member whose session had expired was sent straight to Stripe
 * for a tool their plan includes. The page now asks once per tab, and still
 * sends no address; the next press buys as a guest.
 *
 * WHOM IT ASKS. Only a browser that held a SIGNED-IN session that ended
 * without a deliberate sign-out: AuthContext writes a mark (rb_session_ended_at)
 * on that event alone, and clears it on the next sign-in and on a deliberate
 * sign-out. The last address (rb_last_email) is NOT the key: EmailReportCapture
 * writes it for anyone who asks for their report by email, and those visitors
 * were told their session ended when they never had one, and their first buy
 * press on every product started nothing. The notice's words go through
 * i18n (auth.checkout.*), loaded before the toast is raised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), session: null as unknown, listeners: [] as Array<(event: string, s: unknown) => void>, signOut: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: () => ({ insert: async () => ({ error: null }) }),
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => { h.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: (...a: unknown[]) => h.signOut(...a),
    },
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast, dismiss() {}, toasts: [] }), toast: h.toast }));

import { useProductCheckout, askToSignInFirst } from "@/hooks/use-product-checkout";
import { AuthProvider, PERSONAL_LOCAL_KEYS, SESSION_ENDED_MARK_KEY, useAuth } from "@/contexts/AuthContext";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.session = null;
  h.listeners = [];
  h.invoke.mockReset().mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_x" }, error: null });
  h.toast.mockReset();
  h.signOut.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const checkoutCalls = () => h.invoke.mock.calls.filter((c) => c[0] === "create-product-checkout");
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const sessionFor = (email: string, sid: string) => ({
  access_token: `eyJhbGciOiJIUzI1NiJ9.${b64({ exp: 4_102_444_800, sub: "u1", email, session_id: sid, amr: [{ method: "password", timestamp: 1 }] })}.sig`,
  refresh_token: "rt",
  user: { id: "u1", email },
});
const emit = (event: string, s: unknown) => act(() => { h.session = s; for (const cb of h.listeners) cb(event, s); });

describe("a buy press after a session ended here", () => {
  it("asks to sign in first and starts nothing, sending no address; the next press buys as a guest", async () => {
    localStorage.setItem(SESSION_ENDED_MARK_KEY, String(Date.now()));
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls(), "a signed-out Pro member was sent to Stripe without a word").toHaveLength(0);
    expect(h.toast.mock.calls[0]?.[0]).toMatchObject({
      title: "Have Pro? Sign in first",
      description: "Your session here ended. If you have a Pro plan, sign in and this tool is included at no charge. To buy it without signing in, press the button again.",
    });
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls()).toHaveLength(1);
    expect((checkoutCalls()[0][1] as { body: { email?: string } }).body.email, "a stored address went with a signed-out checkout").toBeUndefined();
  });

  it("does not ask a visitor who only asked for their report by email (rb_last_email is not the key)", async () => {
    localStorage.setItem("rb_last_email", "reader@example.com");
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls(), "a visitor with no account was told their session ended").toHaveLength(1);
    expect(h.toast.mock.calls.some((c) => /Sign in first/.test(JSON.stringify(c[0])))).toBe(false);
  });

  it("does not ask a browser with no ended session (a deliberate sign-out leaves no mark)", async () => {
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls()).toHaveLength(1);
  });

  it("does not ask a signed-in member: their account decides", async () => {
    localStorage.setItem(SESSION_ENDED_MARK_KEY, String(Date.now()));
    h.session = { access_token: "t", user: { email: "member@example.com" } };
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls()).toHaveLength(1);
    expect((checkoutCalls()[0][1] as { body: { email?: string } }).body.email).toBe("member@example.com");
  });

  it("askToSignInFirst reads the mark and nothing else", () => {
    localStorage.setItem("rb_last_email", "reader@example.com");
    expect(askToSignInFirst(false)).toBe(false);
    localStorage.setItem(SESSION_ENDED_MARK_KEY, String(Date.now()));
    expect(askToSignInFirst(false)).toBe(true);
    expect(askToSignInFirst(false), "asked twice in one tab").toBe(false);
  });
});

describe("the mark: written only by a session that ended without a sign-out", () => {
  function Probe() {
    const { signOut } = useAuth();
    return <button type="button" onClick={() => void signOut()}>out</button>;
  }

  it("a signed-in session that vanishes writes the mark; the next sign-in clears it", () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-1"));
    expect(localStorage.getItem(SESSION_ENDED_MARK_KEY)).toBeNull();
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem(SESSION_ENDED_MARK_KEY), "an expired session left no mark").not.toBeNull();
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-2"));
    expect(localStorage.getItem(SESSION_ENDED_MARK_KEY), "a sign-in kept the ended mark").toBeNull();
  });

  it("a deliberate sign-out writes no mark and removes one that was there", async () => {
    localStorage.setItem(SESSION_ENDED_MARK_KEY, String(Date.now() - 5_000));
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-3"));
    await act(async () => { (document.querySelector("button") as HTMLButtonElement).click(); });
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem(SESSION_ENDED_MARK_KEY)).toBeNull();
    expect(PERSONAL_LOCAL_KEYS).toContain(SESSION_ENDED_MARK_KEY);
  });

  it("a visitor who never signed in gets no mark from a SIGNED_OUT the client fires on load", () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem(SESSION_ENDED_MARK_KEY)).toBeNull();
  });
});
