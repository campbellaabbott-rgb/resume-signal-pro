/**
 * A PAST BUYER'S LINK SAYS WHY IT CANNOT OPEN, AND COUNTS NO SECOND SALE
 * (S13-048, S13-128, S13-130).
 *
 *   - S13-048: any refusal from verify-product-purchase read "your payment
 *     may still be processing ... your purchase is safe" with Try again, under
 *     "Payment Successful": a refunded, withdrawn, unpaid or unreadable
 *     purchase too, which no reload can change. Freelance Boost told a
 *     refunded buyer to press Generate again, under its already-paid box.
 *   - S13-128: a product link with no purchase reference showed "Payment
 *     Successful", "Thank You for Your Purchase!" and an upload form whose
 *     Generate could only be refused.
 *   - S13-130: a scan pack, Interview Coach or Career Path link opened again
 *     (any device) recorded another sale, and a scan pack counted $2 whatever
 *     it bought.
 *
 * The real pages mount; only the backend and the two trackers are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const h = vi.hoisted(() => ({ invoke: vi.fn(), conversion: vi.fn(), funnel: vi.fn(), open: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: h.conversion, trackButtonClick: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()),
  useFunnelTracking: () => ({ trackPurchaseCompleted: h.funnel, trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }),
}));
vi.mock("@/lib/purchase-verify-refusal", async (orig) => ({
  ...(await orig<typeof import("@/lib/purchase-verify-refusal")>()),
  openPage: (href: string) => h.open(href),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/hooks/use-product-checkout", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-product-checkout")>()),
  useProductCheckout: () => ({ purchaseProduct: vi.fn(), isLoading: false, currentProduct: null }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
vi.mock("@/components/InterviewCoach", () => ({ InterviewCoach: () => <div data-testid="coach" /> }));
vi.mock("@/components/CareerPathSimulator", () => ({ CareerPathSimulator: () => null }));

import ProductSuccess from "../pages/ProductSuccess";
import FreelanceBoost from "../pages/FreelanceBoost";
import { resetConsentMemory, setAnalyticsConsent } from "@/lib/consent";

vi.setConfig(MOUNT_TEST_BUDGET);

const SESSION = "cs_live_pastbuyerlink0001";
const refusal = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status }) },
});
const verifyAnswers = (answer: unknown) => h.invoke.mockImplementation(async (fn: string) => {
  if (fn === "verify-product-purchase") return answer;
  if (fn === "scan-credits") return { data: { credits: 25, bought: 25, signedIn: false, mailboxProven: false, purchases: 1, email: null }, error: null };
  return { data: {}, error: null };
});
const open = (search: string) => render(<MemoryRouter initialEntries={[`/product-success${search}`]}><ProductSuccess /></MemoryRouter>);
const tryAgain = () => screen.queryByRole("button", { name: en.productSuccess.tryAgain });

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  resetConsentMemory();
  for (const f of [h.invoke, h.conversion, h.funnel, h.open]) f.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("S13-048: a refused purchase link says why, under no success header", () => {
  const cases: Array<[string, number, Record<string, unknown>, RegExp, boolean]> = [
    ["refunded", 402, { error: "This purchase was refunded, so it can no longer be delivered.", refunded: true }, /This purchase was refunded/, false],
    ["withdrawn", 402, { error: "This was withdrawn because the subscription payment behind it was refunded." }, /no longer available/, false],
    ["unpaid", 400, { error: "Payment not completed", status: "unpaid" }, /hasn't completed/, true],
    ["rate limited", 429, { error: "Too many requests. Please try again later." }, /Too many checks/, true],
  ];
  for (const [name, status, body, title, retries] of cases) {
    it(`${name}: its own heading, ${retries ? "with" : "without"} Try again, and no "purchase is safe"`, async () => {
      verifyAnswers(refusal(status, body));
      const { container } = open(`?session_id=${SESSION}&product=coverLetter`);
      expect(await screen.findByRole("heading", { name: title }, SLOW)).toBeTruthy();
      expect(container.textContent).not.toContain(en.productSuccess.couldNotVerifyDescription);
      expect(container.textContent).not.toMatch(/Payment Successful|Thank You for Your Purchase/);
      expect(!!tryAgain()).toBe(retries);
    });
  }

  it("a link verify cannot read offers the paste box, and a pasted email link opens its purchase", async () => {
    verifyAnswers(refusal(400, { error: "We couldn't find that purchase. If you just paid, wait a moment and refresh; otherwise the link may have expired." }));
    open(`?session_id=cs_live_cutshort01&product=coverLetter`);
    expect(await screen.findByRole("heading", { name: /couldn't find this purchase/ }, SLOW)).toBeTruthy();
    expect(tryAgain()).toBeNull();
    const box = screen.getByLabelText(/purchase link or reference/i);
    fireEvent.change(box, { target: { value: "https://resumebooster.work/product-success?session_id=cs_live_thewholelink99&product=coverLetter" } });
    fireEvent.click(screen.getByRole("button", { name: /Open my purchase/ }));
    expect(h.open).toHaveBeenCalledWith("/product-success?session_id=cs_live_thewholelink99&product=coverLetter");
  });

  it("an answer it cannot place keeps the old words and Try again", async () => {
    verifyAnswers(refusal(500, { error: "Failed to verify purchase" }));
    open(`?session_id=${SESSION}&product=coverLetter`);
    expect(await screen.findByText(en.productSuccess.couldNotVerifyDescription, {}, SLOW)).toBeTruthy();
    expect(tryAgain()).toBeTruthy();
  });
});

describe("S13-128: a product link with no purchase reference", () => {
  it("shows no paid badge, thanks or upload form, and asks for the link from the email", async () => {
    verifyAnswers({ data: {}, error: null });
    const { container } = open(`?product=coverLetter`);
    expect(await screen.findByTestId("no-purchase-reference", {}, SLOW)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Payment Successful|Thank You for Your Purchase|You've purchased/);
    expect(container.textContent).not.toContain(en.productSuccess.recovery.titleCoverLetter);
    expect(screen.queryByRole("button", { name: /generate/i })).toBeNull();
    fireEvent.change(screen.getByLabelText(/purchase link or reference/i), { target: { value: "no reference here" } });
    fireEvent.click(screen.getByRole("button", { name: /Open my purchase/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/doesn't contain a purchase reference/);
    expect(h.open).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/purchase link or reference/i), { target: { value: SESSION } });
    fireEvent.click(screen.getByRole("button", { name: /Open my purchase/ }));
    expect(h.open).toHaveBeenCalledWith(`/product-success?session_id=${SESSION}&product=coverLetter`);
    expect(h.invoke.mock.calls.filter(([fn]) => String(fn).startsWith("generate-"))).toEqual([]);
  });
});

describe("S13-130: a purchase link opened again is not another sale", () => {
  it("a scan pack opened from its email on another device records nothing", async () => {
    verifyAnswers({ data: { success: true, verified: true, isFirstUse: false, productType: "scan_pack", generatedContent: null }, error: null });
    open(`?session_id=${SESSION}&product=scanPack`);
    expect(await screen.findByText(/25/, {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(h.invoke.mock.calls.some(([fn]) => fn === "scan-credits")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(h.conversion).not.toHaveBeenCalled();
    expect(h.funnel).not.toHaveBeenCalled();
  });

  it("in the tab that started the checkout, a 25-credit pack is one sale at what 25 credits cost", async () => {
    setAnalyticsConsent("granted");
    sessionStorage.setItem("funnel_progress", JSON.stringify(["landing_view", "product_clicked", "checkout_started"]));
    verifyAnswers({ data: { success: true, verified: true, isFirstUse: false, productType: "scan_pack", generatedContent: null }, error: null });
    open(`?session_id=${SESSION}&product=scanPack`);
    await waitFor(() => expect(h.conversion).toHaveBeenCalledTimes(1), SLOW);
    expect(h.conversion.mock.calls[0]).toEqual(["scanPack", 5, SESSION]);
    expect(h.funnel).toHaveBeenCalledTimes(1);
  });

  it("an Interview Coach link opened again from its email records nothing", async () => {
    sessionStorage.setItem("resumeText", "Senior engineer with ten years of payments work at Acme. ".repeat(4));
    verifyAnswers({ data: { success: true, verified: true, isFirstUse: false, productType: "interview_coach", generatedContent: null }, error: null });
    open(`?session_id=${SESSION}&product=interviewCoach`);
    await waitFor(() => expect(h.invoke.mock.calls.some(([fn]) => fn === "verify-product-purchase")).toBe(true), SLOW);
    await new Promise((r) => setTimeout(r, 100));
    expect(h.conversion).not.toHaveBeenCalled();
    expect(h.funnel).not.toHaveBeenCalled();
  });
});

describe("S13-048: Freelance Boost tells a refused buyer the truth", () => {
  const DRAFT = { projects: [{ clientType: "a dental practice", problem: "no bookings", deliverable: "a booking site", toolsSkills: "Figma", outcome: "more bookings", duration: "3 months" }], targetRole: "UX designer", jobPosting: "", employmentTimeline: "", situation: "alongside", workMode: "freelance" };
  const mount = (answer: unknown) => {
    localStorage.setItem("freelanceBoostIntake", JSON.stringify(DRAFT));
    h.invoke.mockImplementation(async (fn: string) => {
      if (fn === "recover-purchase") return { data: { found: false }, error: null };
      if (fn === "generate-freelance-boost") return answer;
      return { data: null, error: null };
    });
    return render(<MemoryRouter initialEntries={["/freelance-boost?session_id=cs_test_boostrefund"]}><FreelanceBoost /></MemoryRouter>);
  };

  it("refunded: the refund, no 'press Generate', no already-paid box", async () => {
    const { container } = mount(refusal(402, { error: "This purchase was refunded, so it can no longer be delivered.", refunded: true }));
    expect(await screen.findByText(/This purchase was refunded/, undefined, SLOW)).toBeTruthy();
    expect(container.textContent).not.toMatch(/purchase is safe|press "Generate my section"/);
    expect(screen.queryByRole("button", { name: /already paid/i })).toBeNull();
  });

  it("not a paid Freelance Boost: said so, no 'press Generate', no already-paid box", async () => {
    const { container } = mount(refusal(402, { error: "Payment required" }));
    expect(await screen.findByText(/doesn't hold a paid Freelance Boost purchase/, undefined, SLOW)).toBeTruthy();
    expect(container.textContent).not.toMatch(/purchase is safe/);
    expect(screen.queryByRole("button", { name: /already paid/i })).toBeNull();
  });

  it("a write that failed keeps the server's sentence and the Generate button", async () => {
    mount(refusal(502, { error: "We couldn't write a complete section this time. Your purchase is safe — press Generate to try again.", code: "draft_unusable" }));
    expect(await screen.findByText(/Your purchase is safe/, undefined, SLOW)).toBeTruthy();
    expect(screen.getByRole("button", { name: /already paid/i })).toBeTruthy();
  });
});
