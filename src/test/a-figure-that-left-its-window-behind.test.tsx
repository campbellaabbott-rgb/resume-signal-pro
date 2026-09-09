/**
 * A FIGURE THAT LEFT ITS WINDOW BEHIND — AND A SECTION THAT OUTLIVED ITS OWN
 * DELETION.
 *
 * Two properties have to survive every rebuild of /explore, because every
 * defect this page has shipped was one of them failing:
 *
 *   1. NO CARD PRINTS A FIGURE WITHOUT ITS WINDOW. Not "usually prints", not
 *      "prints in a tooltip": the span a number was measured over, the sample it
 *      was computed from and the date basis under it travel in the same card as
 *      the number, or the number does not render. A rate over an unknown stretch
 *      of time is a claim about nothing — it is how "4331 filled in 11d tracked"
 *      reached a reader beside "220 open now", and how a 14-day incidence came
 *      to be published over a ten-day log.
 *
 *   2. NO REMOVED SECTION'S COMPUTATION SURVIVES. Deleting a heading is not
 *      deleting a section. This page has repeatedly kept the arithmetic of
 *      something it stopped showing — trending and newest were removed from the
 *      render months before the cache stopped computing them — and a
 *      computation with no rendered sentence is a number waiting to be
 *      re-rendered by someone who does not know why it left.
 *
 * WHAT THIS FILE GUARDS AFTER 2026-09-09, AND WHY IT IS SMALLER.
 * The rebuild this file was written against — six answers, five of them twelve
 * employer cards — is itself gone. Those five sections held 1,812 open roles
 * against ~938,000 served, 0.19% of the board, and twelve employer cards cannot
 * exceed 11.09% of it however perfectly they are ranked; the page now opens on
 * a field grid that partitions the whole serving population. Every test here
 * that mounted `?i=hiring`, `?i=aged`, `?i=ghost`, `?i=pay` or `?i=entry` and
 * drove a leaderboard's claim builder was a guard over a subject that no longer
 * exists. Left standing they would not have protected anything — they would
 * only have blocked the removal, which is the inverse of this repo's standing
 * failure of a guard staying green over dead code.
 *
 * PROPERTY 1 DID NOT MOVE OR SOFTEN. It now applies at FIELD grain, where the
 * same competing-risks estimator PASSES the same sufficiency gate on thousands
 * of closures instead of three, and it is driven against a real render in
 * a-default-view-that-reached-two-tenths-of-a-percent.test.tsx. PROPERTY 2 IS
 * WHY MOST OF THIS FILE SURVIVES: the removal checks below now cover all three
 * rounds of deletion, and a removal that is not checked is how this page came
 * to keep computing trending for months after it stopped rendering it.
 *
 * READ OFF A REAL RENDER wherever a render can answer. A source guard cannot
 * tell a rendered figure from a well-spelled one, and this repo has been bitten
 * repeatedly by a guard that matched an explanation while the code it described
 * was dead (20260908120000 is the standing example — a COMMENT satisfied the
 * check while production kept the falsehood). Where the property is about the
 * ABSENCE of code, the source is read with comments stripped, for the same
 * reason.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
/** THE TILE COUNTS' ONLY SOURCE. They come off the board's own category facet
 *  now — one list request, the whole map, the same row the field lander reads
 *  its own entry from — not off the hourly explore cache, which could be
 *  fifty-three minutes out of step with the page a tile opens. */
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
import Explore, { feedTotalClaim } from "../pages/Explore";

const ROOT = resolve(__dirname, "../..");
/** Comments stripped: an assertion about what the code DOES must not be
 *  satisfiable by prose describing what it no longer does. Every removal note
 *  in that file names the thing it removed, so an unstripped read would pass
 *  every one of the absence checks below. */
