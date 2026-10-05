/**
 * A BUYER FROM BEFORE IS TOLD HOW TO REACH THEIR CREDITS, NOT THAT THEY HAVE NONE.
 *
 * Review of claude/w1-scan-ai (2026-10-05): a guest who bought a scan pack
 * before this deploy has the address they typed in localStorage
 * (scanCreditsEmail) but no Stripe session id, which is all the header can now
 * prove. The header told them "No scan credits on this browser or account
 * yet" and "Bought them on another device? Sign in with the email you used at
 * checkout" -- and signing in by password with that address no longer opens
 * its pool, because sign-ups are auto-confirmed and an address is not proof.
 *
 * Run, not read: the shipped ScanCreditsCounter, with the auth client and the
 * scan-credits function faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invokes: Array<Record<string, unknown>> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    functions: {
      invoke: async (_fn: string, opts: { body: Record<string, unknown> }) => {
        invokes.push(opts.body);
        return { data: { credits: 0, signedIn: false, mailboxProven: false, purchases: 0, bought: 0, email: null }, error: null };
      },
    },
  },
}));
vi.mock("@/hooks/use-currency", () => ({ useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, isLocalCurrency: false }) }));
vi.mock("@/components/ScanPackPurchase", () => ({ ScanPackPurchase: () => null }));

import { ScanCreditsCounter } from "@/components/ScanCreditsCounter";
import { CREDIT_SESSIONS_KEY } from "@/hooks/use-scan-credits";

const openPopover = async () => {
  render(<MemoryRouter><ScanCreditsCounter /></MemoryRouter>);
  const trigger = await screen.findByRole("button", { name: /my credits/i });
  fireEvent.click(trigger);
};

beforeEach(() => {
  localStorage.clear();
  invokes.length = 0;
});

describe("the header's credits popover", () => {
  it("a guest buyer from before this deploy is told their unused credits are on record and how to get them added", async () => {
    localStorage.setItem("scanCreditsEmail", "Guest@Example.com");
    await openPopover();
    const hint = await screen.findByTestId("legacy-credits-hint");
    expect(hint.textContent).toContain("guest@example.com");
    expect(hint.textContent).toContain("resumeboostersupp@gmail.com");
    expect(hint.textContent).toMatch(/still on record/);
  });

  it("the sign-in line no longer promises that signing in with the checkout address unlocks credits", async () => {
    await openPopover();
    await waitFor(() => expect(screen.getByText(/sign in there once/i)).toBeTruthy());
    expect(screen.queryByText(/sign in with the email you used at checkout/i)).toBeNull();
  });

  it("a browser that holds its purchases gets no such hint", async () => {
    localStorage.setItem("scanCreditsEmail", "buyer@example.com");
    localStorage.setItem(CREDIT_SESSIONS_KEY, JSON.stringify(["cs_test_heldpurchase01"]));
    await openPopover();
    await waitFor(() => expect(invokes.length).toBe(1));
    await screen.findByText(/no scan credits on this browser or account yet/i);
    expect(screen.queryByTestId("legacy-credits-hint")).toBeNull();
  });

  it("nothing typed, nothing held: no hint", async () => {
    await openPopover();
    await screen.findByText(/no scan credits on this browser or account yet/i);
    expect(screen.queryByTestId("legacy-credits-hint")).toBeNull();
  });
});
