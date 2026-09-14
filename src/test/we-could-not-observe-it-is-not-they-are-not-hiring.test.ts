// "WE COULD NOT OBSERVE IT" IS NOT "THEY ARE NOT HIRING".
//
// THE DEFECT, MEASURED LIVE ON 2026-09-09. The board's hiring filter read one
// boolean:
//
//     !!h && h.fills_90d >= ACTIVELY_HIRING_MIN_CLOSED
//         && h.relists_90d <= h.fills_90d
//
// fills_90d counts closures WE SUCCESSFULLY OBSERVED, and a closure is only
// observable on a board we can read in full. A tenant whose feed exceeds our
// per-visit cap is windowed, and until the lap fix the truncated branch pruned
// its vanished postings without writing a closure row at all — so fills_90d sits
// at 0 for every large paginated employer, structurally, however much they hire.
// Against the thirty largest employers by live role count: 13 passed, 17 were
// blocked, and the block hid 91,535 of 154,979 roles — 59% of the inventory,
// every blocked employer at fills_90d = 0, the largest of them holding 34,000
// open roles. A control a person clicks expecting MORE signal removed most of
// the board and said nothing about it.
//
// THE PROPERTY THIS FILE GUARDS, AND IT IS A PROPERTY AND NOT A SPELLING:
//
//   AN UNKNOWN VERDICT NEVER RENDERS AS A NEGATIVE ONE, AT ANY SITE.
//
// Enforced three ways, because any one of them alone can be walked around:
//
//   1. THE ANSWER IS A UNION OF THREE, and the two failing verdicts are
//      distinguishable end to end — verdict, slot and partition. The teeth test
//      below folds unknown into the negative and requires that this file's own
//      property routine REJECTS the folded function; a guard that cannot fail is
//      not a guard, and this repo has shipped four of those.
//   2. THE BAR IS DERIVED IN EXACTLY ONE PLACE PER PAGE. A site that re-derives
//      `fills >= N && relists <= fills` gets a two-state answer by construction
//      and cannot carry a third, which is how three separate spellings of the
//      same arithmetic (a chip, a panel clause, a compare row) came to exist. The
//      count is asserted over COMMENT-STRIPPED source: a guard literal inside a
//      comment has passed over dead code repeatedly here.
//   3. EVERY CONSUMER IS ENUMERATED FROM THE FILE, not from a hand-written list,
//      and each one must handle the unknown branch within its own surface. A
//      fourth site added later fails here rather than shipping, which is the
//      whole reason the enumeration reads the source instead of naming sites.
//
// WHAT UNKNOWN MEANS. No curve row, or a row whose closure ledger holds nothing
// for this employer (fills + relists = 0). Age-outs are deliberately not
// evidence: an age-out is OUR 30-day cap expiring a posting, an event we
// manufacture without watching the employer do anything.
//
// AND WHY THE COPY MAY NOT PROMISE MORE THAN THAT. Unknown does shrink for a
// windowed board — but only once that board completes a PROVABLE full pass and
// then has a role come down afterwards, because the first proven lap stamps its
// backlog absence_basis 'lap_backfill' (job-board/index.ts) and
// get_company_fill_curve excludes lap_backfill from its closure arm. Two laps,
// not one. And a board whose vendor advertises no feed total can never satisfy
// the lap proof at all, so for that population unknown is permanent. Nor can
// this page tell a windowed tenant from a small board we read to the end that
// simply closed nothing. So every unknown string here states the possibilities
// and stops: it may not name windowing as THE cause of a particular employer's
// silence, and it may not promise a timetable. Naming a cause we did not
// measure is the original defect with its sign flipped, and the assertions at
// the bottom of this file pin both directions.
//
// ── 2026-09-09, LATER THE SAME DAY: THE LABEL CAME BACK, THE MEASURE DID NOT ──
//
// The morning's fix renamed the chip "Takes roles down". The owner decided,
// with the trade-off stated, that the label reads "Actively hiring" again NOW,
// with the other half of that claim — the rate at which an employer posts NEW
// roles — joining once the openings series holds enough days to compute one.
// So this file's last section changed from a BAN to a CONDITION: the words
// were permitted only beside a basis sentence stating takedowns, not a hire,
// and new postings NOT YET counted, with no calendar date the code could not
// verify.
//
// ── 2026-09-14: THE OTHER HALF JOINED, AND THE CONDITION MOVED WITH IT ───────
//
// migration 20260909227000 (get_company_growth) is the new-postings half: a
// RATE on the board's own daily served series, gated on read quality, tenure,
// size and series completeness, with the verdict owned by the RPC. The chip's
// predicate is now closes OR grew, combined once in activelyHiringVerdict, so
// the basis sentence changed MEANING — and a changed meaning is a NEW key,
// retired in all nine. The *2 basis family is retired here; the *3 family must
// state BOTH halves and may no longer say "not yet" or promise a join. The
// growth half's own properties (unknown never no-growth, the bar never
// re-derived on the client, the mirrors pinned to the migration) live in
// src/test/a-board-that-grew-is-a-rate-with-gates-not-a-count.test.ts; this
// file keeps the label-beside-basis condition and the closure half.
//
// THE TRANSLATION WINDOW. The English build owns en and en-GB; seven locales
// render the inline English default for the *3 family until the locale pass
// lands. That window is DECLARED (BASIS_PENDING_LOCALES), capped, and expires
// on its own: a locale on the list that carries the whole family fails until
// it is taken off. A locale off the list must carry the family.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  hiringRecordVerdict,
  hiringRecordSlot,
  partitionByHiringRecord,
  type HiringRecordVerdict,
} from "../pages/Jobs";
import { changelog } from "../data/changelog";

const ROOT = resolve(__dirname, "../..");
/** Comment bodies blanked, LINE NUMBERS AND OFFSETS PRESERVED, so a site's
 *  neighbourhood is measured over real code and a prose mention of a branch can
 *  never satisfy an assertion about the branch. */
const strip = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const JOBS = strip(read("src/pages/Jobs.tsx"));
const EXPLORE = strip(read("src/pages/Explore.tsx"));

const lineOf = (src: string, i: number) => src.slice(0, i).split("\n").length;
const all = (src: string, re: RegExp) => {
  const out: number[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let m = r.exec(src); m; m = r.exec(src)) out.push(m.index);
  return out;
};

// The three fixtures the whole argument rests on, named for what they are.
/** The 34,000-open-role employer. A board bigger than one visit can read, so not
 *  one closure of theirs was ever observable. THIS IS THE ROW THE OLD BOOLEAN
 *  ANSWERED "no" FOR. */
const WINDOWED = { fills_90d: 0, relists_90d: 0 };
/** Read, and the pattern is not there: we watched postings leave and come back.
 *  A finding we can support, and the only verdict a surface may render silently. */
const CHURNS = { fills_90d: 1, relists_90d: 9 };
/** Watched taking roles down and leaving them down. */
const CLOSES = { fills_90d: 5, relists_90d: 1 };

type VerdictFn = (h: { fills_90d: number; relists_90d: number } | null | undefined) => HiringRecordVerdict;

/**
 * THE PROPERTY ITSELF, as a routine, so the teeth test can run the SAME checks
 * against a deliberately broken implementation and require them to fail. If this
 * routine is ever weakened to something a folded function satisfies, the teeth
 * test below stops throwing and reports it.
 */
function assertUnknownIsNotNegative(verdict: VerdictFn) {
  // A row we could not read and a row we read and found wanting are DIFFERENT
  // ANSWERS. This single line is what the shipped code got wrong.
  expect(verdict(WINDOWED), "an unobservable board answers as the churn-dominated one")
    .not.toBe(verdict(CHURNS));
  expect(verdict(WINDOWED)).toBe("unknown");
  expect(verdict(null), "no row at all is our side, not theirs").toBe("unknown");
  expect(verdict(undefined)).toBe("unknown");
  // And the distinction survives the mapping every surface actually renders
  // through: a slot is what decides whether a chip fires, so folding at that
  // layer would be the same defect one indirection out.
  expect(hiringRecordSlot(verdict(WINDOWED))).toBe("unreadable");
  expect(hiringRecordSlot(verdict(WINDOWED))).not.toBe(hiringRecordSlot(verdict(CHURNS)));
  // Silence is legal for exactly one verdict.
  expect(hiringRecordSlot(verdict(CHURNS))).toBe("silent");
  expect(hiringRecordSlot(verdict(CLOSES))).toBe("positive");
}

