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
 * WHOM IT ASKS. A browser a member signed in on, that holds no session now:
 * AuthContext writes a member mark (rb_member_signed_in_at) on every event
 * that carries a session, and only a deliberate sign-out (or an account
 * deletion) removes it, with the other personal keys. The question is asked
 * only while there is no session. The last address (rb_last_email) is NOT the
 * key: EmailReportCapture writes it for anyone who asks for their report by
 * email, and those visitors were told their session ended when they never had
 * one. The notice's words go through i18n (auth.checkout.*), loaded before the
 * toast is raised.
 *
 * ROUND 4 (second recheck). The mark used to be written only when a session
 * vanished in an open tab after an event that carried it. A member coming
 * back after their session ended elsewhere (a refresh token revoked by the
 * guard's sign-out of every device, a password change on another device)
 * produces a different sequence: auth-js runs initialize() in its
 * constructor, the refresh fails, and SIGNED_OUT is the first event this tab
 * hears. No mark was written, and the first buy press went straight to Stripe
 * for a tool their plan includes, where refunds are never given.
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
import { AuthProvider, MEMBER_MARK_KEY, PERSONAL_LOCAL_KEYS, useAuth } from "@/contexts/AuthContext";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

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

describe("a buy press in a browser a member signed in on, with no session now", () => {
  it("asks to sign in first and starts nothing, sending no address; the next press buys as a guest", async () => {
    localStorage.setItem(MEMBER_MARK_KEY, String(Date.now()));
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

  it("does not ask a browser no member signed in on (a deliberate sign-out leaves no mark)", async () => {
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls()).toHaveLength(1);
  });

  it("does not ask a signed-in member: their account decides", async () => {
    localStorage.setItem(MEMBER_MARK_KEY, String(Date.now()));
    h.session = { access_token: "t", user: { email: "member@example.com" } };
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls()).toHaveLength(1);
    expect((checkoutCalls()[0][1] as { body: { email?: string } }).body.email).toBe("member@example.com");
  });

  it("askToSignInFirst reads the mark and nothing else", () => {
    localStorage.setItem("rb_last_email", "reader@example.com");
    expect(askToSignInFirst(false)).toBe(false);
    localStorage.setItem(MEMBER_MARK_KEY, String(Date.now()));
    expect(askToSignInFirst(false)).toBe(true);
    expect(askToSignInFirst(false), "asked twice in one tab").toBe(false);
  });
});

describe("the member mark: written by a signed-in session, removed only by a deliberate sign-out", () => {
  function Probe() {
    const { signOut } = useAuth();
    return <button type="button" onClick={() => void signOut()}>out</button>;
  }

  it("a signed-in session writes the mark, an expiry keeps it, and the next sign-in keeps it", () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(localStorage.getItem(MEMBER_MARK_KEY)).toBeNull();
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-1"));
    expect(localStorage.getItem(MEMBER_MARK_KEY), "a signed-in member left no mark").not.toBeNull();
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem(MEMBER_MARK_KEY), "an expired session took the mark").not.toBeNull();
    expect(askToSignInFirst(false)).toBe(true);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-2"));
    expect(localStorage.getItem(MEMBER_MARK_KEY)).not.toBeNull();
  });

  it("a session already held when the page opens (INITIAL_SESSION) writes the mark", () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("INITIAL_SESSION", sessionFor("member@example.com", "sid-0"));
    expect(localStorage.getItem(MEMBER_MARK_KEY)).not.toBeNull();
  });

  it("a returning member whose refresh token was revoked elsewhere (the first event is the load-time SIGNED_OUT) is still asked", async () => {
    localStorage.setItem(MEMBER_MARK_KEY, String(Date.now() - 3 * 24 * 3600_000));
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem(MEMBER_MARK_KEY), "the failed load-time refresh took the mark").not.toBeNull();
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    expect(checkoutCalls(), "a member whose session ended elsewhere was sent to Stripe without a word").toHaveLength(0);
    expect(h.toast.mock.calls.some((c) => /Have Pro\? Sign in first/.test(JSON.stringify(c[0])))).toBe(true);
  });

  it("a deliberate sign-out removes the mark (it is a personal key), and the next buy press is not asked", async () => {
    localStorage.setItem(MEMBER_MARK_KEY, String(Date.now() - 5_000));
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_IN", sessionFor("member@example.com", "sid-3"));
    await act(async () => { (document.querySelector("button") as HTMLButtonElement).click(); });
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem(MEMBER_MARK_KEY)).toBeNull();
    expect(PERSONAL_LOCAL_KEYS).toContain(MEMBER_MARK_KEY);
    expect(askToSignInFirst(false)).toBe(false);
  });

  it("a visitor who never signed in gets no mark from a SIGNED_OUT the client fires on load", () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    emit("SIGNED_OUT", null);
    expect(localStorage.getItem(MEMBER_MARK_KEY)).toBeNull();
  });

  it("only AuthContext writes the mark: EmailReportCapture (any report requester) never does", () => {
    const capture = codeOf(readFileSync(resolve(__dirname, "../components/EmailReportCapture.tsx"), "utf8"));
    expect(capture).not.toMatch(/MEMBER_MARK_KEY|rb_member_signed_in_at/);
    expect(capture, "positive control: the file is the one that writes rb_last_email").toMatch(/rb_last_email/);
  });
});
