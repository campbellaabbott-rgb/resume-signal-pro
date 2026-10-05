/**
 * A FAILED PAID STREAM IS NEVER CALLED READY (platform sweep L3-06).
 *
 * WHAT WAS WRONG. ProductSuccess threw the server's `{type:"error"}` event
 * INSIDE the try that guarded JSON.parse, whose catch ("Ignore JSON parse
 * errors") swallowed it. The loop ran on to the end of the stream, the page
 * announced "Your Content Is Ready!" over a partial or empty Premium Package
 * or Cover Letter, and the purchase was tracked as completed. A stream that
 * simply stopped, with no "complete" event, was treated the same way.
 *
 * WHAT THIS HOLDS, with the page mounted for real and only the backend faked:
 * an error event or a stream with no "complete" is shown as an error with a
 * regenerate control and is not tracked as a purchase; a stream that ends
 * with "complete" is ready and tracked once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
vi.mock("@/hooks/use-funnel-tracking", () => ({ useFunnelTracking: () => ({ trackPurchaseCompleted: trackFunnel, trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));

import ProductSuccess from "../pages/ProductSuccess";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Senior product manager who shipped three platforms. ".repeat(10);

function sse(events: Array<Record<string, unknown>>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let streamEvents: Array<Record<string, unknown>>;
beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("rb_resume_text", RESUME);
  invoke.mockReset();
  trackPurchase.mockReset();
  trackFunnel.mockReset();
  invoke.mockImplementation(async (fn: string) => fn === "verify-product-purchase"
    ? { data: { success: true, verified: true, isFirstUse: true, productType: "premium_package", customerEmail: null, generatedContent: null }, error: null }
    : { data: {}, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => sse(streamEvents)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = () => render(
  <MemoryRouter initialEntries={["/product-success?session_id=cs_test_stream&product=premiumPackage"]}>
    <ProductSuccess />
  </MemoryRouter>,
);

describe("the paid streaming page", () => {
  it("shows the server's error, offers a regenerate, and does not count the purchase as delivered", async () => {
    streamEvents = [{ type: "start" }, { type: "content", content: "Half a pack" }, { type: "error", message: "gateway timed out" }];
    mount();
    expect(await screen.findByRole("button", { name: /regenerate/i }, SLOW)).toBeInTheDocument();
    expect(screen.getByText("gateway timed out")).toBeInTheDocument();
    expect(screen.queryByText("Your Content Is Ready!"), "a failed generation was announced as ready").toBeNull();
    expect(trackPurchase).not.toHaveBeenCalled();
    expect(trackFunnel).not.toHaveBeenCalled();
  });

  it("treats a stream that stops without 'complete' as interrupted, not finished", async () => {
    streamEvents = [{ type: "start" }, { type: "content", content: "Half a pack" }];
    mount();
    expect(await screen.findByText(/interrupted before it finished/i, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText("Your Content Is Ready!")).toBeNull();
    expect(trackPurchase).not.toHaveBeenCalled();
  });

  it("calls a stream that ends with 'complete' ready, and counts it once", async () => {
    streamEvents = [{ type: "start" }, { type: "content", content: "The whole pack." }, { type: "done" }, { type: "complete" }];
    mount();
    expect(await screen.findByText("Your Content Is Ready!", {}, SLOW)).toBeInTheDocument();
    expect(trackPurchase).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a confirmation email when the purchase carries no address (L6-25)", async () => {
    streamEvents = [{ type: "complete" }];
    invoke.mockImplementation(async () => ({ data: { success: true, verified: true, isFirstUse: true, customerEmail: null, generatedContent: { keywords: [] } }, error: null }));
    render(
      <MemoryRouter initialEntries={["/product-success?session_id=cs_test_kw&product=careerSnapshot"]}>
        <ProductSuccess />
      </MemoryRouter>,
    );
    await screen.findByText(/get started now|scan another resume/i, {}, SLOW);
    expect(screen.queryByText(/confirmation email has been sent/i)).toBeNull();
  });
});
