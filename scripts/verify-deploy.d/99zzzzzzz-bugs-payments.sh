# shellcheck shell=bash
# ── 99zzzzzzz-bugs-payments. BUG ROUND A, LANE PAYMENTS (branch bugs/a-payments).
# Pro's checkout page lasts thirty minutes and an account's older open one is
# closed (and every open one when the account is deleted); a grant minted in a
# paid month stays redeemable through it (pro_grants.redeem_until,
# 20261112110000); a second press hands back the open grant, and an unopened
# grant stops counting after an hour (20261112111000); a stale plan read never
# overwrites a newer row and carries the cancel flag; a redelivered checkout
# event is one row, a paid session one conversion; the pricing page reads a
# plan the way the account card does and names the cap; billing opens for an
# address the account proved by code; a checkout records the buyer's network
# key (the affiliate lane's helper and column).
#
# THE CLAIMS, one line each:
#   B   each function this lane changes, directly or through _shared/pro.ts,
#       _shared/checkout-buyer.ts or _shared/pro-perks.ts, serves 2026-11-12.1
#       or later on its preflight. While none does, INFO (not pasted yet);
#       once any does, each one older or unstamped is a FAIL (a partial paste);
#   M1  pro_grants.redeem_until exists (S14X-078). A named missing column
#       answers 42703 before any grant is read; before the paste INFO, after
#       it a FAIL. A row an anonymous caller can read is a FAIL either way;
#   M2  checkout_buyers.network_key exists (RC-S13-063: the affiliate lane's
#       column, which this lane's checkouts fill), judged as M1;
#   F1  the English payments strings (pausedUntilPaid) are published with
#       the pricing page (its chunk or one it imports; the entry, in a build
#       from before the bug round's review moved them there), and the
#       PricingPage chunk, or a chunk it imports, the plan states the
#       account card reads (S14X-114: link pending, ends on; S14X-077: paused
#       until paid), and the Account chunk the paused line. Before the paste
#       INFO, after it a FAIL;
#   F2  /pricing as Googlebot reads it: the Full Analysis row's Pro cell and
#       the Pro list name the cap (S14X-079) while the Full Analysis is on sale;
#   O   the owner-gated keys (S14X-013, S14X-086, S14X-235, NB-11) print INFO
#       owner pending until docs/deploy-ledger.json
#       reservations['bug-round'].ownerDecided names them; then each judges
#       what its decision ships.
#
# WHAT THIS SECTION CANNOT SEE: every write the lane changed needs a checkout,
# a Stripe event or a signed-in member. Those are proven on the shipped
# handlers by the a-*.test.ts files the lane added, and the owner's read-only
# SQL for each is printed below as INFO.
#
# READ-ONLY. OPTIONS preflights, GETs of two PostgREST columns, the site's
# entry and chunks, and two pages as Googlebot. Nothing is posted.
echo "== 99zzzzzzz. bug round A payments: builds, two columns, the published strings, /pricing's cap, owner gates =="

VDBP_FNS="create-checkout create-subscription-checkout create-portal-session delete-account stripe-webhook check-subscription analyze-resume verify-product-purchase create-product-checkout create-agent-checkout create-pass-checkout agent-access agent-connect agent-pass-status generate-apply-package generate-freelance-boost withdraw-subscription"
VDBP_NEW=""
VDBP_OLD=""
for VDBP_F in $VDBP_FNS; do
  VDBP_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDBP_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -n "$VDBP_H" ] && build_ge "$VDBP_F" "$VDBP_H" 2026-11-12 1; then VDBP_NEW="$VDBP_NEW $VDBP_F=$VDBP_H"
  else VDBP_OLD="$VDBP_OLD $VDBP_F=${VDBP_H:-none}"; fi
