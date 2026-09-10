/**
 * A PERCENTAGE THAT READS THE SAME ON EVERY FIELD IS NOT A FIELD PERCENTAGE.
 *
 * The expanded panel under a field tile on /explore printed, beside every
 * narrowing chip, "stated on N%" — and N was the BOARD's coverage. The probe
 * that priced each chip came back with the server's board-wide filterCoverage
 * block (get_filter_coverage: one scan over the whole serving population, no
 * category term), and the chip printed that number beside its own
 * FIELD-scoped count. So Finance & Accounting read "Remote 2,348 stated on
 * 23%", Design read "Remote 694 stated on 23%", and every one of the eighteen
 * panels said 23%, 22%, 44% and 27% on the same four chips.
 *
 * Measured 2026-09-10 against the board's own hourly per-field scan
 * (get_explore_cache().field_grid, computed 15:07Z, stale_parts []):
 *
 *   finance  states a work mode on 30.5%   (chip said 23%)
 *            an experience level on 58.2%  (chip said 44%)
 *            an employment type on 22.5%   (chip said 27%)
 *   design   states a work mode on 38.1%   (chip said 23%)
 *            an experience level on 69.2%  (chip said 44%)
 *
 * Not false — the note above the chips said "of the board" — but mislabelled
 * by placement, in both directions, on every field. The page's own standing
 * rule at the top of Explore.tsx is that a figure identical on every tile is
 * not a tile figure; this is that rule one grain down.
 *
 * WHAT THIS FILE ASSERTS, OFF A REAL RENDER:
 *
 *   1. The share is the FIELD's, so it SEPARATES fields: finance and design
 *      print different percentages from the same fixture, and no chip carries
 *      one on its face.
 *   2. The sentence is stamped from the scan it reads, and only from that scan.
 *   3. Where there is no per-field reading — the cache failed, the field is
 *      under the grid's floor — the panel says so and prints no percentage.
 *      There is no fallback to the board-wide figure; that is how "of the
 *      board" ended up beside a field's count in the first place.
 *   4. The grid's own `n` is the tile quantity from a second scan and reaches
 *      NO tile and NO sentence — fed a wrong n, the page prints it nowhere.
 *   5. A role row prints only a title-tier count (`ranked: true`): the recency
 *      fallback and the trigram rescue tier can never price a row.
 *   6. An outage is said as ours, never as a fact about the field.
 *   7. Under a chosen role the share stays the field's and says so.
 *   8. A stale grid is disclosed inside its own sentence, not in the banner.
 *   9. Every mirrored constant is pinned to the SQL it mirrors.
 *  10. The new keys are in all nine locales, the retired ones are gone from
 *      all nine, and the literals the sentences mirror are pinned to source.
 *  11. The only percent signs in the panel are in the coverage sentence.
 *
 * TEETH: every property here was run against the pre-fix copy of Explore.tsx
 * (HEAD bbea5030) and went red — the pre-fix page prints "stated on 23%" on
 * both fields, prints rolesNone over eight failed probes, and admits an
 * unranked total onto a role row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "i18next";

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

// A NAMESPACE IMPORT, DELIBERATELY. The teeth run points this file at the
// pre-fix copy of the page, which exports neither fieldShares nor
// COVERAGE_FAMILIES; a named import of a missing export is a link error that
// fails the whole file at once, which proves nothing per property. A
// namespace import yields `undefined` and lets each property go red on its
// own.
import * as ExploreModule from "../pages/Explore";
import { searchToBoardBody } from "../lib/job-search-params";
const Explore = ExploreModule.default;
const { fieldShares, COVERAGE_FAMILIES, FIELD_ROLES, CONSTRAINT_CHIPS, COUNTRY_CHIPS } = ExploreModule;

const ROOT = resolve(__dirname, "../..");
const EXPLORE_PATH = resolve(ROOT, "src/pages/Explore.tsx");
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
const EXPLORE = strip(readFileSync(EXPLORE_PATH, "utf8"));
const MIG = resolve(ROOT, "supabase/migrations");
const latestWith = (fragment: string) => {
  const hit = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(resolve(MIG, f), "utf8"))
    .filter((t) => t.includes(fragment)).pop();
  if (!hit) throw new Error(`no migration contains: ${fragment}`);
  return hit;
};
const sqlBody = (fn: string) => {
  const t = latestWith(`CREATE OR REPLACE FUNCTION public.${fn}`).replace(/^\s*--.*$/gm, "");
  const start = t.indexOf(`FUNCTION public.${fn}`);
  return t.slice(start, t.indexOf("$$;", start));
};

// ── THE FIXTURE IS THE LIVE MEASUREMENT ─────────────────────────────────────
// The facet as the board served it on 2026-09-10 14:56Z, and the grid as the
// hourly scan wrote it at 15:07Z. The two stamps differ on purpose: the
// sentence must carry the grid's, never the facet's.
const FACET: Record<string, number> = {
  operations: 144_664, healthcare: 109_811, finance: 33_922, design: 4_181, other: 174_535,
};
const REFRESHED_AT = "2026-09-10T14:56:24.605Z";
const GRID_AT = "2026-09-10T15:07:00Z";
const FINANCE_ROW = { n: 33_910, work_mode_n: 10_350, stated_pay_n: 8_032, pay_floor_n: 8_031, experience_n: 19_745, employment_type_n: 7_636 };
const DESIGN_ROW = { n: 4_176, work_mode_n: 1_592, stated_pay_n: 1_033, pay_floor_n: 1_033, experience_n: 2_888, employment_type_n: 1_265 };
/** The board-wide block every probe carries. If any of these reaches the
 *  screen the page is printing the board's share beside a field's count. */
