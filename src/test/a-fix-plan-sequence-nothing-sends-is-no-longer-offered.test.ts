// @vitest-environment node
/**
 * A FIX-PLAN SEQUENCE NOTHING SENDS IS NO LONGER OFFERED (S14X-012, the
 * owner's option B of 2026-11-15; the page's half is in
 * a-confirmation-link-is-redeemed-by-a-click).
 *
 * WHAT WAS WRONG. A sealed report mail with the box ticked carried a "Start my
 * fix-plan emails" button; pressing it queued four mails on
 * transactional_emails and answered queued: true, and the page said the first
 * would arrive in two days. No job drains that queue, so none ever arrived.
 *
 * WHAT HOLDS NOW, on the shipped handler with its network faked: a report mail
 * carries no button whatever the box said; a button from a mail already sent
 * answers queued: false, reason "withdrawn", and queues nothing (a forged or
 * expired one is still refused as before); and migration 20261112163000 takes
 * the stranded fix-plan mails out of the queue and its dead-letter queue,
 * nothing else, twice cleanly, and on a database with no queue at all.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { migrationText } from "./helpers/mail-lists-db";
import { SLOW } from "./helpers/mount-budget";
import { signDripLink } from "../../supabase/functions/_shared/scan-drip-link";
import { FIX_PLAN_SEQUENCE_OFFERED } from "../../supabase/functions/send-scan-report/sequence-offered";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ html: string }> = [];
const db = new FakeDb();
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__s012Sent = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (u: string) => { throw new Error(`unexpected fetch ${u}`); };
  handler = await loadEdgeHandler("send-scan-report", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__s012Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
    // The report mail as free-keyword-scan sealed it: only the seal is stood in for.
    "_shared/scan-mail-seal.ts": "export async function scanMailSealValid() { return true; }",
  });
}, 60_000);
afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

const post = (body: unknown) => handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" }, body: JSON.stringify(body),
}));
const enqueues: unknown[] = [];
const install = () => {
  enqueues.length = 0;
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
  db.rpcs.enqueue_email_delayed = (a) => { enqueues.push(a); return { data: enqueues.length, error: null }; };
  db.rpcs.save_free_scan_lead = () => ({ data: null, error: null });
};

describe("send-scan-report, as shipped", () => {
  it("ships with the sequence withdrawn", () => {
    expect(FIX_PLAN_SEQUENCE_OFFERED).toBe(false);
  });

  it("a button from a mail already sent queues nothing and says the sequence is withdrawn", async () => {
    install();
    const token = await signDripLink(SERVICE, { email: "jane@example.com", score: 64, reportId: "A1B2C3D4E5F6", steps: [{ step: "Add numbers", minutes: 10, scoreImpact: 6 }] });
    const res = await post({ action: "confirm-drip", token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, queued: false, reason: "withdrawn" });
    expect(enqueues, "the withdrawn sequence was queued").toEqual([]);
  });

  it("a forged or expired button is still refused as before", async () => {
    install();
    const res = await post({ action: "confirm-drip", token: "not-a-signed-plan" });
    expect(res.status).toBe(410);
  });

  it("a sealed report mail with the box ticked carries no button", async () => {
    install();
    const res = await post({
      email: "jane@example.com", score: 61, dripOptIn: true, reportId: "A1B2C3D4E5F6", mailSeal: "stood-in",
      fixRoadmap: { totalMinutes: 20, steps: [{ step: "Add numbers to three bullets", minutes: 10, scoreImpact: 6 }] },
    });
    expect(await res.json()).toEqual({ success: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].html).not.toContain("/fix-plan/confirm");
    expect(sent[0].html).not.toContain("Start my fix-plan emails");
    expect(enqueues).toEqual([]);
  });
});

describe("migration 20261112163000", () => {
  let pg: PGlite;
  // The database starts inside beforeAll's minute, not inside the first test's
  // five seconds: on a loaded machine the cold start alone overran it (the
  // 2026-11-18 pre-push, 5,329 ms), and the test then failed for no reason of
  // its own.
  beforeAll(async () => { pg = new PGlite(); await pg.waitReady; }, 60_000);
  afterAll(async () => { await pg?.close(); });
  const PREFIX = "20261112163000_";
  const labels = async (t: string) => (await pg.query<{ l: string }>(`SELECT message->>'label' AS l FROM pgmq.${t} ORDER BY msg_id`)).rows.map((r) => r.l);

  it("on a database with no queue, takes out nothing and does not fail", async () => {
    await expect(pg.exec(migrationText(PREFIX))).resolves.toBeTruthy();
  }, SLOW.timeout);

  it("takes every fix-plan mail out of the queue and its dead-letter queue, and nothing else", async () => {
    await pg.exec(`
      CREATE SCHEMA pgmq;
      CREATE TABLE pgmq.q_transactional_emails (msg_id bigserial PRIMARY KEY, read_ct int NOT NULL DEFAULT 0, enqueued_at timestamptz NOT NULL DEFAULT now(), vt timestamptz NOT NULL DEFAULT now(), message jsonb);
      CREATE TABLE pgmq.q_transactional_emails_dlq (LIKE pgmq.q_transactional_emails INCLUDING ALL);
      CREATE TABLE pgmq.q_auth_emails (LIKE pgmq.q_transactional_emails INCLUDING ALL);
      INSERT INTO pgmq.q_transactional_emails (message) VALUES ('{"label":"fix-plan-drip","to":"a@example.com"}'), ('{"label":"fix-plan-drip","to":"b@example.com"}'), ('{"label":"other","to":"c@example.com"}');
      INSERT INTO pgmq.q_transactional_emails_dlq (message) VALUES ('{"label":"fix-plan-drip","to":"d@example.com"}');
      INSERT INTO pgmq.q_auth_emails (message) VALUES ('{"label":"fix-plan-drip","to":"sign-in@example.com"}');
    `);
    await pg.exec(migrationText(PREFIX));
    expect(await labels("q_transactional_emails")).toEqual(["other"]);
    expect(await labels("q_transactional_emails_dlq")).toEqual([]);
    expect(await labels("q_auth_emails"), "the sign-in queue was touched").toEqual(["fix-plan-drip"]);
    await expect(pg.exec(migrationText(PREFIX))).resolves.toBeTruthy();
  });

  it("names no word the migration runner refuses", () => {
    expect(migrationText(PREFIX)).not.toMatch(/vault|secret|decrypted/i);
  });
});
