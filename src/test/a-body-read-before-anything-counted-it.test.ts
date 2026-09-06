import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE ONLY VOLUME GUARD THIS FUNCTION HAD FIRED AFTER THE ALLOCATION IT WAS
 * MEANT TO PREVENT.
 *
 * job-board dies on WORKER_RESOURCE_LIMIT (HTTP 546) against a ~256MB isolate
 * ceiling. A slice that dies loses its bookkeeping AND stops the chain, so a
 * 10-minute cron tick produced one slice instead of a ~17-hop chain, and board
 * freshness sat at a p50 of ~59 hours against a 6.7-hour baseline.
 *
 * Five sizing knobs — posting budget, board count, concurrency, wall clock,
 * heap ceiling — were each measured on BOTH sides and each read as refuted. A
 * sixth model, heap linear in postings fetched, was fitted and died on its own
 * samples:
 *
 *     heap  41MB  fetched 1,184  boards 23   (clearwaygroup)
 *     heap 101MB  fetched 1,088  boards 22   (mchapusa~wd5)
 *     heap 190MB  fetched 1,010  boards 23   (medcan~wd10, 23 rows STORED)
 *
 * More postings at a quarter of the heap; and a board that stored twenty-three
 * rows while heap read 190MB, so the 190MB was not that board's data. The
 * breadcrumb names the board that just FINISHED, so a heap reading is the SUM
 * of what all workers hold, dominated by the largest response in flight. The
 * memory was whole HTTP response bodies, and NOTHING BOUNDED THEM:
 *
 *   - MAX_POSTINGS_PER_VISIT binds only CAPPED_VISIT_VENDORS — five of twenty.
 *     Fifteen vendors fetched an entire board in one request.
 *   - greenhouse asked with ?content=true, inlining every description.
 *   - there was no byte cap anywhere: 35 res.text()/res.json() calls, zero size
 *     checks, and fetchWithTimeout had a TIME budget and no BYTE budget.
 *   - AUTO_LIGHT_THRESHOLD_CHARS covered two vendors AND measured contentChars
 *     AFTER the body was parsed, so it could only ever protect the NEXT pass,
 *     never the one that killed the isolate. Too late BY CONSTRUCTION.
 *
 * So this guard states the PROPERTY, not a spelling: no body is read without a
 * byte bound. It ENUMERATES the read sites out of the source rather than
 * listing them by hand, so a body read added later fails here instead of
 * shipping — that enumeration is the whole point, because the previous guard
 * of this class was a threshold constant that a fifteen-vendor blind spot
 * walked straight past.
 *
 * And it asserts CODE against comment-stripped source and prose against raw
 * source. This repo has been bitten seven times by a guard passing on a
 * comment while the code underneath it was dead.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
/**
 * Comment-stripped source, with two traps this file has already sprung avoided.
 *
 * LINE comments go first: index.ts carries a line comment naming `../_shared/*`,
 * and a block-first strip treats that `/*` as an opening delimiter and runs to
 * the next `*` + `/` hundreds of lines away, silently deleting real code — the
 * guard then passes because the thing it was checking is no longer there.
 *
 * And a line comment is only a line comment when its `//` is NOT preceded by a
 * colon or a word character. A naive `//` strip eats every `https://…` in this
 * file from the scheme onwards, which is exactly how the first draft of this
 * guard concluded that listUrl had no light-mode branches at all.
 */
const CODE = RAW.replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
const CODE_LINES = CODE.split("\n");
/** RAW with comment wrapping collapsed, so a prose assertion survives a re-wrap. */
const PROSE = RAW.replace(/\n\s*\*?[ \t]*/g, " ");
const num = (n: string) => Number(CODE.match(new RegExp(`const ${n} = ([0-9_]+)`))![1].replace(/_/g, ""));
/** The two call forms that install a byte bound. Nothing else may feed a read. */
const BOUNDED = ["fetchWithTimeout(", "boundBody("];

/**
 * Every `.json()` / `.text()` in the module, with the receiver it is read from.
 * Derived, never listed: the point of this guard is that a read site nobody
 * thought to add to a list still gets checked.
 */
