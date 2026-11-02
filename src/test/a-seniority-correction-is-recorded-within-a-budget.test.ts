// @vitest-environment node
/**
 * A SENIORITY CORRECTION IS RECORDED, WITHIN A BUDGET (register S13-080).
 *
 * The free report's Level control ("Corrections retrain our detection") calls
 * log_seniority_correction with the publishable key. 20260821030000 revoked
 * EXECUTE from anon and authenticated, rightly (an unbounded anonymous write
 * into a table meant to tune the classifier), and gave the page no other
 * path, so every click was refused with 42501 and recorded nothing; the page
 * swallowed the error. 20261101110000 reopens it the way the census reopened
 * the other browser writers: levels validated before anything is spent, every
 * field capped, client_write_allowed keyed on the platform's address, and the
 * table itself closed to both client roles.
 *
 * Executed in pglite: the table and the closed function as production holds
 * them, the census's budget, a stub for every other listed function, then the
 * migration.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionOf, migFile, migFiles } from "./helpers/fixed-clock-sql";
import { CLIENT_CALLABLE, CLOSED_BY_CENSUS, CLOSED_TABLES, OWNED_ELSEWHERE } from "./helpers/client-callable-allowlist";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const file = (prefix: string) => migFile(migFiles().find((f) => f.startsWith(prefix))!);
const NOW = file("20261101110000_");
const SIG = "public.log_seniority_correction(text,text,text,text,integer,text)";
const UUID = "8b2f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

let db: PGlite;

/** Run `sql` as `role`, with these request headers as PostgREST would set them. */
async function as<T>(role: string, headers: Record<string, string> | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query("SELECT set_config('request.headers', $1, false)", [headers ? JSON.stringify(headers) : ""]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.headers', '', false)");
  }
}
const correct = (ip: string | null, args: unknown[]) =>
  as<{ ok: boolean }>("anon", ip ? { "cf-connecting-ip": ip } : null,
    "SELECT public.log_seniority_correction($1, $2, $3, $4, $5, $6) AS ok", args).then((r) => r[0].ok);
const rows = async () => (await db.query<Record<string, unknown>>("SELECT * FROM public.seniority_corrections ORDER BY created_at, id")).rows;
const spent = async () => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.client_write_budget WHERE scope = 'seniority-correction'")).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  const census = file("20261004110000_");
  const table = file("20260702170000_");
  const tableDdl = table.slice(table.indexOf("create table if not exists public.seniority_corrections"), table.indexOf(");", table.indexOf("create table if not exists public.seniority_corrections")) + 2);
  const budgetTable = census.slice(census.indexOf("CREATE TABLE IF NOT EXISTS public.client_write_budget"), census.indexOf("GRANT ALL ON TABLE public.client_write_budget TO service_role;"));
  let ddl = `
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    -- Supabase's default grants: both client roles hold ALL on every new table and function.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ${tableDdl}
    ALTER TABLE public.seniority_corrections ENABLE ROW LEVEL SECURITY;
    ${definitionOf(file("20260704160023_"), "log_seniority_correction")}
    -- What 20260821030000 left: closed to both client roles, nothing in its place.
    REVOKE EXECUTE ON FUNCTION ${SIG} FROM anon, authenticated;
    REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${SIG} TO service_role;
    ${definitionOf(census, "request_client_address")}
    ${budgetTable}
    GRANT ALL ON TABLE public.client_write_budget TO service_role;
    ${definitionOf(census, "client_write_allowed")}
    REVOKE ALL ON FUNCTION public.client_write_allowed(text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
  `;
  const stub = (sig: string) => `CREATE FUNCTION ${sig} RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;\n`;
  for (const c of CLOSED_BY_CENSUS) ddl += stub(c.sig) + `REVOKE ALL ON FUNCTION ${c.sig} FROM PUBLIC, anon, authenticated;\n`;
  for (const e of OWNED_ELSEWHERE) ddl += stub(e.sig);
  for (const a of CLIENT_CALLABLE) {
    if (a.sig === SIG) continue;
    ddl += stub(a.sig) + (a.roles === "anon" ? "" : `REVOKE ALL ON FUNCTION ${a.sig} FROM PUBLIC, anon;\n`);
  }
  for (const t of CLOSED_TABLES) {
    if (t.table === "seniority_corrections" || t.table === "client_write_budget") continue;
    ddl += `CREATE TABLE public.${t.table} (id int); REVOKE ALL ON public.${t.table} FROM PUBLIC, anon, authenticated;\n`;
  }
  await db.exec(ddl);
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("before 20261101110000", () => {
  it("every correction click was refused (42501) and recorded nothing", async () => {
    await expect(correct("203.0.113.5", ["mid", "senior", "~6 years", "technology", 4200, UUID])).rejects.toThrow(/permission denied/);
    expect(await rows()).toEqual([]);
  });
});