const BOARD_COVERAGE = { workMode: 0.231, hasStatedPay: 0.219, salaryFloor: 0.219, experience: 0.434, employmentType: 0.273, country: 0.85 };
const BOARD_STRINGS = ["23%", "22%", "43%", "27%", "85%"];

type Reply = { data: unknown; error: unknown };
type RoleReply = (name: string) => Reply;
/** The exact-title count the title tier answers for a role in finance. */
const ROLE_TOTALS: Record<string, number> = {
  accountant: 7_109, controller: 1_916, "financial analyst": 1_278, auditor: 948,
  "payroll specialist": 303, "tax accountant": 259, "accounts payable specialist": 181, bookkeeper: 123,
};
const roleTotal = (q: string) => ROLE_TOTALS[q] ?? 512;
const rankedReply: RoleReply = (name) => ({ data: { total: roleTotal(name), ranked: true, filterCoverage: BOARD_COVERAGE }, error: null });

const wire = (opts: {
  cache?: Record<string, unknown> | null;
  cacheError?: boolean;
  role?: RoleReply;
  chip?: (body: Record<string, unknown>) => Reply | null;
} = {}) => {
  const grid = { at: GRID_AT, window_days: 30, fields: { finance: FINANCE_ROW, design: DESIGN_ROW } };
  const cache = opts.cache === null ? null : { field_grid: grid, repost_index: {}, stale_parts: [], computed_at: GRID_AT, ...(opts.cache ?? {}) };
  invoke.mockImplementation(async (_fn: string, o?: { body?: Record<string, unknown> }) => {
    const b = (o?.body ?? {}) as Record<string, unknown>;
    if (b.action === "facets") return { data: { jobs: [], categories: { ...FACET }, refreshedAt: REFRESHED_AT }, error: null };
    if (b.limit === 60) return { data: { total: 0, jobs: [] }, error: null };
    // A ROLE PROBE: q alone beside the category.
    // searchToBoardBody emits every key, undefined where unset — only a key
    // with a value is a narrowing.
    const narrowing = Object.keys(b).filter((k) => b[k] !== undefined && !["action", "limit", "includeFacets", "category", "q"].includes(k));
    if (typeof b.q === "string" && narrowing.length === 0) return (opts.role ?? rankedReply)(b.q);
    const custom = opts.chip?.(b);
    if (custom) return custom;
    // A CHIP PROBE: a distinct count per patch, so a chip printing the wrong
    // query's number shows up as the wrong integer.
    let total = 5_000;
    if (b.workMode === "remote") total = 2_346;
    if (b.workMode === "onsite") total = 3_452;
    if (b.hasStatedPay === true) total = 8_050;
    if (typeof b.salaryFloor === "number") total = 3_501;
    if (b.experience === "entry") total = 5_929;
    if (b.employmentType === "full_time") total = 7_030;
    if (typeof b.maxAgeDays === "number") total = 8_832;
    if (b.sendableOnly === true) total = 6_867;
    if (b.country === "US") return { data: { total: 10_000, countCapped: true, filterCoverage: BOARD_COVERAGE }, error: null };
    if (b.country === "CA") total = 1_285;
    if (b.country === "GB") total = 1_900;
    if (b.country === "DE") total = 700;
    if (b.country === "AU") total = 650;
    if (b.country === "IN") total = 480;
    return { data: { total, ...(typeof b.q === "string" ? { ranked: true } : {}), filterCoverage: BOARD_COVERAGE }, error: null };
  });
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_explore_cache") {
      if (opts.cacheError) return { data: null, error: { message: "down" } };
      return { data: cache, error: null };
    }
    return { data: [], error: null };
  });
};

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  window.history.replaceState({}, "", "/explore");
});
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = ""; });

