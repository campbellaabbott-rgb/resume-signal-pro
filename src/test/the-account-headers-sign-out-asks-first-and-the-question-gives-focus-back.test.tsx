/**
 * THE ACCOUNT HEADER'S SIGN-OUT ASKS FIRST, AND THE QUESTION GIVES FOCUS BACK
 * (the bug round's review of S14X-097).
 *
 * WHAT WAS WRONG.
 *   - The account page has three sign-out buttons. The security card's two
 *     ask before a sign-out deletes a résumé kept only in this browser
 *     (SignOutChoice); the one beside the address at the top of the page
 *     called signOut() directly, so it deleted the builder's résumé and
 *     Freelance Boost's details without a word.
 *   - When the question closed (Cancel, or Escape), focus was left on a
 *     button that no longer existed, so a keyboard or screen-reader user
 *     started again from the top of the page (WCAG 2.4.3).
 *
 * WHAT HOLDS NOW, with the account page mounted for real (the network faked,
 * its other cards stubbed): the header's Sign out asks first when a draft is
 * here and signs nothing out until answered, and with no draft it signs out
 * at once. Closing the question by Cancel or by Escape puts focus back on
 * the button that opened it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const world = vi.hoisted(() => ({
  scans: { data: [] as unknown[] | null, error: null as unknown },
  apps: { data: [] as unknown[] | null, error: null as unknown },
  fillCurve: [] as unknown[],
  lifecycle: [] as unknown[],
  lifecycleFails: false,
  fit: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as string[],
  toasts: { error: [] as string[], success: [] as string[] },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: (m: string) => { world.toasts.error.push(m); },
    success: (m: string) => { world.toasts.success.push(m); },
  }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chainFor = (table: string) => {
    const answer = () => (table === "user_scans" ? world.scans : table === "user_applications" ? world.apps : { data: [], error: null });
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_t, p) => {
        if (p === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad);
        if (p === "maybeSingle" || p === "single") return async () => ({ data: null, error: null });
        return () => chain;
      },
    });
    return chain;
  };
  return {
    supabase: {
      from: chainFor,
      rpc: async (fn: string) => {
        world.rpcCalls.push(fn);
        if (fn === "get_company_fill_curve") return { data: world.fillCurve, error: null };
        if (fn === "get_application_lifecycle") {
          if (world.lifecycleFails) throw new Error("statement timeout");
          return { data: world.lifecycle, error: null };
        }
        return { data: null, error: null };
      },
      functions: {
        invoke: async (fn: string) => (fn === "get-account-data"
          ? { data: { credits: 0, purchases: [], passes: [], orders: [], mailboxProven: true }, error: null }
          : fn === "application-fit" ? world.fit : { data: null, error: null }),
      },
      auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
// One signed-in state for the whole mount: the page reloads whenever the
// session object changes, so a fresh object per render would reload forever.
const auth = vi.hoisted(() => ({
  session: { access_token: "jwt", user: { id: "u1" } },
  user: { id: "u1", email: "u@example.com", created_at: "2026-01-05T10:00:00Z" },
  loading: false,
  signOut: vi.fn(async (_o?: unknown) => undefined),
  signOutEverywhere: vi.fn(async (_o?: unknown) => undefined),
}));
const pro = vi.hoisted(() => ({ pro: { active: false } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/use-pro-subscription", () => ({ useProSubscription: () => pro }));
vi.mock("@/pages/Jobs", async () => ({ FILL_RATE_MIN_TRACKING_DAYS: (await import("@/lib/hiring-record-gate")).FILL_RATE_MIN_TRACKING_DAYS }));
// The page's other cards read their own tables; they are not what this file judges.
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/ProSubscriptionCard", () => ({ ProSubscriptionCard: () => null }));
vi.mock("@/components/account/SavedSearchesCard", () => ({ SavedSearchesCard: () => null }));
vi.mock("@/components/account/ApplyKitPanel", () => ({ ApplyKitPanel: () => null }));
vi.mock("@/components/account/ApplyCopilotPanel", () => ({ ApplyCopilotPanel: () => null }));
vi.mock("@/components/account/MorningQueuePanel", () => ({ MorningQueuePanel: () => null }));
vi.mock("@/components/account/ApplyProfilePanel", () => ({ ApplyProfilePanel: () => null }));
vi.mock("@/components/account/PendingQuestionsPanel", () => ({ PendingQuestionsPanel: () => null }));
vi.mock("@/components/account/ApplyQueuePanel", () => ({ ApplyQueuePanel: () => null }));
vi.mock("@/components/account/AccountNav", () => ({ AccountNav: () => null }));
vi.mock("@/components/account/GapReport", () => ({ GapReport: () => null }));
vi.mock("@/components/account/InterviewsHub", () => ({ InterviewsHub: () => null }));
vi.mock("@/components/account/SetupChecklist", () => ({ SetupChecklist: () => null }));
vi.mock("@/components/account/AgentBridgeCard", () => ({ AgentBridgeCard: () => null }));
vi.mock("@/components/account/AgentStatusBand", () => ({ AgentStatusBand: () => null }));
vi.mock("@/components/account/NotificationsPanel", () => ({ NotificationsPanel: () => null }));
vi.mock("@/components/account/CreditsAndPurchases", () => ({ CreditsAndPurchases: () => null }));
vi.mock("@/components/account/SecurityCard", () => ({ SecurityCard: () => null }));
vi.mock("@/components/account/DataPrivacyCard", () => ({ DataPrivacyCard: () => null }));
vi.mock("@/components/account/ConnectedAIsCard", () => ({ AccountSettingsCards: () => null }));
vi.mock("@/components/account/WithdrawalPanel", () => ({ WithdrawalPanel: () => null }));
vi.mock("@/components/account/ClosedReplacementsPanel", () => ({
  ClosedReplacementsPanel: ({ closedCount }: { closedCount: number }) => <div data-closed-count={closedCount} />,
}));
vi.mock("@/components/account/LocalHistoryOffer", () => ({
  LocalHistoryOffer: ({ offeredScans }: { offeredScans: unknown[] }) => <div data-local-offer={offeredScans.length} />,
}));

import Account from "../pages/Account";

vi.setConfig(MOUNT_TEST_BUDGET);

const DRAFT = JSON.stringify({ personalInfo: { fullName: "Jordan Probe" }, experience: [] });

const mount = async () => {
  const view = render(<MemoryRouter initialEntries={["/account"]}><Account /></MemoryRouter>);
  await act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
  return view;
};
/** The sign-out beside the address at the top of the page (the security card is stubbed here). */
const headerSignOut = () => screen.getByRole("button", { name: "Sign out" });
const press = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  auth.signOut.mockClear();
  auth.signOutEverywhere.mockClear();
});
afterEach(cleanup);

