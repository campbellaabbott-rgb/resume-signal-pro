// @vitest-environment node
/**
 * A PERK POSTING IS READ AGAIN ONLY WHEN ITS TEXT CHANGED, AND THE SWEEP IS
 * KICKED ONLY WHEN THERE IS WORK (cost audit 2026-11-08, "Perk sweep";
 * migrations 20261109160000 and 20261109161000).
 *
 * employer_perk_sweep_take found a changed posting by an md5 over every
 * serving posting's title AND description -- a full read of a million
 * descriptions a day. It now reads what can change a posting's text: a title
 * change the ingest logged, a description arriving after a read made without
 * one, the row inserted again. The every-minute cron kick asks
 * employer_perk_sweep_due() first, which reads the extractor version from
 * employer_perk_extractor_version(), a copy of EXTRACTOR_VERSION held equal
 * here.
 *
 * pglite under Supabase's default grants, with the shipped engine
 * (20261012110000), the shipped extractor and sweep helpers, and the new take.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { boardsOf, encodeBoard, type TakenRow } from "../../supabase/functions/employer-profiles/sweep";
import { EXTRACTOR_VERSION, readPosting } from "../../supabase/functions/_shared/perks-extract";
import { liveDefinitionOf } from "./helpers/live-sql";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith(prefix))!), "utf8");
const ENGINE = file("20261012110000_");
const SCHEDULES = file("20261012111000_");
const TAKE = file("20261109160000_");
const GATE = file("20261109161000_");

const SUPABASE_DEFAULTS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    title text NOT NULL, description text, country text, agency boolean NOT NULL DEFAULT false,
    apply_url text NOT NULL DEFAULT '', missing_since timestamptz, effective_posted timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_company_snapshots (
    company_token text NOT NULL, snapshot_date date NOT NULL, company text NOT NULL DEFAULT '',
    open_roles integer NOT NULL DEFAULT 0, open_roles_served integer, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_field_changes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text NOT NULL, company_token text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT '', field text NOT NULL, old_value text, new_value text,
    observed_at timestamptz NOT NULL DEFAULT now());
`;
const ABOUT = "About us\nWe build software for logistics companies across the country, and we care about craft, kindness and shipping work that matters to the people who rely on it every single day.";
const ROLE = "Responsibilities\nWrite code, review designs and pair with the team on hard problems.\nRequirements\nFive years of experience with TypeScript and Postgres.";
const BENEFITS = "What we offer\nComprehensive medical, dental and vision insurance for you and your family\n401(k) retirement plan with a company match";
const NO_DENTAL = "What we offer\nComprehensive medical insurance for you and your family\n401(k) retirement plan with a company match";
const body = (...p: string[]) => [ABOUT, ROLE, ...p].join("\n");

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

/** acme: six postings with text; acme:5 has none yet. */
async function boot(): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SUPABASE_DEFAULTS);
  for (let i = 0; i < 6; i++) {
    await db.query(
      "INSERT INTO public.job_board_postings (id, source, company_token, company, title, description, country, last_seen) VALUES ($1,'greenhouse','acme','Acme',$2,$3,'US', now() - interval '2 days')",
      [`greenhouse:acme:${i}`, `Engineer ${i}`, i === 5 ? null : body(BENEFITS)]);
  }
  await db.exec(`INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, company, open_roles, open_roles_served)
                 SELECT company_token, current_date, max(company), count(*), count(*) FROM public.job_board_postings GROUP BY company_token`);
  await db.exec(ENGINE);
  await db.exec(TAKE);
  return db;
}
const take = async (db: PGlite, asked = 200): Promise<TakenRow[]> =>
  (await db.query<TakenRow>("SELECT * FROM public.employer_perk_sweep_take($1, $2::smallint, 3000)", [asked, EXTRACTOR_VERSION])).rows;