const readSites = (() => {
  const out: Array<{ line: number; receiver: string; text: string }> = [];
  const re = /(\)|[A-Za-z_$][\w$]*)\s*\.(?:json|text)\(\)/g;
  CODE_LINES.forEach((ln, i) => {
    for (const m of ln.matchAll(re)) {
      out.push({ line: i + 1, receiver: m[1], text: ln.trim().slice(0, 120) });
    }
  });
  return out;
})();

/**
 * Can this file prove the receiver of a read carries a byte bound?
 *
 * Either the receiver expression installs one itself — `boundBody(res, …).json()`
 * — or the nearest preceding binding of that identifier came from a bounded
 * fetch. Deliberately a source-level proof: a runtime assertion would only fire
 * on the boards that happen to be big, which is exactly the shape of bug that
 * shipped.
 */
const isBounded = (site: { line: number; receiver: string }): boolean => {
  const ln = CODE_LINES[site.line - 1];
  const at = ln.indexOf(`${site.receiver}.`, 0);
  if (site.receiver === ")") {
    // An inline expression: `boundBody(req, N).json()`. The installer must be
    // in the expression itself.
    const idx = ln.search(/\)\s*\.(?:json|text)\(\)/);
    return BOUNDED.some((b) => ln.slice(Math.max(0, idx - 160), idx).includes(b));
  }
  const bind = new RegExp(
    `(?:const|let|var)\\s+${site.receiver}\\s*=|(?<![\\w$.])${site.receiver}\\s*=[^=]`,
  );
  for (let j = site.line - 1; j >= 0 && j > site.line - 62; j--) {
    const seg = j === site.line - 1 ? ln.slice(0, at < 0 ? ln.length : at) : CODE_LINES[j];
    if (bind.test(seg)) return BOUNDED.some((b) => seg.includes(b));
  }
  return false;
};

