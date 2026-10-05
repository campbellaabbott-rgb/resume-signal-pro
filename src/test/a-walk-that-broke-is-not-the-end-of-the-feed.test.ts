import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { codeOf } from "./helpers/strip-comments";

/**
 * FOUR WALKS THAT REPORTED THE WRONG THING ABOUT WHERE THEY STOPPED (.89).
 *
 *  - Rippling (register L13-54, old 1.68): page 2 of a 5-page board answering
 *    503, or a 200 bot wall that will not parse, ended the walk and was
 *    reported as a complete, unwindowed read; the unread pages' postings were
 *    stamped missing and later logged as takedowns.
 *  - SmartRecruiters (L7-13): the walk ran to SR_CAP (2,000) per visit while
 *    the slice reserved MAX_POSTINGS_PER_VISIT (250) for it.
 *  - iCIMS (L7-02b): a first page over the 4 MB bound at 100 rows deferred the
 *    board forever; it is now retried at 50, then 25.
 *  - USAJOBS (L7-01): every 500-result page was over the bound, so the federal
 *    feed never stored a row; pages of 100, capped and resumed.
 *
 * Each fetcher here is the SHIPPED one, lifted from index.ts and transpiled,
 * run against a stub vendor.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
const MAX = Number(/const MAX_POSTINGS_PER_VISIT = (\d+);/.exec(CODE)![1]);

function lifted(name: string): string {
  const at = FN.indexOf(`async function ${name}(`);
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
function build<T>(name: string, deps: Record<string, unknown>): T {
  const names = Object.keys(deps);
  return new Function(...names, `${lifted(name)}\nreturn ${name};`)(...names.map((n) => deps[n])) as T;
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

describe("Rippling: a page that failed is not the feed running out", () => {
  type R = { items: unknown[]; windowed: boolean; nextOffset: number; feedEnded: boolean };
  // A 5-page board; `bad` is the page that fails and how.
  const board = (bad: { page: number; how: "503" | "wall" } | null) => build<(s: { token: string }, o?: number) => Promise<R>>("fetchRippling", {
    fetchWithTimeout: async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page") ?? "0");
      if (bad && page === bad.page) return bad.how === "503" ? new Response("busy", { status: 503 }) : new Response("<html>challenge</html>", { status: 200 });
      return new Response(`PAGE:${page}`, { status: 200 });
    },
    extractRipplingJobPosts: (html: string) => {
      const m = /^PAGE:(\d+)$/.exec(html);
      if (!m) return null;
      return { items: Array.from({ length: 20 }, (_, k) => ({ id: `${m[1]}-${k}` })), totalPages: 5 };
    },
    discardBody: () => {},
    RIPPLING_PAGE_CAP: Number(/const RIPPLING_PAGE_CAP = (\d+);/.exec(CODE)![1]),
  });

  it("a board read whole is still a full read", async () => {
    const r = await board(null)({ token: "acme" });
    expect(r.items).toHaveLength(100);
    expect(r.windowed).toBe(false);
    expect(r.nextOffset).toBe(0);
  });

  it("a 503 on page 2 is a window, not a 40-posting board", async () => {
    const r = await board({ page: 2, how: "503" })({ token: "acme" });
    expect(r.items).toHaveLength(40);
    expect(r.windowed, "the unread pages would be stamped missing and closed").toBe(true);
    expect(r.feedEnded).toBe(false);
    // Inside the cap, the next visit starts from the top again rather than at a page that may keep failing.
    expect(r.nextOffset).toBe(0);
  });

  it("a page that will not parse (a 200 bot wall) is a window too, never feedEnded", async () => {
    const r = await board({ page: 3, how: "wall" })({ token: "acme" });
    expect(r.items).toHaveLength(60);
    expect(r.windowed).toBe(true);
    expect(r.feedEnded, "only a parsed, empty page may say the feed ended").toBe(false);
  });
});

describe("SmartRecruiters: a visit stops at MAX_POSTINGS_PER_VISIT and resumes", () => {
  type R = { content: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean };
  const asked: Array<{ offset: number; limit: number }> = [];
  const sr = (size: number) => build<(s: { token: string }, o?: number) => Promise<R>>("fetchSmartRecruiters", {
    listUrl: (_s: unknown, o = 0) => `https://api.smartrecruiters.com/v1/companies/x/postings?limit=100${o ? `&offset=${o}` : ""}`,
    fetchWithTimeout: async (url: string) => {
      const u = new URL(url);
      const offset = Number(u.searchParams.get("offset") ?? "0");
      const limit = Number(u.searchParams.get("limit") ?? "100");
      asked.push({ offset, limit });
      const n = Math.max(0, Math.min(limit, size - offset));
      return json({ totalFound: size, content: Array.from({ length: n }, (_, k) => ({ id: `p${offset + k}` })) });
    },
    discardBody: () => {},
    SR_PAGE: 100,
    SR_PAGE_CAP: 20,
    SR_CAP: 2000,
    MAX_POSTINGS_PER_VISIT: MAX,
  });

  it("dominos-sized: 250 per visit, never 2,000, and the cursor lands on the next unread offset", async () => {
    asked.length = 0;
    const v = await sr(21_531)({ token: "dominos" }, 10_000);
    expect(v.content).toHaveLength(MAX);
    expect(asked.map((a) => a.offset)).toEqual([10_000, 10_100, 10_200]);
    expect(asked.at(-1)!.limit, "the last page asks only for what is left under the cap").toBe(MAX - 200);
    expect(v.nextOffset).toBe(10_000 + MAX);
    expect(v.windowed).toBe(true);
    expect(v.feedEnded).toBe(false);
  });

  it("a small board is still read whole in one visit", async () => {
    const v = await sr(130)({ token: "small" }, 0);
    expect(v.content).toHaveLength(130);
    expect(v.windowed).toBe(false);
    expect(v.nextOffset).toBe(0);
    expect(v.feedEnded).toBe(true);
  });
});

describe("iCIMS: the page size comes from the caller, and the offsets it reports are the ones it read", () => {
  type R = { items: unknown[]; windowed: boolean; nextOffset: number; feedEnded: boolean; endOffset: number };
  const icims = (size: number) => build<(s: { token: string; pages?: number }, o: number, p: number) => Promise<R>>("fetchIcims", {
    fetchWithTimeout: async (url: string) => {
      const u = new URL(url);
      const page = Number(u.searchParams.get("page"));
      const limit = Number(u.searchParams.get("limit"));
      const start = (page - 1) * limit;
      const n = Math.max(0, Math.min(limit, size - start));
      return json({ totalCount: size, jobs: Array.from({ length: n }, (_, k) => ({ id: start + k })) });
    },
    discardBody: () => {},
    discardRest: () => {},
    chunkPageRefusal: (e: unknown, first: boolean) => { if (first) throw e; return null; },
    readChunkPage: async (res: Response) => ({ body: await res.json(), over: false }),
    OVERSIZE_MARKER: "OVERSIZE_BODY",
    MAX_RESPONSE_BYTES: 4_000_000,
    MAX_POSTINGS_PER_VISIT: MAX,
  });

  it("at 25 a row, a visit still stops at the cap and resumes", async () => {
    const v = await icims(330)({ token: "jobs.qxo.com" }, 0, 25);
    expect(v.items).toHaveLength(MAX);
    expect(v.nextOffset).toBe(MAX);
    expect(v.windowed).toBe(true);
  });

  it("a cursor left by another page size re-reads the head of its page and reports the true end offset", async () => {
    // A 25-row visit stopped at 275; a 100-row visit starts at page 3 (offset 200).
    const v = await icims(330)({ token: "jobs.zs.com" }, 275, 100);
    expect(v.endOffset, "the lap's coverage must be the offset really reached, never cursor + rows").toBe(330);
    expect(v.feedEnded).toBe(true);
    expect(v.windowed).toBe(true);
  });

  it("the dispatcher retries a first page over the byte bound smaller before deferring the board", () => {
    expect(CODE).toMatch(/const ICIMS_PAGE_SIZES: readonly number\[\] = \[100, 50, 25\];/);
    const block = CODE.slice(CODE.indexOf('if (s.source === "icims") {'), CODE.indexOf('if (s.source === "usajobs") {'));
    expect(block).toMatch(/await fetchIcims\(s, startOffset, ICIMS_PAGE_SIZES\[k\]\)/);
    expect(block, "only an oversize refusal earns a smaller retry; any other failure still fails the board").toMatch(/if \(!isOversize\(e\) \|\| k \+ 1 >= ICIMS_PAGE_SIZES\.length\) throw e;/);
  });
});

describe("light mode is keyed by board, so a shared token's greenhouse board can go light (L7-02a)", () => {
  it("backfill-desc counts and fills only the greenhouse board of a shared token", () => {
    expect(CODE).toMatch(/\.in\("company_token", lightTokens\)\.eq\("source", DESC_BACKFILL_VENDOR\)\.is\("description", null\)/);
    const bf = CODE.slice(CODE.indexOf('if (action === "backfill-desc") {'));
    expect(bf.slice(0, 6000)).toMatch(/\.eq\("company_token", s\.token\)\s*\.eq\("source", s\.source\)\s*\.is\("description", null\)/);
    expect(bf.slice(0, 6000)).toMatch(/\.eq\("company_token", b\.token\)\.eq\("source", b\.source\)\.is\("description", null\)/);
  });
});
