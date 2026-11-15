// @vitest-environment node
/**
 * D7 (board .102): a Workable board whose details=true list is past the
 * per-response bound went dark, every visit. Now the oversize retry reads the
 * same account with details=false (a list with no descriptions), the visit
 * stores the rows with their text deferred, and the description sweep fills
 * that text one posting at a time from Workable's per-job endpoint: at most
 * WORKABLE_DETAIL_PER_HOP a hop, never two in flight, at least 1,100 ms apart,
 * stopping 20 s before the hop's wall. Three tokens are held dark until a
 * mill screen and an owner call.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { codeOf } from "./helpers/strip-comments";
import { runVisit, workableHeld } from "./helpers/slice-worker";
import { normalizeWorkable } from "../../supabase/functions/job-board/normalize";
import { BOARD_DESC_SOURCES, DETAIL_DESC_SOURCES } from "../../supabase/functions/job-board/descriptions";

const FN = resolve(__dirname, "../../supabase/functions/job-board");
const RAW = readFileSync(`${FN}/index.ts`, "utf8");
const CODE = codeOf(RAW);
const toJs = (ts: string) => transformSync(ts, { loader: "ts" }).code;
const fnDecl = (head: string): string => {
  const i = RAW.indexOf(`\n${head}`);
  if (i < 0) throw new Error(`${head} not found at the top level of index.ts — re-anchor this test`);
  return RAW.slice(i + 1, RAW.indexOf("\n}\n", i) + 2);
};
const constLine = (name: string): string => {
  const m = RAW.match(new RegExp(`^const ${name}\\b[^;\\n]*;`, "m"));
  if (!m) throw new Error(`const ${name} not found at the top level of index.ts`);
  return m[0];
};

const BOARD = { source: "workable", token: "acme-gigs" };
const feed = (n: number) => ({ jobs: Array.from({ length: n }, (_, k) => ({ shortcode: `S${k}`, title: `Role ${k}`, url: `https://apply.workable.com/acme-gigs/j/S${k}/`, city: "Austin", country: "United States", created_at: "2026-11-01" })) });

describe("the oversize retry reads a Workable board without its details", () => {
  it("an oversize Workable board outside the held set is read again with details=false, under the board's reservation, and lands", async () => {
    const x = await runVisit({ board: BOARD, failReason: "oversize 9.1MB", bare: () => ({ jobs: [1, 2, 3], raw: feed(3) }), inFlightReserve: 7, reserve: 40 });
    expect(x.bareCalls).toEqual([{ token: "acme-gigs", reserveDuring: 47 }]);
    expect(x.inFlightReserve).toBe(7);
    expect(x.r?.jobs.length).toBe(3);
    expect(x.fetchedInSlice).toBe(3);
    expect(x.failed).toEqual([]);
    expect(x.deferred, "a board that read is not deferred").toEqual([]);
    expect(x.streamCalls, "Workable has no stream spec").toEqual([]);
  });

  it("a held token is never read again: nogigiddy, weekday-1 and hire-resolve stay dark as they are today", async () => {
    expect([...workableHeld()].sort()).toEqual(["hire-resolve-the-top-recruitment-agency", "nogigiddy", "weekday-1"]);
    for (const token of workableHeld()) {
      const x = await runVisit({ board: { source: "workable", token }, failReason: "oversize 9.1MB", bare: () => ({ jobs: [1], raw: feed(1) }) });
      expect(x.bareCalls, token).toEqual([]);
      expect(x.r, token).toBeNull();
    }
  });

  it("only an oversize verdict on a Workable board starts it", async () => {
    for (const [board, failReason] of [[BOARD, "HTTP 500"], [BOARD, "timeout"], [{ source: "recruitee", token: "acme" }, "oversize 9.1MB"]] as const) {
      const x = await runVisit({ board, failReason, bare: () => ({ jobs: [1], raw: feed(1) }) });
      expect(x.bareCalls, `${board.source} ${failReason}`).toEqual([]);
    }
  });

  it("a bare read that also fails leaves the board to the oversize branch it reached before", async () => {
    const x = await runVisit({ board: BOARD, failReason: "oversize 9.1MB", bare: () => null });
    expect(x.bareCalls.length).toBe(1);
    expect(x.r).toBeNull();
    expect(x.oversized.length + x.deferred.length, "the oversize branch still ran").toBeGreaterThan(0);
  });

  it("a board read bare stores its rows with the description column left alone, so the sweep fills it", () => {
    expect(CODE).toMatch(/let descsDeferred = bareRead;/);
    expect(CODE).toMatch(/const lightDescs = isLight\(s\) \|\| descsDeferred;/);
    expect(CODE, "not light mode: the board never joins DYNAMIC_LIGHT (n017)").not.toMatch(/enrolDynamicLight\([^)]*\)[^;]*bareRead|bareRead[^;]*enrolDynamicLight/);
  });

  it("readWorkableBare asks for details=false through listUrl, releases a refused body, and normalises a landed one", async () => {
    const listTs = RAW.slice(RAW.indexOf("\nconst listUrl = ") + 1, RAW.indexOf(";\n", RAW.indexOf("\nconst listUrl = ")) + 2);
    const make = (res: Response) => {
      const urls: string[] = [];
      const discarded: Response[] = [];
      const fn = new Function("isLight", "fetchWithTimeout", "discardBody", "normalizeWorkable", `${toJs(listTs + fnDecl("async function readWorkableBare("))}\nreturn readWorkableBare;`)(
        () => false, async (u: string) => { urls.push(u); return res; }, (r: Response) => { discarded.push(r); }, normalizeWorkable,
      ) as (s: unknown) => Promise<{ jobs: unknown[]; raw: unknown } | null>;
      return { fn, urls, discarded };
    };
    const ok = make(new Response(JSON.stringify(feed(2)), { status: 200 }));
    const r = await ok.fn({ ...BOARD, name: "Acme" });
    expect(ok.urls).toEqual(["https://apply.workable.com/api/v1/widget/accounts/acme-gigs?details=false"]);
    expect(r?.jobs).toEqual(normalizeWorkable(feed(2), "Acme", "acme-gigs"));
    const refused = make(new Response("no", { status: 429 }));
    expect(await refused.fn({ ...BOARD, name: "Acme" })).toBeNull();
    expect(refused.discarded.length, "the refused body is released").toBe(1);
  });
});

describe("the description sweep fills a Workable board too big to read whole, one posting at a time", () => {
  const filler = new Function(`${toJs([constLine("WORKABLE_DETAIL_PER_HOP"), constLine("WORKABLE_DETAIL_GAP_MS"), fnDecl("async function fillWorkableDetails<R>(")].join("\n"))}\nreturn fillWorkableDetails;`)() as <R>(
    rows: readonly R[], read: (r: R) => Promise<string | null>, write: (r: R, t: string) => Promise<boolean>,
    clock: { now: () => number; sleep: (ms: number) => Promise<unknown> }, deadlineAt: number,
  ) => Promise<{ asked: number; filled: number }>;
  const virtual = (readMs = 300) => {
    let t = 0;
    let inFlight = 0, maxInFlight = 0;
    const starts: number[] = [];
    return {
      clock: { now: () => t, sleep: async (ms: number) => { t += ms; } },
      read: async (row: number) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); starts.push(t);
        t += readMs;
        inFlight--;
        return row % 4 === 3 ? null : `text ${row}`;
      },
      starts, get maxInFlight() { return maxInFlight; }, get t() { return t; },
    };
  };

  it("asks one posting at a time, at least 1,100 ms apart, and writes what came back", async () => {
    const v = virtual();
    const written: number[] = [];
    const f = await filler(Array.from({ length: 10 }, (_, k) => k), v.read, async (r) => { written.push(r); return true; }, v.clock, 1e9);
    expect(f).toEqual({ asked: 10, filled: 8 });
    expect(written).toEqual([0, 1, 2, 4, 5, 6, 8, 9]);
    expect(v.maxInFlight, "never two in flight").toBe(1);
    for (let i = 1; i < v.starts.length; i++) expect(v.starts[i] - v.starts[i - 1], `gap ${i}`).toBeGreaterThanOrEqual(1_100);
  });

  it("asks at most 60 a hop", async () => {
    const v = virtual(0);
    const f = await filler(Array.from({ length: 120 }, (_, k) => k), v.read, async () => true, v.clock, 1e9);
    expect(f.asked).toBe(60);
  });

  it("stops before the deadline instead of starting a read it cannot finish inside the hop", async () => {
    const v = virtual(300);
    const f = await filler(Array.from({ length: 60 }, (_, k) => k), v.read, async () => true, v.clock, 5_000);
    expect(f.asked).toBe(5); // reads start at 0, 1100, 2200, 3300, 4400; the sixth would start at 5500
    expect(v.starts.every((s) => s < 5_000)).toBe(true);
  });

  it("a read or a write that throws costs that row only", async () => {
    const v = virtual(0);
    const f = await filler([1, 2, 3], async (r) => { if (r === 1) throw new Error("x"); return "t"; }, async (r) => { if (r === 2) throw new Error("y"); return true; }, v.clock, 1e9);
    expect(f).toEqual({ asked: 3, filled: 1 });
  });

  it("the per-job read is Workable's v2 job endpoint, not the account's whole details=true widget", () => {
    const i = CODE.indexOf("async function fetchVendorDetail(");
    const body = CODE.slice(i, CODE.indexOf("\n}\n", i));
    expect(body).toContain("https://apply.workable.com/api/v2/accounts/${src.token}/jobs/${encodeURIComponent(externalId)}");
    expect(CODE, "no reader asks for the whole account with its details any more").not.toContain("api/v1/widget/accounts/${src.token}?details=true");
    expect(readFileSync(resolve(__dirname, "../../supabase/functions/fetch-job-posting/extract.ts"), "utf8"), "the endpoint fetch-job-posting already reads").toContain("apply.workable.com/api/v2/accounts/");
  });

  it("the board lane reads a registered Workable board a posting at a time and stays on it while that fills; workable is not a detail-sweep vendor", () => {
    expect(CODE).toMatch(/const whole = !\(b\.source === "workable" && \(await loadOversizeBoards\(client\), OVERSIZE_BOARDS\.has\(boardKeyOf\(b\)\)\)\);/);
    expect(CODE).toMatch(/const r = whole \? await readBoardForDetail\(b\) : null;/);
    expect(CODE).toMatch(/const f = await fillWorkableDetails\(own, async \(row\) => \(await fetchVendorDetail\(b, row\.id, row\.id\.split\(":"\)\.slice\(2\)\.join\(":"\)\)\)\.text, fill, \{ now: Date\.now, sleep: [^}]*\}, Date\.now\(\) \+ SLICE_WALL_BUDGET_MS - 20_000\);/);
    expect(CODE).toMatch(/stay = f\.filled > 0 && own\.length > f\.asked;/);
    expect(CODE).toMatch(/if \(!stay\) bi \+= 1;/);
    expect(DETAIL_DESC_SOURCES as readonly string[], "the description mutual-exclusion guard holds").not.toContain("workable");
    expect(BOARD_DESC_SOURCES as readonly string[]).toContain("workable");
  });
});
