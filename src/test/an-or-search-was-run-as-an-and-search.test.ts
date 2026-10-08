// @vitest-environment node
/**
 * AN OR SEARCH WAS RUN AS AN AND SEARCH (L8-07).
 *
 * "welder OR fabricator" returned 54 "Welder Fabricator" titles with
 * droppedTerms ["or"] and the note "ignored 'or'"; "welder" alone is 684 and
 * "fabricator" 547. QUERY_FILLER held "or", qText was rebuilt from the kept
 * terms, and websearch_to_tsquery's native OR never saw it.
 *
 * "or" between two real words now stays a term: the tsquery tiers read it as
 * OR (checked in Postgres below) and the substring path binds the groups as OR
 * branches. The shipped queryTerms and the browse binding are run.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { sanitizeTerm } from "../../supabase/functions/_shared/location-terms";
import { salaryTokenInQuery } from "../../supabase/functions/job-board/filters.ts";
import { bootBoardList, calls, type BoardList } from "./helpers/board-list";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const { queryTerms, phraseText } = (() => {
  const pick = (re: RegExp) => re.exec(RAW)?.[0] ?? "";
  const src = [
    pick(/const QUERY_FILLER = new Set\(\[[\s\S]*?\]\);/),
    pick(/function queryTerms\([\s\S]*?\n\}/),
    pick(/function phraseText\([\s\S]*?\n\}/),
    "return { queryTerms, phraseText };",
  ].join("\n");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("sanitizeTerm", "salaryTokenInQuery", js)(sanitizeTerm, salaryTokenInQuery) as {
    queryTerms: (raw: unknown) => { terms: string[]; dropped: string[]; liftedSalary: boolean };
    phraseText: (t: readonly string[]) => string;
  };
})();

describe("or between two words is the searcher's OR", () => {
  it("keeps it as a term and stops calling it ignored", () => {
    expect(queryTerms("welder OR fabricator")).toEqual({ terms: ["welder", "or", "fabricator"], dropped: [], liftedSalary: false });
    expect(phraseText(queryTerms("welder or fabricator").terms)).toBe("welder or fabricator");
  });

  it("an or with no word on one side is still filler", () => {
    expect(queryTerms("or nurse").terms).toEqual(["nurse"]);
    expect(queryTerms("or nurse").dropped).toEqual(["or"]);
    expect(queryTerms("nurse jobs or").terms).toEqual(["nurse"]);
  });

  it("the tsquery tiers read it as OR (Postgres)", async () => {
    const db = new PGlite();
    const r = (await db.query<{ s: string; e: string }>("SELECT websearch_to_tsquery('simple', $1)::text AS s, websearch_to_tsquery('english', $1)::text AS e", ["welder or fabricator"])).rows[0];
    expect(r.s).toBe("'welder' | 'fabricator'");
    expect(r.e).toBe("'welder' | 'fabric'");
    await db.close();
  });
});

describe("the substring path binds the groups as OR branches", () => {
  let board: BoardList;
  beforeAll(async () => { board = await bootBoardList(); });

  it("welder or fabricator, served by the recency path, is one or() of both words", async () => {
    board.reset();
    board.answer((q) => (q.rpc === "search_jobs" ? { data: null, error: { message: "forced fallback" } } : undefined));
    await board.post({ action: "list", q: "welder or fabricator", country: "US", limit: 20, groupSimilar: false });
    const page = board.db.queries.filter((q) => q.table === "job_board_postings" && calls(q, "or") && q.calls.some(([m, a]) => m === "or" && String(a[0]).includes("title.ilike")));
    expect(page.length, "the recency page read ran").toBeGreaterThan(0);
    for (const q of page) {
      const ors = q.calls.filter(([m, a]) => m === "or" && String(a[0]).includes("title.ilike")).map(([, a]) => String(a[0]));
      expect(ors.length, "one OR across the groups, not one AND per word").toBe(1);
      expect(ors[0]).toContain('title.ilike."%welder%"');
      expect(ors[0]).toContain('title.ilike."%fabricator%"');
      expect(ors[0]).not.toContain('"%or%"');
    }
  });
});