const CODE = readFileSync(resolve(ROOT, "src/pages/Explore.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

/** One row of get_category_fill_curve, at the shape a FIELD returns: thousands
 *  of closures where an employer had three, which is exactly why the estimator
 *  passes here and failed there. */
const curveRow = (category: string, over: Record<string, unknown> = {}) => ({
  category,
  n_at_risk_14: 2_140, fills_le_14: 690,
  fill_rate_14: 0.31, fill_rate_14_lo: 0.28, fill_rate_14_hi: 0.34,
  relist_rate_14: 0.08, still_open_14: 0.61,
  median_days_to_fill: 22, median_censored: false,
  dated_coverage: 0.71, window_days: 56, sufficient: true,
  ...over,
});

/** The facet reply for an UNFILTERED list request: the whole category map plus
 *  the stamp on the stored row it came out of. Two fields, one above the
 *  serving API's filtered-count ceiling and one below it, so an assertion that
 *  the tiles no longer pass through that ceiling has something to bite on. */
const FACET = { engineering: 38_412, design: 900 };
const mount = (cache: Record<string, unknown> = {}, at = "/explore") => {
  invoke.mockImplementation(async (_fn: string, opts?: { body?: Record<string, unknown> }) => {
    const b = (opts?.body ?? {}) as Record<string, unknown>;
      // action:"facets", not a {limit:1} list. The facet exit reads the SAME
      // job_board_meta k='refresh_head' row through the SAME visibleCategories
      // rule, so nothing about the single-source property changed -- what it
      // drops is the browse the list exit performed on its way there, which
      // logged a job_board_search_events row on every /explore view.
      if (b.action === "facets") {
      return { data: { jobs: [], categories: { ...FACET }, refreshedAt: "2026-09-09T14:07:54.645Z" }, error: null };
    }
    return { data: { jobs: [], total: 0 }, error: null };
  });
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_explore_cache") {
      return {
        data: {
          fields: { engineering: 38_412, design: 900 },
          field_grid: { tiled_n: 39_312, board: { n: 39_312 } },
          totals: { postings_n: 39_312 },
          repost_index: {}, stale_parts: [],
          computed_at: new Date().toISOString(), ...cache,
        },
      };
    }
    return { data: [], error: null };
  });
  return render(<MemoryRouter initialEntries={[at]}><Explore /></MemoryRouter>);
};

/** The whole rendered page as text. Both answers are in the DOM — the inactive
 *  one under `hidden`, because /explore is prerendered and every link on it must
 *  stay crawlable — so a figure that leaks out of its gate is visible here
 *  wherever it leaks to. */
const pageText = () => document.body.textContent ?? "";

const typeCompany = async (q: string) => {
  const input = await screen.findByPlaceholderText(/Type a company name/);
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(input, { target: { value: q } });
};

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); document.body.innerHTML = ""; });

// ─────────────────────────────────────────────────────────────────────────────
// 1. WHAT WE HOLD AND WHAT THEY ADVERTISE ARE TWO NUMBERS, NEVER A RATIO
// ─────────────────────────────────────────────────────────────────────────────