describe("we could not observe it is not they are not hiring", () => {
  it("the predicate answers three things, and the third is not a no", () => {
    assertUnknownIsNotNegative(hiringRecordVerdict);
    expect(hiringRecordVerdict(CLOSES)).toBe("closes");
    expect(hiringRecordVerdict(CHURNS)).toBe("no-pattern");
    // Below the bar but READ: two clean take-downs is a reading, not a gap.
    expect(hiringRecordVerdict({ fills_90d: 2, relists_90d: 0 })).toBe("no-pattern");
    // A single re-list and nothing else is also a reading — we watched a posting
    // of theirs leave. Only an EMPTY closure ledger is unknown.
    expect(hiringRecordVerdict({ fills_90d: 0, relists_90d: 1 })).toBe("no-pattern");
    // relists_90d is a FLOOR (one logged re-list per title per day), so equality
    // still qualifies and one more re-list than take-downs does not: the error
    // is towards disqualifying, the safe direction for a claim that speaks well
    // of an employer.
    expect(hiringRecordVerdict({ fills_90d: 3, relists_90d: 3 })).toBe("closes");
    expect(hiringRecordVerdict({ fills_90d: 3, relists_90d: 4 })).toBe("no-pattern");
    // A build that stops returning the columns is our instrument failing.
    expect(hiringRecordVerdict({ fills_90d: NaN, relists_90d: 0 })).toBe("unknown");
    expect(hiringRecordVerdict({ fills_90d: 0, relists_90d: NaN })).toBe("unknown");
  });

  it("TEETH: folding unknown into the negative fails this file", () => {
    // The exact regression, written out: the shipped boolean, re-expressed as a
    // verdict function that has three names for two answers.
    const folded: VerdictFn = (h) => (hiringRecordVerdict(h) === "closes" ? "closes" : "no-pattern");
    expect(
      () => assertUnknownIsNotNegative(folded),
      "the property routine accepted a function that answers 'not hiring' for an unreadable record — the guard has no teeth",
    ).toThrow();
    // And the same fold at the partition layer: 34,000 roles silently in the
    // discarded pile with nothing to count them.
    const foldedPart = partitionByHiringRecord(
      [{ token: "dominos" }, { token: "acme" }],
      (tok) => (tok === "acme" ? "closes" : folded(WINDOWED)),
    );
    expect(foldedPart.setAside.length, "a fold empties the pile the disclosure counts").toBe(0);
  });

  it("the filter keeps three piles apart, so the exclusion can be stated instead of implied", () => {
    const verdicts: Record<string, HiringRecordVerdict> = {
      dominos: "unknown", cvs: "unknown", ulta: "unknown",
      acme: "closes",
      churny: "no-pattern",
    };
    const rows = [
      { token: "dominos" }, { token: "dominos" }, { token: "cvs" }, { token: "ulta" },
      { token: "acme" }, { token: "acme" },
      { token: "churny" },
      // A row with no employer token at all: unknown, because nothing about it
      // can be looked up. It must never land in the kept pile.
      { token: undefined },
    ];
    const p = partitionByHiringRecord(rows, (tok) => (tok ? verdicts[tok] ?? "unknown" : "unknown"));
    expect(p.shown.length, "only the positive verdict is kept").toBe(2);
    expect(p.noPattern, "a reading we can support is excluded without apology").toBe(1);
    // THE 59%: five openings held out, and the count of EMPLOYERS behind them is
    // a separate number because the sentence quotes both. Deduped on token, and
    // the untokened row cannot be counted as an employer.
    expect(p.setAside.length).toBe(5);
    expect(p.setAsideEmployers).toBe(3);
    // Nothing is lost between the piles — every fetched row is accounted for.
    expect(p.shown.length + p.setAside.length + p.noPattern).toBe(rows.length);
  });

  it("the bar is derived in exactly one place per page — a re-derivation cannot carry a third state", () => {
    // The disqualifier is the fingerprint of the whole predicate: wherever
    // `relists <= fills` is computed, the count gate is beside it and a boolean
    // comes out. One per page, and both are inside a function whose job is to
    // return the three-way answer.
    const jobsSites = all(JOBS, /relists(_90d)?\s*<=\s*(h\.)?fills/);
    expect(
      jobsSites.map((i) => lineOf(JOBS, i)),
      "the bar is re-derived outside hiringRecordVerdict — that site cannot express 'unknown'",
    ).toHaveLength(1);
    expect(JOBS.slice(0, jobsSites[0])).toMatch(/export function hiringRecordVerdict\([\s\S]*$/);

    const exploreSites = all(EXPLORE, /relists\s*<=\s*fills/);
    expect(exploreSites.map((i) => lineOf(EXPLORE, i)), "same rule on /explore").toHaveLength(1);
    // Explore's one site is closureRecordOf, whose third state is `readable` —
    // employers the closure log holds nothing for, counted apart from the
    // finding and named on screen rather than folded into the denominator.
    expect(EXPLORE.slice(0, exploreSites[0])).toMatch(/export function closureRecordOf\([\s\S]*$/);
    // The remainder is rendered, and OUR OWN failures are subtracted out of it
    // first: a token the RPC returned no row for, and a row whose columns came
    // back non-finite, are statements about our build, and the sentence beside
    // this number explains employers' boards. Folding them in described a
    // deploy skew as a fact about employer board sizes.
    expect(EXPLORE, "the unreadable remainder is rendered, not just computed")
      .toMatch(/closure\.asked\s*-\s*closure\.readable\s*-\s*closure\.unanswered\s*>\s*0/);
    expect(EXPLORE, "and our own unanswered reads are counted and named separately")
      .toMatch(/closure\.unanswered > 0/);

    // The threshold is a shared constant on both pages, never a literal beside
    // the comparison — a number typed twice is a number that drifts.
    expect(JOBS).toMatch(/const ACTIVELY_HIRING_MIN_CLOSED = 3;/);
    expect(EXPLORE).toMatch(/const CLOSURE_MIN_FILLS = 3;/);

    // AND THE TWO HALVES MEET IN EXACTLY ONE PLACE. The chip is closes OR grew;
    // a site that spells `=== "closes" ||` or `=== "grew" ||` inline has folded
    // the combination and cannot carry the third state of the OTHER half.
    const inlineOr = all(JOBS, /=== "closes"\s*\|\|\s*\w+\s*=== "grew"|=== "grew"\s*\|\|\s*\w+\s*=== "closes"/);
    expect(inlineOr.map((i) => lineOf(JOBS, i)), "the closes-OR-grew combination is spelled outside activelyHiringVerdict").toHaveLength(1);
    expect(JOBS.slice(0, inlineOr[0])).toMatch(/export function activelyHiringVerdict\([\s\S]*$/);
  });

  it("every consumer of the verdict is enumerated FROM THE SOURCE, and each one answers for unknown", () => {
    // Read the call sites out of the file rather than listing them here. A
    // surface added next quarter is in this set the moment it is written, which
    // is the difference between a guard for a class and a guard for four lines.
    const CONSUMER = /\b(hiringRecordVerdict|hiringRecordOf|isActivelyHiring|hiringSignalOf)\s*\(/g;
    // The definitions themselves are not consumers.
    const DEFINITION = /(export function hiringRecordVerdict\s*\(|const hiringRecordOf = useCallback|const isActivelyHiring = useCallback|const hiringSignalOf = useCallback|hiringRecordVerdict\(tok \? curveByToken|hiringSignalOf\(tok\) === "positive"|activelyHiringVerdict\(hiringRecordOf\(tok\), growthVerdict\(growthOf\(tok\)\)\))/;

    const sites = all(JOBS, CONSUMER).filter((i) => {
      const lineStart = JOBS.lastIndexOf("\n", i) + 1;
      const lineEnd = JOBS.indexOf("\n", i);
      return !DEFINITION.test(JOBS.slice(lineStart, lineEnd === -1 ? undefined : lineEnd));
    });
    // If this ever reads zero the guard has gone vacuous — a rename would
    // otherwise leave every assertion below trivially satisfied.
    expect(sites.length, "no consumer of the verdict found — RE-ANCHOR this guard, do not delete it")
      .toBeGreaterThanOrEqual(6);

    // A surface is the neighbourhood a reader sees at once. Each consuming site
    // must have the unknown branch inside its own, so a positive render can
    // never stand alone with the third state left to silence.
    // Sized to the LARGEST surface in the file — the card's one-slot chain,
    // whose caution, pace, positive and two unreadable branches span a little
    // over 2,000 characters of code between the first and the last. Comments
    // are blanked in place rather than deleted, so this distance is the real
    // one a reader would scroll. Wide enough that a genuine surface is never
    // split; narrow enough that a site pasted into a different part of the
    // page has no handler in reach.
    const WINDOW = 2500;
    const unhandled: number[] = [];
    for (const i of sites) {
      const near = JOBS.slice(Math.max(0, i - WINDOW), i + WINDOW);
      if (!/=== "unknown"|=== "unreadable"|"unknown" &&/.test(near)) unhandled.push(lineOf(JOBS, i));
    }
    expect(
      unhandled,
      `these sites read the verdict and never say what an unreadable record means: lines ${unhandled.join(", ")}`,
    ).toEqual([]);

    // The two surfaces that CANNOT be satisfied by proximity alone, pinned
    // directly, because they are the two the measurement caught: the filter's
    // stated exclusion and the card slot's third chip. THIS IS CONDITION (b)
    // for the label below: the unknown bucket is partitioned, counted, and
    // handed a way back, or the label may not appear at all.
    expect(JOBS, "the filter must count what it set aside").toMatch(/hiringPartition\.setAside\.length > 0/);
    expect(JOBS, "and hand the reader a way back to it").toMatch(/takedownSetAsideShow/);
    expect(JOBS, "the card slot renders the unreadable state instead of an empty slot")
      .toMatch(/hiringRecordSlot\(hiringRecordOf\(job\.token\)\) === "unreadable"/);
    // And BOTH unread halves are counted in the set-aside sentence, not just
    // the closure one: the growth half has its own reasons and they are
    // rendered, per family, from the partition.
    expect(JOBS, "the set-aside sentence must count the employers whose closure record is unread").toMatch(/noClosure: hiringPartition\.noClosureEmployers/);
    expect(JOBS, "the set-aside sentence must count the employers whose growth reading is unread").toMatch(/growthUnread: hiringPartition\.growthUnreadEmployers/);
    for (const fam of ["read", "series", "tooNew", "tooSmall", "excluded", "unread"]) {
      expect(JOBS, `the set-aside sentence must render the growth reason family "${fam}"`).toMatch(new RegExp(`hiringPartition\\.growthReasons\\.${fam}`));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // THE LABEL IS A CONDITION, NOT A BAN.
  //
  // "Actively hiring" is on the chip by owner decision (2026-09-09), and since
  // 2026-09-14 both halves of the claim are measured. What makes that honest is
  // that every surface carrying the words also carries, in the same key family,
  // what is measured: takedowns we watched, which are not hires, AND a rise in
  // roles served on the board's own daily series, which is not a headcount —
  // with the window and both bars named, and no calendar date the code cannot
  // verify. The key names are the family; the VALUES are what a reader sees;
  // both are checked, in every locale carrying the family and in every inline
  // default, by one routine the teeth test can also hand a dishonest copy to.
  const LOCALES = [
    "de", "en-GB", "en", "es", "fr", "hi", "nl", "pt", "tl",
  ] as const;
  /** Keys whose VALUE is the bare label. Unchanged: the label did not change. */
  const LABEL_KEYS = ["hiringFilter2", "chipHiring2", "hiringBadge2"] as const;
  /** Keys that must STATE THE BASIS wherever the label is on screen. The *3
   *  family: both halves, minted 2026-09-14. */
  const BASIS_KEYS = ["hiringFilterTip3", "hiringBadgeTip3", "hiringBasis3", "hiringSetAside3", "savedWithoutHiringFilter3"] as const;
  const FAMILY: readonly string[] = [...LABEL_KEYS, ...BASIS_KEYS];
  /** Retired with each rename. A locale VALUE beats an inline default, so a
   *  survivor would put a retired claim back on the badge for one language. */
  const RETIRED_JOBS_KEYS = [
    // The first rename (2026-08-24 era) — still forbidden.
    "hhActive", "hhBadge", "chipHiring", "chipActivelyHiring",
    "activelyHiringFilter", "activelyHiringTip", "activelyHiringEmpty",
    "savedWithoutActivelyHiring", "hhGathering",
    // The morning's "Takes roles down" family, retired the same day.
    "takedownFilter", "takedownFilterTip", "chipTakedowns", "takedownBadge",
    "takedownBadgeTip", "takedownSetAside", "savedWithoutTakedownFilter",
    "hhBadgeTipObserved",
    // The "not yet new postings" basis family (2026-09-09), retired 2026-09-14
    // when the new-postings half joined: every one of these said the rate was
    // not part of the label, and now it is.
    "hiringFilterTip2", "hiringBadgeTip2", "hiringBasis2", "hiringSetAside2", "savedWithoutHiringFilter2",
    // "Still reading our closure record" — retired 2026-09-14 (review pass)
    // when the pending branch began waiting on BOTH reads: once the closure
    // batch has settled and only get_company_growth is in flight, that
    // sentence names the wrong read. Its successor is signalReading.
    "takedownReading",
  ] as const;
  const RETIRED_EXPLORE_KEYS = ["closureNone"] as const;
  /** Keys that KEPT their names because their sentences are still exactly
   *  true — the counted set-aside's way back, the pending read, the empty
   *  read — plus the unknown-state copy. All nine locales carry them. */
  const REQUIRED_JOBS_KEYS = [
    "noRecordBadge", "noRecordBadgeTip", "takedownSetAsideShow", "signalReading",
    "takedownEmpty", "verdictNoRecord", "verdictTakedownsObserved", "hhNoClosureRecord",
  ] as const;
  const REQUIRED_EXPLORE_KEYS = [
    "closureUnreadable", "closureUnanswered", "closureNone2",
  ] as const;
  /** THE TRANSLATION WINDOW, DECLARED — AND CLOSED. While a locale carries the
   *  label keys (they did not change) and not yet the *3 basis keys, it renders
   *  the inline English basis beside a translated label: a true sentence in
   *  the wrong language, a degradation and not a stale claim. That window is
   *  bounded the three ways src/i18n/index.test.ts bounds the same exemption:
   *  an explicit list, capped, and expiring on its own — the assertion below
   *  fails the moment a listed locale carries the whole family, until it is
   *  taken off. The seven locales opened here on 2026-09-14 landed the whole
   *  family the same day and the assertion flagged each, so the list is
   *  empty; every locale must now carry the family in full. */
  const BASIS_PENDING_LOCALES: readonly string[] = [];
  const BASIS_PENDING_CAP = 7;
  const localeDoc = (loc: string) =>
    JSON.parse(read(`src/i18n/locales/${loc}.json`)) as Record<string, Record<string, string>>;

  const LABEL = /Actively[\s-]hiring/i;
  // THE FACTS A BASIS SENTENCE MUST STATE, as regexes over English copy.
  const TAKEDOWN_BASIS = /(take|took|taken)[^.]{0,60}\bdown\b|come off the board[^.]{0,40}\bstay off/i;
  const NOT_A_HIRE = /not a hire|not a count of hires|not a claim that anyone was hired/i;
  /** The growth half, stated: more roles than a named earlier point. */
  const GROWTH_BASIS = /more roles[^.]{0,80}\bthan\b[^.]{0,60}(earlier|\{\{baselineDay\}\})/i;
  /** …on OUR clock, which is the date basis the sentence must name. */
  const OWN_CLOCK = /counted from our own daily observation/i;
  const NOT_A_HEADCOUNT = /not a headcount|never a headcount/i;
  // AND TWO THINGS IT MAY NOT: a calendar date, and the retired promise.
  const CALENDAR_DATE = /\b20\d\d-\d\d-\d\d\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b|\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/;
  /** The 2026-09-09 condition, now false: the new-postings half is part of the
   *  label. A basis sentence that still says it is not, or promises a join, is
   *  claim drift — copy that went false because the thing it described moved. */
  const RETIRED_PROMISE = /not yet part of|once we hold enough days|joins once|not yet a count/i;
  /** The windows and bars — ACTIVELY_HIRING_WINDOW_DAYS and the GROWTH_*
   *  mirrors in Jobs.tsx, read out of the source so the sentence and the code
   *  cannot drift, and pinned to the migrations elsewhere. */
  const WINDOW_DAYS = Number(JOBS.match(/const ACTIVELY_HIRING_WINDOW_DAYS = (\d+);/)?.[1]);
  /** The basis keys that state the COUNT must state its window beside it, and
   *  the ones that state the RATE must state its window and both bars. The
   *  placeholders are literal in every language, so this needs no English. */
  const WINDOWED_KEYS = ["hiringFilterTip3", "hiringBadgeTip3", "hiringBasis3", "hiringSetAside3"] as const;
  const GROWTH_PLACEHOLDERS = ["{{minNet}}", "{{minRate}}", "{{gdays}}"] as const;

  /**
   * CONDITION (a), AS A ROUTINE. `values` is one surface's worth of copy —
   * a locale's jobsPage block, or the inline defaults read out of Jobs.tsx.
   * `english` says whether the wording checks apply (they are English regexes;
   * a translated basis sentence is checked for PRESENCE, and the English build
   * is what a locale without a value renders). `pending` is the declared
   * translation window: the label may stand beside the inline English basis,
   * and nothing else is relaxed.
   */
  function assertLabelCarriesItsBasis(values: Record<string, string>, english: boolean, where: string, pending = false) {
    // The label is PRESENT when a label key has a value — "Stellt aktiv ein"
    // is the same claim and matches no English regex — or when any value
    // carries the English words. The first arm is what makes this bite in
    // the seven translated locales; the second is what catches a leak.
    const bearing = [
      ...LABEL_KEYS.filter((k) => typeof values[k] === "string" && values[k].trim()),
      ...Object.entries(values).filter(([, v]) => typeof v === "string" && LABEL.test(v)).map(([k]) => k),
    ].filter((k, i, a) => a.indexOf(k) === i);
    // Every key that carries the label is in the family — savedViewTip carrying
    // "the Actively-hiring toggle" into nine languages is how the first rename
    // leaked, and a key outside the family has no basis key beside it.
    const strays = bearing.filter((k) => !FAMILY.includes(k));
    expect(strays, `${where}: these carry "Actively hiring" outside the key family that states its basis: ${strays.join(", ")}`).toEqual([]);
    // If the label is present at all, every basis key is present with it —
    // unless this locale is inside the declared window, in which case the
    // basis keys must be ABSENT AS A SET (a half-landed family would render
    // one translated basis sentence and four English ones).
    if (bearing.length > 0) {
      const missing = BASIS_KEYS.filter((k) => typeof values[k] !== "string" || !values[k].trim());
      if (pending) {
        expect(missing.length, `${where}: inside the translation window the *3 family must be wholly absent or wholly present; present: ${BASIS_KEYS.filter((k) => !missing.includes(k)).join(", ")}`).toBe(BASIS_KEYS.length);
      } else {
        expect(missing, `${where}: the label renders but these basis sentences are absent: ${missing.join(", ")}`).toEqual([]);
      }
    }
    // Language-independent checks, run on every locale: no basis sentence
    // prints a calendar date (an ISO date is a date in any language), and
    // every sentence that states the count states its bar AND its window, and
    // every sentence that states the rate states its window and both bars.
    for (const k of BASIS_KEYS) {
      const v = values[k];
      if (typeof v !== "string") continue;
      expect(v, `${where}: ${k} prints a calendar date the code cannot verify`).not.toMatch(CALENDAR_DATE);
    }
    for (const k of WINDOWED_KEYS) {
      const v = values[k];
      if (typeof v !== "string") continue;
      expect(v, `${where}: ${k} does not print the bar ({{min}})`).toContain("{{min}}");
      expect(v, `${where}: ${k} does not print the window ({{days}}) — "at least three roles down" with no window reads as an all-time count`).toContain("{{days}}");
      for (const ph of GROWTH_PLACEHOLDERS) expect(v, `${where}: ${k} does not print ${ph} — a rate with no window or bar reads as a raw leaderboard`).toContain(ph);
    }
    if (!english) return;
    for (const k of BASIS_KEYS) {
      const v = values[k];
      if (typeof v !== "string") continue;
      expect(v, `${where}: ${k} does not say the measure is takedowns`).toMatch(TAKEDOWN_BASIS);
      expect(v, `${where}: ${k} does not say a takedown is not a hire`).toMatch(NOT_A_HIRE);
      expect(v, `${where}: ${k} does not state the growth half (more roles than an earlier point)`).toMatch(GROWTH_BASIS);
      expect(v, `${where}: ${k} does not name the date basis of the growth half (our own daily observation)`).toMatch(OWN_CLOCK);
      expect(v, `${where}: ${k} does not say a rise in roles served is not a headcount`).toMatch(NOT_A_HEADCOUNT);
      expect(v, `${where}: ${k} still says new postings are not yet counted, or promises a join — they joined in migration 20260909227000`).not.toMatch(RETIRED_PROMISE);
      expect(v, `${where}: ${k} says employer where it means board — one employer holds several tokens and nothing sums across them`).not.toMatch(/employer(?:'s)? (?:grew|growth|posting rate)/i);
    }
  }

  /** The t() defaults of one file, keyed by the bare key. */
  const inlineDefaults = (raw: string, ns: string) => {
    const out: Record<string, string> = {};
    for (const m of raw.matchAll(new RegExp(`t\\("${ns}\\.([A-Za-z0-9_]+)",\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g"))) out[m[1]] = m[2];
    return out;
  };

  it("the translation window is bounded and cannot outlive its reason", () => {
    expect(BASIS_PENDING_LOCALES.length, "the window has grown past its cap — run the locale pass instead of widening this").toBeLessThanOrEqual(BASIS_PENDING_CAP);
    expect(BASIS_PENDING_LOCALES, "en and en-GB are the source of the family and can never be pending").not.toContain("en");
    expect(BASIS_PENDING_LOCALES).not.toContain("en-GB");
    const landed = BASIS_PENDING_LOCALES.filter((loc) => {
      const jp = localeDoc(loc).jobsPage ?? {};
      return BASIS_KEYS.every((k) => typeof jp[k] === "string" && jp[k].trim());
    });
    expect(landed, `translated now — remove from BASIS_PENDING_LOCALES: ${landed.join(", ")}`).toEqual([]);
  });

  it("the label may appear only beside its basis — in every locale value and every inline default", () => {
    for (const loc of LOCALES) {
      const doc = localeDoc(loc);
      // The whole document, not three namespaces: a label that leaks into a
      // footer or a changelog-adjacent string is the same claim in a new place.
      const flat: Record<string, string> = {};
      const walk = (o: Record<string, unknown>, prefix: string) => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === "object") walk(v as Record<string, unknown>, `${prefix}${k}.`);
          else if (typeof v === "string") flat[`${prefix}${k}`] = v;
        }
      };
      walk(doc, "");
      const outside = Object.entries(flat)
        .filter(([k, v]) => LABEL.test(v) && !FAMILY.some((f) => k === `jobsPage.${f}`))
        .map(([k]) => k);
      expect(outside, `${loc}: "Actively hiring" outside jobsPage's basis-bearing family: ${outside.join(", ")}`).toEqual([]);
      assertLabelCarriesItsBasis(doc.jobsPage ?? {}, loc === "en" || loc === "en-GB", `${loc}.json`, BASIS_PENDING_LOCALES.includes(loc));
    }
    // The inline defaults are what a locale without a value renders. Read from
    // the DEFAULT ARGUMENT ONLY — this file has a history of guard literals a
    // prose comment satisfies, and Jobs.tsx narrates the label in comments.
    const defaults = inlineDefaults(read("src/pages/Jobs.tsx"), "jobsPage");
    expect(Object.keys(defaults).length, "no t() defaults found — regex broken").toBeGreaterThan(50);
    assertLabelCarriesItsBasis(defaults, true, "Jobs.tsx inline defaults");
    // And the label IS there — a guard for a condition must see the condition
    // being exercised, or a rename leaves it vacuous.
    for (const k of LABEL_KEYS) expect(defaults[k], `jobsPage.${k} is not the label`).toMatch(LABEL);
    // The en value and the inline default are the same sentence: the locale
    // file was generated from the source, and a hand edit to one is drift.
    const en = localeDoc("en").jobsPage;
    for (const k of BASIS_KEYS) expect(en[k], `en.json jobsPage.${k} differs from the inline default`).toBe(defaults[k]);
    // Explore's copy carries no label at all: its closure block names the
    // measurement in its own words and links to the filter.
    const exploreDefaults = inlineDefaults(read("src/pages/Explore.tsx"), "explore");
    expect(Object.keys(exploreDefaults).length).toBeGreaterThan(10);
    expect(Object.entries(exploreDefaults).filter(([, v]) => LABEL.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("TEETH: a copy that says 'Actively hiring' with no basis sentence fails this file", () => {
    const en = localeDoc("en").jobsPage;
    // 1. The label with the basis keys deleted outright — the shape the first
    //    "Actively hiring" shipped in.
    const bare: Record<string, string> = { ...en };
    for (const k of BASIS_KEYS) delete bare[k];
    expect(() => assertLabelCarriesItsBasis(bare, true, "teeth-1"), "the routine accepted a label with no basis keys").toThrow();
    // 2. The basis keys present but saying nothing about what is measured —
    //    the way a copy edit would break it without touching a key name.
    const hollow: Record<string, string> = { ...en };
    for (const k of BASIS_KEYS) hollow[k] = "Employers that are hiring right now.";
    expect(() => assertLabelCarriesItsBasis(hollow, true, "teeth-2"), "the routine accepted a basis sentence that states no basis").toThrow();
    // 3. Each fact on its own: drop just "not a hire", just the growth half,
    //    just its date basis, add a calendar date, or put the retired promise
    //    back, and the routine must still refuse.
    const dropNotAHire = { ...en, hiringBasis3: en.hiringBasis3.replace(/A takedown is not a hire, and/, "And") };
    expect(dropNotAHire.hiringBasis3).not.toMatch(NOT_A_HIRE);
    expect(() => assertLabelCarriesItsBasis(dropNotAHire, true, "teeth-3a")).toThrow();
    const dropGrowth = { ...en, hiringBasis3: "“Actively hiring” here means employers we have watched take at least {{min}} roles down in the last {{days}} days and leave them down. A takedown is not a hire, and not a headcount ({{minNet}} {{minRate}} {{gdays}})." };
    expect(() => assertLabelCarriesItsBasis(dropGrowth, true, "teeth-3b")).toThrow();
    const dropClock = { ...en, hiringBasis3: en.hiringBasis3.replace(/, counted from our own daily observation[^.]*/, "") };
    expect(dropClock.hiringBasis3, "fixture: the clock phrase moved").not.toMatch(OWN_CLOCK);
    expect(() => assertLabelCarriesItsBasis(dropClock, true, "teeth-3c")).toThrow();
    const dated = { ...en, hiringBasis3: `${en.hiringBasis3} Measured from 2026-09-07.` };
    expect(() => assertLabelCarriesItsBasis(dated, true, "teeth-3d")).toThrow();
    const promised = { ...en, hiringBasis3: `${en.hiringBasis3} More joins once we hold enough days of our own counts.` };
    expect(() => assertLabelCarriesItsBasis(promised, true, "teeth-3e"), "the retired promise was not caught").toThrow();
    const employerNotBoard = { ...en, hiringBasis3: `${en.hiringBasis3} We say the employer grew.` };
    expect(() => assertLabelCarriesItsBasis(employerNotBoard, true, "teeth-3f"), "\"employer grew\" was not caught — the rate is per board").toThrow();
    // 4. The label leaking into a key outside the family — savedViewTip, the
    //    exact key that carried the first rename into nine languages.
    const leaked = { ...en, savedViewTip: "Like the Actively hiring toggle, this narrows the page." };
    expect(() => assertLabelCarriesItsBasis(leaked, true, "teeth-4")).toThrow();
    // 5. The English copy as shipped passes — the routine is not rejecting
    //    everything.
    expect(() => assertLabelCarriesItsBasis(en, true, "teeth-5")).not.toThrow();
    // 6. A TRANSLATED copy — the label in German, which no English regex
    //    sees — with its basis keys deleted, OUTSIDE the declared window. This
    //    is the shape the first version of this routine accepted: it found the
    //    label by English words, found none, and required nothing of the seven
    //    locales whose values override the inline defaults.
    const de = localeDoc("de").jobsPage;
    const deBare: Record<string, string> = { ...de };
    for (const k of BASIS_KEYS) delete deBare[k];
    expect(() => assertLabelCarriesItsBasis(deBare, false, "teeth-6", false), "the routine accepted a translated label with no basis keys").toThrow();
    // 6b. Inside the window a HALF-LANDED family is refused too: one German
    //     basis line beside four English ones is not a translation.
    const deHalf: Record<string, string> = { ...deBare, hiringBasis3: "„Stellt aktiv ein“ heißt hier: mindestens {{min}} Stellen in {{days}} Tagen abgebaut, oder {{minNet}} ({{minRate}} %) mehr als {{gdays}} Tage zuvor." };
    expect(() => assertLabelCarriesItsBasis(deHalf, false, "teeth-6b", true), "a half-landed family inside the window was not caught").toThrow();
    // 7. The same, with one basis line kept and a calendar date in it — the
    //    exact mutant that passed 17/17 before this case existed.
    const deDated: Record<string, string> = { ...deBare, hiringBasis3: "Arbeitgeber, die gerade einstellen. Neue Stellen zaehlen ab 2026-09-16." };
    expect(() => assertLabelCarriesItsBasis(deDated, false, "teeth-7", false)).toThrow();
    // 8. The window dropped from the count — "at least three roles down"
    //    with no "in the last N days" — and the growth bars dropped from the
    //    rate, in English.
    const noWindowEn = { ...en, hiringBasis3: en.hiringBasis3.replace(" in the last {{days}} days", "") };
    expect(noWindowEn.hiringBasis3, "fixture: the window phrase moved").not.toContain("{{days}}");
    expect(() => assertLabelCarriesItsBasis(noWindowEn, true, "teeth-8")).toThrow();
    const noRateBar = { ...en, hiringBasis3: en.hiringBasis3.replace(" — at least {{minRate}}% more —", "") };
    expect(noRateBar.hiringBasis3, "fixture: the rate bar phrase moved").not.toContain("{{minRate}}");
    expect(() => assertLabelCarriesItsBasis(noRateBar, true, "teeth-8b")).toThrow();
    // 9. And every locale as shipped passes under the language-independent
    //    checks and its declared window, so the routine is not refusing
    //    translations wholesale.
    for (const loc of LOCALES) {
      expect(() => assertLabelCarriesItsBasis(localeDoc(loc).jobsPage, loc === "en" || loc === "en-GB", `teeth-9:${loc}`, BASIS_PENDING_LOCALES.includes(loc))).not.toThrow();
    }
  });

  /** The always-on basis line: rendered under the toggle's on-state ALONE —
   *  not behind either read state, not behind the set-aside pile — because the
   *  label is on screen under every one of those conditions. A routine, so
   *  the teeth below can hand it a copy with the line removed or re-gated. */
  function assertBasisLineGatedOnToggle(src: string) {
    const basisAt = src.indexOf('"jobsPage.hiringBasis3"');
    expect(basisAt, "the always-on basis line is gone").toBeGreaterThan(-1);
    const gateStart = src.lastIndexOf("{activelyHiringOnly && (", basisAt);
    expect(gateStart, "the basis line is not gated on the toggle").toBeGreaterThan(-1);
    const gate = src.slice(gateStart, basisAt);
    expect(gate.length, "something else sits between the toggle gate and the basis line").toBeLessThan(200);
    expect(gate, "the basis line is behind a read state or the set-aside pile").not.toMatch(/healthPending|growthPending|signalPending|healthFailed|growthFailed|hiringPartition/);
    return gateStart;
  }

  it("every site that RENDERS the label has the basis in reach, and the basis line is on whenever the toggle is", () => {
    // The key checks above are about VALUES. This one is about SITES: a
    // label key rendered somewhere in Jobs.tsx with no basis tip on the same
    // element and no toggle whose on-state renders the basis line would be the
    // label standing alone. Enumerated from comment-stripped source. The badge
    // tooltip is built in ONE helper (hiringBadgeTip) so it can say which half
    // admitted the employer; a call to that helper is the tip.
    const LABEL_SITE = /"jobsPage\.(hiringFilter2|chipHiring2|hiringBadge2)"/g;
    const TIP_NEAR = /"jobsPage\.hiringFilterTip3"|hiringBadgeTip\(/;
    const sites = all(JOBS, LABEL_SITE);
    expect(sites.length, "no label site found — RE-ANCHOR this guard, do not delete it").toBeGreaterThanOrEqual(6);
    const REACH = 1400;
    const alone: number[] = [];
    for (const i of sites) {
      const near = JOBS.slice(Math.max(0, i - REACH), i + REACH);
      const hasTip = TIP_NEAR.test(near);
      const isToggle = /setActivelyHiringOnly\(/.test(near);
      if (!hasTip && !isToggle) alone.push(lineOf(JOBS, i));
    }
    expect(alone, `these render "Actively hiring" with neither a basis tooltip nor the toggle whose on-state shows the basis line: lines ${alone.join(", ")}`).toEqual([]);
    // The helper is the tip: it renders the *3 basis key, exactly once, and
    // the admitted-by lead sentence for each half.
    expect(all(JOBS, /"jobsPage\.hiringBadgeTip3"/), "hiringBadgeTip3 is rendered in one place — the helper").toHaveLength(1);
    const helperAt = JOBS.indexOf("const hiringBadgeTip = useCallback(");
    expect(helperAt, "the hiringBadgeTip helper is gone — RE-ANCHOR this guard").toBeGreaterThan(-1);
    const helper = JOBS.slice(helperAt, helperAt + 4000);
    for (const k of ["hiringBadgeTip3", "hiringAdmittedBoth", "hiringAdmittedGrew", "hiringAdmittedCloses"]) {
      expect(helper, `the badge tooltip helper does not render jobsPage.${k}`).toContain(`"jobsPage.${k}"`);
    }
    const gateStart = assertBasisLineGatedOnToggle(JOBS);
    // TEETH for the gate check — the SAME routine, handed two mutants.
    // (i) the basis line removed outright;
    const without = JOBS.replace('"jobsPage.hiringBasis3"', '"jobsPage.somethingElse"');
    expect(() => assertBasisLineGatedOnToggle(without), "removing the basis line was not caught").toThrow();
    // (ii) the line kept but re-gated behind a read state — the shape a
    //      well-meaning "don't show it while loading" edit would produce.
    const GATE = "{activelyHiringOnly && (";
    const behindRead = JOBS.slice(0, gateStart) + "{activelyHiringOnly && !signalPending && (" + JOBS.slice(gateStart + GATE.length);
    expect(() => assertBasisLineGatedOnToggle(behindRead), "re-gating the basis line behind the read state was not caught").toThrow();
    // And a badge with its tooltip helper stripped is a label standing alone.
    const strippedBadge = JOBS.replace(/hiringBadgeTip\(/g, "somethingElse(");
    const aloneAfter = all(strippedBadge, LABEL_SITE).filter((i) => {
      const near = strippedBadge.slice(Math.max(0, i - REACH), i + REACH);
      return !TIP_NEAR.test(near) && !/setActivelyHiringOnly\(/.test(near);
    });
    expect(aloneAfter.length, "stripping the badge tooltips left no site standing alone — the reach check is vacuous").toBeGreaterThan(0);
  });

  it("the retired copy is gone from all nine locale files, not just from the code", () => {
    const RAW_JOBS = read("src/pages/Jobs.tsx");
    const RAW_EXPLORE = read("src/pages/Explore.tsx");
    for (const retired of RETIRED_JOBS_KEYS) {
      expect(RAW_JOBS, `"jobsPage.${retired}" still renders`).not.toContain(`"jobsPage.${retired}"`);
    }
    for (const retired of RETIRED_EXPLORE_KEYS) {
      expect(RAW_EXPLORE, `"explore.${retired}" still renders`).not.toContain(`"explore.${retired}"`);
    }
    const survivors: string[] = [];
    for (const loc of LOCALES) {
      const doc = localeDoc(loc);
      for (const k of RETIRED_JOBS_KEYS) if (k in (doc.jobsPage ?? {})) survivors.push(`${loc}:jobsPage.${k}`);
      for (const k of RETIRED_EXPLORE_KEYS) if (k in (doc.explore ?? {})) survivors.push(`${loc}:explore.${k}`);
    }
    expect(
      survivors,
      `a locale VALUE beats the inline English default, so these keys still render the retired claim in their language: ${survivors.join(", ")}`,
    ).toEqual([]);
    // And no surviving value anywhere names the retired control by its words —
    // as each locale actually spelled them at HEAD 87351855, not as an English
    // reader would guess a translation. No key is exempt.
    const RETIRED_LABEL_WORDS: Record<(typeof LOCALES)[number], RegExp> = {
      en: /Takes roles down/i,
      "en-GB": /Takes roles down/i,
      de: /Nimmt Stellen herunter/i,
      es: /Retira vacantes/i,
      fr: /Retire ses annonces/i,
      hi: /पद हटाता है/,
      nl: /Haalt vacatures offline/i,
      pt: /Retira vagas/i,
      tl: /Nag-aalis ng roles/i,
    };
    const offenders: string[] = [];
    for (const loc of LOCALES) {
      const doc = localeDoc(loc);
      for (const [k, v] of Object.entries(doc.jobsPage ?? {})) {
        if (typeof v === "string" && (RETIRED_LABEL_WORDS[loc].test(v) || RETIRED_LABEL_WORDS.en.test(v))) offenders.push(`${loc}:jobsPage.${k}`);
      }
    }
    expect(offenders, `these still name the retired control: ${offenders.join(", ")}`).toEqual([]);
    // TEETH: the arm sees its own locale's words, not only English.
    expect(RETIRED_LABEL_WORDS.de.test("Wie der Nimmt Stellen herunter-Filter daneben")).toBe(true);
    // And no jobsPage value in ANY locale still carries the retired promise:
    // the *2 family is gone by key, and this catches a translated survivor
    // under a different key.
    const promising: string[] = [];
    for (const loc of ["en", "en-GB"]) {
      for (const [k, v] of Object.entries(localeDoc(loc).jobsPage ?? {})) {
        if (typeof v === "string" && RETIRED_PROMISE.test(v)) promising.push(`${loc}:jobsPage.${k}`);
      }
    }
    expect(promising, `these still say new postings are not yet part of the label: ${promising.join(", ")}`).toEqual([]);
  });

  it("the copy that kept its name exists in all nine, so no locale falls back to English for it", () => {
    const missing: string[] = [];
    for (const loc of LOCALES) {
      const doc = localeDoc(loc);
      for (const k of REQUIRED_JOBS_KEYS) if (!(k in (doc.jobsPage ?? {}))) missing.push(`${loc}:jobsPage.${k}`);
      for (const k of REQUIRED_EXPLORE_KEYS) if (!(k in (doc.explore ?? {}))) missing.push(`${loc}:explore.${k}`);
    }
    expect(missing, `absent from these locale files: ${missing.join(", ")}`).toEqual([]);
    // The label keys are in ALL NINE (they did not change), and the *3 basis
    // family is complete in every locale outside the declared window — a
    // label key without its basis keys in the SAME file is the leak.
    for (const loc of LOCALES) {
      const jp = localeDoc(loc).jobsPage;
      for (const k of LABEL_KEYS) expect(typeof jp[k], `${loc}: jobsPage.${k} missing`).toBe("string");
      if (BASIS_PENDING_LOCALES.includes(loc)) continue;
      for (const k of BASIS_KEYS) expect(typeof jp[k], `${loc}: jobsPage.${k} missing`).toBe("string");
    }
  });

  it("the window the count is drawn over is one constant, and it is the RPC's own interval", () => {
    // fills_90d is `closed_at >= now() - interval '90 days'` inside
    // get_company_fill_curve. The page prints that window beside the bar in
    // every basis sentence, from a constant beside ACTIVELY_HIRING_MIN_CLOSED,
    // and this pins the constant to the interval in the migration that
    // currently defines the function — so a re-windowed RPC turns this red
    // rather than leaving nine languages saying "90 days" about a 30-day count.
    expect(JOBS).toMatch(/const ACTIVELY_HIRING_WINDOW_DAYS = 90;/);
    expect(WINDOW_DAYS).toBe(90);
    const DEFINES = /create or replace function\s+(?:public\.)?get_company_fill_curve\s*\(/i;
    const defining = readdirSync(resolve(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => DEFINES.test(read(`supabase/migrations/${f}`)));
    expect(defining.length, "no migration defines get_company_fill_curve — RE-ANCHOR this guard").toBeGreaterThan(0);
    const latest = read(`supabase/migrations/${defining[defining.length - 1]}`);
    const body = latest.slice(latest.search(DEFINES));
    expect(body, `${defining[defining.length - 1]}: the fill curve no longer counts a 90-day window`).toMatch(/fills_90d/);
    expect(body, `${defining[defining.length - 1]}: the RPC's interval is not the ${WINDOW_DAYS} days the page prints`)
      .toMatch(new RegExp(`interval '${WINDOW_DAYS} days'`));
    // Every basis sentence that prints {{days}} is handed the constant — the
    // helper's three sentences, the filter tip, the basis line and the
    // set-aside sentence.
    expect(all(JOBS, /days: ACTIVELY_HIRING_WINDOW_DAYS/).length, "a basis sentence prints {{days}} without being handed the constant").toBeGreaterThanOrEqual(6);
    // The set-aside sentence carries a per-family reason block between its
    // key and its arguments, so the reach is wider than the other three.
    for (const k of WINDOWED_KEYS) {
      const site = JOBS.indexOf(`"jobsPage.${k}"`);
      expect(site, `jobsPage.${k} is not rendered`).toBeGreaterThan(-1);
      const reach = JOBS.slice(site, site + 3400);
      expect(reach, `jobsPage.${k} is rendered without days: ACTIVELY_HIRING_WINDOW_DAYS`).toMatch(/days: ACTIVELY_HIRING_WINDOW_DAYS/);
      expect(reach, `jobsPage.${k} is rendered without gdays: GROWTH_WINDOW_DAYS`).toMatch(/gdays: GROWTH_WINDOW_DAYS/);
      expect(reach, `jobsPage.${k} is rendered without minNet: GROWTH_MIN_NET_ADD`).toMatch(/minNet: GROWTH_MIN_NET_ADD/);
      expect(reach, `jobsPage.${k} is rendered without minRate from GROWTH_MIN_RATE`).toMatch(/minRate: Math\.round\(GROWTH_MIN_RATE \* 100\)/);
    }
  });

  it("an unfinished read never renders as an empty one", () => {
    // THE THIRD STATE COLLAPSING ONE INDIRECTION OUT. `takedownEmpty` was the
    // only sentence in the disclosure block not gated on the read state, so
    // for the 7-16s the curve batch takes — during which EVERY token is
    // unknown by construction, so `shown` is empty by construction — a shared
    // /jobs?activelyHiring=1 URL rendered an empty board captioned "no employer
    // among the openings loaded here has a closure record that clears the bar",
    // with the set-aside count and its "Show them" escape suppressed at exactly
    // that moment. A finding about employers, manufactured out of a read that
    // had not finished. There are two reads now, and the finding half waits
    // for BOTH (signalPending).
    const blockStart = JOBS.indexOf("activelyHiringOnly && (healthFailed");
    expect(blockStart, "the disclosure block moved — RE-ANCHOR this guard").toBeGreaterThan(-1);
    const emptyAt = JOBS.indexOf('"jobsPage.takedownEmpty"', blockStart);
    expect(emptyAt, "takedownEmpty is not inside the disclosure block").toBeGreaterThan(blockStart);
    expect(
      JOBS.slice(blockStart, emptyAt),
      "takedownEmpty is not behind a signalPending branch — an unfinished read is being published as an empty record",
    ).toMatch(/signalPending \? \(/);
    expect(JOBS, "signalPending must be the union of both reads").toMatch(/const signalPending = healthPending \|\| growthPending;/);
    // And the pending window is not a silent gap either: it gets a sentence of
    // its own rather than borrowing the negative one or rendering nothing.
    expect(JOBS, "the pending read must say so, and name BOTH reads it waits on").toMatch(/"jobsPage\.signalReading"/);
    const pendingSentence = inlineDefaults(read("src/pages/Jobs.tsx"), "jobsPage").signalReading ?? "";
    expect(pendingSentence, "signalPending is the union of both reads; the sentence must name both").toMatch(/closure record and posting rates/);
    const setAsideAt = JOBS.indexOf('"jobsPage.hiringSetAside3"', blockStart);
    expect(setAsideAt, "the set-aside sentence must also sit after the pending branch").toBeGreaterThan(
      JOBS.indexOf("signalPending ? (", blockStart),
    );
    // The set-aside sentence quotes the bars it is measured against, so the
    // "what is measured" clause inside it cannot drift from the constants.
    expect(JOBS.slice(setAsideAt, setAsideAt + 3400)).toMatch(/min: ACTIVELY_HIRING_MIN_CLOSED/);
    // A failed growth read is said, as ours, inside the finding half.
    expect(JOBS.slice(blockStart, setAsideAt), "a failed growth read must be named as our side before the set-aside count").toMatch(/growthFailed && \(/);
  });

  it("an abandoned curve read hands its tokens back, so no employer is unknown forever", () => {
    // A `jobs` change during the read — one "Load more", one dismissal — ran the
    // effect's cleanup, which set `cancelled` and threw the response away. The
    // batch's tokens had already gone into healthAttempted and came out only
    // inside giveUp(), which early-returns when cancelled. Those employers then
    // had no curve row that could ever arrive, and the third state turned that
    // silence into a stated sentence. Only an ANSWERED read may keep its
    // tokens — and the growth read follows the same rule, with its own ref.
    expect(JOBS, "the cleanup must release the tokens of a read that never answered")
      .toMatch(/if \(!settled\) batch\.forEach\(\(tok\) => healthAttempted\.current\.delete\(tok\)\)/);
    expect(JOBS, "the growth read's cleanup must release its tokens too")
      .toMatch(/if \(!settled\) batch\.forEach\(\(tok\) => growthAttempted\.current\.delete\(tok\)\)/);
    expect(
      all(JOBS, /settled = true/),
      "settled must be set on BOTH terminal paths of BOTH reads — the successful response and giveUp",
    ).toHaveLength(4);
  });

  it("no unknown-state sentence names a cause the predicate could not produce", () => {
    // THE OVER-CORRECTION, AND IT IS THE SAME DEFECT WITH ITS SIGN FLIPPED.
    // The first pass at the third state told the reader, flatly, that the
    // employers we hold no closure record for have "boards bigger than one
    // visit can read". hiringRecordVerdict reaches `unknown` from a windowed
    // tenant, from a small board we read to the end that simply closed nothing
    // in ninety days, and from a build that stopped returning the columns — and
    // it cannot tell them apart. So a sentence that asserts windowing about a
    // NAMED employer is publishing a fact about their board that our query
    // never produced. (The GROWTH half's reasons are the RPC's own and are
    // rendered as such — that is the difference between naming a cause we
    // measured and guessing one.)
    //
    // The rule enforced: wherever an unknown-state string mentions the visit
    // cap, it must hedge — the cause is offered as one possibility beside the
    // other, never asserted.
    const DEFAULTS = [
      ...read("src/pages/Jobs.tsx").matchAll(/t\("(?:jobsPage|explore)\.([A-Za-z0-9_]+)",\s*"((?:[^"\\]|\\.)*)"/g),
      ...read("src/pages/Explore.tsx").matchAll(/t\("(?:jobsPage|explore)\.([A-Za-z0-9_]+)",\s*"((?:[^"\\]|\\.)*)"/g),
    ];
    expect(DEFAULTS.length, "no t() defaults found — regex broken").toBeGreaterThan(20);
    const CAP_CLAIM = /bigger than one visit can read|larger than one visit can read/;
    // "It may be X, or it may be Y" is the only shape allowed. Either the
    // sentence offers a second possibility, or it says outright that we cannot
    // tell the cases apart.
    const HEDGED = /that can be|that can happen|that happens two ways|can be boards|cannot tell|or an employer who|or employers who|or simply nothing/i;
    const asserted: string[] = [];
    for (const m of DEFAULTS) {
      if (CAP_CLAIM.test(m[2]) && !HEDGED.test(m[2])) asserted.push(m[1]);
    }
    expect(
      asserted,
      `these state the visit cap as THE reason an employer has no closure record, which this page cannot determine: ${asserted.join(", ")}`,
    ).toEqual([]);
    // And no string may promise a timetable for the gap closing.
    const promises = DEFAULTS.filter((m) => /it shrinks as|shrinks as we|within about three days|as we finish a full pass/.test(m[2])).map((m) => m[1]);
    expect(
      promises,
      `these promise the unknown pile shrinks on a schedule the collector cannot keep: ${promises.join(", ")}`,
    ).toEqual([]);
  });

  it("a closure never renders as a hire, on any surface including the apply queue", () => {
    // fills_90d counts postings we watched come off the board and stay off. A
    // hire, a withdrawal, a cancelled requisition and a retitle are
    // indistinguishable to us, so the word "filled" is a claim the number
    // cannot carry — and the morning queue was rendering exactly that from the
    // same figure, in nine languages.
    const QUEUE = read("src/components/account/MorningQueuePanel.tsx");
    expect(QUEUE, "the queue's closure reason may not say 'filled'")
      .toMatch(/"agentQueue\.reasonFills", "we watched \{\{n\}\} of its roles come off the board and stay off"/);
    for (const loc of LOCALES) {
      const v = localeDoc(loc).agentQueue?.reasonFills;
      expect(v, `agentQueue.reasonFills missing from ${loc}`).toBeTruthy();
      expect(v, `${loc} still says the closure count is a fill`).not.toMatch(/\bfilled\b/i);
    }
    // AND THE RANKING, WHICH IS THE SAME CLAIM EXPRESSED AS AN ORDER. The queue
    // added a flat +8 to any posting whose employer cleared fills_90d >= 3 —
    // larger than most fit gaps, and unearnable by every employer whose board we
    // cannot read to the end, i.e. 59% of the live inventory. The queue was
    // sorting by which boards we can read.
    const RUNNER = read("supabase/functions/agent-runner/index.ts");
    const rank = RUNNER.slice(RUNNER.indexOf("const rank = fit.pct"), RUNNER.indexOf("scored.push("));
    expect(rank, "the closure boost is back in the ranking — it demotes every board we cannot read to the end")
      .not.toMatch(/fills_90d/);
  });

  it("the public leaderboard carries the label with its measurement and its exclusion, and no promise the product will not keep", () => {
    // /ghost-job-index ranks employers on observed closures under the heading
    // "Actively hiring". The same condition applies to it as to the chip: the
    // measurement in the heading itself, the exclusion in the paragraph, and
    // no "right now". SINCE 2026-09-14 one more: the paragraph may not say the
    // new-postings half "is not yet part of this ranking; that joins once we
    // hold enough days" — the rate joined the /jobs label, and a growth
    // LEADERBOARD was decided against (the shape /explore deleted twice), so
    // "not yet" and "joins once" are a promise this product will not keep.
    // The paragraph must say the ranking counts takedowns only and stop.
    const GJI = read("src/pages/GhostJobIndex.tsx");
    const h2Start = GJI.indexOf("<h2 className=\"text-lg font-semibold flex items-center gap-2 mb-3\">");
    expect(h2Start, "the leaderboard heading moved — RE-ANCHOR this guard").toBeGreaterThan(-1);
    const heading = GJI.slice(h2Start, GJI.indexOf("</h2>", h2Start));
    expect(heading).toMatch(/Actively hiring/);
    expect(heading, "the heading may not claim a present tense the ranking cannot support").not.toMatch(/right now/i);
    expect(heading, "the heading must state what it ranks beside the label").toMatch(/taken down and not re-listed/);
    const para = GJI.slice(h2Start, GJI.indexOf("</p>", GJI.indexOf("absent from this ranking by construction")));
    expect(para, "the leaderboard must state the exclusion that made the old heading false")
      .toMatch(/absent from this ranking by construction\s+rather than by\s+inactivity/);
    expect(para).toMatch(NOT_A_HIRE);
    expect(para).not.toMatch(CALENDAR_DATE);
    expect(
      para,
      "src/pages/GhostJobIndex.tsx: the leaderboard paragraph still promises the new-postings half will join this ranking (\"not yet part of this ranking; that joins once we hold enough days\"). " +
        "It joined the /jobs label in migration 20260909227000 as a per-board rate with gates, and a growth leaderboard was decided against. " +
        "Say the ranking counts takedowns only, that the posting rate is read per board on /jobs, and make no promise — this file is edited by the build that owns GhostJobIndex.tsx.",
    ).not.toMatch(RETIRED_PROMISE);
  });

  it("the parser's prompt carries the same words and the same honesty as the chip it maps to", () => {
    // Jobs.tsx renders the parser's `interpreted` chips verbatim, so the
    // prompt is a surface too. It may say "actively hiring" — that is the chip
    // — and must say, in the same string, what that means here: BOTH halves,
    // since 2026-09-14.
    const PARSE = read("supabase/functions/nl-search/parse.ts");
    const entry = PARSE.slice(PARSE.indexOf('key: "activelyHiring"'), PARSE.indexOf('key: "sort"'));
    const prompt = entry.match(/prompt:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
    expect(prompt.length).toBeGreaterThan(40);
    expect(prompt).toMatch(LABEL);
    expect(prompt).toMatch(/come off the board and stay off/);
    expect(prompt).toMatch(NOT_A_HIRE);
    expect(prompt, "\"fill\" reasserts the hire a closure cannot evidence").not.toMatch(/\bfill/i);
    expect(prompt).not.toMatch(/proven/i);
    expect(
      prompt,
      "supabase/functions/nl-search/parse.ts: the activelyHiring prompt still says new-posting counts are \"not yet part of it\". " +
        "Since migration 20260909227000 the chip is closes OR grew — the prompt must state both halves (takedowns we watched, OR a board serving more roles than seven days earlier on our own daily observation, not a headcount). " +
        "supabase/functions is owned by the functions build; update the prompt there and run npm run check:functions.",
    ).not.toMatch(RETIRED_PROMISE);
    expect(prompt, "the prompt must state the growth half beside the takedown half").toMatch(/more roles[^.]{0,80}\bthan\b/i);
  });

  it("the changelog entries that brought the label back and then completed it each state what they measure", () => {
    // The morning's entry says the filter "is now called Takes roles down" and
    // is NOT edited — it was true when written. The 2026-09-09 entry was the
    // admission that the name came back ahead of the measure, and it promised
    // an entry would say when the other half joined; it is not edited either.
    const CL = JSON.parse(read("src/i18n/changelog/en.json")) as { changelogEntries: Record<string, { title: string; description: string }> };
    const prior = CL.changelogEntries.activelyHiringHidLargeEmployers;
    expect(prior?.description).toMatch(/now called “Takes roles down”/);
    const back = CL.changelogEntries.activelyHiringIsBack;
    expect(back, "the activelyHiringIsBack entry is missing from en").toBeTruthy();
    const backText = `${back.title} ${back.description}`;
    expect(backText).toMatch(LABEL);
    expect(backText).toMatch(TAKEDOWN_BASIS);
    expect(backText).toMatch(NOT_A_HIRE);
    expect(backText, "the 2026-09-09 entry promised an entry would say when the other half joined — it is history and stays as written").toMatch(/once we hold enough days/i);
    expect(backText).not.toMatch(CALENDAR_DATE);
    expect(backText).toMatch(/at least three roles/);
    expect(backText, "the changelog states the bar without the window it is counted over").toMatch(new RegExp(`in the last ${WINDOW_DAYS} days`));
    const entry = changelog.find((e) => e.id === "activelyHiringIsBack");
    expect(entry?.tags).toEqual(["improved"]);
    // The entry that keeps that promise. Its own properties are pinned in
    // a-board-that-grew-is-a-rate-with-gates-not-a-count.test.ts; here only
    // the label condition: both halves, not a hire, no date, no new promise.
    const joined = CL.changelogEntries.newPostingsJoinActivelyHiring;
    expect(joined, "the newPostingsJoinActivelyHiring entry is missing from en").toBeTruthy();
    const joinedText = `${joined.title} ${joined.description}`;
    expect(joinedText).toMatch(LABEL);
    expect(joinedText).toMatch(TAKEDOWN_BASIS);
    expect(joinedText).toMatch(NOT_A_HIRE);
    expect(joinedText).toMatch(GROWTH_BASIS);
    expect(joinedText).toMatch(OWN_CLOCK);
    expect(joinedText).not.toMatch(CALENDAR_DATE);
    expect(joinedText, "the joining entry may quote the old promise only as the thing it keeps, never as a new one").not.toMatch(/joins once|not yet part/i);
    expect(changelog.find((e) => e.id === "newPostingsJoinActivelyHiring"), "the joining entry must be dated after the promise").toMatchObject({ date: "2026-09-14" });
  });
});
