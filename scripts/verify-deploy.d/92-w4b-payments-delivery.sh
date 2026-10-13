# shellcheck shell=bash
# ── 92. WAVE 4, SECOND ROUND, PAYMENTS-DELIVERY (branch w4b/payments-delivery):
# the delivery engine after the 2026-10-12 cuts, and mail-watch.
#
# THE CLAIMS, one line each below:
#   - stripe-webhook, retry-failed-deliveries, send-product-email,
#     reconcile-stripe and the new mail-watch serve 2026-10-11.22 or later;
#     verify-product-purchase and scan-credits serve 2026-10-14.22 or later
#     (R1 stamped both 2026-10-14.1 and deploys first; this round keeps R1's
#     day with a higher sequence);
#   - mail-watch refuses the publishable key with its own 401 (the platform
#     lets that JWT through; the function's cron-key check answers);
#   - 20261011141000 applied: scan_credit_redeem takes the caller's user id and
#     is closed to anon (a GET probe: PostgREST runs it read-only);
#   - 20261011142000 applied: get_cron_health lists an active mail-watch job,
#     and once it has run, its runs did not fail;
#   - 20261011143000 applied: the retry selector takes p_include_unmailed (the
#     sweep 2026-10-11.22 passes it; without the migration every sweep names
#     a missing function) and is closed to anon;
#   - what no read here can prove is INFO: 20261011140000's trigger and
#     20261011143500's health count (the owner reads both), the test-mode
#     rehearsal secrets and HC_PING_URL.
#
# READ-ONLY. Preflights run no function logic. mail-watch is POSTed only once
# its preflight shows this build, and that build refuses before reading
# anything. The cron read is the anon aggregate section 7m already calls.
echo "== 92. w4b payments-delivery: retired sales recorded, retired plans ended, orders no retry can make spent and asked for, made orders never mailed are mailed, the purchase mail in the buyer's language, mail-watch =="

vd92_build() { # $1 fn -> the x-fn-build its preflight answers (stripe-webhook answers its 405 with it)
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

VD92_LIVE=" "
for VD92_FN in stripe-webhook retry-failed-deliveries send-product-email reconcile-stripe mail-watch; do
  VD92_H=$(vd92_build "$VD92_FN")
  if [ -z "$VD92_H" ]; then echo "FAIL  $VD92_FN preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
  elif build_ge "$VD92_FN" "$VD92_H" "2026-10-11" "22"; then echo "PASS  $VD92_FN preflight x-fn-build = $VD92_H ($VD92_FN.2026-10-11.22 or later)"; VD92_LIVE="$VD92_LIVE$VD92_FN "
  else echo "FAIL  $VD92_FN preflight x-fn-build = $VD92_H (want $VD92_FN.2026-10-11.22 or later: the delivery engine before the 2026-10-12 cuts is serving)"; fi
done
for VD92_FN in verify-product-purchase scan-credits; do
  VD92_H=$(vd92_build "$VD92_FN")
  if [ -z "$VD92_H" ]; then echo "FAIL  $VD92_FN preflight carries no x-fn-build"
  elif build_ge "$VD92_FN" "$VD92_H" "2026-10-14" "22"; then echo "PASS  $VD92_FN preflight x-fn-build = $VD92_H ($VD92_FN.2026-10-14.22 or later: R1's day, this round's sequence)"
  else echo "FAIL  $VD92_FN preflight x-fn-build = $VD92_H (want $VD92_FN.2026-10-14.22 or later)"; fi
done

case "$VD92_LIVE" in
  *" mail-watch "*)
    VD92_MW=$(curl -s -m 30 -o /tmp/vd_92_mw.json -w '%{http_code}' -X POST "$B/functions/v1/mail-watch" -H "apikey: $K" -H "Authorization: Bearer $K" -H "Content-Type: application/json" -d '{}')
    VD92_MW_ERR=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_92_mw.json","utf8"));process.stdout.write(String(j.error??""))}catch{}')
    if [ "$VD92_MW" = "401" ] && [ "$VD92_MW_ERR" = "Unauthorized" ]; then echo "PASS  mail-watch POST with the publishable key -> 401 Unauthorized (its own cron-key check answered)"
    else echo "FAIL  mail-watch POST with the publishable key -> ${VD92_MW:-no answer} ${VD92_MW_ERR:-} (want 401 Unauthorized: anyone could run the watch and mail the owner)"; fi ;;
  *) echo "INFO  mail-watch is not serving 2026-10-11.22 yet: its refusal is judged once it is" ;;
