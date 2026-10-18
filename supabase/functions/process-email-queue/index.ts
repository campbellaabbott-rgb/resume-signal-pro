// deploy-stamp: 2026-10-17T23:00Z
import { sendLovableEmail } from 'npm:@lovable.dev/email-js'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CUSTOMER_REPLY_TO } from "../_shared/customer-mail.ts";
import { isScheduledCaller } from "../_shared/email-cron.ts";
import { sendMail } from "../_shared/send-mail.ts";

/**
 * THE QUEUE DRAIN, WITH A SECOND WAY OUT FOR A SIGN-IN MAIL (R1 mail, CP-A
 * item 3; owner decision D1: auth mail keeps Lovable's queue, with a Resend
 * fallback when Lovable refuses).
 *
 *   - Callers, behind the gateway's own JWT check (verify_jwt stays TRUE for
 *     this function: Lovable's email setup made, outside our migrations, a
 *     trigger and a job that drain this queue with the vault's
 *     email_queue_service_role_key as their bearer, and that path must keep
 *     working; lead decision B of the third fixer round, 2026-10-12): a JWT
 *     whose role claim is service_role (the gateway verified its signature
 *     before this code ran, so the claim is the platform's word), the
 *     service-role key itself (compared in constant time), OR the vault email
 *     cron key in x-email-cron (email_cron_key_matches, the key every other
 *     email cron sends). Our own drain job (rb-auth-mail-drain, 20261014100000)
 *     posts the vault bearer AND the cron key. Every refusal names this
 *     function in its body (refusedBy) and says whether a cron key was offered
 *     (cronKey), so the cron command can read back ITS OWN refusals from
 *     pg_net and fail its run, and never counts another caller's.
 *   - A caller that names no queue drains sign-in mail only: Lovable's
 *     dispatcher names none, and R1 drains sign-in mail only. The fix-plan
 *     drip in transactional_emails waits for CP-G (its text part, marketing
 *     purpose, seller footer and the apex sender) and is drained only by a
 *     caller that names that queue.
 *   - ONE MESSAGE, ONE SEND, THOUGH TWO DRAINS RUN. read_email_batch is
 *     pgmq.read: FOR UPDATE SKIP LOCKED, and each message read is hidden for
 *     30 seconds (vt), so a second drain started meanwhile reads nothing of
 *     the first's batch. A message back in view after that (a crash between
 *     the send and the delete) is skipped and deleted when its 'sent' log row
 *     exists. And every send hands the provider the payload's idempotency
 *     key, so even a re-send is one mail.
 *   - Every message goes to Lovable first. An auth_emails message Lovable
 *     refuses as a sender (401 or 403), or one that has failed transiently
 *     three times, is sent through Resend (sendMail: From
 *     account@resumebooster.work, reply_to CUSTOMER_REPLY_TO, the payload's
 *     idempotency key) BEFORE anything dead-letters it. When Resend also
 *     fails, a PERMANENT Resend refusal (not configured, a bad recipient, a
 *     4xx other than 408/409/429) dead-letters a sender-refused mail naming
 *     both refusals; a transient one (429 -- Resend's limit is the whole
 *     team's -- a 5xx, a timeout, no answer) leaves it on the queue for the
 *     next tick, until the code inside it expires. A sign-in mail is bounded
 *     by that expiry (its TTL, 15 minutes), not by the retry count, and is
 *     never sent late by either provider.
 *   - A LOVABLE THROTTLE OR HANG NEVER STOPS SIGN-IN MAIL (S13-017, hotfix
 *     2026-10-14.2). A Lovable 429 on an auth mail sends that mail through
 *     Resend at once (Lovable did not take it, so it cannot arrive twice),
 *     and every later auth mail of the run goes straight to Resend. It sets
 *     NO cooldown: email_send_state.retry_after_until is the transactional
 *     queue's alone, and a cooldown in force never stops the auth queue
 *     (rb-auth-mail-drain posts through it too). Before this, one 429 with
 *     Retry-After 3600 stopped the run, set an hour's cooldown that the
 *     cron honoured, and every reset mail queued meanwhile expired into the
 *     dead-letter queue with no Resend try and no alert. Every Lovable send
 *     has a deadline (LOVABLE_SEND_TIMEOUT_MS, 10 s): email-js calls fetch
 *     with no signal, so a hung API held the run until the platform killed
 *     it, before any row was written. A send past its deadline may still
 *     land, so it is a transient failure (a 'failed' row, counted toward
 *     AUTH_FALLBACK_AFTER_FAILURES), and the run's later auth mail, which
 *     Lovable never saw, goes straight to Resend.
 *   - transactional_emails keeps its behaviour (a 429 there still stops the
 *     run and sets the cooldown), except that a hung send now fails after
 *     its deadline as any transient failure does.
 *
 * LOVABLE CAN REGENERATE THIS FILE (its "set up emails" step replaced it on
 * 2026-10-12). The guard
 * src/test/r1-mail-the-queue-takes-the-cron-key-and-falls-back-to-resend.test.ts
 * runs this handler and fails CI if the cron key or the fallback goes missing.
 */

