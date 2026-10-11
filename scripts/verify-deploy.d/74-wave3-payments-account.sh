# shellcheck shell=bash
# ── 74. WAVE 3, PAYMENTS + ACCOUNT (S8 sweep 2026-10-08 groups payments and
# account; platform sweep 2026-10-04 group account; commercial-readiness plan
# items 1, 10, 11, 12, 14; owner decisions 2026-10-08). Deploy note:
# docs/wave3/payments-account.md.
#
# THE CLAIMS, one line each below:
#   - every changed function serves its 2026-10-09 build (or later), the new
#     withdraw-subscription included; the review fixes of 2026-10-10 need .3 of
#     stripe-webhook (a promotion's charge in the notices), withdraw-subscription
#     (full refund without the service-start request), delete-account (plans
#     cancelled and the agent off before the CV goes) and both subscription
#     checkouts (the request on the plan), and .1 of process-email-queue (legal
#     notices pass a drip unsubscribe) and free-keyword-scan (it bundles the
#     comped scan-pack settlement);
#   - withdraw-subscription is deployed with the EU/UK switch OFF (404
#     not_available), as owner decision 3 requires until VAT registration;
#   - the four migrations landed: subscription_notices (130000) and
#     lifecycle_reads (131000) exist and refuse the publishable key,
#     api_key_requests.terms_version exists (132000), get_application_lifecycle
#     still refuses anon; 133000 (a constraint) is an INFO with its SQL;
#   - the browser's English strings carry the new copy (the Terms line, the
#     renewal line, the pass in Purchases, the withdrawal panel, the builder's
#     import prompt, the FAQ's renewal sentence, the seller line, and the
#     2026-10-10 round's delete notes, Freelance Boost mark and Pro give-up line);
#   - the crawler's /pricing FAQ says the plans renew and the trial converts;
#   - the owner steps no read can prove are named as INFO.
#
# READ-ONLY. OPTIONS preflights and the webhook's GET (405) run no function
# logic. The one POST is to withdraw-subscription with the publishable key:
# with the switch off it answers before reading anything, and with it on the
# key is no user, so it answers 401 before reaching Stripe or the database.
# Table probes select a column that exists once the migration has run, as
# anon, and expect a refusal (42501): a missing table is PGRST205, a missing
# column 42703. No checkout, purchase, sign-up, key request or mail is made.
echo "== 74. wave 3 payments + account: receipts, renewal and Terms lines, notices, assent, referral, withdrawal behind the switch, account fixes =="

vd74_build() { # $1 fn, $2 method -> the x-fn-build header value
  curl -s -m 30 -D - -o /dev/null -X "${2:-OPTIONS}" "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}

for PAIR in \
  analyze-resume:62 api-key-request:61 create-agent-checkout:61 create-checkout:61 \
  create-portal-session:61 create-product-checkout:61 create-scan-pack-checkout:61 create-subscription-checkout:61 \
  delete-account:4 get-account-data:2 retry-failed-deliveries:61 scan-credits:2 send-market-pulse:24 \
  send-product-email:2 send-scan-report:24 send-search-digest:25 verify-product-purchase:71 \
  verify-scan-pack-purchase:2 withdraw-subscription:61 process-email-queue:2 free-keyword-scan:5 create-test-checkout:61; do
  FN=${PAIR%%:*}; SEQ=${PAIR#*:}
  H=$(vd74_build "$FN")
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (the previous bundle is still serving, or the function is not deployed)"
  elif build_ge "$FN" "$H" "2026-10-09" "$SEQ"; then echo "PASS  $FN preflight x-fn-build = $H ($FN.2026-10-09.$SEQ or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-10-09.$SEQ or later: the previous bundle is still serving)"; fi
done
# create-pass-checkout names itself through FN_NAME, so its build carries an
# October date off the line that names the pass (the pass guard reads a
# standalone number there). The S11 round's EU/UK box (S11-141/142) needs
# 2026-10-09.62; main's 2026-09-27.3 and the earlier merges' 2026-09-27.4 and
# .61 are older bundles.
PC74=$(vd74_build create-pass-checkout)
if [ -z "$PC74" ]; then echo "FAIL  create-pass-checkout preflight carries no x-fn-build"
elif build_ge create-pass-checkout "$PC74" "2026-10-09" "62"; then echo "PASS  create-pass-checkout preflight x-fn-build = $PC74 (create-pass-checkout.2026-10-09.62 or later)"
else echo "FAIL  create-pass-checkout preflight x-fn-build = $PC74 (want create-pass-checkout.2026-10-09.62 or later: the checkout policy and the S11 consent box are not serving)"; fi
WH74=$(vd74_build stripe-webhook GET)
if build_ge stripe-webhook "$WH74" "2026-10-09" "4"; then echo "PASS  stripe-webhook GET x-fn-build = $WH74 (subscription confirmation + trial reminder marked legal notices and stating a promotion's charge, the 14-day paragraph for EU/EEA/UK buyers only, pro_ grants not sales, Boost link mail)"
else echo "FAIL  stripe-webhook GET x-fn-build = '${WH74}' (want stripe-webhook.2026-10-09.4 or later: no subscriber notices, notices a drip unsubscribe drops, or notices quoting the list price to a promotion)"; fi
TC74=$(vd74_build create-test-checkout)
echo "INFO  create-test-checkout preflight x-fn-build = '${TC74:-none}' (a dev-page function; deploy it only if the dev checkout page is used: want create-test-checkout.2026-10-09.2)"

# Owner decision 3: the withdrawal function exists and the switch is off.
WD74=$(curl -s -m 30 -w '\n%{http_code}' -X POST "$B/functions/v1/withdraw-subscription" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{}')
WD74_CODE=$(printf '%s' "$WD74" | tail -n 1); WD74_BODY=$(printf '%s' "$WD74" | sed '$d')
case "$WD74_CODE:$WD74_BODY" in
  404:*not_available*) echo "PASS  withdraw-subscription answers 404 not_available: the EU/UK switch is off, as it must stay until the VAT registration";;
  401:*signInRequired*) echo "INFO  withdraw-subscription answers 401 to the publishable key: the EU/UK switch (EU_UK_SALES) is ON -- correct only once the owner has registered for VAT";;
  404:*) echo "FAIL  withdraw-subscription -> 404 ${WD74_BODY:0:120} (the function is not deployed)";;
  *) echo "FAIL  withdraw-subscription -> $WD74_CODE ${WD74_BODY:0:160} (want 404 not_available)";;
