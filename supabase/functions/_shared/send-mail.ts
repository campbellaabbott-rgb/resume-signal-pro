/**
 * ONE WAY OUT FOR A MAIL WE SEND THROUGH RESEND, AND ONE LOG ROW PER TRY.
 *
 * Register CP-013: only two senders wrote email_send_log, a refused send was
 * often never read, and nothing could later say which mail a bounce belonged
 * to. sendMail is the transport the auth-mail fallback uses (process-email-queue,
 * when Lovable refuses the sender) and the one later senders move onto. It:
 *
 *   - never throws: every outcome is a value the caller acts on;
 *   - reads the body of a non-2xx answer, so the refusal's reason is logged;
 *   - checks suppressed_emails before a transactional or marketing send.
 *     Auth mail is exempt, as it is in the queue: a sign-in code is security
 *     mail the person asked for a moment ago. A transactional mail is held back
 *     by a bounce or a complaint, never by an unsubscribe from marketing; a
 *     marketing mail by any suppression, and also when the check cannot be read;
 *   - writes ONE email_send_log row per attempt that reached a decision
 *     (suppressed, sent, failed, rate_limited: statuses the CHECK accepted
 *     before 20261014100000). An unset RESEND_API_KEY is not an attempt and
 *     writes nothing; the caller says so in its own row;
 *   - stores Resend's id as provider_message_id only while that column exists
 *     (it arrives with 20261014100000, and this file may deploy first). The id
 *     always goes into the row's metadata as well.
 *
 * Import-free (no npm: or https: imports), so the Node tests import it directly.
 */

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 10_000;

export type MailClass = "auth" | "transactional" | "marketing";

export interface OutgoingMail {
  cls: MailClass;
  /** What the mail is (magiclink, recovery, fix-plan-drip ...): the log row's template_name. */
  kind: string;
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Sent as Resend's Idempotency-Key: a retry with the same key is answered, not mailed again. */
  idempotencyKey?: string;
  timeoutMs?: number;
  /** email_send_log.message_id, so this attempt's row joins the message's earlier rows. */
  messageId?: string;
  /** Extra fields for the log row's metadata (never a secret, never a body). */
  metadata?: Record<string, unknown>;
}

export interface SendResult {
  ok: boolean;
  /** Resend's message id on a 2xx. */
  id: string | null;
  /** The provider's HTTP status; 0 when no answer came (not configured, unreachable, timed out, suppressed). */
  status: number;
  error: string | null;
  suppressed?: boolean;
}

// deno-lint-ignore no-explicit-any
type LogDb = { from: (table: string) => any };