// Provable from outside without a key: every response, the preflight
// included, carries this in x-fn-build.
const FN_BUILD = 'process-email-queue.2026-10-14.2'
const BUILD_HEADERS = { 'x-fn-build': FN_BUILD, 'Access-Control-Expose-Headers': 'x-fn-build' }
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...BUILD_HEADERS } })

const MAX_RETRIES = 5
const DEFAULT_BATCH_SIZE = 10
const DEFAULT_SEND_DELAY_MS = 200
const DEFAULT_AUTH_TTL_MINUTES = 15
const DEFAULT_TRANSACTIONAL_TTL_MINUTES = 60

/** The fallback sender: the apex domain Resend has verified (send.resumebooster.work is its return path). */
export const AUTH_FALLBACK_FROM = 'Resume Booster <account@resumebooster.work>'
/** Transient Lovable failures an auth mail takes before Resend is tried. */
export const AUTH_FALLBACK_AFTER_FAILURES = 3
const AUTH_FALLBACK_TIMEOUT_MS = 8_000
/** How long a Lovable send may take (LOVABLE_SEND_TIMEOUT_MS overrides it, within 50 ms and 30 s). */
export const LOVABLE_SEND_TIMEOUT_MS = 10_000

/** The deadline for one Lovable send. */
export function lovableSendTimeoutMs(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(30_000, Math.max(50, Math.floor(n))) : LOVABLE_SEND_TIMEOUT_MS
}

/**
 * A LOVABLE SEND WITH A DEADLINE. email-js's sendLovableEmail calls fetch with
 * no AbortSignal, so a hung API would hold this run until the platform ended
 * the invocation, before any row recorded the try. Past the deadline this
 * throws an error with status 0 (no HTTP status: never read as a 429, 401 or
 * 403) and timedOut true. The request itself cannot be cancelled and may
 * still land, which is why a timeout counts as a transient failure, never as
 * a refusal.
 */
async function sendLovableWithin(
  payload: Parameters<typeof sendLovableEmail>[0],
  options: Parameters<typeof sendLovableEmail>[1],
  ms: number,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      sendLovableEmail(payload, options),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`Lovable did not answer within ${ms} ms`), { status: 0, timedOut: true })), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function isTimedOut(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { timedOut?: unknown }).timedOut === true
}

/** What every refusal answers: the drain's cron command finds it in pg_net's answers (20261014100000). */
export const REFUSED_BODY = { error: 'Forbidden', refusedBy: 'process-email-queue' }

/** True when the request offered a cron key at all (right or wrong): our own drain always does. */
export function offeredCronKey(h: Headers): boolean {
  return (h.get('x-email-cron') ?? '').length > 0
}

