/**
 * A FIGURE THAT LEFT ITS WINDOW BEHIND — AND A SECTION THAT OUTLIVED ITS OWN
 * DELETION.
 *
 * /explore was rebuilt into six answers. Two properties have to survive that
 * rebuild and every future one, because every defect this page has shipped was
 * one of them failing:
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
 *      deleting a section. This page has twice kept the arithmetic of something
 *      it stopped showing — trending and newest were removed from the render
 *      months before the cache stopped computing them — and a computation with
 *      no rendered sentence is a number waiting to be re-rendered by someone who
 *      does not know why it left. The five removals in this rebuild are checked
 *      as removals: the code that produced them is gone, and a cache row that
 *      still carries their payloads renders none of their numbers.
 *
 * READ OFF A REAL RENDER wherever a render can answer. A source guard cannot
 * tell a rendered figure from a well-spelled one, and this repo has been bitten
 * repeatedly by a guard that matched an explanation while the code it described
 * was dead (20260908120000 is the standing example — a COMMENT satisfied the
 * check while production kept the falsehood). Where the property is about the
 * ABSENCE of code, the source is read with comments stripped, for the same
 * reason.
 *
 * The teeth block at the foot drives each refusal with the shape that shipped,
 * so a checker that has stopped checking anything fails here first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
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
  agedClaimOf, feedTotalClaim, heldFor, rankAged, rankEntry, rankRecycling, rankedDurationClaims,
} from "../pages/Explore";

const ROOT = resolve(__dirname, "../..");
/** Comments stripped: an assertion about what the code DOES must not be
 *  satisfiable by prose describing what it no longer does. Every removal note
 *  in that file names the thing it removed, so an unstripped read would pass
 *  every one of the absence checks below. */
const CODE = readFileSync(resolve(ROOT, "src/pages/Explore.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

/** One row of the rewritten get_actively_hiring_companies (20260907010000),
 *  with the curve's own event counts merged the way refresh_explore_cache
 *  merges them. `closed_90d` carries a DIFFERENT, churn-sized value than the
 *  role counts, so anything reading the legacy column is visible on screen. */
const row = (over: Record<string, unknown> = {}) => ({
  company: "Schnucks",
  company_token: "schnucks",
  closed_90d: 4331,
  open_roles: 678,
  tracking_days: 54,
  p50_days_open: 9,
  dated_n: 214,
  fills_window_days: 90,
  filled_roles_ceiling: 214,
  relisted_roles_floor: 12,
  fill_incidence_14d: 0.62,
  fill_incidence_14d_lo: 0.48,
  fill_incidence_14d_hi: 0.71,
  at_risk_14d: 260,
  dated_share: 0.8,
  feed_total: null,
  feed_total_at: null,
  curve_fills_90d: 300,
  curve_relists_90d: 60,
  curve_ageouts_90d: 140,
  curve_tracking_days: 54,
  ...over,
});

/** One row of get_relisting_employers (20260908131000) — the section-3 shape,
 *  in the function's own column names. */
const recycleRow = (over: Record<string, unknown> = {}) => ({
  company: "BoxLunch & Hot Topic",
  company_token: "boxlunch",
  relist_events_floor: 581,
  relisted_titles: 3,
  events_per_title: 193.7,
  worst_title: "Sales Associate (R-48213)",
  // 500, NOT 41. worst_title is the modal-MAXIMUM normalised group, so the sum
  // over titles cannot exceed titles x this number: 581 events across 3 titles
  // whose largest holds 41 is arithmetically impossible (3 x 41 = 123), and
  // that exact row is the shape one judged draft shipped. It belongs in the
  // refusal test below, not in the fixture every other test builds on — a
  // default the builder must reject cannot be the default.
  worst_title_events_floor: 500,
  worst_title_first_at: "2026-07-19T00:00:00Z",
  first_relisted_at: "2026-07-19T00:00:00Z",
  observed_days: 51,
  window_days: 56,
  board_median_per_title: 1.8,
  board_p90_per_title: 4.5,
  board_pool_n: 810,
  ...over,
});

const mount = (cache: Record<string, unknown>, at = "/explore?i=hiring") => {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_explore_cache") {
      return {
        data: {
          hiring: [], relisting: [], entry: [], salary: [], transparent: [],
          ageout_basis: { ageout_log_start: "2026-07-26T00:00:00Z", ageout_log_days: 44 },
          fields: {}, totals: {}, repost_index: {}, stale_parts: [],
          computed_at: new Date().toISOString(), ...cache,
        },
      };
    }
    return { data: [] };
  });
  return render(<MemoryRouter initialEntries={[at]}><Explore /></MemoryRouter>);
};

/** The whole rendered page as text. Every answer is in the DOM under `hidden`
 *  — /explore is prerendered and every company link must stay crawlable — so a
 *  figure that leaks out of its gate is visible here wherever it leaks to. */
const pageText = () => document.body.textContent ?? "";

/** One answer's <section>, so a company appearing on two answers can still be
 *  asked about on the one under test. */
const sectionFor = (heading: RegExp): HTMLElement => {
  // BY TEXT, NOT BY ROLE. Six of the seven answers sit under `hidden` at any
  // moment — deliberately, because /explore is prerendered and every company
  // link must stay crawlable — and `hidden` removes an element from the
  // accessibility tree, so a role query can only ever see the active answer.
  // The property under test is what the page RENDERS, not what it exposes to a
  // screen reader on this particular tab.
  const h = screen.getAllByText(heading).find((el) => el.tagName === "H2");
  const s = h?.closest("section");
  if (!s) throw new Error(`no <section> around heading ${heading}`);
  return s as HTMLElement;
};
/** The card a company's name sits in, within one answer. */
const cardIn = (heading: RegExp, name: string): HTMLElement | null => {
  const hit = within(sectionFor(heading)).queryAllByText(name)[0];
  return hit ? hit.closest("a") : null;
};

