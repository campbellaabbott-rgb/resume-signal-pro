# shellcheck shell=bash
# ── 99zzzzzzz-bugs-ops-alerts. THE BUG ROUND OF 2026-11-08, PART A, LANE
# ops-alerts (branch bugs/a-ops-alerts): the owner's alarms. Four functions,
# each at 2026-11-12.1 (the integrator's stamp): scan-heartbeat (S14X-018 a
# down state is reminded every two hours and its easing is said; S14X-045 a
# cooldown ends with its incident and a Stripe credential failure is down;
# NB-34 a stale accuracy reading is called unmeasured), mail-watch
# (RC-S13-109 a delivered Full Analysis is judged by its report and an
# email_failed order rings; S14X-242 a door per failing member; S14X-217 R10
# reads the last hour and 3 hours; NB-9 R6 resolves every SPF include and
# healthchecks.io hears /fail only when an alarm reached nobody; NB-37 R11
# reads the mail classes' run stamps), check-alerts and check-error-spikes
# (NB-36 our domain first, Resend's onboarding sender second). No migration;
# no frontend file.
#
# THE CLAIMS, one line each. None FAILs on today's production before the
# paste: each reads INFO until what it judges has shipped, and can FAIL.
#   B1  each of the four functions serves 2026-11-12.1 or later. Older is
#       INFO (the paste has not landed; section 49 lists the gap); no build
#       header at all is a FAIL.
#   C1  get_cron_health, read as anon over the last hour and the last 3 hours
#       (the windows R10 now asks for), answers rows carrying the 11 ch_*
#       columns R10 reads. Not rows, no job, or a row missing a column is a
#       FAIL: R10 would read unknown, or ring on nothing. The PASS names any
#       job failing every run there, which R10 rings for on its next run.
#   W1  NEW-OPS-ALERTS-01 (fixed by the cost wave, scan-heartbeat 2026-11-09.2,
#       live since 2026-11-15; kept here as its watch): with
#       VD_BUGS_OPS_WATCH=1, get_scan_health_status is read 13 times, 10
#       minutes apart, and the heartbeat's verdict must not go from not
#       healthy on a :0x run (the hourly full run) to healthy on the next
#       off-hour run. In two or more hours of the watch is a FAIL (the bug
#       flips every hour); in one is INFO (a real recovery looks the same
#       once); none is a PASS. Fewer than two distinct heartbeat rows is a
#       FAIL (the heartbeat is not running). Without the variable the watch
#       does not run and the line is INFO.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the heartbeat's mail
# rules (an-alarm-that-repeats-itself-teaches-deafness and
# a-heartbeat-that-stays-down-keeps-saying-so-and-says-when-it-eases), every
# mail-watch rule (mail-watch-judges-each-order-by-its-own-mail-and-rings-
# for-any-failing-job, w4b-payments-mail-watch-rings-when-a-mail-class-stops;
# its run stamp is in job_board_meta, which anon cannot read), and both
# alarm senders (an-owner-alarm-one-sender-refuses-goes-out-from-the-other).
# The SPF record R6 now rings for is section 94's FAIL until the owner sets
# the TXT 'send' to v=spf1 include:amazonses.com ~all.
#
# READ-ONLY. Four OPTIONS preflights, two anon GETs of get_cron_health and,
# when watching, anon GETs of get_scan_health_status: each a PostgREST GET,
# run in a read-only transaction. Nothing is posted, mailed or written.
echo "== 99zzzzzzz. bug round part A, ops-alerts: four builds, the cron reader R10's new windows read, the heartbeat flap watch =="

rm -f /tmp/vd_bo_opt_*.txt /tmp/vd_bo_cron_*.json /tmp/vd_bo_watch.txt