const mount = () => render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
const tileButton = (id: string) => document.getElementById(`field-${id}`)?.querySelector("button[aria-expanded]") as HTMLButtonElement | null;
const openField = async (id: string) => {
  await waitFor(() => expect(tileButton(id)).toBeTruthy());
  act(() => { tileButton(id)!.click(); });
  await waitFor(() => expect(panel()).toBeTruthy());
};
const closeField = async (id: string) => {
  act(() => { tileButton(id)!.click(); });
  await waitFor(() => expect(panel()).toBeNull());
};
/** The open panel, by structure. Null when no field is open. */
const panel = () => document.querySelector<HTMLElement>('[data-panel="field"]');
const panelText = () => panel()?.textContent ?? "";
const pageText = () => document.body.textContent ?? "";
const chipAnchors = () => [...(panel()?.querySelectorAll("a") ?? [])];
const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
/** The pricing probes the page sent, by body. */
const probes = () => invoke.mock.calls.map((c) => (c[1]?.body ?? {}) as Record<string, unknown>).filter((b) => b.limit === 1);

describe("1. the field percentage separates fields, and no chip carries one", () => {
  it("finance and design print different shares from one fixture, and every chip face is percent-free", async () => {
    wire();
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("31%"));
    // work_mode 10,350/33,910 → 31; pay 8,032/33,910 → 24; experience → 58;
    // employment type → 23. The board's 23/22/43/27 and 85 appear nowhere.
    for (const s of ["31%", "24%", "58%", "23%"]) expect(panelText()).toContain(s);
    expect(panelText()).toContain("Across all of Finance & Accounting");
    expect(pageText()).not.toContain("85%");
    expect(pageText()).not.toContain("43%");
    // Chips render their counts and NOTHING with a percent sign on the face.
    await waitFor(() => expect(panelText()).toContain("2,346"));
    expect(panelText()).toContain("3,452");
    expect(chipAnchors().length).toBeGreaterThan(8);
    for (const a of chipAnchors()) {
      expect(a.textContent ?? "", `a chip face carries a percentage: ${a.textContent}`).toMatch(/^[^%]*$/);
    }
    // …and the pay floor rounds to the same integer as stated pay here
    // (8,031 against 8,032), so its clause is NOT appended.
    expect(panelText()).not.toContain("currency we could price");

    await closeField("finance");
    await openField("design");
    await waitFor(() => expect(panelText()).toContain("38%"));
    for (const s of ["38%", "25%", "69%", "30%"]) expect(panelText()).toContain(s);
    expect(panelText()).toContain("Across all of Design");
    expect(panelText()).not.toContain("31%");
    expect(panelText()).not.toContain("58%");
  });

  it("the shares are a pure function of the grid row, all four or none", () => {
    expect(typeof fieldShares, "fieldShares is not exported").toBe("function");
    const grid = { at: GRID_AT, windowDays: 30, fields: { finance: FINANCE_ROW, design: DESIGN_ROW } };
    expect(fieldShares(grid, "finance")).toEqual({ workMode: 31, pay: 24, payFloor: null, experience: 58, employmentType: 23 });
    expect(fieldShares(grid, "design")).toEqual({ workMode: 38, pay: 25, payFloor: null, experience: 69, employmentType: 30 });
    // The floor's clause appears only when it rounds differently.
    const gridFloor = { ...grid, fields: { finance: { ...FINANCE_ROW, pay_floor_n: 6_000 } } };
    expect(fieldShares(gridFloor, "finance")?.payFloor).toBe(18);
    // A field the scan does not carry, a row without a column, a zero
    // denominator and a string n all yield nothing — never three shares.
    expect(fieldShares(grid, "legal")).toBeNull();
    expect(fieldShares({ ...grid, fields: { finance: { n: 100, work_mode_n: 10 } } }, "finance")).toBeNull();
    expect(fieldShares({ ...grid, fields: { finance: { ...FINANCE_ROW, n: 0 } } }, "finance")).toBeNull();
    expect(fieldShares({ ...grid, fields: { finance: { ...FINANCE_ROW, n: "33910" } } }, "finance")?.workMode).toBe(31);
    expect(fieldShares(null, "finance")).toBeNull();
    // A numerator above the denominator is a row this page does not understand.
    expect(fieldShares({ ...grid, fields: { finance: { ...FINANCE_ROW, work_mode_n: 40_000 } } }, "finance")).toBeNull();
  });

  it("the pay floor's own share is appended only when it rounds differently, bound to salary_rank_usd's column", async () => {
    wire({ cache: { field_grid: { at: GRID_AT, window_days: 30, fields: { finance: { ...FINANCE_ROW, pay_floor_n: 6_000 } } } } });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("18%"));
    expect(panelText()).toContain("currency we could price");
    expect(panelText()).toContain("$80,000+ chip compares against");
    const pay = (COVERAGE_FAMILIES ?? []).find((f) => f.id === "pay");
    expect(pay?.floorCol).toBe("pay_floor_n");
    expect(pay?.col).toBe("stated_pay_n");
  });
});

