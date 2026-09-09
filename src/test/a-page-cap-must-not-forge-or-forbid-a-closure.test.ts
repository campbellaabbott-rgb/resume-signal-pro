import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A PAGE CAP MUST NOT FORGE A CLOSURE, AND MUST NOT FORBID ONE FOREVER.
 *
 * THE PROPERTY, IN TWO HALVES THAT ONLY MEAN ANYTHING TOGETHER:
 *
 *   (1) A posting is NEVER logged as closed on evidence that cannot tell
 *       "the employer took it down" from "it was displaced past our page cap".
 *   (2) A board over the page cap is NOT permanently excluded from producing
 *       closures.
 *
 * Half (1) alone is satisfied by the code this file was written against: with
 * MAX_POSTINGS_PER_VISIT cut to 250, every board whose feed advertises more is
 * permanently `windowed`, and `if (partialRead) continue` meant no stored
 * posting on such a board could ever be stamped, closed or ledgered. Perfectly
 * safe, and wrong: 23 of the 34 companies in the explore cache are over the cap
 * and hold 98% of their roles; ~270 boards at 500+ roles are 36.4% of
 * inventory. A real takedown at CVS Health (16,027 postings) stayed on the site
 * for up to thirty days, until OUR freshness cap removed it, and every
 * lifecycle statistic was computed on a population that structurally excluded
 * those employers while claiming nothing of the sort.
 *
 * Half (2) alone is satisfied by simply deleting the suppression, which was
 * measured to be a lie: 7 of 8 sampled "closures" on a windowed board were
 * still open on the employer's own careers site (2026-07-21).
 *
 * SO THE MECHANISM UNDER TEST IS NEITHER. Absence is proved ACROSS visits: the
 * deep cursor walks a big board from offset 0 to a wrap, the union of that
 * pass's windows is the whole feed, every posting a lap serves is stamped with
 * the lap's epoch, and only an id that reached a COMPLETE, FULLY INSTRUMENTED
 * wrap without the epoch may be treated as gone — then still through the same
 * two-pass grace, one lap per pass.
 *
 * WHY THIS FILE EXECUTES THE SHIPPED EXPRESSIONS INSTEAD OF GREPPING FOR THEM.
 * This repo has four separate incidents of a guard passing on a spelling while
 * the code it described was dead, and one where the pinned literal lived in a
 * COMMENT. A test that asserts the string "lapProven" appears somewhere proves
 * nothing about whether a displaced posting can be logged as a takedown. So
 * every behavioural claim below is made by lifting the actual decision
 * expressions out of index.ts, compiling them, and running scenarios through
 * them. If someone rewrites the mechanism, these fail on OUTCOMES. If someone
 * moves it far enough that the anchors no longer find it, the extraction fails
 * loudly and says so, which is a deliberate re-anchoring rather than a silent
 * green.
 */

const ROOT = resolve(__dirname, "../..");
const COLLECTOR = resolve(ROOT, "supabase/functions/job-board/index.ts");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

const RAW = readFileSync(COLLECTOR, "utf8");
/** Comments removed. Every claim about behaviour is made against THIS. */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Lift one shipped expression out of the collector. A miss is a hard failure
 * with the reason spelled out: the mechanism moved, and re-pointing this file
 * at it is a decision somebody has to make on purpose.
 */
function lift(what: string, re: RegExp): string {
  const m = re.exec(CODE);
  if (!m) {
    throw new Error(
      `Could not find the shipped ${what} in supabase/functions/job-board/index.ts.\n` +
        `This test executes the real decision rather than grepping for its name, so a\n` +
        `refactor that moves it must re-anchor this file DELIBERATELY. Do not delete the\n` +
        `assertion: find where "${what}" now lives and update the pattern.`,
    );
  }
  return js(m[1].trim());
}

/**
 * The lifted text is TypeScript; `new Function` takes JavaScript. Only type
 * ASSERTIONS are removed — `(r.feedTotal as number)` becomes `(r.feedTotal)` —
 * which cannot change what the expression computes, because an assertion has
 * no runtime meaning. Nothing else is rewritten: the operators, the operands
 * and their order are the shipped ones.
 */
function js(src: string): string {
  return src.replace(/\s+as\s+(?:number|string|boolean|const)\b/g, "");
}

function liftAll(re: RegExp): string[] {
  return [...CODE.matchAll(re)].map((m) => js(m[1].trim()));
}

// ── the shipped decisions, compiled ─────────────────────────────────────────

/** How far the advertised total may fall DURING a lap before the lap forfeits. */
const LAP_COVERAGE_MIN = Number(lift("LAP_COVERAGE_MIN", /const LAP_COVERAGE_MIN = ([\d.]+);/));
/** How far short of the feed's advertised end a lap may stop, in OFFSETS. */
const LAP_TAIL_SLACK = Number(lift("LAP_TAIL_SLACK", /const LAP_TAIL_SLACK = (\d+);/));