/** The sweep, as employer-profiles runs it: take, read, store, until nothing is left. */
async function sweep(db: PGlite): Promise<string[]> {
  const read: string[] = [];
  for (let calls = 0; calls < 30; calls++) {
    const rows = await take(db);
    if (!rows.length) break;
    read.push(...rows.map((r) => r.posting_id));
    for (const b of boardsOf(rows, 200)) {
      const enc = await encodeBoard(b);
      await db.query("SELECT public.employer_perk_store($1, $2::jsonb, $3::jsonb, $4, $5, $6::smallint)",
        [b.token, JSON.stringify(enc.rows), JSON.stringify(enc.lines), b.rows[b.rows.length - 1].posting_id, b.done, EXTRACTOR_VERSION]);
    }
  }
  await db.query("INSERT INTO public.employer_profile_runs (kind, started_at, finished_at, ok) VALUES ('sweep', now(), now(), true)");
  return read;
}
/** The next day's walk: every board queued again, as the 20-hour requeue does. */
const requeue = (db: PGlite) => db.exec("UPDATE public.employer_perk_sweep_boards SET queued_at = now(), swept_at = now() - interval '1 minute'");
/** Three hours pass: every read, every logged change and every insert stamp
 *  moves back together, so what came before a read still comes before it and
 *  a change made next is unambiguously after it. */
const later = (db: PGlite) => db.exec(`
  UPDATE public.employer_perk_postings SET extracted_at = extracted_at - interval '3 hours';
  UPDATE public.job_board_field_changes SET observed_at = observed_at - interval '3 hours';
  UPDATE public.job_board_postings SET last_seen = last_seen - interval '3 hours';`);
/** Hours later, the next walk: what it reads. */
const nextWalk = async (db: PGlite): Promise<string[]> => {
  await later(db);
  await requeue(db);
  const ids = (await take(db)).map((r) => r.posting_id);
  if (ids.length) await sweep(db);
  return ids;
};
const readAt = async (db: PGlite, id: string) =>
  (await db.query<{ at: string }>("SELECT extracted_at::text AS at FROM public.employer_perk_postings WHERE posting_id = $1", [id])).rows[0].at;
const dental = async (db: PGlite, id: string) =>
  (await db.query<{ d: boolean }>(
    `SELECT ((perks_y | perks_q) >> (SELECT bit FROM public.employer_profile_perk_publish WHERE perk = 'dental')) & 1 = 1 AS d
       FROM public.employer_perk_postings WHERE posting_id = $1`, [id])).rows[0]?.d;

