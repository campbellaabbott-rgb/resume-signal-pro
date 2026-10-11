// @vitest-environment node
/**
 * A PLURAL SEARCH WITH A SHORT WORD FOUND ONLY PLURAL TITLES (S11-004).
 *
 * pickRoute sends any query with a token of three characters or fewer, or a
 * stopword, to the SIMPLE route, which matched the whole query with the
 * unstemmed 'simple' configuration. So "QA engineers" matched only titles
 * literally carrying "engineers". Live on .91, 2026-10-11: "QA engineer" 400+
 * against "QA engineers" total 2 (hasMore false); "UX designers" 2 against
 * 184; "HR managers" 4, all one Bosch programme; "AI engineers" 9. And an
 * empty window fell through to the english search, which silently discards
 * "it": "IT technicians" headlined 10,000 with Wynn's "Gaming Technicians" on
 * top and no droppedTerms.
 *
 * The SIMPLE route now matches each short or stop token literally and every
 * other token by english stem (search-routing.ts simpleRouteFilters), and an
 * english search served after it names the stopwords it discarded. The
 * shipped handler (helpers/board-list.ts) answers each title read by running
 * its own textSearch filters in a real Postgres (pglite), as
 * a-plural-search-sorted-by-date-or-pay-missed-every-singular-title does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { bootBoardList, calls, row, type BoardList } from "./helpers/board-list";
import type { Query } from "./helpers/proxy-db";
import { simpleRouteFilters, singularReading, stopwordTokens } from "../../supabase/functions/job-board/search-routing";
import { ROLE_ALIASES } from "../../supabase/functions/job-board/search-alias";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const TITLES: Array<[id: string, title: string]> = [
  ["greenhouse:a:1", "QA Engineer"],
  ["greenhouse:a:2", "Senior QA Engineer"],
  ["greenhouse:a:3", "Quality Assurance Engineer"],
  ["greenhouse:a:4", "Guidewire QA Engineers - India"],
  ["greenhouse:a:5", "Software Engineer"],
  ["greenhouse:a:6", "QA Analyst"],
  ["greenhouse:a:7", "IT Technician"],
  ["greenhouse:a:8", "IT Support Technician III"],
  ["greenhouse:a:9", "Senior Technician - Gaming Technicians"],
  ["greenhouse:a:10", "HR Manager"],
  ["greenhouse:a:11", "Human Resources Manager"],
  ["greenhouse:a:12", "Store Manager"],
  ["greenhouse:a:13", "UX Designer"],
  ["greenhouse:a:14", "Sr UX Designers - London"],
];

let board: BoardList;
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("CREATE TABLE p (id text, title text, company text, department text)");
  for (const [id, title] of TITLES) await pg.query("INSERT INTO p VALUES ($1, $2, 'Acme', NULL)", [id, title]);
  board = await bootBoardList();
});
afterAll(async () => { await pg?.close(); });
beforeEach(() => board.reset());

const TSV: Record<string, (cfg: string) => string> = {
  title_tsv: () => "setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(company, '')), 'B') || setweight(to_tsvector('english', coalesce(department, '')), 'C')",
  title: (cfg) => `to_tsvector('${cfg}', coalesce(title, ''))`,
  company: (cfg) => `to_tsvector('${cfg}', coalesce(company, ''))`,
};

async function matched(q: Query): Promise<string[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [m, a] of q.calls) {
    if (m !== "textSearch") continue;
    const [col, value, opts] = a as [string, string, { type?: string; config?: string }];
    expect(opts.type).toBe("websearch");
    params.push(value);
    where.push(`(${TSV[col](opts.config ?? "simple")}) @@ websearch_to_tsquery('${opts.config ?? "simple"}', $${params.length})`);
  }
  const { rows } = await pg.query<{ id: string }>(`SELECT id FROM p WHERE ${where.join(" AND ")} ORDER BY id`, params);
  return rows.map((r) => r.id);
}
const shape = (q: Query) => JSON.stringify(q.calls.filter(([m]) => m === "textSearch"));

/** Post twice: record the title reads, let Postgres decide them, serve the answer. */
async function post(body: Record<string, unknown>, rpc?: (q: Query) => { data: unknown; error: null } | undefined) {
  await board.post(body);
  const byShape = new Map<string, string[]>();
  for (const q of board.db.queries) {
    if (q.table === "job_board_postings" && calls(q, "textSearch")) byShape.set(shape(q), await matched(q));
  }
  board.reset();
  board.answer((q) => {
    if (rpc && q.rpc) return rpc(q);
    if (q.table !== "job_board_postings" || !calls(q, "textSearch")) return undefined;
    const hit = byShape.get(shape(q));
    if (!hit) return undefined;
    return { data: hit.map((id) => row(id, TITLES.find(([i]) => i === id)![1], { salary_rank_usd: 50_000 })), error: null };
  });
  const r = await board.post(body);
  return { r, titles: ((r.jobs ?? []) as Array<{ title: string }>).map((j) => j.title) };
}

