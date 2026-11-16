// @vitest-environment node
/**
 * Board .102's two core migrations, run on a real Postgres that starts from
 * Supabase's default grants (anon and authenticated hold ALL on new tables):
 *
 *   20261111100000  closes_at on job_board_postings, exit_basis on
 *                   job_board_exits; re-runnable, self-checking.
 *   20261111110000  a bare-'$' pay read in CAD under a US place reads USD;
 *                   counts first, refuses above 5,000 rows, a no-op on re-run,
 *                   and leaves a stated Canadian figure alone.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIG = resolve(__dirname, "../../supabase/migrations");
const COLUMNS = readFileSync(`${MIG}/20261111100000_a_usajobs_announcement_closes_on_the_date_the_agency_states.sql`, "utf8");
const HEAL = readFileSync(`${MIG}/20261111110000_pay_read_in_the_wrong_currency_is_read_again.sql`, "utf8");

let db: PGlite;
// A PGlite start and a 5,000-row seed come close to the 5 s default under a loaded full-suite run: each heavy case says its own budget.
const HEAVY = 30_000;

const setup = async (rank: "generated" | "plain") => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    CREATE TABLE public.job_board_postings (
      id text PRIMARY KEY, source text, company_token text, country text, salary text, description text,
      salary_min_annual numeric, salary_currency text,
      ${rank === "generated"
        ? "salary_rank_usd numeric GENERATED ALWAYS AS (salary_min_annual * CASE salary_currency WHEN 'USD' THEN 1.0 WHEN 'CAD' THEN 0.73 ELSE NULL END) STORED"
        : "salary_rank_usd numeric"}
    );
    CREATE TABLE public.job_board_exits (id bigserial PRIMARY KEY, posting_id text, exit_reason text CHECK (exit_reason IN ('removed', 'aged_out')));
  `);
};
const run = (sql: string) => db.exec(sql);

describe("20261111100000 adds the two columns once, and checks itself", () => {
  beforeEach(() => setup("generated"), HEAVY);

  it("adds closes_at timestamptz and exit_basis text, and a second run changes nothing", async () => {
    await run(COLUMNS);
    await run(COLUMNS);
    const { rows } = await db.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE column_name IN ('closes_at', 'exit_basis') ORDER BY 1`);
    expect(rows).toEqual([
      { table_name: "job_board_exits", column_name: "exit_basis", data_type: "text" },
      { table_name: "job_board_postings", column_name: "closes_at", data_type: "timestamp with time zone" },
    ]);
  }, HEAVY);

  it("the self-check fails a column of the wrong type instead of passing it", async () => {
    await db.exec("ALTER TABLE public.job_board_postings ADD COLUMN closes_at date");
    await expect(run(COLUMNS)).rejects.toThrow(/closes_at is missing or not timestamptz/);
  }, HEAVY);

  it("adds no index and no constraint, and names nothing it must not", async () => {
    await run(COLUMNS);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename IN ('job_board_postings', 'job_board_exits') AND indexdef ~ '(closes_at|exit_basis)'`);
    expect(rows[0].n).toBe(0);
    expect(COLUMNS).toMatch(/SET LOCAL lock_timeout = '2s'/);
    expect(COLUMNS).toMatch(/IF tries >= 10 THEN/);
    expect(COLUMNS.toLowerCase()).not.toMatch(/vault|secret|decrypted/);
    expect(HEAL.toLowerCase()).not.toMatch(/vault|secret|decrypted/);
  }, HEAVY);

  it("takes both locks in one block, the exit table first and the posting table last, so a wait for one never holds the other", () => {
    const code = COLUMNS.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    const alters = [...code.matchAll(/ALTER TABLE public\.(\w+) ADD COLUMN/g)].map((m) => m[1]);
    expect(alters).toEqual(["job_board_exits", "job_board_postings"]);
    // One DO block holds both ALTERs, inside the one BEGIN ... EXCEPTION WHEN lock_not_available that releases them together.
    const block = /BEGIN\s+SET LOCAL lock_timeout = '2s';([\s\S]*?)EXCEPTION WHEN lock_not_available THEN/.exec(code)?.[1] ?? "";
    expect([...block.matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1])).toEqual(["job_board_exits", "job_board_postings"]);
    expect(code.match(/EXCEPTION WHEN lock_not_available/g)).toHaveLength(1);
  });
});

describe("20261111110000 reads a bare-dollar pay under a US place as USD, and nothing else", () => {
  const seed = async (extra = 0) => {
    await db.exec(`
      INSERT INTO public.job_board_postings (id, source, company_token, country, salary, salary_min_annual, salary_currency) VALUES
        ('bms1', 'workday', 'bms', 'US', '$24.00 - $45.00', 49920, 'CAD'),
        ('bms2', 'workday', 'bms', 'US', ' $130,000 - $160,000 a year', 130000, 'CAD'),
        ('ca1',  'workday', 'bms', 'US', '$90,000 CAD', 90000, 'CAD'),
        ('ca2',  'lever', 'x', 'US', '$80,000 - $95,000 (Canadian)', 80000, 'CAD'),
        ('ca3',  'lever', 'x', 'US', 'C$70,000', 70000, 'CAD'),
        ('can',  'lever', 'x', 'CA', '$70,000', 70000, 'CAD'),
        ('usd',  'lever', 'x', 'US', '$70,000', 70000, 'USD'),
        ('eur',  'lever', 'x', 'US', '€70.000', 70000, 'CAD');
    `);
    if (extra) await db.exec(`INSERT INTO public.job_board_postings (id, source, company_token, country, salary, salary_min_annual, salary_currency)
      SELECT 'm' || g, 'workday', 'mass', 'US', '$50,000', 50000, 'CAD' FROM generate_series(1, ${extra}) g`);
  };
  const currencies = async () => Object.fromEntries((await db.query<{ id: string; salary_currency: string; salary_rank_usd: string | null }>(
    "SELECT id, salary_currency, salary_rank_usd FROM public.job_board_postings WHERE id NOT LIKE 'm%' ORDER BY id")).rows.map((r) => [r.id, [r.salary_currency, r.salary_rank_usd === null ? null : Number(r.salary_rank_usd)]]));

  for (const rank of ["generated", "plain"] as const) {
    it(`heals the two BMS rows and leaves every row with a Canadian marker, a Canadian place or another currency (salary_rank_usd ${rank})`, async () => {
      await setup(rank);
      await seed();
      if (rank === "plain") await db.exec("UPDATE public.job_board_postings SET salary_rank_usd = salary_min_annual * 0.73 WHERE salary_currency = 'CAD'");
      await run(HEAL);
      const c = await currencies();
      expect(c.bms1).toEqual(["USD", 49920]);
      expect(c.bms2).toEqual(["USD", 130000]);
      for (const id of ["ca1", "ca2", "ca3", "can", "eur"]) expect(c[id]?.[0], id).toBe("CAD");
      expect(c.usd[0]).toBe("USD");
      const before = JSON.stringify(c);
      await run(HEAL);
      expect(JSON.stringify(await currencies()), "a second run changes nothing").toBe(before);
    }, HEAVY);
  }

  it("refuses above 5,000 matching rows and changes none of them", async () => {
    await setup("generated");
    await seed(5_000);
    await expect(run(HEAL)).rejects.toThrow(/more than the 5,000 this heal was written for/);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.job_board_postings WHERE salary_currency = 'CAD'");
    expect(rows[0].n, "every row is still CAD").toBe(5_000 + 7);
  }, HEAVY);

  it("at exactly 5,000 it heals", async () => {
    await setup("generated");
    await seed(4_998);
    await run(HEAL);
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.job_board_postings WHERE company_token = 'mass' AND salary_currency = 'USD'");
    expect(rows[0].n).toBe(4_998);
  }, HEAVY);

  it("does not write the description, so the description-embed trigger has nothing to fire on", () => {
    expect(HEAL).not.toMatch(/SET[^;]*\bdescription\b\s*=/i);
  });

  it("reads the posting table three times, not four: the count and the top tokens share one pass, under the five minutes the earlier heals set", () => {
    const code = HEAL.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(code.match(/FROM public\.job_board_postings/g)).toHaveLength(2);
    expect(code.match(/UPDATE public\.job_board_postings/g)).toHaveLength(2);
    expect(code).toMatch(/^SET LOCAL statement_timeout = '5min';$/m);
  });
});
