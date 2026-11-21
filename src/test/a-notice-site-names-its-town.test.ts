// @vitest-environment node
/**
 * A STATE NOTICE PRINTED A BARE STREET AS ITS SITE (S14X-185).
 *
 * Illinois keeps the street and the town in two columns, and layoff-filings
 * stores them as site_raw and site_city. Both layoff readers printed
 * COALESCE(NULLIF(site_raw, ''), site_city), the town only when there was no
 * street, so Tyson Foods' Illinois notice for 2,495 workers read "positions at
 * 28424 38TH Ave. North" while the state's file names the town, Hillsdale.
 *
 * Proven on a real Postgres (pglite), started from Supabase's default grants:
 * the layoff lane's migrations, 20261009160000 and 20261009160100 (the
 * readers as production serves them), then the fix. Before it, the Illinois
 * notice prints the bare street (positive control). After it, both readers
 * print the street with its town; a site with no town, a street that already
 * names its town, and a town with no street print as before; a road named
 * after the town is not mistaken for the town; and nothing else about either
 * reader moved (definition, grants, return shape).
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const ALL = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const CHAIN = [
  ...ALL.filter((f) => /^202609181\d{5}_/.test(f)),
  ALL.find((f) => f.startsWith("20261009160000_"))!,
  ALL.find((f) => f.startsWith("20261009160100_"))!,
];
/** The fix, selected by the DDL unique to it. */
const FIX = ALL.find((f) => readFileSync(resolve(MIGRATIONS, f), "utf8").includes("CREATE OR REPLACE FUNCTION public.layoff_site_text("));

const STAND_INS = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz, country text, region_code text);
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text);
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz);
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
`;

const q = (s: string | null) => (s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`);
/** One state notice as the writer stores it, matched to its own board token. */
type Notice = { token: string; state: string; site: string | null; city: string | null; eventDaysAgo?: number };
const NOTICES: Notice[] = [
  { token: "tysonfoods~wd5~TSN", state: "IL", site: "28424 38TH Ave. North", city: "Hillsdale" },
  { token: "alaska", state: "WA", site: "Seattle, Spokane, Renton", city: null },
  { token: "vail", state: "AZ", site: "13801 E. Benson HWY; Vail, Arizona 85641", city: "Vail" },
  { token: "schaumburg", state: "IL", site: "2411 WEST SCHAUMBURG ROAD", city: "SCHAUMBURG" },
  { token: "skokie", state: "IL", site: "7447 Skokie Blvd", city: "Skokie" },
  { token: "arsenal", state: "IL", site: "Rock Island Arsenal", city: "Rock Island" },
  { token: "ohare", state: "IL", site: "CHICAGO O'HARE INTRN'L AIRPORT TERMINAL 1", city: "Chicago" },
  { token: "lisle", state: "IL", site: "100 Carlisle Ave", city: "Lisle" },
  { token: "stlouis", state: "IL", site: "1 Main St., St. Louis, MO", city: "St. Louis" },
  { token: "stlouis-bare", state: "IL", site: "1 Main St.", city: "St. Louis" },
  { token: "oakbrook", state: "IL", site: "5 OAK  BROOK CENTER", city: "Oak Brook" },
  { token: "oakbrook-sites", state: "IL", site: "Multiple Oak Brook sites", city: "Oak  Brook" },
  { token: "stlouis-dot", state: "IL", site: "100 StA Louis Building", city: "St. Louis" },
  { token: "burlington", state: "IA", site: null, city: "Burlington" },
  { token: "blank-city", state: "IL", site: "3 Lakes Dr.", city: "  " },
  { token: "nothing", state: "IL", site: "", city: null },
  { token: "metachars", state: "IL", site: "9 Elm St", city: "Foo (Bar* [x]" },
  { token: "tysonfoods~wd5~TSN", state: "IL", site: "1 Older Rd", city: "Joslin", eventDaysAgo: 60 },
];
const EXPECTED: Record<string, string | null> = {
  "tysonfoods~wd5~TSN": "28424 38TH Ave. North, Hillsdale",
  alaska: "Seattle, Spokane, Renton",
  vail: "13801 E. Benson HWY; Vail, Arizona 85641",
  schaumburg: "2411 WEST SCHAUMBURG ROAD, SCHAUMBURG",
  skokie: "7447 Skokie Blvd, Skokie",
  arsenal: "Rock Island Arsenal",
  ohare: "CHICAGO O'HARE INTRN'L AIRPORT TERMINAL 1",
  lisle: "100 Carlisle Ave, Lisle",
  stlouis: "1 Main St., St. Louis, MO",
  "stlouis-bare": "1 Main St., St. Louis",
  oakbrook: "5 OAK  BROOK CENTER, Oak Brook",
  "oakbrook-sites": "Multiple Oak Brook sites",
  "stlouis-dot": "100 StA Louis Building, St. Louis",
  burlington: "Burlington",
  "blank-city": "3 Lakes Dr.",
  nothing: null,
  metachars: "9 Elm St, Foo (Bar* [x]",
};

