/**
 * A FILL CLAIM WITHOUT ITS WINDOW, AND A DEDUPED COUNT WITH AN EQUALS SIGN.
 *
 * /explore's headline section published this, straight out of the cache the
 * page renders, 2026-09-06:
 *
 *   company           filled  days  open now   implied fills/day
 *   Advocate Health    6,406    11       420               582
 *   JLL                4,331    11       220               394
 *
 * JLL cannot fill 394 roles a day while holding 220 open. Those were closure
 * EVENTS — the same handful of roles leaving and coming back — rendered to a
 * job seeker as "4331 filled in 11d tracked". Two independent defects made that
 * sentence possible, and this file guards the property that closes both:
 *
 *   1. NO FILL CLAIM RENDERS WITHOUT ITS WINDOW AND ITS GATE. A figure about
 *      what happens to an employer's postings may appear only when the estimate
 *      itself is admissible (get_company_fill_curve's `sufficient`, honoured by
 *      the RPC), when enough of the record carries the employer's own posting
 *      date (FILL_COVERAGE_MIN), and when we have watched that board long
 *      enough to say anything about a fourteen-day horizon
 *      (FILL_RATE_MIN_TRACKING_DAYS) — and the span it was measured over is
 *      printed beside it, every time, never in a tooltip. A row that fails any
 *      of those does not get a hedged figure; it gets no card.
 *
 *   2. A RELIST FIGURE NEVER RENDERS AS AN EQUALITY. The collector logs only
 *      the first superseded closure per normalised title per employer per 24h
 *      and DELETES the rest, so every re-listing count on this page is a lower
 *      bound. "2,242 re-postings" is a number the query could not have
 *      produced; "2,242+" is.
 *
 * Read off a REAL RENDER, not off the source. A source guard cannot tell a
 * rendered figure from a well-spelled one, and this repo has been bitten
 * repeatedly by a guard that matched an explanation while the code it described
 * was dead. The teeth block at the foot proves each checker fails against the
 * behaviour that shipped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
import Explore from "../pages/Explore";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Comments stripped: an assertion about what the code DOES must not be
 *  satisfiable by prose describing what it no longer does. */
const CODE = read("src/pages/Explore.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

/** One row of the rewritten get_actively_hiring_companies (20260907010000).
 *  Column names are the function's own; `closed_90d` is its legacy alias for
 *  filled_roles_ceiling and is deliberately given a DIFFERENT, churn-sized
 *  value here so that anything reading it is visible on screen. */
const row = (over: Record<string, unknown> = {}) => ({
  company: "Goodfill Health",
  company_token: "good",
  closed_90d: 4331,
  open_roles: 420,
  tracking_days: 34,
  p50_days_open: 9,
  dated_n: 190,
  fills_window_days: 90,
  filled_roles_ceiling: 214,
  relisted_roles_floor: 12,
  relist_share_floor: 0.053,
  repost_events_floor: 14,
  fill_incidence_14d: 0.62,
  fill_incidence_14d_lo: 0.48,
  fill_incidence_14d_hi: 0.71,
  at_risk_14d: 260,
  fills_le_14d: 96,
  dated_share: 0.8,
  feed_total: null,
  ...over,
});

const mount = (cache: Record<string, unknown>) => {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_explore_cache") {
      // `relisting` is the collection the re-listing answer reads since
      // 20260908131000; `reposters` and `segments` are in RETIRED_CACHE_PARTS
      // and are deliberately absent here so a fixture cannot keep a retired
      // shape alive after the page stopped reading it.
      return { data: { hiring: [], relisting: [], entry: [], salary: [], transparent: [], fields: {}, totals: { hiring_n: 31 }, repost_index: {}, stale_parts: [], computed_at: new Date().toISOString(), ...cache } };
    }
    return { data: [] };
  });
  return render(<MemoryRouter initialEntries={["/explore?i=hiring"]}><Explore /></MemoryRouter>);
};

/** The whole rendered page as text. The hiring answer is the default and every
 *  other answer sits in the DOM under `hidden`, so a figure that leaks out of
 *  its gate is visible here wherever it leaks to. */
const pageText = () => document.body.textContent ?? "";

