// @vitest-environment node
/**
 * NB-35 (board .103 rider): AN ANONYMOUS `audit` CALL READS THE CACHE AND
 * NEVER STARTS A RUN.
 *
 * Once the cached audit was over 20 hours old (it was 206 hours old on
 * 2026-11-15), anyone could POST {"action":"audit"} every 30 minutes and start
 * a full run each time: about 117-165 vendor fetches from our address, an
 * exact count over the corpus, deep OFFSET pages and label demotions. Now only
 * maintenance (the chain key, or the service key) starts a run; anyone else
 * gets the cached result marked stale. The daily cron sends no key, so the
 * pass end's kicks step starts the run with the chain key once the audit is
 * 20 hours old, and status shows when a run last started (audit_run) and
 * finished (audit).
 */
import { describe, expect, it } from "vitest";
import { compile, eqOf, fnSource, FN, ifBlock, stubClient, type Call } from "./helpers/lift-index";

const H = 3_600_000;
async function audit(o: { ageMs: number; maintenance: boolean; force?: boolean }) {
  const claims: string[] = [];
  const client = stubClient((c) => {
    if (c.table === "job_board_meta" && eqOf(c, "k") === "audit") return { data: { v: { accuracyPct: 91 }, updated_at: new Date(Date.now() - o.ageMs).toISOString() }, error: null };
    return { data: null, error: null };
  });
  const out = await compile(ifBlock('action === "audit"'), "")({
    client, req: {}, body: { action: "audit", ...(o.force ? { force: true } : {}) },
    isMaintenance: async () => o.maintenance,
    claimRun: async (_c: unknown, k: string) => { claims.push(k); return false; },
    json: (v: unknown) => v,
  });
  return { out: out as Record<string, unknown>, claims };
}

describe("the audit action", () => {
  it("an anonymous call on a stale cache gets the cache marked stale and starts nothing", async () => {
    const { out, claims } = await audit({ ageMs: 206 * H, maintenance: false });
    expect(out).toEqual({ accuracyPct: 91, cached: true, stale: true });
    expect(claims).toEqual([]);
  });

  it("an anonymous force is no different", async () => {
    const { out, claims } = await audit({ ageMs: 206 * H, maintenance: false, force: true });
    expect([out.stale, claims]).toEqual([true, []]);
  });

  it("an anonymous call on a fresh cache gets the cache", async () => {
    const { out, claims } = await audit({ ageMs: 2 * H, maintenance: false });
    expect([out, claims]).toEqual([{ accuracyPct: 91, cached: true }, []]);
  });

  it("maintenance on a stale cache claims the run (one at a time, as before)", async () => {
    const { out, claims } = await audit({ ageMs: 21 * H, maintenance: true });
    expect(claims).toEqual(["audit_run"]);
    expect(out).toMatchObject({ cached: true, running: true });
  });
});

describe("the pass end starts the daily audit with the chain key", () => {
  async function kicks(auditAgeMs: number | null) {
    const sent: Array<Record<string, unknown>> = [];
    const background: Promise<unknown>[] = [];
    const now = new Date().toISOString();
    const V = { EXPERIENCE_VERSION: 7, COUNTRY_VERSION: 3, SALARY_PARSE_VERSION: 10, POSTED_BACKFILL_VERSION: 2 };
    const rows: Record<string, unknown> = {
      experience_version: { v: { version: 7 } }, country_version: { v: { version: 3 } }, salary_parse_version: { v: { version: 10 } },
      filter_audit: { updated_at: now }, posted_backfill: { v: { at: now } },
      ...(auditAgeMs === null ? {} : { audit: { updated_at: new Date(Date.now() - auditAgeMs).toISOString() } }),
    };
    const client = stubClient((c: Call) => ({ data: rows[String(eqOf(c, "k"))] ?? null, error: null }));
    await compile(fnSource("passEndKicks"), "return passEndKicks(client);")({
      client, ...V, MAINTENANCE_STALL_MS: 10 * 60_000,
      chainKey: async () => "KEY",
      waitUntil: (p: Promise<unknown>) => { background.push(p); },
      fetch: async (_u: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response("{}"); },
      discardBody: () => {}, Deno: { env: { get: () => "https://example.supabase.co" } },
      undatedBacklog: async () => 0, postedBackfillDue: () => false, console: { log: () => {}, warn: () => {} },
    });
    await Promise.all(background);
    return sent;
  }

  it("kicks {action:audit} with the chain key once the audit is 20 hours old, or has never run", async () => {
    expect(await kicks(21 * H)).toEqual([{ action: "audit", chainKey: "KEY" }]);
    expect(await kicks(null)).toEqual([{ action: "audit", chainKey: "KEY" }]);
  });

  it("not before", async () => {
    expect(await kicks(19 * H)).toEqual([]);
  });
});

describe("status says when an audit run last started and finished", () => {
  it("reads audit_run and audit as two stamps, never the audit's history", () => {
    const status = FN().slice(FN().indexOf('if (action === "status") {'), FN().indexOf('if (action === "vendor-health") {'));
    expect(status).toMatch(/\.select\("k, updated_at"\)\.in\("k", \["audit", "audit_run"\]\)/);
    expect(status).toMatch(/audit: await auditRead\.then\(/);
    expect(status).toMatch(/return \{ startedAt: at\.get\("audit_run"\) \?\? null, doneAt: at\.get\("audit"\) \?\? null \};/);
  });
});
