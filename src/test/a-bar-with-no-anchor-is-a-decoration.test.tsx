/**
 * A BAR WITH NO ANCHOR IS A DECORATION, AND A SLICE WITH NO ADDRESS IS LOST.
 *
 * /explore's field grid printed eighteen exact counts in 12px muted grey — the
 * faintest thing on a tile whose whole job was to separate tiles by that
 * number — laid out two-up, so the 34x spread between the deepest field and the
 * shallowest (operations 143,092 against design 4,236, measured 2026-09-09) was
 * something a reader had to compute from eighteen integers rather than see.
 *
 * The grid is a single-column list now, and each row carries a bar. That buys
 * three ways to publish a falsehood, and this file guards all three:
 *
 *   1. THE ANCHOR. A bar length is meaningless until the reader knows what 100%
 *      is. Anchored at the BOARD TOTAL every bar is a sliver (the largest is
 *      ~21%) and the comparison disappears; anchored at the largest FIELD the
 *      uncategorised bucket — which is bigger than any field — OVERFLOWS ITS
 *      OWN TRACK by 122%. The only honest anchor is the max over all eighteen
 *      buckets, and it must be named on the page in words.
 *
 *   2. THE TRANSFORM. log10 would draw Design at about 71% of Operations'
 *      length, and a minimum-width floor would prop the smallest fields up —
 *      both overstate the small end, which is exactly the direction this page
 *      exists to stop copy drifting in. Linear, from zero, no floor.
 *
 *   3. THE DERIVATION. Every number in the two sentences that explain the bars
 *      — the anchor, the smallest field, the ratio, and the count of fields
 *      holding half the board — has to come from the SAME facet map the bars
 *      are drawn from, in the same render. A literal "three" in "these three
 *      fields hold more than half" is how a page goes on saying three in nine
 *      languages after the facet moves, and this facet moves four times an hour.
 *
 * AND THE READER'S SLICE NOW HAS AN ADDRESS. openField and role were React
 * state with no URL, so ~23 edge invocations of assembled slice could not be
 * shared, a reload discarded it, and Back left the page rather than closing the
 * panel. `f` and `r` ride beside `i` — which opens a fourth way to publish a
 * falsehood, guarded below: an `r` read off the URL is handed to the board as a
 * free-text `q`, so without a MEMBERSHIP test a stranger's link would make this
 * page render a live count for any string they chose, under a heading reading
 * "The biggest roles in Healthcare".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

import Explore, { FIELD_ROLES } from "../pages/Explore";
import { BOARD_CATEGORY_SLUGS } from "../lib/job-board-categories";

const ROOT = resolve(__dirname, "../..");
/** Comments are not code. This repository has shipped four guards whose
 *  required literal was satisfied by a sentence in a nearby comment, and every
 *  block this change touches is heavily commented — so every source assertion
 *  below reads the stripped text. */
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
const EXPLORE_RAW = readFileSync(resolve(ROOT, "src/pages/Explore.tsx"), "utf8");
const EXPLORE = strip(EXPLORE_RAW);
const JOBS_RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = strip(JOBS_RAW);
const PRERENDER = strip(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));

// ── THE FIXTURE IS THE LIVE FACET, AND ITS PROVENANCE REPRODUCES ────────────
// Read 2026-09-09T16:56:51Z, facetsCarried false: 18 keys summing to 814,026,
// of which SIXTEEN were reported individually. `legal` and `admin` are the two
// that were not, and they are PLACEHOLDERS: 7,600 and 7,398 are chosen so the
// fixture's own sum is the reported 814,026 and its field total the reported
// 639,424, and so both sit inside the reported range as the two unlisted
// buckets do. They are not readings and nothing here presents them as one.
//
// This paragraph is the fixture's date basis and its population, and it is
// written to RECONCILE: add the eighteen values below and you get the number
// this comment claims and the number facetReply hands the page. An earlier
// draft claimed the same provenance over a pair invented without arithmetic,
// so the object summed to 819,529 while the sentence above it said 814,026 —
// the exact defect this file guards a page against, inside the guard.
//
// The properties that make it usable as a fixture are real properties of this
// board and not conveniences: the largest BUCKET (`other`, 174,602) is larger
// than the largest FIELD (operations, 143,092), which is the whole reason the
// anchor cannot be the largest field; and the seventeen fields span 34x, which
// is the quantity the bars exist to show.
const FACET: Record<string, number> = {
  other: 174_602, operations: 143_092, healthcare: 111_732, hospitality_retail: 80_291,
  sales: 77_238, engineering: 73_573, finance: 34_113, customer: 29_476,
  marketing: 17_178, education: 12_383, people_hr: 11_224, science: 8_330,
  data_ai: 8_013, legal: 7_600, admin: 7_398, product: 7_145,
  security: 6_402, design: 4_236,
};
const FACET_TOTAL = Object.values(FACET).reduce((a, b) => a + b, 0);
const REFRESHED_AT = "2026-09-09T16:56:51.000Z";

