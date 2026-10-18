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
import { MemoryRouter } from "react-router-dom";
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

// Scan packs are no longer sold (the product line, 2026-10-12): the offer
// points to a free account and to Pro instead of selling credits. It stays a
// dialog with the server's reset time.
const upsell = (props: { onClose: () => void; resetHours: number | null; signedIn?: boolean }) =>
  render(<MemoryRouter><RateLimitUpsell {...props} /></MemoryRouter>);

describe("the offer when the free scans run out (S8-119)", () => {
  it("is a dialog, sells no credits, and Escape closes it", () => {
    const onClose = vi.fn();
    upsell({ onClose, resetHours: 7 });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.rateLimitUpsell.fewerCredits })).toBeNull();
    expect(screen.queryByLabelText(en.rateLimitUpsell.howManyCredits)).toBeNull();
    expect(document.querySelector("[data-offer='free-account']")).toBeTruthy();
    expect(document.querySelector("[data-offer='pro']")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("a signed-in visitor is not offered the free account they have", () => {
    upsell({ onClose: () => {}, resetHours: null, signedIn: true });
    expect(document.querySelector("[data-offer='free-account']")).toBeNull();
    expect(document.querySelector("[data-offer='pro']")).toBeTruthy();
  });

  it("prints the server's reset time, not hours to local midnight", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 9, 22, 0, 0) });
    upsell({ onClose: () => {}, resetHours: 17 });
    const text = document.body.textContent ?? "";
    expect(text).toContain(en.rateLimitUpsell.hour_other.replace("{{count}}", "17"));
    expect(text, "two hours to local midnight is not the server's window").not.toContain(en.rateLimitUpsell.hour_other.replace("{{count}}", "2"));
  });

  it("prints no reset time at all when the server's answer named none", () => {
    upsell({ onClose: () => {}, resetHours: null });
    expect(document.body.textContent).not.toContain(en.rateLimitUpsell.resetIn);
  });
});

describe("what the credit dialogs say credits follow (S8-058)", () => {
  it("the browser and the signed-in account, with the email for the receipt", () => {
    // Neither dialog sells credits any more (scan packs were cut on
    // 2026-10-12), so neither says where bought credits go: the scan-limit
    // offer points to a free account and Pro, and the pack dialog says packs
    // are no longer sold and that credits already bought still work. The
    // locale values the old dialogs read are still held to the true wording,
    // so a revival cannot bring "tied to your email" back with them.
    upsell({ onClose: () => {}, resetHours: null });
    expect(screen.queryByText(en.rateLimitUpsell.creditsLinkedToEmail)).toBeNull();
    cleanup();
    render(<ScanPackPurchase />);
    expect(document.querySelector("[data-scan-packs-retired]")).toBeTruthy();
    expect(screen.queryByText(en.scanPackPurchase.creditsTiedToEmail)).toBeNull();
    expect(document.body.textContent).toMatch(/already bought still work/);
    for (const said of [en.rateLimitUpsell.creditsLinkedToEmail, en.scanPackPurchase.creditsTiedToEmail]) {
      expect(said).toMatch(/this browser/);
      expect(said).toMatch(/receipt/);
      expect(said).not.toMatch(/tied to your email|linked to this email/i);
    }
  });
});
