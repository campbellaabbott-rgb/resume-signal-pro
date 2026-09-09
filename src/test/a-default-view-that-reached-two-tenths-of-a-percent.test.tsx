/**
 * A DEFAULT VIEW THAT REACHED TWO TENTHS OF A PERCENT.
 *
 * /explore opened on a section whose twelve employer cards held 1,812 open
 * roles against roughly 938,000 on the board — 0.19% of the inventory — while
 * the field grid, the highest-coverage surface the page had, was the seventh of
 * seven tabs. Every sentence on those twelve cards was carefully gated, sourced
 * and windowed. None of that mattered, because the DENOMINATOR was the defect:
 * twelve employer cards cannot exceed 11.09% of this board and in practice sit
 * under 0.5%, so no amount of rigour spent on them could make the page reach a
 * reader's market.
 *
 * THIS GUARD STATES THE ONE PROPERTY THAT REPLACES THAT DEFECT:
 *
 *   THE DEFAULT VIEW ROUTES TO A POPULATION MEASURED IN HUNDREDS OF THOUSANDS,
 *   NOT TO TWELVE EMPLOYER CARDS.
 *
 * It is asserted STRUCTURALLY, in three independent ways, because any one of
 * them alone is escapable:
 *
 *   1. THE DEFAULT INTENT ITSELF. `DEFAULT_INTENT` is the field grid, it is the
 *      FIRST answer offered, and the component's initial state CONSUMES that
 *      constant rather than repeating its value — so the entry point cannot be
 *      moved by an edit that looks local to one line of useState.
 *
 *   2. WHAT THE DEFAULT VIEW ACTUALLY RENDERS. Read off a real render with no
 *      `?i=` in the URL: a tile for every board field plus the uncategorised
 *      bucket, a reach sentence whose population is the board's own posting
 *      count, and NOT ONE company card. A source guard cannot tell a rendered
 *      figure from a well-spelled one, and this repo has been bitten repeatedly
 *      by a check that matched an explanation while the code it described was
 *      dead — so the entry point is read off the DOM.
 *
 *   3. THAT NO FIXED SLICE OF TWELVE IS THE ENTRY POINT. The page-level concept
 *      is gone, not merely unrendered: `HIRING_SLICE`, the `p_limit: 12` calls
 *      that produced it, and every RPC behind the five deleted leaderboards are
 *      absent from the source, AND a cache row still carrying those five
 *      payloads renders none of their numbers. Deleting a heading is not
 *      deleting a section: this page has twice kept the arithmetic of something
 *      it stopped showing, and a computation with no rendered sentence is a
 *      number waiting to be re-rendered by someone who does not know why it
 *      left.
 *
 * The source reads below are taken with COMMENTS STRIPPED. Every removal is
 * documented in prose in that file, and each of those notes names the thing it
 * removed — an unstripped read would satisfy every absence check here while the
 * code was still running. That is not a hypothetical: writing a guard's literal
 * into a comment has defeated a guard in this repository four times.
 *
 * The teeth block at the foot drives each claim builder with the shapes that
 * shipped, so a checker that has stopped checking anything fails here first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
// Declared WITH its parameters, not as () => …. A zero-arg vi.fn gives the
// mock a zero-length call tuple, so every mockImplementation taking (fn,
// opts) is a type error and c[1] has no element — which tsconfig.app.json
// catches and a bare `tsc --noEmit` does not. Same shape the other board
// tests use (a-546-rendered-as-a-fit-ranked-list, a-board-wide-count-…).
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

import Explore, {
  CONSTRAINT_CHIPS, COUNTRY_CHIPS, DEFAULT_INTENT, FIELD_ROLES, INTENTS,
  closureRecordOf, feedTotalClaim, fieldLifecycleOf, numOr,
} from "../pages/Explore";
import { BOARD_CATEGORY_SLUGS } from "../lib/job-board-categories";

const ROOT = resolve(__dirname, "../..");
const RAW = readFileSync(resolve(ROOT, "src/pages/Explore.tsx"), "utf8");
/** Comments stripped, for the reason in the header. */
const CODE = RAW
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

// ── THE FIXTURE: A BOARD THE SIZE OF THE REAL ONE ───────────────────────────
// Seventeen fields plus the uncategorised bucket, against the board's own
// served total. The numbers are the shape of the live measurement that
// motivated the rebuild: the tiles reach 844,340 of 965,897 servable postings
// (87.42%), against the 1,812 the twelve employer cards held.
const FIELD_COUNTS: Record<string, number> = {
  engineering: 96_400, data_ai: 31_200, design: 14_900, product: 18_600,
  marketing: 39_100, sales: 71_800, customer: 52_300, finance: 48_700,
  // legal and security sit UNDER the serving API's 10,000 count cap on
  // purpose: without a field on each side of it, the cap assertions below
  // would be satisfiable by a page that formatted nothing at all.
  legal: 9_400, people_hr: 21_900, operations: 18_400, healthcare: 74_600,
  science: 16_300, education: 27_500, hospitality_retail: 63_200,
  security: 8_700, admin: 52_182,
};
const UNCAT = 179_158;
const BOARD_TOTAL = 965_897;
const COVERED = Object.values(FIELD_COUNTS).reduce((a, b) => a + b, 0) + UNCAT;

/** One row of get_category_fill_curve, in the function's own column names, at
 *  the shape a field actually returns: thousands of closures where an employer
 *  has three, which is exactly why the estimator PASSES here and failed there. */
const curveRow = (category: string, over: Record<string, unknown> = {}) => ({
  category,
  n_at_risk_14: 2_140,
  fills_le_14: 690,
  fill_rate_14: 0.31,
  fill_rate_14_lo: 0.28,
  fill_rate_14_hi: 0.34,
  relist_rate_14: 0.08,
  still_open_14: 0.61,
  median_days_to_fill: 22,
  median_censored: false,
  dated_coverage: 0.71,
  window_days: 56,
  sufficient: true,
  ...over,
});

/** The five collections the rebuild deleted, in their real payload shapes, so a
 *  cache row written by a refresh that still computes them can be fed to the
 *  page and checked to render NONE of their numbers. Every value here is a
 *  distinctive number that appears nowhere else in the fixture. */
