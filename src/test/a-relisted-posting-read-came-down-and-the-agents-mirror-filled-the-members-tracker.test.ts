// @vitest-environment node
/**
 * A RELISTED POSTING READ "CAME DOWN", AND THE AGENT'S MIRROR FILLED THE
 * MEMBER'S TRACKER (S11-138, S11-139).
 *
 * S11-138. 20261009131000 cleared, once, the closure dates of tracker rows
 * whose posting is served again. The live Account page writes closed_at back
 * for any answer that carries one, and a relist is answered with the old
 * closure's date: the row went straight back to "Came down on <date>" for an
 * open posting, and a dated row is never checked again.
 *
 * S11-139. The 2,000-row cap counted the agent's tracker mirror (written as
 * service_role, which the cap exempts) against the member, fired on the
 * INSERT arm of an upsert to a row that exists, and could never fire on
 * shortlist_candidates, which only service_role writes.
 *
 * Run in a real Postgres (pglite) over stand-in tables, auth.uid() and
 * auth.role() read from the request settings as Supabase's do. Every file
 * from 131000 on that defines the cap or the closure-date guard is applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sqlCodeOf } from "./helpers/strip-comments";

const MIG = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .filter((f) => f >= "20261009131000" && /FUNCTION\s+(?:public\.)?(owner_row_cap|user_applications_served_posting_undated|undate_served_tracker_rows)\s*\(/i.test(sqlCodeOf(readFileSync(resolve(MIG, f), "utf8"))));
const U1 = "00000000-0000-4000-8000-0000000000b1";

const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
  CREATE TABLE public.user_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, company text, role text, label text,
    location text, status text, job_id text, apply_url text, job_posting text, fit_missing jsonb, kit jsonb,
    posting_closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX user_applications_user_job_uniq ON public.user_applications (user_id, job_id);
  CREATE TABLE public.user_scans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, resume_text text);
  CREATE TABLE public.agent_learned_answers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, question_key text NOT NULL,
    question_label text NOT NULL DEFAULT '', answer_kind text NOT NULL DEFAULT 'fill', answer_value text NOT NULL DEFAULT '',
    UNIQUE (user_id, question_key));
  CREATE TABLE public.shortlist_candidates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, file_name text);
  CREATE TABLE public.agent_submissions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid, posting_id text, status text);
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
const fresh = async () => {
  await as(null, "service_role");
  await db.exec("TRUNCATE public.user_applications, public.user_scans, public.agent_learned_answers, public.shortlist_candidates, public.agent_submissions, public.job_board_postings, public.job_board_closures");
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STAND_INS);
  for (const f of FILES) {
    const sql = readFileSync(resolve(MIG, f), "utf8");
    await db.exec(sql);
    await db.exec(sql); // each is safe to re-run
  }
}, 180_000);
afterAll(async () => { await db.close(); });

describe("a served posting keeps no closure date (S11-138)", () => {
  it("the page cannot date a row whose posting is served again, whatever version writes it", async () => {
    await fresh();
    await db.exec(`
      INSERT INTO public.job_board_postings (id, company_token, title, missing_since) VALUES ('gh:acme:back', 'acme', 'Analyst', NULL), ('gh:acme:gone', 'acme', 'Designer', now() - interval '3 days');
      INSERT INTO public.user_applications (user_id, company, job_id) VALUES ('${U1}', 'Acme', 'gh:acme:back'), ('${U1}', 'Acme', 'gh:acme:gone');`);
    await as(U1);
    // What main's Account.tsx writes for a 'came_down_relisted' answer, and for a real takedown.
    await db.exec(`UPDATE public.user_applications SET posting_closed_at = now() - interval '5 days' WHERE job_id = 'gh:acme:back' AND posting_closed_at IS NULL`);
    await db.exec(`UPDATE public.user_applications SET posting_closed_at = now() - interval '3 days' WHERE job_id = 'gh:acme:gone' AND posting_closed_at IS NULL`);
    const { rows } = await db.query<{ job_id: string; dated: boolean }>("SELECT job_id, posting_closed_at IS NOT NULL AS dated FROM public.user_applications ORDER BY job_id");
    expect(rows, "an open posting's tracker row was dated as came down").toEqual([
      { job_id: "gh:acme:back", dated: false },
      { job_id: "gh:acme:gone", dated: true },
    ]);
  });

  it("a row dated before its posting was relisted is undated by the daily job", async () => {
    await fresh();
    await db.exec(`
      INSERT INTO public.job_board_postings (id, company_token, title, missing_since) VALUES ('gh:acme:relist', 'acme', 'Analyst', now() - interval '9 days');
      INSERT INTO public.user_applications (user_id, company, job_id, posting_closed_at) VALUES ('${U1}', 'Acme', 'gh:acme:relist', now() - interval '9 days');
      UPDATE public.job_board_postings SET missing_since = NULL WHERE id = 'gh:acme:relist';`);
    const { rows } = await db.query<{ n: number }>("SELECT public.undate_served_tracker_rows() AS n");
    expect(rows[0].n).toBe(1);
    const left = await db.query<{ dated: boolean }>("SELECT posting_closed_at IS NOT NULL AS dated FROM public.user_applications");
    expect(left.rows[0].dated).toBe(false);
  });
});

describe("the tracker cap counts only what the member added (S11-139)", () => {
  it("2,000 rows of the agent's mirror do not refuse the member's own Save", async () => {
    await fresh();
    await db.exec(`INSERT INTO public.user_applications (user_id, company, job_id, status) SELECT '${U1}', 'Mirror', 'gh:sent:' || g, 'applied' FROM generate_series(1, 2000) g`);
    await as(U1);
    await db.exec(`INSERT INTO public.user_applications (user_id, company, job_id, status) VALUES ('${U1}', 'Mine', 'gh:mine:1', 'saved')`);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.user_applications WHERE user_id = '${U1}'`);
    expect(rows[0].n).toBe(2001);
  });

  it("the member's own 2,000 are still the most they can add, and a row cannot claim the agent wrote it", async () => {
    await fresh();
    await as(U1);
    await db.exec(`INSERT INTO public.user_applications (user_id, company, job_id, written_by) SELECT '${U1}', 'Mine', 'gh:mine:' || g, 'service' FROM generate_series(1, 2000) g`);
    await expect(db.exec(`INSERT INTO public.user_applications (user_id, company, job_id) VALUES ('${U1}', 'Mine', 'gh:mine:over')`)).rejects.toThrow(/most it can/);
  });

  it("at the cap, an upsert to an answer that exists changes it instead of being refused", async () => {
    await fresh();
    await db.exec(`INSERT INTO public.agent_learned_answers (user_id, question_key) SELECT '${U1}', 'q' || g FROM generate_series(1, 2000) g`);
    await as(U1);
    await db.exec(`INSERT INTO public.agent_learned_answers (user_id, question_key, answer_value) VALUES ('${U1}', 'q7', 'changed')
                   ON CONFLICT (user_id, question_key) DO UPDATE SET answer_value = EXCLUDED.answer_value`);
    const { rows } = await db.query<{ answer_value: string }>(`SELECT answer_value FROM public.agent_learned_answers WHERE question_key = 'q7'`);
    expect(rows[0].answer_value, "an existing answer could not be changed at the cap").toBe("changed");
    await expect(db.exec(`INSERT INTO public.agent_learned_answers (user_id, question_key) VALUES ('${U1}', 'q-new')`)).rejects.toThrow(/most it can/);
  });

  it("shortlist_candidates is bounded although only our servers write it", async () => {
    await fresh();
    await db.exec(`INSERT INTO public.shortlist_candidates (owner_id, file_name) SELECT '${U1}', 'cv' || g FROM generate_series(1, 10000) g`);
    await expect(db.exec(`INSERT INTO public.shortlist_candidates (owner_id, file_name) VALUES ('${U1}', 'one more')`)).rejects.toThrow(/most it can/);
    // Ten thousand rows through the cap trigger in pglite: seconds on an idle
    // machine, past the default 5 s budget when the pre-push gate runs loaded.
  }, 60_000);
});
