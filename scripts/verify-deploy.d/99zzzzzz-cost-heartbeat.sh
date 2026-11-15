# shellcheck shell=bash
# ── 99zzzzzz-cost-heartbeat. THE 2026-11-08 COST AUDIT, HEARTBEAT LANE (branch
# cost/heartbeat): Do first #1 (the heartbeat's full scan once an hour), #10
# (the scanners' preflight cached for two hours), #11 (token counts printed)
# and #13 (the scan hover warms the scanner the click calls). Three functions:
# scan-heartbeat at 2026-11-09.1, free-keyword-scan at 2026-11-09.2 (the
# integration's, over the ai lane's same-day stamp), free-keyword-scan-stream
# at 2026-11-10.2; one frontend file published by the merge itself
# (src/hooks/use-scan-prefetch.ts); no migration.
#
# Named 99zzzzzz so it sorts with the other last sections; "cost" sorts before
# "hotfix", so it runs ahead of them, which nothing here depends on.
#
# THE CLAIMS, one line each. None FAILs on today's production, before the
# merge and the paste: each reads INFO until what it judges has shipped, and
# can FAIL from then on.
#   B1  each of the three functions serves this lane's build or a later one.
#       Older is INFO (the paste has not landed; section 49 lists the gap); no
#       build header at all is a FAIL.
#   C1  each scanner's preflight answers Access-Control-Max-Age 7200. Missing
#       while the scanner serves the new build is a FAIL (the gateway strips
#       it, or the build lost it); missing on an older build is INFO.
#   H1  the published scan hover (the chunk that logs "[ScanPrefetch] Starting
#       prefetch on hover") asks warm-up for free-keyword-scan and no longer
#       for the streaming fork. The old target alone is INFO (the merge has
#       not published); both, or neither, is a FAIL.
#   H2  the published checkout hook still warms create-product-checkout and
#       still opens checkout through it. A REGRESSION GUARD, NOT PROOF OF THIS
#       DEPLOY: this lane kept the checkout warm-up and changed nothing there.
#   L1  the ten-minute cron still writes its heartbeat row off the hour: the
#       newest row is at most 20 minutes old and, on the new build, written at
#       minute 10 or later (an off-hour run; the hourly run writes by :03).
#       Over 30 minutes is a FAIL (the dead-man check-alerts mails about).
#   L2  on the new build the heartbeat's full scans run once an hour: the last
#       TWO hours hold one to three heartbeat scan rows (twelve when every run
#       was full; the off-hour runs write none). Two hours, not one: a scan
#       row is written when the scan ends, so a one-hour window is empty for
#       the seconds between the last hour's row leaving it and this hour's
#       arriving (review 2026-11-15). None at all is a FAIL. Four or more is
#       a FAIL once the saving must show: COST_HB_DEPLOYED_AT (UTC, the moment
#       the paste carrying scan-heartbeat 2026-11-09.1 and free-keyword-scan
#       2026-11-09.2 landed) is set, both serve those builds or later, and the
#       window opened ten minutes or more after it. Unset, or the window
#       straddling the paste, four or more is INFO. An anchor that is not a
#       time, is in the future, or is set while either build is older, FAILs.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the off-hour run makes no
# model call and the field means nothing without the heartbeat's secret
# (the-scanner-skips-its-model-only-for-the-heartbeats-own-off-hour-run), the
# five skips and the probe that cannot false-alarm (the-heartbeat-pays-for-a-
# full-scan-once-an-hour-and-still-watches-every-ten-minutes), the [AI-USAGE]
# lines (every-model-reply-prints-its-token-counts-and-no-text; they are in
# the function logs, which only the owner can read), and the hover posting
# once in two minutes (the-scan-buttons-hover-warms-the-scanner-the-click-calls).
#
# READ-ONLY. Three OPTIONS preflights; GETs of the homepage, its entry script
# and a handful of chunks; two anon GETs of aggregate health readers
# (get_scan_health_status, get_scan_success_rate), each in PostgREST's
# read-only transaction. Nothing is posted and no model is called.
echo "== 99zzzzzz. cost audit, heartbeat lane: three builds, the scanners' preflight cache, the scan hover's warm-up, the heartbeat's hourly full scan =="