describe("the take reads again exactly the postings whose text changed", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await boot();
    expect((await sweep(db)).length).toBe(6);
    await later(db);
  });

  it("an unchanged board is walked and nothing is read again", async () => {
    await requeue(db);
    expect(await take(db)).toEqual([]);
  });

  it("a title change the ingest logged is read again", async () => {
    await db.exec(`UPDATE public.job_board_postings SET title = 'Staff Engineer 1' WHERE id = 'greenhouse:acme:1';
                   INSERT INTO public.job_board_field_changes (posting_id, company_token, source, field, old_value, new_value)
                   VALUES ('greenhouse:acme:1', 'acme', 'greenhouse', 'title', 'Engineer 1', 'Staff Engineer 1');`);
    await requeue(db);
    expect((await take(db)).map((r) => r.posting_id)).toEqual(["greenhouse:acme:1"]);
    await sweep(db);
    // The read came within fifteen minutes of the change's stamp, so the next
    // walk reads it once more -- the margin's whole cost -- and then never again.
    expect(await nextWalk(db)).toEqual(["greenhouse:acme:1"]);
    expect(await nextWalk(db)).toEqual([]);
    await later(db);
  });

  it("a change stamped up to fifteen minutes BEFORE the read still counts: the ingest stamps its pass start, not its write", async () => {
    const at2 = await readAt(db, "greenhouse:acme:2");
    const at0 = await readAt(db, "greenhouse:acme:0");
    await db.query(`INSERT INTO public.job_board_field_changes (posting_id, company_token, source, field, observed_at) VALUES
                      ('greenhouse:acme:2', 'acme', 'greenhouse', 'title', $1::timestamptz - interval '10 minutes'),
                      ('greenhouse:acme:0', 'acme', 'greenhouse', 'title', $2::timestamptz - interval '20 minutes')`, [at2, at0]);
    await requeue(db);
    expect((await take(db)).map((r) => r.posting_id), "ten minutes before is inside the margin, twenty is not").toEqual(["greenhouse:acme:2"]);
    await sweep(db);
    expect(await nextWalk(db)).toEqual([]);
    await later(db);
  });

  it("a description that arrives after a read made without one is read again, even a short one", async () => {
    await db.exec("UPDATE public.job_board_postings SET description = 'Dental plan.' WHERE id = 'greenhouse:acme:5'");
    await requeue(db);
    expect((await take(db)).map((r) => r.posting_id)).toEqual(["greenhouse:acme:5"]);
    await sweep(db);
    expect(await nextWalk(db), "read with its text now, so its hash is no longer the title's alone").toEqual([]);
    await later(db);
  });

  it("a posting inserted again under the same id, with new text, is read again and stops counting what it dropped", async () => {
    expect(await dental(db, "greenhouse:acme:3")).toBe(true);
    await db.exec("DELETE FROM public.job_board_postings WHERE id = 'greenhouse:acme:3'");
    await db.query("INSERT INTO public.job_board_postings (id, source, company_token, company, title, description, country) VALUES ('greenhouse:acme:3','greenhouse','acme','Acme','Engineer 3',$1,'US')",
      [body(NO_DENTAL)]);
    await requeue(db);
    expect((await take(db)).map((r) => r.posting_id)).toEqual(["greenhouse:acme:3"]);
    await sweep(db);
    expect(await dental(db, "greenhouse:acme:3")).toBe(false);
    // Inserted within fifteen minutes of the read: one more read, then none.
    expect(await nextWalk(db)).toEqual(["greenhouse:acme:3"]);
    expect(await nextWalk(db)).toEqual([]);
    await later(db);
  });

  it("an apostrophe-only title fold, which the ingest patches without a log row, is not read again -- and cannot change a count", async () => {
    await db.exec("UPDATE public.job_board_postings SET title = 'Engineer 4 ’s team' WHERE id = 'greenhouse:acme:4'");
    await requeue(db);
    expect(await take(db)).toEqual([]);
    // What a count is made of: readable, english, franchise and the three masks.
    const counted = (r: ReturnType<typeof readPosting>) => ({ readable: r.readable, english: r.english, franchise: r.franchise, y: r.y, q: r.q, n: r.n });
    for (const [typed, folded] of [["Engineer 4 's team", "Engineer 4 ’s team"], ["Driver – don't miss", "Driver – don’t miss"]]) {
      expect(counted(readPosting(folded, body(BENEFITS)))).toEqual(counted(readPosting(typed, body(BENEFITS))));
      expect(counted(readPosting(folded, body(BENEFITS))).y, "the fixture counts something, so equality is not vacuous").toBeGreaterThan(0);
    }
  });

  it("only the rows it answers are hashed with their description", () => {
    const code = liveDefinitionOf("employer_perk_sweep_take").body;
    expect(code.split("COALESCE(p.description, '')").length - 1, "one md5 over the text: the answered column").toBe(1);
    expect(code).toMatch(/md5\(COALESCE\(p\.title, ''\) \|\| E'\\n' \|\| COALESCE\(p\.description, ''\)\)\s+FROM public\.job_board_postings p/);
  });
});

describe("teeth: the md5 test it replaces read every posting's description", () => {
  it("the 20261012110000 take compares an md5 over the description for every row already read", () => {
    const old = ENGINE.slice(ENGINE.indexOf("CREATE OR REPLACE FUNCTION public.employer_perk_sweep_take("));
    const where = old.slice(old.indexOf("AND (e.posting_id IS NULL"), old.indexOf("ORDER BY p.id"));
    expect(where).toMatch(/e\.text_hash <> md5\(COALESCE\(p\.title, ''\) \|\| E'\\n' \|\| COALESCE\(p\.description, ''\)\)/);
  });
});

describe("the extractor version, as SQL", () => {
  it("employer_perk_extractor_version() is EXTRACTOR_VERSION, in the newest definition and when executed", async () => {
    const def = liveDefinitionOf("employer_perk_extractor_version");
    const m = /SELECT\s+(\d+)::smallint/.exec(def.body);
    expect(m, `${def.file} holds no constant`).toBeTruthy();
    expect(Number(m![1]), `raise ${def.file}'s copy with supabase/functions/_shared/perks-extract.ts`).toBe(EXTRACTOR_VERSION);
    const db = await boot();
    expect((await db.query<{ v: number }>("SELECT public.employer_perk_extractor_version() AS v")).rows[0].v).toBe(EXTRACTOR_VERSION);
  });
});

