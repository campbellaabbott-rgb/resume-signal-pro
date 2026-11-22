// @vitest-environment node
/**
 * A COMPOUND ROLE WORD IS ONE WORD IN EVERY SPELLING (job-board .103, search reach).
 *
 * Measured live 2026-11-17 with labelled probes: "back end developer", the
 * board's most-searched term in Lovable's 14-day read, found 32 jobs while
 * "backend developer" found 281 and "backend engineer" 1,079. "front end
 * developer" 70 against "frontend developer" 158; "dev ops engineer" 21
 * against "devops engineer" 1,117; "a.i. engineer" 3 rows, all junk
 * ("Engineer I-Bahia Mar ... a Doubletree"). The three letters of "end", "dev"
 * and "ops" sent the spaced spelling to the SIMPLE route, which matched it
 * literally; the hyphen made "back-end" one more literal word; and "a.i." was
 * read as the words "a" and "i".
 *
 * So the query's compound role words are joined once, before routing
 * (search-alias.ts joinCompoundRoleWords), and the alias table carries the
 * spaced spelling back into every title tier. Inside a software family only,
 * developer finds engineer and engineer finds developer (roleSwapApplies);
 * never for sales, business, property, real estate, land, product or the other
 * families where the board's own titles show the two words are two jobs.
 *
 * Measured on the corpus below (real titles from the board, judged by
 * helpers/search-reach.ts relevant(), never by either matcher): recall rises
 * and precision does not fall against 0b9d5dfab, no query loses a relevant
 * title it found, and queries outside the software families read exactly as
 * before.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expandQuery, joinCompoundRoleWords, ROLE_ALIASES, roleAliasesFor, roleSwapApplies } from "../../supabase/functions/job-board/search-alias";
import { pickRoute, simpleRouteFilters } from "../../supabase/functions/job-board/search-routing";
import { ftsQuery, ftsSafe, loadPool, matchedRows, relevant, TITLE_TSV, titleReads, type PoolRow, type SearchModules } from "./helpers/search-reach";
import { bootBoardList, row, type BoardList } from "./helpers/board-list";
import type { Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const SHIPPED: SearchModules = {
  join: joinCompoundRoleWords,
  expandQuery,
  aliasesFor: roleAliasesFor,
  pickRoute: (q, a) => pickRoute(q, a),
  simpleRouteFilters: (s, a) => simpleRouteFilters(s, a),
};

describe("the join", () => {
  it("joins the space, hyphen and joined spellings beside a role or software word", () => {
    expect(joinCompoundRoleWords("back end developer")).toBe("backend developer");
    expect(joinCompoundRoleWords("back-end developer")).toBe("backend developer");
    expect(joinCompoundRoleWords("backend developer")).toBe("backend developer");
    expect(joinCompoundRoleWords("sr back end developer")).toBe("sr backend developer");
    expect(joinCompoundRoleWords("react front end developer")).toBe("react frontend developer");
    expect(joinCompoundRoleWords("front-end engineer")).toBe("frontend engineer");
    expect(joinCompoundRoleWords("front end engineering manager")).toBe("frontend engineering manager");
  });

  it("joins full stack, dev ops, dev sec ops and a.i. wherever they stand", () => {
    expect(joinCompoundRoleWords("full-stack developer")).toBe("fullstack developer");
    expect(joinCompoundRoleWords("full stack")).toBe("fullstack");
    expect(joinCompoundRoleWords("dev ops engineer")).toBe("devops engineer");
    expect(joinCompoundRoleWords("dev-ops engineer")).toBe("devops engineer");
    expect(joinCompoundRoleWords("dev sec ops engineer")).toBe("devsecops engineer");
    expect(joinCompoundRoleWords("a.i. engineer")).toBe("ai engineer");
    expect(joinCompoundRoleWords("a.i engineer")).toBe("ai engineer");
  });

  it("leaves a grocery's front end, a bare back end and a quoted phrase as typed", () => {
    for (const q of ["front end manager", "front end associate", "front end supervisor", "back end", "front end", '"back end developer"', "dev", "aid worker"]) {
      expect(joinCompoundRoleWords(q), q).toBe(q);
    }
  });
});

describe("developer and engineer trade places inside a software family only", () => {
  it("swaps for software families", () => {
    for (const q of ["software engineer", "backend developer", "frontend engineer", "fullstack developer", "devops engineer", "ai engineer", "machine learning developer", "web developer", "java engineer", "salesforce developer"]) {
      expect(roleSwapApplies(q), q).toBe(true);
    }
  });

  it("never where the board's titles show two jobs", () => {
    for (const q of ["business developer", "sales engineer", "software sales engineer", "property developer", "real estate developer", "land developer", "product developer", "product engineer", "web content developer", "learning developer", "curriculum developer", "applications developer", "application engineer", "civil engineer", "data engineer", "developer", "engineer", "ai solutions engineer"]) {
      expect(roleSwapApplies(q), q).toBe(false);
    }
    expect(roleAliasesFor("business developer")).toBe(ROLE_ALIASES);
  });

  it("expandQuery reads every spelling and both role words", () => {
    const { q, expansions } = expandQuery("backend developer");
    expect(q.split(" OR ").sort()).toEqual(["back end developer", "back end engineer", "backend developer", "backend engineer"]);
    expect(expansions).toEqual(["back end", "engineer"]);
    expect(expandQuery("software engineer").q.split(" OR ")).toEqual(["software engineer", "software developer", "swe"]);
    expect(expandQuery("devops engineer").q).toContain("dev ops engineer");
    expect(expandQuery("business developer")).toEqual({ q: "business developer", expansions: [] });
    expect(expandQuery("sales engineer")).toEqual({ q: "sales engineer", expansions: [] });
  });
});

type Fixture = {
  baseCommit: string;
  families: Record<string, { pool: PoolRow[]; queries: Array<{ q: string; live: { total: number | null }; base: number[] }> }>;
};
const FX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/search-reach-corpus-2026-11-17.json"), "utf8")) as Fixture;

describe("the corpus: real titles from the board, judged without either matcher", () => {
  let pg: PGlite;
  const out: Array<{ fam: string; q: string; rel: Set<number>; base: number[]; now: number[]; pool: PoolRow[] }> = [];
  beforeAll(async () => {
    pg = new PGlite();
    for (const [fam, f] of Object.entries(FX.families)) {
      await loadPool(pg, f.pool);
      for (const { q, base } of f.queries) {
        const now = await matchedRows(pg, titleReads(q, SHIPPED).filters);
        const rel = new Set(f.pool.map((r, i) => (relevant(q, r.t) ? i : -1)).filter((i) => i >= 0));
        out.push({ fam, q, rel, base, now, pool: f.pool });
      }
    }
  });
  afterAll(async () => { await pg?.close(); });

  it("holds at least 300 query/title cases, the 13 most-searched terms among them", () => {
    const cases = out.reduce((n, x) => n + x.pool.length, 0);
    expect(cases).toBeGreaterThanOrEqual(300);
    const qs = new Set(out.map((x) => x.q));
    for (const q of ["back end developer", "nurse", "software engineer", "front end developer", "registered nurse", "ai engineer", "customer success", "privacy", "product designer", "data analyst", "devops engineer", "full stack developer", "pharmacist"]) {
      expect(qs.has(q), q).toBe(true);
    }
  });

  it("no query loses a relevant title the base found", () => {
    const lost = out.flatMap((x) => x.base.filter((i) => x.rel.has(i) && !x.now.includes(i)).map((i) => `${x.q}: ${x.pool[i].t}`));
    expect(lost).toEqual([]);
  });

  it("recall rises and precision does not fall, over the whole corpus", () => {
    let rel = 0, bTp = 0, nTp = 0, bM = 0, nM = 0;
    for (const x of out) {
      rel += x.rel.size; bM += x.base.length; nM += x.now.length;
      bTp += x.base.filter((i) => x.rel.has(i)).length;
      nTp += x.now.filter((i) => x.rel.has(i)).length;
    }
    const recall = { base: bTp / rel, now: nTp / rel };
    const precision = { base: bTp / bM, now: nTp / nM };
    expect(recall.now, JSON.stringify({ recall, precision })).toBeGreaterThan(recall.base + 0.3);
    expect(recall.now).toBeGreaterThan(0.9);
    expect(precision.now, JSON.stringify({ recall, precision })).toBeGreaterThanOrEqual(precision.base);
  });

  it("every spelling of a compound role finds what its joined spelling finds", () => {
    const by = new Map(out.map((x) => [x.q, x.now.join(",")]));
    for (const group of [
      ["back end developer", "back-end developer", "backend developer"],
      ["front end developer", "front-end developer", "frontend developer"],
      ["full stack developer", "full-stack developer", "fullstack developer"],
      ["devops engineer", "dev ops engineer", "dev-ops engineer"],
      ["ai engineer", "a.i. engineer"],
    ]) {
      for (const q of group.slice(1)) expect(by.get(q), `${q} vs ${group[0]}`).toBe(by.get(group[0]));
    }
  });

  it("a query outside the software families reads exactly as it did", () => {
    const moved = out.filter((x) => (x.fam === "negative" || x.fam === "top") && x.now.join(",") !== x.base.join(",")).map((x) => x.q);
    expect(moved).toEqual([]);
  });

  it("the helper's copies of ftsSafe and ftsQuery are index.ts's", () => {
    const fn = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    const body = (src: string, name: string) => {
      const a = src.indexOf(`function ${name}(`);
      return src.slice(a, src.indexOf("\n}\n", a)).replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");
    };
    const helper = readFileSync(resolve(__dirname, "helpers/search-reach.ts"), "utf8");
    for (const name of ["ftsSafe", "ftsQuery"]) expect(body(helper, name), name).toBe(body(fn, name));
    expect(ftsSafe("a.i. engineer")).toBe("a i engineer");
    expect(ftsQuery("nurses")).toBe('nurses or "nurse s"');
  });
});

describe("through the shipped handler", () => {
  const TITLES: Array<[string, string]> = [
    ["greenhouse:a:1", "Backend Developer"], ["greenhouse:a:2", "Back End Developer"], ["greenhouse:a:3", "Back-End Developer"],
    ["greenhouse:a:4", "Backend Engineer"], ["greenhouse:a:5", "Senior Back-end Engineer"], ["greenhouse:a:6", "Business Developer"],
    ["greenhouse:a:7", "Assistant Store Manager - Back-end Ops"], ["greenhouse:a:8", "AI Engineer"], ["greenhouse:a:9", "Engineer I - a Doubletree by Hilton"],
    ["greenhouse:a:10", "Front End Manager"], ["greenhouse:a:11", "Frontend Engineering Manager"],
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

  const tsv = (col: string, cfg: string) => (col === "title_tsv" ? TITLE_TSV : `to_tsvector('${cfg}', coalesce(title, ''))`);
  async function answerFromPostgres(q: Query) {
    if (q.rpc === "search_jobs") {
      const a = q.calls[0][1][0] as { p_q: string };
      const { rows } = await pg.query<{ id: string }>(`SELECT id FROM p WHERE (${TITLE_TSV}) @@ websearch_to_tsquery('english', $1) ORDER BY id`, [a.p_q]);
      return { data: rows.map((r) => ({ ...row(r.id, TITLES.find(([i]) => i === r.id)![1]), total_rows: rows.length, related_rows: null, title_match: true, snippet: null })), error: null };
    }
    const ts = q.calls.filter(([m]) => m === "textSearch");
    if (q.table !== "job_board_postings" || !ts.length) return undefined;
    const where = ts.map(([, a], n) => {
      const [col, , opts] = a as [string, string, { config?: string }];
      return `(${tsv(col, opts.config ?? "simple")}) @@ websearch_to_tsquery('${opts.config ?? "simple"}', $${n + 1})`;
    });
    const { rows } = await pg.query<{ id: string }>(`SELECT id FROM p WHERE ${where.join(" AND ")} ORDER BY id`, ts.map(([, a]) => a[1]));
    return { data: rows.map((r) => row(r.id, TITLES.find(([i]) => i === r.id)![1])), error: null };
  }
  async function list(qs: string) {
    board.reset();
    board.answer((q) => answerFromPostgres(q) as never);
    const r = await board.post({ action: "list", q: qs, limit: 60, groupSimilar: false });
    const p_q = board.db.queries.find((q) => q.rpc === "search_jobs")?.calls[0][1][0] as { p_q?: string } | undefined;
    const logged = board.db.queries.filter((q) => q.table === "job_board_search_events").map((q) => (q.calls.find(([m]) => m === "insert")?.[1][0] ?? {}) as Record<string, unknown>);
    return { r, titles: ((r.jobs ?? []) as Array<{ title: string }>).map((j) => j.title).sort(), p_q: p_q?.p_q, logged };
  }

  it("q=back end developer is ranked, reads every spelling and both role words, and is logged as typed", async () => {
    const { r, titles, p_q, logged } = await list("back end developer");
    expect(r.ranked, "ranked search must stay ranked").toBe(true);
    expect(p_q?.split(" OR ").sort()).toEqual(["back end developer", "back end engineer", "backend developer", "backend engineer"]);
    expect(titles).toEqual(["Back End Developer", "Back-End Developer", "Backend Developer", "Backend Engineer", "Senior Back-end Engineer"]);
    expect(r.aliases).toEqual(["back end", "engineer"]);
    expect(logged[0]?.q, "the search log keeps what the person typed").toBe("back end developer");
  });

  it("q=a.i. engineer finds the AI engineer, not a hotel's Engineer I", async () => {
    const { titles } = await list("a.i. engineer");
    expect(titles).toEqual(["AI Engineer"]);
  });

  it("q=front end manager still finds the store's front end, not the software one", async () => {
    const { titles } = await list("front end manager");
    expect(titles).toEqual(["Front End Manager"]);
  });

  it("q=business developer gains no engineer", async () => {
    const { titles, p_q } = await list("business developer");
    expect(p_q).toBe("business developer");
    expect(titles).toEqual(["Business Developer"]);
  });
});
