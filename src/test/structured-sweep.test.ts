/**
 * THE WORK-MODE STATEMENT WAS PARSED CORRECTLY AND COULD NOT REACH ITS ROWS.
 *
 * Measured 2026-08-12: work_mode is set on 29% of served postings. Workday is
 * 306,186 of them — half the board — and its LIST payload carries no work-mode
 * field, so every Workday row is text-inferred or nothing.
 *
 * fetchVendorDetail has parsed Workday's structured `remoteType` since
 * 20260724; the code is right. But the only lane that calls it selects
 *
 *     .eq("source", vendor).is("description", null)
 *
 * and writes through `.is("description", null)` too. Both are correct for
 * descriptions and fatal for everything else: the moment a posting has a
 * description — stored by the on-demand `detail` read, or by a sweep that ran
 * before the remoteType parsing existed — it becomes permanently invisible to
 * the only code that could state its work mode.
 *
 * That is the class these tests guard: not "is the parser right" but "can the
 * parser reach the rows". A correct extractor wired to an unreachable set is
 * indistinguishable, from the outside, from no extractor at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const JB = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
/** Comments stripped. Every assertion below names a string that also appears in
 *  the prose explaining it, so asserting against the raw file would let a
 *  deleted implementation keep passing on its own epitaph. */
const CODE = JB.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MIG = resolve(__dirname, "../../supabase/migrations");

/** The structured-sweep action body, sliced to its own `if` block so a match
 *  cannot come from desc-sweep sitting directly above it. */
const LANE = (() => {
  const at = CODE.indexOf('if (action === "structured-sweep")');
  expect(at, "the structured-sweep action is gone").toBeGreaterThan(-1);
  const end = CODE.indexOf('if (action === "report")', at);
  expect(end, "structured-sweep has no terminator").toBeGreaterThan(at);
  return CODE.slice(at, end);
})();

