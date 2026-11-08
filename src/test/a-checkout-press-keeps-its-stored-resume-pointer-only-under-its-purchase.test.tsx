/**
 * A CHECKOUT PRESS KEEPS ITS STORED-RÉSUMÉ POINTER ONLY UNDER ITS PURCHASE
 * (review of the 2026-11-10 hotfix's C-S14-010 fix).
 *
 * The $5 press stored the résumé, then wrote the store's id into this
 * browser twice: under a key that named no purchase, before create-checkout
 * answered, and under the purchase once it did. The first survived an
 * abandoned checkout (the page skips its unload clean-up while it hands over
 * to Stripe) and, kept a day since the hotfix, was read by the success page of
 * any other purchase opened in this browser. Now the press writes the pointer
 * only under the purchase create-checkout names.
 *
 * On the whole homepage, its real uploader, and only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const STORED = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const invoke = vi.hoisted(() => vi.fn());
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
      functions: { invoke },
      from: table,
      rpc: async (fn: string) => (fn === "store_temp_resume" ? { data: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", error: null } : { data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn(), dismiss() {}, toasts: [] }), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/hooks/use-shared-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkConnectionHealth: async () => true,
}));
// The hand-off to Stripe is not followed: the page stays, and so does what it stored.
vi.mock("@/hooks/use-resume-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setCheckoutRedirect: () => {},
}));
const createCheckout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, createCheckout } };
});
vi.mock("@/components/CheckoutOverlay", () => ({ CLOSE_OFFERED_AFTER_MS: 4000, CheckoutOverlay: () => null }));

import Index from "@/pages/Index";
import { clearAllResumeData, getResumeData } from "@/hooks/use-resume-storage";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Senior financial analyst with nine years in FP&A, forecasting and the monthly close. ".repeat(3);

/** Every pointer this browser holds to a stored résumé, by key. */
function pointers(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k === "tempSessionId" || k.startsWith("tempSessionId:"))) out[k] = getResumeData(k);
  }
  return out;
}

beforeEach(() => {
  sessionStorage.clear();
  clearAllResumeData();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: null, error: null });
  createCheckout.mockReset();
  sessionStorage.setItem("rb_resume_text", RESUME);
});
afterEach(() => { cleanup(); sessionStorage.clear(); clearAllResumeData(); });

const buy = () => screen.getByRole("button", { name: /complete analysis/i });
async function pressBuy() {
  render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
  await waitFor(() => expect(buy().hasAttribute("disabled"), "the buy press never became available").toBe(false));
  fireEvent.click(buy());
  await waitFor(() => expect(createCheckout, "create-checkout was never called").toHaveBeenCalled());
}

describe("the $5 press", () => {
  it("while create-checkout has not answered, keeps no pointer that names no purchase", async () => {
    createCheckout.mockImplementation(() => new Promise(() => {}));
    await pressBuy();
    expect(createCheckout.mock.calls[0][0]).toMatchObject({ tempSessionId: STORED });
    expect(pointers(), "a pointer naming no purchase was kept for any success page to read").toEqual({});
  });

  it("once create-checkout names the purchase, keeps the pointer under that purchase alone", async () => {
    createCheckout.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_live_named", sessionId: "cs_live_named" }, error: null, attempts: 1, totalDuration: 1 });
    await pressBuy();
    await waitFor(() => expect(pointers()).toEqual({ "tempSessionId:cs_live_named": STORED }));
  });
});
