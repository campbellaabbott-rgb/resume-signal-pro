/**
 * THE PRO CARD TOLD A TRIAL "EVERY TOOL IS UNLOCKED".
 *
 * WHAT WAS WRONG (wave 2, L6-08 / L6-29). A trialing Agent subscriber's plan
 * reads as live, and the Pro card said "You're a Pro member — every tool is
 * unlocked." Under the owner's trial rule a trial unlocks the plan's ongoing
 * features but mints no paid one-off tool, so that sentence promised what the
 * checkouts then charge for. And a plan on the address that this account
 * cannot use (bought before plans named their account) showed a bare "Go Pro"
 * with no word about why.
 *
 * Mounted for real, with only the subscription hook faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "member@example.com" }, session: { access_token: "jwt" } }) }));

const pro = { active: true, status: "trialing" as string | null, currentPeriodEnd: null, loading: false, trialing: true, linkPending: false };
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));

import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";

vi.setConfig(MOUNT_TEST_BUDGET);

const mount = () => render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);

beforeEach(() => {
  Object.assign(pro, { active: true, status: "trialing", trialing: true, linkPending: false });
});
afterEach(cleanup);

describe("the Pro card says what the plan unlocks", () => {
  it("a trial is told what is on now, and that the paid tools come with the first payment", () => {
    mount();
    expect(screen.queryByText(/every tool is unlocked/i)).toBeNull();
    expect(screen.getByText(en.proPlan.trialing)).toBeTruthy();
  });

  it("a paid plan is still told every tool is unlocked", () => {
    Object.assign(pro, { status: "active", trialing: false });
    mount();
    expect(screen.getByText(/every tool is unlocked/i)).toBeTruthy();
    expect(screen.queryByText(en.proPlan.trialing)).toBeNull();
  });

  it("a plan on the address this account cannot use says why, beside the way to subscribe", () => {
    Object.assign(pro, { active: false, status: "active", trialing: false, linkPending: true });
    mount();
    expect(screen.getByText(en.proPlan.linkPending)).toBeTruthy();
  });
});
