# Wave 3: one integration of eight branches

Wave 3 merges eight branches onto `origin/main`. It was built on `31647d4c`
(wave 2, PR #24, and the deploy ledger, PR #25) and has since taken main twice.
At `25363267` it took PR #26 (migration `20261008131500` and the test helper
that starts from Supabase's default grants), Lovable's staged-migration stubs
0106-0129, and the "Deployed 53 functions" commit that put wave 2 live. At
`a3201ce7` it took PR #27 (the default-grants guard), PR #28 (the ledger's
`verifiedDeploys` record and wave 2's released holds) and PR #29 (wave 2's
changelog). The branches are
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
   Then main thaws (docs/DEPLOY-LEDGER.md §2). Wave 2's step 1 is deployed:
   on 2026-10-10 the live preflights answered job-board.2026-09-09.91,
   stripe-webhook.2026-10-08.2 and create-pass-checkout.2026-09-27.3. Main
   records that deploy in `verifiedDeploys` (commit `1fc1702d`). It released
   wave 2's two held migrations (20261008125000, 20261008128000) on
   2026-10-11. That is wave 2's step 2, and it goes before anything here.
2. **Merge only through an integration PR whose suite passed and whose
   `--against` checks pass:**

       node scripts/deploy-ledger.mjs --against origin/main --against wave3/job-board --against wave3/board-data-ingest --against wave3/scan-ai --against wave3/agents-api --against wave3/payments-account --against wave3/email-ops --against wave3/seo-content --against wave3/tests-ci

   If main moved after this branch was built, merge main into it first, then
   re-run the checks and the suite.
3. **Regenerate the Lovable message at the merge commit**:
   `node scripts/deploy-ledger.mjs --message`. Never copy a list from this
   file: the ledger compares the merge commit with production. Before wave 2
   deployed it listed wave 2 and wave 3 together (87 functions, 43 migrations
   plus 4 held). With main merged in at `a3201ce7` it lists 76 functions and
   23 migrations, with wave 3's two held. The 23 are wave 2's two released
   step-2 migrations, listed first, then wave 3's 21. Once wave 2's step 2 is
   applied, the list is wave 3 alone.
4. **Step 1, one Lovable session.** Apply the migrations the message lists, in
   its order (it skips the held ones). Deploy the functions it lists. Publish
   the frontend from the same commit. These orders inside step 1 come from
   the group notes:
   - `20261009130000` (subscription_notices) before stripe-webhook. The new
     webhook claims a notice row on every new subscription.
   - `20261009134000` (S11-053) before stripe-webhook and
     withdraw-subscription: both write the notice's `sent_at`.
   - `20261009134300` (S11-074) before or with create-product-checkout.
   - `20261009111000` (Shortlist record, additive half) before
     shortlist-evaluate: the new function writes `jd_text_scored`, which only
     it adds. It refuses nothing the live function or page does (S11-056).
     The lockdown half, `20261009112000`, is HELD (below).
   - `20261009141000` before send-market-pulse. `20261009143000` before
     scan-heartbeat.
   - `20261009144000` before send-search-digest and send-agent-digest. The
     new digests write a give-back at once and rely on the claim's new order
     to keep that row from leading the next claim of the same run.
   - send-product-email first among the mail functions. stripe-webhook sends
     it `full_analysis` and `freelance_*`.
   - get-analytics and health-check with or before the frontend.
   - `20261009121000` needs wave 2's `20261008132000`, which in turn needs
     PR #26's `20261008131500` first (Lovable rolled 132000 back twice
     without it). Main's staged-runner stubs record both as applied, so the
     ledger lists neither.

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
- The `notify.resumebooster.work` DNS for the queued mail (auth mails and
  the drip). The subscription notices no longer depend on it: since the S11
  round they go straight through Resend from `billing@resumebooster.work`,
  so the `resumebooster.work` domain must stay verified in Resend.
