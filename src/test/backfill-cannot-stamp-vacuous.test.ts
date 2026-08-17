import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * TWO LANES DISARMED THEMSELVES BY REPORTING SUCCESS FOR WORK THEY NEVER DID.
 *
 * Measured live 2026-08-17. Both are the same failure wearing different
 * clothes, and both were invisible because the stamp they wrote is
 * indistinguishable from the stamp a real pass writes.
 *
 * THE POSTED-DATE BACKFILL. Its draw runs
 *   `source = $1 AND posted_at IS NULL AND id > $2 ORDER BY id LIMIT 500`
 * and the cursor was seeded to "" for every fresh phase. With no id predicate
 * Postgres cannot use the primary key, so the draw took 3.1-3.3s against a ~3s
 * statement timeout and returned 57014 about two times in three. That error was
 * handled as `exhausted = true` — reasonable for greenhouse (99% dated,
 * genuinely near-done), catastrophic for bamboohr (20% dated, 77% of the whole
 * backlog), which was declared finished on hop 1 having scanned zero rows.
 * Control then fell through to an UNCONDITIONAL completion stamp recording
 * `backlogAtSweep: 43,118` — a field documented as the IRREDUCIBLE RESIDUE,
 * meaning rows proven undatable. It was 43,118 rows nothing had read. That
 * number became the floor the +5,000 growth re-arm measures against, so each
 * repeat would raise the bar: a ratchet. Net effect, 4.9 days of doing nothing
 * while the health check went red and the backlog grew to 46,607.
 *
 * THE STRUCTURED SWEEP. Same shape: it reported 154,003 scanned / 0 filled and
 * cheerfully re-walked the same ~154,000 Workday detail fetches every 24 hours,
 * forever, because its cadence never consulted its own output.
 *
 * This file locks the three properties that make those failures impossible to
 * repeat silently. It is source-shape assertion because edge functions are Deno
 * and cannot be imported from vitest's jsdom environment.
 */
const FN = resolve(__dirname, "../../supabase/functions");
const board = readFileSync(resolve(FN, "job-board/index.ts"), "utf8");
const shared = readFileSync(resolve(FN, "_shared/posted-backfill.ts"), "utf8");

/** The backfill handler's body, bounded — never a whole-file regex. */
const backfillBody = (() => {
  const start = board.indexOf('const phase = ["greenhouse", "rippling", "pinpoint"]');
  if (start === -1) return "";
  return board.slice(start, start + 30_000);
})();

