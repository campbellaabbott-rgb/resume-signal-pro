# shellcheck shell=bash
# ── 45. THE PAYMENTS WAVE OF 2026-10-05 (platform sweep 2026-10-04, payments
# group; register /Users/.../platform-debug-2026-10-04/register.json).
# check-subscription, create-subscription-checkout and create-agent-checkout
# answer only about a signed-in caller (or, for check-subscription, the
# address bound to a completed subscription checkout the caller holds);
# reconcile-stripe answers only its cron key (x-reconcile-cron, migration
# 20261005113000), the service role or the owner's key; the webhook, the
# sweeper and the verify path keep the ATS Defense report, record failed
# mail, deliver $0 comps and close subscription rows; migration 20261005110000
# lets log_delivery_step create its row.
#
# READ-ONLY. OPTIONS preflights (and the webhook's GET, which answers 405) run
# no function logic. Two POSTs are made, and ONLY after the preflight proves
# the new build is serving, because on that build both answer before any
# lookup, write or Stripe call: an anonymous check-subscription
# ({active:false,status:"sign_in_required"}, no row, no Stripe) and an
# anonymous reconcile-stripe (401 before any client is built). On an OLD build
# neither is sent -- the old reconcile-stripe would run a Stripe sweep and the
# old check-subscription would look the address up -- and the line says SKIP
# as INFO. The two checkouts are never POSTed: even refusing, they count the
# address (a rate-limit row). The two migration functions are service-role
# only and never called; their refusal is proved in the vitest suite
# (the-payments-wave-migrations-do-what-they-say).
echo "== 45. payments wave: subscription status and checkouts only for their owner; the reconcile sweep only for its cron (20261005110000, 20261005113000) =="

vd45_build() { # $1 fn, $2 method -> the x-fn-build header value
  curl -s -m 30 -D - -o /dev/null -X "${2:-OPTIONS}" "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}
vd45_new() { # $1 fn, $2 header value: true when dated 2026-10-05 or later
  case "$2" in "$1".20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].*) ;; *) return 1;; esac
  local d="${2#"$1".}"; d="${d%%.*}"
  [ "$d" \> "2026-10-04" ]
}

for FN in check-subscription create-subscription-checkout create-agent-checkout create-checkout create-product-checkout create-scan-pack-checkout verify-product-purchase verify-scan-pack-purchase retry-failed-deliveries reconcile-stripe admin-regenerate-delivery analyze-resume generate-ats-defense generate-apply-package generate-freelance-boost parse-resume-structured; do
  H=$(vd45_build "$FN")
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (the previous bundle is still serving)"
  elif vd45_new "$FN" "$H"; then echo "PASS  $FN preflight x-fn-build = $H (2026-10-05 or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-10-05.N or later)"; fi
done
WH45=$(vd45_build stripe-webhook GET)
if vd45_new stripe-webhook "$WH45"; then echo "PASS  stripe-webhook GET x-fn-build = $WH45 (2026-10-05 or later)"
else echo "FAIL  stripe-webhook GET x-fn-build = '${WH45}' (want stripe-webhook.2026-10-05.N or later)"; fi
echo "INFO  section 7a pins the checkouts at .2026-09-27.2; after this wave it prints FAIL for create-checkout, create-product-checkout, create-subscription-checkout, create-agent-checkout and create-scan-pack-checkout -- judge them here"

# The review of this wave (2026-10-05) rides build .2 of three functions; a .1
# build passes the date check above without it: check-subscription caches
# "not subscribed" for a signed-in caller and counts every live check;
# create-product-checkout's signed-out answer reads pro_subscribers only;
# verify-product-purchase holds the confirmation mail when its credit grant or
# generation failed, and records what the sweeper needs.
vd45_rev() { # $1 fn, $2 header value, $3 least build number on 2026-10-05
  vd45_new "$1" "$2" || return 1
  local rest="${2#"$1".}"; local d="${rest%%.*}"; local n="${rest##*.}"
  [ "$d" \> "2026-10-05" ] && return 0
  case "$n" in ''|*[!0-9]*) return 1;; esac
  [ "$n" -ge "$3" ]
}
for FN in check-subscription create-product-checkout verify-product-purchase; do
  H=$(vd45_build "$FN")
  if vd45_rev "$FN" "$H" 2; then echo "PASS  $FN x-fn-build = $H (carries the 2026-10-05 review fixes)"
  else echo "FAIL  $FN x-fn-build = '${H}' (want $FN.2026-10-05.2 or later: the review fixes are not serving)"; fi
done

# An anonymous status question about an address gets the same non-answer for
# every address, and only on the new build (see the header).
CS45=$(vd45_build check-subscription)
if vd45_new check-subscription "$CS45"; then
  ANS45=$(curl -s -m 30 -X POST "$B/functions/v1/check-subscription" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"email":"verify-deploy-probe@example.invalid"}')
  case "$ANS45" in
    *'"status":"sign_in_required"'*) echo "PASS  anonymous check-subscription for an address -> sign_in_required (no lookup, no row, no Stripe call)";;
    *) echo "FAIL  anonymous check-subscription answered: ${ANS45:0:200} (an address's status reached a stranger)";;
  esac
else
  echo "INFO  SKIP anonymous check-subscription probe: build '${CS45}' is not the 2026-10-05 one (the old build looks the address up)"
fi

RS45=$(vd45_build reconcile-stripe)
if vd45_new reconcile-stripe "$RS45"; then
  RC45=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/reconcile-stripe" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"lookbackHours":336}')
  [ "$RC45" = "401" ] && echo "PASS  anonymous reconcile-stripe -> 401 (no Stripe sweep for a stranger)" || echo "FAIL  anonymous reconcile-stripe -> HTTP $RC45 (want 401: the sweep spends our Stripe rate limit)"
else
  echo "INFO  SKIP anonymous reconcile-stripe probe: build '${RS45}' is not the 2026-10-05 one (the old build would run a full Stripe sweep)"
fi

# The cron still fires and the sweep still runs, keyed: the status block the
# board publishes (counts only) carries both stamps.
J '{"action":"status"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  status unreadable")}const p=j.paymentReconcile||{};console.log("INFO  paymentReconcile = "+JSON.stringify(p).slice(0,300)+" (after 15:17 UTC the run stamp should show buildVersion 2026-10-05.1; a lastCronAt with no newer run means the keyed post was refused -- check that migration 20261005113000 applied)")})'
