# R1: sign-in, password recovery and auth mail

R1 is the critical-path round. The owner decided on 2026-10-12 that it ships
first and on its own, ahead of company profiles, the design upgrade and wave 4.
It is built from main (e372e512) and has its own reservation in
`docs/deploy-ledger.json`:

- reservation `critical-path`
- branches `r1/`
- migrations `20261014*`
- function builds `<fn>.2026-10-14.1`
- deployOrder 1.5 (after the wave 3 closeout, before company profiles)

Three builders worked on it in parallel, r1/integration merged their branches,
a fixer round (r1-fix2) applied the review's confirmed findings and the 14
items of the independent S12 sweep, and a third round (r1-fix3, lead decisions
A-H of 2026-10-12) applied the recheck: section 96 now FAILs on a missing
migration behind a serving build and section 95 gates on the guard being
READY (A); the drain is our own job beside Lovable's, behind the gateway's
JWT check (B); the reset and code copy promise "a link (or a 6-digit code)"
(C); a confirmation link survives an outage (D); the Google marker is spent,
short-lived and never silent (E); a refused reset has a way out (F); the
checkout's "Have Pro?" question keys on a session that ended, worded through
i18n (G); and the email-change notice reads the current address from the user
record (H). r1/flags is folded in: Google sign-in and password recovery ship
in the FIRST publish (see "Switches" and "Deploy order").

| branch | what it owns |
|---|---|
| r1/mail | auth-email-hook, process-email-queue, resend-webhook (new), `_shared/send-mail.ts`, the auth mail templates and their strings, migration 20261014100000, verify section 94 |
| r1/signin-web | `/auth` (one Continue screen), AuthContext, the `index.html` stash script, `src/config/auth-providers.ts`, `src/lib/auth-probe.ts`, `src/i18n/auth/*`, the success and confirm pages, verify section 95 |
| r1/signin-server | auth-signed-in (new), `_shared/mailbox-guard.ts`, `_shared/website-session.ts`, `_shared/mailbox-proof.ts`, verify-product-purchase, migration 20261014110000, verify section 96 |

## What changes for people

**Sign-in (`/auth`)**

- There is one Continue screen. **Continue signs in first**, whatever the
  password's length or strength, so a member whose old password fails today's
  strength rule (the HIBP check the owner turns on) still signs in.
- Only when the auth server refuses that email and password does the page
  offer **"New here? You can create an account for <the address typed>"**, as an
  explicit second step. A typo address never becomes an account by itself.
  The Terms version is recorded on the new account.
- A new account refused because the address already has one says "We couldn't
  create an account with that email and password. Wrong password? Reset it",
  never that the account exists.
- Every refusal names the support address. Nothing on screen says a mail was
  "sent": "on its way" shows only after the auth server accepted the request,
  and any other answer says "We couldn't send that just now. Try again in a
  minute, or email <support>".
- The magic-link fallback is gone. It would have reopened the
  pre-registration takeover as soon as mail flowed.
- Modes go through `/auth?mode=continue|reset|confirm|return`. No route was
  added and App.tsx is unchanged.
- Notices are written in the reader's language even when they were set before
  the lazily loaded language arrived; the notices raised outside `/auth` (a
  link's error on another page, the guard's "password cleared", the
  checkout's "Have Pro? Sign in first") load the auth strings before they are
  worded.
- The reset and code screens say "check your email for a link (or a 6-digit
  code)", and either one works: until notify.resumebooster.work is verified
  the mail comes from Lovable's default sender, whose template carries only a
  link; ours prints the code above the link (lead decision C).
- A reset the guard refuses for a reason no retry can pass (the account
  changed since the sign-in, no email identity) says so and offers "Send a
  new reset link" and "Email support", with the way back; only a guard that
  could not answer (503) offers Try again (F).

**A confirmation link during an outage (D)**

- The link's hash stays in the stash until the auth server answers. When it
  cannot be reached (a network failure, a timeout, a 5xx), the page says so
  and offers Try again in the same tab; the link is spent only by a success
  or a definite refusal (expired, already used).

**Links in mail and sessions in URLs (login-CSRF protection)**

