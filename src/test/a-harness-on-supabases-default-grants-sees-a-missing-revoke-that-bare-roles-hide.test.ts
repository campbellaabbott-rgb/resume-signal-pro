// @vitest-environment node
/**
 * A HARNESS ON SUPABASE'S DEFAULT GRANTS SEES A MISSING REVOKE THAT BARE ROLES
 * HIDE (S14X-140).
 *
 * Thirty-two pglite harnesses asserted that anon or authenticated was refused
 * a table or a function, on roles created with nothing but CREATE ROLE. Such a
 * role holds no privilege on anything, so every refusal held whether or not
 * the migration under test revoked anything: the webhook-log harness still
 * read checkout_resume_refs as closed with the migration's REVOKE deleted.
 *
 * helpers/supabase-defaults.ts makes the roles as Supabase does. Run here:
 *   - under it, a table nobody revoked is open to anon, a function revoked
 *     only from PUBLIC is still callable by anon, and service_role reads past
 *     row level security (the positive controls: the defaults are on);
 *   - 20261004150000 with its REVOKE line deleted is refused by its own
 *     self-check under the helper, and anon reads the table, while on bare
 *     roles the same edited file applies and anon is still "refused";
 *   - the file as shipped applies under the helper and anon is refused.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const SQL = readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith("20261004150000_"))!), "utf8");
const REVOKE = "REVOKE ALL ON TABLE public.checkout_resume_refs FROM PUBLIC, anon, authenticated;";
const WITHOUT_REVOKE = SQL.replace(REVOKE, "");

// What 20261004150000 touches, as the webhook-log harness stands it up, and
// pg_cron's two calls (pglite has no pg_cron).
const STAND_INS = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true, jobname text UNIQUE);
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid;
  $$;
  CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT count(*) > 0 FROM d;
  $$;
  CREATE TABLE public.webhook_events (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
    event_type text NOT NULL, event_id text NOT NULL UNIQUE, payload jsonb, processed boolean DEFAULT false,
    processing_error text, processing_time_ms integer
  );
  CREATE TABLE public.temp_resume_storage (
    session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_text text NOT NULL, linkedin_text text,
    job_description_text text, expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour', created_at timestamptz DEFAULT now()
  );
  CREATE TABLE public.ai_response_cache (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, cache_key text NOT NULL, function_name text NOT NULL,
    response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, hit_count integer NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX idx_ai_cache_key_function ON public.ai_response_cache(cache_key, function_name);
  CREATE TABLE public.scan_report_cache (cache_key text PRIMARY KEY, report jsonb NOT NULL, engine_version text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.resume_analyses (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, share_id text NOT NULL UNIQUE DEFAULT md5(random()::text),
    resume_text text, analysis_result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz DEFAULT now() + interval '30 days'
  );
`;
const BARE_ROLES = "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;";

const opened: PGlite[] = [];
afterEach(async () => { while (opened.length) await opened.pop()!.close().catch(() => undefined); });
async function db(roles: string): Promise<PGlite> {
  const pg = new PGlite();
  opened.push(pg);
  await pg.exec(roles + STAND_INS);
  return pg;
}
/** What `role` gets from `sql`: "ok", or the error it was refused with. */
async function as(pg: PGlite, role: string, sql: string): Promise<string> {
  try { await pg.exec(`SET ROLE ${role}; ${sql}`); return "ok"; }
  catch (e) { return String((e as Error).message); }
  finally { await pg.exec("RESET ROLE"); }
}

describe("the helper makes the client roles as Supabase does", () => {
  it("a table nobody revoked is open to anon and authenticated, as every new table is on Supabase", async () => {
    const pg = await db(SUPABASE_DEFAULTS);
    await pg.exec("CREATE TABLE public.nobody_revoked (id int); INSERT INTO public.nobody_revoked VALUES (1);");
    expect(await as(pg, "anon", "SELECT * FROM public.nobody_revoked")).toBe("ok");
    expect(await as(pg, "authenticated", "INSERT INTO public.nobody_revoked VALUES (2)")).toBe("ok");
    // The bare role the harnesses used holds nothing, so the same read is "refused".
    const bare = await db(BARE_ROLES);
    await bare.exec("CREATE TABLE public.nobody_revoked (id int);");
    expect(await as(bare, "anon", "SELECT * FROM public.nobody_revoked")).toMatch(/permission denied/);
  });

  it("a function revoked only from PUBLIC is still callable by anon, because the client roles hold their own grant", async () => {
    const pg = await db(SUPABASE_DEFAULTS);
    await pg.exec("CREATE FUNCTION public.half_closed() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; REVOKE ALL ON FUNCTION public.half_closed() FROM PUBLIC;");
    expect(await as(pg, "anon", "SELECT public.half_closed()")).toBe("ok");
    await pg.exec("REVOKE ALL ON FUNCTION public.half_closed() FROM anon, authenticated;");
    expect(await as(pg, "anon", "SELECT public.half_closed()")).toMatch(/permission denied/);
  });

  it("service_role reads past row level security, as on Supabase", async () => {
    const pg = await db(SUPABASE_DEFAULTS);
    await pg.exec("CREATE TABLE public.locked (id int); ALTER TABLE public.locked ENABLE ROW LEVEL SECURITY; INSERT INTO public.locked VALUES (1);");
    await pg.exec("SET ROLE service_role");
    const seen = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.locked")).rows[0].n;
    await pg.exec("RESET ROLE");
    expect(seen).toBe(1);
  });
});

describe("20261004150000 with its REVOKE deleted (the webhook-log harness's blind spot)", () => {
  it("the edit is real: the REVOKE line is in the shipped file and gone from the edited one", () => {
    expect(SQL).toContain(REVOKE);
    expect(WITHOUT_REVOKE).not.toContain(REVOKE);
  });

  it("under the helper the file's own self-check refuses the apply, and anon reads the table", async () => {
    const pg = await db(SUPABASE_DEFAULTS);
    await expect(pg.exec(WITHOUT_REVOKE)).rejects.toThrow(/checkout_resume_refs is readable or writable by anon or authenticated/);
    // The same statements without the self-check: anon reads the table.
    const pg2 = await db(SUPABASE_DEFAULTS);
    const body = WITHOUT_REVOKE.split("-- ── 7. Self-verify")[0];
    await pg2.exec(body);
    expect(await as(pg2, "anon", "SELECT * FROM public.checkout_resume_refs")).toBe("ok");
  });

  it("on bare roles the edited file applies and anon is still refused: the refusal proved nothing", async () => {
    const pg = await db(BARE_ROLES);
    await pg.exec(WITHOUT_REVOKE);
    expect(await as(pg, "anon", "SELECT * FROM public.checkout_resume_refs")).toMatch(/permission denied/);
  });

  it("the file as shipped applies under the helper and anon and authenticated are refused", async () => {
    const pg = await db(SUPABASE_DEFAULTS);
    await pg.exec(SQL);
    for (const role of ["anon", "authenticated"]) expect(await as(pg, role, "SELECT * FROM public.checkout_resume_refs")).toMatch(/permission denied/);
    expect(await as(pg, "service_role", "SELECT * FROM public.checkout_resume_refs")).toBe("ok");
  });
});
