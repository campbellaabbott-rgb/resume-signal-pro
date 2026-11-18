// @vitest-environment node
/**
 * A DIGEST DATES A POSTING BY THE CALENDAR DAY, AND NOT A RE-DATED ONE
 * (S14X-172, and the digest half of S14X-252).
 *
 * WHAT WAS WRONG. The saved-search digest printed Math.round of the elapsed
 * days, so a posting dated today (a date-only stamp, or midnight UTC) read
 * "posted yesterday" in every mail sent after noon UTC, the 14:23 run
 * included. And it printed an age for Breezy, Paylocity and UKG postings,
 * whose feed date moves whenever the employer edits them, where the board's
 * cards print none.
 *
 * WHAT HOLDS NOW: send-search-digest/posted.ts counts whole UTC calendar days
 * and prints no age for the re-dating systems; its list of those systems is
 * the board's own (src/lib/listing/age.ts), pinned here, so a change to one
 * fails until the other follows.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { REDATING_SOURCES as BOARD_LIST } from "@/lib/listing/age";
import { REDATING_SOURCES, postedDaysAgo } from "../../supabase/functions/send-search-digest/posted.ts";

const AT_RUN = new Date("2026-11-08T14:23:00Z");

describe("posted.ts", () => {
  it("a posting dated today reads today all day, whatever the hour of the stamp", () => {
    expect(postedDaysAgo({ id: "greenhouse:acme:1", postedAt: "2026-11-08" }, AT_RUN)).toBe(0);
    expect(postedDaysAgo({ id: "greenhouse:acme:1", postedAt: "2026-11-08T00:00:00Z" }, AT_RUN)).toBe(0);
    expect(postedDaysAgo({ id: "greenhouse:acme:1", postedAt: "2026-11-08T13:59:00Z" }, AT_RUN)).toBe(0);
  });

  it("counts whole calendar days back, and a future day is today", () => {
    expect(postedDaysAgo({ id: "greenhouse:acme:1", postedAt: "2026-11-07T23:59:00Z" }, AT_RUN)).toBe(1);
    expect(postedDaysAgo({ id: "greenhouse:acme:1", postedAt: "2026-11-01" }, AT_RUN)).toBe(7);
    expect(postedDaysAgo({ id: "workday:acme~wd3~AU:R1", postedAt: "2026-11-09" }, AT_RUN)).toBe(0);
  });

  it("prints no age for a system that moves its date, named by its source or by its id", () => {
    expect(postedDaysAgo({ id: "x:1", source: "breezy", postedAt: "2026-11-08" }, AT_RUN)).toBeNull();
    expect(postedDaysAgo({ id: "x:1", source: "Paylocity", postedAt: "2026-11-01" }, AT_RUN)).toBeNull();
    expect(postedDaysAgo({ id: "ukg:acme~client:R1", postedAt: "2026-11-01" }, AT_RUN)).toBeNull();
    expect(postedDaysAgo({ id: "breezy:veev:abc", source: null, postedAt: "2026-11-01" }, AT_RUN)).toBeNull();
  });

  it("prints no age for a stamp that is not a date", () => {
    for (const postedAt of [null, undefined, "", "soon", "08/11/2026"]) {
      expect(postedDaysAgo({ id: "greenhouse:acme:1", postedAt }, AT_RUN)).toBeNull();
    }
  });

  it("names the same re-dating systems as the board's cards", () => {
    expect([...REDATING_SOURCES]).toEqual([...BOARD_LIST]);
  });
});

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ html: string }> = [];
const db = new FakeDb();
let search: EdgeHandler;
let jobs: unknown[] = [];
const SID = "5e7a0c1d-4444-4444-8444-444444444444";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__s172Sent = sent;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => ({ data: { user: { email: "seeker@example.com" } }, error: null }) } };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      return new Response(JSON.stringify(b.countOnly ? { total: jobs.length, newSince: b.newSince } : { jobs, newSince: b.newSince }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  search = await loadEdgeHandler("send-search-digest", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__s172Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);
afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; jobs = []; });

describe("the mail", () => {
  it("a Breezy posting the board rows carry by source prints no 'posted' age; a dated one does", async () => {
    const today = new Date().toISOString().slice(0, 10);
    jobs = [
      { id: "breezy:veev:abc", source: "breezy", company: "Veev", title: "Edited role", location: "Remote", applyUrl: "https://veev.example/1", postedAt: today },
      { id: "greenhouse:acme:1", source: "greenhouse", company: "Acme", title: "Dated role", location: "Leeds", applyUrl: "https://acme.example/1", postedAt: today },
    ];
    let fresh = false;
    db.rpcs.search_digest_claim_batch = () => ({
      data: (fresh = !fresh) ? [{ sd_id: SID, sd_user_id: "u-1", sd_name: "Roles", sd_params: { q: "role" }, sd_prev_sent_at: "2026-11-01T14:23:00.000Z", sd_fit_threshold: 0, sd_cadence: "weekly" }] : [],
      error: null,
    });
    db.rpcs.search_digest_record_sent = () => ({ data: 2, error: null });
    db.rows("user_job_searches").push({ id: SID, digest_last_sent_at: "2026-11-08T14:23:00.000Z", digest_opt_in: true });
    await search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
    }));
    expect(sent).toHaveLength(1);
    const html = sent[0].html;
    const veev = html.slice(html.indexOf("Edited role"), html.indexOf("Dated role"));
    expect(veev, "a re-dated posting printed an age").not.toMatch(/posted/);
    expect(html.slice(html.indexOf("Dated role")), "a posting dated today read as yesterday").toMatch(/· posted today</);
  });
});