describe("the account header's Sign out", () => {
  it("with a builder draft here, asks first and signs nothing out until answered", async () => {
    localStorage.setItem("resumeBuilderDraft", DRAFT);
    await mount();
    await press(headerSignOut());
    expect(auth.signOut, "the header signed out and deleted the draft with no question").not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Your builder résumé is saved only in this browser, and signing out deletes it.");
    expect(localStorage.getItem("resumeBuilderDraft")).toBe(DRAFT);
  });

  it("'Keep it on this device and sign out' signs out keeping the drafts", async () => {
    localStorage.setItem("resumeBuilderDraft", DRAFT);
    await mount();
    await press(headerSignOut());
    await press(screen.getByRole("button", { name: "Keep it on this device and sign out" }));
    expect(auth.signOut).toHaveBeenCalledWith({ keepLocalDrafts: true });
  });

  it("with nothing typed here, signs out at once", async () => {
    await mount();
    await press(headerSignOut());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(auth.signOut).toHaveBeenCalledWith({ keepLocalDrafts: false });
  });
});

describe("closing the question gives focus back to the button that opened it (WCAG 2.4.3)", () => {
  it("Cancel", async () => {
    localStorage.setItem("resumeBuilderDraft", DRAFT);
    await mount();
    const trigger = headerSignOut();
    trigger.focus();
    await press(trigger);
    expect(document.activeElement, "the question takes focus").toBe(screen.getByRole("button", { name: "Open the builder to download it" }));
    await press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement, "focus was left on a button that is gone").toBe(headerSignOut());
  });

  it("Escape", async () => {
    localStorage.setItem("resumeBuilderDraft", DRAFT);
    await mount();
    await press(headerSignOut());
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(headerSignOut());
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
