/**
 * THE FIRST SCREEN OF BADGES DOES NOT WAIT FOR THE SIXTIETH EMPLOYER, AND AN
 * EMPLOYER ANSWERED ONCE IS NOT PAID FOR AGAIN WHILE THE BOARD IS OPEN
 * (sweep S12-016).
 *
 * get_company_fill_curve's cost grows with the employers asked (anon reads,
 * 2026-11-01: 1 employer 0.43 s, 13 employers 2.97 s, 38 employers 8.46 s; 53
 * employers 17.1 s cold), and the board asked for every visible employer in one
 * call: the first card's badge waited for the last employer's record. The board
 * also forgot every answer when it remounted (a card's employer page, then
 * Back), so the same employers were paid for again.
 *
 * Behavioural, with the RPC mocked: thirty employers on one page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";

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
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
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
const TOKENS = Array.from({ length: 30 }, (_, i) => `emp${String(i).padStart(2, "0")}`);
const row = (token: string, i: number) => ({
  id: `greenhouse:${token}:1`, source: "greenhouse", token, company: `Employer ${token}`, title: `Data Engineer ${i}`,
  location: "Austin, TX", country: "US", salary: null, category: "engineering",
  postedAt: ago(1 + i / 100), lastSeen: ago(0), recheckedAt: ago(0), applyUrl: `https://x/${token}`, remote: false,
});
const ROWS = TOKENS.map(row);
// A record whose roles come back more often than they stay down: the card says
// "Back or same title live", which is how the test sees a badge drawn.
const curve = (token: string) => ({
  company_token: token, open_roles: 40, fills_90d: 20, relists_90d: 30,
  filled_roles_90d: 20, relisted_roles_90d: 24, ageouts_90d: 2,
  n_at_risk_14: 60, fills_le_14: 14,
  fill_rate_14: 0.62, fill_rate_14_lo: 0.55, fill_rate_14_hi: 0.69,
  relist_rate_14: 0.10, still_open_14: 0.28, fill_rate_7: 0.30, fill_rate_30: 0.80,
  median_days_to_fill: 11, median_censored: false,
  dated_coverage: 0.80, dated_n: 40, undated_n: 10,
  fill_through: 0.70, churn: 0.26, absorption: 0.10, tracking_days: 90, sufficient: true,
  observability_bucket: "full_read", watched_from: "2026-08-01", multi_site_title_share: 0,
});

const curveCalls = () => rpc.mock.calls.filter(([fn]) => fn === "get_company_fill_curve").map(([, a]) => (a as { p_tokens: string[] }).p_tokens);
const card = (token: string) => document.querySelector(`[data-job-id="greenhouse:${token}:1"]`)?.textContent ?? "";

function arrangeBoard() {
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      if (b.countOnly) return { data: { total: ROWS.length }, error: null };
      return { data: { jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: ROWS.length, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    return { data: {}, error: null };
  });
}
const mount = () => {
  window.history.replaceState({}, "", "/jobs");
  return render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
};
// The board's routes as the app declares them: one wrapper across the three.
const mountBrowser = () => {
  window.history.replaceState(null, "", "/jobs");
  return render(
    <BrowserRouter>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/field/:category" element={<Jobs />} />
        <Route path="/jobs/company/:companyToken" element={<Jobs />} />
      </Routes>
    </BrowserRouter>,
  );
};
const h1 = () => document.querySelector("h1")?.textContent?.trim() ?? "";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
  clearBoardBudgetRefusal();
  setLanderManifestForTests("*");
  arrangeBoard();
});

describe("the board's hiring badges", () => {
  it("asks first for the first screen's employers, in screen order, and draws their badges while the rest are still being read", async () => {
    let releaseRest: (() => void) | null = null;
    rpc.mockImplementation(async (fn: string, a: { p_tokens: string[] }) => {
      if (fn !== "get_company_fill_curve") return { data: [], error: null };
      const answer = { data: a.p_tokens.map(curve), error: null };
      if (curveCalls().length === 1) return answer;
      return new Promise((ok) => { releaseRest = () => ok(answer); });
    });
    mount();
    await waitFor(() => expect(curveCalls().length).toBeGreaterThan(0), SLOW);
    expect(curveCalls()[0], "the first call asked for every employer on the page at once").toEqual(TOKENS.slice(0, 12));
    await waitFor(() => expect(card("emp00")).toContain("Back or same title live"), SLOW);
    expect(card("emp29"), "the rest have not answered yet").not.toContain("Back or same title live");
    await waitFor(() => expect(curveCalls().length).toBe(2), SLOW);
    expect(curveCalls()[1]).toEqual(TOKENS.slice(12));
    releaseRest!();
    await waitFor(() => expect(card("emp29")).toContain("Back or same title live"), SLOW);
  });

  it("does not ask again, on a board page it remounts for and on Back, for employers it was answered for", async () => {
    rpc.mockImplementation(async (fn: string, a: { p_tokens: string[] }) =>
      fn === "get_company_fill_curve" ? { data: a.p_tokens.map(curve), error: null } : { data: [], error: null });
    mountBrowser();
    await waitFor(() => expect(card("emp29")).toContain("Back or same title live"), SLOW);
    expect(curveCalls().flat().length).toBe(30);
    const asked = curveCalls().length;
    // A card's employer link: another board page, so the board remounts.
    await act(async () => { fireEvent.click(screen.getAllByRole("link", { name: "Employer emp05" })[0]); });
    await waitFor(() => expect(window.location.pathname).toBe("/jobs/company/emp05"), SLOW);
    await waitFor(() => expect(h1()).toMatch(/emp05/), SLOW);
    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 300)); });
    await waitFor(() => expect(window.location.pathname).toBe("/jobs"), SLOW);
    await waitFor(() => expect(card("emp29")).toContain("Back or same title live"), SLOW);
    // The employer page's own record always asks (it states when it was
    // counted); no board page asked for an employer it was answered for.
    const after = curveCalls().slice(asked).filter((t) => !(t.length === 1 && t[0] === "emp05"));
    expect(after, "a remounted board asked again for employers it had been answered for").toEqual([]);
  });

  it("control: a board opened afresh asks again", async () => {
    rpc.mockImplementation(async (fn: string, a: { p_tokens: string[] }) =>
      fn === "get_company_fill_curve" ? { data: a.p_tokens.map(curve), error: null } : { data: [], error: null });
    mount();
    await waitFor(() => expect(card("emp29")).toContain("Back or same title live"), SLOW);
    cleanup();
    mount();
    await waitFor(() => expect(curveCalls().flat().length).toBe(60), SLOW);
  });
});

describe("the memo", () => {
  it("keeps an answer for twenty minutes, keeps an employer asked with no row as asked, and is capped", async () => {
    const m = await import("@/lib/board-curve-memo");
    const memo = new Map() as import("@/lib/board-curve-memo").CurveMemo;
    const t0 = 1_800_000_000_000;
    m.rememberCurves(memo, ["a", "b"], [curve("a"), curve("zz")], t0);
    const hit = m.cachedCurves(memo, ["a", "b", "zz"], t0 + 60_000);
    expect(hit.get("a")?.company_token).toBe("a");
    expect(hit.has("b") && hit.get("b") === null, "an employer asked with no row is kept as asked").toBe(true);
    expect(hit.has("zz"), "a row the call did not ask for is not kept").toBe(false);
    expect(m.cachedCurves(memo, ["a"], t0 + m.CURVE_MEMO_TTL_MS).size, "an answer as old as the TTL is asked again").toBe(0);
    m.rememberCurves(memo, Array.from({ length: 700 }, (_, i) => `t${i}`), [], t0 + 1);
    expect(memo.size).toBe(m.CURVE_MEMO_CAP);
    expect(memo.has("t699") && !memo.has("t0"), "the cap drops the oldest").toBe(true);
    expect(m.curveChunks(TOKENS).map((c) => c.length)).toEqual([12, 18]);
    expect(m.curveChunks(Array.from({ length: 61 }, (_, i) => `x${i}`)).map((c) => c.length)).toEqual([12, 24, 24, 1]);
    expect(m.curveChunks([])).toEqual([]);
  });
});
