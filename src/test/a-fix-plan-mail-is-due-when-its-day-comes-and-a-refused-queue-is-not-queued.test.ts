// @vitest-environment node
/**
 * A FIX-PLAN MAIL IS DUE WHEN ITS DAY COMES, AND A REFUSED QUEUE IS NOT
 * "QUEUED" (wave 2 email-ops, register L13-39 and the sender half of L10-01).
 *
 * WHAT WAS WRONG. send-scan-report queued the day-2/4/6/14 mails with delays
 * of days but stamped queued_at with the enqueue time, and process-email-queue
 * drops anything older than its 60-minute TTL: each mail was dead-lettered the
 * moment it became visible, so nobody who pressed the button got one. And the
 * enqueue's own answer was never read, so a refused enqueue still told the
 * person "Done. The first email arrives in two days."
 *
 * WHAT HOLDS NOW, by running the shipped handler with the database faked:
 * every queued mail carries due_at = the moment it becomes visible (what the
 * queue now ages from, one-refused-sender-must-not-starve-the-queue-behind-it),
 * and a refused enqueue is a logged 503, never {queued: true}.
 *
 * AND THE RETRY IT ASKS FOR CAN WORK (review of the fix). The once-a-month
 * slot (mail_door_take) is taken before the four enqueues, so a refused
 * enqueue answered "try the button again" while the retry could only answer
 * "already started", and a refusal of the second enqueue left the first
 * queued. Now the sequence is all or none: the mails queued before a refusal
 * are deleted (delete_email), the slot is given back, and only then does the
 * answer ask for another press; an attempt it could not undo says retry:false.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { signDripLink } from "../../supabase/functions/_shared/scan-drip-link";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const db = new FakeDb();
const enqueued: Array<Record<string, unknown>> = [];
let refuse = false;
/** Refuse only the Nth enqueue of a press (1-based). */
let refuseAt: number | null = null;
let deleteFails = false;
let nextMsg = 1;
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-scan-report", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 'em' }, error: null }) }; } }",
  });
}, 60_000);

afterEach(() => { enqueued.length = 0; refuse = false; refuseAt = null; deleteFails = false; db.tables = {}; db.writes = []; db.rpcs = {}; });

function install() {
  // A counting door like mail_door_take: one row per (door, bucket).
  db.rpcs.mail_door_take = (a) => {
    const rows = db.rows("mail_door_counts");
    let row = rows.find((r) => r.door === a.p_door && r.bucket === a.p_bucket);
    if (!row) { row = { door: a.p_door, bucket: a.p_bucket, hits: 0 }; rows.push(row); }
    row.hits = Number(row.hits) + 1;
    return { data: Number(row.hits) <= Number(a.p_max), error: null };
  };
  let n = 0;
  db.rpcs.enqueue_email_delayed = (a) => {
    n++;
    if (refuse || refuseAt === n) return { data: null, error: { message: "permission denied for function enqueue_email_delayed" } };
    const id = nextMsg++;
    enqueued.push({ ...a, msg_id: id });
    return { data: id, error: null };
  };
  db.rpcs.delete_email = (a) => {
    if (deleteFails) return { data: null, error: { message: "queue unavailable" } };
    const i = enqueued.findIndex((e) => e.msg_id === a.message_id);
    if (i >= 0) enqueued.splice(i, 1);
    return { data: i >= 0, error: null };
  };
  return () => { n = 0; };
}
const press = async () => {
  const token = await signDripLink(SERVICE, { email: "jane@example.com", score: 64, reportId: "A1B2C3D4E5F6", steps: [{ step: "Add numbers", minutes: 10, scoreImpact: 6 }] });
  return handler(new Request("https://harness.supabase.co/functions/v1/send-scan-report", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" }, body: JSON.stringify({ action: "confirm-drip", token }),
  }));
};

describe("the four mails are due on their days", () => {
  it("each carries due_at = now + its delay, which is what the queue ages it from", async () => {
    install();
    const t0 = Date.now();
    expect(await (await press()).json()).toEqual({ success: true, queued: true });
    expect(enqueued).toHaveLength(4);
    for (const e of enqueued) {
      const p = e.payload as { due_at?: string; queued_at?: string };
      const delayMs = Number(e.delay_seconds) * 1000;
      expect(typeof p.due_at, "a delayed mail with no due time is aged from its enqueue and dead-lettered").toBe("string");
      expect(Math.abs(Date.parse(p.due_at!) - (t0 + delayMs))).toBeLessThan(5_000);
      expect(Math.abs(Date.parse(p.queued_at!) - t0)).toBeLessThan(5_000);
    }
  });
});

describe("a refused enqueue leaves nothing behind, so the retry it asks for can work", () => {
  it("a refused second mail takes back the first and the month's slot; the next press starts all four", async () => {
    const resetPress = install();
    refuseAt = 2;
    const res = await press();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: "Could not start it right now. Try the button again shortly." });
    expect(enqueued, "the day-2 mail stayed queued from a sequence that never started").toEqual([]);
    refuseAt = null;
    resetPress();
    expect(await (await press()).json(), "the retry the page asked for answered already started").toEqual({ success: true, queued: true });
    expect(enqueued).toHaveLength(4);
  });

  it("an attempt it could not take back does not ask for another press", async () => {
    install();
    refuseAt = 3;
    deleteFails = true;
    const res = await press();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: "Could not start the whole sequence.", retry: false });
  });
});

describe("a refused enqueue is not a started sequence", () => {
  it("answers 503 with the retry sentence, never queued: true", async () => {
    install();
    refuse = true;
    const res = await press();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: "Could not start it right now. Try the button again shortly." });
  });
});
