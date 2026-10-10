# Wave 3: one integration of eight branches

Wave 3 merges eight branches onto `origin/main` at `31647d4c`. That base already
holds wave 2 (PR #24) and the deploy ledger (PR #25). The branches are
job-board, board-data-ingest, scan-ai, agents-api, payments-account,
email-ops, seo-content and tests-ci. The integration branch is
`wave3/integration`, built 2026-10-10. It also carries the S10-018 fix, the
ledger's new `--against` check, and the fixes the combination itself needed.
Each group's own note says what changed and why:
[job-board](../job-board-deploy-notes.md) (the `.92` section),
[board-data-ingest](board-data-ingest.md), [scan-ai](scan-ai.md),
[agents-api](agents-api.md), [payments-account](payments-account.md),
[email-ops](email-ops.md), [seo-content](seo-content.md),
[tests-ci](tests-ci.md). Those notes name their branches' own build strings.
The builds that deploy are the ones in the stamp table below.

## Deploy procedure: read this first

1. **Not before wave 2.** Wave 3 deploys ONLY after wave 2's step 1 AND step 2
   are verified live ([wave 2 README](../wave2/README.md): sections 61-66 and
   49 clean, then 20261008125000 and 20261008128000 applied and verified).
   Then main thaws (docs/DEPLOY-LEDGER.md §2). Production was still on
   job-board `.90` on 2026-10-10.
2. **Merge only through an integration PR whose suite passed and whose
   `--against` checks pass:**

       node scripts/deploy-ledger.mjs --against origin/main --against wave3/job-board --against wave3/board-data-ingest --against wave3/scan-ai --against wave3/agents-api --against wave3/payments-account --against wave3/email-ops --against wave3/seo-content --against wave3/tests-ci

   If main moved after this branch was built, merge main into it first, then
   re-run the checks and the suite.
3. **Regenerate the Lovable message at the merge commit**:
   `node scripts/deploy-ledger.mjs --message`. Never copy a list from this
   file: the ledger compares the merge commit with production. On this branch,
   before wave 2 deployed, it listed wave 2 and wave 3 together (87 functions,
   43 migrations plus 4 held). Once wave 2 is live it lists wave 3 alone.
4. **Step 1, one Lovable session.** Apply the migrations the message lists, in
   its order (it skips the held ones). Deploy the functions it lists. Publish
   the frontend from the same commit. These orders inside step 1 come from
   the group notes:
   - `20261009130000` (subscription_notices) before stripe-webhook. The new
     webhook claims a notice row on every new subscription.
   - `20261009111000` (Shortlist record) right before shortlist-evaluate and
     the frontend. In the gap, the old page's status updates are refused.
     Keep it to minutes.
   - `20261009141000` before send-market-pulse. `20261009143000` before
     scan-heartbeat.
   - send-product-email first among the mail functions. stripe-webhook sends
     it `full_analysis` and `freelance_*`.
   - get-analytics and health-check with or before the frontend.
   - `20261009121000` needs wave 2's `20261008132000`, which wave 2's step 1
     applies.

   Then run `bash scripts/verify-deploy.sh`. Sections 71-78 cover wave 3 and
   49 is the ledger. Every build line must PASS before step 2.
5. **Step 2, the held migrations.** Each waits for the condition recorded in
   `docs/deploy-ledger.json`:
   - `20261009100300_a_teamtailor_page_of_a_hundred_wrote_takedowns_nobody_made.sql`:
     wait until job-board answers `job-board.2026-09-09.92` AND
     `status.sliceStats` carries `build` .92 and a `buildSince` (section 71
     prints both). Applied earlier, it bounds itself by the old ceiling and
     must be run again.
   - `20261009160100_an_illinois_notice_dated_after_its_stamp_is_not_a_notice_date.sql`:
     wait until layoff-filings answers `layoff-filings.2026-10-09.3`, ideally
     after one nightly WARN run of that build. The old build re-upserts the
     misdated Illinois ids as active.
6. **Then the changelog** (owner rule): live-checked entries in nine locales,
   shipped in the next frontend publish.

Owner steps that code cannot do are in each group's note. The main ones:
- Stripe: Successful payments and finalized-invoice mails, and the
  `customer.subscription.trial_will_end` event.
- After layoff-filings .3 serves: layoff-filings `lca_wages` and
  `edgar_reread`.
- Keep the OAuth server off.
- The SmartRecruiters permission question.
- The seller identity: fill `src/config/seller.ts` AND
  `supabase/functions/_shared/seller-identity.ts`. They are now the only two
  places it lives.
- The `notify.resumebooster.work` DNS for transactional mail.
- The email-queue cron (S8-017).

## What wave 3 ships, per group

**job-board (.92).** Workday tenants that answer 500 to Deno's
`Accept-Language: *` get the runtime's `*` first and en-US only after a second
500 (S8-003). A vendor body that stalls after its headers now has a clock.
Teamtailor's RSS is read in pages of 100, and a repair marks the false
takedowns as suspect (S8-002, held migration 100300). A replayed lap proof
closes only rows it stamped. Windowed visits write exit rows. Re-admitted
postings drop their tombstones. A cold cursor moves by positions. USAJOBS rows
gain bodies, work mode, pay period and country, and the feed is named
'USAJOBS' with agency names searchable. Stemmed newest/salary orders. Employer
routes that hold "of". 179 employer-name overrides and `_shared/employer-names.ts`.
job-fit and application-fit keyed on the platform address.

**board-data-ingest.** VisitSource records utm/referrer on every page. Job
pages get a free "score against this job". The board gets the wave-2
handoffs, a phone menu and the first job above the fold. layoff-filings fixes
the IL/OR/MA maps, retries SEC fetches and adds the `edgar_reread` action. Pay
parsing for TW/AR/CL/CO/DO/UY dollars (SALARY_PARSE_VERSION 10), country
derivation (COUNTRY_MAP_VERSION 8), seniority and age sentences, clusterKey in
every script, and fit capped at 100. Four migrations (160000-160300; 160100
is held).

**scan-ai.** Shortlist redaction finds the candidate's name in many header
shapes and strips contact lines, and the evaluation record cannot be
rewritten (111000). Grounding reads grouped figures. Premium keeps the buyer's
own contacts. The free report ends with exactly two offers (Full Analysis and
Pro). One time to results is stated: within 90 seconds, a bound the code
guarantees. Rescans hit the cache without spending a slot, and partial reports
are refunded. Day-long limiter allowances last a day (110000). Paid generators
keep verdicts in English.

**agents-api.** The apply agent stops drafting protected answers, reads
sponsorship, countries and contact fields the way a person would, and signs
only an own-folder résumé (120000). A refunded pass packet cannot be sent
free (121000). /v1 and MCP withhold SmartRecruiters (122000). The $99 card
names the four sending systems. Claude and ChatGPT users get the host's own
unkeyed allowance (123000 counts addresses only).

**payments-account.** One checkout policy across seven checkouts: return
origin, receipt email, Terms version, referral, and tax behind
`EU_UK_SALES`. A Terms line sits above every buy and sign-up button, recorded
per press. Subscribers get confirmation and trial-reminder mails as legal
notices (130000). EU/UK withdrawal sits behind the switch (133000). Account
deletion cancels plans first. The closure log is metered per account (131000).
The success page shows the saved copy. Scan packs and $0 sessions deliver.

**email-ops.** Undelivered paid orders mail the owner. Stuck generations are
retried after 15 minutes (140000), and the webhook answers Stripe before the
model. Purchase mails link back to the purchase, with a reply address on
every customer mail. Seller footer lines. track-ab-event address tiers. The
digest/pulse run clocks. Health probes are live only for our callers.
Migrations: the layoff refresh's ten minutes (142000), cron refusals counted
(143000), and pulse confirmations taken back (141000).

**seo-content.** Employers named by the name they use, across pages, JSON-LD
and the bake. The carry base is the live sitemap and ledger, with "no longer
listed" stubs. Company pages list their own openings. Dataset markup and
lastmod by content. /methodology renders from a mirror of the scorer. "Zero
Ghost Jobs" and other unprovable claims are gone. Literal legal dates, and
the seller line (empty until set). No functions and no migrations.

**tests-ci.** The five flaky tests wait for what they assert. ci.yml runs
every check whatever an earlier one said, plus deno-tests and built-output
jobs. board-health.yml parses. botwall-sweep and the deploy check read
`.env`. Vacuous guards are re-anchored, and setup deletes only its own PDFs.
The verifier probes writers with read-only GETs. Five functions get a build
stamp through `_shared/fn-build.ts` `stamped()`.

**Integration additions.**
- S10-018 (`20261009100400`): the nightly orphan cleanup keeps a board's
  own `source:token` stamp while that board's postings exist. It had deleted
  every one nightly, and the next slice re-seeded it fresh.
- `node scripts/deploy-ledger.mjs --against <ref>` (exit 3).
- Two held migrations.
- The fixes listed under "Where two groups met".

## Where two groups met (the integration's decisions)

- **Build stamps.** The branches reused identical strings on different code
  (send-search-digest .2026-10-09.1 on three branches, eleven more on two,
  generate-application-answers .2026-10-10.2 on two, and others). Every
  function whose folder or `_shared` imports differ from main now answers a
  string that sorts after main's and after, and differs from, every branch's.
  The table is below; `--against` enforces it. job-board keeps its
  reservation .92. create-pass-checkout is `2026-09-27.4`: the pass guard
  reads an October date's 10 as a pass number, so the guard keeps main's
  strict form. payments-account had added an exemption for that line, which
  was not kept.
- **Purchase links.** email-ops and payments-account each wrote a module with a
  function named `purchaseLinkFor`, with the arguments the other way round. One
  module remains, `_shared/purchase-links.ts`. It carries the Full Analysis
  page and never links the homepage, and it holds payments' catalogue table.
  `purchase-link.ts` is deleted.
- **Seller identity.** The two strings live in one edge file
  (`_shared/seller-identity.ts`). It is read by `_shared/seller.ts`, which
  holds the one footer builder, and `_shared/seller-footer.ts` passes that
  builder on. The frontend has one `src/config/seller.ts`, whose
  `TERMS_LAST_UPDATED` is `TERMS_VERSION`. It also has one `SellerIdentity`
  that takes both groups' variant names. The footer renders one line, where
  the merge had placed two.
- **Saved purchases.** ProductSuccess keeps payments' `applySavedContent` and
  pro_ rule and email-ops' recover-purchase and manual_regen_ paths.
  verify-product-purchase now answers the saved copy itself, so the counting
  rule (a sale only in the tab that started the checkout, or on first use)
  covers that path too. A test case pins it.
- **The free report.** scan-ai's two offers. payments' Terms line sits above
  the Full Analysis button. seo-content's score banner and plurals.
  email-ops' trackClick.
- **Time to results / prices.** scan-ai's guaranteed bound ({{seconds}})
  everywhere, including the trust tile seo-content had removed. The value
  table states the Full Analysis price (scan-ai), and the /vs pages state the
  catalogue range (seo-content).
- **Locale files.** Rebuilt by a three-way key merge of all six branches that
  touched them. Every key a branch added is present, and the nine files hold
  identical key sets (4,160), with no duplicates. Keys a branch retired are
  gone unless merged code reads them (`trustIndicators.badges.instant.label`
  stays). For the seven keys scan-ai and seo-content changed differently,
  scan-ai's values are kept. For `seller.soldBy` and `seller.controller`,
  payments' are kept.
- **Silent merges fixed.**
  - job-fit declared `FN_BUILD` twice.
  - send-search-digest imported `sellerFooterHtml` twice.
  - send-product-email had payments' freelance entries twice (TS1117), plus
    calls into the deleted module.
  - TrustIndicators lost the `Zap` import.
  - The footer rendered two seller lines.
- **Combination test fixes.**
  - Mocks that hid email-ops' `reachedInThisTab`.
  - Two digest fixtures read the plan by address; agents-api reads it by
    account.
  - seo-content's methodology mirror now runs scan-ai's moved
    `buildScoreAudit`.
  - The $25 guard reads the button that still buys the Full Analysis.
  - Three verifier probes of writers moved from POST to read-only GET
    (tests-ci's S8-125 rule).
  - Section 66 accepts the later /v1 apiVersion.

## Build stamps (function: main -> integration)

76 functions differ from main in their folder or a direct `_shared` import.
Each answers the integration build on its OPTIONS preflight
(`x-fn-build: <fn>.<build>`). job-board also answers it as `status.version`,
and layoff-filings as its GET `version`.

| function | main (31647d4c) | integration | strings the branches set |
|---|---|---|---|
| admin-regenerate-delivery | 2026-10-05.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| agent-mcp | 2026-10-05.2 | **2026-10-09.4** | board-data-ingest 2026-10-09.1, agents-api 2026-10-09.3 |
| agent-pass-status | 2026-10-08.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| agent-runner | 2026-10-05.2 | **2026-10-09.2** | board-data-ingest 2026-10-09.1 |
| analyze-linkedin-profile | 2026-10-05.1 | **2026-10-09.1** | none (a _shared import it reads changed) |
| analyze-resume | 2026-10-08.2 | **2026-10-09.2** | payments-account 2026-10-09.1 |
| api-key-request | 2026-10-04.2 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| application-fit | none | **2026-10-09.2** | job-board 2026-10-09.1, board-data-ingest 2026-10-09.1 |
| apply-agent | 2026-10-05.2 | **2026-10-09.3** | agents-api 2026-10-09.2 |
| apply-broker | 2026-10-05.2 | **2026-10-09.2** | agents-api 2026-10-09.1 |
| company-claim | 2026-10-08.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| create-agent-checkout | 2026-10-08.2 | **2026-10-09.4** | payments-account 2026-10-09.3 |
| create-checkout | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1 |
| create-pass-checkout | 2026-09-27.3 | **2026-09-27.4** | payments-account 2026-10-09.1 |
| create-portal-session | 2026-10-08.2 | **2026-10-09.2** | payments-account 2026-10-09.1 |
| create-product-checkout | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1 |
| create-scan-pack-checkout | 2026-10-05.1 | **2026-10-09.2** | payments-account 2026-10-09.1 |
| create-subscription-checkout | 2026-10-08.1 | **2026-10-09.4** | payments-account 2026-10-09.3 |
| create-test-checkout | none | **2026-10-09.2** | payments-account 2026-10-09.1 |
| create-test-coupon | none | **2026-10-09.2** | tests-ci 2026-10-09.1 |
| delete-account | none | **2026-10-09.4** | payments-account 2026-10-09.3 |
| free-keyword-scan | 2026-10-08.3 | **2026-10-09.3** | payments-account 2026-10-09.1, scan-ai 2026-10-09.2 |
| free-keyword-scan-stream | 2026-10-08.1 | **2026-10-09.3** | scan-ai 2026-10-09.2 |
| generate-application-answers | 2026-10-10.1 | **2026-10-10.3** | scan-ai 2026-10-10.2, agents-api 2026-10-10.2 |
| generate-apply-package | 2026-10-08.2 | **2026-10-09.4** | scan-ai 2026-10-09.3 |
| generate-ats-defense | 2026-10-08.1 | **2026-10-09.2** | scan-ai 2026-10-09.1 |
| generate-career-path | 2026-10-05.1 | **2026-10-09.3** | scan-ai 2026-10-09.2 |
| generate-career-snapshot | 2026-10-10.1 | **2026-10-10.3** | scan-ai 2026-10-10.2 |
| generate-cohort-report | none | **2026-10-09.2** | tests-ci 2026-10-09.1 |
| generate-cover-letter | 2026-10-05.1 | **2026-10-09.3** | scan-ai 2026-10-09.2 |
| generate-cover-letter-stream | 2026-10-05.1 | **2026-10-09.2** | scan-ai 2026-10-09.1 |
| generate-elevator-pitch | 2026-10-10.1 | **2026-10-10.2** | none (a _shared import it reads changed) |
| generate-freelance-boost | 2026-10-08.2 | **2026-10-09.1** | none (a _shared import it reads changed) |
| generate-graduate-gameplan | 2026-10-10.1 | **2026-10-10.3** | scan-ai 2026-10-10.2 |
| generate-interview-coach | 2026-10-05.1 | **2026-10-09.3** | scan-ai 2026-10-09.2 |
| generate-keyword-fix | 2026-10-05.1 | **2026-10-09.2** | scan-ai 2026-10-09.1 |
| generate-premium-package | 2026-10-05.1 | **2026-10-09.3** | scan-ai 2026-10-09.2 |
| generate-premium-package-stream | 2026-10-05.1 | **2026-10-09.2** | scan-ai 2026-10-09.1 |
| generate-product-preview | 2026-10-10.1 | **2026-10-10.3** | scan-ai 2026-10-10.2 |
| generate-recruiter-view | 2026-10-10.1 | **2026-10-10.2** | none (a _shared import it reads changed) |
| generate-resume-roast | 2026-10-05.1 | **2026-10-09.1** | none (a _shared import it reads changed) |
| generate-summary | 2026-10-10.1 | **2026-10-10.2** | none (a _shared import it reads changed) |
| generate-tailored-resume | 2026-10-10.1 | **2026-10-10.2** | none (a _shared import it reads changed) |
| get-account-data | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1 |
| get-analytics | 2026-10-08.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| health-check | 2026-10-08.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| import-freelance-profile | 2026-10-10.1 | **2026-10-10.2** | none (a _shared import it reads changed) |
| job-board | 2026-09-09.91 | **2026-09-09.92** | job-board 2026-09-09.92 |
| job-fit | none | **2026-10-09.2** | job-board 2026-10-09.1, board-data-ingest 2026-10-09.1 |
| layoff-filings | 2026-09-25.1 | **2026-10-09.3** | board-data-ingest 2026-10-09.1, tests-ci 2026-10-09.2 |
| nl-search | 2026-10-08.1 | **2026-10-09.1** | none (a _shared import it reads changed) |
| parse-resume-structured | 2026-10-05.1 | **2026-10-09.1** | none (a _shared import it reads changed) |
| process-email-queue | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| public-api | 2026-10-08.2 | **2026-10-09.2** | board-data-ingest 2026-10-09.1, agents-api 2026-10-09.1 |
| recover-purchase | none | **2026-10-09.2** | email-ops 2026-10-09.1 |
| retry-failed-deliveries | 2026-10-05.1 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| save-lead | none | **2026-10-09.2** | email-ops 2026-10-09.1 |
| scan-credits | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1 |
| scan-heartbeat | 2026-10-08.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| scheduled-health-probe | 2026-10-08.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| scrape-linkedin | none | **2026-10-09.2** | tests-ci 2026-10-09.1 |
| send-affiliate-commission-email | 2026-10-04.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| send-agent-digest | 2026-10-08.1 | **2026-10-09.2** | email-ops 2026-10-09.1, agents-api 2026-10-09.1 |
| send-analysis-email | 2026-10-06.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| send-market-pulse | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| send-product-email | 2026-10-06.1 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| send-scan-report | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| send-search-digest | 2026-10-08.1 | **2026-10-09.2** | board-data-ingest 2026-10-09.1, payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| shortlist-evaluate | 2026-10-10.1 | **2026-10-10.3** | scan-ai 2026-10-10.2 |
| stripe-webhook | 2026-10-08.2 | **2026-10-09.4** | payments-account 2026-10-09.3, email-ops 2026-10-09.1 |
| test-ai-fallback | 2026-10-08.1 | **2026-10-09.1** | none (a _shared import it reads changed) |
| track-ab-event | 2026-09-27.2 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| verify-product-purchase | 2026-10-08.2 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| verify-scan-pack-purchase | 2026-10-05.1 | **2026-10-09.2** | payments-account 2026-10-09.1 |
| warm-up | none | **2026-10-09.2** | tests-ci 2026-10-09.1 |
| withdraw-subscription | none | **2026-10-09.4** | payments-account 2026-10-09.3 |

The eleven functions marked "none" changed only through a `_shared` module
they import (`language-instruction.ts`, `model-spend-gate.ts`,
`owner-alert.ts`, `salary-extract.ts` and the like). They get a new build
anyway, so a deploy of the new bundle can be told apart from the old one.

## Migrations, in apply order

Filename order is apply order. The ledger excludes the held ones and lists
the rest. Each file checks itself and is safe to re-run.

| # | migration | group | note |
|---|---|---|---|
| 1 | 20261009100100_an_employer_named_by_its_system_code_gets_the_name_it_uses | job-board | independent |
| 2 | 20261009100200_federal_jobs_were_credited_to_whichever_agency_sorted_last | job-board | independent |
| 3 | 20261009100300_a_teamtailor_page_of_a_hundred_wrote_takedowns_nobody_made | job-board | **HELD**: after job-board .92 serves with sliceStats.build/buildSince |
| 4 | 20261009100400_the_orphan_cleanup_keeps_a_boards_own_stamp_while_its_postings_exist | integration (S10-018) | independent; cron.alter_job by name |
| 5 | 20261009110000_a_day_long_allowance_survives_an_hourly_callers_sweep | scan-ai | before or with the functions |
| 6 | 20261009111000_a_shortlist_evaluation_cannot_be_rewritten_and_a_status_changes_only_with_its_decision | scan-ai | right before shortlist-evaluate + frontend |
| 7 | 20261009120000_a_mandate_can_name_only_a_resume_in_its_own_folder | agents-api | independent |
| 8 | 20261009121000_a_refunded_pass_application_is_sent_only_if_it_is_paid_for_again | agents-api | after wave 2's 20261008132000 |
| 9 | 20261009122000_v1_names_the_employers_whose_rows_it_withholds | agents-api | either side of public-api |
| 10 | 20261009123000_the_adoption_reader_counts_addresses_not_a_hosts_own_buckets | agents-api | with or before agent-mcp |
| 11 | 20261009130000_a_subscription_notice_is_sent_once_per_subscription_and_kind | payments-account | BEFORE stripe-webhook |
| 12 | 20261009131000_a_tracker_row_reads_the_closure_log_by_the_day_and_a_free_account_has_bounds | payments-account | with the frontend |
| 13 | 20261009132000_an_api_key_request_keeps_the_terms_it_was_shown | payments-account | independent |
| 14 | 20261009133000_a_withdrawal_is_acknowledged_once_per_subscription | payments-account | needed before the EU/UK switch |
| 15 | 20261009140000_a_paid_order_stuck_mid_generation_is_retried_after_fifteen_minutes | email-ops | before or with retry-failed-deliveries |
| 16 | 20261009141000_a_pulse_confirmation_that_never_left_does_not_lock_its_address_out | email-ops | before send-market-pulse |
| 17 | 20261009142000_the_layoff_refresh_job_gets_the_ten_minutes_its_functions_ask_for | email-ops | any time |
| 18 | 20261009143000_a_cron_call_its_function_refused_is_counted_not_read_as_success | email-ops | before scan-heartbeat |
| 19 | 20261009160000_an_exit_cost_filing_is_not_printed_as_a_workforce_reduction | board-data-ingest | independent |
| 20 | 20261009160100_an_illinois_notice_dated_after_its_stamp_is_not_a_notice_date | board-data-ingest | **HELD**: after layoff-filings .3 serves |
| 21 | 20261009160200_a_company_lander_reads_only_its_own_employer | board-data-ingest | independent |
| 22 | 20261009160300_a_federal_wage_filing_needs_an_employer_hiring_in_the_us | board-data-ingest | independent |

No wave-3 migration depends on wave 2's held 20261008125000 or
20261008128000. None touches their cron jobs or reads what they create, so
nothing more is held for them.

## Checks run on this branch (2026-10-10)

- App typecheck (`npm run typecheck`, the pre-commit/pre-push gate): clean.
- Worker typecheck (`cd worker && tsc --noEmit`): clean.
- `bash scripts/check-functions.sh`: every edge function (all 76 changed
  ones included) passes `deno check`, and so do the Deno tests beside them.
  `deno.lock` is unchanged.
- The full vitest suite. The first run on the merged tree failed 4 tests, the
  four combination failures above. Each was fixed and its file re-run green,
  and the pre-push gate re-runs the suite.
- `node scripts/deploy-ledger.mjs --message`: exit 0, no MUST BUMP. It
  lists wave 2 and wave 3 together because wave 2 is not live yet.
- `--against` origin/main and all eight wave-3 tips: 0 violations. The
  job-board .92 reservation is reported as shared with wave3/job-board.
  `--head 173a740b` (the merge before the restamp) reports the collisions,
  for example 17 against wave3/email-ops.