const FIELDS = Object.entries(FACET).filter(([k]) => k !== "other");
const FIELDS_TOTAL = FIELDS.reduce((s, [, n]) => s + n, 0);
const LARGEST_BUCKET = Math.max(...Object.values(FACET));
const LARGEST_FIELD = Math.max(...FIELDS.map(([, n]) => n));
const SMALLEST_FIELD = Math.min(...FIELDS.map(([, n]) => n));

const facetReply = (categories: Record<string, number> = FACET) => ({
  data: { jobs: [], total: FACET_TOTAL, categories: { ...categories }, refreshedAt: REFRESHED_AT },
  error: null,
});

/** Answers the facet read and prices every probe with a distinct, plausible
 *  count, so a panel that opens actually renders rows and chips. */
const wire = (facet: Record<string, number> | null = FACET) => {
  invoke.mockImplementation(async (_fn: string, opts?: { body?: Record<string, unknown> }) => {
    const b = (opts?.body ?? {}) as Record<string, unknown>;
    if (b.action === "facets") return facet === null ? { data: null, error: { message: "down" } } : facetReply(facet);
    if (b.limit === 60) return { data: { jobs: [], total: 0 }, error: null };
    return { data: { total: 3_140, filterCoverage: { workMode: 0.23, country: 0.91 } }, error: null };
  });
  rpc.mockImplementation(async () => ({ data: [], error: null }));
};

const mount = (path = "/explore") => {
  window.history.replaceState({}, "", path);
  return render(<MemoryRouter initialEntries={[path]}><Explore /></MemoryRouter>);
};

/** Every FIELD ROW: a list item carrying an expander. The half-line rule is a
 *  presentational <li> and is deliberately not one of these. */
const rows = () => [...document.querySelectorAll("li")].filter((li) => li.querySelector("button[aria-expanded]"));
const rowFor = (id: string) => document.getElementById(`field-${id}`);
/** The bar's FILL for a row, as a percentage number, or null when the row draws
 *  no track at all. */
const fillPct = (li: Element | null): number | null => {
  const track = li?.querySelector('[aria-hidden="true"]');
  const fill = track?.firstElementChild as HTMLElement | null;
  if (!fill) return null;
  const m = /([\d.]+)%/.exec(fill.style.width ?? "");
  return m ? Number(m[1]) : null;
};
const pageText = () => document.body.textContent ?? "";

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  window.history.replaceState({}, "", "/explore");
  wire();
});
afterEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe("the grid became the panel — one column, one row per bucket", () => {
  it("renders a single-column ordered list, not a two-up grid", async () => {
    const { container } = mount();
    await waitFor(() => expect(rows().length).toBe(BOARD_CATEGORY_SLUGS.length + 1));
    // AN <ol>, BECAUSE THE ORDER IS THE CLAIM the section header makes.
    const list = container.querySelector("ol");
    expect(list, "the rows are not an ordered list").toBeTruthy();
    expect(list!.className, "the rows are still laid out as a multi-column grid")
      .not.toMatch(/grid-cols-2|sm:grid-cols-2/);
    expect(EXPLORE, "the two-up grid is back on the field rows")
      .not.toMatch(/<ul className="grid grid-cols-1 sm:grid-cols-2/);
    // NO SUMMARY STRIP ABOVE THE LIST. A panel over a ranked list of the same
    // eighteen numbers is two renderings of one quantity on one screen, which
    // is the defect this page spent a hundred lines removing for the counts.
    // The only aggregate above the rows is the population sentence and the one
    // line that explains the bar scale; neither repeats a per-field count.
    // THE THREE EXCEPTIONS ARE THE SENTENCES' OWN TERMS, and they are the
    // reason those sentences exist: a bar scale is unreadable until the reader
    // is told what 100% is (the anchor bucket) and what the shortest mark is
    // worth, and a RATIO is uncheckable until both of ITS terms are on the
    // page. The largest FIELD's count is the third, and it was added
    // deliberately rather than left out: the sentence divides it by the
    // smallest field, and printing "34 times deeper" beside the bucket's count
    // and the smallest field's invited a reader to divide those two and get 41.
    // A number rendered twice from ONE reading is a smaller cost than a ratio
    // whose numerator appears nowhere — and the house rule these three are
    // weighed against is that a quantity comes from one SCAN, which it does.
    // Every OTHER field's count must still appear exactly once on this screen,
    // on its own row.
    const head = container.querySelector("main > div")?.textContent ?? "";
    const named = new Set([LARGEST_BUCKET, SMALLEST_FIELD, LARGEST_FIELD]);
    for (const [id, n] of FIELDS) {
      if (named.has(n)) continue;
      expect(head, `${id}'s count is printed above the rows as well as on its row`)
        .not.toContain(n.toLocaleString("en-US"));
    }
  });

  it("the count is the loudest thing on the row, not the faintest", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const li = rowFor("operations")!;
    const spans = [...li.querySelectorAll("span")];
    const count = spans.find((s) => s.textContent === LARGEST_FIELD.toLocaleString("en-US"));
    expect(count, "the row does not print its exact count").toBeTruthy();
    // 18px semibold foreground — it moved off 12px muted, which was the faintest
    // mark on a tile that exists to differentiate by exactly this number.
    expect(count!.className).toMatch(/text-\[18px\]/);
    expect(count!.className).toMatch(/font-semibold/);
    expect(count!.className).toMatch(/text-foreground/);
    expect(count!.className, "a count that can wobble between rows is not comparable")
      .toMatch(/tabular-nums/);
    expect(count!.className, "the count is muted again").not.toMatch(/text-muted-foreground/);
    // The field name is on the same line, at 15px semibold.
    const name = spans.find((s) => s.textContent === "Operations & Logistics");
    expect(name!.className).toMatch(/text-\[15px\]/);
    // …and the role names are the third line, at 11px, full opacity.
    const roleLine = spans.find((s) => s.textContent?.startsWith("operations manager"));
    expect(roleLine, "the row does not name the roles inside the field").toBeTruthy();
    expect(roleLine!.className).toMatch(/text-\[11px\]/);
  });
});