describe("2. the sentence is stamped from the scan it reads", () => {
  it("carries the grid's own `at`, moves with it, and never carries the facet's stamp", async () => {
    wire();
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("31%"));
    expect(panelText()).toContain(fmt(GRID_AT));
    expect(panelText(), "the facet's refreshedAt is on the coverage sentence").not.toContain(fmt(REFRESHED_AT));
    expect(panelText()).toContain("hourly per-field scan");
    await closeField("finance");
    document.body.innerHTML = "";
    const later = "2026-09-10T16:07:00Z";
    wire({ cache: { field_grid: { at: later, window_days: 30, fields: { finance: FINANCE_ROW } } } });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain(fmt(later)));
    expect(panelText()).not.toContain(fmt(GRID_AT));
  });

  it("a grid with no stamp is refused whole — a share with no date basis is not published", async () => {
    wire({ cache: { field_grid: { window_days: 30, fields: { finance: FINANCE_ROW } } } });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("is not measured just now"));
    expect(panelText()).not.toContain("%");
  });
});

describe("3. silence when unmeasured — no board-wide fallback", () => {
  it("the cache read failed: no percent sign in the panel, the refusal is said, the counts still render", async () => {
    wire({ cacheError: true });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("2,346"));
    await waitFor(() => expect(panelText()).toContain("is not measured just now"));
    expect(panelText()).toContain("How much of Finance & Accounting states each of these");
    expect(panelText(), "a percentage was invented from the failed read").not.toContain("%");
    for (const s of BOARD_STRINGS) expect(panelText()).not.toContain(s);
  });

  it("the field is absent from the grid (under its floor): same silence, and the probe's board-wide block never leaks", async () => {
    wire({ cache: { field_grid: { at: GRID_AT, window_days: 30, fields: { design: DESIGN_ROW } } } });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("is not measured just now"));
    expect(panelText()).not.toContain("%");
    expect(panelText()).not.toMatch(/stated on/);
    // TEETH IN THE OTHER DIRECTION: the same fixture DOES measure design.
    await closeField("finance");
    await openField("design");
    await waitFor(() => expect(panelText()).toContain("38%"));
  });
});

