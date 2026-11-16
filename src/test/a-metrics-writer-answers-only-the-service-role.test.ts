// @vitest-environment node
/**
 * A METRICS WRITER ANSWERS ONLY THE SERVICE ROLE (NEW-PRIVACY-RETENTION-01).
 *
 * Live 2026-11-15, with the publishable key: log_scan_metric and
 * log_heartbeat_result answer a GET with 25006 (callable: a POST would
 * insert), while log_parse_failure and log_industry_detection answer 42501,
 * and client_callable_census reports two unlisted client-callable definers.
 * 20260706150000 revoked the signatures this folder knows; production holds
 * others. So a stranger could add 'completed' scan_metrics rows that the
 * public scan count reads, and forge the heartbeat rows the health pages read.
 *
 * 20261112100000 closes every overload it finds in pg_proc by name. This test
 * builds the writers from the migrations that created them, then adds a
 * drifted overload of each of the two open ones the way production has them
 * (unknown to the folder, open under Supabase's default grants), and checks
 * that no overload is left that anon or authenticated can run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./helpers/agent-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const RETENTION = "20261112100000_a_log_keeps_no_address_past_ninety_days.sql";
const CREATORS = [
  "20251216023523_ec1953e6-2409-455e-924f-645f6f7f36b5.sql",
  "20251222170715_d19fa395-cdbc-48ce-a0f5-0d82b0e5ba52.sql",
  "20251223182331_0f66b3f3-9ea2-459b-9657-4f1880078e61.sql",
  "20251223224123_1907cc89-5e4c-45fc-a5f1-835052ab2f80.sql",
  "20251226040656_209705f7-e115-43d1-a41c-d3595106c7dd.sql",
];
const WRITERS = ["log_scan_metric", "log_heartbeat_result", "log_parse_failure", "log_industry_detection"];

let db: PGlite;
type Row = { sig: string; anon: boolean; auth: boolean; svc: boolean };
const grants = async (): Promise<Row[]> => (await db.query<Row>(`
  SELECT p.oid::regprocedure::text AS sig,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
         has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = ANY($1)
  ORDER BY 1`, [WRITERS])).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
  for (const f of CREATORS) await db.exec(migration(f));
  // The drift: overloads production holds and this folder never wrote.
  await db.exec(`
    CREATE FUNCTION public.log_scan_metric(p_scan_type text, p_status text, p_visitor_id text, p_metadata jsonb)
      RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
      AS $$ INSERT INTO public.scan_metrics (scan_type, status, visitor_id, metadata) VALUES (p_scan_type, p_status, p_visitor_id, p_metadata) RETURNING id $$;
    CREATE FUNCTION public.log_heartbeat_result(p_function_name text, p_status text, p_response_time_ms integer, p_test_passed boolean, p_metadata jsonb)
      RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public
      AS $$ INSERT INTO public.heartbeat_results (function_name, status, response_time_ms, test_passed, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING id $$;
  `);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("every overload of the four log writers", () => {
  it("is open to a stranger before the migration (the control: the probe can see an open door)", async () => {
    const open = (await grants()).filter((r) => r.anon || r.auth).map((r) => r.sig);
    expect(open.length).toBe(6);
    expect(open.some((s) => s.startsWith("log_scan_metric(text,text,text,jsonb)"))).toBe(true);
  });

  it("answers neither anon nor authenticated after it, applied twice, and still answers the service role", async () => {
    for (let i = 0; i < 2; i++) await db.exec(migration(RETENTION));
    const rows = await grants();
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.anon || r.auth)).toEqual([]);
    expect(rows.filter((r) => !r.svc)).toEqual([]);
  });

  it("is found by name in the catalogue, never by a signature typed into the migration", async () => {
    const code = migration(RETENTION).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    for (const w of WRITERS) expect(code).not.toMatch(new RegExp(`FUNCTION\\s+public\\.${w}\\s*\\(`));
    expect(code).toMatch(/FROM pg_proc p JOIN pg_namespace n/);
  });
});
