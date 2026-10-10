# Wave 3: payments + account (deploy note)

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
| S8-060, S8-059; items 1, 11, 12, 14; affiliate line | 49b9ac8d | **One policy.** Seven functions create Stripe sessions, and they now share one rule (`_shared/checkout-policy.ts`). **Return address.** Stripe sends the buyer back only to our own hosts, localhost, or an exact origin listed in `CHECKOUT_EXTRA_ORIGINS`. It used to send them to any Origin, and three functions fell back to lovable.dev. **Receipt.** Every one-time payment names `receipt_email`. **Renewal terms.** Pro and the agent show their renewal terms next to Stripe's pay button. The agent's terms state the trial only when the session carries one. **Terms version and referral.** Every checkout records the Terms version and the referral code on the Stripe session and on `checkout_starts`. Five of the six checkouts used to drop the referral. A referral on a checkout outside the catalogue is recorded at $0 (`referral_commission: "none"`), so the affiliate page stays true. **Tax.** Stripe Tax, billing address and tax ID turn on only with `EU_UK_SALES=on`. **Anonymous scan packs.** A scan pack bought without signing in no longer attaches to the typed address's Stripe customer. |
| Items 11, 12; S8-055; L3-20; S8-058 | 78e31329 | **Above every buy and sign-up button.** The button now carries "By continuing you agree to the Terms of Service and the Privacy Policy" (`PurchaseTerms`). Pro's button says it renews monthly until you cancel. The agent's button names the trial, says only first-time subscribers get it, and says how to avoid being charged. With the EU/UK switch on, the button also carries the withdrawal-waiver or service-start box. **Sign-up.** A password or magic-link sign-up stores `terms_version` and `terms_accepted_at` on the account. **Terms date.** /terms prints the Terms version date. It used to print today's date. **New Pro subscribers (S8-055).** They are confirmed live from the Stripe session and never offered Go Pro again. **Sign-in (L3-20).** An expired session is no longer reported as a sign-out. /agent, /shortlist and /account send a signed-out visitor to `/auth?next=`. "Resend confirmation" keeps `?next`. **Credits (S8-058).** The copy says credits follow the browser and the signed-in account. Nine locales. |
| S8-014, S8-119, S8-120 | e5804452 | **Back from Stripe.** Pressing Back from Stripe resets the checkout overlay, which now offers Close. **Credit upsell.** It is a real dialog and prints the server's reset hours. **Funnel.** The $5 Full Analysis records `product_clicked` and `checkout_started`. |
| Item 11 (Cal. B&P 17602) | 04a0d284 | **Confirmation mail.** A new subscription gets a confirmation: the price, that it renews until cancelled, the trial's end and first charge, what cancelling does, and how to cancel. **Trial reminder.** A trial gets a reminder 3 days before it ends. The webhook queues both through the transactional queue (`enqueue_email_delayed`). Each is claimed once in `subscription_notices`. No refund is promised. |
| L6-30, L3-13 | c9fe513e | **Account deletion.** Deleting an account first cancels its plans and removes its CV files. If either step fails, nothing is deleted. **Unlinked plans.** A plan on the address that names no account is cancelled only for a proven mailbox. Otherwise the user gets 409 with Stripe's emailed portal login. **Replaced CV.** A new upload removes the old CV file. |
| S8-053, S8-054 | 7060b711 | **100%-off sessions.** A comped ($0) Full Analysis or scan pack is delivered. **Scan-pack balance.** verify-scan-pack-purchase answers only that purchase's credits, never the address's whole balance. |
| S8-009, S8-015, S8-016, S8-074; wave-2 handoff | 23310733 | **Success page.** It shows the saved copy, bound to the résumé the purchase was made for. **Purchase mails.** They say "Ready" only when content exists. They link `/product-success?session_id=…` and print the session ID. **Freelance Boost.** The purchase gets a link mail and can be recovered. A returning buyer is not sold it again. **Recovery language.** Recovery keeps the buyer's language. **`pro_` grants.** A `pro_` grant is no longer recorded as a full-price sale. |
| S8-018, L13-14, L11-08, S8-103 | 933f8f55 | **Closure log.** It is metered per account per day: 1,000 distinct ids a day, and an id already answered that day is free. A tracker row's `job_id` cannot be rewritten by a client. **Closure outcomes.** A suspect or superseded closure is not a takedown. A posting stamped missing reads `going_down`, not "still posted". **Row caps.** Owner tables get row caps and length bounds. |
| S8-056, S8-057 | 854a730b | **Try again after a cancelled checkout.** It reuses what the checkout was bound to. **Stale résumé copies.** A stored résumé copy older than 23 hours is not reused. |
| S8-104 | 6a5a1ee8 | **Blocked storage.** A browser that blocks site storage now gets a working page with in-memory storage. It used to get a blank page. |
| L3-17 | 54af8be0 | **Interviews card.** It counts calendar days. Tomorrow is "Tomorrow" all day, and today's interview stays listed until local midnight. |
| L3-11, L3-12 | 274f020a | **Résumé builder.** The builder never saves an empty draft. It offers a newer scan once over a real draft. Each report rewrite replaces one bullet, the right one. |
| L6-12, L3-22, L3-14 | 8de03049 | **Purchases.** The list includes the account's Agent Passes. **Get more credits.** It opens the credit pack dialog. **Download all my data.** It reads every table the account owns: 16 tables, all rows, plus the CV file list. |
| Item 11 (FAQ) | 51f2abb2 | **FAQ.** "Is this a subscription?" says both plans renew until cancelled and that the trial becomes the paid plan. Nine locales. The prerender reads it from en.json. |
| Item 12 | 16672c29 | **Data API key form and connector consent.** /data-api's key form and /oauth/consent's Allow carry the Terms line. A key request stores the Terms version on its `api_key_requests` row. |
| Decision 3; item 14 | 662a3940 | **EU/UK withdrawal.** withdraw-subscription and the account page's "Withdraw within 14 days" panel. **Off by default.** They answer 404 and render nothing until the switch is on. **With the switch on:** paid invoices are refunded less the days provided, the plan is cancelled at once, and the withdrawal is acknowledged by mail once. |
| Item 10; owner instruction | 994da17a | **Seller identity.** `SELLER` (src/config/seller.ts and `_shared/seller.ts`) is empty and renders nothing. Once it is set, it appears in the footer, on /terms, on /privacy, beside every buy button, and in the footer of the digest, the pulse and the fix-plan drip. |
| (integration) | 1b7db82f | **Locale files.** The new locale namespaces moved out of the files' tail, so trial merges with the three other wave-3 branches are clean. |

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
| create-subscription-checkout | `create-subscription-checkout.2026-10-09.1` | The same, plus renewal terms and `{CHECKOUT_SESSION_ID}` on success (S8-055) |
| create-agent-checkout | `create-agent-checkout.2026-10-09.1` | The same, plus trial and renewal terms beside the pay button |
| create-pass-checkout | `create-pass-checkout.2026-10-09.1` | The checkout policy |
| create-scan-pack-checkout | `create-scan-pack-checkout.2026-10-09.1` | The checkout policy; no attach to the typed address's customer (S8-059) |
| create-test-checkout | `create-test-checkout.2026-10-09.1` | First build stamp; the policy. A dev page only, so deploying it is optional |
| create-portal-session | `create-portal-session.2026-10-09.1` | The return address is one of our hosts (S8-060) |
| stripe-webhook | `stripe-webhook.2026-10-09.1` | Subscriber confirmation and trial reminder; Boost link mail at payment; `pro_` grants are not sales; referral conversions at $0 outside the catalogue |
| verify-product-purchase | `verify-product-purchase.2026-10-09.1` | Saved copy for every generated product; inProgress; no "Ready" mail without content (S8-009); $0 referral record |
| send-product-email | `send-product-email.2026-10-09.1` | Session link and ID in the mail (S8-015) |
| retry-failed-deliveries | `retry-failed-deliveries.2026-10-09.1` | Passes the session ID to the mail |
| analyze-resume | `analyze-resume.2026-10-09.1` | Accepts a comped $0 session (S8-053) |
| scan-credits | `scan-credits.2026-10-09.1` | A comped pack's grant (S8-053) |
| verify-scan-pack-purchase | `verify-scan-pack-purchase.2026-10-09.1` | This purchase's credits only (S8-054) |
| delete-account | `delete-account.2026-10-09.1` | First build stamp; cancels plans, removes CVs (L6-30, L3-13) |
| get-account-data | `get-account-data.2026-10-09.1` | The account's passes (L6-12) |
| api-key-request | `api-key-request.2026-10-09.1` | Stores the Terms version (item 12) |
| withdraw-subscription | `withdraw-subscription.2026-10-09.1` | **New.** EU/UK withdrawal; 404 while `EU_UK_SALES` is off. `verify_jwt = false` in config.toml (it checks the token itself) |
| send-search-digest | `send-search-digest.2026-10-09.1` | Seller footer line (empty until set) |
| send-market-pulse | `send-market-pulse.2026-10-09.1` | Seller footer line (empty until set) |
| send-scan-report | `send-scan-report.2026-10-09.1` | Seller footer line (empty until set) |

