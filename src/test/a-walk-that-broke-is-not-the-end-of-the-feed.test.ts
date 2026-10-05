import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { codeOf } from "./helpers/strip-comments";
import { emptyFirstPage } from "../../supabase/functions/job-board/read-window";

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
    emptyFirstPage,
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

  it("a cursor past a feed that shrank wraps on the feed's end; from page 1 an empty page is still a refusal", async () => {
    const shrunk = await icims(300)({ token: "jobs.zs.com" }, 400, 100);
    expect(shrunk.items).toHaveLength(0);
    expect(shrunk.nextOffset).toBe(0);
    expect(shrunk.feedEnded).toBe(true);
    expect(shrunk.windowed).toBe(true);
    const refused = build<(s: { token: string }, o: number, p: number) => Promise<R>>("fetchIcims", {
      fetchWithTimeout: async () => json({ totalCount: 278, jobs: [] }),
      discardBody: () => {}, discardRest: () => {},
      chunkPageRefusal: (e: unknown, first: boolean) => { if (first) throw e; return null; },
      readChunkPage: async (res: Response) => ({ body: await res.json(), over: false }),
      OVERSIZE_MARKER: "OVERSIZE_BODY", MAX_RESPONSE_BYTES: 4_000_000, MAX_POSTINGS_PER_VISIT: MAX, emptyFirstPage,
    });
    await expect(refused({ token: "jobs.zs.com" }, 0, 100)).rejects.toThrow(/empty page but total=278/);
  });
});

describe("iCIMS: a first page over the byte bound is retried smaller before the board is deferred (L7-02b)", () => {
  const SIZES = (() => {
    const m = /const ICIMS_PAGE_SIZES: readonly number\[\] = \[([\d, ]+)\];/.exec(CODE);
    expect(m, "ICIMS_PAGE_SIZES not found").toBeTruthy();
    return m![1].split(",").map((x) => Number(x.trim()));
  })();
  /** fetchIcimsSized, the shipped one, over a fetchIcims stub whose first page is over the bound at `overAt` rows and above. */
  const sized = (overAt: number, other?: Error) => {
    const asked: number[] = [];
    const hints = new Map<string, number>();
    const fn = build<(s: { token: string }, o: number) => Promise<{ items: unknown[]; pageSize: number }>>("fetchIcimsSized", {
      ICIMS_PAGE_SIZES: SIZES,
      ICIMS_SIZE_HINT: hints,
      isOversize: (e: unknown) => String((e as Error)?.message ?? e).includes("OVERSIZE_BODY"),
      console: { warn: () => {} },
      fetchIcims: async (_s: unknown, _o: number, pageSize: number) => {
        asked.push(pageSize);
        if (other) throw other;
        if (pageSize >= overAt) throw new Error(`OVERSIZE_BODY over 4000000 on page 1`);
        return { items: Array.from({ length: pageSize }, (_, k) => k), windowed: true, feedTotal: 278, nextOffset: pageSize, feedEnded: false, endOffset: pageSize };
      },
    });
    return { fn, asked, hints };
  };

  it("jobs.zs.com (4.73 MB at 100 rows) reads at 50, and the next visit starts there", async () => {
    const { fn, asked, hints } = sized(100);
    const r = await fn({ token: "jobs.zs.com" }, 0);
    expect(SIZES).toEqual([100, 50, 25]);
    expect(asked).toEqual([100, 50]);
    expect(r.pageSize).toBe(50);
    expect(hints.get("jobs.zs.com")).toBe(50);
    asked.length = 0;
    await fn({ token: "jobs.zs.com" }, 50);
    expect(asked, "the size that fitted is remembered").toEqual([50]);
  });

  it("a board over the bound even at 25 is deferred (the oversize error reaches the caller)", async () => {
    const { fn, asked } = sized(25);
    await expect(fn({ token: "careers.ringpower.com" }, 0)).rejects.toThrow(/OVERSIZE_BODY/);
    expect(asked).toEqual([100, 50, 25]);
  });

  it("any other failure fails the board at once, with no smaller retry", async () => {
    const { fn, asked } = sized(1_000, new Error("HTTP 503"));
    await expect(fn({ token: "jobs.qxo.com" }, 0)).rejects.toThrow(/HTTP 503/);
    expect(asked).toEqual([100]);
  });
});

