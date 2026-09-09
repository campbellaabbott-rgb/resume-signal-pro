/**
 * A FIGURE THE SAME ON EVERY TILE IS NOT A TILE FIGURE.
 *
 * /explore's field grid carried two numbers per tile and neither one told a
 * reader which tile they were looking at.
 *
 *   THE COUNT went through the serving API's COUNT_CAP, so operations
 *   (144,664), healthcare (109,811), the uncategorised bucket (174,535),
 *   hospitality_retail (80,414), sales (77,954) and engineering (73,841) all
 *   rendered as the identical string "10,000+". Six of eighteen tiles, one
 *   string, a 34x spread hidden — under a section header promising the grid was
 *   "ordered by how many roles are open right now", which a reader could not
 *   verify on the six biggest fields.
 *
 *   THE LIFECYCLE LINE was flat by measurement, not by formatting: R(14) spans
 *   0.128–0.243 across all eighteen fields and prints as "up to 16/16/17/17%",
 *   and the medians are 27/28/29/30 — the last four values the estimator can
 *   emit before it censors at FILL_SUPPORT_MAX_DAYS. Twelve tiles, four
 *   strings, one statement.
 *
 * THE RULE THIS GUARD STATES IS THEREFORE A PROPERTY, NOT A SPELLING:
 *
 *   1. NO FIGURE RENDERED ON A TILE MAY BE CARRIED BY A THIRD OF THE GRID. A
 *      figure that a third of the tiles share is a fact about the GRID; it
 *      belongs in one sentence, said once, in the collapsed panel — never
 *      eighteen times on the face, where it costs a line per tile and separates
 *      nothing.
 *
 *   2. A TILE'S COUNT AND THE COUNT ITS DESTINATION PRINTS ARE ONE READING,
 *      NOT TWO THAT AGREE. Both come out of the board's own category facet: one
 *      stored row, one `refreshedAt`, read unfiltered here (the whole map) and
 *      filtered there (the single active entry, via visibleCategories). The
 *      previous arrangement — an hourly explore cache on `7 * * * *` against
 *      board facets on `7,22,37,52 * * * *` — could put a tile fifty-three
 *      minutes out of step with the page it opened, which is the
 *      one-quantity-two-scans defect this page has already had to remove once.
 *
 * BOTH ARE ASSERTED OFF A REAL RENDER, not off the source, because a source
 * check cannot tell a rendered figure from a well-spelled one and this
 * repository has been bitten four times by a guard that matched a COMMENT while
 * the code it described was dead. The source reads that do appear below are
 * taken with comments stripped, for the same reason.
 *
 * AND THE RULE HAS TEETH THAT ARE EXERCISED HERE. `flatFigures` is run against
 * the real grid (must find nothing), against the two mutations that actually
 * shipped — the capped count and the lifecycle line put back on the face (must
 * find both) — and against a two-tile coincidence (must NOT fire, or the rule
 * would forbid two fields from honestly holding the same number).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
// Declared WITH its parameters: a zero-arg vi.fn gives the mock a zero-length
// call tuple, which tsconfig.app.json rejects at every call site that reads
// c[1] — and a bare `tsc --noEmit` does not.
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
import { BOARD_CATEGORY_SLUGS, isBoardCategory } from "../lib/job-board-categories";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
const EXPLORE = strip(readFileSync(resolve(ROOT, "src/pages/Explore.tsx"), "utf8"));
const JOBS = strip(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
const CLUSTERS = strip(readFileSync(resolve(ROOT, "supabase/functions/job-board/clusters.ts"), "utf8"));

// ── THE FIXTURE IS THE LIVE FACET, NOT AN INVENTED ONE ──────────────────────
// Probed against production while this guard was written, one request, one
// `refreshedAt`. Six of these eighteen sit above the serving API's 10,000
// ceiling and five sit below it — without fields on both sides of the cap, an
// assertion that the tiles do not pass through it would be satisfiable by a
// grid that formatted nothing at all.
const FACET: Record<string, number> = {
  operations: 144_664, healthcare: 109_811, hospitality_retail: 80_414,
  sales: 77_954, engineering: 73_841, finance: 34_244, customer: 29_528,
  marketing: 17_272, education: 12_479, people_hr: 11_241, science: 8_534,
  data_ai: 8_029, legal: 7_886, admin: 7_206, product: 7_177,
  security: 6_480, design: 4_230, other: 174_535,
};
const REFRESHED_AT = "2026-09-09T14:07:54.645Z";

/** The facet the board returns for an UNFILTERED list request: the whole map
 *  plus the stamp on the row it came from. */
