// deploy-stamp: 2026-10-14T10:00Z
import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { parseEmailWebhookPayload } from 'npm:@lovable.dev/email-js'
import { WebhookError, verifyWebhookRequest } from 'npm:@lovable.dev/webhooks-js'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { EmailChangeNoticeEmail } from '../_shared/email-templates/email-change-notice.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'
import { DEFAULT_EXPIRY_MINUTES } from '../_shared/email-templates/auth-parts.tsx'
import { type AuthMailLanguage, authMailLanguage, authStrings } from '../_shared/email-templates/auth-strings.ts'

/**
 * THE AUTH HOOK: LOVABLE'S SIGNED CONTRACT, PLUS THE CODE AND A LINK A SCANNER
 * CANNOT SPEND (R1 mail, register CP-010 / CP-009).
 *
 * Kept exactly as Lovable scaffolds it: the x-lovable-signature check against
 * LOVABLE_API_KEY (verifyWebhookRequest with parseEmailWebhookPayload),
 * payload version '1', a run_id, and an enqueue to auth_emails from the
 * Lovable-verified noreply@notify.resumebooster.work for process-email-queue
 * to drain. What is ours:
 *
 *   1. every template prints payload.data.token (the code) above the button,
 *      with its expiry and the "ignore it" line;
 *   2. the button opens https://resumebooster.work/auth?mode=confirm with the
 *      token hash parsed out of payload.data.url and the action type, so the
 *      link signs in only when the person presses Continue there (a mail
 *      scanner's GET spends nothing). payload.data.url is used only when no
 *      hash parses out of it;
 *   3. each queued mail carries idempotency_key 'auth:'+run_id, which the
 *      queue hands to Lovable and, on a fallback, to Resend;
 *   4. email_change: the link goes ONLY to payload.data.email; the other
 *      address gets a notice with no link (and the payload's key set, never
 *      its values, is logged so the fan-out shape can be read from the logs);
 *   5. the page's own redirect (redirect_to in the link GoTrue built) is read
 *      back: its safe `next` rides the confirm link, so a link opened on
 *      another device lands where the sign-in was headed (S12-178), and its
 *      `lng` picks the language every template is written in (S12-180).
 *
 * LOVABLE CAN REGENERATE THIS FILE (its "set up emails" step does). The guard
 * src/test/r1-mail-the-hook-prints-the-code-and-a-link-a-scanner-cannot-spend.test.ts
 * runs this handler and fails CI if any of the four goes missing.
 */

// Provable from outside without a key: every response, the preflight
// included, carries this in x-fn-build.
const FN_BUILD = 'auth-email-hook.2026-10-14.1'

const corsHeaders = {
  'x-fn-build': FN_BUILD,
  'Access-Control-Expose-Headers': 'x-fn-build',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-lovable-signature, x-lovable-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited",
  magiclink: 'Your sign-in code',
  recovery: 'Reset your password',
  email_change: 'Confirm your email change',
  reauthentication: 'Your verification code',
}
const EMAIL_CHANGE_NOTICE_SUBJECT = 'An email change was requested on your account'

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration. SITE_NAME is the From display name and the product name in
// every auth template, so it is the name every other mail of ours uses -- it
// was the internal repository name (register L10-09).
const SITE_NAME = "Resume Booster"
const SENDER_DOMAIN = "notify.resumebooster.work"
const ROOT_DOMAIN = "resumebooster.work"
const FROM_DOMAIN = "notify.resumebooster.work" // Domain shown in From address (may be root or sender subdomain)

/** Our confirm page. It reads token_hash and type and signs in on the Continue button. */
const CONFIRM_PAGE = `https://${ROOT_DOMAIN}/auth`

/** The action types whose link GoTrue's verifyOtp({token_hash, type}) accepts. */
const LINK_TYPES: ReadonlySet<string> = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change'])

/** How long the code lasts, as the owner sets it (Email OTP expiration 900 s; AUTH_CODE_EXPIRY_MINUTES overrides). */
function expiryMinutes(): number {
  const n = Number(Deno.env.get('AUTH_CODE_EXPIRY_MINUTES') ?? '')
  return Number.isInteger(n) && n >= 1 && n <= 1440 ? n : DEFAULT_EXPIRY_MINUTES
}

/** The code GoTrue issued, when it is one: digits only (Lovable's OTP length is 4-8). */
function codeOf(token: unknown): string | null {
  return typeof token === 'string' && /^\d{4,10}$/.test(token) ? token : null
}

/**
 * The token hash GoTrue put in the link it built, or null. GoTrue's verify
 * link carries the hash as `token` (a pkce_ prefix included when PKCE is on);
 * a payload that names token_hash directly is read first. The six-digit code
 * itself is never a hash.
 */
function tokenHashOf(data: Record<string, unknown>): string | null {
  const candidates: unknown[] = [data.token_hash]
  if (typeof data.url === 'string') {
    try {
      const u = new URL(data.url)
      candidates.push(u.searchParams.get('token_hash'), u.searchParams.get('token'))
    } catch {
      // not a URL: no hash in it
    }
  }
  const code = typeof data.token === 'string' ? data.token : ''
  for (const c of candidates) {
    if (typeof c === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(c) && c !== code) return c
  }
  return null
}

