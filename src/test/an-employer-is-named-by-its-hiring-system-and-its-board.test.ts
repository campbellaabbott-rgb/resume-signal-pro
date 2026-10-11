// @vitest-environment node
/**
 * AN EMPLOYER IS NAMED BY ITS HIRING SYSTEM AND ITS BOARD (company profiles,
 * phase 0, plan 2026-10-11 section 4).
 *
 * public.employer_segment / public.employer_key (20261012100000) and their
 * mirror src/lib/employer-key.ts are one rule spelled twice: SQL pools boards
 * in the readers, TypeScript keys the browser's per-employer cache. A mirror
 * that drifts hands one employer's cached facts to another, so this runs both
 * spellings on pglite over the fixture shapes AND over every board in the
 * catalogue, and holds them equal. It also holds the SQL segment equal to the
 * layoff/LCA matcher's own CASE (layoff_matches_rebuild, as last issued), the
 * rule the plan says it copies.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG } from "./helpers/catalog";
import { boardIdentity, employerKey, employerSegment, postingSource } from "@/lib/employer-key";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");

/** The newest migration that (re)defines the matcher: the rule live today. */
const MATCHER_FILE = [...files].reverse().find((f) => /CREATE OR REPLACE FUNCTION public\.layoff_matches_rebuild\(\)/.test(readFileSync(resolve(MIGRATIONS, f), "utf8")))!;
const MATCHER_CASE = (() => {
  const sql = readFileSync(resolve(MIGRATIONS, MATCHER_FILE), "utf8");
  const m = /CASE WHEN split_part\(b\.company_token[\s\S]*?END AS employer/.exec(sql);
  if (!m) throw new Error(`no employer CASE in ${MATCHER_FILE}`);
  return m[0].replace(/ AS employer$/, "");
})();

const FIXTURES: Array<[source: string, token: string, segment: string]> = [
  ["ukg", "recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845", "recruiting~OLL1000OLLIE"],
  ["ukg", "recruiting~OLL1000OLLIE~0000aaaa-0000-0000-0000-000000000000", "recruiting~OLL1000OLLIE"],
  ["ukg", "recruiting2~TRO1001TROO~2b13054b-60bb-410d-9136-e52c1c7d9720", "recruiting2~TRO1001TROO"],
  ["ukg", "recruiting2~BIG1003BIGC~63b1fe5f-a895-49e4-afdc-7059fb08eea2", "recruiting2~BIG1003BIGC"],
  ["greenhouse", "eu~lookers", "eu~lookers"],
  ["lever", "eu~frontier", "eu~frontier"],
  ["workday", "blackstone~wd1~blackstone_careers", "blackstone"],
  ["workday", "blackstone~wd1~Blackstone_Campus_Careers", "blackstone"],
  ["workable", "blackstone", "blackstone"],
  ["workday", "dupont~wd5~Jobs", "dupont"],
  ["bamboohr", "dupont", "dupont"],
  ["oracle", "ejwl~us2~CX", "ejwl"],
  ["oracle", "fa-euqk-saasfaprod1~ocs~CX_1", "fa-euqk-saasfaprod1"],
  ["adp", "a232a7a1-770b-48a0-b05a-65d403177066~9201585048116_2", "a232a7a1-770b-48a0-b05a-65d403177066"],
  ["icims", "careers.petsmart.com", "careers.petsmart.com"],
  ["icims", "careers.84lumber.com", "careers.84lumber.com"],
  ["greenhouse", "stripe", "stripe"],
  ["smartrecruiters", "AECOM2", "AECOM2"],
  // Shapes no board has today, spelled the way split_part answers them.
  ["greenhouse", "recruiting", "recruiting~"],
  ["greenhouse", "eu", "eu"],
  ["greenhouse", "", ""],
];

let db: PGlite;
const seg = async (token: string) => (await db.query<{ s: string }>("SELECT public.employer_segment($1) AS s", [token])).rows[0].s;
const key = async (source: string, token: string) => (await db.query<{ k: string }>("SELECT public.employer_key($1, $2) AS k", [source, token])).rows[0].k;

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec(mig("20261012100000_"));
  await db.exec("CREATE TABLE cat (i int PRIMARY KEY, source text NOT NULL, token text NOT NULL)");
  const sources = CATALOG.map((e) => e.source);
  const tokens = CATALOG.map((e) => e.token);
  await db.query("INSERT INTO cat SELECT u.i::int, u.source, u.token FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS u(source, token, i)", [sources, tokens]);
});