const facetReply = () => ({
  data: { jobs: [], total: 815_755, categories: { ...FACET }, refreshedAt: REFRESHED_AT },
  error: null,
});

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  rpc.mockImplementation(async () => ({ data: null, error: null }));
  invoke.mockImplementation(async (_fn: string, opts?: { body?: Record<string, unknown> }) => {
    const b = (opts?.body ?? {}) as Record<string, unknown>;
    // Only the unfiltered probe gets the facet — exactly as the board behaves.
    // A filtered request (a role row, a chip) must never see the whole map, or
    // this fixture would hide the very bug it is here to catch.
    // action:"facets" is the page's read now, and the fixture answers ONLY
    // that. The page used to reach the same row through {action:"list",
    // limit:1}, which worked and also wrote a job_board_search_events row on
    // every /explore view (the recency exit logs immediately before returning),
    // biasing the browse denominator with a search nobody performed. If this
    // page ever goes back to `list` for its tile numbers, the facet reply stops
    // arriving and every assertion below fails — which is the intent.
    if (b.action === "facets") return facetReply();
    return { data: { jobs: [], total: 0 }, error: null };
  });
});
afterEach(() => { vi.clearAllMocks(); });

const mount = () => render(<MemoryRouter initialEntries={["/explore"]}><Explore /></MemoryRouter>);

/** The tiles, as the reader sees them: every <li> holding a field expander. */
function tileTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("li")]
    .filter((li) => li.querySelector('button[aria-expanded]'))
    .map((li) => li.querySelector('button[aria-expanded]')?.textContent ?? "");
}

// ── THE RULE, AS CODE ───────────────────────────────────────────────────────

/** A THIRD OF THE GRID. Above this share a figure is describing the grid, not
 *  the tile it sits on, and the page's standing rule sends it to the collapsed
 *  panel to be said once. */
const FLAT_SHARE = 1 / 3;
/** …and never on a coincidence. Two fields may honestly hold the same count,
 *  and a rule that forbade that would be forbidding the truth. Three tiles
 *  sharing one figure is a formatter, not an accident. */
const FLAT_MIN_TILES = 3;

/** Every figure a tile renders: an integer, a decimal, a percentage or a
 *  floor-marked count, in any locale's grouping. Deliberately NOT a list of
 *  known spellings — the point is to catch the next flat figure, not the last
 *  two. */
function figuresOn(text: string): Set<string> {
  return new Set((text.match(/\d[\d.,]*\s?%?\+?/g) ?? []).map((s) => s.trim()));
}

/** THE RULE. Returns every figure carried by at least a third of the tiles. */
export function flatFigures(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const t of texts) for (const f of figuresOn(t)) seen.set(f, (seen.get(f) ?? 0) + 1);
  const bar = Math.max(FLAT_MIN_TILES, Math.ceil(texts.length * FLAT_SHARE));
  return [...seen.entries()].filter(([, n]) => n >= bar).map(([f]) => f).sort();
}

describe("no figure on a tile may be the same figure on every other tile", () => {
  it("the real grid carries no flat figure at all", async () => {
    const { container } = mount();
    await waitFor(() => expect(tileTexts(container).length).toBe(BOARD_CATEGORY_SLUGS.length + 1));
    const texts = tileTexts(container);
    // Every tile must actually render something, or an empty grid would pass.
    for (const t of texts) expect(t.trim().length).toBeGreaterThan(0);
    expect(
      flatFigures(texts),
      "a figure is being repeated across the grid — it belongs in the collapsed panel, said once",
    ).toEqual([]);
  });

  it("TEETH: the capped count that shipped is caught", async () => {
    const { container } = mount();
    await waitFor(() => expect(tileTexts(container).length).toBeGreaterThan(0));
    // The mutation, exactly as it rendered: every count at or above the serving
    // API's ceiling formatted through it.
    const CAP = 10_000;
    const mutated = tileTexts(container).map((t, i) => {
      const id = Object.keys(FACET)[i] ?? "";
      const n = FACET[id] ?? 0;
      return n >= CAP ? `${t} 10,000+` : t;
    });
    expect(flatFigures(mutated), "the rule no longer catches the capped count").toContain("10,000+");
  });

  it("TEETH: the lifecycle line put back on the face is caught", async () => {
    const { container } = mount();
    await waitFor(() => expect(tileTexts(container).length).toBeGreaterThan(0));
    // The retired sentence at its real spread: "up to 17%" on most of the grid,
    // "30-day closure log" on all of it.
    const mutated = tileTexts(container).map((t, i) =>
      `${t} up to ${i % 4 < 2 ? 17 : 16}% were gone within 14 days · 30-day closure log`);
    const flat = flatFigures(mutated);
    expect(flat, "the rule no longer catches a flat lifecycle figure").toContain("30");
    expect(flat).toContain("14");
  });

  it("TEETH IN THE OTHER DIRECTION: two fields honestly holding the same count is not a violation", () => {
    // A rule that fired here would be forbidding the truth: nothing stops two
    // fields from having the same number of open roles.
    const texts = ["Design 4,230", "Security 4,230", "Sales 77,954", "Admin 7,206",
      "Legal 7,886", "Product 7,177", "Science 8,534", "Data & AI 8,029"];
    expect(flatFigures(texts)).toEqual([]);
  });
});

