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
ok(Array.isArray(c.closed_tables_still_open)&&c.closed_tables_still_open.length===0,"the closed tables (the write budget among them) give a client role nothing: "+JSON.stringify(c.closed_tables_still_open));
ok(Array.isArray(c.signed_in_only_open_to_anon)&&c.signed_in_only_open_to_anon.length===0,"no signed-in-only function (get_application_lifecycle, agent_sender_online) is callable with the publishable key: "+JSON.stringify(c.signed_in_only_open_to_anon));
// The writers budget per PLATFORM address, read in SQL from request.headers.
// "none" here means PostgREST hands SQL no address: every browser would share
// one bucket held to the ceiling of each writer -- telemetry thins out, nothing leaks.
ok(c.request_address_source==="cf"||c.request_address_source==="xff","PostgREST hands SQL the address of the caller: request_address_source = "+c.request_address_source+" (want cf, or xff; none = the per-address write budgets collapse into one shared bucket)");
// S14X-094: a definer a stranger can call that no list names is a FAIL, not a
// note. The census answers counts only; the owner reads the names with
// admin-ops client_callable_unlisted_names (the admin key, a read), and each
// one is closed by a revoke or listed with its caller by a census re-issue.
if(c.unlisted_client_callable===0)ok(true,"no client-callable definer function outside the lists ("+c.client_callable+" client-callable of "+c.definers+" definers)");
else ok(false,c.unlisted_client_callable+" client-callable definer function(s) appear in no list ("+c.client_callable+" of "+c.definers+" definers are client-callable): admin-ops client_callable_unlisted_names names them; close each with a revoke from anon and authenticated, or list it with its caller in a census re-issue");'

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
# The tracker's lifecycle answered ANY 500 posting ids from the closure ledger
# to anyone; it is signed-in only now (and reads only the caller's own
# tracker). A pure reader: if the revoke had not landed it would only read.
probe get_application_lifecycle '{"p_job_ids":["verify:deploy:probe"]}'

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

