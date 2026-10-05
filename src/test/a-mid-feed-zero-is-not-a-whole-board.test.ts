import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { emptyFirstPage, lapTotal, stampFeedTotal, workdayWindowed } from "../../supabase/functions/job-board/read-window";
import { codeOf } from "./helpers/strip-comments";

/**
 * A ZERO FROM A MID-FEED PAGE IS THE TENANT NOT SAYING, NOT "NOTHING LEFT".
 *
 * Register L1-01 (2026-10-04), the mechanism behind 1.17. Many Workday tenants
 * state `total` only on the offset-0 page and answer `total: 0` on every later
 * page. Measured 2026-10-05 against the tenants' own CXS lists: Adobe 526 at
 * offset 0 and 0 at offset 20, 250 and 500; Novartis 816 then 0; TD 1,521
 * then 0; T-Mobile 2,000 then 0 (and, past offset 2,000, page 0 again with
 * 2,000). 540 of the 689 Workday boards whose stamp read 0 or over 250 behave
 * this way.
 *
 * MAX_POSTINGS_PER_VISIT is 250, so every such board is read over several
 * visits, and every visit after the first began mid-feed and saw a total of 0.
 * `windowed: feedTotal > all.length` was then false: the 250-row slice was
 * taken for the whole board, every other row was stamped missing (hidden at
 * once), deleted after the grace and logged to job_board_closures as an
 * employer takedown; the lap entry was dropped; the verification stamp
 * published feed_total 0. 207 of those boards served nothing.
 *
 * This file runs the SHIPPED fetchWorkday (lifted from index.ts and
 * transpiled) against a stub tenant with exactly that behaviour.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);

/** The source of one top-level `async function` in index.ts, as JavaScript. */
function lifted(name: string): string {
  const at = FN.indexOf(`async function ${name}(`);
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}

/**
 * A Workday tenant that states its total only on the offset-0 page. Like the
 * live CXS list, it answers an offset of 2,000 or more with page 0 again and
 * the capped total (`wrapsAt2000`), and can refuse one offset with an empty
 * page that still states the total (`refuseAt`).
 */
