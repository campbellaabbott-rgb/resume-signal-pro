# Wave 3: email-ops deploy note (2026-10-09)

Branch `wave3/email-ops`. Verifier: `scripts/verify-deploy.d/75-wave3-email-ops.sh`
(section 75; read-only; before the deploy every new-build line reads FAIL).

## What changed

### Commercial-readiness items (2026-10-08 plan)

| Item | What was wrong | What holds now |
|---|---|---|
| 2. Undelivered-order alert | scan-heartbeat decided its alert before it read `product_delivery_health`, so "undelivered" reached only the discarded JSON | the delivery reads run first; each undelivered order (generation_failed, or payment_received/generating untouched for 2 h) is mailed to the owner with session, buyer, product, age, retries and last error, once per order per day, stamped only after Resend accepts (2/hour backstop). The JSON gains `undeliveredOrders` (no address) |
| 2. Stuck generation | `get_failed_deliveries_for_retry` never selected `generating` | 20261009140000 selects a `generating` row 15 min after its generation began; retry-failed-deliveries regenerates it and records a repeat failure as `generation_failed` |
| 2. Stripe waited | stripe-webhook awaited generation (~90 s) before answering Stripe | claim, delivery row and `generating` stamp first; generation, saved copy and mail under `waitUntil` |
| 3. Purchase links | every purchase mail's button went to the homepage; Full Analysis and Freelance Boost buyers got no mail | `_shared/purchase-links.ts`: the page Checkout returned to, with the session (`/product-success?session_id&product`, `/success?session_id`, `/freelance-boost?session_id`), held equal to the checkouts' `success_url` by a test; the reference is printed. The webhook mails Full Analysis and both Freelance tiers at payment. ProductSuccess and FreelanceBoost show the copy saved under the link's session before asking for a resume or generating again; an owner re-delivery (`manual_regen_`) skips Stripe verification |
| 3. Recover form | recover-purchase took a bare id only | it finds the reference in a bare id, the button link (encoded or not) or the reference line |
| 3. reply_to | no customer mail set one | `reply_to: resumeboostersupp@gmail.com` (`_shared/customer-mail.ts`) on purchase, report, re-delivery, API key, company claim, affiliate (Resend 4: `replyTo`), agent digest, market pulse, scan report and drip, saved-search digest, and every queued mail (process-email-queue) |
| 10. Seller identity | no place for it | `_shared/seller-identity.ts` (EMPTY) + `_shared/seller-footer.ts`: marketing footers (scan report and drip, pulse, saved-search and agent digests) print name and address only when both are set |

### S8 register items (fix_group email-ops / ops)

