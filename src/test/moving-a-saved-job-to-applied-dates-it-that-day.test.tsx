/**
 * MOVING A SAVED JOB TO APPLIED DATES IT THAT DAY (S11-095).
 *
 * WHAT WAS WRONG. Saving a job on the board writes a tracker row whose
 * applied_at is the day it was saved. Moving that row to Applied on /account
 * wrote only its status and status_changed_at, so the row kept the save
 * date: "Applied this week", the weekly bars and the row's own date all
 * counted an application made today as one made the day it was saved,
 * weeks back. And the "Which resume gets interviews" table counted every row
 * that named a résumé version as sent, saved rows included.
 *
 * WHAT HOLDS NOW, mounted with the database faked: moving a saved row to any
 * other stage writes applied_at as the day of the move in the reader's own
 * calendar (an evening move west of UTC is still today, not tomorrow's UTC
 * date), and the table counts only rows that left "saved".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  updates: [] as Array<{ table: string; patch: Row }>,
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined, success: () => undefined }) }));
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<[string, boolean]> = [];
    let from = 0; let to = Infinity; let limit = Infinity; let count = false;
    let patch: Row | null = null; let writing = false;
    const rows = () => [...(world.db[table] ?? [])].filter((r) => filters.every((f) => f(r))).sort((a, b) => {
      for (const [c, asc] of orders) {
        const x = String(a[c] ?? ""); const y = String(b[c] ?? "");
        if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
    const run = () => {
      if (patch) { world.updates.push({ table, patch }); return { data: null, error: null }; }
      if (writing) return { data: null, error: null };
      const all = rows();
      return { data: all.slice(from, Math.min(to + 1, from + limit)), error: null, count: count ? all.length : null };
    };
    const impl: Record<string, (...a: unknown[]) => unknown> = {
      select: (_c?: unknown, o?: unknown) => { if ((o as { count?: string } | undefined)?.count) count = true; return chain; },
      eq: (c, v) => { filters.push((r) => !((c as string) in r) || r[c as string] === v); return chain; },
      not: (c, op, v) => { if (op === "is" && v === null) filters.push((r) => r[c as string] != null); return chain; },
      is: (c, v) => { if (v === null) filters.push((r) => r[c as string] == null); return chain; },
      order: (c, o) => { orders.push([c as string, (o as { ascending?: boolean } | undefined)?.ascending !== false]); return chain; },
      limit: (n) => { limit = n as number; return chain; },
      range: (a, b) => { from = a as number; to = b as number; return chain; },
      update: (p) => { patch = p as Row; return chain; },
      insert: () => { writing = true; return chain; },
      upsert: () => { writing = true; return chain; },
      delete: () => { writing = true; return chain; },
      maybeSingle: async () => ({ data: writing || patch ? null : rows()[0] ?? null, error: null }),
      single: async () => ({ data: writing || patch ? null : rows()[0] ?? null, error: null }),
    };
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_t, p) => {
        if (p === "then") return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad);
        if (typeof p === "string" && p in impl) return impl[p];
        return () => chain;
      },
    });
    return chain;
  };
  return {
    supabase: {
      from: (t: string) => query(t),
      rpc: async () => ({ data: null, error: null }),
      functions: {
        invoke: async (fn: string) => (fn === "get-account-data"
          ? { data: { credits: 0, purchases: [], passes: [], orders: [], mailboxProven: true }, error: null }
          : { data: null, error: null }),
      },
      auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});
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
vi.mock("@/components/account/ClosedReplacementsPanel", () => ({ ClosedReplacementsPanel: () => null }));
vi.mock("@/components/account/LocalHistoryOffer", () => ({ LocalHistoryOffer: () => null }));

import Account from "../pages/Account";

vi.setConfig(MOUNT_TEST_BUDGET);

/**
 * A moment whose calendar day here differs from its UTC day wherever the
 * machine's zone allows it: 00:10 UTC west of Greenwich is still the evening
 * before, 23:50 UTC east of it is already the next morning. A UTC machine has
 * no such moment, and the two days then agree.
 */
