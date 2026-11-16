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
 *
 * S14X-223. With the apply agent switched off, as it ships, a pass can never
 * start: an unactivated or live pass reads as retired before it could run,
 * with the support address to write to, not "not started yet" or "running".
 * The positive control switches the agent on and finds the old row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import en from "../i18n/locales/en.json";
import accountEn from "../i18n/shards/account/en.json";
import { AUTH_SUPPORT_EMAIL } from "@/config/auth-providers";

/** The switch, as it ships unless a test turns it on (the positive control). */
const sw = vi.hoisted(() => ({ on: null as boolean | null }));
vi.mock("../../supabase/functions/_shared/apply-agent-switch", async (importActual) => {
  const actual = await importActual<typeof import("../../supabase/functions/_shared/apply-agent-switch")>();
  return {
    ...actual,
    get APPLY_AGENT_ON() { return sw.on ?? actual.APPLY_AGENT_ON; },
  };
});

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

afterEach(() => { cleanup(); sw.on = null; });

const mount = (account: Parameters<typeof CreditsAndPurchases>[0]["account"]) =>
  render(<MemoryRouter><CreditsAndPurchases fetching={false} account={account} email="member@example.com" /></MemoryRouter>);

describe("the account's purchases", () => {
  it("lists an Agent Pass with its state and a link to it, and does not say there are no purchases", () => {
    sw.on = true;
    mount({ credits: 0, purchases: [], passes: [{ date: "2026-10-08T09:00:00Z", state: "live" }], mailboxProven: true });
    const row = screen.getByText(`${en.accountPage.passRow} · ${en.accountPage.passState.live}`).closest("a")!;
    expect(row.getAttribute("href")).toBe("/agents/pass");
    expect(screen.queryByText(en.accountPage.purchasesEmpty)).toBeNull();
    expect(screen.queryByText(/Anything you buy with this email/)).toBeNull();
  });

  it("S14X-223: with the agent switched off, a live or unactivated pass reads as retired, with the address to write to", () => {
    mount({ credits: 0, purchases: [], passes: [{ date: "2026-10-08T09:00:00Z", state: "live" }, { date: "2026-10-07T09:00:00Z", state: "unactivated" }, { date: "2026-09-01T09:00:00Z", state: "closed" }], mailboxProven: true });
    const retired = accountEn.accountView.passRetired.replace("{{support}}", AUTH_SUPPORT_EMAIL);
    expect(screen.getAllByText(retired)).toHaveLength(2);
    expect(screen.queryByText(`${en.accountPage.passRow} · ${en.accountPage.passState.live}`)).toBeNull();
    expect(screen.queryByText(`${en.accountPage.passRow} · ${en.accountPage.passState.unactivated}`)).toBeNull();
    // A closed pass is still a closed pass.
    expect(screen.getByText(`${en.accountPage.passRow} · ${en.accountPage.passState.closed}`)).toBeTruthy();
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