describe("the gate the cron asks", () => {
  let db: PGlite;
  const due = async () => (await db.query<{ d: boolean }>("SELECT public.employer_perk_sweep_due() AS d")).rows[0].d;
  beforeAll(async () => { db = await boot(); });

  it("is due before the first sweep (nothing queued yet)", async () => {
    expect(await due()).toBe(true);
  });

  it("is not due once every board is swept at this version, the queue is fresh and a sweep ran this hour", async () => {
    await sweep(db);
    expect(await due()).toBe(false);
  });

  it("is due when a board is queued again, or swept at another version", async () => {
    await db.exec("UPDATE public.employer_perk_sweep_boards SET queued_at = now(), swept_at = now() - interval '1 minute'");
    expect(await due()).toBe(true);
    await sweep(db);
    expect(await due()).toBe(false);
    await db.exec("UPDATE public.employer_perk_sweep_boards SET swept_version = swept_version - 1");
    expect(await due()).toBe(true);
    await sweep(db);
    expect(await due()).toBe(false);
  });

  it("is due when the daily requeue is due", async () => {
    await db.exec("UPDATE public.employer_perk_sweep_boards SET queued_at = now() - interval '21 hours', swept_at = now() - interval '20 hours'");
    expect(await due()).toBe(true);
    await sweep(db);
  });

  it("is due when no sweep has run for an hour, whatever the queue says", async () => {
    expect(await due()).toBe(false);
    await db.exec("UPDATE public.employer_profile_runs SET started_at = now() - interval '61 minutes'");
    expect(await due()).toBe(true);
  });

  it("is closed to both client roles, as are the take and the version", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.query("SELECT public.employer_perk_sweep_due()")).rejects.toThrow(/permission denied/);
      await expect(db.query("SELECT public.employer_perk_extractor_version()")).rejects.toThrow(/permission denied/);
      await expect(db.query("SELECT * FROM public.employer_perk_sweep_take(1, 2::smallint, 200)")).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE");
    }
  });
});

describe("the cron kick asks the gate first (20261109161000)", () => {
  const CRON = `
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (
      jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
      database text NOT NULL DEFAULT 'postgres', username text NOT NULL DEFAULT 'postgres',
      active boolean NOT NULL DEFAULT true, jobname text UNIQUE);
    CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
                                   database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE cron.job j SET schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command),
             active = coalesce(alter_job.active, j.active)
       WHERE j.jobid = job_id;
    END $$;
  `;
  // The command exactly as 20261012111000 schedules it.
  const SHIPPED = /'employer-perks-sweep',\s*'\* \* \* \* \*',\s*\$job\$([\s\S]*?)\$job\$/.exec(SCHEDULES)![1];
  const command = async (db: PGlite) =>
    (await db.query<{ command: string; schedule: string; active: boolean }>("SELECT command, schedule, active FROM cron.job WHERE jobname = 'employer-perks-sweep'")).rows[0];
  async function withJob(cmd: string): Promise<PGlite> {
    const db = await boot();
    await db.exec(CRON);
    await db.query("INSERT INTO cron.job (jobname, schedule, command) VALUES ('employer-perks-sweep', '* * * * *', $1)", [cmd]);
    return db;
  }

  it("inserts the gate in front of the existing condition and changes nothing else in the command", async () => {
    const db = await withJob(SHIPPED);
    await db.exec(GATE);
    const j = await command(db);
    expect(j.command).toBe(SHIPPED.replace(") WHERE EXISTS (", ") WHERE public.employer_perk_sweep_due() AND EXISTS ("));
    expect(j.command.startsWith("SET statement_timeout = '15s';")).toBe(true);
    expect(j).toMatchObject({ schedule: "* * * * *", active: true });
  });

  it("re-applying leaves the gated command as it is", async () => {
    const db = await withJob(SHIPPED);
    await db.exec(GATE);
    const once = (await command(db)).command;
    await db.exec(GATE);
    expect((await command(db)).command).toBe(once);
  });

  it("a command without the condition it inserts into fails the file instead of guessing", async () => {
    const db = await withJob("SET statement_timeout = '15s'; SELECT 1;");
    await expect(db.exec(GATE)).rejects.toThrow(/has no "\) WHERE EXISTS \(" to gate/);
  });

  it("a database without pg_cron, or without the job, applies the file as a no-op", async () => {
    const bare = await boot();
    await expect(bare.exec(GATE)).resolves.toBeDefined();
    const db = await boot();
    await db.exec(CRON);
    await expect(db.exec(GATE)).resolves.toBeDefined();
  });

  it("the file names none of the words Lovable's agent refuses", () => {
    expect(GATE).not.toMatch(/vault|secret|decrypted/i);
    expect(TAKE).not.toMatch(/vault|secret|decrypted/i);
  });
});