function momentAcrossMidnight(): Date {
  const west = new Date(Date.UTC(2026, 10, 21, 0, 10));
  if (west.getTimezoneOffset() > 10) return west;
  const east = new Date(Date.UTC(2026, 10, 20, 23, 50));
  if (east.getTimezoneOffset() < -10) return east;
  return new Date(Date.UTC(2026, 10, 20, 12, 0));
}
const readerDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const DAY = 86_400_000;
let NOW: Date;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();

const mount = async () => {
  const view = render(<MemoryRouter><Account /></MemoryRouter>);
  await act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
  return view;
};
const statusWrites = () => world.updates.filter((u) => u.table === "user_applications" && "status" in u.patch);
/** The number on the stat tile whose label is `label`. */
const tile = (label: string) => {
  const p = [...document.querySelectorAll("p")].find((x) => x.textContent === label);
  return p?.previousElementSibling?.textContent ?? null;
};

beforeEach(() => {
  NOW = momentAcrossMidnight();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  world.db = {
    user_scans: [{
      id: "v1", ats_score: 72, projected_score: null, industry: "nursing", verdict: null, red_flag_count: 0,
      fix_plan: null, label: "Ward CV", created_at: ago(40), resume_text: null, report_id: null,
    }],
    user_profiles: [],
    user_applications: [{
      id: "s1", company: "St Mary's", role: "Staff Nurse", status: "saved", scan_id: "v1", scan_score: 72,
      created_at: ago(30), applied_at: ago(30).slice(0, 10), job_id: null, posting_closed_at: null,
    }],
  };
  world.updates = [];
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("S11-095: a saved job moved on is dated the day it moved", () => {
  it("Advance to Applied writes applied_at as the reader's own day, and the week counts it", async () => {
    const today = readerDay(NOW);
    if (NOW.getTimezoneOffset() !== 0) expect(today, "the moment must sit across midnight here").not.toBe(NOW.toISOString().slice(0, 10));
    await mount();
    const advance = await screen.findByTitle(en.accountPage.advanceTip.replace("{{stage}}", en.accountPage.status.applied));
    expect(tile(en.accountPage.statWeek)).toBe("0");
    fireEvent.click(advance);
    await waitFor(() => expect(statusWrites().length).toBeGreaterThan(0));
    const patch = statusWrites()[0].patch;
    expect(patch.status).toBe("applied");
    expect(patch.applied_at).toBe(today);
    await waitFor(() => expect(tile(en.accountPage.statWeek)).toBe("1"));
  });

  it("a row already past saved keeps the date it was applied on when it moves again", async () => {
    const row = world.db.user_applications[0];
    row.status = "applied";
    row.applied_at = ago(12).slice(0, 10);
    await mount();
    const advance = await screen.findByTitle(en.accountPage.advanceTip.replace("{{stage}}", en.accountPage.status.interviewing));
    fireEvent.click(advance);
    await waitFor(() => expect(statusWrites().length).toBeGreaterThan(0));
    expect(statusWrites()[0].patch.status).toBe("interviewing");
    expect("applied_at" in statusWrites()[0].patch).toBe(false);
  });
});

describe("S11-095: the 'which resume gets interviews' table counts only rows that were sent", () => {
  const sentCells = () => [...document.querySelectorAll("span")].map((s) => s.textContent ?? "").filter((t) => /^\d+ sent$/.test(t));

  it("a saved row naming the version is not counted as sent", async () => {
    world.db.user_applications.push({
      id: "a1", company: "City Hospital", role: "Staff Nurse", status: "applied", scan_id: "v1", scan_score: 72,
      created_at: ago(20), applied_at: ago(20).slice(0, 10), job_id: null, posting_closed_at: null,
    });
    await mount();
    await waitFor(() => expect(sentCells().length).toBe(1));
    expect(sentCells()).toEqual([en.accountPage.versionSentCount.replace("{{n}}", "1")]);
  });

  it("a version named only by saved rows has no row in the table", async () => {
    await mount();
    await screen.findByTitle(en.accountPage.advanceTip.replace("{{stage}}", en.accountPage.status.applied));
    expect(sentCells()).toEqual([]);
  });
});
