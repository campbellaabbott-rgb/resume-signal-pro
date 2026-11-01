// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { transformSync } from "esbuild";
import * as readWindow from "../../supabase/functions/job-board/read-window";
import { oracleHost } from "../../supabase/functions/job-board/normalize";

/**
 * ORACLE WILL NOT PAGE PAST TEN THOUSAND, AND A LAP THAT REACHED THE CAP STILL
 * PROVES (S10-003, n1430).
 *
 * Measured on Kroger's own CE REST feed (eluq.fa.us2.oraclecloud.com, site
 * CX_1, POSTING_DATES_DESC) on 2026-11-01: TotalJobsCount 11,267; offset 9,999
 * limit 1 answers one row posted 2026-08-13; offset 10,000, and offset 9,950
 * limit 100, answer TotalJobsCount 0 with no rows (a page whose end passes
 * 10,000 is refused whole). Marriott (12,826, row 9,999 posted 2026-09-25),
 * AutoZone (11,287, 2026-09-25) and Kotak (12,053, 2026-09-28) answer the
 * same. The board read that empty page as the feed's end, so lapSeen stopped
 * at 10,000 against a total of 11,000+ and no lap on these four employers ever
 * proved: nothing they took down was stamped, closed or logged.
 *
 * The walk now stops at the cap, wraps without claiming the end, and reports
 * the posting date of the last row it could read (the floor). A lap that
 * reached the cap proves only when the floor is older than the 30-day fence,
 * so every stored dated row was inside the read; a stored row that is undated
 * or posted on or before the floor is never an absence candidate on that lap.
 *
 * The fetcher, the lap block and the absence list here are the SHIPPED ones,
 * lifted from index.ts and run against a stub tenant that behaves as Kroger's
 * feed was measured to.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const num = (name: string) => Number(new RegExp(`\\nconst ${name} = ([0-9_.]+);`).exec(FN)![1].replace(/_/g, ""));
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const FENCE = NOW - 30 * DAY;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function fetcher() {
  const at = FN.indexOf("async function fetchOracle(");
  expect(at, "fetchOracle moved").toBeGreaterThan(-1);
  const src = ts.transpileModule(FN.slice(at, FN.indexOf("\n}\n", at) + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return (total: number, asked: number[], newest = NOW) => {
    // Row k is posted (k / 125) days before `newest`: Kroger's ~78 days at row 9,999.
    const deps: Record<string, unknown> = {
      oracleHost,
      fetchWithTimeout: async (url: string) => {
        const finder = decodeURIComponent(new URL(url).searchParams.get("finder") ?? "");
        const offset = Number(/offset=(\d+)/.exec(finder)![1]), limit = Number(/limit=(\d+)/.exec(finder)![1]);
        asked.push(offset);
        const refused = offset + limit > 10_000;
        const n = refused ? 0 : Math.max(0, Math.min(limit, total - offset));
        const rows = Array.from({ length: n }, (_, k) => ({ Id: String(offset + k), Title: "Clerk", PostedDate: iso(newest - Math.floor((offset + k) / 125) * DAY) }));
        return new Response(JSON.stringify({ items: [{ TotalJobsCount: refused ? 0 : total, requisitionList: rows }] }), { status: 200 });
      },
      discardBody: () => {}, discardRest: () => {},
      chunkPageRefusal: (e: unknown, first: boolean) => { if (first) throw e; return null; },
      readChunkPage: async (res: Response) => ({ body: await res.json(), over: false }),
      OVERSIZE_MARKER: "OVERSIZE_BODY", MAX_RESPONSE_BYTES: 4_000_000,
      ORACLE_PAGE_SIZE: num("ORACLE_PAGE_SIZE"), ORACLE_PAGE_CAP: num("ORACLE_PAGE_CAP"), MAX_POSTINGS_PER_VISIT: num("MAX_POSTINGS_PER_VISIT"),
      ...readWindow,
    };
    const names = Object.keys(deps);
    return new Function(...names, `${src}\nreturn fetchOracle;`)(...names.map((n) => deps[n])) as
      (s: { token: string; pages?: number }, o: number) => Promise<{ items: Array<{ Id: string; PostedDate: string }>; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number; capFloor?: string }>;
  };
}
const KROGER = { token: "eluq~us2~CX_1", pages: 130 };

describe("the walk stops at the vendor's cap and says so", () => {
  it("Kroger's last window before the cap reads its 100 rows, never asks offset 10,000, wraps without claiming the end and names the floor", async () => {
    const asked: number[] = [];
    const v = await fetcher()(11_327, asked)(KROGER, 9_900);
    expect(asked.filter((o) => o >= 10_000), "a page past the cap was asked").toEqual([]);
    expect(v.items).toHaveLength(100);
    expect(v.nextOffset).toBe(0);
    expect(v.feedEnded, "an empty page at the cap was read as the end of an 11,327-posting feed").toBe(false);
    expect(v.windowed).toBe(true);
    expect(v.endOffset).toBe(10_000);
    expect(v.capFloor).toBe(v.items.at(-1)!.PostedDate);
  });

  it("a window inside the cap is untouched: 300 rows and the next cursor", async () => {
    const v = await fetcher()(11_327, [])(KROGER, 9_600);
    expect([v.items.length, v.nextOffset, v.feedEnded, v.capFloor]).toEqual([300, 9_900, false, undefined]);
  });

  it("a feed of exactly 10,000 ends at the cap like any feed that ran out", async () => {
    const v = await fetcher()(10_000, [])(KROGER, 9_900);
    expect([v.items.length, v.nextOffset, v.feedEnded, v.capFloor]).toEqual([100, 0, true, undefined]);
  });

  it("a small feed read from the top is still one whole read", async () => {
    const v = await fetcher()(230, [])({ token: "efet~us2~CX_1" }, 0);
    expect([v.items.length, v.nextOffset, v.feedEnded, v.windowed, v.capFloor]).toEqual([230, 0, true, false, undefined]);
  });
});

describe("a lap that reached the cap proves when every stored dated row was inside it", () => {
  const lapBlock = (() => {
    const a = FN.indexOf("        // Rationale: docs/job-board-index-notes.md#n083-lapepoch");
    const b = FN.indexOf("        const failLap = () => {", a);
    expect(a, "the lap block moved").toBeGreaterThan(-1);
    return FN.slice(a, b);
  })();
  type Rec = { e: number; s: number; t: string; f: 0 | 1; t0: number };
  function visit(r: Record<string, unknown>, cursorBefore: number, rec: Rec) {
    const scope: Record<string, unknown> = {
      ...readWindow, r, cursorBefore, deepLaps: { "oracle:eluq~us2~CX_1": { ...rec } }, s: { source: "oracle", ...KROGER }, startIso: new Date(NOW).toISOString(),
      freshCutoffMs: FENCE, LAP_TAIL_SLACK: num("LAP_TAIL_SLACK"), LAP_COVERAGE_MIN: num("LAP_COVERAGE_MIN"),
    };
    const names = Object.keys(scope);
    const js = transformSync(`let deepCursorsDirty = false;\n${lapBlock}\nreturn { lapProven, lapSeen };`, { loader: "ts" }).code;
    return new Function(...names, js)(...names.map((n) => scope[n])) as { lapProven: boolean; lapSeen: number };
  }
  const rec: Rec = { e: 9, s: 9_900, t: "2026-10-30T00:00:00.000Z", f: 0, t0: 11_327 };
  const capped = (floorDaysBack: number) => ({ jobs: Array.from({ length: 100 }, () => ({})), windowed: true, feedTotal: 11_327, nextOffset: 0, feedEnded: false, endOffset: 10_000, capFloor: iso(NOW - floorDaysBack * DAY) });

  it("Kroger (floor 78 days back, the fence 30) proves its lap at the cap", () => {
    expect(visit(capped(78), 9_900, rec)).toEqual({ lapProven: true, lapSeen: 10_000 });
  });

  it("a floor inside the fence (more than 10,000 postings in 30 days) does not prove: stored rows sit past the cap", () => {
    expect(visit(capped(20), 9_900, rec).lapProven).toBe(false);
    expect(visit(capped(30), 9_900, rec).lapProven, "a floor on the fence's own day is not older than it").toBe(false);
  });

  it("a lap with a failed epoch write, or a feed that shrank under 90% of where it opened, still cannot prove", () => {
    expect(visit(capped(78), 9_900, { ...rec, f: 1 }).lapProven).toBe(false);
    expect(visit({ ...capped(78), feedTotal: 9_000 }, 9_900, rec).lapProven).toBe(false);
  });

  it("an uncapped wrap is judged exactly as before", () => {
    const short = { jobs: [], windowed: true, feedTotal: 1_037, nextOffset: 0, feedEnded: true, endOffset: 1_037 };
    expect(visit(short, 900, { ...rec, s: 900, t0: 1_037 }).lapProven).toBe(true);
    expect(visit({ ...short, endOffset: 900 }, 900, { ...rec, s: 900, t0: 2_000 }).lapProven).toBe(false);
  });
});

describe("on a capped visit, a stored row the read could not reach is never an absence candidate", () => {
  const line = (() => {
    const m = /\n( +const vanishedAll = [^\n]+;)\n/.exec(FN);
    expect(m, "the absence list moved").not.toBeNull();
    return m![1];
  })();
  const run = (r: Record<string, unknown>, rows: Array<{ id: string; posted_at: string | null }>, live: string[], aged: string[] = []) => {
    const scope: Record<string, unknown> = {
      ...readWindow, r, existing: new Set(rows.map((x) => x.id)), liveIds: new Set(live), agedOutIds: new Set(aged), existingById: new Map(rows.map((x) => [x.id, x])),
    };
    const names = Object.keys(scope);
    return new Function(...names, `${transformSync(line, { loader: "ts" }).code}\nreturn vanishedAll;`)(...names.map((n) => scope[n])) as string[];
  };
  const rows = [
    { id: "fresh", posted_at: "2026-10-20T00:00:00.000Z" },
    { id: "floorDay", posted_at: "2026-08-13T00:00:00.000Z" },
    { id: "undated", posted_at: null },
    { id: "old", posted_at: "2026-08-01T00:00:00.000Z" },
    { id: "seen", posted_at: "2026-10-31T00:00:00.000Z" },
  ];

  it("a row posted after the floor is a candidate; one on the floor's own day, before it, or undated is not", () => {
    expect(run({ capFloor: "2026-08-13" }, rows, ["seen"])).toEqual(["fresh"]);
  });

  it("a row this visit aged out still leaves, whatever its date", () => {
    expect(run({ capFloor: "2026-08-13" }, rows, ["seen"], ["old"])).toEqual(["fresh", "old"]);
  });

  it("an uncapped visit lists every absent row, as before", () => {
    expect(run({}, rows, ["seen"])).toEqual(["fresh", "floorDay", "undated", "old"]);
  });
});

describe("the floor rules, on their own", () => {
  it("capLapCovers needs the whole servable range and a floor older than the fence", () => {
    const covers = readWindow.capLapCovers as (seen: number, floor: string | undefined, fence: number) => boolean;
    expect(covers(10_000, "2026-08-13", FENCE)).toBe(true);
    expect(covers(9_900, "2026-08-13", FENCE)).toBe(false);
    expect(covers(10_000, iso(FENCE), FENCE)).toBe(false);
    expect(covers(10_000, "", FENCE)).toBe(false);
    expect(readWindow.ORACLE_RESULT_CAP).toBe(10_000);
  });

  it("belowCapFloor hides undated rows and rows on or before the floor's day, and nothing when no floor is named", () => {
    const below = readWindow.belowCapFloor as (p: string | null | undefined, f: string | undefined) => boolean;
    expect(below("2026-08-14T00:00:00.000Z", "2026-08-13")).toBe(false);
    expect(below("2026-08-13T00:00:00.000Z", "2026-08-13")).toBe(true);
    expect(below(null, "2026-08-13")).toBe(true);
    expect(below("2026-08-14T00:00:00.000Z", "not a date")).toBe(true);
    expect(below(null, undefined)).toBe(false);
  });
});
