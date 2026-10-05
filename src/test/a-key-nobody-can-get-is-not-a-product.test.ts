// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { MAIL_DOOR_SQL, MAIL_DOOR_VERIFY, bootMailDoorDb, h64, rows } from "./helpers/mail-door-db";

/**
 * AN API NOBODY CAN TRY IS AN API NOBODY BECOMES A CUSTOMER OF -- AND A KEY
 * ANYONE CAN MINT IS NO LIMIT AT ALL.
 *
 * public-api shipped working and unusable: a key existed only if someone wrote
 * SQL. Self-serve issuance fixed that on 2026-08-26 -- and then handed a
 * working key to whoever typed an address, returned it in the response, and
 * mailed that address on every mint. A script inventing addresses held as many
 * keys as it liked, each with its own per-minute rate and daily quota, so the
 * metering bound nothing (defect sweep 2026-10-02, 1.43: the harvesting door).
 *
 * Since 20261004100000 a key requires a mailbox: a request mails a single-use
 * link to the address that asked, and the key is minted only when that link is
 * opened, then shown once to whoever opened it. This pins, by RUNNING the SQL
 * in pglite and the shipped handler in the edge harness:
 *   1. the raw secret is never stored, and never in a response to a request;
 *   2. the bounds -- per mailbox (however it is spelled), per network (from the
 *      platform's address, never a header the caller writes), per domain, and
 *      overall -- are enforced where they are atomic;
 *   3. a request never revokes anything; only a mailbox's confirmed owner
 *      retires that mailbox's own account-less keys, never an account's key;
 *   4. the page says what the code does (claim drift);
 *   5. (review of 2026-10-04) the pool the old door filled is revoked by the
 *      file, a free key unused for 30 days retires, a full day cannot be used
 *      to turn the door off for everyone (past a soft ceiling only networks
 *      that have not used it today are served, and reaching either ceiling
 *      tells the owner), and the answer to a request never says whether the
 *      address bounced, complained or already had its two links today.
 */
const ROOT = resolve(__dirname, "../..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const stripJs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const FN = readFileSync(resolve(ROOT, "supabase/functions/api-key-request/index.ts"), "utf8");
const CODE = stripJs(FN);
const PAGE_CODE = stripJs(readFileSync(resolve(ROOT, "src/pages/DataApi.tsx"), "utf8"));
const MIG = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).filter((x) => x.endsWith(".sql"))
    .filter((x) => readFileSync(resolve(dir, x), "utf8").includes("FUNCTION public.api_key_issue(")).sort().pop();
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
})();
// SQL comments stripped for the NEGATIVE assertions: the header explains what
// it does not store, and a guard that fails on its own documentation is the
// trap this repo strips JS comments for.
const MIG_CODE = MIG.split("\n").map((l) => (/^\s*--/.test(l) ? "" : l)).join("\n");

describe("the secret and its storage", () => {
  it("issues from a CSPRNG with a recognisable prefix", () => {
    expect(CODE).toMatch(/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
    expect(CODE).toMatch(/"rb_live_"/);
  });

  it("stores only the hash -- the raw key never reaches the database", () => {
    expect(CODE).toMatch(/p_key_hash: await sha256Hex\(raw\)/);
    expect(CODE, "the raw key is passed to the issue RPC").not.toMatch(/p_key_raw|p_secret/);
    expect(MIG, "the issue function takes a raw secret").not.toMatch(/p_key_raw|p_secret/);
  });

  it("the free-tier constants live in the mint, where the MCP config and the pages mirror them", () => {
    expect(MIG_CODE).toMatch(/c_rate integer := \d+;/);
    expect(MIG_CODE).toMatch(/c_quota integer := \d+;/);
    expect(MIG_CODE).toMatch(/c_max_active integer := 3;/);
  });

  it("every function is service-role only, revoked from anon and authenticated BY NAME", () => {
    for (const sig of ["api_key_issue\\(text, text, text, text\\)", "api_key_request_open\\(text, text, text, text\\)", "api_key_mailbox\\(text\\)"]) {
      expect(MIG).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, authenticated;`));
      expect(MIG).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO service_role;`));
    }
  });

  it("the network is the shared helper's (the platform's address), never a header read here", () => {
    expect(CODE).toMatch(/import \{ networkBucket \} from "\.\.\/_shared\/network-bucket\.ts";/);
    expect(CODE, "the function reads a forwarding header itself").not.toMatch(/x-forwarded-for|cf-connecting-ip/i);
    expect(MIG_CODE, "the database stores an address").not.toMatch(/\bip\b|inet|x-forwarded-for/i);
  });
});

