// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { normalizeTeamtailor, xmlBlocks } from "../../supabase/functions/job-board/normalize";
import { lapTotal, stampFeedTotal } from "../../supabase/functions/job-board/read-window";
import { codeOf } from "./helpers/strip-comments";

/**
 * A TEAMTAILOR FEED OF A HUNDRED WAS READ AS THE WHOLE BOARD.
 *
 * Sweep S8-002 (2026-10-08). jobs.rss serves 100 items a page and pages with
 * `?offset=N` (groupeetam: 100, 100, 54, then an empty channel at 300;
 * measured 2026-10-08). job-board made one GET and returned no `windowed`,
 * so a board of 535 was a whole read of 100: postings past item 100 were never
 * stored, and each new posting pushed a stored row to item 101, where it was
 * stamped missing and, after the grace, closed as an employer takedown and
 * deleted. A probe of all 2,274 catalogued Teamtailor boards on 2026-10-08
 * found 58 with items at offset 100 (eutalents 2,600, anicuraglobal 642,
 * academee 592, tutoringjobs 534, ...) before Teamtailor began answering 403.
 *
 * This runs the SHIPPED fetchBoard (lifted from index.ts and transpiled, with
 * whatever teamtailor helpers it calls today) against a stand-in feed, with
 * the real normalizeTeamtailor and xmlBlocks.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
const has = (name: string) => new RegExp(`\\n(?:async )?function ${name}\\(`).test(FN);
function lifted(name: string): string {
  const at = FN.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
const num = (name: string, fallback?: number): number => {
  const m = new RegExp(`\\nconst ${name} = ([0-9_]+);`).exec(FN);
  if (!m && fallback !== undefined) return fallback;
  return Number(m![1].replace(/_/g, ""));
};
const MAX = num("MAX_POSTINGS_PER_VISIT");

const item = (n: number) =>
  `<item><title>Role ${n}</title><description>&lt;p&gt;Body ${n}&lt;/p&gt;</description>` +
  `<link>https://acme.teamtailor.com/jobs/${1000 + n}-role-${n}</link><pubDate>Mon, 05 Oct 2026 10:00:00 +0200</pubDate>` +
  `<tt:city>Paris</tt:city><tt:country>France</tt:country></item>`;
const channel = (items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>Acme</title>${items.join("")}</channel></rss>`;

/** A Teamtailor host serving `size` items, 100 a page, by `?offset=`. */
function feed(size: number, opts: { ignoresOffset?: boolean; refuseOffset?: number } = {}) {
  const asked: number[] = [];
  const fetchWithTimeout = async (url: string) => {
    const offset = Number(new URL(url).searchParams.get("offset") ?? "0");
    asked.push(offset);
    if (offset === opts.refuseOffset) return new Response("<html>Forbidden</html>", { status: 403 });
    const from = opts.ignoresOffset ? 0 : offset;
    const items = Array.from({ length: Math.max(0, Math.min(100, size - from)) }, (_, k) => item(from + k));
    return new Response(channel(items), { status: 200, headers: { "content-type": "application/rss+xml" } });
  };
  return { fetchWithTimeout, asked };
}

type Read = { jobs: Array<{ id: string }>; raw: unknown; windowed?: boolean; feedTotal?: number; nextOffset?: number; feedEnded?: boolean; endOffset?: number } | null;
function shippedFetchBoard(f: ReturnType<typeof feed>) {
  const names: Record<string, unknown> = {
    fetchWithTimeout: f.fetchWithTimeout,
    listUrl: (s: { token: string; host?: string }) => `https://${s.host ?? `${s.token}.teamtailor.com`}/jobs.rss`,
    discardBody: () => {},
    normalizeTeamtailor,
    xmlBlocks,
    MAX_POSTINGS_PER_VISIT: MAX,
    TT_PAGE: num("TT_PAGE", 100),
    console: { warn: () => {}, log: () => {}, error: () => {} },
  };
  const src = ["fetchTeamtailor", "fetchBoard"].filter(has).map(lifted).join("\n");
  const keys = Object.keys(names);
  const fetchBoard = new Function(...keys, `${src}\nreturn fetchBoard;`)(...keys.map((k) => names[k]));
  return (startOffset = 0, fail?: (r: string) => void): Promise<Read> =>
    fetchBoard({ name: "Acme", source: "teamtailor", token: "acme" }, fail, startOffset);
}

