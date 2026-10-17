// deploy-stamp: 2026-10-14T10:00Z
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * RESEND TELLS US WHAT HAPPENED TO A MAIL, AND ONLY RESEND CAN (R1 mail, CP-A
 * item 4; register CP-013: bounces and complaints were never ingested).
 *
 * Resend signs every webhook through Svix: svix-id, svix-timestamp and
 * svix-signature ("v1,<base64 HMAC-SHA256>" entries, space separated) over
 * "<id>.<timestamp>.<raw body>", keyed with the base64 secret after "whsec_".
 * This function:
 *   - refuses everything while RESEND_WEBHOOK_SECRET is unset (503), and any
 *     request whose signature does not verify (401);
 *   - refuses a timestamp more than five minutes from now either way, so a
 *     captured request cannot be replayed later (401);
 *   - records, under Resend's id (email_send_log.provider_message_id):
 *       email.bounced    a 'bounced' row; a permanent bounce suppresses the address
 *       email.complained a 'complained' row; the address is suppressed
 *       email.delivered  delivered_at on the 'sent' row that id names
 *       email.delivery_delayed  delayed_at on that row
 *     Delivered and delayed are stamped on the sent row rather than written as
 *     rows of their own: email_delivery_health counts any status outside its
 *     terminal set as stuck once it is two hours old, so a 'delivered' row
 *     would read as a stalled mail. The status CHECK accepts both
 *     (20261014100000) for the day that reader learns them.
 *   - is idempotent: Svix redelivers until it sees a 2xx, and a second
 *     delivery of the same event writes nothing new.
 * Every other event type is acknowledged and ignored.
 *
 * verify_jwt must be false for this function (Resend sends no JWT); the
 * signature is the authentication.
 */

