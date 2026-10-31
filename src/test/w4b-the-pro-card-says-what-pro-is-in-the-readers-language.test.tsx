/**
 * THE PRO CARD SAYS WHAT PRO IS, IN THE READER'S LANGUAGE, AND WHAT HAPPENS
 * TO THE PLAN (S12-044, S12-076, S12-168; S12-002's linkPending line).
 *
 * WHAT WAS WRONG.
 *   S12-044  The $45 card, its perks, its button and its checkout toasts were
 *            English literals in all nine locales.
 *   S12-076  After cancelling in Stripe's portal the card still said
 *            "Renews <date>": the cache never held the cancel flag.
 *   S12-168  A retired Agent plan counts as Pro, so its subscriber saw
 *            "$45/month ... Renews" and, past due, "Update payment method":
 *            prompted to pay for a plan we no longer sell.
 *   S12-002  The unlinked-plan line told people to sign in with Google, a
 *            control the page does not render.
 *
 * Mounted for real with only the subscription hook and the translator faked:
 * the translator returns each key in brackets, so any English left on the
 * card is a string that never went through t().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("react-i18next", async (orig) => ({
  ...(await orig<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string) => `⟦${k}⟧`, i18n: { language: "de" } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => `⟦${i18nKey}⟧`,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
let signedIn = true;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => (signedIn ? { user: { email: "m@example.com" }, session: { access_token: "jwt" } } : { user: null, session: null }) }));

const base = { active: false, status: null as string | null, currentPeriodEnd: null as string | null, loading: false, trialing: false, linkPending: false, cancelAtPeriodEnd: false, planTier: null as "pro" | "agent" | null };
const pro = { ...base };
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn(), justSubscribed: false, notConfirmedYet: false }),
}));

import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import { PRO_PERK_ITEMS } from "@/config/pro-perks";

vi.setConfig(MOUNT_TEST_BUDGET);

const mount = () => render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
const card = () => document.querySelector("[data-pro-card]")?.textContent ?? "";
/** What is left once every translated key, the price and punctuation are removed. */
const untranslated = () => card().replace(/⟦[^⟧]*⟧/g, " ").replace(/\$\d+/g, " ").replace(/[^A-Za-zÀ-ÿ]+/g, " ").trim();
const DATE = new Date(Date.now() + 9 * 86_400_000).toISOString();