const RETIRED_PAYLOADS = {
  hiring: [{
    company: "Schnucks", company_token: "schnucks", open_roles: 678, tracking_days: 54,
    p50_days_open: 9, dated_n: 214, filled_roles_ceiling: 214, relisted_roles_floor: 12,
    fill_incidence_14d: 0.62, fill_incidence_14d_lo: 0.48, fill_incidence_14d_hi: 0.71,
    dated_share: 0.8, at_risk_14d: 260,
  }],
  relisting: [{
    company: "BoxLunch", company_token: "boxlunch", relist_events_floor: 581,
    relisted_titles: 3, events_per_title: 193.7, worst_title: "Sales Associate",
    worst_title_events_floor: 500, first_relisted_at: "2026-07-19T00:00:00Z",
    window_days: 56, board_median_per_title: 1.8, board_pool_n: 810,
  }],
  entry: [{ company: "Aramark", company_token: "aramark", open_roles: 1_507, entry_roles: 933 }],
  transparent: [{ company: "Zillow", company_token: "zillow", open_roles: 267, pay_pct: 97, usd_n: 251, median_usd_floor: 118_400 }],
  salary: [{ category: "data_ai", currency: "USD", n: 4_318, median_annual_min: 129_750 }],
};

/** Numbers that may ONLY reach the screen through a deleted section. */
const RETIRED_NUMBERS = ["678", "193.7", "581", "1,507", "933", "118,400", "129,750", "4,318", "267"];

/** Every field's curve, keyed by category, in the shape refresh_explore_cache
 *  writes under `field_curves`. THE STEADY STATE: the live RPC is a 44-second
 *  scan and the cache is where it belongs, so most tests below drive the cached
 *  path and the live one is exercised only where it is the property. */
const CURVES = Object.fromEntries(BOARD_CATEGORY_SLUGS.map((c) => [c, curveRow(c)]));

const cacheRow = (over: Record<string, unknown> = {}) => ({
  fields: { ...FIELD_COUNTS, other: UNCAT },
  // THE REACH SENTENCE'S ONE PASS. tiled_n and board.n are get_explore_field_grid's
  // own roll-up over the same statement that produced `fields`; the page must
  // divide THESE and never `fields` summed against totals.postings_n, which is
  // a different function's scan at a different instant.
  field_grid: { tiled_n: COVERED, board: { n: BOARD_TOTAL } },
  totals: { postings_n: BOARD_TOTAL, employers_n: 41_802 },
  repost_index: {},
  stale_parts: [],
  computed_at: new Date().toISOString(),
  ...over,
});

/** Open a field tile. Sections 2-4 exist only behind this click — and since the
 *  uncached lifecycle scan was gated on it too, so does the live curve call. */
const openField = (name: RegExp) => (screen.getAllByRole("button", { name })[0]).click();

const mount = (over: Record<string, unknown> = {}) => {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_explore_cache") return { data: cacheRow(over) };
    if (fn === "get_category_fill_curve") {
      return { data: BOARD_CATEGORY_SLUGS.map((c) => curveRow(c)), error: null };
    }
    return { data: [], error: null };
  });
  return render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
};

/** The supabase mock forwards (fn, args), so `args` is present-and-undefined on
 *  a no-argument call. toHaveBeenCalledWith("x") demands exactly one argument
 *  and would fail on a call that really did happen — a false green in the
 *  other direction. Read the first argument. */
const rpcCalls = () => rpc.mock.calls.map((c) => c[0] as string);
const calledRpc = (fn: string) => rpcCalls().includes(fn);

const pageText = () => document.body.textContent ?? "";
const links = () => Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
/** Only what the reader actually sees. Every answer stays in the DOM under
 *  `hidden` — /explore is prerendered and its links must stay crawlable — so a
 *  test about the DEFAULT VIEW has to exclude the hidden one, or "no company
 *  cards on the entry point" would be satisfiable by nothing at all. */
const visible = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("main > div"))
    .filter((d) => !d.hasAttribute("hidden"));
const visibleText = () => visible().map((d) => d.textContent ?? "").join(" ");
const visibleLinks = () =>
  visible().flatMap((d) => Array.from(d.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? ""));

beforeEach(() => { rpc.mockReset(); invoke.mockClear(); });
afterEach(() => { document.body.innerHTML = ""; });

