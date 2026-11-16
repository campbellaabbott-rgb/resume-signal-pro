// @vitest-environment node
/**
 * AN AFFILIATE RESETS A PASSWORD BY MAIL AND PROVES THE ADDRESS (S14X-115).
 *
 * WHAT WAS WRONG. An affiliate who forgot the password had no way back in:
 * no reset, no mail, and the sign-up never asked anyone to prove they own the
 * address they typed, so an account could be opened, earn and ask to be paid
 * under somebody else's address. There was no way to sign out other devices,
 * see what the program holds about you, or close the account.
 *
 * WHAT HOLDS NOW, by running the shipped affiliate-account handler against
 * the real SQL (pglite, the affiliate files on main and then this round's;
 * only the mail transport and the HTTP client are faked):
 *   - asking for a reset answers the same whether or not the address has an
 *     account, and mails only an address that has one;
 *   - the link works once, within thirty minutes; it sets the new password,
 *     signs out every session, clears the failed-sign-in count and proves the
 *     address;
 *   - a signed-in affiliate can ask for a confirmation link, change the
 *     address by a link sent to the new one, sign out everywhere, download
 *     what the program holds, and erase the account;
 *   - a change link reaches one address at most three times an hour,
 *     whichever affiliate asks, and one affiliate asks at most five times a
 *     day, so the change form cannot mail a stranger on a loop;
 *   - the function answers its preflight with Access-Control-Max-Age 7200
 *     and its build stamp.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { PgSupabase } from "./helpers/pglite-supabase";
import { bootAffiliateDb, fromAddress, one, q } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

type Mail = { to: string; subject: string; html: string; text?: string; kind: string; cls: string; replyTo?: string; from: string };
const mail: Mail[] = [];
let db: PGlite;
let handler: EdgeHandler;

const DOOR = `
  CREATE TABLE public.mail_door_counts (door text, bucket text, n int, PRIMARY KEY (door, bucket));
  CREATE FUNCTION public.mail_door_take(p_door text, p_bucket text, p_max int, p_window_minutes int) RETURNS boolean LANGUAGE sql AS $$
    INSERT INTO public.mail_door_counts AS c VALUES (p_door, p_bucket, 1)
    ON CONFLICT (door, bucket) DO UPDATE SET n = c.n + 1 RETURNING n <= p_max $$;
`;

beforeAll(async () => {
  db = await bootAffiliateDb({ round: true });
  await db.exec(DOOR);
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_role_key_for_the_harness_0123456789abcdef", RESEND_API_KEY: "re_harness" };
  g.__acctMail = mail;
  g.__pg = new PgSupabase(db);
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("affiliate-account", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__pg;",
    "_shared/send-mail.ts": "export async function sendMail(m) { globalThis.__acctMail.push(m); return { ok: true, id: 'em', status: 200, error: null }; }",
  });
}, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });
beforeEach(() => { mail.length = 0; });

let ipSeq = 0;
// Each call from its own network, so the per-network door is not what a test meets.
const post = async (body: unknown, ip = `10.${(ipSeq++ % 250) + 1}.0.1`) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/affiliate-account", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const register = async (email: string, password = "correct horse 1") => {
  // Each sign-up from its own /24: the round allows ten a day per network.
  await fromAddress(db, `172.16.${(ipSeq++ % 250) + 1}.1`);
  return (await one<{ j: { session_token: string } }>(db, "SELECT public.register_affiliate($1, $2) AS j", [email, password])).j.session_token;
};
const login = async (email: string, password: string, ip = "198.51.100.250") => {
  await fromAddress(db, ip);
  return (await one<{ j: { success: boolean; session_token?: string; error?: string } }>(db, "SELECT public.login_affiliate($1, $2) AS j", [email, password])).j;
};
const linkIn = (m: Mail, kind: string) => {
  const hit = new RegExp(`https://resumebooster\\.work/affiliates#${kind}=([0-9a-f]{64})`).exec(m.html);
  expect(hit, m.html).not.toBeNull();
  expect(m.text ?? "").toContain(hit![0]);
  return hit![1];
};

describe("the preflight", () => {
  it("answers Access-Control-Max-Age 7200 and the build stamp", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/affiliate-account", { method: "OPTIONS" }));
    expect(res.headers.get("access-control-max-age")).toBe("7200");
    expect(res.headers.get("x-fn-build")).toMatch(/^affiliate-account\.\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("a forgotten password", () => {
  it("asking answers the same for an address with no account, and mails nobody", async () => {
    await register("known@example.com");
    const known = await post({ action: "reset-request", email: "Known@Example.com " });
    const unknown = await post({ action: "reset-request", email: "nobody-here@example.com" });
    expect(unknown).toEqual(known);
    expect(known).toEqual({ status: 200, body: { status: "sent" } });
    expect(mail.map((m) => m.to)).toEqual(["known@example.com"]);
    expect(mail[0]).toMatchObject({ cls: "transactional", replyTo: "resumeboostersupp@gmail.com" });
    expect(mail[0].from).toMatch(/@resumebooster\.work>$/);
  });

  it("the link sets the password once, signs out every session, clears the failed count and proves the address", async () => {
    const t1 = await register("reset@example.com");
    for (let i = 0; i < 10; i++) await login("reset@example.com", `wrong ${i}`, "192.0.2.9");
    expect((await login("reset@example.com", "correct horse 1", "192.0.2.9")).success, "ten failures from one address stop it").toBe(false);

    await post({ action: "reset-request", email: "reset@example.com" });
    const token = linkIn(mail[0], "reset");
    const weak = await post({ action: "reset", token, password: "short" });
    expect(weak.status).toBe(400);
    const done = await post({ action: "reset", token, password: "a brand new one 7" });
    expect(done).toEqual({ status: 200, body: { status: "reset" } });

    expect((await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM public.affiliate_sessions s JOIN public.affiliates a ON a.id = s.affiliate_id WHERE a.email = 'reset@example.com'")).n).toBe(0);
    const dash = await q(db, "SELECT public.get_affiliate_dashboard($1)", [t1]).catch((e) => String(e.message));
    expect(dash).toMatch(/Invalid or expired session/);
    expect((await login("reset@example.com", "correct horse 1", "192.0.2.9")).success).toBe(false);
    expect((await login("reset@example.com", "a brand new one 7", "192.0.2.9")).success, "the reset did not clear the failed count").toBe(true);
    const [{ ok }] = await q<{ ok: boolean }>(db, "SELECT email_confirmed_at IS NOT NULL AS ok FROM public.affiliates WHERE email = 'reset@example.com'");
    expect(ok).toBe(true);

    const again = await post({ action: "reset", token, password: "and another one 8" });
    expect(again.status, "a reset link worked twice").toBe(400);
    expect(again.body).toMatchObject({ status: "expired" });
  });

  it("a link older than thirty minutes does nothing", async () => {
    await register("late@example.com");
    await post({ action: "reset-request", email: "late@example.com" });
    const token = linkIn(mail[0], "reset");
    await q(db, "UPDATE public.affiliate_account_links SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    expect((await post({ action: "reset", token, password: "a brand new one 7" })).body).toMatchObject({ status: "expired" });
    expect((await login("late@example.com", "correct horse 1")).success).toBe(true);
  });

  it("asking again replaces the earlier link", async () => {
    await register("twice@example.com");
    await post({ action: "reset-request", email: "twice@example.com" });
    await post({ action: "reset-request", email: "twice@example.com" });
    const [first, second] = [linkIn(mail[0], "reset"), linkIn(mail[1], "reset")];
    expect((await post({ action: "reset", token: first, password: "a brand new one 7" })).body).toMatchObject({ status: "expired" });
    expect((await post({ action: "reset", token: second, password: "a brand new one 7" })).body).toEqual({ status: "reset" });
  });

  it("the link is stored as its hash", async () => {
    await register("hashed-link@example.com");
    await post({ action: "reset-request", email: "hashed-link@example.com" });
    const token = linkIn(mail[0], "reset");
    const all = (await q<{ t: string }>(db, "SELECT row_to_json(l)::text AS t FROM public.affiliate_account_links l")).map((r) => r.t).join("\n");
    expect(all).not.toContain(token);
  });
});

describe("a signed-in affiliate", () => {
  it("confirms the address by a mailed link", async () => {
    const t = await register("confirm@example.com");
    expect(await post({ action: "confirm-request", sessionToken: t })).toEqual({ status: 200, body: { status: "sent" } });
    expect(mail.map((m) => m.to)).toEqual(["confirm@example.com"]);
    expect((await post({ action: "confirm", token: linkIn(mail[0], "confirm") })).body).toEqual({ status: "confirmed" });
    const d = (await one<{ j: { affiliate: { email_confirmed: boolean } } }>(db, "SELECT public.get_affiliate_dashboard($1) AS j", [t])).j;
    expect(d.affiliate.email_confirmed).toBe(true);
  });

  it("changes the address by a link sent to the new one", async () => {
    const t = await register("old-address@example.com");
    await register("taken@example.com");
    expect((await post({ action: "email-change-request", sessionToken: t, newEmail: "new-address@example.com" })).body).toEqual({ status: "sent" });
    expect(mail.map((m) => m.to)).toEqual(["new-address@example.com"]);
    expect((await post({ action: "email-confirm", token: linkIn(mail[0], "email") })).body).toEqual({ status: "changed" });
    expect((await login("new-address@example.com", "correct horse 1")).success).toBe(true);
    mail.length = 0;
    await post({ action: "email-change-request", sessionToken: t, newEmail: "taken@example.com" });
    expect(mail, "a link to take over another affiliate's address was mailed").toEqual([]);
  });

  it("a stranger's address gets at most three change links an hour, whichever affiliate asks and from whichever network", async () => {
    const a = await register("asker-one@example.com");
    const b = await register("asker-two@example.com");
    for (let i = 0; i < 3; i++) {
      expect((await post({ action: "email-change-request", sessionToken: i < 2 ? a : b, newEmail: "Stranger@Example.com" })).body).toEqual({ status: "sent" });
    }
    expect(mail.map((m) => m.to)).toEqual(["stranger@example.com", "stranger@example.com", "stranger@example.com"]);
    const fourth = await post({ action: "email-change-request", sessionToken: b, newEmail: "stranger@example.com" });
    expect(fourth.status, "a fourth link reached the same stranger within the hour").toBe(429);
    expect(mail).toHaveLength(3);
  });

  it("one affiliate asks for at most five address changes a day", async () => {
    const t = await register("restless@example.com");
    for (let i = 0; i < 5; i++) {
      expect((await post({ action: "email-change-request", sessionToken: t, newEmail: `elsewhere-${i}@example.com` })).status).toBe(200);
    }
    const sixth = await post({ action: "email-change-request", sessionToken: t, newEmail: "elsewhere-6@example.com" });
    expect(sixth.status, "a sixth change link went out the same day").toBe(429);
    expect(mail.map((m) => m.to)).not.toContain("elsewhere-6@example.com");
    expect(mail).toHaveLength(5);
  });

  it("signs out everywhere", async () => {
    const t = await register("everywhere@example.com");
    const other = String((await login("everywhere@example.com", "correct horse 1")).session_token);
    expect((await post({ action: "sign-out-everywhere", sessionToken: t })).body).toMatchObject({ status: "signed_out" });
    for (const tok of [t, other]) {
      expect(await q(db, "SELECT public.get_affiliate_dashboard($1)", [tok]).catch((e) => String(e.message))).toMatch(/Invalid or expired session/);
    }
  });

  it("downloads what the program holds about them, and no visitor's details", async () => {
    const t = await register("export@example.com");
    const [{ referral_code: code }] = await q<{ referral_code: string }>(db, "SELECT referral_code FROM public.affiliates WHERE email = 'export@example.com'");
    await fromAddress(db, "192.0.2.77");
    await q(db, "SELECT public.track_affiliate_click($1, NULL, 'Visitor Agent/1.0', 'https://visitor.example/')", [code]);
    const r = await post({ action: "export", sessionToken: t });
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).toContain("export@example.com");
    expect(text).toContain(code);
    expect(text).not.toContain("Visitor Agent");
    expect(text).not.toContain("visitor.example");
    expect(text).not.toContain(t);
  });

  it("erases the account: the address becomes a hash, the password is cleared, every session ends", async () => {
    const t = await register("erase-me@example.com");
    expect((await post({ action: "erase", sessionToken: t })).status, "erase without the confirm word").toBe(400);
    expect((await post({ action: "erase", sessionToken: t, confirm: "ERASE" })).body).toEqual({ status: "erased" });
    const left = await q<{ email: string; status: string }>(db, "SELECT email, status FROM public.affiliates WHERE email LIKE '%erase-me%'");
    expect(left).toEqual([]);
    expect((await login("erase-me@example.com", "correct horse 1")).success).toBe(false);
    expect(await q(db, "SELECT public.get_affiliate_dashboard($1)", [t]).catch((e) => String(e.message))).toMatch(/Invalid or expired session/);
  });

  it("an unknown session is a 401 for every signed-in action", async () => {
    for (const action of ["confirm-request", "email-change-request", "sign-out-everywhere", "export", "erase"]) {
      expect((await post({ action, sessionToken: "ab".repeat(32), newEmail: "x@example.com", confirm: "ERASE" })).status, action).toBe(401);
    }
  });
});
