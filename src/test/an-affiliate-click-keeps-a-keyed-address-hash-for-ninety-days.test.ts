// @vitest-environment node
/**
 * AN AFFILIATE CLICK KEEPS A KEYED ADDRESS HASH FOR NINETY DAYS (S14X-021).
 *
 * WHAT WAS WRONG. track_affiliate_click stored md5('affiliate-click:' ||
 * address): every IPv4 address hashes in seconds, so the column was a list of
 * visitors' addresses under a thin coat. With no address it stored whatever
 * the browser sent as p_ip_hash, and the browser sent a fingerprint of the
 * visitor's agent, language, screen and time zone. Nothing ever deleted a
 * click, so all of it was kept for ever.
 *
 * WHAT HOLDS NOW (pglite, the affiliate files on main and then this round's,
 * twice, from Supabase's default grants):
 *   - ip_hash is an HMAC under a key held in a table no client role can read:
 *     not the md5 of the address, never the browser's value, and the same
 *     address still gives the same hash so visitors are still counted once;
 *   - a click older than ninety days is deleted by a daily job, and its day
 *     still counts: in the dashboard's total and in get_affiliate_clicks;
 *   - the job's statement_timeout is SET inside its cron command;
 *   - a hash written the old way is re-keyed, so no md5 of an address stays;
 *   - the key table and the day counts refuse anon and authenticated.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyRound, bootAffiliateDb, fromAddress, one, q } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let db: PGlite;
let token = "";
let code = "";
const OLD_MD5_ADDR = "198.51.100.200";

beforeAll(async () => {
  db = await bootAffiliateDb({ cron: true });
  await fromAddress(db, "203.0.113.5");
  const r = await one<{ j: { session_token: string; referral_code: string } }>(db, "SELECT public.register_affiliate('clicks@example.com', 'correct horse 1') AS j");
  code = r.j.referral_code;
  // A click recorded the old way, before this round.
  await fromAddress(db, OLD_MD5_ADDR);
  await q(db, "SELECT public.track_affiliate_click($1, NULL, 'agent', NULL)", [code]);
  await applyRound(db);
  await fromAddress(db, "203.0.113.5");
  token = String((await one<{ j: { session_token: string } }>(db, "SELECT public.login_affiliate('clicks@example.com', 'correct horse 1') AS j")).j.session_token);
}, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

// Each click carries its own referrer and is read back by it. Reading "the newest row" instead
// (ORDER BY created_at DESC, id DESC LIMIT 1) reads another click's row whenever two clicks land inside
// one tick of pglite's millisecond clock: created_at ties and the id is a random uuid, so two different
// addresses could come back with one hash (seen on the push gate, 2026-11-21).
let clicks = 0;
const click = async (ip: string | null, clientHash: string | null = "fingerprint-from-the-browser") => {
  await fromAddress(db, ip);
  const referrer = `https://example.com/?click=${++clicks}`;
  await q(db, "SELECT public.track_affiliate_click($1, $2, 'Mozilla/5.0', $3)", [code, clientHash, referrer]);
  const rows = await q<{ ip_hash: string | null }>(db, "SELECT ip_hash FROM public.affiliate_clicks WHERE referrer = $1", [referrer]);
  expect(rows, `click ${clicks} from ${ip} stored ${rows.length} rows`).toHaveLength(1);
  return rows[0].ip_hash;
};
const md5 = async (s: string) => (await one<{ h: string }>(db, "SELECT md5($1) AS h", [s])).h;

describe("the address is kept as a keyed hash", () => {
  it("is neither the md5 of the address nor the browser's value", async () => {
    const h = await click("192.0.2.44");
    expect(h).not.toBe(await md5("affiliate-click:192.0.2.44"));
    expect(h).not.toBe("fingerprint-from-the-browser");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the same address gives the same hash, so a visitor is still counted once", async () => {
    expect(await click("192.0.2.45")).toBe(await click("192.0.2.45"));
    expect(await click("192.0.2.46")).not.toBe(await click("192.0.2.47"));
  });

  it("with no platform address nothing the browser chose is stored", async () => {
    expect(await click(null)).toBeNull();
  });

  it("a hash written the old way was re-keyed", async () => {
    const old = await md5(`affiliate-click:${OLD_MD5_ADDR}`);
    const [{ n }] = await q<{ n: number }>(db, "SELECT count(*)::int AS n FROM public.affiliate_clicks WHERE ip_hash = $1", [old]);
    expect(n).toBe(0);
  });
});

describe("clicks are kept ninety days, and their days still count", () => {
  it("a 100-day-old click leaves the table, and the dashboard and the history still count its day", async () => {
    const [{ id }] = await q<{ id: string }>(db, "SELECT id FROM public.affiliates WHERE referral_code = $1", [code]);
    await q(db, "INSERT INTO public.affiliate_clicks (affiliate_id, ip_hash, created_at) VALUES ($1, 'x', now() - interval '100 days'), ($1, 'y', now() - interval '100 days')", [id]);
    const before = (await one<{ j: { stats: { total_clicks: number } } }>(db, "SELECT public.get_affiliate_dashboard($1) AS j", [token])).j.stats.total_clicks;

    await q(db, "SELECT public.affiliate_clicks_roll_up_and_prune(90)");
    const [{ n }] = await q<{ n: number }>(db, "SELECT count(*)::int AS n FROM public.affiliate_clicks WHERE created_at < now() - interval '90 days'");
    expect(n, "a click older than ninety days was kept").toBe(0);

    const after = (await one<{ j: { stats: { total_clicks: number } } }>(db, "SELECT public.get_affiliate_dashboard($1) AS j", [token])).j.stats.total_clicks;
    expect(after).toBe(before);
    const hist = await q<{ click_date: string; click_count: number }>(db, "SELECT click_date::text, click_count::int FROM public.get_affiliate_clicks($1, 365)", [token]);
    const day = hist.find((h) => h.click_date === new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10));
    expect(day?.click_count, JSON.stringify(hist)).toBe(2);
    // Running it again moves nothing twice.
    await q(db, "SELECT public.affiliate_clicks_roll_up_and_prune(90)");
    const again = (await one<{ j: { stats: { total_clicks: number } } }>(db, "SELECT public.get_affiliate_dashboard($1) AS j", [token])).j.stats.total_clicks;
    expect(again).toBe(before);
  });

  it("refuses a window shorter than thirty days", async () => {
    await expect(q(db, "SELECT public.affiliate_clicks_roll_up_and_prune(5)")).rejects.toThrow();
  });

  it("runs daily from pg_cron with its statement_timeout SET in the command", async () => {
    const jobs = await q<{ schedule: string; command: string }>(db, "SELECT schedule, command FROM cron.job WHERE jobname = 'affiliate-clicks-prune'");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].command).toMatch(/^SET statement_timeout = '\d+min'; SELECT public\.affiliate_clicks_roll_up_and_prune\(90\);$/);
    expect(jobs[0].schedule.split(" ").slice(2)).toEqual(["*", "*", "*"]);
  });
});

describe("the key and the day counts are closed", () => {
  it("refuse anon and authenticated", async () => {
    const [acl] = await q<Record<string, boolean>>(db, `SELECT
      has_table_privilege('anon', 'public.affiliate_hash_keys', 'SELECT') AS anon_keys,
      has_table_privilege('authenticated', 'public.affiliate_hash_keys', 'SELECT') AS auth_keys,
      has_table_privilege('anon', 'public.affiliate_click_days', 'SELECT') AS anon_days,
      has_table_privilege('authenticated', 'public.affiliate_click_days', 'SELECT') AS auth_days,
      has_function_privilege('anon', 'public.affiliate_clicks_roll_up_and_prune(integer)', 'EXECUTE') AS anon_prune,
      has_table_privilege('anon', 'public.affiliate_clicks', 'SELECT') AS anon_clicks`);
    expect(acl).toEqual({ anon_keys: false, auth_keys: false, anon_days: false, auth_days: false, anon_prune: false, anon_clicks: false });
  });
});
