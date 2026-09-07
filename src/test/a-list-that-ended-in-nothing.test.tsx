/**
 * THE LIST ENDED IN NOTHING.
 *
 * src/pages/Jobs.tsx rendered the results <ul>, then a load-more gate, then the
 * fragment closed. When the server answered hasMore:false the gate evaluated
 * false and NOTHING took its place — no sentence, no count, no next step. The
 * results simply stopped mid-scroll. Every visitor who exhausts a search met
 * it, which is every visitor who searches something specific; 594 jobsPage keys
 * existed and not one of them was a terminal string.
 *
 * A dead stop with a sentence painted on it is barely better, and on THIS
 * product a careless sentence is worse than silence. "That's every job there
 * is" is not a claim an aggregator of other people's feeds can make, and a
 * count is not a decoration:
 *
 *   * `total` can legitimately be null — the count blows its 1.5s deadline and
 *     the server says countUnavailable. The header already refuses to print
 *     jobs.length as if it were the total in that state; a terminal card
 *     reading "all 47 results" when the server said "I could not count" is the
 *     same unearned sentence one layer down.
 *
 *   * even when `total` IS produced it counts UNGROUPED rows while the page
 *     serves grouped cards — measured at a 7.3% median shortfall on 43.9% of
 *     terminal pages. So the card prints shownCount, the cards on screen,
 *     labelled as shown, and never a server total.
 *
 * THE PROPERTY, in two halves:
 *
 *   1. The list can never again end in nothing. The terminal card's gate is the
 *      character-exact complement of the load-more gate, so on any page with
 *      rows exactly one of the two renders. (Rows imply `data`: setJobs is fed
 *      from the same response setData is, on the following line.)
 *
 *   2. The terminal state never prints a count the server did not produce. No
 *      branch of the card reads `total`, `pageTotalCount` or any of the count
 *      surrogates, the countUnavailable branch interpolates no number at all,
 *      and it runs no relaxation probes — the counter those probes would ask is
 *      the one that just failed.
 *
 * COMMENT-STRIPPED. Every assertion about CODE below runs against source with
 * comments removed. The block this guards is heavily commented and the prose
 * above quotes the very shapes being asserted; this repo has been bitten seven
 * times by a guard that matched an explanation while the code it described was
 * dead. The copy assertions run against the locale JSON, which has no comments
 * to hide in, and the inline English fallbacks are compared to it from the
 * STRIPPED source for the same reason.
 *
 * Three mounts in the middle read the three endings off a real render, because
 * a source guard cannot tell a rendered card from a well-spelled one; the
 * static checks are what stop the shapes above from drifting once it does.
 *
 * The teeth block at the foot re-runs each checker against the pre-fix file
 * (this same source with the terminal block excised) and against a card that
 * prints a server total, and proves each one fails there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [] }),
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
import Jobs from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

const RAW = read("src/pages/Jobs.tsx");
const CODE = strip(RAW);
const EN = JSON.parse(read("src/i18n/locales/en.json")).jobsPage as Record<string, string>;
const GB = JSON.parse(read("src/i18n/locales/en-GB.json")).jobsPage as Record<string, string>;

/* Pure checkers over source text, so the teeth block can run the very same
   functions against the pre-fix spelling instead of a paraphrase of it. */

