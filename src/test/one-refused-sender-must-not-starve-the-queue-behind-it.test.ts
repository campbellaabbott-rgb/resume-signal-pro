// @vitest-environment node
/**
 * ONE REFUSED SENDER MUST NOT STARVE THE QUEUE BEHIND IT, A DELAYED MAIL IS
 * NOT STALE FOR THE DAYS IT WAS MEANT TO WAIT, AND A DELIVERED MAIL IS NOT
 * STUCK (wave 2 email-ops, register L10-01, L13-39, L10-07, L10-16).
 *
 * WHAT WAS WRONG.
 *   L10-01  Every auth mail and the fix-plan drip send as
 *           notify.resumebooster.work, which lost its DNS. process-email-queue
 *           moved a 403 to the dead-letter queue and then STOPPED the run --
 *           and it reads auth_emails first, so the transactional queue behind
 *           a refused auth mail starved, with no log line naming the sender.
 *   L13-39  The drip is enqueued with delays of 2-14 days but stamped
 *           queued_at = the enqueue time, and the queue drops anything older
 *           than 60 minutes: every drip mail was dead-lettered the moment it
 *           became visible.
 *   L10-07  email_delivery_health counted the hook's 'pending' row as stuck
 *           forever, though the queue wrote a separate 'sent' row for the same
 *           message 1.8 s later.
 *   L10-16  a provider 429 was logged as 'rate_limited', which the status
 *           CHECK refused, so throttling left no trace.
 *
 * WHAT HOLDS NOW: the shipped queue handler, run with the provider and the
 * database faked, moves only the refused message to the DLQ (naming its
 * sender) and sends the rest; ages a delayed message from when it was due;
 * and the migration, applied to pglite, judges a message by its latest row
 * and accepts 'rate_limited'.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bootEmailOpsDb, migration, rows } from "./helpers/email-ops-db";

const SERVICE_JWT = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
const db = new FakeDb();
const attempts: Array<Record<string, unknown>> = [];
const dlq: Array<Record<string, unknown>> = [];
const deleted: number[] = [];
/** The provider's verdict per message id: an error with a status, or undefined for delivered. */
let verdict: (p: Record<string, unknown>) => { status: number; message: string } | undefined = () => undefined;
let queues: Record<string, Array<{ msg_id: number; read_ct: number; message: Record<string, unknown> }>> = {};
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LOVABLE_API_KEY: "lov" };
  g.__fakeSupabase = db;
  g.__peqSend = async (p: Record<string, unknown>) => {
    attempts.push(p);
    const v = verdict(p);
    if (v) throw Object.assign(new Error(`HTTP ${v.status}: ${v.message}`), { status: v.status });
    return { ok: true };
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("process-email-queue", {
    "npm:@lovable.dev/email-js": "export async function sendLovableEmail(p) { return globalThis.__peqSend(p); }",
    "npm:@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
  });
}, 60_000);

afterEach(() => {
  attempts.length = 0; dlq.length = 0; deleted.length = 0;
  db.tables = {}; db.writes = []; db.rpcs = {};
  verdict = () => undefined;
  queues = {};
});

function install() {
  db.rows("email_send_state").push({ id: 1, retry_after_until: null, batch_size: 10, send_delay_ms: 0, auth_email_ttl_minutes: 15, transactional_email_ttl_minutes: 60 });
  db.rpcs.read_email_batch = (a) => ({ data: queues[String(a.queue_name)] ?? [], error: null });
  db.rpcs.delete_email = (a) => { deleted.push(Number(a.message_id)); return { data: true, error: null }; };
  db.rpcs.move_to_dlq = (a) => { dlq.push(a); return { data: 1, error: null }; };
}
const msg = (id: number, extra: Record<string, unknown> = {}) => ({
  msg_id: id, read_ct: 1,
  message: { message_id: `m-${id}`, to: `u${id}@example.com`, from: "Resume Booster <noreply@notify.resumebooster.work>", sender_domain: "notify.resumebooster.work", subject: "s", html: "h", label: "magiclink", queued_at: new Date().toISOString(), ...extra },
});
const run = () => handler(new Request("https://harness.supabase.co/functions/v1/process-email-queue", { method: "POST", headers: { authorization: `Bearer ${SERVICE_JWT}` } }));
const statuses = () => db.rows("email_send_log").map((r) => [r.message_id, r.status]);