describe("the recovery lane reaches the rows desc-sweep cannot", () => {
  it("targets rows that ALREADY have a description", () => {
    // The entire point. Rows with a null description are desc-sweep's job and
    // pick up the same structured fields on the way past; the unreachable set
    // is the complement, and selecting it is what this lane is for. An
    // `.is("description", null)` here would rebuild the bug it exists to fix.
    expect(LANE).toMatch(/\.not\("description", "is", null\)/);
    expect(LANE, "the lane re-created the filter that made the rows unreachable")
      .not.toMatch(/\.is\("description", null\)/);
  });

  it("only visits rows with no work mode stored", () => {
    // Sliced to the SELECT chain. A bare `LANE` match passed while the select
    // filter was deleted, because the UPDATE further down carries the same
    // `.is("work_mode", null)` guard and satisfied the regex on its own —
    // caught by mutation, and it is the difference between "walks the gaps" and
    // "walks all 306k Workday rows re-fetching details for nothing".
    const sel = LANE.slice(LANE.indexOf("let sel = client"), LANE.indexOf(".limit(DESC_SWEEP_PER_HOP)"));
    expect(sel.length, "the select chain slice is empty").toBeGreaterThan(60);
    expect(sel, "the lane no longer filters to rows missing a work mode")
      .toMatch(/\.is\("work_mode", null\)/);
  });

  it("seeds an empty cursor to the vendor's own id range", () => {
    // THE BUG THAT KILLED THE FIRST HOP, TWICE.
    //
    // `id` is `source:token:externalId`, so ordering by id orders by vendor
    // first — and every vendor carried sorts BEFORE "workday" (ashby,
    // bamboohr, breezy, greenhouse, icims, lever, oracle, personio, pinpoint,
    // recruitee, rippling, smartrecruiters, teamtailor, workable). An empty
    // cursor started the walk at row one and had to scan ~300,000 rows failing
    // `source = 'workday'` before reaching a single candidate. It timed out
    // every time.
    //
    // The shape is what made it hard to see: every hop AFTER the first would
    // have been fine, because the cursor was by then inside the vendor range.
    // The lane could only fail at hop one, and could never reach hop two.
    expect(LANE).toMatch(/String\(body\.cursor \?\? ""\) \|\| `\$\{sVendor\}:`/);
  });

  it("bounds the walk above with a sentinel that survives the URL", () => {
    // The bound itself is the mirror of the missing-seed defect. But the
    // SENTINEL is the hard-won part: ";" (the theoretically-tight next byte
    // after ":") is truncated in the REST query string — proven live,
    // `id=lt.workday;` matched ZERO rows while `~` matched — so the window
    // came back empty and the pass stamped doneAt over 148,776 untouched
    // rows, twice. "~" sorts above ":" and vendor names are lowercase ASCII,
    // so `{vendor}~` bounds correctly for every vendor. ";" must never come
    // back, however tight it looks.
    expect(LANE).toMatch(/\.lt\("id", `\$\{sVendor\}~`\)/);
    expect(LANE, "the semicolon sentinel is back — it dies in the query string")
      .not.toMatch(/\$\{sVendor\};/);
  });

  it("stamps its progress row BEFORE doing the work", () => {
    // A hop that dies before its end-of-run stamp leaves status all-null, which
    // is indistinguishable from "never kicked" — and the kick itself is
    // fire-and-forget through waitUntil with a `.catch(() => {})`, so a failing
    // action is invisible from both ends at once. That ambiguity cost two
    // deploys. desc-sweep stamps `runningVi` up front for the same reason.
    // Anchored on `running: true`, which only the start-stamp carries.
    // A first version matched `k: "structured_sweep"` and passed while the
    // start-stamp was deleted, because the DONE-stamp (in the vi-exhausted
    // branch above) also matches and also precedes the select — caught by
    // mutation. Two writes to the same meta key need distinguishing by their
    // payload, not by the key they share.
    const stampAt = LANE.indexOf("running: true");
    const selectAt = LANE.indexOf("let sel = client");
    expect(stampAt, "no start-of-hop progress stamp in the lane").toBeGreaterThan(-1);
    expect(selectAt, "the select is gone").toBeGreaterThan(-1);
    expect(stampAt, "the lane stamps only after its work — a dead hop is invisible")
      .toBeLessThan(selectAt);
  });

  it("walks by cursor, because the predicate cannot clear itself", () => {
    // desc-sweep may re-select its gaps every hop: filling one removes it from
    // `description is null`. Here a posting whose detail states no remoteType
    // stays work_mode-null forever, so a re-selecting lane would spend its
    // whole budget re-fetching rows it has already proven have nothing.
    expect(LANE).toMatch(/\.order\("id", \{ ascending: true \}\)/);
    expect(LANE).toMatch(/\.gt\("id", cursor\)/);
  });

  it("advances the cursor on the last SELECTED row, never the last filled", () => {
    // A page where nothing carried a remoteType must still move. Advancing on
    // the last FILLED id would park the walk permanently on the first row that
    // had nothing to give — the keyset form of desc-sweep's `updated === 0`.
    expect(LANE).toMatch(/const nextCursor = sQueue\.length \? sQueue\[sQueue\.length - 1\]\.id : ""/);
  });

  it("is a maintenance action, not an anon-reachable one", () => {
    expect(LANE).toMatch(/body\.chainKey !== await chainKey\(\)/);
    expect(LANE).toMatch(/403/);
  });
});

describe("what the lane writes", () => {
  it("moves `remote` with work_mode, in both writers", () => {
    // Ingest sets remote = (workMode === "remote") and the board's Remote
    // filter reads the boolean, so writing work_mode alone produces a row that
    // says remote and cannot be found by asking for remote. This exact drift
    // was measured before (32/616 design, 43/479 security, 56/790 legal).
    const writers = [...CODE.matchAll(/work_mode = wmVendor|work_mode = workMode|\.work_mode = (?:wmVendor|workMode)/g)];
    expect(writers.length, "no structured work_mode writer found — the regex broke").toBeGreaterThan(0);
    for (const m of [/patch\.work_mode = workMode; patch\.remote = workMode === "remote"/,
                     /salv\.work_mode = wmVendor; salv\.remote = wmVendor === "remote"/]) {
      expect(CODE, `a work_mode writer does not move remote with it: ${m}`).toMatch(m);
    }
  });

  it("fills gaps and never overwrites a stored statement", () => {
    expect(LANE).toMatch(/\.update\(patch\)[\s\S]{0,120}\.is\("work_mode", null\)/);
  });

  it("only fills posted_at when it is missing", () => {
    // This lane's justification is the work mode. A date already stored came
    // from the vendor's own list payload and it has no standing to replace it —
    // the Workday floored-bucket replacement stays desc-sweep's call.
    expect(LANE).toMatch(/if \(postedAt && !row\.posted_at\) patch\.posted_at = postedAt/);
  });

  it("skips the write entirely when the detail stated nothing", () => {
    expect(LANE).toMatch(/if \(!Object\.keys\(patch\)\.length\) continue/);
  });
});

