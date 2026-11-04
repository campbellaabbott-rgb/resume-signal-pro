// @vitest-environment node
/**
 * A SAVED SEARCH REMEMBERS THE LANGUAGE IT WAS SWITCHED ON IN (audit 2026-10-31,
 * S13-102; migration 20261103240000).
 *
 * The digest runs on a schedule with no request in hand, and nothing stored a
 * language it could read. The migration adds user_job_searches.locale and a
 * trigger that fills it from the browser's own Accept-Language. Applied here to
 * pglite with the roles and the row level security of production, writing as
 * the owner's role with the headers PostgREST would set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILE = readdirSync(DIR).find((f) => f.startsWith("20261103240000_"))!;
const SQL = readFileSync(resolve(DIR, FILE), "utf8");
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE TABLE public.user_job_searches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
      params jsonb NOT NULL DEFAULT '{}'::jsonb, last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
      digest_opt_in boolean NOT NULL DEFAULT false, digest_last_sent_at timestamptz, digest_attempted_at timestamptz,
      fit_threshold integer NOT NULL DEFAULT 0, digest_cadence text NOT NULL DEFAULT 'weekly', UNIQUE (user_id, name));
    ALTER TABLE public.user_job_searches ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_job_searches TO authenticated;
    GRANT ALL ON public.user_job_searches TO service_role;
    CREATE POLICY own ON public.user_job_searches FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    CREATE POLICY svc ON public.user_job_searches FOR ALL TO service_role USING (true) WITH CHECK (true);
  `);
  await pg.exec(SQL);
}, 120_000);
afterAll(async () => { await pg.close(); });

/** One PostgREST-shaped write: the owner's role, their id, the request's headers. */
async function asOwner<T>(language: string | null, sql: string, params: unknown[] = [], user = USER): Promise<T[]> {
  await pg.exec("BEGIN");
  try {
    await pg.query("SELECT set_config('request.headers', $1, true), set_config('request.jwt.sub', $2, true)", [language === null ? "" : language, user]);
    await pg.exec("SET LOCAL ROLE authenticated");
    const r = await pg.query<T>(sql, params);
    await pg.exec("COMMIT");
    return r.rows;
  } catch (e) {
    await pg.exec("ROLLBACK");
    throw e;
  }
}
const headers = (lang: string) => JSON.stringify({ "accept-language": lang, host: "harness" });
let n = 0;
const insert = (lang: string | null, extra = "") =>
  asOwner<{ id: string; locale: string | null }>(lang === null ? null : headers(lang), `INSERT INTO public.user_job_searches (user_id, name${extra ? ", locale" : ""}) VALUES ('${USER}', 'search ${++n}'${extra ? `, '${extra}'` : ""}) RETURNING id, locale`);

