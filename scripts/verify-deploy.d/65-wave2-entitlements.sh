# shellcheck shell=bash
# ── 65. WAVE 2, ENTITLEMENTS (platform sweep 2026-10-04: L3-04, L6-08, L6-29,
# L6-18, L9-13, and the two mailbox switches made one; owner decisions
# 2026-10-04). Deploy note: docs/wave2/entitlements.md.
#
# THE CLAIMS, one line each below:
#   - every changed function serves its 2026-10-08 build (or later);
#   - the three migrations landed: pro_entitlement_rows (20261008130000),
#     payment_revoke / payment_revoke_credits / payment_revocations
#     (20261008131000), agent_pass_settle (20261008132000), each present and
#     closed to the publishable key by name;
#   - the browser's English strings carry the new copy: the Morning Queue on
#     the agent plan's card, the trial named for first-time subscribers (the
#     board and the agent paywall), the trial-only welcome banner, the pass
#     page's refunded line, the Pro card's trial line;
#   - the crawler's /agent names the trial for first-time subscribers;
#   - the owner steps that no read can prove are named as INFO.
#
# READ-ONLY. OPTIONS preflights and the webhook's GET (405) run no function
# logic. The RPC probes call the new functions as anon with arguments that
# would write nothing even if a revoke had not landed (an empty payment
# intent raises before any write; a zero uuid matches no pass or account),
# and expect 42501. The table probe reads `*` as anon and expects a refusal.
# No checkout, scan, analysis or webhook POST is made: each would count an
# address, mint a Stripe session or need a signature.
echo "== 65. wave 2 entitlements: one Pro rule by account, Full Analysis in Pro, one trial, refunds revoke, a closed pass gives back, one mailbox switch =="

vd65_build() { # $1 fn, $2 method -> the x-fn-build header value
  curl -s -m 30 -D - -o /dev/null -X "${2:-OPTIONS}" "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}

# generate-ats-defense and agent-pass-status (and the .2 builds) came with the
# review: a refunded session refused where Stripe still answers 'paid', the
# welcome URL saying whether the checkout carried a trial.
for PAIR in \
  "scan-credits|1" "get-account-data|1" "free-keyword-scan|2" "check-subscription|1" \
  "create-product-checkout|1" "create-subscription-checkout|1" "create-portal-session|1" \
  "verify-product-purchase|2" "generate-apply-package|2" "generate-freelance-boost|2" \
  "generate-ats-defense|1" "agent-pass-status|1" \
  "create-agent-checkout|2" "create-checkout|1" "analyze-resume|2"; do
  FN=${PAIR%%|*}; N=${PAIR#*|}
  H=$(vd65_build "$FN")
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (the previous bundle is still serving)"
  elif build_ge "$FN" "$H" "2026-10-08" "$N"; then echo "PASS  $FN preflight x-fn-build = $H ($FN.2026-10-08.$N or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-10-08.$N or later: the previous bundle is still serving)"; fi
done
WH65=$(vd65_build stripe-webhook GET)
if build_ge stripe-webhook "$WH65" "2026-10-08" 2; then echo "PASS  stripe-webhook GET x-fn-build = $WH65 (refunds and disputes revoke)"
else echo "FAIL  stripe-webhook GET x-fn-build = '${WH65}' (want stripe-webhook.2026-10-08.2 or later: refunds still revoke nothing)"; fi

# The migrations: present (not PGRST202) and refused by name (42501).
vd65_probe() { # $1 fn, $2 args, $3 what it proves
  local out code
  out=$(R "$1" "$2")
  code=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
  case "$code" in
    42501) echo "PASS  $1 exists and refuses anon by name (42501): $3";;
    PGRST202) echo "FAIL  $1 not found (PGRST202): its migration has not applied -- $3";;
    *) echo "FAIL  $1 as anon -> $code $(printf '%s' "$out" | head -c 160) (want 42501)";;
  esac
}
vd65_probe pro_entitlement_rows '{"p_user_id":"00000000-0000-0000-0000-000000000000"}' "20261008130000, the one Pro rule's read by account"
vd65_probe payment_revoke '{"p_payment_intent_id":"","p_reason":""}' "20261008131000, a refund takes back what it bought"
vd65_probe payment_revoke_credits '{"p_email":"","p_credits":0}' "20261008131000, the credit claw-back"
vd65_probe agent_pass_settle '{"p_pass_id":"00000000-0000-0000-0000-000000000000"}' "20261008132000, a closed pass gives back what it never sent"
PR65=$(curl -s -m 30 "$B/rest/v1/payment_revocations?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$PR65" in
  *'"42501"'*|*'permission denied'*) echo "PASS  payment_revocations refuses anon (42501)";;
  *'"PGRST205"'*|*'does not exist'*|*'Could not find the table'*) echo "FAIL  payment_revocations not found: 20261008131000 has not applied";;
  '[]') echo "FAIL  payment_revocations answered anon with an empty list (RLS on, but the grant was not revoked)";;
  *) echo "FAIL  payment_revocations as anon -> ${PR65:0:160}";;
