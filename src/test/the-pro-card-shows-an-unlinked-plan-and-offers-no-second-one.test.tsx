/**
 * THE PRO CARD SHOWS AN UNLINKED PLAN AND OFFERS NO SECOND ONE (S13-086).
 * The checkout refuses a second plan on an address that has one, so the card
 * that knows the address has one says so instead of "Go Pro".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const base = { active: false, status: null as string | null, currentPeriodEnd: null as string | null, loading: false, trialing: false, linkPending: false, cancelAtPeriodEnd: false, planTier: null as "pro" | "agent" | null };
const pro = { ...base };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "member@example.com" }, session: { access_token: "jwt" } }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn(), justSubscribed: false, notConfirmedYet: false }),
}));

import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";

beforeEach(() => { Object.assign(pro, base); });
afterEach(() => cleanup());

describe("an unlinked plan on the card", () => {
  it("says the plan is on the address and how to link it, with no Go Pro button", () => {
    Object.assign(pro, { linkPending: true });
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    expect(document.querySelector("[data-link-pending]")).toBeTruthy();
    expect(screen.getByText(/isn't linked to this account yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Go Pro/ })).toBeNull();
  });

  it("an account with no plan anywhere still gets Go Pro, as on main", () => {
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /Go Pro/ })).toBeTruthy();
    expect(document.querySelector("[data-link-pending]")).toBeNull();
  });
});
