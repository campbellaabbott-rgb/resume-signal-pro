/**
 * THE PRICING PAGE'S PRO BLOCK READS A PLAN THE WAY THE ACCOUNT CARD DOES
 * (S14X-114), AND A PLAN THAT OWES SAYS ITS TOOLS ARE PAUSED (S14X-077).
 *
 * WHAT WAS WRONG. ProBuyConnected (/pricing) knew two states: "member" for
 * any active plan and "owing" for any unpaid one. So a retired Agent plan
 * that owed was told to update its card (the account card says no card is
 * needed for a plan we no longer sell), an address whose plan is not linked
 * yet was offered Go Pro (the checkout answers alreadySubscribed), and a
 * plan cancelled in the portal never said when it ends. It now takes the
 * card's order: retired plan, active (Ends / Renews), owing, link pending,
 * then the buy block, with the card's own translated proPlan.* lines.
 *
 * And an owing plan, on both, said only "update your card to keep your
 * plan", while every Pro tool was already off (pro-standing.ts: past_due is
 * not live). Both now say the tools are paused until the payment goes
 * through and that the payment is for the whole month (payments.pro.
 * pausedUntilPaid, the payments shard, nine languages).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const base = { active: false, status: null as string | null, currentPeriodEnd: null as string | null, loading: false, trialing: false, linkPending: false, cancelAtPeriodEnd: false, planTier: null as "pro" | "agent" | null };
const pro = { ...base };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "member@example.com" }, session: { access_token: "jwt" } }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  PRO_CONFIRM_INTERVAL_MS: 3000,
  useProSubscription: () => ({ pro, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn(), justSubscribed: false, notConfirmedYet: false }),
}));

import { ProBuyConnected } from "@/components/pricing/BuyBlock";
import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import { resolveSaleGates } from "@/components/pricing/sale-gates";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeEach(() => { Object.assign(pro, base); });
afterEach(() => cleanup());

const END = "2026-12-09T00:00:00.000Z";
const block = () => render(<MemoryRouter><ProBuyConnected gates={resolveSaleGates()} /></MemoryRouter>);
const card = () => render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
const PAUSED = /paused until this payment goes through/;

describe("the /pricing Pro block takes the account card's order (S14X-114)", () => {
  it("a retired Agent plan that owes is told no card is needed, not 'Update payment method'", () => {
    Object.assign(pro, { planTier: "agent", status: "past_due" });
    block();
    expect(document.querySelector("[data-pro-state='retired']")).toBeTruthy();
    expect(screen.getByText(/You don't need a card for a plan we no longer sell/)).toBeTruthy();
    expect(screen.queryByText(/Update payment method/)).toBeNull();
  });

  it("a retired Agent plan that runs, or ends, says so", () => {
    Object.assign(pro, { planTier: "agent", status: "active", active: true });
    block();
    expect(screen.getByText(/Pro's tools stay on/)).toBeTruthy();
    cleanup();
    Object.assign(pro, { cancelAtPeriodEnd: true, currentPeriodEnd: END });
    block();
    expect(screen.getByText(/will not renew/)).toBeTruthy();
  });

  it("an address whose plan is not linked yet gets the link note and no Go Pro button", () => {
    Object.assign(pro, { linkPending: true });
    block();
    expect(document.querySelector("[data-pro-state='link-pending']")).toBeTruthy();
    expect(screen.getByText(/isn't linked to this account yet/)).toBeTruthy();
    expect(screen.getByText(/You don't need to buy Pro again/)).toBeTruthy();
    expect(document.querySelector("[data-buy='pro']")).toBeNull();
  });

  it("a plan cancelled in the portal says when it ends; a running one when it renews", () => {
    Object.assign(pro, { active: true, status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: END });
    block();
    expect(document.querySelector("[data-testid='pro-ends']")?.textContent).toMatch(/^Ends .*2026: cancelled, it will not renew$/);
    cleanup();
    Object.assign(pro, { cancelAtPeriodEnd: false });
    block();
    expect(document.querySelector("[data-testid='pro-renews']")?.textContent).toMatch(/^Renews .*2026$/);
  });

  it("an account with no plan anywhere still gets the buy block, as before", () => {
    block();
    expect(document.querySelector("[data-buy='pro']")).toBeTruthy();
  });
});

describe("an owing plan says its tools are paused (S14X-077)", () => {
  it("on /pricing", () => {
    Object.assign(pro, { status: "past_due" });
    block();
    expect(document.querySelector("[data-pro-state='owing']")).toBeTruthy();
    expect(screen.getByText(PAUSED)).toBeTruthy();
  });

  it("on the account card", () => {
    Object.assign(pro, { status: "past_due" });
    card();
    expect(screen.getByText(PAUSED)).toBeTruthy();
    expect(screen.getByText(/whole month/)).toBeTruthy();
  });

  it("not on a live plan, and not on a retired plan, which needs no card", () => {
    Object.assign(pro, { active: true, status: "active" });
    card();
    expect(screen.queryByText(PAUSED)).toBeNull();
    cleanup();
    Object.assign(pro, { active: false, status: "past_due", planTier: "agent" });
    card();
    expect(screen.queryByText(PAUSED)).toBeNull();
  });

  it("the sentence is in all nine languages of the payments shard, each its own", () => {
    const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
    const said = LNGS.map((l) => JSON.parse(readFileSync(resolve(__dirname, `../i18n/shards/payments/${l}.json`), "utf8")).payments.pro.pausedUntilPaid as string);
    for (const s of said) expect(s.length).toBeGreaterThan(40);
    expect(new Set(said.filter((_, i) => LNGS[i] !== "en-GB")).size).toBe(LNGS.length - 1);
  });
});