# EVERY TABLE, READ AS A STRANGER (NB-13). The two tables above are probed by
# name. On 2026-11-15, 72 of the 145 tables the migrations create answered the
# publishable key 200: anon held SELECT, and 70 of them showed no row only
# because row level security hid it (affiliate sessions and API keys among
# them), so one permissive policy would have opened them with every check
# green. One GET per table the checkout's migrations create (renames and drops
# followed), selecting the column it was created with, so a column grant is
# seen too, and * when that column is gone (42703). limit=1, and no value is
# printed or kept: only whether a row came back. Judged:
#   - a row from a table that is not a public aggregate by design is a FAIL;
#   - 200 from a table outside the 72 is a FAIL: a new table revokes from
#     PUBLIC, anon and authenticated, and a revoked one stays revoked;
#   - the known tables still answering 200 with no row are INFO, by name;
#   - 404 is INFO (not served: a pending migration, or dropped outside the files);
#   - any other answer (a gateway error, a timeout, a refusal that is not
#     42501) is a FAIL: that table was not judged.
rm -f /tmp/vd_40_tables.txt /tmp/vd_40_tables.tsv
node -e '
const fs=require("fs");const D="supabase/migrations";const T=new Map();
const nm=(x)=>{const p=x.replace(/"/g,"").split(".");if(p.length>1&&p[0].toLowerCase()!=="public")return null;return p[p.length-1].toLowerCase()};
for(const f of fs.readdirSync(D).filter((x)=>x.endsWith(".sql")).sort()){
  const s=fs.readFileSync(D+"/"+f,"utf8").replace(/\/\*[\s\S]*?\*\//g," ").replace(/--[^\n]*/g," ").replace(/\$(\w*)\$[\s\S]*?\$\1\$/g," ");
  for(const m of s.matchAll(/create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi)){
    const n=nm(m[1]);if(!n)continue;
    let i=m.index+m[0].length,d=1,j=i;while(j<s.length&&d>0){if(s[j]==="(")d++;else if(s[j]===")")d--;j++}
    const parts=[];let cur="",dd=0;for(const ch of s.slice(i,j-1)){if(ch==="(")dd++;if(ch===")")dd--;if(ch===","&&dd===0){parts.push(cur);cur=""}else cur+=ch}parts.push(cur);
    const col=parts.map((p)=>(p.trim().split(/\s+/)[0]||"").replace(/"/g,"")).find((w)=>w&&!/^(constraint|primary|unique|foreign|check|exclude|like)$/i.test(w));
    T.set(n,{col:/^\w+$/.test(col||"")?col:"*",file:f.slice(0,14)});
  }
  for(const m of s.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+rename\s+to\s+"?(\w+)"?/gi)){const a=nm(m[1]);if(a&&T.has(a)){T.set(m[2].toLowerCase(),T.get(a));T.delete(a)}}
  for(const m of s.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([^;]+);/gi))for(const x of m[1].split(",")){const w=x.trim().split(/\s+/)[0];const n=w&&nm(w);if(n)T.delete(n)}
}
for(const [n,v] of [...T].sort())console.log(n+" "+v.col+" "+v.file);' > /tmp/vd_40_tables.txt 2>/dev/null
: > /tmp/vd_40_tables.tsv
while read -r VD40T VD40C VD40F; do
  [ -n "$VD40T" ] || continue
  VD40O=$(curl -s -m 30 -w '\n%{http_code}' "$B/rest/v1/$VD40T?select=$VD40C&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  case "$VD40O" in *'"42703"'*) VD40O=$(curl -s -m 30 -w '\n%{http_code}' "$B/rest/v1/$VD40T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K");; esac
  VD40S=${VD40O##*$'\n'}; VD40BODY=${VD40O%$'\n'*}
  case "$VD40S:$VD40BODY" in
    200:'[]') VD40KIND=empty;;
    200:'['*) VD40KIND=rows;;
    *) VD40KIND=$(printf '%s' "$VD40BODY" | grep -oE '"code" *: *"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/'); VD40KIND=${VD40KIND:-none};;
  esac
  printf '%s\t%s\t%s\t%s\n' "$VD40T" "$VD40F" "$VD40S" "$VD40KIND" >> /tmp/vd_40_tables.tsv
done < /tmp/vd_40_tables.txt
unset VD40O VD40BODY
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const lines=(f)=>{try{return fs.readFileSync(f,"utf8").split("\n").filter(Boolean)}catch{return[]}};
const want=lines("/tmp/vd_40_tables.txt").map((l)=>l.split(" ")[0]);
const got=lines("/tmp/vd_40_tables.tsv").map((l)=>{const [t,f,s,k]=l.split("\t");return {t,f,s,k}});
if(want.length<100){ok(false,"NB-13 the table sweep parsed "+want.length+" tables from supabase/migrations (145 on 2026-11-15): the parse is broken, so no table was judged");process.exit(0)}
// Public aggregates by design: a row here is the page working.
const AGG=new Set(["daily_scan_stats","job_board_stats_rollup"]);
// The 72 that answered anon 200 on 2026-11-15. Only shrinks: a table that now
// refuses can be taken off; one added is a table left open by its migration.
const KNOWN=new Set("ab_test_events affiliate_clicks affiliate_conversions affiliate_sessions affiliates agent_learned_answers agent_mandates agent_pending_questions agent_queue agent_searches agent_submissions agent_subscribers agent_worker_heartbeat ai_response_cache alert_log api_keys api_quota api_rate api_usage cohort_weekly_reports company_claims daily_scan_stats detection_telemetry email_logs email_send_log email_send_state email_unsubscribe_tokens free_scan_leads job_board_board_state job_board_board_watch job_board_click_rollup job_board_closures job_board_company_dim_snapshots job_board_company_flow job_board_embeddings job_board_exit_rollup job_board_exits job_board_field_changes job_board_pool_samples job_board_posting_reports job_board_search_clicks job_board_search_events job_board_search_misses job_board_search_rollup job_board_stats_rollup parse_failures payment_failures pro_grants pro_subscribers product_deliveries purchased_content rate_limits resume_analyses scan_feedback scan_industry_pins scan_metrics scan_outcomes scan_report_cache scan_slots shortlist_decisions shortlist_demographics shortlist_notices shortlist_roles suppressed_emails temp_resume_storage used_stripe_sessions user_applications user_job_searches user_profiles user_scan_credits user_scans webhook_events".split(" "));
const names=(rs)=>rs.map((r)=>r.t).join(", ");
const closed=got.filter((r)=>(r.s==="401"||r.s==="403")&&r.k==="42501");
const open=got.filter((r)=>r.s==="200");
const leak=open.filter((r)=>r.k==="rows"&&!AGG.has(r.t));
const agg=open.filter((r)=>r.k==="rows"&&AGG.has(r.t));
ok(leak.length===0,leak.length?"NB-13 a stranger reads rows of "+leak.length+" table(s) that are not public aggregates: "+names(leak)+" (no value printed; a permissive policy or a missing RLS)":"NB-13 no table but the public aggregates answers a stranger with a row ("+agg.length+" aggregate(s) did, of "+got.length+" tables read)");
const fresh=open.filter((r)=>!KNOWN.has(r.t));
ok(fresh.length===0,fresh.length?"NB-13 "+fresh.length+" table(s) outside the 72 known on 2026-11-15 answer a stranger 200: "+fresh.map((r)=>r.t+" (created "+r.f+")").join(", ")+" (revoke from PUBLIC, anon and authenticated, then grant what is meant)":"NB-13 every table that answers a stranger is one of the 72 known on 2026-11-15; "+closed.length+" of "+got.length+" refuse (42501)");
const rlsOnly=open.filter((r)=>r.k==="empty"&&KNOWN.has(r.t));
if(rlsOnly.length)info("NB-13 "+rlsOnly.length+" table(s) show a stranger no row only because row level security hides it, while anon holds SELECT: "+names(rlsOnly));
const shut=[...KNOWN].filter((t)=>closed.some((r)=>r.t===t));
if(shut.length)info("NB-13 "+shut.length+" of the 72 known open now refuse a stranger (take them off the list): "+shut.join(", "));
const gone=got.filter((r)=>r.s==="404");
if(gone.length)info("NB-13 "+gone.length+" table(s) the migrations create are not served (a pending migration, or dropped outside the files): "+names(gone));
const odd=got.filter((r)=>!(r.s==="200"&&(r.k==="rows"||r.k==="empty"))&&!closed.includes(r)&&r.s!=="404");
const unread=want.filter((t)=>!got.some((r)=>r.t===t));
ok(odd.length===0&&unread.length===0,odd.length||unread.length?"NB-13 "+(odd.length+unread.length)+" table(s) were not judged: "+odd.map((r)=>r.t+" ("+r.s+" "+r.k+")").concat(unread.map((t)=>t+" (no answer)")).join(", "):"NB-13 every one of the "+want.length+" tables the migrations create answered a refusal, a 404 or a 200 that was judged");'

# admin-ops: the build on the preflight, the admin header allowed, and a call
# without the key refused before anything is called (index.ts checks the key
# first and builds no client until it matches).
H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/admin-ops" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-admin-key,content-type,authorization,apikey")
BUILD=$(printf '%s' "$H" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if build_ge admin-ops "$BUILD" 2026-10-04 1; then echo "PASS  admin-ops preflight x-fn-build = $BUILD (2026-10-04.1 or later)"; else echo "FAIL  admin-ops preflight x-fn-build = '${BUILD}' (want admin-ops.2026-10-04.1 or later; empty = not deployed)"; fi
printf '%s' "$H" | tr -d '\r' | grep -i '^access-control-allow-headers:' | grep -qi 'x-admin-key' && echo "PASS  admin-ops allows the x-admin-key header" || echo "FAIL  admin-ops preflight does not allow x-admin-key (every dashboard panel would fail CORS)"
NOKEY=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/admin-ops" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"fn":"get_delivery_health","args":{"p_hours_back":0}}')
[ "$NOKEY" = "401" ] && echo "PASS  admin-ops without the admin key -> 401" || echo "FAIL  admin-ops without the admin key -> $NOKEY"

# check-alerts: the build on the preflight, the cron/admin headers allowed, and
# -- only once the new build is proven serving, since the old one ran the alert
# evaluation (and could mail the owner) for any POST -- a keyless POST refused.
H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/check-alerts" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-alerts-cron,content-type")
CBUILD=$(printf '%s' "$H" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
# build_ge, not a pinned day: the exact pin read FAIL (and stopped sending the
# keyless probe) once 2026-10-08.1 replaced 2026-10-04.1.
if build_ge check-alerts "$CBUILD" 2026-10-04 1; then
    echo "PASS  check-alerts preflight x-fn-build = $CBUILD (2026-10-04.1 or later)"
    printf '%s' "$H" | tr -d '\r' | grep -i '^access-control-allow-headers:' | grep -qi 'x-alerts-cron' && echo "PASS  check-alerts allows the x-alerts-cron header" || echo "FAIL  check-alerts preflight does not allow x-alerts-cron"
    CNOKEY=$(curl -s -m 30 -o /tmp/vd_40_alerts.json -w '%{http_code}' -X POST "$B/functions/v1/check-alerts" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{}')
    [ "$CNOKEY" = "401" ] && echo "PASS  check-alerts without a key -> 401 (no evaluation, no metrics)" || echo "FAIL  check-alerts without a key -> $CNOKEY $(head -c 160 /tmp/vd_40_alerts.json)"
else
  echo "FAIL  check-alerts preflight x-fn-build = '${CBUILD}' (want check-alerts.2026-10-04.1 or later; the keyless POST is NOT sent until it is: the old build evaluates and may mail for anyone)"
fi
EH=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/check-error-spikes" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST")
EBUILD=$(printf '%s' "$EH" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if build_ge check-error-spikes "$EBUILD" 2026-10-04 1; then echo "PASS  check-error-spikes preflight x-fn-build = $EBUILD (alert email defangs browser-written text)"; else echo "FAIL  check-error-spikes preflight x-fn-build = '${EBUILD}' (want check-error-spikes.2026-10-04.1 or later)"; fi