esac

# The migrations, read as anon through a column each one creates.
vd74_table() { # $1 table, $2 a column the migration creates, $3 what it proves, $4 its migration
  local out
  out=$(curl -s -m 30 "$B/rest/v1/$1?select=$2&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  case "$out" in
    *'"42501"'*|*'permission denied'*) echo "PASS  $1.$2 exists and refuses anon (42501): $3";;
    *'"PGRST205"'*|*'Could not find the table'*) echo "FAIL  $1 not found (PGRST205): $4 has not applied -- $3";;
    *'"42703"'*|*'does not exist'*) echo "FAIL  $1.$2 does not exist (42703): $4 has not applied -- $3";;
    '[]') echo "FAIL  $1 answered anon with an empty list (RLS on, but the grant was not revoked)";;
    *) echo "FAIL  $1.$2 as anon -> ${out:0:160} (want 42501)";;
  esac
}
vd74_table subscription_notices subscription_id "each subscription notice is claimed once (confirmation, trial reminder, withdrawal)" 20261009130000
vd74_table lifecycle_reads day "the closure log is metered per account per day (S8-018)" 20261009131000
vd74_table api_key_requests terms_version "a key request keeps the Terms version its button showed (item 12)" 20261009132000
# A read-only GET: since 20261009131000 get_application_lifecycle WRITES (it
# meters lifecycle_reads per account per day), so a POST would commit a row had
# its revoke regressed (S8-125). PostgREST runs a GET in a READ ONLY transaction.
LC74=$(curl -s -m 60 "$B/rest/v1/rpc/get_application_lifecycle?p_job_ids=%7B%7D" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$LC74" in
  *'"42501"'*|*'permission denied'*) echo "PASS  get_application_lifecycle refuses anon (42501): signed-in only, metered by 20261009131000";;
  *'"25006"'*) echo "FAIL  get_application_lifecycle is CALLABLE as anon: it tried to write its meter and only this read-only GET stopped it";;
  *) echo "FAIL  get_application_lifecycle as anon -> ${LC74:0:160} (want 42501)";;
esac
echo "INFO  20261009133000 (a constraint, not readable as anon): SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'subscription_notices_kind_check'; -- want kind IN ('confirmation','trial_ending','withdrawal')"

# The copy the browser loads (the English strings chunk the main bundle names).
EN74=""
MAIN74=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
for CH in $(curl -s -m 30 "$SITE$MAIN74" | grep -o '"\./en-[A-Za-z0-9_-]*\.js"' | tr -d '"' | sed 's|^\./||' | sort -u); do
  BODY74=$(curl -s -m 30 "$SITE/assets/$CH")
  printf '%s' "$BODY74" | grep -q "agentPitchCta" || continue
  EN74=$BODY74; break
done
if [ -z "$EN74" ]; then
  echo "FAIL  could not find the English strings chunk the browser loads (frontend not published, or the bundle layout moved)"
