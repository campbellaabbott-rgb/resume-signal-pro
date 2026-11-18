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
 * affiliate's approved conversions and the owner is mailed; a second open
 * request is a 409; and the table is closed to the client roles and holds one
 * open request per affiliate.
 *
 * AND A PAID BALANCE IS NOT REQUESTED AGAIN (review of the fix, applying
 * 20261008126000). The request asked for affiliates.pending_payout, which
 * nothing ever reduced: once the owner marked a request paid, the same
 * balance could be filed again and the owner mailed "pay $X" a second time.
 * The column also held unapproved commission the dashboard does not show. A
 * request now names its approved conversions, and setting it paid settles
 * them and moves the amount from pending_payout to paid_out in one statement.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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

/** sha256 hex: how 20261112120000 stores a session token. */
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * `approved` is the approved conversions' commissions; `pending` the
 * affiliates column; `flagged` the indexes of approved conversions held for
 * review; `proven` whether the address is confirmed (default yes). The
 * session row is stored as the round's migration stores it: by hash only.
 */
function install(opts: { approved?: number[]; pending?: number; expires?: string; status?: string; flagged?: number[]; proven?: boolean } = {}) {
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
  db.rows("affiliate_sessions").push({ token_hash: sha256(TOKEN), session_token: null, affiliate_id: "aff-1", expires_at: opts.expires ?? new Date(Date.now() + 86_400_000).toISOString() });
  const approved = opts.approved ?? [500, 2500];
  db.rows("affiliates").push({ id: "aff-1", email: "partner@example.com", status: opts.status ?? "active", pending_payout: opts.pending ?? approved.reduce((a, b) => a + b, 0),
    email_confirmed_at: opts.proven === false ? null : "2026-11-01T00:00:00Z" });
  approved.forEach((c, i) => db.rows("affiliate_conversions").push({ id: `conv-${i + 1}`, affiliate_id: "aff-1", commission_amount: c, status: "approved",
    review_flags: opts.flagged?.includes(i) ? ["affiliate-network"] : [] }));
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
    install({ approved: [500, 700] });
    const res = await post({ sessionToken: TOKEN });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "The minimum payout is $25.00.", minimumCents: 2500 });
    expect(requests()).toEqual([]);
  });
});