describe("the posted-date backfill cannot disarm itself on work it never did", () => {
  it("seeds the draw cursor with the phase prefix, never an empty string", () => {
    // The one-line root cause. `if (cursor) q = q.gt("id", cursor)` means an
    // empty seed disables the id predicate entirely — which is the branch that
    // was firing, and the reason the draw could not use the primary key.
    expect(backfillBody, "backfill handler not found — has the phase list changed?").not.toBe("");
    expect(
      /let cursor = [^;]*: `\$\{phase\}:`;/.test(backfillBody),
      'The draw cursor must seed to `${phase}:`. Seeding "" removes the id ' +
        "predicate, so the query cannot use the primary key and times out " +
        "(measured 3.1-3.3s vs a ~3s statement timeout; 0.23s with the seed).",
    ).toBe(true);
  });

  it("distinguishes a failed draw from an exhausted phase", () => {
    expect(
      backfillBody.includes("drawFailed = true"),
      "A statement timeout on the draw must set drawFailed, not only " +
        "`exhausted`. A phase that could not be READ has proven nothing about " +
        "whether its rows are datable.",
    ).toBe(true);
  });

  it("refuses to write a completion stamp for a vacuous sweep", () => {
    // The specific regression: `{version, sweptAt, backlogAtSweep}` written
    // after scanning zero rows. Leaving `version` unwritten is what keeps
    // postedBackfillDue true so the next kick retries.
    expect(
      /if \(drawFailed \|\| scannedTotal <= 0\)/.test(backfillBody),
      "The completion stamp must be guarded on drawFailed || scannedTotal <= 0",
    ).toBe(true);
    const guardIdx = backfillBody.indexOf("if (drawFailed || scannedTotal <= 0)");
    const stampIdx = backfillBody.indexOf("version: POSTED_BACKFILL_VERSION, sweptAt:");
    expect(guardIdx, "guard not found").toBeGreaterThan(-1);
    expect(stampIdx, "completion stamp not found").toBeGreaterThan(-1);
    expect(
      guardIdx < stampIdx,
      "The vacuous-sweep guard must come BEFORE the completion stamp, or it " +
        "cannot prevent it. This is the 'guard below an early return' shape.",
    ).toBe(true);
  });

  it("keeps the version and the vendor list moving together", () => {
    // pinpoint joined POSTED_BACKFILL_VENDORS in the same change that bumped to
    // v7. Adding a vendor without a bump leaves its rows unswept until the
    // seven-day timer, which is how a vendor sits at 0% unnoticed.
    expect(shared.includes('"pinpoint"'), "pinpoint must be in POSTED_BACKFILL_VENDORS").toBe(true);
    const m = /POSTED_BACKFILL_VERSION = (\d+)/.exec(shared);
    expect(m, "POSTED_BACKFILL_VERSION not found").toBeTruthy();
    expect(
      Number(m![1]),
      "Adding a vendor to POSTED_BACKFILL_VENDORS requires bumping " +
        "POSTED_BACKFILL_VERSION — it is the only mechanism that re-arms the sweep.",
    ).toBeGreaterThanOrEqual(7);
    // And the backfill must actually have a branch for it, or the phase drains
    // instantly and reports success.
    expect(
      board.includes('phase === "pinpoint"'),
      "pinpoint is in the vendor list but has no dating branch — the phase " +
        "would drain immediately and stamp itself complete.",
    ).toBe(true);
  });
});

describe("the structured sweep backs off when it writes nothing", () => {
  it("counts rows written, not updates attempted", () => {
    // PostgREST returns no error when an update matches zero rows, so
    // `if (!error) sFilled++` counted attempts. Without this you cannot tell
    // "wrote 6,700 rows" from "matched nothing 6,700 times" — the exact
    // ambiguity that left 154,003 scanned / 0 filled unexplained.
    expect(
      /sFilled \+= \(wrote\?\.length \?\? 0\)/.test(board),
      "structured-sweep must increment `filled` by the rows the update " +
        "returned (add .select(\"id\") to the chain), never on absence of error.",
    ).toBe(true);
  });

  it("stretches its cadence after consecutive zero-write passes", () => {
    expect(
      board.includes("zeroFilledPasses"),
      "The 24h re-kick must consult the previous pass's output. A cadence that " +
        "ignores its own result re-issued ~154,000 vendor fetches daily to " +
        "write nothing.",
    ).toBe(true);
    expect(
      /ssBackoffH|ssBackedOff/.test(board),
      "expected a backoff derived from zeroFilledPasses",
    ).toBe(true);
  });

  it("classifies the work-mode labels vendors actually publish", () => {
    // remoteType is TENANT-AUTHORED FREE TEXT, not a Workday enum. The old
    // five-substring test matched 0 of 154 sampled live postings; every
    // observed value was an onsite label it had never heard of ("In-Person
    // Working", "Campus based", "Fully on premise", "Field Based").
    for (const label of ["in[-\\s]?person", "on[-\\s]?campus", "field[-\\s]?based", "on[-\\s]?premise"]) {
      expect(
        board.includes(label),
        `the work-mode classifier must recognise /${label}/ — it is a real ` +
          `observed Workday remoteType value`,
      ).toBe(true);
    }
    // Order matters: "Hybrid: Remote and Office" is hybrid, not remote.
    const hy = board.indexOf("/hybrid|hybride|flex/");
    const re = board.indexOf("/remote|work from home|wfh|telework");
    expect(hy, "hybrid test not found").toBeGreaterThan(-1);
    expect(re, "remote test not found").toBeGreaterThan(-1);
    expect(
      hy < re,
      "hybrid must be tested BEFORE remote — a label containing both words is " +
        "hybrid, and testing remote first silently mislabels every one.",
    ).toBe(true);
  });
});
