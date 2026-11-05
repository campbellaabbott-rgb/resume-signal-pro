// @vitest-environment node
/**
 * A SAVED SEARCH REMEMBERS THE LANGUAGE IT WAS SWITCHED ON IN (audit 2026-10-31,
 * S13-102; migration 20261103240000).
 *
 * The digest runs on a schedule with no request in hand, and nothing stored a
 * language it could read. The migration adds user_job_searches.locale, which the
 * owner's page writes (a-saved-search-keeps-the-language-its-owner-reads-the-site-in).
 * Applied here to pglite with the roles and the row level security of production,
 * writing as the owner's role with the headers PostgREST would set.
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
async function asOwner<T>(headersJson: string | null, sql: string, params: unknown[] = [], user = USER): Promise<T[]> {
  await pg.exec("BEGIN");
  try {
    await pg.query("SELECT set_config('request.headers', $1, true), set_config('request.jwt.sub', $2, true)", [headersJson === null ? "" : headersJson, user]);
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
const insert = (lang: string | null, locale = "") =>
  asOwner<{ id: string; locale: string | null }>(lang === null ? null : headers(lang), `INSERT INTO public.user_job_searches (user_id, name${locale ? ", locale" : ""}) VALUES ('${USER}', 'search ${++n}'${locale ? `, '${locale}'` : ""}) RETURNING id, locale`);

describe("the column, on the owner's own writes", () => {
  it("keeps the language the page sent, and the browser's own preference decides nothing", async () => {
    expect((await insert("de", "en"))[0].locale, "English chosen on a German browser").toBe("en");
    expect((await insert("en-US,en;q=0.9", "es"))[0].locale, "Spanish chosen on an English browser").toBe("es");
  });

  it("a write that names no language leaves none, whatever the browser prefers, and the digest reads that as English", async () => {
    expect((await insert("de"))[0].locale).toBeNull();
    expect((await insert(null))[0].locale).toBeNull();
  });

  it("switching the digest on with the page's language takes it, also over the same value a browser would have changed", async () => {
    const [{ id }] = await insert("de", "en");
    const same = await asOwner<{ locale: string }>(headers("de"), "UPDATE public.user_job_searches SET digest_opt_in = true, locale = 'en' WHERE id = $1 RETURNING locale", [id]);
    expect(same[0].locale, "the owner reads English; the German browser is not asked").toBe("en");
    const moved = await asOwner<{ locale: string }>(headers("de"), "UPDATE public.user_job_searches SET last_seen_at = now(), locale = 'nl' WHERE id = $1 RETURNING locale", [id]);
    expect(moved[0].locale).toBe("nl");
  });

  it("a write that names no language keeps the one kept", async () => {
    const [{ id }] = await insert("fr", "fr");
    const r = await asOwner<{ locale: string }>(headers("de"), "UPDATE public.user_job_searches SET last_seen_at = now(), digest_opt_in = true, name = name || ' x' WHERE id = $1 RETURNING locale", [id]);
    expect(r[0].locale).toBe("fr");
  });

  it("every language the page writes is one the column takes", async () => {
    for (const lang of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      expect((await insert("*", lang))[0].locale).toBe(lang);
    }
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
    const c = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.user_job_searches'::regclass AND conname = 'user_job_searches_locale_known'");
    expect(c.rows[0].n).toBe(1);
  });

  it("puts no trigger on the table: no browser's header writes a reader's language", async () => {
    const t = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.user_job_searches'::regclass AND NOT tgisinternal");
    expect(t.rows[0].n).toBe(0);
  });

  it("the self-check fails a table with no such check, and one that lost its row level security", async () => {
    const block = SQL.slice(SQL.lastIndexOf("DO $$"), SQL.lastIndexOf("NOTIFY pgrst"));
    await pg.exec("BEGIN");
    await pg.exec("ALTER TABLE public.user_job_searches DROP CONSTRAINT user_job_searches_locale_known");
    await expect(pg.exec(block)).rejects.toThrow(/has no locale check/);
    await pg.exec("ROLLBACK");
    await pg.exec("BEGIN");
    await pg.exec("ALTER TABLE public.user_job_searches DISABLE ROW LEVEL SECURITY");
    await expect(pg.exec(block)).rejects.toThrow(/lost row level security/);
    await pg.exec("ROLLBACK");
  });

  it("the column's own comment says what writes it", async () => {
    const r = await pg.query<{ c: string }>("SELECT col_description('public.user_job_searches'::regclass, a.attnum) AS c FROM pg_attribute a WHERE a.attrelid = 'public.user_job_searches'::regclass AND a.attname = 'locale'");
    expect(r.rows[0].c).toMatch(/site language the owner's page was read in/);
    expect(r.rows[0].c).not.toMatch(/browser/);
  });
});
