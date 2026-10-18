# shellcheck shell=bash
# ── 92 (w4b ops-email-tests). Sourced by scripts/verify-deploy.sh just before
# "done."; $B $K $SITE and the helpers R probe build_ge are in scope.
#
# THE CLAIMS (wave 4 round 2, the S12 ops, data-page and tests-ci items):
#   - scan-heartbeat and check-alerts answer 2026-10-11.28 or later;
#   - cron_http_answers exists and refuses anon (20261011200000), and
#     get_scan_health_status still answers anon, with a heartbeat that ran in
#     the last 30 minutes (its dead-man, which check-alerts now alarms on);
#   - the outside board alarm runs at its off-peak minutes.
# READ-ONLY: OPTIONS preflights, one GET refusal probe, one anon read of the
# health reader (aggregates only), and GitHub run lists through `gh`.
echo "== 92. w4b ops: heartbeat and alert builds, the cron answers reader, the heartbeat's dead-man, the board alarm =="

for FN92 in scan-heartbeat check-alerts; do
  H92=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN92" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$H92" ]; then echo "FAIL  $FN92 preflight carries no x-fn-build (want $FN92.2026-10-11.28 or later)"
  elif build_ge "$FN92" "$H92" "2026-10-11" "28"; then echo "PASS  $FN92 x-fn-build = $H92 (2026-10-11.28 or later)"
  else echo "FAIL  $FN92 x-fn-build = $H92 (want $FN92.2026-10-11.28 or later: the cron 5xx rule, the e2e clock and the dead-man ping are not live)"; fi
done

# 42501 = the reader exists and refuses anon; PGRST202 = 20261011200000 not applied.
probe cron_http_answers '{"p_minutes":60,"p_error_minutes":180}'

R get_scan_health_status '{}' > /tmp/vd_92_health.json
node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_92_health.json","utf8"))}catch{}
const r=Array.isArray(j)?j[0]:null;
if(!r||typeof r!=="object"){console.log("FAIL  get_scan_health_status as anon answered no row: "+JSON.stringify(j).slice(0,160)+" (the ScanMetrics page and post-publish-smoke read it with the publishable key)");process.exit(0)}
const age=r.last_heartbeat_time?Math.round((Date.now()-Date.parse(r.last_heartbeat_time))/60000):null;
const issues=Array.isArray(r.issues)?r.issues:[];
console.log((age!==null&&age<=30?"PASS":"FAIL")+"  the heartbeat last ran "+(age===null?"never":age+" min ago")+" (status "+r.last_heartbeat_status+"; over 30 min is the dead-man check-alerts mails about)");
const stale=issues.some((x)=>/^Heartbeat has (not run|never run)/.test(String(x)));
if(age!==null&&age<=30)console.log((stale?"FAIL":"PASS")+"  get_scan_health_status names no stopped heartbeat while it is running ("+JSON.stringify(issues).slice(0,200)+")");
const visitorWording=issues.some((x)=>/^(Visitor scan|Every visitor scan|High visitor scan|Heartbeat has)/.test(String(x)));
const oldWording=issues.some((x)=>/^(Success rate below|No successful scans in last hour|High latency:)/.test(String(x)));
if(oldWording)console.log("FAIL  get_scan_health_status still speaks the old reader ("+JSON.stringify(issues).slice(0,200)+"): 20261011200000, which counts visitor scans only, is not applied");
else console.log("INFO  get_scan_health_status: status "+r.status+", "+r.scans_last_hour+" visitor scan(s) this hour at "+r.success_rate_last_hour+"%, issues "+JSON.stringify(issues).slice(0,200)+(visitorWording?" (the 20261011200000 wording)":" (no issue to tell the two readers apart by)"));'

echo "INFO  OWNER: create a healthchecks.io check (period 15 min, grace 30 min) and put its ping URL in the Lovable secret HC_PING_URL; scan-heartbeat 2026-10-11.28 pings it every run (/fail when it finds the product down) and its JSON says deadMan sent|unset|failed. Then pause the scan-heartbeat-sentinel job for 45 min once to see the check mail you."

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh run list --workflow board-health.yml --limit 40 --json event,createdAt,conclusion > /tmp/vd_92_bh.json 2>/dev/null || : > /tmp/vd_92_bh.json
  node -e '
const fs=require("fs");let r=[];try{r=JSON.parse(fs.readFileSync("/tmp/vd_92_bh.json","utf8"))}catch{}
const day=r.filter((x)=>x.event==="schedule"&&Date.now()-Date.parse(x.createdAt)<=24*3600e3);
console.log("INFO  board-health ran "+day.length+" scheduled time(s) in the last 24 h of the 48 its off-peak minutes (17 and 47) ask for; GitHub drops scheduled runs under load, which is why the outside check (BOARD_HEALTH_PING_URL) exists");'
else
  echo "INFO  gh is not installed or not signed in: the board-health schedule is not read"
fi