- `STRIPE_PORTAL_LOGIN_URL`: set it to Stripe's customer-portal login link
  and check it in a private window (S11-015).
- The EU/UK switch, in this order (S11-142): publish the frontend, turn on
  Stripe Tax, then set `EU_UK_SALES=on`. `VITE_EU_UK_SALES` is not needed.
- Pro plans bought between wave 2's binding and its deploy (S11-061, owner
  action in Stripe only, no code): 20261008130000 bound Pro rows by address at
  22:51Z, but the old checkout and webhook kept writing unbound rows until the
  deploy at 00:35Z, and nothing binds those rows later. In the Stripe
  Dashboard, list the subscriptions created from 22:45Z to 00:36Z, and the
  sessions of the old checkout completed up to about 24 hours after 00:35Z.
  For each, confirm the buyer's account and set the subscription's
  `metadata.user_id` to that account's id; the next Pro refresh binds the row.
  Never bind by `updated_at` (checkProByEmail rewrites it, which would reopen
  S8-001).
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
The S11 round (w31/payments-account, migrations 134000-134300, builds
`.61`): legal notices sent directly through Resend and recorded only after a
2xx; paid deliveries retried through the day with outages spending no tries
and an owner alarm when one runs out; the Premium Package and Cover Letter
made once by the checked generators and shown from the saved copy; a five-
minute wait for slow generations; ATS Defense asks for and carries up to three
roles; the co-pilot writes its cover letters; the Full Analysis survives a
reload; legacy subscribers reach billing; the EU/UK box follows the server's
switch and belongs to its own line; the tracker cap counts only the member's
rows. Details in [payments-account](payments-account.md) ("S11 round").

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
- The fixes from the review of the integration, listed below.

## Fixes from the review of the integration (2026-10-10)

Four read-only reviewers read the branch. Each finding was reproduced
first, then fixed with a behaviour test that fails on the old file and passes
on the new one.

- **Main had moved.** Main was merged in at `25363267`, and again at
  `a3201ce7` when it moved during this work (above). PR #28 rewrote the
  ledger script that this branch had refactored. The merge keeps the
  refactor (the pure rules are exported and tested) and carries #28's two
  rules into it: `verifiedDeploys`, and a stamp the function never sends
  counting as no marker. Section 40 takes main's `build_ge` form of the
  check-alerts line.
- **The free report sold a third product.** Every scan run against a posting
  showed "Prepare this exact application", whose sample ended in a $7 Apply
  Assistant checkout. The card is gone, along with its two locale keys in all
  nine files. The two-offer test now mounts the report with the posting
  source, presses every sample and unlock, and finds only the Full Analysis
  and Pro prices. Verifier section 72 FAILs while the deployed chunk still
  carries the card.
- **Role chips bought the Full Analysis.** After a sheet of jobs was imported,
  each role chip started the $5 checkout with no price and no Terms line.
  A chip now picks its role and buys nothing. The priced link below, under
  its line, starts the checkout.
- **The pass opened itself after sign-in.** Coming back from /auth with
  `?buy=pass` started create-pass-checkout with no press and no Terms line
  on screen. The return now lands on the Buy button, focused, with its line,
  and only a press opens checkout.
- **A tap during checkout erased the Terms.** `purchaseTerms()` reads the last
  press, and the homepage Full Analysis and every product checkout read it
  only after awaits. Both now read it before their first await.
- **Digest give-backs led every later run.** Migration `20261009144000` gives
  `user_job_searches` and `agent_mandates` an attempt stamp. Both claims now
  order by it first and stamp it, and return their rows in the order they
  chose them. A row a run worked waits behind every row not yet worked.
  send-search-digest `.3` writes each give-back at once, with no `finally`
  holding them, and every board call has a clock (20 s, never past 140 s
  into the run). send-agent-digest `.3` keeps the claim's stamp for a
  mandate it may not mail and for an empty shortlist. It hands the cursor
  back only for a failed send or a failed read. The new test runs both shipped
  handlers against the real claims in pglite.