describe("the anchor is the largest BUCKET, and the page says so in words", () => {
  it("the longest bar is exactly full, and it belongs to the bucket", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    // The uncategorised bucket is the largest thing on this board, so it is the
    // 100% mark. Anchored at the largest FIELD it would be 122% — a bar that
    // cannot be drawn inside its own track.
    expect(LARGEST_BUCKET).toBe(FACET.other);
    expect(FACET.other / LARGEST_FIELD).toBeGreaterThan(1);
    expect(fillPct(rowFor("other"))).toBeCloseTo(100, 6);
    for (const [id, n] of Object.entries(FACET)) {
      const pct = fillPct(rowFor(id));
      expect(pct, `${id} draws no bar`).not.toBeNull();
      expect(pct!, `${id}'s bar overflows its track`).toBeLessThanOrEqual(100);
      expect(pct!, `${id}'s bar is not n/anchor`).toBeCloseTo((n / LARGEST_BUCKET) * 100, 6);
    }
  });

  it("the anchor is NOT the board total and NOT the largest field", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const boardTotal = Object.values(FACET).reduce((a, b) => a + b, 0);
    const ops = fillPct(rowFor("operations"))!;
    // Anchored at the board total, operations would be ~17.6% and every bar
    // would be a sliver; anchored at the largest field it would be exactly 100.
    expect(ops).not.toBeCloseTo((LARGEST_FIELD / boardTotal) * 100, 3);
    expect(ops).not.toBeCloseTo(100, 3);
    expect(ops).toBeCloseTo((LARGEST_FIELD / LARGEST_BUCKET) * 100, 6);
  });

  it("linear from zero — no log, no sqrt, and no minimum width", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const design = fillPct(rowFor("design"))!;
    const ops = fillPct(rowFor("operations"))!;
    // THE TEETH. Under log10 the shortest bar would sit at ~71% of the longest;
    // under sqrt at ~17%. Linear puts it at 3.0% of the anchor and 3.0% of
    // Operations' own length, which is the 34x spread made visible.
    expect(design).toBeCloseTo((SMALLEST_FIELD / LARGEST_BUCKET) * 100, 6);
    const logShare = (Math.log10(SMALLEST_FIELD) / Math.log10(LARGEST_BUCKET)) * 100;
    const sqrtShare = (Math.sqrt(SMALLEST_FIELD) / Math.sqrt(LARGEST_BUCKET)) * 100;
    expect(design, "the scale is logarithmic — the spread is being hidden").not.toBeCloseTo(logShare, 1);
    expect(design, "the scale is a square root — the spread is being softened").not.toBeCloseTo(sqrtShare, 1);
    expect(design / ops).toBeCloseTo(SMALLEST_FIELD / LARGEST_FIELD, 6);
    // NO FLOOR. A min-width would make the smallest fields lie in exactly the
    // direction this page exists to stop them lying in, so the shortest bar is
    // allowed to be a few pixels.
    expect(design).toBeLessThan(4);
    expect(EXPLORE, "a minimum bar width is back").not.toMatch(/minWidth|min-w-\[\d/);
    expect(EXPLORE, "the bar is being transformed rather than scaled")
      .not.toMatch(/Math\.(log|log10|sqrt|pow)\(/);
  });

  it("the bucket's bar is not drawn as a field", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const fillOf = (id: string) =>
      (rowFor(id)!.querySelector('[aria-hidden="true"]')!.firstElementChild as HTMLElement).className;
    // It is the longest mark on the page and it is not a field; drawing it in
    // the field colour would present our own vocabulary's coverage gap as the
    // board's biggest field.
    expect(fillOf("other")).toMatch(/bg-muted-foreground\/40/);
    expect(fillOf("other"), "the bucket's bar reads as a field").not.toMatch(/bg-primary/);
    expect(fillOf("operations")).toMatch(/bg-primary/);
    // …and it is still pinned last, whatever its size.
    expect(rows()[rows().length - 1].id).toBe("field-other");
  });

  it("the bar is hidden from assistive tech, because the count beside it is better", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const track = rowFor("design")!.querySelector('[aria-hidden="true"]');
    expect(track, "the bar is not hidden from a screen reader").toBeTruthy();
    expect(track!.textContent, "the bar carries text of its own").toBe("");
  });
});

