// @vitest-environment node
/**
 * A SAVED SEARCH'S NAME, IN A DIGEST, CARRIES NO WAY TO REACH ANYONE (NB-2,
 * the hardening half; the confirm-link and one-digest-per-inbox design waits
 * for the owner).
 *
 * WHAT WAS WRONG. A saved search's name and its free-text query are whatever
 * the account typed, and with email confirmation off the address the digest
 * goes to need never have been proven. The digest printed both whole, in the
 * subject and the body of a mail from our domain: "Your account is locked,
 * call +1 415 555 0100 or visit secure-rb-billing.com" went out as written.
 *
 * WHAT HOLDS NOW, on the shipped handler with the database faked: the name in
 * the subject, the header line and the lead, and the query in a plain
 * subject, have every link, bare domain, address and phone number taken out
 * and are at most 80 characters; a name that was nothing else reads "Saved
 * search"; an ordinary name is printed as it was.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ subject: string; html: string }> = [];
const db = new FakeDb();
let search: EdgeHandler;
const SID = "5e7a0c1d-4444-4444-8444-444444444444";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__nb2Sent = sent;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => ({ data: { user: { email: "someone@example.com" } }, error: null }) } };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      const jobs = [{ id: "j1", company: "Acme", title: "Ward nurse", location: "Leeds", applyUrl: "https://acme.example/1", postedAt: null }];
      return new Response(JSON.stringify(b.countOnly ? { total: 1, newSince: b.newSince } : { jobs, newSince: b.newSince }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  search = await loadEdgeHandler("send-search-digest", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__nb2Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);
afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

async function runWith(name: string, params: Record<string, unknown>) {
  let fresh = false;
  db.rpcs.search_digest_claim_batch = () => ({
    data: (fresh = !fresh) ? [{ sd_id: SID, sd_user_id: "u-1", sd_name: name, sd_params: params, sd_prev_sent_at: "2026-11-01T14:23:00.000Z", sd_fit_threshold: 0, sd_cadence: "weekly" }] : [],
    error: null,
  });
  db.rpcs.search_digest_record_sent = () => ({ data: 1, error: null });
  db.rows("user_job_searches").push({ id: SID, digest_last_sent_at: "2026-11-08T14:23:00.000Z", digest_opt_in: true });
  await search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
  }));
  expect(sent).toHaveLength(1);
  return sent[0];
}

const LURE = "Your account is locked, call +1 415 555 0100 or visit secure-rb-billing.com/restore or mail help@rb-billing.net now";
const REACH = /555|secure-rb-billing|rb-billing\.net|help@|https?:\/\//;

describe("the digest", () => {
  it("prints a lure's words without its number, domain or address, in the subject and the body", async () => {
    const m = await runWith(LURE, {});
    expect(m.subject, m.subject).not.toMatch(REACH);
    expect(m.subject).toContain("Your account is locked");
    const body = m.html.replace(/<a [^>]*href="[^"]*"/g, "<a");
    expect(body).toContain("Your account is locked");
    const named = body.split("Your account is locked").slice(1).map((s) => s.slice(0, 120)).join(" | ");
    expect(named, named).not.toMatch(REACH);
  });

  it("clips a name to 80 characters", async () => {
    const m = await runWith("Nurse ".repeat(40).trim(), {});
    const name = /— (.*)$/.exec(m.subject)?.[1] ?? "";
    expect(name.length, m.subject).toBeLessThanOrEqual(80);
    expect(name.startsWith("Nurse Nurse")).toBe(true);
  });

  it("strips a free-text query that names a way to reach someone from a plain subject", async () => {
    const m = await runWith("Nurse jobs", { q: "call 0800 555 0199 now" });
    expect(m.subject, m.subject).not.toMatch(/555/);
    expect(m.subject).toMatch(/Nurse jobs$/);
  });

  it("a name that was nothing but a link reads as a saved search", async () => {
    const m = await runWith("https://secure-rb-billing.com/restore", {});
    expect(m.subject, m.subject).not.toMatch(REACH);
    expect(m.subject).toMatch(/— Saved search$/);
  });

  it("an ordinary name is printed as it was", async () => {
    const m = await runWith("Node.js developer in Leeds", { q: "node.js" });
    expect(m.subject).toMatch(/node\.js .*— Node\.js developer in Leeds$/);
    expect(m.html).toContain("Node.js developer in Leeds");
  });
});
