// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness).
/**
 * A PASS BUYER WAS TOLD "NO PURCHASES", AND THE EXPORT LEFT OUT THE AGENT
 * (platform sweep L6-12, L3-14).
 *
 * L6-12. get-account-data listed purchased_content rows by address only; an
 * Agent Pass is an agent_passes row by account, which it never read.
 *
 * L3-14. "Download all my data" read user_job_searches, agent_mandates,
 * agent_queue and one column of user_profiles. It left out what the agent
 * submitted to employers in the member's name, its learned answers, pending
 * questions and saved searches, the account's passes, the Shortlist
 * workspace and the CV files in storage, and its scans and tracker rows were
 * the page's first 50 and 100.
 *
 * Run: the shipped handler with the database faked; the export collector
 * against a fake client; and the collector's table list against every owner
 * read policy the migrations create, so a new owner table cannot be left out.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { collectAccountExport, EXPORT_PAGE, OWNER_TABLES, type ExportClient } from "@/lib/account-export";

const USER_ID = "00000000-0000-4000-8000-0000000a55e5";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const PASSWORD_JWT = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }] })}.sig`;

describe("the get-account-data handler lists the account's passes", () => {
  let handler: EdgeHandler;
  let reads: Array<[string, string, unknown]>;
  const hour = 3_600_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  const passRows = () => [
    { purchased_at: iso(-2 * hour), shelf_expires_at: iso(30 * 24 * hour), activated_at: iso(-hour), expires_at: iso(5 * hour), closed_at: null },
    { purchased_at: iso(-48 * hour), shelf_expires_at: iso(28 * 24 * hour), activated_at: null, expires_at: null, closed_at: null },
    { purchased_at: iso(-90 * hour), shelf_expires_at: iso(26 * 24 * hour), activated_at: iso(-89 * hour), expires_at: iso(-83 * hour), closed_at: null },
  ];

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = {
      SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_ANON_KEY: "anon",
    };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.fetch = async (url: string) => String(url).endsWith("/auth/v1/settings")
      ? new Response(JSON.stringify({ mailer_autoconfirm: true }), { status: 200 })
      : new Response("{}", { status: 404 });
    handler = await loadEdgeHandler("get-account-data", {
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__accountClient;",
    });
  }, 180_000);

  beforeEach(() => {
    reads = [];
    (globalThis as Record<string, unknown>).__accountClient = {
      auth: { getUser: async (jwt: string) => jwt === PASSWORD_JWT
        ? { data: { user: { id: USER_ID, email: "buyer@example.com", identities: [] } }, error: null }
        : { data: { user: null }, error: { message: "bad jwt" } } },
      rpc: async () => ({ data: 0, error: null }),
      from: (table: string) => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (c: string, v: unknown) => { reads.push([table, c, v]); return q; },
          is: () => q,
          order: () => q,
          maybeSingle: async () => ({ data: null, error: null }),
          limit: async () => ({ data: table === "agent_passes" ? passRows() : [], error: null }),
        };
        return q;
      },
    };
  });

  it("answers a password session (no mailbox proof needed: the rows are the account's) with each pass and its state", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/get-account-data", {
      method: "POST", headers: { authorization: `Bearer ${PASSWORD_JWT}` },
    }));
    const body = await res.json() as { passes?: Array<{ state: string; date: string }>; purchases: unknown[]; mailboxProven: boolean };
    expect(res.status).toBe(200);
    expect(body.mailboxProven).toBe(false);
    expect(body.purchases).toEqual([]);
    expect(body.passes?.map((p) => p.state)).toEqual(["live", "unactivated", "closed"]);
    expect(reads).toContainEqual(["agent_passes", "user_id", USER_ID]);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "get-account-data", "2026-10-09"), String(res.headers.get("x-fn-build"))).toBe(true);
  });
});

describe("the export collects every record the account can read about itself", () => {
  type Row = Record<string, unknown>;
  const fakeClient = (tables: Record<string, Row[]>, files: Row[]) => {
    const calls: Array<{ table: string; key: string; uid: string; from: number; to: number }> = [];
    const client: ExportClient = {
      from: (table: string) => {
        let key = "", uid = "";
        const q = {
          select: () => q,
          eq: (k: string, v: string) => { key = k; uid = v; return q; },
          range: async (from: number, to: number) => {
            calls.push({ table, key, uid, from, to });
            const rows = (tables[table] ?? []).filter((r) => r[key] === uid);
            return { data: rows.slice(from, to + 1), error: null };
          },
        };
        return q;
      },
      storage: { from: (bucket: string) => ({
        list: async (path: string) => ({ data: bucket === "resumes" && path === USER_ID ? files : [], error: null }),
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}`, error: null })), error: null }),
      }) },
    };
    return { client, calls };
  };

  it("includes the agent's submissions, answers, questions, searches and passes, all rows past one page, and the CV files", async () => {
    const mine = (n: number, extra: Row = {}) => Array.from({ length: n }, (_, i) => ({ id: i, user_id: USER_ID, ...extra }));
    const { client, calls } = fakeClient({
      agent_submissions: mine(2, { employer: "Acme" }),
      agent_learned_answers: mine(1),
      agent_pending_questions: mine(1),
      agent_searches: mine(1),
      agent_passes: mine(1),
      user_applications: [...mine(EXPORT_PAGE + 5), { id: "x", user_id: "someone-else" }],
      shortlist_roles: [{ id: 1, owner_id: USER_ID }],
    }, [{ name: "cv-2026.pdf", created_at: "2026-10-01T00:00:00Z", metadata: { size: 1234 } }]);
    const out = await collectAccountExport(client, USER_ID);
    expect(out.agentSubmissions).toHaveLength(2);
    expect(out.agentLearnedAnswers).toHaveLength(1);
    expect(out.agentPendingQuestions).toHaveLength(1);
    expect(out.agentSearches).toHaveLength(1);
    expect(out.agentPasses).toHaveLength(1);
    expect(out.shortlistRoles).toHaveLength(1);
    expect(out.applications).toHaveLength(EXPORT_PAGE + 5);
    expect(out.cvFiles).toEqual([expect.objectContaining({ name: "cv-2026.pdf", createdAt: "2026-10-01T00:00:00Z", updatedAt: null, bytes: 1234 })]);
    // Every read is the caller's own rows, by the column its policy names.
    for (const c of calls) expect(c.uid).toBe(USER_ID);
    expect(calls.find((c) => c.table === "shortlist_roles")?.key).toBe("owner_id");
  });

  it("names a table it could not read instead of exporting it as empty", async () => {
    const client: ExportClient = {
      from: () => {
        const q = { select: () => q, eq: () => q, range: async () => ({ data: null, error: { message: "permission denied" } }) };
        return q;
      },
      storage: { from: () => ({ list: async () => ({ data: null, error: { message: "denied" } }), createSignedUrls: async () => ({ data: null, error: { message: "denied" } }) }) },
    };
    const out = await collectAccountExport(client, USER_ID);
    expect(out.agentSubmissions).toEqual({ error: "permission denied" });
    expect(out.cvFiles).toEqual({ error: "denied" });
  });

  it("reads every table the migrations give its owner a read policy on", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const owned = new Map<string, string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = readFileSync(resolve(dir, f), "utf8");
      for (const m of sql.matchAll(/create\s+policy\s+(?:"[^"]+"|\S+)\s+on\s+(?:public\.)?"?([a-z_]+)"?([\s\S]*?);/gi)) {
        const [, table, body] = m;
        const cmd = /\bfor\s+(select|all|insert|update|delete)\b/i.exec(body)?.[1]?.toLowerCase() ?? "all";
        const col = /auth\.uid\(\)\s*\)?\s*=\s*(?:\w+\.)?(user_id|owner_id)\b|\b(user_id|owner_id)\s*=\s*\(?\s*(?:select\s+)?auth\.uid\(\)/i.exec(body);
        if (col && (cmd === "select" || cmd === "all")) owned.set(table, (col[1] ?? col[2]).toLowerCase());
      }
      for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)) owned.delete(m[1]);
    }
    expect(owned.size).toBeGreaterThan(10);
    const listed = new Map<string, string>(OWNER_TABLES.map((t) => [t.table, t.key]));
    for (const [table, key] of owned) {
      expect(listed.get(table), `${table} has an owner read policy on ${key} and is not in the export`).toBe(key);
    }
  });
});
