/**
 * A PASS BUYER READ "NO PURCHASES YET", AND "GET MORE CREDITS" LED TO A PAGE
 * SELLING NONE (platform sweep L6-12, L3-22).
 *
 * The account page listed only purchased_content rows, and an Agent Pass is
 * an agent_passes row: a $29 buyer was told "No purchases yet. Anything you
 * buy with this email shows up here." Its "Get more credits" went to
 * /pricing, whose ladder, plans, catalogue and add-ons sell no credit pack.
 *
 * Mounted: the card the page renders (CreditsAndPurchases), with what
 * get-account-data now returns. The handler's half is in
 * a-pass-buyer-was-told-no-purchases-and-the-export-left-out-the-agent.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

import { CreditsAndPurchases } from "@/components/account/CreditsAndPurchases";

afterEach(cleanup);

const mount = (account: Parameters<typeof CreditsAndPurchases>[0]["account"]) =>
  render(<MemoryRouter><CreditsAndPurchases fetching={false} account={account} email="member@example.com" /></MemoryRouter>);

describe("the account's purchases", () => {
  it("lists an Agent Pass with its state and a link to it, and does not say there are no purchases", () => {
    mount({ credits: 0, purchases: [], passes: [{ date: "2026-10-08T09:00:00Z", state: "live" }], mailboxProven: true });
    const row = screen.getByText(`${en.accountPage.passRow} · ${en.accountPage.passState.live}`).closest("a")!;
    expect(row.getAttribute("href")).toBe("/agents/pass");
    expect(screen.queryByText(en.accountPage.purchasesEmpty)).toBeNull();
    expect(screen.queryByText(/Anything you buy with this email/)).toBeNull();
  });

  it("names what does show up when there is nothing yet", () => {
    mount({ credits: 0, purchases: [], passes: [], mailboxProven: true });
    expect(screen.getByText(en.accountPage.purchasesEmpty)).toBeTruthy();
    expect(en.accountPage.purchasesEmpty).toMatch(/Agent Pass/);
  });
});

// Scan packs are no longer sold (owner decision 2026-10-12): the card that
// opened the pack checkout here offers none now. Credits already bought stay.
describe("getting more credits", () => {
  it("offers no scan pack, since packs are no longer sold", () => {
    mount({ credits: 3, purchases: [], passes: [], mailboxProven: true });
    expect(screen.queryByRole("button", { name: en.accountPage.getMoreCredits })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