rm -f /tmp/vd_ch_home.html /tmp/vd_ch_entry.js /tmp/vd_ch_chunk.js /tmp/vd_ch_hover.js /tmp/vd_ch_checkout.js /tmp/vd_ch_health.json /tmp/vd_ch_rate.json /tmp/vd_ch_opt_*.txt

# B1 + C1.
VDCH_HB_NEW=unknown
VDCH_FKS_NEW=unknown
for VDCH_SPEC in scan-heartbeat:2026-11-09:1 free-keyword-scan:2026-11-09:2 free-keyword-scan-stream:2026-11-10:2; do
  VDCH_FN=${VDCH_SPEC%%:*}; VDCH_REST=${VDCH_SPEC#*:}; VDCH_D=${VDCH_REST%%:*}; VDCH_N=${VDCH_REST#*:}
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDCH_FN" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,apikey,content-type" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' > "/tmp/vd_ch_opt_$VDCH_FN.txt"
  VDCH_H=$(grep -i '^x-fn-build:' "/tmp/vd_ch_opt_$VDCH_FN.txt" | head -1 | sed -E 's/^[^:]+: *//')
  VDCH_AGE=$(grep -i '^access-control-max-age:' "/tmp/vd_ch_opt_$VDCH_FN.txt" | head -1 | sed -E 's/^[^:]+: *//')
  VDCH_ISNEW=no
  if [ -z "$VDCH_H" ]; then echo "FAIL  B1 $VDCH_FN preflight carries no x-fn-build (want $VDCH_FN.$VDCH_D.$VDCH_N or later)"
  elif build_ge "$VDCH_FN" "$VDCH_H" "$VDCH_D" "$VDCH_N"; then VDCH_ISNEW=yes; echo "PASS  B1 $VDCH_FN x-fn-build = $VDCH_H ($VDCH_D.$VDCH_N or later)"
  else echo "INFO  B1 $VDCH_FN x-fn-build = $VDCH_H: the paste with $VDCH_D.$VDCH_N has not landed (section 49 lists the gap)"; fi
  [ "$VDCH_FN" = scan-heartbeat ] && { [ -z "$VDCH_H" ] && VDCH_HB_NEW=unknown || VDCH_HB_NEW=$VDCH_ISNEW; }
  [ "$VDCH_FN" = free-keyword-scan ] && { [ -z "$VDCH_H" ] && VDCH_FKS_NEW=unknown || VDCH_FKS_NEW=$VDCH_ISNEW; }
  [ "$VDCH_FN" = scan-heartbeat ] && continue
  if [ "$VDCH_AGE" = 7200 ]; then echo "PASS  C1 $VDCH_FN preflight answers Access-Control-Max-Age 7200: a browser asks it once in two hours, not before every scan more than five seconds after the last"
  elif [ "$VDCH_ISNEW" = yes ]; then echo "FAIL  C1 $VDCH_FN serves $VDCH_H but its preflight answers Access-Control-Max-Age '${VDCH_AGE:-none}' (want 7200): the gateway strips it, or the build lost it, so every scan still pays a preflight"
  else echo "INFO  C1 $VDCH_FN preflight answers no Access-Control-Max-Age 7200 yet (${VDCH_AGE:-none}): the build carrying it has not landed"; fi
done

# H1. The entry names the page chunks; the hover's chunk is the one that logs it.
curl -s -m 30 "$SITE/" > /tmp/vd_ch_home.html
VDCH_MAIN=$(grep -o '/assets/index-[^"]*\.js' /tmp/vd_ch_home.html | head -1)
[ -n "$VDCH_MAIN" ] && curl -s -m 60 "$SITE$VDCH_MAIN" > /tmp/vd_ch_entry.js
VDCH_HOVERN=""
for VDCH_C in $( { [ -f /tmp/vd_ch_entry.js ] && grep -aoE '(Index|ResumeUploader)-[A-Za-z0-9_-]*\.js' /tmp/vd_ch_entry.js; } | sort -u | head -12); do
  rm -f /tmp/vd_ch_chunk.js
  curl -s -m 30 "$SITE/assets/$VDCH_C" > /tmp/vd_ch_chunk.js
  if grep -aqF 'ScanPrefetch] Starting prefetch on hover' /tmp/vd_ch_chunk.js; then VDCH_HOVERN=$VDCH_C; mv /tmp/vd_ch_chunk.js /tmp/vd_ch_hover.js; break; fi
done
if [ -z "$VDCH_MAIN" ]; then echo "FAIL  H1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDCH_HOVERN" ]; then echo "FAIL  H1 no Index or ResumeUploader chunk named by $VDCH_MAIN logs the scan hover: the bundle layout moved, so the hover's warm-up cannot be judged"
else
  VDCH_NEWT=no; VDCH_OLDT=no
  grep -aqF 'target:"free-keyword-scan"}' /tmp/vd_ch_hover.js && VDCH_NEWT=yes
  grep -aqF 'target:"free-keyword-scan-stream"}' /tmp/vd_ch_hover.js && VDCH_OLDT=yes
  if [ "$VDCH_NEWT" = yes ] && [ "$VDCH_OLDT" = no ]; then echo "PASS  H1 the published scan hover ($VDCH_HOVERN) asks warm-up for free-keyword-scan, the scanner the click calls first, and no longer for the streaming fork"
  elif [ "$VDCH_OLDT" = yes ] && [ "$VDCH_NEWT" = no ]; then echo "INFO  H1 the published scan hover ($VDCH_HOVERN) still warms free-keyword-scan-stream: the merge carrying the new target has not published"
  elif [ "$VDCH_OLDT" = yes ]; then echo "FAIL  H1 the published hover chunk ($VDCH_HOVERN) asks warm-up for both scanners: two warm-ups a hover"
  else echo "FAIL  H1 the published hover chunk ($VDCH_HOVERN) asks warm-up for neither scanner, so the target moved or the minified shape changed: read the chunk"; fi
