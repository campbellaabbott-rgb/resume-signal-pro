// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as readWindow from "../../supabase/functions/job-board/read-window";
import { codeOf } from "./helpers/strip-comments";

/**
 * AN EMPTY PAGE INSIDE THE LAP'S OWN TOTAL PROVED THE LAP; TWO QUICK FAILURES
 * THREW AWAY A GIANT CURSOR.
 *
 * Sweep S8-086 (2026-10-08), both halves of n420.
 *
 *  1. A Workday tenant that states its total only at offset 0 answers total 0
 *     at depth, so an empty page there read as "ended". Inside the tail slack
 *     the lap was then proven on that page: a scratch run with cursor 780 and
 *     the lap's offset-0 total (t0) 831 gave {empty: "ended", lapProven: true},
 *     and every row of the unread tail was stamped missing, hidden at once.
 *  2. cursorAfterFailure reset the cursor on a board's second consecutive
 *     failure. The retry lane re-tries a failing board after 15 minutes, so
 *     two transient failures a quarter-hour apart sent a 16,520-deep cursor
 *     back to 0 (cursorAfterFailure(16520, 1) === 0) and the lap with it.
 *
 * The lap test runs the SHIPPED lap block of the refresh worker (from its
 * n083 rationale line to failLap, lifted from index.ts) for one visit.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
const lapBlock = (() => {
  const a = FN.indexOf("        // Rationale: docs/job-board-index-notes.md#n083-lapepoch");
  const b = FN.indexOf("        const failLap = () => {", a);
  expect(a, "the lap block moved; re-point this test").toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return FN.slice(a, b);
})();
const num = (name: string) => Number(new RegExp(`\\nconst ${name} = ([0-9_.]+);`).exec(FN)![1].replace(/_/g, ""));

type Rec = { e: number; s: number; t: string; f: 0 | 1; t0: number };
function visit(r: Record<string, unknown>, cursorBefore: number, rec: Rec) {
  const deepLaps: Record<string, Rec> = { "workday:acme~wd5~Ext": { ...rec } };
  const helpers = Object.fromEntries(Object.entries(readWindow));
  const scope: Record<string, unknown> = {
    ...helpers,
    r, cursorBefore, deepLaps, s: { source: "workday", token: "acme~wd5~Ext" }, startIso: "2026-10-08T12:00:00.000Z",
    LAP_TAIL_SLACK: num("LAP_TAIL_SLACK"), LAP_COVERAGE_MIN: num("LAP_COVERAGE_MIN"),
  };
  const names = Object.keys(scope);
  const js = transformSync(`let deepCursorsDirty = false;\n${lapBlock}\nreturn { lapProven, lapSeen };`, { loader: "ts" }).code;
  return new Function(...names, js)(...names.map((n) => scope[n])) as { lapProven: boolean; lapSeen: number };
}

describe("an empty page past the cursor, inside the total the lap opened on, is not the feed's end", () => {
  const rec: Rec = { e: 5, s: 780, t: "2026-10-07T00:00:00.000Z", f: 0, t0: 831 };
  // fetchWorkday's own answer to an empty page at 780 on a tenant that says total 0 past the top.
  const empty = { jobs: [], windowed: true, feedTotal: 0, nextOffset: 0, feedEnded: true, endOffset: 780 };

  it("does not prove the lap (the 51 unread offsets would be stamped missing and hidden)", () => {
    expect(visit(empty, 780, rec).lapProven).toBe(false);
  });

  it("a short page that really ends the feed inside the slack still proves it", () => {
    const short = { jobs: Array.from({ length: 7 }, (_, k) => ({ id: `workday:acme~wd5~Ext:R${k}` })), windowed: true, feedTotal: 0, nextOffset: 0, feedEnded: true, endOffset: 787 };
    expect(visit(short, 780, rec).lapProven).toBe(true);
  });

  it("an empty page past the lap's whole total is the feed ending, and proves as before", () => {
    expect(visit({ ...empty, endOffset: 840 }, 840, { ...rec, s: 840 }).lapProven).toBe(true);
  });
});

describe("a cursor is reset by failures that span hours, not by two a retry apart", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const after = (cursor: number, streak: number, minutes?: number) =>
    (readWindow.cursorAfterFailure as (...a: unknown[]) => number)(cursor, streak, minutes === undefined ? undefined : now - minutes * 60_000, now);

  it("a 16,520-deep cursor survives a second failure fifteen minutes after the first", () => {
    expect(after(16_520, 1, 15)).toBe(16_520);
  });

  it("a board failing for hours (a stranded cursor) starts again from the top, well inside the dormancy floor", () => {
    expect(after(16_520, 1, 7 * 60)).toBe(0);
    expect(after(16_520, 0, 7 * 60), "the first failure always keeps the cursor").toBe(16_520);
    expect(after(0, 4, 7 * 60)).toBe(0);
  });

  it("the worker hands the streak's start to the rule", () => {
    expect(CODE).toMatch(/cursorAfterFailure\(cur, streak, since, Date\.now\(\)\)/);
  });
});