describe("desc-sweep no longer discards structured fields with an empty body", () => {
  /** desc-sweep's PER-POSTING phase only.
   *
   *  Its board-level phase above (workable/pinpoint, whose descriptions arrive
   *  in the list payload) has its own `if (!text) continue` and should keep it:
   *  there `text` comes from a map built off one board fetch, no structured
   *  fields are parsed alongside it, and there is nothing to salvage. Asserting
   *  over the whole action conflated the two and failed on the correct one —
   *  which is the narrowing, not a softening: the per-posting phase is the only
   *  place fetchVendorDetail is called. */
  const SWEEP = (() => {
    const at = CODE.indexOf("const vendor = DETAIL_DESC_SOURCES[vi];");
    expect(at, "the per-posting phase is gone").toBeGreaterThan(-1);
    const end = CODE.indexOf('if (action === "structured-sweep")', at);
    expect(end, "desc-sweep slice has no terminator").toBeGreaterThan(at);
    const slice = CODE.slice(at, end);
    expect(slice, "the slice missed the detail call it exists to check").toContain("fetchVendorDetail");
    return slice;
  })();

  it("salvages a parsed work mode and date rather than dropping the row", () => {
    // The fetch was paid for and the vendor stated both facts; they were
    // discarded because a DIFFERENT field of the same payload came back blank.
    expect(SWEEP, "the bare early-return is back — parsed fields are being dropped")
      .not.toMatch(/if \(!text\) continue;/);
    expect(SWEEP).toMatch(/salv\.work_mode = wmVendor/);
    expect(SWEEP).toMatch(/salv\.posted_at = postedAt/);
  });

  it("applies the work_mode guard ONLY when it writes a work mode", () => {
    // Attaching `.is("work_mode", null)` unconditionally means a row that
    // already has a work mode and is missing a date matches nothing — silently
    // dropping the very date the salvage exists to rescue.
    expect(SWEEP).toMatch(/await \(wmVendor \? q\.is\("work_mode", null\) : q\)/);
  });
});

describe("the lane is observable, and cannot silently do nothing", () => {
  it("publishes filled alongside scanned", () => {
    // A lane that walks its whole corpus filling nothing looks identical to one
    // that never ran. `filled` is the number that distinguishes them, so it is
    // published rather than inferred from coverage moving days later.
    const at = CODE.indexOf("structuredSweep: {");
    expect(at, "structuredSweep is not reported in status").toBeGreaterThan(-1);
    // Sliced to the block's closing "}," not a fixed width — a 700-char
    // window silently dropped ageMin when the id-window fields grew the block,
    // the third fixed-window failure in this repo's test history.
    const blockEnd = CODE.indexOf("\n        },", at);
    expect(blockEnd, "structuredSweep block has no terminator").toBeGreaterThan(at);
    const block = CODE.slice(at, blockEnd);
    for (const k of ["vendor", "cursor", "scanned", "filled", "ageMin", "firstId", "lastId", "pageLen"]) {
      expect(block, `structuredSweep omits ${k}`).toContain(`${k}:`);
    }
  });

  it("resumes from its cursor instead of restarting the walk", () => {
    // desc-sweep re-kicks at vi:0 safely because its predicate is
    // self-clearing. Doing that here would re-fetch every row already proven to
    // state no remoteType, every time.
    expect(CODE).toMatch(/kick\("structured-sweep", \{ vi: 0, cursor: ssCursor \}\)/);
    expect(CODE).toMatch(/const ssCursor = typeof ss\.v\?\.cursor === "string"/);
  });

  it("is kicked BEFORE any branch that returns, or it never runs", () => {
    // THE BUG THIS EXISTS FOR, and it shipped. The kick was originally last in
    // maybeKickMaintenance, after the desc_sweep kick. Two branches in that
    // sequence — the recategorise sweep and backfill-desc — `return` after
    // kicking, so everything below them only runs on cycles where neither
    // fires. Measured live: four status polls over 13 minutes, structuredSweep
    // all-null the whole time while every other chain ran.
    //
    // The function's own header already recorded this: "Track kicks are
    // NON-EXCLUSIVE — kick and fall through, never return", written after the
    // same starvation hit desc-sweep. Adding a track below a `return` repeats
    // it, and the symptom is a lane that looks deployed and does nothing.
    const fnAt = CODE.indexOf("async function maybeKickMaintenance");
    expect(fnAt, "maybeKickMaintenance is gone").toBeGreaterThan(-1);
    const body = CODE.slice(fnAt, CODE.indexOf("\n}", CODE.indexOf("maintenance kick skipped", fnAt)));
    const kickAt = body.indexOf('kick("structured-sweep"');
    expect(kickAt, "the structured-sweep kick is not in maybeKickMaintenance").toBeGreaterThan(-1);
    // The first bare `return;` in the sequence is the starvation boundary:
    // anything after it runs only when no earlier branch has fired.
    const returnAt = body.search(/\n\s*return;/);
    expect(returnAt, "no early return found — the guard's premise is stale").toBeGreaterThan(-1);
    expect(
      kickAt,
      "the structured-sweep kick sits after an early return and will be starved",
    ).toBeLessThan(returnAt);
  });

  it("only lists vendors whose detail actually states a work mode", () => {
    // An entry without a fetchVendorDetail branch setting workMode would walk
    // that vendor's whole corpus fetching details and filling nothing.
    const m = CODE.match(/const STRUCTURED_SWEEP_SOURCES: readonly string\[\] = \[([^\]]*)\]/);
    expect(m, "STRUCTURED_SWEEP_SOURCES is no longer a literal array").toBeTruthy();
    const listed = [...m![1].matchAll(/"([a-z0-9_-]+)"/g)].map((x) => x[1]);
    expect(listed.length).toBeGreaterThan(0);
    // Derived from the source, not pinned: the assertion is that every listed
    // vendor has a branch assigning workMode, so adding one without writing
    // that branch fails here.
    const detailAt = CODE.indexOf("async function fetchVendorDetail");
    const detail = CODE.slice(detailAt, CODE.indexOf("\n}", CODE.indexOf("return { text", detailAt)));
    for (const v of listed) {
      const branch = detail.indexOf(`src.source === "${v}"`);
      expect(branch, `${v} has no branch in fetchVendorDetail`).toBeGreaterThan(-1);
      const next = detail.indexOf("} else if (src.source ===", branch);
      const body = detail.slice(branch, next > -1 ? next : undefined);
      expect(body, `${v} is listed but its branch never assigns workMode`).toMatch(/workMode = /);
    }
  });
});