else
  for PAIR in "By continuing you agree to the|every buy and sign-up button names the Terms (item 12)" \
              "renewing automatically until you cancel|the Pro button names its renewal (item 11)" \
              "First-time subscribers get|the agent button names its trial and how not to be charged (item 11)" \
              "turns into the paid plan when it ends|the FAQ no longer says nothing upgrades a trial (item 11)" \
              "Agent Passes bought on this account|Purchases lists the pass and says what shows up (L6-12)" \
              "Withdraw within|the withdrawal panel's copy ships (renders only with the switch on)" \
              "billed to an address in the EU, the EEA or the UK|a plan billed elsewhere is told the withdrawal is not its right (review fix)" \
              "cancelled a subscription on this account|a refused delete after a cancel says the plan was cancelled (review fix)" \
              "from your latest scan|the builder offers a newer scan over an old draft (L3-11)" \
              "Sold by|the seller line ships (renders only once the seller is set)" \
              "Your stored CV has been removed.|a refused delete says when the CV was already removed (2026-10-10 review)" \
              "already bought on this device|a Freelance Boost bought here asks for the email link instead of loading a stored id (2026-10-10 review)" \
              "We could not confirm your subscription yet|the Pro card stops saying it is confirming and frees Go Pro (2026-10-10 review)"; do
    S=${PAIR%%|*}; WHY=${PAIR#*|}
    if printf '%s' "$EN74" | grep -qF "$S"; then echo "PASS  English strings carry \"$S\": $WHY"
    else echo "FAIL  English strings lack \"$S\": $WHY -- the frontend with this wave is not published"; fi
  done
fi

# The page a crawler reads for /pricing (Googlebot UA, read-only GET): the
# prerender bakes the FAQ's subscription answer from en.json.
PR74=$(curl -s -m 30 -A "$UA" "$SITE/pricing")
if printf '%s' "$PR74" | grep -qF "turns into the paid plan"; then echo "PASS  /pricing as served to a crawler says the plans renew and the trial becomes the paid plan"
elif printf '%s' "$PR74" | grep -qF "nothing upgrades you automatically"; then echo "FAIL  /pricing as served to a crawler still says nothing upgrades you automatically (the prerender with this wave is not published)"
else echo "FAIL  /pricing as served to a crawler carries neither FAQ sentence ($(printf '%s' "$PR74" | wc -c | tr -d ' ') bytes)"; fi

# The owner steps and the measurements no read can prove.
echo "INFO  OWNER STEP (receipts, item 1): Stripe Dashboard > Settings > Customer emails: turn on 'Successful payments' -- REQUIRED for anonymous one-time buyers (most \$5 Full Analysis sales: no address is known when the session is made, so no receipt_email is set) as well as for plan renewals; a one-time checkout names receipt_email only when the buyer is signed in or typed an address. Also, under Subscriptions and invoices, 'Send finalized invoices and credit notes to customers'"
echo "INFO  OWNER STEP (item 11): add customer.subscription.trial_will_end to the stripe-webhook endpoint's events; without it no trial reminder is sent (the confirmation needs nothing new)"
echo "INFO  OWNER STEP (item 12, optional): set the Terms URL in Stripe (Settings > Public details > Terms of service), then the secret STRIPE_TERMS_CONSENT=on to add Stripe's own Terms checkbox; setting the secret first makes Stripe refuse every session"
echo "INFO  OWNER STEP (decision 3, order per S11-142): leave EU_UK_SALES unset until the VAT registration; then turn on Stripe Tax (Dashboard > Tax, origin address, registrations), and only then set the secret EU_UK_SALES=on. The published page asks create-checkout and shows the box on its own; VITE_EU_UK_SALES is no longer needed (setting it shows the box whatever the server says)"
echo "INFO  OWNER STEP (item 10): fill src/config/seller.ts and supabase/functions/_shared/seller.ts with the legal name and postal address once chosen, then redeploy the frontend and send-search-digest, send-market-pulse, send-scan-report"
echo "INFO  OWNER STEP (S11-053): the subscriber notices and the withdrawal acknowledgement go straight through Resend (RESEND_API_KEY, the key paid deliveries use) from billing@resumebooster.work: the resumebooster.work domain must stay verified in Resend. The queue's notify.resumebooster.work DNS still matters for auth mails and the drip. STRIPE_PORTAL_LOGIN_URL, when set, is named in the notices as the second way to cancel"
echo "INFO  OWNER STEP (S11-015): set STRIPE_PORTAL_LOGIN_URL to the Stripe customer-portal login link (Stripe Dashboard > Settings > Billing > Customer portal > 'Login link', https://billing.stripe.com/p/login/...) and check it by opening it in a private window: it is where a subscriber whose session cannot prove the mailbox is sent to cancel"

# ── THE S11 ROUND (2026-10-11), deploy note docs/wave3/payments-account.md "S11 round".
for PAIR74 in stripe-webhook:GET withdraw-subscription:OPTIONS retry-failed-deliveries:OPTIONS verify-product-purchase:OPTIONS \
  create-product-checkout:OPTIONS create-checkout:OPTIONS create-portal-session:OPTIONS analyze-resume:OPTIONS \
  generate-premium-package:OPTIONS generate-cover-letter:OPTIONS generate-apply-package:OPTIONS; do
  FN74=${PAIR74%%:*}; M74=${PAIR74#*:}
  H74=$(vd74_build "$FN74" "$M74")
  if [ -z "$H74" ]; then echo "FAIL  $FN74 carries no x-fn-build (the S11 round is not deployed)"
  elif build_ge "$FN74" "$H74" "2026-10-09" "61"; then echo "PASS  $FN74 x-fn-build = $H74 (the S11 round: $FN74.2026-10-09.61 or later)"
  else echo "FAIL  $FN74 x-fn-build = $H74 (want $FN74.2026-10-09.61 or later: the S11 round is not serving)"; fi
done
# Read-only: a GET answers the switch and nothing else (S11-142).
EP74=$(curl -s -m 30 "$B/functions/v1/create-checkout" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$EP74" in
  *'"euUkSales":false'*) echo "PASS  create-checkout answers a GET with the EU/UK switch, off (S11-142: the page's box stays dormant until the server says on)";;
  *'"euUkSales":true'*) echo "INFO  create-checkout says the EU/UK switch is ON -- correct only after the VAT registration";;
  *) echo "FAIL  create-checkout GET -> ${EP74:0:120} (want a JSON euUkSales: the S11 build is not serving)";;
