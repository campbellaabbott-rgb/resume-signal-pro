// @vitest-environment node
/**
 * A DIGEST SCORES FIT ONLY AGAINST A RESUME ITS OWNER SCANNED (NB-12).
 *
 * WHAT WAS WRONG. A fit-bar alert scores new postings against the account's
 * pinned résumé, user_profiles.matching_scan_id, which the account writes for
 * itself. The digest read that scan with the service role by id alone, so an
 * account that pointed its profile at another person's scan had its alerts
 * scored against that person's résumé.
 *
 * WHAT HOLDS NOW: the pinned scan is read only when it belongs to the alert's
 * owner; otherwise the owner's own latest scan is used, as when nothing is
 * pinned.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ subject: string }> = [];
const db = new FakeDb();
let search: EdgeHandler;
const SID = "5e7a0c1d-5555-4555-8555-555555555555";
const NURSE = "registered nurse acute ward ".repeat(10);
const CODER = "typescript react frontend engineer components ".repeat(10);

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__nb12Sent = sent;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => ({ data: { user: { email: "owner@example.com" } }, error: null }) } };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      const jobs = [{ id: "j1", company: "Acme", title: "Ward nurse", location: "Leeds", applyUrl: "https://acme.example/1", postedAt: null }];
      return new Response(JSON.stringify(b.countOnly ? { total: 1, newSince: b.newSince } : { jobs, newSince: b.newSince }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  // The fallback read of the owner's latest scan filters with .not(col, "is", null).
  const proto = Object.getPrototypeOf(db.from("user_scans")) as Record<string, unknown>;
  if (!proto.not) {
    proto.not = function (this: { preds: Array<(r: Record<string, unknown>) => boolean> }, col: string, op: string, val: unknown) {
      if (op === "is" && val === null) this.preds.push((r) => r[col] != null);
      return this;
    };
  }
  search = await loadEdgeHandler("send-search-digest", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__nb12Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);
afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

async function run(pinned: { id: string; user_id: string; resume_text: string }) {
  let fresh = false;
  db.rpcs.search_digest_claim_batch = () => ({
    data: (fresh = !fresh) ? [{ sd_id: SID, sd_user_id: "owner-1", sd_name: "Nurse jobs", sd_params: { q: "nurse" }, sd_prev_sent_at: "2026-11-01T14:23:00.000Z", sd_fit_threshold: 30, sd_cadence: "weekly" }] : [],
    error: null,
  });
  db.rpcs.search_digest_record_sent = () => ({ data: 1, error: null });
  db.rows("user_job_searches").push({ id: SID, digest_last_sent_at: "2026-11-08T14:23:00.000Z", digest_opt_in: true });
  db.rows("user_profiles").push({ user_id: "owner-1", matching_resume_text: null, matching_scan_id: pinned.id });
  db.rows("user_scans").push(pinned);
  // The owner's own latest scan: a résumé that clears no nursing bar.
  db.rows("user_scans").push({ id: "own-scan", user_id: "owner-1", resume_text: CODER, created_at: "2026-11-02T00:00:00Z" });
  db.rows("job_board_postings").push({ id: "j1", description: "registered nurse acute ward ".repeat(20) });
  const res = await search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
  }));
  return res.json();
}

describe("the pinned résumé", () => {
  it("another person's scan, pinned by the account, is not what the alert is scored against", async () => {
    const body = await run({ id: "someone-elses-scan", user_id: "stranger-9", resume_text: NURSE });
    expect(body, "the run must finish, scoring the owner's own latest scan").toMatchObject({ ok: true, considered: 1 });
    expect(sent, "the alert cleared its bar with a stranger's résumé").toEqual([]);
  });

  it("the account's own pinned scan is still used", async () => {
    const body = await run({ id: "owner-pinned", user_id: "owner-1", resume_text: NURSE });
    expect(body).toMatchObject({ ok: true, sent: 1 });
    expect(sent).toHaveLength(1);
  });
});