- **The ledger's --against rule was laxer than §2.** A reserved job-board
  version is now shared only with a branch of the workstream that owns it,
  only when HEAD belongs to that workstream too, and only while main does not
  carry it. Before, any reservation was shared with any ref (.91, .92 and
  .93). Branches map to workstreams through `branches` in
  `docs/deploy-ledger.json`. A relabel must change the marker and nothing
  else on its line. A sequence with a leading zero (`.04`) is unreadable.
- **Two wave-2 functions read MUST BUMP for a while.** With wave 2 live and
  before main's `verifiedDeploys` record arrived, the ledger answered MUST
  BUMP (exit 2) for affiliate-payout-request and industry-corrections-digest.
  Wave 2 had changed both after writing their `2026-10-08.1` stamps. They
  were restamped, then the restamp was reverted once `a3201ce7` came in:
  the record proves that the 1fc1702d deploy shipped those changes. Neither
  deploys with wave 3. The ledger now answers exit 0, with no MUST BUMP and
  no CHECK.

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
  identical key sets (4,158 after the review retired the two
  `freeResults.applyBridge` keys), with no duplicates. Keys a branch retired are
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

| function | main (a3201ce7) | integration | strings the branches set |
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
| send-agent-digest | 2026-10-08.1 | **2026-10-09.3** | email-ops 2026-10-09.1, agents-api 2026-10-09.1 |
| send-analysis-email | 2026-10-06.1 | **2026-10-09.2** | email-ops 2026-10-09.1 |
| send-market-pulse | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| send-product-email | 2026-10-06.1 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| send-scan-report | 2026-10-08.1 | **2026-10-09.2** | payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
| send-search-digest | 2026-10-08.1 | **2026-10-09.3** | board-data-ingest 2026-10-09.1, payments-account 2026-10-09.1, email-ops 2026-10-09.1 |
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
| 6 | 20261009111000_a_shortlist_evaluation_cannot_be_rewritten_and_a_status_changes_only_with_its_decision | scan-ai | additive (jd_text_scored, shortlist_decide, jd_version): before shortlist-evaluate |
| 6a | 20261009112000_a_shortlist_evaluation_is_closed_to_the_browser_once_no_live_code_writes_it_from_there | parsers-scan (S11-056) | **HELD**: after shortlist-evaluate .2026-10-10.62 serves AND the published Shortlist page decides through shortlist_decide (section 72 PASSes both) |
| 7 | 20261009120000_a_mandate_can_name_only_a_resume_in_its_own_folder | agents-api | independent |
| 8 | 20261009121000_a_refunded_pass_application_is_sent_only_if_it_is_paid_for_again | agents-api | after wave 2's 20261008132000 |
| 9 | 20261009122000_v1_names_the_employers_whose_rows_it_withholds | agents-api | either side of public-api |
| 10 | 20261009123000_the_adoption_reader_counts_addresses_not_a_hosts_own_buckets | agents-api | with or before agent-mcp |
| 11 | 20261009130000_a_subscription_notice_is_sent_once_per_subscription_and_kind | payments-account | BEFORE stripe-webhook |
| 12 | 20261009131000_a_tracker_row_reads_the_closure_log_by_the_day_and_a_free_account_has_bounds | payments-account | with the frontend |
| 13 | 20261009132000_an_api_key_request_keeps_the_terms_it_was_shown | payments-account | independent |
| 14 | 20261009133000_a_withdrawal_is_acknowledged_once_per_subscription | payments-account | needed before the EU/UK switch |
| 14a | 20261009134000_a_legal_notice_is_recorded_as_sent_only_after_resend_accepted_it | payments-account (S11) | BEFORE stripe-webhook and withdraw-subscription |
| 14b | 20261009134100_a_paid_delivery_is_retried_through_the_day_and_an_outage_does_not_spend_its_tries | payments-account (S11) | any time |
| 14c | 20261009134200_a_served_posting_keeps_no_closure_date_and_the_tracker_cap_counts_only_what_its_owner_added | payments-account (S11) | **after the frontend, right after 131000** (131000 re-creates the cap in its older form); one daily cron job |
| 14d | 20261009134300_a_pro_grant_keeps_the_roles_its_ats_defense_was_bought_for | payments-account (S11) | before or with create-product-checkout |
| 15 | 20261009140000_a_paid_order_stuck_mid_generation_is_retried_after_fifteen_minutes | email-ops (edited in S11) | **BEFORE retry-failed-deliveries**: the new sweep always passes p_include_generating, which only this file's function takes; the live sweep is handed no stuck-generation row (S11-146) |
| 16 | 20261009141000_a_pulse_confirmation_that_never_left_does_not_lock_its_address_out | email-ops | before send-market-pulse |
| 17 | 20261009142000_the_layoff_refresh_job_gets_the_ten_minutes_its_functions_ask_for | email-ops | any time |
| 18 | 20261009143000_a_cron_call_its_function_refused_is_counted_not_read_as_success | email-ops | before scan-heartbeat |
| 19 | 20261009144000_a_digest_given_back_waits_behind_the_rest_of_the_queue | integration (review) | BEFORE send-search-digest and send-agent-digest |
| 20 | 20261009160000_an_exit_cost_filing_is_not_printed_as_a_workforce_reduction | board-data-ingest | independent |
| 21 | 20261009160100_an_illinois_notice_dated_after_its_stamp_is_not_a_notice_date | board-data-ingest | **HELD**: after layoff-filings .3 serves |
| 22 | 20261009160200_a_company_lander_reads_only_its_own_employer | board-data-ingest | independent |
| 23 | 20261009160300_a_federal_wage_filing_needs_an_employer_hiring_in_the_us | board-data-ingest | independent |

