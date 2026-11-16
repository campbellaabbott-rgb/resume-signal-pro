// @vitest-environment node
/**
 * AN EXTENDED ANNOUNCEMENT AND A HEALED DEPARTMENT LAND ON THE STORED ROW.
 *
 * WHAT WAS WRONG. job-board .102 patches closes_at (XR-1) and department
 * (S14X-216) on stored rows, and stored rows are corrected only through
 * apply_posting_corrections. Its last definition (20260906210500) named
 * fourteen columns and ignored every other key, so on a real Postgres a
 * {closes_at} and a {department} patch returned 2, the count the edge reads as
 * success, and changed nothing: an extended announcement still closed on its
 * old date, rows stored before .102 never gained one, and 'R&amp;D' never
 * healed. 20261111100000 now restates the RPC with both keys.
 *
 * This runs the RPC the way a replay leaves it, on a Postgres that starts from
 * Supabase's default grants (anon and authenticated hold ALL on new tables and
 * EXECUTE on new functions): the definition that stood before .102, then
 * 20261111100000, then any later file that redefines the RPC. The patches are
 * sent the way the edge sends them, one jsonb array a call.
 */
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";

const MIG = resolve(__dirname, "../../supabase/migrations");
const STAMP = "20261111100000";
const sqlOf = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const THIS = all.find((f) => f.startsWith(`${STAMP}_`))!;
const definers = all.filter((f) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.apply_posting_corrections\s*\(/i.test(sqlCodeOf(sqlOf(f))));
/** The definition that stood before .102, the closes_at file itself, and any later redefinition. */
const BEFORE = definers.filter((f) => f < STAMP).at(-1)!;
const FILES = [BEFORE, THIS, ...definers.filter((f) => f > THIS)];

// A PGlite start comes close to the 5 s default under a loaded full-suite run: each case says its own budget.
const HEAVY = 30_000;

let db: PGlite | null = null;
afterEach(async () => { await db?.close(); db = null; });

const fresh = async (files: string[] = FILES): Promise<PGlite> => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE TABLE public.job_board_postings (
      id text PRIMARY KEY, source text, title text, location text, apply_url text, country text, region_code text,
      work_mode text, employment_type text, salary text, salary_min_annual numeric, salary_max_annual numeric,
      salary_period text, salary_currency text, remote boolean, agency boolean NOT NULL DEFAULT false, department text,
      posted_at timestamptz, first_seen timestamptz, missing_since timestamptz, category text, description text
    );
    CREATE TABLE public.job_board_exits (id bigserial PRIMARY KEY, posting_id text, exit_reason text);
  `);
  for (const f of files) await db.exec(sqlOf(f));
  return db;
};

/** One call, the edge's shape: client.rpc("apply_posting_corrections", { p_patches: chunk }). */
const correct = async (d: PGlite, patches: unknown) =>
  (await d.query<{ n: number }>(`SELECT public.apply_posting_corrections($1::jsonb) AS n`, [JSON.stringify(patches)])).rows[0].n;

const row = async (d: PGlite, id: string) =>
  (await d.query<Record<string, unknown>>(
    `SELECT title, salary, salary_min_annual::float8 AS salary_min_annual, salary_max_annual::float8 AS salary_max_annual, salary_period,
            remote, agency, department, to_char(closes_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS closes_at,
            first_seen, posted_at, category
       FROM public.job_board_postings WHERE id = $1`, [id])).rows[0];

describe(`${STAMP} teaches apply_posting_corrections closes_at and department`, () => {
  it("the files it runs are the ones a replay runs", () => {
    expect(BEFORE, "the definition that stood before .102").toBe("20260906210500_the_patch_rpc_drops_every_key_it_was_not_taught.sql");
    expect(THIS).toBe("20261111100000_a_usajobs_announcement_closes_on_the_date_the_agency_states.sql");
  });

  it("an extended announcement moves its date and an entity-encoded department heals, and nothing else on either row moves", async () => {
    const d = await fresh();
    await d.exec(`INSERT INTO public.job_board_postings (id, source, title, department, closes_at) VALUES
      ('usajobs:usajobs:1', 'usajobs', 'Analyst', NULL, '2026-11-20T04:59:59Z'),
      ('teamtailor:t:1', 'teamtailor', 'PM', 'R&amp;D', NULL)`);
    const n = await correct(d, [{ id: "usajobs:usajobs:1", closes_at: "2026-12-06T04:59:59.000Z" }, { id: "teamtailor:t:1", department: "R&D" }]);
    expect(n).toBe(2);
    expect(await row(d, "usajobs:usajobs:1")).toMatchObject({ title: "Analyst", department: null, closes_at: "2026-12-06T04:59:59Z" });
    expect(await row(d, "teamtailor:t:1")).toMatchObject({ title: "PM", department: "R&D", closes_at: null });
  }, HEAVY);

  it("a row stored before .102 gains its date, JSON null clears it, and a string that is no ISO instant keeps the stored date without failing the batch", async () => {
    const d = await fresh();
    const was = "2026-11-20T04:59:59Z";
    await d.exec(`INSERT INTO public.job_board_postings (id, closes_at) VALUES
      ('a', NULL), ('b', '${was}'), ('c', '${was}'), ('d', '${was}'), ('e', '${was}'), ('f', '${was}'), ('g', '${was}'), ('h', '${was}')`);
    const n = await correct(d, [
      { id: "a", closes_at: "2026-11-21T04:59:59.000Z" },
      { id: "b", closes_at: null },
      { id: "c", closes_at: "now" },
      { id: "d", closes_at: "infinity" },
      { id: "e", closes_at: "not a date" },
      { id: "f", closes_at: 1_763_700_000 },
      { id: "g", closes_at: "2026-12-02T04:59:59+00:00" },
      { id: "h", title: "kept date" },
    ]);
    expect(n, "every row matched: a malformed value fails nothing").toBe(8);
    const got = Object.fromEntries(await Promise.all(["a", "b", "c", "d", "e", "f", "g", "h"].map(async (id) => [id, (await row(d, id)).closes_at])));
    expect(got).toEqual({
      a: "2026-11-21T04:59:59Z", // stored before .102: gains the date on its next read
      b: null, // JSON null clears
      c: was, d: was, e: was, f: was, // Postgres's own words, junk and a number: kept
      g: "2026-12-02T04:59:59Z", // PostgREST's spelling of an instant
      h: was, // key absent: untouched
    });
  }, HEAVY);

  it("the fourteen old columns behave as before: title and salary land, the pay columns cast behind their guards, an unknown key and another sweep's column are ignored", async () => {
    const d = await fresh();
    await d.exec(`INSERT INTO public.job_board_postings
      (id, title, salary, salary_min_annual, salary_max_annual, salary_period, remote, agency, department, closes_at, first_seen, posted_at, category) VALUES
      ('x', 'Old title', '$90,000', 90000, 95000, 'year', false, false, 'Eng', '2026-11-20T04:59:59Z', '2026-10-01T00:00:00Z', '2026-09-30T00:00:00Z', 'engineering')`);
    const n = await correct(d, [
      { id: "x", title: "New title", salary: "$100,000", salary_min_annual: 100000, salary_max_annual: null, salary_period: "year",
        remote: true, agency: "maybe", bogus: "ignored", first_seen: "2020-01-01T00:00:00Z", posted_at: "2020-01-01T00:00:00Z", category: "sales" },
      { title: "no id: matches no row" },
      { id: "", title: "blank id: matches no row" },
    ]);
    expect(n).toBe(1);
    const x = await row(d, "x");
    expect(x).toMatchObject({
      title: "New title", salary: "$100,000", salary_min_annual: 100000, salary_max_annual: null, salary_period: "year",
      remote: true, agency: false, department: "Eng", closes_at: "2026-11-20T04:59:59Z", category: "engineering",
    });
    expect(new Date(x.first_seen as string).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(new Date(x.posted_at as string).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(await correct(d, { id: "x", title: "not an array" }), "a non-array is no batch").toBe(0);
  }, HEAVY);

  it("only service_role may run it, from the default grants, and the file runs twice", async () => {
    // Alone on a fresh database (the function is born here with Supabase's default EXECUTE grants), and again on top.
    const d = await fresh([THIS, THIS]);
    const can = async (role: string) =>
      (await d.query<{ ok: boolean }>(`SELECT has_function_privilege($1, 'public.apply_posting_corrections(jsonb)', 'EXECUTE') AS ok`, [role])).rows[0].ok;
    expect({ anon: await can("anon"), authenticated: await can("authenticated"), service_role: await can("service_role") })
      .toEqual({ anon: false, authenticated: false, service_role: true });
    await d.exec("SET ROLE anon");
    try {
      await expect(correct(d, [])).rejects.toThrow(/permission denied for function apply_posting_corrections/);
    } finally {
      await d.exec("RESET ROLE");
    }
    await d.exec("INSERT INTO public.job_board_postings (id, department) VALUES ('s', 'R&amp;D')");
    await d.exec("SET ROLE service_role");
    try {
      expect(await correct(d, [{ id: "s", department: "R&D" }])).toBe(1);
    } finally {
      await d.exec("RESET ROLE");
    }
    expect((await row(d, "s")).department).toBe("R&D");
  }, HEAVY);

  it("its self-check fails a definition that lost an arm instead of passing it", async () => {
    const d = await fresh();
    const selfCheck = sqlOf(THIS).slice(sqlOf(THIS).lastIndexOf("DO $$"));
    await d.exec(selfCheck);
    await d.exec(sqlOf(BEFORE)); // the fourteen-column definition stands again
    await expect(d.exec(selfCheck)).rejects.toThrow(/apply_posting_corrections has no key-presence arm for department/);
  }, HEAVY);
});
