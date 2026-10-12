/**
 * THE SUCCESS PAGE SAYS WHAT AN ORDER NEEDS INSTEAD OF WAITING (S12-054, S12-169).
 *
 * An Apply Assistant bought with no job posting could never be made, yet the
 * page answered "still being made: close this tab, we'll email it", because a
 * résumé was bound and the retry sweep was assumed to finish it. And a retired
 * product paid after it stopped being sold would have waited the same way.
 * The verifier now says needsJobPosting or retired, and the page says what
 * happened and what comes next. Mounted for real with only the backend faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

import ProductSuccess from "../pages/ProductSuccess";

vi.setConfig(MOUNT_TEST_BUDGET);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  invoke.mockReset();
});
afterEach(() => { cleanup(); });

const mount = (session: string) =>
  render(<MemoryRouter initialEntries={[`/product-success?session_id=${session}&product=applyAssistant`]}><ProductSuccess /></MemoryRouter>);

describe("an order nothing can make yet", () => {
  it("an Apply Assistant with no posting says the posting is needed and how to send it, never that it is on its way", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, isFirstUse: false, generatedContent: null, inProgress: false, hasResumeData: false, needsJobPosting: true, customerEmail: "b***@example.com" }, error: null }
      : { data: {}, error: null });
    mount("cs_live_needsposting01");
    await waitFor(() => expect(screen.getByTestId("needs-job-posting")).toBeTruthy(), SLOW);
    expect(screen.getByText(/needs the job posting/)).toBeTruthy();
    expect(screen.getByText(/Reply to that email with the posting/)).toBeTruthy();
    expect(screen.queryByTestId("still-being-made"), "the page still promised a mail with the product").toBeNull();
    expect(screen.queryByText(en.productSuccess.stillBeingMade.emailed)).toBeNull();
    expect(invoke.mock.calls.filter(([f]) => typeof f === "string" && f.startsWith("generate-")), "the page made it from this tab").toEqual([]);
  });

  it("with no address on the purchase, it names the support address and the order reference instead", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, generatedContent: null, needsJobPosting: true, customerEmail: null }, error: null }
      : { data: {}, error: null });
    mount("cs_live_needsposting02");
    await waitFor(() => expect(screen.getByTestId("needs-job-posting")).toBeTruthy(), SLOW);
    expect(screen.getByText(/resumeboostersupp@gmail\.com/)).toBeTruthy();
    expect(screen.getByText(/cs_live_needsposting02/)).toBeTruthy();
  });

  it("a retired product paid after it stopped being sold says it was recorded, not made", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
      ? { data: { verified: true, isFirstUse: true, generatedContent: null, retired: true, hasResumeData: false, customerEmail: "b***@example.com" }, error: null }
      : { data: {}, error: null });
    mount("cs_live_retiredsale0001");
    await waitFor(() => expect(screen.getByTestId("retired-sale")).toBeTruthy(), SLOW);
    expect(screen.getByText(/is no longer sold/)).toBeTruthy();
    expect(screen.getByText(/nothing was made automatically/)).toBeTruthy();
    expect(screen.queryByTestId("still-being-made")).toBeNull();
  });
});
