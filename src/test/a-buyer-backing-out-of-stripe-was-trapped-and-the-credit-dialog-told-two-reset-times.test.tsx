/**
 * A BUYER BACKING OUT OF STRIPE WAS TRAPPED, AND THE CREDIT DIALOG TOLD TWO
 * RESET TIMES.
 *
 * WHAT WAS WRONG (sweep 2026-10-08).
 *   S8-014  Back from Stripe restored the homepage from the back/forward
 *           cache under its full-screen "Redirecting to checkout" overlay,
 *           whose loading screen had no Close; nothing listened for the
 *           restore.
 *   S8-119  The scan-credit upsell was a plain fixed div: no dialog role, no
 *           focus, no Escape, an unlabelled stepper and amount field, and a
 *           reset time counted to LOCAL MIDNIGHT beside a toast quoting the
 *           server's rolling 24 hours.
 *   S8-058  Both credit dialogs said credits are "tied to your email", but
 *           since wave 1 they are spent only by the purchasing browser or a
 *           proven sign-in.
 *
 * Mounted for real; only the backend is faked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import en from "../i18n/locales/en.json";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

import { useBackForwardRestore } from "@/hooks/use-back-forward-restore";
import { CheckoutOverlay, CLOSE_OFFERED_AFTER_MS } from "@/components/CheckoutOverlay";
import { RateLimitUpsell } from "@/components/RateLimitUpsell";
import { ScanPackPurchase } from "@/components/ScanPackPurchase";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const pageshow = (persisted: boolean) => {
  const e = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(e, "persisted", { value: persisted });
  window.dispatchEvent(e);
};

describe("backing out of Stripe (S8-014)", () => {
  it("a page restored from the back/forward cache runs its reset; an ordinary load does not", () => {
    const reset = vi.fn();
    renderHook(() => useBackForwardRestore(reset));
    pageshow(false);
    expect(reset).not.toHaveBeenCalled();
    pageshow(true);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("the loading screen is a modal dialog that takes focus and offers Close after a few seconds", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<CheckoutOverlay isVisible currentStep="redirecting" onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.queryByRole("button", { name: en.common.close })).toBeNull();
    act(() => { vi.advanceTimersByTime(CLOSE_OFFERED_AFTER_MS); });
    fireEvent.click(screen.getByRole("button", { name: en.common.close }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the scan-credit offer when the free scans run out (S8-119)", () => {
  it("is a dialog whose stepper and amount are labelled, and Escape closes it", () => {
    const onClose = vi.fn();
    render(<RateLimitUpsell onClose={onClose} resetHours={7} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: en.rateLimitUpsell.fewerCredits })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.rateLimitUpsell.moreCredits })).toBeTruthy();
    expect(screen.getByLabelText(en.rateLimitUpsell.howManyCredits)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("prints the server's reset time, not hours to local midnight", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 9, 22, 0, 0) });
    render(<RateLimitUpsell onClose={() => {}} resetHours={17} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain(en.rateLimitUpsell.hour_other.replace("{{count}}", "17"));
    expect(text, "two hours to local midnight is not the server's window").not.toContain(en.rateLimitUpsell.hour_other.replace("{{count}}", "2"));
  });

  it("prints no reset time at all when the server's answer named none", () => {
    render(<RateLimitUpsell onClose={() => {}} resetHours={null} />);
    expect(document.body.textContent).not.toContain(en.rateLimitUpsell.resetIn);
  });
});

describe("what the credit dialogs say credits follow (S8-058)", () => {
  it("the browser and the signed-in account, with the email for the receipt", () => {
    render(<RateLimitUpsell onClose={() => {}} resetHours={null} />);
    expect(screen.getByText(en.rateLimitUpsell.creditsLinkedToEmail)).toBeTruthy();
    cleanup();
    render(<ScanPackPurchase />);
    expect(screen.getByText(en.scanPackPurchase.creditsTiedToEmail)).toBeTruthy();
    for (const said of [en.rateLimitUpsell.creditsLinkedToEmail, en.scanPackPurchase.creditsTiedToEmail]) {
      expect(said).toMatch(/this browser/);
      expect(said).toMatch(/receipt/);
      expect(said).not.toMatch(/tied to your email|linked to this email/i);
    }
  });
});