describe("the two sentences are derived, in one render, from the map the bars use", () => {
  it("the bar sentences name the anchor, the shortest field and the spread — all measured", async () => {
    const { container } = mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const head = container.querySelector("main > div")!.textContent ?? "";
    expect(head).toContain(LARGEST_BUCKET.toLocaleString("en-US"));
    expect(head).toContain(SMALLEST_FIELD.toLocaleString("en-US"));
    // RATIO COMPARES LIKE WITH LIKE: largest FIELD against smallest FIELD. The
    // bucket is not a field, and dividing it by Design would be comparing our
    // vocabulary's coverage gap with a job market.
    const ratio = Math.round(LARGEST_FIELD / SMALLEST_FIELD);
    expect(ratio).toBe(34);
    expect(head).toContain(`${ratio} times deeper`);
    const bucketRatio = Math.round(LARGEST_BUCKET / SMALLEST_FIELD);
    expect(bucketRatio).not.toBe(ratio);
    expect(head, "the spread divides the bucket by a field").not.toContain(`${bucketRatio} times deeper`);
    // …AND THE RATIO'S OWN NUMERATOR IS ON THE PAGE. This is the assertion that
    // was missing: the sentence named the BUCKET's count and the smallest
    // field's, then printed a ratio computed from neither pair together, so a
    // reader who divided the two numbers in front of them got 41 where the page
    // said 34. Both halves were true and the arithmetic between them could not
    // be followed, which on this page is the whole failure. The largest FIELD's
    // count has to be printed too, or the number 34 has nothing behind it that
    // a reader can reach.
    expect(head, "the ratio's numerator — the largest FIELD's count — is never printed")
      .toContain(LARGEST_FIELD.toLocaleString("en-US"));
    // …and it says the scale in words, because a reader cannot see "linear".
    expect(head).toContain("linear and starts at zero");
  });

  it("one field and a bucket still get an anchor sentence, not two unexplained bars", async () => {
    // THE DECORATION STATE THIS FILE IS NAMED AFTER, ARRIVED AT BY GATING TOO
    // WIDE. The ratio and the half-line need two FIELDS and are rightly silent
    // below that; the ANCHOR needs one number. Gating all of it on the spread
    // meant a facet carrying the bucket and a single field drew two bars of
    // visibly different lengths with no anchor named, no ratio, and no
    // retraction — a scale the reader cannot recover, in the one state where
    // they most need it named.
    wire({ other: 174_602, operations: 143_092 });
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const head = document.querySelector("main > div")!.textContent ?? "";
    expect(head, "the anchor is not named when only one field carries a count")
      .toContain((174_602).toLocaleString("en-US"));
    expect(head).toContain("linear and starts at zero");
    // …and the two-terms rule still holds for the halves that need two terms.
    expect(head, "a ratio is published over a single field").not.toContain("times deeper");
    expect(document.querySelectorAll('li[role="presentation"]').length,
      "a half-line is drawn over a single field").toBe(0);
    // The bars themselves are still drawn — there IS a count and an anchor.
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it("the half-line is one presentational row, placed where the count actually crosses half", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const marks = [...document.querySelectorAll<HTMLElement>('li[role="presentation"]')];
    expect(marks.length, "the half-line is not exactly one non-item row").toBe(1);

    // THE EXPECTED SPLIT, COMPUTED HERE FROM THE SAME FIXTURE THE PAGE WAS
    // GIVEN — never retyped, or this guard would pin today's facet instead of
    // the arithmetic.
    const ordered = [...FIELDS].sort((a, b) => b[1] - a[1]);
    let above = 0;
    let k = 0;
    for (const [, n] of ordered) { above += n; k += 1; if (above * 2 > FIELDS_TOTAL) break; }
    const rest = ordered.length - k;
    const text = marks[0].textContent ?? "";
    expect(text).toContain(`These ${k} fields`);
    expect(text).toContain(above.toLocaleString("en-US"));
    expect(text).toContain(FIELDS_TOTAL.toLocaleString("en-US"));
    expect(text).toContain(`other ${rest} fields`);
    expect(text).toContain((FIELDS_TOTAL - above).toLocaleString("en-US"));
    // THE DENOMINATOR IS THE SEVENTEEN FIELDS, NOT THE BOARD. "the roles whose
    // field we could sort" is precisely what the bucket is not, so counting it
    // in either half would make the sentence false in both.
    const boardTotal = Object.values(FACET).reduce((a, b) => a + b, 0);
    expect(FIELDS_TOTAL).toBeLessThan(boardTotal);
    expect(text, "the half-line counts the bucket as a sortable role")
      .not.toContain(boardTotal.toLocaleString("en-US"));

    // AND IT SITS AFTER THE ROW THAT CROSSED, not at a fixed index.
    const all = [...document.querySelectorAll<HTMLElement>("li")];
    const at = all.indexOf(marks[0] as HTMLElement);
    expect(all[at - 1].id, "the rule is not after the row that crossed half").toBe(`field-${ordered[k - 1][0]}`);
  });

  it("k is never a literal — a facet that moves moves the half-line with it", async () => {
    // THE TEETH FOR THE PROPERTY THAT MATTERS MOST HERE. A hardcoded "three"
    // survives a facet change in nine languages with every guard green, and
    // this facet is recomputed four times an hour. Drive a DIFFERENT board and
    // the sentence has to say something different.
    const flat: Record<string, number> = { other: 50_000 };
    for (const s of BOARD_CATEGORY_SLUGS) flat[s] = 10_000;
    wire(flat);
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const text = document.querySelector('li[role="presentation"]')?.textContent ?? "";
    // Seventeen equal fields: half is crossed at the ninth.
    expect(text).toContain("These 9 fields");
    expect(text).toContain("other 8 fields");
    expect(text).toContain((90_000).toLocaleString("en-US"));
    expect(EXPLORE_RAW, "the half-line's field count is spelled rather than interpolated")
      .toMatch(/explore\.halfLine", "These \{\{k\}\} fields/);
  });

  it("no counts, no bars at all — an empty track would read as zero", async () => {
    wire(null);
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain("could not read the board's field counts"));
    await waitFor(() => expect(rows().length).toBe(BOARD_CATEGORY_SLUGS.length + 1));
    for (const li of rows()) {
      expect(li.querySelector('[aria-hidden="true"]'), `${li.id} draws a track with nothing behind it`).toBeNull();
    }
    // The retraction is stated, exactly as fieldsBlurb4 retracts the ordering.
    expect(pageText()).toContain("no bars either");
    // …and no half-line, because there is no cumulative count to cross.
    expect(document.querySelectorAll('li[role="presentation"]').length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the reader's slice has an address", () => {
  it("opening a row writes f, and ONE Back closes the panel", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const before = window.history.length;
    act(() => { (rowFor("healthcare")!.querySelector("button[aria-expanded]") as HTMLButtonElement).click(); });
    await waitFor(() => expect(pageText()).toContain("The biggest roles in"));
    expect(new URLSearchParams(window.location.search).get("f")).toBe("healthcare");
    // pushState, not replaceState: the panel is a place, and Back must return
    // from it before it leaves the page.
    expect(window.history.length, "opening a row added no history entry").toBeGreaterThan(before);
    expect(EXPLORE).toMatch(/window\.history\.pushState\(null, "", href\)/);
    // …and closing it by clicking again does NOT push, or the reader has to
    // unwind a stack key by key to get off the page.
    act(() => { (rowFor("healthcare")!.querySelector("button[aria-expanded]") as HTMLButtonElement).click(); });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("f")).toBeNull());
  });

  it("popstate is LISTENED FOR, not assumed — pushState does not notify the router", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    act(() => { (rowFor("design")!.querySelector("button[aria-expanded]") as HTMLButtonElement).click(); });
    await waitFor(() => expect(rowFor("design")!.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("true"));
    // THE FAILURE THIS GUARDS IS THE ONE THAT LOOKS CORRECT: history.pushState
    // does not notify react-router, so a page that WRITES the address without
    // listening for the Back that unwinds it changes the address bar while the
    // panel stays open. Simulate the Back the browser performs.
    act(() => {
      window.history.replaceState({}, "", "/explore?i=fields");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(rowFor("design")!.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("false"));
    expect(EXPLORE).toMatch(/window\.addEventListener\("popstate", onPop\)/);
    expect(EXPLORE, "the popstate listener is never removed").toMatch(/window\.removeEventListener\("popstate", onPop\)/);
  });

  it("a shared link opens the panel it names, and scrolls to it", async () => {
    mount("/explore?i=fields&f=education&r=teacher");
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rowFor("education")!.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(pageText()).toContain("Narrow “teacher"));
    expect(EXPLORE).toMatch(/scrollIntoView\(\{ block: "center" \}\)/);
  });

  it("a role from the URL is validated by MEMBERSHIP, never by a regex", async () => {
    // WITHOUT THIS, A SHARED LINK PUBLISHES A STRANGER'S SEARCH UNDER OUR
    // SENTENCE: `r` is handed to the board as a free-text `q`, so the page
    // would render a live count for any string they chose beneath a heading
    // reading "The biggest roles in Healthcare". A regex cannot help — "cheap
    // rolex" is a perfectly well-formed role name. The only honest test is that
    // WE named it, for THIS field.
    mount("/explore?i=fields&f=healthcare&r=cheap%20rolex");
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rowFor("healthcare")!.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("true");
    expect(pageText(), "an arbitrary q from the URL reached the page").not.toContain("cheap rolex");
    const probed = invoke.mock.calls.map((c) => (c[1]?.body ?? {}) as Record<string, unknown>);
    for (const b of probed) {
      expect(String(b.q ?? ""), "an arbitrary q from the URL was priced").not.toContain("cheap rolex");
    }
    // …and a role that belongs to a DIFFERENT field is refused just as flatly.
    expect(FIELD_ROLES.education).toContain("teacher");
    expect(FIELD_ROLES.healthcare).not.toContain("teacher");
    document.body.innerHTML = "";
    mount("/explore?i=fields&f=healthcare&r=teacher");
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(pageText()).not.toContain("Narrow “teacher");
    expect(EXPLORE, "the role is validated by shape rather than by membership")
      .toMatch(/\(FIELD_ROLES\[field\] \?\? \[\]\)\.includes\(r\)/);
  });

  it("a field from the URL must be one the destination itself accepts", async () => {
    mount("/explore?i=fields&f=quantum_basketry");
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    for (const li of rows()) {
      expect(li.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("false");
    }
    expect(EXPLORE).toMatch(/BOARD_CATEGORY_SLUGS as readonly string\[\]\)\.includes\(f\)/);
  });

  it("reopening a field re-fires no probes — the price maps are memoised", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const open = () => act(() => { (rowFor("design")!.querySelector("button[aria-expanded]") as HTMLButtonElement).click(); });
    open();
    await waitFor(() => expect(pageText()).toContain("Where"));
    /** The PRICED probes — a role row, a chip, a country chip. Deliberately not
     *  every board call: the closure record reads a PAGE of the slice's own
     *  results (limit 60) under its own dedupe, which is released on close on
     *  purpose so a failed read retries. This memo is about the twenty-two
     *  counts. */
    const priced = () => invoke.mock.calls
      .map((c) => (c[1]?.body ?? {}) as Record<string, unknown>)
      .filter((b) => b.limit === 1).length;
    const afterFirst = priced();
    expect(afterFirst, "the first open bought no probes at all").toBeGreaterThan(5);
    open();                       // close
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("f")).toBeNull());
    open();                       // and open again
    await waitFor(() => expect(pageText()).toContain("Where"));
    expect(priced(), "reopening a field re-fired its ~22 priced probes").toBe(afterFirst);
    // A FAILED PROBE IS NOT A MEASUREMENT AND MUST NOT BE CACHED, or one bad
    // minute becomes permanent for the rest of the session with nothing to
    // retry it.
    expect(EXPLORE).toMatch(/if \(!Object\.values\(map\)\.some\(\(p\) => p\.failed\)\) rolePriceCache/);
    expect(EXPLORE).toMatch(/if \(!anyFailed\) chipPriceCache\.current\.set/);
  });

  it("…and the memo EXPIRES, because the sentence over those counts states when they were taken", async () => {
    // A CACHE OF MEASUREMENTS NEEDS A STATED WINDOW, AND A REF IS NOT ONE.
    // These counts render under explore.rolesNote — "a live count of exactly
    // the search that row opens, taken just now" — and a Map that lives as long
    // as the tab publishes a six-hour-old integer under that sentence with no
    // failure state entered and nothing on screen looking wrong. That is the
    // carried-facet defect basisCarried2 fixes one level up on this same page,
    // one grain down: the number is real, its DATE BASIS is a lie.
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const open = () => act(() => { (rowFor("design")!.querySelector("button[aria-expanded]") as HTMLButtonElement).click(); });
    const priced = () => invoke.mock.calls
      .map((c) => (c[1]?.body ?? {}) as Record<string, unknown>)
      .filter((b) => b.limit === 1).length;
    open();
    await waitFor(() => expect(pageText()).toContain("Where"));
    const afterFirst = priced();
    open();                       // close
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("f")).toBeNull());

    // …six minutes later, on a page nobody reloaded.
    const realNow = Date.now;
    const later = realNow() + 6 * 60 * 1000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => later);
    try {
      open();
      await waitFor(() => expect(pageText()).toContain("Where"));
      await waitFor(() => expect(priced(),
        "a reading older than the stated window was served under \"taken just now\"")
        .toBeGreaterThan(afterFirst));
    } finally {
      spy.mockRestore();
      expect(Date.now()).toBeGreaterThanOrEqual(realNow() - 1000);
    }
    // …and the window is a named constant rather than a number in two places.
    expect(EXPLORE).toMatch(/const PRICE_CACHE_MS = /);
    expect(EXPLORE).toMatch(/Date\.now\(\) - held\.at > PRICE_CACHE_MS/);
    // …and the method panel SAYS the counts are re-taken rather than
    // remembered. A window nobody is told about is still a false date basis.
    const en = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8")) as
      { explore: Record<string, string> };
    expect(en.explore.methodNamesMethod3, "the method panel still claims every count is taken at the moment you click")
      .toContain("more than a few minutes old");
    expect(en.explore, "methodNamesMethod2 still carries the claim the cache made false")
      .not.toHaveProperty("methodNamesMethod2");
  });

  it("the way back carries the slice, and the board keeps it by name", async () => {
    mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const arrow = rowFor("healthcare")!.querySelector("a")!.getAttribute("href") ?? "";
    expect(arrow).toContain("from=explore");
    expect(arrow, "the board is given no way back to the slice the reader left")
      .toContain(`back=${encodeURIComponent("/explore?i=fields&f=healthcare")}`);
    // ONE PLACE ON THE OTHER SIDE. Jobs.tsx's lander rewrite builds its URL by
    // hand and returns before the query form is serialised, so a non-filter
    // param survives only if it is re-added BY NAME to the shared object — that
    // is exactly how `from` was lost for weeks.
    expect(JOBS).toMatch(/landerKeep\.set\("back", backParam\)/);
    expect(JOBS).toMatch(/if \(backParam\) p\.set\("back", backParam\)/);
    // AND IT IS VALIDATED AS A PATH ON THIS SITE. It arrives in a URL a
    // stranger can compose and ends up in an href, so a passthrough is an open
    // redirect — and "//evil.example" is protocol-relative, i.e. another origin
    // that still starts with a slash.
    // READ OFF THE RAW SOURCE, AND ONLY THIS ONE. The comment stripper this
    // file uses everywhere else eats from `//` to end of line, and the literal
    // this assertion needs IS "//" — stripped source cannot contain it, so a
    // stripped read would be a guard that can never pass. The risk the strip
    // exists for does not apply here either: "//" in a comment about open
    // redirects is not a plausible way to fake this predicate.
    expect(JOBS_RAW).toMatch(/v\.startsWith\("\/explore"\) && !v\.startsWith\("\/\/"\)/);
    // On a field lander with no `back`, the field IS the slice, so the link is
    // derived rather than guessed.
    expect(JOBS).toMatch(/\/explore\?i=fields&f=\$\{encodeURIComponent\(landerCategory\)\}/);
  });

  it("the employer check is a slice too, and its links carry the way back to it", () => {
    // THE OTHER HALF OF THE PAGE, WHICH THE FIRST ROUND LEFT ONE-WAY. The check
    // tab's employer links are the only outbound links on it, and they went out
    // with `from=explore` and nothing else. On the far side that lands a reader
    // on a COMPANY lander, where there is no `back` to honour and no
    // landerCategory to derive one from — Jobs.tsx falls through to the literal
    // "/explore", so their tab, the employer they typed and the results they
    // were reading are all gone. Same one-way trip the field rows were fixed
    // for, on the tab nobody re-read.
    //
    // ASSERTED ON THE SOURCE, because reaching this link in jsdom needs a live
    // typeahead round trip; the property is that the intent is a PARAMETER of
    // backHere rather than a constant, and that this call site passes its own.
    expect(EXPLORE, "backHere still hardcodes the fields intent and cannot express the check slice")
      .toMatch(/const backHere = useCallback\(\(field: string \| null, r: string \| null, i: Intent = "fields"\)/);
    expect(EXPLORE, "backHere no longer builds its address from the intent it was given")
      .toMatch(/new URLSearchParams\(\{ i \}\)/);
    const link = /\/jobs\/company\/\$\{encodeURIComponent\(h\.tokens\[0\]\)\}\?from=explore([^`]*)/.exec(EXPLORE);
    expect(link, "the check tab's employer link is not where it was — re-read this assertion").toBeTruthy();
    expect(link![1], "the employer link still leaves the reader with no way back to their check")
      .toContain('back=${encodeURIComponent(backHere(null, null, "check"))}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the page is reachable by keyboard and is not under the header", () => {
  it("the skip link finally has a target here", async () => {
    const { container } = mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const main = container.querySelector("main")!;
    // index.html ships <a href="#main-content"> as the FIRST focusable element
    // of every page. This page rendered no such id, so a keyboard or
    // screen-reader user's first keystroke moved nothing — permanently, not
    // only during hydration.
    expect(main.id).toBe("main-content");
    expect(main.getAttribute("tabindex"), "the id is an anchor, not a focus destination").toBe("-1");
    // FROM src/lib, NOT FROM Jobs.tsx: importing the recovery from the board
    // page would pull its 10.6k lines into this page's chunk for nine lines of
    // behaviour.
    expect(EXPLORE).toMatch(/from "@\/lib\/skip-link"/);
    expect(EXPLORE, "Explore is importing the whole board page")
      .not.toMatch(/from "\.\/Jobs"|from "@\/pages\/Jobs"/);
    expect(EXPLORE).toMatch(/honourPendingSkipLink\(window\.location\.hash\)/);
    expect(JOBS, "the board page lost the recovery in the move").toMatch(/honourPendingSkipLink\(window\.location\.hash\)/);
  });

  it("the H1 and the date-basis sentence clear the fixed header", async () => {
    const { container } = mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    // Header is a FIXED h-16 (64px) bar that emits no spacer, so every page has
    // to leave room: /jobs uses pt-20, /companies pt-24. py-10 (40px) put the H1
    // and the one sentence carrying the date basis for all eighteen numbers
    // under a translucent blur.
    const cls = container.querySelector("main")!.className;
    const pt = /(?:^|\s)pt-(\d+)/.exec(cls);
    expect(pt, "the main element sets no top padding at all").toBeTruthy();
    expect(Number(pt![1]) * 4, "the page still starts under the fixed 64px header").toBeGreaterThanOrEqual(64);
    expect(cls, "py-10 is back — the header sits on the H1").not.toMatch(/(?:^|\s)py-10/);
  });

  it("the tabs and their panels point at each other", async () => {
    const { container } = mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    for (const tab of tabs) {
      const panelId = tab.getAttribute("aria-controls");
      expect(panelId, "a tab promises a panel it does not name").toBeTruthy();
      const panel = document.getElementById(panelId!);
      expect(panel, `no panel with id ${panelId}`).toBeTruthy();
      expect(panel!.getAttribute("role")).toBe("tabpanel");
      expect(panel!.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(tab.id, "the tab has no id for its panel to point back at").toBeTruthy();
    }
    // Home and End are part of the same promise as the arrows.
    expect(EXPLORE).toMatch(/e\.key === "Home"/);
    expect(EXPLORE).toMatch(/e\.key === "End"/);
    expect(EXPLORE).toMatch(/e\.key === "ArrowRight"/);
    expect(EXPLORE).toMatch(/e\.key === "ArrowLeft"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the prerendered document stops contradicting itself", () => {
  it("the field pills are ordered by the count they print, with the bucket last", () => {
    // THE DOCUMENT TOLD CRAWLERS the fields were "ordered by how many roles are
    // open in it right now" and then rendered CATEGORY_LANDERS in hand-declared
    // order with NO counts at all — design third at ~4,236, operations eleventh
    // at ~143,092. The ordering claim and the ordering lived in two places and
    // only one of them was data.
    const block = PRERENDER.slice(PRERENDER.indexOf('<h2 class="text-xl font-bold mb-3">Every field on the board</h2>'));
    const body = block.slice(0, block.indexOf("</section>"));
    expect(body, "the pills are still rendered in declaration order")
      .toMatch(/\.sort\(\(a, b\) => \(nOf\(b\[0\]\) \?\? 0\) - \(nOf\(a\[0\]\) \?\? 0\)\)/);
    expect(body, "the ordering is not read from the facet the landers already use")
      .toMatch(/boardFacets\?\.categoriesFacet/);
    expect(body, "a pill still prints no number").toMatch(/fmtN\(nOf\(slug\)\)/);
    // 'other' is the LARGEST bucket, so sorting it with the fields would head a
    // list of fields with our own vocabulary's coverage gap.
    expect(body).toMatch(/const otherPill = /);
    // …AND IT IS PINNED LAST IN THE EMITTED HTML, NOT MERELY DECLARED SECOND.
    // The obvious assertion here — indexOf("otherPill") > indexOf("fieldPills")
    // over the SOURCE — is satisfied by the order of the two `const` lines and
    // says nothing whatever about the order of the interpolations. Swapping the
    // template to `${otherPill}${fieldPills}` puts the 174,602-row bucket at the
    // head of a list of fields, which is the exact defect the message names, and
    // that assertion stays green through it. So: read the emitted div.
    const emitted = /<div class="flex flex-wrap gap-2 text-xs">\$\{(\w+)\}\$\{(\w+)\}<\/div>/.exec(body);
    expect(emitted, "the pill row is no longer two interpolations in one div — re-read this assertion").toBeTruthy();
    expect(emitted?.[1], "the fields do not come first in the emitted pill row").toBe("fieldPills");
    expect(emitted?.[2], "the bucket is not pinned last in the emitted pill row").toBe("otherPill");
    // THE ORDERING CLAIM IS GATED ON THE DATA THAT CREATES IT: a build that
    // reached no facet must not go on calling declaration order an ordering.
    expect(body).toMatch(/const anyCount = /);
    expect(body).toMatch(/in no particular order and carry no numbers/);
    // …and a printed count names the day it was taken.
    expect(body).toMatch(/Counts as at \$\{/);
    expect(body).toMatch(/facetsSource === "snapshot"/);
    expect(PRERENDER).toMatch(/facetsSavedAt = typeof snap\.savedAt === "string"/);
  });

  it("the crawler is told what the bucket actually is", () => {
    // Same correction as the page: categorize() returns "other" when no regex
    // in OUR OWN rule set matched, which is a coverage gap in a vocabulary
    // frozen at v9 by design — not a failure to read the employer's title.
    const block = PRERENDER.slice(PRERENDER.indexOf("Every field on the board</h2>"));
    const body = block.slice(0, block.indexOf("</section>"));
    expect(body).toContain("could not sort into a field");
    expect(body, "the document still blames the employer's title")
      .not.toContain("could not read from the title");
  });
});