fi

# H2. A regression guard: the checkout hook's chunk, named by the entry or the page.
VDCH_COUTN=$( { cat /tmp/vd_ch_entry.js /tmp/vd_ch_hover.js 2>/dev/null; } | grep -ao 'use-product-checkout-[A-Za-z0-9_-]*\.js' | head -1)
[ -n "$VDCH_COUTN" ] && curl -s -m 30 "$SITE/assets/$VDCH_COUTN" > /tmp/vd_ch_checkout.js
if [ -z "$VDCH_COUTN" ]; then echo "FAIL  H2 neither the entry nor the hover's chunk names a use-product-checkout chunk: the bundle layout moved, so the checkout path cannot be judged"
elif grep -aqF 'target:"create-product-checkout"}' /tmp/vd_ch_checkout.js && grep -aqF 'invoke("create-product-checkout"' /tmp/vd_ch_checkout.js; then
  echo "PASS  H2 (a regression guard: this lane changed no checkout file) the published checkout hook ($VDCH_COUTN) still warms create-product-checkout and opens checkout through it"
else echo "FAIL  H2 the published checkout hook ($VDCH_COUTN) no longer both warms create-product-checkout and opens checkout through it: read the chunk before anything else, a purchase may not open"; fi

# L1 + L2.
# GETs: PostgREST runs a GET in a read-only transaction, so neither reader can write.
curl -s -m 60 "$B/rest/v1/rpc/get_scan_health_status" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_ch_health.json
curl -s -m 60 "$B/rest/v1/rpc/get_scan_success_rate?p_scan_type=heartbeat&p_hours_back=2" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_ch_rate.json
# VDCH_NOW (an ISO time) pins the clock for the section's own test.
VDCH_HB_NEW=$VDCH_HB_NEW VDCH_FKS_NEW=$VDCH_FKS_NEW VDCH_ANCHOR="${COST_HB_DEPLOYED_AT:-}" VDCH_NOW="${VDCH_NOW:-}" node -e '
const fs=require("fs");const read=(p)=>{try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return null}};
const isNew=process.env.VDCH_HB_NEW==="yes";
const now=process.env.VDCH_NOW?Date.parse(process.env.VDCH_NOW):Date.now();
const h=read("/tmp/vd_ch_health.json");const r=Array.isArray(h)?h[0]:null;
if(!r||typeof r!=="object"||!r.last_heartbeat_time){console.log("FAIL  L1 get_scan_health_status as anon answered no last heartbeat: "+JSON.stringify(h).slice(0,160));}
else{
  const t=new Date(r.last_heartbeat_time);const age=Math.round((now-t.getTime())/60000);const min=t.getUTCMinutes();
  const at=t.toISOString().slice(11,16)+" UTC";
  if(!Number.isFinite(age))console.log("FAIL  L1 the last heartbeat time is unreadable: "+JSON.stringify(r.last_heartbeat_time));
  else if(age>30)console.log("FAIL  L1 the heartbeat last wrote its row "+age+" min ago (at "+at+"): over 30 minutes, the dead-man check-alerts mails about");
  else if(age>20)console.log("INFO  L1 the heartbeat last wrote its row "+age+" min ago (at "+at+"): a run was missed or is late; over 30 is the FAIL");
  else if(!isNew)console.log("INFO  L1 the heartbeat wrote its row "+age+" min ago (at "+at+"), but scan-heartbeat does not serve 2026-11-09.1 yet: every run is still full");
  else if(min>=10)console.log("PASS  L1 the heartbeat wrote its row "+age+" min ago at "+at+", an off-hour run: the ten-minute watch still runs and records itself between the hourly scans");
  else console.log("INFO  L1 the newest heartbeat row ("+age+" min ago, at "+at+") is the hourly run; an off-hour row is judged on a run after :20");
}
const s=read("/tmp/vd_ch_rate.json");const q=Array.isArray(s)?s[0]:null;
const scanNew=process.env.VDCH_FKS_NEW==="yes";
const given=process.env.VDCH_ANCHOR||"";
let anchor=null,anchorBad=null;
if(given){const t=Date.parse(given);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(given)||!Number.isFinite(t))anchorBad="COST_HB_DEPLOYED_AT="+given+" is not a UTC time (want e.g. 2026-11-20T14:05Z)";
  else if(t>now)anchorBad="COST_HB_DEPLOYED_AT="+given+" is in the future";
  else if(!isNew||!scanNew)anchorBad="COST_HB_DEPLOYED_AT="+given+" says the paste landed, but "+(!isNew?"scan-heartbeat does not serve 2026-11-09.1":"free-keyword-scan does not serve 2026-11-09.2")+" or later";
  else anchor=t;}
