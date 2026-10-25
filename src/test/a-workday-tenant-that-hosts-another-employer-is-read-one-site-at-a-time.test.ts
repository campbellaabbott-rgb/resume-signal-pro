// @vitest-environment node
/**
 * A WORKDAY TENANT THAT HOSTS ANOTHER EMPLOYER IS READ ONE SITE AT A TIME
 * (sweep S12-130; migration 20261012135000).
 *
 * get_company_intel and get_similar_companies pooled a Workday token with
 * every site of its tenant, so the Madewell page (jcrew~wd1~MadewellCareers)
 * printed J.Crew's net-new roles, pay floor and fields, byte-identical to
 * J.Crew's page, on 17 tenants that host another employer's career site.
 * 20261009100100 already names those sites one by one (a full-token row in
 * company_name_overrides); now the readers read such a tenant one site at a
 * time, and every other tenant still pools its sites.
 *
 * On pglite, in the live order: the financials table (20260723021844), the
 * readers as 20260827140000 left them, 20261009160200, the employer key
 * (20261012100000), the profiles readers (20261012101000), then this file,
 * under Supabase's default grants. Every claim has its positive control on
 * the database without the fix.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");
const FIX = mig("20261012135000_");

const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    category text, country text, salary_currency text, salary_min_annual numeric, missing_since timestamptz,
    effective_posted timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.company_profiles (company_token text PRIMARY KEY, employee_count int, employee_basis text, yc_batch text);
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, company text NOT NULL DEFAULT '', open_roles int NOT NULL DEFAULT 0, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
`;

let n = 0;
const posts = (source: string, token: string, company: string, k: number, pay: number, category: string) =>
  Array.from({ length: k }, () => `('${source}:${token}:${n++}', '${source}', '${token}', '${company}', '${category}', 'US', 'USD', ${pay}, NULL, now() - interval '2 days')`);

const JCREW = "jcrew~wd1~JCrewCareers";
const MADEWELL = "jcrew~wd1~MadewellCareers";
const MEIJER_STORES = "meijer~wd5~Meijer_Stores_Hourly";
const MEIJER_CORP = "meijer~wd5~Meijer_Corporate";

const SEED = `
  INSERT INTO public.job_board_postings (id, source, company_token, company, category, country, salary_currency, salary_min_annual, missing_since, effective_posted) VALUES
  ${[
    ...posts("workday", JCREW, "J.Crew", 5, 60000, "retail"),
    ...posts("workday", MADEWELL, "Madewell", 3, 40000, "retail"),
    ...posts("workday", MEIJER_STORES, "Meijer", 4, 30000, "retail"),
    ...posts("workday", MEIJER_CORP, "Meijer", 2, 90000, "finance"),
    ...posts("greenhouse", "everlane", "Everlane", 4, 55000, "retail"),
  ].join(",\n  ")};
  INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('${JCREW}', 'J.Crew'), ('meijer', 'Meijer');
  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES
    ('${JCREW}', current_date - 6, 100), ('${JCREW}', current_date, 5),
    ('${MADEWELL}', current_date - 6, 3), ('${MADEWELL}', current_date, 3),
    ('${MEIJER_STORES}', current_date - 6, 2), ('${MEIJER_STORES}', current_date, 4),
    ('${MEIJER_CORP}', current_date - 6, 2), ('${MEIJER_CORP}', current_date, 2);
`;

const strip = (sql: string) => sql.replace(/NOTIFY pgrst[^;]*;/g, "");

async function boot(opts: { fix?: boolean; skipProfiles?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(strip(mig("20260723021844_")));
  await db.exec(mig("20260827140000_"));
  await db.exec(mig("20261009160200_"));
  await db.exec(mig("20261012100000_"));
  if (!opts.skipProfiles) await db.exec(mig("20261012101000_"));
  await db.exec(SEED);
  if (opts.fix) await db.exec(FIX);
  return db;
}

type Intel = { usd_n: number; median_usd_floor: number | null; net_7d: number | null };
const intel = async (db: PGlite, t: string) => (await db.query<{ j: Intel }>("SELECT public.get_company_intel($1) AS j", [t])).rows[0].j;
const similar = async (db: PGlite, t: string) =>
  (await db.query<{ j: Array<{ company_token: string }> }>("SELECT public.get_similar_companies($1, 20) AS j", [t])).rows[0].j.map((r) => r.company_token);

let before: PGlite, after: PGlite;
beforeAll(async () => { [before, after] = await Promise.all([boot(), boot({ fix: true })]); });

describe("the Madewell page reads Madewell", () => {
  it("positive control: before the fix, Madewell and J.Crew printed the same intel, pooled over both sites", async () => {
    const m = await intel(before, MADEWELL);
    const j = await intel(before, JCREW);
    expect(m.usd_n).toBe(8);
    // Every pooled figure the same; only open_by_source is per token.
    const pooled = (x: Intel & Record<string, unknown>) => ({ usd_n: x.usd_n, median: x.median_usd_floor, net_7d: x.net_7d, categories: x.categories });
    expect(pooled(m as never)).toEqual(pooled(j as never));
  });

  it("each site reads its own postings, pay floor and week", async () => {
    const m = await intel(after, MADEWELL);
    const j = await intel(after, JCREW);
    expect(m.usd_n).toBe(3);
    expect(Number(m.median_usd_floor)).toBe(40000);
    expect(m.net_7d, "J.Crew's fall from 100 to 5 leaked into Madewell's week").toBe(0);
    expect(j.usd_n).toBe(5);
    expect(Number(j.median_usd_floor)).toBe(60000);
    expect(j.net_7d).toBe(-95);
  });

  it("J.Crew is a different employer on Madewell's similar list, as Everlane is", async () => {
    expect(await similar(before, MADEWELL), "positive control: the tenant's other site was the page's own board").not.toContain(JCREW);
    const s = await similar(after, MADEWELL);
    expect(s).toContain(JCREW);
    expect(s).toContain("everlane");
    expect(s).not.toContain(MADEWELL);
  });
});

describe("a tenant whose sites are one employer still pools them", () => {
  it("Meijer's two sites read the same intel before and after", async () => {
    for (const db of [before, after]) {
      expect((await intel(db, MEIJER_STORES)).usd_n).toBe(6);
      expect((await intel(db, MEIJER_CORP)).usd_n).toBe(6);
      expect((await intel(db, MEIJER_STORES)).net_7d).toBe(2);
    }
  });

  it("the helper: a full-token override marks its tenant; a bare slug, another tenant and a plain token do not", async () => {
    const f = async (t: string) => (await after.query<{ b: boolean }>("SELECT public.workday_site_is_own_employer($1) AS b", [t])).rows[0].b;
    expect(await f(MADEWELL)).toBe(true);
    expect(await f(JCREW)).toBe(true);
    expect(await f(MEIJER_STORES)).toBe(false);
    expect(await f("jcrew")).toBe(false);
    expect(await f("everlane")).toBe(false);
  });

  it("a tenant named site by site later is split the day its row lands", async () => {
    const db = await boot({ fix: true });
    await db.exec(`INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('${MEIJER_CORP}', 'Meijer Corporate')`);
    expect((await intel(db, MEIJER_CORP)).usd_n).toBe(2);
    expect((await intel(db, MEIJER_STORES)).usd_n).toBe(4);
  });
});

describe("the migration", () => {
  it("is safe to run twice", async () => {
    const db = await boot({ fix: true });
    await db.exec(FIX);
    expect((await intel(db, MADEWELL)).usd_n).toBe(3);
  });

  it("the helper is private under Supabase's default grants; the readers keep anon", async () => {
    const priv = async (role: string, fn: string) =>
      (await after.query<{ ok: boolean }>(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, fn])).rows[0].ok;
    expect(await priv("anon", "public.workday_site_is_own_employer(text)")).toBe(false);
    expect(await priv("authenticated", "public.workday_site_is_own_employer(text)")).toBe(false);
    expect(await priv("service_role", "public.workday_site_is_own_employer(text)")).toBe(true);
    expect(await priv("anon", "public.get_company_intel(text)")).toBe(true);
    expect(await priv("anon", "public.get_similar_companies(text, integer)")).toBe(true);
  });

  it("refuses a live body it does not know rather than overwrite it", async () => {
    const db = await boot({ skipProfiles: true });
    await expect(db.exec(FIX)).rejects.toThrow(/drifted/);
  });
});