/** The condition the load-more button is gated on, or "" if that gate moved. */
const loadMoreGate = (code: string): string => {
  const m = code.match(/\{data && (data\.hasMore !== false && \([^\n]*?\)) && \(/);
  return m ? m[1] : "";
};

/** The condition listExhausted negates, or "" if nothing defines the terminal state. */
const exhaustedGate = (code: string): string => {
  const m = code.match(/const listExhausted = !!data && !\((.*)\);\n/);
  return m ? m[1] : "";
};

/** Does the JSX render anything at all under the list when paging is over? */
const hasTerminalBlock = (code: string): boolean => /\{listExhausted && \(/.test(code);

/**
 * The terminal card's JSX, from its gate to the brace that closes it.
 *
 * Brace-matched rather than cut at the next `</>`: the narrow branch opens its
 * own fragment, so a naive cut stopped three lines in and every assertion about
 * the rest of the card passed on an empty tail — a guard reading half the thing
 * it guards. Braces inside these strings (`{{n}}`) and template holes (`${…}`)
 * are balanced, so the count is sound over this block.
 */
const terminalBlock = (code: string): string => {
  const i = code.indexOf("{listExhausted && (");
  if (i < 0) return "";
  let depth = 0;
  for (let k = i; k < code.length; k++) {
    if (code[k] === "{") depth++;
    else if (code[k] === "}" && --depth === 0) return code.slice(i, k + 1);
  }
  return code.slice(i);
};

/** Every server-count surrogate. None may appear inside the terminal card. */
const SERVER_COUNTS = /\bdata\.total\b|\bdata\?\.total\b|\bpageTotalCount\b|\btotalAtLeast\b|\btotalBeforeExclusions\b|\btotalAllCompanies\b/;

describe("a list that ended in nothing", () => {
  it("the terminal card is the exact complement of the load-more gate", () => {
    const more = loadMoreGate(CODE);
    expect(more, "the load-more gate moved — this guard's premise is gone").not.toBe("");
    const end = exhaustedGate(CODE);
    expect(end, "listExhausted is gone; nothing defines 'no next page'").not.toBe("");
    // Character-identical, negated. Two copies exist only because
    // a-headline-counts-what-the-board-can-serve pins the JSX gate's literal
    // spelling; this assertion is what keeps them from drifting apart into a
    // page that can render both blocks, or neither.
    expect(end, "the terminal gate is no longer the negation of the load-more gate")
      .toBe(more);
  });

  it("renders a terminal state, so the list cannot stop with nothing under it", () => {
    expect(hasTerminalBlock(CODE), "there is nothing under the list when paging ends").toBe(true);
    const block = terminalBlock(CODE);
    expect(block.length, "the terminal block is a stub").toBeGreaterThan(600);
    // Rows on screen imply a response object, so `!!data` in listExhausted can
    // never be the reason the page shows neither block.
    expect(CODE).toMatch(/setData\(br\);\s*\n\s*setJobs\(/);
  });

  it("prints no count the server did not produce", () => {
    const block = terminalBlock(CODE);
    expect(block.match(SERVER_COUNTS), "the terminal card quotes a server total").toBe(null);
    // The one figure it may show is the rows on this page, the same basis the
    // results summary and the screen-reader line already use.
    expect(block).toMatch(/n: shownCount\.toLocaleString\(\)/);
  });

  it("says nothing numeric when the server could not count", () => {
    const block = terminalBlock(CODE);
    expect(block, "the unavailable-count branch is gone").toMatch(/endKind === "unknown"/);
    // Neither string in that branch takes an interpolation object: a t() call
    // with no second argument beyond the English fallback cannot print a figure.
    for (const k of ["endUnknownTitle", "endUnknownBody"]) {
      const m = block.match(new RegExp(`t\\("jobsPage\\.${k}", "(?:[^"\\\\]|\\\\.)*"(.)`));
      expect(m, `${k} is not rendered`).not.toBe(null);
      expect(m![1], `${k} interpolates a value into a state with no count`).toBe(")");
    }
    // And no relaxation is measured there — those counts come from the same
    // counter whose deadline just blew.
    expect(CODE).toMatch(/const endTarget = listExhausted[^;]*!endCountUnknown/);
  });

  it("distinguishes the three endings rather than shipping one generic card", () => {
    expect(CODE).toMatch(/const endKind: "unknown" \| "narrow" \| "broad"/);
    const block = terminalBlock(CODE);
    for (const k of ["endUnknownTitle", "endNarrowTitle", "endBroadTitle"]) {
      expect(block, `${k} never renders — the three endings collapsed into fewer`)
        .toContain(`jobsPage.${k}`);
    }
    // Narrow gets the measured wideners; broad does not.
    expect(block).toMatch(/endKind === "narrow"[\s\S]*jobsPage\.zeroRemove/);
    expect(block.indexOf("jobsPage.endBroadBody"))
      .toBeGreaterThan(block.indexOf("jobsPage.zeroRemove"));
  });

  it("reuses the zero-result rescue's measurement instead of a second one", () => {
    // One probe, one state, two dead ends. A separate copy of the RELAX map
    // would be the thing that drifts: the zero path has already been fixed
    // twice for probing a looser query than the page was served from.
    expect(CODE).toMatch(/const zeroTarget = data\.total === 0 && jobs\.length === 0;/);
    // THE CACHE KEY IS CLEARED ON EVERY EARLY RETURN. The signature is built
    // from the filter BODY, which does not carry sortMode, searchNewestFirst or
    // the fit-browse flag — all of which refetch the list. Without the reset,
    // changing the sort nulled widenHelp on the way in, hit the identical
    // signature on the way out and early-returned, leaving the colon-ended
    // promise of counts over a spinner that never resolved.
    expect(CODE).toMatch(/if \(loading \|\| refreshing \|\| error \|\| !data\) \{ widenSigRef\.current = ""; setWidenHelp\(null\); setWidenComplete\(false\); return; \}/);
    expect(CODE).toMatch(/if \(!zeroTarget && !endTarget\) \{ widenSigRef\.current = ""; setWidenHelp\(null\); setWidenComplete\(false\); return; \}/);
    // A FAILED PROBE LEAVES THE SAMPLE. invokeBoard RESOLVES {data:null,error}
    // rather than throwing, so without this a rate-limited count arrived as
    // zero, was dropped by the floor, and became "we checked, nothing helps".
    expect(CODE, "a failed probe is still counted as a measurement of zero")
      .toMatch(/if \(probeError \|\| r == null\) return null;/);
    expect(CODE, "the catch still fabricates a count").not.toMatch(/catch \{ return \{ \.\.\.c, count: 0/);
    expect(CODE).toMatch(/const results = probed\.filter\(\(r\)[^\n]*r !== null\);/);
    // …and the refuting sentence is gated on a complete sample: every candidate
    // answered, and the candidates were every active filter (the end path probes
    // only the first two chips).
    expect(CODE).toMatch(/setWidenComplete\(results\.length === candidates\.length && candidates\.length === activeFilters\.length\);/);
    expect(terminalBlock(CODE)).toMatch(/endKind === "narrow" && widenComplete \?/);
    expect(CODE, "the terminal path must not resurrect a second probe map")
      .not.toMatch(/const END_RELAX|endRelax/);
    // A relaxation offered at the foot of a short list has to beat that list.
    expect(CODE).toMatch(/const floor = zeroTarget \? 0 : pageTotalCount;/);
    expect(CODE).toMatch(/results\.filter\(\(r\) => r\.count > floor\)/);
  });

  it("offers the alert at the moment the user is best qualified to want it", () => {
    const block = terminalBlock(CODE);
    expect(block, "the highest-intent moment on the board still renders no next step")
      .toMatch(/saveCurrentSearch\(true\)/);
    // Gated on the same condition as the save button above the results: a
    // search with nothing in it is not one the digest can run.
    expect(block).toMatch(/\(q \|\| activeBoardFilterKeys\(filterState\)\.length > 0\) && \(/);
  });

  it("scopes the claim the way the page already scopes it", () => {
    // The card must not imply the corpus is complete or fresher than it is, and
    // must not invent a second account of freshness beside sourceNote's.
    expect(EN.endScope, "the terminal card no longer states its scope").toBeTruthy();
    expect(EN.endScope).toContain("the company feeds we track");
    expect(EN.endScope).toContain("as of our last read of each one");
    // ONE story about freshness, and the assertion is that the two strings
    // tell it in the SAME words — not that they contain a particular phrase.
    // The literal used to be "rotates around the clock"; that sentence was
    // retracted on 2026-09-06 because it is a cadence claim the measurement
    // contradicts (scan-heartbeat reads it as a median bound of 480 minutes and
    // the live p50 is ~3,720), so pinning the literal would have pinned a false
    // claim in place. Pin the SHARED PHRASE instead: whatever the rotation
    // sentence becomes, both surfaces must say it identically, which is the
    // property this test was actually written to hold.
    const ROTATION = "the rotation runs continuously";
    expect(EN.sourceNote, "sourceNote no longer describes the rotation").toContain(ROTATION);
    expect(EN.endScope, "sourceNote's rotation language is the one story about freshness")
      .toContain(ROTATION);
    // And it must not have quietly regrown a cadence or completeness promise.
    for (const s of [EN.endScope, EN.sourceNote]) {
      expect(s, "a retracted cadence claim is back in board copy")
        .not.toMatch(/around the clock|whole catalog rotat|every \d+\s*(–|-)?\s*\d*\s*minutes?/i);
    }
    for (const s of [EN.endScope, EN.endNarrowTitle, EN.endBroadTitle, EN.endUnknownTitle, EN.endBroadBody]) {
      expect(s, "a terminal string claims the whole market").not.toMatch(/every job|all the jobs|everywhere/i);
    }
  });

  const NEW_KEYS = [
    "endNarrowTitle", "endNarrowBody", "endNarrowNoWidener", "endNarrowUnmeasured",
    "endBroadTitle", "endBroadBody", "endPagingOnlyBody",
    "endUnknownTitle", "endUnknownBody",
    "endUnconfirmedTitle", "endUnconfirmedBody", "endHiddenBody", "endRefreshing",
    "endScope", "endScopeServed", "endScopeFreshness",
    "endAlertHint", "endAlertCta", "endBrowseHint", "endBrowseCta",
  ];

  it("names no cause it cannot observe, and denies no count the page is printing", () => {
    // countUnavailable is published for at least five different reasons — the
    // count RPC erroring, a bounded rescue tier that can only publish its own
    // window size, close matches appended so no figure describes the page, a
    // page that disproves its own count, and the offset-past-end exit — of
    // which a deadline is ONE. The card used to assert the deadline for all of
    // them. On the typo-rescue exit nothing times out (the tier never counts)
    // and the server publishes a proven floor the header renders as "of 60+",
    // so the old sentence also denied a number already on screen.
    for (const s of [EN.endUnknownBody, EN.endUnconfirmedBody, EN.endPagingOnlyBody]) {
      expect(s, "a terminal string names a server-side cause the client cannot observe")
        .not.toMatch(/time limit|timed out|deadline|too slow/i);
    }
    expect(EN.endUnknownBody, "the card denies having a count while the header may be printing a floor")
      .not.toMatch(/how many matched|can't tell you how many/i);
  });

  it("withholds the completeness claim unless the server's own count was served in full", () => {
    // hasMore:false is not always exhaustion: deepPageable excludes the company
    // and simple retrievers and the SYMBOL route, so those report it at the edge
    // of a window while `total` still names a far larger match set (q="c++"
    // counts 1,682 and stops serving at rank 200).
    expect(CODE).toMatch(/const endServerConfirmed = data\?\.hasMore === false;/);
    expect(CODE).toMatch(/const endComplete = endServerConfirmed && !endCountUnknown && !endApproximate/);
    expect(CODE, "a capped count can still carry a completeness claim")
      .toMatch(/data\?\.countCapped !== true && data\?\.relatedCapped !== true/);
    expect(CODE, "the page must not claim completeness over rows the counts do not cover")
      .toMatch(/jobs\.length >= pageTotalCount;/);
    // Close-match rescues serve rows the filters did not match — every card
    // wears a "close match" chip — so they can never be "everything matching".
    expect(CODE).toMatch(/const endApproximate = !!data\?\.fuzzy \|\| !!data\?\.fuzzyExtra \|\| !!data\?\.exactWordMatch/);
    const block = terminalBlock(CODE);
    expect(block, "endBroadBody is no longer gated on a proven-complete response")
      .toMatch(/endComplete \? \(\s*\n\s*<p[^>]*>\s*\n\s*\{t\("jobsPage\.endBroadBody"/);
    expect(block, "the scope line still claims completeness unconditionally")
      .toMatch(/endComplete\s*\n?\s*\? t\("jobsPage\.endScope"/);
    expect(EN.endScopeServed).not.toMatch(/that's everything matching/i);
  });

  it("hands over the measurement that makes its freshness sentence honest", () => {
    // sourceNote's rotation clause is honest because a third clause points at
    // the live median and 95th-percentile re-check ages. endScope kept the
    // rotation and dropped the pointer, which is the cheerful half on its own —
    // at a p50 of ~62 hours against a 6.7-hour baseline, "shows up on the next
    // pass" is an impression with no number behind it.
    for (const s of [EN.endScope, EN.endScopeServed]) {
      expect(s, "a cadence sentence with no way to check it")
        .not.toMatch(/next pass|shows up soon/i);
      expect(s).toMatch(/measurement rather than a promise/);
    }
    expect(EN.sourceNote).toMatch(/measurement rather than a promise/);
    // And the pointer is a real link to the page that publishes those ages.
    expect(terminalBlock(CODE)).toMatch(/<Link to="\/ghost-job-index"[\s\S]*jobsPage\.endScopeFreshness/);
  });

  it("stands its claim down for the window in which the rows are the previous search's", () => {
    // `refreshing` starts at the top of the 400ms debounce, so this covers the
    // whole window in which the chips read the new filters and the list still
    // holds the old rows — the same window the load-more button disables for.
    // The card still RENDERS, so the list never goes back to ending in nothing.
    const block = terminalBlock(CODE);
    expect(block).toMatch(/\{refreshing \? \(/);
    expect(block).toContain("jobsPage.endRefreshing");
    expect(block.indexOf("jobsPage.endRefreshing"))
      .toBeLessThan(block.indexOf("jobsPage.endNarrowTitle"));
  });

  it("puts no counted headline on a page whose rows are all hidden", () => {
    // shownCount is narrowed by dismissals and by the browser-side Actively
    // hiring toggle while the card's gate reads the FETCHED rows, so a page with
    // every row hidden printed "End of results — 0 openings shown".
    expect(CODE).toMatch(/: shownCount === 0 \? "hidden"/);
    // And the wideners never run behind that toggle: its counts came from a
    // query the filter was never in, the same withdrawal the results summary
    // performs on its totals.
    expect(CODE).toMatch(/const endTarget = listExhausted[\s\S]*!activelyHiringOnly/);
  });

  it("carries the English in both source-of-truth locales and inline, identically", () => {
    for (const k of NEW_KEYS) {
      expect(EN[k], `en.json is missing jobsPage.${k}`).toBeTruthy();
      expect(GB[k], `en-GB.json is missing jobsPage.${k}`).toBe(EN[k]);
      // The file's idiom is t("jobsPage.x", "English inline"). Read from the
      // STRIPPED source so a fallback that survives only in a comment fails.
      const m = CODE.match(new RegExp(`t\\("jobsPage\\.${k}", "((?:[^"\\\\]|\\\\.)*)"`));
      expect(m, `jobsPage.${k} is not rendered with an inline English fallback`).not.toBe(null);
      expect(JSON.parse(`"${m![1]}"`), `the inline fallback for ${k} disagrees with en.json`).toBe(EN[k]);
    }
  });

  it("a retracted claim is not still shipping in seven other languages", () => {
    /**
     * A TRANSLATION OUTLIVES THE SENTENCE IT TRANSLATED. These three keys were
     * translated into all nine locales while their English said things the
     * board cannot back — that the count "couldn't finish inside its time
     * limit" (a cause the client cannot observe and that is wrong on most of
     * the paths that withhold a count), that "we checked whether dropping a
     * filter would help, and it doesn't" (printed over failed probes and over
     * a 2-of-5 sample), and a rotation cadence with the pointer to its
     * measurement dropped. Fixing only the English would have left the false
     * version rendering for every de/es/fr/hi/nl/pt/tl reader, because i18next
     * prefers the locale value over the inline fallback.
     *
     * So the stale values were DELETED rather than left in place: an English
     * fallback is worse localisation and better honesty. This assertion is the
     * tripwire. When the translation phase lands real translations of the NEW
     * English, delete the key from RETRACTED here in the same commit — that
     * edit is the confirmation that what was translated is the current
     * sentence and not the retracted one.
     */
    // Emptied 2026-09-06: all seven locales landed translations of the CURRENT
    // English. Checked per key before deleting, not assumed from the diff —
    // endUnknownBody names no server-side cause and prints no figure in any of
    // the seven (no timeout/deadline wording, no digits, no word for zero);
    // endNarrowNoWidener reports the completed negative result and redirects to
    // the search term rather than promising a looser filter; and endScope keeps
    // all three limbs (these filters / the feeds we track / as of our last read
    // of each one) and ends on the colon that hands off to endScopeFreshness.
    // The rotation clause in each locale's endScope and endScopeServed is the
    // byte-identical substring of that same locale's own sourceNote, so the
    // shared-phrase property this file pins in English holds in all seven.
    const RETRACTED: string[] = [];
    for (const loc of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const jp = JSON.parse(read(`src/i18n/locales/${loc}.json`)).jobsPage as Record<string, string>;
      for (const k of RETRACTED) {
        expect(jp[k], `${loc}.json still carries a translation of the retracted jobsPage.${k}`)
          .toBeUndefined();
      }
    }
  });
});

/* ───────────────────────── and it actually renders ─────────────────────────
   A source guard cannot tell a rendered card from a well-spelled one. These
   three mount the real page against a server that says hasMore:false and read
   the words off the screen — one mount per ending, because "one generic card
   for all three" is the failure mode the copy above is arranged to prevent. */
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `j-${i}`, company: `Emp ${i}`, title: `Role ${i}`, location: "Remote",
  salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
}));

/** A terminal board: one page, no next offset, and a relaxation probe that has
 *  plenty to offer. `extra` is how a caller withdraws the count. */
function terminalBoard(n: number, extra: Record<string, unknown> = {}, probe = 999) {
  invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
    const body = opts?.body ?? {};
    if (fn !== "job-board" || body.action !== "list") return { data: null };
    if (body.facetCounts) return { data: { categories: {} } };
    if (body.countOnly) return { data: { total: probe } };
    return { data: {
      jobs: rows(n), total: n, totalAllCompanies: 500, companies: [], companiesCount: 0,
      categories: {}, failedSources: [], failedCount: 0, refreshedAt: null,
      hasMore: false, nextOffset: n, ...extra,
    } };
  });
}
// The page reads its filters off window.location, not the router entry.
const mount = (url: string) => {
  window.history.replaceState({}, "", url);
  return render(<MemoryRouter initialEntries={[url]}><Jobs /></MemoryRouter>);
};
const SLOW = { timeout: 4000 } as const;

describe("a list that ended in nothing — the three endings on screen", () => {
  beforeEach(() => { invoke.mockReset(); });

  it("a narrow search that ran out gets its measured wideners", async () => {
    terminalBoard(4);
    mount("/jobs?q=nurse");
    await waitFor(() => expect(screen.getByText(/End of results/i)).toBeTruthy(), SLOW);
    expect(screen.getByText(/narrow set of filters/i)).toBeTruthy();
    // The relaxation is measured, and it beats the four results on the page.
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove .*999 openings/i })).toBeTruthy(), SLOW);
    expect(screen.getByText(/company feeds we track/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Email me new matches/i })).toBeTruthy();
  }, 20000);

  it("a browse with nothing to blame gets the alert, not the wideners", async () => {
    terminalBoard(6);
    mount("/jobs");
    await waitFor(() => expect(screen.getByText(/You've reached the end/i)).toBeTruthy(), SLOW);
    expect(screen.getByText(/seen everything this search reaches/i)).toBeTruthy();
    expect(screen.queryByText(/narrow set of filters/i), "a broad browse was offered filter relaxations").toBeNull();
  }, 20000);

  it("a withdrawn count says the least and puts no figure on the page", async () => {
    terminalBoard(5, { total: null, countUnavailable: true });
    mount("/jobs?q=nurse");
    await waitFor(() => expect(screen.getByText(/last page for this search/i)).toBeTruthy(), SLOW);
    expect(screen.getByText(/didn't publish a count/i)).toBeTruthy();
    // NO CAUSE IS NAMED. countUnavailable means at least five different things
    // server-side and the client can observe none of them.
    expect(document.body.textContent, "the card invented a cause for the missing count")
      .not.toMatch(/time limit|timed out/i);
    // Neither counted headline may appear, and no relaxation is offered: the
    // counter that would measure one is the counter that did not answer.
    expect(document.body.textContent, "a count survived a state with no count")
      .not.toMatch(/openings shown for these filters|You've reached the end/i);
    expect(screen.queryByRole("button", { name: /Remove .* openings/i })).toBeNull();
  }, 20000);

  it("the typo rescue is not told it timed out, and is not called complete", async () => {
    // The payload the server actually sends for a misspelled query: a bounded
    // rescue tier, a proven floor, no count, and hasMore:false as a deliberate
    // disclosure mechanism rather than an exhaustion signal.
    terminalBoard(5, {
      total: null, countUnavailable: true, totalAtLeast: 60, fuzzy: "nurse practicioner",
    });
    mount("/jobs?q=nurse+practicioner");
    await waitFor(() => expect(screen.getByText(/last page for this search/i)).toBeTruthy(), SLOW);
    expect(document.body.textContent).not.toMatch(/time limit/i);
    expect(document.body.textContent, "a rescue page claimed to be everything matching the filters")
      .not.toMatch(/That's everything matching these filters/i);
  }, 20000);

  it("a window edge is not exhaustion — the count the server withheld rows from is not called complete", async () => {
    // q="c++": total 1,682, served to SQL rank 200, hasMore:false because the
    // company/simple/SYMBOL routes are excluded from deepPageable.
    terminalBoard(6, { total: 1682 });
    mount("/jobs");
    await waitFor(() => expect(screen.getByText(/no further page to load/i)).toBeTruthy(), SLOW);
    expect(document.body.textContent, "the card claimed completeness over 1,676 unserved matches")
      .not.toMatch(/seen everything this search reaches|That's everything matching these filters/i);
    expect(screen.getByText(/not necessarily every posting that matches/i)).toBeTruthy();
  }, 20000);

  it("an unconfirmed end says so instead of borrowing the server's word", async () => {
    // An older deployed function (this project's documented deploy failure:
    // a bundle over ~4.5MB reports success and serves the previous version)
    // sends no hasMore at all, and the count comparison ends paging on page 1.
    terminalBoard(6, { hasMore: undefined });
    mount("/jobs?q=nurse");
    await waitFor(() => expect(screen.getByText(/everything this search returned/i)).toBeTruthy(), SLOW);
    expect(screen.getByText(/didn't say whether another page exists/i)).toBeTruthy();
    expect(document.body.textContent, "an inferred end wore a confirmed end's headline")
      .not.toMatch(/End of results —|You've reached the end/i);
  }, 20000);

  it("a failed probe never becomes a refutation", async () => {
    // invokeBoard resolves {data:null,error}: a 429 off the rate budget used to
    // arrive as count 0, fall under the floor, and print "we checked, and it
    // doesn't" over zero successful measurements.
    invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
      const body = opts?.body ?? {};
      if (fn !== "job-board" || body.action !== "list") return { data: null };
      if (body.facetCounts) return { data: { categories: {} } };
      if (body.countOnly) return { data: null, error: { message: "rate limited" } };
      return { data: {
        jobs: rows(4), total: 4, totalAllCompanies: 500, companies: [], companiesCount: 0,
        categories: {}, failedSources: [], failedCount: 0, refreshedAt: null,
        hasMore: false, nextOffset: 4,
      } };
    });
    mount("/jobs?q=nurse");
    await waitFor(() => expect(screen.getByText(/End of results/i)).toBeTruthy(), SLOW);
    await waitFor(() => expect(screen.getByText(/is where more postings would come from/i)).toBeTruthy(), SLOW);
    expect(document.body.textContent, "a failed probe was printed as a measured refutation")
      .not.toMatch(/We checked each of your filters/i);
  }, 20000);

  it("a complete, refuted probe may say it checked", async () => {
    // One active filter, one candidate, one successful count below the floor.
    terminalBoard(4, {}, 2);
    mount("/jobs?q=nurse");
    await waitFor(() => expect(screen.getByText(/We checked each of your filters/i)).toBeTruthy(), SLOW);
    expect(screen.queryByRole("button", { name: /Remove .* openings/i })).toBeNull();
  }, 20000);

  it("stands its claim down while the rows belong to the previous search", async () => {
    terminalBoard(4);
    mount("/jobs?q=nurse");
    await waitFor(() => expect(screen.getByText(/End of results/i)).toBeTruthy(), SLOW);
    fireEvent.change(document.getElementById("board-search")!, { target: { value: "welder" } });
    // `refreshing` starts at the top of the debounce, so the claim is gone
    // immediately — not 400ms later when the request goes out.
    await waitFor(() => expect(screen.getByText(/Re-running this search/i)).toBeTruthy(), SLOW);
    expect(document.body.textContent, "a completeness claim survived into a search that had not run")
      .not.toMatch(/End of results —|company feeds we track/i);
    expect(screen.queryByRole("button", { name: /Email me new matches/i }),
      "the alert would have been saved against filters whose results were never shown").toBeNull();
  }, 20000);

  it("prints no counted headline when every row on the page is hidden", async () => {
    // The Actively-hiring toggle is browser-side with no board predicate; with
    // no hiring-health data it empties a served page.
    terminalBoard(2);
    mount("/jobs?q=nurse&activelyHiring=1");
    await waitFor(() => expect(screen.getByText(/last page for this search/i)).toBeTruthy(), SLOW);
    expect(document.body.textContent, "the card counted a page nobody can see")
      .not.toMatch(/0 openings shown/i);
    expect(screen.queryByRole("button", { name: /Remove .* openings/i }),
      "wideners were measured without the filter the visitor is looking through").toBeNull();
  }, 20000);

  it("an unfiltered browse that ends is still given somewhere to go", async () => {
    terminalBoard(6);
    mount("/jobs");
    await waitFor(() => expect(screen.getByText(/You've reached the end/i)).toBeTruthy(), SLOW);
    // The alert cannot run on an empty watch, so this ending would otherwise be
    // a title, a sentence and no control at all.
    expect(screen.queryByRole("button", { name: /Email me new matches/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Search for a role/i })).toBeTruthy();
  }, 20000);
});

/* ─────────────────────────────── has teeth ───────────────────────────────
   Each checker above is re-run against the state that actually shipped: the
   file with its terminal block excised, which is the file as it stood before
   this change. A guard that cannot fail there is decoration. */
describe("a list that ended in nothing — the guard has teeth", () => {
  /** The pre-fix file: load-more gate, then straight to the closing fragment. */
  // Built without an assertion of its own: a fixture that THROWS at collection
  // time takes the whole file down with it, and a file that cannot be collected
  // reports "no tests" instead of the property that broke. On a source with no
  // terminal block this is simply that source, which is the pre-fix state
  // exactly — the teeth below still hold, and the failures the reader sees are
  // the property tests above, by name.
  const PRE_FIX = CODE.replace(terminalBlock(CODE), "")
    .replace(/const listExhausted = [^\n]*\n/, "");

  it("the pre-fix page renders nothing when paging ends", () => {
    expect(hasTerminalBlock(PRE_FIX)).toBe(false);
    expect(terminalBlock(PRE_FIX)).toBe("");
    // The load-more gate is still there — which is exactly why the absence was
    // invisible: the page looked complete right up to its last page.
    expect(loadMoreGate(PRE_FIX)).not.toBe("");
    expect(exhaustedGate(PRE_FIX), "nothing defined the terminal condition").toBe("");
  });

  it("a gate that is not the load-more gate's negation fails the complement check", () => {
    const drifted = CODE.replace(
      /const listExhausted = !!data && !\(data\.hasMore !== false/,
      "const listExhausted = !!data && !(data.hasMore === false",
    );
    expect(exhaustedGate(drifted)).not.toBe(loadMoreGate(drifted));
  });

  it("a terminal card that prints a server total fails the count check", () => {
    const card = (n: string) => `{listExhausted && (<p>{t("jobsPage.endNarrowTitle", "All {{n}} results", { n: ${n}.toLocaleString() })}</p>)}`;
    expect(terminalBlock(card("pageTotalCount")).match(SERVER_COUNTS)).not.toBe(null);
    expect(terminalBlock(card("shownCount")).match(SERVER_COUNTS)).toBe(null);
  });

  it("an unavailable-count branch that interpolates a figure fails", () => {
    const withNumber = 't("jobsPage.endUnknownBody", "No more pages", { n: shownCount })';
    const m = withNumber.match(/t\("jobsPage\.endUnknownBody", "(?:[^"\\]|\\.)*"(.)/);
    expect(m![1], "the check would not notice an interpolated count").not.toBe(")");
  });
});
