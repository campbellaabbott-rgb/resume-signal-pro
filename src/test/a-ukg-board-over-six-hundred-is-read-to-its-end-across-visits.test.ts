// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { transformSync } from "esbuild";
import * as readWindow from "../../supabase/functions/job-board/read-window";
import { adpBoardParams, ukgBoardParams } from "../../supabase/functions/job-board/normalize";
import { codeOf } from "./helpers/strip-comments";

/**
 * A UKG BOARD OVER SIX HUNDRED IS READ TO ITS END ACROSS VISITS (S10-004, n1431).
 *
 * fetchUkg read Skip 0..599 on every visit (12 pages of 50) and returned no
 * resume cursor, so a board over 600 never opened a lap: nothing on it was
 * ever stamped missing or logged as closed, and a role taken down stayed up
 * "checked minutes ago" until the 30-day cap aged it out. Measured 2026-11-01
 * on UKG's own LoadSearchResults: Ollie's Bargain Outlet states totalCount
 * 1,392 on every page (Skip 0, 600 and 1,300 alike), in PostedDate order,
 * 989 of them posted in the last 30 days, while the board held 1,300 open
 * Ollie's rows; Cherry (1,283), Big 5 (1,030), Troon (2,154) and four more
 * were over 600 too. ADP's job-requisitions feed (300 a visit) states
 * meta.totalNumber on every page as well; no ADP board measured that day was
 * over 300, but the same walk had the same ceiling.
 *
 * Both now take the cursor contract Oracle and Workday have: start at the
 * cursor, return where to resume, and say whether the feed ended. The fetchers
 * and the lap block are the SHIPPED ones, lifted from index.ts.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
const num = (name: string) => Number(new RegExp(`\\nconst ${name} = ([0-9_.]+);`).exec(FN)![1].replace(/_/g, ""));

function lifted<T>(name: string, deps: Record<string, unknown>): T {
  const at = FN.indexOf(`async function ${name}(`);
  expect(at, `${name} moved`).toBeGreaterThan(-1);
  const src = ts.transpileModule(FN.slice(at, FN.indexOf("\n}\n", at) + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const names = Object.keys(deps);
  return new Function(...names, `${src}\nreturn ${name};`)(...names.map((n) => deps[n])) as T;
}
const common = {
  discardBody: () => {}, discardRest: () => {},
  chunkPageRefusal: (e: unknown, first: boolean) => { if (first) throw e; return null; },
  readChunkPage: async (res: Response) => ({ body: await res.json(), over: false }),
  OVERSIZE_MARKER: "OVERSIZE_BODY", MAX_RESPONSE_BYTES: 4_000_000, MAX_POSTINGS_PER_VISIT: num("MAX_POSTINGS_PER_VISIT"),
  ...readWindow,
};
type Visit = { items: Array<{ Id?: string; itemID?: string }>; windowed: boolean; feedTotal: number; nextOffset?: number; feedEnded?: boolean; endOffset?: number };

const ukg = (total: number, asked: number[]) => lifted<(s: { token: string }, o?: number) => Promise<Visit>>("fetchUkg", {
  ...common, ukgBoardParams, UKG_PAGE: num("UKG_PAGE"), UKG_PAGE_CAP: num("UKG_PAGE_CAP"), UKG_CHUNK: num("UKG_CHUNK"),
  fetchWithTimeout: async (_url: string, init: RequestInit) => {
    const { Top, Skip } = (JSON.parse(String(init.body)) as { opportunitySearch: { Top: number; Skip: number } }).opportunitySearch;
    asked.push(Skip);
    const n = Math.max(0, Math.min(Top, total - Skip));
    return new Response(JSON.stringify({ totalCount: total, opportunities: Array.from({ length: n }, (_, k) => ({ Id: `u${Skip + k}` })) }), { status: 200 });
  },
});
const adp = (total: number, asked: number[]) => lifted<(s: { token: string }, o?: number) => Promise<Visit>>("fetchAdp", {
  ...common, adpBoardParams, ADP_PAGE: num("ADP_PAGE"), ADP_PAGE_CAP: num("ADP_PAGE_CAP"), ADP_CHUNK: num("ADP_CHUNK"),
  fetchWithTimeout: async (url: string) => {
    const u = new URL(url);
    const top = Number(u.searchParams.get("$top")), skip = Number(u.searchParams.get("$skip"));
    asked.push(skip);
    // ADP's $skip is 1-based: $skip=1 is the first requisition.
    const n = Math.max(0, Math.min(top, total - (skip - 1)));
    return new Response(JSON.stringify({ meta: { totalNumber: total }, jobRequisitions: Array.from({ length: n }, (_, k) => ({ itemID: `a${skip - 1 + k}` })) }), { status: 200 });
  },
});
const OLLIES = { token: "recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845" };
const ids = (v: Visit) => v.items.map((x) => x.Id ?? x.itemID);

describe("UKG: Ollie's 1,392 postings are read in three visits, and the third wraps on the feed's end", () => {
  it("visit 1 reads the first 600 and leaves the cursor at 600", async () => {
    const v = await ukg(1_392, [])(OLLIES, 0);
    expect([v.items.length, v.nextOffset, v.feedEnded, v.windowed, v.feedTotal]).toEqual([600, 600, false, true, 1_392]);
  });

  it("visit 2 starts at the cursor, not at the top again", async () => {
    const asked: number[] = [];
    const v = await ukg(1_392, asked)(OLLIES, 600);
    expect(asked[0], "every visit re-read Skip 0").toBe(600);
    expect(ids(v)[0]).toBe("u600");
    expect([v.items.length, v.nextOffset, v.feedEnded, v.endOffset]).toEqual([600, 1_200, false, 1_200]);
  });

  it("visit 3 reads the last 192, wraps to 0 and reports the end; the three visits together are the whole feed", async () => {
    const v3 = await ukg(1_392, [])(OLLIES, 1_200);
    expect([v3.items.length, v3.nextOffset, v3.feedEnded, v3.endOffset, v3.windowed]).toEqual([192, 0, true, 1_392, true]);
    const all = new Set([...ids(await ukg(1_392, [])(OLLIES, 0)), ...ids(await ukg(1_392, [])(OLLIES, 600)), ...ids(v3)]);
    expect(all.size).toBe(1_392);
  });

  it("a board under 600 is one whole read, exactly as before", async () => {
    const v = await ukg(461, [])({ token: "recruiting2~BUI1005BABW~621885b8-8801-434c-83f1-c5e38d84ac03" }, 0);
    expect([v.items.length, v.nextOffset, v.feedEnded, v.windowed]).toEqual([461, 0, true, false]);
  });

  it("an empty first page against a stated total is still a refusal, never an empty board", async () => {
    const refused = lifted<(s: { token: string }, o?: number) => Promise<Visit>>("fetchUkg", {
      ...common, ukgBoardParams, UKG_PAGE: 50, UKG_PAGE_CAP: 12, UKG_CHUNK: 4,
      fetchWithTimeout: async () => new Response(JSON.stringify({ totalCount: 1_392, opportunities: [] }), { status: 200 }),
    });
    await expect(refused(OLLIES, 0)).rejects.toThrow(/empty page but total=1392/);
  });
});

describe("ADP: a feed over 300 resumes at the cursor on ADP's 1-based skip", () => {
  it("visit 2 asks $skip=301 and the walk ends on the feed's last page", async () => {
    const asked: number[] = [];
    const v = await adp(410, asked)({ token: "82153303-7d5a-4833-b767-9cb13d965e09" }, 300);
    expect(asked[0]).toBe(301);
    expect(ids(v)[0]).toBe("a300");
    expect([v.items.length, v.nextOffset, v.feedEnded, v.endOffset]).toEqual([110, 0, true, 410]);
  });

  it("visit 1 of that feed leaves the cursor at 300; a 260-posting board is one whole read", async () => {
    const v1 = await adp(410, [])({ token: "82153303-7d5a-4833-b767-9cb13d965e09" }, 0);
    expect([v1.items.length, v1.nextOffset, v1.feedEnded, v1.windowed]).toEqual([300, 300, false, true]);
    const small = await adp(260, [])({ token: "82153303-7d5a-4833-b767-9cb13d965e09" }, 0);
    expect([small.items.length, small.nextOffset, small.feedEnded, small.windowed]).toEqual([260, 0, true, false]);
  });
});

describe("the cursor reaches both fetchers, and the lap block proves the wrap", () => {
  it("fetchBoard hands the cursor to fetchUkg and fetchAdp and passes back where to resume", () => {
    expect(CODE).toMatch(/await fetchUkg\(s, startOffset\)/);
    expect(CODE).toMatch(/await fetchAdp\(s, startOffset\)/);
  });

  it("Ollie's third visit proves the lap the first visit opened", async () => {
    const a = FN.indexOf("        // Rationale: docs/job-board-index-notes.md#n083-lapepoch");
    const b = FN.indexOf("        const failLap = () => {", a);
    const v3 = await ukg(1_392, [])(OLLIES, 1_200);
    const scope: Record<string, unknown> = {
      ...readWindow, r: { ...v3, jobs: v3.items }, cursorBefore: 1_200, s: { source: "ukg", ...OLLIES },
      deepLaps: { [`ukg:${OLLIES.token}`]: { e: 3, s: 1_200, t: "2026-11-01T00:00:00.000Z", f: 0, t0: 1_392 } },
      startIso: "2026-11-01T20:00:00.000Z", freshCutoffMs: Date.parse("2026-10-02T20:00:00Z"),
      LAP_TAIL_SLACK: num("LAP_TAIL_SLACK"), LAP_COVERAGE_MIN: num("LAP_COVERAGE_MIN"),
    };
    const names = Object.keys(scope);
    const js = transformSync(`let deepCursorsDirty = false;\n${FN.slice(a, b)}\nreturn { lapProven, lapSeen };`, { loader: "ts" }).code;
    expect(new Function(...names, js)(...names.map((n) => scope[n]))).toEqual({ lapProven: true, lapSeen: 1_392 });
  });
});