done
VDBP_LIVE=0
[ -n "$VDBP_NEW" ] && VDBP_LIVE=1
for VDBP_P in $VDBP_NEW; do echo "PASS  B ${VDBP_P%%=*} preflight x-fn-build = ${VDBP_P#*=} (2026-11-12.1 or later)"; done
for VDBP_P in $VDBP_OLD; do
  VDBP_F=${VDBP_P%%=*}; VDBP_H=${VDBP_P#*=}
  if [ "$VDBP_LIVE" = 0 ]; then echo "INFO  B $VDBP_F preflight x-fn-build = $VDBP_H: bug round A is not pasted yet (judged once any of the lane's functions serves 2026-11-12.1)"
  elif [ "$VDBP_H" = none ]; then echo "FAIL  B $VDBP_F preflight carries no x-fn-build while others serve 2026-11-12.1 (want $VDBP_F.2026-11-12.1 or later)"
  else echo "FAIL  B $VDBP_F preflight x-fn-build = $VDBP_H while others serve 2026-11-12.1: a partial paste (want $VDBP_F.2026-11-12.1 or later)"; fi
done

# M1, M2: a named column, read as anon. 200 [] or a permission refusal = the
# column exists; 400 42703 = it does not.
vdbp_column() {
  local vdbp_id="$1" vdbp_table="$2" vdbp_col="$3" vdbp_mig="$4" vdbp_out vdbp_code vdbp_body
  vdbp_out=$(curl -s -m 30 -w '\n%{http_code}' "$B/rest/v1/$vdbp_table?select=$vdbp_col&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  vdbp_code=$(printf '%s' "$vdbp_out" | tail -n 1)
  vdbp_body=$(printf '%s' "$vdbp_out" | sed '$d')
  case "$vdbp_code" in
    200)
      if [ "$(printf '%s' "$vdbp_body" | tr -d '[:space:]')" = "[]" ]; then echo "PASS  $vdbp_id $vdbp_table.$vdbp_col exists ($vdbp_mig), and an anonymous read returns no row"
      else echo "FAIL  $vdbp_id $vdbp_table.$vdbp_col: an anonymous read returned rows ($(printf '%s' "$vdbp_body" | head -c 120)): the table must show anon nothing"; fi ;;
    401|403)
      if printf '%s' "$vdbp_body" | grep -q '42501'; then echo "PASS  $vdbp_id $vdbp_table.$vdbp_col exists ($vdbp_mig): anon is refused the read, not told the column is missing"
      else echo "FAIL  $vdbp_id $vdbp_table.$vdbp_col -> $vdbp_code $(printf '%s' "$vdbp_body" | head -c 160) (want 200 [] or 42501)"; fi ;;
    400)
      if printf '%s' "$vdbp_body" | grep -q '42703'; then
        if [ "$VDBP_LIVE" = 1 ]; then echo "FAIL  $vdbp_id $vdbp_table.$vdbp_col does not exist while the lane's functions serve 2026-11-12.1: $vdbp_mig did not apply (re-apply it under a fresh stamp)"
        else echo "INFO  $vdbp_id $vdbp_table.$vdbp_col does not exist yet: $vdbp_mig is not applied (bug round A is not pasted)"; fi
      else echo "FAIL  $vdbp_id $vdbp_table.$vdbp_col -> 400 $(printf '%s' "$vdbp_body" | head -c 160) (want 200 [], 42501, or 42703 before the paste)"; fi ;;
    *) echo "FAIL  $vdbp_id $vdbp_table.$vdbp_col -> ${vdbp_code:-no answer} $(printf '%s' "$vdbp_body" | head -c 160) (want 200 [] or 42501)" ;;
  esac
}
vdbp_column M1 pro_grants redeem_until "20261112110000, S14X-078"
vdbp_column M2 checkout_buyers network_key "the affiliate lane's 20261112122000, which RC-S13-063's checkouts fill"

