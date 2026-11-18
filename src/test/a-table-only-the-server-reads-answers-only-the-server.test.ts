// @vitest-environment node
/**
 * A TABLE ONLY THE SERVER READS ANSWERS ONLY THE SERVER (NB-13).
 *
 * Supabase grants anon and authenticated ALL on every new table in public, so
 * fifty-two service-only tables (API keys, affiliate sessions, the purchase
 * and subscription records, the search and scan logs) were private only
 * because row-level security answered an empty list. 20261112102000 revokes
 * them by name and adds client_table_grants(), one anon call that lists every
 * table a client role holds any privilege on.
 *
 * Run in pglite from Supabase's default grants, the migration applied twice.
 * The static half keeps the list honest: no page reads a listed table.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { migration } from "./helpers/agent-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const FILE = "20261112102000_a_table_only_the_server_reads_answers_only_the_server.sql";
const code = migration(FILE).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
/** The list the migration revokes, read from its first loop. */
const CLOSED = (() => {
  const m = /FOREACH v_t IN ARRAY ARRAY\[([\s\S]*?)\] LOOP/.exec(code);
  return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [];
})();
const KEPT = ["used_stripe_sessions", "purchased_content", "product_deliveries", "user_scans", "user_job_searches", "shortlist_roles"];

let db: PGlite;
const priv = async (role: string, table: string) => (await db.query<{ ok: boolean }>(
  "SELECT has_any_column_privilege($1, $2::regclass, 'SELECT, INSERT, UPDATE') OR has_table_privilege($1, $2::regclass, 'DELETE, TRUNCATE') AS ok",
  [role, `public.${table}`])).rows[0].ok;
// Most listed tables exist here; a few are left out, as a database that lacks one would.
const PRESENT = CLOSED.filter((t) => !["agent_worker_heartbeat", "scan_slots", "job_board_company_flow"].includes(t));

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;");
  for (const t of [...PRESENT, ...KEPT]) await db.exec(`CREATE TABLE public.${t} (id bigint PRIMARY KEY, v text); ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("the service-only tables", () => {
  it("lists fifty-two distinct tables, none of them one the verifier reads as anon or the account's own", () => {
    expect(CLOSED).toHaveLength(52);
    expect(new Set(CLOSED).size).toBe(52);
    for (const t of KEPT) expect(CLOSED).not.toContain(t);
  });

  it("are open to both client roles under the default grants (the control)", async () => {
    expect(await priv("anon", "api_keys")).toBe(true);
    expect(await priv("authenticated", "affiliate_sessions")).toBe(true);
  });

  it("answer neither anon nor authenticated after the migration, applied twice, and still answer the service role", async () => {
    for (let i = 0; i < 2; i++) await db.exec(migration(FILE));
    const open: string[] = [];
    for (const t of PRESENT) {
      if (await priv("anon", t)) open.push(`anon:${t}`);
      if (await priv("authenticated", t)) open.push(`authenticated:${t}`);
      if (!(await priv("service_role", t))) open.push(`service_role lost ${t}`);
    }
    expect(open).toEqual([]);
  });

  it("leave the tables it does not list exactly as they were", async () => {
    for (const t of KEPT) {
      expect(await priv("anon", t), t).toBe(true);
      expect(await priv("authenticated", t), t).toBe(true);
    }
  });
});

describe("client_table_grants(), read as anon", () => {
  it("names every table a client role can touch, and none of the closed ones", async () => {
    await db.exec("SET ROLE anon;");
    const r = (await db.query<{ g: { anon: string[]; authenticated: string[] } }>("SELECT public.client_table_grants() AS g")).rows[0].g;
    await db.exec("RESET ROLE;");
    expect([...r.anon].sort()).toEqual([...KEPT].sort());
    expect([...r.authenticated].sort()).toEqual([...KEPT].sort());
  });

  it("runs as its caller and reads only the catalogue", async () => {
    const d = (await db.query<{ d: boolean; v: string }>("SELECT prosecdef AS d, provolatile AS v FROM pg_proc WHERE oid = 'public.client_table_grants()'::regprocedure")).rows[0];
    expect(d).toEqual({ d: false, v: "s" });
  });
});

describe("no page or worker reads a closed table", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (n === "node_modules" || n === "test" || n === "integrations") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(n) && !/\.test\./.test(n)) files.push(p);
    }
  };
  const ROOT = resolve(__dirname, "../..");
  walk(join(ROOT, "src"));
  try { walk(join(ROOT, "worker", "src")); } catch { /* no worker sources in this checkout */ }

  it("finds no .from() of a closed table outside the tests", () => {
    const hits: string[] = [];
    const re = new RegExp(`\\.from\\(\\s*["'\`](${CLOSED.join("|")})["'\`]\\s*\\)`);
    for (const f of files) if (re.test(readFileSync(f, "utf8"))) hits.push(f.slice(ROOT.length + 1));
    expect(files.length).toBeGreaterThan(100);
    expect(hits).toEqual([]);
  });
});
