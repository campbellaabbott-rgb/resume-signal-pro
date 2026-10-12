// @vitest-environment node
/**
 * A PULSE CONFIRMATION THAT NEVER LEFT LOCKED ITS ADDRESS OUT, AND THE PULSE
 * PRESENTED A HAND-TYPED TABLE AS THIS MONTH'S POSTINGS (S8-099, S8-102).
 *
 * WHAT WAS WRONG.
 *   S8-099  market_pulse_request_confirm stamps the request before Resend is
 *           called, and a refused send undid nothing: for 7 days every
 *           request answered "pending" with no mail, and three refusals in 90
 *           days blocked the address.
 *   S8-102  The monthly mail read only the curated KEYWORD_FREQUENCY table
 *           and said "{industry} postings shifted", "screening for right
 *           now", "In 80%+ of postings" and "In 50–79% of postings": numbers
 *           nobody computed.
 *
 * WHAT HOLDS NOW: in PGlite, the new market_pulse_confirm_unsent takes back
 * exactly the request whose mail failed (and never a later one), so the next
 * request mails at once; the shipped handler calls it with the token hash it
 * recorded when Resend refuses; the monthly mail names its source and prints
 * no share of postings.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";
import { bootMailDoorDb, h64, rows } from "./helpers/mail-door-db";

const UNSENT_SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20261009141000_a_pulse_confirmation_that_never_left_does_not_lock_its_address_out.sql"), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("20261009141000 in PGlite: a request whose mail never left is taken back", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await bootMailDoorDb({ cron: true });
    await pg.exec(UNSENT_SQL);
    await pg.exec(UNSENT_SQL); // safe to re-run
  }, 120_000);
  beforeEach(async () => { await pg.exec("BEGIN"); });
  afterEach(async () => { await pg.exec("ROLLBACK"); });
  const request = (email: string, token: string) =>
    rows<{ pc_send: boolean; pc_reason: string }>(pg, "SELECT * FROM public.market_pulse_request_confirm($1, 'technology', 70, $2, 'net-a')", [email, token]).then((r) => r[0]);
  const unsent = (email: string, token: string) =>
    rows<{ ok: boolean }>(pg, "SELECT public.market_pulse_confirm_unsent($1, $2) AS ok", [email, token]).then((r) => r[0].ok);

  it("the next request mails at once, and three refusals do not lock the address", async () => {
    for (const c of ["a", "b", "c", "d"]) {
      expect(await request("jane@example.com", h64(c)), `request ${c}`).toEqual({ pc_send: true, pc_reason: "sent" });
      expect(await unsent("jane@example.com", h64(c))).toBe(true);
    }
    const [row] = await rows<{ confirm_sends: number; confirm_token_hash: string | null; confirm_sent_at: string | null }>(pg,
      "SELECT confirm_sends, confirm_token_hash, confirm_sent_at FROM public.market_pulse_subscribers WHERE email = 'jane@example.com'");
    expect(row).toEqual({ confirm_sends: 0, confirm_token_hash: null, confirm_sent_at: null });
  });

  it("an old token never takes back a later request's mail", async () => {
    expect((await request("ann@example.com", h64("e"))).pc_send).toBe(true);
    expect(await unsent("ann@example.com", h64("x")), "a token the row does not hold").toBe(false);
    expect(await request("ann@example.com", h64("f")), "the mail that did leave still holds its week").toEqual({ pc_send: false, pc_reason: "recently_sent" });
  });

  it("is service-role only and not a definer", async () => {
    const [acl] = await rows<{ anon: boolean; auth: boolean; svc: boolean; definer: boolean }>(pg, `
      SELECT has_function_privilege('anon', 'public.market_pulse_confirm_unsent(text,text)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.market_pulse_confirm_unsent(text,text)', 'EXECUTE') AS auth,
             has_function_privilege('service_role', 'public.market_pulse_confirm_unsent(text,text)', 'EXECUTE') AS svc,
             (SELECT prosecdef FROM pg_proc WHERE oid = 'public.market_pulse_confirm_unsent(text,text)'::regprocedure) AS definer`);
    expect(acl).toEqual({ anon: false, auth: false, svc: true, definer: false });
  });
});

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
let refuse = false;
const db = new FakeDb();
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let handler: EdgeHandler;
const rpc = (name: string, impl: (a: Record<string, unknown>) => unknown) => {
  db.rpcs[name] = (args) => { calls.push({ name, args }); return { data: impl(args), error: null }; };
};

describe("the shipped handler", () => {
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
    g.__unsentSent = sent;
    g.__unsentRefuse = () => refuse;
    g.__fakeSupabase = db;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    handler = await loadEdgeHandler("send-market-pulse", {
      ...SELLER_SET_STUB,
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
      "https://esm.sh/resend@2.0.0":
        "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__unsentSent.push(m); return globalThis.__unsentRefuse() ? { data: null, error: { message: 'provider down' } } : { data: { id: 'em' }, error: null }; } }; } }",
    });
  }, 60_000);
  afterEach(() => { sent.length = 0; calls.length = 0; refuse = false; db.tables = {}; db.writes = []; db.rpcs = {}; });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handler(new Request("https://harness.supabase.co/functions/v1/send-market-pulse", {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    }));

  it("a confirmation Resend refused is taken back with the token hash the request recorded", async () => {
    rpc("mail_door_take", () => true);
    rpc("market_pulse_request_confirm", () => ({ pc_send: true, pc_reason: "sent" }));
    rpc("market_pulse_confirm_unsent", () => true);
    refuse = true;
    const res = await post({ action: "subscribe", email: "jane@example.com", industry: "technology", score: 70 }, { "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(502);
    const recorded = calls.find((c) => c.name === "market_pulse_request_confirm")!;
    const undone = calls.find((c) => c.name === "market_pulse_confirm_unsent");
    expect(undone, "the refused request was left recorded: the address waits a week for nothing").toBeTruthy();
    expect(undone!.args).toEqual({ p_email: "jane@example.com", p_token_hash: recorded.args.p_token_hash });
    const token = /#t=([0-9a-f]{64})/.exec(sent[0].html)?.[1];
    expect(sha(token!)).toBe(recorded.args.p_token_hash);
  });

  it("a confirmation that left is not taken back", async () => {
    rpc("mail_door_take", () => true);
    rpc("market_pulse_request_confirm", () => ({ pc_send: true, pc_reason: "sent" }));
    rpc("market_pulse_confirm_unsent", () => true);
    expect((await post({ action: "subscribe", email: "jane@example.com", industry: "technology" })).status).toBe(200);
    expect(calls.some((c) => c.name === "market_pulse_confirm_unsent")).toBe(false);
  });

  it("the monthly mail names its source and prints no share of postings nobody counted", async () => {
    rpc("market_pulse_claim_batch", () => [{ cl_email: "one@example.com", cl_industry: "technology", cl_last_score: 70, cl_confirmed_at: "2026-10-04T00:00:00Z", cl_prev_sent_at: null }]);
    rpc("get_user_score_trend", () => []);
    expect((await post({ action: "send" }, { authorization: `Bearer ${SERVICE}` })).status).toBe(200);
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.subject).not.toMatch(/shifted/i);
    expect(m.html).not.toMatch(/\d+%|right now|this month's keywords/i);
    expect(m.html).toContain("not a count of this month's postings");
  });
});
