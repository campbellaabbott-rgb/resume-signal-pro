// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { emptyFirstPage } from "../../supabase/functions/job-board/read-window";
import { icimsOrgRefusal, icimsOrgScope } from "../../supabase/functions/job-board/normalize";

/**
 * AN ICIMS PAGE REFUSED MID-WALK ENDS THE WALK, NOT THE VISIT (S13-035, n1432).
 *
 * fetchIcims threw `HTTP <status>` for any refused page, and the shipped
 * chunkPageRefusal rethrows everything but an oversize body on a later page,
 * so one 403, 429 or 503 on page 2-5 rejected the chunk's Promise.all: the
 * pages that had landed were thrown away, the board was marked failed, and the
 * failure counted toward the dormancy prune. Every other chunked fetcher (UKG,
 * ADP, Oracle, Workday) ends the walk there with what it has. The suite's own
 * iCIMS stub handed in a chunkPageRefusal that swallowed later-page errors,
 * so it never saw this; the one here is the SHIPPED one.
 *
 * And a visit fetched ICIMS_CHUNK = 5 pages at once while
 * MAX_POSTINGS_PER_VISIT (250) stops the walk after three pages of 100: pages
 * 4 and 5 were fetched from the employer and thrown away on every visit.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const num = (name: string) => Number(new RegExp(`\\nconst ${name} = ([0-9_.]+);`).exec(FN)![1].replace(/_/g, ""));
const MAX = num("MAX_POSTINGS_PER_VISIT");

function lift(name: string): string {
  const at = FN.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  expect(at, `${name} moved`).toBeGreaterThan(-1);
  return ts.transpileModule(FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
type R = { items: unknown[]; windowed: boolean; nextOffset: number; feedEnded: boolean; endOffset: number };

function icims(size: number, bad: Record<number, number>, asked: number[]) {
  const deps: Record<string, unknown> = {
    fetchWithTimeout: async (url: string) => {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page")), limit = Number(u.searchParams.get("limit"));
      asked.push(page);
      if (bad[page]) return new Response("refused", { status: bad[page] });
      const start = (page - 1) * limit, n = Math.max(0, Math.min(limit, size - start));
      return new Response(JSON.stringify({ totalCount: size, jobs: Array.from({ length: n }, (_, k) => ({ id: start + k })) }), { status: 200 });
    },
    discardBody: () => {}, discardRest: () => {},
    isOversize: (e: unknown) => String((e as Error)?.message ?? e).includes("OVERSIZE_BODY"),
    readChunkPage: async (res: Response) => ({ body: await res.json(), over: false }),
    OVERSIZE_MARKER: "OVERSIZE_BODY", MAX_RESPONSE_BYTES: 4_000_000, MAX_POSTINGS_PER_VISIT: MAX,
    emptyFirstPage, icimsOrgScope, icimsOrgRefusal,
  };
  const names = Object.keys(deps);
  return new Function(...names, `${lift("chunkPageRefusal")}\n${lift("fetchIcims")}\nreturn fetchIcims;`)(...names.map((n) => deps[n])) as
    (s: { token: string; pages?: number }, o: number, p: number) => Promise<R>;
}
const BOARD = { token: "careers-acme.icims.com" };

describe("a refused later page keeps what landed and resumes there", () => {
  it.each([403, 429, 503])("HTTP %i on page 2 of a visit from the top: page 1's 100 rows, windowed, the cursor on page 2", async (status) => {
    const v = await icims(1_000, { 2: status }, [])(BOARD, 0, 100);
    expect([v.items.length, v.windowed, v.feedEnded, v.nextOffset, v.endOffset]).toEqual([100, true, false, 100, 100]);
  });

  it("a refusal on page 3 of a resumed visit keeps pages 1-2 of that visit", async () => {
    const v = await icims(1_000, { 6: 503 }, [])(BOARD, 300, 100);
    expect([v.items.length, v.nextOffset, v.feedEnded]).toEqual([200, 500, false]);
  });

  it("the visit's first page refused is still a failed visit", async () => {
    await expect(icims(1_000, { 1: 503 }, [])(BOARD, 0, 100)).rejects.toThrow(/HTTP 503/);
    await expect(icims(1_000, { 4: 429 }, [])(BOARD, 300, 100)).rejects.toThrow(/HTTP 429/);
  });
});

describe("a visit asks only for the pages it can keep", () => {
  it("at 100 a row: three pages, never five", async () => {
    const asked: number[] = [];
    const v = await icims(1_000, {}, asked)(BOARD, 0, 100);
    expect(v.items).toHaveLength(300);
    expect(asked, "pages fetched from the employer and thrown away").toEqual([1, 2, 3]);
  });

  it("at 50 and at 25 a row the walk still reaches the cap and stops there", async () => {
    const a50: number[] = [];
    expect((await icims(1_000, {}, a50)(BOARD, 0, 50)).items).toHaveLength(MAX);
    expect(a50).toEqual([1, 2, 3, 4, 5]);
    const a25: number[] = [];
    expect((await icims(1_000, {}, a25)(BOARD, 0, 25)).items).toHaveLength(MAX);
    expect(a25).toHaveLength(10);
  });

  it("a small board is still one whole read", async () => {
    const v = await icims(130, {}, [])(BOARD, 0, 100);
    expect([v.items.length, v.windowed, v.feedEnded, v.nextOffset]).toEqual([130, false, true, 0]);
  });
});
