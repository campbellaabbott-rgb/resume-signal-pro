// @vitest-environment node
/**
 * A SEARCH SAVED WITH THE RETIRED AGENT FILTER READS THE WHOLE BOARD (audit-rest
 * S13-118; job-board .101, agent-mcp and public-api 2026-11-03.1, migration
 * 20261103220000).
 *
 * WHAT WAS WRONG. A search saved while the board offered its agent-ready filter
 * stored params.sendableOnly. The page dropped the filter, but job-board kept
 * honouring the flag, so the digest and the "+N new" badge counted about 5% of
 * what the link they carried opened, with nothing on screen to show why.
 *
 * WHAT HOLDS NOW. job-board narrows on the flag for no caller and names it in
 * ignoredFilters. The stored key is gone: this file runs the migration in
 * pglite, twice, against rows that carry the key and rows that do not. The two
 * doors that sold agent-ready as a parameter of their own, /v1/jobs and the
 * connector's search, keep their meaning by sending the vendor list instead.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ANON, bootBoardHandler, type BoardHandler } from "./helpers/board-handler";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { migration } from "./helpers/agent-db";
import { argOf, type Query } from "./helpers/proxy-db";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const browser = { authorization: `Bearer ${ANON}`, apikey: ANON, origin: "https://resumebooster.work" };

describe("job-board", () => {
  let board: BoardHandler;
  beforeAll(async () => { board = await bootBoardHandler(); });
  beforeEach(() => { board.reset(); });

  const sourcesAsked = () => [
    ...board.db.queries.filter((q: Query) => q.rpc).map((q: Query) => (q.calls[0][1][0] as Record<string, unknown>).p_sources).filter((v) => v !== undefined && v !== null),
    ...board.db.on("job_board_postings", "in").filter((q: Query) => q.calls.some(([m, a]) => m === "in" && a[0] === "source")).map((q: Query) => argOf(q, "in", 1)),
  ];

  for (const [name, extra] of [["a search with words", { q: "nurse" }], ["a browse with no words", {}], ["a newest-sorted search", { q: "nurse", sort: "newest" }]] as Array<[string, Record<string, unknown>]>) {
    it(`${name} carrying the flag binds no source and names the flag`, async () => {
      const r = await board.post({ action: "list", sendableOnly: true, ...extra }, browser);
      expect(sourcesAsked(), "the flag still narrowed a query").toEqual([]);
      expect(r.ignoredFilters).toContain("sendableOnly");
    });
  }

  it("the logged search does not record a filter that was not applied", async () => {
    await board.post({ action: "list", q: "nurse", sendableOnly: true }, browser);
    const events = board.db.on("job_board_search_events", "insert").map((q: Query) => argOf(q, "insert") as Record<string, unknown>);
    expect(events).toHaveLength(1);
    expect(events[0].filters ?? {}).not.toHaveProperty("sendableOnly");
  });

  it("a vendor a caller asked for still binds", async () => {
    await board.post({ action: "list", q: "nurse", vendor: "greenhouse" }, browser);
    expect(sourcesAsked().length).toBeGreaterThan(0);
    expect(sourcesAsked().flat()).toContain("greenhouse");
  });

  it("the same request without the flag answers the same, and names nothing", async () => {
    const r = await board.post({ action: "list", q: "nurse" }, browser);
    expect(r.ignoredFilters ?? []).not.toContain("sendableOnly");
    expect(sourcesAsked()).toEqual([]);
  });
});

describe("the migration, in Postgres", () => {
  const STRIP = "20261103220000_a_stored_search_no_longer_asks_for_the_retired_agent_ready_filter.sql";
  let db: PGlite;
  const USER = "00000000-0000-4000-8000-000000000001";
  type Row = { name: string; params: Record<string, unknown> | unknown[]; last_seen_at: string; created_at: string };
  const rows = async () => (await db.query<Row>("SELECT name, params, last_seen_at, created_at FROM public.user_job_searches ORDER BY name")).rows;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE public.user_job_searches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        name text NOT NULL,
        params jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_seen_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z',
        created_at timestamptz NOT NULL DEFAULT '2026-01-02T00:00:00Z',
        digest_attempted_at timestamptz,
        UNIQUE (user_id, name)
      );
    `);
    const add = (name: string, params: unknown) => db.query("INSERT INTO public.user_job_searches (user_id, name, params) VALUES ($1, $2, $3::jsonb)", [USER, name, JSON.stringify(params)]);
    await add("nurse · remote · agent-ready", { q: "nurse", remote: true, sendableOnly: true });
    await add("off", { q: "cook", sendableOnly: false });
    await add("clean", { q: "welder", workMode: "onsite" });
    await add("nested", { q: "pilot", note: { sendableOnly: true } });
    await add("list", ["sendableOnly", "q"]);
    await add("empty", {});
  });

  it("removes the key from every row that has it, whatever its value, and nothing else", async () => {
    await db.exec(migration(STRIP));
    const by = Object.fromEntries((await rows()).map((r) => [r.name, r]));
    expect(by["nurse · remote · agent-ready"].params, "the name is the owner's and stays").toEqual({ q: "nurse", remote: true });
    expect(by.off.params).toEqual({ q: "cook" });
    expect(by.clean.params).toEqual({ q: "welder", workMode: "onsite" });
    expect(by.nested.params, "only the top-level key").toEqual({ q: "pilot", note: { sendableOnly: true } });
    expect(by.list.params, "an array element of that spelling is not the key").toEqual(["sendableOnly", "q"]);
    expect(by.empty.params).toEqual({});
  });

  it("leaves when a search was last seen alone, so nothing reads as new", async () => {
    for (const r of await rows()) {
      expect(new Date(r.last_seen_at).toISOString(), r.name).toBe("2026-01-01T00:00:00.000Z");
      expect(new Date(r.created_at).toISOString(), r.name).toBe("2026-01-02T00:00:00.000Z");
    }
  });

  it("is safe to run again, and changes nothing the second time", async () => {
    const before = await rows();
    await db.exec(migration(STRIP));
    expect(await rows()).toEqual(before);
  });

  it("verifies itself: a row it could not clean stops the migration", async () => {
    const twin = new PGlite();
    await twin.exec(`
      CREATE TABLE public.user_job_searches (id bigint PRIMARY KEY, params jsonb NOT NULL);
      INSERT INTO public.user_job_searches VALUES (1, '{"sendableOnly": true}');
      CREATE FUNCTION public.keep_it() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.params := OLD.params; RETURN NEW; END $$;
      CREATE TRIGGER keep_it BEFORE UPDATE ON public.user_job_searches FOR EACH ROW EXECUTE FUNCTION public.keep_it();
    `);
    await expect(twin.exec(migration(STRIP))).rejects.toThrow(/still carry the retired filter/);
  });

  it("passes where the table is not there", async () => {
    await expect(new PGlite().exec(migration(STRIP))).resolves.toBeDefined();
  });
});

describe("the connector's search", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);
  beforeEach(() => { mcp.boardCalls.length = 0; });

  it("agentReadyOnly reaches the board as the vendor list, never as the flag", async () => {
    const r = await mcp.call({ query: "nurse", agentReadyOnly: true });
    expect(r.isError, r.text).toBe(false);
    expect(mcp.boardCalls[0]).not.toHaveProperty("sendableOnly");
    expect(mcp.boardCalls[0].vendor).toBe(SENDABLE_VENDORS.join(","));
  });

  it("beside a vendor it keeps only what both allow", async () => {
    await mcp.call({ query: "nurse", agentReadyOnly: true, vendor: `greenhouse,${SENDABLE_VENDORS[0]}` });
    expect(mcp.boardCalls[0].vendor).toBe(SENDABLE_VENDORS[0]);
  });

  it("beside a vendor it excludes it says so, and spends no board call", async () => {
    const r = await mcp.call({ query: "nurse", agentReadyOnly: true, vendor: "greenhouse" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no posting can match");
    expect(mcp.boardCalls).toEqual([]);
  });

  it("without it, nothing changes", async () => {
    await mcp.call({ query: "nurse", vendor: "greenhouse" });
    expect(mcp.boardCalls[0].vendor).toBe("greenhouse");
    await mcp.call({ query: "nurse" });
    expect(mcp.boardCalls[1]).not.toHaveProperty("vendor");
  });
});

describe("/v1/jobs?engine=ranked", () => {
  let handler: EdgeHandler;
  let boardBodies: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
    handler = await loadEdgeHandler("public-api", {
      "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__v1FlagDb; }",
    });
  }, 120_000);

  beforeEach(() => {
    boardBodies = [];
    const g = globalThis as Record<string, unknown>;
    g.fetch = async (url: string, init: { body?: string } = {}) => {
      if (String(url).endsWith("/functions/v1/job-board")) {
        boardBodies.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
        return new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    const chain: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
        return () => chain;
      },
    });
    g.__v1FlagDb = {
      rpc: (name: string) => {
        const r = Promise.resolve(name === "api_key_check"
          ? { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "builder", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null }
          : { data: null, error: null });
        return Object.assign(r, { maybeSingle: () => r });
      },
      from: () => chain,
    };
  });

  const get = async (qs: string) => {
    const res = await handler(new Request(`https://harness.supabase.co/functions/v1/public-api/v1/jobs?engine=ranked&q=nurse${qs}`, { headers: { authorization: "Bearer rb_live_harness_key_0123456789" } }));
    return { status: res.status, body: JSON.parse(await res.text()) as Record<string, unknown> };
  };

  it("agent_ready_only reaches the board as the vendor list, never as the flag", async () => {
    const { status } = await get("&agent_ready_only=true");
    expect(status).toBe(200);
    expect(boardBodies).toHaveLength(1);
    expect(boardBodies[0]).not.toHaveProperty("sendableOnly");
    expect(boardBodies[0].vendor).toBe(SENDABLE_VENDORS.join(","));
  });

  it("beside a source it keeps only what both allow", async () => {
    await get(`&agent_ready_only=true&source=greenhouse,${SENDABLE_VENDORS[0]}`);
    expect(boardBodies[0].vendor).toBe(SENDABLE_VENDORS[0]);
  });

  it("beside a source it excludes it answers nothing to find, without asking the board for the whole board", async () => {
    const { status, body } = await get("&agent_ready_only=true&source=greenhouse");
    expect(status).toBe(200);
    expect(boardBodies).toEqual([]);
    expect(body.jobs ?? body.data).toEqual([]);
  });

  it("without it, a source goes as it always did", async () => {
    await get("&source=greenhouse");
    expect(boardBodies[0].vendor).toBe("greenhouse");
  });
});