/**
 * THE PAGE'S OWN REDIRECT, READ BACK FROM THE LINK (S12-178, S12-180). The
 * sign-in page asks for a link that returns to /auth?mode=confirm&next=...&lng=..
 * (AuthContext.confirmRedirect), and GoTrue puts that redirect in the link it
 * builds (redirect_to). The payload carries nothing else of the page's, so
 * where the person was headed and the language they read are taken from it.
 */
export function redirectOf(data: Record<string, unknown>): URL | null {
  const candidates: unknown[] = [data.redirect_to]
  if (typeof data.url === 'string') {
    try { candidates.push(new URL(data.url).searchParams.get('redirect_to')) } catch { /* not a URL */ }
  }
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue
    try { return new URL(c) } catch { /* not a URL */ }
  }
  return null
}

/** The same-origin path rule the sign-in page uses (src/lib/auth-fragment.ts safeNextPath), else null. */
export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\s]/.test(s) || /^\/[^/?#]*:/.test(s)) return null
  return s === '/account' ? null : s
}

/** The button's target: our confirm page with the hash (and the page's next), or GoTrue's own link when no hash parses. */
function confirmLinkFor(data: Record<string, unknown>, actionType: string): string {
  const hash = tokenHashOf(data)
  if (hash && LINK_TYPES.has(actionType)) {
    const u = new URL(CONFIRM_PAGE)
    u.searchParams.set('mode', 'confirm')
    u.searchParams.set('token_hash', hash)
    u.searchParams.set('type', actionType)
    // A link opened on another device still lands where the sign-in was headed.
    const next = safeNext(redirectOf(data)?.searchParams.get('next'))
    if (next) u.searchParams.set('next', next)
    return u.toString()
  }
  if (typeof data.url === 'string' && /^https:\/\//i.test(data.url)) return data.url
  return CONFIRM_PAGE
}

const norm = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '')

/** a***@example.com: enough for the owner of the address to recognise it, too little to harvest. */
function maskEmail(addr: string): string {
  const at = addr.indexOf('@')
  if (at < 1) return '***'
  return `${addr[0]}***${addr.slice(at)}`
}

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://resume-signal-pro.lovable.app"
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
    token: '123456',
    expiryMinutes: DEFAULT_EXPIRY_MINUTES,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
    token: '123456',
    expiryMinutes: DEFAULT_EXPIRY_MINUTES,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
    token: '123456',
    expiryMinutes: DEFAULT_EXPIRY_MINUTES,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
    token: '123456',
    expiryMinutes: DEFAULT_EXPIRY_MINUTES,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
    token: '123456',
    expiryMinutes: DEFAULT_EXPIRY_MINUTES,
  },
  reauthentication: {
    token: '123456',
    expiryMinutes: DEFAULT_EXPIRY_MINUTES,
  },
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'x-fn-build': FN_BUILD,
    'Access-Control-Expose-Headers': 'x-fn-build',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]

  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** One mail the hook puts on the queue. */
interface QueuedMail {
  to: string
  label: string
  subject: string
  template: React.ComponentType<any>
  props: Record<string, unknown>
  idempotencyKey: string
  /** The link mail must queue or the hook answers 500; a notice that fails is logged and the hook goes on. */
  required: boolean
}

/**
 * The mails one auth event becomes. One, except email_change: the link to
 * payload.data.email, and a no-link notice to whichever of the old and new
 * address is not that one.
 */
/** Each type's subject in the reader's language (auth-strings.ts). */
function subjectFor(emailType: string, lng: AuthMailLanguage): string {
  const s = authStrings(lng)
  const bySubject: Record<string, string> = {
    signup: s.signup.subject, invite: s.invite.subject, magiclink: s.magic.subject, recovery: s.recovery.subject,
    email_change: s.change.subject, reauthentication: s.reauth.subject,
  }
  return bySubject[emailType] || EMAIL_SUBJECTS[emailType] || 'Notification'
}

