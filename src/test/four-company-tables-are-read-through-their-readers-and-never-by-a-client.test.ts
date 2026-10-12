/**
 * FOUR COMPANY TABLES ARE READ THROUGH THEIR READERS, NEVER BY A CLIENT
 * (20261012130000).
 *
 * Lovable's security scan flagged showcase_excluded, company_profiles,
 * company_financials and company_name_overrides as client-readable: each was
 * created with a SELECT policy USING (true) and a grant to anon and
 * authenticated. The migration drops every policy that admits a client role,
 * revokes every table and column privilege from PUBLIC, anon and
 * authenticated, keeps ALL for the service role, and checks itself.
 *
 * The database here starts from Supabase's own default grants (every new
 * public table is granted ALL to anon, authenticated and service_role, the
 * pattern helpers/agent-db.ts documents), builds the four tables the way
 * their creating migrations did, and puts the readers beside them: the three
 * company-page readers as SECURITY DEFINER stand-ins with their live
 * signatures, a definer leaderboard, and the LIVE name-override trigger
 * function read from the migrations (it runs with the writer's rights).
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { liveDefinitionOf } from "./helpers/live-sql";

const FILE = "20261012130000_four_company_tables_are_read_through_their_readers_and_never_by_a_client.sql";
const MIGRATION = readFileSync(resolve(__dirname, "../../supabase/migrations", FILE), "utf8");
const TABLES = ["showcase_excluded", "company_profiles", "company_financials", "company_name_overrides"] as const;

const BASE = `
  -- Supabase's service_role bypasses row level security; the client roles do not.
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY, reason text NOT NULL DEFAULT '');
  ALTER TABLE public.showcase_excluded ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "showcase_excluded_public_read" ON public.showcase_excluded FOR SELECT USING (true);
  GRANT SELECT ON public.showcase_excluded TO anon, authenticated;

  CREATE TABLE public.company_profiles (company_token text PRIMARY KEY, employee_count integer NOT NULL,
    employee_basis text NOT NULL, yc_batch text, as_of date);
  ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "company_profiles_public_read" ON public.company_profiles FOR SELECT USING (true);
  GRANT SELECT ON public.company_profiles TO anon, authenticated;

  CREATE TABLE public.company_financials (slug text PRIMARY KEY, cik bigint NOT NULL, ticker text NOT NULL,
    exchange text NOT NULL DEFAULT '', sec_name text NOT NULL DEFAULT '', currency text NOT NULL DEFAULT 'USD',
    series jsonb NOT NULL DEFAULT '[]'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(), matched_source text);
  ALTER TABLE public.company_financials ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "company_financials_public_read" ON public.company_financials FOR SELECT USING (true);
  GRANT SELECT ON public.company_financials TO anon, authenticated;

  CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL,
    added_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.company_name_overrides ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "company_name_overrides_public_read" ON public.company_name_overrides FOR SELECT USING (true);
  GRANT SELECT ON public.company_name_overrides TO anon, authenticated;
  -- A column grant a table REVOKE does not remove.
  GRANT SELECT (display_name) ON public.company_name_overrides TO anon;

  CREATE TABLE public.job_board_postings (id text PRIMARY KEY, company_token text, company text);
  REVOKE ALL ON public.job_board_postings FROM anon, authenticated;

  INSERT INTO public.showcase_excluded VALUES ('spamco', 'aggregator');
  INSERT INTO public.company_profiles VALUES ('acme', 1200, 'public_records', NULL, NULL), ('beta', 40, 'yc_self_reported', 'W21', NULL);
  INSERT INTO public.company_financials (slug, cik, ticker, sec_name, matched_source) VALUES ('acme', 12345, 'ACME', 'Acme Corp', 'greenhouse');
  INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('acmewd', 'Acme Health');

  -- The company page's three readers: definers with their live signatures.
  CREATE FUNCTION public.get_company_intel(p_token text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT jsonb_build_object('employees', (SELECT employee_count FROM public.company_profiles WHERE company_token = p_token)) $$;
  CREATE FUNCTION public.get_company_financials(p_token text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT to_jsonb(f) - 'cik' FROM public.company_financials f WHERE f.slug = p_token $$;
  CREATE FUNCTION public.get_similar_companies(p_token text, p_limit int DEFAULT 6)
    RETURNS TABLE (company_token text, employees int)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT pr.company_token, pr.employee_count FROM public.company_profiles pr
       WHERE pr.company_token <> p_token
         AND pr.company_token NOT IN (SELECT s.company_token FROM public.showcase_excluded s)
       ORDER BY pr.employee_count DESC LIMIT p_limit $$;
  -- A leaderboard the hourly cache and the page call, also a definer.
  CREATE FUNCTION public.get_trending_companies() RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT count(*) FROM public.showcase_excluded $$;
  REVOKE ALL ON FUNCTION public.get_company_intel(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.get_company_financials(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.get_similar_companies(text, int) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_company_intel(text) TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_company_financials(text) TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_similar_companies(text, int) TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_trending_companies() TO anon, authenticated, service_role;
`;

/** The live trigger function, as the last migration that defines it wrote it. */
const TRIGGER_FN = `${liveDefinitionOf("apply_company_name_override").body.replace(/^FUNCTION/, "CREATE OR REPLACE FUNCTION")}\n$$;
  CREATE TRIGGER trg_company_name_override BEFORE INSERT OR UPDATE ON public.job_board_postings
    FOR EACH ROW EXECUTE FUNCTION public.apply_company_name_override();
  GRANT ALL ON public.job_board_postings TO service_role;`;

