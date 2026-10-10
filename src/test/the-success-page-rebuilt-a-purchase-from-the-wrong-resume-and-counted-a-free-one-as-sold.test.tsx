/**
 * THE SUCCESS PAGE REBUILT A PURCHASE FROM THE WRONG RÉSUMÉ, COUNTED A FREE
 * ONE AS SOLD, AND SOLD A FREELANCE BOOST AGAIN.
 *
 * WHAT WAS WRONG.
 *   S8-009  ProductSuccess asked the server for the saved copy only for the
 *           keyword fix; every other product was regenerated from the
 *           résumé this TAB held, so an Account apply kit for job X, bought in
 *           a tab holding a homepage scan of job Y, showed a kit for Y.
 *   S8-074  A report regenerated from the recovery form came back in English
 *           whatever language the buyer read.
 *   wave 2  A Pro member's included tool (a pro_ grant) was recorded in both
 *           purchase ledgers at the catalogue price.
 *   S8-016  Back on /freelance-boost without the success URL, a buyer was
 *           shown the $29/$59 buy buttons again, and a reload regenerated the
 *           result they had.
 *
 * Mounted for real; only the backend and the trackers are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
const trackPurchase = vi.fn();
const trackFunnel = vi.fn();
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: trackPurchase, trackButtonClick: vi.fn() }) }));
// The real module's other exports (reachedInThisTab, wave3/email-ops) stay; only the hook is faked.
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({ ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()), useFunnelTracking: () => ({ trackPurchaseCompleted: trackFunnel, trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
// The report's own view is not under test: it shows which copy arrived.
vi.mock("@/components/CareerSnapshotResults", () => ({ CareerSnapshotResults: ({ data }: { data: { summary?: string } }) => <div data-testid="snapshot">{data?.summary}</div> }));

import ProductSuccess, { VERIFY_POLL_DELAYS_MS } from "../pages/ProductSuccess";
import FreelanceBoost, { PURCHASE_KEY } from "../pages/FreelanceBoost";

vi.setConfig(MOUNT_TEST_BUDGET);

const TAB_RESUME = "Homepage scan for job Y: a résumé the buyer scanned later in this tab. ".repeat(4);
const SAVED = { summary: "Snapshot built from the copy bound for job X" };
const calls = (fn: string) => invoke.mock.calls.filter(([f]) => f === fn);
const at = (path: string, node: JSX.Element) => render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("rb_resume_text", TAB_RESUME);
  invoke.mockReset();
  trackPurchase.mockReset();
  trackFunnel.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the success page renders the server's copy (S8-009)", () => {
  it("asks for the saved copy and never rebuilds the product from the tab's résumé", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { success: true, verified: true, productType: "career_snapshot", generatedContent: SAVED }, error: null }
      : { data: { data: { summary: "rebuilt from job Y" } }, error: null });
    at("/product-success?session_id=cs_test_snapshot01&product=careerSnapshot", <ProductSuccess />);
    await waitFor(() => expect(calls("verify-product-purchase").length).toBe(1), SLOW);
    expect(calls("verify-product-purchase")[0][1].body.generateContent).toBe(true);
    await waitFor(() => expect(trackPurchase).toHaveBeenCalledTimes(1), SLOW);
    expect(screen.getByTestId("snapshot").textContent).toBe(SAVED.summary);
    expect(calls("generate-career-snapshot"), "the page rebuilt the product from the tab's résumé").toHaveLength(0);
  });

  it("while the webhook is still making it, asks again instead of generating a second copy", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    invoke.mockImplementation(async (fn: string) => {
      if (fn !== "verify-product-purchase") return { data: {}, error: null };
      n++;
      return { data: n < 3 ? { verified: true, inProgress: true, generatedContent: null } : { verified: true, generatedContent: SAVED }, error: null };
    });
    at("/product-success?session_id=cs_test_snapshot02&product=careerSnapshot", <ProductSuccess />);
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(VERIFY_POLL_DELAYS_MS[i]); });
    await waitFor(() => expect(calls("verify-product-purchase").length).toBe(3), SLOW);
    expect(calls("generate-career-snapshot")).toHaveLength(0);
  });
});

describe("a Pro member's included tool is not a sale (wave-2 handoff)", () => {
  it("a pro_ grant records no purchase", async () => {
    invoke.mockImplementation(async () => ({ data: { verified: true, generatedContent: SAVED }, error: null }));
    at("/product-success?session_id=pro_00000000-0000-4000-8000-000000000001&product=careerSnapshot", <ProductSuccess />);
    await waitFor(() => expect(calls("verify-product-purchase").length).toBe(1), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(trackPurchase).not.toHaveBeenCalled();
    expect(trackFunnel).not.toHaveBeenCalled();
  });
});

describe("a report rebuilt from the recovery form is in the buyer's language (S8-074)", () => {
  it("the regeneration carries the language the buyer reads", async () => {
    sessionStorage.clear();
    localStorage.setItem("i18nextLng", "es");
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, generatedContent: null }, error: null }
      : { data: { success: true, data: SAVED }, error: null });
    at("/product-success?session_id=cs_test_recover01&product=careerSnapshot", <ProductSuccess />);
    const box = await screen.findByPlaceholderText(en.productSuccess.recovery.pasteResumePlaceholder, {}, SLOW);
    fireEvent.change(box, { target: { value: TAB_RESUME } });
    const label = en.productSuccess.recovery.generate.replace("{{item}}", en.productSuccess.recovery.itemCareerSnapshotReport);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }));
    await waitFor(() => expect(calls("generate-career-snapshot").length).toBe(1), SLOW);
    expect(calls("generate-career-snapshot")[0][1].body.language).toBe("es");
  });
});

describe("a Freelance Boost bought in this browser (S8-016)", () => {
  it("is not offered for sale again, and the page asks for the purchase email's link", async () => {
    localStorage.setItem(PURCHASE_KEY, JSON.stringify({ at: Date.now() }));
    invoke.mockResolvedValue({ data: { success: true, found: false, purchases: [] }, error: null });
    at("/freelance-boost", <FreelanceBoost />);
    expect(await screen.findByText(en.freelanceBoost.openYourLink, {}, SLOW)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Boost my experience/ }), "the buy button was offered to a buyer").toBeNull();
    expect(calls("generate-freelance-boost"), "the result was made again").toHaveLength(0);
  });

  it("with the link, its saved result is read back rather than made again", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "recover-purchase"
      ? { data: { success: true, found: true, purchases: [{ productType: "freelance_boost", generatedContent: { experienceSection: "Saved section" } }] }, error: null }
      : { data: { success: true, data: { experienceSection: "Made again" } }, error: null });
    at("/freelance-boost?session_id=cs_test_freelance01", <FreelanceBoost />);
    await waitFor(() => expect(calls("recover-purchase").length).toBe(1), SLOW);
    expect(calls("recover-purchase")[0][1].body.sessionId).toBe("cs_test_freelance01");
    expect(calls("generate-freelance-boost"), "the result was made again").toHaveLength(0);
  });

  it("arriving from Stripe marks this browser as having bought", async () => {
    invoke.mockResolvedValue({ data: { success: true, found: false, purchases: [] }, error: null });
    at("/freelance-boost?session_id=cs_test_freelance02", <FreelanceBoost />);
    await waitFor(() => expect(localStorage.getItem(PURCHASE_KEY)).not.toBeNull(), SLOW);
  });
});
