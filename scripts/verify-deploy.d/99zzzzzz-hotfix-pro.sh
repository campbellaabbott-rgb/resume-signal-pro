# shellcheck shell=bash
# ── 99zzzzzz-hotfix-pro. HOTFIX LANE PRO (branch hotfix/pro, item H1; sweep
# S14: M-S14-002, M-S14-006, C-S14-004). A Pro member who changes their
# billing email in Stripe's portal keeps Pro, reaches billing and is sold no
# second plan; an address's plan is described only to the account it belongs
# to. No migration. Eleven functions at 2026-11-10.1: check-subscription,
# create-portal-session, create-subscription-checkout and stripe-webhook
# changed, and seven more bundle the changed _shared/pro.ts.
#
# Named 99zzzzzz so it sorts after 99zzzzz-free-scan-wave-recheck.sh.
#
# THE CLAIMS, one line each:
#   B   each of the eleven serves 2026-11-10.1 or later on its preflight.
#       While none does, an older build is INFO (not deployed yet). Once any
#       does, each one still older or unstamped is a FAIL: a partial deploy
#       (a webhook that moves rows beside a check that still clears them, or
#       a checkout guard that reads a different rule from the card);
#   A1  check-subscription with no session says sign_in_required and nothing
#       about any address; A2 create-portal-session with no session is a 401;
#       A3 stripe-webhook refuses a GET with 405. REGRESSION GUARDS: all three
#       held before this deploy too, so they do not show it landed;
#   O   the owner's Stripe steps (INFO).
#
# WHAT THIS SECTION CANNOT SEE. Each H1 claim needs a signed-in member with a
# plan, or a signed Stripe event, and this script has neither: so do the two
# the integration's review added (an unbound row whose customer left its
# address is not kept live for whoever proves that mailbox; a member with two
# bound plans opens billing on the live or owing one). They are proven on the
# shipped handlers by
# src/test/a-pro-member-who-changes-their-billing-email-in-stripe-keeps-pro-the-portal-and-no-second-plan.test.ts
# and on the shared modules by
# supabase/functions/check-subscription/billing_email_change_test.ts.
#
# READ-ONLY. Eleven OPTIONS preflights and three GETs. Nothing is posted.
echo "== 99zzzzzz. hotfix pro (H1): builds, anon still learns nothing, the owner's Stripe steps =="

VDHP_FNS="check-subscription create-portal-session create-subscription-checkout stripe-webhook analyze-resume create-agent-checkout create-checkout create-product-checkout generate-apply-package generate-freelance-boost verify-product-purchase"
VDHP_NEW=""
VDHP_OLD=""
for VDHP_F in $VDHP_FNS; do
  VDHP_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDHP_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -n "$VDHP_H" ] && build_ge "$VDHP_F" "$VDHP_H" 2026-11-10 1; then VDHP_NEW="$VDHP_NEW $VDHP_F=$VDHP_H"
  else VDHP_OLD="$VDHP_OLD $VDHP_F=${VDHP_H:-none}"; fi
done
for VDHP_P in $VDHP_NEW; do echo "PASS  ${VDHP_P%%=*} preflight x-fn-build = ${VDHP_P#*=} (2026-11-10.1 or later)"; done
for VDHP_P in $VDHP_OLD; do
  VDHP_F=${VDHP_P%%=*}; VDHP_H=${VDHP_P#*=}
  if [ -z "$VDHP_NEW" ]; then echo "INFO  $VDHP_F preflight x-fn-build = $VDHP_H: hotfix pro is not deployed yet (judged once any of its eleven functions serves 2026-11-10.1)"
  elif [ "$VDHP_H" = none ]; then echo "FAIL  $VDHP_F preflight carries no x-fn-build while others serve 2026-11-10.1 (want $VDHP_F.2026-11-10.1 or later)"
  else echo "FAIL  $VDHP_F preflight x-fn-build = $VDHP_H while others serve 2026-11-10.1: a partial deploy (want $VDHP_F.2026-11-10.1 or later)"; fi
done

echo "INFO  A1-A3 below held before this deploy too: they guard a regression, they do not show the deploy landed"
VDHP_A1=$(curl -s -m 30 "$B/functions/v1/check-subscription" -H "apikey: $K" -H "Authorization: Bearer $K")
printf '%s' "$VDHP_A1" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{let j=null;try{j=JSON.parse(s)}catch{}
const told=j&&typeof j==="object"?["currentPeriodEnd","cancelAtPeriodEnd","needsPaymentUpdate","linkPending","planTier"].filter((k)=>k in j):[];
if(j&&j.active===false&&j.status==="sign_in_required"&&told.length===0)console.log("PASS  A1 check-subscription with no session -> sign_in_required, and nothing about any address");
else console.log("FAIL  A1 check-subscription with no session -> "+s.slice(0,200)+" (want active false, status sign_in_required, and no plan fields"+(told.length?"; it said "+told.join(", "):"")+")")})'
VDHP_A2=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/functions/v1/create-portal-session" -H "apikey: $K" -H "Authorization: Bearer $K")
if [ "$VDHP_A2" = 401 ]; then echo "PASS  A2 create-portal-session with no session -> 401"
else echo "FAIL  A2 create-portal-session with no session -> ${VDHP_A2:-no answer} (want 401: billing opens only for a signed-in account)"; fi
VDHP_A3=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/functions/v1/stripe-webhook" -H "apikey: $K")
if [ "$VDHP_A3" = 405 ]; then echo "PASS  A3 stripe-webhook GET -> 405"
else echo "FAIL  A3 stripe-webhook GET -> ${VDHP_A3:-no answer} (want 405: only a signed POST from Stripe is read)"; fi

echo "INFO  O1 owner step: in Stripe, Developers > Webhooks > the stripe-webhook endpoint > events, add customer.updated, so a billing email changed in Stripe's portal moves the member's cache row to the new address. Without it no member loses Pro: every subscription, invoice and refund event and every live check refresh each row by its customer"
echo "INFO  O2 owner step: if customers were stopped from changing their email in Stripe's customer portal (Settings > Billing > Customer portal) while this was open, it can be turned back on once every B line above is PASS"