async function fresh(extra = ""): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(TRIGGER_FN);
  if (extra) await db.exec(extra);
  return db;
}

/** Runs `sql` as `role`; the SQLSTATE it fails with, or "ok". */
async function as(db: PGlite, role: string, sql: string): Promise<string> {
  try {
    await db.exec(`SET ROLE ${role}; ${sql}; RESET ROLE;`);
    return "ok";
  } catch (e) {
    await db.exec("RESET ROLE;");
    return String((e as { code?: string }).code ?? (e as Error).message);
  }
}

describe("before the lock: the hole the scan found is real here", () => {
  it("anon reads every one of the four tables directly", async () => {
    const db = await fresh();
    for (const t of TABLES) expect(await as(db, "anon", `SELECT * FROM public.${t}`), t).toBe("ok");
  });
});

describe("after the lock", () => {
  it("no client role can read or write any of the four, and the service role still can", async () => {
    const db = await fresh();
    await db.exec(MIGRATION);
    for (const t of TABLES) {
      for (const role of ["anon", "authenticated"]) {
        expect(await as(db, role, `SELECT 1 FROM public.${t} LIMIT 1`), `${role} SELECT ${t}`).toBe("42501");
        expect(await as(db, role, `DELETE FROM public.${t}`), `${role} DELETE ${t}`).toBe("42501");
      }
      expect(await as(db, "service_role", `SELECT 1 FROM public.${t} LIMIT 1`), `service_role SELECT ${t}`).toBe("ok");
    }
    expect(await as(db, "anon", "SELECT display_name FROM public.company_name_overrides"), "the column grant is gone too").toBe("42501");
    expect(await as(db, "authenticated", "INSERT INTO public.showcase_excluded VALUES ('x', 'y')")).toBe("42501");
    expect(await as(db, "service_role", "INSERT INTO public.showcase_excluded VALUES ('x', 'y')")).toBe("ok");
  });

  it("drops every policy that admits a client role and keeps row level security on", async () => {
    const db = await fresh();
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)`, [TABLES as unknown as string[]]);
    expect(rows[0].n).toBe(0);
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1)`, [TABLES as unknown as string[]]);
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("every reader the page calls as anon still answers as anon, from the locked tables", async () => {
    const db = await fresh();
    await db.exec(MIGRATION);
    await db.exec("SET ROLE anon;");
    const fin = await db.query<{ j: { ticker: string } }>("SELECT public.get_company_financials('acme') AS j");
    const intel = await db.query<{ j: { employees: number } }>("SELECT public.get_company_intel('acme') AS j");
    const sim = await db.query<{ company_token: string }>("SELECT * FROM public.get_similar_companies('acme', 5)");
    const lb = await db.query<{ n: string }>("SELECT public.get_trending_companies() AS n");
    await db.exec("RESET ROLE;");
    expect(fin.rows[0].j.ticker).toBe("ACME");
    expect(intel.rows[0].j.employees).toBe(1200);
    expect(sim.rows.map((r) => r.company_token)).toEqual(["beta"]);
    expect(Number(lb.rows[0].n)).toBe(1);
  });

  it("the name-override trigger still names a service-role write (it runs with the writer's rights)", async () => {
    const db = await fresh();
    await db.exec(MIGRATION);
    await db.exec("SET ROLE service_role; INSERT INTO public.job_board_postings VALUES ('p1', 'acmewd~wd1~Careers', 'raw name'); RESET ROLE;");
    const { rows } = await db.query<{ company: string }>("SELECT company FROM public.job_board_postings WHERE id = 'p1'");
    expect(rows[0].company).toBe("Acme Health");
  });

  it("is safe to run twice", async () => {
    const db = await fresh();
    await db.exec(MIGRATION);
    await expect(db.exec(MIGRATION)).resolves.toBeDefined();
    expect(await as(db, "anon", "SELECT 1 FROM public.company_financials")).toBe("42501");
  });
});