describe("L10-01: a 403 dead-letters that message and the run goes on", () => {
  it("a refused auth mail does not stop the auth mails after it, nor the whole transactional queue", async () => {
    install();
    queues = {
      auth_emails: [msg(1), msg(2)],
      transactional_emails: [msg(3, { label: "fix-plan-drip", sender_domain: "resumebooster.work" })],
    };
    verdict = (p) => (p.message_id === "m-1" ? { status: 403, message: "domain not verified" } : undefined);
    const res = await run();
    expect(await res.json()).toEqual({ processed: 2, forbidden: 1 });
    expect(attempts.map((a) => a.message_id), "the run stopped at the first refusal").toEqual(["m-1", "m-2", "m-3"]);
    expect(dlq.map((d) => d.message_id)).toEqual([1]);
    expect(String((statuses().find(([id, s]) => id === "m-1" && s === "dlq") ?? [])[0])).toBe("m-1");
    const dlqRow = db.rows("email_send_log").find((r) => r.status === "dlq")!;
    expect(String(dlqRow.error_message), "the dead-letter row must name the refused sender").toContain("notify.resumebooster.work");
    expect(statuses().filter(([, s]) => s === "sent").map(([id]) => id)).toEqual(["m-2", "m-3"]);
  });

  it("the preflight answers its build", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/process-email-queue", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^process-email-queue\.2026-10-(0[89]|[1-3]\d)\.\d+$/);
  });
});

describe("L13-39: a delayed message is aged from when it was due", () => {
  it("a day-4 drip mail queued four days ago and due a minute ago is sent, not dead-lettered", async () => {
    install();
    const fourDays = new Date(Date.now() - 4 * 86_400_000).toISOString();
    queues = { transactional_emails: [msg(7, { label: "fix-plan-drip", queued_at: fourDays, due_at: new Date(Date.now() - 60_000).toISOString() })] };
    expect(await (await run()).json()).toEqual({ processed: 1 });
    expect(dlq).toEqual([]);
    expect(statuses()).toEqual([["m-7", "sent"]]);
  });

  it("a message with no due time that waited past the TTL is still dead-lettered", async () => {
    install();
    queues = { transactional_emails: [msg(8, { queued_at: new Date(Date.now() - 2 * 3_600_000).toISOString() })] };
    await run();
    expect(attempts).toEqual([]);
    expect(dlq.map((d) => d.message_id)).toEqual([8]);
  });
});

describe("the log, applied to pglite (20261008121000)", () => {
  const ago = (h: number) => `now() - interval '${h} hours'`;
  it("a pending row its own send followed is not stuck; a pending row nothing followed is; a throttle can be written", async () => {
    const pg = await bootEmailOpsDb({ apply: ["20261008121000"] });
    await pg.exec(`INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at) VALUES
      ('delivered', 'magiclink', 'a@example.com', 'pending', ${ago(800)}),
      ('delivered', 'magiclink', 'a@example.com', 'sent', ${ago(799.9)}),
      ('stranded', 'magiclink', 'b@example.com', 'pending', ${ago(5)}),
      ('throttled', 'fix-plan-drip', 'c@example.com', 'rate_limited', ${ago(4)}),
      ('throttled', 'fix-plan-drip', 'c@example.com', 'sent', ${ago(3)}),
      ('gave-up', 'fix-plan-drip', 'd@example.com', 'rate_limited', ${ago(3)})`);
    const r = await rows<{ status: string; n: string; stuck: string }>(pg, "SELECT status, n::text, stuck::text FROM public.email_delivery_health(24) ORDER BY status");
    expect(r).toEqual([
      { status: "pending", n: "1", stuck: "1" },
      { status: "rate_limited", n: "2", stuck: "1" },
      { status: "sent", n: "1", stuck: "0" },
    ]);
    const acl = await rows<{ anon: boolean; svc: boolean }>(pg, "SELECT has_function_privilege('anon', 'public.email_delivery_health(integer)', 'EXECUTE') AS anon, has_function_privilege('service_role', 'public.email_delivery_health(integer)', 'EXECUTE') AS svc");
    expect(acl[0]).toEqual({ anon: false, svc: true });
    await pg.exec(migration("20261008121000"));
  }, 60_000);
});
