/**
 * A PRO MEMBER WHO IS SIGNED OUT IS ASKED TO SIGN IN BEFORE THE FIVE-DOLLAR
 * CHECKOUT (S10-070).
 *
 * Pro includes the $5 Full Analysis. A signed-out checkout sends no address
 * (a stored one may be the last person's), so the server cannot recognise a
 * signed-out member and charges them. The page-side answer (S12-087) asks
 * once: a member signed in on this browser earlier and holds no session now,
 * so the first press says "sign in first if you have Pro" and starts nothing;
 * the next press buys as a guest. It was wired only into the product hook,
 * whose products Pro does not include, never into the homepage's own press,
 * the one product Pro does include: a member whose session ended was charged.
 *
 * WHAT HOLDS NOW, on the whole homepage with its real uploader and only the
 * backend faked: the first press shows the notice and invokes no checkout and
 * stores no résumé; the second press buys; a browser no member signed in on,
 * and a member who is signed in, are never asked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import authEn from "@/i18n/auth/en.json";

const MEMBER_MARK_KEY = "rb_member_signed_in_at";
const STORED = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const stores = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const auth = vi.hoisted(() => ({ session: null as null | { access_token: string; user: { id: string; email: string } } }));
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit", "gte", "lte", "in", "insert", "upsert", "update"]) th[k] = () => th;
    th.maybeSingle = async () => ({ data: null });
    th.single = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: null }) },
      from: table,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn !== "store_temp_resume") return { data: null, error: null };
        stores.push(args);
        return { data: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: auth.session }, error: null }),
        getUser: async () => ({ data: { user: auth.session?.user ?? null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: auth.session, user: auth.session?.user ?? null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/hooks/use-shared-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkConnectionHealth: async () => true,
}));
const createCheckout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, createCheckout } };
});
vi.mock("@/components/CheckoutOverlay", () => ({ CLOSE_OFFERED_AFTER_MS: 4000, CheckoutOverlay: () => null }));

// No request leaves the test: the checked-in .env names production, and a
// résumé of 100 characters or more starts the page's background scan.
beforeAll(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 503, headers: { "content-type": "application/json" } })));
});
afterAll(() => { vi.unstubAllGlobals(); });

import Index from "@/pages/Index";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Senior financial analyst with nine years in FP&A, forecasting and the monthly close. ".repeat(3);
const NOTICE = authEn.auth.checkout.signInFirstTitle;

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  stores.length = 0;
  toast.mockReset();
  auth.session = null;
  createCheckout.mockReset();
  createCheckout.mockResolvedValue({ data: null, error: { title: "x", description: "stopped for the test", isRetryable: false }, attempts: 1, totalDuration: 1 });
  sessionStorage.setItem("rb_resume_text", RESUME);
});
afterEach(() => { cleanup(); try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ } });

const mount = () => render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
const buy = () => screen.getByRole("button", { name: /complete analysis/i });
async function press() {
  await waitFor(() => expect(buy().hasAttribute("disabled"), "the buy press never became available").toBe(false), SLOW);
  fireEvent.click(buy());
}
const noticeShown = () => toast.mock.calls.some(([arg]) => (arg as { title?: string })?.title === NOTICE);

describe("the homepage's $5 Full Analysis press", () => {
  it("for a member signed in here before and signed out now, asks first and starts no checkout", async () => {
    localStorage.setItem(MEMBER_MARK_KEY, String(Date.now()));
    mount();
    await press();
    await waitFor(() => expect(noticeShown(), "the signed-out member was never asked to sign in").toBe(true), SLOW);
    // The notice is the whole answer to the first press.
    await new Promise((r) => setTimeout(r, 50));
    expect(createCheckout, "the checkout started, so the member would be charged for what Pro includes").not.toHaveBeenCalled();
    expect(stores, "a résumé was stored for a purchase that was not started").toEqual([]);
  });

  it("buys on the next press, as a guest, once the member has been asked", async () => {
    localStorage.setItem(MEMBER_MARK_KEY, String(Date.now()));
    mount();
    await press();
    await waitFor(() => expect(noticeShown()).toBe(true), SLOW);
    await press();
    await waitFor(() => expect(createCheckout).toHaveBeenCalledTimes(1), SLOW);
    expect(createCheckout.mock.calls[0][0]).toMatchObject({ tempSessionId: STORED });
  });

  it("asks no one on a browser no member signed in on", async () => {
    mount();
    await press();
    await waitFor(() => expect(createCheckout).toHaveBeenCalledTimes(1), SLOW);
    expect(noticeShown()).toBe(false);
  });

  it("asks no member who is signed in", async () => {
    localStorage.setItem(MEMBER_MARK_KEY, String(Date.now()));
    auth.session = { access_token: "t", user: { id: "u1", email: "member@example.com" } };
    mount();
    await press();
    await waitFor(() => expect(createCheckout).toHaveBeenCalledTimes(1), SLOW);
    expect(noticeShown()).toBe(false);
  });
});