/** Every percentage on screen that could only have come from a fill measure.
 *  Two shapes are legitimate copy and are excluded: the interval "48–71%
 *  approx." and the coverage qualifier, both of which only ever appear beside
 *  an already-gated figure.
 *
 *  CASE-INSENSITIVE, AND THAT IS THE WHOLE POINT OF THE FLAG. R(14) used to be
 *  a lowercase badge ("up to 62%") prefixed to the figure; the rebuild demoted
 *  it to the evidence line, where it opens a sentence and renders "Up to 62%".
 *  A case-sensitive scanner returns [] for every page — INCLUDING A LEAKING ONE
 *  — so the three gate tests below would have gone green over a live falsehood,
 *  which is the exact shape this repo has been bitten by. The method drawer
 *  contains the words 'reads "up to"' with no digits after them, so /i cannot
 *  create a false positive here. */
const fillPercents = (txt: string): string[] =>
  [...txt.matchAll(/up to\s*(\d{1,3})%/gi)].map((m) => m[1]);

/** The card a company's name sits in — the anchor the grid renders per row. */
const cardFor = (name: string): HTMLElement | null => {
  const el = screen.queryByText(name);
  return el ? el.closest("a") : null;
};

beforeEach(() => { rpc.mockReset(); document.body.innerHTML = ""; });