// ─────────────────────────────────────────────────────────────────────────────
describe("1. the default intent is the field grid, and nothing local can undo it", () => {
  it("DEFAULT_INTENT is the field grid and is the first answer offered", () => {
    expect(DEFAULT_INTENT).toBe("fields");
    expect(INTENTS[0]).toBe("fields");
    // The five deleted leaderboards are not answers any more. A retired id must
    // not resolve to an Intent, or a shared /explore?i=pay link would land a
    // reader on a section that no longer makes that claim.
    for (const dead of ["hiring", "ghost", "aged", "pay", "entry", "scale"]) {
      expect(INTENTS as readonly string[]).not.toContain(dead);
    }
  });

  it("the component's initial state CONSUMES the constant rather than repeating its value", () => {
    // The whole point of exporting it. `useState<Intent>("fields")` would make
    // this property true today and silently untrue after one edit that never
    // touches the exported constant a reader would check.
    expect(CODE).toMatch(/useState<Intent>\(\s*DEFAULT_INTENT\s*\)/);
    expect(CODE).not.toMatch(/useState<Intent>\(\s*["'](?!.*DEFAULT_INTENT)[a-z]+["']\s*\)/);
  });

  it("a URL that names no answer, and a URL that names a retired one, both land on the default", async () => {
    mount();
    await waitFor(() => expect(calledRpc("get_explore_cache")).toBe(true));
    // No `?i=` at all: the field grid is what is visible.
    await waitFor(() => expect(visibleText()).toContain("Every field on the board"));
    // The employer check is OFFERED (its tab label is chrome, always on
    // screen) and is NOT the answer being shown: its own body — the lookup and
    // its methodology — is behind the `hidden` attribute.
    expect(visibleText()).not.toContain("Every employer whose board we carry");
    expect(visibleText()).not.toContain("Type a company name");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("2. what the default view actually renders, read off the DOM", () => {
  it("renders a tile for every board field plus the uncategorised bucket", async () => {
    mount();
    await waitFor(() => expect(visibleText()).toContain("Every field on the board"));
    // Eighteen tiles: seventeen fields and the bucket. Each is a list item with
    // its own way into the board.
    await waitFor(() => {
      const items = visible().flatMap((d) => Array.from(d.querySelectorAll("li")));
      expect(items.length).toBe(BOARD_CATEGORY_SLUGS.length + 1);
    });
    // The bucket, which no field tile can reach, is named as what it is —
    // rows whose field we could not read — and never as a field.
    expect(visibleText()).toContain("Roles whose field we could not read from the title");
  });

  it("the default view's population is the board's own posting count, in hundreds of thousands", async () => {
    mount();
    await waitFor(() => expect(visibleText()).toContain("These tiles reach at least"));
    const text = visibleText();
    // THE REACH SENTENCE, AND BOTH OF ITS TERMS. Covered and board total, with
    // the covered half marked as a FLOOR ("at least") because a field under the
    // scan's 50-posting floor is absent from the tiles entirely.
    expect(text).toContain(COVERED.toLocaleString("en-US"));
    expect(text).toContain(BOARD_TOTAL.toLocaleString("en-US"));
    expect(text).toMatch(/at least/i);
    // Hundreds of thousands, not twelve cards' worth. The literal thousand-fold
    // difference this guard exists for: the deleted default reached 1,812.
    expect(COVERED).toBeGreaterThan(100_000);
    expect(text).not.toContain("1,812");
  });

  it("the reach fraction comes off ONE scan, and vanishes rather than divide two", async () => {
    // "AS COUNTED IN THE SAME HOURLY SCAN" IS A DATE BASIS, AND IT HAS TO BE
    // TRUE. This sentence used to sum the rendered tiles and divide by
    // totals.postings_n — get_explore_denominators' own board CTE, a different
    // function on a different scan. get_explore_field_grid publishes tiled_n
    // and board.n over one pass for exactly this fraction, and the page reads
    // that pair or says nothing.
    //
    // A denominators total that DISAGREES must move nothing: here it is 40,000
    // short of the grid's, which under the old arithmetic tripped the wholeness
    // branch and published "every posting we can serve — all N of them" as an
    // equality neither statement proved.
    mount({ totals: { postings_n: COVERED - 40_000, employers_n: 41_802 } });
    await waitFor(() => expect(visibleText()).toContain("These tiles reach at least"));
    expect(visibleText()).toContain(BOARD_TOTAL.toLocaleString("en-US"));
    expect(visibleText()).not.toContain((COVERED - 40_000).toLocaleString("en-US"));
    expect(visibleText()).not.toContain("reach every posting we can serve");

    // AND NO GRID, NO SENTENCE. In the deploy window before the cache carries
    // field_grid there is no pair from one scan, and a reach fraction with a
    // missing half is a different claim rather than a smaller one.
    document.body.innerHTML = "";
    rpc.mockReset();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") {
        const row = cacheRow() as Record<string, unknown>;
        delete row.field_grid;
        return { data: row };
      }
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Engineering"));
    expect(visibleText()).not.toContain("These tiles reach at least");
    expect(visibleText()).not.toContain("reach every posting we can serve");
  });

  it("when the tiles reach the whole board they say so, and no fraction of a number by itself is published", async () => {
    // MEASURED LIVE while this was written: every servable posting carries a
    // category, so tiled_n and board.n are the SAME NUMBER and the eighteen
    // tiles partition the board rather than sampling it. "At least 805,927 of
    // the 805,927 postings — about 100%" is a true sentence that reads as a
    // rounding artefact, and a number divided by itself is a fraction carrying
    // no information.
    mount({ field_grid: { tiled_n: BOARD_TOTAL, board: { n: BOARD_TOTAL } } });
    await waitFor(() => expect(visibleText()).toContain("reach every posting we can serve"));
    expect(visibleText()).toContain(`all ${BOARD_TOTAL.toLocaleString("en-US")} of them`);
    expect(visibleText()).not.toContain("about 100%");
    expect(visibleText()).not.toMatch(/\b1[0-9][0-9](\.[0-9])?%/);
  });

  it("the field lifecycle scan is read from the hourly cache when the cache carries it", async () => {
    // A 44-SECOND SCAN BELONGS IN THE HOURLY CACHE, NOT ON A PAGE VIEW. This
    // page already made the opposite mistake once, with a 26-second aggregate
    // every visitor paid for on a section that had never rendered.
    mount({ field_curves: { engineering: curveRow("engineering", { median_days_to_fill: 17 }) } });
    await waitFor(() => expect(visibleText()).toContain("17 days"));
    // The live fallback is not asked when the cache answered.
    expect(calledRpc("get_category_fill_curve")).toBe(false);
  });

  it("while the uncached scan runs, the placeholder says what it costs", async () => {
    // A spinner with no stated cost is indistinguishable from one that is never
    // going to finish, and eighteen of them read as a broken page.
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow() };
      if (fn === "get_category_fill_curve") return new Promise(() => { /* still running */ });
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    openField(/Data & AI/);
    await waitFor(() => expect(visibleText()).toContain("this scan takes up to a minute"));
    // ...and everything else on the tile is usable while it runs.
    expect(visibleText()).toContain("10,000+");
    expect(visibleLinks().some((h) => h.includes("category=engineering"))).toBe(true);
  });

  it("not one company card is on the entry point", async () => {
    mount();
    await waitFor(() => expect(visibleText()).toContain("Every field on the board"));
    // The five deleted sections all routed to /jobs/company/{token}. Their
    // absence from the DEFAULT view is the property; the employer check still
    // links there, and it is a different (hidden, second) answer.
    expect(visibleLinks().filter((h) => h.startsWith("/jobs/company/"))).toEqual([]);
    // And the entry point offers far more destinations than a slice of twelve.
    expect(visibleLinks().filter((h) => h.startsWith("/jobs")).length).toBeGreaterThan(12);
  });

  it("a tile's count is capped exactly as the page it opens is, and the page says why the two do not add up", async () => {
    mount();
    await waitFor(() => expect(visibleText()).toContain("Every field on the board"));
    const text = visibleText();
    // A FIELD OVER THE CAP MUST READ "10,000+" AND NEVER ITS RAW COUNT, or the
    // tile and the page it opens print two different figures for the same rows
    // in two runtimes — the exact shape of the note line the previous rebuild
    // had to delete.
    expect(text).toContain("10,000+");
    for (const slug of Object.keys(FIELD_COUNTS)) {
      const n = FIELD_COUNTS[slug];
      if (n >= 10_000) {
        expect(text, `${slug} is over the cap and must not print its raw count`)
          .not.toContain(n.toLocaleString("en-US"));
      } else {
        // ...and a field UNDER the cap prints its exact number, so the rule is
        // a formatter and not a blanket suppression.
        expect(text, `${slug} is under the cap and must print exactly`)
          .toContain(n.toLocaleString("en-US"));
      }
    }
    // The uncategorised bucket is far over the cap too, and gets no exemption.
    expect(text).not.toContain(UNCAT.toLocaleString("en-US"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("3. no fixed slice of twelve is the entry point — as code, and as render", () => {
  it("the page-level slice concept is gone from the source", () => {
    expect(CODE).not.toMatch(/HIRING_SLICE/);
    // The four cache-writer slices and the live fallback that produced it.
    expect(CODE).not.toMatch(/p_limit\s*:\s*12/);
    // A leaderboard is a ranked slice. None of the five ranking functions, none
    // of their card renderers, and none of their client-side gates survive.
    for (const gone of [
      "rankedDurationClaims", "rankRecycling", "rankAged", "rankEntry",
      "DurationGrid", "RecyclingGrid", "AgedGrid", "CompanyGrid",
      "heldFor", "agedClaimOf", "recyclingClaimOf", "measureOf",
      "ENTRY_MIN_ENTRY_ROLES", "ENTRY_MIN_OPEN_ROLES", "PAY_MEDIAN_MIN_USD_N",
    ]) {
      expect(CODE, `${gone} is a deleted section's computation`).not.toMatch(new RegExp(`\\b${gone}\\b`));
    }
  });

  it("none of the deleted sections' RPCs is called, on any path", async () => {
    mount();
    await waitFor(() => expect(calledRpc("get_explore_cache")).toBe(true));
    const called = rpcCalls();
    for (const dead of [
      "get_actively_hiring_companies", "get_entry_level_companies",
      "get_transparent_employers", "get_relisting_employers",
      "get_salary_benchmarks", "get_size_segments", "get_repost_churn_companies",
      "get_trending_companies", "get_newest_companies",
    ]) {
      expect(called, `${dead} feeds a section that no longer exists`).not.toContain(dead);
      expect(CODE).not.toMatch(new RegExp(`["']${dead}["']`));
    }
  });

  it("a cache row still carrying all five deleted payloads renders none of their numbers", async () => {
    // THE REMOVAL THAT MATTERS. refresh_explore_cache keeps writing these keys
    // until a migration this workflow does not own stops it, and the frontend
    // deploys first. So the live shape for the next while is exactly this: a
    // current page reading a cache row full of retired collections.
    mount(RETIRED_PAYLOADS);
    await waitFor(() => expect(pageText()).toContain("Every field on the board"));
    for (const n of RETIRED_NUMBERS) {
      expect(pageText(), `${n} can only reach the screen through a deleted section`).not.toContain(n);
    }
    for (const name of ["Schnucks", "BoxLunch", "Aramark", "Zillow"]) {
      expect(pageText()).not.toContain(name);
    }
  });

  it("a retired collection cannot make this page look stale", async () => {
    // THE CACHE WRITER'S OWN NEW KEYS ARE IN HERE TOO, and role_rows is the one
    // that was guaranteed to fire: refresh_explore_role_rows runs on a SEPARATE
    // six-hourly cron, so for the first hours after the migration the hourly
    // read-through finds nothing and names role_rows stale — a yellow warning,
    // in a raw internal spelling, about a section this page does not render.
    // chip_coverage and ageout_basis are written and unread for the same
    // reason: the chips and the roles are priced by live probes at click time.
    mount({ stale_parts: ["hiring", "transparent", "salary", "entry", "relisting", "role_rows", "chip_coverage", "ageout_basis"] });
    await waitFor(() => expect(pageText()).toContain("Every field on the board"));
    // Warning about a section that does not exist trains readers to ignore the
    // line that matters when the hourly job actually dies — which it did, for a
    // day.
    expect(pageText()).not.toContain("could not be recomputed");
  });

  it("field_curves is NOT retired — its staleness is this page's business", async () => {
    // The mirror of the test above, and the reason that set is a deny-list
    // rather than a blanket. The lifecycle sentence under every tile is drawn
    // from this key; a refresh that could not recompute it is a fact about what
    // is on this screen.
    mount({ stale_parts: ["field_curves"] });
    await waitFor(() => expect(pageText()).toContain("could not be recomputed"));
    expect(pageText()).toContain("field_curves");
  });

  it("an unknown stale part is still reported", async () => {
    mount({ stale_parts: ["hiring", "some_future_collection"] });
    await waitFor(() => expect(pageText()).toContain("could not be recomputed"));
    expect(pageText()).toContain("some_future_collection");
    // ...and the retired one beside it is still filtered out.
    expect(pageText()).not.toMatch(/hiring,|,\s*hiring/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("4. the statistics stayed, at the grain where their sample exists", () => {
  it("the 44-second lifecycle scan is never paid for by a page view, and is paid once by a click", async () => {
    // THE BLOCKER THIS GUARD EXISTS FOR. get_category_fill_curve is
    // anon-granted and measured at 44.3s against a 60s statement timeout, and
    // /explore's default view reads it under every tile. Shipped with the
    // fallback gated only on "the cache did not carry it" — a condition nothing
    // in the tree could make false — it was one 44-second scan per page view on
    // a prerendered, daily-sitemapped page. That is the get_transparent_employers
    // bill this page has already paid ("every visitor paid 26s of database time
    // for a section that had never rendered"), on far more traffic.
    //
    // 20260909130000 now writes the `field_curves` cache key, so the steady
    // state is free; this half of the guard is about the path that remains when
    // the cache has not answered, on the deploy window where the frontend ships
    // first.
    mount();
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    // The whole page has settled and nothing has been scanned.
    expect(calledRpc("get_category_fill_curve")).toBe(false);
    // And the tiles say why, rather than spinning on an answer that is not
    // coming or asserting a fact about the closure record.
    expect(visibleText()).toContain("open a field to read its closure record");
    expect(visibleText()).not.toContain("no closure record we can read for this field yet");

    // An explicit click buys it, once.
    openField(/Data & AI/);
    await waitFor(() => expect(calledRpc("get_category_fill_curve")).toBe(true));
    expect(rpcCalls().filter((f) => f === "get_category_fill_curve").length).toBe(1);
    // ONE ARITY, FOR EVER. Both of that function's parameters have defaults, so
    // a second overload makes every no-argument call an ambiguous PGRST203 —
    // which is how the old fill-speed RPC went dark on eighteen landing pages.
    // The call site passes nothing, which is what keeps that arity single.
    expect(CODE).toMatch(/rpc\("get_category_fill_curve"\)/);
  });

  it("a field's median renders with its window, its date basis and no word we cannot support", async () => {
    mount({ field_curves: CURVES });
    await waitFor(() => expect(visibleText()).toContain("22 days"));
    // FIGURE, WINDOW, DATE BASIS, in the same line as the number.
    expect(visibleText()).toContain("employer's own post date");
    expect(visibleText()).toContain("56-day closure log");
    // AND THE EXACT EVENT. median_days_to_fill is the median of the FILL
    // incidence, and the estimator's "fill" is a closure that did not come
    // back — so "gone within N days" alone is the weaker off-board claim for a
    // different number, and "filled" is the stronger claim this page's standing
    // rule forbids, a closure being indistinguishable from a withdrawal, a
    // cancelled requisition or a retitle.
    expect(visibleText()).toContain("did not come back");
    expect(visibleText()).not.toMatch(/half of these roles were filled/i);
  });

  it("a field whose record fails the estimator's own gate says so instead of showing a number", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow() };
      if (fn === "get_category_fill_curve") {
        return {
          data: [
            // sufficient FALSE: the estimator refusing on a record that exists.
            curveRow("engineering", { sufficient: false, median_days_to_fill: 7 }),
            // Coverage under the floor: the record exists and the estimator is
            // satisfied, but too few of the field's roles carry the employer's
            // own date for a duration to mean anything.
            curveRow("sales", { dated_coverage: 0.11, median_days_to_fill: 5 }),
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    openField(/Data & AI/);
    await waitFor(() => expect(visibleText()).toContain("too few closures with a stated post date"));
    // Neither refused median leaks.
    expect(visibleText()).not.toContain("7 days");
    expect(visibleText()).not.toContain("5 days");
    // And a field the RPC did not return at all is a DIFFERENT sentence: our
    // instrument, not a finding about the field.
    expect(visibleText()).toContain("no closure record we can read for this field yet");
  });

  it("a failed lifecycle call reads as our outage, never as every field being thin", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow() };
      // A RESOLVED PostgREST ERROR. supabase-js does not throw one, which is
      // how a deploy window in which the function is absent turned into a page
      // of confident refusals about eighteen fields.
      if (fn === "get_category_fill_curve") return { data: null, error: { code: "PGRST202" } };
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    openField(/Data & AI/);
    await waitFor(() => expect(visibleText()).toContain("no closure record we can read"));
    expect(visibleText()).not.toContain("too few closures with a stated post date");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5. every priced thing is priced by the query its own link runs", () => {
  it("nothing is probed on a default page view", async () => {
    mount();
    await waitFor(() => expect(visibleText()).toContain("Every field on the board"));
    // Twenty-two counts per field is a real cost, and it is paid on an explicit
    // click rather than by every visitor who loads the page.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("the count and the link are built from ONE params object through the two mappers", () => {
    // searchToBoardBody produces the count; searchToQuery produces the
    // destination. A hand-written body or a hand-written href on either side is
    // the drift that put "38 entry-level roles" over a page showing 900.
    expect(CODE).toMatch(/searchToBoardBody\(/);
    expect(CODE).toMatch(/searchToQuery\(/);
    // No /jobs href is assembled by string concatenation with a filter name in
    // it. The one exception is the multi-employer link, which uses
    // URLSearchParams and the comma list Jobs.tsx already round-trips.
    expect(CODE).not.toMatch(/`\/jobs\?[a-zA-Z]+=/);
  });

  it("every constraint chip names the coverage column it can be checked against — or states its exclusion in words", () => {
    // A chip whose filter hides rows must publish how much of the board it can
    // even see. Two chips carry no coverage key, and they are OPPOSITE cases
    // that must not share a render:
    //
    //   apply — genuinely complete. sendableOnly filters on `source`, which
    //     every served row carries, so an invented "100%" would be noise.
    //   week  — the chip that hides the MOST. maxAgeDays binds `posted_at`, the
    //     employer's own stated date (job-board/index.ts, and count_jobs_capped
    //     itself), NOT effective_posted; whole vendors are structurally undated
    //     (bamboohr 43,687 of 43,687) and every one of those rows is dropped
    //     however new it is. get_filter_coverage publishes the fraction as
    //     `dated`, but coverageDisclosure has no maxAgeDays branch, so no
    //     number reaches this page — and the honest render of a figure we
    //     cannot get is the exclusion IN WORDS. Silence here put the page's
    //     largest hidden population under a note that reads silence as "we hold
    //     no coverage reading for this filter".
    const withCoverage = CONSTRAINT_CHIPS.filter((c) => c.coverageKey !== null);
    expect(withCoverage.length).toBeGreaterThanOrEqual(6);
    for (const c of withCoverage) {
      expect(["workMode", "hasStatedPay", "salaryFloor", "experience", "employmentType", "country"])
        .toContain(c.coverageKey);
      // A chip may publish a figure OR state an exclusion, never both.
      expect(c.note, `${c.id} carries both a coverage key and a prose exclusion`).toBeUndefined();
    }
    for (const c of CONSTRAINT_CHIPS.filter((x) => x.coverageKey === null)) {
      expect(["week", "apply"]).toContain(c.id);
    }
    const week = CONSTRAINT_CHIPS.find((c) => c.id === "week")!;
    expect(week.patch).toEqual({ maxAgeDays: 7 });
    expect(week.note, "the chip bounded by dated_n disclosed nothing").toBeTruthy();
    expect(week.note!).toMatch(/employer's own date/i);
    expect(CONSTRAINT_CHIPS.find((c) => c.id === "apply")!.note).toBeUndefined();
    expect(COUNTRY_CHIPS.length).toBeGreaterThan(0);
  });

  it("the board-wide employer facet is not read anywhere on this page", () => {
    // A field that is only ever null is a liability — someone will fill it back
    // in with the facet count, which is what this test exists to stop. The
    // facet's own key names are excluded structurally, so a regression fails
    // here rather than on screen.
    expect(CODE, "companiesCount is board-wide and answers a different question")
      .not.toMatch(/\bcompaniesCount\b/);
    // The closure probe must ask for a page of the slice's own results, and
    // must not ask for facets at all.
    expect(CODE).toMatch(/includeFacets:\s*false/);
    expect(CODE, "no call on this page asks for the board-wide facet")
      .not.toMatch(/includeFacets:\s*true/);
  });

  it("NO PINNED PAY PERCENTAGE. Three numbers for one fact is how this repo already broke a claim", () => {
    // 20.1% is salary_min_annual over servable rows; 12.9% is the pay FLOOR's
    // column over an older, un-windowed denominator; ~4% is a gloss on an
    // $80k-floor collapse and is wrong under every definition here. The
    // resolution is that this page pins NONE of them and reads each chip's
    // coverage live out of that chip's own probe response.
    for (const stale of ["20.1", "12.9", "0.201", "0.129"]) {
      expect(CODE, `${stale} is a dated snapshot and must not be pinned on this page`).not.toContain(stale);
    }
    expect(CODE).toMatch(/filterCoverage/);
  });

  it("the role vocabulary is ours, is never a number, and covers every field", () => {
    for (const slug of BOARD_CATEGORY_SLUGS) {
      expect(FIELD_ROLES[slug], `${slug} has no role vocabulary`).toBeTruthy();
      expect(FIELD_ROLES[slug].length).toBeGreaterThanOrEqual(6);
    }
    // The uncategorised bucket deliberately has NONE: its rows have no field we
    // could read, so a role list for them would be a list about nothing.
    expect(FIELD_ROLES.other).toBeUndefined();
    // And the page says whose words these are, on screen, not only in a comment.
    expect(RAW).toContain("Role names are ours, not the board's");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEETH. Each claim builder driven with the shape that shipped, so a checker
// that has stopped checking anything fails here rather than passing quietly.
// ─────────────────────────────────────────────────────────────────────────────
describe("teeth — the builders refuse what they are supposed to refuse", () => {
  it("numOr treats a numeric-as-string as a number and an absent column as a refusal", () => {
    expect(numOr("0.42")).toBe(0.42);
    expect(numOr(undefined)).toBeNull();
    expect(numOr("")).toBeNull();
    expect(numOr("not a number")).toBeNull();
  });

  it("fieldLifecycleOf honours sufficiency, coverage and the observation window separately", () => {
    const ok = fieldLifecycleOf(curveRow("engineering"));
    expect(ok.kind).toBe("median");
    // The estimator's own flag.
    expect(fieldLifecycleOf(curveRow("engineering", { sufficient: false })).kind).toBe("thin");
    // The coverage floor, which `sufficient` deliberately does not include.
    expect(fieldLifecycleOf(curveRow("engineering", { dated_coverage: 0.05 })).kind).toBe("thin");
    // The observation window, which `sufficient` does not look at at all: a
    // fourteen-day claim needs a log deeper than fourteen days. It is its OWN
    // refusal, not folded into the thin-sample one — "we have not watched long
    // enough" is a statement about our log and "too few closures" is one about
    // the field, and a page that says the second when the first is true passes
    // a verdict on a field it never measured.
    expect(fieldLifecycleOf(curveRow("engineering", { window_days: 9 })).kind).toBe("window");
    // A censored median is a FINDING and must outlive the number it refuses —
    // returning "absent" here would render as "no data" for a field we measured.
    expect(fieldLifecycleOf(curveRow("engineering", { median_censored: true, median_days_to_fill: null })).kind)
      .toBe("censored");
    // No row at all is OUR instrument, and a different sentence.
    expect(fieldLifecycleOf(undefined).kind).toBe("absent");
    expect(fieldLifecycleOf(curveRow("engineering", { window_days: null })).kind).toBe("absent");
    // PostgREST's numeric-as-string build must not silently become a refusal.
    expect(fieldLifecycleOf(curveRow("engineering", { dated_coverage: "0.71", fill_rate_14: "0.31", median_days_to_fill: "22" })).kind)
      .toBe("median");
  });

  it("closureRecordOf keeps asked, readable and closers as three different numbers", () => {
    const asked = ["a", "b", "c", "d"];
    const rows = [
      { company_token: "a", fills_90d: 9, relists_90d: 2, ageouts_90d: 4, tracking_days: 60 },   // closer
      { company_token: "b", fills_90d: 9, relists_90d: 40, ageouts_90d: 0, tracking_days: 60 },  // churns
      { company_token: "c", fills_90d: 1, relists_90d: 0, ageouts_90d: 0, tracking_days: 60 },   // under the bar
      // "d" IS THE SHAPE THE RPC ACTUALLY EMITS FOR AN EMPLOYER WE HAVE LOGGED
      // NOTHING ABOUT, and getting this fixture wrong is what made the whole
      // sentence a falsehood. get_company_fill_curve is `FROM toks t LEFT JOIN
      // …` and projects COALESCE(c.f90, 0) / COALESCE(c.r90, 0)
      // (20260908137000:535-536): it returns a row for EVERY token asked, and
      // an employer with no record comes back 0/0 — never null. The first
      // version of this guard used `{fills_90d: null, relists_90d: null}`, a
      // payload the function cannot produce, so it went green over a branch
      // production never takes while `readable` was structurally identical to
      // `asked` and the page asserted a readable closure record for 51 of 51
      // employers, 47 of which we had never logged an event for.
      { company_token: "d", fills_90d: 0, relists_90d: 0, ageouts_90d: 0 },
    ];
    const rec = closureRecordOf(null, 60, asked, rows)!;
    expect(rec.inSlice).toBeNull();
    expect(rec.rowsRead).toBe(60);
    expect(rec.asked).toBe(4);
    expect(rec.readable).toBe(3);
    expect(rec.closers).toBe(1);
    expect(rec.tokens).toEqual(["a"]);
    // A relist count EQUAL to the fills still qualifies — relists_90d is a
    // FLOOR, so the bar errs towards disqualifying, which is the safe direction
    // for a claim that speaks well of an employer.
    expect(closureRecordOf(null, 60, ["a"], [{ company_token: "a", fills_90d: 3, relists_90d: 3 }])!.closers).toBe(1);
    expect(closureRecordOf(null, 60, ["a"], [{ company_token: "a", fills_90d: 3, relists_90d: 4 }])!.closers).toBe(0);
    // Nothing to ask about is not a finding.
    expect(closureRecordOf(null, 60, [], rows)).toBeNull();
    // The multi-employer link caps at the 12 Jobs.tsx round-trips.
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const allClosers = many.map((tk) => ({ company_token: tk, fills_90d: 5, relists_90d: 1 }));
    expect(closureRecordOf(null, 60, many, allClosers)!.tokens.length).toBe(12);
    expect(closureRecordOf(null, 60, many, allClosers)!.closers).toBe(30);
    // ...and the truncation is REPORTED, because the finding sentence counts 30
    // and the link carries 12. "Open this slice at those N employers" asserted
    // an identity the destination did not have.
    expect(closureRecordOf(null, 60, many, allClosers)!.capped).toBe(true);
    expect(closureRecordOf(null, 60, ["a"], [{ company_token: "a", fills_90d: 5, relists_90d: 1 }])!.capped).toBe(false);

    // AN EMPLOYER WITH NO LOGGED EVENT IS NOT A READABLE RECORD — the test
    // that could never fire, as its own class. One arm of three is enough:
    // "no fills, no relists, but four roles aged out" IS a record we read.
    expect(closureRecordOf(null, 60, ["z"], [{ company_token: "z", fills_90d: 0, relists_90d: 0, ageouts_90d: 0 }])!.readable).toBe(0);
    expect(closureRecordOf(null, 60, ["z"], [{ company_token: "z", fills_90d: 0, relists_90d: 0, ageouts_90d: 4 }])!.readable).toBe(1);
    expect(closureRecordOf(null, 60, ["z"], [{ company_token: "z", fills_90d: 0, relists_90d: 2, ageouts_90d: 0 }])!.readable).toBe(1);
    // A build that does not return the columns at all is OUR INSTRUMENT and is
    // still refused — a different fact, kept in front of the counts test.
    expect(closureRecordOf(null, 60, ["z"], [{ company_token: "z", fills_90d: null, relists_90d: null }])!.readable).toBe(0);
    // An older build with no ageouts_90d degrades towards "unreadable", which
    // is the safe direction for a sentence about how little we hold.
    expect(closureRecordOf(null, 60, ["z"], [{ company_token: "z", fills_90d: 0, relists_90d: 0 }])!.readable).toBe(0);
  });

  it("feedTotalClaim still refuses a total with no date and never yields a ratio", () => {
    expect(feedTotalClaim(678, 19_265, "2026-08-30T00:00:00Z")).toEqual({ open: 678, total: 19_265, at: "2026-08-30T00:00:00Z" });
    expect(feedTotalClaim(678, 19_265, null)).toBeNull();
    expect(feedTotalClaim(null, 19_265, "2026-08-30T00:00:00Z")).toBeNull();
    expect(feedTotalClaim(678, 400, "2026-08-30T00:00:00Z")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE LIVE PATH, END TO END. Sections 2, 3 and 4 only exist once a reader opens
// a field, so a guard that never opens one is a guard over an entry point with
// nothing behind it.
// ─────────────────────────────────────────────────────────────────────────────
describe("6. opening a field prices what is inside it, from the query each link runs", () => {
  /** Every probe answers with a count keyed off what was actually asked, so an
   *  assertion below can only pass if the body the page sent carried the
   *  filters the link carries. */
  const wireBoard = () => {
    invoke.mockImplementation(async (_fn: string, opts?: { body?: Record<string, unknown> }) => {
      const body = ((opts ?? {}) as { body?: Record<string, unknown> }).body ?? {};
      // THE CLOSURE PROBE READS A PAGE OF THE SLICE'S OWN RESULTS. It carries
      // the board-wide `companies` facet too, precisely so a regression that
      // went back to reading it shows up here as the wrong denominator rather
      // than as a missing one.
      if (body.limit === 60) {
        return {
          data: {
            total: 7_311,
            jobs: [
              { token: "acme" }, { token: "acme" }, { token: "globex" },
              { token: "initech" }, { token: "acme" },
            ],
            companies: [{ token: "dominos", name: "Domino's", count: 34_000 }],
            companiesCount: 33_545,
          },
          error: null,
        };
      }
      // A DIFFERENT COUNT PER FILTER, so a chip that priced the wrong query
      // shows the wrong number here rather than passing on a shared constant.
      let total = 41_000;
      if (typeof body.q === "string") total = body.q === "data analyst" ? 7_311 : 512;
      if (body.workMode === "remote") total = 1_204;
      if (body.hasStatedPay === true) total = 933;
      if (body.country === "US") total = 5_002;
      // A filter the server refuses is NAMED, and the chip for it must not
      // render a count for a query the click will never run.
      if (body.sendableOnly === true) return { data: { total: 88, ignoredFilters: ["sendableOnly"] }, error: null };
      return {
        data: {
          total,
          filterCoverage: {
            workMode: 0.281, hasStatedPay: 0.201, salaryFloor: 0.201,
            experience: 0.431, employmentType: 0.62, country: 0.72,
          },
        },
        error: null,
      };
    });
  };

  it("a probe asks the exit that CARRIES the disclosures, not the one that drops them", async () => {
    // MEASURED LIVE, same filters, both exits:
    //   {countOnly:true} -> keys ["total"]
    //   {limit:1}        -> total, filterCoverage AND ignoredFilters
    // The cheap-looking exit drops the coverage block and the name of any
    // filter the server refused — so a chip priced through it would print a
    // count for a query the click never runs, with no coverage beside it.
    wireBoard();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow() };
      if (fn === "get_category_fill_curve") return { data: BOARD_CATEGORY_SLUGS.map((c) => curveRow(c)), error: null };
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    (screen.getAllByRole("button", { name: /Data & AI/ })[0]).click();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const bodies = invoke.mock.calls
      .map((c) => ((c[1] ?? {}) as { body?: Record<string, unknown> }).body ?? {});
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b.countOnly, "the countOnly exit drops filterCoverage and ignoredFilters").toBeUndefined();
      // Two probe shapes and no third: one row to price a slice, one page to
      // find the employers in it.
      expect([1, 60]).toContain(b.limit);
    }
    expect(bodies.some((b) => b.limit === 1), "the pricing probes ask for one row").toBe(true);
    expect(bodies.some((b) => b.limit === 60), "the closure probe reads a page of the slice's own results").toBe(true);
    // And the chips really do render the coverage that exit carries.
    await waitFor(() => expect(visibleText()).toContain("stated on 28%"));
    expect(visibleText()).not.toContain("coverage unknown");
  });

  it("role rows, constraint chips, country chips and the closure record all render measured numbers", async () => {
    wireBoard();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow() };
      if (fn === "get_category_fill_curve") return { data: BOARD_CATEGORY_SLUGS.map((c) => curveRow(c)), error: null };
      if (fn === "get_company_fill_curve") {
        return {
          data: [
            { company_token: "acme", fills_90d: 14, relists_90d: 3, ageouts_90d: 2, tracking_days: 60 },
            { company_token: "globex", fills_90d: 4, relists_90d: 30, ageouts_90d: 0, tracking_days: 60 },
            // initech IN THE SHAPE THE RPC EMITS for an employer we have logged
            // nothing about: a row, with every count zero. readable is 2, not 3.
            { company_token: "initech", fills_90d: 0, relists_90d: 0, ageouts_90d: 0, tracking_days: 60 },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));

    // Open the field. Nothing was probed before this click.
    expect(invoke).not.toHaveBeenCalled();
    (screen.getAllByRole("button", { name: /Data & AI/ })[0]).click();

    // 2. PRICED ROLE ROWS — the count beside a role is the count for that
    //    role's own query, not the field's.
    await waitFor(() => expect(visibleText()).toContain("7,311"));
    expect(visibleText()).toContain("The biggest roles in Data & AI");
    expect(visibleText()).toContain("Role names are ours, not the board's");

    // 3. PRICED CONSTRAINT CHIPS — count AND the live coverage of the column
    //    each one filters on, read out of that chip's own probe response.
    await waitFor(() => expect(visibleText()).toContain("1,204"));
    expect(visibleText()).toContain("stated on 28%");
    expect(visibleText()).toContain("stated on 20%");
    // A chip the server named in ignoredFilters priced a query the click will
    // not run, so it does not render at all.
    expect(visibleText()).not.toContain("One-click apply");
    // AND THE CHIP THAT HIDES THE MOST STATES SO IN WORDS. maxAgeDays binds
    // posted_at, so every posting from a structurally undated vendor is
    // excluded however new it is; coverageDisclosure publishes no key for it,
    // and rendering silence put the page's largest hidden population under a
    // note that reads silence as "we hold no coverage reading".
    expect(visibleText()).toContain("Posted this week");
    expect(visibleText()).toContain("roles carrying the employer's own date only");

    // Country, priced the same way.
    await waitFor(() => expect(visibleText()).toContain("5,002"));
    expect(visibleText()).toContain("United States");

    // 4. THE CLOSURE RECORD — three denominators, three different numbers, and
    //    the gap in our record said as loudly as the finding.
    await waitFor(() => expect(visibleText()).toContain("read the first 5 results for this slice"));
    const text = visibleText();
    expect(text).toContain("found 3 employers among them");
    expect(text).toContain("readable closure record for 2");
    // THE DENOMINATOR THAT MUST NEVER APPEAR. `companiesCount` and the
    // `companies` facet beside it are BOARD-WIDE — measured live, the same
    // 33,545 and the same top row (Domino's, count 34,000) come back for a
    // four-role slice and for the whole board. Printing it as the slice's
    // employer count, or handing its tokens to the curve, is the denominator
    // defect this entire rebuild exists to remove.
    expect(text).not.toContain("33,545");
    expect(text).not.toContain("34,000");
    expect(text).not.toContain("Domino");
    expect(text).toContain("not every employer hiring in the slice");
    expect(text).toContain("1 of those 2 have taken at least 3 roles down");
    expect(visibleLinks().some((h) => h.includes("dominos"))).toBe(false);
    // A CLOSURE NEVER MEANS "HIRED", AND THE CARD SAYS SO RATHER THAN LEAVING
    // A READER TO ASSUME IT. The four causes are indistinguishable to us and
    // the copy names all four.
    expect(text).toContain("not a claim that anyone was hired");
    expect(text).toContain("a cancelled requisition and a retitle look the same to us");
    // The bar is interpolated from the constant, not typed: "at least 3" here
    // and "taking 3 roles down" below must be the same number.
    expect(text).toContain("taking 3 roles down");
    // And the way into the slice at exactly those employers, through the comma
    // list Jobs.tsx already round-trips.
    expect(visibleLinks().some((h) => h.includes("company=acme"))).toBe(true);
    expect(visibleLinks().some((h) => h.includes("globex"))).toBe(false);
  });

  it("a role row that would open a four-result page does not render, and the withholding is said", async () => {
    // SECTION 2 EXISTS TO CHANGE THE SIZE OF WHAT A READER LANDS IN. "database
    // administrator 4" beside "data engineer 2,028" is an honest number
    // attached to a click that reproduces the landing-size defect one grain
    // down, which is the failure this whole rebuild is about.
    invoke.mockImplementation(async (_fn: string, opts?: { body?: Record<string, unknown> }) => {
      const body = ((opts ?? {}) as { body?: Record<string, unknown> }).body ?? {};
      if (body.limit === 60) return { data: { total: 7_311, jobs: [] }, error: null };
      if (body.q === "data analyst") return { data: { total: 2_028 }, error: null };
      if (typeof body.q === "string") return { data: { total: 4 }, error: null };
      return { data: { total: 41_000 }, error: null };
    });
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow({ field_curves: CURVES }) };
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    openField(/Data & AI/);
    await waitFor(() => expect(visibleText()).toContain("2,028"));
    expect(visibleText()).not.toContain("database administrator");
    expect(visibleLinks().some((h) => h.includes("database+administrator"))).toBe(false);
  });

  it("a field where every role is under the floor says THAT, not that nothing matched", async () => {
    // TWO DIFFERENT FACTS, TWO SENTENCES. Letting the floor fall into "none of
    // the role names matched anything" would publish a falsehood about a field
    // that does have those roles in it.
    invoke.mockImplementation(async (_fn: string, opts?: { body?: Record<string, unknown> }) => {
      const body = ((opts ?? {}) as { body?: Record<string, unknown> }).body ?? {};
      if (body.limit === 60) return { data: { total: 90, jobs: [] }, error: null };
      if (typeof body.q === "string") return { data: { total: 4 }, error: null };
      return { data: { total: 90 }, error: null };
    });
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow({ field_curves: CURVES }) };
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    openField(/Data & AI/);
    await waitFor(() => expect(visibleText()).toContain("too few to be worth a page of their own"));
    expect(visibleText()).not.toContain("None of the role names we tried matched");
  });

  it("every /jobs link this page builds carries the way back", async () => {
    // Jobs.tsx renders its "Back to Explore" link only on `from=explore`. The
    // deleted employer cards spelled that param by hand; routing the tiles,
    // role rows, constraint chips and country chips through the shared mapper
    // silently dropped it, and a reader who clicked Engineering landed on a
    // one-way page — the exact dead end the link exists to prevent.
    wireBoard();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow({ field_curves: CURVES }) };
      if (fn === "get_company_fill_curve") return { data: [], error: null };
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    openField(/Data & AI/);
    await waitFor(() => expect(visibleLinks().some((h) => h.includes("workMode") || h.includes("mode=remote"))).toBe(true));
    const boardLinks = visibleLinks().filter((h) => h.startsWith("/jobs?"));
    expect(boardLinks.length).toBeGreaterThan(10);
    for (const h of boardLinks) {
      expect(h, `a /jobs link with no way back: ${h}`).toContain("from=explore");
    }
  });

  it("a probe that failed renders no row at all — never a zero", async () => {
    invoke.mockImplementation(async () => ({ data: null, error: { message: "boom" } }));
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: cacheRow() };
      if (fn === "get_category_fill_curve") return { data: BOARD_CATEGORY_SLUGS.map((c) => curveRow(c)), error: null };
      return { data: [], error: null };
    });
    render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);
    await waitFor(() => expect(visibleText()).toContain("Data & AI"));
    (screen.getAllByRole("button", { name: /Data & AI/ })[0]).click();
    await waitFor(() => expect(visibleText()).toContain("None of the role names we tried matched"));
    // A FAILED MEASUREMENT IS OURS AND SAYS SO — it must never borrow the
    // sentence for a slice with no record in it.
    await waitFor(() => expect(visibleText()).toContain("That is our measurement failing"));
    // No invented counts anywhere in the opened panel.
    expect(visibleText()).not.toMatch(/data analyst\s*0\b/);
  });
});
