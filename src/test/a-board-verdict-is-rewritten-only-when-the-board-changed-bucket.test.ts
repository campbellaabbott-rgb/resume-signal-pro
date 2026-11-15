// @vitest-environment node
/**
 * A BOARD VERDICT IS REWRITTEN ONLY WHEN THE BOARD CHANGED BUCKET
 * (cost audit 2026-11-08, "Closure population"; migration 20261109140000).
 *
 * refresh_closure_population() upserted every board observed in the last
 * seven days on every pass, unchanged or not, and deleted the boards that left
 * the window by an as_of older than the pass. The new function writes a row
 * only where (bucket, lap_w0) moved and deletes leavers by name, in the same
 * statement.
 *
 * Two pglite databases get the same fixture: one runs the 20260909217800
 * function, the other the 20261109140000 one. Over two passes, with boards
 * changing bucket, leaving and joining the window and the closure log
 * growing, the PUBLISHED NUMBERS (the cached closure_population payload) and
 * the verdict table (company_token, bucket, lap_w0) are identical -- and only
 * the new function leaves unchanged rows untouched (same xmin), and does not
 * even lock them: ON CONFLICT DO UPDATE locks the conflicting row before its
 * WHERE is read, which stamps xmax and dirties the page with no new version,
 * so the pass leaves unchanged boards out of the INSERT's source instead.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const OLD = readFileSync(resolve(MIG, "20260909217800_the_bucket_we_computed_and_threw_away.sql"), "utf8");
const NEW = readFileSync(resolve(MIG, "20261109140000_a_board_verdict_is_rewritten_only_when_the_board_changed_bucket.sql"), "utf8");

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL, state text, stored_count integer,
    PRIMARY KEY (company_token, observed_on));
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text NOT NULL, company_token text NOT NULL,
    closed_at timestamptz NOT NULL DEFAULT now(), superseded boolean NOT NULL DEFAULT false, suspect boolean,
    absence_basis text);
  CREATE TABLE public.job_board_stats_rollup (k text PRIMARY KEY, v jsonb NOT NULL, computed_at timestamptz NOT NULL DEFAULT now());
`;

// Every bucket and every lap-map shape the classification reads: a vendor-
// prefixed key, a bare legacy key, a lap with no completed pass, a boundary
// that is not an instant, a board with two observations, one outside the window.
const FIXTURE = `
  INSERT INTO public.job_board_meta (k, v) VALUES ('deep_cursor', jsonb_build_object('__laps', jsonb_build_object(
    'greenhouse:proven', jsonb_build_object('w', '3', 'w0', '2026-09-09T15:09:37Z'),
    'workday:pending', jsonb_build_object('w0', '2026-10-01T00:00:00Z'),
    'legacybare', jsonb_build_object('w', '1', 'w0', '2026-09-20T10:00:00Z'),
    'lever:badw0', jsonb_build_object('w', '2', 'w0', 'not an instant'))));
  INSERT INTO public.job_board_board_state (company_token, observed_on, state, stored_count) VALUES
    ('okco', current_date, 'ok', 10),
    ('darkco', current_date - 1, 'dark', 0),
    ('emptyco', current_date - 2, 'empty', 0),
    ('errco', current_date, 'error', 4),
    ('nullco', current_date, NULL, 3),
    ('proven', current_date, 'truncated', 900),
    ('pending', current_date, 'truncated', 700),
    ('unlapped', current_date, 'truncated', 650),
    ('legacybare', current_date, 'truncated', 500),
    ('badw0', current_date, 'truncated', 400),
    ('twice', current_date - 3, 'ok', 5),
    ('twice', current_date, 'truncated', 6),
    ('gone', current_date - 12, 'ok', 8);
  INSERT INTO public.job_board_closures (posting_id, company_token, absence_basis)
    SELECT 'p' || i, 'okco', (ARRAY['full_read', 'lap', 'lap_backfill', NULL])[1 + i % 4]
    FROM generate_series(1, 403) i;
`;

// The next pass: okco is windowed now and lapped; emptyco's only observation
// falls out of the window; a new board joins; pending completes its lap; the
// log grows.
const NEXT = `
  INSERT INTO public.job_board_board_state (company_token, observed_on, state, stored_count) VALUES
    ('okco', current_date + 1, 'truncated', 1200),
    ('newco', current_date, 'ok', 2);
  UPDATE public.job_board_board_state SET observed_on = current_date - 9 WHERE company_token = 'emptyco';
  UPDATE public.job_board_meta SET v = jsonb_set(jsonb_set(v, '{__laps,greenhouse:okco}', '{"w":"1","w0":"2026-11-01T00:00:00Z"}'),
                                                  '{__laps,workday:pending}', '{"w":"1","w0":"2026-10-01T00:00:00Z"}')
   WHERE k = 'deep_cursor';
  INSERT INTO public.job_board_closures (posting_id, company_token, absence_basis)
    SELECT 'q' || i, 'newco', (ARRAY['full_read', 'lap'])[1 + i % 2] FROM generate_series(1, 57) i;
`;

type Row = { company_token: string; bucket: string; lap_w0: string | null };
type Stamped = Row & { xmin: string; xmax: string; as_of: string };

async function boot(withNew: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(FIXTURE);
  await db.exec(OLD); // the table, the function and its own seed pass
  if (withNew) await db.exec(NEW);
  return db;
}
const refresh = (db: PGlite) => db.query("SELECT public.refresh_closure_population()");
const payload = async (db: PGlite) =>
  (await db.query<{ v: Record<string, unknown> }>("SELECT v FROM public.job_board_stats_rollup WHERE k = 'closure_population'")).rows[0]?.v;
const verdicts = async (db: PGlite) =>
  (await db.query<Row>("SELECT company_token, bucket, lap_w0::text AS lap_w0 FROM public.job_board_board_observability ORDER BY company_token")).rows;
const stamped = async (db: PGlite) =>
  new Map((await db.query<Stamped>(
    "SELECT company_token, bucket, lap_w0::text AS lap_w0, xmin::text AS xmin, xmax::text AS xmax, as_of::text AS as_of FROM public.job_board_board_observability",
  )).rows.map((r) => [r.company_token, r]));

let was: PGlite;
let now: PGlite;
const first: { was?: Record<string, unknown>; now?: Record<string, unknown>; wasRows?: Row[]; nowRows?: Row[] } = {};
let beforeWas: Map<string, Stamped>;
let beforeNow: Map<string, Stamped>;
let afterWas: Map<string, Stamped>;
let afterNow: Map<string, Stamped>;

beforeAll(async () => {
  [was, now] = await Promise.all([boot(false), boot(true)]);
  await refresh(was);
  await refresh(now);
  first.was = await payload(was);
  first.now = await payload(now);
  first.wasRows = await verdicts(was);
  first.nowRows = await verdicts(now);
  beforeWas = await stamped(was);
  beforeNow = await stamped(now);
  await was.exec(NEXT);
  await now.exec(NEXT);
  await refresh(was);
  await refresh(now);
  afterWas = await stamped(was);
  afterNow = await stamped(now);
});
afterAll(async () => {
  for (const db of [was, now]) { try { await db.close(); } catch { /* best effort */ } }
});