esac

# The copy the browser loads (the English strings chunk the main bundle names).
EN65=""
MAIN65=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
for CH in $(curl -s -m 30 "$SITE$MAIN65" | grep -o '"\./en-[A-Za-z0-9_-]*\.js"' | tr -d '"' | sed 's|^\./||' | sort -u); do
  BODY65=$(curl -s -m 30 "$SITE/assets/$CH")
  printf '%s' "$BODY65" | grep -q "agentPitchCta" || continue
  EN65=$BODY65; break
done
if [ -z "$EN65" ]; then
  echo "FAIL  could not find the English strings chunk the browser loads (frontend not published, or the bundle layout moved)"
else
  for PAIR in "perkMorningQueue|the agent plan's card lists the Morning Queue (L3-04)" \
              "first-time subscribers|the board names the trial for first-time subscribers only (L6-29)" \
              "first-time subscribers start with|the agent paywall names the trial for first-time subscribers only (L6-29)" \
              "welcomeTitleTrial|the welcome banner names a trial only when the checkout gave one (L6-29)" \
              "repairRefunded|the pass page says a refunded payment opens no pass (L6-18)" \
              "Your trial is on|the Pro card tells a trial what is on now (L6-08)"; do
    S=${PAIR%%|*}; WHY=${PAIR#*|}
    if printf '%s' "$EN65" | grep -qF "$S"; then echo "PASS  English strings carry \"$S\": $WHY"
    else echo "FAIL  English strings lack \"$S\": $WHY -- the frontend with this wave is not published"; fi
  done
fi

# The page a crawler reads for /agent (Googlebot UA, read-only GET).
AG65=$(curl -s -m 30 -A "$UA" "$SITE/agent")
if printf '%s' "$AG65" | grep -qF "days free for first-time subscribers"; then echo "PASS  /agent as served to a crawler names the trial for first-time subscribers (L6-29)"
elif printf '%s' "$AG65" | grep -qE "[0-9]+ days free"; then echo "FAIL  /agent as served to a crawler still promises free days to everyone (the prerender with this wave is not published)"
else echo "FAIL  /agent as served to a crawler names no trial at all ($(printf '%s' "$AG65" | wc -c | tr -d ' ') bytes)"; fi

# The owner steps no read can prove.
echo "INFO  OWNER STEP (L6-18): subscribe the Stripe webhook endpoint to charge.refunded and charge.dispute.created; until then Stripe sends neither and no refund revokes anything"
echo "INFO  OWNER STEP (mailbox switch): after turning on email confirmation, run UPDATE public.mailbox_proof_settings SET confirmation_required_since = now(); -- one row now switches the scanner, the Account page and the agent gates alike (EMAIL_CONFIRMED_SINCE is read only if that row cannot be read)"
echo "INFO  MEASURE (L9-13): every closed agent_passes row has settled_at; applications_used drops at close by the packets that will not go (failed, stale, blocked past any answer, exhausted, held) and dismissed/expired rows, and again later as a waiting request ends unsent; approved queue rows with no packet keep pass_refunded_at NULL after a close"
echo "INFO  MEASURE: pro_grants rows with user_id IS NULL and consumed_at IS NULL minted before the deploy are refused at redemption (the member mints a new one); payment_revocations rows appear only after the two Stripe events are subscribed"
