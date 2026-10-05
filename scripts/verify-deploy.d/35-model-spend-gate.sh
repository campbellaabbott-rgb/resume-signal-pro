# Sourced by scripts/verify-deploy.sh (K, B and the helpers are in scope).
#
# == model spend gate (defect sweep 1.06, 1.24, 1.64; branch claude/sec-ai-spend) ==
# THE CLAIM: every public model endpoint now counts the caller against the
# address the platform states (never the first forwarded hop) in its own
# check_rate_limit bucket, fails closed when it cannot count, carries an
# output cap, and the free ones are also bounded by a function-wide hourly
# ceiling; generate-summary has a limiter, bounded input and a cache key that
# is its prompt; Interview Coach answer scoring no longer 500s.
# The review of 2026-10-04 added: one purchase has a daily allowance of its
# own on every generator (a session id cannot feed an address pool); on the
# free generators a purchase is off the ceiling only for a product that
# generator delivers (a $2 scan pack is not); a signed-in account or a board
# pass spends a separate "proven" ceiling, so a pool that spends the anonymous
# one cannot lock those callers out; the purchase-gated generators count
# nothing until a call is about to reach the model (warm-up pings and unpaid
# strangers spend no slot); the server deliveries (stripe-webhook,
# verify-product-purchase, retry-failed-deliveries) reach the generators with
# the service-role key and name their purchase; generate-tailored-resume-stream
# is retired (410, no model, no database).
# Each changed generator answers its build on the CORS preflight, so the
# deploy is provable here without calling a model, writing a row or spending
# a credit.
#
# READ-ONLY: OPTIONS preflights only. The refusals themselves are proved in
# src/test/every-public-model-call-is-counted-before-it-is-made.test.ts,
# src/test/a-paid-delivery-never-queues-behind-strangers.test.ts and the two
# the-spend-gate-* tests; a live probe of a limiter would have to spend from
# it, and a POST to the retired stream would, on the previous bundle, write a
# rate_limits row before refusing.
echo "INFO  == 35. model spend gate: every public model endpoint answers the 2026-10-04 build =="
for FN in generate-summary generate-interview-coach generate-career-path generate-cover-letter \
  generate-tailored-resume generate-elevator-pitch generate-recruiter-view generate-resume-roast \
  generate-application-answers generate-product-preview nl-search analyze-linkedin-profile \
  import-freelance-profile test-ai-fallback parse-resume-structured shortlist-evaluate \
  generate-keyword-fix generate-career-snapshot generate-graduate-gameplan generate-premium-package \
  generate-premium-package-stream generate-cover-letter-stream generate-tailored-resume-stream \
  generate-freelance-boost; do
  MSG_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r')
  MSG_S=$(printf '%s' "$MSG_H" | head -1 | awk '{print $2}')
  MSG_V=$(printf '%s' "$MSG_H" | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  case "$MSG_V" in
    "$FN.2026-10-04.1") echo "PASS  $FN preflight x-fn-build = $MSG_V";;
    "") echo "FAIL  $FN preflight (HTTP $MSG_S) carries no x-fn-build: the previous bundle is still serving (baseline 2026-10-04: none on all 24)";;
    *) echo "INFO  $FN preflight x-fn-build = $MSG_V (want $FN.2026-10-04.1 or a later build of this gate)";;
  esac
done
echo "INFO  the refusal paths (429 rate_limited_function / rate_limited_session / rate_limited_global, 503 limiter_unavailable, 410 retired) are proved in tests, not here: a live probe would spend from the limiter it measures"
echo "INFO  the server deliveries' service-role key ships inside stripe-webhook, verify-product-purchase and retry-failed-deliveries, whose x-fn-build strings other 2026-10-04 branches bump; a build of theirs deployed from main after claude/sec-ai-spend merged carries it"
