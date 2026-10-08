# shellcheck shell=bash
# ── 63. WAVE 2 EMAIL-OPS (docs/wave2/email-ops.md). Sourced by
# scripts/verify-deploy.sh just before "done."; $B $K $SITE $UA and the
# helpers J R probe build_ge are in scope.
#
# READ-ONLY. Every function here that can send mail, run a scan or spend a
# model call is NEVER called: its builds are read from OPTIONS preflights
# (which run no function logic), its refusals are proved in the vitest suite.
# The three unsubscribe links are read with a GET and a token no mailbox
# holds: every build, old or new, refuses that token before any write (the
# new ones answer 303 to the confirm page and never write on GET at all). The
# board is read with one list countOnly request under x-rb-budget: probe.
# Table and RPC probes are selects and readers a revoked grant refuses.
echo "== 63. wave 2 email-ops: digest window and schedule, unsubscribe by button, mail queue, claims, sentinel, monitors, affiliates =="

# Builds: date part 2026-10-08 or later (a later deploy carries this too).
for FN63 in send-search-digest industry-corrections-digest send-market-pulse send-scan-report process-email-queue auth-email-hook \
  company-claim scan-heartbeat admin-ops check-alerts notify-owner free-keyword-scan test-ai-fallback health-check \
  scheduled-health-probe get-analytics get-error-telemetry affiliate-payout-request send-agent-digest check-error-spikes; do
  H63=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN63" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$H63" ]; then echo "FAIL  $FN63 preflight carries no x-fn-build (not deployed, or the previous bundle is still serving)"
  elif build_ge "$FN63" "$H63" 2026-10-08 1; then echo "PASS  $FN63 preflight x-fn-build = $H63 (2026-10-08.1 or later)"
  else echo "FAIL  $FN63 preflight x-fn-build = $H63 (want $FN63.2026-10-08.1 or later)"; fi
done

# L1-03 / L10-10: a preflight that refuses x-admin-key is a dashboard the browser never lets through.
for FN63 in get-analytics get-error-telemetry scan-heartbeat admin-ops company-claim; do
  A63=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN63" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-admin-key,content-type" | tr -d '\r' | grep -i '^access-control-allow-headers:' | head -1)
  case "$(printf '%s' "$A63" | tr 'A-Z' 'a-z')" in *x-admin-key*) echo "PASS  $FN63 preflight allows x-admin-key";; *) echo "FAIL  $FN63 preflight does not allow x-admin-key: ${A63:-(no header)}";; esac
done

# L10-02: the board applies and echoes the digest's discovery window (job-board .91).
J '{"action":"status"}' > /tmp/vd_63_status.json
J '{"action":"list","q":"nurse","countOnly":true,"newSince":"2026-10-01T00:00:00Z"}' > /tmp/vd_63_newsince.json
node -e '
const fs=require("fs");const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const st=rd("/tmp/vd_63_status.json")||{};const m=/^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(st.version||""));
const ok=!!m&&(m[1]>"2026-09-09"||(m[1]==="2026-09-09"&&Number(m[2])>=91));
console.log((ok?"PASS":"FAIL")+"  job-board status.version = "+st.version+" (want 2026-09-09.91 or later: the newSince window)");
const j=rd("/tmp/vd_63_newsince.json")||{};
console.log((j.newSince==="2026-10-01T00:00:00.000Z"?"PASS":"FAIL")+"  a newSince count echoes its window: newSince="+JSON.stringify(j.newSince)+" total="+JSON.stringify(j.total)+(j.countUnavailable?" countUnavailable":""));
if(typeof j.total!=="number")console.log("INFO  the newSince count was not a number ("+JSON.stringify(j).slice(0,160)+"): the digest gives such a claim back and retries the next day");'

