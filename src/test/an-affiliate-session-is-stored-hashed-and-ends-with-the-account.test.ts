// @vitest-environment node
/**
 * AN AFFILIATE SESSION IS STORED HASHED AND ENDS WITH THE ACCOUNT (S14X-093).
 *
 * WHAT WAS WRONG. affiliate_sessions kept the bearer token itself, so anyone
 * who could read that table (a leaked backup, a mistaken grant) held a live
 * sign-in for every affiliate. And a session outlived its account: pausing or
 * banning an affiliate, or changing the password, left every token open, and
 * get_affiliate_dashboard never looked at the account's status.
 *
 * WHAT HOLDS NOW (run, not read: the affiliate files on main, then this
 * round's affiliate files twice, in pglite from Supabase's default grants):
 *   - the token login answers is stored nowhere: the row holds its sha256;
 *   - a token minted before the change still signs in after it, and its
 *     plaintext is gone from the row;
 *   - pausing or banning the account, or changing its password, deletes
 *     every session; a paused account's token opens nothing even if a row
 *     were left;
 *   - logout ends the session it names.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootAffiliateDb, fromAddress, one, q, roundAffiliateFiles, applyRound } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let db: PGlite;
let oldToken = "";

beforeAll(async () => {
  db = await bootAffiliateDb();
  await fromAddress(db, "203.0.113.5");
  // An affiliate signed in before this round: the token is the old plaintext kind.
  const r = await one<{ j: { session_token: string } }>(db, "SELECT public.register_affiliate('before@example.com', 'correct horse 1') AS j");
  oldToken = r.j.session_token;
  await applyRound(db);
}, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

const login = async (email: string, password: string) =>
  (await one<{ j: Record<string, unknown> }>(db, "SELECT public.login_affiliate($1, $2) AS j", [email, password])).j;
const dashboard = async (token: string) => {
  try {
    return (await one<{ j: Record<string, unknown> }>(db, "SELECT public.get_affiliate_dashboard($1) AS j", [token])).j;
  } catch (e) {
    return { error: String((e as Error).message) };
  }
};
const sessionsText = async () =>
  (await q<{ t: string }>(db, "SELECT row_to_json(s)::text AS t FROM public.affiliate_sessions s")).map((r) => r.t).join("\n");

describe("the token is stored as its hash", () => {
  it("this round's affiliate files are on disk", () => {
    expect(roundAffiliateFiles().length, "no affiliate migration in 20261112120000-20261112129999").toBeGreaterThan(0);
  });

  it("the token login answers appears nowhere in affiliate_sessions; its sha256 does", async () => {
    await fromAddress(db, "203.0.113.5");
    await q(db, "SELECT public.register_affiliate('hash@example.com', 'correct horse 2')");
    const j = await login("hash@example.com", "correct horse 2");
    expect(j.success).toBe(true);
    const token = String(j.session_token);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await sessionsText(), "a bearer token sits in the table in the clear").not.toContain(token);
    const [{ n }] = await q<{ n: number }>(db,
      "SELECT count(*)::int AS n FROM public.affiliate_sessions WHERE token_hash = encode(extensions.digest($1, 'sha256'), 'hex')", [token]);
    expect(n).toBe(1);
    expect(await dashboard(token)).toHaveProperty("affiliate");
  });

  it("a token minted before the change still opens the dashboard, and its plaintext is gone", async () => {
    expect(oldToken).toMatch(/^[0-9a-f]{64}$/);
    expect(await dashboard(oldToken)).toHaveProperty("affiliate");
    expect(await sessionsText()).not.toContain(oldToken);
  });

  it("the column that held tokens can no longer be read back as one: a guessed token opens nothing", async () => {
    expect(await dashboard("ab".repeat(32))).toEqual({ error: expect.stringMatching(/Invalid or expired session/) });
  });
});

describe("a session ends with the account", () => {
  const fresh = async (email: string) => {
    await fromAddress(db, "203.0.113.5");
    await q(db, "SELECT public.register_affiliate($1, 'correct horse 3')", [email]);
    const a = String((await login(email, "correct horse 3")).session_token);
    const b = String((await login(email, "correct horse 3")).session_token);
    const [{ id }] = await q<{ id: string }>(db, "SELECT id FROM public.affiliates WHERE email = $1", [email]);
    return { a, b, id };
  };
  const count = async (id: string) =>
    (await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM public.affiliate_sessions WHERE affiliate_id = $1", [id])).n;

  for (const status of ["banned", "paused"]) {
    it(`setting the account ${status} deletes every one of its sessions`, async () => {
      const s = await fresh(`${status}@example.com`);
      expect(await count(s.id)).toBe(3);
      await q(db, "UPDATE public.affiliates SET status = $2 WHERE id = $1", [s.id, status]);
      expect(await count(s.id), `a ${status} affiliate kept a live sign-in`).toBe(0);
      expect(await dashboard(s.a)).toEqual({ error: expect.stringMatching(/Invalid or expired session/) });
    });
  }

  it("changing the password deletes every session", async () => {
    const s = await fresh("newpass@example.com");
    await q(db, "UPDATE public.affiliates SET password_hash = extensions.crypt('another one 9', extensions.gen_salt('bf')) WHERE id = $1", [s.id]);
    expect(await count(s.id)).toBe(0);
  });

  it("a paused account's unexpired session row opens nothing", async () => {
    const s = await fresh("leftover@example.com");
    await q(db, "ALTER TABLE public.affiliates DISABLE TRIGGER USER");
    try {
      await q(db, "UPDATE public.affiliates SET status = 'paused' WHERE id = $1", [s.id]);
    } finally {
      await q(db, "ALTER TABLE public.affiliates ENABLE TRIGGER USER");
    }
    expect(await count(s.id), "the stand-in kept the rows so the readers are what is tested").toBe(3);
    expect(await dashboard(s.a)).toEqual({ error: expect.stringMatching(/Invalid or expired session/) });
    const clicks = await q(db, "SELECT * FROM public.get_affiliate_clicks($1, 30)", [s.a]).catch((e) => String(e.message));
    expect(clicks).toMatch(/Invalid or expired session/);
  });

  it("logout ends the session it names and no other", async () => {
    const s = await fresh("logout@example.com");
    const [{ ok }] = await q<{ ok: boolean }>(db, "SELECT public.logout_affiliate($1) AS ok", [s.a]);
    expect(ok).toBe(true);
    expect(await dashboard(s.a)).toEqual({ error: expect.stringMatching(/Invalid or expired session/) });
    expect(await dashboard(s.b)).toHaveProperty("affiliate");
  });
});

describe("the new tables and helpers stay closed", () => {
  it("anon and authenticated can read neither the session hashes nor call the owner lookup", async () => {
    const [acl] = await q<Record<string, boolean>>(db, `SELECT
      has_table_privilege('anon', 'public.affiliate_sessions', 'SELECT') AS anon_sessions,
      has_table_privilege('authenticated', 'public.affiliate_sessions', 'SELECT') AS auth_sessions,
      has_function_privilege('anon', 'public.affiliate_session_owner(text)', 'EXECUTE') AS anon_owner,
      has_function_privilege('authenticated', 'public.affiliate_session_owner(text)', 'EXECUTE') AS auth_owner,
      has_function_privilege('service_role', 'public.affiliate_session_owner(text)', 'EXECUTE') AS svc_owner`);
    expect(acl).toEqual({ anon_sessions: false, auth_sessions: false, anon_owner: false, auth_owner: false, svc_owner: true });
  });
});