describe("4. the grid's own n reaches no tile and no sentence", () => {
  it("fed n = 999,999 for finance, the page prints it nowhere and the tile keeps the facet's count", async () => {
    wire({ cache: { field_grid: { at: GRID_AT, window_days: 30, fields: { finance: { ...FINANCE_ROW, n: 999_999, work_mode_n: 500_000 } } } } });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("50%"));
    expect(pageText(), "field_grid.n reached the screen").not.toContain("999,999");
    expect(pageText()).not.toContain("999999");
    expect(tileButton("finance")?.textContent).toContain("33,922");
    expect(tileButton("design")?.textContent).toContain("4,181");
    // And the counts' own basis line names the window, the cache bound and
    // the cap, each from its constant.
    expect(panelText()).toContain("inside the board's 30-day freshness window");
    expect(panelText()).toContain("more than 5 minutes old");
    expect(panelText()).toContain("“10,000+” means the board stopped counting at 10,000");
  });
});

describe("5. a role row needs a ranked measurement, and prints the destination's number", () => {
  const withReply = (name: string, reply: Reply): RoleReply => (q) => (q === name ? reply : rankedReply(q));

  it("an unranked total is not a row and is counted as our instrument", async () => {
    wire({ role: withReply("accountant", { data: { total: 7_109, filterCoverage: BOARD_COVERAGE }, error: null }) });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("1,916"));
    expect(panelText(), "the recency fallback priced a role row").not.toContain("7,109");
    expect(panelText()).toContain("1 of the 8 names we tried could not be counted just now");
  });

  it("a ranked reply that withdrew its total is not a row and NOT an outage — nor is a rescue-tier floor", async () => {
    wire({ role: withReply("accountant", { data: { ranked: true, total: null, countUnavailable: true, totalAtLeast: 40 }, error: null }) });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("1,916"));
    expect(panelText()).not.toContain("40+");
    expect(panelText()).not.toContain("could not be counted");
    await closeField("finance");
    document.body.innerHTML = "";
    // The trigram tier: no `ranked`, a floor, and closeMatch on the row — a
    // name that matched nothing exactly, which used to render "40+".
    wire({ role: withReply("accountant", { data: { total: null, countUnavailable: true, totalAtLeast: 40, jobs: [{ closeMatch: true }] }, error: null }) });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("1,916"));
    expect(panelText()).not.toContain("40+");
    expect(panelText(), "a rescue-tier reply was reported as our outage").not.toContain("could not be counted");
  });

  it("a ranked exact count prints as itself, a capped one prints the cap with a plus, and each equals the destination's figure", async () => {
    wire({ role: withReply("controller", { data: { ranked: true, countCapped: true, total: 10_000 }, error: null }) });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("7,109"));
    expect(panelText()).toContain("10,000+");
    // THE ROW'S NUMBER IS THE DESTINATION'S. Read each row's link, build the
    // destination's body through the ONE mapper from the params the link
    // carries, and ask the same fixture what it would count for that body.
    const rows = [...(panel()?.querySelectorAll("ul li") ?? [])];
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const li of rows) {
      const href = li.querySelector("a")?.getAttribute("href") ?? "";
      const u = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      const q = u.get("q")!;
      expect(u.get("category")).toBe("finance");
      expect(href).toContain("from=explore");
      const body = searchToBoardBody({ category: "finance", q });
      expect(body.q).toBe(q);
      const printed = li.textContent ?? "";
      if (q === "controller") { expect(printed).toContain("10,000+"); continue; }
      expect(printed).toContain(roleTotal(q).toLocaleString("en-US"));
    }
  });
});

