// @vitest-environment node
/**
 * A KEY LINK THE PROVIDER REFUSED DOES NOT USE UP THE MAILBOX (S13-072).
 *
 * WHAT WAS WRONG. api_key_request_open records the request row before
 * api-key-request calls the mail provider, and every row counted toward the
 * mailbox's two links a day. A refused send answered 502, but its row kept
 * counting, so after two refusals the next request met 'too_many_requests',
 * which the door deliberately answers exactly like a mailed request: "If
 * that address can receive mail from us, a link is on its way". Nothing was
 * on its way.
 *
 * WHAT HOLDS NOW, with migration 20261103170000 in pglite and the shipped
 * handler run against it (the mail provider faked):
 *   - a refused or thrown send marks its row (api_key_request_unsent) with
 *     the same token hash it recorded, and answers 502;
 *   - a marked row no longer counts toward the mailbox or the day, so the
 *     next request is mailed; it still counts toward the caller's network;
 *   - two links that did leave still close the mailbox for the day.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { bootMailDoorDb, h64, rows } from "./helpers/mail-door-db";

const UNSENT_SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20261103170000_a_key_link_the_provider_refused_is_not_counted_as_mailed.sql"), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
type Open = { rq_send: boolean; rq_reason: string; rq_live_keys: number };

describe("20261103170000 in pglite", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await bootMailDoorDb();
    await pg.exec(UNSENT_SQL);
    await pg.exec(UNSENT_SQL); // safe to re-run
  }, 120_000);

  const open = (email: string, token: string, net = "net-a") =>
    rows<Open>(pg, "SELECT * FROM public.api_key_request_open($1, 'app', $2, $3)", [email, token, net]).then((r) => r[0]);
  const unsent = (token: string) =>
    rows<{ ok: boolean }>(pg, "SELECT public.api_key_request_unsent($1) AS ok", [token]).then((r) => r[0].ok);

  it("a mailbox whose two links were refused is still sent a third", async () => {
    expect((await open("dev@example.org", h64("1"))).rq_send).toBe(true);
    expect(await unsent(h64("1"))).toBe(true);
    expect((await open("dev+x@example.org", h64("2"))).rq_send).toBe(true);
    expect(await unsent(h64("2"))).toBe(true);
    expect(await open("Dev@Example.org", h64("3")), "two refused links used up the mailbox's day").toMatchObject({ rq_send: true, rq_reason: "sent" });
  });

  it("two links that left still close the mailbox for the day", async () => {
    await open("ops@example.org", h64("4"), "net-b");
    await open("ops@example.org", h64("5"), "net-b");
    expect(await open("ops@example.org", h64("6"), "net-b")).toMatchObject({ rq_send: false, rq_reason: "too_many_requests" });
  });

  it("a refused request still counts toward the caller's network", async () => {
    for (const [i, c] of ["7", "8", "9", "a", "b"].entries()) {
      expect((await open(`n${i}@example.org`, h64(c), "net-c")).rq_send).toBe(true);
      await unsent(h64(c));
    }
    expect(await open("n9@example.org", h64("c"), "net-c")).toMatchObject({ rq_send: false, rq_reason: "network_busy" });
  });

  it("marks only a recent, unconfirmed, unmarked request, and nothing else", async () => {
    expect(await unsent(h64("d")), "a token nobody requested was marked").toBe(false);
    expect(await unsent(h64("1")), "a row was marked twice").toBe(false);
    await open("old@example.org", h64("e"), "net-d");
    await pg.query("UPDATE public.api_key_requests SET created_at = now() - interval '2 hours' WHERE token_hash = $1", [h64("e")]);
    expect(await unsent(h64("e"))).toBe(false);
    await open("done@example.org", h64("f"), "net-d");
    await pg.query("UPDATE public.api_key_requests SET confirmed_at = now() WHERE token_hash = $1", [h64("f")]);
    expect(await unsent(h64("f"))).toBe(false);
    await expect(pg.query("SELECT public.api_key_request_unsent('short')")).rejects.toThrow(/invalid arguments/);
  });

  it("leaves the link as it was: a send that threw after the provider took it still delivers a working link", async () => {
    const r = (await rows<{ expires_at: string; created_at: string }>(pg,
      "SELECT expires_at, created_at FROM public.api_key_requests WHERE token_hash = $1", [h64("1")]))[0];
    expect(Date.parse(String(r.expires_at)) - Date.parse(String(r.created_at))).toBeGreaterThan(23 * 3_600_000);
  });

  it("both functions are closed to the client roles and open to service_role; the self-check left no probe row", async () => {
    const acl = await rows<{ sig: string; anon: boolean; auth: boolean; svc: boolean }>(pg, `
      SELECT f AS sig, has_function_privilege('anon', f, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', f, 'EXECUTE') AS auth,
             has_function_privilege('service_role', f, 'EXECUTE') AS svc
        FROM unnest(ARRAY['public.api_key_request_unsent(text)', 'public.api_key_request_open(text,text,text,text)']) f`);
    for (const a of acl) expect(a, a.sig).toMatchObject({ anon: false, auth: false, svc: true });
    expect(await rows(pg, "SELECT 1 FROM public.api_key_requests WHERE email LIKE '0000000000-%'")).toEqual([]);
  });
});

describe("the handler, against the SQL", () => {
  let pg: PGlite;
  const db = new FakeDb();
  let handler: EdgeHandler;
  const mails: Array<{ to: string[]; html: string }> = [];
  const unsentCalls: Array<Record<string, unknown>> = [];
  const opened: Array<Record<string, unknown>> = [];
  let provider: () => Promise<Response>;

  beforeAll(async () => {
    pg = await bootMailDoorDb();
    await pg.exec(UNSENT_SQL);
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_role_key_for_the_harness_0123456789abcdef", RESEND_API_KEY: "re_harness" };
    g.__klDb = db;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.fetch = async (url: string, init: { body: string }) => {
      if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`);
      const res = await provider();
      if (res.ok) mails.push(JSON.parse(init.body));
      return res;
    };
    handler = await loadEdgeHandler("api-key-request", {
      "https://esm.sh/@supabase/supabase-js@2.45.0": "export const createClient = () => globalThis.__klDb;",
    });
  }, 120_000);

  beforeEach(async () => {
    await pg.query("DELETE FROM public.api_key_requests");
    provider = async () => new Response("{}", { status: 200 });
    db.rpcs.api_key_request_open = async (a) => {
      opened.push(a);
      const r = await rows<Open>(pg, "SELECT * FROM public.api_key_request_open($1, $2, $3, $4)", [a.p_email, a.p_name, a.p_token_hash, a.p_net]);
      return { data: r, error: null };
    };
    db.rpcs.api_key_request_unsent = async (a) => {
      unsentCalls.push(a);
      const r = await rows<{ ok: boolean }>(pg, "SELECT public.api_key_request_unsent($1) AS ok", [a.p_token_hash]);
      return { data: r[0].ok, error: null };
    };
  });
  afterEach(() => { mails.length = 0; unsentCalls.length = 0; opened.length = 0; db.rpcs = {}; });

  const post = (email: string) => handler(new Request("https://harness.supabase.co/functions/v1/api-key-request", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.30" }, body: JSON.stringify({ email }),
  }));

  it("a refused send marks the row it recorded, by the same token hash, and answers 502", async () => {
    provider = async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 });
    const res = await post("dev@example.org");
    expect(res.status).toBe(502);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "api-key-request", "2026-11-03"), String(res.headers.get("x-fn-build"))).toBe(true);
    expect(unsentCalls).toEqual([{ p_token_hash: opened[0].p_token_hash }]);
  });

  it("after two refused sends the next request is mailed, not answered 'on its way' with nothing sent", async () => {
    provider = async () => new Response("{}", { status: 500 });
    expect((await post("dev@example.org")).status).toBe(502);
    provider = async () => { throw new Error("connect ETIMEDOUT"); };
    expect((await post("dev@example.org")).status).toBe(502);
    expect(unsentCalls).toHaveLength(2);
    provider = async () => new Response("{}", { status: 200 });
    const third = await post("dev@example.org");
    expect(third.status).toBe(200);
    expect(mails.map((m) => m.to[0]), "the third request was answered as mailed and nothing was sent").toEqual(["dev@example.org"]);
    const token = /\/data-api#confirm=([0-9a-f]{64})"/.exec(mails[0].html)?.[1];
    expect(sha(token!)).toBe(opened[2].p_token_hash);
  });

  it("a send that left marks nothing", async () => {
    expect((await post("dev@example.org")).status).toBe(200);
    expect(unsentCalls).toEqual([]);
    expect(mails).toHaveLength(1);
  });
});
