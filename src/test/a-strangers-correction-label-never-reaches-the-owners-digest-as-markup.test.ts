// @vitest-environment node
/**
 * A STRANGER'S CORRECTION LABEL NEVER REACHES THE OWNER'S DIGEST AS MARKUP
 * (wave 2 email-ops, register L10-18 and the corrections half of L11-01).
 *
 * WHAT WAS WRONG. log_industry_correction is callable with the publishable key
 * and stores both labels as typed (<= 50 characters, lower-cased, trimmed).
 * industry-corrections-digest interpolated them raw into the HTML it mails the
 * owner from reports@resumebooster.work, so p_corrected '<a href=//x.tld>re-
 * verify</a>' arrived as a live link from our own domain. The function also
 * answered any POST, so anyone could make it mail the owner, and its cron job
 * was missing from production.
 *
 * WHAT HOLDS NOW, by running the shipped handler with Resend and the database
 * faked: no key, the publishable key or a wrong cron key is a 401 that reads
 * nothing and sends nothing; the cron key (or the service role) runs it; only
 * pairs whose both labels are industries the correction menu can send are
 * printed, escaped, and the number left out is stated.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const CRON_KEY = "c".repeat(64);
type Sent = { to: string[]; subject: string; html: string };
const sent: Sent[] = [];
const db = new FakeDb();
const calls: string[] = [];
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__icdSent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] } };
  handler = await loadEdgeHandler("industry-corrections-digest", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0":
      "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__icdSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 120_000);

afterEach(() => { sent.length = 0; calls.length = 0; db.rpcs = {}; });

const HOSTILE = '<a href=//x.tld>re-verify</a>';
function install() {
  db.rpcs.email_cron_key_matches = (a) => { calls.push("email_cron_key_matches"); return { data: a.p_key === CRON_KEY, error: null }; };
  db.rpcs.get_industry_correction_stats = () => {
    calls.push("get_industry_correction_stats");
    return { data: [
      { detected: "technology", corrected: "healthcare", corrections: 3 },
      { detected: "technology", corrected: HOSTILE, corrections: 9 },
      { detected: "finance", corrected: "accounting & <b>tax</b>", corrections: 2 },
    ], error: null };
  };
}
const post = (headers: Record<string, string>) =>
  handler(new Request("https://harness.supabase.co/functions/v1/industry-corrections-digest", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ action: "send" }),
  }));

describe("the digest answers the scheduler and our service role, nobody else", () => {
  it("no key, the publishable key, or a wrong cron key: 401, nothing read, nothing sent", async () => {
    install();
    for (const h of [{}, { authorization: "Bearer anon_publishable_key_0123456789abcdef" }, { "x-email-cron": "d".repeat(64) }]) {
      expect((await post(h)).status, JSON.stringify(h)).toBe(401);
    }
    expect(calls.filter((c) => c === "get_industry_correction_stats")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("the cron key runs it", async () => {
    install();
    const res = await post({ "x-email-cron": CRON_KEY });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

describe("only industries anyone can pick are printed, and nothing prints as markup", () => {
  it("drops the pairs with a label outside the known list, says how many, and keeps the real pair", async () => {
    install();
    expect(await (await post({ authorization: `Bearer ${SERVICE}` })).json()).toMatchObject({ sent: true, total: 3, pairs: 1, dropped: 2 });
    const [m] = sent;
    expect(m.html).not.toMatch(/<a href|x\.tld|<b>tax/);
    expect(m.html).toContain("technology");
    expect(m.html).toContain("→ healthcare");
    expect(m.html).toContain("2 pairs naming a label outside the known industry list were left out.");
    expect(m.subject).toBe("Industry detection: 3 corrections this week");
  });
});
