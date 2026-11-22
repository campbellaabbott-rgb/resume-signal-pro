/**
 * THE TRACKER COUNTS EVERY APPLICATION AND REACHES THE OLD ONES (S10-069).
 *
 * WHAT WAS WRONG. /account read the newest 100 user_applications rows, with
 * no count and no paging, and every number it printed was the length of
 * that page. Someone tracking 150 applications read "100 tracked", and the
 * oldest fifty (often the interviews and offers that came from early
 * applications) could not be reached from the page at all.
 *
 * WHAT HOLDS NOW, mounted with the database faked (a table that honours
 * order, limit, range and the count option, as PostgREST does): the header
 * and the "All" lane say the exact count, and "Load older applications"
 * brings the next page until every row is on the page, each once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import accountEn from "../i18n/shards/account/en.json";

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  reads: [] as Array<{ table: string; from: number; to: number; limit: number; count: boolean }>,
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined, success: () => undefined }) }));
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<[string, boolean]> = [];
    let from = 0; let to = Infinity; let limit = Infinity; let count = false; let writing = false;
    const rows = () => [...(world.db[table] ?? [])].filter((r) => filters.every((f) => f(r))).sort((a, b) => {
      for (const [c, asc] of orders) {
        const x = String(a[c] ?? ""); const y = String(b[c] ?? "");
        if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
    const run = () => {
      if (writing) return { data: null, error: null };
      world.reads.push({ table, from, to, limit, count });
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
      update: () => { writing = true; return chain; },
      insert: () => { writing = true; return chain; },
      upsert: () => { writing = true; return chain; },
      delete: () => { writing = true; return chain; },
      maybeSingle: async () => ({ data: writing ? null : rows()[0] ?? null, error: null }),
      single: async () => ({ data: writing ? null : rows()[0] ?? null, error: null }),
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

const T0 = Date.parse("2026-11-20T12:00:00Z");
/** Row n of `total`: row 1 is the newest, row `total` the oldest. */
const application = (n: number) => ({
  id: `app-${String(n).padStart(4, "0")}`, company: `Employer ${n}`, role: `Role ${n}`,
  status: n === 150 ? "offer" : "applied", scan_id: null, scan_score: null,
  created_at: new Date(T0 - n * 3_600_000).toISOString(),
  applied_at: new Date(T0 - n * 3_600_000).toISOString().slice(0, 10),
  job_id: null, posting_closed_at: null,
});
const rowsOf = (total: number) => Array.from({ length: total }, (_, i) => application(i + 1));

const mount = async () => {
  const view = render(<MemoryRouter><Account /></MemoryRouter>);
  await act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
  return view;
};
const pageText = () => document.body.textContent ?? "";
/** The employers on the tracker's rows, in page order. */
const shownEmployers = () => [...document.querySelectorAll("p")]
  .map((p) => /^Employer (\d+) · Role \1$/.exec(p.textContent ?? "")?.[1])
  .filter((n): n is string => !!n);

beforeEach(() => {
  world.db = { user_scans: [], user_profiles: [], user_applications: rowsOf(150) };
  world.reads = [];
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("S10-069: the tracker counts every application", () => {
  it("150 tracked rows read as 150, in the header and the All lane, though one page holds 100", async () => {
    await mount();
    await waitFor(() => expect(shownEmployers().length).toBe(100));
    expect(pageText()).toContain("150 tracked");
    expect(pageText()).not.toContain("100 tracked");
    const all = screen.getByRole("button", { name: /^All\s*150$/ });
    expect(all).toBeTruthy();
    // The read asked for the count, and for a page rather than everything.
    const read = world.reads.find((r) => r.table === "user_applications")!;
    expect(read.count).toBe(true);
    expect(Math.min(read.to + 1, read.limit)).toBe(100);
  });

  it("Load older applications reaches row 150, the oldest, with every row on the page once", async () => {
    await mount();
    await waitFor(() => expect(shownEmployers().length).toBe(100));
    expect(shownEmployers()).not.toContain("150");
    fireEvent.click(screen.getByRole("button", { name: accountEn.accountView.trackerLoadMore }));
    await waitFor(() => expect(shownEmployers()).toContain("150"));
    const shown = shownEmployers();
    expect(shown).toHaveLength(150);
    expect(new Set(shown).size).toBe(150);
    // Every row is on the page: nothing more to load.
    expect(screen.queryByRole("button", { name: accountEn.accountView.trackerLoadMore })).toBeNull();
    expect(pageText()).toContain("150 tracked");
  });

  it("positive control: a tracker that fits one page offers nothing more to load", async () => {
    world.db.user_applications = rowsOf(40);
    await mount();
    await waitFor(() => expect(shownEmployers().length).toBe(40));
    expect(pageText()).toContain("40 tracked");
    expect(screen.queryByRole("button", { name: accountEn.accountView.trackerLoadMore })).toBeNull();
  });
});