describe("a tile's number and its destination's number are one reading", () => {
  it("the tile number is the board's own category facet, read UNFILTERED", async () => {
    const { container } = mount();
    await waitFor(() => expect(tileTexts(container).length).toBeGreaterThan(0));

    const bodies = invoke.mock.calls
      .map((c) => (c[1]?.body ?? {}) as Record<string, unknown>)
      .filter((b) => b.action === "facets");
    expect(bodies.length, "the page never asked the board for the facet").toBeGreaterThan(0);
    const facetCall = bodies[0];
    // MECHANICAL, NOT A NAMED DENYLIST. The edge function hands this exit's
    // facet through visibleCategories with unfiltered=true, so the request must
    // carry nothing that could be read as a filter — `action` and nothing else.
    expect(
      Object.keys(facetCall).filter((k) => k !== "action"),
      "the facet request carries something other than the action",
    ).toEqual([]);
    // AND IT MUST NOT BE A BROWSE. A `list` call from this page is the shape
    // that logged a synthetic zero-query search event per view.
    expect(
      invoke.mock.calls.map((c) => (c[1]?.body ?? {}) as Record<string, unknown>)
        .filter((b) => b.action === "list").length,
      "the page is browsing the board to read its tile numbers again",
    ).toBe(0);

    // …and the numbers on screen are that reply's, exactly, uncapped.
    const texts = tileTexts(container).join(" ");
    expect(texts).toContain("144,664");
    expect(texts).toContain("73,841");
    expect(texts).toContain("4,230");
    expect(texts, "a tile is still rendering the serving cap").not.toContain("10,000+");
  });

  it("the destination prints that same facet entry, out of the same row", () => {
    // THE BOARD'S HALF. visibleCategories publishes the whole map for an
    // unfiltered request and the single ACTIVE category for a filtered one —
    // "scoped to exactly what the reader filtered, so it cannot overstate".
    // Both come off one `categoriesFacet`.
    expect(CLUSTERS).toMatch(/export function visibleCategories/);
    expect(CLUSTERS).toMatch(/if \(unfiltered\) return facet \?\? \{\};/);
    expect(CLUSTERS).toMatch(/const n = facet\[activeCategory\];/);
    // THE DESTINATION'S HALF. /jobs/field/:id renders that entry in its count
    // line, in preference to the capped total.
    // countCategory, not landerCategory: the same facet entry, reached whenever
    // a single category is the ONLY filter rather than only when a ROUTE PARAM
    // produced it. Keying on the route param left /jobs?category=other — the
    // uncategorised tile's destination, which has no lander route — printing
    // the board-wide total over a 174,535-row filtered list.
    expect(JOBS, "the field lander no longer prints the facet entry")
      .toMatch(/data\?\.categories\?\.\[countCategory\]/);
    expect(JOBS, "the exact count is keyed on the route param again, so the bucket loses it")
      .toMatch(/const countCategory = useMemo/);
    // THIS PAGE'S HALF. The tile reads `categories` off a list reply and
    // nothing else; the stamp it publishes is that reply's own refreshedAt.
    expect(EXPLORE).toMatch(/r\?\.categories/);
    expect(EXPLORE).toMatch(/refreshedAt/);
  });

  it("the tile link lands on the page that prints that number", async () => {
    const { container } = mount();
    await waitFor(() => expect(tileTexts(container).length).toBeGreaterThan(0));
    const lis = [...container.querySelectorAll("li")].filter((li) => li.querySelector("button[aria-expanded]"));
    let landers = 0;
    for (const li of lis) {
      const href = li.querySelector("a")?.getAttribute("href") ?? "";
      const m = href.match(/^\/jobs\/field\/([a-z_]+)\?/);
      if (m) {
        // A slug the lander's own predicate refuses would fall through to the
        // generic board, whose hero prints the BOARD-WIDE total.
        expect(isBoardCategory(m[1]), `${m[1]} is not a lander slug`).toBe(true);
        landers += 1;
      }
      expect(href, "a tile link lost the way back to Explore").toContain("from=explore");
    }
    expect(landers, "field tiles are not routed to their landers").toBe(BOARD_CATEGORY_SLUGS.length);
    // …and the one tile with no LANDER still carries its figure, because its
    // destination prints that figure back.
    //
    // THIS ASSERTION IS INVERTED FROM ITS FIRST FORM, and the inversion is the
    // fix rather than a loosening. The rule was never "the bucket gets no
    // number" — it was "no number without a destination that prints it", and
    // /jobs?category=other was printing the board-wide 815,909 over a
    // 174,535-row filtered list. That was fixed at the destination (Jobs.tsx
    // countCategory reads the response's own facet entry whenever a single
    // category is the only filter, route param or not), so the condition the
    // original rule required is now met and the tile may speak. The rule itself
    // is enforced above, on the destination.
    const uncat = lis.find((li) => (li.querySelector("a")?.getAttribute("href") ?? "").includes("category=other"));
    expect(uncat, "the uncategorised tile is gone").toBeTruthy();
    const uncatText = uncat!.querySelector("button[aria-expanded]")?.textContent ?? "";
    expect(
      uncatText,
      "the uncategorised tile lost the count its destination prints",
    ).toContain(FACET.other.toLocaleString("en-US"));
  });

  it("the hourly explore cache is not a second source for a tile number", async () => {
    // ONE QUANTITY, ONE SCAN. The cache still exists and still carries a
    // `fields` map; reading it here would put a tile up to fifty-three minutes
    // out of step with the page it opens. So a cache row carrying WRONG numbers
    // must change nothing on the grid.
    rpc.mockImplementation(async (fn: string) => (fn === "get_explore_cache"
      ? { data: { fields: { engineering: 1, healthcare: 2 }, field_grid: { tiled_n: 3, board: { n: 4 } }, computed_at: "2026-09-09T13:07:00Z" }, error: null }
      : { data: null, error: null }));
    const { container } = mount();
    await waitFor(() => expect(tileTexts(container).join(" ")).toContain("73,841"));
    const texts = tileTexts(container).join(" ");
    expect(texts).toContain("109,811");
    expect(texts).not.toMatch(/\b1\b/);
    // And the source cannot quietly re-acquire the habit.
    expect(EXPLORE, "the tiles are reading the explore cache again").not.toMatch(/c\.fields/);
    expect(EXPLORE, "the reach pair is being read from the explore cache again").not.toMatch(/c\.field_grid/);
    for (const part of ["fields", "field_grid", "field_curves", "totals"]) {
      expect(EXPLORE, `${part} is read by nothing here and must not raise a staleness warning`)
        .toMatch(new RegExp(`"${part}"`));
    }
  });
});