/**
 * The wrap test: may this visit conclude a full pass happened?
 *
 * Lifted WITH its preamble, because the three derived numbers are half the
 * decision — a harness that passed them in as parameters would be testing its
 * own arithmetic rather than the shipped rule.
 */
const provenPre = lift(
  "lap-proof preamble",
  /(const totalNow = Math\.max\(0, Math\.trunc\(r\.feedTotal \?\? 0\)\);[\s\S]*?const tailSlack = [^;]+;)/,
);
const provenSrc = lift(
  "lap-proven condition",
  /if \((r\.nextOffset === 0 && cursorBefore > 0[\s\S]*?)\) \{\s*lapProven = true;/,
);
const isLapProven = new Function(
  "r",
  "cursorBefore",
  "rec",
  "lapSeen",
  "LAP_COVERAGE_MIN",
  "LAP_TAIL_SLACK",
  `${provenPre}\nreturn !!(${provenSrc});`,
) as (
  r: { nextOffset: number | undefined; feedTotal: number | null; feedEnded?: boolean },
  cursorBefore: number,
  rec: { f: 0 | 1; t0: number },
  lapSeen: number,
  min: number,
  slack: number,
) => boolean;

/** A wrap that satisfies everything, so a scenario only has to say what it breaks. */
const cleanWrap = (over: Partial<{ nextOffset: number; feedTotal: number | null; feedEnded: boolean }> = {}) =>
  ({ nextOffset: 0, feedTotal: 10_000, feedEnded: true, ...over });
const cleanRec = (over: Partial<{ f: 0 | 1; t0: number }> = {}) => ({ f: 0 as 0 | 1, t0: 10_000, ...over });
const proven = (
  r: { nextOffset: number | undefined; feedTotal: number | null; feedEnded?: boolean },
  cursorBefore: number,
  rec: { f: 0 | 1; t0: number },
  lapSeen: number,
) => isLapProven(r, cursorBefore, rec, lapSeen, LAP_COVERAGE_MIN, LAP_TAIL_SLACK);

/** The epoch this visit stamps with; 0 disables every lap behaviour. */
const lapMarkSrc = lift("lapMark", /const lapMark = ([^;]+);/);
const lapMarkOf = new Function(
  "missingColUnknown",
  "lapColUnknown",
  "lapEpoch",
  `return (${lapMarkSrc});`,
) as (missingColUnknown: boolean, lapColUnknown: boolean, lapEpoch: number) => number;

/** The one visit per lap allowed to conclude a posting is gone. */
const lapModeSrc = lift("lapMode", /const lapMode = ([^;]+);/);
const lapModeOf = new Function(
  "r",
  "lapProven",
  "lapMark",
  `return !!(${lapModeSrc});`,
) as (r: { windowed: boolean }, lapProven: boolean, lapMark: number) => boolean;

/**
 * The line that decides whether an absent id may proceed to the grace/closure
 * machinery at all. TRUE here means SKIP: this pass cannot speak to that id.
 *
 * It is lifted with matchAll deliberately. It appears twice — once in the loop
 * that counts the pass's absence for the shrink ratchet and the feed-dark
 * guard, once in the loop that actually stamps and prunes — and the two MUST be
 * the same test, or the ratio stamped on a closure row describes a different
 * population from the one that produced it. That disagreement is the defect
 * 20260906090000 exists to prevent, so it is asserted, not assumed.
 */
const skipSrcs = liftAll(/if \((partialRead && [^\n]*?)\) continue;/g);
if (skipSrcs.length === 0) {
  throw new Error(
    "Could not find the shipped windowed-absence test in job-board/index.ts.\n" +
      "That line is the entire subject of this file: it is what refuses to treat a\n" +
      "posting displaced past the page cap as a takedown. Re-anchor deliberately.",
  );
}
const cannotSpeakTo = new Function(
  "partialRead",
  "lapMode",
  "existingById",
  "id",
  "lapMark",
  `return !!(${skipSrcs[0]});`,
) as (
  partialRead: boolean,
  lapMode: boolean,
  existingById: Map<string, { lap_epoch: number | null }>,
  id: string,
  lapMark: number,
) => boolean;

/** The gate on the branch that writes job_board_closures. */
const logGateSrc = lift(
  "closure-log gate",
  /if \((vanished\.length && \(!truncatedFetch \|\| lapMode\))\) \{/,
);
const logsClosures = new Function(
  "vanished",
  "truncatedFetch",
  "lapMode",
  `return !!(${logGateSrc});`,
) as (vanished: string[], truncatedFetch: boolean, lapMode: boolean) => boolean;

/** Which served rows get this lap's epoch written to them. */
const markSrc = lift(
  "seen-this-visit predicate",
  /toUnstamp = \[\.\.\.liveIds\]\.filter\(\(id\) => \{([\s\S]*?)\n {10}\}\);/,
);
const marksRow = new Function(
  "id",
  "existingById",
  "lapMark",
  markSrc,
) as (
  id: string,
  existingById: Map<string, { missing_since: string | null; lap_epoch: number | null }>,
  lapMark: number,
) => boolean;

const row = (lap_epoch: number | null, missing_since: string | null = null) => ({ lap_epoch, missing_since });
const oneRow = (id: string, lap_epoch: number | null, missing_since: string | null = null) =>
  new Map([[id, row(lap_epoch, missing_since)]]);

// ── half (1): a page cap must not forge a closure ───────────────────────────

describe("absence that cannot be distinguished from displacement is never a closure", () => {
  it("a windowed board with no completed lap can speak to no id, whatever the row holds", () => {
    // Every shape a stored row can be in — never stamped, stamped by an older
    // lap, stamped by THIS lap — and a windowed pass that has not wrapped
    // refuses all of them. This is the pre-existing suppression, unweakened.
    for (const epoch of [null, 1, 6, 7]) {
      expect(cannotSpeakTo(true, false, oneRow("x", epoch), "x", 7)).toBe(true);
    }
  });

  it("a posting SERVED during the lap is never closed by that lap's wrap", () => {
    // The whole point of the epoch: it separates "we walked past it and it was
    // there" from "we walked the entire feed and it was nowhere".
    expect(cannotSpeakTo(true, true, oneRow("x", 7), "x", 7)).toBe(true);
  });

  it("an open lap is not a completed one", () => {
    // A board being walked right now has an epoch on most of its rows and a
    // cursor mid-feed. Until the WRAP, none of that is evidence: the ids below
    // the cursor were passed, the ids above it were not yet reached, and the
    // two are indistinguishable from the row alone.
    expect(lapModeOf({ windowed: true }, false, 7)).toBe(false);
    expect(cannotSpeakTo(true, lapModeOf({ windowed: true }, false, 7), oneRow("x", null), "x", 7)).toBe(true);
  });

  it("a lap that only covered part of the feed proves nothing", () => {
    expect(proven(cleanWrap(), 9_750, cleanRec(), 10_000)).toBe(true);
    // A feed that went dark mid-lap wraps early (an empty page ends the walk).
    // Half a board read is not a pass over a board.
    expect(proven(cleanWrap(), 9_750, cleanRec(), 5_000)).toBe(false);
    expect(proven(cleanWrap(), 9_750, cleanRec(), 0)).toBe(false);
  });

  it("a lap that did not open at offset 0, or whose vendor states no total, proves nothing", () => {
    // Mid-feed at deploy time: the board was never walked from the start, so
    // ids below the cursor were never given a chance to carry the epoch.
    expect(proven(cleanWrap(), 0, cleanRec(), 10_000)).toBe(false);
    // No advertised total means no denominator, so coverage is unknowable.
    expect(proven(cleanWrap({ feedTotal: 0 }), 9_750, cleanRec({ t0: 0 }), 10_000)).toBe(false);
    expect(proven(cleanWrap({ feedTotal: null }), 9_750, cleanRec({ t0: 0 }), 10_000)).toBe(false);
    // Not a wrap at all — an ordinary mid-lap visit.
    expect(proven(cleanWrap({ nextOffset: 9_750 }), 9_500, cleanRec(), 10_000)).toBe(false);
  });

  it("a lap that lost an epoch write proves nothing, because its gaps are unfalsifiable", () => {
    // Rows that WERE served but failed to receive the epoch are, at the wrap,
    // indistinguishable from rows nobody served. A database blip must not
    // become employer takedowns, so the whole lap forfeits its proof.
    expect(proven(cleanWrap(), 9_750, cleanRec({ f: 1 }), 10_000)).toBe(false);
  });

  it("A WRAP ON THE ADVERTISED TOTAL IS NOT AN OBSERVATION THAT THE FEED ENDED", () => {
    // THE SELF-CERTIFYING DENOMINATOR. Every paginated fetcher wraps on
    // `exhausted || advanced >= feedTotal`, so a coverage test against that
    // same feedTotal has numerator and denominator moving together: any
    // understated total certifies itself as a complete pass. index.ts names the
    // live instance — "several tenants report exactly 2000, which is Workday's
    // own reporting cap rather than a count" — and such a tenant keeps serving
    // past 2000, so every stored row beyond it is unreachable, unstamped, and
    // would become a logged takedown on a live role.
    //
    // `feedEnded` is set ONLY by a short or empty page: the feed itself saying
    // it ended. Without it the wrap proves nothing, whatever the arithmetic.
    expect(proven(cleanWrap({ feedEnded: false }), 9_750, cleanRec(), 10_000)).toBe(false);
    expect(proven(cleanWrap({ feedEnded: undefined }), 9_750, cleanRec(), 10_000)).toBe(false);
    // The reporting-cap tenant, in its own numbers: 2,000 advertised, 2,000
    // reached, full coverage by any ratio — and still refused.
    expect(proven({ nextOffset: 0, feedTotal: 2_000, feedEnded: false }, 1_820, { f: 0, t0: 2_000 }, 2_000)).toBe(false);
  });

  it("a total that collapses mid-lap cannot certify the lap it is the denominator of", () => {
    // CVS Health: 16,027 at lap open, cursor at 9,900, and page 0 of this visit
    // comes back saying 10,000. Against the CURRENT total the lap reads as
    // complete; against the total it started walking it is 63% of a board.
    expect(proven({ nextOffset: 0, feedTotal: 10_000, feedEnded: true }, 9_900, { f: 0, t0: 16_027 }, 10_150)).toBe(false);
    // A genuine, modest shrink is churn, not a collapse: it still proves.
    expect(proven({ nextOffset: 0, feedTotal: 9_800, feedEnded: true }, 9_600, { f: 0, t0: 10_000 }, 9_800)).toBe(true);
  });

  it("a short page in the last tenth is unfetched territory, not churn", () => {
    // `s` is an OFFSET, so a shortfall against the feed's end is offsets never
    // requested. A 10% ratio on a 16,027-posting board would admit a lap that
    // stopped 1,500 offsets early — a single transient short page — and then
    // convert that whole tail into takedowns. The tolerance is absolute.
    expect(proven({ nextOffset: 0, feedTotal: 16_027, feedEnded: true }, 14_500, { f: 0, t0: 16_027 }, 14_510)).toBe(false);
    expect(proven({ nextOffset: 0, feedTotal: 16_027, feedEnded: true }, 15_900, { f: 0, t0: 16_027 }, 15_960)).toBe(true);
    // Small boards keep the proportional slack: the bound is the NARROWER of
    // the two, so it never grows past a tenth of a small feed.
    expect(proven({ nextOffset: 0, feedTotal: 200, feedEnded: true }, 100, { f: 0, t0: 200 }, 170)).toBe(false);
    expect(proven({ nextOffset: 0, feedTotal: 200, feedEnded: true }, 100, { f: 0, t0: 200 }, 185)).toBe(true);
  });

  it("the coverage bar is high enough that a half-read board cannot condemn its other half", () => {
    expect(LAP_COVERAGE_MIN).toBeGreaterThan(0.75);
    expect(LAP_COVERAGE_MIN).toBeLessThanOrEqual(1);
    // And the tail bound is a small absolute number of offsets, not a share of
    // however big the employer happens to be.
    expect(LAP_TAIL_SLACK).toBeGreaterThan(0);
    expect(LAP_TAIL_SLACK).toBeLessThanOrEqual(250);
  });

  it("without the epoch column, a windowed board falls back to proving nothing", () => {
    // Deploy-before-migration, or any read that came back on a narrower column
    // list: lapMark is 0, lapMode collapses, and a missing lap_epoch can never
    // be misread as "absent from the whole feed".
    expect(lapMarkOf(false, true, 9)).toBe(0);
    expect(lapMarkOf(true, false, 9)).toBe(0);
    expect(lapModeOf({ windowed: true }, true, 0)).toBe(false);
    expect(cannotSpeakTo(true, lapModeOf({ windowed: true }, true, 0), oneRow("x", null), "x", 0)).toBe(true);
  });

  it("the counting loop and the pruning loop apply the SAME test", () => {
    // The feed-dark guard stamps batch_removed / batch_live_before on every
    // closure row as the numbers that DECIDED. If the loop that counts absence
    // and the loop that prunes it disagreed, the stored ratio would describe a
    // different population from the verdict beside it.
    expect(skipSrcs.length).toBe(2);
    expect(new Set(skipSrcs).size).toBe(1);
  });

  it("a windowed pass with no proven lap never reaches the closure-log branch", () => {
    expect(logsClosures(["a", "b"], true, false)).toBe(false);
  });
});

// ── half (2): a page cap must not forbid a closure forever ──────────────────

describe("a board over the page cap can produce a closure again", () => {
  it("an id absent from every window of a completed lap is admissible", () => {
    // Never stamped, or stamped by an earlier lap: either way it was in no
    // window of the pass just finished.
    expect(cannotSpeakTo(true, true, oneRow("x", null), "x", 7)).toBe(false);
    expect(cannotSpeakTo(true, true, oneRow("x", 6), "x", 7)).toBe(false);
  });

  it("a proven lap opens the closure-log branch for a windowed board", () => {
    const lapMode = lapModeOf({ windowed: true }, true, 7);
    expect(lapMode).toBe(true);
    expect(logsClosures(["a"], true, lapMode)).toBe(true);
  });

  it("boards read in full are completely unaffected", () => {
    // The 28,000 small boards keep the behaviour they had: absence within one
    // fetch, no epoch, no lap, no change.
    expect(cannotSpeakTo(false, false, oneRow("x", null), "x", 0)).toBe(false);
    expect(logsClosures(["a"], false, false)).toBe(true);
  });

  it("every posting a lap serves is marked exactly once per lap", () => {
    // The write that carries the epoch is the unstamp write that was already
    // here, widened — so a row already marked for this lap and not flagged
    // missing costs nothing, which is what keeps this off the write-
    // amplification path that bloated this table once before.
    const seen = new Map([["x", row(7, null)]]);
    expect(marksRow("x", seen, 7)).toBe(false);
    const stale = new Map([["x", row(6, null)]]);
    expect(marksRow("x", stale, 7)).toBe(true);
    const never = new Map([["x", row(null, null)]]);
    expect(marksRow("x", never, 7)).toBe(true);
    // A reappeared row still clears its stamp even on a board with no lap.
    const flickered = new Map([["x", row(null, "2026-09-08T00:00:00Z")]]);
    expect(marksRow("x", flickered, 0)).toBe(true);
    // And a board with no lap open writes no epochs at all.
    expect(marksRow("x", stale, 0)).toBe(false);
  });
});

// ── the two halves together, over a board's actual lifetime ─────────────────

describe("a full lap lifecycle on a board four times the page cap", () => {
  /**
   * 1,000 postings, 250 a visit, four visits to a lap. Between lap 1 and lap 2
   * the employer takes one role down, and a SEPARATE posting is skipped by the
   * pagination shifting under us (the failure mode that makes single-lap
   * confirmation unsafe: a takedown above the cursor pulls every later posting
   * up one offset, so one id falls between two windows while being live).
   *
   * The board must end with the takedown closed and the skipped posting still
   * live, having proved both without ever reading a row twice.
   */
  const PAGE = 250;
  const feed0 = Array.from({ length: 1000 }, (_, i) => `wd:${i}`);

  function runLap(
    epoch: number,
    feed: string[],
    stored: Map<string, { lap_epoch: number | null; missing_since: string | null }>,
    skip: string | null,
  ) {
    let cursor = 0;
    let lapSeen = 0;
    let lapProvenNow = false;
    /**
     * The collector's `liveIds` is THIS VISIT's rows, not the lap's union — the
     * wrap visit of a 1,000-posting board holds 250 ids and every other stored
     * row is "absent" from it. That is exactly why absence within a visit means
     * nothing, and modelling it any other way would let a broken epoch test
     * pass this file.
     */
    let lastServed: string[] = [];
    // The lap walks in the vendor's own offsets. `skip` models an id that no
    // window happens to land on because the feed shifted mid-walk.
    const walked = feed.filter((id) => id !== skip);
    while (true) {
      const served = walked.slice(cursor, cursor + PAGE);
      const nextOffset = cursor + served.length >= walked.length ? 0 : cursor + served.length;
      const cursorBefore = cursor;
      lapSeen = Math.max(lapSeen, nextOffset > 0 ? nextOffset : cursorBefore + served.length);
      for (const id of served) {
        if (!stored.has(id)) { stored.set(id, row(epoch)); continue; }
        if (marksRow(id, stored, epoch)) {
          stored.get(id)!.lap_epoch = epoch;
          stored.get(id)!.missing_since = null;
        }
      }
      // `feedEnded` is what the fetcher observes when a page comes back short
      // — the walk running out of feed, as it does on the last window here.
      lapProvenNow = proven(
        { nextOffset, feedTotal: feed.length, feedEnded: nextOffset === 0 },
        cursorBefore,
        { f: 0, t0: feed.length },
        lapSeen,
      );
      lastServed = served;
      if (nextOffset === 0) break;
      cursor = nextOffset;
    }
    // The wrap's prune, in the shape the collector applies it.
    const liveIds = new Set(lastServed);
    const closed: string[] = [];
    for (const id of [...stored.keys()]) {
      if (liveIds.has(id)) continue;
      if (cannotSpeakTo(true, lapModeOf({ windowed: true }, lapProvenNow, epoch), stored, id, epoch)) continue;
      const cur = stored.get(id)!;
      if (cur.missing_since) { closed.push(id); stored.delete(id); }
      else cur.missing_since = `wrap-${epoch}`;
    }
    return { proven: lapProvenNow, closed };
  }

  it("closes a real takedown in two laps and never closes the displaced posting", () => {
    const stored = new Map<string, { lap_epoch: number | null; missing_since: string | null }>();

    // Lap 1: first sight of the whole board. Nothing is gone, nothing closes.
    const l1 = runLap(1, feed0, stored, null);
    expect(l1.proven).toBe(true);
    expect(l1.closed).toEqual([]);
    expect(stored.size).toBe(1000);

    // The employer removes wd:400. Pagination shifts, so wd:900 falls between
    // two windows of lap 2 while remaining perfectly live.
    const feed1 = feed0.filter((id) => id !== "wd:400");
    const l2 = runLap(2, feed1, stored, "wd:900");
    expect(l2.proven).toBe(true);
    // FIRST proven lap of absence stamps; it does not close. Both the real
    // takedown and the displaced posting are merely marked.
    expect(l2.closed).toEqual([]);
    expect(stored.get("wd:400")!.missing_since).toBe("wrap-2");
    expect(stored.get("wd:900")!.missing_since).toBe("wrap-2");

    // Lap 3 sees wd:900 again — the skip does not repeat — and still cannot
    // find wd:400 anywhere in the feed.
    const l3 = runLap(3, feed1, stored, null);
    expect(l3.proven).toBe(true);
    expect(l3.closed).toEqual(["wd:400"]);
    // THE HALF THAT MATTERS BOTH WAYS: the takedown is gone from the board and
    // the live-but-displaced posting is back, unstamped, still served.
    expect(stored.has("wd:400")).toBe(false);
    expect(stored.get("wd:900")!.missing_since).toBe(null);
    expect(stored.get("wd:900")!.lap_epoch).toBe(3);
  });

  it("a lap the feed cut short closes nothing, however long the posting has been absent", () => {
    const stored = new Map<string, { lap_epoch: number | null; missing_since: string | null }>();
    runLap(1, feed0, stored, null);
    const feed1 = feed0.filter((id) => id !== "wd:400");
    runLap(2, feed1, stored, null);
    expect(stored.get("wd:400")!.missing_since).toBe("wrap-2");

    // Lap 3 walks a feed that answers with a quarter of itself. The employer's
    // own advertised total is unchanged, so coverage fails and the wrap proves
    // nothing — the stamped id waits rather than closing on a collection fault.
    const dark = feed1.slice(0, 250);
    let cursor = 0;
    const served = dark.slice(cursor, cursor + PAGE);
    cursor += served.length;
    const cutShort = proven(
      { nextOffset: 0, feedTotal: feed1.length, feedEnded: true },
      1,
      { f: 0, t0: feed1.length },
      cursor,
    );
    expect(cutShort).toBe(false);
    expect(cannotSpeakTo(true, lapModeOf({ windowed: true }, cutShort, 3), stored, "wd:400", 3)).toBe(true);
    expect(stored.has("wd:400")).toBe(true);
  });
});

// ── the population every published closure number is entitled to claim ──────

describe("the log says which kind of evidence ended each posting", () => {
  it("closure rows are stamped with a basis, and the two bases are the two mechanisms", () => {
    // Not a spelling check: this asserts the collector cannot write a closure
    // row without recording WHICH population it belongs to, because pooling a
    // full-read closure with a lap closure is a claim about coverage that
    // nobody made.
    const closureRow = /const closureRows = rows\.map\(\(r\) => \(\{([\s\S]*?)\n {16}\}\)\);/.exec(CODE);
    expect(closureRow, "the closure row builder moved — re-anchor this test").toBeTruthy();
    const basis = /absence_basis: ([\s\S]*?)\n {18}\.\.\.lifecycleFacets/.exec(closureRow![1]);
    expect(basis, "a closure row must record what kind of absence produced it").toBeTruthy();
    const decide = new Function(
      "lapMode",
      "lapBackfillUntil",
      "missingSinceById",
      "r",
      "startIso",
      `return (${basis![1].trim().replace(/,\s*$/, "")});`,
    ) as (
      lapMode: boolean,
      lapBackfillUntil: string,
      missingSinceById: Map<string, string | null>,
      r: { id: string },
      startIso: string,
    ) => string;

    const NOW = "2026-09-20T00:00:00.000Z";
    const none = new Map<string, string | null>();
    // A board read in full: one fetch, absence is a fact about that fetch.
    expect(decide(false, "", none, { id: "a" }, NOW)).toBe("full_read");
    // A settled lap: the row was stamped by the previous lap, well after this
    // board's first observable one.
    const settled = new Map<string, string | null>([["a", "2026-09-18T00:00:00.000Z"]]);
    expect(decide(true, "2026-09-10T00:00:00.000Z", settled, { id: "a" }, NOW)).toBe("lap");
    // THE BACKLOG. This row was stamped by the board's FIRST proven lap, so its
    // absence began somewhere in the preceding thirty days and nothing here
    // knows when. closed_at will say today; the basis says not to believe it.
    const backlog = new Map<string, string | null>([["a", "2026-09-10T00:00:00.000Z"]]);
    expect(decide(true, "2026-09-10T00:00:00.000Z", backlog, { id: "a" }, NOW)).toBe("lap_backfill");
    // A row with no stamp at all on the very first proven lap is backlog too:
    // the board has no history in which it could have been seen absent.
    expect(decide(true, NOW, none, { id: "a" }, NOW)).toBe("lap_backfill");
  });

  it("the basis column survives a deploy that lands ahead of its migration", () => {
    // settleInsertError strips only what the database complains about; a
    // column missing from that list takes the WHOLE closure insert down, and a
    // lost pass of closures cannot be recovered from anywhere.
    const optional = /const CLOSURE_OPTIONAL_COLS = \[([\s\S]*?)\] as const;/.exec(CODE);
    expect(optional).toBeTruthy();
    expect(optional![1]).toContain("absence_basis");
  });

  it("an instrumentation gap in the middle of a lap disarms it", () => {
    // The two places where the cursor has already advanced past a window but
    // that window's rows did not receive the epoch. Both must forfeit the lap;
    // `isLapProven` above proves that forfeiting works, this proves it is
    // actually reached.
    const readFail = /failed\.push\(`\$\{s\.name\} \(db-read\)`\);\s*failLap\(\);/.test(CODE);
    expect(readFail, "a failed board read must disarm the lap it interrupted").toBe(true);
    const writeFail = /missing-unstamp failed[\s\S]{0,400}?failLap\(\);/.test(RAW);
    expect(writeFail, "a failed epoch write must disarm the lap it holed").toBe(true);
  });

  it("a migration publishes the population, and names the boards that still cannot produce a closure", () => {
    const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
    const withFn = files.filter((f) =>
      /CREATE OR REPLACE FUNCTION public\.get_closure_population/.test(
        readFileSync(resolve(MIGRATIONS, f), "utf8"),
      ),
    );
    expect(withFn.length, "no migration defines get_closure_population()").toBeGreaterThan(0);
    const sql = readFileSync(resolve(MIGRATIONS, withFn[withFn.length - 1]), "utf8");
    // The four buckets must all exist as returned columns — a population that
    // reports only the boards it CAN read is the false claim this whole change
    // is about. Asserted against the RETURNS clause, which is code.
    const returns = /RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/.exec(sql);
    expect(returns).toBeTruthy();
    for (const col of [
      "boards_full_read",
      "boards_lap_proven",
      "boards_lap_pending",
      "boards_unprovable",
    ]) {
      expect(returns![1], `the population must report ${col}`).toContain(col);
    }
  });
});

// ── the ways a lap can be armed over ground it never actually stamped ───────

describe("a lap may not carry evidence it did not gather", () => {
  it("A VISIT THAT COULD NOT STAMP DISARMS THE LAP, not merely itself", () => {
    // lapMark 0 suppresses stamping and proving FOR THE VISIT. But the lap
    // bookkeeping runs BEFORE the existing-rows read and has already credited
    // that window's offsets to `rec.s`, so without a disarm the lap goes on
    // believing it covered ground nothing was stamped on — and the wrap writes
    // missing_since over every row those visits served, out of the serving
    // fence, on the largest boards.
    //
    // This is guaranteed on the deploy that ships lap_epoch: the function goes
    // live before the migration applies, and index.ts already carries three
    // deploy-window fallbacks for exactly that ordering.
    const disarmSrc = lift(
      "unstampable-visit disarm",
      /(const lapMark = [^;]+;[\s\S]*?)const lapMode =/,
    );
    const run = new Function(
      "missingColUnknown",
      "lapColUnknown",
      "lapEpoch",
      "failLap",
      `${disarmSrc}\nreturn lapMark;`,
    ) as (m: boolean, l: boolean, e: number, failLap: () => void) => number;

    for (const [m, l] of [[true, false], [false, true], [true, true]] as Array<[boolean, boolean]>) {
      let disarmed = 0;
      const mark = run(m, l, 9, () => { disarmed++; });
      expect(mark, "a visit that cannot stamp must stamp nothing").toBe(0);
      expect(
        disarmed,
        "the visit suppressed its own stamping but left the lap armed — the wrap will " +
          "treat every row served in this window as absent from the whole feed",
      ).toBeGreaterThan(0);
    }

    // And an ordinary visit does NOT disarm: a guard that always fires would
    // make the mechanism a permanent no-op while reporting itself as tracking.
    let disarmed = 0;
    expect(run(false, false, 9, () => { disarmed++; })).toBe(9);
    expect(disarmed).toBe(0);
  });

  it("a board read whole in one visit never opens a lap it can never close", () => {
    // `windowed` is `feedTotal > all.length`, so a tenant that advertises 140
    // and serves 137 reports windowed with nextOffset 0 (index.ts's own
    // Caterpillar note: 503 served against 942 advertised). Opening a lap there
    // means a fresh epoch every visit, an UPDATE over the board's whole row set
    // every visit on the hottest table in the system, a permanent __laps entry
    // the 45-day prune never reaches — and a wrap test requiring cursorBefore
    // > 0 that can never be satisfied. All cost, no evidence.
    const opensSrc = lift("lap-open condition", /const lapOpens = ([^;]+);/);
    const opens = new Function("cursorBefore", "r", `return !!(${opensSrc});`) as (
      c: number,
      r: { nextOffset: number | undefined },
    ) => boolean;
    expect(opens(0, { nextOffset: 250 }), "a board with work left to resume opens a lap").toBe(true);
    expect(opens(0, { nextOffset: 0 }), "start and end at offset 0 is a whole read, not a lap").toBe(false);
    expect(opens(250, { nextOffset: 500 }), "a lap already open is not re-opened mid-walk").toBe(false);
    expect(opens(250, { nextOffset: 0 }), "the WRAP visit must not open a new lap").toBe(false);
    expect(opens(0, { nextOffset: undefined }), "a board with no cursor has no lap").toBe(false);
  });

  it("the lap map is keyed by vendor AND token, because a token is not a board", () => {
    // 139 catalog tokens are carried by two or three vendors, and six pair a
    // windowed rippling board with a non-windowed twin. Under a token key the
    // twin's visit takes the retire branch and DELETES the rippling board's
    // open lap while leaving its cursor alone: nothing is stamped for the rest
    // of the pass, the wrap proves nothing, and the board reports itself as
    // tracked the whole time.
    expect(
      /const lapKey = `\$\{s\.source\}:\$\{s\.token\}`;/.test(CODE),
      "the lap key must name the vendor as well as the token",
    ).toBe(true);
    expect(
      /deepLaps\[s\.token\]/.test(CODE),
      "a token-keyed read or delete of the lap map is still present — a different vendor's " +
        "board with the same token can reach this board's lap",
    ).toBe(false);
  });

  it("the coverage receipt is written where the proof is USED, not where it is computed", () => {
    // `lapProven` is decided before the existing-rows read. A wrap that then
    // turned out to be unstampable would otherwise stamp `w` and tell
    // get_closure_population() the board completed a provable pass on a visit
    // that proved nothing.
    const provenBlock = /lapProven = true;([\s\S]{0,300}?)\n {12}\}/.exec(CODE);
    expect(provenBlock, "the lapProven assignment moved — re-anchor").toBeTruthy();
    expect(
      /rec\.w\s*=/.test(provenBlock![1]),
      "the receipt is written beside lapProven, before the visit knows it can stamp",
    ).toBe(false);
    expect(
      /if \(lapMode\) \{[\s\S]{0,300}?\.w = startIso;/.test(CODE),
      "nothing writes the coverage receipt under lapMode",
    ).toBe(true);
  });

  it("every paginated fetcher reports whether the FEED ended, not just whether we stopped", () => {
    // The term is only as good as its coverage: a vendor that reports no
    // feedEnded is silently unprovable, which is safe — but a vendor that
    // reports the WRAP as an ending re-opens the self-certifying denominator.
    // Each of these returns must carry the field explicitly.
    for (const fn of ["fetchWorkday", "fetchOracle", "fetchSmartRecruiters", "fetchRippling"]) {
      const sig = new RegExp(`async function ${fn}\\(s: JobSource, startOffset = 0\\): Promise<\\{([^}]*)\\}`);
      const m = sig.exec(CODE);
      expect(m, `${fn} moved or changed shape — re-anchor`).toBeTruthy();
      expect(m![1], `${fn} must report feedEnded`).toContain("feedEnded");
      expect(m![1], `${fn} must report endOffset`).toContain("endOffset");
    }
    // rippling's total is our own arithmetic (pages x 20), so its ending must
    // come from a page returning nothing — never from `lastPage >= totalPages`,
    // which is the same number the denominator is derived from.
    expect(/feedEnded: ranOut,/.test(CODE), "rippling must report ranOut, not reachedEnd").toBe(true);
  });
});
