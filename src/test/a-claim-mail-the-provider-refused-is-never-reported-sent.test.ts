// @vitest-environment node
/**
 * A CLAIM MAIL THE PROVIDER REFUSED IS NEVER REPORTED SENT (S13-098, the
 * company-claim half).
 *
 * WHAT WAS WRONG. company-claim inserted the claim row, took the inbox's and
 * the day's counts, then called the mail provider. When the provider refused
 * the send (or the call threw), the request answered 502, but:
 *   - the resend cooldown read last_sent_at OR created_at, so a retry inside
 *     ten minutes of the row's creation answered {status: "sent"} and mailed
 *     nothing;
 *   - the counts stayed taken, so after two refusals (the inbox allows two a
 *     day) the claimant was told "That address was already sent verification
 *     links today" when nothing had ever been sent.
 *
 * WHAT HOLDS NOW, running the shipped handler with the mail provider and the
 * database faked, and migration 20261103165000 in pglite:
 *   - a refused or thrown send hands the inbox's and the day's counts back
 *     (mail_door_give) and answers 502;
 *   - the cooldown runs only from a send that left, so the retry sends;
 *   - two refusals in a row do not use up the inbox's day;
 *   - a send that left is still not repeated inside ten minutes.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { bootMailDoorDb } from "./helpers/mail-door-db";

const GIVE_SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20261103165000_a_mail_the_provider_refused_hands_its_count_back.sql"), "utf8");

describe("20261103165000 in pglite: a count handed back", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await bootMailDoorDb();
    await pg.exec(GIVE_SQL);
    await pg.exec(GIVE_SQL); // safe to re-run
  }, 120_000);

  const take = async (door: string, bucket: string, max = 2, mins = 1440) =>
    (await pg.query<{ ok: boolean }>("SELECT public.mail_door_take($1, $2, $3, $4) AS ok", [door, bucket, max, mins])).rows[0].ok;
  const give = async (door: string, bucket: string, mins = 1440) =>
    (await pg.query<{ ok: boolean }>("SELECT public.mail_door_give($1, $2, $3) AS ok", [door, bucket, mins])).rows[0].ok;
  const hits = async (door: string, bucket: string) =>
    (await pg.query<{ hits: number }>("SELECT hits FROM public.mail_door_counts WHERE door = $1 AND bucket = $2", [door, bucket])).rows[0]?.hits ?? null;

  it("a two-a-day inbox refuses its third knock, and opens again once a refused send hands its count back", async () => {
    expect(await take("company-claim:recipient", "inbox-a")).toBe(true);
    expect(await take("company-claim:recipient", "inbox-a")).toBe(true);
    expect(await take("company-claim:recipient", "inbox-a")).toBe(false);
    expect(await give("company-claim:recipient", "inbox-a")).toBe(true);
    expect(await give("company-claim:recipient", "inbox-a")).toBe(true);
    expect(await hits("company-claim:recipient", "inbox-a")).toBe(1);
    expect(await take("company-claim:recipient", "inbox-a")).toBe(true);
  });

  it("never goes below zero, never makes a row, and never reaches into another bucket", async () => {
    expect(await give("company-claim:recipient", "nobody")).toBe(false);
    expect(await hits("company-claim:recipient", "nobody")).toBeNull();
    await take("company-claim:recipient", "inbox-b");
    await take("company-claim:recipient", "inbox-c");
    expect(await give("company-claim:recipient", "inbox-b")).toBe(true);
    expect(await give("company-claim:recipient", "inbox-b")).toBe(false);
    expect(await hits("company-claim:recipient", "inbox-b")).toBe(0);
    expect(await hits("company-claim:recipient", "inbox-c")).toBe(1);
  });

  it("hands nothing back into a window that has already ended", async () => {
    await take("company-claim:recipient", "inbox-d");
    await pg.query("UPDATE public.mail_door_counts SET window_start = now() - interval '2 days' WHERE bucket = 'inbox-d'");
    expect(await give("company-claim:recipient", "inbox-d")).toBe(false);
  });

  it("is closed to the client roles, open to service_role, and refuses malformed arguments", async () => {
    const acl = (await pg.query<{ anon: boolean; auth: boolean; svc: boolean; pub: boolean }>(`
      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
             EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS pub
        FROM pg_proc p WHERE p.oid = to_regprocedure('public.mail_door_give(text,text,integer)')`)).rows[0];
    expect(acl).toEqual({ anon: false, auth: false, svc: true, pub: false });
    await expect(pg.query("SELECT public.mail_door_give('', 'x', 60)")).rejects.toThrow(/invalid arguments/);
    await expect(pg.query("SELECT public.mail_door_give('d', 'x', 0)")).rejects.toThrow(/invalid arguments/);
  });

  it("the self-check left no probe row", async () => {
    expect((await pg.query("SELECT 1 FROM public.mail_door_counts WHERE door LIKE 'self-check:%'")).rows).toEqual([]);
  });
});

describe("the handler", () => {
  const db = new FakeDb();
  let handler: EdgeHandler;
  const sent: Array<{ to: string[]; subject: string }> = [];
  let provider: () => Promise<{ data: unknown; error: unknown }>;
  // The doors, counted as mail_door_take and mail_door_give count them.
  let counts: Map<string, number>;
  let given: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_0123456789abcdef", RESEND_API_KEY: "re_harness" };
    g.__cmrDb = db;
    g.__cmrSend = async (m: { to: string[]; subject: string }) => {
      const r = await provider();
      if (!r.error) sent.push(m);
      return r;
    };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    handler = await loadEdgeHandler("company-claim", {
      "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__cmrDb;",
      "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: (m) => globalThis.__cmrSend(m) }; } }",
    });
  }, 60_000);

  const install = () => {
    counts = new Map();
    given = [];
    provider = async () => ({ data: { id: "em" }, error: null });
    db.rpcs.mail_door_take = (a) => {
      const k = `${a.p_door}|${a.p_bucket}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return { data: n <= Number(a.p_max), error: null };
    };
    db.rpcs.mail_door_give = (a) => {
      given.push(a);
      const k = `${a.p_door}|${a.p_bucket}`;
      const n = counts.get(k) ?? 0;
      if (n > 0) counts.set(k, n - 1);
      return { data: n > 0, error: null };
    };
    db.rows("job_board_postings").push({ id: "p-savills", company_token: "savills", company: "Savills", apply_url: "https://careers.savills.co.uk/jobs/42" });
  };
  afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

  const request = () => handler(new Request("https://harness.supabase.co/functions/v1/company-claim", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.44" },
    body: JSON.stringify({ action: "request", companyToken: "savills", workEmail: "hr@savills.co.uk" }),
  }));
  const toClaimant = () => sent.filter((m) => m.to[0] === "hr@savills.co.uk");

  it("a refused send answers 502, hands the inbox's and the day's counts back, and the retry sends", async () => {
    install();
    provider = async () => ({ data: null, error: { name: "validation_error", message: "domain not verified" } });
    const refused = await request();
    expect(refused.status).toBe(502);
    expect(buildIsAtLeast(refused.headers.get("x-fn-build"), "company-claim", "2026-11-03"), String(refused.headers.get("x-fn-build"))).toBe(true);
    expect(given.map((a) => a.p_door).sort()).toEqual(["company-claim:all", "company-claim:recipient"]);
    expect(given.every((a) => a.p_window_minutes === 1440)).toBe(true);
    expect(db.rows("company_claims")[0].last_sent_at ?? null, "a refused send stamped the cooldown").toBeNull();

    provider = async () => ({ data: { id: "em" }, error: null });
    const retry = await request();
    expect(await retry.json()).toEqual({ status: "sent" });
    expect(toClaimant(), "the retry inside ten minutes of the row was answered sent and mailed nothing").toHaveLength(1);
  });

  it("a send that throws is handled the same way", async () => {
    install();
    provider = async () => { throw new Error("connect ETIMEDOUT"); };
    const res = await request();
    expect(res.status).toBe(502);
    expect(given.map((a) => a.p_door).sort()).toEqual(["company-claim:all", "company-claim:recipient"]);
    provider = async () => ({ data: { id: "em" }, error: null });
    await request();
    expect(toClaimant()).toHaveLength(1);
  });

  it("two refusals in a row do not use up the inbox's day", async () => {
    install();
    provider = async () => ({ data: null, error: { message: "rate limited" } });
    expect((await request()).status).toBe(502);
    expect((await request()).status).toBe(502);
    provider = async () => ({ data: { id: "em" }, error: null });
    const third = await request();
    expect(third.status, "two refused sends told the claimant the address had been sent its links today").toBe(200);
    expect(toClaimant()).toHaveLength(1);
  });

  it("a send that left is still not repeated inside ten minutes, and nothing is handed back for it", async () => {
    install();
    expect((await request()).status).toBe(200);
    expect(await (await request()).json()).toEqual({ status: "sent" });
    expect(toClaimant()).toHaveLength(1);
    expect(given).toEqual([]);
  });
});
