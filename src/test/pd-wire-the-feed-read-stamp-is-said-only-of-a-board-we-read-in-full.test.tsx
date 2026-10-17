/**
 * THE FEED-READ STAMP IS SAID ONLY OF A BOARD WE READ IN FULL (Track 1, A3,
 * carried through pass B).
 *
 * The card's "Greenhouse · feed read 4 min ago" and the pane's "Employer's
 * feed read 4 min ago" date the last read of the employer's whole feed, and
 * the pane's screen-reader sentence says that read covers the whole board.
 * On a board read in laps (lap_proven, lap_pending, unprovable) no single
 * read reaches every posting, so that sentence would be false. Pass B moved
 * the card and the pane to the listing vocabulary (JobCard, PostingDetail,
 * LiveStatus); the board now hands them a read time only where the shared
 * gate's feedReadStatable passes, and marks a lap-read board partialRead so
 * the pane says "We could read only part of this board" instead.
 *
 * Behavioural: two boards on one page, one read in full and one read in
 * laps, each row carrying a fresh recheckedAt from the job board.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const DAY = 86_400_000;
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const job = (token: string, company: string, title: string) => ({
  id: `greenhouse:${token}:1`, source: "greenhouse", token, company,
  title, location: "New York, NY, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3,
  category: "engineering", department: null, agency: false,
  postedAt: ago(2 * DAY), lastSeen: ago(2 * DAY), recheckedAt: ago(4 * MIN), applyUrl: `https://x/${token}`, remote: false,
});

const FULL = job("acme", "Acme", "Platform Engineer");
const LAPS = job("dominos", "Domino's", "Delivery Driver");

const curve = (token: string, bucket: string) => ({
  company_token: token, open_roles: 1, fills_90d: 0, relists_90d: 0, filled_roles_90d: 0, relisted_roles_90d: 0, ageouts_90d: 0,
  n_at_risk_14: 0, fills_le_14: 0, fill_rate_14: null, still_open_14: null, median_days_to_fill: null, median_censored: true,
  dated_coverage: 1, dated_n: 1, undated_n: 0, tracking_days: 20, sufficient: false,
  observability_bucket: bucket, watched_from: "2026-09-20", multi_site_title_share: 0,
});
const BUCKET: Record<string, string> = { acme: "full_read", dominos: "lap_proven" };

function mount() {
  window.history.replaceState({}, "", "/jobs");
  const jobs = [FULL, LAPS];
  rpc.mockImplementation(async (fn: string, a?: { p_tokens?: string[] }) => {
    if (fn === "get_company_fill_curve") return { data: (a?.p_tokens ?? []).filter((t) => BUCKET[t]).map((t) => curve(t, BUCKET[t])), error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "detail") return { data: { job: jobs.find((j) => j.id === b.id) ?? jobs[0], description: "A role." } };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: jobs.length } };
      return { data: { jobs, total: jobs.length, hasMore: false, totalAllCompanies: jobs.length, companies: [], companiesCount: 2, categories: {}, failedSources: [], refreshedAt: ago(0) }, error: null };
    }
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={["/jobs"]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
      </Routes>
    </MemoryRouter>,
  );
}

const cardOf = (title: string) => Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]"))
  .find((c) => (c.textContent ?? "").includes(title)) ?? null;
const status = () => document.querySelector<HTMLElement>("[data-live-status]");

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
});

describe("the feed-read stamp is said only of a board we read in full", () => {
  it("the card of a full-read board dates its feed read, the card of a lap-read board does not", async () => {
    mount();
    await waitFor(() => expect(cardOf("Platform Engineer")?.textContent ?? "").toContain("feed read"), SLOW);
    // Both curves have answered once the full-read card carries its stamp
    // (the stamp waits on the curve), so the lap card's silence is the gate.
    expect(rpc.mock.calls.some(([fn, a]) => fn === "get_company_fill_curve" && (a as { p_tokens?: string[] })?.p_tokens?.includes("dominos"))).toBe(true);
    expect(cardOf("Delivery Driver"), "the lap-read card is on the page").not.toBeNull();
    expect(cardOf("Delivery Driver")!.textContent ?? "", "a lap-read board's card dates a read that did not reach every posting").not.toMatch(/feed read/i);
  });

  it("the pane of a lap-read board says it could read only part of the board, and never that the read covers it", async () => {
    mount();
    await waitFor(() => expect(cardOf("Platform Engineer")?.textContent ?? "").toContain("feed read"), SLOW);
    fireEvent.click(cardOf("Delivery Driver")!);
    await waitFor(() => expect(status()?.getAttribute("data-live-status")).toBe("partial"), SLOW);
    const body = document.body.textContent ?? "";
    expect(body).toContain("We could read only part of this board");
    expect(body).not.toContain("That read covers the employer's whole board");
  });

  it("the pane of a full-read board dates its feed read (the positive control)", async () => {
    mount();
    await waitFor(() => expect(cardOf("Platform Engineer")?.textContent ?? "").toContain("feed read"), SLOW);
    fireEvent.click(cardOf("Platform Engineer")!);
    await waitFor(() => expect(status()?.getAttribute("data-live-status")).toBe("read"), SLOW);
    expect(document.body.textContent ?? "").toContain("Employer's feed read");
  });
});