describe("a request is recorded and the owner is told", () => {
  it("writes one row for the approved conversions and their sum, mails the owner, and answers requested", async () => {
    install({ approved: [500, 3000] });
    // Another sale, not yet approved: on the column, not on the dashboard.
    db.rows("affiliate_conversions").push({ id: "conv-unapproved", affiliate_id: "aff-1", commission_amount: 500, status: "pending" });
    db.rows("affiliates")[0].pending_payout = 4000;
    const res = await post({ sessionToken: TOKEN });
    expect(await res.json()).toMatchObject({ status: "requested", amountCents: 3500, ownerNotified: true });
    expect(requests().map((r) => [r.affiliate_id, r.amount_cents, r.conversion_ids])).toEqual([["aff-1", 3500, ["conv-1", "conv-2"]]]);
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

describe("a balance the owner already paid is not requested again", () => {
  it("once its conversions are paid there is nothing to request, whatever the pending column still says", async () => {
    install({ approved: [500, 2500] });
    for (const c of db.rows("affiliate_conversions")) c.status = "paid";
    db.rows("affiliate_payout_requests").push({ id: "req-1", affiliate_id: "aff-1", amount_cents: 3000, status: "paid" });
    // The column as the old code left it: never reduced by the payment.
    db.rows("affiliates")[0].pending_payout = 3000;
    const res = await post({ sessionToken: TOKEN });
    expect(res.status, "a paid balance was filed again and the owner asked to pay it twice").toBe(400);
    expect(requests().filter((r) => r.status === "requested")).toEqual([]);
    expect(mail).toEqual([]);
  });

  it("settling a request in pglite (20261008126000) pays its conversions and moves the amount, once", async () => {
    const pg = await bootEmailOpsDb({ apply: ["20261008124000", "20261008126000"] });
    const [{ id: aff }] = await rows<{ id: string }>(pg, "INSERT INTO public.affiliates (email, password_hash, pending_payout) VALUES ('p@example.com', 'x', 3500) RETURNING id");
    const conv = async (cents: number, status: string) =>
      (await rows<{ id: string }>(pg, "INSERT INTO public.affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, status) VALUES ($1, md5(random()::text), 2900, $2, $3) RETURNING id", [aff, cents, status]))[0].id;
    const c1 = await conv(500, "approved");
    const c2 = await conv(2500, "approved");
    await conv(500, "pending");
    const [{ id: req }] = await rows<{ id: string }>(pg, "INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids) VALUES ($1, 3000, $2) RETURNING id", [aff, [c1, c2]]);

    await pg.query("UPDATE public.affiliate_payout_requests SET status = 'paid' WHERE id = $1", [req]);
    const [bal] = await rows<{ pending_payout: number; paid_out: number }>(pg, "SELECT pending_payout, paid_out FROM public.affiliates WHERE id = $1", [aff]);
    expect(bal, "marking a request paid left the paid amount in the pending balance").toEqual({ pending_payout: 500, paid_out: 3000 });
    const statuses = await rows<{ status: string; n: number }>(pg, "SELECT status, count(*)::int AS n FROM public.affiliate_conversions WHERE affiliate_id = $1 GROUP BY status ORDER BY status", [aff]);
    expect(statuses).toEqual([{ status: "paid", n: 2 }, { status: "pending", n: 1 }]);
    const [r] = await rows<{ resolved_at: string | null }>(pg, "SELECT resolved_at FROM public.affiliate_payout_requests WHERE id = $1", [req]);
    expect(r.resolved_at).not.toBeNull();

    await expect(pg.query("INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids) VALUES ($1, 3000, $2)", [aff, [c1, c2]]),
      "the paid conversions were requested a second time").rejects.toThrow(/approved conversion/);
    await expect(pg.query("UPDATE public.affiliate_payout_requests SET status = 'requested' WHERE id = $1", [req])).rejects.toThrow(/final/);
    await expect(pg.query("UPDATE public.affiliate_payout_requests SET status = 'paid', amount_cents = 1 WHERE id = $1", [req])).rejects.toThrow(/fixed/);
    const [after] = await rows<{ pending_payout: number; paid_out: number }>(pg, "SELECT pending_payout, paid_out FROM public.affiliates WHERE id = $1", [aff]);
    expect(after).toEqual({ pending_payout: 500, paid_out: 3000 });
    // A rejected request moves nothing and frees the conversions for a new one.
    const c3 = await conv(2500, "approved");
    const [{ id: req2 }] = await rows<{ id: string }>(pg, "INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids) VALUES ($1, 2500, $2) RETURNING id", [aff, [c3]]);
    await pg.query("UPDATE public.affiliate_payout_requests SET status = 'rejected' WHERE id = $1", [req2]);
    const [rej] = await rows<{ pending_payout: number; paid_out: number }>(pg, "SELECT pending_payout, paid_out FROM public.affiliates WHERE id = $1", [aff]);
    expect(rej).toEqual({ pending_payout: 500, paid_out: 3000 });
    // A conversion rejected after the request was filed: the payment is refused whole.
    const [{ id: req3 }] = await rows<{ id: string }>(pg, "INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids) VALUES ($1, 2500, $2) RETURNING id", [aff, [c3]]);
    await pg.query("UPDATE public.affiliate_conversions SET status = 'rejected' WHERE id = $1", [c3]);
    await expect(pg.query("UPDATE public.affiliate_payout_requests SET status = 'paid' WHERE id = $1", [req3])).rejects.toThrow(/nothing was moved/);
    const [{ status: s3 }] = await rows<{ status: string }>(pg, "SELECT status FROM public.affiliate_payout_requests WHERE id = $1", [req3]);
    expect(s3).toBe("requested");
    await pg.exec(migration("20261008126000"));
  }, 60_000);
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

/**
 * BUG ROUND 2026-11-08 (S14X-093, S14X-115, S14X-116, RC-S13-063). The session
 * is found by the sha256 of its token; an unproven address cannot be paid; a
 * conversion held for review is never requested; and a refusal names itself
 * in the body, so the page never reads "your balance changed" as "a request is
 * already open". Until the round's migrations apply, a missing column (42703)
 * reads as main read it.
 */
describe("the round's session, address and review rules", () => {
  it("a token stored only as its hash files the request; the token itself is never looked up", async () => {
    install({ approved: [3000] });
    const res = await post({ sessionToken: TOKEN });
    expect(await res.json()).toMatchObject({ status: "requested", amountCents: 3000 });
  });

  it("an unproven address is answered 403 unproven_address, and nothing is written or mailed", async () => {
    install({ approved: [3000], proven: false });
    const res = await post({ sessionToken: TOKEN });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ status: "unproven_address" });
    expect(requests()).toEqual([]);
    expect(mail).toEqual([]);
  });

  it("a conversion held for review is left out of the request", async () => {
    install({ approved: [3000, 2500], flagged: [1] });
    const res = await post({ sessionToken: TOKEN });
    expect(await res.json()).toMatchObject({ status: "requested", amountCents: 3000 });
    expect(requests().map((r) => r.conversion_ids)).toEqual([["conv-1"]]);
  });

  it("held for review alone is under the minimum: nothing is requested", async () => {
    install({ approved: [3000], flagged: [0] });
    expect((await post({ sessionToken: TOKEN })).status).toBe(400);
    expect(requests()).toEqual([]);
  });

  it("a balance that changed under the request (23514) says balance_changed, not already_requested", async () => {
    install({ approved: [3000] });
    db.faults.push({ table: "affiliate_payout_requests", op: "insert", error: { code: "23514", message: "check violation" } });
    const res = await post({ sessionToken: TOKEN });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ status: "balance_changed" });
  });

  it("before the migrations apply (42703 on each new column) it reads the plain token and main's columns", async () => {
    install({ approved: [3000] });
    db.rows("affiliate_sessions")[0].session_token = TOKEN;
    for (const table of ["affiliate_sessions", "affiliates", "affiliate_conversions"]) {
      db.faults.push({ table, op: "select", error: { code: "42703", message: "column does not exist" } });
    }
    const res = await post({ sessionToken: TOKEN });
    expect(await res.json()).toMatchObject({ status: "requested", amountCents: 3000 });
    expect(db.faults).toEqual([]);
  });
});