describe("6. outage honesty", () => {
  const rejecting = (names: readonly string[]): RoleReply => (q) => (names.includes(q) ? { data: null, error: { message: "boom" } } : rankedReply(q));

  it("two of eight role probes fail: six rows, and the two are said as ours", async () => {
    wire({ role: rejecting(["auditor", "bookkeeper"]) });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("2 of the 8 names we tried could not be counted"));
    const rows = [...(panel()?.querySelectorAll("ul li") ?? [])];
    expect(rows.length).toBe(6);
    expect(panelText()).not.toContain("None of the role names we tried matched");
  });

  it("all eight fail: the partial sentence renders and rolesNone does NOT", async () => {
    wire({ role: rejecting(FIELD_ROLES.finance) });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("8 of the 8 names we tried could not be counted"));
    expect(panelText(), "an outage was published as a market fact").not.toContain("None of the role names we tried matched");
    expect(panelText()).not.toContain("too few to be worth a page");
  });

  it("a genuine no-match field still says so, because no probe failed", async () => {
    wire({ role: (q) => ({ data: { total: 0, ranked: true }, error: null }) });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("None of the role names we tried matched"));
    expect(panelText()).not.toContain("could not be counted");
  });

  it("three chip probes fail: the chips are absent, no number is invented, and the three are said as ours", async () => {
    wire({ chip: (b) => (b.workMode === "remote" || b.hasStatedPay === true || b.country === "CA" ? { data: null, error: { message: "boom" } } : null) });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("3 of the 14 narrowings could not be counted"));
    expect(panelText()).not.toContain("2,346");
    expect(panelText()).not.toContain("8,050");
    expect(panelText()).not.toContain("1,285");
    expect(panelText()).toContain("3,452");
    expect(CONSTRAINT_CHIPS.length + COUNTRY_CHIPS.length).toBe(14);
  });
});

describe("7. under a role the share stays the field's and says so", () => {
  it("choosing accountant re-prices the chips with q and leaves the percentages alone", async () => {
    wire();
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("7,109"));
    const before = probes().length;
    const roleButton = [...(panel()?.querySelectorAll("button[aria-pressed]") ?? [])]
      .find((b) => b.textContent?.trim() === "accountant") as HTMLButtonElement;
    expect(roleButton).toBeTruthy();
    act(() => { roleButton.click(); });
    await waitFor(() => expect(panelText()).toContain("we do not measure it for “accountant” alone"));
    for (const s of ["31%", "24%", "58%", "23%"]) expect(panelText()).toContain(s);
    await waitFor(() => expect(probes().length).toBeGreaterThan(before));
    const rePriced = probes().slice(before);
    expect(rePriced.some((b) => b.q === "accountant" && b.workMode === "remote")).toBe(true);
    expect(rePriced.some((b) => b.q === "accountant" && b.country === "US")).toBe(true);
  });
});

describe("8. staleness is said in the sentence, not the banner", () => {
  it("stale_parts naming field_grid: the carried clause renders and the banner does not", async () => {
    wire({ cache: { stale_parts: ["field_grid"] } });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("31%"));
    expect(panelText()).toContain("latest hourly pass did not finish");
    expect(pageText()).not.toContain("could not be recomputed");
  });

  it("stale_parts naming only unrendered parts: neither", async () => {
    wire({ cache: { stale_parts: ["chip_coverage", "role_rows"] } });
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("31%"));
    expect(panelText()).not.toContain("did not finish");
    expect(pageText()).not.toContain("could not be recomputed");
  });
});

