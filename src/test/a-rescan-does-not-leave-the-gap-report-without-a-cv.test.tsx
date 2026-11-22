/**
 * A RESCAN DOES NOT LEAVE THE GAP REPORT WITHOUT A CV (S10-066).
 *
 * WHAT WAS WRONG. The homepage stores a scan with no résumé text (its insert
 * names the score, the verdict and the fix plan only). With no matching
 * résumé pinned, /account's gap report, the morning queue and the apply
 * copilot all fell back to the NEWEST scan's text, so a person who saved a
 * version and then rescanned on the homepage had no CV in any of them: no
 * gaps measured, no résumé for the queue, nothing for the copilot to tailor.
 * The morning queue's own read (on /agent, where no résumé is handed down)
 * asked for the newest scan the same way.
 *
 * WHAT HOLDS NOW, mounted with the database faked: the page reads the newest
 * scan that holds its text, the gap report measures the tracked postings
 * against it, and the queue's own read asks for a scan with text. A pinned
 * résumé still wins, and a newest scan that does hold its text is still the
 * one used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  fitBodies: [] as Array<Record<string, unknown>>,
  access: null as unknown,
  realQueue: false,
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined, success: () => undefined }) }));
vi.mock("@/integrations/supabase/client", () => {
  // A table that answers the way PostgREST would: filters, order, limit and
  // range are applied, so a read that asks for the wrong row gets it.
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
        invoke: async (fn: string, opts?: { body?: Record<string, unknown> }) => {
          if (fn === "get-account-data") return { data: { credits: 0, purchases: [], passes: [], orders: [], mailboxProven: true }, error: null };
          if (fn === "application-fit") {
            world.fitBodies.push(opts?.body ?? {});
            return { data: { success: true, data: { pct: 40, missing: ["kubernetes", "terraform"] } }, error: null };
          }
          if (fn === "agent-access") return { data: world.access, error: null };
          return { data: null, error: null };
        },
      },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
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
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true }) }));
// The queue's own read is judged on the panel with its controls showing, as
// the agent suites load it (the agent is switched off in the shipped build).
vi.mock("../../supabase/functions/_shared/apply-agent-switch", () => ({ APPLY_AGENT_ON: true, AGENT_PRODUCTS_ON_SALE: true, APPLY_ASSISTANT_ON_SALE: false }));
vi.mock("@/pages/Jobs", async () => ({ FILL_RATE_MIN_TRACKING_DAYS: (await import("@/lib/hiring-record-gate")).FILL_RATE_MIN_TRACKING_DAYS }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/ProSubscriptionCard", () => ({ ProSubscriptionCard: () => null }));
vi.mock("@/components/account/SavedSearchesCard", () => ({ SavedSearchesCard: () => null }));
vi.mock("@/components/account/ApplyKitPanel", () => ({ ApplyKitPanel: () => null }));
vi.mock("@/components/account/ApplyProfilePanel", () => ({ ApplyProfilePanel: () => null }));
vi.mock("@/components/account/PendingQuestionsPanel", () => ({ PendingQuestionsPanel: () => null }));
vi.mock("@/components/account/ApplyQueuePanel", () => ({ ApplyQueuePanel: () => null }));
vi.mock("@/components/account/AccountNav", () => ({ AccountNav: () => null }));
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
// What each of the three is handed, read off the page.
vi.mock("@/components/account/GapReport", () => ({
  GapReport: ({ resumeText }: { resumeText: string | null }) => <div data-gap-resume={resumeText ?? ""} />,
}));
vi.mock("@/components/account/ApplyCopilotPanel", () => ({
  ApplyCopilotPanel: ({ apps, resumeFor }: { apps: Row[]; resumeFor: (a: Row) => string | null }) => (
    <div data-copilot-resume={apps.length ? resumeFor(apps[0]) ?? "" : "no-apps"} />
  ),
}));
vi.mock("@/components/account/MorningQueuePanel", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/account/MorningQueuePanel")>();
  const Real = real.MorningQueuePanel;
  return {
    ...real,
    MorningQueuePanel: (p: Parameters<typeof Real>[0]) => (world.realQueue
      ? <Real {...p} />
      : <div data-morning-resume={p.defaultResume ?? ""} />),
  };
});

import Account from "../pages/Account";
import { MorningQueuePanel } from "@/components/account/MorningQueuePanel";

vi.setConfig(MOUNT_TEST_BUDGET);

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const SAVED_VERSION = "Senior data engineer. Python, SQL, Airflow, dbt and Spark on AWS. Built the batch and streaming pipelines for a payments company and led a team of four engineers. ".repeat(2);
const NEWER_VERSION = "Data engineer, now with Kubernetes and Terraform as well: Python, SQL, Airflow, dbt and Spark on AWS, batch and streaming pipelines for a payments company. ".repeat(2);
const PINNED = "Staff data engineer, the résumé this person pinned for matching: Python, SQL, Kafka, Flink, Kubernetes and Terraform across three clouds, with on-call ownership. ".repeat(2);
const POSTING = "We are hiring a data engineer to build pipelines with Kubernetes, Terraform, Python and SQL on AWS. You will own ingestion, modelling and the warehouse end to end. ".repeat(2);

const scan = (id: string, daysAgo: number, resume_text: string | null) => ({
  id, ats_score: 70, projected_score: null, industry: "technology", verdict: null, red_flag_count: 0,
  fix_plan: null, label: null, created_at: ago(daysAgo), resume_text, report_id: null,
});
const tracked = (id: string) => ({
  id, company: `Co ${id}`, role: "Data Engineer", status: "applied", scan_id: null, scan_score: null,
  applied_at: ago(5).slice(0, 10), created_at: ago(5), job_posting: POSTING, fit_pct: null, fit_missing: null,
  job_id: null, posting_closed_at: null,
});

const mount = async () => {
  const view = render(<MemoryRouter><Account /></MemoryRouter>);
  await act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
  return view;
};
const attr = (name: string) => document.querySelector(`[${name}]`)?.getAttribute(name);

beforeEach(() => {
  world.db = {
    // The homepage rescan is the newest row and holds no text; the version the
    // person saved is older and does.
    user_scans: [scan("rescan", 1, null), scan("saved-version", 9, SAVED_VERSION)],
    user_applications: [tracked("a1"), tracked("a2"), tracked("a3")],
    user_profiles: [],
  };
  world.fitBodies = [];
  world.access = null;
  world.realQueue = false;
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("S10-066: with nothing pinned, the account reads the newest scan that holds its text", () => {
  it("a rescan with no text leaves the gap report, the morning queue and the copilot the saved version", async () => {
    await mount();
    // The gap report measured the tracked postings against the saved version.
    await waitFor(() => expect(world.fitBodies.length).toBeGreaterThan(0));
    expect(world.fitBodies.map((b) => b.resumeText)).toEqual(world.fitBodies.map(() => SAVED_VERSION));
    await waitFor(() => expect(attr("data-gap-resume")).toBe(SAVED_VERSION));
    expect(attr("data-morning-resume")).toBe(SAVED_VERSION);
    expect(attr("data-copilot-resume")).toBe(SAVED_VERSION);
  });

  it("positive control: a newest scan that holds its text is the one read", async () => {
    world.db.user_scans = [scan("rescan", 1, NEWER_VERSION), scan("saved-version", 9, SAVED_VERSION)];
    await mount();
    await waitFor(() => expect(attr("data-gap-resume")).toBe(NEWER_VERSION));
    expect(new Set(world.fitBodies.map((b) => b.resumeText))).toEqual(new Set([NEWER_VERSION]));
    expect(attr("data-morning-resume")).toBe(NEWER_VERSION);
    expect(attr("data-copilot-resume")).toBe(NEWER_VERSION);
  });

  it("a pinned résumé still wins over every scan", async () => {
    world.db.user_profiles = [{ user_id: "u1", target_score: null, matching_scan_id: null, matching_resume_text: PINNED }];
    await mount();
    await waitFor(() => expect(attr("data-gap-resume")).toBe(PINNED));
    expect(attr("data-morning-resume")).toBe(PINNED);
    expect(attr("data-copilot-resume")).toBe(PINNED);
  });
});

describe("S10-066: the morning queue's own read asks for a scan that holds its text", () => {
  it("handed no résumé, the queue finds the saved version under a newer rescan and can start", async () => {
    world.realQueue = true;
    world.access = { active: true, tier: "pass", status: "pass", pass: { state: "live", usable: true, applicationsLeft: 7 } };
    render(<MemoryRouter><MorningQueuePanel userId="u1" email="u@example.com" defaultResume={null} /></MemoryRouter>);
    const activate = await screen.findByRole("button", { name: /Activate mandate/ });
    await waitFor(() => expect(activate).not.toBeDisabled());
  });

  it("positive control: with no scan holding text anywhere, it still cannot start", async () => {
    world.realQueue = true;
    world.db.user_scans = [scan("rescan", 1, null), scan("older-rescan", 9, null)];
    world.access = { active: true, tier: "pass", status: "pass", pass: { state: "live", usable: true, applicationsLeft: 7 } };
    render(<MemoryRouter><MorningQueuePanel userId="u1" email="u@example.com" defaultResume={null} /></MemoryRouter>);
    const activate = await screen.findByRole("button", { name: /Activate mandate/ });
    await act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
    expect(activate).toBeDisabled();
  });
});
