// @vitest-environment node
/**
 * A CHAT USER'S SEARCHES ARE KEPT A MONTH, NOT HALF A YEAR.
 *
 * Owner decision 2026-10-11 (MCP economics 6): the connector's searches from
 * Claude and other non-ChatGPT surfaces are kept 30 days without shown ids,
 * and the Privacy page's draft MCP table says so. job-board .93 does the write
 * side; until this migration the rows lived the demand log's general 180
 * days, so the page would have stated a retention nothing enforced. w4/mcp
 * deferred the prune because it is irreversible and safe only beside .93's
 * write change; the integration carries both.
 *
 * Run in a real Postgres (pglite), the general demand rollup (20260906217000)
 * applied first, under Supabase's default grants, with a pg_cron stand-in, and
 * the new migration applied twice.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./helpers/agent-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const GENERAL = "20260906217000_the_demand_log_is_raw_rows_one_cleanup_away_from_gone.sql";
const PRUNE = "20261011103000_a_chat_users_searches_are_kept_a_month_not_half_a_year.sql";
const CRON_STAND_IN = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
    RETURNING jobid $$;
`;

let db: PGlite;
const ago = (days: number) => `now() - interval '${days} days'`;

async function seed(): Promise<void> {
  await db.exec("DELETE FROM public.job_board_search_events; DELETE FROM public.job_board_search_rollup;");
  const ev = (caller: string | null, days: number, q: string, offset = 0, route = "recency") =>
    `INSERT INTO public.job_board_search_events (search_id, q, route, results, total, offset_n, at, took_ms, caller)
     VALUES (gen_random_uuid(), '${q}', '${route}', 3, 3, ${offset}, ${ago(days)}, 120, ${caller === null ? "NULL" : `'${caller}'`});`;
  await db.exec([
    ev("mcp", 40, "nurse"), ev("mcp", 40, "welder"), ev("mcp", 40, "nurse", 10),
    ev("mcp", 10, "pharmacist"),
    ev("web", 40, "nurse"), ev(null, 40, "nurse"),
  ].join("\n"));
}
const rows = async () => (await db.query<{ caller: string | null; q: string }>("SELECT caller, q FROM public.job_board_search_events ORDER BY caller NULLS FIRST, q")).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;");
  await db.exec(CRON_STAND_IN);
  await db.exec(`
    CREATE TABLE public.job_board_search_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, search_id uuid NOT NULL, q text NOT NULL DEFAULT '',
      location text NOT NULL DEFAULT '', filters jsonb NOT NULL DEFAULT '{}'::jsonb, route text NOT NULL DEFAULT 'unknown',
      rescued text, results integer NOT NULL DEFAULT 0, total integer, offset_n integer NOT NULL DEFAULT 0,
      at timestamptz NOT NULL DEFAULT now(), took_ms integer, caller text, shown jsonb);
    CREATE TABLE public.job_board_search_clicks (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, search_id uuid, at timestamptz NOT NULL DEFAULT now(),
      company_token text, category text, kind text, salary_present boolean, position integer);
  `);
  await db.exec(migration(GENERAL));
  for (let i = 0; i < 2; i++) await db.exec(migration(PRUNE));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("the connector's searches are summarised, then pruned at 30 days", () => {
  it("prunes only mcp rows older than 30 days, after writing their (day, route, caller) summary", async () => {
    await seed();
    const r = (await db.query<{ rows_rolled: number; events_pruned: number }>("SELECT * FROM public.roll_up_and_prune_search_demand_for_caller('mcp', 30)")).rows[0];
    expect(r).toEqual({ rows_rolled: 1, events_pruned: 3 });
    expect(await rows()).toEqual([{ caller: null, q: "nurse" }, { caller: "mcp", q: "pharmacist" }, { caller: "web", q: "nurse" }]);
    const sum = (await db.query<{ caller: string; route: string; searches: number; paged_requests: number; distinct_queries: number }>(
      "SELECT caller, route, searches, paged_requests, distinct_queries FROM public.job_board_search_rollup")).rows;
    expect(sum).toEqual([{ caller: "mcp", route: "recency", searches: 2, paged_requests: 1, distinct_queries: 2 }]);
  });

  it("a re-run rolls and prunes nothing, and the summary is not overwritten by a remainder", async () => {
    const r = (await db.query<{ rows_rolled: number; events_pruned: number }>("SELECT * FROM public.roll_up_and_prune_search_demand_for_caller('mcp', 30)")).rows[0];
    expect(r).toEqual({ rows_rolled: 0, events_pruned: 0 });
    expect((await db.query<{ searches: number }>("SELECT searches FROM public.job_board_search_rollup WHERE caller = 'mcp'")).rows).toEqual([{ searches: 2 }]);
  });

  it("the general run reaching the same day later leaves the connector's summary alone", async () => {
    await db.query("SELECT * FROM public.roll_up_and_prune_search_demand(30)");
    const mcp = (await db.query<{ searches: number; paged_requests: number }>("SELECT searches, paged_requests FROM public.job_board_search_rollup WHERE caller = 'mcp'")).rows;
    expect(mcp).toEqual([{ searches: 2, paged_requests: 1 }]);
  });

  it("any other caller, and a shorter window, prune nothing more (the floor is 30 days)", async () => {
    await seed();
    expect((await db.query("SELECT * FROM public.roll_up_and_prune_search_demand_for_caller('web', 30)")).rows).toEqual([{ rows_rolled: 0, events_pruned: 0 }]);
    expect((await db.query("SELECT * FROM public.roll_up_and_prune_search_demand_for_caller(NULL, 30)")).rows).toEqual([{ rows_rolled: 0, events_pruned: 0 }]);
    await db.query("SELECT * FROM public.roll_up_and_prune_search_demand_for_caller('mcp', 5)");
    expect(await rows()).toEqual([{ caller: null, q: "nurse" }, { caller: "mcp", q: "pharmacist" }, { caller: "web", q: "nurse" }]);
  });
});

describe("who may run it, and when it runs", () => {
  it("the service role only, by name, under Supabase's default grants", async () => {
    const sig = "public.roll_up_and_prune_search_demand_for_caller(text, integer)";
    const can = async (role: string) => (await db.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, sig])).rows[0].ok;
    expect(await can("anon")).toBe(false);
    expect(await can("authenticated")).toBe(false);
    expect(await can("service_role")).toBe(true);
  });

  it("nightly at 03:47 UTC, after the general run, with its own statement_timeout in the command", async () => {
    const job = (await db.query<{ schedule: string; command: string }>("SELECT schedule, command FROM cron.job WHERE jobname = 'search-demand-mcp-retention'")).rows;
    expect(job).toHaveLength(1);
    expect(job[0].schedule).toBe("47 3 * * *");
    expect(job[0].command).toMatch(/^\s*SET statement_timeout = '5min'; SELECT public\.roll_up_and_prune_search_demand_for_caller\('mcp', 30\);\s*$/);
  });
});
