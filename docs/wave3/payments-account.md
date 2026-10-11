# Wave 3: payments + account (deploy note)

> **Integrated 2026-10-10 on `wave3/integration`.** The builds this note names
> are this branch's own strings. Several were reused by other wave-3 branches on
> different code, so every function the integration changed answers a later
> build: see the stamp table in [README.md](README.md). Deploy from the ledger
> (`node scripts/deploy-ledger.mjs --message` at the merge commit), never from
> the tables below.

Branch `wave3/payments-account`, from main at 12a37285 (wave 2, PR #24). It works:

- every item in the S8 debug sweep of 2026-10-08 (private register `platform-debug-2026-10-08/register.json`) with `fix_group` "payments" or "account";
- the platform sweep of 2026-10-04's "account" group;
- the commercial items in the checkout, subscription and account code from the commercial-readiness plan of 2026-10-08 (items 1, 10, 11, 12 and 14);
- the owner decisions of 2026-10-08 that touch this code: decision 3 (EU/UK sales behind a switch), the empty seller identity, and the wave-2 handoff about `pro_` grants.

The verifier is `scripts/verify-deploy.d/74-wave3-payments-account.sh`.

**Production is still on the 2026-10-05 builds. Wave 2 (PR #24) has not been deployed.** Every function here is built from main at 12a37285, so each build also carries wave 2's change to that function. Deploy wave 2 first, following its own two-step order in `docs/wave2/README.md`, or deploy both together in that order. Do not deploy this branch's functions over a database without wave 2's migrations.

## What changes for a customer

| Register | Commit | What changes |
| --- | --- | --- |
| S8-060, S8-059; items 1, 11, 12, 14; affiliate line | 49b9ac8d | **One policy.** Seven functions create Stripe sessions, and they now share one rule (`_shared/checkout-policy.ts`). **Return address.** Stripe sends the buyer back only to our own hosts, localhost, or an exact origin listed in `CHECKOUT_EXTRA_ORIGINS`. It used to send them to any Origin, and three functions fell back to lovable.dev. **Receipt.** A one-time payment names `receipt_email` when the buyer's address is known: signed in, or typed into the product or scan-pack form. An anonymous $5 Full Analysis buyer (most of them) has no address until Stripe's page, so their receipt depends on the dashboard's **Successful payments** switch (owner step 1). **Renewal terms.** Pro and the agent show their renewal terms next to Stripe's pay button. The agent's terms state the trial only when the session carries one. **Terms version and referral.** Every checkout records the Terms version and the referral code on the Stripe session and on `checkout_starts`. Five of the six checkouts used to drop the referral. A referral on a checkout outside the catalogue is recorded at $0 (`referral_commission: "none"`), so the affiliate page stays true. **Tax.** Stripe Tax, billing address and tax ID turn on only with `EU_UK_SALES=on`. **Anonymous scan packs.** A scan pack bought without signing in no longer attaches to the typed address's Stripe customer. |
| Items 11, 12; S8-055; L3-20; S8-058 | 78e31329, 4478cd07 | **Above every buy and sign-up button.** The button now carries "By continuing you agree to the Terms of Service and the Privacy Policy" (`PurchaseTerms`). The free report's own buy buttons got theirs in 4478cd07 (below). A line covers only the buttons in its own block, and the Terms version is recorded only for a press on one of them. Pro's button says it renews monthly until you cancel. The agent's button names the trial, says only first-time subscribers get it, and says how to avoid being charged. With the EU/UK switch on, the button also carries the withdrawal-waiver or service-start box. **Sign-up.** A password or magic-link sign-up stores `terms_version` and `terms_accepted_at` on the account. **Terms date.** /terms prints the Terms version date. It used to print today's date. **New Pro subscribers (S8-055).** They are confirmed live from the Stripe session and never offered Go Pro again. **Sign-in (L3-20).** An expired session is no longer reported as a sign-out. /agent, /shortlist and /account send a signed-out visitor to `/auth?next=`. "Resend confirmation" keeps `?next`. **Credits (S8-058).** The copy says credits follow the browser and the signed-in account. Nine locales. |
| S8-014, S8-119, S8-120 | e5804452 | **Back from Stripe.** Pressing Back from Stripe resets the checkout overlay, which now offers Close. **Credit upsell.** It is a real dialog and prints the server's reset hours. **Funnel.** The $5 Full Analysis records `product_clicked` and `checkout_started`. |
| Item 11 (Cal. B&P 17602) | 04a0d284 | **Confirmation mail.** A new subscription gets a confirmation: the price, that it renews until cancelled, the trial's end and first charge, what cancelling does, and how to cancel. **Trial reminder.** A trial gets a reminder 3 days before it ends. The webhook queues both through the transactional queue (`enqueue_email_delayed`). Each is claimed once in `subscription_notices`. No refund is promised. |
| L6-30, L3-13 | c9fe513e | **Account deletion.** Deleting an account cancels its plans and removes its CV files before the user is deleted (the order is fixed in 74f0e6e0, below). **Unlinked plans.** A plan on the address that names no account is cancelled only for a proven mailbox. Otherwise the user gets 409 with Stripe's emailed portal login. **Replaced CV.** A new upload removes the old CV file, once the mandate names the new one (d501fb07, below). |
| S8-053, S8-054 | 7060b711 | **100%-off sessions.** A comped ($0) Full Analysis or scan pack is delivered. **Scan-pack balance.** verify-scan-pack-purchase answers only that purchase's credits, never the address's whole balance. |
| S8-009, S8-015, S8-016, S8-074; wave-2 handoff | 23310733 | **Success page.** It shows the saved copy, bound to the résumé the purchase was made for. **Purchase mails.** They say "Ready" only when content exists. They link `/product-success?session_id=…` and print the session ID. **Freelance Boost.** The purchase gets a link mail and can be recovered. A returning buyer is not sold it again. **Recovery language.** Recovery keeps the buyer's language. **`pro_` grants.** A `pro_` grant is no longer recorded as a full-price sale. |
| S8-018, L13-14, L11-08, S8-103 | 933f8f55 | **Closure log.** It is metered per account per day: 1,000 distinct ids a day, and an id already answered that day is free. A tracker row's `job_id` cannot be rewritten by a client. **Closure outcomes.** A suspect or superseded closure is not a takedown. A posting stamped missing reads `going_down`, not "still posted". **Row caps.** Owner tables get row caps and length bounds. |
| S8-056, S8-057 | 854a730b | **Try again after a cancelled checkout.** It reuses what the checkout was bound to. **Stale résumé copies.** A stored résumé copy older than 23 hours is not reused. |
| S8-104 | 6a5a1ee8 | **Blocked storage.** A browser that blocks site storage now gets a working page with in-memory storage. It used to get a blank page. |
| L3-17 | 54af8be0 | **Interviews card.** It counts calendar days. Tomorrow is "Tomorrow" all day, and today's interview stays listed until local midnight. |
| L3-11, L3-12 | 274f020a | **Résumé builder.** The builder never saves an empty draft. It offers a newer scan once over a real draft. Each report rewrite replaces one bullet, the right one. |
| L6-12, L3-22, L3-14 | 8de03049 | **Purchases.** The list includes the account's Agent Passes. **Get more credits.** It opens the credit pack dialog. **Download all my data.** It reads every table the account owns: 16 tables, all rows, plus each stored CV with a signed link to it (a078e830, below). |
| Item 11 (FAQ) | 51f2abb2 | **FAQ.** "Is this a subscription?" says both plans renew until cancelled and that the trial becomes the paid plan. Nine locales. The prerender reads it from en.json. |
| Item 12 | 16672c29 | **Data API key form and connector consent.** /data-api's key form and /oauth/consent's Allow carry the Terms line. A key request stores the Terms version on its `api_key_requests` row. |
| Decision 3; item 14 | 662a3940 | **EU/UK withdrawal.** withdraw-subscription and the account page's "Withdraw within 14 days" panel. **Off by default.** They answer 404 and render nothing until the switch is on. **With the switch on:** for a plan billed in the EU, the EEA or the UK (b6e1f02a, below), paid invoices are refunded less the days provided, the plan is cancelled at once, and the withdrawal is acknowledged by mail once. |
| Item 10; owner instruction | 994da17a | **Seller identity.** `SELLER` (src/config/seller.ts and `_shared/seller.ts`) is empty and renders nothing. Once it is set, it appears in the footer, on /terms, on /privacy, beside every buy button, and in the footer of the digest, the pulse and the fix-plan drip. |
| (integration) | 1b7db82f | **Locale files.** The new locale namespaces moved out of the files' tail, so trial merges with the three other wave-3 branches are clean. |

### Review fixes (2026-10-09)

| Review finding | Commit | What changes |
| --- | --- | --- |
| Legal notices dropped for drip unsubscribers (major) | 97553011 | **Notices the law requires.** The subscription confirmation, the trial reminder and the withdrawal acknowledgement carry `legal_notice: true`. process-email-queue sends a payload that sets it and names one of those three labels past an `unsubscribe` suppression. A bounce or a complaint still suppresses it, and no other label can claim the flag. |
| Withdrawal offered to every country (major) | b6e1f02a | **Only where the law gives it.** withdraw-subscription refunds and cancels only a plan billed in the EU, the EEA or the UK. The newest paid invoice's address decides, then the customer's billing address; no country read means no right assumed (`outside_territory`). `{ preview: true }` answers the eligible count and changes nothing, and the account panel shows only when a plan qualifies. The confirmation's 14-day paragraph goes only to a checkout whose billing country is in the territory. New copy `accountPage.withdraw.outsideTerritory`, nine locales. |
| /agents/pass bought with no Terms line or waiver box | 5a42e461 | The pass page renders `PurchaseTerms` above "Buy a pass", so the call carries the Terms version and, with the switch on, the waiver box is there. |
| Replaced CV deleted before the mandate was saved | d501fb07 | The old CV files go only after the mandate names the new file. A failed save or a closed tab leaves the old file in place. |
| Delete cancelled plans, then refused, then said nothing changed | 852405e8 | (Order superseded by 74f0e6e0 in the 2026-10-10 round: plans are now cancelled before the CV goes.) delete-account reads the plans, removes the files, then cancels the plans last, just before deleting the user. A partial cancel reports `subscriptionsCancelled`, and the page then says a subscription was cancelled but the account was not deleted (`accountPage.deletePlanCancelled`). `deleteRetry` now says the account was not deleted, never "nothing was deleted". Nine locales. |
| free-keyword-scan bundles the changed scan-credits.ts | 08bf6191 | Its build moves to `free-keyword-scan.2026-10-09.1`, and it is in the deploy table. It is the first function to resolve a held pack, so its old bundle refuses a $0 comped pack. |
| S8-014 wiring untested | c7167985 | Test only: the whole homepage is mounted with the checkout overlay up, and a back/forward restore closes it. |
| CV missing from the data export (L3-14) | a078e830 | Each stored CV carries `downloadUrl`, signed by the member's own session for a day, with `downloadUrlExpiresAt`. A file storage would not sign carries `downloadError`. |
| Renewal terms in English for every buyer | b0a58e6f | The subscribe buttons send the page's language. The sentence beside Stripe's pay button is in that language (nine), and the session's `locale` matches where Stripe has it: pt is pt-BR, tl is fil, and Hindi keeps Stripe's own choice. A body with no language stays English with no locale, as before. |
| Receipt claim in this note | (this note) | Corrected above and in owner step 1: anonymous one-time buyers need the dashboard switch. |

### Review fixes (2026-10-10)

| Review finding | Commit | What changes |
| --- | --- | --- |
| Free report's buy buttons had no Terms line, and recorded it anyway (major) | 4478cd07 | **Measured** by mounting the report and pressing every button: 13 presses started a checkout with no line in their block. They were the next-steps Full Analysis and Interview Coach, five Premium Package buttons, Cover Letter, the Apply kit, the keyword report, and three more Full Analysis entry points. Each still sent `termsVersion`, because any line mounted anywhere (the add-ons, the pricing tiers) counted. **Now:** each of those buttons has a line in its own block. `purchaseTerms()` sends the version, and with the switch on the box, only when the press that started the checkout landed in a mounted line's block (a capture-phase click/submit listener). The checkout overlay's retry keeps the first press. **Box refusal on the homepage.** `Index.handleCheckout` answers create-checkout's 400 `consentRequired` by asking for the box and closing the overlay. It used to show "Checkout failed". |
| Success page polls ran past the verifier's 30 an hour (minor) | 5f32d253 | Six asks over about a minute (5, 8, 12, 15, 20 s) instead of 24 over two minutes, so a load and a reload use 12 of the 30. A refused ask after the purchase was confirmed in progress takes the same path as running out of asks. It is never shown as "We Couldn't Verify Your Purchase Yet". |
| Storage guard treated a full localStorage as blocked (minor) | eda8d73b | A storage is replaced only when reading it throws, or when a write is refused for a reason other than a full quota. A full storage is kept, so the saved sign-in, the scan history and the drafts still read. |
| Delete removed the CV before the cancel could fail (minor) | 74f0e6e0 | **New order:** read the plans, cancel them, switch the agent off (`agent_mandates.active = false`, the stop apply-broker enforces), remove the CV files, delete the user. A failed cancel, or an agent that cannot be switched off, keeps the CV. A refusal says what had already changed (`subscriptionsCancelled`, `agentStopped`, `cvRemoved`), and the account page reads each out (`accountPage.deleteAgentStopped`, `deleteCvRemoved`; nine locales). |
| Withdrawal deducted the days provided without the buyer's request (minor) | a0bf9ae7, aaa3eb6a | The days provided are kept only when the plan records the buyer's express request that it start inside the period (art. 7(3), 14(3)). The request is read from `service_start_consent` on the subscription, else on its checkout session. **Without the request the refund is full** (art. 14(4)(a)(ii)). Both plan checkouts now copy the request onto `subscription_data.metadata`. |
| Freelance Boost purchase id kept in localStorage for good (minor) | fa483896 | The browser keeps only that it bought and when, for seven days, never the purchase id. Without the link, the page offers no buy button, reads nothing back, and asks for the link in the purchase email (`freelanceBoost.boughtHereTitle`, `openYourLink`; nine locales). The result loads only from the link. |
| Pro card stuck on "Confirming" with Go Pro disabled (minor) | ba4b77a7 | When the ten asks run out with the plan still not live, the card says it could not confirm yet: refresh in a minute, or contact support (`proPlan.notConfirmedYet`, nine locales). Go Pro works again; the checkout answers `alreadySubscribed` for a plan that is live. |
| Notices quoted the list price to a buyer with a promotion code (minor) | 5b805f0a | **When a plan carries a discount,** stripe-webhook reads its first charge from Stripe: the paid first invoice, or for a trial `invoices.createPreview`. It reads how long the discount lasts from the coupon's duration and the discount's end. **What the mail says:** the confirmation and the trial reminder state the discounted first charge, what follows it, and the list price after the promotion. **No discount:** no extra Stripe call, and the wording is unchanged. |

## Already fixed on main, or not done

- **S8-001 (high): already fixed by wave 2.**
  - The billing-portal half was fixed in d3d23f52. create-portal-session opens only for the account the plan names or a proven mailbox.
  - The catalogue half was fixed in 550f9e2b. `isProCached` is gone, and Pro is read by account.
  - Verified against main at 12a37285.
- **One trial per card fingerprint: documented, not built.**
  - The spec allowed this only without new PII storage. Stripe Checkout collects the card after the session, and with it the trial, is fixed. So the only enforcement point is after payment, with two ways to do it:
    - End a trial the buyer was just shown, which charges someone who was promised free days. That contradicts the button copy and the 17602 disclosure.
    - Look up earlier trials by card, which needs a stored fingerprint (a pseudonymous card identifier, new personal data) or Stripe Search on a fingerprint written into Stripe metadata.
  - Both need an owner decision on the trial copy. The current rule (account id, address, and every Stripe customer behind it) stands. The gap: a new address, a new account and the same card still get a trial.
- **Connector consent record.** /oauth/consent shows the Terms line, but no per-consent row is written. The account behind the session already carries its sign-up `terms_version`.

## Apply the migrations first, in this order

Each migration checks itself with a DO block (it RAISEs if the change did not land) and is safe to re-run. None adds a function a client role can call, so nothing goes on the census allowlist.

1. `20261009130000_a_subscription_notice_is_sent_once_per_subscription_and_kind.sql`
   - Adds the `subscription_notices` table (PRIMARY KEY (subscription_id, kind)). It is service_role only.
   - **It must land before stripe-webhook.2026-10-09.1.** Otherwise every new subscription's `checkout.session.completed` answers 500 (the notice claim fails), and Stripe redelivers until the table exists. The rest of that event's work still runs.
2. `20261009131000_a_tracker_row_reads_the_closure_log_by_the_day_and_a_free_account_has_bounds.sql`
   - **Adds:**
     - `lifecycle_reads`;
     - the metered plpgsql `get_application_lifecycle` (same signature and return type; still authenticated + service_role);
     - the `user_applications_job_id_fixed` trigger;
     - the `owner_row_cap` triggers;
     - the NOT VALID length CHECKs.
   - **Clears once** `posting_closed_at` on tracker rows whose posting is served again.
   - **Depends on:**
     - `get_application_lifecycle` from 20261004110000 (present);
     - `job_board_closures.superseded` and `.suspect`;
     - `job_board_postings.missing_since`;
     - the owner tables. A missing owner table is skipped with a NOTICE.
   - Deploy the frontend with it. Account renders `going_down` and persists a date only for `came_down`.
3. `20261009132000_an_api_key_request_keeps_the_terms_it_was_shown.sql`
   - Adds `api_key_requests.terms_version` (nullable, with a date-format check). It depends on 20261004100000, which is present: the verifier's probe reaches the table.
   - api-key-request.2026-10-09.1 writes the column on a best-effort basis. Before this migration lands, it logs a warning and still takes the request.
4. `20261009133000_a_withdrawal_is_acknowledged_once_per_subscription.sql`
   - Widens `subscription_notices_kind_check` to include `withdrawal`. It depends on 130000.
   - It is needed only before the EU/UK switch goes on.

## Deploy these functions

| Function | Build | Why |
| --- | --- | --- |
| create-checkout | `create-checkout.2026-10-09.1` | The checkout policy: origin, receipt, Terms version, referral, tax switch |
| create-product-checkout | `create-product-checkout.2026-10-09.1` | The same (the one commissioned checkout) |
| create-subscription-checkout | `create-subscription-checkout.2026-10-09.3` | The same, plus renewal terms in the buyer's language, the session locale, `{CHECKOUT_SESSION_ID}` on success (S8-055), and the service-start request on the plan's metadata |
| create-agent-checkout | `create-agent-checkout.2026-10-09.3` | The same, plus trial and renewal terms beside the pay button, in the buyer's language, and the service-start request on the plan's metadata |
| create-pass-checkout | `create-pass-checkout.2026-10-09.1` | The checkout policy |
| create-scan-pack-checkout | `create-scan-pack-checkout.2026-10-09.1` | The checkout policy; no attach to the typed address's customer (S8-059) |
| create-test-checkout | `create-test-checkout.2026-10-09.1` | First build stamp; the policy. A dev page only, so deploying it is optional |
| create-portal-session | `create-portal-session.2026-10-09.1` | The return address is one of our hosts (S8-060) |
| stripe-webhook | `stripe-webhook.2026-10-09.3` | Subscriber confirmation and trial reminder, marked legal notices, stating a promotion's charge and term; the 14-day paragraph only for EU/EEA/UK billing; Boost link mail at payment; `pro_` grants are not sales; referral conversions at $0 outside the catalogue |
| verify-product-purchase | `verify-product-purchase.2026-10-09.1` | Saved copy for every generated product; inProgress; no "Ready" mail without content (S8-009); $0 referral record |
| send-product-email | `send-product-email.2026-10-09.1` | Session link and ID in the mail (S8-015) |
| retry-failed-deliveries | `retry-failed-deliveries.2026-10-09.1` | Passes the session ID to the mail |
| analyze-resume | `analyze-resume.2026-10-09.1` | Accepts a comped $0 session (S8-053) |
| scan-credits | `scan-credits.2026-10-09.1` | A comped pack's grant (S8-053) |
| verify-scan-pack-purchase | `verify-scan-pack-purchase.2026-10-09.1` | This purchase's credits only (S8-054) |
| delete-account | `delete-account.2026-10-09.3` | First build stamp; cancels plans, switches the agent off, removes CVs, then deletes (L6-30, L3-13); a refusal says what had already changed |
| get-account-data | `get-account-data.2026-10-09.1` | The account's passes (L6-12) |
| api-key-request | `api-key-request.2026-10-09.1` | Stores the Terms version (item 12) |
| withdraw-subscription | `withdraw-subscription.2026-10-09.3` | **New.** EU/UK withdrawal, for plans billed in the EU, the EEA or the UK only; the days provided are kept only with the buyer's recorded service-start request, otherwise a full refund; `{ preview: true }`; the acknowledgement marked a legal notice; 404 while `EU_UK_SALES` is off. `verify_jwt = false` in config.toml (it checks the token itself) |
| send-search-digest | `send-search-digest.2026-10-09.1` | Seller footer line (empty until set) |
| send-market-pulse | `send-market-pulse.2026-10-09.1` | Seller footer line (empty until set) |
| send-scan-report | `send-scan-report.2026-10-09.1` | Seller footer line (empty until set) |
| process-email-queue | `process-email-queue.2026-10-09.1` | A legal notice (`legal_notice` and one of the three notice labels) passes an unsubscribe suppression; a bounce or a complaint still stops it |
| free-keyword-scan | `free-keyword-scan.2026-10-09.1` | Bundles the changed `scan-credits.ts`: a comped $0 scan pack the browser holds now pays for a scan (S8-053) |

**Shared modules changed.** `checkout-policy.ts` (new), `subscription-notice.ts` (new), `withdrawal.ts` (new), `seller.ts` (new), `purchase-link.ts` (new), `full-analysis.ts`, and `scan-credits.ts`. In the 2026-10-10 round, `subscription-notice.ts` and `withdrawal.ts` changed again. Their importers (stripe-webhook, withdraw-subscription) are both at .3.

- free-keyword-scan imports `scan-credits.ts` and resolves a held pack through the changed `grantFromStripe`, so it is in the table. Its old bundle refuses a $0 comped pack.
- create-checkout, retry-failed-deliveries and stripe-webhook import `full-analysis.ts`. All three are in the table.
- Every importer of `checkout-policy.ts` and `withdrawal.ts` is in the table (both modules are new in this branch).

**Deploy the frontend with the same commit.** It carries:

- the Terms, renewal and trial lines;
- the Pro confirmation on return;
- the sign-in fixes;
- the success page and Freelance Boost recovery;
- the builder, the interviews card and the account's Purchases, credits and export;
- the storage guard;
- the FAQ (the prerender bakes it into /pricing);
- the withdrawal panel and the seller line, both rendering nothing by default;
- the free report's Terms lines and the per-press Terms record (4478cd07), the success page's capped polling, the storage guard's full-quota rule, the delete messages, the Freelance Boost mark and the Pro card's give-up line.

## Environment switches (all optional, all off by default)

| Name | Where | Effect |
| --- | --- | --- |
| `EU_UK_SALES` = `on` | function secret | Stripe Tax, billing address and tax ID on every session; the waiver or service-start box is required; the confirmation's 14-day paragraph for EU/EEA/UK billing addresses; withdraw-subscription answers, for plans billed there only |
| `VITE_EU_UK_SALES` = `on` | frontend build | The box above every buy button, and the account's withdrawal panel (shown only when the function's preview finds a qualifying plan). Turn it on together with `EU_UK_SALES` |
| `STRIPE_TERMS_CONSENT` = `on` | function secret | Stripe's own required Terms checkbox (`consent_collection`). Needs the Terms URL in the Stripe dashboard first, or Stripe refuses every session |
| `CHECKOUT_EXTRA_ORIGINS` | function secret | A comma-separated list of exact https origins (for example the Lovable preview) that Stripe may return to |
| `STRIPE_PORTAL_LOGIN_URL` | function secret | Stripe's emailed portal sign-in (`https://billing.stripe.com/...`), named in the notices and in delete-account's 409 |
| `SUPPORT_EMAIL` | function secret | Where the confirmation's EU/UK paragraph says to write. Default resumeboostersupp@gmail.com |

## Owner steps

1. **Receipts (item 1).**
   - A one-time checkout passes `receipt_email` only when the buyer's address is known when the session is made: a signed-in buyer, or one who typed an address (the product and scan-pack forms). Stripe honours it whatever the dashboard says.
   - **An anonymous $5 Full Analysis buyer, most of them, gets no receipt unless Successful payments is on.** Plan renewals need the same switch.
   - In the Stripe Dashboard go to Settings, then Customer emails:
     - turn on **Successful payments** (anonymous one-time buyers and renewals);
     - under Subscriptions and invoices, turn on **Send finalized invoices and credit notes to customers**.
   - Code cannot check these switches.
2. **Trial reminder (item 11).** Add `customer.subscription.trial_will_end` to the stripe-webhook endpoint's events. The confirmation needs nothing new.
3. **Mail delivery.** The notices, the withdrawal acknowledgement and the purchase links are delivered only once `notify.resumebooster.work` has DNS. This step was already on the list.
4. **Stripe's Terms checkbox (optional).**
   - First, set the Terms of service URL in Stripe: Settings, then Public details.
   - Then set `STRIPE_TERMS_CONSENT=on`.
   - The checkout already records the Terms version without it.
5. **EU/UK (decision 3).** Leave both switches unset until the VAT registration. If `STRIPE_SECRET_KEY` is a restricted key, it needs read access to Checkout Sessions, because withdraw-subscription reads a plan's service-start request from its checkout session. Then, in this order:
   - turn on Stripe Tax (origin address and registrations);
   - apply 133000 (it may already be applied);
   - set `EU_UK_SALES=on` and `VITE_EU_UK_SALES=on` together;
   - redeploy the frontend.
   - The Terms' "No Refunds" paragraph already says "except where required by applicable law". Ask the lawyer to add the statutory withdrawal wording before the switch goes on.
6. **Seller identity (item 10).** Once the entity and address are chosen:
   - fill both `src/config/seller.ts` and `supabase/functions/_shared/seller.ts` (a test holds them equal);
   - redeploy the frontend, send-search-digest, send-market-pulse and send-scan-report.
   - Never fill them with a placeholder.

## Rollback

- **Functions.** Redeploy each function from main at 12a37285, or from the build production serves now (process-email-queue and free-keyword-scan included). withdraw-subscription is new: delete it, or leave it, since it answers 404 while the switch is off.
- **Frontend.** Redeploy the previous build.
- **Migrations, newest first, each after its functions have been rolled back.**
  - 133000:

    ```sql
    ALTER TABLE public.subscription_notices DROP CONSTRAINT subscription_notices_kind_check;
    ALTER TABLE public.subscription_notices ADD CONSTRAINT subscription_notices_kind_check CHECK (kind IN ('confirmation','trial_ending'));
    ```

    Delete any `withdrawal` rows first.
  - 132000:

    ```sql
    ALTER TABLE public.api_key_requests DROP COLUMN terms_version;
    ```

  - 131000:
    - Re-run the `get_application_lifecycle` section of 20261004110000 (lines 767-832). The return type is the same, so CREATE OR REPLACE applies.
    - Then drop the triggers `user_applications_job_id_fixed_trg` and `<table>_owner_row_cap_trg`, the functions `user_applications_job_id_fixed()` and `owner_row_cap()`, the `<table>_<column>_len` constraints, and `lifecycle_reads`.
    - The one-time clearing of wrong `posting_closed_at` dates cannot be undone. Those dates were for postings that are served again.
  - 130000:

    ```sql
    DROP TABLE public.subscription_notices;
    ```

    Only after stripe-webhook has been rolled back.

## What to measure

- **After the next new Pro or agent subscription:**
  - `subscription_notices` has one `confirmation` row, and `process-email-queue` sent a `subscription-confirmation`.
  - A trial gets a `trial_ending` row 3 days before its end, once step 2 above is done.
- **`checkout_starts.metadata`:**
  - `termsVersion` is present on checkouts started from a buy button, the free report's included. A null row was started by a press with no Terms line in its block, or by no press at all. Read its `origin_path` and `checkout_function` to find the button, then give that button a line.
  - `referral` is true for referred visitors on all six checkouts.
  - `affiliate_conversions` gets $0 rows for non-catalogue referred sales.
- **Stripe:** a signed-in or typed-address one-time charge shows a receipt sent to that address; an anonymous Full Analysis charge shows one only once Successful payments is on.
- **Legal notices:** a `subscription-confirmation`, `trial-ending` or `subscription-withdrawal` to an address in `suppressed_emails` with reason `unsubscribe` logs `sent`, not `suppressed` (the verifier prints the query).
- **Lifecycle:** `lifecycle_reads` rows per account per day stay at or under 1,000. No member is refused on reload. `user_applications` updates that change `job_id` fail (no page does this).
- **Accounts:** get-account-data returns `passes` for a pass buyer. One owner-run test account shows that delete-account cancels the plan, sets `agent_mandates.active` false, empties `resumes/{id}/`, then deletes. The account page's export carries a working `downloadUrl` for each stored CV.
- **Withdrawal:** withdraw-subscription answers 404 `not_available` until the switch is on (the verifier checks this). Once it is on, a plan without `service_start_consent` is refunded in full: the Stripe refund equals `amount_paid`.
- **Promotions:** the next subscription made with a promotion code gets a confirmation stating "Your first charge, with your promotion, is …". It does not say "You are charged $45.00 every month".
- **Success page:** `verify-product-purchase` 429s in the function logs fall to near zero. A load makes at most six calls.

## Handoffs to the integrator and other groups

- **Shared build stamps.** This branch now bumps `process-email-queue` (wave 2 email-ops' function) and `free-keyword-scan` (wave3/scan-ai changes it too). If both branches bump the same function, keep the higher build and both changes; the verifier asks for 2026-10-09.1 or later of each.

- **wave3/scan-ai (FreeKeywordResults). The merge conflicts, and the line has to be added by hand.**
  - **On this branch,** 4478cd07 puts a Terms line on every buy button the main-branch report renders. It changes:
    - the `TermsAbove` wrapper on CoverLetterButton, KeywordFixButton, ApplyAssistantButton and PremiumPackageButton;
    - the next-steps block;
    - the hidden-issues card, the gated keywords and the final CTA.
  - **What scan-ai deletes.** Its rewrite (94778203) deletes all of that.
  - **What still renders on scan-ai.** `handleUpgradeClick` is still referenced about 15 times (`action_required_banner`, `peer_percentile_cta`, the four `locked_*` career insights, `premium_receipt`, `triggered_questions`, `locked_bullet_rewrites`, `locked_keyword_gap`, `locked_career_strategy`, `next_steps_full_analysis`). Every one but `next_steps_full_analysis` sits behind `!diagnosticLayout` or `gateDeepInsights ?`. Those are constants: `diagnosticLayout = true` and `gateDeepInsights = false`. So the report renders exactly two offers:
    - the Full Analysis button (`data-offer="fullAnalysis"`, which goes through Index's `handleCheckout`);
    - the Pro link to /pricing, which carries its own lines.
  - **Resolving the merge:**
    - in every FreeKeywordResults conflict, take scan-ai's side;
    - keep `import { PurchaseTerms } from "./PurchaseTerms";`;
    - add `<PurchaseTerms kind="payment" />` as the first child of the `space-y-2.5` div inside `data-testid="report-next-steps"`, directly above the Full Analysis button.
  - **The safety net.** `src/test/the-free-reports-buy-buttons-carried-no-terms-and-a-line-elsewhere-recorded-them.test.tsx` mounts the report and presses every button. It fails after the merge until that line is in.
  - **If the dead entry points come back.** Should either constant flip, each of those entry points needs its own line.
  - **The rule for any new buy button.** It must sit in the same element as a `PurchaseTerms` line. Otherwise its checkout records no Terms version, and with the EU/UK switch on, no box.
- **wave3/agents-api.**
  - This branch touches `api-key-request` (Terms version), `DataApi.tsx` (the line above "Email me a link") and `OAuthConsent.tsx` (the line above Allow). Trial merges with their branch are clean.
  - **send-agent-digest gets no seller footer here.** Their branch changes it, and it is a subscriber service mail. Add `sellerFooterHtml()` there if the lawyer treats it as marketing.
- **Privacy page.** /privacy still prints today's date as "Last updated" (`Privacy.tsx`). This is the same defect that /terms had, which this branch fixed with `TERMS_VERSION`. It needs the date the policy text last changed, so it is left for the policy rewrite (item 13).
- **Wave-2 README.** The "Not in this deploy" follow-ups this branch closes:
  - "ProductSuccess records pro_ grants as full-price purchases" (23310733);
  - "the one-trial rule does not key on the card fingerprint". This one is documented above as not built, and why.

## S11 round (2026-10-11): branch `w31/payments-account`

Built on `wave3/integration` at 1b7bfe53 from the S11 sweep register (group payments-account) and the owner decisions of 2026-10-11. It ships inside wave 3. Every item was reproduced first; each fix has a behaviour test that fails on the file it replaces (each was run against the old file).

### What changes

| Register | What changes |
| --- | --- |
| S11-053 | The confirmation, the trial reminder and the EU/UK withdrawal acknowledgement go straight through Resend (the key and verified domain paid deliveries use) with the notice's idempotency key, and `subscription_notices.sent_at` is written only after a 2xx. The queue is not used for them. A failed send records nothing and the webhook answers 500, so Stripe redelivers. A withdrawal's acknowledgement is written into the ledger (`pending_mail`) before the plan is cancelled; if its first send fails, stripe-webhook sends it on the `customer.subscription.deleted` event the cancel causes. A bounced or complained address gets nothing; a drip unsubscribe does not stop a legal notice. |
| S11-014 | A failed delivery is retried at 5 min, 15 min, 1 h, 2 h, 4 h, 6 h, then 8 h, within the 24 hours the résumé lives. A 402, 408, 425, 429 or 5xx, a timeout, a network error, a deadlock or the limiter being unavailable adds to `transient_failures` and spends no try (read from the error text the live builds already write, so the live webhook benefits as soon as the migration applies). `max_retries` is 8 counted failures. Open rows bought in the last day keep their place (old budget 3 becomes 8). retry-failed-deliveries mails the owner once when a delivery runs out. |
| S11-146 | `get_failed_deliveries_for_retry` gains `p_include_generating` (default false). The live sweep's call is handed no 'generating' row, so it cannot hold its five-row batch with rows it skips; the new sweep passes true. 20261009140000 is edited in place (not yet applied anywhere) and its header no longer says the old build spends a retry. |
| S11-015 | The billing portal opens for a legacy plan with no `metadata.user_id` when a Pro or agent cache row bound to this account names the same Stripe customer (owner decision; no metadata backfill). The agent card shows the portal's refusal instead of doing nothing. |
| S11-016 | After the Full Analysis renders, the address names it (`?session_id=…&share=…`), so a reload, Back or a restored tab loads the saved copy; the buyer's own reload is not labelled a shared view. With no résumé in the tab, the page asks analyze-resume by the session alone, and analyze-resume answers a redeemed session from its saved copy (a session with nothing delivered still needs the résumé). |
| S11-017 | `validateTailoredResume` blanks any contact value the source résumé lacks (phone by digits, URL by host and path, email exactly) and any placeholder ("N/A", "Not provided"), and reports them (`removedContact`). generate-apply-package's prompt carries the copy-only contact rule. `contact-guard.ts` moved to `_shared` so both generators share it. |
| S11-018, S11-054 | The success page no longer streams the Premium Package or the Cover Letter. verify-product-purchase makes them with the non-stream generators and the page renders the saved copy; with nothing bound, the page makes them from its own résumé with the same generators. generate-premium-package now runs the figure check too (an invented figure is a retryable 422, never delivered); generate-cover-letter now runs the contact guard first. verify reports "in progress" for every product the page shows from the saved copy (not the Coach or the Career Path, which make their own), whatever the page asked. Review round (.71): with a readable résumé bound and the server's generation failed, the page makes nothing and says it is coming (the retry sweep makes and mails it); verify's hasResumeData is false when the bound résumé could not be read. The stream functions are no longer called by the page; they stay deployed and gated. |
| S11-140 | The page asks for five minutes while the server is generating (14 asks a load, inside the verifier's 30 an hour), then says the product is still being made and will be emailed. It never regenerates from the tab while a generation runs. |
| S11-055 | A saved ATS Defense report renders with the ATS Parse Simulation run on the tab's résumé (and its layout flag). The saved apply-kit objects (webhook, verify, sweep) keep `groundingReport`. |
| S11-074 | ATS Defense asks for up to three roles before checkout (one dialog, mounted once in App, opened by `purchaseProduct`; closing it starts no checkout). create-product-checkout writes them to the session's `target_roles` metadata or the Pro grant's new `target_roles` column; the webhook, verify, the sweep and the page's fallback all send them to generate-ats-defense. |
| S11-038 | The Pro co-pilot writes each saved job its cover letter through generate-cover-letter (figure check, contact guard, model spend gate), and a kit made without one is given its letter alone. |
| S11-138 | A client cannot date a tracker row while its posting is served (trigger), whatever page version writes it; a daily job (pg_cron `tracker-served-postings-undated`, 05:23 UTC, its own two-minute timeout) undates rows whose posting came back. |
| S11-139 | The tracker cap counts only rows the member added (`user_applications.written_by`, stamped by the trigger; the agent's mirror rows already written are marked), skips the INSERT arm of an upsert to a row that exists, and applies to service_role on `shortlist_candidates`; shortlist-evaluate refuses a full account before any model call. Keep says when the tracker is full. |
| S11-141 | Each Terms line keeps its own EU/UK box; the checkout sends the box of the line that holds the press, and the box clears as the checkout starts. |
| S11-142 | The box shows when the build flag is on or the server says its switch is on: create-checkout answers a GET with `{euUkSales}`, asked once per page, and a refusal names its box and carries the wording. The owner publishes the page first and flips `EU_UK_SALES` after; `VITE_EU_UK_SALES` is no longer needed. |
| S11-143, S11-144 | The builder's "Rescan this version" marks its own export as the draft's source, and "Start Over" sticks until a real import. |
| S11-145 | A sign-out pressed in one tab writes a short-lived mark the other tabs read, so they do not report an expired session. |
| Copy | The pass says an application counts only when the agent can send it (the agents group's rule), the co-pilot says it writes a résumé and a letter per job, the agent plan's Morning Queue and review lines are shorter, and ATS Defense says it targets the roles you name. All nine locales. |

### Migrations (stamp range 20261009134000-134900)

| migration | order |
| --- | --- |
| `20261009134000_a_legal_notice_is_recorded_as_sent_only_after_resend_accepted_it` | after 130000 and 133000; BEFORE stripe-webhook and withdraw-subscription (both write `sent_at`, `provider_message_id`, `pending_mail`) |
| `20261009134100_a_paid_delivery_is_retried_through_the_day_and_an_outage_does_not_spend_its_tries` | any time; the live webhook and sweep benefit at once |
| `20261009134200_a_served_posting_keeps_no_closure_date_and_the_tracker_cap_counts_only_what_its_owner_added` | after 131000; with or before the frontend (schedules one daily cron job) |
| `20261009134300_a_pro_grant_keeps_the_roles_its_ats_defense_was_bought_for` | before or with create-product-checkout (the function mints the grant without the roles if the column is missing) |
| `20261009140000_…` (edited) | either side of retry-failed-deliveries: the new opt-in argument defaults to false |

Every new function REVOKEs from PUBLIC, anon and authenticated, every file checks itself and is safe to re-run, and the one cron command sets its own `statement_timeout`. None needs a hold.

### Builds (sequence 61, so no other wave-3 round shares a string)

analyze-resume, api-key-request, create-agent-checkout, create-checkout, create-portal-session, create-product-checkout, create-scan-pack-checkout, create-subscription-checkout, create-test-checkout, generate-apply-package, generate-cover-letter, generate-premium-package, retry-failed-deliveries, stripe-webhook, verify-product-purchase and withdraw-subscription answer `2026-10-09.61`; generate-application-answers and shortlist-evaluate answer `2026-10-10.61`; create-pass-checkout answers `2026-09-27.61` (the pass guard keeps the September date). `node scripts/deploy-ledger.mjs --against origin/wave3/integration`: 0 violations. job-board is untouched (.92).

### Owner steps

- **Resend sender:** the notices are sent from `billing@resumebooster.work`; the `resumebooster.work` domain must stay verified in Resend (it is the domain paid deliveries use). The `notify.resumebooster.work` DNS no longer gates them.
- **STRIPE_PORTAL_LOGIN_URL (S11-015):** set it to the customer-portal login link from Stripe (Settings > Billing > Customer portal) and open it in a private window to check it.
- **EU/UK switch (S11-142):** publish the frontend first, then set `EU_UK_SALES=on` (after Stripe Tax). Leave `VITE_EU_UK_SALES` unset.

Verifier: section 74 gains the S11 block (builds, the create-checkout GET, the two new readers, `subscription_notices.sent_at`, and the owner SQL for 134200/134300).
