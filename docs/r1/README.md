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

Three builders worked on it in parallel, and r1/integration merges their
branches. No file is shared between them.

| branch | head | what it owns |
|---|---|---|
| r1/mail | 3c78e716 | auth-email-hook, process-email-queue, resend-webhook (new), `_shared/send-mail.ts`, the auth mail templates, migration 20261014100000, verify section 94 |
| r1/signin-web | d35ae887 | `/auth` (one Continue screen), AuthContext, the `index.html` stash script, `src/config/auth-providers.ts`, `src/i18n/auth/*`, the success and confirm pages, verify section 95 |
| r1/signin-server | 41771026 | auth-signed-in (new), `_shared/mailbox-guard.ts`, `_shared/website-session.ts`, `_shared/mailbox-proof.ts`, verify-product-purchase, migration 20261014110000, verify section 96 |

## What changes for people

**Sign-in (`/auth`)**

- There is one Continue screen. A new address becomes an account, and the
  Terms version is recorded.
- An address that already has an account signs in with the same password.
  Nothing on screen says whether the account exists.
- The magic-link fallback is gone. It would have reopened the
  pre-registration takeover as soon as mail flowed.
- No copy says a mail was "sent".
- Modes go through `/auth?mode=continue|reset|confirm|return`. No route was
  added and App.tsx is unchanged.

**Links in mail (`/auth?mode=confirm`)**

- Our template's button opens `/auth?mode=confirm&token_hash=<hash>&type=<t>`.
  The page signs in only when the person presses Continue, so a mail scanner
  that fetches the link cannot spend it.
- Lovable's default link (the Supabase verify endpoint, which redirects with
  `#access_token=...` in the fragment) also works. Until
  notify.resumebooster.work is Verified in Lovable, mail comes from that
  default sender.

**Credentials in URLs**

- The first script in `<head>` moves tokens, `token_hash`, `code` and
  `session_id` from the address into sessionStorage before any other script
  runs. That includes the host's analytics.
- A session that arrives in a URL is used silently only if this browser
  started the sign-in. Otherwise the person sees "You're signing in to the
  account for a***@x.com" and chooses Continue or Sign out (login-CSRF
  protection).

**The account guard (D15)**

- auth-signed-in runs once per session.
- The first code, link or Google sign-in that proves the account's address
  clears a password set before that proof, ends the other sessions, and the
  page explains why.
- It fails closed. If the auth audit log cannot vouch for the sign-in, or the
  account changed after it, the address stays unproven.

**Signing out**

- Sign-out is this device only by default; "everywhere" is separate.
- A deliberate sign-out removes the last address, the drafts, the session
  résumé copies and the cached reports.

**Purchase links**

- A success link shows the buyer's address masked (`j***@gmail.com`) unless
  the signed-in caller has proven that mailbox.
- The success page no longer stores that address where the next checkout
  would prefill it.

**Auth mail**

- Every template prints the code above the button, says when it expires
  (15 minutes by default) and says "If you didn't ask for this, you can
  ignore it."
- An email change links only to the new address. The old address gets a
  notice with no link.
- A queued sign-in mail is drained every 10 seconds. The drain is scheduled
  only if Lovable has not already scheduled one.
- A mail Lovable refuses (401/403, or 3 transient failures) goes out through
  Resend from `account@resumebooster.work` before any dead-letter.
- resend-webhook records bounces and complaints, and suppresses those
  addresses.

**Behind switches, all off in this publish** (`src/config/auth-providers.ts`)

| switch | ships | turns on |
|---|---|---|
| `GOOGLE_SIGN_IN_LIVE` | false | the follow-up publish (branch r1/flags), after section 96 passes |
| `RECOVERY_LIVE` | false | the same follow-up publish. Recovery is "Forgot password?" plus `?mode=reset`, and the new password is set only after the guard answers, so the guard must be serving first |
| `CODE_SIGN_IN_LIVE` | false | a later publish, after the owner's P0 code test and the rate-limit check (D2) |
| `APPLE_SIGN_IN_LIVE` | false | never (D10, D11: no Apple, no Microsoft) |

