// @vitest-environment node
/**
 * AN EMPLOYER NAMED BY ITS SYSTEM CODE GETS THE NAME IT USES.
 *
 * SEO & GEO report 2026-10-08, F1. Published pages named employers by their
 * Workday tenant code, title-cased: "Ms" for Morgan Stanley, "Pg", "Mdlz",
 * "Db", "Tmobile", "Rmit", "Hcmportal". Read with a crawler user-agent on
 * 2026-10-08, 209 of the 487 company pages and 146 posting-page employers
 * carried a name that folds to the token's first segment.
 *
 * Three things are checked here:
 *  1. the migration, run on a real Postgres (pglite) with the SHIPPED trigger
 *     function, renames the stored rows and every later write, and leaves a
 *     tenant's other employers alone where it keyed one site;
 *  2. supabase/functions/_shared/employer-names.ts, which the prerender and the
 *     app import, is the table the migrations leave (every write replayed);
 *  3. employerDisplayName resolves a token by the trigger's own precedence.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { replayNameOverrides } from "./helpers/name-overrides";
import {
  EMPLOYER_NAME_OVERRIDES,
  employerDisplayName,
  employerNameOverride,
  isSystemCodeName,
} from "../../supabase/functions/_shared/employer-names";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const mig = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const FILE = "20261009100100_an_employer_named_by_its_system_code_gets_the_name_it_uses.sql";

/** The trigger function as the latest migration that defines it ships it. */
const TRIGGER_FN = (() => {
  const src = mig("20260724224836_d71072f4-903d-4e53-b6be-04914724a3b3.sql");
  const m = /CREATE OR REPLACE FUNCTION public\.apply_company_name_override\(\)[\s\S]*?\$\$;/.exec(src);
  if (!m) throw new Error("apply_company_name_override moved; re-point this test");
  return m[0];
})();

const SCHEMA = `
  CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_postings (id text PRIMARY KEY, source text NOT NULL DEFAULT 'workday', company_token text NOT NULL, company text);
  CREATE TABLE public.job_board_closures (event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source text NOT NULL DEFAULT 'workday', company_token text, company text);
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, company text, PRIMARY KEY (company_token, snapshot_date));
  ${TRIGGER_FN}
  CREATE TRIGGER trg_company_name_override BEFORE INSERT OR UPDATE ON public.job_board_postings
    FOR EACH ROW EXECUTE FUNCTION public.apply_company_name_override();
  -- Live rows from earlier batches (Chanel's and Airbus's Workday tenants, NVIDIA).
  INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('nvidia', 'NVIDIA'), ('cc', 'Chanel'), ('ag', 'Airbus');
`;