# L10-14: a GET on an old unsubscribe link changes nothing and goes to the confirm page.
vd63_unsub() { # $1 fn, $2 query
  local hdr; hdr=$(curl -s -m 30 -D - -o /dev/null "$B/functions/v1/$1?action=unsubscribe&$2" | tr -d '\r')
  local code; code=$(printf '%s' "$hdr" | head -1 | awk '{print $2}')
  local loc; loc=$(printf '%s' "$hdr" | grep -i '^location:' | head -1 | sed -E 's/^[^:]+: *//')
  case "$code|$loc" in 303\|$SITE/email/unsubscribe#*) echo "PASS  $1 GET unsubscribe -> 303 $loc (no write on GET)";;
    *) echo "FAIL  $1 GET unsubscribe -> HTTP $code ${loc:+Location $loc}(want 303 to $SITE/email/unsubscribe#...)";; esac
}
vd63_unsub send-search-digest "id=00000000-0000-4000-8000-000000000000&token=00000000000000000000000000000000"
vd63_unsub send-market-pulse "email=nobody%40example.invalid&token=00000000000000000000000000000000"
vd63_unsub send-scan-report "token=00000000000000000000000000000000"
grep -q '^Disallow: /email/unsubscribe' <(curl -s -m 30 -A "$UA" "$SITE/robots.txt") \
  && echo "PASS  robots.txt disallows /email/unsubscribe (the frontend with the confirm page is live)" \
  || echo "FAIL  robots.txt does not name /email/unsubscribe (the frontend with the confirm page has not published)"

# The new tables and readers: present, and closed to the publishable key.
vd63_code() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})'; }
for T63 in search_digest_sent affiliate_payout_requests; do
  C63=$(curl -s -m 30 "$B/rest/v1/$T63?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | vd63_code)
  case "$C63" in 42501) echo "PASS  anon GET $T63 -> 42501 (exists, closed by name)";; PGRST205) echo "FAIL  $T63 does not exist (its migration has not applied)";;
    *) echo "FAIL  anon GET $T63 -> $C63 (want 42501)";; esac
done
C63=$(curl -s -m 30 "$B/rest/v1/affiliate_payout_requests?select=conversion_ids&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | vd63_code)
case "$C63" in 42501) echo "PASS  affiliate_payout_requests carries conversion_ids (42501 on the column, not 42703): a paid request settles its conversions";; 42703) echo "FAIL  affiliate_payout_requests lacks conversion_ids (20261008126000 not applied; affiliate-payout-request .10-08 writes it)";;
  PGRST205) echo "FAIL  affiliate_payout_requests does not exist (20261008124000 not applied)";; *) echo "INFO  affiliate_payout_requests column probe -> $C63";; esac
C63=$(curl -s -m 30 "$B/rest/v1/company_claims?select=owner_approved_at,last_sent_at&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | vd63_code)
case "$C63" in 42501) echo "PASS  company_claims carries owner_approved_at and last_sent_at (42501 on the columns, not 42703)";; 42703) echo "FAIL  company_claims lacks owner_approved_at/last_sent_at (20261008122000 not applied; company-claim .10-08 needs it)";;
  *) echo "INFO  company_claims column probe -> $C63";; esac
for P63 in 'get_recent_heartbeats|{"p_limit":1}' 'get_heartbeat_history|{"p_hours":1,"p_limit":1}' 'search_digest_record_sent|{"p_search_id":"00000000-0000-4000-8000-000000000000","p_posting_ids":[]}' 'email_delivery_health|{"p_hours":1}'; do
  N63=${P63%%|*}; A63=${P63#*|}
  C63=$(R "$N63" "$A63" | vd63_code)
  case "$C63" in 42501) echo "PASS  $N63 as anon -> 42501 (closed)";; PGRST202) echo "FAIL  $N63 -> PGRST202 (not created: its migration has not applied)";; *) echo "FAIL  $N63 as anon -> $C63 (want 42501)";; esac
done
R get_company_claim_status '{"p_token":"__vd63_no_such_company__"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{}console.log((j&&j.verified===false?"PASS":"FAIL")+"  get_company_claim_status still answers the badge reader: "+s.slice(0,80))})'
echo "INFO  the website under a Verified employer badge shows only after the owner approves the claim; the pglite test proves it, and production has no claim to read it from here"