describe("a body read before anything counted it", () => {
  it("finds every body read in the module, and there are many", () => {
    // If this collapses to a handful, the enumeration broke and every
    // assertion below became vacuous — the failure mode of a derived guard.
    expect(readSites.length).toBeGreaterThan(30);
  });

  it("NO BODY IS READ WITHOUT A BYTE BOUND — every enumerated read site", () => {
    const unbounded = readSites.filter((s) => !isBounded(s));
    expect(
      unbounded.map((s) => `  line ${s.line}: ${s.text}`).join("\n"),
      "these bodies are read with nothing bounding their size — route the fetch through fetchWithTimeout, or wrap the response in boundBody(res, <budget>) before reading it",
    ).toBe("");
  });

  it("the bound is installed by fetchWithTimeout on BOTH of its exits", () => {
    // The 429 retry is a second exit and it was the easy one to miss: a
    // rate-limited giant would have come back completely unbounded.
    const i = CODE.indexOf("async function fetchWithTimeout(");
    const body = CODE.slice(i, CODE.indexOf("\n}", i));
    expect(body, "fetchWithTimeout not found").not.toBe("");
    expect(body).toMatch(/return boundBody\(await once\(\), limit\);/);
    expect(body).toMatch(/return boundBody\(res, limit\);/);
    expect(body, "the 429 body is never read — release it instead of leaving it hanging")
      .toMatch(/discardBody\(res\);/);
    expect(body, "a raw `return res` would leak an unbounded response out of the wrapper")
      .not.toMatch(/return res;/);
  });

  it("the bound acts BEFORE the body is read — header first, then a counting stream", () => {
    const i = CODE.indexOf("function boundBody(");
    const body = CODE.slice(i, CODE.indexOf("\nasync function fetchWithTimeout", i));
    expect(body, "boundBody not found").not.toBe("");
    // 1. The cheap path: refuse on a declared length, before a byte moves.
    expect(body).toMatch(/src\.headers\.get\("content-length"\)/);
    expect(body).toMatch(/declared > limit/);
    // 2. The path that actually holds: Content-Length is absent on chunked
    //    responses and can lie, so a running total decides.
    expect(body, "a header check alone cannot bound a chunked response").toMatch(/new TransformStream</);
    expect(body).toMatch(/seen \+= chunk\.byteLength;/);
    expect(body).toMatch(/if \(seen > limit\)/);
    expect(body, "over budget must ERROR the stream, which cancels the source body")
      .toMatch(/ctrl\.error\(/);
    // 3. Bounded, not buffered. A reader that pushed chunks onto an array
    //    would reintroduce exactly the allocation this exists to prevent.
    expect(body, "the bounded reader must not accumulate the body it is bounding")
      .not.toMatch(/chunks\.push|\.concat\(|new Uint8Array\(/);
  });

  /**
   * PEAK CONCURRENT BODIES = PEAK WORKERS x BODIES READ AT ONCE PER WORKER.
   *
   * A per-RESPONSE budget only bounds memory if you know how many responses
   * are live at once, and the first draft of this arithmetic got BOTH factors
   * wrong: it divided by CONCURRENCY and stopped. Five vendors page a board in
   * a concurrent CHUNK (icims 5 wide, ukg/adp/workday/oracle 4), so a worker
   * held a whole chunk of parsed pages — 4 x 5 x 4MB = 80MB of wire, ~480MB
   * parsed, from a bound whose comment claimed 96MB. And effConcurrency could
   * be 5, not 4. Both factors are re-derived from source here.
   */
  const peakWorkers = (() => {
    const conc = num("CONCURRENCY");
    const hot = num("HOT_CONCURRENCY");
    // The shed table may only ever HOLD or REDUCE the worker count. It read
    // `shedLevel === 1 ? 5` — a cut when CONCURRENCY was 8, a 25% raise after
    // the cut to 4, on the signal that means the database is struggling.
    const eff = CODE.match(/const effConcurrency = ([^;]+);/)![1];
    const clamped = /^Math\.min\(CONCURRENCY,/.test(eff.trim());
    const literals = [...eff.matchAll(/\?\s*(\d+)/g)].map((m) => Number(m[1]));
    return { conc, hot, eff, clamped, literals, peak: Math.max(conc, hot) };
  })();

  it("the shed table can never raise the worker count the budget is divided by", () => {
    expect(
      peakWorkers.clamped,
      `effConcurrency must be clamped to CONCURRENCY — it reads: ${peakWorkers.eff}`,
    ).toBe(true);
    // Belt and braces: even unclamped, no literal in that table may exceed the
    // baseline the arithmetic below is built on.
    for (const n of peakWorkers.literals) {
      expect(n, `shed level worker count ${n} exceeds CONCURRENCY=${peakWorkers.conc}`).toBeLessThanOrEqual(peakWorkers.conc);
    }
  });

  it("NO FETCHER PARSES A CHUNK OF PAGES CONCURRENTLY — that is the second factor", () => {
    // Derived from the idiom, not from a list of vendors: every
    // `Promise.all(pages.map(…))` in the module must hand back RESPONSES, not
    // parsed bodies. A vendor added later that parses inside the map puts a
    // whole chunk back in memory and fails here.
    const chunks: string[] = [];
    let at = CODE.indexOf("Promise.all(pages.map(");
    while (at >= 0) {
      const open = CODE.indexOf("(", at + "Promise.all".length);
      let depth = 0, end = open;
      for (let i = open; i < CODE.length; i++) {
        if (CODE[i] === "(") depth++;
        else if (CODE[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
      }
      chunks.push(CODE.slice(at, end + 1));
      at = CODE.indexOf("Promise.all(pages.map(", end);
    }
    // ukg, adp, workday, oracle, icims. If this collapses the enumeration
    // broke and the assertion below is vacuous.
    expect(chunks.length, "the chunked fetchers went missing from the enumeration").toBeGreaterThanOrEqual(5);
    const parsing = chunks.filter((c) => /\.(?:json|text)\(\)/.test(c));
    expect(
      parsing.map((c) => `  ${c.slice(0, 100).replace(/\s+/g, " ")}…`).join("\n"),
      "a chunk that parses inside Promise.all holds every page of that chunk at once — fetch concurrently, read the bodies one at a time",
    ).toBe("");
    // And the pages that were fetched but never read must be released.
    expect(
      (CODE.match(/discardRest\(responses, read\)/g) ?? []).length,
      "every chunked fetcher must release the tail of a chunk it stopped reading",
    ).toBeGreaterThanOrEqual(5);
    // A PAGE REFUSED ON ITS DECLARED LENGTH NEVER REACHES THE READ LOOP.
    //
    // Found by running this walk against a local server: boundBody's
    // Content-Length check throws inside the concurrent fetch, so the chunk's
    // Promise.all rejects and a board whose FOURTH page is too big loses the
    // three pages that landed and defers whole — the read-loop's careful
    // "mid-walk oversize is a window" branch is unreachable on the one path
    // where the size is known in advance. Every chunk fetch must route its
    // refusal through the same decision.
    expect(
      (CODE.match(/chunkPageRefusal\(e, page === /g) ?? []).length,
      "a chunk page refused before it is read must end the walk mid-way and defer only on the first page",
    ).toBeGreaterThanOrEqual(5);
    const cr = CODE.indexOf("function chunkPageRefusal(");
    const refusal = CODE.slice(cr, CODE.indexOf("\n}", cr));
    expect(refusal).toMatch(/if \(!isFirstPage && isOversize\(e\)\) return null;/);
    expect(refusal, "anything that is not the byte bound must still propagate").toMatch(/throw e;/);
  });

  it("the budget comes from arithmetic that keeps PEAK WORKERS x ONE body under the ceiling", () => {
    const budget = num("MAX_RESPONSE_BYTES");
    const CEILING_MB = 256; // WORKER_RESOURCE_LIMIT, HTTP 546
    const AMPLIFICATION = 6; // JSON wire bytes -> JS objects: UTF-16 + per-key overhead
    const BODIES_PER_WORKER = 1; // proven by the chunk test above, not assumed
    const ALLOTMENT_MB = 128; // ceiling - ~64MB baseline - ~64MB reserve
    const peakMb = (peakWorkers.peak * BODIES_PER_WORKER * budget * AMPLIFICATION) / 1e6;
    expect(
      peakMb,
      `every worker at the per-response ceiling at once (${peakWorkers.peak} workers) must fit the in-flight allotment`,
    ).toBeLessThanOrEqual(ALLOTMENT_MB);
    expect(
      peakMb,
      "and must still leave the isolate room for the slice it is building",
    ).toBeLessThan(CEILING_MB / 2);
    // Pinned from below too: a budget small enough to defer ordinary boards
    // would trade an outage for a silently thinning catalog. Measured p90 by
    // vendor is 36KB-936KB, so this is two orders of magnitude clear of them.
    expect(budget, "a budget this small would defer healthy boards forever").toBeGreaterThan(1_000_000);
  });

  it("over budget DEFERS the board, and a deferred board is not a failed one", () => {
    // The catalog is the product. An oversize response means the vendor
    // answered us and the answer was too big — not that the board is gone, so
    // it must not feed `failed`, the failure streak, or the dormancy prune.
    expect(CODE).toMatch(/const OVERSIZE_MARKER = "OVERSIZE_BODY";/);
    expect(CODE, "the classifier must give oversize its own verdict")
      .toMatch(/\? `oversize \$\{\(Number\(over\[1\]\) \/ 1e6\)\.toFixed\(1\)\}MB`/);
    const i = CODE.indexOf("if (!r) {");
    const block = CODE.slice(i, CODE.indexOf("failed.push(", i));
    expect(block, "the oversize branch must come BEFORE failed.push, or it never runs")
      .toMatch(/if \(failReason\.startsWith\("oversize"\)\) \{/);
    expect(block, "deferral rides the existing budget-deferral channel").toMatch(/budgetSkipped\.push\(s\.token\);/);
    expect(block, "an oversize board must be NAMED, or a permanently oversize feed vanishes silently")
      .toMatch(/oversized\.push\(s\.token\);/);
    expect(block, "an oversize board must never be recorded as a vendor failure").not.toMatch(/failed\.push/);
    // The existing guard's property, restated where the new branch can break
    // it: budget-deferred tokens are excluded from failure accounting.
    expect(CODE).toMatch(/const budgetSkippedSet = new Set\(budgetSkipped\);/);
  });

  it("a light-capable vendor ENROLS rather than being deferred forever", () => {
    const i = CODE.indexOf('if (failReason.startsWith("oversize"))');
    const block = CODE.slice(i, i + 1400);
    expect(block).toMatch(/LIGHT_CAPABLE_VENDORS\.has\(s\.source\) && !isLight\(s\.token\)/);
    expect(block).toMatch(/await enrolDynamicLight\(client, s\.token,/);
    // AND IT GETS ITS SLOT BACK. Every other budget deferral `continue`s
    // before `baseAttempted++`, so its board is re-offered on the next slice;
    // this branch sits after that line. Left alone, a board enrolled for a
    // light re-fetch that would succeed immediately waits a full cold rotation
    // — 6.7h at baseline, ~59h at the p50 this whole change exists to fix.
    // Returned only where the next attempt would DIFFER: a board with no light
    // form would abort identically, so re-offering it every slice would burn a
    // board slot and a 4MB transfer per pass, forever.
    expect(
      block.slice(block.indexOf("enrolDynamicLight")),
      "an enrolled board must not wait a whole rotation for the light fetch",
    ).toMatch(/baseTokens\.has\(s\.token\) && baseAttempted > 0\) baseAttempted--/);
    // Reuse of the machinery that already exists, not a second copy of it:
    // the enrolment must persist through the same meta row the auto-light
    // measurement writes, or a restart forgets every enrolment.
    const h = CODE.indexOf("async function enrolDynamicLight(");
    const helper = CODE.slice(h, CODE.indexOf("\n}", h));
    expect(helper, "enrolDynamicLight not found").not.toBe("");
    expect(helper).toMatch(/DYNAMIC_LIGHT\.add\(token\);/);
    expect(helper).toMatch(/k: "light_desc_dynamic"/);
    expect(helper).toMatch(/tokens: \[\.\.\.DYNAMIC_LIGHT\]\.slice\(-AUTO_LIGHT_CAP\)/);
  });

  it("LIGHT_CAPABLE_VENDORS names only vendors that have a light form AND a way back to the descriptions", () => {
    // Derived from listUrl and from the fillers, never transcribed. TWO
    // conditions, because the first draft satisfied only the first and that
    // was a data-loss bug wearing a deferral's clothes:
    //
    //  1. A light form in listUrl — or enrolment changes nothing and the board
    //     comes back oversize forever while the log claims it was handled.
    //  2. A filler that still works while the board is light. workable has a
    //     light form (details=false) and NO filler: backfill-desc selects
    //     greenhouse only, and workable is absent from DETAIL_DESC_SOURCES, so
    //     its one lane is desc-sweep's board lane — which calls fetchBoard and
    //     therefore re-fetches through listUrl in the very mode that omits the
    //     descriptions. Enrolling workable does not defer its descriptions, it
    //     deletes them: every posting ingests description-null, permanently,
    //     scoring null in fit-batch and invisible to the description tier,
    //     while the sweep reports the board handled with filled:0.
    const i = CODE.indexOf("const listUrl = (s: JobSource");
    const listUrl = CODE.slice(i, CODE.indexOf("const SR_PAGE", i));
    expect(listUrl, "listUrl not found").not.toBe("");
    const marks = [...listUrl.matchAll(/s\.source === "([a-z]+)"/g)];
    const withLight = marks
      .filter((m, k) => {
        const start = m.index!;
        const end = k + 1 < marks.length ? marks[k + 1].index! : listUrl.length;
        return listUrl.slice(start, end).includes("isLight(");
      })
      .map((m) => m[1])
      .sort();
    expect(withLight.length, "listUrl lost its light branches — the deferral path now has no escape").toBeGreaterThan(0);

    // The fillers, derived: the per-JOB backfill lane's own vendor filter,
    // plus the per-posting detail sweep's vendor list.
    const bfLine = CODE_LINES.find((ln) => ln.includes("JOB_SOURCES.filter(") && ln.includes("isLight(") && ln.includes("s.source ==="))!;
    expect(bfLine, "backfill-desc's vendor filter not found").toBeTruthy();
    const backfillVendors = (bfLine.match(/"([a-z]+)"/g) ?? []).map((q) => q.replace(/"/g, ""));
    const DESCS = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/descriptions.ts"), "utf8");
    const detailVendors = (DESCS.match(/export const DETAIL_DESC_SOURCES = \[([^\]]*)\]/)![1].match(/"([a-z]+)"/g) ?? [])
      .map((q) => q.replace(/"/g, ""));
    const fillable = new Set([...backfillVendors, ...detailVendors]);

    const declared = [...CODE.matchAll(/const LIGHT_CAPABLE_VENDORS = new Set\(\[([^\]]*)\]\)/g)][0][1]
      .match(/"([a-z]+)"/g)!
      .map((q) => q.replace(/"/g, ""))
      .sort();
    expect(declared.length, "with no light-capable vendor at all the enrolment branch is dead code").toBeGreaterThan(0);
    expect(
      declared.filter((v) => !withLight.includes(v)),
      "these vendors have no light form in listUrl, so enrolling them is a no-op",
    ).toEqual([]);
    expect(
      declared.filter((v) => !fillable.has(v)),
      "these vendors have a light form but NO description filler that works while light — enrolling them deletes descriptions instead of deferring them",
    ).toEqual([]);
  });

  it("a permanently oversize board stays NAMEABLE, and is never logged as a closure", () => {
    // The catalog is the product, and the fifteen vendors with no light form
    // fetch a whole board in one request — so an over-budget board there is
    // deferred on EVERY pass with nothing about the next pass differing.
    // Deferral deliberately keeps it out of failedTokens, the failure streak,
    // job_board_board_state and the dormancy classifier (it did not fail),
    // which is exactly what makes it invisible. Measured live 2026-09-06:
    // ashby openai 13.6MB, recruitee livezoku 15.0MB, lever veeva 12.8MB —
    // ~1% of light-incapable boards, and they are the largest employers here.
    expect(CODE, "the registry must ACCUMULATE — slice_stats is one row overwritten every ten minutes")
      .toMatch(/const OVERSIZE_BOARDS = new Map</);
    expect(CODE).toMatch(/k: "oversize_boards"/);
    expect(CODE, "loaded in the invocation that runs the sweep, or the sweep cannot consult it")
      .toMatch(/await loadOversizeBoards\(client\);/);
    const i = CODE.indexOf('if (failReason.startsWith("oversize"))');
    const block = CODE.slice(i, i + 1400);
    expect(block, "an oversize board must be recorded where it survives the next slice").toMatch(/OVERSIZE_BOARDS\.set\(s\.token,/);
    // THE CLOSURE LOG IS THE ONE UNCOPYABLE ASSET HERE. A board we are too
    // small to READ has not closed: its postings age past the 30-day window
    // unverified and are dropped, but writing them into the exit ledger would
    // record ~90 boards' worth of live roles as ordinary expirations,
    // indistinguishable from real ones forever after.
    const s = CODE.indexOf("const oversizeHeld = agedRows.filter(");
    expect(s, "the freshness sweep no longer looks at the oversize registry at all").toBeGreaterThan(0);
    const sweep = CODE.slice(s, CODE.indexOf('"freshness-sweep"', s) + 40);
    expect(sweep, "the freshness sweep must exclude oversize boards from the ledger").toMatch(
      /OVERSIZE_BOARDS\.has\(String\(r\.company_token\)\)/,
    );
    // The exclusion rides the one set the ledger line already consults, so
    // there is exactly one filter in front of the exit ledger and the guards
    // that pin that line (a-posting-that-aged-out-must-not-walk-back-in,
    // a-table-nothing-reads-yet-is-still-load-bearing) keep reading the
    // property they were written for.
    expect(sweep, "the suppressed ids must actually reach the set the ledger line filters on").toMatch(
      /for \(const r of oversizeHeld\) alreadyTombstoned\.add\(String\(r\.id\)\);/,
    );
    expect(sweep).toMatch(/const freshlyDead = agedRows\.filter\(\(r\) => !alreadyTombstoned\.has\(String\(r\.id\)\)\);/);
    expect(sweep, "a suppressed ledger write must be counted out loud, not silently").toMatch(/console\.warn/);
    // The deletion itself is NOT suppressed: a posting nobody has verified in
    // 30 days is not servable whatever the reason. Only the claim that it
    // CLOSED is withdrawn.
    expect(CODE, "the sweep must still delete what it stops serving").toMatch(/from\("job_board_postings"\)\.delete\(\)\.in\("id", ids\.slice/);
  });

  it("nothing between the bound and the classifier may swallow the OVERSIZE marker", () => {
    // A swallowed marker is not a cosmetic loss: fetchBoard's classifier reads
    // message text, so an absorbed OVERSIZE becomes "payload shape
    // unrecognized" or "feed unavailable", which is a VENDOR FAILURE — a
    // failure streak, and at DEAD_BOARD_THRESHOLD the dormancy prune deleting
    // every posting on a live employer and writing a whole-board exit into the
    // closure log. A board being large must never spell itself as dead.
    expect(
      CODE,
      "`.json().catch(() => undefined)` turns an oversize abort into a shape failure — route it through readChunkPage",
    ).not.toMatch(/\.json\(\)\.catch\(\(\) => undefined\)/);
    const r = CODE.indexOf("async function readChunkPage(");
    const helper = CODE.slice(r, CODE.indexOf("\n}", r));
    expect(helper, "readChunkPage not found").not.toBe("");
    expect(helper).toMatch(/isOversize\(e\)\) return \{ body: undefined, over: true \}/);
    expect(CODE).toMatch(/const isOversize = \(e: unknown\) => String\(\(e as Error\)\?\.message \?\? e\)\.includes\(OVERSIZE_MARKER\)/);
    const p = CODE.indexOf("async function fetchPersonio(");
    const personio = CODE.slice(p, CODE.indexOf("\n}", CODE.indexOf("personio feed unavailable", p)));
    expect(
      personio,
      "personio tried the OTHER host on an oversize body and then reported the feed unavailable",
    ).toMatch(/includes\(OVERSIZE_MARKER\)\) throw e;/);
  });

  it("an inbound body over the limit is 413, not 'Invalid JSON'", () => {
    // Telling a caller their well-formed 3MB body is malformed sends them to
    // debug their serializer, and nothing records that a size limit was the
    // reason.
    const i = CODE.indexOf("boundBody(req, MAX_REQUEST_BYTES)");
    const block = CODE.slice(i, i + 600);
    expect(block).toMatch(/includes\(OVERSIZE_MARKER\)/);
    expect(block).toMatch(/}, 413\)/);
    expect(block, "everything that is genuinely malformed still answers 400").toMatch(/"Invalid JSON" }, 400\)/);
  });

  it("the too-late guard is still named as such, so nobody restores it as the answer", () => {
    // PROSE, against RAW. The reasoning is the artifact worth keeping: the
    // next person to look at this must not re-derive AUTO_LIGHT_THRESHOLD_CHARS
    // as the volume guard, because it measures after the parse.
    expect(PROSE).toMatch(/AFTER the body is parsed/);
    expect(PROSE).toMatch(/BY CONSTRUCTION|by construction/);
    // And the arithmetic must be shown, not just the constant.
    const i = PROSE.indexOf("THE ARITHMETIC.");
    expect(i, "the byte budget must show its arithmetic in a comment").toBeGreaterThan(0);
    const arith = PROSE.slice(i, i + 3600);
    expect(arith).toMatch(/CONCURRENCY/);
    expect(arith).toMatch(/amplification/);
    expect(arith).toMatch(/256MB/);
    // BOTH denominators, named. The version that divided by CONCURRENCY alone
    // certified 96MB while permitting 480MB, because a chunked vendor holds
    // several bodies per worker — the arithmetic must say so or the next
    // person re-derives the same wrong number.
    expect(arith, "the arithmetic must name the per-worker fan-out, not just the worker count")
      .toMatch(/BODIES READ AT ONCE PER WORKER/);
    // And it must be calibrated against requests this code actually issues.
    // stripe/zscaler are LIGHT_DESC_TOKENS: listUrl has not sent them
    // ?content=true in months, so their 3.9MB/4.9MB content measurements
    // describe a request shape that no longer exists.
    expect(arith, "the budget must be anchored on measured requests the code still makes")
      .toMatch(/no longer issued|no longer exists/);
  });

  it("the discards are discards, not reads — a bound of zero", () => {
    // The chain kicks used to call .text() purely to drain the socket, which
    // is an allocation this function cannot afford and, worse, a body read
    // with nothing bounding it. Cancelling releases the connection and
    // allocates nothing.
    expect(CODE, "a fire-and-forget kick must not read the body it throws away")
      .not.toMatch(/\.then\(\(rr?\) => rr?\.text\(\)\)/);
    const h = CODE.indexOf("function discardBody(");
    const helper = CODE.slice(h, CODE.indexOf("\n}", h));
    expect(helper, "discardBody not found").not.toBe("");
    expect(helper).toMatch(/\.body\?\.cancel\(\)/);
  });
});
