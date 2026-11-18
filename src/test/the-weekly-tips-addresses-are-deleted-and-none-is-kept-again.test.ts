// @vitest-environment node
/**
 * THE WEEKLY-TIPS ADDRESSES ARE DELETED, AND NONE IS KEPT AGAIN (S14X-101, the
 * owner's answer 'remove' of 2026-11-15; the closeout review of 2026-11-16).
 *
 * The owner's answer removed the free report's weekly-tips box and approved a
 * purge of the addresses it had collected. The round removed the box, but no
 * lane built the purge, and save-lead still stored every address it was sent
 * (a tab running the old page, a script), as did send-scan-report beside every
 * report mail, into a list nothing ever mailed. Now:
 *   - 20261112103000, run in pglite from Supabase's default grants on the
 *     table and the function as production holds them, deletes every row and
 *     leaves save_free_scan_lead with its signature, return type, owner rights
 *     and grants, storing nothing; applied twice it still passes, and its
 *     self-check refuses to apply while a row is left;
 *   - neither function's code calls the lead-saving function any more.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migration } from "./helpers/agent-db";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const FILE = "20261112103000_the_weekly_tips_addresses_are_deleted_and_none_is_kept_again.sql";
/** The table, and the writer as production runs it (20251220013949), with the census's grants (20261004110000). */
const TABLE = "20251216162922_57db3c3b-1c2b-4bf5-9c10-f887d54cbbc2.sql";
const WRITER = "20251220013949_4e5e6007-d535-4c76-94c4-bc2ffdb5cb8a.sql";
const SIG = "public.save_free_scan_lead(text,text,integer)";

let db: PGlite;
const rows = async () => Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.free_scan_leads")).rows[0].n);
const canRun = async (role: string) =>
  (await db.query<{ ok: boolean }>(`SELECT has_function_privilege('${role}', '${SIG}', 'EXECUTE') AS ok`)).rows[0].ok;
const shape = async () => (await db.query<{ ret: string; definer: boolean; config: string[] | null; args: string }>(
  `SELECT p.prorettype::regtype::text AS ret, p.prosecdef AS definer, p.proconfig AS config,
          pg_get_function_arguments(p.oid) AS args
     FROM pg_proc p WHERE p.oid = '${SIG}'::regprocedure`)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
  // The table and its first writer, then the writer production runs.
  await db.exec(migration(TABLE));
  const writer = migration(WRITER);
  const start = writer.indexOf("CREATE OR REPLACE FUNCTION public.save_free_scan_lead");
  await db.exec(writer.slice(start, writer.indexOf("$function$;", start) + "$function$;".length));
  // The census left the writer to the service role alone.
  await db.exec(`REVOKE EXECUTE ON FUNCTION ${SIG} FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ${SIG} TO service_role;`);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("20261112103000", () => {
  it("before it, the writer keeps every address it is sent (the control)", async () => {
    await db.query("SELECT public.save_free_scan_lead($1, $2, $3)", ["one@corp.example.com", "Finance", 71]);
    await db.query("SELECT public.save_free_scan_lead($1, $2, $3)", ["two@corp.example.com", null, null]);
    expect(await rows()).toBe(2);
  });

  it("deletes every row, applied twice", async () => {
    await db.exec(migration(FILE));
    expect(await rows()).toBe(0);
    await db.exec(migration(FILE));
    expect(await rows()).toBe(0);
  });

  it("leaves the writer callable as before, keeping nothing and answering false", async () => {
    const r = await db.query<{ kept: boolean }>("SELECT public.save_free_scan_lead($1, $2, $3) AS kept", ["three@corp.example.com", "Finance", 64]);
    expect(r.rows[0].kept).toBe(false);
    // A malformed address is answered the same way: nothing reads it.
    expect((await db.query<{ kept: boolean }>("SELECT public.save_free_scan_lead('nope') AS kept")).rows[0].kept).toBe(false);
    expect(await rows()).toBe(0);
  });

  it("keeps the writer's signature, return type, owner rights, search path and grants", async () => {
    const s = await shape();
    expect(s.args).toBe("p_email text, p_industry text DEFAULT NULL::text, p_ats_score integer DEFAULT NULL::integer");
    expect(s.ret).toBe("boolean");
    expect(s.definer).toBe(true);
    expect(s.config).toEqual(["search_path=public"]);
    expect(await canRun("service_role")).toBe(true);
    expect(await canRun("anon")).toBe(false);
    expect(await canRun("authenticated")).toBe(false);
  });

  it("its self-check refuses a table with a row left", async () => {
    await db.exec("INSERT INTO public.free_scan_leads (email) VALUES ('left@corp.example.com')");
    const sql = migration(FILE);
    await expect(db.exec(sql.slice(sql.indexOf("DO $verify$")))).rejects.toThrow(/1 free_scan_leads row\(s\) are left/);
    await db.exec("DELETE FROM public.free_scan_leads");
  });

  it("its self-check refuses a writer that still stores an address", async () => {
    const writer = migration(WRITER);
    const start = writer.indexOf("CREATE OR REPLACE FUNCTION public.save_free_scan_lead");
    await db.exec(writer.slice(start, writer.indexOf("$function$;", start) + "$function$;".length));
    const sql = migration(FILE);
    await expect(db.exec(sql.slice(sql.indexOf("DO $verify$")))).rejects.toThrow(/save_free_scan_lead still stores an address/);
    await db.exec(sql);
    expect(await rows()).toBe(0);
  });
});

describe("no function keeps an address", () => {
  const read = (fn: string) => codeOf(readFileSync(resolve(ROOT, "supabase/functions", fn, "index.ts"), "utf8"));
  it("save-lead and send-scan-report no longer call the lead-saving function", () => {
    for (const fn of ["save-lead", "send-scan-report"]) expect(read(fn), fn).not.toMatch(/save_free_scan_lead/);
  });
  it("save-lead's alert and ceiling notice no longer say the lead is saved", () => {
    const lead = read("save-lead");
    expect(lead).not.toMatch(/lead is saved|still saved|New lead saved/);
    expect(lead).toMatch(/No address is kept/);
  });
});
