// @vitest-environment node
/**
 * AN ACCOUNT CANNOT SET THE CLOCK THAT THROTTLES ITS AGENT KICK (NB-14).
 *
 * WHAT WAS WRONG. agent_kick_on_mandate (20260805010000) runs the apply-agent
 * preparer when a mandate is created or switched on, once per five minutes,
 * and read the five minutes from NEW.last_prepare_kick_at: a column the
 * signed-in account writes itself (agent_mandates is granted whole-row to
 * authenticated). Sending last_prepare_kick_at = NULL with every toggle of
 * active fired the kick as often as the account liked.
 *
 * WHAT HOLDS NOW, in pglite over 20260805010000 and 20261112161000, from
 * Supabase's default grants: the trigger is gone while the apply agent is
 * switched off; and the function, re-attached the way the migration says to,
 * throttles on the stamp the database wrote. A client role's value is put
 * back (on an UPDATE) or emptied (on an INSERT); our own service role still
 * sets it.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrationText } from "./helpers/mail-lists-db";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";

const USER = "00000000-0000-4000-8000-00000000b014";
let db: PGlite;

const as = async (role: "authenticated" | "service_role", sql: string, params: unknown[] = []) => {
  await db.query(`SELECT set_config('request.jwt.claim.role', $1, false)`, [role]);
  return db.query(sql, params);
};
const kicks = async () => Number((await db.query<{ n: number }>("SELECT n FROM public.kick_count")).rows[0].n);
const stamp = async () => (await db.query<{ s: Date | null }>("SELECT last_prepare_kick_at AS s FROM public.agent_mandates WHERE user_id = $1", [USER])).rows[0]?.s ?? null;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    ${SUPABASE_DEFAULTS}
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    CREATE TABLE public.agent_mandates (user_id uuid PRIMARY KEY, active boolean NOT NULL DEFAULT false, daily_cap integer NOT NULL DEFAULT 5);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_mandates TO authenticated;
    -- The preparer, counted instead of called.
    CREATE TABLE public.kick_count (n integer NOT NULL);
    INSERT INTO public.kick_count VALUES (0);
    CREATE FUNCTION public.agent_prepare_now() RETURNS boolean LANGUAGE sql AS $$ UPDATE public.kick_count SET n = n + 1; SELECT true $$;
  `);
  await db.exec(migrationText("20260805010000_"));
  await db.exec(migrationText("20261112161000_"));
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("while the apply agent is switched off", () => {
  it("nothing on agent_mandates runs the kick", async () => {
    const t = await db.query("SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.agent_mandates'::regclass AND NOT tgisinternal");
    expect(t.rows).toEqual([]);
    await as("authenticated", "INSERT INTO public.agent_mandates (user_id, active) VALUES ($1, true)", [USER]);
    expect(await kicks()).toBe(0);
    await as("authenticated", "DELETE FROM public.agent_mandates WHERE user_id = $1", [USER]);
  });

  it("the function is the database's alone", async () => {
    const r = await db.query<{ anon: boolean; authn: boolean; definer: boolean }>(`SELECT
      has_function_privilege('anon', 'public.agent_kick_on_mandate()', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.agent_kick_on_mandate()', 'EXECUTE') AS authn,
      (SELECT prosecdef FROM pg_proc WHERE oid = 'public.agent_kick_on_mandate()'::regprocedure) AS definer`);
    expect(r.rows).toEqual([{ anon: false, authn: false, definer: true }]);
  });
});

describe("re-attached as the migration says, the throttle reads the database's stamp", () => {
  beforeAll(async () => {
    await db.exec(`CREATE TRIGGER agent_mandates_kick_prepare
      BEFORE INSERT OR UPDATE OF active, last_prepare_kick_at
      ON public.agent_mandates FOR EACH ROW
      EXECUTE FUNCTION public.agent_kick_on_mandate();`);
  });
  beforeEach(async () => {
    await db.exec("DELETE FROM public.agent_mandates; UPDATE public.kick_count SET n = 0;");
  });

  it("a new mandate kicks once, whatever stamp the account sent with it", async () => {
    await as("authenticated", "INSERT INTO public.agent_mandates (user_id, active, last_prepare_kick_at) VALUES ($1, true, now() + interval '1 year')", [USER]);
    expect(await kicks()).toBe(1);
    const s = await stamp();
    expect(s, "the year-ahead stamp the account sent was kept").not.toBeNull();
    expect(Math.abs(new Date(s as Date).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("toggling active with an empty stamp, again and again, kicks no more", async () => {
    await as("authenticated", "INSERT INTO public.agent_mandates (user_id, active) VALUES ($1, true)", [USER]);
    const first = await stamp();
    for (let i = 0; i < 5; i++) {
      await as("authenticated", "UPDATE public.agent_mandates SET active = false, last_prepare_kick_at = NULL WHERE user_id = $1", [USER]);
      await as("authenticated", "UPDATE public.agent_mandates SET active = true, last_prepare_kick_at = NULL WHERE user_id = $1", [USER]);
    }
    expect(await kicks(), "the account reset the throttle with its own write").toBe(1);
    expect(await stamp()).toEqual(first);
  });

  it("an account writing the stamp alone gets the stored one back", async () => {
    await as("authenticated", "INSERT INTO public.agent_mandates (user_id, active) VALUES ($1, true)", [USER]);
    const first = await stamp();
    await as("authenticated", "UPDATE public.agent_mandates SET last_prepare_kick_at = now() - interval '1 day' WHERE user_id = $1", [USER]);
    expect(await stamp()).toEqual(first);
    expect(await kicks()).toBe(1);
  });

  it("an edit that is not the switch does not kick", async () => {
    await as("authenticated", "INSERT INTO public.agent_mandates (user_id, active) VALUES ($1, true)", [USER]);
    await as("authenticated", "UPDATE public.agent_mandates SET daily_cap = 9 WHERE user_id = $1", [USER]);
    expect(await kicks()).toBe(1);
  });

  it("our own service role still moves the stamp, and a switch-on past five minutes kicks again", async () => {
    await as("authenticated", "INSERT INTO public.agent_mandates (user_id, active) VALUES ($1, false)", [USER]);
    await as("service_role", "UPDATE public.agent_mandates SET last_prepare_kick_at = now() - interval '10 minutes' WHERE user_id = $1", [USER]);
    expect(await kicks()).toBe(0);
    await as("authenticated", "UPDATE public.agent_mandates SET active = true WHERE user_id = $1", [USER]);
    expect(await kicks()).toBe(1);
  });
});

describe("the file", () => {
  it("names no word the migration runner refuses, and runs twice cleanly", async () => {
    const sql = migrationText("20261112161000_");
    expect(sql).not.toMatch(/vault|secret|decrypted/i);
    await db.exec("DROP TRIGGER IF EXISTS agent_mandates_kick_prepare ON public.agent_mandates");
    await expect(db.exec(sql)).resolves.toBeTruthy();
  });
});
