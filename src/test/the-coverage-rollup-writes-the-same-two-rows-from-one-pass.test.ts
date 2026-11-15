// @vitest-environment node
/**
 * THE COVERAGE ROLLUP WRITES THE SAME TWO ROWS, FROM ONE PASS.
 *
 * 20261109121000 re-issues refresh_job_board_stats() so date_coverage and
 * desc_coverage come from one grouped pass over the live postings instead of
 * two. Run in pglite against the definition it replaces (20260909221000, the
 * file itself, not a copy), it holds that:
 *
 *   - on one fixture, inside one transaction (so now() is one instant), the
 *     old and the new writer leave byte-equal rows: date_coverage,
 *     desc_coverage and freshness;
 *   - the new writer reads the postings once where the old read them twice
 *     (counted by routing the table through a function that counts its own
 *     calls);
 *   - a pass that fails -- by a statement timeout's own SQLSTATE, which WHEN
 *     OTHERS does not catch, or by any other error -- leaves BOTH coverage
 *     rows as they were, under their old computed_at, and still writes
 *     freshness;
 *   - a write that fails costs only its own row.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const read = (stamp: string) => {
  const f = readdirSync(MIG).find((x) => x.startsWith(stamp) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration ${stamp}`);
  return readFileSync(resolve(MIG, f), "utf8");
};
const OLD_FILE = read("20260909221000");
/** The old definition alone: its CREATE through the END of its body. */
const OLD_FN = OLD_FILE.slice(
  OLD_FILE.indexOf("CREATE OR REPLACE FUNCTION public.refresh_job_board_stats()"),
  OLD_FILE.indexOf("END $$;") + "END $$;".length,
);
const NEW_FILE = read("20261109121000");

/**
 * The postings are a VIEW over a function, so every scan of them is one call
 * the test can count, and a fault can be thrown from inside the read.
 */
const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.postings_base (
    id bigserial PRIMARY KEY, company_token text NOT NULL, source text, posted_at timestamptz,
    description text, missing_since timestamptz);
  CREATE TABLE public.scan_count (n int NOT NULL);
  INSERT INTO public.scan_count VALUES (0);
  CREATE TABLE public.fault (kind text);
  INSERT INTO public.fault VALUES (NULL);
  CREATE FUNCTION public.postings_scan() RETURNS SETOF public.postings_base LANGUAGE plpgsql VOLATILE AS $$
  DECLARE k text;
  BEGIN
    UPDATE public.scan_count SET n = n + 1;
    SELECT f.kind INTO k FROM public.fault f;
    IF k = 'timeout' THEN RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled'; END IF;
    IF k = 'error' THEN RAISE EXCEPTION 'the postings could not be read'; END IF;
    RETURN QUERY SELECT * FROM public.postings_base;
  END $$;
  CREATE VIEW public.job_board_postings AS SELECT * FROM public.postings_scan();
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, verified_at timestamptz NOT NULL);
  CREATE TABLE public.job_board_stats_rollup (k text PRIMARY KEY, v jsonb, computed_at timestamptz);
  CREATE TABLE public.write_fault (k text);
  CREATE FUNCTION public.refuse_write() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.write_fault w WHERE w.k = NEW.k) THEN RAISE EXCEPTION 'write refused for %', NEW.k; END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER refuse_write BEFORE INSERT OR UPDATE ON public.job_board_stats_rollup
    FOR EACH ROW EXECUTE FUNCTION public.refuse_write();
`;

/** Three sources with distinct totals (so ORDER BY total DESC has one answer), nulls in both counted columns, and withdrawn rows that must not count. */
const FIXTURE = `
  INSERT INTO public.postings_base (company_token, source, posted_at, description, missing_since)
  SELECT 'acme', 'greenhouse', CASE WHEN g % 3 = 0 THEN NULL ELSE now() - interval '2 days' END,
         CASE WHEN g % 4 = 0 THEN NULL ELSE 'text' END, NULL FROM generate_series(1, 23) g;
  INSERT INTO public.postings_base (company_token, source, posted_at, description, missing_since)
  SELECT 'globex', 'workday', CASE WHEN g % 2 = 0 THEN NULL ELSE now() END,
         CASE WHEN g % 5 = 0 THEN 'text' ELSE NULL END, NULL FROM generate_series(1, 41) g;
  INSERT INTO public.postings_base (company_token, source, posted_at, description, missing_since)
  SELECT 'initech', 'lever', now(), 'text', NULL FROM generate_series(1, 7) g;
  INSERT INTO public.postings_base (company_token, source, posted_at, description, missing_since)
  SELECT 'gone', 'lever', now(), 'text', now() - interval '1 day' FROM generate_series(1, 30) g;
  INSERT INTO public.postings_base (company_token, source, posted_at, description, missing_since)
  SELECT 'nullsource', NULL, NULL, NULL, NULL FROM generate_series(1, 2) g;
  INSERT INTO public.job_board_verifications VALUES
    ('acme', now() - interval '90 minutes'), ('globex', now() - interval '20 minutes'),
    ('initech', now() - interval '400 minutes'), ('gone', now() - interval '3 days'), ('unknown', now());
