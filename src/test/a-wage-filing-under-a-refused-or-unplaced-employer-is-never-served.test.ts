// @vitest-environment node
/**
 * A WAGE FILING UNDER A REFUSED OR UNPLACED EMPLOYER IS NEVER SERVED
 * (S14X-067, S14X-068, RC-OI-21).
 *
 * The rejected-pair ledger lived only in the deploy's refusal, so the cells
 * already loaded for socialfinance and sigmasoftware2 (and the twin-vendor
 * token sunday) kept printing, and two more name matches (a Missouri health
 * network's filings on a California board, a Minnesota distributor's on a
 * Florida board) printed with nothing to refuse them. A board whose postings
 * all leave the country blank (Hisense USA: "Alpharetta, Georgia") printed
 * nothing although its cells are GA.
 *
 * pglite from Supabase's default grants: the LCA lane's migrations, then
 * 20261009160300, then the fix (applied twice).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { decodeLcaCells, LCA_REFUSED_TOKENS } from "../../supabase/functions/layoff-filings/lca-cells";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), "utf8");
const LCA_LANE = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && f < "20261009" && /oflc_lca_wages/.test(read(f)))
  .sort();
const GATE = readdirSync(MIGRATIONS).find((f) => f.startsWith("20261009160300_"))!;
const FIX = readdirSync(MIGRATIONS).find((f) => f.startsWith("20261112180000_"))!;

const COMPASS = "ebb9e98a-78f1-47eb-a562-c52b36b09dd3";
const PATTERSON = "32d78507-2175-47fb-8427-a89a691203be";

const DEFAULTS = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  CREATE TABLE IF NOT EXISTS public.job_board_postings (
    id text PRIMARY KEY, company_token text NOT NULL, country text, missing_since timestamptz, location text, region_code text
  );
  CREATE TABLE IF NOT EXISTS public.layoff_read_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind text, fetched int, kept int, new_rows int, ok boolean, ms int, note text,
    at timestamptz NOT NULL DEFAULT now()
  );
`;
const cell = (tok: string, st: string, n = 8) =>
  `('${tok}', '15-1252', 'Software Developers', '${st}', 100000, 130000, 115000, ${n}, 'FY2026 Q1-Q3', 'LCA_Disclosure_Data_FY2026_Q3.xlsx', 'https://www.dol.gov/x.xlsx', '2026-08-07', '2025-10-01', '2026-06-30')`;
const post = (id: string, tok: string, country: string | null, location: string, region: string | null = null) =>
  `('${id}', '${tok}', ${country == null ? "NULL" : `'${country}'`}, NULL, '${location}', ${region == null ? "NULL" : `'${region}'`})`;

async function boot(withFix: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(DEFAULTS);
  for (const f of LCA_LANE) await db.exec(read(f));
  await db.exec(read(GATE));
  await db.exec(`
    INSERT INTO public.oflc_lca_wages (company_token, soc_code, soc_title, worksite_state, wage_low_annual, wage_high_annual,
      wage_median_annual, filings_n, fiscal_quarter, source_file, source_url, published_on, coverage_from, coverage_to)
    VALUES ${cell("socialfinance", "WA", 66)}, ${cell("sigmasoftware2", "TX", 11)}, ${cell("sunday", "CA")}, ${cell("echo", "CA")},
           ${cell(COMPASS, "MO", 6)}, ${cell(PATTERSON, "MN", 5)}, ${cell("hisenseusacorporation", "GA", 9)},
           ${cell("unplaced", "MN")}, ${cell("mixed", "TX")}, ${cell("regioned", "GA")}, ${cell("acme", "CA", 12)};
    INSERT INTO public.job_board_postings (id, company_token, country, missing_since, location, region_code) VALUES
      ${post("sf1", "socialfinance", "US", "Boston, MA")}, ${post("sg1", "sigmasoftware2", "US", "New York, NY")},
      ${post("su1", "sunday", "US", "San Francisco, CA")}, ${post("ec1", "echo", "US", "San Jose, CA")},
      ${post("co1", COMPASS, "US", "Hearthside")}, ${post("pa1", PATTERSON, "US", "Plant City, FL")},
      ${post("hi1", "hisenseusacorporation", null, "Alpharetta, Georgia")}, ${post("hi2", "hisenseusacorporation", "", "Alpharetta, Georgia")},
      ${post("un1", "unplaced", null, "Plant City, FL")},
      ${post("mx1", "mixed", "PL", "Warsaw")}, ${post("mx2", "mixed", null, "Austin, Texas")},
      ${post("rg1", "regioned", null, "Remote", "US-GA")},
      ${post("ac1", "acme", "US", "San Diego, CA")};
  `);
  if (withFix) {
    await db.exec(read(FIX));
    await db.exec(read(FIX)); // safe to re-run
  }
  return db;
}
type Row = { ow_soc_code: string | null; ow_worksite_state: string | null; ow_employer_filings_n: number | null };
const wages = async (db: PGlite, tok: string) =>
  (await db.query<Row>("SELECT * FROM public.get_employer_lca_wages(ARRAY[$1]::text[])", [tok])).rows[0];

describe("the wage reader refuses the ledger and places a blank-country board by its own words", () => {
  let before: PGlite, after: PGlite;
  beforeAll(async () => { before = await boot(false); after = await boot(true); });

  it("positive control: before the fix the ledger's and the twins' cells printed, and the blank-country board printed none", async () => {
    expect((await wages(before, "socialfinance")).ow_soc_code).toBe("15-1252");
    expect((await wages(before, "sigmasoftware2")).ow_soc_code).toBe("15-1252");
    expect((await wages(before, COMPASS)).ow_soc_code).toBe("15-1252");
    expect((await wages(before, "hisenseusacorporation")).ow_soc_code).toBeNull();
  });

  it("a ledger token and a twin-vendor token answer the no-cell row, even with a live US posting", async () => {
    for (const tok of ["socialfinance", "sigmasoftware2", "sunday", "echo", COMPASS, PATTERSON]) {
      const r = await wages(after, tok);
      expect(r.ow_soc_code, `${tok} still prints a filed wage`).toBeNull();
      expect(r.ow_employer_filings_n, `${tok} still prints a sponsor count`).toBeNull();
    }
  });

  it("a board whose postings leave the country blank prints the cell of the state its location names", async () => {
    const h = await wages(after, "hisenseusacorporation");
    expect(h.ow_soc_code, "Hisense's GA cells stayed hidden behind a blank country").toBe("15-1252");
    expect(h.ow_worksite_state).toBe("GA");
    expect((await wages(after, "regioned")).ow_worksite_state, "a stated region code places the board too").toBe("GA");
  });

  it("a blank-country board that names no cell state, or one with any other country, still prints nothing; a US employer still prints", async () => {
    expect((await wages(after, "unplaced")).ow_soc_code).toBeNull();
    expect((await wages(after, "mixed")).ow_soc_code).toBeNull();
    expect((await wages(after, "acme")).ow_soc_code).toBe("15-1252");
  });

  it("the ledger table is the service role's alone, and the reader keeps its anon grant", async () => {
    const priv = async (role: string, p: string) =>
      (await after.query<{ ok: boolean }>(`SELECT has_table_privilege($1, 'public.lca_refused_tokens', $2) AS ok`, [role, p])).rows[0].ok;
    for (const role of ["anon", "authenticated"]) for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(await priv(role, p), `${role} ${p}`).toBe(false);
    expect(await priv("service_role", "SELECT")).toBe(true);
    const fn = await after.query<{ ok: boolean }>(`SELECT has_function_privilege('anon', 'public.get_employer_lca_wages(text[], text, text)', 'EXECUTE') AS ok`);
    expect(fn.rows[0].ok).toBe(true);
  });

  it("the SQL ledger is the code's ledger, and the two new tokens carry cells in the embedded payload", async () => {
    const seeded = (await after.query<{ company_token: string }>("SELECT company_token FROM public.lca_refused_tokens ORDER BY 1")).rows.map((r) => r.company_token);
    expect(seeded).toEqual(Object.keys(LCA_REFUSED_TOKENS).sort());
    const cells = await decodeLcaCells();
    for (const tok of [COMPASS, PATTERSON]) expect(cells.some((c) => c.company_token === tok), `${tok} has no cell in the payload`).toBe(true);
  });
});