export interface SendDeps {
  /** A service-role client for the suppression check and the log; without one, neither happens. */
  admin?: LogDb | null;
  /** Defaults to RESEND_API_KEY. */
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function envGet(name: string): string | undefined {
  try {
    // deno-lint-ignore no-explicit-any
    const d = (globalThis as any).Deno;
    const v = d?.env?.get?.(name);
    return typeof v === "string" && v ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a suppression row of `reason` holds this class of mail back. */
export function suppressionHolds(cls: MailClass, reason: unknown): boolean {
  if (cls === "auth") return false;
  if (cls === "marketing") return true;
  return reason === "bounce" || reason === "complaint";
}

// provider_message_id arrives with migration 20261014100000. Known present is
// kept for the isolate's life; known absent is asked again after a minute.
let providerColumn: { ok: boolean; at: number } | null = null;

/** Test seam: forget what the last probe learned about the column. */
export function resetProviderColumnProbe(): void {
  providerColumn = null;
}

function isMissingColumn(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code ?? "");
  return code === "42703" || code === "PGRST204" || /provider_message_id/.test(String(e?.message ?? ""));
}

async function hasProviderColumn(admin: LogDb): Promise<boolean> {
  const now = Date.now();
  if (providerColumn && (providerColumn.ok || now - providerColumn.at < 60_000)) return providerColumn.ok;
  try {
    const { error } = await admin.from("email_send_log").select("provider_message_id").limit(1);
    if (!error) providerColumn = { ok: true, at: now };
    else if (isMissingColumn(error)) providerColumn = { ok: false, at: now };
    else return false;
  } catch {
    return false;
  }
  return providerColumn.ok;
}

async function logAttempt(
  admin: LogDb | null,
  row: { messageId: string; kind: string; to: string; status: string; error?: string | null; metadata: Record<string, unknown> },
  providerId: string | null,
): Promise<void> {
  if (!admin) return;
  const base = {
    message_id: row.messageId,
    template_name: row.kind.slice(0, 120) || "mail",
    recipient_email: row.to,
    status: row.status,
    error_message: row.error ? row.error.slice(0, 1000) : null,
    metadata: providerId ? { ...row.metadata, provider_message_id: providerId } : row.metadata,
  };
  try {
    if (providerId && await hasProviderColumn(admin)) {
      const { error } = await admin.from("email_send_log").insert({ ...base, provider_message_id: providerId });
      if (!error) return;
      if (!isMissingColumn(error)) {
        console.warn("[send-mail] log row refused", { status: row.status, code: (error as { code?: string }).code ?? null });
        return;
      }
      providerColumn = { ok: false, at: Date.now() };
    }
    const { error } = await admin.from("email_send_log").insert(base);
    if (error) console.warn("[send-mail] log row refused", { status: row.status, code: (error as { code?: string }).code ?? null });
  } catch (e) {
    console.warn("[send-mail] log write failed", e instanceof Error ? e.message.slice(0, 160) : String(e));
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

/** Send one mail through Resend. Never throws. */
export async function sendMail(mail: OutgoingMail, deps: SendDeps = {}): Promise<SendResult> {
  const admin = deps.admin ?? null;
  const to = String(mail?.to ?? "").trim().toLowerCase();
  const kind = String(mail?.kind ?? "mail");
  const messageId = mail?.messageId || newId();
  const meta = (extra: Record<string, unknown>) => ({ provider: "resend", cls: mail?.cls ?? null, ...(mail?.metadata ?? {}), ...extra });
  try {
    if (!EMAIL_RE.test(to)) {
      await logAttempt(admin, { messageId, kind, to: to || "(none)", status: "failed", error: "no valid recipient address", metadata: meta({}) }, null);
      return { ok: false, id: null, status: 0, error: "invalid_recipient" };
    }

    if (admin && mail.cls !== "auth") {
      let reason: unknown = null;
      let unreadable = false;
      try {
        const { data, error } = await admin.from("suppressed_emails").select("reason").eq("email", to).maybeSingle();
        if (error) unreadable = true;
        else reason = data?.reason ?? null;
      } catch {
        unreadable = true;
      }
      if (unreadable && mail.cls === "marketing") {
        return { ok: false, id: null, status: 0, error: "suppression_unreadable", suppressed: true };
      }
      if (reason != null && suppressionHolds(mail.cls, reason)) {
        await logAttempt(admin, { messageId, kind, to, status: "suppressed", error: `suppressed: ${String(reason)}`, metadata: meta({}) }, null);
        return { ok: false, id: null, status: 0, error: `suppressed: ${String(reason)}`, suppressed: true };
      }
    }

    const apiKey = deps.apiKey ?? envGet("RESEND_API_KEY");
    if (!apiKey) return { ok: false, id: null, status: 0, error: "not_configured" };

    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    if (mail.idempotencyKey) headers["Idempotency-Key"] = mail.idempotencyKey.slice(0, 256);
    const body: Record<string, unknown> = { from: mail.from, to: [to], subject: mail.subject, html: mail.html };
    if (mail.text) body.text = mail.text;
    if (mail.replyTo) body.reply_to = mail.replyTo;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(500, mail.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    let res: Response;
    try {
      res = await (deps.fetchImpl ?? fetch)(RESEND_EMAILS_URL, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      const why = ctl.signal.aborted ? "timed out" : `unreachable: ${e instanceof Error ? e.message : String(e)}`;
      await logAttempt(admin, { messageId, kind, to, status: "failed", error: `resend ${why}`, metadata: meta({ http_status: 0 }) }, null);
      return { ok: false, id: null, status: 0, error: `resend ${why}`.slice(0, 300) };
    }
    clearTimeout(timer);

    const raw = await res.text().catch(() => "");
    let parsed: { id?: unknown; message?: unknown; name?: unknown } | null = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (res.status >= 200 && res.status < 300) {
      const id = typeof parsed?.id === "string" ? parsed.id : null;
      await logAttempt(admin, { messageId, kind, to, status: "sent", metadata: meta({ http_status: res.status }) }, id);
      return { ok: true, id, status: res.status, error: null };
    }

    const reason = String(parsed?.message ?? parsed?.name ?? (raw || `resend answered ${res.status}`)).slice(0, 300);
    await logAttempt(admin, {
      messageId, kind, to,
      status: res.status === 429 ? "rate_limited" : "failed",
      error: `resend ${res.status}: ${reason}`,
      metadata: meta({ http_status: res.status }),
    }, null);
    return { ok: false, id: null, status: res.status, error: reason };
  } catch (e) {
    return { ok: false, id: null, status: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}