`;

async function boot(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  return db;
}
type RollupRow = { k: string; v: unknown; computed_at: string };
const rollup = async (db: PGlite, table = "public.job_board_stats_rollup") =>
  Object.fromEntries((await db.query<RollupRow>(`SELECT k, v, computed_at::text AS computed_at FROM ${table} ORDER BY k`)).rows.map((r) => [r.k, r]));
const scans = async (db: PGlite) => Number((await db.query<{ n: number }>("SELECT n FROM public.scan_count")).rows[0].n);

describe("the merged writer leaves the rows the old one did", () => {
  it("on one fixture, at one instant, the old and the new definition write equal rows", async () => {
    const db = await boot();
    await db.exec(FIXTURE);
    await db.exec(`BEGIN;
      ${OLD_FN}
      SELECT public.refresh_job_board_stats();
      CREATE TEMP TABLE old_rows AS SELECT * FROM public.job_board_stats_rollup;
      DELETE FROM public.job_board_stats_rollup;
      ${NEW_FILE}
      SELECT public.refresh_job_board_stats();
      COMMIT;`);
    const before = await rollup(db, "old_rows");
    const after = await rollup(db);
    expect(Object.keys(after)).toEqual(["date_coverage", "desc_coverage", "freshness"]);
    expect(after).toEqual(before);
    // And the fixture was worth comparing: three sources and the null one,
    // withdrawn rows left out, both columns partly null.
    expect(after.date_coverage.v).toEqual([
      { source: "workday", total: 41, dated: 21 },
      { source: "greenhouse", total: 23, dated: 16 },
      { source: "lever", total: 7, dated: 7 },
      { source: null, total: 2, dated: 0 },
    ]);
    expect(after.desc_coverage.v).toEqual([
      { source: "workday", total: 41, described: 8 },
      { source: "greenhouse", total: 23, described: 18 },
      { source: "lever", total: 7, described: 7 },
      { source: null, total: 2, described: 0 },
    ]);
  });

  it("the new definition reads the postings once a run, where the old read them twice", async () => {
    // No verification stamps, so the freshness block reads no postings and
    // every call counted is a coverage pass.
    const db = await boot();
    await db.exec(`INSERT INTO public.postings_base (company_token, source, posted_at) VALUES ('a', 'x', now());`);
    await db.exec(OLD_FN);
    await db.exec("UPDATE public.scan_count SET n = 0; SELECT public.refresh_job_board_stats();");
    expect(await scans(db)).toBe(2);
    await db.exec(NEW_FILE);
    await db.exec("UPDATE public.scan_count SET n = 0; SELECT public.refresh_job_board_stats();");
    expect(await scans(db)).toBe(1);
  });
});

describe("each row still degrades on its own", () => {
  const SEEDED = `
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at) VALUES
      ('date_coverage', '[{"source": "kept", "total": 1, "dated": 1}]', '2020-01-01T12:00:00Z'),
      ('desc_coverage', '[{"source": "kept", "total": 1, "described": 1}]', '2020-01-01T12:00:00Z'),
      ('freshness', '{"boards": -1}', '2020-01-01T12:00:00Z');
  `;
  for (const kind of ["timeout", "error"] as const) {
    it(`a coverage pass that fails by ${kind === "timeout" ? "a statement timeout's SQLSTATE" : "any other error"} keeps both coverage rows and still writes freshness`, async () => {
      const db = await boot();
      await db.exec(SEEDED);
      await db.exec(NEW_FILE);
      await db.exec(`UPDATE public.fault SET kind = '${kind}';`);
      await db.exec("SELECT public.refresh_job_board_stats();");
      const r = await rollup(db);
      expect(r.date_coverage.v).toEqual([{ source: "kept", total: 1, dated: 1 }]);
      expect(r.desc_coverage.v).toEqual([{ source: "kept", total: 1, described: 1 }]);
      expect(r.date_coverage.computed_at).toMatch(/^2020-01-01/);
      expect(r.desc_coverage.computed_at).toMatch(/^2020-01-01/);
      expect(r.freshness.computed_at).not.toMatch(/^2020-01-01/);
      expect((r.freshness.v as { boards: number }).boards).toBe(0);
    });
  }

  it("a write that fails costs only its own row", async () => {
    const db = await boot();
    await db.exec(SEEDED);
    await db.exec(FIXTURE);
    await db.exec(NEW_FILE);
    await db.exec("INSERT INTO public.write_fault VALUES ('desc_coverage'); SELECT public.refresh_job_board_stats();");
    const r = await rollup(db);
    expect(r.desc_coverage.v).toEqual([{ source: "kept", total: 1, described: 1 }]);
    expect(r.date_coverage.computed_at).not.toMatch(/^2020-01-01/);
    expect((r.date_coverage.v as Array<{ source: string }>)[0].source).toBe("workday");
  });
});
