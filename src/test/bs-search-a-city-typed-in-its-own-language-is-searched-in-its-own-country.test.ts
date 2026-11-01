// @vitest-environment node
/**
 * A CITY TYPED IN ITS OWN LANGUAGE IS SEARCHED IN ITS OWN COUNTRY (S13-006).
 *
 * Live on job-board.2026-09-09.96, 2026-11-01: location "Wien" with q "nurse"
 * (ranked: true, locationSearched [Vienna, Wien]) served 9 rows, 7 of them in
 * Vienna VA, Vienna WV and Vienna GA. "Warszawa" served Warsaw, Indiana rows.
 * The English name the alias adds matched any US town of that name.
 *
 * Now a name added for a city typed in its own language is sent as
 * "Vienna@Austria": the browse path's or() refuses it on a row placed in the
 * US unless the row names Austria, and migration 20261102100000 teaches
 * search_jobs, count_jobs_capped and fuzzy_title_search the same arm. Not
 * "placed in Austria": one country column cannot hold a multi-city posting
 * ("Zurich, Switzerland; Amsterdam; London" is placed GB), and binding to it
 * dropped 6 right rows of 859 in the live corpus. The typed form stays a plain
 * substring, and an English spelling ("Vienna", "Zurich") is read as it always
 * was: a US seeker typing Vienna still finds Vienna, VA.
 *
 * All of it is run: the three functions in pglite before and after the
 * migration, both copies of the branch builder, and the term reader.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { locationTerms, rankedLocationParam, METRO_ALIASES } from "../../supabase/functions/_shared/location-terms";
import { placeTerms, rankedPlaceParam } from "../../supabase/functions/job-board/query-place";
import * as board from "../../supabase/functions/job-board/location-match";
import * as copy from "../../supabase/functions/_shared/location-match";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const OLD = read("supabase/migrations/20261008100200_a_state_code_matched_a_country_that_starts_with_its_letters.sql");
const PLACE = read("supabase/migrations/20261009101000_a_place_filter_reads_its_index_and_a_leading_state_code_is_a_state.sql");
const MIG = read("supabase/migrations/20261102100000_a_city_typed_in_its_own_language_is_searched_in_its_own_country.sql");

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

// Shapes the live probe served for "Wien" and "Warszawa", 2026-11-01.
const ROWS: Array<[string, string, string | null]> = [
  ["at-vienna", "Vienna, Austria", "AT"],
  ["at-wien", "Wien, Austria", "AT"],
  ["at-wiener", "Wiener Neustadt", "AT"],
  ["un-vienna", "Vienna", null],
  ["us-va", "Vienna, VA, United States", "US"],
  ["us-wv", "VIENNA, West Virginia", "US"],
  ["us-ga", "VIENNA, Georgia", "US"],
  ["gb-multi", "Zurich, Switzerland; Amsterdam, Netherlands; London, United Kingdom", "GB"],
  ["us-zurich", "Lake Zurich, IL", "US"],
  ["pl-warszawa", "Warszawa, Poland", "PL"],
  ["pl-warsaw", "Warsaw, Masovia", "PL"],
  ["us-warsaw", "Warsaw, IN, United States", "US"],
  ["us-poland", "Warsaw, Poland", "US"],
  ["tx", "Austin, TX", "US"],
];

async function boot(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(TABLE);
  for (const [id, loc, c] of ROWS) {
    await db.query(
      `INSERT INTO public.job_board_postings (id, source, company, title, location, country, effective_posted, last_seen, description)
       VALUES ($1, 'greenhouse', 'Hospital', 'Registered Nurse', $2, $3, now(), now(), 'Day shift.')`,
      [id, loc, c],
    );
  }
  await db.exec(OLD);
  await db.exec(PLACE);
  return db;
}

const CUT = "now() - interval '30 days'";
async function three(db: PGlite, loc: string) {
  const ranked = (await db.query<{ id: string }>(`SELECT id FROM public.search_jobs('nurse', ${CUT}, p_location => $1) ORDER BY id`, [loc])).rows.map((r) => r.id);
  const count = Number((await db.query<{ n: number }>(`SELECT n FROM public.count_jobs_capped(${CUT}, 'nurse', p_location => $1)`, [loc])).rows[0].n);
  const fuzzy = (await db.query<{ id: string }>(`SELECT id FROM public.fuzzy_title_search('Registered Nurse', ${CUT}, 40, p_location => $1) ORDER BY id`, [loc])).rows.map((r) => r.id);
  return { ranked, count, fuzzy };
}

describe("the term reader anchors only a city typed in its own language", () => {
  it("Wien, Warszawa and Zürich bind the added name; the typed form stays plain", () => {
    expect(locationTerms("Wien").terms).toEqual(["Vienna@Austria", "Wien"]);
    expect(locationTerms("Warszawa").terms).toEqual(["Warsaw@Poland", "Warszawa"]);
    expect(locationTerms("Zürich").terms).toEqual(["Zurich@Switzerland", "Zürich"]);
    expect(locationTerms("Praha").terms, "Czech names Czechia and the Czech Republic alike").toEqual(["Prague@Czech", "Praha"]);
    expect(locationTerms("muenchen").terms, "neither name is the typed form, so both are bound").toEqual(["Munich@Germany", "München@Germany"]);
    expect(rankedLocationParam("Wien")).toBe("Vienna@Austria|Wien");
    expect(rankedPlaceParam("Wien")).toBe("Vienna@Austria|Wien");
    expect(placeTerms("Wien").terms).toEqual(["Vienna@Austria", "Wien"]);
  });

  it("an English spelling and every other place read exactly as before", () => {
    expect(locationTerms("Vienna").terms).toEqual(["Vienna", "Wien"]);
    expect(locationTerms("Zurich").terms).toEqual(["Zurich", "Zürich"]);
    expect(locationTerms("Warsaw").terms).toEqual(["Warsaw", "Warszawa"]);
    expect(locationTerms("Texas").terms).toEqual(["Texas", ", TX"]);
    expect(locationTerms("bay area").terms).toEqual(["San Francisco", "Oakland", "San Jose"]);
    expect(locationTerms("Springfield").terms).toEqual(["Springfield"]);
  });

  it("every anchored entry is a local form whose English twin is unanchored", () => {
    const anchored = Object.entries(METRO_ALIASES).filter(([, v]) => v.anchor);
    expect(anchored.length).toBeGreaterThanOrEqual(15);
    for (const [k, v] of anchored) {
      expect(v.anchor, k).toMatch(/^[A-Z][a-z]+$/);
      const english = v.names[0].toLowerCase();
      expect(english === k, `${k} is the English spelling and must not be anchored`).toBe(false);
      expect(METRO_ALIASES[english]?.anchor, `${english} (the English spelling) stays unanchored`).toBeUndefined();
    }
  });
});

describe("the browse path's branch binds the anchored name (both copies)", () => {
  it.each([["job-board", board], ["_shared", copy]] as const)("%s", (_n, m) => {
    expect(m.locationBranch("Vienna@Austria")).toBe('and(location.ilike."%Vienna%",or(country.is.null,country.neq.US,location.ilike."%Austria%"))');
    expect(m.locationBranch("Wien")).toBe('location.ilike."%Wien%"');
    expect(m.locationBranch(", TX")).toContain("location.match");
    expect(m.partMatchesTerm("Vienna, Austria", "Vienna@Austria")).toBe(true);
    expect(m.partMatchesTerm("Austin, TX", "Vienna@Austria")).toBe(false);
  });
});

describe("migration 20261102100000 binds the anchored name in all three search functions", () => {
  it("Wien: the US Viennas are in before and out after; Austria and unplaced stay; the plain arm is unchanged", async () => {
    const db = await boot();
    const before = await three(db, "Vienna@Austria|Wien");
    expect(before.ranked, "an unpatched function reads 'Vienna@Austria' as text and finds only Wien").toEqual(["at-wien", "at-wiener"]);
    const plainBefore = await three(db, "Vienna|Wien");
    expect(plainBefore.ranked).toContain("us-va");
    await db.exec(MIG);
    const want = ["at-vienna", "at-wien", "at-wiener", "un-vienna"];
    const after = await three(db, "Vienna@Austria|Wien");
    expect(after.ranked).toEqual(want);
    expect(after.count).toBe(want.length);
    expect(after.fuzzy).toEqual(want);
    expect(await three(db, "Vienna|Wien"), "a plain list answers as it did").toEqual(plainBefore);
    expect((await three(db, "Warsaw@Poland|Warszawa")).ranked, "a US-placed row naming Poland stays").toEqual(["pl-warsaw", "pl-warszawa", "us-poland"]);
    expect((await three(db, "Zurich@Switzerland|Zürich")).ranked, "a multi-city posting placed GB stays; Lake Zurich, IL goes").toEqual(["gb-multi"]);
    expect((await three(db, "Texas|, TX")).ranked, "the state-code arms stand").toEqual(["tx"]);
    await db.close();
  });

  it("applies twice, keeps one signature each, and stays closed to client roles", async () => {
    const db = await boot();
    await db.exec(MIG);
    await db.exec(MIG);
    const r = (await db.query<{ proname: string; n: number; anon: boolean; auth: boolean; svc: boolean; arms: number }>(`
      SELECT p.proname, count(*)::int AS n,
             bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon,
             bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS auth,
             bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) AS svc,
             max((length(p.prosrc) - length(replace(p.prosrc, 'split_part(v_alias, ''@'', 2)', ''))) / length('split_part(v_alias, ''@'', 2)'))::int AS arms
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('search_jobs', 'count_jobs_capped', 'fuzzy_title_search') GROUP BY p.proname ORDER BY p.proname`)).rows;
    expect(r).toEqual([
      { proname: "count_jobs_capped", n: 1, anon: false, auth: false, svc: true, arms: 1 },
      { proname: "fuzzy_title_search", n: 1, anon: false, auth: false, svc: true, arms: 1 },
      { proname: "search_jobs", n: 1, anon: false, auth: false, svc: true, arms: 1 },
    ]);
    await db.close();
  });

  it("refuses a body that does not hold the plain arm exactly once, and changes nothing", async () => {
    const db = await boot();
    const src0 = (await db.query<{ s: string }>(`SELECT prosrc AS s FROM pg_proc WHERE proname = 'count_jobs_capped'`)).rows[0].s;
    await db.exec(`DO $$ DECLARE d text; BEGIN
      d := pg_get_functiondef('public.count_jobs_capped'::regproc);
      EXECUTE replace(d, 'v_loc := v_loc || (''p.location ILIKE '' || quote_literal(''%'' || v_alias || ''%''));', 'v_loc := v_loc || (''p.location ILIKE '' || quote_literal(''%'' || v_alias || ''%'' ));');
    END $$;`);
    await expect(db.exec(MIG)).rejects.toThrow(/exactly once/);
    const src1 = (await db.query<{ s: string }>(`SELECT prosrc AS s FROM pg_proc WHERE proname = 'search_jobs'`)).rows[0].s;
    expect(src1.includes("split_part(v_alias, '@', 2)"), "search_jobs was patched though the migration failed").toBe(false);
    expect(src0.length).toBeGreaterThan(1000);
    await db.close();
  });
});