describe("what we hold and what they advertise are two numbers, never a ratio", () => {
  it("the employer check prints both, with the day theirs was read", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") {
        return { data: { fields: {}, totals: {}, repost_index: {}, stale_parts: [], computed_at: new Date().toISOString() } };
      }
      if (fn === "get_company_suggest") {
        return { data: [{ name: "CVS Health", tokens: ["cvs"], open_roles: 678, feed_total: 19265, feed_total_at: "2026-09-06T12:00:00Z" }] };
      }
      return { data: [] };
    });
    render(<MemoryRouter initialEntries={["/explore?i=check"]}><Explore /></MemoryRouter>);
    await typeCompany("cvs");
    await waitFor(() => expect(pageText()).toMatch(/CVS Health/), { timeout: 3000 });
    const card = screen.getAllByText("CVS Health")[0].closest("a")!.textContent ?? "";
    expect(card, "our own floor is missing").toMatch(/678 roles open on our board now/);
    expect(card, "their total is missing, or missing its date").toMatch(/advertised 19,265 roles when we read it on/);
    // THE GAP, AS A SUBTRACTION AND NEVER AS A RATIO.
    expect(card, "the gap between the two is not stated as a count").toMatch(/18,587 more than we serve/);
    // The stamp itself, formatted in the reader's own locale — asserted
    // against the same Intl call the page makes, because a UTC timestamp lands
    // on either side of midnight depending on where the reader is and a
    // hardcoded "Sep 6" would make this test a timezone check.
    expect(card, "the read date is missing")
      .toContain(new Date("2026-09-06T12:00:00Z").toLocaleDateString("en", { dateStyle: "medium" }));
    // THE RATIO IS NOT A COVERAGE PERCENTAGE AND MUST NOT APPEAR. 678/19,265 is
    // 3.5%: a division of a floor by one stale reading, on two different days,
    // under two different definitions.
    expect(card, "the two numbers were divided").not.toMatch(/3\.5%|4%|3%/);
  });

  it("with no read date, the employer's own total is not published at all", () => {
    // job_board_verifications keeps one row per board and is UPSERTed on every
    // fetch, so it has no history: a board that went dark holds its last
    // advertised total forever, and printed bare it reads as current.
    expect(feedTotalClaim(678, 19265, null), "a total with no date basis reached the page").toBeNull();
    // Nor when it does not exceed what we hold: there is no gap to report and
    // printing it invites the division anyway.
    expect(feedTotalClaim(678, 400, "2026-09-06T00:00:00Z")).toBeNull();
    const ok = feedTotalClaim(678, 19265, "2026-09-06T00:00:00Z");
    expect(ok).toEqual({ open: 678, total: 19265, at: "2026-09-06T00:00:00Z" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE REMOVALS ARE REMOVALS, NOT HIDDEN SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("the removals are removals, not hidden sections", () => {
  it("nothing computes size segments any more", () => {
    for (const dead of ["get_size_segments", "orderedBands", "segStatsBase", "segMega", "with_headcount", "company_total"]) {
      expect(CODE, `"${dead}" survived the removal of the size-band section`).not.toContain(dead);
    }
  });

  it("nothing reads trending or newest", () => {
    // Both were removed from the render months ago while the hourly job kept
    // computing and caching them. A computation with no rendered sentence is a
    // number waiting to be re-rendered by someone who does not know why it left.
    expect(CODE).not.toMatch(/get_trending_companies|get_newest_companies/);
    expect(CODE).not.toMatch(/c\.trending|c\.newest/);
  });

  it("nothing calls the raw-title re-poster collection or clamps its count", () => {
    expect(CODE, "the replaced collection is still fetched").not.toContain("get_repost_churn_companies");
    for (const dead of ["repostBadgeCapped", "repostAcross", "worst_count", "reposted_roles"]) {
      expect(CODE, `"${dead}" survived the re-poster section`).not.toContain(dead);
    }
    // The client clamp — "cap the stated count at one re-list per tracked day"
    // — was a presentation fix for a measurement defect, and the measurement is
    // what changed.
    expect(CODE).not.toMatch(/Math\.min\(raw,\s*days\)/);
  });

  it("none of the five employer leaderboards' RPCs, payload keys or builders survives", () => {
    // THE 2026-09-09 REMOVAL, checked the same way as the two before it. Each
    // name below produced a twelve-card section; a page that still fetched or
    // ranked any of them would be computing a leaderboard with nowhere to put
    // it, which is precisely how trending outlived its own deletion.
    for (const dead of [
      "get_actively_hiring_companies", "get_relisting_employers", "get_entry_level_companies",
      "get_transparent_employers", "get_salary_benchmarks", "get_aged_out_roles",
      "rankedDurationClaims", "rankRecycling", "rankAged", "rankEntry", "agedClaimOf",
      "recyclingClaimOf", "heldFor", "HIRING_SLICE",
      "c.hiring", "c.relisting", "c.entry", "c.transparent", "c.salary",
    ]) {
      expect(CODE, `"${dead}" survived the removal of the employer leaderboards`).not.toContain(dead);
    }
  });

  it("the field tiles carry EXACT counts, and the note that contradicted them is gone", async () => {
    mount();
    await waitFor(() => expect(pageText()).toMatch(/Every field on the board/));
    // THIS ASSERTION INVERTED, AND THE INVERSION IS THE FIX. It used to require
    // the tile to format through the serving API's ceiling, on the argument
    // that a tile must agree with the page it opens. That argument was sound
    // only while the two numbers came from two scans. They come from one row
    // now — the board's category facet, read whole here and read one entry at a
    // time by /jobs/field/:id — so there is nothing to reconcile, and the
    // ceiling did real damage: it is COUNT_CAP, the limit on a FILTERED count,
    // and it made operations (144,664), healthcare (109,811), the uncategorised
    // bucket (174,535), hospitality_retail, sales and engineering render as one
    // identical string under a header promising an ordering by size.
    // SCOPED TO THE TILES. The collapsed "How we measure" panel still explains
    // what the retired ceiling was, once, in prose — that is a sentence about
    // the grid and is exactly where the page's own rule says such a thing
    // belongs. What must never come back is the ceiling ON A TILE FACE.
    const tiles = [...document.querySelectorAll("li")]
      .filter((li) => li.querySelector("button[aria-expanded]"))
      .map((li) => li.querySelector("button[aria-expanded]")?.textContent ?? "")
      .join(" | ");
    expect(tiles, "the tile is capping again — six fields will read alike").not.toContain("10,000+");
    expect(tiles, "the tile above the old ceiling must print exactly").toContain("38,412");
    expect(tiles, "and so must the one below it").toContain("900");
    // The note printed the UNCAPPED count as a board-wide total directly above
    // chips that cap — one sentence contradicting the eighteen numbers under it.
    expect(pageText(), "the uncapped denominator sentence came back")
      .not.toMatch(/roles open across the board right now/);
    expect(CODE).not.toContain("noteFields");
  });

  it("a cache row still carrying the removed collections renders none of their numbers", async () => {
    // The deploy window this page keeps failing in: the client is new and the
    // hourly cache is old. Nothing in the payload may reach the screen through a
    // section that no longer exists.
    mount({
      hiring: [{ company: "Schnucks", company_token: "schnucks", open_roles: 678, closed_90d: 4331, filled_roles_ceiling: 214, tracking_days: 54 }],
      totals: { postings_n: 39_312, hiring_n: 31 },
      segments: { mega: { companies: 212, open_roles: 129810, entry_pct: 4, remote_pct: null, top: [{ company: "Ghost Band Co", company_token: "gb", on_board: 300, company_total: 1200 }] } },
      reposters: [{ company: "Rawtitle Ltd", company_token: "raw", repost_events: 2242, reposted_roles: 298, worst_title: "Nurse (R-48213)", worst_count: 41, tracking_days: 49 }],
      trending: [{ company: "Trendy Inc", company_token: "tr", recent: 900 }],
      newest: [{ company: "Newbie Inc", company_token: "nb" }],
      relisting: [{ company: "BoxLunch", company_token: "boxlunch", relist_events_floor: 581, relisted_titles: 3, events_per_title: 193.7 }],
      entry: [{ company: "Aramark", company_token: "aramark", open_roles: 1507, entry_roles: 933 }],
      transparent: [{ company: "Zillow", company_token: "zillow", open_roles: 267, pay_pct: 97, median_usd_floor: 118400 }],
      salary: [{ category: "data_ai", currency: "USD", n: 4318, median_annual_min: 129750 }],
    });
    await waitFor(() => expect(pageText()).toMatch(/Every field on the board/));
    const txt = pageText();
    for (const ghost of [
      "Ghost Band Co", "Rawtitle Ltd", "Trendy Inc", "Newbie Inc", "Schnucks",
      "BoxLunch", "Aramark", "Zillow",
      "129,810", "2,242", "193.7", "1,507", "933", "118,400", "129,750", "678",
    ]) {
      expect(txt, `a removed section rendered "${ghost}" from a stale cache row`).not.toContain(ghost);
    }
    // And the legacy closure count is still not read anywhere: it is the number
    // that put 4,331 "fills" on JLL's card.
    expect(txt, "closed_90d reached the screen").not.toMatch(/4,?331/);
  });

  it("a stale part naming a section this page no longer renders is not a warning about this page", async () => {
    // EIGHT NAMES, AND THREE OF THEM ARE THE CACHE WRITER'S OWN NEW KEYS.
    // role_rows was guaranteed to fire: its writer runs on a separate
    // six-hourly cron, so the hourly refresh names it stale until that cron's
    // first tick — a yellow warning, in a raw internal spelling, about a
    // section this page does not render.
    // FOUR MORE NAMES JOINED THAT SET IN THE GRID'S DESIGN PASS, and they are
    // the four the tiles used to be built from: `fields` and `field_grid`,
    // because the counts and their roll-up now come off the board's own facet
    // in one read with their destination; `field_curves`, because the
    // field-grain lifecycle line it fed is gone; and `totals`, because the
    // sentence that stood over it went with the old reach fraction. A yellow
    // warning about a collection this page does not render is a false alarm in
    // a raw internal spelling.
    mount({ stale_parts: ["trending", "segments", "hiring", "salary", "transparent", "role_rows", "chip_coverage", "ageout_basis", "fields", "field_grid", "field_curves", "totals"] });
    await waitFor(() => expect(pageText()).toMatch(/Every field on the board/));
    expect(pageText(), "the staleness line named a collection nothing here renders")
      .not.toMatch(/could not be recomputed/);
    // …but a part that DOES back this page still raises the line. repost_index
    // is the churn warning on the employer check, and it is what the cache is
    // still read for.
    document.body.innerHTML = "";
    rpc.mockReset();
    invoke.mockReset();
    mount({ stale_parts: ["trending", "repost_index"] });
    await waitFor(() => expect(pageText()).toMatch(/repost_index could not be recomputed/));
    expect(pageText()).not.toMatch(/trending, repost_index/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE i18n HAZARD: A LOCALE VALUE OVERRIDES AN INLINE DEFAULT
// ─────────────────────────────────────────────────────────────────────────────

describe("copy that changed meaning changed key", () => {
  /** Nine locales carry these values. A locale VALUE beats an inline English
   *  default, so re-using one of these keys for a sentence that now measures
   *  something else leaves eight languages rendering the retracted wording —
   *  which is how this product shipped a "no subscriptions" claim that had
   *  moved runtimes, and a re-post badge stating an equality in eight
   *  languages while English said "at least". */
  // COMPUTED FROM THE PREVIOUS SHIP AND THEN PINNED AS LITERALS. Every name
  // here is a key that existed in the nine locale files before this rebuild and
  // is no longer called by the page — 129 of them, the copy of eight deleted
  // sections across three rounds of removal — plus the four keys this ship
  // RE-POINTED. A re-pointed key is the sharper hazard: closureBasis and
  // closureBasisNoTotal described a facet-derived population the page
  // abandoned, asOfCounts claimed every figure below it was counted live when a
  // chip's coverage percentage is not, and fieldCurveMedian dropped the half of
  // the claim the estimator actually measures. Each took a NEW key precisely so
  // that nine translated values could not answer for a sentence whose meaning
  // changed, and calling the old one again would render the retracted claim in
  // eight languages while English read correctly.
  const RETIRED = [
    "explore.actionEntry", "explore.actionGhost", "explore.actionHiring",
    "explore.agedBasis", "explore.agedBlurb", "explore.agedEvidence2",
    "explore.agedFloors", "explore.agedHeadline2", "explore.agedLedger2",
    "explore.agedNoneBody", "explore.agedNoneTitle", "explore.agedTitle",
    "explore.agedZeroBody", "explore.agedZeroTitle", "explore.asOf", "explore.badge",
    "explore.checkBlurb2", "explore.checkFeedGap", "explore.ctaButton", "explore.ctaLine",
    "explore.durBlurb", "explore.durEvidence", "explore.durFloor", "explore.durHeadline",
    "explore.durNoneBody", "explore.durNoneTitle", "explore.durRate", "explore.durTitle",
    "explore.durUnit", "explore.entryBadgeShare", "explore.entryBlurb2",
    "explore.entryOutBody", "explore.entryOutTitle", "explore.entryThinBody",
    "explore.entryThinTitle", "explore.entryTitle2", "explore.fieldsBlurb",
    "explore.fieldsTitle", "explore.fillCoverage", "explore.fillInterval",
    "explore.fillRelistFloor", "explore.headline", "explore.hiringHeldDuration",
    "explore.hiringHeldEstimate", "explore.hiringHeldOf", "explore.hiringHeldReposter2",
    "explore.hiringHeldUndated", "explore.hiringHeldUnmeasured",
    "explore.hiringHeldWindow", "explore.hiringOutBody", "explore.hiringOutTitle",
    "explore.intentAged", "explore.intentDates", "explore.intentDuration",
    "explore.intentEntry", "explore.intentFields", "explore.intentPay",
    "explore.methodAgedMethod", "explore.methodAgedRateMethod2",
    "explore.methodAgedRateTerm", "explore.methodAgedTerm", "explore.methodAgedWhoMethod",
    "explore.methodAgedWhoTerm", "explore.methodBaseMethod", "explore.methodBaseTerm",
    "explore.methodBlindMethod", "explore.methodBlindTerm", "explore.methodEntryMethod",
    "explore.methodEntryRankMethod", "explore.methodEntryRankTerm",
    "explore.methodEntryTerm", "explore.methodFeedMethod", "explore.methodFeedTerm",
    "explore.methodFloorMethod", "explore.methodFloorTerm", "explore.methodGateMethod",
    "explore.methodGateTerm", "explore.methodMedianMethod", "explore.methodMedianTerm",
    "explore.methodOpenMethod2", "explore.methodOpenTerm2", "explore.methodOrderMethod",
    "explore.methodOrderTerm", "explore.methodPayMedianMethod2",
    "explore.methodPayMedianTerm", "explore.methodPayOrderMethod",
    "explore.methodPayOrderTerm", "explore.methodRateMethod", "explore.methodRateTerm",
    "explore.methodRelistMethod", "explore.methodRelistTerm", "explore.methodSampleMethod",
    "explore.methodSampleTerm", "explore.methodTitleMethod", "explore.methodTitleTerm",
    "explore.noteAged", "explore.noteDurationPool", "explore.noteDurationShown",
    "explore.noteDurationShownOne", "explore.noteEntryShare", "explore.notePay",
    "explore.notePayBoard", "explore.noteRecycleFlagged", "explore.noteRecyclePool",
    "explore.openBoth", "explore.payBlurb", "explore.payMedianHeld2",
    "explore.payMedianMissing", "explore.payMedianN2", "explore.payMedianUnknown2",
    "explore.payOutBody", "explore.payOutTitle", "explore.payTitle",
    "explore.recycleBaseline", "explore.recycleBaselineP90", "explore.recycleBlurb",
    "explore.recycleEvidence", "explore.recycleHeadline", "explore.recycleOutBody",
    "explore.recycleOutTitle", "explore.recycleTitle", "explore.recycleWorst",
    "explore.salaryBadge", "explore.salaryBlurb", "explore.salaryTitle",
    "explore.seoDescription3", "explore.seoTitle3", "explore.subhead3",
    "explore.transparentBadge", "explore.closureBasis", "explore.closureBasisNoTotal",
    "explore.asOfCounts", "explore.fieldCurveMedian",
  ];
  const src = readFileSync(resolve(ROOT, "src/pages/Explore.tsx"), "utf8");

  it("no retired key is asked for by this page", () => {
    for (const k of RETIRED) {
      const key = k.replace("explore.", "");
      expect(src, `t("${k}") is still called — nine locales would answer it with the retracted sentence`)
        .not.toMatch(new RegExp(`t\\(\\s*"explore\\.${key}"`));
    }
  });

  it("every new sentence ships an inline English default, so an untranslated key is never a blank", () => {
    // t("k") with no second argument renders the key itself when the locale has
    // no value — "explore.fieldsTitle2" in the middle of a card.
    const bare = [...src.matchAll(/t\(\s*"(explore\.[A-Za-z0-9_]+)"\s*([,)])/g)]
      .filter((m) => m[2] === ")")
      .map((m) => m[1]);
    expect(bare, "a key with no inline English default").toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEETH — each refusal, driven with the shape that shipped
// ─────────────────────────────────────────────────────────────────────────────

describe("teeth: the checkers fail against the behaviour they exist to stop", () => {
  it("the field-grain lifecycle claim is gone, and its estimator went with it", () => {
    // THESE TEETH USED TO DRIVE fieldLifecycleOf — this page's mapper from one
    // get_category_fill_curve row onto median / censored / window / thin /
    // absent — through each refusal in turn. The claim it built is retired, for
    // two independent reasons, and so the teeth follow it rather than pinning a
    // function that no longer has a sentence to serve:
    //
    //   IT DID NOT DIFFERENTIATE. R(14) spans 0.128-0.243 across the eighteen
    //   fields and printed as four distinct strings; the medians were
    //   27/28/29/30, the last four values the estimator can emit before it
    //   censors. Twelve tiles, four strings, one statement.
    //
    //   ITS INPUT WAS ABOUT TO STOP BEING ADMISSIBLE. get_category_fill_curve
    //   reads closed_at and does not filter absence_basis; a lap_backfill row's
    //   closed_at is, by that column's own COMMENT, "not admissible in ANY
    //   duration, tenure or fill-speed statistic". Nothing published today was
    //   wrong — no lap had completed — but the first one would have made it so
    //   silently, on eighteen tiles, in nine languages.
    //
    // THIS PAGE'S STANDING PROPERTY IS THAT A REMOVED SECTION'S COMPUTATION
    // GOES WITH IT: "arithmetic with no rendered sentence is a number waiting
    // to be re-rendered by someone who does not know why it left." That applies
    // with unusual force to an estimator whose input a column comment warns
    // about, so the absence is asserted rather than assumed.
    for (const name of ["fieldLifecycleOf", "get_category_fill_curve", "FieldCurveRow",
      "median_censored", "dated_coverage", "canStateFillRate"]) {
      expect(CODE, `${name} is back on /explore — the field-grain fill claim returned with it`)
        .not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    // AND THE REFUSALS THEMSELVES ARE NOT WEAKENED, only relocated: /jobs still
    // owns the single predicate every surface that publishes a fill rate must
    // pass through, and it still reads the RPC's own sufficiency finding rather
    // than re-deriving it from counts.
    const jobs = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
    const gate = /export function canStateFillRate\([\s\S]*?\n\}/.exec(jobs)?.[0] ?? "";
    expect(gate, "the shared predicate is gone").toBeTruthy();
    expect(gate, "the gate must read the RPC's own sufficiency finding").toMatch(/\.sufficient\b/);
    expect(gate, "the observation-window floor is the half `sufficient` cannot supply")
      .toMatch(/FILL_RATE_MIN_TRACKING_DAYS/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. AN ABSENT COLUMN IS OUR INSTRUMENT. A REFUSAL MUST NEVER BORROW A FACT.
// ─────────────────────────────────────────────────────────────────────────────

describe("a missing column never renders as a finding about an employer", () => {
  it("a lookup row without the feed columns says nothing about the employer's own total", async () => {
    // THE DEPLOY WINDOW, AND THE STATE THE PAGE SHIPPED IN. get_company_suggest
    // returned (name, tokens) alone until 20260908136000, so `feed_total` was
    // undefined on every hit and the page fell into its own refusal branch:
    // "We hold no dated reading of this employer's own total." That is FALSE
    // about our own record — job_board_verifications holds the reading — and it
    // was rendered for every single-board employer on the board.
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: { fields: {}, totals: {}, repost_index: {}, stale_parts: [], computed_at: new Date().toISOString() } };
      if (fn === "get_company_suggest") return { data: [{ name: "Wegmans", tokens: ["wegmans"] }] };
      return { data: [] };
    });
    render(<MemoryRouter initialEntries={["/explore?i=check"]}><Explore /></MemoryRouter>);
    await typeCompany("wegman");
    await waitFor(() => expect(pageText()).toMatch(/Wegmans/), { timeout: 3000 });
    expect(pageText(), "an absent column was published as an absent reading")
      .not.toMatch(/We hold no dated reading/);
  });

  it("a single-board employer we really hold no reading for still says so", async () => {
    // The other half of the same line, and it must survive the fix: a present
    // column carrying null IS "we hold no dated reading", and suppressing that
    // would trade a falsehood for a silence.
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: { fields: {}, totals: {}, repost_index: {}, stale_parts: [], computed_at: new Date().toISOString() } };
      if (fn === "get_company_suggest") return { data: [{ name: "Wegmans", tokens: ["wegmans"], open_roles: 498, feed_total: null, feed_total_at: null }] };
      return { data: [] };
    });
    render(<MemoryRouter initialEntries={["/explore?i=check"]}><Explore /></MemoryRouter>);
    await typeCompany("wegman");
    await waitFor(() => expect(pageText()).toMatch(/Wegmans/), { timeout: 3000 });
    expect(pageText(), "our own count is missing").toMatch(/498 roles open on our board now/);
    expect(pageText(), "a real absence of evidence stopped being stated").toMatch(/We hold no dated reading/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE TITLE PORT IS A PORT OF THE SEMANTICS, AND WHITESPACE IS SEMANTICS.
// ─────────────────────────────────────────────────────────────────────────────

describe("normalize_close_title groups the way the collector grouped", () => {
  const PORT = readFileSync(
    resolve(ROOT, "supabase/migrations/20260908130000_a_raw_title_is_not_a_role.sql"), "utf8",
  );
  const fold = (() => {
    const i = PORT.indexOf("pg_catalog.translate(");
    const a = PORT.indexOf("U&'", i);
    const b = PORT.indexOf("'", a + 3);
    return PORT.slice(a + 3, b);
  })();

  it("folds every character JavaScript's \\s matches and Postgres's does not", () => {
    // JS `\s` and .trim() are UNICODE-aware; Postgres `\s` is [[:space:]], ASCII
    // only in every locale this database runs, and one-argument btrim() strips
    // U+0020 alone. A single non-breaking space therefore splits ONE collector
    // key into TWO SQL groups — inflating relisted_titles and deflating the rate
    // this section ranks employers by, which is the exact inversion the port
    // exists to prevent. NBSP is demonstrably in this pipeline: job-board's
    // sources.ts carries vendor-supplied names containing one, and
    // worker/src/questions/match.ts:716 already had to widen its own class.
    const JS_ONLY = [
      0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
      0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
    ];
    // The reference set, derived rather than asserted from memory: every code
    // point below U+10000 that JS `\s` matches and Postgres cannot.
    const derived: number[] = [];
    for (let cp = 0x80; cp <= 0xffff; cp++) {
      if (/\s/.test(String.fromCharCode(cp))) derived.push(cp);
    }
    expect(derived, "the port's fold list is not JavaScript's own whitespace set").toEqual(JS_ONLY);
    for (const cp of JS_ONLY) {
      const esc = `\\${cp.toString(16).padStart(4, "0")}`;
      expect(fold, `normalize_close_title does not fold U+${cp.toString(16).toUpperCase()}`).toContain(esc);
    }
    // translate() is char-for-char: a mismatched arity silently truncates.
    expect((fold.match(/\\[0-9a-f]{4}/g) ?? []).length, "the fold list has entries the replacement string cannot cover")
      .toBe(19);
  });

  it("still never strips words, and still runs the two id regexes in order", () => {
    // NEVER STRIP WORDS is normalize.ts's own rule: a Senior Engineer closing
    // while Engineer stays live is not a repost, and a normaliser that merged
    // them would manufacture the conduct this section measures.
    const body = PORT.slice(PORT.indexOf("AS $$"), PORT.indexOf("$$;"));
    expect(body).toContain("[([{][^)\\]}]*\\d[^)\\]}]*[)\\]}]");
    expect(body).toContain("(?:req|job|id|jr)?[\\s#:-]*\\d{3,}");
    expect(body.indexOf("[([{]"), "the bracketed-segment strip must run first")
      .toBeLessThan(body.indexOf("(?:req|job|id|jr)?"));
    expect(body, "IMMUTABLE is what lets the planner fold this and an index build on it")
      .not.toMatch(/\bSTABLE\b|\bVOLATILE\b/);
  });
});