describe("the self-check has teeth", () => {
  it("refuses to lock while an INVOKER reader a client can execute would break", async () => {
    const db = await fresh(`
      CREATE FUNCTION public.headcount_of(p text) RETURNS int LANGUAGE sql STABLE AS $$
        SELECT employee_count FROM public.company_profiles WHERE company_token = p $$;
      GRANT EXECUTE ON FUNCTION public.headcount_of(text) TO anon;`);
    await expect(db.exec(MIGRATION)).rejects.toThrow(/headcount_of\(text\) \(invoker a client can execute\)/);
    // Rolled back: the hole is still open, not half shut.
    expect(await as(db, "anon", "SELECT 1 FROM public.company_profiles")).toBe("ok");
  });

  it("refuses when the company page's reader is not executable by anon", async () => {
    const db = await fresh("REVOKE EXECUTE ON FUNCTION public.get_company_financials(text) FROM anon;");
    await expect(db.exec(MIGRATION)).rejects.toThrow(/anon cannot execute get_company_financials/);
  });

  it("refuses when a reader fails as anon (it would fail on the page)", async () => {
    const db = await fresh(`
      CREATE OR REPLACE FUNCTION public.get_company_intel(p_token text) RETURNS jsonb
        LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
          SELECT jsonb_build_object('employees', (SELECT employee_count FROM public.company_profiles WHERE company_token = p_token)) $$;`);
    await expect(db.exec(MIGRATION)).rejects.toThrow(/get_company_intel\(text\) \(invoker a client can execute\)/);
  });
});

describe("the file follows the house rules", () => {
  const code = MIGRATION.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  it("revokes from all three client grantees by name and never grants a client anything", () => {
    for (const t of TABLES) expect(code).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    expect(code).not.toMatch(/GRANT[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i);
  });
  it("sits in this round's lock range and after the migrations that opened the tables", () => {
    expect(FILE.slice(0, 14) >= "20261012130000" && FILE.slice(0, 14) <= "20261012134999").toBe(true);
    for (const opened of ["20260721034113", "20260722161307", "20260722154604", "20260723021844", "20261012102000"]) {
      expect(FILE.slice(0, 14) > opened).toBe(true);
    }
  });
});