describe("9. every mirrored constant is pinned to the SQL it mirrors", () => {
  it("CLOSURE_WINDOW_DAYS is the fill curve's own interval, and the finding names it", () => {
    expect(EXPLORE).toMatch(/const CLOSURE_WINDOW_DAYS = 90;/);
    const curve = sqlBody("get_company_fill_curve");
    expect(curve).toMatch(/fills_90d/);
    expect(curve).toMatch(/relists_90d/);
    expect(curve).toMatch(/interval '90 days'/);
    expect(EXPLORE).toMatch(/closureFinding2"[\s\S]{0,400}days: CLOSURE_WINDOW_DAYS/);
  });

  it("every coverage family column is a column the per-field scan writes, and the window matches", () => {
    expect(Array.isArray(COVERAGE_FAMILIES), "COVERAGE_FAMILIES is not exported").toBe(true);
    const grid = sqlBody("get_explore_field_grid");
    for (const fam of COVERAGE_FAMILIES) {
      expect(grid, `${fam.col} is not a column of get_explore_field_grid`).toMatch(new RegExp(`\\bAS ${fam.col}\\b`));
      if (fam.floorCol) expect(grid).toMatch(new RegExp(`\\bAS ${fam.floorCol}\\b`));
    }
    // The floor column really is salary_rank_usd's, and stated pay really is
    // salary_min_annual's — the two-columns-one-fact history in the page.
    expect(grid).toMatch(/salary_rank_usd IS NOT NULL\)::int AS pay_floor_n/);
    expect(grid).toMatch(/salary_min_annual IS NOT NULL\)::int AS stated_pay_n/);
    const serve = EXPLORE.match(/const SERVE_WINDOW_DAYS = (\d+);/);
    const win = grid.match(/'window_days',\s*(\d+)/);
    expect(serve?.[1]).toBeTruthy();
    expect(win?.[1], "the grid writes no window_days literal").toBeTruthy();
    expect(serve![1]).toBe(win![1]);
    // …and the sentence is stamped from the grid's own `at`, which the SQL writes.
    expect(grid).toMatch(/'at',\s*now\(\)/);
  });

  it("the board-wide coverage block is read by nothing on this page", () => {
    expect(EXPLORE, "the probe reply's board-wide filterCoverage is being read again").not.toMatch(/filterCoverage/);
    expect(EXPLORE).not.toMatch(/coverageKey/);
    expect(EXPLORE).toMatch(/fieldShares\(grid, id\)/);
  });
});