/** The refusal, saying whether a cron key was offered, so the cron counts only its own. */
export function refusal(h: Headers): typeof REFUSED_BODY & { cronKey: boolean } {
  return { ...REFUSED_BODY, cronKey: offeredCronKey(h) }
}

/**
 * The role claim of the bearer the GATEWAY let through. Read without checking
 * the signature, which is right ONLY because this function runs with
 * verify_jwt = true (supabase/config.toml carries no false entry for it, and
 * the R1 ledger test pins that): the platform refused every unsigned or
 * mis-signed token before this code ran. A function behind verify_jwt = false
 * must never trust this.
 */
export function gatewayVerifiedRole(h: Headers): string | null {
  const a = (h.get('authorization') ?? '').trim()
  const m = /^bearer\s+(.+)$/i.exec(a)
  const part = m?.[1]?.trim().split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))))
    return typeof claims?.role === 'string' ? claims.role : null
  } catch {
    return null
  }
}

/** The door behind the gateway: a verified service_role token, the key itself, or the cron key. */
export async function callerMayDrain(h: Headers, admin: Parameters<typeof isScheduledCaller>[1], serviceKey: string): Promise<boolean> {
  if (gatewayVerifiedRole(h) === 'service_role') return true
  return await isScheduledCaller(h, admin, serviceKey)
}

/** The queues this function drains, auth mail first. */
const QUEUES = ['auth_emails', 'transactional_emails']

/** The queues a run drains: the ones its body names, else sign-in mail only (R1; the drip waits for CP-G). */
export function queuesToDrain(body: unknown): string[] {
  const named = (body as { queues?: unknown } | null)?.queues
  if (!Array.isArray(named)) return [QUEUES[0]]
  const pick = QUEUES.filter((q) => named.includes(q))
  return pick.length ? pick : [QUEUES[0]]
}

/**
 * WHETHER RESEND'S REFUSAL WILL STILL STAND AT THE NEXT TICK. Not configured,
 * a recipient it cannot take, or a 4xx that is not a timeout (408), a conflict
 * on the idempotency key (409) or the team-wide rate limit (429): permanent.
 * Anything else (429, a 5xx, a timeout, no answer) passes, so the mail waits
 * on the queue for its next try instead of being dead-lettered by one hiccup.
 */
export function resendRefusalIsPermanent(r: { status: number; error: string | null }): boolean {
  if (r.error === 'not_configured' || r.error === 'invalid_recipient') return true
  return r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 409 && r.status !== 429
}

// Check if an error is a rate-limit (429) response.
// Uses EmailAPIError.status when available (email-js >=0.x with structured errors),
// falls back to parsing the error message for older versions.
function isRateLimited(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 429
  }
  return error instanceof Error && error.message.includes('429')
}

// Check if an error is a forbidden (403) response. Retrying won't help.
// Move straight to DLQ.
function isForbidden(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 403
  }
  return error instanceof Error && error.message.includes('403')
}

// A 401 or 403 from Lovable: it will not send as this sender, so another try
// through Lovable cannot help. For an auth mail that is the cue for Resend.
function isSenderRefusal(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const s = (error as { status: number }).status
    return s === 401 || s === 403
  }
  return error instanceof Error && /\b(401|403)\b/.test(error.message)
}

// Extract Retry-After seconds from a structured EmailAPIError, or default to 60s.
function getRetryAfterSeconds(error: unknown): number {
  if (error && typeof error === 'object' && 'retryAfterSeconds' in error) {
    return (error as { retryAfterSeconds: number | null }).retryAfterSeconds ?? 60
  }
  return 60
}

// Move a message to the dead letter queue and log the reason.
async function moveToDlq(
  supabase: any,
  queue: string,
  msg: { msg_id: number; message: Record<string, unknown> },
  reason: string
): Promise<void> {
  const payload = msg.message
  await (supabase.from('email_send_log').insert({
    message_id: payload.message_id,
    template_name: (payload.label || queue) as string,
    recipient_email: payload.to,
    status: 'dlq',
    error_message: reason,
  }) as any)
  const { error } = await (supabase.rpc('move_to_dlq', {
    source_queue: queue,
    dlq_name: `${queue}_dlq`,
    message_id: msg.msg_id,
    payload,
  }) as any)
  if (error) {
    console.error('Failed to move message to DLQ', { queue, msg_id: msg.msg_id, reason, error })
  }
}