describe("a fill claim without its window", () => {
  it("renders the figure, and its window in the same card", async () => {
    mount({ hiring: [row()] });
    await waitFor(() => expect(cardFor("Goodfill Health")).not.toBeNull());
    const card = cardFor("Goodfill Health")!.textContent ?? "";
    // The claim…
    expect(card, "the fill figure is not on the card").toMatch(/62%/);
    // …as a ceiling, because the deduped relists it never saw are absent from
    // the cohort the share is computed over. THE PROPERTY IS THE MARKER, NOT
    // THE PHRASE: R(14) moved from a lowercase badge beside the figure to the
    // opening of the evidence sentence ("Up to 62% of its roles came down
    // within 14 days and stayed down"), so the case is the page's business and
    // the marker is ours. Both halves are asserted — the marker is present, AND
    // the figure never appears without it — so a rewording that demotes the
    // ceiling to a point estimate fails here even if the words "up to" survive
    // somewhere else on the card.
    expect(card, "a ceiling rendered as a point estimate").toMatch(/up to\s*62%/i);
    expect(card, "the fill share appears somewhere without its ceiling marker")
      .not.toMatch(/(?<!up to\s*)\b62%/i);
    // …with the span it was measured over, in the same card. THIS is the half
    // that was optional and must never be again. The compact "34d" became
    // "across the 34 days we have watched this board"; either spelling is a
    // window, and a card with neither is a number over an unknown stretch of
    // time. Asserted against the CARD, never the page, so "in the same card"
    // stays the thing being tested.
    expect(card, "a fill figure with no window beside it").toMatch(/\b34\s*(?:d\b|days\b)/);
    // …and the horizon it is quoted at, so "62%" cannot be read as "of all
    // its roles, ever".
    expect(card, "the 14-day horizon is not stated").toMatch(/14 days/);
  });

  it("prints no figure at all when the board has not been watched long enough", async () => {
    // 11 days of watching cannot carry a fourteen-day claim. `sufficient` never
    // looks at observation depth — lifetimes run from the employer's stated
    // post date, not from our first sighting — so this is the term that has to
    // be applied here, and a hedged number is not an acceptable degradation.
    mount({ hiring: [row({ tracking_days: 11 })] });
    await waitFor(() => expect(pageText()).toMatch(/deep enough|Goodfill/));
    expect(fillPercents(pageText()), "a 14-day rate published over an 11-day record").toEqual([]);
    expect(cardFor("Goodfill Health"), "an employer with no publishable figure still got a card").toBeNull();
  });

  it("prints no figure when the rate covers a minority of the employer's board", async () => {
    // dated_share below FILL_COVERAGE_MIN. Undatedness is correlated with
    // posting AGE, so the roles dropped from the duration arm are
    // disproportionately the long-open ones — the same right-tail loss the
    // whole estimator change exists to remove, wearing a coverage label.
    mount({ hiring: [row({ dated_share: 0.12 })] });
    await waitFor(() => expect(pageText()).toMatch(/deep enough|Goodfill/));
    expect(fillPercents(pageText()), "a rate published over a third of a record").toEqual([]);
  });

  it("a row carrying only the legacy closure count makes no fill claim", async () => {
    // The regression itself: closed_90d is a count of closure events dominated
    // by re-listings. A cache row written before the rewrite carries it and
    // nothing else, and the honest rendering of that row is no card.
    mount({ hiring: [{ company: "Churn Corp", company_token: "churn", closed_90d: 4331, open_roles: 220, tracking_days: 11 }] });
    await waitFor(() => expect(pageText()).toMatch(/deep enough|Churn Corp/));
    expect(pageText(), "the closure count reached the screen as a fill count").not.toMatch(/4,?331/);
    expect(cardFor("Churn Corp"), "an unmeasured employer was recommended anyway").toBeNull();
  });

  it("says how many employers it held back, and never silently drops them", async () => {
    // An employer missing from a leaderboard is unreadable on its own: a weak
    // record, a short one and a broken instrument of ours must not look alike.
    mount({ hiring: [row(), row({ company: "Shortlog Ltd", company_token: "short", tracking_days: 11 })] });
    await waitFor(() => expect(cardFor("Goodfill Health")).not.toBeNull());
    expect(pageText(), "a withheld employer vanished without a word").toMatch(/watched for fewer than 21 days/);
  });

  it("the denominator sentence counts the cards, not the payload", async () => {
    mount({ hiring: [row(), row({ company: "Shortlog Ltd", company_token: "short", tracking_days: 11 })] });
    await waitFor(() => expect(cardFor("Goodfill Health")).not.toBeNull());
    // One card of two rows. The sentence must count what is on screen, not the
    // size of the payload — and it must be grammatical at one, which "The 1
    // employers" was not when this rendered live.
    // The section now leads with a MEDIAN rather than a fill rate, so "carries
    // a figure" became "carries a median" and "fill-measurement bars" became
    // "measurement bars". The counted quantity is unchanged: duration.shown,
    // the cards, not `hiring`, the payload.
    expect(pageText(), "the note still claims the size of the payload")
      .toMatch(/One of those carries a median here/);
    // And the payload size must not appear as the card count at all — the
    // singular branch exists because "The 1 employers" shipped live, and this
    // is the negative that pins which of the two numbers it is counting.
    expect(pageText(), "the note counted the payload rather than the cards")
      .not.toMatch(/\b2 of those carry/);
    expect(pageText(), "the pool it was drawn from is gone")
      .toMatch(/31 employers clear our measurement bars/);
  });

  it("no sentence about the pool is computed from the slice", async () => {
    // THE CENSUS DEFECT. The cache stores at most twelve rows
    // (`FILTER (WHERE r.rn <= 12)`), the client's coverage and window bars are
    // applied to those twelve alone, and the page then printed the result as a
    // fact about every employer we carry: "No employer's record is deep enough
    // to publish a fill figure right now" beside a 934-employer denominator.
    // A claim about all employers produced by testing twelve.
    //
    // Both halves are asserted: what IS said names the rows it was computed
    // over, and the un-quantified sentence cannot come back.
    mount({ hiring: [row(), row({ company: "Shortlog Ltd", company_token: "short", tracking_days: 11 })] });
    await waitFor(() => expect(cardFor("Goodfill Health")).not.toBeNull());
    expect(pageText(), "the held-back counts must name the rows they were computed over")
      .toMatch(/Counted over the 2 employers ranked here/);
    expect(pageText(), "a refusal computed from the slice must not speak for the pool")
      .not.toMatch(/No employer's record is deep enough/);
  });

  it("a refusal names the rows it tested, and an outage of ours is not a refusal", async () => {
    // Two different facts that must not borrow each other's sentence.
    //
    // (a) Rows in hand, none of them qualifying: the section says so ABOUT
    //     THOSE ROWS. It used to say it about every employer on the board.
    mount({ hiring: [row({ tracking_days: 11 })] });
    await waitFor(() => expect(pageText()).toMatch(/deep enough|could not measure/));
    expect(pageText(), "the refusal must name the rows it was computed over")
      .toMatch(/None of the 1 employers we ranked/);
  });

  it("an empty hiring payload still renders the section, and blames the instrument", async () => {
    // THE SECTION USED TO DISAPPEAR ENTIRELY. `available.hiring` was
    // `hiring.length > 0` and the whole block was wrapped in the same test, so
    // zero rows — the rewritten RPC's most likely steady state, and exactly
    // what refresh_explore_cache writes when the ranking times out — removed
    // the chip, the heading, the denominator and the honest empty state
    // together. A visitor on the shared link /explore?i=hiring was silently
    // shown a different answer.
    mount({ hiring: [] });
    await waitFor(() => expect(pageText()).toMatch(/could not measure this in the last refresh/));
    // And it is stated as a fact about US, never as a verdict on employers we
    // did not measure.
    expect(pageText(), "an outage of ours must not read as a finding about employers")
      .toMatch(/that is our instrument/);
    expect(pageText(), "a section that could not run must not refuse on the employers' behalf")
      .not.toMatch(/None of the .* employers we ranked/);
    // THE CHIP ROW IS TOTAL, so the deep link still lands where it says. The
    // label changed — "Will actually hire me" was a claim the section stopped
    // making, and reusing its key would have left eight locales advertising it
    // — but the intent id `hiring` did not, which is what makes ?i=hiring land
    // here. Asserting EVERY label rather than this one is what gives this
    // teeth: a future section that re-couples its chip to its row count fails
    // here, because that section's chip is missing from an empty payload.
    for (const label of [
      "Check an employer", "How long do I have", "Watch out: recycled dates",
      "Still up at day 30", "States the pay", "Early career", "By field",
    ]) {
      expect(pageText(), `the chip "${label}" is not offered on an empty payload`)
        .toMatch(label);
    }
  });

  it("no employer carrying the re-post warning appears under a heading that disqualifies it", async () => {
    // BUG 3, as it shipped: Accenture, Michaels, Pacs and KnitWell each
    // rendered "Re-lists roles: 2,242 re-postings across 182 roles in 49d" on
    // their own card inside the section whose blurb had just called them
    // disqualified. The gate was wrong, not the sentence.
    mount({
      hiring: [row({ company: "Serial Reposter Inc", company_token: "serial" })],
      repost_index: { serial: [2242, 182, 49] },
    });
    await waitFor(() => expect(pageText()).toMatch(/deep enough|Serial Reposter/));
    expect(cardFor("Serial Reposter Inc"), "a flagged re-poster was recommended for its fill record").toBeNull();
    expect(pageText(), "the warning is rendered inside the section that disqualifies it")
      .not.toMatch(/Re-lists roles:/);
    expect(pageText(), "the exclusion is unexplained").toMatch(/left out for serial re-listing/);
  });
});

describe("a relist figure never renders as an equality", () => {
  it("the fill card's own relist line is a floor", async () => {
    mount({ hiring: [row({ relisted_roles_floor: 12 })] });
    await waitFor(() => expect(cardFor("Goodfill Health")).not.toBeNull());
    const card = cardFor("Goodfill Health")!.textContent ?? "";
    expect(card, "a deduped relist count rendered as an exact figure").toMatch(/at least 12/);
  });

  it("the churn warning that follows an employer onto other answers is a floor", async () => {
    // It reads "Re-lists roles: 2,242 re-postings across 182 roles in 49d" in
    // nine locales. The floor marker goes on the interpolated VALUE, so every
    // one of those translations becomes a floor at once rather than eight of
    // them stating an equality until a translation pass lands.
    mount({
      entry: [{ company: "Churny Co", company_token: "chr", entry_roles: 40, open_roles: 60 }],
      repost_index: { chr: [2242, 182, 49] },
    });
    await waitFor(() => expect(pageText()).toMatch(/Re-lists roles/));
    const warn = pageText().match(/Re-lists roles:[^·]*?49d/)?.[0] ?? "";
    expect(warn, "the churn warning did not render").not.toBe("");
    expect(warn, "the event count is stated as an equality").toMatch(/2,242\+/);
    expect(warn, "the affected-role count is stated as an equality").toMatch(/182\+/);
  });

  it("no rendered re-listing count anywhere on the page lacks its floor marker", async () => {
    // The class, not the instance: every COUNT this page prints beside the
    // word "re-list" comes from the same 24h-deduped log.
    //
    // The fixture is the shipped payload, not the pre-migration one: the
    // section reads `relisting` (`reposters` is in RETIRED_CACHE_PARTS), and
    // recyclingClaimOf refuses a row that does not carry its own ranking key,
    // window and first-seen date. Both refusals are respected in the numbers
    // chosen — perRole (12.3) <= events (2,242), and events <= titles x worst
    // title (182 x 41 = 7,462) — so the card renders and the markers on it are
    // what is under test rather than the builder's gates.
    mount({
      hiring: [row()],
      relisting: [{
        company: "Repeat Ltd", company_token: "rep",
        relist_events_floor: 2242, relisted_titles: 182, events_per_title: 12.3,
        worst_title: "Nurse", worst_title_events_floor: 41,
        first_relisted_at: "2026-07-14T00:00:00Z", window_days: 49,
        board_median_per_title: 2.7, board_p90_per_title: 6.1, board_pool_n: 900,
      }],
      entry: [{ company: "Churny Co", company_token: "chr", entry_roles: 40, open_roles: 60 }],
      repost_index: { chr: [2242, 182, 49] },
      totals: { hiring_n: 31, relisting_pool_n: 900 },
    });
    await waitFor(() => expect(pageText()).toMatch(/Repeat Ltd/));
    const txt = pageText();
    // THE EQUALITIES, which is the half with teeth: each count rendered with
    // its "+" stripped is a number the deduped log could not have produced.
    for (const bare of [/2,242 re-listings/, /across 182 titles/, /— 41 times/]) {
      expect(txt, `an equality survived: ${bare}`).not.toMatch(bare);
    }
    expect(txt, "the re-listing event count lost its floor marker").toMatch(/2,242\+ re-listings/);
    // The affected-title count carries a "+" it did not carry before the
    // rebuild — the same dedupe can delete a title's only logged event.
    expect(txt, "the affected-title count lost its floor marker").toMatch(/182\+ titles/);
    expect(txt, "the worst title's count lost its floor marker").toMatch(/41\+ times/);
    // THE ONE DELIBERATE EXCEPTION, pinned as a positive so it cannot drift
    // into an unmarked count by accident and cannot acquire a marker either.
    // events_per_title is a RATIO OF TWO FLOORS deflated by the same feed-dark
    // batch drops, so it has no known direction; a "+" on it would be a
    // direction claim on the one number this section ranks conduct by.
    expect(txt, "the ranking ratio did not render").toMatch(/12\.3×/);
    expect(txt, "a ratio of two floors was given a direction it does not have")
      .not.toMatch(/12\.3\+/);
  });
});

describe("the gate is the board's, not a second copy of it", () => {
  it("Explore asks /jobs' predicate rather than re-deriving its terms", () => {
    // ONE BAR, ONE DECLARATION. These floors were once re-typed here under
    // different names, which is how two surfaces published and refused the same
    // employer: editing one file was silent on the other.
    expect(CODE).toMatch(/import \{[^}]*canStateFillRate[^}]*\} from "@\/pages\/Jobs"/);
    expect(CODE).toMatch(/import \{[^}]*FILL_COVERAGE_MIN[^}]*FILL_RATE_MIN_TRACKING_DAYS[^}]*\} from "@\/pages\/Jobs"/);
    expect(CODE, "Explore declared its own copy of the bar again")
      .not.toMatch(/const FILL_(?:COVERAGE|HORIZON|RATE)_[A-Z_]+\s*=/);
    expect(CODE, "the observation-window floor is the half `sufficient` cannot supply")
      .toMatch(/>= FILL_RATE_MIN_TRACKING_DAYS/);
    // The middle coverage band is named rather than silently passed, which is
    // the gap docs/hiring-health-model.md §5 recorded against this surface.
    expect(CODE).toMatch(/coverageBand\(/);
  });

  it("the legacy closure count is not read anywhere in the page", () => {
    // get_actively_hiring_companies still returns `closed_90d` for four
    // consumers that read by column name. This page is not one of them any
    // more: it reads filled_roles_ceiling, which counts ROLES that did not come
    // back rather than closure events.
    expect(CODE, "the count that published 4,331 fills is being read again")
      .not.toMatch(/\bclosed_90d\b/);
    expect(CODE).toMatch(/filled_roles_ceiling/);
  });

  it("the cards the section shows are the cards its button opens", () => {
    // HiringGrid/fill.shown became DurationGrid/duration.shown when the section
    // stopped leading with R(14) and started leading with the median. The
    // property is unchanged and is the reason this test exists: the button once
    // mapped the RAW payload, so it opened a board filtered to employers the
    // section had just refused to show. ONE LIST, two consumers.
    expect(CODE).toMatch(/<DurationGrid claims=\{duration\.shown\} \/>/);
    expect(CODE, "the action button re-derives its own list from the raw payload")
      .toMatch(/duration\.shown\.map\(\(c\) => c\.token\)/);
    // And the grid is fed from nothing else. `hiring` is the raw payload; a
    // grid handed it directly is the defect above, wearing a new component name.
    expect(CODE, "the duration grid was handed the raw payload")
      .not.toMatch(/<DurationGrid claims=\{(?!duration\.shown\})/);
  });
});