esac

probe scan_credit_redeem '{"p_email":"probe@example.invalid","p_session_hash":"0000000000000000000000000000000000000000000000000000000000000000","p_user_id":"00000000-0000-0000-0000-000000000000"}'

# The three-argument selector: 42501 means PostgREST found it and anon may not
# run it; PGRST202 means no function takes p_include_unmailed (not applied).
VD92_SEL=$(curl -s -m 60 "$B/rest/v1/rpc/get_failed_deliveries_for_retry?p_limit=1&p_include_generating=false&p_include_unmailed=true" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$VD92_SEL" in
  42501) echo "PASS  get_failed_deliveries_for_retry takes p_include_unmailed and anon may not run it (20261011143000 applied)" ;;
  PGRST202) echo "FAIL  no get_failed_deliveries_for_retry takes p_include_unmailed: 20261011143000 has not applied, and retry-failed-deliveries 2026-10-11.22 names a missing function on every sweep" ;;
  ROWS) echo "FAIL  get_failed_deliveries_for_retry answered rows to anon: paid orders and buyers' addresses are readable by anyone" ;;
  *) echo "FAIL  get_failed_deliveries_for_retry probe -> $VD92_SEL (want 42501)" ;;
esac

R get_cron_health '{"p_hours":24}' > /tmp/vd_92_cron.json
node -e '
const fs=require("fs");let rows=null;try{rows=JSON.parse(fs.readFileSync("/tmp/vd_92_cron.json","utf8"))}catch{}
if(!Array.isArray(rows)||rows.length===0){console.log("INFO  get_cron_health unreadable or empty: the mail-watch schedule cannot be judged here");process.exit(0)}
const j=rows.find((r)=>r&&r.ch_jobname==="mail-watch");
if(!j){console.log("FAIL  get_cron_health ("+rows.length+" jobs) lists no mail-watch job: 20261011142000 has not applied");process.exit(0)}
if(j.ch_active!==true){console.log("FAIL  the mail-watch job is inactive");process.exit(0)}
console.log("PASS  mail-watch is scheduled and active ("+j.ch_schedule+")");
const runs=Number(j.ch_runs||0),failed=Number(j.ch_failed||0);
if(runs===0)console.log("INFO  mail-watch has not run yet in the last 24 hours (it runs every 15 minutes)");
else if(failed>0)console.log("FAIL  mail-watch ran "+runs+" times in 24 hours and "+failed+" failed: read cron.job_run_details for the message (the vault key, or the function)");
else console.log("PASS  mail-watch ran "+runs+" times in 24 hours with no failed run");'

echo "INFO  20261011140000 (a refunded or delivered order never reopens) is proven by the owner's read: select tgname, tgenabled from pg_trigger where tgname = 'product_delivery_stays_closed' (one row, enabled O)"
echo "INFO  20261011143500 (a paid order whose mail never left counts as stuck; a test purchase never counts) is proven by the owner's read: select position('email_failed' in pg_get_functiondef('public.product_delivery_health(integer)'::regprocedure)) > 0 (true)"
echo "INFO  the test-mode rehearsal needs STRIPE_TEST_WEBHOOK_SECRET and an sk_test_ STRIPE_TEST_SECRET_KEY (critical-path owner step BEFORE R2 MERGES); mail-watch pings healthchecks.io only once HC_PING_URL is set"