- Our template's button opens `/auth?mode=confirm&token_hash=<hash>&type=<t>`
  (plus the page's safe `next`). The page spends the link only when the person
  presses Continue, so a mail scanner that fetches it spends nothing.
- The link is spent, and a session in a URL (Lovable's default link, a
  provider return) is resolved, through a throwaway auth client that keeps
  nothing (`src/lib/auth-probe.ts`). The account is the one the AUTH SERVER
  names, never the one a token claims (a forged, expired token naming the
  visitor's own address is refreshed into the sender's account).
- It is handed to the site's own client only when this browser started a
  sign-in in the last hour **for that same address** (the pending marker names
  the address typed). Otherwise the page asks **"Is this your account?"** with
  the full address, BEFORE any session exists in the browser. The link holder
  already holds that account, so the full address tells them nothing; a
  masked one could be matched by a look-alike address.
- Address-change and recovery links get the same question.
- "Not me" signs nothing in, ends that session on the auth server, and touches
  nothing of the visitor's (their builder draft, scans and reports stay).
- A link adopted under a marker that could not name the address (a provider
  press) ALWAYS shows a "Signed in as <address>. Not you? Sign out" banner,
  whatever link type the URL carried or did not carry; its sign-out ends that
  session on this device only and keeps the visitor's work. A provider marker
  lives ten minutes (a typed-address marker an hour), and is spent by a
  failed or cancelled return, by "Not me", and by `/auth` opening any other
  way (Back from Google), so no later crafted token pair rides it (E).
- A link's error is shown once: on /auth inline, elsewhere as a notice, never
  again on a later visit.

**Credentials in URLs (the first script in `<head>`)**

- It moves every sign-in part (access_token, refresh_token, provider tokens,
  token_hash, code, and with them expires_*, token_type, type and error*) out
  of the query AND the fragment, comparing keys decoded (`access%5Ftoken` is
  `access_token`). auth-js reads both places and adopts any token pair it
  finds, so nothing of a sign-in may survive in either.
- When the stash cannot be written (blocked storage), the sign-in parts still
  leave the address: that sign-in is lost, never adopted unasked.
- It also moves every Stripe `session_id` on any path (product and full
  analysis returns, Freelance Boost, the pass, `/account?pro=success`, the
  scan-pack return), the `share` id on `/success` (it reads and deletes the
  analysis, so the page keeps a new share in the stash, not the address), and
  the API key link's `#confirm` on `/data-api`. Those path-bound values stay in
  the address when storage is blocked, so the page still finds them.
- Not moved: the company-claim link's `claim_verify` (`/jobs/company/:token`).
  Its reader, `src/components/jobs/CompanyClaim.tsx`, is a job-board file R1
  may not touch; it strips the token itself after the page loads. Handed to
  the job-board owner.

**The account guard (D15)**

- auth-signed-in runs once per session, with an hourly allowance per SESSION
  (a stranger's sessions of the same account cannot spend the owner's).
- The first code, link or Google sign-in that proves the account's address
  clears a password set before that proof, ends the other sessions, and the
  page explains why (not over the reset form, which asks for a new one).
- The proof is written BEFORE the rotation and taken back if the rotation
  fails, so a rotation never stands without its proof.
- The admin API rotates only when GoTrue refuses the session's own update
  with a rule only an admin can pass (reauthentication, a current-password
  rule, MFA), also when the proof is refused for an account change, and the
  answer says `signedOut`: the site signs out quietly and asks the person to
  sign in again (the reset asks for a new code). A timeout or a 5xx rotates
  nothing and answers 503.
- An account already proven at another address keeps its password (it is the
  proven owner's).
- It fails closed: if the auth audit log cannot vouch for the sign-in, the
  address stays unproven and nothing is cleared. The reset then goes on (the
  guard will never clear the new password), so recovery works even if GoTrue
  turns out not to write its audit log to Postgres.

**Signing out**

- Sign-out is this device only by default; "everywhere" is separate.
- A deliberate sign-out removes the last address, the drafts, the session
  résumé copies, the cached reports AND the purchase proofs
  (`scanCreditsSessions`, `freelanceBoostPurchase`), in every open tab.

**Purchases**

- A success link shows the buyer's address masked (`j***@gmail.com`) unless
  the signed-in caller has proven that mailbox.
- A signed-out checkout sends no address. When this browser held a SIGNED-IN
  session that ended without a deliberate sign-out (AuthContext writes
  `rb_session_ended_at` on that event alone, and clears it on the next
  sign-in and on a sign-out), the first buy press in the tab says "Have Pro?
  Sign in first" and starts nothing; the next press buys as a guest
  (S12-087). The last address is not the key: EmailReportCapture writes it
  for anyone who asks for their report, and those visitors were being told
  their session had ended (G).

**Auth mail**

- Every template prints the code above the button, says when it expires
  (15 minutes by default) and says "If you didn't ask for this, you can
  ignore it", in the reader's language: the page names it in the link's
  redirect (`&lng=de`) and the hook reads it back (en, en-GB, de, es, fr, hi,
  nl, pt, tl).
- An email change links only to the address GoTrue issued the token for; the
  other address gets a notice with no link. When the payload names only the
  new address (no `old_email`), the account's current address is read from
  the user record by the payload's user id (`user_id`, `user.id` or `id`)
  with the service role, so it still gets its notice; a lookup that fails is
  logged and the link still goes out (H; m9 is live: Account.tsx already
  offers "Change email").
- A queued sign-in mail is drained every 10 seconds by our own job (see "The
  drain").
- A mail Lovable refuses (401/403, or 3 transient failures) goes out through
  Resend from `account@resumebooster.work`. A permanent Resend refusal
  dead-letters it naming both refusals; a Resend 429, 5xx or timeout leaves it
  on the queue for the next tick, until the code inside it expires.
- resend-webhook records bounces and complaints, and suppresses those
  addresses.

## The drain (lead decision B, third fixer round)

**Lovable's own mail path is never touched.** Its email setup made, outside
our migrations, a trigger and a job that drain the queue under the name
`process-email-queue`, a dispatcher (`email_queue_dispatch()`, listed in the
live types) and the vault secret `email_queue_service_role_key`. The second
fixer round had assumed it was the only caller and the only writer of that
job name; it is neither, so:

- process-email-queue is back behind the gateway's JWT check
  (**`verify_jwt = true`**, as before R1; the config.toml line R1 had flipped
  is restored). Lovable's dispatcher posts the vault bearer through that
  check and must keep working.
- The function's own check is the second door: a JWT whose role claim is
  `service_role` (the gateway verified its signature, so the claim is the
  platform's word and the bearer need not be byte-for-byte the function's
  own key), the service-role key itself, or the vault cron key in
  `x-email-cron`. Every refusal answers
  `{"error":"Forbidden","refusedBy":"process-email-queue","cronKey":<bool>}`,
  the flag saying whether a cron key was offered: only our posts offer one.
- A caller that names no queue drains **sign-in mail only** (Lovable's
  dispatcher names none). The fix-plan drip in transactional_emails stays
  where it is until CP-G gives it its text part, marketing purpose, seller
  footer and the apex sender; a caller that names that queue gets it.
- Our cron job is **`rb-auth-mail-drain`** (20261014100000): it never
  schedules, alters or unschedules a job named `process-email-queue` (the
  file only reads that name to report it, and its self-check fails if a job
  of that name carries a marker of ours). It posts the vault bearer
  (`email_queue_service_role_key`) AND the cron key (`email_cron_key`), names
  `{"queues":["auth_emails"]}`, and RAISEs, posting nothing, when either
  vault secret is missing: a failed run, visible in `get_cron_health` and
  section 94, instead of a post the gateway refuses unheard.
- `net.http_post` reads every run as succeeded whatever the answer, and
  `net._http_response` records no URL and no caller, so the command reads
  the answers back by their body: a refusal naming the drain **with cronKey
  true** in the last two minutes fails the run (only our posts offer the
  key), and so does the gateway's own 401 (`"code":401`: a bearer it does not
  accept, the same vault bearer every cron sends). A refusal of another
  caller's post never stops ours.
- **One message, one send, though two drains run.** `read_email_batch` is
  `pgmq.read` (FOR UPDATE SKIP LOCKED, each message hidden 30 s), so the
  second drain reads nothing of the first's batch; a message back in view
  after a crash between send and delete is skipped and deleted when its
  'sent' row exists; and both providers are handed the payload's idempotency
  key. The queue test runs two handler calls against a pgmq-like stand-in.
- Section 94 judges OUR job's last run and failures, reports a
  `process-email-queue` job as Lovable's (never as ours), and PASSes only
  the gateway's 401 to a post with no JWT (a 403 naming the drain means
  verify_jwt is off and the role claim is unverified: a FAIL that says what
  to deploy); the publishable key must be refused 403 with cronKey false.
- Three wave 2/3 queue tests name the queues they drain.

**Accepted deviation: delivery stamps.** resend-webhook stamps `delivered` and
`delayed` on the sent row's metadata instead of writing rows in those states.
`email_delivery_health` counts every status outside its terminal set as stuck
after two hours, so rows in those states would read as stuck mail; stamping
keeps the reader honest without changing it inside R1. A later migration can
add both states to that reader's terminal list and move to rows.

## Switches (`src/config/auth-providers.ts`)

| switch | first publish | why |
|---|---|---|
| `GOOGLE_SIGN_IN_LIVE` | **true** | with the magic link gone, an account made by a magic link or registered by a stranger has no password its owner knows: Google and recovery are its only ways in (register S12-057, lead decision 1) |
| `RECOVERY_LIVE` | **true** | the same; "Forgot password?" and `?mode=reset`, the new password set only after the guard answered |
| `CODE_SIGN_IN_LIVE` | false | a later publish, after the owner's P0 code test and the rate-limit check (D2) |
| `APPLE_SIGN_IN_LIVE` | false | never (D10, D11: no Apple, no Microsoft) |

Both mailbox-proving switches being on in the first publish is why the
frontend waits for section 96 (below).

## Deploy order (enforced)

Generate the Lovable message from main after the merge, with
`node scripts/deploy-ledger.mjs --message`. Never write it by hand. The ledger
carries the migration order as `migrationOrder` rules, and the 20261014110000
rule's text names the frontend gate:

1. **Migration 20261014110000** (sign-in server), through Lovable's staged
   runner, before the functions. auth-signed-in calls the proof and clear
   tables and the three auth readers it creates, and verify-product-purchase
   reads the proof table.
2. **Functions**: auth-email-hook, process-email-queue (with `verify_jwt =
   false` from `supabase/config.toml`), resend-webhook, auth-signed-in,
   verify-product-purchase. Each is built 2026-10-14.1 and sends it in
   `x-fn-build`.
   - The ledger also lists create-portal-session, delete-account,
     free-keyword-scan, get-account-data and scan-credits at 2026-10-14.1.
     Their behaviour is unchanged; each imports `_shared/mailbox-proof.ts`,
     which R1 changed (added exports only), and a build string may not name
     two versions of a function's code.
3. **Run `bash scripts/verify-deploy.sh` and read section 96. It must PASS IN
   FULL** (auth-signed-in and verify-product-purchase answering 2026-10-14.1,
   the CORS origin, the refusals, AND the three readers and two tables
   refused for permission, 42501) **before the frontend is published.** Once
   auth-signed-in serves its R1 build, a reader that does not exist
   (PGRST202) or a table that does not exist (PGRST205, 42P01) is a FAIL,
   never an INFO: Lovable's staged runner has edited failing migrations
   before, and "functions deployed, migration missing" leaves every guard
   call at 503 and the reset without its password form (lead decision A).
   The first publish turns on Google and recovery, and both prove a mailbox
   only the guard acts on.
4. **Migration 20261014100000** (mail drain), once section 94 shows
   process-email-queue answering 2026-10-14.1 AND its post-with-no-JWT line
   PASSes (the gateway's 401: verify_jwt is on, so the role claim the
   function reads is the platform's word). Before applying it, read
   Lovable's own mail path once (Owner steps: `email_queue_dispatch()` and
   the queue triggers); the file never touches it.
5. **Publish the frontend.** Section 95 then FAILs any live sign-in page that
   offers Google or "Forgot password?" while the account guard is not READY
   (the R1 build of auth-signed-in over migration 20261014110000, read as
   anon the way section 96 reads it), so a publish ahead of step 3, or over a
   migration the staged runner dropped, is caught.
6. **Run `bash scripts/verify-deploy.sh` again** and read 94, 95 and 96.
   - 94: the three mail builds, DNS, OUR drain job rb-auth-mail-drain (last
     run succeeded, no failures; a process-email-queue job is reported as
     Lovable's), the gateway's 401 to a post with no JWT, the publishable
     key's 403 with cronKey false.
   - 95: the deployed bundle's flags (`google=on recovery=on code=off
     apple=off`), the controls against the guard being ready, the stash
     script first in `<head>`, and no magic-link copy.
   - 96: the auth-signed-in and verify-product-purchase builds, the CORS
     origin, 401 without a session, the readers and tables closed (42501,
     each table read selecting a real column).

   The probes are read-only. The POSTs (two to auth-signed-in, two to
   process-email-queue, one to resend-webhook) are refused before anything is
   read or written.

Lovable's staged runner has edited failing migrations before and staged them
under other names. Judge "applied" by behaviour: sections 94 and 96 read the
cron job, the column and the tables' refusals.

Then record the deploy in `docs/deploy-ledger.json` `verifiedDeploys`, and add
the changelog entries in all 9 locales in the next frontend publish (owner
rule).

**The ledger cannot print step 3 as its own step.** Its message prints
migrations, functions, the after-function migrations and "Publish the
frontend" in that order, and has no rule type for "frontend after a verify
section"; adding one means editing `scripts/deploy-ledger.mjs`, which wave 4
rewrites. The gate lives in the 110000 rule's text, this file, the PR body and
section 95.

## The later flip: email codes (D2)

Set `CODE_SIGN_IN_LIVE` to true in a separate publish, only after both of
these pass:

- **P0 code test:** request a sign-in code to your own inbox. Exactly one
  mail arrives, it shows the code and a Continue link, and entering the code
  signs you in.
- **Rate-limit check:** request codes to three plus-addresses (you+1@,
  you+2@, you+3@) within 10 minutes. None is refused.

Until then the password leads and no code control renders.

## Owner steps

Before the deploy:

- **Lovable Emails.** More > Cloud > Emails > Manage domains >
  notify.resumebooster.work > Verify domain. Until it reads Verified, auth
  mail comes from Lovable's default sender (in English: the language and the
  `next` ride only our template's link), and GoTrue's default templates
  carry ONLY a link, no code. The pages say "a link (or a 6-digit code)" and
  take either; the confirm page handles both kinds of link.
- **Lovable's own mail path, read once before 20261014100000 is applied**
  (More > Cloud > SQL editor, read-only):
  `select pg_get_functiondef('public.email_queue_dispatch()'::regprocedure);`
  and `select tgname, tgrelid::regclass, pg_get_triggerdef(oid) from
  pg_trigger where tgrelid in ('pgmq.q_auth_emails'::regclass,
  'pgmq.q_transactional_emails'::regclass);`. Our drain never schedules,
  alters or unschedules Lovable's `process-email-queue` job, and it posts the
  vault bearer that dispatcher uses; tell us if the dispatcher posts
  something other than `email_queue_service_role_key` as its bearer, or names
  queues, so section 94's reading of it can be checked.
- **Auth settings** (More > Cloud > Users > Auth settings).
  - Site URL: `https://resumebooster.work`.
  - Redirect URLs: `https://resumebooster.work/**` and
    `http://localhost:8080/**` (the links now carry `&next=` and `&lng=`).
  - Minimum password length 8, and the Password HIBP check ON.
  - Email OTP length 6 and Email OTP expiration 900. If the expiration
    differs, set the Lovable secret `AUTH_CODE_EXPIRY_MINUTES` to match.
  - Leave Auto-confirm ON and Secure email change ON for now.
  - Leave the "password changed" notification OFF. The hook has no template
    for that type: it answers 400 "Unknown email type", as the live hook does
    today.
- **Audit log check**, once, read-only, in More > Cloud > SQL editor:
  `select count(*), max(created_at) from auth.audit_log_entries;`
  - If the count is 0, or `max(created_at)` does not move after a sign-in,
    GoTrue is not writing its audit log to Postgres. The guard is then inert:
    it proves nothing and clears nothing (a stranger's pre-registered
    password survives a Google sign-in). Recovery still works. Tell us.
- **SPF.** In Cloudflare, set the TXT record `send` to exactly
  `v=spf1 include:amazonses.com ~all`. The current include is NXDOMAIN, and
  section 94 FAILs on it.
- **Resend.** Then re-verify the domain in Resend. MX `send`, TXT `send` and
  TXT `resend._domainkey` must read Verified, and the apex domain too (the
  fallback sends from `account@resumebooster.work`).
- **Resend webhook.** Add the endpoint
  `https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/resend-webhook` with
  email.delivered, email.bounced, email.complained and email.delivery_delayed,
  and copy its signing secret into the Lovable secret `RESEND_WEBHOOK_SECRET`.
  Until then the function answers 503 and section 94 prints INFO.
- **Cancel without signing in.** In Stripe, activate the customer portal login
  link and copy it into the Lovable secret `STRIPE_PORTAL_LOGIN_URL`. R1 does
  not render the link yet (the URL is a server secret).
- **Optional.** `CUSTOMER_REPLY_TO` chooses the reply address on
  Resend-fallback mail. D5: turning off Lovable's built-in analytics.
- **Never** ask Lovable to "set up emails" or "redeploy email templates"
  again. That regenerates auth-email-hook and process-email-queue (and could
  put `verify_jwt` back). The r1-mail guard tests would fail CI, but the
  deploy would already be wrong.

**Decision needed before P3 (Confirm email ON).** With Confirm email on, a
password sign-up's confirmation mints an amr "otp" session the auth log
vouches for, so the guard would clear the password the person chose a minute
earlier and show "We cleared a password set on this address before you
proved you own it". Choose before P3: accept it and change the sign-up copy
and the owner steps, or have the guard skip an account's own first sign-up
(review minor, not changed in R1).

## Known limits

**Unproven until live**

- Whether GoTrue writes `auth.audit_log_entries` (the owner check above).
- The shape of Lovable's `payload.data.url`, and whether it carries the
  page's `redirect_to`. Without it the mail is English and the button has no
  `next`; if no hash parses, the button falls back to that URL.
- Whether Lovable's Google broker keeps the path and query of `redirect_uri`.
  If it drops them, the return lands on `/`, where the session is still
  resolved and adopted under the marker.
- What Lovable's dispatcher (`email_queue_dispatch()`) and queue triggers
  post, and with which bearer (the owner step above reads them). Our drain
  runs beside them under its own name and depends on nothing of theirs
  except the vault bearer they created; a bearer the gateway refuses shows
  up as our job's failed run (it reads the gateway's 401 back), and a
  dispatcher that names no queue now drains sign-in mail only.
- The exact body of the gateway's 401 (`{"code":401,...}`): the drain's
  read-back of it is best effort, keyed on that shape. The owner's live code
  test (one sign-in mail arriving) is the proof that the drain works end to
  end; `get_cron_health` shows the runs.
- Which key Lovable's email_change payload carries the user id under
  (`user_id`, `user.id` or `id` are read); the hook logs the payload's key
  set, and a payload with none and no `old_email` sends the link and no
  notice.

**Gaps and open decisions**

- A signed-out Pro subscriber is recognised before checkout only by signing
  in (D8, open): the page asks once, it sends no address.
- `use-pro-subscription` still falls back to a stored address for a
  signed-out visitor's Pro status (pre-existing, CP-H; changing it widens D8).
- A password set in Account after a guard call that failed before any
  rotation can still be cleared by the re-ask (review minor; the reset awaits
  the guard, Account.tsx is not R1's).
- ProductSuccess still says "A confirmation email has been sent to your
  inbox". That copy is R2's.
- `/auth` names `resumeboostersupp@gmail.com` as the support address, the same
  as the footer. support@ on our own domain may bounce (CP-017).
- auth-email-hook has no template for GoTrue's security notifications (keep
  them off).
