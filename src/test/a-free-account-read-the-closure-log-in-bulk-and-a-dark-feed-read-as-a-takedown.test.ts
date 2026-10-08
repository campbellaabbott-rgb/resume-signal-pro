// @vitest-environment node
/**
 * A FREE ACCOUNT READ THE CLOSURE LOG IN BULK, A DARK FEED READ AS A TAKEDOWN,
 * AND ONE ACCOUNT COULD FILL THE DISK.
 *
 * WHAT WAS WRONG.
 *   S8-018  get_application_lifecycle answered for any job id on the caller's
 *           own tracker rows, and a tracker row's job_id is free text: insert
 *           500 posting ids (or PATCH existing rows), read their closures,
 *           rewrite, read again, with no meter.
 *   L13-14  It took the latest closure with no suspect or superseded filter,
 *           so a feed that went dark read as an employer takedown.
 *   L11-08  A posting already stamped missing read "still standing".
 *   S8-103  No row cap or length bound on the owner-writable tables.
 *
 * WHAT HOLDS NOW, the migration run in a real Postgres (pglite) over stand-in
 * tables with the columns its SQL reads, auth.uid() and auth.role() read from
 * the request settings as Supabase's do.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20261009131000_a_tracker_row_reads_the_closure_log_by_the_day_and_a_free_account_has_bounds.sql"), "utf8");
const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";

const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
  CREATE TABLE public.user_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, company text, role text, label text,
    location text, status text, job_id text, apply_url text, job_posting text, fit_missing jsonb, kit jsonb,
    posting_closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.user_scans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, resume_text text);
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text, title text, posted_at timestamptz, first_seen timestamptz, missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text NOT NULL, closed_at timestamptz NOT NULL, posted_at timestamptz, first_seen timestamptz,
    company_token text, title text, absence_basis text, superseded boolean NOT NULL DEFAULT false, suspect boolean NOT NULL DEFAULT false);
`;

let db: PGlite;
const as = async (uid: string | null, role = "authenticated") => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false), set_config('request.jwt.claim.role', '${role}', false);`);
};
const lifecycle = async (ids: string[]) =>
  (await db.query<{ job_id: string; outcome: string; closed_at: string | null }>(
    "SELECT job_id, outcome, closed_at FROM public.get_application_lifecycle($1::text[]) ORDER BY job_id", [ids])).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(SQL);
  await db.exec(SQL); // safe to re-run
}, 120_000);
afterAll(async () => { await db.close(); });

describe("the lifecycle answers truthfully (L13-14, L11-08)", () => {
  it("a suspect closure is not a takedown; a posting stamped missing is going down, not standing", async () => {
    await as(null, "service_role");
    await db.exec(`
      INSERT INTO public.job_board_postings (id, company_token, title, first_seen, missing_since) VALUES
        ('gh:acme:live', 'acme', 'Analyst', now() - interval '20 days', NULL),
        ('gh:acme:leaving', 'acme', 'Engineer', now() - interval '20 days', now() - interval '1 hour');
      INSERT INTO public.job_board_closures (posting_id, closed_at, company_token, title, suspect) VALUES
        ('gh:acme:live', now() - interval '3 days', 'acme', 'Analyst', true),
        ('gh:acme:gone', now() - interval '2 days', 'acme', 'Designer', false);
      INSERT INTO public.user_applications (user_id, company, job_id) VALUES
        ('${U1}', 'Acme', 'gh:acme:live'), ('${U1}', 'Acme', 'gh:acme:leaving'), ('${U1}', 'Acme', 'gh:acme:gone');
    `);
    await as(U1);
    const rows = await lifecycle(["gh:acme:live", "gh:acme:leaving", "gh:acme:gone"]);
    expect(rows).toEqual([
      { job_id: "gh:acme:gone", outcome: "came_down", closed_at: expect.anything() },
      { job_id: "gh:acme:leaving", outcome: "going_down", closed_at: null },
      { job_id: "gh:acme:live", outcome: "still_standing", closed_at: null },
    ]);
  });

  it("answers nothing for an id on someone else's tracker", async () => {
    await as(U2);
    expect(await lifecycle(["gh:acme:gone"])).toEqual([]);
  });
});

describe("the closure log is read by the day, not in bulk (S8-018)", () => {
  it("a tracker row's posting cannot be rewritten by its owner", async () => {
    await as(U1);
    await expect(db.exec(`UPDATE public.user_applications SET job_id = 'gh:other:1' WHERE user_id = '${U1}' AND job_id = 'gh:acme:gone'`))
      .rejects.toThrow(/cannot be changed/);
  });

  it("one account is answered at most 1,000 distinct ids a day; ids already answered stay free", async () => {
    await as(null, "service_role");
    await db.exec(`
      INSERT INTO public.job_board_closures (posting_id, closed_at, company_token, title)
        SELECT 'gh:bulk:' || g, now() - interval '1 day', 'bulk', 'Role ' || g FROM generate_series(1, 1100) g;
      INSERT INTO public.user_applications (user_id, company, job_id)
        SELECT '${U2}', 'Bulk', 'gh:bulk:' || g FROM generate_series(1, 1100) g;
    `);
    await as(U2);
    const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `gh:bulk:${from + i}`);
    expect((await lifecycle(ids(1, 500))).length).toBe(500);
    expect((await lifecycle(ids(501, 1000))).length).toBe(500);
    expect((await lifecycle(ids(1001, 1100))).length, "the day's allowance was spent and new ids were still answered").toBe(0);
    expect((await lifecycle(ids(1, 50))).length, "a reload of ids already answered today was refused").toBe(50);
  });
});

describe("one account's storage is bounded (S8-103)", () => {
  it("a tracker row past the length bound is refused", async () => {
    await as(U1);
    await expect(db.exec(`INSERT INTO public.user_applications (user_id, company, job_posting) VALUES ('${U1}', 'X', repeat('a', 60000))`))
      .rejects.toThrow(/user_applications_job_posting_len/);
  });

  it("the row cap refuses a client and lets our own servers through", async () => {
    await as(null, "service_role");
    await db.exec(`INSERT INTO public.user_scans (user_id, resume_text) SELECT '${U1}', 'r' FROM generate_series(1, 2000)`);
    await as(U1);
    await expect(db.exec(`INSERT INTO public.user_scans (user_id, resume_text) VALUES ('${U1}', 'one more')`)).rejects.toThrow(/most it can/);
    await as(null, "service_role");
    await db.exec(`INSERT INTO public.user_scans (user_id, resume_text) VALUES ('${U1}', 'from a server')`);
  });
});