describe("the SIMPLE route stems what the english index can see (S11-004)", () => {
  it("splits a query token by token: short words literal with their aliases, the rest by stem", () => {
    expect(simpleRouteFilters("qa engineers", ROLE_ALIASES)).toEqual({
      filters: [
        { column: "title", query: "qa or quality assurance", config: "simple" },
        { column: "title_tsv", query: "engineers", config: "english" },
        { column: "title", query: "engineers", config: "english" },
      ],
      expansions: ["quality assurance"],
    });
    expect(simpleRouteFilters("it technicians", ROLE_ALIASES)?.filters[0]).toEqual({ column: "title", query: "it", config: "simple" });
    // Nothing to stem, or websearch syntax: the whole-query match stands.
    expect(simpleRouteFilters("rn", ROLE_ALIASES)).toBeNull();
    expect(simpleRouteFilters("qa or tester", ROLE_ALIASES)).toBeNull();
    expect(simpleRouteFilters('"qa lead" engineers', ROLE_ALIASES)).toBeNull();
    expect(singularReading("QA engineers")).toBe("QA engineer");
    expect(stopwordTokens("it or hr technicians")).toEqual(["it"]);
  });

  it("q=QA engineers finds the singular titles and the spelled-out alias, and leads with the exact title", async () => {
    const { r, titles } = await post({ action: "list", q: "QA engineers", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("SIMPLE");
    expect([...titles].sort()).toEqual(["Guidewire QA Engineers - India", "QA Engineer", "Quality Assurance Engineer", "Senior QA Engineer"]);
    expect(titles[0]).toBe("QA Engineer");
    expect(r.total, "a short window is the whole match set").toBe(4);
    expect(r.aliases).toEqual(["quality assurance"]);
  });

  it("q=IT technicians keeps the literal IT and stems the rest; the casino's technicians are not IT", async () => {
    const { r, titles } = await post({ action: "list", q: "IT technicians", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("SIMPLE");
    expect([...titles].sort()).toEqual(["IT Support Technician III", "IT Technician"]);
  });

  it("q=HR managers finds HR and Human Resources managers, not every manager", async () => {
    const { titles } = await post({ action: "list", q: "HR managers", limit: 60, groupSimilar: false });
    expect([...titles].sort()).toEqual(["HR Manager", "Human Resources Manager"]);
  });

  it("the count matches the list, and so does the date order", async () => {
    const { r: c } = await post({ action: "list", q: "QA engineers", countOnly: true });
    expect(c.total).toBe(4);
    const { r, titles } = await post({ action: "list", q: "UX designers", sort: "newest", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("NEWEST");
    expect([...titles].sort()).toEqual(["Sr UX Designers - London", "UX Designer"]);
  });

  it("an english search behind an empty window names the stopword it discarded", async () => {
    // No title holds "it" and "plumber": the window is empty, and search_jobs (english) answers for "plumbers".
    const { r, titles } = await post({ action: "list", q: "it plumbers", limit: 60, groupSimilar: false }, (q) =>
      q.rpc === "search_jobs"
        ? { data: [{ ...row("greenhouse:b:1", "Plumber"), total_rows: 1, related_rows: null, title_match: true, snippet: null }], error: null }
        : undefined);
    expect(titles).toEqual(["Plumber"]);
    expect(r.ranked).toBe(true);
    expect(r.droppedTerms, "the english tsquery searched plumbers alone and must say so").toEqual(["it"]);
  });
});
