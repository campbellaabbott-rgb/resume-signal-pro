// @vitest-environment node
/**
 * A STATE CODE MATCHED A COUNTRY THAT STARTS WITH ITS LETTERS (L13-01, old 1.08).
 *
 * location = "Maine" expands to "Maine|, ME" and every alias was bound as
 * location ILIKE '%alias%': ", ME" matched ", Mexico". Live on .87,
 * {location:"Maine"} answered 6,375 with 32 of the first 60 rows in Mexico.
 * Indiana's ", IN" matched India, Delaware's ", DE" Germany.
 *
 * 20261008100200 binds a ", XX" alias case-sensitively with a trailing
 * boundary, on US, Canadian or unplaced rows, in search_jobs, count_jobs_capped
 * and fuzzy_title_search; job-board .91 applies the same rule on browse and in
 * preferMatchedLocation (L8-14). All of it is RUN here: the three functions in
 * pglite before and after the migration, and the shipped TypeScript.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { locationTerms } from "../../supabase/functions/_shared/location-terms";
import { isStateCodeAlias, locationBranch, partMatchesTerm } from "../../supabase/functions/job-board/location-match.ts";
import { detectPlace } from "../../supabase/functions/job-board/normalize.ts";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const PREV = read("supabase/migrations/20260927034117_a_wage_on_the_card_is_a_stated_wage_in_every_path.sql");
const MIG = read("supabase/migrations/20261008100200_a_state_code_matched_a_country_that_starts_with_its_letters.sql");

// The country each row carries is the one ingest stores: a vendor-stated
// country where the vendor states one, else detectPlace's read of the text.
const stored = (loc: string, stated?: string) => detectPlace(loc, stated).country;
const ROWS: Array<[string, string, string | null]> = [
  ["mx", "San Pedro Garza Garcia, N.L., Mexico", "MX"],
  ["mx-upper", "Monterrey, MEXICO", "MX"],
  ["me-portland", "Portland, ME", "US"],
  ["me-zip", "Bangor, ME 04401", "US"],
  ["me-name", "Augusta, Maine", "US"],
  ["me-multi", "Boston, MA; Portland, ME, United States", "US"],
  ["me-unplaced", "Lewiston, ME", null],
  ["in-india-stated", "Pune, IN", stored("Pune, IN", "IN")],
  ["in-india-text", "Chennai, IN", stored("Chennai, IN")],
  ["in-india-word", "Pune, India", stored("Pune, India")],
  ["in-us", "Indianapolis, IN", stored("Indianapolis, IN")],
  ["de-germany-stated", "Berlin, DE", stored("Berlin, DE", "DE")],
  ["de-germany-text", "Munich, DE", stored("Munich, DE")],
  ["de-us", "Wilmington, DE", stored("Wilmington, DE")],
  ["on-canada", "Toronto, ON", "CA"],
];

async function boot(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.job_board_postings (
      id text PRIMARY KEY, source text, company_token text, company text, title text,
      location text, country text, remote boolean, work_mode text, employment_type text,
      department text, category text, posted_at timestamptz, apply_url text, salary text,
      salary_min_annual numeric, salary_max_annual numeric, salary_period text, salary_currency text,
      experience_band text, min_years integer, last_seen timestamptz, description text,
      effective_posted timestamptz, missing_since timestamptz, agency boolean NOT NULL DEFAULT false,
      title_tsv tsvector, search_tsv tsvector, salary_rank_usd numeric
    );
  `);
  for (const [id, loc, c] of ROWS) {
    await db.query(
      `INSERT INTO public.job_board_postings (id, source, company, title, location, country, effective_posted, last_seen, title_tsv, search_tsv)
       VALUES ($1, 'greenhouse', 'Hospital', 'Registered Nurse', $2, $3, now(), now(), to_tsvector('english', 'Registered Nurse'), to_tsvector('english', 'Registered Nurse'))`,
      [id, loc, c],
    );
  }
  await db.exec(PREV);
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

describe("the three search functions, before and after 20261008100200", { timeout: 90_000 }, () => {
  it("Maine: Mexico in before, out after; the state's own rows in every form stay", async () => {
    const db = await boot();
    expect(param("Maine")).toBe("Maine|, ME");
    const before = await three(db, param("Maine"));
    expect(before.ranked, "the defect: ', ME' read as a substring").toEqual(expect.arrayContaining(["mx", "mx-upper"]));
    await db.exec(MIG);
    const want = ["me-multi", "me-name", "me-portland", "me-unplaced", "me-zip"];
    const after = await three(db, param("Maine"));
    expect(after.ranked).toEqual(want);
    expect(after.count).toBe(want.length);
    expect(after.fuzzy).toEqual(want);
    await db.close();
  });

  it("Indiana and Delaware keep their own and lose a spelled-out India and a vendor-stated India or Germany; a province code still finds Canada", async () => {
    const db = await boot();
    const before = await three(db, param("Indiana"));
    expect(before.ranked, "the defect: ', IN' read as a substring").toEqual(expect.arrayContaining(["in-india-stated", "in-india-word"]));
    await db.exec(MIG);
    const indiana = (await three(db, param("Indiana"))).ranked;
    const delaware = (await three(db, param("Delaware"))).ranked;
    expect(indiana).toContain("in-us");
    expect(indiana).not.toContain("in-india-stated");
    expect(indiana).not.toContain("in-india-word");
    expect(delaware).toContain("de-us");
    expect(delaware).not.toContain("de-germany-stated");
    expect((await three(db, param("Ontario"))).ranked).toEqual(["on-canada"]);
    // A spelled-out place is untouched: "Mexico" still finds Mexico.
    expect((await three(db, "Mexico")).ranked).toEqual(["mx", "mx-upper"]);
    await db.close();
  });

  it("a text-derived 'Munich, DE' or 'Chennai, IN' is stored as US and still matches Delaware or Indiana: the residual this file does not fix", async () => {
    // detectCountry reads ', DE' and ', IN' as US state codes before it looks
    // at the city, and the gate reads the stored country. When the follow-up
    // teaches detectCountry the city first, this test fails and is flipped.
    expect(stored("Munich, DE")).toBe("US");
    expect(stored("Chennai, IN")).toBe("US");
    const db = await boot();
    await db.exec(MIG);
    expect((await three(db, param("Indiana"))).ranked).toEqual(["in-india-text", "in-us"]);
    expect((await three(db, param("Delaware"))).ranked).toEqual(["de-germany-text", "de-us"]);
    await db.close();
  });

  it("applies twice, keeps one signature each, and stays closed to client roles", async () => {
    const db = await boot();
    await db.exec(MIG);
    await db.exec(MIG);
    const r = (await db.query<{ proname: string; n: number; anon: boolean; svc: boolean }>(`
      SELECT proname, count(*)::int AS n, bool_or(has_function_privilege('anon', oid, 'EXECUTE')) AS anon,
             bool_and(has_function_privilege('service_role', oid, 'EXECUTE')) AS svc
      FROM pg_proc WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('search_jobs', 'count_jobs_capped', 'fuzzy_title_search') GROUP BY proname ORDER BY proname`)).rows;
    expect(r).toEqual([
      { proname: "count_jobs_capped", n: 1, anon: false, svc: true },
      { proname: "fuzzy_title_search", n: 1, anon: false, svc: true },
      { proname: "search_jobs", n: 1, anon: false, svc: true },
    ]);
    await db.close();
  });
});

describe("the edge applies the same rule", () => {
  it("a code alias is ', XX' and nothing else", () => {
    expect(isStateCodeAlias(", ME")).toBe(true);
    expect(isStateCodeAlias("Maine")).toBe(false);
    expect(isStateCodeAlias(", me")).toBe(false);
    expect(isStateCodeAlias(", MEX")).toBe(false);
  });

  it("a card's place matches the code at a boundary only (preferMatchedLocation)", () => {
    expect(partMatchesTerm("Portland, OR", ", OR")).toBe(true);
    expect(partMatchesTerm("New York, NY", ", OR")).toBe(false); // "yORk" was the needle 'or'
    expect(partMatchesTerm("Washington, DC", ", IN")).toBe(false);
    expect(partMatchesTerm("Indianapolis, IN 46204", ", IN")).toBe(true);
    expect(partMatchesTerm("San Pedro, N.L., Mexico", ", ME")).toBe(false);
    expect(partMatchesTerm("Austin, Texas", "Texas")).toBe(true);
    expect(partMatchesTerm("austin, texas", "Texas")).toBe(true);
  });

  it("the browse branch binds the boundary and the country for a code, and a plain ILIKE for a name", () => {
    expect(locationBranch("Maine")).toBe('location.ilike."%Maine%"');
    expect(locationBranch(", ME")).toBe('and(location.ilike."%, ME%",location.match.", ME($|[^A-Za-z])",or(country.is.null,country.in.(US,CA)))');
  });

  it("preferMatchedLocation moves the searched state first (the shipped function)", () => {
    const RAW = read("supabase/functions/job-board/index.ts");
    const src = /function preferMatchedLocation\([\s\S]*?\n\}/.exec(RAW)?.[0] ?? "";
    expect(src, "preferMatchedLocation has moved").toBeTruthy();
    const js = ts.transpileModule(src + "\nreturn preferMatchedLocation;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const prefer = new Function("partMatchesTerm", js)(partMatchesTerm) as (jobs: Array<Record<string, unknown>>, t: string[]) => Array<Record<string, unknown>>;
    const cases: Array<[string, string, string]> = [
      ["Oregon", "New York, NY; Portland, OR", "Portland, OR"],
      ["Indiana", "Washington, DC; Indianapolis, IN", "Indianapolis, IN"],
      ["Maine", "Monterrey, Mexico; Portland, ME", "Portland, ME"],
      ["California", "Toronto, Canada; San Jose, CA", "San Jose, CA"],
    ];
    for (const [place, loc, first] of cases) {
      const [j] = prefer([{ location: loc }], locationTerms(place).terms);
      expect(String(j.location).split("; ")[0], place).toBe(first);
    }
  });
});