// ── the SQL, run ─────────────────────────────────────────────────────────────

type Db = PGlite;
type Open = { rq_send: boolean; rq_reason: string; rq_live_keys: number };
type Issue = { ik_issued: boolean; ik_reason: string; ik_rate: number; ik_quota: number; ik_retired: string[] };
const open = (db: Db, email: string, token: string, net: string | null = "net-a") =>
  rows<Open>(db, "SELECT * FROM public.api_key_request_open($1, 'my app', $2, $3)", [email, token, net]).then((r) => r[0]);
const issue = (db: Db, token: string, keyHash: string, net: string | null = "net-b") =>
  rows<Issue>(db, "SELECT * FROM public.api_key_issue($1, $2, 'rb_live_' || left($2, 8), $3)", [token, keyHash, net]).then((r) => r[0]);
let n = 0;
/** A fresh 64-hex stand-in hash for each call. */
const fresh = () => sha(`k${++n}`);
const keys = (db: Db) => rows<{ owner_email: string; revoked: boolean; user_id: string | null }>(db,
  "SELECT owner_email, revoked_at IS NOT NULL AS revoked, user_id FROM public.api_keys ORDER BY created_at, key_prefix");

let pg: Db;
describe("the SQL, applied to the tables it meets", () => {
  beforeAll(async () => { pg = await bootMailDoorDb(); }, 120_000);
  beforeEach(async () => { await pg.exec("BEGIN"); });
  afterEach(async () => { await pg.exec("ROLLBACK"); });

  describe("a request mails a link and mints nothing", () => {
    it("two links a day per MAILBOX, however it is spelled", async () => {
      expect(await open(pg, "Jane.Doe@gmail.com", fresh())).toMatchObject({ rq_send: true, rq_reason: "sent" });
      expect(await open(pg, "janedoe+api@googlemail.com", fresh())).toMatchObject({ rq_send: true });
      expect(await open(pg, "j.a.n.e.d.o.e@gmail.com", fresh()), "a third spelling of one inbox").toMatchObject({ rq_send: false, rq_reason: "too_many_requests" });
      expect(await keys(pg), "a request minted a key").toEqual([]);
    });

    it("five an hour per network, whatever the addresses", async () => {
      for (let i = 0; i < 5; i++) expect((await open(pg, `dev${i}@example${i}.org`, fresh(), "net-x")).rq_send).toBe(true);
      expect(await open(pg, "dev9@example9.org", fresh(), "net-x")).toMatchObject({ rq_send: false, rq_reason: "network_busy" });
      expect((await open(pg, "dev9@example9.org", fresh(), "net-y")).rq_send, "another network is not this one's bucket").toBe(true);
    });

    it("past 150 a day only a network with no request today is served; at 600 nobody is", async () => {
      // Three apiece from fifty networks, two hours ago: inside the day,
      // outside each network's own hourly five.
      await pg.query(`INSERT INTO public.api_key_requests (email, mailbox, token_hash, request_net, created_at, expires_at)
                      SELECT 'b' || g || '@example.org', 'b' || g || '@example.org', md5(g::text) || md5((g + 1)::text),
                             'flood-' || (g % 50), now() - interval '2 hours', now() + interval '1 day'
                        FROM generate_series(1, 150) g`);
      expect(await open(pg, "next@example.org", fresh(), "flood-4"), "a network that already asked today").toMatchObject({ rq_send: false, rq_reason: "shed" });
      expect(await open(pg, "real-dev@example.org", fresh(), "net-fresh"), "a network that has not").toMatchObject({ rq_send: true, rq_reason: "sent" });
      expect(await open(pg, "second@example.org", fresh(), "net-fresh")).toMatchObject({ rq_send: false, rq_reason: "shed" });
      await pg.query(`INSERT INTO public.api_key_requests (email, mailbox, token_hash, request_net, expires_at)
                      SELECT 'c' || g || '@example.org', 'c' || g || '@example.org', md5('c' || g) || md5('d' || g),
                             'wide-' || g, now() + interval '1 day'
                        FROM generate_series(1, 450) g`);
      expect(await open(pg, "late@example.org", fresh(), "net-z")).toMatchObject({ rq_send: false, rq_reason: "paused" });
    });

    it("a busy network hears 'network busy' for every address alike: the address is judged last, so the order is no oracle", async () => {
      await pg.query("INSERT INTO public.suppressed_emails (email, reason) VALUES ('bounced@example.org', 'bounce')");
      for (let i = 0; i < 2; i++) await open(pg, "capped@example.org", fresh(), `other-${i}`);
      for (let i = 0; i < 5; i++) await open(pg, `x${i}@site${i}.org`, fresh(), "busy-net");
      for (const email of ["bounced@example.org", "capped@example.org", "ordinary@example.org"]) {
        expect(await open(pg, email, fresh(), "busy-net"), email).toMatchObject({ rq_send: false, rq_reason: "network_busy" });
      }
    });

    it("never mails an address that bounced or complained (an unsubscribe from marketing is not that)", async () => {
      await pg.query("INSERT INTO public.suppressed_emails (email, reason) VALUES ('bounced@example.org', 'bounce'), ('quiet@example.org', 'unsubscribe')");
      expect(await open(pg, "bounced@example.org", fresh())).toMatchObject({ rq_send: false, rq_reason: "undeliverable" });
      expect((await open(pg, "quiet@example.org", fresh())).rq_send).toBe(true);
    });
  });

  describe("the mint redeems a link, once", () => {
    it("mints against a live token, with the free-tier limits, and refuses it a second time", async () => {
      const t = fresh();
      await open(pg, "dev@example.org", t);
      expect(await issue(pg, t, fresh())).toMatchObject({ ik_issued: true, ik_reason: "issued", ik_rate: 60, ik_quota: 1000, ik_retired: [] });
      expect(await issue(pg, t, fresh()), "one link, two keys").toMatchObject({ ik_issued: false, ik_reason: "already_used" });
      expect(await keys(pg)).toEqual([{ owner_email: "dev@example.org", revoked: false, user_id: null }]);
    });

    it("an unknown or expired token mints nothing", async () => {
      expect(await issue(pg, fresh(), fresh())).toMatchObject({ ik_issued: false, ik_reason: "invalid_link" });
      const t = fresh();
      await open(pg, "late@example.org", t);
      await pg.query("UPDATE public.api_key_requests SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [t]);
      expect(await issue(pg, t, fresh())).toMatchObject({ ik_issued: false, ik_reason: "expired" });
      expect(await keys(pg)).toEqual([]);
    });

    it("five keys a day per network, and a refused link stays redeemable", async () => {
      const tokens: string[] = [];
      for (let i = 0; i < 6; i++) { const t = fresh(); tokens.push(t); await open(pg, `m${i}@site${i}.org`, t, `req-${i}`); }
      for (let i = 0; i < 5; i++) expect((await issue(pg, tokens[i], fresh(), "net-mint")).ik_issued).toBe(true);
      expect(await issue(pg, tokens[5], fresh(), "net-mint")).toMatchObject({ ik_issued: false, ik_reason: "network_limit" });
      expect((await issue(pg, tokens[5], fresh(), "net-other")).ik_issued, "the refused token was spent").toBe(true);
    });

    it("five a day per domain, except the big shared providers", async () => {
      const at = async (email: string) => { const t = fresh(); await open(pg, email, t, `r-${email}`); return issue(pg, t, fresh(), `m-${email}`); };
      for (let i = 0; i < 5; i++) expect((await at(`u${i}@catchall.example`)).ik_issued).toBe(true);
      expect(await at("u9@catchall.example")).toMatchObject({ ik_issued: false, ik_reason: "domain_limit" });
      for (let i = 0; i < 6; i++) expect((await at(`person${i}@gmail.com`)).ik_issued, `gmail #${i}`).toBe(true);
    });

    it("past twenty account-less keys a day only a network that has made none today is served; at sixty nobody is", async () => {
      await pg.query(`INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier)
                      SELECT md5(g::text), 'rb_live_x', 'k', 'k' || g || '@gmail.com', 'free' FROM generate_series(1, 19) g`);
      const t1 = fresh(); await open(pg, "first@example.org", t1, "r1");
      expect((await issue(pg, t1, fresh(), "mint-net")).ik_issued, "the twentieth key, below the soft ceiling").toBe(true);
      const t2 = fresh(); await open(pg, "second@example.org", t2, "r2");
      expect(await issue(pg, t2, fresh(), "mint-net"), "the same network again, past it").toMatchObject({ ik_issued: false, ik_reason: "shed" });
      expect((await issue(pg, t2, fresh(), "mint-fresh")).ik_issued, "a fresh network, and the refused link was not spent").toBe(true);
      await pg.query(`INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier)
                      SELECT md5('m' || g), 'rb_live_x', 'k', 'm' || g || '@gmail.com', 'free' FROM generate_series(1, 40) g`);
      const t3 = fresh(); await open(pg, "third@example.org", t3, "r3");
      expect(await issue(pg, t3, fresh(), "mint-brand-new")).toMatchObject({ ik_issued: false, ik_reason: "paused" });
    });

    it("a free key nobody used for 30 days retires; a used one, an account's key and a hand-made tier never do", async () => {
      await pg.query(`INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, created_at, last_used_at, user_id) VALUES
        ('i1', 'rb_live_idle', 'k', 'a@example.org', 'free', now() - interval '60 days', now() - interval '31 days', NULL),
        ('i2', 'rb_live_never', 'k', 'b@example.org', 'free', now() - interval '31 days', NULL, NULL),
        ('i3', 'rb_live_used', 'k', 'c@example.org', 'free', now() - interval '90 days', now() - interval '2 days', NULL),
        ('i4', 'rb_live_acct', 'agent-mcp', 'd@example.org', 'free', now() - interval '90 days', NULL, gen_random_uuid()),
        ('i5', 'rb_live_trial', 'k', 'e@example.org', 'trial', now() - interval '90 days', NULL, NULL)`);
      expect((await rows<{ n: number }>(pg, "SELECT public.api_key_retire_idle() AS n"))[0].n).toBe(2);
      const live = (await rows<{ key_prefix: string }>(pg, "SELECT key_prefix FROM public.api_keys WHERE revoked_at IS NULL ORDER BY key_prefix")).map((x) => x.key_prefix);
      expect(live).toEqual(["rb_live_acct", "rb_live_trial", "rb_live_used"]);
    });

    it("a fourth key retires the mailbox's least recently used, never an account's key or another mailbox's", async () => {
      await pg.query(`INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, last_used_at, user_id) VALUES
        ('h1', 'rb_live_old', 'k', 'dev+one@example.org', 'free', now() - interval '9 days', NULL),
        ('h2', 'rb_live_mid', 'k', 'dev@example.org', 'free', now() - interval '2 days', NULL),
        ('h3', 'rb_live_new', 'k', 'DEV+two@example.org', 'free', now() - interval '1 hour', NULL),
        ('h4', 'rb_live_agt', 'agent-mcp', 'dev@example.org', 'free', now() - interval '30 days', gen_random_uuid()),
        ('h5', 'rb_live_oth', 'k', 'other@example.org', 'free', now() - interval '60 days', NULL)`);
      const t = fresh();
      const req = await open(pg, "dev@example.org", t);
      expect(req.rq_live_keys, "the mail warns that a key will retire").toBe(3);
      const r = await issue(pg, t, fresh());
      expect(r).toMatchObject({ ik_issued: true, ik_retired: ["rb_live_old"] });
      const live = (await rows<{ key_prefix: string }>(pg, "SELECT key_prefix FROM public.api_keys WHERE revoked_at IS NULL")).map((x) => x.key_prefix);
      expect(live).toHaveLength(5);
      for (const kept of ["rb_live_agt", "rb_live_mid", "rb_live_new", "rb_live_oth"]) expect(live, kept).toContain(kept);
      expect(live).not.toContain("rb_live_old");
    });

    it("the old address-taking mint is gone: its named arguments resolve to nothing", async () => {
      await expect(pg.query("SELECT public.api_key_issue(p_email => 'a@b.co', p_name => 'x', p_key_hash => 'y', p_key_prefix => 'z')"))
        .rejects.toThrow(/does not exist/);
    });

    it("the self-check refuses a database where an address-taking overload survived", async () => {
      await pg.query("CREATE FUNCTION public.api_key_issue(p_email text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$");
      await expect(pg.exec(MAIL_DOOR_VERIFY)).rejects.toThrow(/overloads/);
    });

    it("no client role can execute any of it, or read the request table", async () => {
      const r = await rows<{ f: string; anon: boolean; auth: boolean }>(pg, `
        SELECT f, has_function_privilege('anon', f, 'EXECUTE') AS anon, has_function_privilege('authenticated', f, 'EXECUTE') AS auth
          FROM unnest(ARRAY['public.api_key_issue(text,text,text,text)', 'public.api_key_request_open(text,text,text,text)', 'public.api_key_mailbox(text)', 'public.api_key_retire_idle()']) f`);
      for (const x of r) expect(x, x.f).toMatchObject({ anon: false, auth: false });
      const t = await rows<{ sel: boolean }>(pg, "SELECT has_table_privilege('anon', 'public.api_key_requests', 'SELECT') AS sel");
      expect(t[0].sel).toBe(false);
    });
  });
});

// ── the pool the old door filled ─────────────────────────────────────────────

describe("the keys the old door handed out are revoked by the file, and only those", () => {
  // Its own boot: the rows must exist BEFORE the migration runs, as today's do.
  const LEGACY = `INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id, last_used_at) VALUES
    ('L1', 'rb_live_scrpt', 'k', 'made-up-1@example.org', 'free', NULL, now()),
    ('L2', 'rb_live_strgr', 'k', 'someone-else@example.org', 'free', NULL, NULL),
    ('L3', 'rb_live_agent', 'agent-mcp', 'dev@example.org', 'free', gen_random_uuid(), now()),
    ('L4', 'rb_live_hand', 'partner', 'partner@example.org', 'trial', NULL, now()),
    ('L5', 'rb_live_gone', 'k', 'old@example.org', 'free', NULL, NULL);
    UPDATE public.api_keys SET revoked_at = now() - interval '9 days', notes = 'rotated' WHERE key_hash = 'L5';`;
  let lg: Db;
  beforeAll(async () => { lg = await bootMailDoorDb({ seed: LEGACY }); }, 120_000);
  const state = async () => rows<{ key_prefix: string; revoked: boolean; notes: string | null }>(lg,
    "SELECT key_prefix, revoked_at IS NOT NULL AS revoked, notes FROM public.api_keys ORDER BY key_hash");

  it("every free account-less key minted before the file is revoked, with the reason; an account's key and a hand-made tier are not", async () => {
    expect(await state()).toEqual([
      { key_prefix: "rb_live_scrpt", revoked: true, notes: "revoked 20261004100000: a free key issued before keys needed a confirmed mailbox" },
      { key_prefix: "rb_live_strgr", revoked: true, notes: "revoked 20261004100000: a free key issued before keys needed a confirmed mailbox" },
      { key_prefix: "rb_live_agent", revoked: false, notes: null },
      { key_prefix: "rb_live_hand", revoked: false, notes: null },
      { key_prefix: "rb_live_gone", revoked: true, notes: "rotated" },
    ]);
  });

  it("a key confirmed through the mailbox survives the file being run again (the staged runner re-stamps files)", async () => {
    const t = fresh();
    await open(lg, "dev@example.org", t);
    expect((await issue(lg, t, fresh())).ik_issued).toBe(true);
    await lg.exec(MAIL_DOOR_SQL);
    const live = (await rows<{ owner_email: string }>(lg, "SELECT owner_email FROM public.api_keys WHERE revoked_at IS NULL AND tier = 'free' AND user_id IS NULL")).map((r) => r.owner_email);
    expect(live).toEqual(["dev@example.org"]);
  });

  it("the self-check refuses a database where an old-door key is still live", async () => {
    await lg.exec("BEGIN");
    await lg.query("INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier) VALUES ('L9', 'rb_live_late', 'k', 'late@example.org', 'free')");
    await expect(lg.exec(MAIL_DOOR_VERIFY)).rejects.toThrow(/1 free keys minted without a confirmed mailbox are still live/);
    await lg.exec("ROLLBACK");
  });

  it("what a revoked key's holder is told names the way back", () => {
    const api = readFileSync(resolve(ROOT, "supabase/functions/public-api/index.ts"), "utf8");
    expect(api).toMatch(/"key_revoked", "This key has been revoked\. Get a new one at https:\/\/resumebooster\.work\/data-api/);
    const mcp = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/index.ts"), "utf8");
    expect(mcp).toMatch(/issued before keys needed a confirmed email/);
  });
});

// ── the handler, run ─────────────────────────────────────────────────────────

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const db = new FakeDb();
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const mails: Array<{ to: string[]; subject: string; html: string }> = [];
let handler: EdgeHandler;
function rpc(name: string, impl: (a: Record<string, unknown>) => unknown) {
  db.rpcs[name] = (args) => { calls.push({ name, args }); return { data: impl(args), error: null }; };
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).startsWith("https://api.resend.com/")) { mails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  handler = await loadEdgeHandler("api-key-request", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export const createClient = () => globalThis.__fakeSupabase;",
  });
}, 60_000);