esac
# Read-only GETs: both readers refuse anon (42501) once their migrations ran;
# a PGRST202 means the file did not apply.
for P74 in 'get_failed_deliveries_for_retry|p_limit=1&p_include_generating=false|20261009140000 (S11-146: the stuck-generation opt-in)' \
           'delivery_error_is_transient|p_error=x|20261009134100 (S11-014: outages spend no tries)'; do
  N74=${P74%%|*}; REST74=${P74#*|}; A74=${REST74%%|*}; WHY74=${REST74#*|}
  C74=$(curl -s -m 60 "$B/rest/v1/rpc/$N74?$A74" -H "apikey: $K" -H "Authorization: Bearer $K")
  case "$C74" in
    *'"42501"'*|*'permission denied'*) echo "PASS  $N74 exists and refuses anon (42501): $WHY74";;
    *'"PGRST202"'*) echo "FAIL  $N74 -> PGRST202: $WHY74 has not applied";;
    *) echo "FAIL  $N74 as anon -> ${C74:0:140} (want 42501): $WHY74";;
  esac
done
vd74_table subscription_notices sent_at "a legal notice is recorded as sent only after Resend accepted it (S11-053)" 20261009134000
echo "INFO  20261009134200 / 20261009134300 (owner SQL): SELECT count(*) FROM pg_trigger WHERE tgname = 'user_applications_served_posting_undated_trg'; SELECT jobname, command FROM cron.job WHERE jobname = 'tracker-served-postings-undated'; SELECT column_name FROM information_schema.columns WHERE table_name IN ('user_applications','pro_grants') AND column_name IN ('written_by','target_roles') -- want 1 trigger, 1 job carrying statement_timeout, 2 columns"
echo "INFO  MEASURE (S11-014): SELECT status, retry_count, transient_failures, max_retries, next_retry_at FROM product_deliveries WHERE status IN ('payment_received','generating','generation_failed','email_failed') ORDER BY created_at DESC LIMIT 20 -- an outage shows transient_failures rising with retry_count unchanged, and tries spaced 5m, 15m, 1h, 2h, 4h, 6h, 8h"
echo "INFO  MEASURE: after the next new subscription, subscription_notices holds one 'confirmation' row for it, and checkout_starts.metadata carries termsVersion (null only for a press with no Terms line in its block: read origin_path and checkout_function) and referral true/false; an affiliate referral on a non-catalogue checkout records a \$0 conversion (referral_commission none)"
echo "INFO  MEASURE: get-account-data returns passes[] for a pass buyer; delete-account cancels the account's plans, sets agent_mandates.active false, removes resumes/{user id}/, then deletes (one test account, owner-run)"
echo "INFO  MEASURE: the next subscription bought with a promotion code gets a confirmation naming 'Your first charge, with your promotion' and the list price after it; verify-product-purchase 429s in its logs fall to near zero (a success-page load makes at most six calls)"
echo "INFO  MEASURE: a subscription-confirmation or trial-ending to an address in suppressed_emails with reason 'unsubscribe' has an email_send_log 'sent' row, not 'suppressed' (SELECT l.status, count(*) FROM email_send_log l JOIN suppressed_emails s ON lower(l.recipient_email) = s.email AND s.reason = 'unsubscribe' WHERE l.template_name IN ('subscription-confirmation','trial-ending','subscription-withdrawal') GROUP BY 1)"
