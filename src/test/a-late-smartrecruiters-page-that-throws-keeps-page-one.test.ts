// @vitest-environment node
/**
 * S14X-121 (board .102): fetchSmartRecruiters walked its later pages with no
 * guard. A page that timed out (fetchWithTimeout throws on its abort) or whose
 * body broke mid-read threw out of the whole read, so page one, already in
 * hand, was discarded with it and the visit counted as a vendor failure. Now a
 * later page that throws ends the walk the way a refused one already did: its
 * body is released, page one is kept, the read is windowed (so nothing is
 * pruned on it), and the slice record names the board in srPartial.
 *
 * Runs the shipped fetchSmartRecruiters, lifted from index.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const at = FN.indexOf("async function fetchSmartRecruiters(");
if (at < 0) throw new Error("fetchSmartRecruiters moved; re-point this test");
const SRC = ts.transpileModule(FN.slice(at, FN.indexOf("\n}\n", at) + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type R = { content: unknown[]; windowed: boolean; feedTotal: number; nextOffset: number; feedEnded: boolean };
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
const page = (offset: number, n: number, total: number) => json({ totalFound: total, content: Array.from({ length: n }, (_, k) => ({ id: `p${offset + k}` })) });

function read(late: "timeout" | "broken-body" | "503" | null, total = 250) {
  const sliceReads = { srPartial: [] as string[] };
  const discarded: unknown[] = [];
  const deps = {
    listUrl: () => "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100",
    fetchWithTimeout: async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset") ?? "0");
      if (offset === 0) return page(0, 100, total);
      if (late === "timeout") throw new DOMException("The signal has been aborted", "AbortError");
      if (late === "broken-body") return new Response("{\"totalFound\": 250, \"content\": [", { status: 200 });
      if (late === "503") return new Response("busy", { status: 503 });
      return page(offset, Math.min(100, total - offset), total);
    },
    discardBody: (r: unknown) => { discarded.push(r); },
    sliceReads,
    boardKeyOf: (s: { source: string; token: string }) => `${s.source}:${s.token}`,
    SR_PAGE: 100, SR_PAGE_CAP: 20, SR_CAP: 2000, MAX_POSTINGS_PER_VISIT: 250,
  };
  const fn = new Function(...Object.keys(deps), `${SRC}\nreturn fetchSmartRecruiters;`)(...Object.values(deps)) as (s: unknown, o?: number) => Promise<R>;
  return fn({ source: "smartrecruiters", token: "acme" }, 0).then((r) => ({ r, srPartial: sliceReads.srPartial, discarded }));
}

describe("a late SmartRecruiters page that throws keeps page one", () => {
  for (const late of ["timeout", "broken-body", "503"] as const) {
    it(`a ${late} on page two keeps the 100 rows of page one, windowed, and names the board`, async () => {
      const { r, srPartial } = await read(late);
      expect(r.content).toHaveLength(100);
      expect(r.windowed, "the unread pages must not be stamped missing").toBe(true);
      expect(r.feedEnded).toBe(false);
      expect(r.nextOffset, "the next visit resumes after page one").toBe(100);
      expect(srPartial).toEqual(["smartrecruiters:acme"]);
    });
  }

  it("a refused or broken body is released, and a timeout with no response releases nothing", async () => {
    expect((await read("503")).discarded.filter(Boolean)).toHaveLength(1);
    expect((await read("broken-body")).discarded.filter(Boolean)).toHaveLength(1);
    expect((await read("timeout")).discarded.filter(Boolean)).toHaveLength(0);
  });

  it("a whole read names nothing", async () => {
    const { r, srPartial } = await read(null);
    expect(r.content).toHaveLength(250);
    expect(r.windowed).toBe(false);
    expect(srPartial).toEqual([]);
  });

  it("page one failing is still the vendor failure it was", async () => {
    const deps = {
      listUrl: () => "https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100",
      fetchWithTimeout: async () => { throw new DOMException("aborted", "AbortError"); },
      discardBody: () => {}, sliceReads: { srPartial: [] }, boardKeyOf: () => "x",
      SR_PAGE: 100, SR_PAGE_CAP: 20, SR_CAP: 2000, MAX_POSTINGS_PER_VISIT: 250,
    };
    const fn = new Function(...Object.keys(deps), `${SRC}\nreturn fetchSmartRecruiters;`)(...Object.values(deps)) as (s: unknown) => Promise<R>;
    await expect(fn({ source: "smartrecruiters", token: "acme" })).rejects.toThrow(/aborted/);
  });
});