/**
 * TEETH — each checker above, run against the behaviour that actually shipped.
 * A guard that cannot fail is a comment.
 */
describe("teeth", () => {
  it("the window checker fails on a card with no span beside its figure", () => {
    // Both spellings of the span, against the widened checker: the old compact
    // "50d" and the shipped "across the 34 days we have watched this board".
    const shipped = "median over 190 roles · across the 34 days we have watched this board";
    const legacy = "4324 filled in 50d tracked · 172 open now";
    const noWindow = "Up to 63% of its roles came down within 14 days and stayed down";
    const win = /\b(?:34|50)\s*(?:d\b|days\b)/;
    expect(win.test(noWindow), "the checker passes a figure with no window").toBe(false);
    expect(win.test(shipped)).toBe(true);
    expect(win.test(legacy)).toBe(true);
  });

  it("the ceiling checker fails on a share published as a point estimate", () => {
    // The honesty breach this guards, in the shape the rebuild could have
    // produced: the figure demoted into a sentence with the marker dropped.
    const marked = "Up to 62% of its roles came down within 14 days and stayed down";
    const bare = "62% of its roles came down within 14 days and stayed down";
    expect(/up to\s*62%/i.test(bare), "the ceiling checker passes a point estimate").toBe(false);
    expect(/up to\s*62%/i.test(marked)).toBe(true);
    // …and the negative half, which is what catches a marker that survived
    // somewhere else on the card while the figure itself went bare.
    const both = "It reads “up to” · 62% of its roles came down";
    expect(/(?<!up to\s*)\b62%/i.test(both), "the bare-figure checker was satisfied by a stray marker").toBe(true);
    expect(/(?<!up to\s*)\b62%/i.test(marked)).toBe(false);
  });

  it("the equality checker fails on the sentence that shipped", () => {
    const shipped = "Re-lists roles: 2,242 re-postings across 182 roles in 49d";
    expect(/2,242\+/.test(shipped), "the floor checker passes an equality").toBe(false);
    expect(/2,242/.test(shipped)).toBe(true);
  });

  it("the fill-percent scanner would have caught a rate published over a short log", () => {
    // THE SHIPPED SPELLING, not a hand-written lowercase one. The three gate
    // tests above prove nothing unless the scanner can see the sentence the
    // page actually renders, and it renders the marker capitalised because
    // R(14) now opens the evidence sentence instead of sitting in a badge.
    expect(fillPercents("median over 190 roles · Up to 63% of its roles came down within 14 days and stayed down")).toEqual(["63"]);
    // The old badge's lowercase form still has to be caught — the scanner is
    // for any leak, not for one section's current wording.
    expect(fillPercents("4324 filled in 11d tracked · up to 63% taken down for good within 14d")).toEqual(["63"]);
    expect(fillPercents("4324 filled in 11d tracked · 172 open now")).toEqual([]);
    // And the method drawer's prose, which contains the marker with no figure
    // after it, must not register as a published rate.
    expect(fillPercents("which is why it reads “up to”. The interval beside it is an approximation")).toEqual([]);
  });
});
