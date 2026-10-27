/**
 * BACKING OUT OF STRIPE LEFT THE HOMEPAGE UNDER ITS CHECKOUT OVERLAY (S8-014,
 * the wiring; wave 3 review of payments-account).
 *
 * WHAT WAS WRONG. The fix for S8-014 is a call in src/pages/Index.tsx that
 * closes the full-screen checkout overlay when the browser restores the page
 * from its back/forward cache. The test for it ran only the hook on its own,
 * so deleting that call from Index.tsx left every test green: the homepage
 * could go back to trapping a buyer who pressed Back on Stripe and nothing
 * would say so.
 *
 * WHAT HOLDS NOW: the whole homepage is mounted, a paste starts the Full
 * Analysis checkout so the overlay is up (the connection check never answers,
 * as on a page frozen mid-redirect), and a `pageshow` with `persisted` set
 * closes it; an ordinary `pageshow` does not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit", "gte", "lte", "in"]) th[k] = () => th;
    th.maybeSingle = async () => ({ data: null });
    th.single = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: null }) },
      from: table,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
// A page frozen while it redirected: the connection check never answers, so
// the overlay stays up exactly as the back/forward cache would keep it.
vi.mock("@/hooks/use-shared-data", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkConnectionHealth: () => new Promise<boolean>(() => {}),
}));
vi.mock("@/components/CheckoutOverlay", () => ({
  CLOSE_OFFERED_AFTER_MS: 4000,
  CheckoutOverlay: ({ isVisible }: { isVisible: boolean }) => (isVisible ? <div data-testid="checkout-overlay" /> : null),
}));
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: ({ onTextSubmit }: { onTextSubmit: (t: string) => void }) => (
    <button type="button" onClick={() => onTextSubmit("Senior financial analyst with nine years in FP&A. ".repeat(6))}>paste and analyse</button>
  ),
}));

import Index from "@/pages/Index";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(cleanup);

const pageshow = (persisted: boolean) => {
  const e = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(e, "persisted", { value: persisted });
  act(() => { window.dispatchEvent(e); });
};

describe("the homepage restored from the back/forward cache", () => {
  it("comes back with the checkout overlay closed", async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(screen.getByRole("button", { name: "paste and analyse" }));
    expect(await screen.findByTestId("checkout-overlay")).toBeTruthy();
    pageshow(false);
    expect(screen.queryByTestId("checkout-overlay"), "an ordinary load closed the overlay").not.toBeNull();
    pageshow(true);
    expect(screen.queryByTestId("checkout-overlay"), "Back from Stripe left the overlay up").toBeNull();
  });
});