describe("a Teamtailor board of more than 100 postings is read in pages, never as a whole board of 100", () => {
  it("tutoringjobs-sized (534): the first visit is a window of whole pages that resumes, not a whole read of 100", async () => {
    const f = feed(534);
    const r = (await shippedFetchBoard(f)(0))!;
    expect(r.windowed, "a 100-item page was taken for the whole board; every row past it was closed as a takedown").toBe(true);
    expect(r.jobs.length).toBeGreaterThan(100);
    expect(r.jobs.length).toBeLessThanOrEqual(MAX);
    expect(r.nextOffset).toBe(r.jobs.length);
    expect(r.feedEnded).toBe(false);
    expect(f.asked).toEqual([0, 100]);
  });

  it("the visit that reaches the end states where the feed ended, so a lap can prove absence", async () => {
    const f = feed(534);
    const r = (await shippedFetchBoard(f)(400))!;
    expect(f.asked).toEqual([400, 500]);
    expect(r.jobs).toHaveLength(134);
    expect(r.windowed, "a visit that did not start at the top is never a whole read").toBe(true);
    expect(r.nextOffset).toBe(0);
    expect(r.feedEnded).toBe(true);
    expect(r.endOffset).toBe(534);
    // read-window's lap inputs: the total this visit states is what the lap is judged against.
    expect(lapTotal(r.feedTotal, 400, 0)).toBe(534);
  });

  it("every id on the board is served across the visits, once the cursor walks it", async () => {
    const f = feed(534);
    const read = shippedFetchBoard(f);
    const ids = new Set<string>();
    let cursor = 0;
    for (let v = 0; v < 5; v++) {
      const r = (await read(cursor))!;
      for (const j of r.jobs) ids.add(j.id);
      cursor = r.nextOffset ?? 0;
      if (cursor === 0) break;
    }
    expect(ids.size).toBe(534);
  });

  it("a host that ignores ?offset serves its first page again: one window, no cursor, no claim of an end", async () => {
    const f = feed(534, { ignoresOffset: true });
    const r = (await shippedFetchBoard(f)(0))!;
    expect(r.jobs).toHaveLength(100);
    expect(r.windowed).toBe(true);
    expect(r.nextOffset).toBe(0);
    expect(r.feedEnded).toBe(false);
  });

  it("a later page refused (Teamtailor answers 403 when it throttles) is a window that resumes there", async () => {
    const f = feed(534, { refuseOffset: 100 });
    const r = (await shippedFetchBoard(f)(0))!;
    expect(r.jobs).toHaveLength(100);
    expect(r.windowed).toBe(true);
    expect(r.feedEnded).toBe(false);
    expect(r.nextOffset).toBe(100);
  });

  it("a 200 that is not the feed (a bot wall) at depth is a failed visit, never the end of the feed a lap could prove on", async () => {
    const f = feed(534);
    const wall = async (url: string) => (Number(new URL(url).searchParams.get("offset") ?? "0") === 300
      ? new Response("<html><body>Just a moment...</body></html>", { status: 200 })
      : f.fetchWithTimeout(url));
    const reasons: string[] = [];
    const r = await shippedFetchBoard({ ...f, fetchWithTimeout: wall })(300, (m) => reasons.push(m));
    expect(r, "an empty-looking answer at the cursor was read as the feed ending").toBeNull();
    expect(reasons).toHaveLength(1);
    const mid = await shippedFetchBoard({ ...f, fetchWithTimeout: async (url: string) => (Number(new URL(url).searchParams.get("offset") ?? "0") === 100
      ? new Response("<html></html>", { status: 200 })
      : f.fetchWithTimeout(url)) })(0);
    expect(mid!.jobs).toHaveLength(100);
    expect(mid!.windowed).toBe(true);
    expect(mid!.feedEnded).toBe(false);
  });

  it("a first page refused fails the board, as before", async () => {
    const reasons: string[] = [];
    const r = await shippedFetchBoard(feed(534, { refuseOffset: 0 }))(0, (m) => reasons.push(m));
    expect(r).toBeNull();
    expect(reasons).toEqual(["HTTP 403"]);
  });
});

describe("a board inside one visit is still a whole read, and states no total of its own", () => {
  it("40 postings: one request, a full read that can close a posting the same day", async () => {
    const f = feed(40);
    const r = (await shippedFetchBoard(f)(0))!;
    expect(f.asked).toEqual([0]);
    expect(r.jobs).toHaveLength(40);
    expect(r.windowed ?? false).toBe(false);
    expect(r.nextOffset ?? 0).toBe(0);
    // n130: our own count is not the employer's stated total; the stamp keeps null.
    expect(stampFeedTotal(r.feedTotal, 0, 0)).toBeNull();
  });

  it("exactly 100: the empty second page proves the first was the whole board", async () => {
    const f = feed(100);
    const r = (await shippedFetchBoard(f)(0))!;
    expect(f.asked).toEqual([0, 100]);
    expect(r.jobs).toHaveLength(100);
    expect(r.windowed).toBe(false);
  });

  it("descriptions are read from every page of the visit", async () => {
    const r = (await shippedFetchBoard(feed(150))(0))!;
    expect(typeof r.raw).toBe("string");
    expect(xmlBlocks(r.raw as string, "item")).toHaveLength(150);
  });
});

describe("a Teamtailor visit reserves what it can bring back", () => {
  it("a visit to a big board never brings back more postings than the start gate reserved for it", async () => {
    const vendors = /const CAPPED_VISIT_VENDORS = new Set\(\[([^\]]*)\]\)/.exec(CODE)![1];
    expect(vendors).toMatch(/"teamtailor"/);
    // The shipped reservation expression, evaluated over the shipped vendor set.
    const expr = /const reserve = ([^;]+);/.exec(CODE)![1];
    const reserve = new Function("inHotPhase", "deepTokens", "CAPPED_VISIT_VENDORS", "s", "MAX_POSTINGS_PER_VISIT", "COLD_BOARD_RESERVE", `return ${expr};`)(
      false, new Set(), new Set(JSON.parse(`[${vendors}]`)), { source: "teamtailor", token: "eutalents" }, MAX, num("COLD_BOARD_RESERVE"),
    );
    const read = shippedFetchBoard(feed(2600));
    for (const from of [0, 200, 1000]) {
      const r = (await read(from))!;
      expect(r.jobs.length, `a visit from ${from} brought back ${r.jobs.length} against a reservation of ${reserve}`).toBeLessThanOrEqual(reserve);
    }
  });
});
