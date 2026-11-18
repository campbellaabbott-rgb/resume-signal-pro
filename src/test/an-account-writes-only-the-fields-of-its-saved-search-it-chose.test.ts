// @vitest-environment node
/**
 * AN ACCOUNT WRITES ONLY THE FIELDS OF ITS SAVED SEARCH IT CHOSE (NB-2, the
 * column half).
 *
 * WHAT WAS WRONG. user_job_searches was granted whole-row INSERT and UPDATE to
 * authenticated, so a signed-in account could write the digest's own
 * bookkeeping on its rows: setting digest_attempted_at or digest_last_sent_at
 * back put its alerts at the head of the claim queue, ahead of every real
 * subscriber's, and created_at decides a first-match subject.
 *
 * WHAT HOLDS NOW, in pglite from Supabase's default grants over the table's
 * own migration and 20261112162000: an account inserts and updates the eight
 * fields the pages write, and nothing else; anon writes nothing; the service
 * role writes everything; and every insert and update the pages send names
 * only those eight fields, so no page's save is refused.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationText } from "./helpers/mail-lists-db";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";

const PREFIX = "20261112162000_";
const OWNER = "00000000-0000-4000-8000-0000000b0002";
const FIELDS = ["user_id", "name", "params", "digest_opt_in", "fit_threshold", "digest_cadence", "locale", "last_seen_at"];
let db: PGlite;

async function as(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = []) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [role === "authenticated" ? OWNER : ""]);
  await db.exec(`SET ROLE ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec("RESET ROLE"); }
}
const refused = async (role: "anon" | "authenticated", sql: string, params: unknown[] = []) => {
  try { await as(role, sql, params); return null; } catch (e) { return String((e as Error).message); }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    ${SUPABASE_DEFAULTS}
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    INSERT INTO auth.users VALUES ('${OWNER}');
    CREATE TABLE public.user_applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
  `);
  // The table as 20260711152606 made it, then the columns later files added.
  await db.exec(migrationText("20260711152606_"));
  await db.exec(`
    ALTER TABLE public.user_job_searches
      ADD COLUMN digest_opt_in boolean NOT NULL DEFAULT false,
      ADD COLUMN digest_last_sent_at timestamptz,
      ADD COLUMN fit_threshold integer NOT NULL DEFAULT 0,
      ADD COLUMN digest_cadence text NOT NULL DEFAULT 'weekly',
      ADD COLUMN digest_attempted_at timestamptz,
      ADD COLUMN locale text;
  `);
  await db.exec(migrationText(PREFIX));
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("a signed-in account", () => {
  it("saves a search and changes every field the pages change", async () => {
    await as("authenticated", `INSERT INTO public.user_job_searches (user_id, name, params, digest_opt_in, digest_cadence, locale)
      VALUES ($1, 'Nurse jobs', '{"q":"nurse"}', true, 'daily', 'de')`, [OWNER]);
    await as("authenticated", `UPDATE public.user_job_searches SET name = 'Ward nurse', params = '{}', digest_opt_in = false, fit_threshold = 20,
      digest_cadence = 'weekly', locale = 'fr', last_seen_at = now() WHERE user_id = $1`, [OWNER]);
    const r = await as("authenticated", "SELECT name, fit_threshold, digest_cadence, locale FROM public.user_job_searches");
    expect(r.rows).toEqual([{ name: "Ward nurse", fit_threshold: 20, digest_cadence: "weekly", locale: "fr" }]);
    expect(await refused("authenticated", "DELETE FROM public.user_job_searches WHERE name = 'nothing'")).toBeNull();
  });

  it("cannot write the digest's own stamps, the row's birth or its id", async () => {
    for (const set of ["digest_attempted_at = NULL", "digest_last_sent_at = now() - interval '30 days'", "created_at = now() - interval '1 year'", "id = gen_random_uuid()"]) {
      const err = await refused("authenticated", `UPDATE public.user_job_searches SET ${set} WHERE user_id = $1`, [OWNER]);
      expect(err, set).toMatch(/permission denied/);
    }
    const born = await refused("authenticated", `INSERT INTO public.user_job_searches (user_id, name, created_at) VALUES ($1, 'Old', now() - interval '1 year')`, [OWNER]);
    expect(born).toMatch(/permission denied/);
  });
});

describe("everyone else", () => {
  it("anon writes nothing", async () => {
    expect(await refused("anon", `INSERT INTO public.user_job_searches (user_id, name) VALUES ($1, 'x')`, [OWNER])).toMatch(/permission denied/);
    expect(await refused("anon", "UPDATE public.user_job_searches SET name = 'x'")).toMatch(/permission denied/);
  });

  it("the digest's service role still writes its stamps", async () => {
    await as("service_role", "UPDATE public.user_job_searches SET digest_attempted_at = now(), digest_last_sent_at = now()");
    const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.user_job_searches WHERE digest_attempted_at IS NOT NULL");
    expect(r.rows[0].n).toBe(1);
  });
});

describe("the pages", () => {
  /** The keys of each saved-search insert or update object literal a page sends. */
  function writtenKeys(file: string): string[][] {
    const src = readFileSync(resolve(__dirname, "../..", file), "utf8");
    const out: string[][] = [];
    const opener = /(?:\b(?:searchesTable|table)\(\)|"user_job_searches"\))\s*\.(?:insert|update|upsert)\(\{/g;
    for (const m of src.matchAll(opener)) {
      let depth = 1, i = (m.index ?? 0) + m[0].length;
      const start = i;
      for (; i < src.length && depth > 0; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; }
      out.push([...src.slice(start, i - 1).matchAll(/(?:^|[{,\s])([A-Za-z_]\w*)\s*:/g)].map((k) => k[1]));
    }
    return out;
  }

  it("every save names only the fields an account may write", () => {
    const files = ["src/pages/Jobs.tsx", "src/pages/Explore.tsx", "src/components/jobs/SavedSearchPills.tsx", "src/components/account/SavedSearchesCard.tsx", "src/components/account/NotificationsPanel.tsx"];
    let writes = 0;
    for (const f of files) {
      for (const keys of writtenKeys(f)) {
        writes++;
        for (const k of keys) expect(FIELDS, `${f} writes ${k}`).toContain(k);
      }
    }
    expect(writes, "the scan found no saved-search write at all").toBeGreaterThanOrEqual(10);
    // writeWithDigestLocale's spread is the locale column.
    expect(readFileSync(resolve(__dirname, "../../src/lib/saved-search-locale.ts"), "utf8")).toMatch(/\blocale\b/);
  });
});

describe("the file", () => {
  it("names no word the migration runner refuses, and runs twice cleanly", async () => {
    const sql = migrationText(PREFIX);
    expect(sql).not.toMatch(/vault|secret|decrypted/i);
    await expect(db.exec(sql)).resolves.toBeTruthy();
  });
});