describe("USAJOBS: pages of 100 from the cursor, capped, resumed, and never stranded past the feed (L7-01, n420)", () => {
  type R = { items: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number };
  const CAP = Number(/const USAJOBS_RESULT_CAP = ([\d_]+);/.exec(CODE)![1].replace(/_/g, ""));
  /** A stub search API: `count` matches, at most `serves` reachable (empty pages past it), optional HTTP status on a page. */
  const api = (count: number, opts: { serves?: number; status?: { page: number; code: number } } = {}) => {
    const asked: Array<{ page: number; per: number; key: string | null }> = [];
    const fn = build<(s: { token: string; pages?: number }, o: number, key: string, ua: string) => Promise<R>>("fetchUsajobs", {
      fetchWithTimeout: async (url: string, init: { headers: Record<string, string> }) => {
        const u = new URL(url);
        const page = Number(u.searchParams.get("Page"));
        const per = Number(u.searchParams.get("ResultsPerPage"));
        asked.push({ page, per, key: init.headers["Authorization-Key"] ?? null });
        if (opts.status && opts.status.page === page) return new Response("no", { status: opts.status.code });
        const start = (page - 1) * per;
        const reach = Math.min(count, opts.serves ?? CAP);
        const n = Math.max(0, Math.min(per, reach - start));
        return json({ SearchResult: { SearchResultCountAll: count, SearchResultItems: Array.from({ length: n }, (_, k) => ({ MatchedObjectId: String(start + k) })) } });
      },
      discardBody: () => {},
      chunkPageRefusal: (e: unknown, first: boolean) => { if (first) throw e; return null; },
      readChunkPage: async (res: Response) => ({ body: await res.json(), over: false }),
      OVERSIZE_MARKER: "OVERSIZE_BODY",
      MAX_RESPONSE_BYTES: 4_000_000,
      MAX_POSTINGS_PER_VISIT: MAX,
      USAJOBS_RESULT_CAP: CAP,
      emptyFirstPage,
    });
    return { fn, asked };
  };
  const S = { token: "usajobs" };

  it("asks pages of 100 with the key, stops at the visit cap and resumes where it stopped", async () => {
    const { fn, asked } = api(1_234);
    const v = await fn(S, 0, "k", "ua");
    expect(asked.every((a) => a.per === 100 && a.key === "k")).toBe(true);
    expect(v.items).toHaveLength(MAX % 100 === 0 ? MAX : Math.ceil(MAX / 100) * 100);
    expect(v.nextOffset).toBe(v.endOffset);
    expect(v.windowed).toBe(true);
    expect(v.feedEnded).toBe(false);
    asked.length = 0;
    const next = await fn(S, v.nextOffset, "k", "ua");
    expect(asked[0].page, "the next visit starts at the cursor's page").toBe(v.nextOffset / 100 + 1);
    expect(next.endOffset).toBeGreaterThan(v.endOffset);
  });

  it("walks the whole feed in visits and wraps on its short last page", async () => {
    const { fn } = api(1_234);
    let cursor = 0, visits = 0, last: R | null = null;
    do { last = await fn(S, cursor, "k", "ua"); cursor = last.nextOffset; visits++; } while (cursor !== 0 && visits < 50);
    expect(last!.endOffset).toBe(1_234);
    expect(last!.feedEnded).toBe(true);
  });

  it("a cursor past a feed that shrank wraps instead of failing every visit into the dormancy prune", async () => {
    const { fn } = api(900);
    const v = await fn(S, 1_000, "k", "ua");
    expect(v.items).toHaveLength(0);
    expect(v.nextOffset).toBe(0);
    expect(v.feedEnded).toBe(true);
  });

  it("a feed larger than the result cap wraps at the cap without claiming an end, and never asks past it", async () => {
    const { fn, asked } = api(31_000);
    const atCap = await fn(S, CAP, "k", "ua");
    expect(asked, "no page past the cap is requested").toEqual([]);
    expect(atCap.nextOffset).toBe(0);
    expect(atCap.feedEnded, "a lap must not prove absence on the 21,000 it cannot read").toBe(false);
    const nearCap = await fn(S, CAP - 100, "k", "ua");
    expect(nearCap.endOffset).toBe(CAP);
    expect(nearCap.nextOffset).toBe(0);
    expect(nearCap.feedEnded).toBe(false);
  });

  it("an API that serves less deep than the cap: the empty page restarts the lap, it does not fail", async () => {
    const { fn } = api(31_000, { serves: 5_000 });
    const v = await fn(S, 5_000, "k", "ua");
    expect(v.nextOffset).toBe(0);
    expect(v.feedEnded).toBe(false);
  });

  it("from the top, an empty answer against a stated count, or a non-200, fails the board", async () => {
    const refused = api(15_000, { serves: 0 });
    await expect(refused.fn(S, 0, "k", "ua")).rejects.toThrow(/empty page but total=15000/);
    const down = api(15_000, { status: { page: 1, code: 503 } });
    await expect(down.fn(S, 0, "k", "ua")).rejects.toThrow(/HTTP 503/);
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
