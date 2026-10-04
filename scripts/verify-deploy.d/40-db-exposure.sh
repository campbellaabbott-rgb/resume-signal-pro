# Sourced by scripts/verify-deploy.sh. Every probe is read-only.
#
# The client-callable census (migration 20261004110000 + the admin-ops edge
# function). Baseline 2026-10-04, before deploy, with the publishable key:
# get_delivery_health / get_payment_health / get_rate_limit_stats /
# detect_user_error_spikes / should_send_alert / get_db_size_stats /
# get_stale_board_count all answered 200; job_board_verifications and
# job_board_closure_rollup answered rows; get_funnel_cohort_stats grouped by
# any key it was handed; client_callable_census was PGRST202; admin-ops 404.
#
# Closed functions that WRITE (log_alert_sent, store_cached_response,
# save_free_scan_lead, the index one-shots, ...) are never called here, not
# even to watch them refuse: if a revoke had not landed, the call would write.
# client_callable_census() proves them closed from the catalogue instead.

echo "INFO  == 40. the client-callable census: closed means 42501, open means the list (20261004110000) =="
R client_callable_census > /tmp/vd_40_census.json
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
let c=null;try{c=JSON.parse(fs.readFileSync("/tmp/vd_40_census.json","utf8"))}catch{}
if(!c||typeof c!=="object"||Array.isArray(c)||!("closed" in c)){ok(false,"client_callable_census as anon -> "+JSON.stringify(c).slice(0,200)+" (PGRST202 = 20261004110000 not applied)");process.exit(0)}
ok(c.closed===56&&c.closed_missing===0,"the census names "+c.closed+" closed signatures, "+c.closed_missing+" missing (want 56 and 0)");
ok(Array.isArray(c.closed_still_callable)&&c.closed_still_callable.length===0,"no closed function is callable by anon or authenticated: "+JSON.stringify(c.closed_still_callable));
ok(Array.isArray(c.allowlisted_not_callable)&&c.allowlisted_not_callable.length===0,"every allowlisted function still answers its pages ("+c.allowlisted+" listed): "+JSON.stringify(c.allowlisted_not_callable));
ok(Array.isArray(c.closed_tables_still_open)&&c.closed_tables_still_open.length===0,"the four closed tables give a client role nothing: "+JSON.stringify(c.closed_tables_still_open));
if(c.unlisted_client_callable===0)ok(true,"no client-callable definer function outside the lists ("+c.client_callable+" client-callable of "+c.definers+" definers)");
else info(c.unlisted_client_callable+" client-callable definer function(s) appear in no list (schema drift or new since the census): the apply NOTICE names them; "+c.client_callable+" of "+c.definers+" definers are client-callable");'

# Pure readers, confirmed in source (no INSERT/UPDATE/DELETE in their bodies):
# a refusal is 42501; if a revoke had not landed these would only READ.
probe get_delivery_health '{"p_hours_back":0}'
probe get_payment_health '{"p_hours_back":0}'
probe get_rate_limit_stats '{"p_hours_back":0}'
probe detect_user_error_spikes '{"p_spike_threshold":100000000,"p_recent_minutes":1,"p_baseline_hours":1}'
probe should_send_alert '{"p_alert_type":"verify-probe","p_metric_name":"verify-probe","p_cooldown_minutes":1}'
probe check_user_health '{"p_visitor_id":"verify-deploy-probe"}'
probe get_visitor_error_history '{"p_visitor_id":"verify-deploy-probe"}'
probe get_db_size_stats '{}'
probe get_stale_board_count '{}'
probe email_delivery_health '{"p_hours":1}'

# The cohort reader stays open for its eight dimensions and refuses any other key.
FUN=$(R get_funnel_cohort_stats '{"p_cohort_dimension":"referrer","p_days_back":1}')
case "$FUN" in *'"22023"'*) echo "PASS  get_funnel_cohort_stats refuses an arbitrary metadata key (22023)";; *) echo "FAIL  get_funnel_cohort_stats grouped by an arbitrary key: ${FUN:0:160}";; esac
FOK=$(R get_funnel_cohort_stats '{"p_cohort_dimension":"trafficSource","p_days_back":1}' | head -c 1)
[ "$FOK" = "[" ] && echo "PASS  get_funnel_cohort_stats still answers trafficSource (verify 7c and the weekly report)" || echo "FAIL  get_funnel_cohort_stats(trafficSource) did not answer an array"

# Positive controls: the public pages' readers still answer the publishable key.
for F in get_stats_cache get_job_board_facets agent_sender_public_status; do
  OUT=$(R "$F" '{}'); case "$OUT" in *42501*|*PGRST202*) echo "FAIL  $F as anon -> ${OUT:0:120} (a public page lost its reader)";; *) echo "PASS  $F still answers anon";; esac
done

for T in job_board_verifications job_board_closure_rollup; do
  code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/$T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  { [ "$code" = "401" ] || [ "$code" = "403" ]; } && echo "PASS  $T SELECT as anon -> $code" || echo "FAIL  $T SELECT as anon -> $code (baseline 200 with rows)"
done

# admin-ops: the build on the preflight, the admin header allowed, and a call
# without the key refused before anything is called (index.ts checks the key
# first and builds no client until it matches).
H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/admin-ops" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-admin-key,content-type,authorization,apikey")
BUILD=$(printf '%s' "$H" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
case "$BUILD" in admin-ops.2026-10-04.*) echo "PASS  admin-ops preflight x-fn-build = $BUILD";; *) echo "FAIL  admin-ops preflight x-fn-build = '${BUILD}' (want admin-ops.2026-10-04.1; empty = not deployed)";; esac
printf '%s' "$H" | tr -d '\r' | grep -i '^access-control-allow-headers:' | grep -qi 'x-admin-key' && echo "PASS  admin-ops allows the x-admin-key header" || echo "FAIL  admin-ops preflight does not allow x-admin-key (every dashboard panel would fail CORS)"
NOKEY=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/admin-ops" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"fn":"get_delivery_health","args":{"p_hours_back":0}}')
[ "$NOKEY" = "401" ] && echo "PASS  admin-ops without the admin key -> 401" || echo "FAIL  admin-ops without the admin key -> $NOKEY"