# The schedules: present and active (their commands are not readable here; each file's self-check asserted x-email-cron when it applied).
R get_cron_health '{"p_hours":48}' > /tmp/vd_63_cron.json
node -e '
const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync("/tmp/vd_63_cron.json","utf8"))}catch{j=null}
if(!Array.isArray(j)){console.log("INFO  get_cron_health unreadable: "+JSON.stringify(j).slice(0,140));process.exit(0)}
const job=(n)=>j.find((x)=>x.ch_jobname===n);
for(const [n,s,m] of [["send-search-digest","23 14 * * *","20261008125000"],["industry-corrections-digest","15 9 * * 1","20261008125000"],["check-error-spikes","7-59/15 * * * *","20261008128000"]]){
  const r=job(n);
  if(!r){console.log("FAIL  no "+n+" cron job ("+m+" has not applied; apply it LAST, after its function\x27s 2026-10-08 build serves)");continue}
  console.log((r.ch_schedule===s&&r.ch_active?"PASS":"FAIL")+"  "+n+" cron: schedule "+r.ch_schedule+", active "+r.ch_active);
  console.log("INFO  "+n+" last 48h: runs "+r.ch_runs+", failed "+r.ch_failed+", last "+r.ch_last_status+" at "+r.ch_last_start+" (a 401 in the function log means the job is not sending the key)");}
const hb=job("scan-heartbeat-sentinel");
console.log((hb&&hb.ch_active?"PASS":"FAIL")+"  scan-heartbeat-sentinel cron "+(hb?"schedule "+hb.ch_schedule+", active "+hb.ch_active+", runs "+hb.ch_runs+"/48h":"is missing"));
const q=job("process-email-queue");
console.log(q?"INFO  process-email-queue cron: schedule "+q.ch_schedule+", active "+q.ch_active+", runs "+q.ch_runs+"/48h":"INFO  no process-email-queue cron job: queued mail (auth mails, the fix-plan drip) is never sent until Lovable Cloud\x27s email setup re-creates it (owner)");'

# The sentinel, from its public status reader (it is never run from here).
R get_scan_health_status '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{}const r=Array.isArray(j)?j[0]:j;if(!r){console.log("INFO  get_scan_health_status unreadable: "+s.slice(0,120));return}
const age=r.last_heartbeat_time?Math.round((Date.now()-Date.parse(r.last_heartbeat_time))/60000):null;
console.log((age!==null&&age<=20?"PASS":"FAIL")+"  the sentinel ran "+(age===null?"never":age+" min ago")+", status "+r.last_heartbeat_status+" (a run older than 20 min after the deploy means its cron is refused: check the key)");
console.log("INFO  last_successful_scan "+r.last_successful_scan+", scans_last_hour "+r.scans_last_hour+" (the heartbeat now runs an uncached scan every 10 min, typed heartbeat)");})'
# The heartbeat's uncached scan is not a resume anyone scanned: the public counter must not climb 6 an hour by itself.
R get_today_scan_count '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=Number(s);const h=new Date().getUTCHours()+new Date().getUTCMinutes()/60;
console.log(Number.isFinite(n)?"INFO  get_today_scan_count = "+n+" at "+new Date().toISOString().slice(11,16)+" UTC; the heartbeat alone would add about "+Math.floor(h*6)+" by now if free-keyword-scan .10-08 counted it (it must not: compare day over day after the deploy)":"INFO  get_today_scan_count unreadable: "+s.slice(0,120))})'
echo "INFO  OWNER: notify.resumebooster.work has no DNS (register L10-01): auth mails and the fix-plan drip are refused by the provider. process-email-queue now dead-letters each refused message with the sender named and keeps going; re-verify the domain in Lovable Cloud or restore its delegation, then send one magic link and check a pending+sent pair"
echo "INFO  OWNER: affiliate payout requests now arrive by email and sit in affiliate_payout_requests (status requested). A request covers APPROVED conversions only (nothing in the code approves one: set a conversion approved once its refund window has passed). Setting a request paid settles it: its conversions become paid and the amount leaves pending_payout for paid_out, in that one update"
