// @vitest-environment node
/**
 * A PAYOUT REQUEST IS A ROW THE OWNER CAN ACT ON (wave 2 email-ops, register
 * L13-63; owner decision 2026-10-07).
 *
 * WHAT WAS WRONG. Request Payout on /affiliates called nothing: no record, no
 * message, while the page said the payment was coming in 5-7 business days.
 *
 * WHAT HOLDS NOW, by running the shipped affiliate-payout-request handler
 * (Resend and the database faked) and applying 20261008124000 to pglite: only
 * the affiliate's own live session can file a request; a balance under the
 * minimum is refused with the minimum named; one request is written for the
 * whole pending balance and the owner is mailed; a second open request is a
 * 409; and the table is closed to the client roles and holds one open request
 * per affiliate.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bootEmailOpsDb, migration, rows } from "./helpers/email-ops-db";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const TOKEN = "ab".repeat(32);
type Mail = { to: string[]; subject: string; html: string };
const mail: Mail[] = [];
const db = new FakeDb();
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness", OWNER_NOTIFY_EMAIL: "owner@example.com" };
  g.__payMail = mail;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("affiliate-payout-request", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__payMail.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);

afterEach(() => { mail.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

function install(opts: { pending?: number; expires?: string; status?: string } = {}) {
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
  db.rows("affiliate_sessions").push({ session_token: TOKEN, affiliate_id: "aff-1", expires_at: opts.expires ?? new Date(Date.now() + 86_400_000).toISOString() });
  db.rows("affiliates").push({ id: "aff-1", email: "partner@example.com", status: opts.status ?? "active", pending_payout: opts.pending ?? 3000 });
}
const post = (body: unknown) => handler(new Request("https://harness.supabase.co/functions/v1/affiliate-payout-request", {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" }, body: JSON.stringify(body),
}));
const requests = () => db.rows("affiliate_payout_requests");

describe("only the affiliate's own live session files a request", () => {
  it("no token, a guessed token, or an expired session: 401, nothing written, nobody mailed", async () => {
    install({ expires: new Date(Date.now() - 1000).toISOString() });
    for (const body of [{}, { sessionToken: "cd".repeat(32) }, { sessionToken: TOKEN }]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(401);
    }
    expect(requests()).toEqual([]);
    expect(mail).toEqual([]);
  });

  it("a balance under the minimum is refused with the minimum named", async () => {
    install({ pending: 1200 });
    const res = await post({ sessionToken: TOKEN });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "The minimum payout is $25.00.", minimumCents: 2500 });
    expect(requests()).toEqual([]);
  });
});

describe("a request is recorded and the owner is told", () => {
  it("writes one row for the whole pending balance, mails the owner, and answers requested", async () => {
    install({ pending: 3500 });
    const res = await post({ sessionToken: TOKEN });
    expect(await res.json()).toMatchObject({ status: "requested", amountCents: 3500, ownerNotified: true });
    expect(requests().map((r) => [r.affiliate_id, r.amount_cents])).toEqual([["aff-1", 3500]]);
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toEqual(["owner@example.com"]);
    expect(mail[0].subject).toBe("Affiliate payout request: $35.00");
    expect(mail[0].html).toContain("partner@example.com");
  });

  it("a second open request is a 409 that writes nothing", async () => {
    install();
    db.faults.push({ table: "affiliate_payout_requests", op: "insert", error: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const res = await post({ sessionToken: TOKEN });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "already_requested" });
    expect(mail).toEqual([]);
  });
});

describe("the table, applied to pglite (20261008124000)", () => {
  it("holds one open request per affiliate and is closed to the client roles", async () => {
    const pg = await bootEmailOpsDb({ apply: ["20261008124000"] });
    const [{ id }] = await rows<{ id: string }>(pg, "INSERT INTO public.affiliates (email, password_hash) VALUES ('a@example.com', 'x') RETURNING id");
    await pg.query("INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents) VALUES ($1, 3000)", [id]);
    await expect(pg.query("INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents) VALUES ($1, 3000)", [id])).rejects.toThrow(/duplicate key/);
    await pg.query("UPDATE public.affiliate_payout_requests SET status = 'paid', resolved_at = now() WHERE affiliate_id = $1", [id]);
    await pg.query("INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents) VALUES ($1, 500)", [id]);
    const [acl] = await rows<{ anon: boolean; auth: boolean; svc: boolean }>(pg, `SELECT
      has_table_privilege('anon', 'public.affiliate_payout_requests', 'SELECT') AS anon,
      has_table_privilege('authenticated', 'public.affiliate_payout_requests', 'INSERT') AS auth,
      has_table_privilege('service_role', 'public.affiliate_payout_requests', 'INSERT') AS svc`);
    expect(acl).toEqual({ anon: false, auth: false, svc: true });
    await pg.exec(migration("20261008124000"));
  }, 60_000);
});
