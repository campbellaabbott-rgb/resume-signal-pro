// @vitest-environment node
//
// Node, not jsdom: the handler half bundles job-board with esbuild.
/**
 * A WATCH ON AN EMPLOYER THAT DATES NOTHING CAN FIRE (job-board .91, wave 2
 * email-ops, register L10-02).
 *
 * WHAT WAS WRONG. The saved-search digest could only ask the board for
 * postedAfter, which binds the EMPLOYER's stated date (posted_at > X). That is
 * the right reading of "posted after X" and the wrong one for "new to me since
 * my last email": a posting dated three days ago and first read by us today was
 * outside every later window, and a posting with no stated date could never
 * satisfy posted_at > X at all -- so a watch on an employer whose feed carries
 * no dates could never send its "We found it" mail.
 *
 * WHAT HOLDS NOW, by running the shipped board handler with only its network
 * faked: newSince reaches the posting query as posted_at > X OR first_seen > X,
 * as one canonical instant; it is RPC-blind, so no search or count RPC answers
 * a request that carries it; a malformed value is refused and named, and binds
 * nothing; and both the list and the count echo the window they applied, which
 * is what lets the digest refuse an older bundle that ignored the key.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, eqs, type Answer, type Query } from "./helpers/proxy-db";
import { normalizeFilters, rpcBlindFilters } from "../../supabase/functions/job-board/filters";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SVC = "svc_harness_key";

describe("the filter, as the board normalises it", () => {
  it("is one canonical instant, refused and named when it is not an instant, and blind to every RPC", () => {
    const ok = normalizeFilters({ newSince: "2026-10-06T14:23:00+02:00" }, 50_000);
    expect(ok.applied.newSince).toBe("2026-10-06T12:23:00.000Z");
    expect(rpcBlindFilters(ok.applied)).toEqual(["newSince"]);
    const bad = normalizeFilters({ newSince: "last tuesday" }, 50_000);
    expect(bad.applied.newSince).toBeNull();
    expect(bad.ignored).toContain("newSince");
    expect(normalizeFilters({}, 50_000).applied.newSince).toBeNull();
  });
});

describe("the handler, run with only its network faked", () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SVC };
  let handler: EdgeHandler;
  let db: ProxyDb;
  beforeAll(async () => {
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.EdgeRuntime = { waitUntil: () => {} };
    globalThis.fetch = (async () => new Response("no network in tests", { status: 503 })) as typeof fetch;
    handler = await loadEdgeHandler("job-board", {
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__jbDb; }",
    });
  });
  beforeEach(() => {
    db = new ProxyDb();
    db.answer = (q: Query): Answer | undefined => {
      if (q.table === "job_board_meta" && eqs(q, "k", "refresh_head")) {
        return { data: { v: { companiesCount: 10, total: 1000, coverage: { open: 1000 } }, updated_at: new Date().toISOString() }, error: null };
      }
      if (q.table === "job_board_postings" && q.calls.some(([m]) => m === "or")) {
        return { data: [], error: null, count: 2 };
      }
      return undefined;
    };
    g.__jbDb = db;
  });
  const post = (body: Record<string, unknown>) =>
    handler(new Request("https://h.supabase.co/functions/v1/job-board", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", authorization: `Bearer ${SVC}` },
      body: JSON.stringify(body),
    }));
  const windowOrs = () => db.on("job_board_postings", "or").flatMap((q) =>
    q.calls.filter(([m, a]) => m === "or" && String(a[0]).includes("first_seen")).map(([, a]) => String(a[0])));
  const SEARCH_RPCS = ["search_jobs", "search_jobs_semantic", "count_jobs_capped"];

  it("a list with newSince binds posted_at OR first_seen after the instant, and says which window it applied", async () => {
    const res = await post({ action: "list", q: "nurse", newSince: "2026-10-06T14:23:00Z", groupSimilar: false, limit: 60 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect([...new Set(windowOrs())]).toEqual(['posted_at.gt."2026-10-06T14:23:00.000Z",first_seen.gt."2026-10-06T14:23:00.000Z"']);
    expect(body.newSince).toBe("2026-10-06T14:23:00.000Z");
    expect(db.queries.filter((q) => q.rpc && SEARCH_RPCS.includes(q.rpc)).map((q) => q.rpc), "an RPC that cannot bind the window answered").toEqual([]);
  });

  it("the count binds the same window and echoes it", async () => {
    const body = await (await post({ action: "list", q: "nurse", newSince: "2026-10-06T14:23:00Z", countOnly: true })).json();
    expect([...new Set(windowOrs())]).toEqual(['posted_at.gt."2026-10-06T14:23:00.000Z",first_seen.gt."2026-10-06T14:23:00.000Z"']);
    expect(body.total).toBe(2);
    expect(body.newSince).toBe("2026-10-06T14:23:00.000Z");
    expect(db.queries.filter((q) => q.rpc && SEARCH_RPCS.includes(q.rpc))).toEqual([]);
  });

  it("a malformed window binds nothing, is named back, and is not echoed", async () => {
    const body = await (await post({ action: "list", q: "nurse", newSince: "2026-10-06 12:00 GMT-12", countOnly: true })).json();
    expect(windowOrs()).toEqual([]);
    expect(body.ignoredFilters).toContain("newSince");
    expect(body).not.toHaveProperty("newSince");
  });
});