describe("the published numbers do not move", () => {
  it("the first pass publishes the same closure population and the same verdicts", () => {
    expect(first.now).toEqual(first.was);
    expect(first.nowRows).toEqual(first.wasRows);
    // The fixture reaches every bucket, so an identical answer is not a vacuous one.
    const buckets = new Set(first.nowRows!.map((r) => r.bucket));
    expect([...buckets].sort()).toEqual(["full_read", "lap_pending", "lap_proven", "unobserved", "unprovable"]);
    expect(first.now).toMatchObject({ closures_full_read: 100, closures_lap: 101, closures_lap_backfill: 101, closures_pre_basis: 101 });
  });

  it("after boards change bucket, leave and join the window, the second pass still publishes the same", async () => {
    expect(await payload(now)).toEqual(await payload(was));
    expect(await verdicts(now)).toEqual(await verdicts(was));
    const rows = new Map((await verdicts(now)).map((r) => [r.company_token, r]));
    expect(rows.get("okco")?.bucket, "okco moved to a proven lap").toBe("lap_proven");
    expect(rows.get("pending")?.bucket).toBe("lap_proven");
    expect(rows.has("emptyco"), "a board that left the seven-day window leaves the table").toBe(false);
    expect(rows.has("gone")).toBe(false);
    expect(rows.get("newco")?.bucket).toBe("full_read");
  });
});

describe("only the boards whose verdict moved are written", () => {
  const unchanged = ["darkco", "errco", "nullco", "proven", "unlapped", "legacybare", "badw0", "twice"];

  it("the new function leaves every unchanged row as it was: the same row version and the same as_of", () => {
    for (const t of unchanged) {
      expect(afterNow.get(t)?.xmin, `${t} was rewritten`).toBe(beforeNow.get(t)?.xmin);
      expect(afterNow.get(t)?.as_of, `${t} was re-stamped`).toBe(beforeNow.get(t)?.as_of);
    }
  });

  it("an unchanged row is not even locked by the pass: no transaction stamps its xmax", () => {
    for (const t of unchanged) {
      expect(afterNow.get(t)?.xmax, `${t} was locked by the upsert though its verdict held`).toBe("0");
    }
  });

  it("and writes the rows that moved, stamped with the pass that moved them", () => {
    for (const t of ["okco", "pending"]) {
      expect(afterNow.get(t)?.xmin, `${t} changed bucket but was not written`).not.toBe(beforeNow.get(t)?.xmin);
      expect(afterNow.get(t)!.as_of > beforeNow.get(t)!.as_of, `${t} kept an old as_of`).toBe(true);
    }
    expect(afterNow.get("newco")).toBeDefined();
  });

  it("teeth: the function it replaces rewrote every one of those unchanged rows", () => {
    for (const t of unchanged) {
      expect(afterWas.get(t)?.xmin, `${t}: the old function should rewrite it`).not.toBe(beforeWas.get(t)?.xmin);
    }
  });
});

describe("the migration keeps what the function was", () => {
  it("re-applies cleanly, keeps the ten-minute header and stays service-role only", async () => {
    await now.exec(NEW);
    const { rows } = await now.query<{ cfg: string[]; anon: boolean; auth: boolean; svc: boolean }>(`
      SELECT p.proconfig AS cfg,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
        FROM pg_proc p WHERE p.oid = 'public.refresh_closure_population()'::regprocedure`);
    expect(rows[0].cfg).toContain("statement_timeout=10min");
    expect(rows[0]).toMatchObject({ anon: false, auth: false, svc: true });
  });
});