afterEach(() => { calls.length = 0; mails.length = 0; db.rpcs = {}; });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/api-key-request", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));

describe("a request returns no key and mails only the address that asked", () => {
  it("the response carries no key; the mail carries a link whose token hash is what was stored, and none of the requester's text", async () => {
    rpc("api_key_request_open", () => ({ rq_send: true, rq_reason: "sent", rq_live_keys: 0 }));
    const res = await post({ email: " Dev@Example.org ", name: "<a href='https://evil.example'>win</a>" }, { "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text, "a request response carried a key").not.toMatch(/rb_live_|"key"/);
    expect(JSON.parse(text)).toMatchObject({ requested: true });
    const req = calls.find((c) => c.name === "api_key_request_open")!;
    expect(req.args.p_email).toBe("dev@example.org");
    expect(req.args.p_net).toMatch(/^[0-9a-f]{32}$/);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual(["dev@example.org"]);
    expect(mails[0].html).not.toMatch(/evil\.example|win</);
    expect(mails[0].html).not.toMatch(/rb_live_/);
    const token = /\/data-api#confirm=([0-9a-f]{64})"/.exec(mails[0].html)?.[1];
    expect(token, "no confirmation link in the mail").toBeTruthy();
    expect(sha(token!)).toBe(req.args.p_token_hash);
  });

  it("an address that bounced, complained or already had two links today gets the SAME answer as one that was mailed, and no mail", async () => {
    rpc("api_key_request_open", () => ({ rq_send: true, rq_reason: "sent", rq_live_keys: 0 }));
    const mailed = await post({ email: "dev@example.org" });
    const mailedBody = await mailed.text();
    mails.length = 0;
    for (const reason of ["undeliverable", "too_many_requests"]) {
      rpc("api_key_request_open", () => ({ rq_send: false, rq_reason: reason, rq_live_keys: 0 }));
      const res = await post({ email: "target@corp.example" });
      expect(res.status, reason).toBe(mailed.status);
      expect(await res.text(), `${reason} is told apart from a mailed request`).toBe(mailedBody);
    }
    expect(mails).toEqual([]);
    expect(JSON.parse(mailedBody).message).toMatch(/^If that address can receive mail from us/);
  });

  it("a refusal about the caller's network or the day says so, sends nothing, and a ceiling tells the owner once", async () => {
    const cases: Array<[string, number, string]> = [["network_busy", 429, "network_busy"], ["shed", 429, "network_busy"], ["paused", 503, "paused"]];
    const alerts: string[] = [];
    let first = true;
    rpc("mail_door_take", (a) => { alerts.push(String(a.p_bucket)); const due = first; first = false; return due; });
    for (const [reason, status, code] of cases) {
      rpc("api_key_request_open", () => ({ rq_send: false, rq_reason: reason, rq_live_keys: 0 }));
      const res = await post({ email: "dev@example.org" });
      expect(res.status, reason).toBe(status);
      const b = await res.json();
      expect(b.error.code).toBe(code);
      expect(b.error.message.length).toBeGreaterThan(20);
    }
    expect(alerts, "shed and paused each ask whether today's alert is due").toEqual(["api-key-request:request", "api-key-request:request"]);
    expect(mails.map((m) => m.to[0]), "nothing to the address; one alert to the owner").toEqual(["resumeboostersupp@gmail.com"]);
  });

  it("two callers in one /24 share a network, whatever first hop each forges", async () => {
    rpc("api_key_request_open", () => ({ rq_send: false, rq_reason: "network_busy", rq_live_keys: 0 }));
    await post({ email: "a@example.org" }, { "x-forwarded-for": "1.1.1.1, 198.51.100.7" });
    await post({ email: "b@example.org" }, { "x-forwarded-for": "2.2.2.2, 198.51.100.99" });
    const nets = calls.map((c) => c.args.p_net);
    expect(nets[0]).toBe(nets[1]);
  });

  it("a malformed address is refused before anything is recorded", async () => {
    expect((await post({ email: "nope" })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("the link mints the key and shows it once", () => {
  it("redeems the token by its hash and returns a key whose hash and prefix are what was stored", async () => {
    rpc("api_key_issue", () => ({ ik_issued: true, ik_reason: "issued", ik_tier: "free", ik_rate: 60, ik_quota: 1000, ik_retired: ["rb_live_0123abcd"] }));
    const token = "a".repeat(64);
    const res = await post({ action: "confirm", token });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.key).toMatch(/^rb_live_[0-9a-f]{64}$/);
    expect(b).toMatchObject({ shownOnce: true, limits: { perMinute: 60, perDay: 1000 }, retiredPrefixes: ["rb_live_0123abcd"] });
    const c = calls.find((x) => x.name === "api_key_issue")!;
    expect(c.args).toMatchObject({ p_token_hash: sha(token), p_key_hash: sha(b.key), p_key_prefix: b.key.slice(0, 16) });
    expect(c.args.p_net).toMatch(/^[0-9a-f]{32}$/);
    expect(mails, "the key was emailed").toEqual([]);
  });

  it("a busy day's mint refuses a network that already minted (429), a full day everyone (503), and tells the owner", async () => {
    rpc("mail_door_take", () => true);
    rpc("api_key_issue", () => ({ ik_issued: false, ik_reason: "shed" }));
    const shed = await post({ action: "confirm", token: "c".repeat(64) });
    expect(shed.status).toBe(429);
    expect((await shed.json()).error.code).toBe("network_limit");
    rpc("api_key_issue", () => ({ ik_issued: false, ik_reason: "paused" }));
    expect((await post({ action: "confirm", token: "c".repeat(64) })).status).toBe(503);
    expect(calls.filter((c) => c.name === "mail_door_take").map((c) => c.args.p_bucket)).toEqual(["api-key-request:mint", "api-key-request:mint"]);
  });

  it("a malformed token never reaches the mint; a spent one is a 410 with its reason", async () => {
    rpc("api_key_issue", () => ({ ik_issued: false, ik_reason: "already_used" }));
    expect((await post({ action: "confirm", token: "zz" })).status).toBe(400);
    expect(calls).toEqual([]);
    const res = await post({ action: "confirm", token: "b".repeat(64) });
    expect(res.status).toBe(410);
    expect((await res.json()).error.code).toBe("already_used");
  });

  it("the preflight answers its build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/api-key-request", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^api-key-request\.2026-10-04\.\d+$/);
  });
});

describe("the page says what the code does", () => {
  it("no longer claims there are no self-serve keys, or that asking again revokes the old one", () => {
    expect(PAGE_CODE, "the page still says self-serve keys do not exist").not.toMatch(/No self-serve keys yet/);
    expect(PAGE_CODE, "a request never revoked anything after 20260826214700").not.toMatch(/revokes the old one|previous key was revoked/);
    expect(PAGE_CODE, "the function never set `rotated`").not.toMatch(/\brotated\b/);
    expect(PAGE_CODE).toMatch(/api-key-request/);
  });

  it("reads the server's refusal from the non-2xx body, rather than printing its own guess", () => {
    expect(PAGE_CODE).toMatch(/errorBodyOf\(error\)/);
  });

  it("the documented base URL cannot drift from the deployed project", () => {
    expect(PAGE_CODE).toMatch(/const API_BASE = `\$\{import\.meta\.env\.VITE_SUPABASE_URL\}\/functions\/v1\/public-api`/);
  });

  it("the free-tier numbers shown come from the response, not from copy", () => {
    expect(PAGE_CODE).toMatch(/issued\.limits\.perMinute/);
    expect(PAGE_CODE).toMatch(/issued\.limits\.perDay/);
  });

  it("the page states the fences to the people most likely to resell the data", () => {
    expect(PAGE_CODE).toMatch(/already withdrawn/);
    expect(PAGE_CODE).toMatch(/30-day freshness window/);
  });
});