beforeEach(() => { Object.assign(pro, base); signedIn = true; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("every word on the card goes through the translator (S12-044)", () => {
  const states: Array<[string, Partial<typeof base>]> = [
    ["not subscribed", {}],
    ["a paid member", { active: true, status: "active", currentPeriodEnd: DATE, planTier: "pro" }],
    ["a member who cancelled", { active: true, status: "active", currentPeriodEnd: DATE, cancelAtPeriodEnd: true, planTier: "pro" }],
    ["a trial", { active: true, status: "trialing", trialing: true, planTier: "pro" }],
    ["a plan that owes money", { status: "past_due", planTier: "pro" }],
    ["an unlinked plan", { linkPending: true }],
    ["a retired agent plan", { active: true, status: "active", currentPeriodEnd: DATE, planTier: "agent" }],
  ];
  it.each(states)("%s", (_name, state) => {
    Object.assign(pro, state);
    mount();
    expect(untranslated(), "English the translator never saw").toBe("");
  });

  it("signed out, too", () => {
    signedIn = false;
    mount();
    expect(untranslated()).toBe("");
  });

  it("each perk renders by its own key", () => {
    mount();
    for (const p of PRO_PERK_ITEMS) expect(card()).toContain(`⟦${p.key}⟧`);
  });
});

describe("the plan's end is said as it is (S12-076)", () => {
  it("a cancelled plan says Ends, never Renews", () => {
    Object.assign(pro, { active: true, status: "active", currentPeriodEnd: DATE, cancelAtPeriodEnd: true, planTier: "pro" });
    mount();
    expect(screen.getByTestId("pro-ends").textContent).toBe("⟦proPlan.endsOn⟧");
    expect(screen.queryByTestId("pro-renews")).toBeNull();
  });

  it("a plan that renews says Renews", () => {
    Object.assign(pro, { active: true, status: "active", currentPeriodEnd: DATE, planTier: "pro" });
    mount();
    expect(screen.getByTestId("pro-renews").textContent).toBe("⟦proPlan.renewsOn⟧");
  });
});

describe("a retired Agent plan is not shown as Pro (S12-168)", () => {
  it("live: the retired-plan card, no $45 renewal, no Go Pro", () => {
    Object.assign(pro, { active: true, status: "active", currentPeriodEnd: DATE, planTier: "agent" });
    mount();
    expect(document.querySelector("[data-retired-plan]")).toBeTruthy();
    expect(card()).toContain("⟦proPlan.retiredPlanLive⟧");
    for (const k of ["proPlan.renewsOn", "proPlan.goPro", "proPlan.activeMember", "proPlan.updatePayment"]) expect(card(), k).not.toContain(k);
  });

  it("past due: told it need not pay a retired plan, offered billing to cancel, not 'update payment method'", () => {
    Object.assign(pro, { active: false, status: "past_due", planTier: "agent" });
    mount();
    expect(card()).toContain("⟦proPlan.retiredPlanOwing⟧");
    expect(card()).toContain("⟦proPlan.manageRetired⟧");
    expect(card()).not.toContain("proPlan.updatePayment");
    expect(card()).not.toContain("proPlan.goPro");
  });
});

/**
 * A TRIALING RETIRED PLAN IS TOLD WHAT A TRIAL GETS (recheck 3, 2026-10-26).
 * The Apply Agent plan is the only plan ever sold with a trial, and the
 * webhook sets every trialing one to end at its period end. The card said
 * "Pro's tools stay on until then", but a trial gets fewer of them: the
 * writing tools run on the free daily allowance (writingGate passes "free"
 * without consumables) and no Full Analysis is minted; only the uncapped
 * scans hold.
 */
describe("a trialing retired Agent plan says what a trial gets (recheck 3)", () => {
  it("ending at its trial's end: the trial line with the date, never 'Pro's tools stay on'", () => {
    Object.assign(pro, { active: true, status: "trialing", trialing: true, currentPeriodEnd: DATE, cancelAtPeriodEnd: true, planTier: "agent" });
    mount();
    expect(document.querySelector("[data-retired-plan]")).toBeTruthy();
    expect(card()).toContain("⟦proPlan.retiredPlanTrialingEnds⟧");
    for (const k of ["proPlan.retiredPlanEnds", "proPlan.retiredPlanLive", "proPlan.trialingNoCap"]) expect(card(), k).not.toContain(k);
  });

  it("with no end set yet: the trial line, never 'Pro's tools stay on'", () => {
    Object.assign(pro, { active: true, status: "trialing", trialing: true, currentPeriodEnd: DATE, planTier: "agent" });
    mount();
    expect(card()).toContain("⟦proPlan.retiredPlanTrialing⟧");
    expect(card()).not.toContain("proPlan.retiredPlanLive");
  });

  it("positive control: a paid retired plan that ends keeps its line", () => {
    Object.assign(pro, { active: true, status: "active", currentPeriodEnd: DATE, cancelAtPeriodEnd: true, planTier: "agent" });
    mount();
    expect(card()).toContain("⟦proPlan.retiredPlanEnds⟧");
  });

  it("the English says the scans have no daily cap, the writing tools count on the free daily allowance, and no Full Analysis comes with a trial", async () => {
    const en = (await import("@/i18n/locales/en.json")).default as unknown as { proPlan: Record<string, string> };
    for (const k of ["retiredPlanTrialing", "retiredPlanTrialingEnds"]) {
      const line = en.proPlan[k];
      expect(line, k).toMatch(/no daily cap/);
      expect(line, k).toMatch(/free daily allowance/);
      expect(line, k).toMatch(/Full Analysis is not included/);
      expect(line, k).not.toMatch(/Pro's tools stay on/);
    }
    expect(en.proPlan.retiredPlanTrialingEnds).toContain("{{date}}");
  });
});

describe("the unlinked-plan line names no control the page lacks (S12-002)", () => {
  it("the new key, not the one that said to sign in with Google", () => {
    Object.assign(pro, { linkPending: true });
    mount();
    expect(card()).toContain("⟦proPlan.linkPendingUnlinked⟧");
    expect(card()).not.toContain("⟦proPlan.linkPending⟧");
  });
});

describe("a buyer in the EU, the EEA, the UK or India is offered Pro, as on main (owner, 2026-10-27: \"keep selling as today\")", () => {
  const realOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  for (const zone of ["Europe/Berlin", "Europe/London", "Asia/Kolkata"]) {
    it(`${zone}: Go Pro stands on the card, and no region note`, () => {
      vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...realOptions.call(this), timeZone: zone };
      });
      mount();
      expect(document.querySelector("[data-region-notice]")).toBeNull();
      expect(card()).toContain("⟦proPlan.goPro⟧");
    });
  }
});