const seed = (): string => NOTICES.map((n, i) => {
  const id = `warn:${n.token}:${i}`;
  const day = `(now() - interval '${n.eventDaysAgo ?? 20} days')::date`;
  return `
    INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis,
      source_read_at, source_url, source_name, status, state, feed, workers, event_type, site_raw, site_city)
    VALUES (${q(id)}, 'state_warn', 'Filer ${i}', 'filer ${i}', ${day}, 'warn_received', ${day}, 'state_received',
      now(), 'https://example.gov/warn', 'State agency', 'active', '${n.state}', 'bln_raw', 120, 'layoff', ${q(n.site)}, ${q(n.city)});
    INSERT INTO public.layoff_matches (filing_id, company_token, matched_via, matched_norm, relation)
    VALUES (${q(id)}, ${q(n.token)}, 'exact_multitoken', 'filer ${i}', 'filer');`;
}).join("\n");

async function boot(withFix: boolean): Promise<PGlite> {
  const d = new PGlite();
  await d.exec(STAND_INS);
  for (const f of CHAIN) await d.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
  if (withFix) {
    expect(FIX, "no migration creates public.layoff_site_text").toBeTruthy();
    await d.exec(readFileSync(resolve(MIGRATIONS, FIX!), "utf8"));
  }
  await d.exec(seed());
  return d;
}

const TOKENS = Object.keys(EXPECTED);
const newest = async (d: PGlite) => Object.fromEntries((await d.query<{ lf_company_token: string; lf_site: string | null }>(
  "SELECT lf_company_token, lf_site FROM public.get_employer_layoff_filings($1::text[])", [TOKENS])).rows.map((r) => [r.lf_company_token, r.lf_site]));
const listed = async (d: PGlite, token: string) => (await d.query<{ la_site: string | null }>(
  "SELECT la_site FROM public.get_employer_layoff_filings_all($1)", [token])).rows.map((r) => r.la_site);
const defOf = async (d: PGlite, sig: string) =>
  (await d.query<{ def: string }>("SELECT pg_get_functiondef($1::regprocedure) AS def", [sig])).rows[0].def;
const can = async (d: PGlite, role: string, sig: string) =>
  (await d.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig])).rows[0].ok;

describe("a state notice prints the town its street is in", () => {
  it("positive control: before the fix the Illinois notice printed a bare street", async () => {
    const d = await boot(false);
    expect((await newest(d))["tysonfoods~wd5~TSN"]).toBe("28424 38TH Ave. North");
    expect(await listed(d, "tysonfoods~wd5~TSN")).toEqual(["28424 38TH Ave. North", "1 Older Rd"]);
  });

  it("the card's reader prints the street with its town, and every other shape as the rule says", async () => {
    const d = await boot(true);
    expect(await newest(d)).toEqual(EXPECTED);
  });

  it("the employer page's reader prints every notice it lists with its town", async () => {
    const d = await boot(true);
    expect(await listed(d, "tysonfoods~wd5~TSN")).toEqual(["28424 38TH Ave. North, Hillsdale", "1 Older Rd, Joslin"]);
    expect(await listed(d, "schaumburg")).toEqual(["2411 WEST SCHAUMBURG ROAD, SCHAUMBURG"]);
    expect(await listed(d, "alaska")).toEqual(["Seattle, Spokane, Renton"]);
  });

  it("nothing else about either reader moved: the same definition but the one expression, definer, the same grants", async () => {
    const before = await boot(false);
    const after = await boot(true);
    for (const sig of ["public.get_employer_layoff_filings(text[])", "public.get_employer_layoff_filings_all(text)"]) {
      const was = await defOf(before, sig);
      expect(was).toContain("COALESCE(NULLIF(f.site_raw, ''), f.site_city) AS site_text");
      expect(await defOf(after, sig)).toBe(was.replace(
        "COALESCE(NULLIF(f.site_raw, ''), f.site_city) AS site_text",
        "public.layoff_site_text(f.site_raw, f.site_city) AS site_text"));
      for (const role of ["anon", "authenticated", "service_role"]) expect(await can(after, role, sig), `${role} on ${sig}`).toBe(true);
    }
  });

  it("the helper is closed to strangers: anon and authenticated cannot call it, service_role can", async () => {
    const d = await boot(true);
    const sig = "public.layoff_site_text(text, text)";
    expect(await can(d, "anon", sig)).toBe(false);
    expect(await can(d, "authenticated", sig)).toBe(false);
    expect(await can(d, "service_role", sig)).toBe(true);
    // The readers still answer anon, through the helper they call as its owner.
    await d.exec("SET ROLE anon");
    const r = await d.query<{ lf_site: string }>("SELECT lf_site FROM public.get_employer_layoff_filings(ARRAY['tysonfoods~wd5~TSN'])");
    expect(r.rows[0].lf_site).toBe("28424 38TH Ave. North, Hillsdale");
    await d.exec("RESET ROLE");
  });

  it("is safe to run again, and refuses a reader whose live definition drifted", async () => {
    const d = await boot(true);
    await d.exec(readFileSync(resolve(MIGRATIONS, FIX!), "utf8"));
    expect((await newest(d))["tysonfoods~wd5~TSN"]).toBe("28424 38TH Ave. North, Hillsdale");

    const drifted = await boot(false);
    const def = await defOf(drifted, "public.get_employer_layoff_filings_all(text)");
    await drifted.exec(def.replace("COALESCE(NULLIF(f.site_raw, ''), f.site_city) AS site_text", "f.site_raw AS site_text"));
    await expect(drifted.exec(readFileSync(resolve(MIGRATIONS, FIX!), "utf8"))).rejects.toThrow(/drifted/);
  });
});
