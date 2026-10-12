/**
 * R1: THE PAGES THAT READ A CREDENTIAL FROM THE URL READ IT FROM THE STASH,
 * AND A BEARER LINK NEVER SHOWS OR KEEPS A FULL ADDRESS.
 *
 * The first script in index.html moves session_id (on /product-success and
 * /success) and the unsubscribe/confirm fragments out of the address. The
 * pages are mounted for real with the URL already stripped, and must still
 * find what they need. And (Account UX spec 7 and 9):
 *   - the success page no longer writes the purchase's address into this
 *     browser (scanCreditsEmail), and shows it masked unless the server said
 *     the signed-in visitor proved that mailbox (customerEmailMasked false);
 *   - a checkout is prefilled with the signed-in account's address or none,
 *     never with an address another person left in this browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const h = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), session: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: (...a: unknown[]) => h.rpc(...a),
    from: () => {
      const th: Record<string, unknown> = {};
      const self = () => th;
      for (const k of ["select", "order", "eq", "not", "update", "insert", "upsert", "in", "gte", "lte"]) th[k] = self;
      th.limit = async () => ({ data: [] });
      th.maybeSingle = async () => ({ data: null });
      th.single = async () => ({ data: null });
      th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
      return th;
    },
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackButtonClick: vi.fn(), trackAllConversions: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()),
  useFunnelTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn(), dismiss() {}, toasts: [] }), toast: vi.fn() }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
vi.mock("@/components/AnalysisResults", () => ({ AnalysisResults: () => <div data-testid="analysis">the analysis</div> }));

import ProductSuccess from "../pages/ProductSuccess";
import Success from "../pages/Success";
import EmailUnsubscribe from "../pages/EmailUnsubscribe";
import { checkoutPrefillEmail, useProductCheckout } from "@/hooks/use-product-checkout";
import { setResumeData, clearAllResumeData } from "@/hooks/use-resume-storage";

vi.setConfig(MOUNT_TEST_BUDGET);

const stash = (o: Record<string, string>, path: string) => sessionStorage.setItem("rb_url_stash", JSON.stringify({ ...o, _at: Date.now(), _path: path }));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  clearAllResumeData();
  h.invoke.mockReset();
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.session = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("/product-success", () => {
  const scanPackAnswer = (verify: Record<string, unknown>, credits: Record<string, unknown> = {}) => h.invoke.mockImplementation(async (fn: string) => {
    if (fn === "verify-product-purchase") return { data: { success: true, verified: true, productType: "scan_pack", generatedContent: null, ...verify }, error: null };
    if (fn === "scan-credits") return { data: { credits: 10, bought: 10, signedIn: false, mailboxProven: false, purchases: 1, email: "jane@gmail.com", ...credits }, error: null };
    return { data: {}, error: null };
  });
  const open = (url = "/product-success?product=scanPack") => render(<MemoryRouter initialEntries={[url]}><ProductSuccess /></MemoryRouter>);

  it("reads session_id from the stash when the first script took it out of the address", async () => {
    stash({ session_id: "cs_test_from_stash", session_id_path: "/product-success" }, "/product-success");
    scanPackAnswer({ customerEmail: "j***@gmail.com", customerEmailMasked: true });
    open();
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("verify-product-purchase", expect.objectContaining({ body: expect.objectContaining({ sessionId: "cs_test_from_stash" }) })), SLOW);
  });

  it("ignores a session id stashed on another payment page", async () => {
    stash({ session_id: "cs_live_full_analysis", session_id_path: "/success" }, "/success");
    scanPackAnswer({});
    open();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(h.invoke).not.toHaveBeenCalledWith("verify-product-purchase", expect.anything());
  });

  it("shows the masked address the server returns, and writes no address into this browser", async () => {
    stash({ session_id: "cs_test_masked", session_id_path: "/product-success" }, "/product-success");
    scanPackAnswer({ customerEmail: "j***@gmail.com", customerEmailMasked: true });
    open();
    expect(await screen.findByText("j***@gmail.com", {}, SLOW)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("jane@gmail.com");
    expect(localStorage.getItem("scanCreditsEmail")).toBeNull();
  });

  it("masks a full address from a server that does not say (an older build)", async () => {
    scanPackAnswer({ customerEmail: "jane@gmail.com" });
    open("/product-success?session_id=cs_test_old_server&product=scanPack");
    expect(await screen.findByText("j***@gmail.com", {}, SLOW)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("jane@gmail.com");
  });

  it("shows the full address only when the server says the visitor proved that mailbox", async () => {
    scanPackAnswer({ customerEmail: "jane@gmail.com", customerEmailMasked: false });
    open("/product-success?session_id=cs_test_owner&product=scanPack");
    expect(await screen.findByText("jane@gmail.com", {}, SLOW)).toBeInTheDocument();
    expect(localStorage.getItem("scanCreditsEmail")).toBeNull();
  });
});

describe("/success (the full analysis)", () => {
  const RESUME = "Senior software engineer with ten years of shipping. ".repeat(10);
  it("finds the purchase in the stash, and naming the analysis in the address keeps the session id out of it", async () => {
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "get_temp_resume") return { data: [{ resume_text: RESUME, linkedin_text: null, job_description_text: null }], error: null };
      return { data: null, error: null };
    });
    h.invoke.mockImplementation(async (fn: string, o: { body: { resumeText: string } }) => fn === "analyze-resume" && o.body.resumeText
      ? { data: { industry: "Software", experienceLevel: "Senior", atsScore: { overall: 72 }, shareId: "share_r1_0001", emailSent: false }, error: null }
      : { data: { error: "Resume text is required" }, error: null });
    stash({ session_id: "cs_live_stashed_fa", session_id_path: "/success" }, "/success");
    setResumeData("tempSessionId:cs_live_stashed_fa", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    window.history.replaceState(null, "", "/success");
    render(<BrowserRouter><Success /></BrowserRouter>);
    expect(await screen.findByTestId("analysis", {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain("share=share_r1_0001"));
    expect(window.location.search, "the session id went back into the address").not.toContain("session_id");
  });
});

describe("the unsubscribe page", () => {
  it("reads its link from the stashed fragment, and forgets it once spent", async () => {
    const SID = "5e7a0c1d-1111-4111-8111-111111111111";
    const TOKEN = "ab".repeat(16);
    stash({ fragment: `#list=search-digest&id=${SID}&token=${TOKEN}` }, "/email/unsubscribe");
    window.history.replaceState(null, "", "/email/unsubscribe");
    h.invoke.mockResolvedValue({ data: { unsubscribed: true }, error: null });
    render(<MemoryRouter><EmailUnsubscribe /></MemoryRouter>);
    expect(screen.getByText(/Stop the digest emails for this saved search/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Yes, turn them off/ }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("send-search-digest", { body: { action: "unsubscribe", id: SID, token: TOKEN } }));
    await waitFor(() => expect(sessionStorage.getItem("rb_url_stash") ?? "").not.toContain(TOKEN));
  });
});

describe("the checkout prefill", () => {
  it("signed out: no address, even one another person left in this browser", async () => {
    localStorage.setItem("scanCreditsEmail", "previous.buyer@example.com");
    localStorage.setItem("rb_last_email", "previous.member@example.com");
    expect(await checkoutPrefillEmail()).toBeUndefined();
    h.invoke.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    const call = h.invoke.mock.calls.find((c) => c[0] === "create-product-checkout");
    expect(call, "the checkout was never asked for").toBeTruthy();
    expect((call![1] as { body: Record<string, unknown> }).body.email).toBeUndefined();
  });

  it("signed in: the account's own address", async () => {
    localStorage.setItem("scanCreditsEmail", "previous.buyer@example.com");
    h.session = { access_token: "t", user: { id: "u1", email: "member@example.com" } };
    h.invoke.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useProductCheckout());
    await act(async () => { await result.current.purchaseProduct("coverLetter"); });
    const call = h.invoke.mock.calls.find((c) => c[0] === "create-product-checkout");
    expect((call![1] as { body: Record<string, unknown> }).body.email).toBe("member@example.com");
  });
});
