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
and a fixer round (r1-fix2, pushed to r1/integration) applied the review's
confirmed findings and the 14 items of the independent S12 sweep. r1/flags is
folded in: Google sign-in and password recovery ship in the FIRST publish (see
"Switches" and "Deploy order").

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
  the lazily loaded language arrived.

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
  press) shows a "Signed in as <address>. Not you? Sign out" banner; its
  sign-out ends that session on this device only and keeps the visitor's work.
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
- A signed-out checkout sends no address. When this browser held a session
  that ended without a deliberate sign-out, the first buy press in the tab
  says "Have Pro? Sign in first" and starts nothing; the next press buys as a
  guest (S12-087).

**Auth mail**

- Every template prints the code above the button, says when it expires
  (15 minutes by default) and says "If you didn't ask for this, you can
  ignore it", in the reader's language: the page names it in the link's
  redirect (`&lng=de`) and the hook reads it back (en, en-GB, de, es, fr, hi,
  nl, pt, tl).
- An email change links only to the address GoTrue issued the token for; the
  other address gets a notice with no link.
- A queued sign-in mail is drained every 10 seconds (see "The drain").
- A mail Lovable refuses (401/403, or 3 transient failures) goes out through
  Resend from `account@resumebooster.work`. A permanent Resend refusal
  dead-letters it naming both refusals; a Resend 429, 5xx or timeout leaves it
  on the queue for the next tick, until the code inside it expires.
- resend-webhook records bounces and complaints, and suppresses those
  addresses.

## The drain (decision 5)

- process-email-queue runs with **`verify_jwt = false`** (one
  `supabase/config.toml` line, a declared critical-path share) and checks its
  own caller: the service-role key itself (constant-time) or the vault cron key
  in `x-email-cron`. A token's claims open nothing. Every refusal answers
  `{"error":"Forbidden","refusedBy":"process-email-queue"}`.
- The cron job (20261014100000) posts only the cron key, with **no bearer**,
  so no missing or stale vault bearer (`email_queue_service_role_key`, which
  no migration creates) can have the gateway refuse it unheard. This was the
  option that cannot silently 401.
- `net.http_post` reads every run as succeeded whatever the answer, so the
  command reads pg_net's answers back: a refusal naming the drain in the last
  two minutes fails the run instead of posting again, and so does a missing
  cron key. Section 94 FAILs on no job, on failed runs, and on a last run that
  did not succeed, and proves the gateway lets a post with no JWT through to
  the function's own 403.
- The cron names `{"queues":["auth_emails"]}`: **R1 drains sign-in mail
  only.** The fix-plan drip in transactional_emails stays where it is until
  CP-G gives it its text part, marketing purpose, seller footer and the apex
  sender (review minor: the drain would have restarted it through Lovable,
  labelled transactional, from the domain sign-in mail depends on).
- Three wave 2/3 queue tests now post with the real service-role key, since a
  forged `role: service_role` claim no longer opens the drain.

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
3. **Run `bash scripts/verify-deploy.sh` and read section 96. It must PASS**
   (auth-signed-in and verify-product-purchase answering 2026-10-14.1, the CORS
   origin, the refusals, the readers and tables closed) **before the frontend
   is published.** The first publish turns on Google and recovery, and both
   prove a mailbox only the guard acts on.
4. **Migration 20261014100000** (mail drain), once section 94 shows
   process-email-queue answering 2026-10-14.1 AND its post-with-no-JWT line
   PASSes (the gateway lets the cron's JWT-less post through). An older build
   or a gateway still asking for a JWT would refuse the drain's posts in words
   that do not name it.
5. **Publish the frontend.** Section 95 then FAILs any live sign-in page that
   offers Google or "Forgot password?" while auth-signed-in does not serve its
   R1 build, so a publish ahead of step 3 is caught.
6. **Run `bash scripts/verify-deploy.sh` again** and read 94, 95 and 96.
   - 94: the three mail builds, DNS, the drain job (last run succeeded, no
     failures), the gateway's answer, the refusals.
   - 95: the deployed bundle's flags (`google=on recovery=on code=off
     apple=off`), the controls against the guard's build, the stash script
     first in `<head>`, and no magic-link copy.
   - 96: the auth-signed-in and verify-product-purchase builds, the CORS
     origin, 401 without a session, the readers and tables closed.

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
  `next` ride only our template's link). The confirm page handles both kinds
  of link.
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
- Whether Lovable honours `verify_jwt = false` for process-email-queue (it
  does for resend-webhook and the other false entries; section 94's
  post-with-no-JWT line proves it).
- Whether Lovable's out-of-migration queue trigger posts to
  process-email-queue, and with which key: a service-role JWT that is not
  byte-for-byte `SUPABASE_SERVICE_ROLE_KEY` is now refused (no gateway checks
  its signature). Our cron does not depend on it.

**Gaps and open decisions**

- A signed-out Pro subscriber is recognised before checkout only by signing
  in (D8, open): the page asks once, it sends no address.
- `use-pro-subscription` still falls back to a stored address for a
  signed-out visitor's Pro status (pre-existing, CP-H; changing it widens D8).
- The email-change notice can miss the account's current address when
  Lovable's payload carries no `old_email` (no UI changes an email yet; fix
  before one ships).
- A password set in Account after a guard call that failed before any
  rotation can still be cleared by the re-ask (review minor; the reset awaits
  the guard, Account.tsx is not R1's).
- ProductSuccess still says "A confirmation email has been sent to your
  inbox". That copy is R2's.
- `/auth` names `resumeboostersupp@gmail.com` as the support address, the same
  as the footer. support@ on our own domain may bounce (CP-017).
- auth-email-hook has no template for GoTrue's security notifications (keep
  them off).
