// @vitest-environment node
/**
 * A SIMILAR EMPLOYER IS NAMED BY ITS BOARD, AND THE FEDERAL LISTING SITE IS
 * NOT ONE (migration 20261012136000, 2026-10-18 review).
 *
 * Live on 2026-10-18, get_similar_companies for CVS Health and for Eurofins
 * led with {company: 'Veterans Health Administration', company_token:
 * 'usajobs'}: max(company) named the federal listing site after its
 * alphabetically last agency, under a list described as companies hiring
 * from their own career systems. The same max() picked an arbitrary brand on
 * a multi-brand board, and the list admitted agency boards and board names
 * two hiring systems share.
 *
 * On pglite, in the live order (the 20261012135000 test's boot), then this
 * file, under Supabase's default grants. Each claim has its positive control
 * on the database without the fix.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");
const FIX = mig("20261012136000_");

const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    category text, country text, salary_currency text, salary_min_annual numeric, missing_since timestamptz,
    effective_posted timestamptz NOT NULL DEFAULT now(), agency boolean NOT NULL DEFAULT false
  );
  CREATE TABLE public.company_profiles (company_token text PRIMARY KEY, employee_count int, employee_basis text, yc_batch text);
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, company text NOT NULL DEFAULT '', open_roles int NOT NULL DEFAULT 0, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
`;

let n = 0;
const posts = (source: string, token: string, company: string, k: number, category: string, agency = false) =>
  Array.from({ length: k }, () => `('${source}:${token}:${n++}', '${source}', '${token}', '${company}', '${category}', 'US', 'USD', 50000, NULL, now() - interval '2 days', ${agency})`);

const CVS = "cvshealth~wd1~CVS_Health_Careers";
const SEED = `
  INSERT INTO public.job_board_postings (id, source, company_token, company, category, country, salary_currency, salary_min_annual, missing_since, effective_posted, agency) VALUES
  ${[
    ...posts("workday", CVS, "CVS Health", 6, "healthcare"),
    // The federal listing site: many agencies under one token.
    ...posts("usajobs", "usajobs", "Department of the Army", 9, "healthcare"),
    ...posts("usajobs", "usajobs", "Veterans Health Administration", 2, "healthcare"),
    // A staffing agency's board.
    ...posts("breezy", "surge", "Surge Staffing", 8, "healthcare", true),
    // A board name two hiring systems carry.
    ...posts("greenhouse", "clear", "CLEAR - Corporate", 4, "healthcare"),
    ...posts("bamboohr", "clear", "Clear", 3, "healthcare"),
    // A multi-brand board: most rows say Alpha Health, one says Zeta Clinics.
    ...posts("greenhouse", "alphahealth", "Alpha Health", 5, "healthcare"),
    ...posts("greenhouse", "alphahealth", "Zeta Clinics", 1, "healthcare"),
    // A board whose full-token override names it.
    ...posts("workday", "kp~wd5~KP_Careers", "kp", 4, "healthcare"),
  ].join(",\n  ")};
  INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('kp~wd5~KP_Careers', 'Kaiser Permanente');
`;

const strip = (sql: string) => sql.replace(/NOTIFY pgrst[^;]*;/g, "");

async function boot(opts: { fix?: boolean; skip135?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(strip(mig("20260723021844_")));
  await db.exec(mig("20260827140000_"));
  await db.exec(mig("20261009160200_"));
  await db.exec(mig("20261012100000_"));
  await db.exec(mig("20261012101000_"));
  if (!opts.skip135) await db.exec(mig("20261012135000_"));
  await db.exec(SEED);
  if (opts.fix) await db.exec(strip(FIX));
  return db;
}

type Row = { company: string; company_token: string; open_roles: number };
const similar = async (db: PGlite, t: string) =>
  (await db.query<{ j: Row[] }>("SELECT public.get_similar_companies($1, 20) AS j", [t])).rows[0].j;

let before: PGlite, after: PGlite;
beforeAll(async () => { [before, after] = await Promise.all([boot(), boot({ fix: true })]); });

describe("the list of employers hiring in the same field", () => {
  it("positive control: before the fix, CVS Health's list led with USAJOBS named after an agency", async () => {
    const s = await similar(before, CVS);
    expect(s[0]).toMatchObject({ company_token: "usajobs", company: "Veterans Health Administration" });
  });

  it("never lists the USAJOBS board, under any name", async () => {
    const s = await similar(after, CVS);
    expect(s.map((r) => r.company_token)).not.toContain("usajobs");
    expect(s.map((r) => r.company)).not.toContain("Veterans Health Administration");
    expect(s.map((r) => r.company)).not.toContain("Department of the Army");
  });

  it("leaves out a staffing agency's board and a board name two hiring systems share", async () => {
    const b = (await similar(before, CVS)).map((r) => r.company_token);
    expect(b, "positive control").toEqual(expect.arrayContaining(["surge", "clear"]));
    const s = (await similar(after, CVS)).map((r) => r.company_token);
    expect(s).not.toContain("surge");
    expect(s).not.toContain("clear");
  });

  it("names a board by its full-token override, else by the name most of its rows carry, never the alphabetically last", async () => {
    const b = await similar(before, CVS);
    expect(b.find((r) => r.company_token === "alphahealth")?.company, "positive control").toBe("Zeta Clinics");
    const s = await similar(after, CVS);
    expect(s.find((r) => r.company_token === "alphahealth")?.company).toBe("Alpha Health");
    expect(s.find((r) => r.company_token === "kp~wd5~KP_Careers")?.company).toBe("Kaiser Permanente");
  });
});

describe("the migration", () => {
  it("is safe to run twice and keeps the reader anon-executable", async () => {
    const db = await boot({ fix: true });
    await db.exec(strip(FIX));
    expect((await similar(db, CVS)).map((r) => r.company_token)).not.toContain("usajobs");
    const { rows } = await db.query<{ ok: boolean }>("SELECT has_function_privilege('anon', 'public.get_similar_companies(text, integer)', 'EXECUTE') AS ok");
    expect(rows[0].ok).toBe(true);
  });

  it("keeps 20261012135000's hosting-tenant rule, and refuses to run before it", async () => {
    const { rows } = await after.query<{ d: string }>("SELECT pg_get_functiondef('public.get_similar_companies(text, integer)'::regprocedure) AS d");
    expect(rows[0].d).toContain("workday_site_is_own_employer(p_token)");
    const db = await boot({ skip135: true });
    await expect(db.exec(strip(FIX))).rejects.toThrow(/20261012135000 is not applied/);
  });

  it("refuses a live body it does not know rather than overwrite it", async () => {
    const db = await boot();
    await db.exec(`DO $x$ BEGIN EXECUTE replace(pg_get_functiondef('public.get_similar_companies(text, integer)'::regprocedure), 'HAVING count(*) >= 3', 'HAVING count(*) >= 4'); END $x$;`);
    await expect(db.exec(strip(FIX))).rejects.toThrow(/drifted/);
  });
});