describe("the work-mode count index carries both serving predicates", () => {
  const sql = (() => {
    const f = readFileSync(resolve(MIG, "20260812160000_the_board_cannot_count_its_own_remote_jobs.sql"), "utf8");
    return f.replace(/^\s*--.*$/gm, "");
  })();

  it("includes missing_since IS NULL in the partial clause", () => {
    // The older index (20260725140000) is (work_mode, effective_posted DESC)
    // WHERE work_mode IS NOT NULL. count_jobs_capped's query also filters
    // missing_since IS NULL, which that index cannot answer — so every
    // candidate row needed a heap fetch and the count timed out on all three
    // work modes (57014, measured against a 1.38s unfiltered control).
    expect(sql).toMatch(/WHERE work_mode IS NOT NULL AND missing_since IS NULL/);
    expect(sql).toMatch(/\(work_mode, effective_posted DESC\)/);
  });

  it("does not hardcode the freshness window into the index predicate", () => {
    // now() is not IMMUTABLE so it cannot appear in an index predicate at all,
    // and a literal date would rot into an index that silently stops covering
    // the window it was built for. The 30 days stays a range scan.
    expect(sql).not.toMatch(/interval '30 days'/);
    expect(sql).not.toMatch(/effective_posted >= '?\d{4}-\d{2}-\d{2}/);
  });

  it("builds CONCURRENTLY, because the table serves reads continuously", () => {
    expect(sql).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  });
});

describe("a finished pass reports itself instead of erasing itself", () => {
  // The first real pass wrote a bare {doneAt} over its own tallies, which made
  // "the eligible set was genuinely small" and "the walk terminated early"
  // indistinguishable from outside — forcing exactly the forensics the status
  // surface exists to prevent.
  it("carries cumulative totals through the chain body", () => {
    expect(CODE).toMatch(/passScanned = Math\.max\(0, Number\(body\.passScanned\) \|\| 0\)/);
    expect(CODE).toMatch(/const cumScanned = passScanned \+ sSeen;/);
    expect(CODE).toMatch(/passScanned: cumScanned, passFilled: cumFilled,/);
  });

  it("the done-stamp keeps the pass's numbers", () => {
    expect(CODE).toMatch(/doneAt: new Date\(\)\.toISOString\(\), scanned: passScanned, filled: passFilled/);
  });

  it("the progress stamp reports the pass, not the hop", () => {
    expect(CODE).toMatch(/scanned: cumScanned, filled: cumFilled, at:/);
  });
});