const DURATION = /How long do I have/;
const RECYCLE = /dates here are not what they look like/;
const AGED = /Still advertised when it crossed day 30/;
const PAY = /Who states pay/;
const ENTRY = /Where a beginner actually has a chance/;
const CHECK = /Check an employer/;

beforeEach(() => { rpc.mockReset(); document.body.innerHTML = ""; });

// ─────────────────────────────────────────────────────────────────────────────
// 1. NO CARD PRINTS A FIGURE WITHOUT ITS WINDOW
// ─────────────────────────────────────────────────────────────────────────────

describe("every published figure carries the window it was measured over", () => {
  it("the median lifetime prints its span, its sample, and the cap that floors it", async () => {
    mount({ hiring: [row()], totals: { hiring_n: 31 } });
    await waitFor(() => expect(cardIn(DURATION, "Schnucks")).not.toBeNull());
    const card = cardIn(DURATION, "Schnucks")!.textContent ?? "";
    // The figure, as a FLOOR in the number itself: we stop serving at day 30,
    // so every role that outlived the cap is missing from the median and the
    // true value can only be larger.
    expect(card, "the median is not on the card").toMatch(/9\+/);
    // THE WINDOW. The employer's own span, never "90 days of watching" — the
    // closure log began 2026-07-14 and that watch was never performed.
    expect(card, "a median with no span beside it").toMatch(/54 days we have watched this board/);
    // THE SAMPLE, and it is dated_n — the roles the duration was computed from
    // — never n_at_risk_14, which is the survivors at day 14.
    expect(card, "a median with no sample beside it").toMatch(/214 roles carrying the employer's own post date/);
    expect(card, "the 30-day censoring cap is not disclosed").toMatch(/stop serving a posting at 30 days/);
    // The date basis: whose clock the duration is on.
    expect(card, "the date basis is missing").toMatch(/date the employer itself put on them/);
  });

  it("R(14) is demoted to evidence and still names its horizon", async () => {
    mount({ hiring: [row()], totals: { hiring_n: 31 } });
    await waitFor(() => expect(cardIn(DURATION, "Schnucks")).not.toBeNull());
    const card = cardIn(DURATION, "Schnucks")!.textContent ?? "";
    expect(card, "the incidence lost its ceiling qualifier").toMatch(/Up to 62%/);
    expect(card, "a 14-day figure that does not say 14 days").toMatch(/within 14 days/);
    // The headline is the duration, not the rate: the big number on the card is
    // the one the heading asks about.
    const big = card.indexOf("9+");
    const rate = card.indexOf("Up to 62%");
    expect(big, "the rate outranks the median the section is about").toBeLessThan(rate);
  });

  it("a median with no observation window is not published at all", async () => {
    // tracking_days below FILL_RATE_MIN_TRACKING_DAYS. `sufficient` never looks
    // at observation depth — lifetimes run from the employer's stated date, not
    // from our first sighting — so this is the term that has to be applied, and
    // a hedged number is not an acceptable degradation.
    mount({ hiring: [row({ tracking_days: 11, curve_tracking_days: 11 })], totals: { hiring_n: 31 } });
    await waitFor(() => expect(pageText()).toMatch(/deep enough|Schnucks/));
    expect(cardIn(DURATION, "Schnucks"), "a figure published over an 11-day record").toBeNull();
    expect(pageText(), "a withheld employer vanished without a word").toMatch(/watched for fewer than 21 days/);
  });

  it("a row that clears every rate bar but carries no median says so, and prints no median", async () => {
    mount({ hiring: [row({ p50_days_open: null, dated_n: 0 })], totals: { hiring_n: 31 } });
    await waitFor(() => expect(pageText()).toMatch(/deep enough|no median/));
    expect(cardIn(DURATION, "Schnucks"), "a card rendered with nothing to lead with").toBeNull();
    expect(pageText(), "the refusal is silent, which reads as no data")
      .toMatch(/carry no median: too few of their closed roles state a date from the employer/);
  });

  it("the age-out share prints both counts and the span they cover", async () => {
    mount({ hiring: [row()], totals: { hiring_n: 31 } }, "/explore?i=aged");
    await waitFor(() => expect(cardIn(AGED, "Schnucks")).not.toBeNull());
    const card = cardIn(AGED, "Schnucks")!.textContent ?? "";
    // 140 of (300 + 60 + 140) = 28%.
    expect(card, "the share is wrong or absent").toMatch(/28%/);
    expect(card, "the numerator is not stated as a floor").toMatch(/140\+ roles still up at the cap/);
    expect(card, "the denominator is not stated").toMatch(/of 500\+ takedowns, re-listings and age-outs/);
    expect(card, "an age-out share with no span").toMatch(/54 days we have watched this board/);
    expect(card, "back-dated exits are not disclaimed").toMatch(/back-dated/);
    // A RATIO OF TWO FLOORS CARRIES NO DIRECTION. The 24h dedupe understates the
    // denominator (pushing the share up); an exit row we failed to write
    // understates the numerator (pushing it down). Marking it either way is a
    // claim neither count supports.
    expect(card, "the share was published as a lower bound it is not").not.toMatch(/28%\+/);
    expect(card, "the card does not say why the share carries no marker")
      .toMatch(/Both counts are floors/);
    // AND IT DOES NOT CLAIM THE SET. board_dormant and untracked exits are roles
    // that left and are in none of the three counts, so "everything we watched
    // leave this board" was a denominator wider than the one it named.
    expect(card, "the denominator claims a population it is not")
      .not.toMatch(/everything we watched leave/);
  });

  it("the age-out card names the ledger it was counted from, not the column's name", async () => {
    // ageouts_90d is named for ninety days of exit events. The exit ledger began
    // 2026-07-26 and is pruned at ninety, so the record is SHORTER than the
    // name — and a count printed beside a "_90d" invites a division by a watch
    // we did not perform, which is the "90 days of watching" defect exactly.
    mount({ hiring: [row()], totals: { hiring_n: 31 } }, "/explore?i=aged");
    await waitFor(() => expect(cardIn(AGED, "Schnucks")).not.toBeNull());
    expect(cardIn(AGED, "Schnucks")!.textContent, "the ledger's own span is missing")
      .toMatch(/exit ledger that holds 44 days in all/);
    // TWO LEDGERS, TWO SPANS, BOTH PRINTED. The takedowns and re-listings come
    // from the closure log (this employer's own 54 days); the age-outs come from
    // an exit ledger that began later and holds 44. One span over a pair drawn
    // from two records is "90 days of watching" in miniature.
    expect(cardIn(AGED, "Schnucks")!.textContent, "one span was printed over two ledgers")
      .toMatch(/the closure half across the 54 days/);
  });

  it("the curve is fetched for the age-out count only when that answer is opened", async () => {
    // get_company_fill_curve is the single owner of ageouts_90d, and it is a
    // ~25-second grouped scan. Paying it on every default page view to fill a
    // section most readers never open is the cost this page removed once
    // already; refusing to pay it at all leaves the section permanently
    // refusing. So it is fetched on demand, once.
    mount({ hiring: [row({ curve_ageouts_90d: undefined, curve_fills_90d: undefined, curve_relists_90d: undefined })], totals: { hiring_n: 31 } });
    await waitFor(() => expect(cardIn(DURATION, "Schnucks")).not.toBeNull());
    expect(rpc.mock.calls.map((c) => c[0]), "the 25-second curve ran on a page view that did not need it")
      .not.toContain("get_company_fill_curve");

    // Opening the answer — through the control a reader actually uses, because
    // the query string is read off window.location and a MemoryRouter entry
    // does not touch it.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("tab", { name: /Still up at day 30/ }));
    await waitFor(() => expect(rpc.mock.calls.map((c) => c[0])).toContain("get_company_fill_curve"));
  });

  it("the re-listing card prints its ratio, its window, its first sighting and the baseline", async () => {
    mount({ relisting: [recycleRow()], totals: { relisting_pool_n: 810 } }, "/explore?i=ghost");
    await waitFor(() => expect(cardIn(RECYCLE, "BoxLunch & Hot Topic")).not.toBeNull());
    const card = cardIn(RECYCLE, "BoxLunch & Hot Topic")!.textContent ?? "";
    expect(card, "the ranking figure is not on the card").toMatch(/193\.7×/);
    // NO "+" ON THE RATIO. Both terms are floors — the 24h dedupe deletes
    // events, and a feed-dark batch drop can delete a title's only event with it
    // — and a ratio of two floors has no known direction. Marking it would be a
    // claim about direction on the number this section ranks conduct by.
    expect(card, "the ratio was published as a lower bound it is not").not.toMatch(/193\.7\+×/);
    expect(card, "both counts must be floors").toMatch(/581\+ re-listings across 3\+ titles/);
    // ONE WINDOW, COMMON TO EVERY CARD, and it comes from the query — the log
    // began 2026-07-14, so 56 days is what there is to measure over.
    expect(card, "a conduct finding with no window").toMatch(/56 days of closure log/);
    expect(card, "the first sighting is missing").toMatch(/first seen/);
    // The baseline is re-measured in this window under this grouping. The 2.7
    // from 2026-08-12 was measured on raw titles over an unbounded window at 29
    // days of log, and may not be reused here.
    expect(card, "no baseline, so the ratio means nothing")
      .toMatch(/board-wide in the same window: median 1\.8× per affected title, top tenth above 4\.5×, across 810 employers/);
    expect(pageText(), "a stale baseline was reused under a new definition").not.toMatch(/2\.7\+?×/);
  });

  it("a re-listing row with no window renders no card", async () => {
    mount({ relisting: [recycleRow({ window_days: null })] }, "/explore?i=ghost");
    await waitFor(() => expect(pageText()).toMatch(/no re-listing measurement|BoxLunch/));
    expect(cardIn(RECYCLE, "BoxLunch & Hot Topic"), "a conduct card with no window").toBeNull();
  });

  it("the pay median renders only with its own sample, and refuses in words", async () => {
    mount({
      transparent: [
        { company: "Statespay Ltd", company_token: "sp", open_roles: 300, pay_pct: 92, median_usd_floor: 84000, usd_n: 140 },
        { company: "Onepost Inc", company_token: "op", open_roles: 300, pay_pct: 88, median_usd_floor: 250000, usd_n: 1 },
      ],
    }, "/explore?i=pay");
    await waitFor(() => expect(cardIn(PAY, "Statespay Ltd")).not.toBeNull());
    expect(cardIn(PAY, "Statespay Ltd")!.textContent, "a median with no sample beside it")
      .toMatch(/median stated floor \$84,000 across the 140 of its postings we could read as a US-dollar annual floor/);
    // THE GATE IS THE MEDIAN'S OWN SAMPLE, not the size of the board: one USD
    // posting among three hundred published a "median floor" with a sample of
    // one for as long as the row carried no usd_n.
    expect(cardIn(PAY, "Onepost Inc")!.textContent, "a median from a sample of one reached the screen")
      .not.toMatch(/250,000/);
    // THE SENTENCE MUST NAME WHAT usd_n COUNTS. It is count(*) WHERE
    // salary_currency = 'USD' AND salary_min_annual > 0 — a PARSED ANNUAL FLOOR,
    // which that migration's own COMMENT ON calls "a strict subset and
    // frequently far smaller". Calling it "roles that state pay in US dollars"
    // printed "only 1 of its roles state pay in US dollars" directly beneath a
    // badge saying 88% of 300 roles state pay: two populations, one sentence.
    expect(cardIn(PAY, "Onepost Inc")!.textContent, "the refusal is a gap rather than a sentence")
      .toMatch(/only 1 of its roles carry a pay figure we could read as a US-dollar annual floor, fewer than the 20 we require/);
    expect(cardIn(PAY, "Onepost Inc")!.textContent, "a parsed-annual-floor count was described as stating pay")
      .not.toMatch(/of its roles state pay in US dollars/);
  });

  it("a median the SQL withheld still leaves the sample sentence behind", async () => {
    // get_transparent_employers now nulls median_usd_floor below the floor
    // itself. Testing the median for null FIRST would render no line at all for
    // an employer with three USD postings — a silence a reader takes for
    // "states no pay", which is the opposite of what membership in this list
    // means. The refusal has to outlive the number it refuses.
    mount({ transparent: [{ company: "Threepost Ltd", company_token: "tp", open_roles: 300, pay_pct: 91, median_usd_floor: null, usd_n: 3 }] }, "/explore?i=pay");
    await waitFor(() => expect(cardIn(PAY, "Threepost Ltd")).not.toBeNull());
    expect(cardIn(PAY, "Threepost Ltd")!.textContent, "a withheld median left no sentence at all")
      .toMatch(/only 3 of its roles carry a pay figure we could read as a US-dollar annual floor/);
  });

  it("a row from a function that does not return usd_n refuses as OUR limit, not theirs", async () => {
    // The deploy window: the page is new and get_transparent_employers has not
    // gained the column yet. "Fewer than 20 of its roles state pay" would be a
    // confident falsehood about an employer listed precisely because it states
    // pay on 80% of its board — a broken instrument rendering as a fact about
    // the thing it measures.
    mount({ transparent: [{ company: "Preflight Ltd", company_token: "pf", open_roles: 300, pay_pct: 92, median_usd_floor: 84000 }] }, "/explore?i=pay");
    await waitFor(() => expect(cardIn(PAY, "Preflight Ltd")).not.toBeNull());
    const card = cardIn(PAY, "Preflight Ltd")!.textContent ?? "";
    expect(card, "an unmeasured sample was published as a finding about the employer")
      .not.toMatch(/fewer than/);
    expect(card, "the refusal does not say whose limit it is")
      .toMatch(/we hold no count of how many of its roles carry a pay figure we could read as a US-dollar annual floor/);
    expect(card, "the median rendered without a sample").not.toMatch(/84,000/);
  });

  it("the entry-level card states a share and discloses whose word “entry-level” is", async () => {
    mount({ entry: [{ company: "Wide Gate Co", company_token: "wg", entry_roles: 40, open_roles: 60 }], totals: { entry_n: 220 } }, "/explore?i=entry");
    await waitFor(() => expect(cardIn(ENTRY, "Wide Gate Co")).not.toBeNull());
    expect(cardIn(ENTRY, "Wide Gate Co")!.textContent, "the count is published without its denominator")
      .toMatch(/67% of its 60 open roles are entry-level \(40 roles\)/);
    expect(within(sectionFor(ENTRY)).getByText(/classifier/i).textContent, "our classifier is presented as the employer's label")
      .toMatch(/No employer told us that/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TWO NUMBERS FROM TWO POPULATIONS ARE NEVER DIVIDED BY EACH OTHER
// ─────────────────────────────────────────────────────────────────────────────

describe("what we hold and what they advertise are two numbers, never a ratio", () => {
  it("the employer check prints both, with the day theirs was read", async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: { hiring: [], recycling: [], entry: [], salary: [], transparent: [], fields: {}, totals: {}, repost_index: {}, stale_parts: [], computed_at: new Date().toISOString() } };
      if (fn === "get_company_suggest") {
        return { data: [{ name: "CVS Health", tokens: ["cvs"], open_roles: 678, feed_total: 19265, feed_total_at: "2026-09-06T12:00:00Z" }] };
      }
      return { data: [] };
    });
    render(<MemoryRouter initialEntries={["/explore?i=check"]}><Explore /></MemoryRouter>);
    const input = await screen.findByPlaceholderText(/Type a company name/);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "cvs" } });
    await waitFor(() => expect(pageText()).toMatch(/CVS Health/), { timeout: 3000 });
    const card = within(sectionFor(CHECK)).getAllByText("CVS Health")[0].closest("a")!.textContent ?? "";
    expect(card, "our own floor is missing").toMatch(/678 roles open on our board now/);
    expect(card, "their total is missing, or missing its date").toMatch(/19,265 roles when we last read it on/);
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

  it("the age-out share never mixes the curve's events with the RPC's role counts", () => {
    // fills_90d/relists_90d/ageouts_90d are one population under one feed-dark
    // policy and are windows of EVENTS; filled_roles_ceiling and
    // relisted_roles_floor are ROLES under a different one. A numerator from one
    // and a denominator from the other is not a rate of anything.
    const rpcOnly = row({ curve_fills_90d: undefined, curve_relists_90d: undefined, curve_ageouts_90d: undefined, curve_tracking_days: undefined });
    expect(agedClaimOf(rpcOnly), "a denominator assembled from two populations").toBeNull();
    const halfMerged = row({ curve_relists_90d: undefined });
    expect(agedClaimOf(halfMerged), "a share computed from a partial merge").toBeNull();
    const noWindow = row({ curve_tracking_days: undefined });
    expect(agedClaimOf(noWindow), "an age-out share with no span").toBeNull();
  });

  it("the age-out answer speaks only for employers the previous answer admitted", () => {
    const short = row({ company: "Shortlog", company_token: "short", tracking_days: 11, curve_tracking_days: 11 });
    expect(heldFor(short, new Set()), "an 11-day record was admitted").toBe("window");
    expect(rankAged([short], new Set()).map((c) => c.token), "a card rested on evidence the page refused one answer earlier").toEqual([]);
    expect(rankAged([row(), short], new Set()).map((c) => c.token)).toEqual(["schnucks"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. A HEADING ABOUT CONDUCT RANKS ON CONDUCT
// ─────────────────────────────────────────────────────────────────────────────

describe("the re-listing answer ranks on the rate, and refuses an incoherent row", () => {
  it("puts the worst ratio first, not the biggest volume", () => {
    // THE SHAPE, NOT A MEASUREMENT. These rows are modelled on figures
    // get_repost_churn_companies reported on 2026-08-12 — RAW titles, unbounded
    // window, 29 days of log — and the equivalents under normalize_close_title
    // grouping have never been measured, because job_board_closures has no anon
    // read path here. They are fixtures for the ORDERING property (a rate ranks
    // conduct, a raw count ranks size) and are not quoted anywhere a reader can
    // see them.
    const order = rankRecycling([
      recycleRow({ company: "ALTEN", company_token: "alten", relist_events_floor: 769, relisted_titles: 298, events_per_title: 2.6, worst_title_events_floor: 9 }),
      recycleRow({ company: "BAYADA", company_token: "bayada", relist_events_floor: 594, relisted_titles: 270, events_per_title: 2.2, worst_title_events_floor: 7 }),
      recycleRow(),
    ]).map((c) => c.token);
    expect(order, "ranked by raw events, which is a ranking by size").toEqual(["boxlunch", "alten", "bayada"]);
  });

  it("refuses a ratio the counts beside it cannot produce", () => {
    // THE ROW THAT SHIPPED, EXACTLY. One judged draft published a card asserting
    // 581 events across 3 titles whose own worst title showed 41. Every pairwise
    // check passes on it — 193.7 <= 581, and 41 <= 581 — so the guard that only
    // tested those two let it through. The invariant that binds is the sum over
    // titles against titles x the LARGEST title: worst_title is the modal-max
    // group, so 3 titles capped at 41 hold at most 123, not 581. The WHOLE card
    // drops: the incoherence is in the headline pair, not in the detail line.
    expect(
      rankRecycling([recycleRow({ worst_title_events_floor: 41 })]),
      "581 events across 3 titles whose largest holds 41 reached the page",
    ).toEqual([]);
    // And it is not merely rejecting anything with a small worst title: the
    // same row with a worst title large enough to carry the sum renders.
    expect(rankRecycling([recycleRow({ worst_title_events_floor: 200 })]).length).toBe(1);
    expect(rankRecycling([recycleRow({ relist_events_floor: 12, events_per_title: 193.7 })]), "an impossible ratio was published").toEqual([]);
    // And a per-title count larger than the employer's own total drops the line
    // rather than printing it.
    const c = rankRecycling([recycleRow({ worst_title_events_floor: 999 })])[0];
    expect(c.worstEvents, "a per-title figure larger than the sum it belongs to").toBeNull();
  });

  it("never derives the ranking key itself", () => {
    // The number the cards are ordered by must be the number the query grouped
    // by. Deriving events/roles here would publish a ratio under a definition
    // this page chose — and the whole point of the section is that the grouping
    // IS the measurement.
    expect(rankRecycling([recycleRow({ events_per_title: null })]), "the client invented the ranking key").toEqual([]);
    expect(CODE, "a client-side ratio crept back in").not.toMatch(/relist_events_floor\s*\/\s*/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. NO REMOVED SECTION'S COMPUTATION SURVIVES
// ─────────────────────────────────────────────────────────────────────────────

describe("the five removals are removals, not hidden sections", () => {
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

  it("the field chips carry counts and the note that contradicted them is gone", async () => {
    mount({ fields: { engineering: 38412, design: 900 }, totals: { postings_n: 38412 } }, "/explore?i=fields");
    await waitFor(() => expect(pageText()).toMatch(/Browse by field/));
    const s = sectionFor(/Browse by field/);
    // The chip formats through the serving API's own cap, so the number on it
    // and the number on the page it opens are one number in one presentation.
    expect(within(s).getByText("10,000+"), "the chip stopped capping").toBeTruthy();
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
      hiring: [row()],
      totals: { hiring_n: 31 },
      segments: { mega: { companies: 212, open_roles: 129810, entry_pct: 4, remote_pct: null, median_usd_floor: null, usd_n: null, top: [{ company: "Ghost Band Co", company_token: "gb", on_board: 300, company_total: 1200 }] } },
      reposters: [{ company: "Rawtitle Ltd", company_token: "raw", repost_events: 2242, reposted_roles: 298, worst_title: "Nurse (R-48213)", worst_count: 41, tracking_days: 49 }],
      trending: [{ company: "Trendy Inc", company_token: "tr", recent: 900 }],
      newest: [{ company: "Newbie Inc", company_token: "nb" }],
    });
    await waitFor(() => expect(cardIn(DURATION, "Schnucks")).not.toBeNull());
    const txt = pageText();
    for (const ghost of ["Ghost Band Co", "Rawtitle Ltd", "Trendy Inc", "Newbie Inc", "129,810", "2,242", "1,000+ open roles"]) {
      expect(txt, `a removed section rendered "${ghost}" from a stale cache row`).not.toContain(ghost);
    }
    // And the legacy closure count is still not read anywhere: it is the number
    // that put 4,331 "fills" on JLL's card.
    expect(txt, "closed_90d reached the screen").not.toMatch(/4,?331/);
  });

  it("a stale part naming a section this page no longer renders is not a warning about this page", async () => {
    mount({ hiring: [row()], totals: { hiring_n: 31 }, stale_parts: ["trending", "segments", "hiring"] });
    await waitFor(() => expect(cardIn(DURATION, "Schnucks")).not.toBeNull());
    expect(pageText(), "the staleness line named a collection nothing here renders").not.toMatch(/trending, segments/);
    // …but a part that DOES back an answer on this page still raises the line.
    expect(pageText(), "a real stale collection went unannounced").toMatch(/hiring could not be recomputed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE i18n HAZARD: A LOCALE VALUE OVERRIDES AN INLINE DEFAULT
// ─────────────────────────────────────────────────────────────────────────────

describe("copy that changed meaning changed key", () => {
  /** Nine locales carry these values. A locale VALUE beats an inline English
   *  default, so re-using one of these keys for a sentence that now measures
   *  something else leaves eight languages rendering the retracted wording —
   *  which is how this product shipped a "no subscriptions" claim that had
   *  moved runtimes, and a re-post badge stating an equality in eight
   *  languages while English said "at least". */
  const RETIRED = [
    "explore.hiringTitle", "explore.hiringTitleRanked", "explore.hiringBlurb", "explore.hiringBlurbRanked",
    "explore.hiringBadge", "explore.hiringFillRate", "explore.hiringSpeed", "explore.fillLabel",
    "explore.fillEvidence", "explore.fillWindow", "explore.fillOpenBoth", "explore.fillUpTo",
    "explore.repostTitle", "explore.repostBlurb", "explore.repostBadge", "explore.repostBadgeCapped",
    "explore.repostAcross", "explore.noteGhost", "explore.noteGhostFlagged", "explore.noteHiring",
    "explore.noteHiringPoolGated", "explore.noteHiringShown", "explore.noteHiringShownOne",
    "explore.noteEntry", "explore.noteFields", "explore.entryTitle", "explore.entryBlurb",
    "explore.entryBadge", "explore.entryBadgeRatio", "explore.transparentTitle", "explore.transparentBlurb",
    "explore.transparentMedian", "explore.checkTitle", "explore.checkBlurb",
    "explore.segTitle", "explore.segBlurb", "explore.segMega", "explore.segLarge", "explore.segMid",
    "explore.segSmall", "explore.segOther", "explore.segOpen", "explore.segOpenBoth", "explore.segStats",
    "explore.segStatsBase", "explore.segRemoteDisclosed", "explore.segSalary",
    "explore.trendingTitle", "explore.trendingBlurb", "explore.trendingBadge",
    "explore.newestTitle", "explore.newestBlurb",
    "explore.intentHiring", "explore.intentGhost", "explore.intentScale",
    "explore.seoTitle", "explore.seoTitle2", "explore.seoDescription", "explore.seoDescription2",
    "explore.subhead", "explore.hiringNoneRankedTitle", "explore.hiringNoneBody",
    "explore.hiringHeldReposter", "explore.methodFillTerm", "explore.hiringBlurbCurve",
    "explore.methodRankTerm", "explore.methodRankMethod", "explore.methodOpenTerm", "explore.methodOpenMethod",
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
    // no value — "explore.durHeadline" in the middle of a card.
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
  it("the window gate is what refuses a short record, not luck", () => {
    const ok = rankedDurationClaims([row()], new Set());
    expect(ok.shown.map((c) => c.token)).toEqual(["schnucks"]);
    expect(ok.shown[0].windowDays, "the window travelled separately from the figure").toBe(54);
    expect(ok.shown[0].sample).toBe(214);
    const short = rankedDurationClaims([row({ tracking_days: 11, curve_tracking_days: 11 })], new Set());
    expect(short.shown).toEqual([]);
    expect(short.held.window).toBe(1);
  });

  it("a numeric that arrives as a string is coerced, not compared as text", () => {
    // `"0.42" >= 0.3` is true by string collation for the wrong reason, and
    // `"0.12" >= 0.3` is false for the right one by accident. Both gates must
    // run on numbers.
    const asText = rankedDurationClaims([row({ dated_share: "0.12", fill_incidence_14d: "0.62" })], new Set());
    expect(asText.shown, "a 12% coverage record was published").toEqual([]);
    expect(asText.held.estimate).toBe(1);
    const fine = rankedDurationClaims([row({ dated_share: "0.80", fill_incidence_14d: "0.62", p50_days_open: "9", dated_n: "214" })], new Set());
    expect(fine.shown.length, "a string-typed numeric refused a good record").toBe(1);
  });

  it("the ordering is the median, and ties do not fall to size", () => {
    const claims = rankedDurationClaims([
      row({ company: "Slow Co", company_token: "slow", p50_days_open: 27 }),
      row({ company: "Fast Co", company_token: "fast", p50_days_open: 4 }),
      row({ company: "Tie Big", company_token: "big", p50_days_open: 9, dated_n: 40, open_roles: 90000 }),
      row({ company: "Tie Evidenced", company_token: "eviD", p50_days_open: 9, dated_n: 900, open_roles: 60 }),
    ], new Set());
    expect(claims.shown.map((c) => c.token), "the order stopped being the figure the card leads with")
      .toEqual(["fast", "eviD", "big", "slow"]);
  });

  it("the entry answer's order is the share it prints, whatever order the payload arrives in", () => {
    // MEASURED LIVE, 2026-09-08, before this was enforced: the payload is
    // ordered by COUNT and rendered under a heading promising a ranking by
    // share, so the cards read 39%, 17%, 17%, 44%, 86% down the page. An order
    // that contradicts its own sentence is the defect this rebuild removes.
    const rows = [
      { company: "Marriott", company_token: "marriott", entry_roles: 3905, open_roles: 9933 },
      { company: "CVS Health", company_token: "cvs", entry_roles: 2766, open_roles: 16708 },
      { company: "Ulta Beauty", company_token: "ulta", entry_roles: 1127, open_roles: 2537 },
      { company: "CHS", company_token: "chs", entry_roles: 1068, open_roles: 1245 },
    ];
    expect(rankEntry(rows).map((r) => r.company_token), "the count order survived under a share heading")
      .toEqual(["chs", "ulta", "marriott", "cvs"]);
    // And the floors the card states in words are enforced on the rows, so a
    // perfect ratio on a tiny board cannot top a list about where a beginner
    // has a chance.
    const thin = [{ company: "Three Role Co", company_token: "three", entry_roles: 3, open_roles: 3 }];
    expect(rankEntry(thin), "a three-role board topped the list on a perfect ratio").toEqual([]);
    expect(rankEntry([{ company: "Big Thin", company_token: "bt", entry_roles: 9, open_roles: 900 }]), "the entry floor is not applied").toEqual([]);
  });

  it("a flagged serial re-poster is never recommended by the duration answer", () => {
    const held = rankedDurationClaims([row()], new Set(["schnucks"]));
    expect(held.shown, "an employer flagged for churn was recommended anyway").toEqual([]);
    expect(held.held.reposter).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. AN ABSENT COLUMN IS OUR INSTRUMENT. A REFUSAL MUST NEVER BORROW A FACT.
//
// Every gate on this page can fail for two unrelated reasons: the record is
// thin, or our query did not answer. The sentences are different, and this
// block drives the shapes that made them collapse into one another. Three of
// the four were live falsehoods about employers, produced by a missing column.
// ─────────────────────────────────────────────────────────────────────────────

describe("a missing column never renders as a finding about an employer", () => {
  it("a lookup row without the feed columns says nothing about the employer's own total", async () => {
    // THE DEPLOY WINDOW, AND THE STATE THE PAGE SHIPPED IN. get_company_suggest
    // returned (name, tokens) alone until 20260908136000, so `feed_total` was
    // undefined on every hit and the page fell into its own refusal branch:
    // "We hold no dated reading of this employer's own total." That is FALSE
    // about our own record — job_board_verifications holds the reading and
    // get_actively_hiring_companies already returns it — and it was rendered for
    // every single-board employer on the board.
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: { hiring: [], relisting: [], entry: [], salary: [], transparent: [], fields: {}, totals: {}, repost_index: {}, stale_parts: [], computed_at: new Date().toISOString() } };
      if (fn === "get_company_suggest") return { data: [{ name: "Wegmans", tokens: ["wegmans"] }] };
      return { data: [] };
    });
    render(<MemoryRouter initialEntries={["/explore?i=check"]}><Explore /></MemoryRouter>);
    const input = await screen.findByPlaceholderText(/Type a company name/);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "wegman" } });
    await waitFor(() => expect(pageText()).toMatch(/Wegmans/), { timeout: 3000 });
    expect(pageText(), "an absent column was published as an absent reading")
      .not.toMatch(/We hold no dated reading/);
  });

  it("a single-board employer we really hold no reading for still says so", async () => {
    // The other half of the same line, and it must survive the fix: a present
    // column carrying null IS "we hold no dated reading", and suppressing that
    // would trade a falsehood for a silence.
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") return { data: { hiring: [], relisting: [], entry: [], salary: [], transparent: [], fields: {}, totals: {}, repost_index: {}, stale_parts: [], computed_at: new Date().toISOString() } };
      if (fn === "get_company_suggest") return { data: [{ name: "Wegmans", tokens: ["wegmans"], open_roles: 498, feed_total: null, feed_total_at: null }] };
      return { data: [] };
    });
    render(<MemoryRouter initialEntries={["/explore?i=check"]}><Explore /></MemoryRouter>);
    const input = await screen.findByPlaceholderText(/Type a company name/);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "wegman" } });
    await waitFor(() => expect(pageText()).toMatch(/Wegmans/), { timeout: 3000 });
    expect(pageText(), "our own count is missing").toMatch(/498 roles open on our board now/);
    expect(pageText(), "a real absence of evidence stopped being stated").toMatch(/We hold no dated reading/);
  });

  it("an age-out measurement that ran and returned zero is a finding, not an outage", async () => {
    // rankAged drops any row whose ageouts are zero, so a curve that answered
    // for every token and found no age-outs produced an EMPTY list — and the
    // page said "the lifecycle measurement did not reach this page". That blames
    // our instrument for a state it reached successfully, which is the us/them
    // confusion the duration answer separates with `unmeasured` against
    // `undated`.
    mount({ hiring: [row({ curve_ageouts_90d: 0 })], totals: { hiring_n: 31 } }, "/explore?i=aged");
    await waitFor(() => expect(pageText()).toMatch(/logged a role still up|did not reach this page/));
    expect(pageText(), "a successful measurement was reported as an outage")
      .not.toMatch(/The lifecycle measurement behind this answer did not reach this page/);
    expect(pageText(), "the finding is not stated").toMatch(/None of the employers ranked here logged a role still up at our cap/);
    // AND IT IS STILL NOT A CLEAN BILL: the count is a floor.
    expect(pageText()).toMatch(/not a clean bill/);
  });

  it("a curve that never answered still reads as our instrument", async () => {
    mount({ hiring: [row({ curve_ageouts_90d: undefined, curve_fills_90d: undefined, curve_relists_90d: undefined })], totals: { hiring_n: 31 } }, "/explore?i=aged");
    await waitFor(() => expect(pageText()).toMatch(/did not reach this page|logged a role still up/), { timeout: 3000 });
    expect(pageText(), "an outage was reported as a finding about employers")
      .not.toMatch(/None of the employers ranked here logged a role still up at our cap/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. A DENOMINATOR NAMES THE POOL ITS CARDS WERE DRAWN FROM, OR IT IS ABSENT.
// ─────────────────────────────────────────────────────────────────────────────

describe("a pool sentence degrades to silence, never to the wrong number", () => {
  const entryRow = { company: "Wide Gate Co", company_token: "wg", entry_roles: 40, open_roles: 60 };

  it("names the pool only when the server says which gate counted it", async () => {
    // entry_n EXISTS UNDER BOTH DEFINITIONS — the deployed `entry_n >= 5` with
    // no board floor, and this rebuild's 10-entry/50-open pair — so its presence
    // cannot say which one produced it, and the frontend deploys before
    // migrations apply. Without a shape marker the sentence prints the OLD pool
    // beneath the NEW floors' wording, over twelve cards filtered client-side to
    // the new floors: the stat-provenance defect verbatim.
    mount({ entry: [entryRow], totals: { entry_n: 1938 } }, "/explore?i=entry");
    await waitFor(() => expect(cardIn(ENTRY, "Wide Gate Co")).not.toBeNull());
    expect(within(sectionFor(ENTRY)).queryByText(/1,938 employers clear our floors/), "a pool counted under the old gate was named under the new floors").toBeNull();
  });

  it("names it when the markers match the floors it is about to state", async () => {
    mount({ entry: [entryRow], totals: { entry_n: 220, entry_min_entry: 10, entry_min_open: 50 } }, "/explore?i=entry");
    await waitFor(() => expect(cardIn(ENTRY, "Wide Gate Co")).not.toBeNull());
    expect(within(sectionFor(ENTRY)).getByText(/220 employers clear our floors of at least 10 entry-level roles and 50 roles open/)).toBeTruthy();
  });

  it("refuses when the server's gate is not the gate the cards were filtered by", async () => {
    mount({ entry: [entryRow], totals: { entry_n: 900, entry_min_entry: 5, entry_min_open: 0 } }, "/explore?i=entry");
    await waitFor(() => expect(cardIn(ENTRY, "Wide Gate Co")).not.toBeNull());
    expect(within(sectionFor(ENTRY)).queryByText(/900 employers clear/), "a pool from a different gate was named anyway").toBeNull();
  });

  it("the re-listing pool is not named above a section holding no cards", async () => {
    // relisting_pool_n comes off the raw RPC rows (max(board_pool_n)) BEFORE
    // recyclingClaimOf applies its refusals, so a payload whose rows all lack a
    // window yields a pool of 810 and zero cards — a denominator printed
    // directly above the panel saying the section holds no measurement. Its two
    // siblings were already gated at their call sites; this one was not.
    mount({ relisting: [recycleRow({ window_days: null })], totals: { relisting_pool_n: 810 } }, "/explore?i=ghost");
    await waitFor(() => expect(pageText()).toMatch(/no re-listing measurement/));
    expect(pageText(), "a denominator was printed for twelve cards that do not exist")
      .not.toMatch(/810 employers cleared the re-listing floor/);
  });

  it("and is named when there are cards under it", async () => {
    mount({ relisting: [recycleRow()], totals: { relisting_pool_n: 810 } }, "/explore?i=ghost");
    await waitFor(() => expect(cardIn(RECYCLE, "BoxLunch & Hot Topic")).not.toBeNull());
    expect(pageText()).toMatch(/810 employers cleared the re-listing floor/);
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