function mailsFor(emailType: string, data: Record<string, unknown>, run_id: string): QueuedMail[] {
  const token = codeOf(data.token)
  const minutes = expiryMinutes()
  const confirmationUrl = confirmLinkFor(data, emailType)
  const linkTo = norm(data.email)
  // The language the sign-in page named in its redirect (S12-180); English otherwise.
  const lng = authMailLanguage(redirectOf(data)?.searchParams.get('lng'))
  const base: QueuedMail = {
    to: linkTo,
    label: emailType,
    subject: subjectFor(emailType, lng),
    template: EMAIL_TEMPLATES[emailType],
    props: {
      siteName: SITE_NAME,
      siteUrl: `https://${ROOT_DOMAIN}`,
      recipient: data.email,
      confirmationUrl,
      token,
      expiryMinutes: minutes,
      email: data.email,
      oldEmail: data.old_email,
      newEmail: data.new_email,
      lng,
    },
    idempotencyKey: `auth:${run_id}`,
    required: true,
  }
  if (emailType !== 'email_change') return [base]

  // Which address is the account's current one. A payload may name both, or
  // only the one that is not data.email.
  const newAddr = norm(data.new_email) || null
  const oldAddr = norm(data.old_email) || (newAddr && linkTo !== newAddr ? linkTo : null)
  const otherAddr = [oldAddr, newAddr].find((a) => a && a !== linkTo) ?? null
  // In full only to the current address, or to the address itself.
  const shown = (addr: string | null, recipient: string): string =>
    !addr ? '' : recipient === oldAddr || addr === recipient ? addr : maskEmail(addr)

  console.log('email_change payload shape', {
    keys: Object.keys(data).sort(),
    emailIsNew: !!newAddr && linkTo === newAddr,
    emailIsOld: !!norm(data.old_email) && linkTo === norm(data.old_email),
    hasOther: !!otherAddr,
    run_id,
  })

  const out: QueuedMail[] = [{
    ...base,
    props: { ...base.props, oldEmail: shown(oldAddr, linkTo), newEmail: shown(newAddr, linkTo) },
  }]
  if (otherAddr) {
    out.push({
      to: otherAddr,
      label: 'email_change_notice',
      subject: authStrings(lng).notice.subject || EMAIL_CHANGE_NOTICE_SUBJECT,
      template: EmailChangeNoticeEmail,
      props: {
        siteName: SITE_NAME,
        oldEmail: shown(oldAddr, otherAddr),
        newEmail: shown(newAddr, otherAddr),
        confirmedAt: shown(linkTo, otherAddr),
        lng,
      },
      idempotencyKey: `auth:${run_id}:notice`,
      required: false,
    })
  }
  return out
}

// Webhook handler - verifies signature and queues the email
async function handleWebhook(req: Request): Promise<Response> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')

  if (!apiKey) {
    console.error('LOVABLE_API_KEY not configured')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Verify signature + timestamp, then parse payload.
  let payload: any
  let run_id = ''
  try {
    const verified = await verifyWebhookRequest({
      req,
      secret: apiKey,
      parser: parseEmailWebhookPayload,
    })
    payload = verified.payload
    run_id = payload.run_id
  } catch (error) {
    if (error instanceof WebhookError) {
      switch (error.code) {
        case 'invalid_signature':
        case 'missing_timestamp':
        case 'invalid_timestamp':
        case 'stale_timestamp':
          console.error('Invalid webhook signature', { error: error.message })
          return new Response(JSON.stringify({ error: 'Invalid signature' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        case 'invalid_payload':
        case 'invalid_json':
          console.error('Invalid webhook payload', { error: error.message })
          return new Response(
            JSON.stringify({ error: 'Invalid webhook payload' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
      }
    }

    console.error('Webhook verification failed', { error })
    return new Response(
      JSON.stringify({ error: 'Invalid webhook payload' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!run_id) {
    console.error('Webhook payload missing run_id')
    return new Response(
      JSON.stringify({ error: 'Invalid webhook payload' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (payload.version !== '1') {
    console.error('Unsupported payload version', { version: payload.version, run_id })
    return new Response(
      JSON.stringify({ error: `Unsupported payload version: ${payload.version}` }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // The email action type is in payload.data.action_type (e.g., "signup", "recovery")
  // payload.type is the hook event type ("auth")
  const data: Record<string, unknown> = payload.data ?? {}
  const emailType = String(data.action_type ?? '')
  console.log('Received auth event', { emailType, email: maskEmail(norm(data.email)), run_id })

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type', { emailType, run_id })
    return new Response(
      JSON.stringify({ error: `Unknown email type: ${emailType}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Enqueue email for async processing by the dispatcher (process-email-queue).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let queuedCount = 0
  for (const mail of mailsFor(emailType, data, run_id)) {
    // Render React Email to HTML and plain text
    const html = await renderAsync(React.createElement(mail.template, mail.props))
    const text = await renderAsync(React.createElement(mail.template, mail.props), {
      plainText: true,
    })

    const messageId = crypto.randomUUID()

    // Log pending BEFORE enqueue so we have a record even if enqueue crashes
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: mail.label,
      recipient_email: mail.to,
      status: 'pending',
    })

    const { error: enqueueError } = await supabase.rpc('enqueue_email', {
      queue_name: 'auth_emails',
      payload: {
        run_id,
        message_id: messageId,
        idempotency_key: mail.idempotencyKey,
        to: mail.to,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject: mail.subject,
        html,
        text,
        purpose: 'transactional',
        label: mail.label,
        queued_at: new Date().toISOString(),
      },
    })

    if (enqueueError) {
      console.error('Failed to enqueue auth email', { error: enqueueError, run_id, label: mail.label })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: mail.label,
        recipient_email: mail.to,
        status: 'failed',
        error_message: 'Failed to enqueue email',
      })
      if (mail.required) {
        return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      continue
    }
    queuedCount++
  }

  console.log('Auth email enqueued', { emailType, queued: queuedCount, run_id })

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Handle CORS preflight for main endpoint
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Route to preview handler for /preview path
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  // Main webhook handler
  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
