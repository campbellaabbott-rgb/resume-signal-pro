// @vitest-environment node
/**
 * A PLACE FILTER READS ITS INDEX, AND A LEADING STATE CODE IS A STATE
 * (S11-002, S11-003; the p_title_only half of S11-009).
 *
 * S11-002. The three search functions matched every alias inside a correlated
 * semi-join over the split list, which no index can answer. Live on .91,
 * 2026-10-11: {q:"manager", location:"Boise"} leaves under 200 title hits, so
 * search_jobs reads search_tsv and tested every "manager" description through
 * the semi-join: 57014 after 8.36 s, the unranked fallback at 10.7 s.
 *
 * S11-003. "Texas" expands to "Texas|, TX", and ", TX" matched only
 * "<city>, TX". CVS's "TX - Houston" (1,054 rows against 15 for "Texas"),
 * RTX's "US-TX-Houston", Sanford's "SD, Sioux Falls" and "Tyler,TX - ..."
 * were out of every state search.
 *
 * 20261009101000 builds one constant arm per alias in plpgsql. All of it is
 * RUN here: the three functions in pglite before and after the migration, the
 * planner's choice on a seeded table, and the shipped TypeScript rule.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { auto_explain } from "@electric-sql/pglite/contrib/auto_explain";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { locationTerms, STATE_ALIASES } from "../../supabase/functions/_shared/location-terms";
import * as board from "../../supabase/functions/job-board/location-match";
import * as copy from "../../supabase/functions/_shared/location-match";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const OLD = read("supabase/migrations/20261008100200_a_state_code_matched_a_country_that_starts_with_its_letters.sql");
const MIG = read("supabase/migrations/20261009101000_a_place_filter_reads_its_index_and_a_leading_state_code_is_a_state.sql");

const TABLE = `
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, company text, title text,
    location text, country text, remote boolean, work_mode text, employment_type text,
    department text, category text, posted_at timestamptz, apply_url text, salary text,
    salary_min_annual numeric, salary_max_annual numeric, salary_period text, salary_currency text,
    experience_band text, min_years integer, last_seen timestamptz, description text,
    effective_posted timestamptz, missing_since timestamptz, agency boolean NOT NULL DEFAULT false,
    title_tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(company, '')), 'B')) STORED,
    search_tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(company, '')), 'B') ||
      setweight(to_tsvector('english', left(coalesce(description, ''), 4000)), 'D')) STORED,
    salary_rank_usd numeric
  );
`;

// Shapes read off the live board, 2026-10-11, with the country ingest stored.
const ROWS: Array<[string, string, string | null]> = [
  ["tx-lead", "TX - Houston", "US"],
  ["tx-us-dash", "US-TX-HOUSTON-17015 ALDINE WESTFIELD", "US"],
  ["tx-usa-dash", "USA TX - El Paso - Northwestern Dr.", "US"],
  ["tx-usa-space", "USA TX Austin", "US"],
  ["tx-no-space", "Tyler,TX - 100 Rice Road", "US"],
  ["tx-dash-trail", "Austin - TX", "US"],
  ["tx-trailing", "Austin, TX", "US"],
  ["tx-name", "Dallas, Texas", "US"],
  ["tx-word", "TXU Energy Plaza", "US"],
  ["sd-lead", "SD, Sioux Falls", "US"],
  ["sd-trailing", "Rapid City, SD, United States", "US"],
  ["ca-canada", "CA - BROSSARD BUILDING (PQBRO)", "CA"],
  ["ca-lead", "CA - Los Angeles - Palmdale", "US"],
  ["in-unplaced", "IN - Jaipur", null],
  ["in-india", "IN - Pune", "IN"],
  ["in-lead", "IN - Fort Wayne", "US"],
  ["on-lead", "Canada - ON - Remote", "CA"],
  ["on-us", "PITTSBURG - ON SITE", "US"],
  ["me-portland", "Portland, ME", "US"],
  ["mx", "San Pedro Garza Garcia, N.L., Mexico", "MX"],
];

async function boot(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(TABLE);
  for (const [id, loc, c] of ROWS) {
    await db.query(
      `INSERT INTO public.job_board_postings (id, source, company, title, location, country, effective_posted, last_seen, description)
       VALUES ($1, 'greenhouse', 'Hospital', 'Registered Nurse', $2, $3, now(), now(), 'Day shift on the forklift team.')`,
      [id, loc, c],
    );
  }
  await db.exec(OLD);
  return db;
}

const CUT = "now() - interval '30 days'";
async function three(db: PGlite, loc: string) {
  const ranked = (await db.query<{ id: string }>(`SELECT id FROM public.search_jobs('nurse', ${CUT}, p_location => $1) ORDER BY id`, [loc])).rows.map((r) => r.id);
  const count = Number((await db.query<{ n: number }>(`SELECT n FROM public.count_jobs_capped(${CUT}, 'nurse', p_location => $1)`, [loc])).rows[0].n);
  const fuzzy = (await db.query<{ id: string }>(`SELECT id FROM public.fuzzy_title_search('Registered Nurse', ${CUT}, 40, p_location => $1) ORDER BY id`, [loc])).rows.map((r) => r.id);
  return { ranked, count, fuzzy };
}
const param = (place: string) => locationTerms(place).terms.join("|");
const sorted = (a: string[]) => [...a].sort();

describe("a state code that leads the place is the state (S11-003)", () => {
  it("Texas: the leading, dashed and no-space forms are out before and in after, in all three functions", async () => {
    const db = await boot();
    expect(param("Texas")).toBe("Texas|, TX");
    const before = await three(db, param("Texas"));
    for (const id of ["tx-lead", "tx-us-dash", "tx-usa-dash", "tx-no-space", "tx-dash-trail"]) {
      expect(before.ranked, `the defect: ${id} is not a Texas row`).not.toContain(id);
    }
    await db.exec(MIG);
    const want = sorted(["tx-lead", "tx-us-dash", "tx-usa-dash", "tx-usa-space", "tx-no-space", "tx-dash-trail", "tx-trailing", "tx-name"]);
    const after = await three(db, param("Texas"));
    expect(after.ranked).toEqual(want);
    expect(after.count).toBe(want.length);
    expect(after.fuzzy).toEqual(want);
    await db.close();
  });

  it("South Dakota finds Sanford's 'SD, Sioux Falls'", async () => {
    const db = await boot();
    expect((await three(db, param("South Dakota"))).ranked).toEqual(["sd-trailing"]);
    await db.exec(MIG);
    const after = await three(db, param("South Dakota"));
    expect(after.ranked).toEqual(["sd-lead", "sd-trailing"]);
    expect(after.count).toBe(2);
    expect(after.fuzzy).toEqual(["sd-lead", "sd-trailing"]);
    await db.close();
  });

  it("a leading code counts only on a row placed in the code's own country", async () => {
    const db = await boot();
    await db.exec(MIG);
    // "CA - Brossard" stored as Canada is not California; "CA - Los Angeles" is.
    expect((await three(db, param("California"))).ranked).toEqual(["ca-lead"]);
    // Unplaced and Indian "IN - <city>" rows are not Indiana.
    expect((await three(db, param("Indiana"))).ranked).toEqual(["in-lead"]);
    // A province code needs a Canadian row: "PITTSBURG - ON SITE" is not Ontario.
    expect((await three(db, param("Ontario"))).ranked).toEqual(["on-lead"]);
    // 20261008100200's rule stands: ", ME" is not ", Mexico".
    expect((await three(db, param("Maine"))).ranked).toEqual(["me-portland"]);
    await db.close();
  });

  it("a name, a metro list and an empty location answer as they did", async () => {
    const db = await boot();
    const cases = ["Mexico", "Houston|El Paso", "", "Fort Wayne"];
    const before = await Promise.all(cases.map((c) => three(db, c)));
    await db.exec(MIG);
    const after = await Promise.all(cases.map((c) => three(db, c)));
    expect(after).toEqual(before);
    expect(after[0].ranked).toEqual(["mx"]);
    expect(after[2], "an empty location still matches nothing").toEqual({ ranked: [], count: 0, fuzzy: [] });
    await db.close();
  });

  it("applies twice, keeps one signature each, and stays closed to client roles", async () => {
    const db = await boot();
    await db.exec(MIG);
    await db.exec(MIG);
    const r = (await db.query<{ proname: string; n: number; anon: boolean; auth: boolean; svc: boolean; lang: string }>(`
      SELECT p.proname, count(*)::int AS n,
             bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon,
             bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS auth,
             bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) AS svc,
             max(l.lanname) AS lang
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('search_jobs', 'count_jobs_capped', 'fuzzy_title_search') GROUP BY p.proname ORDER BY p.proname`)).rows;
    expect(r).toEqual([
      { proname: "count_jobs_capped", n: 1, anon: false, auth: false, svc: true, lang: "plpgsql" },
      { proname: "fuzzy_title_search", n: 1, anon: false, auth: false, svc: true, lang: "plpgsql" },
      { proname: "search_jobs", n: 1, anon: false, auth: false, svc: true, lang: "plpgsql" },
    ]);
    await db.close();
  });
});

describe("every other filter answers as it did (fuzzy_title_search is plpgsql now)", () => {
  it("a matrix of filters gives the same rows from all three functions before and after", async () => {
    const db = new PGlite({ extensions: { pg_trgm } });
    await db.exec(TABLE);
    // Rows that differ on every filtered column.
    await db.exec(`
      INSERT INTO public.job_board_postings (id, source, company_token, company, title, location, country, remote, work_mode,
        employment_type, department, category, posted_at, salary, salary_period, experience_band, min_years, agency,
        salary_rank_usd, effective_posted, last_seen, description)
      SELECT 'm' || g,
        (ARRAY['greenhouse','lever','workday'])[1 + g % 3],
        'tok' || (g % 4), 'Acme ' || (g % 4),
        (ARRAY['Registered Nurse','Nurse Manager','Registered Nurse II'])[1 + g % 3],
        (ARRAY['Houston, TX','London, United Kingdom','Toronto, ON','Remote'])[1 + g % 4],
        (ARRAY['US','GB','CA',NULL])[1 + g % 4],
        g % 5 = 0,
        (ARRAY['remote','hybrid','onsite',NULL])[1 + g % 4],
        (ARRAY['full_time','part_time','contract',NULL])[1 + (g / 2) % 4],
        (ARRAY['Nursing','ICU','Emergency',NULL])[1 + (g / 3) % 4],
        (ARRAY['healthcare','other'])[1 + g % 2],
        CASE WHEN g % 6 = 0 THEN NULL ELSE now() - ((g % 20) || ' days')::interval END,
        CASE WHEN g % 3 = 0 THEN NULL ELSE '$' || (40000 + g * 1000) END,
        (ARRAY['hour','year','month',NULL])[1 + g % 4],
        (ARRAY['entry','mid','senior'])[1 + g % 3],
        CASE WHEN g % 4 = 0 THEN NULL ELSE g % 9 END,
        g % 7 = 0,
        CASE WHEN g % 3 = 0 THEN NULL ELSE 40000 + g * 1000 END,
        now() - ((g % 20) || ' days')::interval, now(), 'Care for patients.'
      FROM generate_series(1, 60) g;
    `);
    await db.exec(OLD);
    const P: Array<Record<string, unknown>> = [
      {}, { p_remote: true }, { p_country: "US,GB" }, { p_category: "healthcare" }, { p_experience: ["mid", "senior"] },
      { p_salary_floor: 70000 }, { p_salary_floor: 70000, p_include_unstated: true }, { p_salary_ceiling: 80000 },
      { p_salary_ceiling: 80000, p_include_unstated: true }, { p_pay_stated: true }, { p_companies: ["tok1", "tok2"] },
      { p_posted_after: "2026-01-01T00:00:00Z" }, { p_max_age_days: 7 }, { p_pay_basis: "hourly" }, { p_pay_basis: "salaried" },
      { p_max_years: 4 }, { p_department: "icu" }, { p_work_mode: "remote,hybrid" }, { p_employment_type: "contract" },
      { p_exclude_agencies: true }, { p_sources: ["lever"] }, { p_country: "CA", p_work_mode: "onsite", p_salary_floor: 50000 },
    ];
    const named = (p: Record<string, unknown>, base: number) => {
      const keys = Object.keys(p);
      return { sql: keys.map((k, i) => `, ${k} => $${base + i}`).join(""), vals: keys.map((k) => p[k]) };
    };
    const run = async () => {
      const out: string[] = [];
      for (const p of P) {
        const sj = named(p, 2);
        const s = (await db.query<{ id: string }>(`SELECT id FROM public.search_jobs($1, ${CUT}${sj.sql}, p_limit => 200) ORDER BY id`, ["nurse", ...sj.vals])).rows.map((r) => r.id);
        const c = (await db.query<{ n: number }>(`SELECT n FROM public.count_jobs_capped(${CUT}, $1${sj.sql})`, ["nurse", ...sj.vals])).rows[0].n;
        const fp = named(Object.fromEntries(Object.entries(p).map(([k, v]) => [k === "p_sources" ? "p_vendors" : k, v])), 2);
        const f = (await db.query<{ id: string }>(`SELECT id FROM public.fuzzy_title_search($1, ${CUT}, 60${fp.sql}) ORDER BY id`, ["Registered Nurse", ...fp.vals])).rows.map((r) => r.id);
        out.push(JSON.stringify({ p, s, c, f }));
      }
      return out;
    };
    const before = await run();
    await db.exec(MIG);
    const after = await run();
    expect(after).toEqual(before);
    // The matrix is not vacuous: the filters narrow, and differently.
    expect(new Set(before.map((x) => JSON.stringify(JSON.parse(x).f))).size).toBeGreaterThan(10);
    await db.close();
  });
});

describe("the description tier can be skipped on request (S11-009, SQL half)", () => {
  it("p_title_only answers the title tier with related_rows NULL; the old function has no such parameter", async () => {
    const db = await boot();
    // "forklift" is in every description and no title: the full call reads the description tier.
    const q = `SELECT count(*)::int AS n, max(related_rows) AS rel, bool_or(snippet IS NOT NULL) AS snip
               FROM public.search_jobs('forklift', ${CUT}, p_limit => 60, p_title_only => true)`;
    await expect(db.query(q), "the defect: nothing could ask for the title tier alone").rejects.toThrow();
    await db.exec(MIG);
    const full = (await db.query<{ n: number; rel: number; snip: boolean }>(
      `SELECT count(*)::int AS n, max(related_rows) AS rel, bool_or(snippet IS NOT NULL) AS snip FROM public.search_jobs('forklift', ${CUT}, p_limit => 60)`,
    )).rows[0];
    expect(full.n).toBe(ROWS.length);
    expect(Number(full.rel)).toBe(ROWS.length);
    expect(full.snip).toBe(true);
    const titleOnly = (await db.query<{ n: number; rel: number | null; snip: boolean | null }>(q)).rows[0];
    expect(titleOnly).toEqual({ n: 0, rel: null, snip: null });
    // A title match is unaffected by the flag.
    const nurse = (await db.query<{ n: number; rel: number | null }>(
      `SELECT count(*)::int AS n, max(related_rows) AS rel FROM public.search_jobs('nurse', ${CUT}, p_limit => 60, p_title_only => true)`,
    )).rows[0];
    expect(nurse).toEqual({ n: ROWS.length, rel: null });
    await db.close();
  });
});

describe("the place is answered by its trigram index (S11-002)", () => {
  // A seeded board: the role words of the live shape (one "manager" title in
  // ten, "manager" in two descriptions of five) and a small city among many.
  async function seeded(): Promise<PGlite> {
    const db = new PGlite({ extensions: { pg_trgm, auto_explain } });
    await db.exec(TABLE);
    await db.exec(`
      INSERT INTO public.job_board_postings (id, source, company, title, location, country, description, effective_posted, last_seen)
      SELECT 'r' || g, 'greenhouse', 'Company ' || (g % 900),
        (ARRAY['Store Manager','Registered Nurse','Software Engineer','Sales Associate','Warehouse Associate',
               'Pharmacist','Data Analyst','Truck Driver','Electrician','Cashier'])[1 + (g % 10)],
        CASE WHEN g % 97 = 3 THEN 'Boise, ID'
             ELSE (ARRAY['Houston, TX','TX - Dallas','Denver, CO','Chicago, Illinois','US-WA-Seattle','London, United Kingdom',
                         'Toronto, ON','New York, NY','Atlanta, Georgia','Phoenix, AZ','Miami, FL','Berlin, Germany'])[1 + (g % 12)] END,
        CASE WHEN g % 12 IN (5, 11) THEN NULL ELSE 'US' END,
        CASE WHEN g % 5 < 2 THEN 'You report to the general manager. ' ELSE 'You join a friendly team. ' END
          || repeat('Benefits include medical dental vision and a retirement plan. ', 4),
        now() - ((g % 25) || ' days')::interval, now()
      FROM generate_series(1, 40000) g;
      CREATE INDEX job_board_postings_location_trgm_idx ON public.job_board_postings USING gin (location gin_trgm_ops);
      CREATE INDEX job_board_postings_title_trgm_idx ON public.job_board_postings USING gin (title gin_trgm_ops);
      CREATE INDEX job_board_postings_title_tsv_idx ON public.job_board_postings USING gin (title_tsv);
      CREATE INDEX job_board_postings_search_tsv_idx ON public.job_board_postings USING gin (search_tsv);
      ANALYZE public.job_board_postings;
      LOAD 'auto_explain';
      SET auto_explain.log_min_duration = 0;
      SET auto_explain.log_nested_statements = on;
      SET auto_explain.log_level = 'notice';
    `);
    return db;
  }
  /** Every plan the call ran, nested statements included. */
  async function plans(db: PGlite, sql: string): Promise<string> {
    const out: string[] = [];
    await db.query(sql, [], { onNotice: (n) => out.push(n.message) });
    return out.join("\n");
  }
  const DESC_COUNT = /Query Text: SELECT count\(\*\) FROM \(SELECT 1 FROM public\.job_board_postings p WHERE p\.search_tsv @@ \$1[\s\S]*?(?=\nQuery Text:|$)/;

  it("manager in Boise: a per-row semi-join before, the location index after, same answer", async () => {
    const db = await seeded();
    await db.exec(OLD);
    const call = `SELECT count(*)::int AS n, max(total_rows) AS t, max(related_rows) AS r FROM public.search_jobs('manager', ${CUT}, p_location => 'Boise', p_limit => 60)`;
    const beforeRows = (await db.query(call)).rows;
    const before = await plans(db, call);
    const beforeDesc = DESC_COUNT.exec(before)?.[0] ?? "";
    expect(beforeDesc, "the description-tier count ran").not.toBe("");
    expect(beforeDesc, "the defect: the place is a semi-join the index cannot answer").toMatch(/Semi Join/);
    expect(beforeDesc).not.toMatch(/job_board_postings_location_trgm_idx/);

    await db.exec(MIG);
    const afterRows = (await db.query(call)).rows;
    const after = await plans(db, call);
    const afterDesc = DESC_COUNT.exec(after)?.[0] ?? "";
    expect(afterDesc, "the description-tier count ran").not.toBe("");
    expect(afterDesc).toMatch(/Bitmap Index Scan on job_board_postings_location_trgm_idx\s+\([^)]*\)[^\n]*\n\s+Index Cond: \(location ~~\* '%Boise%'::text\)/);
    expect(after, "no statement of the call joins the alias list per row").not.toMatch(/Semi Join/);
    expect(afterRows).toEqual(beforeRows);
    await db.close();
  });

  it("the count and the rescue tier read the place from the index too", async () => {
    const db = await seeded();
    await db.exec(MIG);
    const count = await plans(db, `SELECT * FROM public.count_jobs_capped(${CUT}, 'manager', p_location => 'Boise')`);
    expect(count).toMatch(/Index Cond: \(location ~~\* '%Boise%'::text\)/);
    expect(count).not.toMatch(/Semi Join/);
    const state = await plans(db, `SELECT * FROM public.count_jobs_capped(${CUT}, NULL, p_location => 'Idaho|, ID')`);
    // A code is a case-sensitive regex, and pg_trgm answers a regex from the index.
    expect(state).toMatch(/Bitmap Index Scan on job_board_postings_location_trgm_idx[^\n]*\n\s+Index Cond: \(location ~ '/);
    expect(state).not.toMatch(/Semi Join/);
    const fuzzy = await plans(db, `SELECT * FROM public.fuzzy_title_search('Registred Nurse', ${CUT}, 40, p_location => 'Boise')`);
    expect(fuzzy).not.toMatch(/Semi Join/);
    expect(fuzzy).toMatch(/location ~~\* '%Boise%'::text/);
    await db.close();
  });
});

