/**
 * THE TRACKER OFFERS NO APPLY ON A POSTING THAT CAME DOWN (S14X-200), COUNTS
 * A RE-LISTED POSTING AS LIVE (S14X-201), AND CALLS AN UNANSWERED ONE "NOT
 * CHECKED YET" (S14X-203).
 *
 * WHAT WAS WRONG.
 *   S14X-200 "Do next" offered "Apply now" on a saved row whatever the
 *            closure log said, so the link went to a posting that was gone.
 *   S14X-201 The closed-postings count took every non-saved row holding a
 *            closure date, and the page sets that date in memory for every
 *            outcome, re-listed included: replacements were offered for a
 *            posting that was live again.
 *   S14X-203 A row the lifecycle read did not answer (the read failed, the
 *            day's allowance ran out, or it had not landed) printed
 *            "Posting still open".
 *
 * All three now read one answer per row, trackedPostingState
 * (lib/interviewAttribution): the measured outcome, else a persisted closure
 * date, else unknown. Mounted for real with the network faked and the page's
 * other cards stubbed out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import accountEn from "../i18n/shards/account/en.json";

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
  signOut: async () => undefined,
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

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const applied = (daysAgo: number) => ({
  id: "a1", company: "Acme", role: "Data Engineer", status: "applied", scan_id: null, scan_score: null,
  applied_at: ago(daysAgo), job_id: "greenhouse:acme:1", posting_closed_at: null,
});

const mount = async () => {
  const view = render(<MemoryRouter><Account /></MemoryRouter>);
  await act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
  return view;
};
const pageText = () => document.body.textContent ?? "";

beforeEach(() => {
  world.scans = { data: [], error: null };
  world.apps = { data: [], error: null };
  world.fillCurve = [];
  world.lifecycle = [];
  world.lifecycleFails = false;
  world.fit = { data: null, error: null };
  world.rpcCalls = [];
  world.toasts = { error: [], success: [] };
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

const saved = (id: string, over: Record<string, unknown> = {}) => ({
  id, company: `Co ${id}`, role: `Role ${id}`, status: "saved", scan_id: null, scan_score: null,
  applied_at: ago(30), apply_url: `https://jobs.example.com/${id}`, job_id: null, posting_closed_at: null, ...over,
});
const tracked = (id: string, over: Record<string, unknown> = {}) => ({
  id, company: `Co ${id}`, role: `Role ${id}`, status: "applied", scan_id: null, scan_score: null,
  applied_at: ago(3), job_id: `greenhouse:co${id}:${id}`, posting_closed_at: null, ...over,
});
const applyNowHrefs = () => [...document.querySelectorAll("a")].filter((a) => a.textContent === en.accountPage.doApplyNow).map((a) => a.getAttribute("href"));
const closedCount = () => document.querySelector("[data-closed-count]")?.getAttribute("data-closed-count");

describe("S14X-200: Do next offers no Apply now on a posting the closure log says is gone", () => {
  it("a saved row whose posting came down, or is coming down, gets no Apply now; one still up does", async () => {
    world.apps = { data: [
      saved("gone", { posting_closed_at: ago(10) }),
      saved("going", { job_id: "greenhouse:cogoing:9" }),
      saved("open"),
    ], error: null };
    world.lifecycle = [{ job_id: "greenhouse:cogoing:9", outcome: "going_down", closed_at: null, days_standing: 20, relisted: false }];
    await mount();
    expect(applyNowHrefs()).toEqual(["https://jobs.example.com/open"]);
  });
});

describe("S14X-201: a posting that came down and went back up is not counted closed", () => {
  it("a re-listed row counts 0; a row that came down and stayed down counts 1", async () => {
    world.apps = { data: [tracked("r"), tracked("d")], error: null };
    world.lifecycle = [{ job_id: "greenhouse:cor:r", outcome: "came_down_relisted", closed_at: ago(4), days_standing: 12, relisted: true }];
    await mount();
    expect(closedCount()).toBe("0");
    cleanup();
    world.lifecycle = [{ job_id: "greenhouse:cod:d", outcome: "came_down", closed_at: ago(4), days_standing: 12, relisted: false }];
    await mount();
    expect(closedCount()).toBe("1");
  });
});

describe("S14X-203: a row the lifecycle read did not answer is not said to be open", () => {
  it("with the read failing, a tracked row says Not checked yet and never Posting still open", async () => {
    world.apps = { data: [tracked("x")], error: null };
    world.lifecycleFails = true;
    await mount();
    expect(pageText()).toContain(accountEn.accountView.lifecycleNotChecked);
    expect(pageText()).not.toContain(accountEn.accountView.postingOpen);
  });

  it("positive control: a row the read answers as still standing is said to be open", async () => {
    world.apps = { data: [tracked("y")], error: null };
    world.lifecycle = [{ job_id: "greenhouse:coy:y", outcome: "still_standing", closed_at: null, days_standing: null, relisted: false }];
    await mount();
    expect(pageText()).toContain(accountEn.accountView.postingOpen);
    expect(pageText()).not.toContain(accountEn.accountView.lifecycleNotChecked);
  });
});
