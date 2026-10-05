/**
 * A PURCHASE IS MADE FROM THE RÉSUMÉ ON SCREEN, NEVER ANOTHER STORED ONE.
 *
 * Review of claude/w1-scan-ai (2026-10-05), on the L3-03 fallback: every
 * purchase button fell back to the tab's pre-stored résumé session. On the
 * Account page, the apply-kit panel stores its own résumé + saved posting;
 * when that store was refused (the store's budgets) or raised (a posting over
 * 50,000 characters), the buy button silently fell back to the HOMEPAGE's
 * stored résumé and job description, so the $7 Apply Assistant was tailored
 * to a different posting than the one being paid for. And with nothing
 * stored at all, a purchase went to Stripe with no résumé behind it.
 *
 * Run, not read: bindPurchaseResume and purchaseProduct with the database and
 * the checkout function faked, sessionStorage real (jsdom).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

type Call = { fn: string; args: Record<string, unknown> };
const calls: Call[] = [];
let storeAnswer: () => { data: unknown; error: unknown };
const toasts: Array<{ title?: string }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return storeAnswer();
    },
    functions: {
      invoke: async (fn: string, opts: { body: Record<string, unknown> }) => {
        calls.push({ fn, args: opts.body });
        return { data: { url: "https://checkout.stripe.test/c/pay" }, error: null };
      },
    },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string }) => toasts.push(t) }) }));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackButtonClick: () => {} }) }));
vi.mock("@/hooks/use-funnel-tracking", () => ({ useFunnelTracking: () => ({ trackProductClicked: () => {}, trackCheckoutStarted: () => {} }) }));
vi.mock("@/hooks/use-checkout-prefetch", () => ({ useCheckoutPrefetch: () => ({ prefetch: () => {}, prefetchProps: {} }) }));
vi.mock("@/hooks/use-currency", () => ({ useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, isLocalCurrency: false }) }));
// The preview slice itself is another function's job: here it is simply there.
vi.mock("@/hooks/use-product-preview", () => ({
  useProductPreview: () => ({
    generate: async () => null,
    reset: () => {},
    isLoading: false,
    error: null,
    preview: { productId: "applyAssistant", kind: "text", label: "", heading: "Your tailored summary", body: "A real slice.", before: null, note: null },
  }),
}));

import {
  bindPurchaseResume,
  PRESTORED_RESUME_KEY,
  preStoredResumeFor,
  rememberPreStoredResume,
  useProductCheckout,
} from "@/hooks/use-product-checkout";
import { saveResumeToSession, clearResumeSession } from "@/hooks/use-session-resume";
import { ApplyKitPanel } from "@/components/account/ApplyKitPanel";

const RESUME_A = "Jane Doe — senior financial analyst, nine years of FP&A, Excel, SQL, forecasting. ".repeat(2);
const JD_1 = "Senior FP&A analyst at Acme: forecasting, budgeting, vendor management.";
const RESUME_B = "Jane Doe — the version saved to her account, tailored for operations roles. ".repeat(2);
const POSTING_2 = "Operations analyst at Beta Inc: process improvement, SQL, dashboards.";
const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  sessionStorage.clear();
  clearResumeSession();
  storeAnswer = () => ({ data: Q, error: null });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // The homepage scanned résumé A against JD 1 and pre-stored it as P.
  saveResumeToSession(RESUME_A, undefined, JD_1);
  rememberPreStoredResume(P, { resumeText: RESUME_A, linkedInText: null, jobDescription: JD_1 });
});

const stores = () => calls.filter((c) => c.fn === "store_temp_resume");
const checkouts = () => calls.filter((c) => c.fn === "create-product-checkout");

describe("which stored résumé a purchase is bound to", () => {
  it("a button with no résumé of its own (/pricing, the results page) uses the tab's copy while it holds the tab's résumé", async () => {
    expect(await bindPurchaseResume("premiumPackage", {})).toEqual({ sessionId: P });
    expect(stores()).toEqual([]);
  });

  it("the apply kit for a saved posting never gets the homepage's résumé: it stores its own and is bound to that", async () => {
    const b = await bindPurchaseResume("applyAssistant", { inputs: { resumeText: RESUME_B, jobDescription: POSTING_2 } });
    expect(b).toEqual({ sessionId: Q });
    expect(b.sessionId).not.toBe(P);
    expect(stores()).toHaveLength(1);
    expect(stores()[0].args).toMatchObject({ p_job_description: POSTING_2 });
    expect(String(stores()[0].args.p_resume)).toBe(RESUME_B.trim());
  });

  it("the same résumé with a different posting is a different purchase", async () => {
    expect(preStoredResumeFor({ resumeText: RESUME_A, jobDescription: JD_1 })).toBe(P);
    expect(preStoredResumeFor({ resumeText: RESUME_A, jobDescription: POSTING_2 })).toBeUndefined();
    expect(preStoredResumeFor({ resumeText: RESUME_A, jobDescription: null })).toBeUndefined();
  });

  it("when its own store is refused, a product made from the résumé refuses instead of falling back", async () => {
    storeAnswer = () => ({ data: null, error: null }); // the store's budget said no
    expect(await bindPurchaseResume("applyAssistant", { inputs: { resumeText: RESUME_B, jobDescription: POSTING_2 } })).toEqual({ refused: true });
    storeAnswer = () => ({ data: null, error: { message: "Job description text too long" } });
    expect(await bindPurchaseResume("applyAssistant", { inputs: { resumeText: RESUME_B, jobDescription: POSTING_2 } })).toEqual({ refused: true });
  });

  it("the tab's résumé changed since the copy was stored: the new one is stored, not the old copy used", async () => {
    clearResumeSession();
    saveResumeToSession(RESUME_B, undefined, JD_1);
    expect(await bindPurchaseResume("coverLetter", {})).toEqual({ sessionId: Q });
    expect(String(stores()[0].args.p_resume)).toBe(RESUME_B.trim());
  });

  it("a bare id left by the previous build is never used: it says nothing about what it holds", async () => {
    sessionStorage.setItem(PRESTORED_RESUME_KEY, P);
    expect(await bindPurchaseResume("premiumPackage", {})).toEqual({ sessionId: Q });
  });

  it("the caller's own stored id wins", async () => {
    expect(await bindPurchaseResume("applyAssistant", { sessionId: Q, inputs: { resumeText: RESUME_B, jobDescription: POSTING_2 } })).toEqual({ sessionId: Q });
    expect(stores()).toEqual([]);
  });

  it("a product not made from the résumé never stores one and is never refused for it", async () => {
    storeAnswer = () => ({ data: null, error: null });
    expect(await bindPurchaseResume("scanPack", { inputs: { resumeText: RESUME_B, jobDescription: POSTING_2 } })).toEqual({});
    expect(stores()).toEqual([]);
  });

  it("with no résumé anywhere the purchase goes ahead and the success page asks for one, as before", async () => {
    clearResumeSession();
    sessionStorage.removeItem(PRESTORED_RESUME_KEY);
    expect(await bindPurchaseResume("premiumPackage", {})).toEqual({});
  });
});

describe("purchaseProduct", () => {
  it("sends the checkout the apply kit's own stored copy, not the homepage's", async () => {
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => {
      await result.current.purchaseProduct("applyAssistant", { inputs: { resumeText: RESUME_B, jobDescription: POSTING_2 } });
    });
    expect(checkouts()).toHaveLength(1);
    expect(checkouts()[0].args.sessionId).toBe(Q);
  });

  it("starts no checkout at all when the résumé on screen could not be stored", async () => {
    storeAnswer = () => ({ data: null, error: null });
    const { result } = renderHook(() => useProductCheckout());
    let url: string | null = "unset";
    await act(async () => {
      url = await result.current.purchaseProduct("applyAssistant", { inputs: { resumeText: RESUME_B, jobDescription: POSTING_2 } });
    });
    expect(url).toBeNull();
    expect(checkouts()).toEqual([]);
    expect(toasts.map((t) => t.title)).toContain("Couldn't prepare your résumé");
  });
});

describe("the Account page's apply kit, clicked through", () => {
  const openAndBuy = async () => {
    render(createElement(ApplyKitPanel, { jobPosting: POSTING_2, resumeText: RESUME_B, proActive: false }));
    fireEvent.click(screen.getByRole("button", { name: /application kit/i }));
    const unlock = await screen.findByRole("button", { name: /apply assistant/i });
    fireEvent.click(unlock);
  };

  it("its own store refused at open: the buy stores the résumé + posting on screen and checks out with that copy", async () => {
    const answers = [{ data: null, error: null }, { data: Q, error: null }];
    storeAnswer = () => answers.shift() ?? { data: null, error: null };
    await openAndBuy();
    await waitFor(() => expect(checkouts()).toHaveLength(1));
    expect(checkouts()[0].args.sessionId).toBe(Q);
    expect(stores().map((c) => c.args.p_job_description)).toEqual([POSTING_2, POSTING_2]);
  });

  it("refused at open and at the buy: no checkout, and never the homepage's copy", async () => {
    storeAnswer = () => ({ data: null, error: null });
    await openAndBuy();
    await waitFor(() => expect(stores()).toHaveLength(2));
    await waitFor(() => expect(toasts.map((t) => t.title)).toContain("Couldn't prepare your résumé"));
    expect(checkouts()).toEqual([]);
  });
});
