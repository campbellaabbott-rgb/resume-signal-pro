# shellcheck shell=bash
# ── 99zzzzzz. COST WAVE 2 (2026-11-16, branch cost2/db): two scheduled calls
# nothing reads stop, and the database size is written down once a night.
#
# THE CLAIMS, one line each below, read from get_cron_health (name, schedule,
# the timeout a command sets, run counts; never a command):
#   - 20261115100000: warm-up-edge-functions (every 10 minutes) and
#     scheduled-health-probe-every-5min (every 5 minutes), both made in the
#     dashboard, are no longer scheduled (plan BN-1);
#   - 20261115110000: storage-size-stamp runs daily at 11:11 UTC with
#     statement_timeout 60s in its command, and no run of it failed (BN-2).
# BEFORE THE DEPLOY each claim is an INFO line naming what runs today. The
# pair counts as applied once storage-size-stamp shows in cron health
# (20261115110000 applies after 20261115100000, so from then on either old job
# still listed is a FAIL), or once COST2_APPLIED_AT (UTC, when the second file
# finished applying) is set, in the environment or on the line below.
# Not provable from outside, so proved in the suite: the ring keeps the last
# 60 nights newest first, the function runs as its caller and no client role
# may call it, and the removal can run twice.
#
# READ-ONLY: one anon read RPC.
echo "== 99zzzzzz. Cost wave 2: two scheduled calls nothing reads stop, and the database size is written down nightly =="

VDC2_APPLIED_AT="${COST2_APPLIED_AT:-}"

rm -f /tmp/vd_c2_cron.json
R get_cron_health '{"p_hours":24}' > /tmp/vd_c2_cron.json

VDC2_APPLIED="$VDC2_APPLIED_AT" node -e '
const fs=require("fs");
const rd=(p)=>{try{return fs.readFileSync(p,"utf8")}catch{return ""}};
const parse=(s)=>{try{return JSON.parse(s)}catch{return undefined}};
const out=(s)=>console.log(s);
const now=Date.now();
const GONE=["warm-up-edge-functions","scheduled-health-probe-every-5min"];
const ST="storage-size-stamp",AT="11 11 * * *",TO="60s";

const cs=rd("/tmp/vd_c2_cron.json");const cj=parse(cs);
if(!Array.isArray(cj)){out("FAIL  get_cron_health answered "+(cj===undefined?"no JSON (a 60s client timeout, or an HTML error page): "+cs.slice(0,120):JSON.stringify(cj).slice(0,160))+" -- no schedule of this wave can be read");process.exit(0)}
if(!cj.length){out("FAIL  get_cron_health answered no jobs at all, so no schedule of this wave can be read");process.exit(0)}
const J=Object.fromEntries(cj.map((r)=>[r.ch_jobname,r]));
const desc=(r)=>r.ch_schedule+(r.ch_active?"":" PAUSED")+", timeout "+(r.ch_timeout||"none")+", "+r.ch_runs+" runs in 24h";
const at=Date.parse(process.env.VDC2_APPLIED||"");
const asserted=Number.isFinite(at)&&at<=now;
const applied=!!J[ST]||asserted;
const why=J[ST]?ST+" shows in cron health":"COST2_APPLIED_AT says the files applied";

for(const n of GONE){const r=J[n];
  if(!r)out(applied?"PASS  "+n+" is no longer scheduled (20261115100000): nothing read what it posted":"INFO  "+n+" is not scheduled today; 20261115100000 removes it by name if it is");
  else if(applied)out("FAIL  "+n+" is still scheduled ("+desc(r)+") though "+why+": 20261115100000 did not take");
  else out("INFO  before 20261115100000: "+n+" runs ("+desc(r)+"); the deploy unschedules it, since nothing reads what it posts")}

{const r=J[ST];
  if(!r){
    if(asserted)out("FAIL  "+ST+" is not scheduled though COST2_APPLIED_AT says 20261115110000 applied");
    else out("INFO  before 20261115110000: "+ST+" is not scheduled; the deploy schedules it daily at 11:11 UTC with "+TO+" in its command")}
  else if(r.ch_schedule!==AT||r.ch_timeout!==TO||!r.ch_active)out("FAIL  "+ST+": "+desc(r)+". 20261115110000 leaves it on "+AT+", active, with timeout "+TO+" in the command");
  else if(Number(r.ch_failed)>0)out("FAIL  "+ST+" failed "+r.ch_failed+" of "+r.ch_runs+" runs in 24h (last "+(r.ch_last_status||"none")+")");
  else if(!Number(r.ch_runs)){
    if(asserted&&now-at>25*3600e3)out("FAIL  "+ST+" has not run in the last 24h though COST2_APPLIED_AT is more than 25 hours ago");
    else out("PASS  "+ST+" runs on "+AT+" with timeout "+TO+" (20261115110000); no run in the last 24h yet, and the file wrote the first entry as it applied")}
  else out("PASS  "+ST+" runs on "+AT+" with timeout "+TO+" (20261115110000); last run "+(r.ch_last_status||"none")+" in "+r.ch_last_seconds+" s")}
'