# F1: the published strings. The English payments strings ride with the
# pricing page (the entry, before the review); the PricingPage chunk (or one
# it imports) holds the Pro block; the Account chunk holds the account card.
VDBP_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDBP_MAINJS=""
[ -n "$VDBP_MAIN" ] && VDBP_MAINJS=$(curl -s -m 30 "$SITE$VDBP_MAIN")
vdbp_chunk() { printf '%s' "$VDBP_MAINJS" | grep -oE "(\./|assets/)$1-[A-Za-z0-9_-]+\.js" | head -1 | sed -E 's#^(\./|assets/)##'; }
VDBP_PP=$(vdbp_chunk PricingPage)
VDBP_AC=$(vdbp_chunk Account)
if [ -z "$VDBP_MAINJS" ] || [ -z "$VDBP_PP" ] || [ -z "$VDBP_AC" ]; then
  echo "FAIL  F1 the served entry (${VDBP_MAIN:-none found}) names no PricingPage or Account chunk (${VDBP_PP:-none}, ${VDBP_AC:-none}): the frontend is not serving, or the bundle layout moved, so the published strings cannot be judged"
else
  VDBP_PPJS=$(curl -s -m 30 "$SITE/assets/$VDBP_PP")
  VDBP_DEPS=$(printf '%s' "$VDBP_PPJS" | grep -oE '"\./[A-Za-z0-9_.-]+\.js"' | tr -d '"' | sed 's#^\./##' | grep -v '^index-' | sort -u | head -40)
  for VDBP_D in $VDBP_DEPS; do VDBP_PPJS="$VDBP_PPJS
$(curl -s -m 30 "$SITE/assets/$VDBP_D")"; done
  VDBP_ACJS=$(curl -s -m 30 "$SITE/assets/$VDBP_AC")
  VDBP_MISSING=""
  printf '%s\n%s' "$VDBP_MAINJS" "$VDBP_PPJS" | grep -qF 'tools are paused until this payment goes through' || VDBP_MISSING="$VDBP_MISSING the English payments strings (in the pricing page's chunks or the entry);"
  printf '%s' "$VDBP_PPJS" | grep -qF 'payments.pro.pausedUntilPaid' || VDBP_MISSING="$VDBP_MISSING the Pro block's paused-until-paid line (S14X-077);"
  printf '%s' "$VDBP_PPJS" | grep -qF 'proPlan.linkPending' || VDBP_MISSING="$VDBP_MISSING the Pro block's link-pending state (S14X-114);"
  printf '%s' "$VDBP_PPJS" | grep -qF 'proPlan.endsOn' || VDBP_MISSING="$VDBP_MISSING the Pro block's ends-on date (S14X-114);"
  printf '%s' "$VDBP_ACJS" | grep -qF 'payments.pro.pausedUntilPaid' || VDBP_MISSING="$VDBP_MISSING the account card's paused-until-paid line (S14X-077);"
  if [ -z "$VDBP_MISSING" ]; then echo "PASS  F1 the published site carries the payments strings, and the pricing Pro block ($VDBP_PP) and account card ($VDBP_AC) state paused-until-paid, link pending and ends-on as the card does"
  elif [ "$VDBP_LIVE" = 1 ]; then echo "FAIL  F1 the published site lacks${VDBP_MISSING%;} while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened"
  else echo "INFO  F1 the published site lacks${VDBP_MISSING%;}: the round's frontend has not published yet"; fi
fi

# F2: /pricing as a crawler reads it. The numbers are the repo's own.
VDBP_DAY=$(grep -oE 'PRO_GRANTS_PER_DAY = [0-9]+' supabase/functions/_shared/pro-perks.ts | grep -oE '[0-9]+$')
VDBP_MONTH=$(grep -oE 'PRO_GRANTS_PER_MONTH = [0-9]+' supabase/functions/_shared/pro-perks.ts | grep -oE '[0-9]+$')
if ! grep -qE 'FULL_ANALYSIS_ON_SALE: boolean = true' src/config/sales-gate.ts; then
  echo "INFO  F2 the Full Analysis is off sale in this checkout's src/config/sales-gate.ts, so /pricing hides the included analysis and its cap together (S14X-079): nothing to judge"
elif [ -z "$VDBP_DAY" ] || [ -z "$VDBP_MONTH" ]; then
  echo "FAIL  F2 supabase/functions/_shared/pro-perks.ts states no PRO_GRANTS_PER_DAY or PRO_GRANTS_PER_MONTH, so the cap /pricing should name is unknown"