/**
 * SEND ONE QUEUED AUTH MAIL THROUGH RESEND. The reply address is
 * CUSTOMER_REPLY_TO from the environment when it is set, else the payload's,
 * else the shared constant every customer mail carries. The idempotency key is
 * the payload's ('auth:'+run_id from the hook), or one derived from the
 * message id for a message queued before the hook set it. sendMail writes the
 * attempt's email_send_log row under the message's own id, so a 'sent' row
 * supersedes the hook's 'pending' one.
 */
async function sendAuthThroughResend(
  supabase: any,
  payload: Record<string, unknown>,
  why: string,
) {
  const envReplyTo = Deno.env.get('CUSTOMER_REPLY_TO')
  const replyTo = envReplyTo
    ? envReplyTo
    : typeof payload.reply_to === 'string' && payload.reply_to ? payload.reply_to : CUSTOMER_REPLY_TO
  const idempotencyKey = typeof payload.idempotency_key === 'string' && payload.idempotency_key
    ? payload.idempotency_key
    : `auth:${String(payload.message_id ?? payload.run_id ?? '')}`
  return await sendMail(
    {
      cls: 'auth',
      kind: String(payload.label || 'auth_emails'),
      to: String(payload.to ?? ''),
      from: AUTH_FALLBACK_FROM,
      subject: String(payload.subject ?? ''),
      html: String(payload.html ?? ''),
      text: typeof payload.text === 'string' ? payload.text : undefined,
      replyTo,
      idempotencyKey,
      timeoutMs: AUTH_FALLBACK_TIMEOUT_MS,
      messageId: typeof payload.message_id === 'string' ? payload.message_id : undefined,
      metadata: { fallback_from: 'lovable', fallback_reason: why.slice(0, 200) },
    },
    { admin: supabase },
  )
}

/**
 * WHEN A QUEUED MESSAGE IS DUE (register L13-39). The fix-plan drip is
 * enqueued with delays of 2-14 days, and its payload stamps queued_at as the
 * moment it becomes due (send-scan-report since 2026-10-08). Before that it
 * stamped the enqueue time, so every drip mail was older than the 60-minute TTL
 * the moment it became visible and went straight to the dead-letter queue.
 * Aging from `due_at` when a payload carries one keeps either stamp honest.
 */
export function dueAt(payload: Record<string, unknown>, enqueuedAt?: string): string | undefined {
  const due = typeof payload.due_at === 'string' ? payload.due_at : undefined
  const queued = typeof payload.queued_at === 'string' ? payload.queued_at : undefined
  return due ?? queued ?? enqueuedAt
}

/**
 * A NOTICE THE LAW REQUIRES IS NOT MARKETING (wave 3 review). The subscription
 * confirmation and trial reminder (Cal. B&P 17602) and the EU/UK withdrawal
 * acknowledgement ride this queue, and the suppression gate below dropped them
 * for anyone who had unsubscribed from the fix-plan drip. Such a payload sets
 * legal_notice and names one of these labels; it skips an unsubscribe only,
 * never a bounce or a complaint.
 */
export const LEGAL_NOTICE_LABELS: ReadonlySet<string> = new Set([
  'subscription-confirmation',
  'trial-ending',
  'subscription-withdrawal',
])

