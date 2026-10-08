# Wave 2: email-ops deploy note (2026-10-08)

Branch `wave2/email-ops`. Verifier: `scripts/verify-deploy.d/63-wave2-email-ops.sh`
(section 63; read-only; before the deploy every new-build line reads FAIL).

## What changed, by register item

| Item | What was wrong | What holds now |
|---|---|---|
| L10-02 | The saved-search digest windowed on the employer's stated date, so late-discovered and undated postings never mailed | job-board .91 takes `newSince` (posted_at OR first_seen after X, RPC-blind, echoed back); the digest uses it and dedupes against `search_digest_sent` (30 days) |
| L10-03 | A failed or unavailable board count read as "zero new" and the claim's advanced stamp deleted the window | any non-number count, a missing list, or an answer without the `newSince` echo gives the claim back |
| L11-01 | No cron job for `send-search-digest` or `industry-corrections-digest` | 20261008125000 schedules both with `x-email-cron` (owner decision: yes) |
| L10-18 | Correction labels written by anyone printed raw into the owner's digest; the digest answered any POST | scheduler/service role only; only known industries printed, escaped, and the number dropped stated |
| L10-14 | Unsubscribe pages unsubscribed on a bare GET and rendered as text/plain on supabase.co | links open `/email/unsubscribe` (button, POST); GET on an old link 303s there and writes nothing; digest and pulse carry List-Unsubscribe + List-Unsubscribe-Post |
| L10-01 | (owner DNS) and a 403 stopped the whole queue run with no log naming the sender | a 403 dead-letters only that message, names the sender domain in the log and the DLQ row, and the run goes on; a refused drip enqueue is a logged 503, not "queued" |
| L13-39 | Drip mails were dead-lettered by the 60-minute TTL the moment they became visible | they carry `due_at`; the queue ages a message from it |
| L10-07 | `email_delivery_health` counted every delivered auth mail's pending row as stuck forever | a row is stuck only while no later row exists for its message |
| L10-16 | A provider 429 was logged as `rate_limited`, which the CHECK refused | the CHECK accepts it; the insert's error is read |
| L10-09 | Auth mails came from "resume-signal-pro" | "Resume Booster" |
| L13-06 | company-claim auto-verified by two-way substring match (x@nth.io as Anthropic) and showed the claimant's website under the badge | exact registrable-domain match with a host the board links to, never an ATS's; website shows only after the owner approves |
| L10-12 | Resend cooldown read created_at, so every request after 10 minutes re-sent | reads `last_sent_at`, stamped after each send |
| L10-10 | scan-heartbeat answered anyone | cron key, service role or the owner's ADMIN_API_KEY only; its cron re-created carrying the key |
| L10-21 | The heartbeat's e2e scan was served from the 7-day report cache | a per-run reference line, `synthetic: true`, and a `cachedReport` answer fails `e2e_scan` |
| L10-15 | Vendor drift passed on a canary 5xx and vanished on a timeout | both are recorded skips |
| L10-05 | Alerts were stamped announced before the send; the send's answer was never read | state written only after Resend accepts; recovery note likewise; a refused sender-offline alert is logged |
| L10-08 | The delivery check read only email_send_log | it also counts email_logs (paid-report mail), counts only |
| L13-67 | Stripe check discarded the response and read a missing key as healthy; AI 401/402 read healthy | only a 200 from Stripe passes; missing key / 401 / 402 / 403 are errors (health-check, scheduled-health-probe, and a new `stripe_credentials` heartbeat check) |
| L13-48 | check-alerts ran every 6 h and looked back 1 h; logged every alert as sent | looks back 6 h; logs the send's real outcome; an unavailable reader is an alert |
| L10-17 | Alert mail linked resumebooster.lovable.app (another product) | links https://resumebooster.work/health-check |
| L10-13 | notify-owner accepted unauthenticated posts | service role or cron key only (the auth.users trigger sends the key; free-keyword-scan sends the service role and skips synthetic/heartbeat scans); hourly ceiling counted in the database |
| L10-19 | test-ai-fallback tested a chain no production path runs | it walks `DEFAULT_MODELS` and the scanner's chain (now `_shared/scan-models.ts`, which free-keyword-scan reads) through the shared helper |
| L3-08 | /health-check showed 100% uptime and "All systems operational" over an unreadable table | heartbeats via admin-ops `get_recent_heartbeats`; a refusal reads "unavailable" |
| L3-09 | The AI fallback test ran every 30 s against a 3/hour limit | runs from its buttons; a 429 keeps the last result |
| L1-03 | /analytics and /errors preflights refused x-admin-key | allowed; constant-time key compare |
| L3-19 | One failed fetch locked /analytics | error cleared per fetch; presets and Retry on the error screen |
| L9-14 | The agent digest told every subscriber "we never submit anything for you" | footer from each mandate's `apply_mode` and daily cap |
| L3-10 | Affiliate "real-time" and error-dashboard "Live" subscribed to tables RLS denies | both poll what their reader may read every 30 s; callbacks in refs |
| L13-63 | Affiliate page promised 20%; server pays flat $1/$5; Request Payout filed nothing | copy quotes the flat amounts (held equal to both server lists); Request Payout writes `affiliate_payout_requests` via `affiliate-payout-request` (session-checked) and mails the owner; success toast only on a recorded row |
| L10-20 | check-error-spikes has no trigger | **skipped**: scheduling it starts a new stream of owner mail on every browser error, deleting it is an undeploy; needs an owner decision |