else
  VDBP_PRICING=$(curl -s -m 30 -A "$UA" "$SITE/pricing")
  VDBP_FA=$(printf '%s' "$VDBP_PRICING" | VDBP_DAY="$VDBP_DAY" VDBP_MONTH="$VDBP_MONTH" node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
const row=(s.match(/<tr data-row="fa">[\s\S]*?<\/tr>/)||[""])[0]; const d=process.env.VDBP_DAY, m=process.env.VDBP_MONTH;
const cell=row.includes(d+" a day, "+m+" a month"), perk=s.includes("Up to "+d+" Full Analyses a day and "+m+" a month");
console.log((row?"row":"norow")+" "+(cell?"cell":"nocell")+" "+(perk?"perk":"noperk"))})')
  case "$VDBP_FA" in
    "row cell perk") echo "PASS  F2 /pricing as Googlebot reads it names the cap: the Full Analysis row's Pro cell says $VDBP_DAY a day, $VDBP_MONTH a month, and the Pro list says up to $VDBP_DAY a day and $VDBP_MONTH a month (S14X-079)" ;;
    norow*) echo "FAIL  F2 /pricing as Googlebot reads it has no Full Analysis row (<tr data-row=\"fa\">): the prerendered limits table moved or the page did not render" ;;
    *)
      if [ "$VDBP_LIVE" = 1 ]; then echo "FAIL  F2 /pricing as Googlebot reads it does not name the cap ($VDBP_FA) while the lane's functions serve 2026-11-12.1: the round's frontend publish (which re-renders /pricing) has not happened"
      else echo "INFO  F2 /pricing as Googlebot reads it does not name the cap yet ($VDBP_FA): the round's frontend has not published"; fi ;;
  esac
fi

echo "INFO  owner read-only SQL after the paste (each needs the service role, which this script never holds): S14X-076 SELECT created_at, metadata->>'expiresAt' FROM checkout_starts WHERE checkout_function='create-subscription-checkout' AND created_at > :paste -- every expiresAt within 31 minutes of created_at; S14X-078 SELECT count(*) FROM pro_grants WHERE created_at > :paste AND redeem_until IS NULL -- 0 unless the member's plan stated no period end; S14X-079 SELECT user_id FROM pro_grants WHERE consumed_at IS NULL AND created_at > :paste GROUP BY user_id, date_trunc('day', created_at) HAVING count(*) > 1 -- no rows; S14X-081 SELECT metadata->>'session_id', count(*) FROM payment_failures WHERE failure_code IN ('async_payment_failed','checkout_expired') AND created_at > :paste GROUP BY 1 HAVING count(*) > 1 -- no rows; S14X-042 SELECT count(*) FROM payment_failures WHERE failure_code='checkout_expired' AND customer_email IS NOT NULL AND created_at > :paste -- 0; S14X-152 conversions of variant 'pro' in ab_test_events since the paste >= Pro deliveries since the paste"
echo "INFO  proven in the suite, never here (each needs a checkout, a Stripe event or a signed-in member): the thirty-minute Pro page and the older one expired, delete-account expiring open checkouts, the grant window, one grant per press, the newer row winning, the cancel flag, one row per redelivered event, one conversion per paid session, the refunded first month revoking its commission, the code-proven portal, the network key"

# O: the owner-gated keys. ownerDecided maps key -> choice (a string, or an
# object with a choice), written by the integrator alone.
vdbp_decided() {
  node -e 'let l={};try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
const d=((l.reservations||{})["bug-round"]||{}).ownerDecided||{};const v=d[process.argv[2]];
process.stdout.write(v==null?"":typeof v==="object"?String(v.choice??v.option??JSON.stringify(v)):String(v))' "${VDBP_LEDGER:-docs/deploy-ledger.json}" "$1"
}
VDBP_O13=$(vdbp_decided S14X-013)
if [ -z "$VDBP_O13" ]; then echo "INFO  S14X-013 owner pending: the Pro subscription terms (renewal, cancelling, access to the period end, EU/UK withdrawal) wait for the owner and counsel; /terms is unchanged"
else
  VDBP_TERMS=$(curl -s -m 30 -A "$UA" "$SITE/terms" | grep -ciE 'renew')
  if [ "${VDBP_TERMS:-0}" -ge 1 ]; then echo "PASS  S14X-013 decided ($VDBP_O13): /terms as Googlebot reads it states renewal"
  elif [ "$VDBP_LIVE" = 1 ]; then echo "FAIL  S14X-013 decided ($VDBP_O13), but /terms as Googlebot reads it never says renew while the lane's functions serve 2026-11-12.1: the terms did not publish"
  else echo "INFO  S14X-013 decided ($VDBP_O13); /terms does not state renewal yet: the round has not published"; fi