const FN_BUILD = "resend-webhook.2026-10-14.1";
const HEADERS = {
  "x-fn-build": FN_BUILD,
  "Access-Control-Expose-Headers": "x-fn-build",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, svix-id, svix-timestamp, svix-signature",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "Content-Type": "application/json" } });

/** Svix's default tolerance: five minutes either side of now. */
export const REPLAY_WINDOW_SECONDS = 300;
const MAX_BODY_BYTES = 256 * 1024;

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

type Verdict = { ok: true } | { ok: false; why: string };

/** Svix verification: headers present, timestamp inside the window, one v1 signature matching. */
async function verifySvix(secret: string, h: Headers, body: string, nowSec: number): Promise<Verdict> {
  const id = h.get("svix-id") ?? h.get("webhook-id") ?? "";
  const ts = h.get("svix-timestamp") ?? h.get("webhook-timestamp") ?? "";
  const sigs = h.get("svix-signature") ?? h.get("webhook-signature") ?? "";
  if (!id || !ts || !sigs) return { ok: false, why: "missing svix headers" };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, why: "bad timestamp" };
  if (Math.abs(nowSec - Number(ts)) > REPLAY_WINDOW_SECONDS) return { ok: false, why: "timestamp outside the replay window" };
  let keyBytes: ArrayBuffer;
  try {
    keyBytes = b64ToBuffer(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret);
  } catch {
    return { ok: false, why: "secret is not base64" };
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = bytesToB64(mac);
  for (const part of sigs.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version === "v1" && sig && sameString(sig, expected)) return { ok: true };
  }
  return { ok: false, why: "no signature matched" };
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The recipient addresses an event names, lower-cased; Resend sends `to` as a list. */
function recipientsOf(data: Record<string, unknown>): string[] {
  const raw = Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [];
  return raw
    .map((a) => String(a ?? "").trim().toLowerCase())
    .map((a) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim())
    .filter((a) => EMAIL_RE.test(a));
}

// deno-lint-ignore no-explicit-any
type Db = any;

type SentRow = { id: string; message_id: string | null; template_name: string | null; recipient_email: string | null; metadata: Record<string, unknown> | null };

/** The sent row(s) this Resend id names. A missing column (migration not applied yet) reads as none. */
async function sentRowsFor(db: Db, providerId: string): Promise<SentRow[]> {
  const { data, error } = await db.from("email_send_log")
    .select("id, message_id, template_name, recipient_email, metadata, status")
    .eq("provider_message_id", providerId)
    .eq("status", "sent");
  if (error) {
    console.warn("[resend-webhook] could not read the sent row", { code: error.code ?? null });
    return [];
  }
  return Array.isArray(data) ? data as SentRow[] : [];
}

/** Stamp delivered_at / delayed_at on the sent row(s). Idempotent: the first stamp is kept. */
async function stampSent(db: Db, providerId: string, field: "delivered_at" | "delayed_at", at: string, svixId: string) {
  const rows = await sentRowsFor(db, providerId);
  let stamped = 0;
  for (const r of rows) {
    const meta = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
    if (meta[field]) continue;
    const { error } = await db.from("email_send_log")
      .update({ metadata: { ...meta, [field]: at, last_event: field, last_svix_id: svixId } })
      .eq("id", r.id);
    if (error) throw new Error(`stamp ${field}: ${String(error.message ?? error.code ?? "refused").slice(0, 120)}`);
    stamped++;
  }
  return { matched: rows.length, stamped };
}

/** A bounced or complained row under the Resend id, once per (id, status). */
async function recordTerminal(
  db: Db,
  providerId: string,
  status: "bounced" | "complained",
  recipients: string[],
  detail: { error: string | null; metadata: Record<string, unknown> },
) {
  const { data: already, error: readError } = await db.from("email_send_log")
    .select("id").eq("provider_message_id", providerId).eq("status", status);
  if (readError) throw new Error(`read ${status}: ${String(readError.message ?? readError.code ?? "refused").slice(0, 120)}`);
  if (Array.isArray(already) && already.length > 0) return { inserted: 0 };
  const sent = await sentRowsFor(db, providerId);
  const first = sent[0];
  const to = first?.recipient_email ?? recipients[0] ?? "(unknown)";
  const { error } = await db.from("email_send_log").insert({
    message_id: first?.message_id ?? null,
    template_name: first?.template_name ?? `resend:${status}`,
    recipient_email: to,
    status,
    error_message: detail.error ? detail.error.slice(0, 1000) : null,
    provider_message_id: providerId,
    metadata: detail.metadata,
  });
  if (error) throw new Error(`insert ${status}: ${String(error.message ?? error.code ?? "refused").slice(0, 120)}`);
  return { inserted: 1 };
}

/** suppressed_emails gets the address; an unsubscribe already there is raised to the stronger reason. */
async function suppress(db: Db, email: string, reason: "bounce" | "complaint", metadata: Record<string, unknown>) {
  const { data: existing, error: readError } = await db.from("suppressed_emails").select("reason").eq("email", email).maybeSingle();
  if (readError) throw new Error(`read suppression: ${String(readError.message ?? readError.code ?? "refused").slice(0, 120)}`);
  if (!existing) {
    const { error } = await db.from("suppressed_emails").insert({ email, reason, metadata });
    if (error && error.code !== "23505") throw new Error(`suppress: ${String(error.message ?? error.code).slice(0, 120)}`);
    return "added";
  }
  if (existing.reason === "unsubscribe") {
    const { error } = await db.from("suppressed_emails").update({ reason, metadata }).eq("email", email);
    if (error) throw new Error(`raise suppression: ${String(error.message ?? error.code).slice(0, 120)}`);
    return "raised";
  }
  return "kept";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: HEADERS });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET is not set: every event is refused until it is");
    return reply({ error: "Webhook secret not configured" }, 503);
  }

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) return reply({ error: "Body too large" }, 413);

  const verdict = await verifySvix(secret, req.headers, body, Math.floor(Date.now() / 1000));
  if (!verdict.ok) {
    console.warn("[resend-webhook] refused", { why: verdict.why });
    return reply({ error: "Invalid signature" }, 401);
  }

  let event: { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
  try {
    event = JSON.parse(body);
  } catch {
    return reply({ error: "Invalid JSON" }, 400);
  }
  const type = String(event?.type ?? "");
  const data = (event?.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
  const providerId = typeof data.email_id === "string" && data.email_id ? data.email_id.slice(0, 200) : "";
  const svixId = (req.headers.get("svix-id") ?? req.headers.get("webhook-id") ?? "").slice(0, 120);
  const at = typeof event.created_at === "string" ? event.created_at : new Date().toISOString();

  const known = ["email.delivered", "email.delivery_delayed", "email.bounced", "email.complained"];
  if (!known.includes(type)) return reply({ ok: true, ignored: type || "untyped" });
  if (!providerId) return reply({ ok: true, ignored: "no email_id" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const recipients = recipientsOf(data);
  try {
    if (type === "email.delivered") {
      return reply({ ok: true, event: "delivered", ...(await stampSent(db, providerId, "delivered_at", at, svixId)) });
    }
    if (type === "email.delivery_delayed") {
      return reply({ ok: true, event: "delayed", ...(await stampSent(db, providerId, "delayed_at", at, svixId)) });
    }
    // Suppression first: it needs nothing from 20261014100000, and it is the
    // write that protects the sending domain. Both writes are idempotent, so a
    // redelivery after a failed row write repeats nothing.
    let status: "bounced" | "complained";
    let hard = true;
    let detail: { error: string | null; metadata: Record<string, unknown> };
    if (type === "email.bounced") {
      const bounce = (data.bounce && typeof data.bounce === "object" ? data.bounce : {}) as Record<string, unknown>;
      const bounceType = typeof bounce.type === "string" ? bounce.type : null;
      // Resend reports a bounce as a permanent rejection; when it names a
      // type, only 'Permanent' (a hard bounce) suppresses the address.
      hard = bounceType === null || /^permanent$/i.test(bounceType);
      status = "bounced";
      detail = {
        error: typeof bounce.message === "string" ? bounce.message : `bounced (${bounceType ?? "type not given"})`,
        metadata: { bounce_type: bounceType, bounce_subtype: bounce.subType ?? null, svix_id: svixId, at },
      };
    } else {
      status = "complained";
      detail = { error: "the recipient marked this mail as spam", metadata: { svix_id: svixId, at } };
    }
    let suppressed = 0;
    if (hard) {
      for (const r of recipients) {
        const outcome = await suppress(db, r, status === "bounced" ? "bounce" : "complaint", { source: "resend-webhook", provider_message_id: providerId, ...detail.metadata });
        if (outcome !== "kept") suppressed++;
      }
    }
    const row = await recordTerminal(db, providerId, status, recipients, detail);
    return reply({ ok: true, event: status, hard, ...row, suppressed });
  } catch (e) {
    // A non-2xx makes Svix deliver again later, which is what a failed write needs.
    console.error("[resend-webhook] could not record", { type, error: e instanceof Error ? e.message : String(e) });
    return reply({ error: "Could not record the event" }, 500);
  }
});
