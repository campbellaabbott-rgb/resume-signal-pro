/**
 * THE SUCCESS PAGE SPENT THE VERIFIER'S HOURLY ALLOWANCE AND CALLED A PAID
 * PURCHASE UNVERIFIED (wave 3 review of payments-account, S8-009 follow-up).
 *
 * WHAT WAS WRONG. While the webhook was making a product (20 to 60 seconds,
 * the normal case) /product-success asked verify-product-purchase again every
 * 5 seconds, up to 24 times a load. That function allows 30 calls an hour per
 * address, so one slow generation and a reload, or two purchases in an hour
 * from one address, ran past it, and the refusal was shown as "We couldn't
 * verify your purchase" to a buyer who had paid.
 *
 * WHAT HOLDS NOW, mounted for real with only the backend faked: a load and a
 * reload together stay inside the function's hourly allowance (read from the
 * function itself), and a refusal after the purchase was confirmed in
 * progress takes the same path as running out of asks, with no verification
 * error on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
vi.mock("@/hooks/use-funnel-tracking", () => ({ useFunnelTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
vi.mock("@/components/CareerSnapshotResults", () => ({ CareerSnapshotResults: ({ data }: { data: { summary?: string } }) => <div data-testid="snapshot">{data?.summary}</div> }));

import ProductSuccess from "../pages/ProductSuccess";

vi.setConfig(MOUNT_TEST_BUDGET);

/** The verifier's own hourly allowance per address, as the function sets it. */
const HOURLY = Number(
  /p_function: "verify-product-purchase",[^)]*?p_max_requests: (\d+)/.exec(
    readFileSync(resolve(__dirname, "../../supabase/functions/verify-product-purchase/index.ts"), "utf8"),
  )?.[1],
);
const verifyCalls = () => invoke.mock.calls.filter(([f]) => f === "verify-product-purchase").length;
const IN_PROGRESS = { data: { verified: true, inProgress: true, generatedContent: null }, error: null };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("rb_resume_text", "A résumé held by this tab, long enough to rebuild from if needed. ".repeat(4));
  invoke.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the success page while the webhook is still making the product", () => {
  it("asks few enough times that a load and a reload stay inside the verifier's hourly allowance", async () => {
    expect(HOURLY, "the verifier's allowance could not be read").toBeGreaterThan(0);
    invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase" ? IN_PROGRESS : { data: {}, error: null });
    render(<MemoryRouter initialEntries={["/product-success?session_id=cs_test_budget01&product=careerSnapshot"]}><ProductSuccess /></MemoryRouter>);
    for (let i = 0; i < 40; i++) await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    const perLoad = verifyCalls();
    expect(perLoad).toBeGreaterThan(1);
    expect(perLoad * 2, `${perLoad} asks a load`).toBeLessThan(HOURLY);
  });

  it("a refused ask after the purchase was confirmed in progress is not shown as an unverified purchase", async () => {
    let n = 0;
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "verify-product-purchase") {
        n++;
        return n === 1 ? IN_PROGRESS : { data: null, error: { message: "Edge Function returned a non-2xx status code" } };
      }
      return { data: { success: true, data: { summary: "rebuilt" } }, error: null };
    });
    render(<MemoryRouter initialEntries={["/product-success?session_id=cs_test_budget02&product=careerSnapshot"]}><ProductSuccess /></MemoryRouter>);
    for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    await waitFor(() => expect(verifyCalls()).toBe(2), SLOW);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByText(en.productSuccess.couldNotVerify), "a paid purchase was called unverified").toBeNull();
  });
});