let db: PGlite;
const nameOf = async (table: string, token: string) =>
  (await db.query<{ company: string }>(`SELECT company FROM public.${table} WHERE company_token = $1 LIMIT 1`, [token])).rows[0]?.company;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  // Rows stored before the names existed (inserted with the trigger off, as history was).
  await db.exec(`
    ALTER TABLE public.job_board_postings DISABLE TRIGGER trg_company_name_override;
    INSERT INTO public.job_board_postings (id, company_token, company) VALUES
      ('workday:ms~wd5~external:R1', 'ms~wd5~external', 'Ms'),
      ('workday:ms~wd5~private:R2', 'ms~wd5~private', 'Ms'),
      ('workday:pg~wd5~1000:R3', 'pg~wd5~1000', 'Pg'),
      ('workday:db~wd3~DBWebsite:R4', 'db~wd3~DBWebsite', 'Db'),
      ('workday:db~wd3~DWSWebsite:R5', 'db~wd3~DWSWebsite', 'Db'),
      ('workday:easyservice~wd5~MercyHealthCareers:R6', 'easyservice~wd5~MercyHealthCareers', 'Easyservice'),
      ('workday:easyservice~wd5~roperstfrancishealthcare:R7', 'easyservice~wd5~roperstfrancishealthcare', 'Easyservice'),
      ('workday:geico~wd1~External:R8', 'geico~wd1~External', 'Geico'),
      ('greenhouse:ms:R9', 'ms', 'Ms Studio'),
      ('greenhouse:cc:R11', 'cc', 'Chanel'),
      ('workday:nvidia~wd5~NVIDIAExternalCareerSite:R10', 'nvidia~wd5~NVIDIAExternalCareerSite', 'Nvidia');
    ALTER TABLE public.job_board_postings ENABLE TRIGGER trg_company_name_override;
    UPDATE public.job_board_postings SET source = 'greenhouse' WHERE id LIKE 'greenhouse:%';
    INSERT INTO public.job_board_closures (company_token, company) VALUES ('mdlz~wd3~External', 'Mdlz'), ('tmobile~wd1~External', 'Tmobile');
    INSERT INTO public.job_board_closures (source, company_token, company) VALUES ('greenhouse', 'ag', 'Airbus');
    INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, company) VALUES ('rmit~wd3~RMIT_Careers', '2026-10-07', 'Rmit');
  `);
  await db.exec(mig(FILE));
});
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the migration renames what is stored and everything written after it", () => {
  it("renames the stored postings of a named tenant, every site of it", async () => {
    expect(await nameOf("job_board_postings", "ms~wd5~external")).toBe("Morgan Stanley");
    expect(await nameOf("job_board_postings", "ms~wd5~private")).toBe("Morgan Stanley");
    expect(await nameOf("job_board_postings", "pg~wd5~1000")).toBe("P&G");
  });

  it("a site keyed by its full token is renamed; the tenant's other employers keep their names", async () => {
    expect(await nameOf("job_board_postings", "db~wd3~DBWebsite")).toBe("Deutsche Bank");
    expect(await nameOf("job_board_postings", "db~wd3~DWSWebsite")).toBe("Db");
    expect(await nameOf("job_board_postings", "easyservice~wd5~MercyHealthCareers")).toBe("Mercy Health");
    expect(await nameOf("job_board_postings", "easyservice~wd5~roperstfrancishealthcare")).toBe("Easyservice");
  });

  it("never touches a board it does not name, nor a non-Workday token that shares a slug", async () => {
    expect(await nameOf("job_board_postings", "geico~wd1~External")).toBe("Geico");
    expect(await nameOf("job_board_postings", "ms")).toBe("Ms Studio");
  });

  it("a bare greenhouse token that shares a tenant slug gets its own name back, and keeps it", async () => {
    // The trigger matched "cc" (Chanel's Workday tenant) as a full token, so Climate Corps read as Chanel.
    expect(await nameOf("job_board_postings", "cc")).toBe("Climate Corps");
    expect(await nameOf("job_board_closures", "ag")).toBe("Avathon Government");
    await db.exec(`INSERT INTO public.job_board_postings (id, source, company_token, company) VALUES
      ('greenhouse:cc:R12', 'greenhouse', 'cc', 'Climate Corps'),
      ('greenhouse:nc:R13', 'greenhouse', 'nc', 'NorthCoast Asset Management')`);
    const after = (await db.query<{ id: string; company: string }>(`SELECT id, company FROM public.job_board_postings WHERE id IN ('greenhouse:cc:R12', 'greenhouse:nc:R13') ORDER BY id`)).rows;
    expect(after.map((r) => r.company)).toEqual(["Climate Corps", "NorthCoast Asset Management"]);
  });

  it("renames the closure ledger and the snapshots too", async () => {
    expect(await nameOf("job_board_closures", "mdlz~wd3~External")).toBe("Mondelēz International");
    expect(await nameOf("job_board_closures", "tmobile~wd1~External")).toBe("T-Mobile");
    expect(await nameOf("job_board_company_snapshots", "rmit~wd3~RMIT_Careers")).toBe("RMIT University");
  });

  it("re-applies an older override whose rows had drifted, and a later ingest write cannot undo any of it", async () => {
    expect(await nameOf("job_board_postings", "nvidia~wd5~NVIDIAExternalCareerSite")).toBe("NVIDIA");
    await db.exec(`INSERT INTO public.job_board_postings (id, company_token, company) VALUES ('workday:ms~wd5~external:R99', 'ms~wd5~external', 'Ms')`);
    expect((await db.query<{ company: string }>(`SELECT company FROM public.job_board_postings WHERE id = 'workday:ms~wd5~external:R99'`)).rows[0].company).toBe("Morgan Stanley");
  });

  it("is safe to run again", async () => {
    await db.exec(mig(FILE));
    expect(await nameOf("job_board_postings", "ms~wd5~external")).toBe("Morgan Stanley");
  });
});

describe("the module the prerender and the app import is the table the migrations leave", () => {
  it("every override any migration wrote, and nothing else, with the same name", () => {
    const table = replayNameOverrides();
    expect(table.size, "the replay found almost nothing; the reader broke").toBeGreaterThan(300);
    expect(Object.fromEntries([...EMPLOYER_NAME_OVERRIDES].sort()), "add the row to both the migration and employer-names.ts").toEqual(Object.fromEntries([...table].sort()));
  });
});

describe("employerDisplayName resolves a token the way the trigger does", () => {
  it("the published codes the SEO report named now read as the employers", () => {
    expect(employerDisplayName("ms~wd5~external", "Ms")).toBe("Morgan Stanley");
    expect(employerDisplayName("rmit~wd3~RMIT_Careers", "Rmit")).toBe("RMIT University");
    expect(employerDisplayName("hcmportal~wd5~Search", "Hcmportal")).toBe("UPS");
    expect(employerDisplayName("mdlz~wd3~External", "Mdlz")).toBe("Mondelēz International");
  });

  it("an exact token outranks its tenant; a slug applies only to a Workday token", () => {
    expect(employerDisplayName("db~wd3~DBWebsite", "Db")).toBe("Deutsche Bank");
    expect(employerDisplayName("db~wd3~DWSWebsite", "Db")).toBe("Db");
    expect(employerDisplayName("ms", "Ms Studio")).toBe("Ms Studio");
    expect(employerDisplayName("cc", "Climate Corps")).toBe("Climate Corps");
    expect(employerDisplayName("cc~wd3~ChanelCareers", "Cc")).toBe("Chanel");
    expect(employerDisplayName("ebqb~us2~CX_1", "BDO")).toBe("BDO USA");
  });

  it("an unknown board keeps its stored name, and a prototype key is just a key", () => {
    expect(employerDisplayName("acme", " Acme Corp ")).toBe("Acme Corp");
    expect(employerDisplayName(null, null)).toBe("");
    expect(employerNameOverride("constructor")).toBeNull();
    expect(employerNameOverride("toString~wd1~x")).toBeNull();
  });

  it("isSystemCodeName flags a name that is still the tenant code, and not one that has its name", () => {
    expect(isSystemCodeName("geico~wd1~External", "Geico")).toBe(true);
    expect(isSystemCodeName("ms~wd5~external", "Ms")).toBe(false);
    expect(isSystemCodeName("acme~wd1~x", "Acme Health")).toBe(false);
  });
});
