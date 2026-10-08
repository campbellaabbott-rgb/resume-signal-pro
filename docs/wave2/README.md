# Wave 2: one deploy, in two steps

Wave 2 of the 2026-10-04 platform sweep, integrated on 2026-10-08 from seven
branches (job-board, frontend-board, email-ops, data-pages-sql, entitlements,
public-api, terms-draft). Each group's own note says what changed and why:
[job-board](../job-board-deploy-notes.md) (the `.91` section),
[frontend-board](frontend-board.md), [email-ops](email-ops.md),
[data-pages-sql](data-pages-sql.md), [entitlements](entitlements.md),
[public-api](public-api.md), [terms-draft](terms-draft.md) (a document for
counsel; nothing deploys).

The groups' orders disagree in one place (email-ops writes "frontend first",
data-pages-sql "migrations before the frontend"). The order below satisfies
every hard constraint in the seven notes: each migration lands before the
functions and pages that read it, and the two migrations that START new
scheduled work run only after the code they call is serving.

## Step 1 (one Lovable session)

1. **Migrations, in this order** (each is self-verifying and safe to re-run):
   - job-board: `20261008100000`, `20261008100100`, `20261008100200`
   - data-pages-sql: `20261008110000`, `20261008110500`, `20261008111000`,
     `20261008111500`, `20261008112000`, `20261008112500`, `20261008113000`,
     `20261008113500`
   - email-ops: `20261008120000`, `20261008121000`, `20261008122000`,
     `20261008123000`, `20261008124000`, `20261008126000`, `20261008127000`
     (NOT 125000 or 128000 yet)
   - entitlements: `20261008130000`, `20261008131000`, `20261008132000`
   - public-api: `20261008140000`, `20261008141000`
2. **Edge functions** (39), each answering this build on its preflight:

   | function | build |
   |---|---|
   | job-board | `job-board.2026-09-09.91` (status.version `2026-09-09.91`) |
   | admin-ops | `admin-ops.2026-10-08.2` (both public-api's and email-ops' readers) |
   | free-keyword-scan | `free-keyword-scan.2026-10-08.3` (both entitlements' and email-ops' changes) |
   | affiliate-payout-request (NEW) | `.2026-10-08.1` |
   | agent-pass-status, auth-email-hook, check-alerts, check-error-spikes, check-subscription, company-claim, create-checkout, create-product-checkout, create-subscription-checkout, free-keyword-scan-stream, generate-ats-defense, get-account-data, get-analytics, get-error-telemetry, health-check, industry-corrections-digest, notify-owner, process-email-queue, scan-credits, scheduled-health-probe, send-agent-digest, send-market-pulse, send-scan-report, send-search-digest, test-ai-fallback, nl-search | `<fn>.2026-10-08.1` |
   | scan-heartbeat | `2026-10-08.1` |
   | analyze-resume, create-agent-checkout, create-portal-session, generate-apply-package, generate-freelance-boost, public-api, stripe-webhook, verify-product-purchase | `<fn>.2026-10-08.2` |

   Changed shared modules whose importers were not otherwise touched need no
   redeploy: `_shared/agent.ts` only gained exports (AGENT_TRIAL_DAYS,
   agentPlanEverHeld) and `_shared/ai-fallback.ts` only exported DEFAULT_MODELS.
3. **Frontend publish** (the same commit).

Then run `bash scripts/verify-deploy.sh` (sections 61-66). Every build line
must PASS before step 2.

## Step 2 (after step 1 verifies)

- `20261008125000_the_saved_search_digest_and_the_corrections_digest_run_on_a_schedule.sql`
  starts the saved-search digest (14:23 UTC daily) and the corrections digest
  (Mondays 09:15 UTC). Needs job-board .91, send-search-digest and
  industry-corrections-digest serving and the `/email/unsubscribe` page live.
- `20261008128000_the_error_spike_check_runs_on_a_schedule_and_mails_only_a_spike.sql`
  starts check-error-spikes every 15 minutes; it mails the owner only on a
  visitor-error spike, at most once in 6 hours. Skip it if that mail is not
  wanted.

Mail only arrives once `notify.resumebooster.work` has DNS again (owner).

## Owner steps this deploy creates

- Stripe → Settings → Billing → Customer portal → copy the **login link**
  (`https://billing.stripe.com/p/login/...`) into the Supabase secret
  `STRIPE_PORTAL_LOGIN_URL`. create-portal-session now opens a subscriber's
  portal only for the account the plan names or a proven mailbox (sweep
  S8-001); everyone else gets that link, where Stripe emails them a sign-in.
  Without it they are told to use the link in their Stripe receipt.

- Stripe: subscribe the webhook to `charge.refunded` and `charge.dispute.created`
  (until then a refund revokes nothing).
- After turning on "Confirm email": `UPDATE public.mailbox_proof_settings SET
  confirmation_required_since = now();` (the EMAIL_CONFIRMED_SINCE secret is no
  longer needed).
- A subscription created by hand in Stripe needs `metadata.user_id`.
- /admin/claims: approve the website link of genuine verified claims.
- Confirm a `process-email-queue` cron exists (Lovable Cloud email setup).
- Decide: `/v1/changes` unassessed pre-2026-09-06 history stays `suspectBatch:
  null` (this build) or gets the estimators' batch check (public-api note).
- The Terms section 4 draft goes to counsel (terms-draft note, section 8).

## Not in this deploy (follow-ups)

From the groups' handoffs: /v1 still binds `location.ilike` itself (L13-01 on
/v1; reuse job-board/location-match.ts); the board UI does not yet render
`sortUnavailable` / `facetSource: "withheld"` or offer an Undo for intent
filters; the prerender still bakes the old no-pay sentence and dotted company
hrefs (seo-content-i18n, wave 3); the one-trial rule does not key on the card
fingerprint; ProductSuccess records `pro_` grants as full-price purchases; the
stream fork's 24h cache key ignores the caller's IP country; L13-21 needs a
maintenance-window decision.