describe("the edge binds the same rule (location-match.ts, both copies)", () => {
  it("the API's copy is the board's file, byte for byte", () => {
    expect(read("supabase/functions/_shared/location-match.ts")).toBe(read("supabase/functions/job-board/location-match.ts"));
  });

  it("a card's place matches a leading or dashed code, and nothing that only starts with the letters", () => {
    for (const m of [board, copy]) {
      for (const place of ["TX - Houston", "US-TX-Houston", "USA TX - El Paso", "USA TX Austin", "Tyler,TX - 100 Rice Road", "Austin - TX", "Austin, TX"]) {
        expect(m.partMatchesTerm(place, ", TX"), place).toBe(true);
      }
      expect(m.partMatchesTerm("SD, Sioux Falls", ", SD")).toBe(true);
      for (const place of ["TXU Energy Plaza", "Texarkana", "Houston", "Remote - LATAM"]) {
        expect(m.partMatchesTerm(place, place === "Remote - LATAM" ? ", LA" : ", TX"), place).toBe(false);
      }
      expect(m.partMatchesTerm("San Pedro, N.L., Mexico", ", ME")).toBe(false);
    }
  });

  it("the browse branch keeps 20261008100200's arm and adds the no-space and leading arms with their country tests", () => {
    expect(board.locationBranch("Texas")).toBe('location.ilike."%Texas%"');
    expect(board.locationBranch(", TX")).toBe(
      'or(and(location.ilike."%, TX%",location.match.", TX($|[^A-Za-z])",or(country.is.null,country.in.(US,CA))),' +
      'and(location.ilike."%,TX%",location.match.",TX($|[^A-Za-z])",or(country.is.null,country.in.(US,CA))),' +
      'and(location.match."^TX ?([-,]|$)|- ?TX($|[^A-Za-z])|^USA? TX($|[^A-Za-z])",country.eq.US))',
    );
    expect(board.locationBranch(", ON")).toMatch(/country\.eq\.CA\)\)$/);
  });

  it("the TypeScript patterns are the ones the migration builds, and the province list is one list", () => {
    const sql = MIG.replace(/--[^\n]*/g, "");
    const p = board.codePatterns(", TX");
    // The migration concatenates the same strings around v_code.
    const built = (s: string) => s.replace(/TX/g, "' || v_code || '");
    expect(sql).toContain(`quote_literal('${built(p.trailing)}')`);
    expect(sql).toContain(`quote_literal('${built(p.noSpace)}')`);
    expect(sql).toContain(`quote_literal('${built(p.leading)}')`);
    const provinces = /v_code IN \(([^)]*)\) THEN 'CA'/.exec(sql)?.[1].replace(/'/g, "").split(/,\s*/) ?? [];
    expect(provinces.sort()).toEqual([...board.PROVINCE_CODES].sort());
    // A code is a province exactly when the alias table spells a Canadian province for it.
    const CANADA = new Set(["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador",
      "Nova Scotia", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan"]);
    for (const a of Object.values(STATE_ALIASES)) {
      const code = a.names.find((n) => /^, [A-Z]{2}$/.test(n))!.slice(2);
      expect(board.PROVINCE_CODES.has(code), `${code} (${a.names[0]})`).toBe(CANADA.has(a.names[0]));
    }
  });
});