describe("the segment and the key, SQL and TypeScript", () => {
  it("agree on every fixture shape: UKG paths, eu~ pods, Workday and Oracle tenants, ADP, iCIMS hosts, plain slugs", async () => {
    for (const [source, token, want] of FIXTURES) {
      expect(employerSegment(token), `TS segment of ${token}`).toBe(want);
      expect(await seg(token), `SQL segment of ${token}`).toBe(want);
      expect(await key(source, token), `SQL key of ${source}:${token}`).toBe(employerKey(source, token));
    }
  });

  it("a UKG client's career sites are one employer and two UKG clients are two", () => {
    expect(employerKey("ukg", FIXTURES[0][1])).toBe(employerKey("ukg", FIXTURES[1][1]));
    expect(employerKey("ukg", FIXTURES[2][1])).not.toBe(employerKey("ukg", FIXTURES[3][1]));
    expect(employerKey("greenhouse", "eu~lookers")).not.toBe(employerKey("greenhouse", "eu~rubyhotels"));
  });

  it("the planted pairs share a segment and are still two employers: the source is what parts them", async () => {
    for (const [plain, tenant] of [[["workable", "blackstone"], ["workday", "blackstone~wd1~blackstone_careers"]], [["bamboohr", "dupont"], ["workday", "dupont~wd5~Jobs"]]] as const) {
      expect(await seg(plain[1]), "positive control: the segment alone merges them").toBe(await seg(tenant[1]));
      expect(await key(plain[0], plain[1])).not.toBe(await key(tenant[0], tenant[1]));
      expect(employerKey(plain[0], plain[1])).not.toBe(employerKey(tenant[0], tenant[1]));
    }
    expect(await key("workday", "blackstone~wd1~blackstone_careers")).toBe(await key("workday", "blackstone~wd1~Blackstone_Campus_Careers"));
  });

  it(`agree on all ${CATALOG.length.toLocaleString("en-US")} catalogue boards`, async () => {
    const { rows } = await db.query<{ i: number; s: string; k: string }>(
      "SELECT i, public.employer_segment(token) AS s, public.employer_key(source, token) AS k FROM cat ORDER BY i");
    expect(rows.length).toBe(CATALOG.length);
    const bad: string[] = [];
    for (const r of rows) {
      const e = CATALOG[r.i - 1];
      if (r.s !== employerSegment(e.token) || r.k !== employerKey(e.source, e.token)) bad.push(`${e.source}:${e.token} sql=${r.k} ts=${employerKey(e.source, e.token)}`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it(`the SQL segment is the matcher's own rule (${MATCHER_FILE.slice(0, 14)}) on every catalogue board`, async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT token AS company_token FROM cat) b WHERE public.employer_segment(b.company_token) IS DISTINCT FROM (${MATCHER_CASE})`);
    expect(rows[0].n).toBe(0);
    // ...and the comparison could fail: a rule that dropped the UKG branch differs on every UKG board.
    const { rows: ctl } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT token AS company_token FROM cat) b WHERE split_part(b.company_token, '~', 1) IS DISTINCT FROM (${MATCHER_CASE})`);
    expect(ctl[0].n).toBeGreaterThan(1000);
  });

  it("over the catalogue, the segment spans vendors and the key never does", async () => {
    const { rows } = await db.query<{ segs: number; keys: number; collided: number }>(`
      SELECT (SELECT count(*)::int FROM (SELECT public.employer_segment(token) FROM cat GROUP BY 1 HAVING count(DISTINCT source) > 1) x) AS segs,
             (SELECT count(*)::int FROM (SELECT public.employer_key(source, token) FROM cat GROUP BY 1 HAVING count(DISTINCT source) > 1) x) AS keys,
             (SELECT count(*)::int FROM (SELECT token FROM cat GROUP BY 1 HAVING count(DISTINCT source) > 1) x) AS collided`);
    expect(rows[0].keys).toBe(0);
    expect(rows[0].segs, "the review measured 176 segments over two vendors").toBeGreaterThan(rows[0].collided);
    expect(rows[0].collided).toBeGreaterThan(100);
  });
});

describe("the helpers are private and the file re-runs", () => {
  it("neither client role can execute them; service_role can", async () => {
    const { rows } = await db.query<Record<string, boolean>>(`SELECT
      has_function_privilege('anon', 'public.employer_segment(text)', 'EXECUTE') AS a1,
      has_function_privilege('authenticated', 'public.employer_segment(text)', 'EXECUTE') AS a2,
      has_function_privilege('anon', 'public.employer_key(text,text)', 'EXECUTE') AS a3,
      has_function_privilege('authenticated', 'public.employer_key(text,text)', 'EXECUTE') AS a4,
      has_function_privilege('service_role', 'public.employer_segment(text)', 'EXECUTE') AS s1,
      has_function_privilege('service_role', 'public.employer_key(text,text)', 'EXECUTE') AS s2`);
    expect(rows[0]).toEqual({ a1: false, a2: false, a3: false, a4: false, s1: true, s2: true });
  });

  it("applies twice without error", async () => {
    await expect(db.exec(mig("20261012100000_"))).resolves.toBeDefined();
  });
});

describe("the browser's identity helpers", () => {
  it("a board of unknown origin keys on its own token, never on a key another board can share", () => {
    expect(boardIdentity("workday", "acme~wd1~Careers")).toBe(boardIdentity("workday", "acme~wd1~Campus"));
    expect(boardIdentity(null, "acme~wd1~Careers")).not.toBe(boardIdentity(null, "acme~wd1~Campus"));
    expect(boardIdentity(undefined, "blackstone")).not.toBe(boardIdentity("workday", "blackstone~wd1~blackstone_careers"));
  });

  it("reads the hiring system off the row, or off an id shaped source:token:externalId", () => {
    expect(postingSource({ source: "lever", id: "greenhouse:x:1" })).toBe("lever");
    expect(postingSource({ id: "workable:blackstone:ABC123" })).toBe("workable");
    expect(postingSource({ id: "weird id" })).toBeNull();
    expect(postingSource({})).toBeNull();
  });
});