**Shared modules changed.** `checkout-policy.ts` (new), `subscription-notice.ts` (new), `withdrawal.ts` (new), `seller.ts` (new), `purchase-link.ts` (new), `full-analysis.ts`, and `scan-credits.ts`.

- free-keyword-scan imports `scan-credits.ts` but uses none of what changed, so redeploying it is optional.
- create-checkout, retry-failed-deliveries and stripe-webhook import `full-analysis.ts`. All three are in the table.

**Deploy the frontend with the same commit.** It carries:

- the Terms, renewal and trial lines;
- the Pro confirmation on return;
- the sign-in fixes;
- the success page and Freelance Boost recovery;
- the builder, the interviews card and the account's Purchases, credits and export;
- the storage guard;
- the FAQ (the prerender bakes it into /pricing);
- the withdrawal panel and the seller line, both rendering nothing by default.

## Environment switches (all optional, all off by default)

| Name | Where | Effect |
| --- | --- | --- |
| `EU_UK_SALES` = `on` | function secret | Stripe Tax, billing address and tax ID on every session; the waiver or service-start box is required; the confirmation's 14-day paragraph; withdraw-subscription answers |
| `VITE_EU_UK_SALES` = `on` | frontend build | The box above every buy button, and the account's withdrawal panel. Turn it on together with `EU_UK_SALES` |
| `STRIPE_TERMS_CONSENT` = `on` | function secret | Stripe's own required Terms checkbox (`consent_collection`). Needs the Terms URL in the Stripe dashboard first, or Stripe refuses every session |
| `CHECKOUT_EXTRA_ORIGINS` | function secret | A comma-separated list of exact https origins (for example the Lovable preview) that Stripe may return to |
| `STRIPE_PORTAL_LOGIN_URL` | function secret | Stripe's emailed portal sign-in (`https://billing.stripe.com/...`), named in the notices and in delete-account's 409 |
| `SUPPORT_EMAIL` | function secret | Where the confirmation's EU/UK paragraph says to write. Default resumeboostersupp@gmail.com |

