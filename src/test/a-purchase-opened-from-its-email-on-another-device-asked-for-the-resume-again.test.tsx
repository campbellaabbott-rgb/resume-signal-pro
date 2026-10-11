/**
 * A PURCHASE OPENED FROM ITS EMAIL ON ANOTHER DEVICE ASKED FOR THE RESUME
 * AGAIN (commercial-readiness 2026-10-08, item 3).
 *
 * WHAT WAS WRONG. The purchase mail's button now opens the purchase's own
 * page with its session. On a device that never held the resume, those pages
 * ignored the copy already saved under that session: the product page fell
 * into an upload form, and Freelance Boost asked for the intake again and
 * would generate a second time. An owner re-delivery's reference was sent to
 * Stripe verification, which cannot read it.
 *
 * WHAT HOLDS NOW, with each page mounted for real and only the backend
 * faked: the saved copy under the link's session is shown, nothing is
 * generated again, and with no saved copy each page does what it did before.
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
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackButtonClick: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({ ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()), useFunnelTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/hooks/use-product-checkout", () => ({ useProductCheckout: () => ({ purchaseProduct: vi.fn(), isLoading: false, currentProduct: null }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

import ProductSuccess from "../pages/ProductSuccess";
import FreelanceBoost from "../pages/FreelanceBoost";

vi.setConfig(MOUNT_TEST_BUDGET);

const LETTER = "Dear hiring team, I shipped three platforms and I would like to ship yours.";
let saved: Array<Record<string, unknown>>;
const called = (fn: string) => invoke.mock.calls.filter(([f]) => f === fn);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  invoke.mockReset();
  saved = [];
  invoke.mockImplementation(async (fn: string) => {
    if (fn === "verify-product-purchase") return { data: { success: true, verified: true, isFirstUse: false, productType: "cover_letter", customerEmail: "b@example.com", generatedContent: null }, error: null };
    if (fn === "recover-purchase") return { data: saved.length ? { success: true, found: true, purchases: saved } : { success: true, found: false, purchases: [] }, error: null };
    return { data: {}, error: null };
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const at = (path: string, node: JSX.Element) => render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);

describe("the product page opened from the purchase email", () => {
  it("shows the cover letter saved under the link's session, and generates nothing", async () => {
    saved = [{ id: "p", productType: "cover_letter", productName: "Cover Letter", generatedContent: { coverLetter: LETTER, keySkillsHighlighted: [] } }];
    at("/product-success?session_id=cs_live_fromtheemail0001&product=coverLetter", <ProductSuccess />);
    expect(await screen.findByText(LETTER, {}, SLOW)).toBeInTheDocument();
    expect(called("recover-purchase")[0][1]).toEqual({ body: { sessionId: "cs_live_fromtheemail0001" } });
    expect(fetch, "a stream generated the letter a second time").not.toHaveBeenCalled();
  });

  it("an owner re-delivery's reference opens its saved copy without asking Stripe", async () => {
    saved = [{ id: "p", productType: "cover_letter", productName: "Cover Letter", generatedContent: { coverLetter: LETTER, keySkillsHighlighted: [] } }];
    at("/product-success?session_id=manual_regen_11111111-2222-4333-8444-555555555555&product=coverLetter", <ProductSuccess />);
    expect(await screen.findByText(LETTER, {}, SLOW)).toBeInTheDocument();
    expect(called("verify-product-purchase")).toHaveLength(0);
  });

  it("with nothing saved yet, the page still falls back to what it did (no letter invented)", async () => {
    at("/product-success?session_id=cs_live_fromtheemail0002&product=coverLetter", <ProductSuccess />);
    await waitFor(() => expect(called("recover-purchase")).toHaveLength(1), SLOW);
    await waitFor(() => expect(screen.queryByText(LETTER)).toBeNull(), SLOW);
  });
});

describe("Freelance Boost opened from the purchase email", () => {
  it("shows the section saved under the session, with no intake on this device and no second generation", async () => {
    saved = [{ id: "p", productType: "freelance_boost", productName: "Freelance Boost", generatedContent: {
      structure: "projects_section", structureNote: "", header: "Freelance Projects", scopeStatement: "",
      projects: [{ clientLabel: "dental", relevance: 8, bullets: ["Shipped a booking site that filled the calendar"], keywordsCovered: [] }],
      transitionParagraph: "", gapHandling: "", keywordCoverage: null,
    } }];
    at("/freelance-boost?session_id=cs_live_boostfromemail01", <FreelanceBoost />);
    expect(await screen.findByText("Shipped a booking site that filled the calendar", {}, SLOW)).toBeInTheDocument();
    expect(called("generate-freelance-boost"), "the section was generated a second time").toHaveLength(0);
    expect(screen.queryByText(/intake answers weren't found/i)).toBeNull();
  });
});
