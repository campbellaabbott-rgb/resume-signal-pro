/**
 * THE EXPLORE PAGE RENDERS THE SAME FROM THE SLIMMER CACHE.
 *
 * 20261109110000 stops refresh_explore_cache writing field_curves,
 * chip_coverage, role_rows and the denominators behind totals. The frontend
 * publishes the moment its branch merges, before the migration is pasted, so
 * for a while production serves TODAY's row to the page and afterwards the
 * NEW one. The page must not be able to tell them apart.
 *
 * Mounted twice with the board's own facet and the same field grid -- once
 * from a row shaped like production's on 2026-11-08 (every retired key
 * present, each carrying a figure no other part of the page could print) and
 * once from the row the new writer produces -- with the finance field open so
 * the chips' coverage sentence, the one reader of field_grid, is on screen.
 * The two renders must be identical, and no figure from a retired key may
 * appear in either. The same holds when today's writer names the retired
 * parts in stale_parts: the page raises no staleness line for a part it does
 * not render, and the new writer never names them at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

const rpc = vi.fn();
const invoke = vi.fn(
  async (_fn: string, _opts?: { body?: Record<string, unknown> }) => ({ data: null, error: null } as unknown),
);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...(a as Parameters<typeof invoke>)) },
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
import Explore from "../pages/Explore";

const FACET: Record<string, number> = { operations: 144_664, healthcare: 109_811, finance: 33_922, design: 4_181 };
const REFRESHED_AT = "2026-11-08T16:56:24.605Z";
const GRID_AT = "2026-11-08T17:07:00Z";
const FINANCE_ROW = { n: 33_910, work_mode_n: 10_350, stated_pay_n: 8_032, pay_text_n: 8_138, pay_floor_n: 8_031, experience_n: 19_745, employment_type_n: 7_636 };
const DESIGN_ROW = { n: 4_176, work_mode_n: 1_592, stated_pay_n: 1_033, pay_text_n: 1_040, pay_floor_n: 1_033, experience_n: 2_888, employment_type_n: 1_265 };
const GRID = { at: GRID_AT, window_days: 30, fields: { finance: FINANCE_ROW, design: DESIGN_ROW } };
const REPOST = { acme: { n: 3 }, globex: { n: 5 } };

/** The row the new writer produces. */
const NEW_ROW = {
  field_grid: GRID, repost_index: REPOST, fields: { finance: 33_910, design: 4_176 },
  totals: { repost_flagged_n: 2 }, stale_parts: [] as string[], computed_at: GRID_AT,
};
/** Figures only a retired key carries. Any of them on screen is a reader the migration would blank. */
const RETIRED_FIGURES = ["987,654", "987654", "43.21", "0.4321", "Zebra Wrangler", "77,777", "0.613"];
/** Today's row: the same read parts, plus every key the new writer drops. */
const LIVE_ROW = {
  ...NEW_ROW,
  field_curves: { finance: { still_open_30: 0.4321, gate_share_30: 0.613, sufficient_30: true, dated_cohort_n_30: 77_777 } },
  chip_coverage: { open: 987_654, workMode: 0.4321 },
  role_rows: { fields: { finance: [{ role: "Zebra Wrangler", n: 77_777 }] }, at: "2026-11-08T12:22:00Z", status: "ok" },
  fields: { finance: 33_910, design: 4_176 },
  totals: { postings_n: 987_654, postings_pay_n: 77_777, repost_flagged_n: 2 },
};

const wire = (cache: Record<string, unknown>) => {
  invoke.mockImplementation(async (_fn: string, o?: { body?: Record<string, unknown> }) => {
    const b = (o?.body ?? {}) as Record<string, unknown>;
    if (b.action === "facets") return { data: { jobs: [], categories: { ...FACET }, refreshedAt: REFRESHED_AT }, error: null };
    if (b.limit === 60) return { data: { total: 0, jobs: [] }, error: null };
    return { data: { total: 5_000, filterCoverage: { workMode: 0.231 } }, error: null };
  });
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_explore_cache") return { data: cache, error: null };
    return { data: [], error: null };
  });
};

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  window.history.replaceState({}, "", "/explore");
});
afterEach(() => { cleanup(); vi.clearAllMocks(); document.body.innerHTML = ""; });

const tileButton = (id: string) => document.getElementById(`field-${id}`)?.querySelector("button[aria-expanded]") as HTMLButtonElement | null;
const panel = () => document.querySelector<HTMLElement>('[data-panel="field"]');
/** React's generated ids differ between two mounts in one process; nothing else may. */
const normalised = () => document.body.innerHTML
  .replace(/«[^»]*»/g, "«id»")
  .replace(/:r[0-9a-z]+:/g, ":id:")
  .replace(/_r_[0-9a-z]+_/g, "_id_");

/** Mount from one cache row, open finance, wait for the grid's sentence, and return what is on screen. */
async function renderFrom(cache: Record<string, unknown>): Promise<{ html: string; text: string; cacheReads: number }> {
  wire(cache);
  render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
  await waitFor(() => expect(tileButton("finance")).toBeTruthy());
  act(() => { tileButton("finance")!.click(); });
  await waitFor(() => expect(panel()).toBeTruthy());
  // work mode 10,350 / 33,910 rounds to 31: the field grid reached the screen.
  await waitFor(() => expect(panel()!.textContent).toContain("31%"));
  const out = {
    html: normalised(),
    text: document.body.textContent ?? "",
    cacheReads: rpc.mock.calls.filter((c) => c[0] === "get_explore_cache").length,
  };
  cleanup();
  document.body.innerHTML = "";
  invoke.mockReset();
  rpc.mockReset();
  window.history.replaceState({}, "", "/explore");
  return out;
}

describe("the page cannot tell today's explore row from the new writer's", () => {
  it("renders byte-identically from both, with the field grid on screen", async () => {
    const live = await renderFrom(LIVE_ROW);
    const next = await renderFrom(NEW_ROW);
    expect(live.cacheReads).toBe(1);
    expect(next.cacheReads).toBe(1);
    expect(next.text).toBe(live.text);
    expect(next.html).toBe(live.html);
  });

  it("no figure carried only by a retired key reaches the screen from today's row", async () => {
    const live = await renderFrom(LIVE_ROW);
    for (const f of RETIRED_FIGURES) expect(live.text, `${f} came from a key the migration drops`).not.toContain(f);
  });

  it("today's writer naming the retired parts stale raises nothing the new writer's row does not", async () => {
    const live = await renderFrom({ ...LIVE_ROW, stale_parts: ["field_curves", "chip_coverage", "role_rows", "fields", "totals"] });
    const next = await renderFrom(NEW_ROW);
    expect(live.text).not.toMatch(/could not be recomputed/);
    expect(next.html).toBe(live.html);
  });

  it("a part the page does read still raises its line from either row (the comparison can see a difference)", async () => {
    const live = await renderFrom({ ...LIVE_ROW, stale_parts: ["repost_index"] });
    const next = await renderFrom(NEW_ROW);
    expect(live.text).toMatch(/could not be recomputed/);
    expect(next.html).not.toBe(live.html);
  });
});