| Item | Status | What holds now |
|---|---|---|
| S8-019 | fixed | track-ab-event keys the address tier on `clientAddressOr`, refuses metadata over 2048 chars of JSON before any write, and adds a site-wide hourly ceiling (`client_write_allowed`, scope `track-ab-event:global`, 20,000/h); visitor budget 180, address ceiling 1800 (re-derived). The address ceiling is also taken BEFORE the site's hour (`mail_door_take`, door `track-ab-event:address`, bucket = keyed hash of the address), so one address spends at most 1,800 of the 20,000; a full site hour is logged as an error. An IPv6 caller rotating inside its /64 is still one address per call (as it always was for the writer's tier). **Retention on ab_test_events not added** (owner: pick a period) |
| S8-049 | fixed | layoff half: 20261009142000 prefixes `layoff-partition-refresh` with `SET statement_timeout = '10min'`. Exit-rollup half already fixed by wave 2 (20261008113000, commit 21aa208b) |
| S8-051 | fixed (aggregate) | 20261009143000 `cron_http_refusals(minutes)` over `net._http_response`; scan-heartbeat check `cron_http_refusals` fails on any 401/403 in the last hour. Per-job attribution needs request-id logging in every cron command (belongs with S8-050's inventory). check-alerts "blind" half: wave 2 L13-48 |
| S8-052 | fixed | the saved-search digest claims 25 at a time, starts nothing after 100 s, hands back every claimed-but-unstarted row, and never retries a row inside the run that gave it back; the pulse and agent loops hand back what the clock leaves. Handed-back rows are restored when the run ends (restored at once, 25 of them at the NULLS FIRST head stopped every run); a suppressed or mailbox-less owner keeps the claim's stamp and is looked at again a cadence later |
| S8-061 | fixed | health-check and scheduled-health-probe run live probes (Stripe, AI, heartbeat write) only for `x-admin-key`, `x-email-cron` or the service role; anonymous health-checks share one live probe per isolate per minute without provider text; an anonymous probe is database-only and writes nothing |
| S8-097 | fixed | CompanyClaim holds the `?claim_verify=` token for a press of "Confirm my claim"; nothing is sent on open |
| S8-098 | already fixed by wave 2 | industry-corrections-digest answers only `isScheduledCaller` (commit 3c3fe0d7) and runs weekly with the cron key (20261008125000) |
| S8-099 | fixed | 20261009141000 `market_pulse_confirm_unsent` (INVOKER, service_role); send-market-pulse takes back a request whose confirmation Resend refused |
| S8-100 | fixed | save-lead escapes every value, prints only detector/menu industries, uses the platform address (also for its rate key) and the ipinfo country of that address, never a header; subject stripped |
| S8-101 | fixed | the pass refund alert has its own door, `owner-alert:pass` (`firstPassAlert`) |
| S8-102 | fixed | the pulse says its keywords are the curated list, "not a count of this month's postings"; no percentages, no "shifted", no "right now"; the opt-in line (9 locales) no longer says "rising" |
| S8-121 | fixed | error boundaries send variant `app` / the section (≤ 30) and the message in metadata |
| S8-122 | fixed | `useABTest().trackClick` records a view under `<test>__click`; `conversion` is left to the purchase |
| S8-123 | fixed | scroll/time milestones carry the page in the variant (`pricing:25%`); get-analytics folds the prefix back |
| S8-035 | partly | the "more than 10,000" claim is gone from es/fr/pt/tl (guard extended). **Owner decision:** remove the tips box or route it to the pulse; stop send-scan-report writing every report address into `free_scan_leads`; retention of existing rows |
| S8-017 | owner | no cron drains the email queue. Section 75 now FAILs while no such job exists. Owner: re-create process-email-queue's job (Lovable Cloud email setup) or move auth mail to GoTrue |
| S8-020 | owner | wave 2 added `client_callable_unlisted_names` (admin-ops, commit 1721a15a). Owner: read the two names, then revoke or allowlist them. Section 40 stays INFO (house rule: the census is not redefined here) |
| S8-050 | owner | five live cron jobs no repo file creates; read their commands with the service role, then one inventory migration (see also S8-061 below) |

## Functions to deploy, with their builds

All `<fn>.2026-10-09.1` (scan-heartbeat body `buildVersion` 2026-10-09.1; track-ab-event `BUILD_VERSION` 2026-10-09.1).

| Function | Depends on |
|---|---|
| send-product-email | **deploy FIRST of the mail set**: stripe-webhook .10-09 sends it `full_analysis` / `freelance_*`, which the old build renders with the keyword-fix copy and a homepage button |
| stripe-webhook | send-product-email .10-09 |
| retry-failed-deliveries | 20261009140000 (the old build with the new selector spends a retry on a stuck row and leaves it, harmless) |
| verify-product-purchase, admin-regenerate-delivery, send-analysis-email | none (an old send-product-email ignores the new `sessionId`) |
| recover-purchase | none; the frontend works with the old build for bare ids and links |
| process-email-queue, api-key-request, company-claim, send-affiliate-commission-email, send-agent-digest, send-scan-report, send-search-digest | none |
| send-market-pulse | 20261009141000 first (without it a refused confirmation logs "NOT taken back" and still answers 502) |
| scan-heartbeat | 20261009143000 first, or its new check records a skip |
| save-lead, agent-pass-status | none |
| track-ab-event | `client_write_allowed` (20261004110000) and `mail_door_take` (20261004100000); if either is absent its tier fails open, logged (the writer's address ceiling still holds) |
| get-analytics | deploy before or with the frontend (old builds show `pricing:25%` as its own variant) |
| health-check, scheduled-health-probe | see the owner note on the live probe cron |

Frontend (Lovable publish): ProductSuccess, FreelanceBoost, CompanyClaim, ErrorBoundary, CardErrorBoundary, use-ab-test (+ Hero, FreeKeywordResults call sites), use-scroll-depth, use-time-on-page, nine locales.

## Migrations, in apply order

All four are independent of each other, self-verifying and safe to re-run.

1. `20261009140000_a_paid_order_stuck_mid_generation_is_retried_after_fifteen_minutes.sql` (before or with retry-failed-deliveries .10-09)
2. `20261009141000_a_pulse_confirmation_that_never_left_does_not_lock_its_address_out.sql` (before send-market-pulse .10-09)
3. `20261009142000_the_layoff_refresh_job_gets_the_ten_minutes_its_functions_ask_for.sql` (any time)
4. `20261009143000_a_cron_call_its_function_refused_is_counted_not_read_as_success.sql` (before scan-heartbeat .10-09)

New SECURITY DEFINER functions open to anon/authenticated: **none**. New service-role-only functions: `market_pulse_confirm_unsent(text,text)` (INVOKER), `cron_http_refusals(integer)` (DEFINER, reads pg_net's table). `get_failed_deliveries_for_retry(integer)` is re-issued with its grants restated (service_role only).

## Order in one line

migrations 1-4 -> send-product-email -> the other functions -> get-analytics with the frontend publish -> section 75.

## Tell the owner

- **Undelivered paid orders now reach your inbox** ("Paid order(s) not delivered"), once per order per day. The first run after the deploy mails every row already stuck: those are real (check them in Stripe by session id).
- **The heartbeat now fails on refused cron calls** (check `cron_http_refusals`): any 401/403 a cron got in the last hour degrades the status and the existing alert mails you, with the refusal's body (which names the gate). Expect it to surface a job re-keyed wrong or one of the five unrepo'd jobs (S8-050).
- **scheduled-health-probe answers anonymous callers from the database only.** The live job `scheduled-health-probe-every-5min` (created outside the repo, S8-050) writes heartbeat rows only if it sends the service-role key, `x-email-cron` or `x-admin-key`. Read its command; re-key it or unschedule it (scan-heartbeat-sentinel is the primary heartbeat).
- **Reply test:** reply once to a purchase mail and to a pulse confirmation; both should land in resumeboostersupp@gmail.com.
- **Seller identity:** fill `supabase/functions/_shared/seller-identity.ts` (both fields) when the entity and address exist; nothing renders until then.
- **Decisions still open:** the tips box (S8-035), retention for `ab_test_events` (S8-019), the email-queue cron (S8-017), the two unlisted definers (S8-020), the cron inventory (S8-050).
- Full Analysis and Freelance Boost buyers now get a mail at payment with the button back to their page.

## Rollback

- Functions: redeploy the previous builds; each is independent except roll back stripe-webhook before (or with) send-product-email.
- 20261009140000: re-apply 20261005110000's `get_failed_deliveries_for_retry` body (drops the `generating` arm).
- 20261009141000 and 20261009143000: additive; leave them, or `DROP FUNCTION public.market_pulse_confirm_unsent(text,text)` / `public.cron_http_refusals(integer)` after rolling back the functions that call them.
- 20261009142000: `SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'layoff-partition-refresh'), command := ' SELECT public.layoff_matches_rebuild(); SELECT public.refresh_layoff_partition(); ');`
- Frontend: the hooks and pages revert with the publish; rows already written with `pricing:` prefixes or `__click` test names stay readable by get-analytics .10-09.

## What to measure

- Section 75 all PASS (the process-email-queue line stays FAIL until the owner acts).
- `product_delivery_health`: `stuck` drops; no row sits in `generating` past ~30 min.
- Stripe dashboard: webhook response time for `checkout.session.completed` on product sales under ~2 s (was up to ~90 s).
- `email_logs` / Resend: `product_full_analysis` and `product_freelance_boost` sends appear after those sales.
- `ab_test_events`: `client_error` rows appear (variant `app` or a section) where there were almost none; `hero_layout__click` etc. views appear; `scroll_depth` variants `pricing:%`.
- get_cron_health: `layoff-partition-refresh` `ch_timeout` = 10min, no statement-timeout cancels.
- Saved-search digest log: `handedBack` 0 on normal runs; a positive number means the run hit its 100 s clock (the rows run next day).

## Handoffs to other groups

- Frontend footer/Terms/Privacy: mirror the two seller fields in a `src/config` constant equal to `_shared/seller-identity.ts`, with a test holding them equal.
- The free report's gated-keywords card says "These appear in 50–80% of job postings for your role — the top-quartile candidates have all of them" (FreeKeywordResults, hard-coded English): no code computes it. It sits in the offer stack owner decision (1) rewrites.
- ProductSuccess records `pro_` grants as purchases in its existing generated-content branch (wave 2 follow-up); the new saved-copy branch already skips `pro_`.
