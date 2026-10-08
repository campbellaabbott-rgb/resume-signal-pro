// A CARD PRAISED AN EMPLOYER WHOSE DETAIL PANE WARNED THAT ITS ROLES CAME BACK.
//
// 20261008110000 gave the board role counts: filled_roles_90d (roles that came
// down and stayed down) and relisted_roles_90d (roles that came back -- closed
// twice, superseded, or served again). The posting's verdict block, the
// compare drawer and the Account chip moved to them. The card's one employer
// slot did not finish the move: its caution still read relists_90d (same-title
// re-list EVENTS) and its "Fills fast" branch asked only for three filled
// roles, trusting arithmetic that held only while both sides counted events.
//
// So an employer with 5 roles down, 20 back and a single same-title re-list
// event got "Fills fast" on its card while its detail pane, one click away,
// said "Apply with expectations -- re-lists roles often (at least 20x)". The
// slot's own rule is that a caution takes it from praise.
//
// Behavioural, with the board mocked: the card and the pane are rendered from
// the same RPC row and must say the same thing about the employer.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

import Jobs, { relistCaution, hiringRecordVerdict } from "../pages/Jobs";

const SLOW = { timeout: 4000 } as const;
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const row = (token: string, company: string, n: number) => ({
  id: `greenhouse:${token}:${n}`, source: "greenhouse", token, company,
  title: `${company} Engineer`, location: "Austin, TX, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: null, employmentType: null, experienceBand: null, minYears: null,
  category: "engineering", department: null,
  postedAt: ago(2), lastSeen: ago(2), recheckedAt: ago(0), applyUrl: `https://x/${n}`, remote: false,
});
const ROWS = [row("churny", "Churny", 1), row("steady", "Steady", 2)];

// Both rows clear every rate gate (sufficient, coverage, tracking, rate >= 0.5)
// and neither has three same-title re-list EVENTS, so the old event caution is
// silent on both. They differ only in how many ROLES came back.
const curve = (token: string, filled: number, relisted: number) => ({
  company_token: token, open_roles: 40, fills_90d: filled + 1, relists_90d: 1,
  filled_roles_90d: filled, relisted_roles_90d: relisted, ageouts_90d: 2,
  n_at_risk_14: 60, fills_le_14: 14,
  fill_rate_14: 0.62, fill_rate_14_lo: 0.55, fill_rate_14_hi: 0.69,
  relist_rate_14: 0.05, still_open_14: 0.33, fill_rate_7: 0.30, fill_rate_30: 0.80,
  median_days_to_fill: 11, median_censored: false,
  dated_coverage: 0.80, dated_n: 40, undated_n: 10,
  fill_through: 0.70, churn: 0.10, absorption: 0.10, tracking_days: 90, sufficient: true,
});
const CURVE = [curve("churny", 5, 20), curve("steady", 11, 0)];

function mount(path = "/jobs") {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_company_fill_curve") return { data: CURVE, error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length,
          companies: [], companiesCount: 2, categories: {}, failedSources: [], failedCount: 0,
          refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const cardOf = (company: string) =>
  Array.from(document.querySelectorAll("[data-job-id]")).find((c) => (c.textContent ?? "").includes(company));
const panel = () => (screen.getAllByRole("dialog")[0]?.textContent ?? "");

describe("the card and the detail pane say the same thing about an employer whose roles came back", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("the caution counts roles, and an employer it fires on is never one the verdict calls a closer", () => {
    const churny = CURVE[0];
    expect(relistCaution(churny)).toBe(true);
    expect(hiringRecordVerdict(churny)).not.toBe("closes");
    expect(relistCaution(CURVE[1])).toBe(false);
    expect(relistCaution({ filled_roles_90d: 5, relisted_roles_90d: 9 }), "under ten roles back is not a pattern").toBe(false);
    expect(relistCaution({ filled_roles_90d: null, relisted_roles_90d: null }), "a row without role columns is not a caution").toBe(false);
  });

  it("the verdict moves both ways once it reads roles: 10 down and 4 back closes, where 12 re-list events did not", () => {
    // The counts get_company_fill_curve returns for a board with 10 roles down
    // once and 4 postings re-listed three times each (executed in
    // a-role-that-closed-twice-is-one-relisted-role-not-two-fills).
    expect(hiringRecordVerdict({ filled_roles_90d: 10, relisted_roles_90d: 4 })).toBe("closes");
    expect(hiringRecordVerdict({ filled_roles_90d: 10, relisted_roles_90d: 12 })).toBe("no-pattern");
  });

  it("the card of an employer with 20 roles back and 5 down carries the caution, not 'Fills fast'", async () => {
    mount();
    // The control row proves the praise branch is alive on this page.
    await waitFor(() => expect(cardOf("Steady")?.textContent ?? "").toContain("Fills fast"), SLOW);
    await waitFor(() => expect(cardOf("Churny")?.textContent ?? "").toContain("Re-lists roles often (20×+)"), SLOW);
    expect(cardOf("Churny")?.textContent ?? "", "praise beside a true warning about the same employer").not.toContain("Fills fast");
  });

  it("the detail pane for the same employer warns, so the two surfaces agree", async () => {
    mount("/jobs?job=greenhouse:churny:1");
    await waitFor(() => expect(panel()).toContain("re-lists roles often (at least 20×)"), SLOW);
    expect(panel()).toContain("Apply with expectations");
  });
});
