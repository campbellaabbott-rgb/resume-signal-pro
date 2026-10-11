// @vitest-environment node
/**
 * A PLURAL SEARCH SORTED BY DATE OR PAY MISSED EVERY SINGULAR TITLE.
 *
 * Sweep S8-027 (2026-10-08). The NEWEST and SALARY exits matched titles with
 * the simple (unstemmed) configuration and ftsQuery's possessive variant, so
 * q=teachers became websearch 'teachers' | 'teacher' & 's': a title saying
 * "Teacher" never matched. Live, q=teachers sort=newest ended at 243 rows
 * (hasMore false) while countOnly counted 4,610, under a caption promising
 * every posting whose title matches.
 *
 * The shipped handler (helpers/board-list.ts) answers each posting read by
 * running its own textSearch filters in a real Postgres (pglite) over a few
 * titles, so the matcher is judged by what Postgres does with it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { bootBoardList, calls, row, type BoardList } from "./helpers/board-list";
import type { Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const TITLES: Array<[id: string, title: string, company: string]> = [
  ["greenhouse:a:1", "Teacher", "Acme Schools"],
  ["greenhouse:a:2", "Teacher of Science", "Acme Schools"],
  ["greenhouse:a:3", "Substitute Teachers Pool", "Acme Schools"],
  ["greenhouse:a:4", "Registered Nurse", "Teachers Federal Credit Union"],
  ["greenhouse:a:5", "Engineer II (Men's Health)", "Acme Health"],
  ["greenhouse:a:6", "Line Cook", "Grandma's Kitchen"],
];

let board: BoardList;
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("CREATE TABLE p (id text, title text, company text, department text)");
  for (const [id, title, company] of TITLES) await pg.query("INSERT INTO p VALUES ($1, $2, $3, NULL)", [id, title, company]);
  board = await bootBoardList();
});
afterAll(async () => { await pg?.close(); });
beforeEach(() => board.reset());

const TSV: Record<string, (cfg: string) => string> = {
  // The stored generated column (20260718180000).
  title_tsv: () => "setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(company, '')), 'B') || setweight(to_tsvector('english', coalesce(department, '')), 'C')",
  title: (cfg) => `to_tsvector('${cfg}', coalesce(title, ''))`,
  company: (cfg) => `to_tsvector('${cfg}', coalesce(company, ''))`,
};

/** The ids a posting read's textSearch filters select, as Postgres decides it. */
async function matched(q: Query): Promise<string[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [m, a] of q.calls) {
    if (m !== "textSearch") continue;
    const [col, value, opts] = a as [string, string, { type?: string; config?: string }];
    expect(opts.type, "every title matcher here is websearch").toBe("websearch");
    const cfg = opts.config ?? "simple";
    expect(["simple", "english"]).toContain(cfg);
    params.push(value);
    where.push(`(${TSV[col](cfg)}) @@ websearch_to_tsquery('${cfg}', $${params.length})`);
  }
  const { rows } = await pg.query<{ id: string }>(`SELECT id FROM p WHERE ${where.join(" AND ")} ORDER BY id`, params);
  return rows.map((r) => r.id);
}

/** A read's identity across the two passes: its text filters (the clock-bound ones differ). */
const shape = (q: Query) => JSON.stringify(q.calls.filter(([m]) => m === "textSearch"));

/** Post, resolving every textSearch read through pglite first. */
async function post(body: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  // Two passes: the first records the reads (answered empty), pglite decides
  // what each selects, the second serves those rows to the same reads.
  await board.post(body);
  const byShape = new Map<string, string[]>();
  for (const q of board.db.queries) {
    if (q.table === "job_board_postings" && calls(q, "textSearch")) byShape.set(shape(q), await matched(q));
  }
  board.reset();
  board.answer((q) => {
    if (q.table !== "job_board_postings" || !calls(q, "textSearch")) return undefined;
    const hit = byShape.get(shape(q));
    if (!hit) return undefined;
    const rows = hit.map((id) => {
      const [, title, company] = TITLES.find(([i]) => i === id)!;
      return row(id, title, { company, salary_rank_usd: 50_000, ...extra });
    });
    return { data: rows, error: null };
  });
  const r = await board.post(body);
  return { r, titles: ((r.jobs ?? []) as Array<{ title: string }>).map((j) => j.title) };
}

describe("a plural query sorted by date or pay finds the singular titles (S8-027)", () => {
  it("q=teachers sort=newest serves the plain 'Teacher' titles, and only titles", async () => {
    const { r, titles } = await post({ action: "list", q: "teachers", sort: "newest", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("NEWEST");
    expect(r.sortMatcher, "the caption's claim is still a title claim").toBe("title");
    expect(titles, "the simple matcher found only the literal plural").toEqual(
      expect.arrayContaining(["Teacher", "Teacher of Science", "Substitute Teachers Pool"]));
    expect(titles, "an employer named Teachers is not a title match").not.toContain("Registered Nurse");
  });

  it("q=teachers sort=salary serves the plain 'Teacher' titles too", async () => {
    const { r, titles } = await post({ action: "list", q: "teachers", sort: "salary", limit: 60, groupSimilar: false });
    expect(r.searchRoute).toBe("SALARY");
    expect(titles).toEqual(expect.arrayContaining(["Teacher", "Teacher of Science", "Substitute Teachers Pool"]));
    expect(titles).not.toContain("Registered Nurse");
  });

  it("a token the english index cannot see keeps the simple matcher (q=it teachers)", async () => {
    await post({ action: "list", q: "it teachers", sort: "newest", limit: 60, groupSimilar: false });
    // Recorded on the second pass. Since 20261009101000's wave (S11-004) the
    // SIMPLE route stems the words english CAN see ("teachers" finds
    // "Teacher"), but "it", which the english config discards, is matched
    // literally on every read and is never handed to an english matcher.
    const reads = board.db.queries.filter((q) => q.table === "job_board_postings" && calls(q, "textSearch"));
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) {
      const ts = q.calls.filter(([m]) => m === "textSearch").map(([, a]) => ({ col: a[0], q: String(a[1]), cfg: (a[2] as { config: string }).config }));
      expect(ts.some((t) => t.cfg === "simple" && /(^|\s)it(\s|$)/.test(t.q)), JSON.stringify(ts)).toBe(true);
      expect(ts.filter((t) => t.cfg === "english" && /(^|\s)it(\s|$)/.test(t.q)), JSON.stringify(ts)).toEqual([]);
    }
  });
});

describe("the possessive variant is a phrase, not two loose words (S8-027)", () => {
  it("the rescue tier's title half no longer matches a stray 's' anywhere in a title", async () => {
    // search_jobs answers nothing, so the simple-config rescue tier runs.
    const { titles } = await post({ action: "list", q: "engineers", limit: 60, groupSimilar: false });
    expect(titles, "'engineer' & 's' matched Men's Health").not.toContain("Engineer II (Men's Health)");
  });

  it("and still finds the possessive employer it exists for", async () => {
    const { titles } = await post({ action: "list", q: "grandmas", limit: 60, groupSimilar: false });
    expect(titles).toContain("Line Cook");
  });
});
