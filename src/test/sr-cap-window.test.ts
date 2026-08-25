/**
 * THE SMARTRECRUITERS CAP, AND WHY 2,000 IS A MEASUREMENT RATHER THAN A GUESS.
 *
 * The raw numbers looked like a disaster: 11 SR boards pinned at ~800 live rows
 * against 31,531 advertised, so 22,617 postings "missing", plus Domino's at
 * 800 of 24,566. That framing is wrong, and the correction is the whole reason
 * this file exists.
 *
 * The SR feed is ordered NEWEST FIRST — measured on AECOM, 2026-08-10:
 *
 *     offset     0  ->  2026-08-10   (today)
 *     offset   800  ->  2026-07-31   (10 days — where the old cap cut)
 *     offset  2000  ->  2026-07-07   (34 days — already past the serving window)
 *     offset  4000  ->  2026-04-28
 *
 * So the cap never dropped random postings; it cut the tail, and most of that
 * tail is older than the board's own 30-day rule and would be filtered out
 * anyway. What it really cost was the part of the WINDOW it could not reach.
 * Binary-searching each feed for the 30-day crossover:
 *
 *     AECOM      1,793 inside 30 days   ->  800 covered 44%
 *     Bosch      1,815 inside 30 days   ->  800 covered 44%
 *     Domino's  >6,000 inside 30 days   ->  800 covered <13%
 *
 * 2,000 covers ten of the eleven capped boards in full and triples the giants,
 * while staying inside a request budget this file already runs in production
 * for Oracle (100 x 20). Uncapping instead would cost 246 sequential requests
 * for Domino's alone, every pass, inside a slice that handles 80 boards.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

const num = (name: string) => {
  const m = new RegExp(`const ${name} = (\\d+)`).exec(SRC);
  expect(m, `${name} not found`).toBeTruthy();
  return Number(m![1]);
};

describe("the cap is sized to the serving window, not to infinity", () => {
  it("is the page size times the page cap — a request budget, not a magic number", () => {
    expect(SRC).toMatch(/const SR_CAP = SR_PAGE \* SR_PAGE_CAP;/);
    expect(num("SR_PAGE") * num("SR_PAGE_CAP")).toBe(2000);
  });

  it("matches Oracle's proven per-pass budget in this same file", () => {
    // Oracle runs 100 x 20 here already. Borrowing a budget that is known to
    // fit a slice beats inventing one.
    expect(num("ORACLE_PAGE_SIZE") * num("ORACLE_PAGE_CAP")).toBe(num("SR_PAGE") * num("SR_PAGE_CAP"));
  });

  it("covers the boards whose 30-day window was measured", () => {
    // AECOM 1,793 and Bosch 1,815 both fit under the cap; if someone lowers it
    // below ~1,850 those boards silently go partial again.
    expect(num("SR_PAGE") * num("SR_PAGE_CAP")).toBeGreaterThanOrEqual(1850);
  });

  it("still bounds one board's fetch — the constraint the cap exists for", () => {
    // Uncapped, Domino's is 246 sequential requests per pass.
    expect(num("SR_PAGE_CAP")).toBeLessThanOrEqual(25);
  });
});

describe("truncation is reported, not inferred", () => {
  const fetcher = SRC.slice(
    SRC.indexOf("async function fetchSmartRecruiters"),
    SRC.indexOf("async function fetchBoard"),
  );

  it("keeps the vendor's advertised total UNCLAMPED", () => {
    // Clamping feedTotal to the cap would publish our own ceiling as though it
    // were the company's size — the false-precision trap Workday's feedTotal
    // was introduced to close ("503 open" while advertising 942).
    expect(fetcher).toMatch(/const feedTotal = Number\(page1\.totalFound\) \|\| 0;/);
    expect(fetcher).toMatch(/const total = Math\.min\(feedTotal, SR_CAP\);/);
  });

  it("computes windowed from the advertised total, like Workday and Oracle", () => {
    expect(fetcher).toMatch(/windowed: feedTotal > content\.length/);
  });

  it("propagates it out of fetchBoard, where it used to die", () => {
    // Asserted as an INVARIANT, not as a literal line. This used to pin the whole
    // return statement including its closing brace, so adding a field beside
    // windowed/feedTotal — nextOffset, when the capped vendors learned to resume
    // where the last pass stopped — failed a TRUNCATION guard for a reason that
    // had nothing to do with truncation. What must hold is that both values come
    // off `sr` and leave fetchBoard, not the punctuation after them.
    expect(SRC).toMatch(/return \{ jobs, raw, windowed: sr\.windowed === true, feedTotal: sr\.feedTotal \?\? 0[,}]/);
  });

  it("the closure guard reads the reported signal, not a row-count proxy", () => {
    // The proxy could not tell a board holding exactly the cap from one holding
    // twelve times it, so a company with precisely SR_CAP live postings had
    // closure logging suppressed forever — and the closure log is the one
    // asset here that cannot be re-derived later.
    expect(SRC).toMatch(/const truncatedFetch = r\.windowed === true;/);
    const guard = SRC.slice(SRC.indexOf("const truncatedFetch"));
    expect(guard.slice(0, 200)).not.toMatch(/rowsById\.size >= SR_CAP/);
  });

  it("a partial fetch from a mid-loop failure still reports windowed", () => {
    // The page loop breaks on a bad response rather than throwing; feedTotal is
    // still the real advertised number, so feedTotal > content.length holds and
    // closures stay suppressed.
    expect(fetcher).toMatch(/if \(!res\.ok\) break;/);
  });
});
