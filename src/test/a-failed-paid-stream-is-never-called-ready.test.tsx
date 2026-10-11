/**
 * A FAILED PAID GENERATION IS NEVER CALLED READY (platform sweep L3-06), AND
 * THE PREMIUM PACKAGE AND COVER LETTER ARE MADE ONCE, CHECKED (S11-018, S11-054).
 *
 * L3-06. ProductSuccess streamed the Premium Package and the Cover Letter
 * from the tab, and a server error or a cut-off stream was announced as
 * "Your Content Is Ready!" and tracked as a completed purchase.
 *
 * S11-018 / S11-054. The streamed copy ran neither the contact guard nor the
 * figure check, and the webhook (or the retry sweep, after a page-first
 * claim) generated a second copy of the same sale. The stream is gone from
 * this page: verify-product-purchase is asked to make the product with the
 * non-stream generator (both checks), the page renders the saved copy, and
 * with nothing bound it makes it from the tab's résumé with the same
 * generator. A generation the checks refuse is never shown as ready.
 *
 * Mounted for real, with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

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
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({ ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()), useFunnelTracking: () => ({ trackPurchaseCompleted: trackFunnel, trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));

import ProductSuccess from "../pages/ProductSuccess";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Senior product manager who shipped three platforms. ".repeat(10);
const PACKAGE = {
  resume: { rewrittenResume: "THE CHECKED REWRITE OF THE RESUME", professionalSummary: "", keyChanges: [], addedKeywords: [], atsScore: { before: 50, after: 80, improvement: "" }, highlights: [] },
  coverLetter: { coverLetter: "THE CHECKED LETTER", openingLine: "", keySkillsHighlighted: [], suggestedSubjectLine: "" },
  originalResume: "",
  jobDetails: { title: "Product Manager", company: "Acme" },
};

let streamed: string[];
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("rb_resume_text", RESUME);
  invoke.mockReset();
  trackPurchase.mockReset();
  trackFunnel.mockReset();
  streamed = [];
  // Any request to a streaming generator is recorded: none may be made.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { streamed.push(String(url)); return new Response("{}", { status: 200 }); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = (product = "premiumPackage") => render(
  <MemoryRouter initialEntries={[`/product-success?session_id=cs_test_pkg&product=${product}`]}>
    <ProductSuccess />
  </MemoryRouter>,
);
const verifyBodies = () => invoke.mock.calls.filter(([f]) => f === "verify-product-purchase").map(([, o]) => (o as { body: Record<string, unknown> }).body);

describe("the premium package and the cover letter on the success page", () => {
  it("asks the server to make the package and shows its saved, checked copy; no stream is opened", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { success: true, verified: true, isFirstUse: true, productType: "premium_package", customerEmail: null, generatedContent: PACKAGE }, error: null }
      : { data: {}, error: null });
    mount();
    expect(await screen.findByText("THE CHECKED REWRITE OF THE RESUME", {}, SLOW)).toBeInTheDocument();
    expect(verifyBodies()[0], "the page did not ask the server to make it").toMatchObject({ generateContent: true });
    expect(streamed.filter((u) => /-stream\b/.test(u)), "the page streamed a second, unchecked copy").toEqual([]);
    expect(invoke.mock.calls.map(([f]) => f)).not.toContain("generate-premium-package");
  });

  it("with nothing bound, makes the letter from the tab's résumé with the checked generator, never a stream", async () => {
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "verify-product-purchase") return { data: { success: true, verified: true, isFirstUse: true, productType: "cover_letter", customerEmail: null, generatedContent: null }, error: null };
      if (fn === "generate-cover-letter") return { data: { success: true, data: { coverLetter: "THE CHECKED LETTER", openingLine: "", keySkillsHighlighted: [], personalizedElements: [], suggestedSubjectLine: "", alternateOpenings: [] } }, error: null };
      return { data: {}, error: null };
    });
    mount("coverLetter");
    expect(await screen.findByText("THE CHECKED LETTER", {}, SLOW)).toBeInTheDocument();
    const call = invoke.mock.calls.find(([f]) => f === "generate-cover-letter");
    expect((call?.[1] as { body: Record<string, unknown> }).body).toMatchObject({ resumeText: RESUME, sessionId: "cs_test_pkg" });
    expect(streamed.filter((u) => /-stream\b/.test(u))).toEqual([]);
  });

  it("a generation the checks refused is never called ready: the page asks for the résumé again", async () => {
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "verify-product-purchase") return { data: { success: true, verified: true, isFirstUse: true, productType: "premium_package", customerEmail: null, generatedContent: null }, error: null };
      if (fn === "generate-premium-package") return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { status: 422 } } };
      return { data: {}, error: null };
    });
    mount();
    await waitFor(() => expect(invoke.mock.calls.map(([f]) => f)).toContain("generate-premium-package"), SLOW);
    expect(await screen.findByRole("button", { name: /generate/i }, SLOW)).toBeInTheDocument();
    expect(screen.queryByText("Your Content Is Ready!"), "a refused generation was announced as ready").toBeNull();
    expect(screen.queryByText("THE CHECKED REWRITE OF THE RESUME")).toBeNull();
  });

  it("says nothing about a confirmation email when the purchase carries no address (L6-25)", async () => {
    invoke.mockImplementation(async () => ({ data: { success: true, verified: true, isFirstUse: true, customerEmail: null, generatedContent: { keywords: [] } }, error: null }));
    render(
      <MemoryRouter initialEntries={["/product-success?session_id=cs_test_kw&product=basicKeywordFix"]}>
        <ProductSuccess />
      </MemoryRouter>,
    );
    await screen.findByText(/get started now|scan another resume/i, {}, SLOW);
    expect(screen.queryByText(/confirmation email has been sent/i)).toBeNull();
  });
});