describe("after it", () => {
  beforeAll(async () => { await db.exec(NOW); });

  it("the page's call, exactly as FreeKeywordResults.tsx sends it, records one row", async () => {
    expect(await correct("203.0.113.5", ["mid", "senior", "~6 years", "technology", 4200, UUID])).toBe(true);
    expect(await rows()).toEqual([expect.objectContaining({
      detected_level: "mid", corrected_level: "senior", detected_years: "~6 years", industry: "technology", resume_text_length: 4200, visitor_id: UUID,
    })]);
  });

  it("refuses a level that is not one, a correction to the level detected, and a missing level, before spending anything", async () => {
    await db.exec("DELETE FROM public.client_write_budget; DELETE FROM public.seniority_corrections;");
    for (const [d, c] of [["mid", "mid"], ["junior", "senior"], ["senior", "__perm_probe__"], [null, "senior"], ["entry", null], ["MID", "senior"]]) {
      expect(await correct("203.0.113.6", [d, c, null, null, null, null]), `${d} -> ${c}`).toBe(false);
    }
    expect(await rows()).toEqual([]);
    expect(await spent(), "a refused correction spent the budget").toBe(0);
  });

  it("caps every field it stores", async () => {
    await db.exec("DELETE FROM public.seniority_corrections;");
    expect(await correct("203.0.113.7", ["entry", "mid", "y".repeat(500), `  ${"Healthcare".repeat(20)}  `, -5, "<script>alert(1)</script>"])).toBe(true);
    expect(await correct("203.0.113.7", ["senior", "executive", null, null, 2_000_000, "x".repeat(65)])).toBe(true);
    // By level, not by position: pglite can stamp two quick inserts with the
    // same created_at, and the id that breaks the tie is a random uuid.
    const stored = await rows();
    expect(stored).toHaveLength(2);
    const a = stored.find((r) => r.detected_level === "entry")!;
    const b = stored.find((r) => r.detected_level === "senior")!;
    expect(String(a.detected_years)).toHaveLength(40);
    expect(a.industry).toBe("healthcare".repeat(6));
    expect(a.resume_text_length).toBeNull();
    expect(a.visitor_id, "a visitor id not in visitor-id form is not kept").toBeNull();
    expect(b.resume_text_length).toBeNull();
    expect(b.visitor_id).toBeNull();
  });

  it("20 an hour from one address; another address is still recorded", async () => {
    await db.exec("DELETE FROM public.client_write_budget; DELETE FROM public.seniority_corrections;");
    const got: boolean[] = [];
    for (let i = 0; i < 21; i++) got.push(await correct("198.51.100.66", ["mid", "senior", null, null, null, UUID]));
    expect(got.filter(Boolean)).toHaveLength(20);
    expect(got[20]).toBe(false);
    expect(await correct("203.0.113.20", ["mid", "senior", null, null, null, UUID])).toBe(true);
    expect(await rows()).toHaveLength(21);
  });

  it("the budget is the platform's address, not a value the caller passes", async () => {
    await db.exec("DELETE FROM public.client_write_budget;");
    const got: boolean[] = [];
    for (let i = 0; i < 21; i++) got.push(await correct("198.51.100.67", ["mid", "senior", null, null, null, `v-${i}`]));
    expect(got.filter(Boolean), "a fresh visitor id each call bought a fresh budget").toHaveLength(20);
  });

  it("300 in all an hour, so a rotating pool of addresses still meets a ceiling", async () => {
    await db.exec("DELETE FROM public.client_write_budget;");
    expect(await correct("192.0.2.1", ["entry", "mid", null, null, null, null])).toBe(true);
    await db.exec("UPDATE public.client_write_budget SET n = 300 WHERE scope = 'seniority-correction' AND bucket = '*'");
    expect(await correct("192.0.2.2", ["entry", "mid", null, null, null, null])).toBe(false);
  });

  it("the table gives both client roles nothing; only the function writes it", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(as(role, null, "SELECT * FROM public.seniority_corrections"), role).rejects.toThrow(/permission denied/);
      await expect(as(role, null, "INSERT INTO public.seniority_corrections (detected_level, corrected_level) VALUES ('mid', 'senior')"), role)
        .rejects.toThrow(/permission denied/);
    }
  });

  it("the census, read as anon, lists it, and nothing listed is uncallable or closed and open", async () => {
    const [{ c }] = await as<{ c: Record<string, unknown> }>("anon", null, "SELECT public.client_callable_census() AS c");
    expect(c.allowlisted).toBe(CLIENT_CALLABLE.length);
    expect(c.allowlisted_not_callable).toEqual([]);
    expect(c.closed_still_callable).toEqual([]);
    expect(c.closed_tables_still_open).toEqual([]);
    expect(c.unlisted_client_callable).toBe(0);
  });

  it("re-runs cleanly", async () => {
    await expect(db.exec(NOW)).resolves.toBeDefined();
  });
});

describe("the census it re-issues", () => {
  const fnOf = (s: string) => {
    const at = s.indexOf("CREATE OR REPLACE FUNCTION public.client_callable_census()");
    return s.slice(at, s.indexOf("$census$;", at) + "$census$;".length);
  };
  it("is 20261012110100's byte for byte, plus the writer on the anon list and its table on the closed-tables list", () => {
    const was = fnOf(file("20261012110100_"));
    const now = fnOf(NOW);
    expect(was.length).toBeGreaterThan(5000);
    expect(now
      .replace(`        '${SIG}',\n`, "")
      .replace("        'public.client_write_budget',\n        'public.seniority_corrections'\n", "        'public.client_write_budget'\n"))
      .toBe(was);
  });
});