## Deploy order

Generate the Lovable message from main after the merge, with
`node scripts/deploy-ledger.mjs --message`. Never write it by hand. The ledger
carries the order below as `migrationOrder` rules, so the message prints these
steps:

1. **Migration 20261014110000** (sign-in server), through Lovable's staged
   runner, before the functions. auth-signed-in calls the proof and clear
   tables and the three auth readers it creates, and verify-product-purchase
   reads the proof table. If the functions go first, every guard call answers
   503 and nothing is cleared.
2. **Functions**: auth-email-hook, process-email-queue, resend-webhook,
   auth-signed-in, verify-product-purchase. Each is built 2026-10-14.1 and
   sends it in `x-fn-build`.
   - The ledger also lists create-portal-session, delete-account,
     free-keyword-scan, get-account-data and scan-credits at 2026-10-14.1.
     Their behaviour is unchanged. Each imports `_shared/mailbox-proof.ts`,
     which R1 changed (added exports only), and a build string may not name
     two versions of a function's code (DEPLOY-LEDGER.md §2).
   - The three of them that did not expose `x-fn-build` to browsers now do.
3. **Migration 20261014100000** (mail drain), once process-email-queue answers
   2026-10-14.1 (section 94 shows it). The drain's posts carry `x-email-cron`,
   which only that build reads, and only that build has the Resend fallback.
4. **Publish the frontend.** Do this promptly after step 2: until it
   publishes, the live `/auth` still offers the magic link, and mail is
   flowing again.
5. **Run `bash scripts/verify-deploy.sh`** and read sections 94, 95 and 96.
   - 94: the three mail builds, DNS, the drain job, and the refusal on
     email_delivery_health.
   - 95: the deployed bundle's flags (`rb-auth:google=off` and so on), the
     stash script first in `<head>`, and no magic-link copy.
   - 96: about 10 PASS lines covering the auth-signed-in and
     verify-product-purchase builds, the CORS origin, 401 without a session,
     the three readers and two tables closed to client roles.

   The probes are read-only. The two POSTs to auth-signed-in are refused by
   its website-session check before it reads or writes anything.

This order differs from the task's literal list ("migrations 100000 then
110000, then functions"). Each builder found a reason, and the migration
headers say the same: 110000 must precede the guard, and 100000 must follow
the queue build.

Lovable's staged runner has edited failing migrations before and staged them
under other names. Judge "applied" by behaviour: sections 94 and 96 read the
cron job, the column, and the tables' refusals.

Then record the deploy in `docs/deploy-ledger.json` `verifiedDeploys`, and add
the changelog entries in all 9 locales in the next frontend publish (owner
rule).

## The follow-up publish: Google and recovery (branch r1/flags)

r1/flags is one commit on top of r1/integration. It sets
`GOOGLE_SIGN_IN_LIVE` and `RECOVERY_LIVE` to true and changes nothing else.
Every string those controls need already ships in `src/i18n/auth/*.json`. The
branch is pushed and must not be merged until:

1. section 96 passes, with auth-signed-in answering 2026-10-14.1 or later, and
2. the owner's audit-log check below shows GoTrue writing
   `auth.audit_log_entries`. Without it, the guard proves nothing and clears
   nothing.

`holdUntilVerified` in the ledger holds migration stamps only, so this hold is
recorded here.

How to ship it:

- If R1 was merged with a merge commit, open a PR from r1/flags.
- If it was squashed, cherry-pick the one commit onto main.

After it publishes:

- Section 95 should print `google=on recovery=on` as PASS. A switch that is
  on while auth-signed-in does not serve 2026-10-14.1 is a FAIL.
- Test Google once in a private window. It should land on
  `/auth?mode=return` and then on the page you started from.

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
  mail comes from Lovable's default sender. The confirm page handles both
  kinds of link.