## Functions to deploy, with their builds

| Function | Build (x-fn-build) | Notes |
|---|---|---|
| job-board | `job-board.2026-09-09.91` | ships with the job-board group's .91; carries `newSince` (n306b). The .91 section in docs/job-board-deploy-notes.md must name it |
| send-search-digest | `send-search-digest.2026-10-08.1` | needs job-board .91 and 20261008120000, else every claim is given back (no mail, no loss) |
| industry-corrections-digest | `industry-corrections-digest.2026-10-08.1` | now refuses callers without the cron key |
| send-market-pulse | `send-market-pulse.2026-10-08.1` | |
| send-scan-report | `send-scan-report.2026-10-08.1` | |
| process-email-queue | `process-email-queue.2026-10-08.1` | |
| auth-email-hook | `auth-email-hook.2026-10-08.1` | |
| company-claim | `company-claim.2026-10-08.1` | needs 20261008122000 FIRST (new columns) |
| scan-heartbeat | `scan-heartbeat.2026-10-08.1` (body `buildVersion` 2026-10-08.1) | needs 20261008123000 FIRST, or its cron is refused |
| admin-ops | `admin-ops.2026-10-08.1` | serves `get_recent_heartbeats` (20261008123000) |
| check-alerts | `check-alerts.2026-10-08.1` | |
| notify-owner | `notify-owner.2026-10-08.1` | needs 20261008123000 (trigger sends the key) and free-keyword-scan .10-08 |
| free-keyword-scan | `free-keyword-scan.2026-10-08.1` | other wave-2 groups may also bump this file: merge, keep the later build |
| test-ai-fallback | `test-ai-fallback.2026-10-08.1` | |
| health-check | `health-check.2026-10-08.1` | |
| scheduled-health-probe | `scheduled-health-probe.2026-10-08.1` | |
| get-analytics | `get-analytics.2026-10-08.1` | |
| get-error-telemetry | `get-error-telemetry.2026-10-08.1` | |
| affiliate-payout-request | `affiliate-payout-request.2026-10-08.1` | NEW; `verify_jwt = false` in config.toml (checks the affiliate session itself) |
| send-agent-digest | `send-agent-digest.2026-10-08.1` | |

Frontend (Lovable publish): `/email/unsubscribe` page, Affiliates/PayoutRequest copy and payout wiring, HealthCheck, ScanMetrics heartbeat button (sends the admin key), AnalyticsDashboard, ErrorDashboard, AdminClaims (Approve on verified-but-unapproved claims), robots.txt, nine locales.

## Migrations, in apply order

