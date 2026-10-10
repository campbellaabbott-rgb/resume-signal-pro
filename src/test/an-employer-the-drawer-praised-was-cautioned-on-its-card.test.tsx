// AN EMPLOYER THE DRAWER PRAISED WAS CAUTIONED ON ITS CARD (S8-092).
//
// The card put "Re-lists roles often" on any employer with three same-title
// re-list EVENTS in 90 days, and that caution took the slot from praise. The
// compare drawer and the detail pane warn only on relistCaution: roles that
// came back outnumber roles that stayed down, and at least ten came back. So an
// employer with 44 re-list events and 448 roles down for good (verdict
// "closes") was cautioned on its card and praised in the drawer beside it; on
// live page 1, 9 of 11 cautioned employers had a "closes" verdict.
//
// One rule now, on every surface: the card asks relistCaution too.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const row = (token: string, company: string, title: string) => ({
  id: `greenhouse:${token}:1`, source: "greenhouse", token, company, title,
  location: "Austin, TX", country: "US", salary: null, category: "engineering",
  postedAt: ago(2), lastSeen: ago(2), recheckedAt: ago(0), applyUrl: `https://x/${token}`, remote: false,
});
const curve = (token: string, o: { relists_90d: number; filled: number; relisted: number }) => ({
  company_token: token, open_roles: 40, fills_90d: o.filled, relists_90d: o.relists_90d,
  filled_roles_90d: o.filled, relisted_roles_90d: o.relisted, ageouts_90d: 2,
  n_at_risk_14: 60, fills_le_14: 14,
  fill_rate_14: 0.62, fill_rate_14_lo: 0.55, fill_rate_14_hi: 0.69,
  relist_rate_14: 0.10, still_open_14: 0.28, fill_rate_7: 0.30, fill_rate_30: 0.80,
  median_days_to_fill: 11, median_censored: false,
  dated_coverage: 0.80, dated_n: 40, undated_n: 10,
  fill_through: 0.70, churn: 0.26, absorption: 0.10, tracking_days: 90, sufficient: true,
});
// big: re-lists 44 titles, but 448 roles came down and stayed down against 30
//      that came back: verdict "closes", and the drawer praises it.
// churny: 24 roles back against 20 down: relistCaution, on every surface.
const ROWS = [row("big", "Bigco", "Platform Engineer"), row("churny", "Churnco", "Data Engineer")];
const CURVE = [curve("big", { relists_90d: 44, filled: 448, relisted: 30 }), curve("churny", { relists_90d: 30, filled: 20, relisted: 24 })];

function mount() {
  window.history.replaceState({}, "", "/jobs");
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_company_fill_curve") return { data: CURVE, error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      if (b.countOnly) return { data: { total: ROWS.length }, error: null };
      return { data: { jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    return { data: {}, error: null };
  });
  return render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
}
const card = (company: string) =>
  Array.from(document.querySelectorAll("[data-job-id]")).find((c) => (c.textContent ?? "").includes(company))?.textContent ?? "";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
  clearBoardBudgetRefusal();
});

describe("an employer the drawer praised was cautioned on its card", () => {
  it("positive control: roles back outnumber roles down, and the card cautions", async () => {
    mount();
    await waitFor(() => expect(card("Churnco")).toContain("Re-lists roles often"), SLOW);
  });

  it("an employer whose roles stay down is not cautioned for re-list events the drawer does not count", async () => {
    mount();
    await waitFor(() => expect(card("Churnco")).toContain("Re-lists roles often"), SLOW);
    await waitFor(() => expect(card("Bigco")).toMatch(/Fills fast|Actively hiring/), SLOW);
    expect(card("Bigco"), "the card cautioned an employer whose verdict is closes").not.toContain("Re-lists roles often");
  });
});