function tenant(size: number, opts: { totalPastZero?: (n: number) => number; wrapsAt2000?: boolean; refuseAt?: number } = {}) {
  const asked: number[] = [];
  const fetchWithTimeout = async (_url: string, init: { body: string }) => {
    const { offset: asked0, limit } = JSON.parse(init.body) as { offset: number; limit: number };
    asked.push(asked0);
    const offset = opts.wrapsAt2000 && asked0 >= 2000 ? 0 : asked0;
    const n = asked0 === opts.refuseAt ? 0 : Math.max(0, Math.min(limit, size - offset));
    const jobPostings = Array.from({ length: n }, (_, k) => ({ title: `Role ${offset + k}`, externalPath: `/job/x_R${offset + k}` }));
    const total = offset === 0 || asked0 === opts.refuseAt ? Math.min(size, 2000) : (opts.totalPastZero ? opts.totalPastZero(size) : 0);
    return new Response(JSON.stringify({ total, jobPostings }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchWithTimeout, asked };
}

type WorkdayVisit = { jobPostings: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean; endOffset: number };

function shippedFetchWorkday(fetchWithTimeout: unknown): (s: { token: string; pages?: number }, startOffset?: number) => Promise<WorkdayVisit> {
  const deps = {
    fetchWithTimeout,
    discardBody: () => {},
    discardRest: () => {},
    chunkPageRefusal: (e: unknown, first: boolean) => { if (first) throw e; return null; },
    readChunkPage: async (res: Response) => ({ body: await res.json(), over: false }),
    OVERSIZE_MARKER: "OVERSIZE_BODY",
    MAX_RESPONSE_BYTES: 4_000_000,
    MAX_POSTINGS_PER_VISIT: Number(/const MAX_POSTINGS_PER_VISIT = (\d+);/.exec(CODE)![1]),
    WORKDAY_PAGE_CAP: Number(/const WORKDAY_PAGE_CAP = (\d+);/.exec(CODE)![1]),
    workdayWindowed,
    emptyFirstPage,
  };
  const names = Object.keys(deps);
  return new Function(...names, `${lifted("fetchWorkday")}\nreturn fetchWorkday;`)(...names.map((n) => deps[n as keyof typeof deps]));
}

/** Walk a board visit by visit the way the deep cursor does, until it wraps. */
async function walk(size: number, opts: Parameters<typeof tenant>[1] = {}) {
  const t = tenant(size, opts);
  const fetchWorkday = shippedFetchWorkday(t.fetchWithTimeout);
  const visits: Array<WorkdayVisit & { start: number }> = [];
  let cursor = 0;
  for (let i = 0; i < 20; i++) {
    const v = await fetchWorkday({ token: "adobe~wd5~external_experienced" }, cursor);
    visits.push({ ...v, start: cursor });
    cursor = v.nextOffset;
    if (cursor === 0) break;
  }
  return visits;
}

describe("a mid-feed zero is not a whole board", () => {
  it("Adobe's 526, read in three visits: every visit is windowed, and the walk wraps on the feed's own end", async () => {
    const visits = await walk(526);
    expect(visits.map((v) => [v.start, v.jobPostings.length, v.feedTotal])).toEqual([[0, 260, 526], [260, 260, 0], [520, 6, 0]]);
    expect(
      visits.map((v) => v.windowed),
      "a visit that began past offset 0 and saw total 0 was taken for the whole board — its slice " +
        "would have been read as everything and the rest of the board stamped, deleted and logged as takedowns",
    ).toEqual([true, true, true]);
    expect(visits.at(-1)!.feedEnded).toBe(true);
    expect(visits.at(-1)!.endOffset).toBe(526);
  });

  it("a board that fits one visit from the top is still read whole, so its absences still count", async () => {
    const visits = await walk(180);
    expect(visits).toHaveLength(1);
    expect(visits[0].windowed).toBe(false);
    expect(visits[0].feedEnded).toBe(true);
  });

  it("a tenant that states its total on every page behaves exactly as before", async () => {
    const t = tenant(526, { totalPastZero: (n) => n });
    const fetchWorkday = shippedFetchWorkday(t.fetchWithTimeout);
    const v = await fetchWorkday({ token: "cvshealth~wd1~CVS_Health_Careers" }, 260);
    expect(v.windowed).toBe(true);
    expect(v.feedTotal).toBe(526);
  });

  it("the rule, in its own terms", () => {
    // From the top, total stated: whole only when the total does not exceed what was read.
    expect(workdayWindowed(0, 526, 260, false)).toBe(true);
    expect(workdayWindowed(0, 180, 180, true)).toBe(false);
    // From the top, no total stated: whole only when the walk saw the feed end.
    expect(workdayWindowed(0, 0, 250, false)).toBe(true);
    expect(workdayWindowed(0, 0, 12, true)).toBe(false);
    expect(workdayWindowed(0, 0, 0, true), "an empty board read from the top is whole").toBe(false);
    // Past the top: never whole, whatever the page said.
    expect(workdayWindowed(260, 0, 260, false)).toBe(true);
    expect(workdayWindowed(520, 0, 6, true)).toBe(true);
    expect(workdayWindowed(260, 526, 260, false)).toBe(true);
  });
});

describe("the advertised total a mid-feed visit carries", () => {
  it("the lap proof measures a mid-feed zero against the total the lap opened on", () => {
    expect(lapTotal(0, 520, 526)).toBe(526);
    expect(lapTotal(null, 520, 526)).toBe(526);
    expect(lapTotal(1_515, 520, 1_521), "a stated total is the visit's own").toBe(1_515);
    expect(lapTotal(0, 0, 526), "a visit from the top that stated nothing has nothing").toBe(0);
    expect(lapTotal(0, 520, 0), "a lap that opened on no total has nothing").toBe(0);
    // And index.ts uses it, at the one place the wrap is judged.
    expect(CODE).toMatch(/const totalNow = lapTotal\(r\.feedTotal, cursorBefore, rec\.t0\);/);
  });

  it("the verification stamp never publishes a mid-feed zero as '0 open'", () => {
    expect(stampFeedTotal(526, 0, 0)).toBe(526);
    expect(stampFeedTotal(0, 0, 0), "an empty board read from the top is an honest 0").toBe(0);
    expect(stampFeedTotal(undefined, 0, 0), "a vendor that states no total stays null").toBe(null);
    expect(stampFeedTotal(0, 260, 526), "mid-feed: the lap's t0").toBe(526);
    expect(stampFeedTotal(0, 260, 0), "mid-feed with no lap: leave the column out, the last stated total stands").toBe(undefined);
    // The upsert leaves the column out on undefined, rather than writing null over the last good total.
    expect(CODE).toMatch(/const stampTotal = stampFeedTotal\(r\.feedTotal, cursorBefore, deepLaps\[lapKey\]\?\.t0\);/);
    expect(CODE).toMatch(/\.\.\.\(stampTotal === undefined \? \{\} : \{ feed_total: stampTotal \}\)/);
  });

  it("fetchWorkday keeps the visit's own page-0 total for the WRAP arithmetic", async () => {
    // T-Mobile answers offsets >= 2,000 with page 0 again and total 2,000; the
    // wrap at `advanced >= feedTotal` is what stops the walk there instead of
    // re-reading page 0 as offset 2,000 forever.
    const visits = await walk(4_000, { wrapsAt2000: true });
    expect(visits.map((v) => v.start)).toEqual([0, 260, 520, 780, 1040, 1300, 1560, 1820, 2080]);
    expect(visits.at(-1)!.feedTotal, "page 0 again, stating the capped total").toBe(2000);
    expect(visits.at(-1)!.nextOffset).toBe(0);
  });
});

describe("an empty first page past the top wraps; from the top it is a refusal (n420)", () => {
  it("a cursor left past a feed that shrank wraps on the feed's end instead of failing every visit", async () => {
    // A tenant that states its total on every page, now 500 open, with the
    // cursor at 520 from the last lap. This used to throw `empty page but
    // total=500`; a failed visit keeps its cursor, so every visit failed the
    // same way until six failures over 40 hours pruned the whole board.
    const t = tenant(500, { totalPastZero: (n) => n });
    const v = await shippedFetchWorkday(t.fetchWithTimeout)({ token: "cvshealth~wd1~CVS_Health_Careers" }, 520);
    expect(v.jobPostings).toHaveLength(0);
    expect(v.nextOffset).toBe(0);
    expect(v.windowed, "a visit past the top is never whole").toBe(true);
    expect(v.feedEnded, "the feed really ends before the cursor, as a short page would say").toBe(true);
  });

  it("an empty page past the top while the total says there is more restarts the lap without claiming an end", async () => {
    const t = tenant(1_500, { totalPastZero: (n) => n, refuseAt: 520 });
    const v = await shippedFetchWorkday(t.fetchWithTimeout)({ token: "cvshealth~wd1~CVS_Health_Careers" }, 520);
    expect(v.jobPostings).toHaveLength(0);
    expect(v.nextOffset).toBe(0);
    expect(v.windowed).toBe(true);
    expect(v.feedEnded, "a lap must not prove absence on a page the vendor would not serve").toBe(false);
  });

  it("from the top, an empty page against a stated total still fails the board (Four Seasons)", async () => {
    const t = tenant(1_963, { refuseAt: 0 });
    await expect(shippedFetchWorkday(t.fetchWithTimeout)({ token: "fourseasons~wd3~Search" }, 0)).rejects.toThrow(/empty page but total=1963/);
  });

  it("the verdict, in its own terms", () => {
    expect(emptyFirstPage(0, 0, 1_963)).toBe("refused");
    expect(emptyFirstPage(0, 0, 0), "an empty board read from the top is just empty").toBe(null);
    expect(emptyFirstPage(520, 0, 500)).toBe("ended");
    expect(emptyFirstPage(520, 0, 0), "a mid-feed zero states nothing, and the page is empty: the end").toBe("ended");
    expect(emptyFirstPage(10_000, 0, 31_000)).toBe("restart");
    expect(emptyFirstPage(520, 20, 1_500), "a page that read anything is not empty").toBe(null);
  });
});
