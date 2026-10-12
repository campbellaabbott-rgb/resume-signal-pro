// @vitest-environment node
/**
 * A PERK'S READ DATE IS THE OLDEST READ, A CHANGED POSTING IS READ AGAIN, THE
 * ROLLUP KEEPS ITS HEADROOM, AND THE AUDIT DRAWS THE NEGATION STRATUM
 * (sweep S12-186, S12-188 and S12-091's audit half; migration 20261012110000
 * and supabase/functions/employer-profiles/sweep.ts).
 *
 *   S12-188  a claim row's as_of was the rollup's own time, printed as "read
 *            {date}" beside postings read days before; it is now the oldest
 *            extracted_at among the n postings counted. And a posting was
 *            never read again when its text changed, so a re-dated posting
 *            that dropped dental kept counting it: the take now answers the
 *            md5 of the text it hands out, the sweep echoes it to the store,
 *            and a posting whose text no longer matches is taken again.
 *   S12-186  the tick checked its budget only between chunks, so a chunk that
 *            started at 85 s ran past the cron's 110 s and took the whole
 *            tick's work with it. It now sizes chunks by the slowest chunk of
 *            the last tick and never starts one that would overrun.
 *   S12-091  the audit draw takes up to a quarter of its rows from claim rows
 *            whose quoted line carries a negating word, and says so per row.
 *
 * pglite, under Supabase's default grants, with the shipped extractor and
 * sweep helpers reading a stand-in board.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { boardsOf, encodeBoard, type TakenRow } from "../../supabase/functions/employer-profiles/sweep";
import { EXTRACTOR_VERSION } from "../../supabase/functions/_shared/perks-extract";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const ENGINE = readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith("20261012110000_"))!), "utf8");

const SUPABASE_DEFAULTS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    title text NOT NULL, description text, country text, agency boolean NOT NULL DEFAULT false,
    apply_url text NOT NULL DEFAULT '', missing_since timestamptz, effective_posted timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_company_snapshots (
    company_token text NOT NULL, snapshot_date date NOT NULL, company text NOT NULL DEFAULT '',
    open_roles integer NOT NULL DEFAULT 0, open_roles_served integer, PRIMARY KEY (company_token, snapshot_date));
`;
const ABOUT = "About us\nWe build software for logistics companies across the country, and we care about craft, kindness and shipping work that matters to the people who rely on it every single day.";
const ROLE = "Responsibilities\nWrite code, review designs and pair with the team on hard problems.\nRequirements\nFive years of experience with TypeScript and Postgres.";
const US_BENEFITS = "What we offer\nComprehensive medical, dental and vision insurance for you and your family\n401(k) retirement plan with a company match";
const NO_DENTAL = "What we offer\nComprehensive medical insurance for you and your family\n401(k) retirement plan with a company match";
const body = (...p: string[]) => [ABOUT, ROLE, ...p].join("\n");

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

async function boot(boards: Array<{ token: string; n: number; text: (i: number) => string }>): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SUPABASE_DEFAULTS);
  for (const b of boards) {
    for (let i = 0; i < b.n; i++) {
      const id = `greenhouse:${b.token}:${i}`;
      await db.query("INSERT INTO public.job_board_postings (id, source, company_token, company, title, description, country) VALUES ($1,'greenhouse',$2,$2,$3,$4,'US')",
        [id, b.token, `Engineer ${i}`, b.text(i)]);
    }
  }
  await db.exec(`INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, company, open_roles, open_roles_served)
                 SELECT company_token, current_date, max(company), count(*), count(*) FROM public.job_board_postings GROUP BY company_token`);
  await db.exec(ENGINE);
  return db;
}

async function take(db: PGlite, asked = 200): Promise<TakenRow[]> {
  return (await db.query<TakenRow>("SELECT * FROM public.employer_perk_sweep_take($1, $2::smallint, 3000)", [asked, EXTRACTOR_VERSION])).rows;
}
async function sweep(db: PGlite): Promise<void> {
  for (let calls = 0; calls < 30; calls++) {
    const asked = 200;
    const rows = await take(db, asked);
    if (!rows.length) return;
    for (const b of boardsOf(rows, asked)) {
      const enc = await encodeBoard(b);
      await db.query("SELECT public.employer_perk_store($1, $2::jsonb, $3::jsonb, $4, $5, $6::smallint)",
        [b.token, JSON.stringify(enc.rows), JSON.stringify(enc.lines), b.rows[b.rows.length - 1].posting_id, b.done, EXTRACTOR_VERSION]);
    }
  }
}
const tick = async (db: PGlite, budget = 90000) =>
  (await db.query<{ r: { state: string; chunks: number; chunk_rows: number } }>("SELECT public.employer_perk_rollup_tick($1) AS r", [budget])).rows[0].r;
const fresh = (db: PGlite) => db.exec("UPDATE public.employer_perk_rollup_state SET lap_finished_at = now() - interval '2 days', lap_cursor = NULL");

describe("S12-188: the read date and the re-read", () => {
  it("a claim row is dated by the oldest read among the postings it counts, not by the rollup", async () => {
    const db = await boot([{ token: "acme", n: 6, text: () => body(US_BENEFITS) }]);
    await sweep(db);
    await db.exec("UPDATE public.employer_perk_postings SET extracted_at = now() - interval '3 days' WHERE posting_id = 'greenhouse:acme:2'");
    await fresh(db);
    await tick(db);
    const { rows } = await db.query<{ perk: string; as_of: string; oldest: string }>(
      `SELECT r.perk, r.as_of::text AS as_of, (SELECT min(e.extracted_at) FROM public.employer_perk_postings e WHERE e.company_token = 'acme')::text AS oldest
         FROM public.employer_perk_rollups r WHERE r.company_token = 'acme' AND r.perk = 'dental'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].as_of).toBe(rows[0].oldest);
    const ageH = (await db.query<{ h: number }>("SELECT extract(epoch FROM now() - as_of) / 3600 AS h FROM public.employer_perk_rollups WHERE company_token = 'acme' AND perk = 'dental'")).rows[0].h;
    expect(Number(ageH)).toBeGreaterThan(70);
  });

  it("the take answers the text's md5, the sweep stores it, and a posting whose text changed is taken and read again", async () => {
    const db = await boot([{ token: "acme", n: 6, text: () => body(US_BENEFITS) }]);
    const first = await take(db);
    expect(first.every((r) => typeof r.text_hash === "string" && /^[0-9a-f]{32}$/.test(r.text_hash!))).toBe(true);
    await sweep(db);
    expect(await take(db), "nothing left to read once every posting is stored with its hash").toHaveLength(0);
    const stored = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.employer_perk_postings WHERE text_hash IS NOT NULL")).rows[0].n;
    expect(stored).toBe(6);
    // Re-dated and re-written: dental is gone from the text.
    await db.query("UPDATE public.job_board_postings SET description = $1 WHERE id = 'greenhouse:acme:0'", [body(NO_DENTAL)]);
    await db.exec("UPDATE public.employer_perk_sweep_boards SET swept_at = NULL");
    const again = await take(db);
    expect(again.map((r) => r.posting_id)).toEqual(["greenhouse:acme:0"]);
    await sweep(db);
    const bitDental = (await db.query<{ dental: boolean }>(
      `SELECT ((perks_y | perks_q) >> (SELECT bit FROM public.employer_profile_perk_publish WHERE perk = 'dental')) & 1 = 1 AS dental
         FROM public.employer_perk_postings WHERE posting_id = 'greenhouse:acme:0'`)).rows[0].dental;
    expect(bitDental, "the re-read posting no longer counts dental").toBe(false);
  });

  it("a row stored without a hash (a sweep that sent none) is not taken again on it, so such a sweep cannot loop", async () => {
    const db = await boot([{ token: "acme", n: 6, text: () => body(US_BENEFITS) }]);
    await sweep(db);
    await db.exec("UPDATE public.employer_perk_postings SET text_hash = NULL");
    await db.exec("UPDATE public.employer_perk_sweep_boards SET swept_at = NULL");
    expect(await take(db)).toHaveLength(0);
  });
});

describe("S12-186: the rollup never starts a chunk it cannot finish", () => {
  const BOARDS = Array.from({ length: 30 }, (_, b) => ({ token: `b${String(b).padStart(2, "0")}`, n: 60, text: () => body(US_BENEFITS) }));

  it("with the last tick's slowest chunk on record, the first chunk runs and the tick stops at its budget", async () => {
    const db = await boot(BOARDS);
    await sweep(db);
    await db.exec("UPDATE public.employer_profile_config SET rollup_chunk = 1000");
    // 20 seconds per 1,000 perk rows: one chunk of 1,000 cannot fit twice in 3 seconds.
    await db.exec("UPDATE public.employer_perk_rollup_state SET ms_per_krow = 20000");
    await fresh(db);
    const r = await tick(db, 3000);
    expect(r.chunks, "the first chunk always runs, so the cursor moves").toBe(1);
    expect(r.state).toBe("budget");
    expect(r.chunk_rows).toBe(1000);
    const cursor = (await db.query<{ c: string | null }>("SELECT lap_cursor AS c FROM public.employer_perk_rollup_state")).rows[0].c;
    expect(cursor && cursor > "", "the work of the chunk that ran is kept").toBeTruthy();
    // The tick records what it measured, and the next tick, fast now, finishes the lap.
    const kept = (await db.query<{ m: number }>("SELECT ms_per_krow::float AS m FROM public.employer_perk_rollup_state")).rows[0].m;
    expect(kept).toBeLessThan(20000);
    const next = await tick(db, 90000);
    expect(next.state).toBe("lap_finished");
  });

  it("chunks are sized so one is expected to take a third of the budget", async () => {
    const db = await boot(BOARDS.slice(0, 5));
    await sweep(db);
    await db.exec("UPDATE public.employer_perk_rollup_state SET ms_per_krow = 10");
    await fresh(db);
    // 90 s budget / 3 = 30 s; at 10 ms per 1,000 rows that is 3,000,000 rows, capped at the configured 50,000.
    expect((await tick(db, 90000)).chunk_rows).toBe(50000);
    await db.exec("UPDATE public.employer_perk_rollup_state SET ms_per_krow = 600");
    await fresh(db);
    // 30 s at 600 ms per 1,000 rows: 50,000 rows.
    expect((await tick(db, 90000)).chunk_rows).toBe(50000);
    await db.exec("UPDATE public.employer_perk_rollup_state SET ms_per_krow = 1500");
    await fresh(db);
    expect((await tick(db, 90000)).chunk_rows).toBe(20000);
  });
});

describe("S12-091: the audit draws the negation stratum first", () => {
  it("a claim row whose quoted line carries a negating word is drawn, and every row names its stratum", async () => {
    const boards = Array.from({ length: 12 }, (_, b) => ({ token: `c${String(b).padStart(2, "0")}`, n: 6, text: () => body(US_BENEFITS) }));
    const db = await boot(boards);
    await sweep(db);
    await fresh(db);
    await tick(db);
    // One board's dental line is a sentence with a negating word in it.
    await db.exec(`INSERT INTO public.employer_perk_lines (line_hash, line) VALUES ('00000000000000aa', 'Dental is not included for interns; full-time staff get medical, dental and vision.')`);
    await db.exec(`UPDATE public.employer_perk_rollups SET quote_hash = '00000000000000aa' WHERE company_token = 'c07' AND perk = 'dental'`);
    const draw = (await db.query<{ r: { rows: Array<{ company_token: string; stratum: string }> } }>("SELECT public.employer_perk_audit_draw('dental', 4) AS r")).rows[0].r;
    expect(draw.rows).toHaveLength(4);
    expect(draw.rows.find((x) => x.company_token === "c07")?.stratum).toBe("negation_near");
    expect(draw.rows.filter((x) => x.stratum === "random")).toHaveLength(3);
    expect(new Set(draw.rows.map((x) => x.company_token)).size, "no row is drawn twice").toBe(4);
  });
});