# B1.
VDBO_HB=""
for VDBO_SPEC in "scan-heartbeat:down reminded every 2 hours, its easing said, a Stripe credential failure down, a stale accuracy reading unmeasured" \
                 "mail-watch:R2 by each order's state, a door per failing member, R10's 1- and 3-hour windows, R6's SPF includes, R11, the dead-man ping" \
                 "check-alerts:its alert from our domain first, Resend's onboarding sender second" \
                 "check-error-spikes:its spike mail from our domain first, the cooldown door given back when nobody got it"; do
  VDBO_FN=${VDBO_SPEC%%:*}; VDBO_WHAT=${VDBO_SPEC#*:}
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDBO_FN" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" | tr -d '\r' > "/tmp/vd_bo_opt_$VDBO_FN.txt"
  VDBO_H=$(grep -i '^x-fn-build:' "/tmp/vd_bo_opt_$VDBO_FN.txt" | head -1 | sed -E 's/^[^:]+: *//')
  [ "$VDBO_FN" = scan-heartbeat ] && VDBO_HB=$VDBO_H
  if [ -z "$VDBO_H" ]; then echo "FAIL  B1 $VDBO_FN preflight carries no x-fn-build (want $VDBO_FN.2026-11-12.1 or later): the function is not deployed, or its preflight does not answer"
  elif build_ge "$VDBO_FN" "$VDBO_H" 2026-11-12 1; then echo "PASS  B1 $VDBO_FN x-fn-build = $VDBO_H (2026-11-12.1 or later: $VDBO_WHAT)"
  else echo "INFO  B1 $VDBO_FN x-fn-build = $VDBO_H: the part-A paste with 2026-11-12.1 has not landed (section 49 lists the gap)"; fi
done

# C1. GETs: PostgREST runs a GET in a read-only transaction.
for VDBO_HRS in 1 3; do
  curl -s -m 60 "$B/rest/v1/rpc/get_cron_health?p_hours=$VDBO_HRS" -H "apikey: $K" -H "Authorization: Bearer $K" > "/tmp/vd_bo_cron_$VDBO_HRS.json"
done
node -e '
const fs=require("fs");
const want=["ch_jobname","ch_schedule","ch_active","ch_timeout","ch_runs","ch_failed","ch_timeouts","ch_last_start","ch_last_status","ch_last_seconds","ch_max_seconds"];
for(const h of [1,3]){
  let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_bo_cron_"+h+".json","utf8"))}catch{}
  const label="C1 get_cron_health as anon over the last "+(h===1?"hour":h+" hours");
  if(!Array.isArray(j)){console.log("FAIL  "+label+" answered no rows ("+JSON.stringify(j).slice(0,140)+"): mail-watch R10 reads this window to ring for a job failing every run");continue}
  if(j.length===0){console.log("FAIL  "+label+" lists no scheduled job: R10 would read unknown");continue}
  const bad=j.filter((r)=>!r||typeof r!=="object"||want.some((c)=>!(c in r)));
  if(bad.length){const r=bad[0]&&typeof bad[0]==="object"?bad[0]:{};console.log("FAIL  "+label+" answers "+bad.length+" of "+j.length+" row(s) without the columns R10 reads: missing "+want.filter((c)=>!(c in r)).join(", "));continue}
  const streak=j.filter((r)=>r.ch_last_status==="failed"&&Number(r.ch_runs)>=3&&Number(r.ch_failed)>=Number(r.ch_runs)).map((r)=>r.ch_jobname+" ("+r.ch_failed+" of "+r.ch_runs+")");
  console.log("PASS  "+label+" answers "+j.length+" job(s) carrying the 11 columns R10 reads; "+(streak.length?"failing every run there, so R10 rings for them on its next run, as it should: "+streak.join(", "):"none failing every run, so this window rings for nothing"));
}'

# W1.
if [ "${VD_BUGS_OPS_WATCH:-}" = 1 ]; then
  VDBO_N=${VD_BUGS_OPS_WATCH_SAMPLES:-13}; VDBO_GAP=${VD_BUGS_OPS_WATCH_GAP:-600}
  : > /tmp/vd_bo_watch.txt
  VDBO_I=0
  while [ "$VDBO_I" -lt "$VDBO_N" ]; do
    curl -s -m 60 "$B/rest/v1/rpc/get_scan_health_status" -H "apikey: $K" -H "Authorization: Bearer $K" >> /tmp/vd_bo_watch.txt
    echo >> /tmp/vd_bo_watch.txt
    VDBO_I=$((VDBO_I + 1))
    [ "$VDBO_I" -lt "$VDBO_N" ] && sleep "$VDBO_GAP"
  done
  VDBO_CARRY=no
  [ -n "$VDBO_HB" ] && build_ge scan-heartbeat "$VDBO_HB" 2026-11-09 2 && VDBO_CARRY=yes
  VDBO_CARRY=$VDBO_CARRY VDBO_N=$VDBO_N node -e '
const fs=require("fs");const seen=new Map();
for(const l of fs.readFileSync("/tmp/vd_bo_watch.txt","utf8").split("\n")){
  let j=null;try{j=JSON.parse(l)}catch{continue}
  const r=Array.isArray(j)?j[0]:null;if(!r||!r.last_heartbeat_time)continue;
  const t=Date.parse(r.last_heartbeat_time);if(Number.isFinite(t))seen.set(t,String(r.last_heartbeat_status));
}
const rows=[...seen.entries()].sort((a,b)=>a[0]-b[0]);
const n=process.env.VDBO_N;
if(rows.length<2){console.log("FAIL  W1 the flap watch read "+rows.length+" distinct heartbeat row(s) in "+n+" samples: the heartbeat is not writing its ten-minute row, or get_scan_health_status does not answer");process.exit(0)}
const hours=new Set();const said=[];
for(let i=1;i<rows.length;i++){const [ta,sa]=rows[i-1],[tb,sb]=rows[i];
  const ma=new Date(ta).getUTCMinutes(),mb=new Date(tb).getUTCMinutes();
  if(sa!=="healthy"&&ma<10&&sb==="healthy"&&mb>=10){hours.add(new Date(ta).toISOString().slice(0,13));said.push(new Date(ta).toISOString().slice(11,16)+" "+sa+" to "+new Date(tb).toISOString().slice(11,16)+" healthy")}}
const carry=process.env.VDBO_CARRY==="yes";
if(hours.size===0)console.log("PASS  W1 (NEW-OPS-ALERTS-01) "+rows.length+" heartbeat rows watched: no hourly run'"'"'s failure read healthy on the next off-hour run");
else if(hours.size>=2&&carry)console.log("FAIL  W1 (NEW-OPS-ALERTS-01) the heartbeat read healthy on the off-hour run after a failing hourly run in "+hours.size+" hours ("+said.join("; ")+"): the off-hour runs no longer carry the hourly checks, so each hour mails a recovery that is not one");
else if(hours.size>=2)console.log("INFO  W1 (NEW-OPS-ALERTS-01) the heartbeat flipped to healthy after a failing hourly run in "+hours.size+" hours ("+said.join("; ")+"), but scan-heartbeat does not serve 2026-11-09.2, the build that carries the hourly checks");
else console.log("INFO  W1 (NEW-OPS-ALERTS-01) one hour flipped from a failing hourly run to a healthy off-hour run ("+said.join("; ")+"): a real recovery looks the same once; two hours of it is the FAIL");
'
else
  echo "INFO  W1 (NEW-OPS-ALERTS-01, fixed by the cost wave's scan-heartbeat 2026-11-09.2) the heartbeat flap watch did not run: VD_BUGS_OPS_WATCH=1 reads get_scan_health_status 13 times, 10 minutes apart"
fi
