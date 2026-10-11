/**
 * THE SUCCESS PAGE GAVE UP ON A SLOW GENERATION, DROPPED THE ATS SIMULATION,
 * AND SENT NO ROLES (S11-140, S11-055, S11-074).
 *
 * S11-140. verify-product-purchase reports a generation in progress for up
 * to five minutes, but the page stopped asking after about a minute and then
 * regenerated the product from the tab's résumé: a second generation, from
 * the wrong résumé when the tab held another scan (the S8-009 path). It now
 * asks for five minutes, and if the server is still making it, says so and
 * makes nothing.
 *
 * S11-055. The saved ATS Defense report was rendered without the résumé, so
 * the ATS Parse Simulation (and its PDF section) vanished for every buyer.
 *
 * S11-074. The page's own fallback generation sent targetRoles: [].
 *
 * Mounted for real, with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackButtonClick: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({ ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()), useFunnelTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
vi.mock("@/components/ATSDefenseResults", () => ({
  ATSDefenseResults: ({ resumeText }: { resumeText?: string }) => <div data-testid="ats-report">{resumeText ? "ATS Parse Simulation" : "no simulation"}</div>,
}));

import ProductSuccess from "../pages/ProductSuccess";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "A résumé held by this tab, long enough to build a report from. ".repeat(4);
const verifyCalls = () => invoke.mock.calls.filter(([f]) => f === "verify-product-purchase");
const generatorCalls = () => invoke.mock.calls.filter(([f]) => String(f).startsWith("generate-"));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("rb_resume_text", RESUME);
  invoke.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("a generation the server is still making (S11-140)", () => {
  it("is asked about for five minutes, then the page says it is coming by email and makes nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, isFirstUse: false, inProgress: true, generatedContent: null, customerEmail: "b@example.com" }, error: null }
      : { data: { success: true, data: { summary: "made again from the tab" } }, error: null });
    render(<MemoryRouter initialEntries={["/product-success?session_id=cs_test_slow01&product=careerSnapshot"]}><ProductSuccess /></MemoryRouter>);
    const started = Date.now();
    let lastAskAt = started;
    let asks = 0;
    for (let i = 0; i < 50; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      if (verifyCalls().length !== asks) { asks = verifyCalls().length; lastAskAt = Date.now(); }
    }
    expect(lastAskAt - started, "the page stopped asking long before the server's five minutes").toBeGreaterThanOrEqual(280_000);
    expect(generatorCalls(), "the page made a second copy while the server was still making it").toEqual([]);
    expect(await screen.findByTestId("still-being-made")).toBeInTheDocument();
    expect(screen.getByText(en.productSuccess.stillBeingMade.emailed)).toBeInTheDocument();
  });
});

describe("the saved ATS Defense report (S11-055, S11-074)", () => {
  it("is shown with the ATS Parse Simulation run on the tab's résumé", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, isFirstUse: true, generatedContent: { summary: "saved report" }, customerEmail: null, targetRoles: ["Data Analyst"] }, error: null }
      : { data: {}, error: null });
    render(<MemoryRouter initialEntries={["/product-success?session_id=cs_test_ats01&product=atsDefense"]}><ProductSuccess /></MemoryRouter>);
    expect((await screen.findByTestId("ats-report", {}, SLOW)).textContent, "the saved report lost its simulation").toBe("ATS Parse Simulation");
  });

  it("a report the page has to make itself targets the roles named at checkout", async () => {
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "verify-product-purchase") return { data: { verified: true, isFirstUse: true, generatedContent: null, customerEmail: null, targetRoles: ["Data Analyst", "BI Developer"] }, error: null };
      if (fn === "generate-ats-defense") return { data: { report: { summary: "made here" } }, error: null };
      return { data: {}, error: null };
    });
    render(<MemoryRouter initialEntries={["/product-success?session_id=cs_test_ats02&product=atsDefense"]}><ProductSuccess /></MemoryRouter>);
    await waitFor(() => expect(invoke.mock.calls.map(([f]) => f)).toContain("generate-ats-defense"), SLOW);
    const body = (invoke.mock.calls.find(([f]) => f === "generate-ats-defense")![1] as { body: Record<string, unknown> }).body;
    expect(body.targetRoles, "the roles named at checkout were dropped").toEqual(["Data Analyst", "BI Developer"]);
  });
});

// Review of S11-054. (1) With a résumé bound and the server's generation
// failed, verify answers no copy and not in progress; the page made its own
// Premium Package from the tab while the retry sweep made and mailed another.
// (2) The verifier's "in progress" reached the Coach and the Career Path,
// widgets that make their own: the page waited on "verifying" for minutes.
describe("what the page makes itself after a paid purchase (review of S11-054)", () => {
  it.each(["premiumPackage", "coverLetter"])("%s: a bound résumé the server failed on is left to the sweep, and the page says it is coming", async (product) => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, isFirstUse: true, inProgress: false, generatedContent: null, hasResumeData: true, customerEmail: "b@example.com" }, error: null }
      : { data: { success: true, data: { summary: "made again from the tab" } }, error: null });
    render(<MemoryRouter initialEntries={[`/product-success?session_id=cs_test_bound_${product}&product=${product}`]}><ProductSuccess /></MemoryRouter>);
    expect(await screen.findByTestId("still-being-made", {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText(en.productSuccess.stillBeingMade.emailed)).toBeInTheDocument();
    expect(generatorCalls(), "the page made a second copy from the tab's résumé").toEqual([]);
  });

  it("with no résumé bound the page still makes the Premium Package from the tab", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, isFirstUse: true, inProgress: false, generatedContent: null, hasResumeData: false, customerEmail: null }, error: null }
      : { data: { success: true, data: { summary: "made from the tab" } }, error: null });
    render(<MemoryRouter initialEntries={["/product-success?session_id=cs_test_unbound_prem&product=premiumPackage"]}><ProductSuccess /></MemoryRouter>);
    await waitFor(() => expect(generatorCalls().map(([f]) => f)).toContain("generate-premium-package"), SLOW);
  });

  it.each(["interviewCoach", "careerPathSimulator"])("%s: an answer in progress is not waited for", async (product) => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, isFirstUse: false, inProgress: true, generatedContent: null, customerEmail: "b@example.com" }, error: null }
      : { data: {}, error: null });
    render(<MemoryRouter initialEntries={[`/product-success?session_id=cs_test_widget_${product}&product=${product}`]}><ProductSuccess /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(en.productSuccess.sessionReady)).toBeInTheDocument(), SLOW);
    expect(verifyCalls(), "the page polled for a widget that makes its own").toHaveLength(1);
    expect(screen.queryByTestId("still-being-made")).toBeNull();
  });
});