describe("the field-grain lifecycle claim left the page, and its computation with it", () => {
  it("nothing here reads the field curve or the bar that gated it", () => {
    expect(EXPLORE, "the field curve is being fetched again").not.toMatch(/get_category_fill_curve/);
    expect(EXPLORE, "the field-grain estimator is back").not.toMatch(/fieldLifecycleOf/);
    // The bar was imported so this page and /jobs could not publish and refuse
    // the same evidence under two copies of one gate. With no fill claim here
    // there is nothing to gate, so the import's RETURN is the signal that a
    // claim came back — not a spelling to be preserved.
    for (const name of ["canStateFillRate", "coverageBand", "FILL_COVERAGE_MIN",
      "FILL_RATE_MIN_TRACKING_DAYS", "URGENT_FILL_MAX_DAYS"]) {
      expect(EXPLORE, `${name} is imported again — a fill claim has returned to /explore`)
        .not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    // /jobs still owns and applies the bar. This guard removes a claim from one
    // page; it must not be read as permission to loosen the other.
    expect(JOBS).toMatch(/export function canStateFillRate/);
    expect(JOBS).toMatch(/FILL_RATE_MIN_TRACKING_DAYS/);
  });

  it("the retired copy is gone from ALL NINE locales, not just English", () => {
    // A locale VALUE overrides an inline English default. A key left behind
    // goes on rendering the retired claim in the eight languages nobody
    // reviewing this diff can read.
    const RETIRED = [
      "fieldCurveSlow", "fieldCurveLoading", "fieldCurveDeferred", "fieldCurveAbsent",
      "fieldCurveWindow", "fieldCurveThin", "fieldCurveMedian2", "fieldCurveCensored2",
      "fieldCurveCoverage", "subhead4", "asOfCounts2", "staleAge", "fieldsBlurb2",
      "fieldsReachWhole", "fieldsReach", "methodTileMethod", "methodLifecycleTerm",
      "methodLifecycleMethod", "methodUncatMethod", "uncatLine",
      // …and the round the design review added. basisWhole/basisPartial spelled
      // "eighteen fields" as a translated literal (counting the bucket the
      // method panel says is not a field, and unable to move when a slug is
      // added) and claimed a board total /jobs publishes from a different,
      // separately-patched field. uncatLine2 and methodUncatMethod2 both said
      // the bucket's tile carries no count, which stopped being true when its
      // destination started printing that count. methodNamesMethod did not say
      // the role names stay in English on purpose.
      "basisWhole", "basisPartial", "uncatLine2", "methodUncatMethod2",
      "methodNamesMethod",
      // …and the 2026-09-09 round, now that the locale pass has landed in all
      // nine. Every one lost its call site because its MEANING changed, not its
      // wording: the three basis sentences, the bucket's row note, its role-list
      // refusal and its method entry all said the bucket held "the roles whose
      // field we could not read from the title" (or a variant), which blames the
      // employer's title for a coverage gap in OUR OWN rule set — categorize()
      // returns "other" when no regex of ours matched, and that vocabulary is
      // frozen at v9 by design. methodTileTerm went with the grid it named.
      "basisWhole2", "basisPartial2", "basisCarried", "uncatLine3", "rolesUncat",
      "methodUncatTerm", "methodUncatMethod3", "methodTileTerm",
      // …and the two the review round split or corrected. barBasis named the
      // largest BUCKET's count and the smallest field's and then printed a
      // ratio computed from neither pair together, so the arithmetic in front
      // of the reader did not reach the number beside it; it is now two keys,
      // each naming its own terms. methodNamesMethod2 said the role counts were
      // "taken at the moment you click", which the per-field price cache made
      // false for every reopen inside its window.
      "barBasis", "methodNamesMethod2",
    ];
    const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
    for (const loc of LOCALES) {
      const j = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${loc}.json`), "utf8")) as
        { explore?: Record<string, unknown> };
      const ex = j.explore ?? {};
      for (const k of RETIRED) {
        expect(ex, `${loc}.json still renders the retired claim under explore.${k}`).not.toHaveProperty(k);
      }
      // …and every sentence the redesign DOES say exists in that locale, or
      // seven languages fall back to English for the page's only date basis.
      for (const k of ["basisCarriedWhen", "basisNone", "fieldsBlurb3", "fieldsBlurb4",
        "methodTileMethod3", "methodNamesTerm", "methodNamesMethod3",
        "methodLiveTerm", "methodLiveMethod"]) {
        expect(ex, `${loc}.json is missing explore.${k}`).toHaveProperty(k);
      }
      // …and the sentences the row rewrite minted, in ALL NINE. They were held
      // to en/en-GB for the length of the translation window; the window is
      // closed, and a guard left at that strength could never report the next
      // missing key — delete barBasisAnchor from de.json and a file whose whole
      // subject is a figure that does not vary would have stayed green.
      for (const k of ["basisWhole3", "basisPartial3", "basisCarried2",
        "barBasisAnchor", "barBasisSpread",
        "barsNone", "halfLine", "otherRowNote", "rolesUncat2", "methodBarTerm",
        "methodBarMethod", "methodRowTerm", "methodUncatTerm2", "methodUncatMethod4"]) {
        expect(ex, `${loc}.json is missing explore.${k}`).toHaveProperty(k);
      }
    }
  });

  it("the one sentence above the fold carries the date basis for all eighteen numbers", async () => {
    const { container } = mount();
    await waitFor(() => expect(tileTexts(container).length).toBeGreaterThan(0));
    const head = container.querySelector("main > div")?.textContent ?? "";
    // The population, from the same map every tile number came from…
    const all = Object.values(FACET).reduce((a, b) => a + b, 0);
    expect(head).toContain(all.toLocaleString("en-US"));
    // …and the stamp on the row it came out of. A count with no date basis is
    // the claim this page refuses to publish.
    expect(head).toMatch(/2026/);
  });
});
