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
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hiringRecordVerdict,
  hiringRecordSlot,
  partitionByHiringRecord,
  type HiringRecordVerdict,
} from "../pages/Jobs";

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
  });

  it("every consumer of the verdict is enumerated FROM THE SOURCE, and each one answers for unknown", () => {
    // Read the call sites out of the file rather than listing them here. A
    // surface added next quarter is in this set the moment it is written, which
    // is the difference between a guard for a class and a guard for four lines.
    const CONSUMER = /\b(hiringRecordVerdict|hiringRecordOf|isActivelyHiring)\s*\(/g;
    // The definitions themselves are not consumers.
    const DEFINITION = /(export function hiringRecordVerdict\s*\(|const hiringRecordOf = useCallback|const isActivelyHiring = useCallback|hiringRecordVerdict\(tok \? curveByToken|hiringRecordOf\(tok\) === "closes")/;

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
    // whose caution, pace, positive and unreadable branches span a little over
    // 1,700 characters of code between the first and the last. Comments are
    // blanked in place rather than deleted, so this distance is the real one a
    // reader would scroll. Wide enough that a genuine surface is never split;
    // narrow enough that a site pasted into a different part of the page has no
    // handler in reach.
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
    // stated exclusion and the card slot's third chip.
    expect(JOBS, "the filter must count what it set aside").toMatch(/hiringPartition\.setAside\.length > 0/);
    expect(JOBS, "and hand the reader a way back to it").toMatch(/takedownSetAsideShow/);
    expect(JOBS, "the card slot renders the unreadable state instead of an empty slot")
      .toMatch(/hiringRecordSlot\(hiringRecordOf\(job\.token\)\) === "unreadable"/);
  });

  it("no surface calls the measurement 'actively hiring' any more", () => {
    // WHAT THE PREDICATE MEASURES, EVEN AT ITS BEST: we have watched this
    // employer take roles down and not repost them. That is not "actively
    // hiring", and the label was the claim doing the damage on the surfaces that
    // still worked. Asserted over the WHOLE file including comments — the string
    // is a rendered label, and a stale one in a t() default renders in English
    // for anyone whose locale has no value for the key.
    const RAW_JOBS = read("src/pages/Jobs.tsx");
    const RAW_EXPLORE = read("src/pages/Explore.tsx");
    for (const retired of RETIRED_JOBS_KEYS) {
      expect(RAW_JOBS, `"jobsPage.${retired}" still renders`).not.toContain(`"jobsPage.${retired}"`);
    }
    for (const retired of RETIRED_EXPLORE_KEYS) {
      expect(RAW_EXPLORE, `"explore.${retired}" still renders`).not.toContain(`"explore.${retired}"`);
    }
    // And the replacement says what we watched rather than what we inferred.
    expect(JOBS).toMatch(/"jobsPage\.takedownBadge", "Takes roles down"/);
    expect(JOBS).toMatch(/"jobsPage\.noRecordBadge", "No closure record"/);
    // A closure is never a hire — a hire, a withdrawal, a cancelled requisition
    // and a retitle are indistinguishable to us, and the tooltip on the chip a
    // person clicks has to say so.
    expect(JOBS).toMatch(/takedownFilterTip[\s\S]{0,400}not a hire/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // THE HALF THIS GUARD CLAIMED TO CHECK AND DID NOT.
  //
  // The loop above reads Jobs.tsx and nothing else, while its failure message
  // said retired copy "has to leave the code AND all nine locale files". A
  // locale VALUE beats an inline English default, so restoring
  // `"hhActive": "Aktiv am Einstellen"` to de.json puts the retired label back
  // on the badge for every German reader with the suite green — this repo's
  // logged "guard green over a live falsehood" shape, sitting on the guard for
  // the defect class this file exists to close. The locale files are opened
  // here, parsed rather than grepped, in all three directions: retired keys
  // gone, replacement keys present, and no surviving VALUE naming the retired
  // control.
  const LOCALES = [
    "de", "en-GB", "en", "es", "fr", "hi", "nl", "pt", "tl",
  ] as const;
  const RETIRED_JOBS_KEYS = [
    "hhActive", "hhBadge", "chipHiring", "chipActivelyHiring",
    "activelyHiringFilter", "activelyHiringTip", "activelyHiringEmpty",
    "savedWithoutActivelyHiring", "hhGathering",
  ] as const;
  const RETIRED_EXPLORE_KEYS = ["closureNone"] as const;
  const REQUIRED_JOBS_KEYS = [
    "takedownFilter", "takedownFilterTip", "chipTakedowns", "takedownBadge",
    "takedownBadgeTip", "noRecordBadge", "noRecordBadgeTip", "takedownSetAside",
    "takedownSetAsideShow", "takedownReading", "takedownEmpty",
    "savedWithoutTakedownFilter", "verdictNoRecord", "verdictTakedownsObserved",
    "hhNoClosureRecord", "hhBadgeTipObserved",
  ] as const;
  const REQUIRED_EXPLORE_KEYS = [
    "closureUnreadable", "closureUnanswered", "closureNone2",
  ] as const;
  const localeDoc = (loc: string) =>
    JSON.parse(read(`src/i18n/locales/${loc}.json`)) as Record<string, Record<string, string>>;

  it("the retired copy is gone from all nine locale files, not just from the code", () => {
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
  });

  it("the replacement copy exists in all nine, so no locale falls back to English", () => {
    const missing: string[] = [];
    for (const loc of LOCALES) {
      const doc = localeDoc(loc);
      for (const k of REQUIRED_JOBS_KEYS) if (!(k in (doc.jobsPage ?? {}))) missing.push(`${loc}:jobsPage.${k}`);
      for (const k of REQUIRED_EXPLORE_KEYS) if (!(k in (doc.explore ?? {}))) missing.push(`${loc}:explore.${k}`);
    }
    expect(missing, `absent from these locale files: ${missing.join(", ")}`).toEqual([]);
  });

  it("no surviving locale value, and no inline default, still names the retired control", () => {
    // THE HOLE THE KEY-NAME CHECKS CANNOT SEE. `savedViewTip` was never retired
    // — its VALUE named the "Actively-hiring toggle", and it carried that
    // sentence into nine languages while every key-name assertion stayed green.
    // A live English label is a claim regardless of which key holds it.
    const RETIRED_LABEL = /Actively[\s-]hiring|Actively hiring/i;
    const offenders: string[] = [];
    for (const loc of LOCALES) {
      const doc = localeDoc(loc);
      for (const ns of ["jobsPage", "explore", "agentQueue"]) {
        for (const [k, v] of Object.entries(doc[ns] ?? {})) {
          if (typeof v === "string" && RETIRED_LABEL.test(v)) offenders.push(`${loc}:${ns}.${k}`);
        }
      }
    }
    // And the same sentence in an inline t() default, which is what renders for
    // a locale that has no value for the key — a tenth locale, or a translation
    // pass that drops one. Read from the DEFAULT ARGUMENT ONLY: this file has a
    // history of guard literals that a prose comment satisfies, and Jobs.tsx
    // narrates the retired label in a dozen comments on purpose.
    const RAW_JOBS = read("src/pages/Jobs.tsx");
    for (const m of RAW_JOBS.matchAll(/t\("(jobsPage\.[A-Za-z0-9_]+)",\s*"((?:[^"\\]|\\.)*)"/g)) {
      if (RETIRED_LABEL.test(m[2])) offenders.push(`inline default ${m[1]}`);
    }
    expect(
      offenders,
      `these still render the retired label, which is not what the predicate measures: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("an unfinished read never renders as an empty one", () => {
    // THE THIRD STATE COLLAPSING ONE INDIRECTION OUT. `takedownEmpty` was the
    // only sentence in the disclosure block not gated on healthPending, so for
    // the measured 7-16s the curve batch takes — during which EVERY token is
    // unknown by construction, so `shown` is empty by construction — a shared
    // /jobs?activelyHiring=1 URL rendered an empty board captioned "no employer
    // among the openings loaded here has a closure record that clears the bar",
    // with the set-aside count and its "Show them" escape suppressed at exactly
    // that moment. A finding about employers, manufactured out of a read that
    // had not finished.
    const blockStart = JOBS.indexOf("activelyHiringOnly && (healthFailed");
    expect(blockStart, "the disclosure block moved — RE-ANCHOR this guard").toBeGreaterThan(-1);
    const emptyAt = JOBS.indexOf('"jobsPage.takedownEmpty"', blockStart);
    expect(emptyAt, "takedownEmpty is not inside the disclosure block").toBeGreaterThan(blockStart);
    expect(
      JOBS.slice(blockStart, emptyAt),
      "takedownEmpty is not behind a healthPending branch — an unfinished read is being published as an empty record",
    ).toMatch(/healthPending \? \(/);
    // And the pending window is not a silent gap either: it gets a sentence of
    // its own rather than borrowing the negative one or rendering nothing.
    expect(JOBS, "the pending read must say so").toMatch(/"jobsPage\.takedownReading"/);
    const setAsideAt = JOBS.indexOf('"jobsPage.takedownSetAside"', blockStart);
    expect(setAsideAt, "the set-aside sentence must also sit after the pending branch").toBeGreaterThan(
      JOBS.indexOf("healthPending ? (", blockStart),
    );
  });

  it("an abandoned curve read hands its tokens back, so no employer is unknown forever", () => {
    // A `jobs` change during the read — one "Load more", one dismissal — ran the
    // effect's cleanup, which set `cancelled` and threw the response away. The
    // batch's tokens had already gone into healthAttempted and came out only
    // inside giveUp(), which early-returns when cancelled. Those employers then
    // had no curve row that could ever arrive, and the third state turned that
    // silence into a stated sentence: the filter set them aside and told the
    // reader we hold no closure record for them, when we had fetched it and
    // discarded it. Only an ANSWERED read may keep its tokens.
    expect(JOBS, "the cleanup must release the tokens of a read that never answered")
      .toMatch(/if \(!settled\) batch\.forEach\(\(tok\) => healthAttempted\.current\.delete\(tok\)\)/);
    expect(
      all(JOBS, /settled = true/),
      "settled must be set on BOTH terminal paths — the successful response and giveUp",
    ).toHaveLength(2);
  });

  it("no unknown-state sentence names a cause the predicate could not produce", () => {
    // THE OVER-CORRECTION, AND IT IS THE SAME DEFECT WITH ITS SIGN FLIPPED.
    // The first pass at the third state told the reader, flatly, that the
    // employers we hold no closure record for have "boards bigger than one
    // visit can read". hiringRecordVerdict reaches `unknown` from a windowed
    // tenant, from a small board we read to the end that simply closed nothing
    // in ninety days, and from a build that stopped returning the columns — and
    // it cannot tell them apart. get_closure_population() is the function that
    // could place a board in its bucket and it is called from nowhere in src/.
    // So a sentence that asserts windowing about a NAMED employer is publishing
    // a fact about their board that our query never produced.
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
    // And no string may promise a timetable for the gap closing. The first
    // proven lap stamps its backlog 'lap_backfill', which get_company_fill_curve
    // excludes, so restoration takes a proven pass PLUS takedowns observed after
    // it — and a board whose vendor advertises no feed total can never prove a
    // pass at all, so for that population the gap never closes.
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

  it("the public leaderboard names its measurement and its exclusion", () => {
    // /ghost-job-index ranked employers on observed closures under the heading
    // "Actively hiring right now", with a disclosure paragraph that enumerated
    // every other exclusion and not this one. An employer with 34,000 open roles
    // has no closure rows at all, so it cannot place — and the page told the
    // reader that meant it was not hiring.
    const GJI = read("src/pages/GhostJobIndex.tsx");
    const heading = GJI.slice(GJI.indexOf("<h2 className=\"text-lg font-semibold flex items-center gap-2 mb-3\">"));
    expect(heading.slice(0, 400), "the leaderboard heading still claims 'actively hiring'")
      .not.toMatch(/Actively hiring right now\n?\s*<\/h2>/);
    expect(GJI, "the leaderboard must state the exclusion that made the old heading false")
      .toMatch(/absent from this ranking by construction\s+rather than by\s+inactivity/);
  });
});