## Owner steps

1. **Receipts (item 1).**
   - One-time products now pass `receipt_email`, which Stripe honours whatever the dashboard says.
   - For plan renewals, in the Stripe Dashboard go to Settings, then Customer emails:
     - turn on **Successful payments**;
     - under Subscriptions and invoices, turn on **Send finalized invoices and credit notes to customers**.
   - Code cannot check these switches.
2. **Trial reminder (item 11).** Add `customer.subscription.trial_will_end` to the stripe-webhook endpoint's events. The confirmation needs nothing new.
3. **Mail delivery.** The notices, the withdrawal acknowledgement and the purchase links are delivered only once `notify.resumebooster.work` has DNS. This step was already on the list.
4. **Stripe's Terms checkbox (optional).**
   - First, set the Terms of service URL in Stripe: Settings, then Public details.
   - Then set `STRIPE_TERMS_CONSENT=on`.
   - The checkout already records the Terms version without it.
5. **EU/UK (decision 3).** Leave both switches unset until the VAT registration. Then, in this order:
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

- **Functions.** Redeploy each function from main at 12a37285, or from the build production serves now. withdraw-subscription is new: delete it, or leave it, since it answers 404 while the switch is off.
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
  - `termsVersion` is present for buttons that showed the line, and null for the free report's button (see the handoffs).
  - `referral` is true for referred visitors on all six checkouts.
  - `affiliate_conversions` gets $0 rows for non-catalogue referred sales.
- **Stripe:** one-time charges show a receipt sent to the buyer's address.
- **Lifecycle:** `lifecycle_reads` rows per account per day stay at or under 1,000. No member is refused on reload. `user_applications` updates that change `job_id` fail (no page does this).
- **Accounts:** get-account-data returns `passes` for a pass buyer. One owner-run test account shows that delete-account cancels the plan and empties `resumes/{id}/`.
- **Withdrawal:** withdraw-subscription answers 404 `not_available` until the switch is on (the verifier checks this).

## Handoffs to the integrator and other groups

- **wave3/scan-ai (FreeKeywordResults).**
  - Their rewrite of the free report (94778203) leaves two upgrade buttons: the $5 Full Analysis and Pro. Neither has the Terms line yet.
  - Add `<PurchaseTerms kind="payment" />` above the Full Analysis button and `<PurchaseTerms kind="subscription" plan="pro" />` above the Pro one.
  - The calls already spread `purchaseTerms()`: the Full Analysis goes through Index's `handleCheckout`, and Pro through `useProSubscription`. They send the Terms version only while a line is on screen.
  - The file changes too much on their branch to edit here without a conflict.
- **wave3/agents-api.**
  - This branch touches `api-key-request` (Terms version), `DataApi.tsx` (the line above "Email me a link") and `OAuthConsent.tsx` (the line above Allow). Trial merges with their branch are clean.
  - **send-agent-digest gets no seller footer here.** Their branch changes it, and it is a subscriber service mail. Add `sellerFooterHtml()` there if the lawyer treats it as marketing.
- **Privacy page.** /privacy still prints today's date as "Last updated" (`Privacy.tsx`). This is the same defect that /terms had, which this branch fixed with `TERMS_VERSION`. It needs the date the policy text last changed, so it is left for the policy rewrite (item 13).
- **Wave-2 README.** The "Not in this deploy" follow-ups this branch closes:
  - "ProductSuccess records pro_ grants as full-price purchases" (23310733);
  - "the one-trial rule does not key on the card fingerprint". This one is documented above as not built, and why.