No wave-3 migration depends on wave 2's held 20261008125000 or
20261008128000. None touches their cron jobs or reads what they create, so
nothing more is held for them.

## Checks run on this branch (2026-10-10)

As built on `31647d4c`:
- The first full vitest run on the merged tree failed 4 tests, the four
  combination failures above. Each was fixed and its file re-run green.
- `--head 173a740b` (the merge before the restamp) reports the collisions,
  for example 17 against wave3/email-ops.

After main was merged in (`25363267`, then `a3201ce7`) and the review fixes
landed:
- App typecheck (`npm run typecheck`, the pre-commit/pre-push gate): clean.
- Worker typecheck (`cd worker && tsc --noEmit`): clean.
- `bash scripts/check-functions.sh`: every edge function passes `deno check`,
  and so do the Deno tests beside them. `bash scripts/deno-tests.sh`: 66
  passed, 0 failed. `deno.lock` is unchanged.
- The full vitest suite at `4f77c2b1` (846 files, 10,938 tests): 840 files
  passed. Five failed on timeouts while the machine's load average stood
  between 250 and 600, and one never started its worker. All six passed when
  re-run alone afterwards. After the `a3201ce7` merge, the pre-push gate
  runs the suite again.
- Each review fix's test was run on the old file (failing) and the new one
  (passing): the ledger rule 8 of 13 failing before, the free report's third
  offer, the role chips 3/3, the pass return, the tap during checkout 4/4,
  and the digest claims 8/8 (with the old functions and without
  20261009144000).
- `node scripts/deploy-ledger.mjs --message`: exit 0, with no MUST BUMP and
  no CHECK. It lists 76 functions and 23 migrations (wave 2's two released
  ones first), and holds 2.
- `--against` origin/main and all eight wave-3 tips: 0 violations. The
  job-board .92 reservation is reported as wave 3's, shared with
  wave3/job-board. `--against wave3/tests-ci --head wave3/board-data-ingest`
  now reports the two tips' .91 on different job-board code as a violation.