describe("the trigger, on the owner's own writes", () => {
  it("runs for the owner's role though that role cannot call the function", async () => {
    const r = await pg.query<{ anon: boolean; auth: boolean }>(`
      SELECT has_function_privilege('anon', 'public.user_job_search_locale_from_request()', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.user_job_search_locale_from_request()', 'EXECUTE') AS auth`);
    expect(r.rows[0]).toEqual({ anon: false, auth: false });
    expect((await insert("fr"))[0].locale).toBe("fr");
  });

  const samples: Array<[string, string | null]> = [
    ["fr", "fr"], ["fr-CA,fr;q=0.9,en;q=0.8", "fr"], ["de-DE", "de"], ["pt-BR,pt;q=0.9", "pt"], ["en-GB,en;q=0.9", "en-GB"], ["en-US,en;q=0.5", "en"],
    ["es-419", "es"], ["hi-IN", "hi"], ["nl", "nl"], ["tl-PH", "tl"], ["ja,de;q=0.5", "de"], ["ja,ko,zh", null], ["*", null], ["", null],
    ["a,b,c,d,e,f,de", null],
  ];
  for (const [header, want] of samples) {
    it(`Accept-Language ${JSON.stringify(header)} stores ${want}`, async () => {
      expect((await insert(header))[0].locale).toBe(want);
    });
  }

  it("no headers at all, and a header that is not JSON, save the row with no language", async () => {
    expect((await insert(null))[0].locale).toBeNull();
    const r = await asOwner<{ locale: string | null }>("{not json", `INSERT INTO public.user_job_searches (user_id, name) VALUES ('${USER}', 'bad headers') RETURNING locale`);
    expect(r[0].locale).toBeNull();
  });

  it("a language the client sends wins over its browser's", async () => {
    expect((await insert("fr", "nl"))[0].locale).toBe("nl");
  });

  it("an existing row with no language takes one at its owner's next write", async () => {
    const [{ id }] = await insert(null);
    const r = await asOwner<{ locale: string }>(headers("de"), "UPDATE public.user_job_searches SET last_seen_at = now() WHERE id = $1 RETURNING locale", [id]);
    expect(r[0].locale).toBe("de");
  });

  it("an ordinary write keeps a language already kept", async () => {
    const [{ id }] = await insert("fr");
    const r = await asOwner<{ locale: string }>(headers("de"), "UPDATE public.user_job_searches SET last_seen_at = now(), name = name || ' x' WHERE id = $1 RETURNING locale", [id]);
    expect(r[0].locale).toBe("fr");
  });

  it("switching the digest on takes the language of that browser", async () => {
    const [{ id }] = await insert("fr");
    const r = await asOwner<{ locale: string }>(headers("es"), "UPDATE public.user_job_searches SET digest_opt_in = true WHERE id = $1 RETURNING locale", [id]);
    expect(r[0].locale).toBe("es");
  });

  it("switching it on from a browser whose language we do not carry keeps the one kept", async () => {
    const [{ id }] = await insert("fr");
    const r = await asOwner<{ locale: string }>(headers("ja"), "UPDATE public.user_job_searches SET digest_opt_in = true WHERE id = $1 RETURNING locale", [id]);
    expect(r[0].locale).toBe("fr");
  });

  it("switching it on with an explicit language keeps the explicit one", async () => {
    const [{ id }] = await insert("fr");
    const r = await asOwner<{ locale: string }>(headers("es"), "UPDATE public.user_job_searches SET digest_opt_in = true, locale = 'nl' WHERE id = $1 RETURNING locale", [id]);
    expect(r[0].locale).toBe("nl");
  });

  it("the digest's own stamps fire nothing: the scheduler's headers can't set a language", async () => {
    const [{ id }] = await insert(null);
    await pg.exec("BEGIN");
    await pg.query("SELECT set_config('request.headers', $1, true)", [headers("de")]);
    const r = await pg.query<{ locale: string | null }>("UPDATE public.user_job_searches SET digest_last_sent_at = now(), digest_attempted_at = now() WHERE id = $1 RETURNING locale", [id]);
    await pg.exec("COMMIT");
    expect(r.rows[0].locale).toBeNull();
  });

  it("a language that is not one of the nine is refused at the column", async () => {
    await expect(asOwner(headers("fr"), `INSERT INTO public.user_job_searches (user_id, name, locale) VALUES ('${USER}', 'klingon', 'tlh')`)).rejects.toThrow(/user_job_searches_locale_known/);
  });

  it("another owner's row stays out of reach", async () => {
    const [{ id }] = await insert("fr");
    const r = await asOwner(headers("de"), "UPDATE public.user_job_searches SET locale = 'de' WHERE id = $1 RETURNING id", [id], OTHER);
    expect(r).toEqual([]);
  });
});

describe("the migration", () => {
  it("runs again without change, its self-check included", async () => {
    await pg.exec(SQL);
    const t = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.user_job_searches'::regclass AND NOT tgisinternal");
    expect(t.rows[0].n).toBe(1);
  });

  it("the self-check fails a trigger function opened to a client role", async () => {
    await pg.exec("BEGIN");
    await pg.exec("GRANT EXECUTE ON FUNCTION public.user_job_search_locale_from_request() TO authenticated");
    const block = SQL.slice(SQL.lastIndexOf("DO $$"), SQL.lastIndexOf("NOTIFY pgrst"));
    await expect(pg.exec(block)).rejects.toThrow(/open to a client role/);
    await pg.exec("ROLLBACK");
  });

  it("the self-check fails a trigger that fills nothing", async () => {
    await pg.exec("BEGIN");
    await pg.exec(`CREATE OR REPLACE FUNCTION public.user_job_search_locale_from_request() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$`);
    const block = SQL.slice(SQL.lastIndexOf("DO $$"), SQL.lastIndexOf("NOTIFY pgrst"));
    await expect(pg.exec(block)).rejects.toThrow(/a French browser stored nothing/);
    await pg.exec("ROLLBACK");
  });

  it("the self-check leaves no probe table and no headers behind", async () => {
    await pg.exec("BEGIN");
    const block = SQL.slice(SQL.lastIndexOf("DO $$"), SQL.lastIndexOf("NOTIFY pgrst"));
    await pg.exec(block);
    const r = await pg.query<{ probe: string | null; headers: string | null }>("SELECT to_regclass('pg_temp._user_job_search_locale_probe')::text AS probe, NULLIF(current_setting('request.headers', true), '') AS headers");
    await pg.exec("COMMIT");
    expect(r.rows[0]).toEqual({ probe: null, headers: null });
  });
});
