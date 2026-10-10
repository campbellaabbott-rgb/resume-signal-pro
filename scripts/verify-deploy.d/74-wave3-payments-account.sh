# shellcheck shell=bash
# ── 74. WAVE 3, PAYMENTS + ACCOUNT (S8 sweep 2026-10-08 groups payments and
# account; platform sweep 2026-10-04 group account; commercial-readiness plan
# items 1, 10, 11, 12, 14; owner decisions 2026-10-08). Deploy note:
# docs/wave3/payments-account.md.
#
# THE CLAIMS, one line each below:
#   - every changed function serves its 2026-10-09 build (or later), the new
#     withdraw-subscription included; the review fixes of 2026-10-09 need .2 of
#     stripe-webhook, withdraw-subscription, delete-account and both
#     subscription checkouts, and .1 of process-email-queue (legal notices
#     pass a drip unsubscribe) and free-keyword-scan (it bundles the comped
#     scan-pack settlement);
#   - withdraw-subscription is deployed with the EU/UK switch OFF (404
#     not_available), as owner decision 3 requires until VAT registration;
#   - the four migrations landed: subscription_notices (130000) and
#     lifecycle_reads (131000) exist and refuse the publishable key,
#     api_key_requests.terms_version exists (132000), get_application_lifecycle
#     still refuses anon; 133000 (a constraint) is an INFO with its SQL;
#   - the browser's English strings carry the new copy (the Terms line, the
#     renewal line, the pass in Purchases, the withdrawal panel, the builder's
#     import prompt, the FAQ's renewal sentence, the seller line);
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
  analyze-resume:1 api-key-request:1 create-agent-checkout:2 create-checkout:1 create-pass-checkout:1 \
  create-portal-session:1 create-product-checkout:1 create-scan-pack-checkout:1 create-subscription-checkout:2 \
  delete-account:2 get-account-data:1 retry-failed-deliveries:1 scan-credits:1 send-market-pulse:1 \
  send-product-email:1 send-scan-report:1 send-search-digest:1 verify-product-purchase:1 \
  verify-scan-pack-purchase:1 withdraw-subscription:2 process-email-queue:1 free-keyword-scan:1; do
  FN=${PAIR%%:*}; SEQ=${PAIR#*:}
  H=$(vd74_build "$FN")
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (the previous bundle is still serving, or the function is not deployed)"
  elif build_ge "$FN" "$H" "2026-10-09" "$SEQ"; then echo "PASS  $FN preflight x-fn-build = $H ($FN.2026-10-09.$SEQ or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-10-09.$SEQ or later: the previous bundle is still serving)"; fi
done
WH74=$(vd74_build stripe-webhook GET)
if build_ge stripe-webhook "$WH74" "2026-10-09" 2; then echo "PASS  stripe-webhook GET x-fn-build = $WH74 (subscription confirmation + trial reminder marked legal notices, the 14-day paragraph for EU/EEA/UK buyers only, pro_ grants not sales, Boost link mail)"
else echo "FAIL  stripe-webhook GET x-fn-build = '${WH74}' (want stripe-webhook.2026-10-09.2 or later: no subscriber notices, or notices a drip unsubscribe drops)"; fi
TC74=$(vd74_build create-test-checkout)
echo "INFO  create-test-checkout preflight x-fn-build = '${TC74:-none}' (a dev-page function; deploy it only if the dev checkout page is used: want create-test-checkout.2026-10-09.1)"

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
LC74=$(R get_application_lifecycle '{"p_job_ids":[]}')
case "$LC74" in
  *'"42501"'*|*'permission denied'*) echo "PASS  get_application_lifecycle refuses anon (42501): signed-in only, metered by 20261009131000";;
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
              "Sold by|the seller line ships (renders only once the seller is set)"; do
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
echo "INFO  OWNER STEP (decision 3): leave EU_UK_SALES and VITE_EU_UK_SALES unset until the VAT registration; then turn on Stripe Tax (Dashboard > Tax, origin address, registrations) BEFORE setting both to 'on' together"
echo "INFO  OWNER STEP (item 10): fill src/config/seller.ts and supabase/functions/_shared/seller.ts with the legal name and postal address once chosen, then redeploy the frontend and send-search-digest, send-market-pulse, send-scan-report"
echo "INFO  OWNER STEP: mail (the subscriber notices, the withdrawal acknowledgement, the purchase links) is delivered only once notify.resumebooster.work has DNS; STRIPE_PORTAL_LOGIN_URL, when set, is named in the notices as the second way to cancel"
echo "INFO  MEASURE: after the next new subscription, subscription_notices holds one 'confirmation' row for it, and checkout_starts.metadata carries termsVersion (when the button showed the line) and referral true/false; an affiliate referral on a non-catalogue checkout records a \$0 conversion (referral_commission none)"
echo "INFO  MEASURE: get-account-data returns passes[] for a pass buyer; delete-account removes resumes/{user id}/, then cancels the account's plans, then deletes (one test account, owner-run)"
echo "INFO  MEASURE: a subscription-confirmation or trial-ending to an address in suppressed_emails with reason 'unsubscribe' has an email_send_log 'sent' row, not 'suppressed' (SELECT l.status, count(*) FROM email_send_log l JOIN suppressed_emails s ON lower(l.recipient_email) = s.email AND s.reason = 'unsubscribe' WHERE l.template_name IN ('subscription-confirmation','trial-ending','subscription-withdrawal') GROUP BY 1)"