fi
VDBP_O86=$(vdbp_decided S14X-086)
if [ -z "$VDBP_O86" ]; then echo "INFO  S14X-086 owner pending: in the Stripe Dashboard, Settings > Billing > Subscriptions and emails, turn on Stripe's customer emails for failed payments (code cannot read or set it), or choose our own notice"
elif printf '%s' "$VDBP_O86" | grep -qiE 'our|notice|code'; then
  case " $VDBP_NEW " in
    *" stripe-webhook="*) echo "PASS  S14X-086 decided ($VDBP_O86): stripe-webhook, which sends our failed-payment notice, serves 2026-11-12.1 or later; the owner reads the next decline's subscription_notices row through admin-ops" ;;
    *) if [ "$VDBP_LIVE" = 1 ]; then echo "FAIL  S14X-086 decided ($VDBP_O86), but stripe-webhook does not serve 2026-11-12.1 while the lane's other functions do"
       else echo "INFO  S14X-086 decided ($VDBP_O86); stripe-webhook does not serve the round's build yet"; fi ;;
  esac
else echo "INFO  S14X-086 decided ($VDBP_O86): Stripe's own failed-payment emails, an owner setting this script cannot see"; fi
VDBP_O235=$(vdbp_decided S14X-235)
if [ -z "$VDBP_O235" ]; then echo "INFO  S14X-235 owner pending: Pro's confirmation and the EU/UK withdrawal acknowledgement stay English until the owner decides"
elif printf '%s' "$VDBP_O235" | grep -qi 'english'; then echo "INFO  S14X-235 decided ($VDBP_O235): the confirmation and the withdrawal acknowledgement stay English, as today; nothing ships"
else
  case " $VDBP_NEW " in
    *" withdraw-subscription="*) echo "PASS  S14X-235 decided ($VDBP_O235): withdraw-subscription serves 2026-11-12.1 or later; the owner reads the next German checkout's notice subject through admin-ops" ;;
    *) if [ "$VDBP_LIVE" = 1 ]; then echo "FAIL  S14X-235 decided ($VDBP_O235), but withdraw-subscription does not serve 2026-11-12.1 while the lane's other functions do"
       else echo "INFO  S14X-235 decided ($VDBP_O235); withdraw-subscription does not serve the round's build yet"; fi ;;
  esac
fi
VDBP_ONB11=$(vdbp_decided NB-11)
if [ -z "$VDBP_ONB11" ]; then echo "INFO  NB-11 owner pending: the Pro card's lines say the writing tools are Pro's, though a free account has one of each a day; new wording waits for the owner"
else
  VDBP_OLDLINE=$(curl -s -m 30 -A "$UA" "$SITE/pricing" | grep -cF 'Everything in a free account, plus the writing tools<')
  if [ "${VDBP_OLDLINE:-0}" = 0 ]; then echo "PASS  NB-11 decided ($VDBP_ONB11): /pricing as Googlebot reads it no longer lists the writing tools as Pro's alone"
  elif [ "$VDBP_LIVE" = 1 ]; then echo "FAIL  NB-11 decided ($VDBP_ONB11), but /pricing still lists 'Everything in a free account, plus the writing tools' while the lane's functions serve 2026-11-12.1"
  else echo "INFO  NB-11 decided ($VDBP_ONB11); /pricing still has the old line: the round has not published"; fi
fi