if(anchorBad)console.log("FAIL  L2 "+anchorBad);
if(!q||typeof q!=="object"||q.total_scans==null)console.log("INFO  L2 get_scan_success_rate for the heartbeat is unreadable, so the hourly cadence is not judged: "+JSON.stringify(s).slice(0,120));
else{const n=Number(q.total_scans);
  const settled=anchor!==null&&now-2*3600e3>=anchor+10*60e3;
  if(!isNew)console.log("INFO  L2 the heartbeat wrote "+n+" scan row(s) in the last two hours on the old build (twelve when every run is full)");
  else if(n===0)console.log("FAIL  L2 the heartbeat wrote no scan row in the last two hours on the new build: its hourly full scan did not run, or did not reach the scanner");
  else if(n<=3)console.log("PASS  L2 the heartbeat wrote "+n+" scan row(s) in the last two hours: its full scan runs hourly, where every run was full before (twelve in two hours)");
  else if(settled)console.log("FAIL  L2 the heartbeat wrote "+n+" scan rows in the two hours from "+new Date(now-2*3600e3).toISOString().slice(0,16)+"Z, all after the paste (COST_HB_DEPLOYED_AT "+given+"): off-hour runs are still full scans, so the hourly saving is not happening (a caller that is not the cron reaches it, or the scanner ignores the off-hour flag)");
  else console.log("INFO  L2 the heartbeat wrote "+n+" scan rows in the last two hours: "+(anchor===null?"set COST_HB_DEPLOYED_AT to judge it (four or more then FAILs)":"the window opened before the paste settled ("+given+" plus ten minutes)")+"; one to three is the settled count");}
'