- **Auth settings** (More > Cloud > Users > Auth settings).
  - Site URL: `https://resumebooster.work`.
  - Redirect URLs: `https://resumebooster.work/**` and
    `http://localhost:8080/**`. If you prefer exact entries, add
    `https://resumebooster.work/auth?mode=confirm`, `...?mode=reset` and
    `...?mode=return`.
  - Minimum password length 8, and the Password HIBP check ON.
  - Email OTP length 6 and Email OTP expiration 900. If the expiration
    differs, set the Lovable secret `AUTH_CODE_EXPIRY_MINUTES` to match.
  - Leave Auto-confirm ON and Secure email change ON for now.
  - Leave the "password changed" notification OFF. The hook has no template
    for that type: it answers 400 "Unknown email type", as the live hook does
    today, so nobody would get the notice.
- **Audit log check**, once, read-only, in More > Cloud > SQL editor:
  `select count(*), max(created_at) from auth.audit_log_entries;`
  - If the count is 0, or `max(created_at)` does not move after a sign-in,
    GoTrue is not writing its audit log to Postgres. The guard is then inert.
  - Tell us before r1/flags is merged.
- **SPF.** In Cloudflare, set the TXT record `send` to exactly
  `v=spf1 include:amazonses.com ~all`. The current include,
  `dc-fd741b8612._spfm.send.resumebooster.work`, is NXDOMAIN, and section 94
  FAILs on it.
- **Resend.** Then re-verify the domain in Resend. MX `send`, TXT `send` and
  TXT `resend._domainkey` must read Verified. The fallback sends from
  `account@resumebooster.work`, so the apex domain must read Verified too.
- **Resend webhook.**
  - Resend > Webhooks > Add endpoint
    `https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/resend-webhook`,
    with the events email.delivered, email.bounced, email.complained and
    email.delivery_delayed.
  - Copy its signing secret (`whsec_...`) into the Lovable secret
    `RESEND_WEBHOOK_SECRET`.
  - Until then the function answers 503 to every event, and section 94
    prints INFO.
- **Cancel without signing in.**
  - In Stripe: Settings > Billing > Customer portal > activate the login
    link, then copy the `https://billing.stripe.com/p/login/...` URL into the
    Lovable secret `STRIPE_PORTAL_LOGIN_URL`.
  - R1 does not render the "Manage or cancel without signing in" link yet:
    the URL is a server secret and the page has no config for it. It is left
    for a later round.
- **Optional.** Set the Lovable secret `CUSTOMER_REPLY_TO` to choose the
  reply address on Resend-fallback mail.
- **Optional (D5).** Turn off Lovable's built-in analytics. The stash keeps
  credentials out of URLs either way, but the analytics still records full
  URLs.
- **Never** ask Lovable to "set up emails" or "redeploy email templates"
  again. That regenerates auth-email-hook and process-email-queue. The r1-mail
  guard tests would fail CI, but the deploy would already be wrong.

The deploy itself: run the ledger message from main and follow the steps
above. After it verifies, merge r1/flags, then the code flip when its two
tests pass.

## Known limits

**Unproven until live**

- Whether GoTrue writes `auth.audit_log_entries` (the owner check above).
- The shape of Lovable's `payload.data.url`. If no hash parses, the mail's
  button falls back to that URL.
- Whether Lovable's Google broker keeps the path and query of
  `redirect_uri`. If it drops them, the return lands on `/`, where the
  session is still adopted.
- The `recovery` amr value on a live token.
- Whether Lovable's own queue trigger re-schedules `process-email-queue` over
  ours.

**Gaps and open decisions**

- resend-webhook stamps delivered and delayed on the sent row's metadata
  rather than writing rows in those states. `email_delivery_health` would
  count such rows as stuck. A later migration can add them to that reader's
  terminal list.
- A signed-out Pro subscriber is no longer recognised before checkout (D8,
  open).
- ProductSuccess still says "A confirmation email has been sent to your
  inbox". That copy is R2's.
- `/auth` names `resumeboostersupp@gmail.com` as the support address, the same
  as the footer. support@ on our own domain may bounce (CP-017).