export function suppressionApplies(payload: Record<string, unknown>, reason: unknown): boolean {
  const legal = payload.legal_notice === true && LEGAL_NOTICE_LABELS.has(String(payload.label ?? ''))
  return !(legal && reason === 'unsubscribe')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: BUILD_HEADERS })
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!apiKey || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return reply({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // THE SECOND DOOR (the gateway's JWT check is the first): a service_role
  // token the gateway verified, the service-role key itself, or the
  // scheduler's cron key (x-email-cron, checked by email_cron_key_matches).
  // The publishable key is every visitor's and opens nothing. The refusal
  // says whether a cron key was offered: only our own drain offers one.
  if (!(await callerMayDrain(req.headers, supabase, supabaseServiceKey))) {
    return reply(refusal(req.headers), 403)
  }

  let requested: unknown = null
  try { requested = await req.json() } catch { /* no body: sign-in mail only */ }
  const queues = queuesToDrain(requested)

  // 1. Check rate-limit cooldown and read queue config. The cooldown is the
  // transactional queue's alone (S13-017): sign-in mail is drained through
  // it, and a Lovable 429 on sign-in mail goes to Resend, never into it.
  const { data: state } = await supabase
    .from('email_send_state')
    .select('retry_after_until, batch_size, send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes')
    .single()

  const cooling = !!state?.retry_after_until && new Date(state.retry_after_until) > new Date()
  if (cooling && !queues.includes('auth_emails')) {
    return reply({ skipped: true, reason: 'rate_limited' })
  }
  const cooled: string[] = []
  const sendTimeoutMs = lovableSendTimeoutMs(Deno.env.get('LOVABLE_SEND_TIMEOUT_MS'))

  const batchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE
  const sendDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS
  const ttlMinutes: Record<string, number> = {
    auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
    transactional_emails: state?.transactional_email_ttl_minutes ?? DEFAULT_TRANSACTIONAL_TTL_MINUTES,
  }

  let totalProcessed = 0
  let forbidden = 0
  let viaResend = 0
  let resendFailed = 0
  let rateLimited = 0
  // Why Lovable is not asked again in this run (S13-017): it answered 429, or
  // a send passed its deadline. The run's later auth mail goes to Resend.
  let lovableOut: string | null = null

  /**
   * ONE AUTH MAIL THROUGH RESEND (D1). Sent: off the queue. Not sent: a mail
   * Lovable refused as a sender (`senderRefusal`) whose Resend refusal is
   * permanent dead-letters, naming both refusals; anything else (a throttle,
   * a transient Resend failure) stays on the queue (vt 30 s) for the next
   * tick, until the code inside it expires.
   */
  const throughResend = async (
    queue: string,
    msg: { msg_id: number; message: Record<string, unknown> },
    why: string,
    senderRefusal: unknown,
    lovableMsg: string,
  ) => {
    const payload = msg.message
    const fb = await sendAuthThroughResend(supabase, payload, why)
    if (fb.ok) {
      viaResend++
      totalProcessed++
      const { error: delError } = await supabase.rpc('delete_email', { queue_name: queue, message_id: msg.msg_id })
      if (delError) {
        console.error('Failed to delete a message Resend sent', { queue, msg_id: msg.msg_id, error: delError })
      }
      return
    }
    if (fb.status !== 0 || fb.error !== 'not_configured') resendFailed++
    const permanent = resendRefusalIsPermanent(fb)
    console.error('Resend fallback did not send the auth mail', { msg_id: msg.msg_id, status: fb.status, error: fb.error, permanent })
    if (senderRefusal && permanent) {
      forbidden++
      await moveToDlq(
        supabase, queue, msg,
        `${isForbidden(senderRefusal) ? 403 : 401} from the provider for sender ${String(payload.sender_domain ?? payload.from ?? 'unknown')}: ${lovableMsg}; Resend fallback: ${fb.error ?? 'refused'}`.slice(0, 1000),
      )
    }
  }

  // 2. Process auth_emails first (priority), then transactional_emails (unless the caller named only auth mail)
  for (const queue of queues) {
    // A provider cooldown holds the transactional queue only (S13-017).
    if (cooling && queue !== 'auth_emails') {
      cooled.push(queue)
      continue
    }
    const { data: messages, error: readError } = await supabase.rpc('read_email_batch', {
      queue_name: queue,
      batch_size: batchSize,
      vt: 30,
    })

    if (readError) {
      console.error('Failed to read email batch', { queue, error: readError })
      continue
    }

    if (!messages?.length) continue

    // Retry budget is based on real send failures, not pgmq read_ct.
    // read_ct increments for every message in a claimed batch, including
    // messages not attempted when a 429 stops processing early.
    const messageIds = Array.from(
      new Set(
        messages
          .map((msg: any) =>
            msg?.message?.message_id && typeof msg.message.message_id === 'string'
              ? msg.message.message_id
              : null
          )
          .filter((id: string | null): id is string => Boolean(id))
      )
    )
    const failedAttemptsByMessageId = new Map<string, number>()
    if (messageIds.length > 0) {
      const { data: failedRows, error: failedRowsError } = await supabase
        .from('email_send_log')
        .select('message_id')
        .in('message_id', messageIds)
        .eq('status', 'failed')

      if (failedRowsError) {
        console.error('Failed to load failed-attempt counters', {
          queue,
          error: failedRowsError,
        })
      } else {
        for (const row of failedRows ?? []) {
          const messageId = row?.message_id
          if (typeof messageId !== 'string' || !messageId) continue
          failedAttemptsByMessageId.set(
            messageId,
            (failedAttemptsByMessageId.get(messageId) ?? 0) + 1
          )
        }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const payload = msg.message
      const failedAttempts =
        payload?.message_id && typeof payload.message_id === 'string'
          ? (failedAttemptsByMessageId.get(payload.message_id) ?? 0)
          : msg.read_ct ?? 0

      // Drop expired messages (TTL exceeded), aged from when each was DUE
      // (dueAt above): a delayed message is not stale for the days it was
      // meant to wait.
      const queuedAt = dueAt(payload ?? {}, msg.enqueued_at)
      if (queuedAt) {
        const ageMs = Date.now() - new Date(queuedAt).getTime()
        const maxAgeMs = ttlMinutes[queue] * 60 * 1000
        if (ageMs > maxAgeMs) {
          console.warn('Email expired (TTL exceeded)', {
            queue,
            msg_id: msg.msg_id,
            queued_at: queuedAt,
            ttl_minutes: ttlMinutes[queue],
          })
          await moveToDlq(supabase, queue, msg, `TTL exceeded (${ttlMinutes[queue]} minutes)`)
          continue
        }
      }

      // Move to DLQ if max failed send attempts reached. A sign-in mail whose
      // age is known is bounded by its TTL instead (the code's expiry): each
      // try writes two 'failed' rows (Lovable's and Resend's), so the count
      // would give up after a minute on a mail whose code lasts fifteen.
      if (failedAttempts >= MAX_RETRIES && !(queue === 'auth_emails' && queuedAt)) {
        await moveToDlq(supabase, queue, msg, `Max retries (${MAX_RETRIES}) exceeded (attempted ${failedAttempts} times)`)
        continue
      }

      // Guard: skip if another worker already sent this message (VT expired race)
      if (payload.message_id) {
        const { data: alreadySent } = await supabase
          .from('email_send_log')
          .select('id')
          .eq('message_id', payload.message_id)
          .eq('status', 'sent')
          .maybeSingle()

        if (alreadySent) {
          console.warn('Skipping duplicate send (already sent)', {
            queue,
            msg_id: msg.msg_id,
            message_id: payload.message_id,
          })
          const { error: dupDelError } = await supabase.rpc('delete_email', {
            queue_name: queue,
            message_id: msg.msg_id,
          })
          if (dupDelError) {
            console.error('Failed to delete duplicate message from queue', { queue, msg_id: msg.msg_id, error: dupDelError })
          }
          continue
        }
      }

      // Suppression gate: honor unsubscribes/bounces/complaints for queued
      // mail. Matters most for delayed sends (the fix-plan drip) — a user who
      // unsubscribes on day 2 must not get the day-4 and day-6 emails that
      // were enqueued before they opted out. Auth emails (password resets)
      // are exempt: they're user-initiated security mail. A notice the law
      // requires passes an unsubscribe, never a bounce (suppressionApplies).
      if (queue !== 'auth_emails') {
        const { data: suppressed } = await supabase
          .from('suppressed_emails')
          .select('email, reason')
          .eq('email', String(payload.to || '').toLowerCase())
          .maybeSingle()
        if (suppressed && suppressionApplies(payload, suppressed.reason)) {
          await supabase.from('email_send_log').insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: 'suppressed',
          })
          await supabase.rpc('delete_email', { queue_name: queue, message_id: msg.msg_id })
          continue
        }
      }

      // LOVABLE IS OUT FOR THE REST OF THIS RUN (S13-017): it answered 429,
      // or a send passed its deadline. This auth mail was never handed to
      // it, so Resend cannot make it arrive twice.
      if (queue === 'auth_emails' && lovableOut) {
        await throughResend(queue, msg, `Lovable not asked: ${lovableOut} earlier in this run`, null, '')
        if (i < messages.length - 1) await new Promise((r) => setTimeout(r, sendDelayMs))
        continue
      }

      try {
        await sendLovableWithin(
          {
            run_id: payload.run_id,
            to: payload.to,
            from: payload.from,
            sender_domain: payload.sender_domain,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
            purpose: payload.purpose,
            // A reply reaches a person (commercial-readiness 2026-10-08, item 3).
            reply_to: typeof payload.reply_to === 'string' && payload.reply_to ? payload.reply_to : CUSTOMER_REPLY_TO,
            label: payload.label,
            idempotency_key: payload.idempotency_key,
            unsubscribe_token: payload.unsubscribe_token,
            message_id: payload.message_id,
          },
          // sendUrl is optional — when LOVABLE_SEND_URL is not set, the library
          // falls back to the default Lovable API endpoint (https://api.lovable.dev).
          // Set LOVABLE_SEND_URL as a Supabase secret to override (e.g. for local dev).
          { apiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') },
          sendTimeoutMs,
        )

        // Log success
        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'sent',
        })

        // Delete from queue
        const { error: delError } = await supabase.rpc('delete_email', {
          queue_name: queue,
          message_id: msg.msg_id,
        })
        if (delError) {
          console.error('Failed to delete sent message from queue', { queue, msg_id: msg.msg_id, error: delError })
        }
        totalProcessed++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('Email send failed', {
          queue,
          msg_id: msg.msg_id,
          read_ct: msg.read_ct,
          failed_attempts: failedAttempts,
          error: errorMsg,
        })

        if (isRateLimited(error)) {
          // 'rate_limited' is a status email_send_log's CHECK accepts since
          // 20261008121000 (register L10-16); before it, this insert was
          // refused, the error was never read, and throttling left no trace.
          const { error: rlLogError } = await supabase.from('email_send_log').insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: 'rate_limited',
            error_message: errorMsg.slice(0, 1000),
          })
          if (rlLogError) console.error('Failed to record the provider throttle', { queue, msg_id: msg.msg_id, error: rlLogError })

          // A SIGN-IN MAIL LOVABLE THROTTLED GOES THROUGH RESEND NOW (S13-017).
          // Lovable did not take it, so it cannot arrive twice. No cooldown is
          // set: one would hold every reset mail queued behind it past its
          // 15-minute code, into the dead-letter queue.
          if (queue === 'auth_emails') {
            rateLimited++
            lovableOut = `Lovable answered 429 (Retry-After ${getRetryAfterSeconds(error)} s)`
            await throughResend(queue, msg, `Lovable rate-limited the send (429): ${errorMsg}`, null, errorMsg)
            if (i < messages.length - 1) await new Promise((r) => setTimeout(r, sendDelayMs))
            continue
          }

          const retryAfterSecs = getRetryAfterSeconds(error)
          await supabase
            .from('email_send_state')
            .update({
              retry_after_until: new Date(
                Date.now() + retryAfterSecs * 1000
              ).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', 1)

          // Stop processing — remaining messages stay in queue (VT expires, retried next cycle)
          return reply({ processed: totalProcessed, stopped: 'rate_limited' })
        }

        // AN AUTH MAIL HAS A SECOND WAY OUT (D1). A sender refusal (401/403)
        // or a third transient failure sends it through Resend before any
        // dead-letter. When Resend fails too, a sender-refused mail
        // dead-letters (naming both refusals) only if Resend's refusal is
        // permanent; a transient one (429, 5xx, a timeout) waits for the next
        // tick, until its TTL. A transient Lovable failure always waits.
        // A send past its deadline is transient (it may still land), and
        // Lovable is not asked again in this run (S13-017).
        if (queue === 'auth_emails' && isTimedOut(error)) lovableOut = `Lovable did not answer within ${sendTimeoutMs} ms`
        const refused = isSenderRefusal(error)
        if (queue === 'auth_emails' && (refused || failedAttempts + 1 >= AUTH_FALLBACK_AFTER_FAILURES)) {
          const why = refused
            ? `Lovable refused sender ${String(payload.sender_domain ?? payload.from ?? 'unknown')}: ${errorMsg}`
            : `Lovable failed ${failedAttempts + 1} times: ${errorMsg}`
          await supabase.from('email_send_log').insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: 'failed',
            error_message: why.slice(0, 1000),
          })
          if (payload?.message_id && typeof payload.message_id === 'string') {
            failedAttemptsByMessageId.set(payload.message_id, failedAttempts + 1)
          }
          // A transient Resend failure leaves the mail on the queue (vt 30 s)
          // for the next tick; only a refusal that will still stand ends it.
          await throughResend(queue, msg, why, refused ? error : null, errorMsg)
          if (i < messages.length - 1) await new Promise((r) => setTimeout(r, sendDelayMs))
          continue
        }

        // A 403 is a refusal of THIS message's sender (register L10-01: the
        // auth mails and the drip send as notify.resumebooster.work, whose DNS
        // was gone). Only this message goes to the DLQ, with the sender named,
        // and the run continues: stopping here left every message behind it --
        // the transactional queue whole, since auth_emails is read first --
        // starved behind one dead domain, with nothing in the log saying why.
        if (isForbidden(error)) {
          forbidden++
          console.error('Email sender refused (403): the sending domain is not accepted by the provider. Re-verify it in Lovable Cloud, or restore its DNS.', {
            queue,
            msg_id: msg.msg_id,
            sender_domain: payload.sender_domain ?? null,
            from: payload.from ?? null,
            label: payload.label ?? null,
            error: errorMsg.slice(0, 300),
          })
          await moveToDlq(supabase, queue, msg, `403 from the provider for sender ${String(payload.sender_domain ?? payload.from ?? 'unknown')}: ${errorMsg}`.slice(0, 1000))
          continue
        }

        // Log non-429 failures to track real retry attempts.
        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'failed',
          error_message: errorMsg.slice(0, 1000),
        })
        if (payload?.message_id && typeof payload.message_id === 'string') {
          failedAttemptsByMessageId.set(payload.message_id, failedAttempts + 1)
        }

        // Non-429 errors: message stays invisible until VT expires, then retried
      }

      // Small delay between sends to smooth bursts
      if (i < messages.length - 1) {
        await new Promise((r) => setTimeout(r, sendDelayMs))
      }
    }
  }

  return reply({
    processed: totalProcessed,
    ...(forbidden ? { forbidden } : {}),
    ...(viaResend ? { viaResend } : {}),
    ...(resendFailed ? { resendFailed } : {}),
    ...(rateLimited ? { rateLimited } : {}),
    ...(cooled.length ? { cooledQueues: cooled } : {}),
  })
})