describe("10. the keys", () => {
  const NEW_KEYS: Record<string, string[]> = {
    panelCountsBasis: ["{{field}}", "{{window}}", "{{min}}", "{{cap}}"],
    rolesTitle2: ["{{field}}"],
    rolesNote2: [],
    rolesPartial: ["{{n}}", "{{total}}"],
    chipsPartial: ["{{n}}", "{{total}}"],
    chipsCoverageField: ["{{field}}", "{{time}}", "{{workMode}}", "{{pay}}", "{{experience}}", "{{employmentType}}"],
    chipsCoveragePayFloor: ["{{payFloor}}"],
    chipsCoverageRole: ["{{role}}"],
    chipsCoverageCarried: [],
    chipsCoverageNone: ["{{field}}"],
    whereNote: ["{{field}}"],
    closureFinding2: ["{{closers}}", "{{readable}}", "{{min}}", "{{days}}"],
    methodLiveMethod2: ["{{min}}"],
    seoDescription5: [],
  };
  const RETIRED = ["chipCoverage", "chipCoverageUnknown", "chipsCoverageNote", "rolesTitle", "rolesNote",
    "methodLiveMethod", "seoDescription4", "closureFinding", "closureBasis2"];
  const ENGLISH = ["en", "en-GB"];
  const WINDOW = ["de", "es", "fr", "hi", "nl", "pt", "tl"];
  const doc = (loc: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${loc}.json`), "utf8")).explore ?? {}) as Record<string, string>;

  it("English carries every new key with its placeholders and none of the retired ones", () => {
    for (const loc of ENGLISH) {
      const ex = doc(loc);
      for (const [k, phs] of Object.entries(NEW_KEYS)) {
        expect(typeof ex[k], `${loc}.json is missing explore.${k}`).toBe("string");
        for (const ph of phs) expect(ex[k], `${loc} explore.${k} drops ${ph}`).toContain(ph);
      }
      for (const k of RETIRED) expect(ex, `${loc}.json still renders the retired claim under explore.${k}`).not.toHaveProperty(k);
    }
    // And the page renders every new key and none of the retired ones.
    const raw = readFileSync(EXPLORE_PATH, "utf8");
    for (const k of Object.keys(NEW_KEYS)) expect(raw, `explore.${k} has no call site`).toContain(`"explore.${k}"`);
    for (const k of RETIRED) expect(raw, `explore.${k} still has a call site`).not.toContain(`"explore.${k}"`);
  });

  it("the seven other locales carry the pass WHOLE — every new key with its placeholders, none of the retired", () => {
    // The locale pass landed in all nine in the same change as the page, so
    // the window this test was written to police is shut: a locale that lacks
    // ANY of the new keys is a regression, not a pending translation. What a
    // locale may never do is carry SOME of them — that is a page half in one
    // language, and it is also how a retired value survives beside a new one.
    const outstanding: string[] = [];
    for (const loc of WINDOW) {
      const ex = doc(loc);
      const has = Object.keys(NEW_KEYS).filter((k) => k in ex);
      if (has.length === 0) { outstanding.push(loc); continue; }
      expect(has.sort(), `${loc}.json carries only part of the chip-coverage pass`).toEqual(Object.keys(NEW_KEYS).sort());
      for (const k of RETIRED) expect(ex, `${loc}.json landed the pass but kept the retired explore.${k}`).not.toHaveProperty(k);
      for (const [k, phs] of Object.entries(NEW_KEYS)) for (const ph of phs) expect(ex[k], `${loc} explore.${k} drops ${ph}`).toContain(ph);
    }
    expect(outstanding, "a locale has none of the chip-coverage keys — the pass is landed, so this is a lost file, not a window").toEqual([]);
  });

  it("the literals the sentences mirror are pinned to the source they describe", () => {
    // explore.whereNote says "Six countries we chose" in all nine locales. The
    // only thing that makes six true is COUNTRY_CHIPS.length, and the sum pin
    // in §6 (CONSTRAINT_CHIPS + COUNTRY_CHIPS = 14) would stay green if one
    // row moved from one list to the other. Pin the count the sentence names.
    expect(COUNTRY_CHIPS.length, "explore.whereNote says \"Six countries\" in nine locales — a seventh chip makes all nine false").toBe(6);
    expect(doc("en").whereNote).toMatch(/^Six countries/);
    // explore.chipsCoveragePayFloor names "the $80,000+ chip". That chip's
    // label and its salaryFloor patch are the two things the sentence mirrors;
    // bind the sentence to the label and the label to the patch, so a
    // re-priced floor cannot leave nine locales naming the old threshold.
    const pay80k = CONSTRAINT_CHIPS.find((c) => c.id === "pay80k");
    expect(pay80k, "the pay floor chip is gone but chipsCoveragePayFloor still describes it").toBeTruthy();
    const floor = pay80k!.patch.salaryFloor;
    expect(typeof floor).toBe("number");
    expect(pay80k!.label).toBe(`$${(floor as number).toLocaleString("en-US")}+`);
    for (const loc of ENGLISH) {
      expect(doc(loc).chipsCoveragePayFloor, `${loc} chipsCoveragePayFloor does not name the ${pay80k!.label} chip`).toContain(`${pay80k!.label} chip`);
    }
    // …and the other seven name the same threshold in their own notation: the
    // digits 80 and 000 both appear, in that order, so a re-priced floor cannot
    // hide behind a locale's thousands separator.
    for (const loc of WINDOW) {
      expect(doc(loc).chipsCoveragePayFloor, `${loc} chipsCoveragePayFloor does not name the ${floor} floor`).toMatch(/80[ .,\u202f\u00a0]?000/);
    }
  });
});

describe("11. the panel's only percent signs are in the coverage sentence", () => {
  it("every % inside the open panel is inside the element that renders chipsCoverageField", async () => {
    wire();
    mount();
    await openField("finance");
    await waitFor(() => expect(panelText()).toContain("31%"));
    await waitFor(() => expect(panelText()).toContain("1,285"));
    const inPanel = (panelText().match(/%/g) ?? []).length;
    const sentence = panel()?.querySelector('[data-coverage="field"]')?.textContent ?? "";
    const inSentence = (sentence.match(/%/g) ?? []).length;
    expect(inSentence).toBe(4);
    expect(inPanel, "a percent sign is rendered somewhere other than the coverage sentence").toBe(inSentence);
    // …and the structural form of "a figure identical on two chips is not a
    // chip figure": no two chip faces share a figure at all.
    const faces = chipAnchors().map((a) => (a.textContent ?? "").match(/\d[\d,]*\+?/g) ?? []);
    const seen = new Map<string, number>();
    for (const f of faces) for (const n of f) seen.set(n, (seen.get(n) ?? 0) + 1);
    for (const [n, c] of seen) expect(c, `${n} appears on ${c} chip faces`).toBe(1);
  });
});
