/**
 * THE TRACKER QUOTES NO SHARE THE EMPLOYER PAGE WITHHOLDS (RC-S12-185), SAYS
 * THE FIT CHECK'S HOURLY LIMIT AS ONE (S14X-204), AND NEVER READS A FAILED
 * LOAD AS AN EMPTY TRACKER (S14X-258).
 *
 * WHAT WAS WRONG.
 *   RC-S12-185 The reply-window line under an applied row asked the gate only
 *              whether the fourteen-day share could be stated, then printed
 *              the raw fill rate as "taken down for good, not re-listed",
 *              also where the gate files that share under every takedown
 *              (the re-post test reads other sites), and printed "more than
 *              half were still up 30 days after" wherever the median was
 *              censored, which the employer page says only when its own
 *              "never half down" gate passes.
 *   S14X-204   application-fit answers its hourly limit with 429
 *              {rateLimited: true}; the page said "Fit check failed. Try
 *              again shortly." for that as for an outage.
 *   S14X-258   A failed read of the scans or the tracker was never checked:
 *              the page set both to empty, offered every scan this browser
 *              held for re-import (each a duplicate on Add) and showed the
 *              empty tracker.
 *
 * WHAT HOLDS NOW, the account page mounted for real with the network faked
 * and its other cards stubbed out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";
import accountEn from "../i18n/shards/account/en.json";
import { LOCAL_HISTORY_KEY } from "@/lib/account-history-import";

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

/** A board the employer page reads to its end, with a fourteen-day share it states. */
const STATED = {
  company_token: "acme", observability_bucket: "full_read", watched_from: "2026-07-01", tracking_days: 60,
  sufficient: true, dated_coverage: 0.8, fill_rate_14: 0.4, fill_rate_14_lo: 0.32, fill_rate_14_hi: 0.48, still_open_14: 0.5,
  multi_site_title_share: 0.02, filled_roles_90d: 120, relisted_roles_90d: 6,
};
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
/** The fixed words between a sentence's first two placeholders. */
const between = (s: string) => s.split(/\{\{[^}]*\}\}/)[1];

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

describe("RC-S12-185: the reply-window line says only what the employer page says", () => {
  it("a share the gate files under every takedown (the re-post test reads other sites) is not quoted as fills", async () => {
    world.apps = { data: [applied(5)], error: null };
    world.fillCurve = [{ ...STATED, multi_site_title_share: 0.97, filled_roles_90d: 43, relisted_roles_90d: 2967 }];
    await mount();
    expect(pageText()).not.toContain(between(en.accountPage.replyWindowFill));
  });

  it("a censored median is not said where the employer page's never-half gate refuses it", async () => {
    world.apps = { data: [applied(40)], error: null };
    world.fillCurve = [{ ...STATED, median_censored: true, sufficient_30: false, insufficient_reason_30: "insufficient" }];
    await mount();
    expect(pageText()).not.toContain(between(en.accountPage.replyWindowFillCensored));
  });

  it("positive control: a share the gate counts as fills is quoted, from the gate's own ceiling", async () => {
    world.apps = { data: [applied(5)], error: null };
    world.fillCurve = [STATED];
    await mount();
    expect(pageText()).toContain(en.accountPage.replyWindowFill.replace("{{d}}", "5").replace("{{pct}}", "40").replace("{{h}}", "14"));
  });
});

describe("S14X-204: the fit check's hourly limit is said as the hourly limit", () => {
  const POSTING = "We are hiring a data engineer to build pipelines in Python and dbt, own our warehouse, and mentor two juniors.";
  const runFit = async () => {
    world.scans = { data: [{ id: "s1", ats_score: 70, projected_score: null, industry: "data", verdict: null, red_flag_count: 0, fix_plan: null, label: null, created_at: ago(3), resume_text: "Jane Doe, data engineer." }], error: null };
    world.apps = { data: [{ ...applied(5), scan_id: "s1", scan_score: 70 }], error: null };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "check fit" }));
    fireEvent.change(screen.getByPlaceholderText(en.accountPage.fitPlaceholder), { target: { value: POSTING } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: en.accountPage.fitCheck })); });
  };

  it("a 429 from application-fit says the hourly limit", async () => {
    world.fit = { data: null, error: { name: "FunctionsHttpError", context: new Response(JSON.stringify({ success: false, rateLimited: true }), { status: 429 }) } };
    await runFit();
    expect(world.toasts.error).toEqual([accountEn.accountView.fitCheckHourly]);
  });

  it("an outage still says the check failed", async () => {
    world.fit = { data: null, error: { name: "FunctionsHttpError", context: new Response(JSON.stringify({ error: "boom" }), { status: 500 }) } };
    await runFit();
    expect(world.toasts.error).toEqual([en.accountPage.fitCheckFailed]);
  });
});

describe("S14X-258: a failed load says so and keeps what it cannot read", () => {
  const LOCAL = { entries: [{ id: "l1", timestamp: ago(40), atsScore: 61, resumeFingerprint: "x" }] };

  it("a failed read of the scans offers no local scan, says so, and asks nothing of the closure log", async () => {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(LOCAL));
    world.scans = { data: null, error: { code: "57014", message: "statement timeout" } };
    world.apps = { data: [applied(5)], error: null };
    await mount();
    expect(document.querySelector("[data-local-offer]")).toBeNull();
    expect(pageText()).toContain(accountEn.accountView.trackerLoadFailed);
    expect(world.rpcCalls).not.toContain("get_application_lifecycle");
  });

  it("a failed read of the tracker shows no empty tracker", async () => {
    world.apps = { data: null, error: { code: "57014", message: "statement timeout" } };
    await mount();
    expect(pageText()).toContain(accountEn.accountView.trackerLoadFailed);
    expect(pageText()).not.toContain(en.accountPage.trackerEmpty);
    expect(pageText()).not.toContain(en.accountPage.noScans);
    expect(screen.getByRole("button", { name: accountEn.accountView.trackerRetry })).toBeTruthy();
  });

  it("positive control: a load that worked offers the local scan and shows the empty tracker", async () => {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(LOCAL));
    await mount();
    expect(document.querySelector("[data-local-offer]")?.getAttribute("data-local-offer")).toBe("1");
    expect(pageText()).toContain(en.accountPage.trackerEmpty);
    expect(pageText()).not.toContain(accountEn.accountView.trackerLoadFailed);
  });
});