1. `20261008120000_a_saved_search_remembers_the_postings_it_already_mailed.sql`
2. `20261008121000_an_email_log_row_its_own_send_superseded_is_not_stuck.sql`
3. `20261008122000_a_claimed_website_shows_only_after_the_owner_approves_it.sql` (before company-claim .10-08)
4. `20261008123000_the_heartbeat_and_the_owner_notes_answer_only_our_own_callers.sql` (before scan-heartbeat and notify-owner .10-08)
5. `20261008124000_a_payout_request_is_a_row_the_owner_can_act_on.sql` (before the Affiliates frontend)
6. `20261008125000_the_saved_search_digest_and_the_corrections_digest_run_on_a_schedule.sql` **LAST**, after job-board .91, send-search-digest .10-08 and industry-corrections-digest .10-08 serve (section 63 lines PASS), and after the frontend with `/email/unsubscribe` is live

Every file is self-verifying and safe to re-run. New definer functions open to the client roles: **none**. New closed readers: `get_recent_heartbeats(integer)` (INVOKER, service role only, listed in `ADMIN_READERS_CREATED_CLOSED` in the allowlist helper); `search_digest_record_sent(uuid,text[])` (INVOKER, service role only). `get_company_claim_status(text)` is re-issued with its existing anon grant (already allowlisted). `notify_owner_on_signup()` is a trigger function.

## Order in one line

frontend publish -> migrations 1-5 -> functions (company-claim after 3; scan-heartbeat, notify-owner, free-keyword-scan after 4; send-search-digest after job-board .91) -> section 63 -> migration 6 -> section 63 again.

## Tell the owner

- **notify.resumebooster.work has no DNS (L10-01).** Re-verify it in Lovable Cloud or restore its delegation in Cloudflare, then send yourself one magic link and confirm a pending and a sent row in email_send_log. Until then every auth mail and fix-plan mail is dead-lettered, now with the sender named in the row.
- **No process-email-queue cron was visible** (section 63 says which). Without it nothing in the queue is ever sent; Lovable Cloud's email setup creates it.
- **Saved-search digests start at 14:23 UTC** after migration 6; the corrections digest on Mondays 09:15 UTC.
- **Verified company claims keep their badge but lose the website link** until you press Approve on /admin/claims. Claims verified under the old substring rule (`domain_match = true`) deserve a look: revoke any that are not genuine.
- **Affiliate payout requests now arrive by email** and sit in `affiliate_payout_requests`; pay, then set the row's status to paid or rejected (service role).
- **The heartbeat now runs a real (synthetic) scan every 10 minutes** and checks the Stripe key; a wrong or missing STRIPE_SECRET_KEY now alerts.
- **check-error-spikes (L10-20) needs your call**: schedule it (hourly, cron key, cooldown, spikes only) or retire it.
- /scan-metrics' Run heartbeat button now needs the admin key in its gate.

## Rollback

- Functions: redeploy the previous builds; each is independent. scan-heartbeat .10-08 rolled back still works with the new cron (the old build ignores the header).
- Migration 6: `SELECT cron.unschedule('send-search-digest'); SELECT cron.unschedule('industry-corrections-digest');`
- Migration 4: the old function builds ignore the new header; the cron and trigger may stay.
- Migrations 1, 2, 3, 5 are additive (tables, a column pair, a wider CHECK, a re-issued reader); leave them.
- job-board .91's `newSince` is unused by anything but the digest.

## What to measure

- Section 63 all PASS after migration 6; `get_cron_health`: send-search-digest runs daily with 0 failures, a 200 `{sent, skipped, considered}` in its log (a 401 means the key is not reaching it).
- `search_digest_sent` grows after the first run; digests mention undated postings.
- `email_delivery_health(24)` stuck drops to 0 (the 2026-07-03 pending row is superseded).
- The heartbeat payload: `e2e_scan` passes without `cachedReport`, `stripe_credentials` present, `job_board_vendors` either a check or a skip with a reason; `delivery.paidMail` present.
- check-alerts log: readers asked for 6 hours; no `ALERTS BLIND` without an alert.
- /analytics and /errors load with the admin key; /health-check shows real uptime or "unavailable".
