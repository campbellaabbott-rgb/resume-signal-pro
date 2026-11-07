# shellcheck shell=bash
# ── 99zzzz. AUDIT-REST, THE HELD BOARD ITEMS (branch fix/audit-rest-held-board):
# S13-114 (an anonymous status is counted and writes nothing; upkeep answers
# only the scheduler; a dead chain is kicked by the database's own clock),
# S13-118 (the retired agent-ready flag narrows nothing), S13-104 and S13-040
# (below, in the suite). job-board .101, agent-mcp and public-api 2026-11-03.1,
# migrations 20261103220000 and 20261107100000 (the upkeep hotfix:
# 20261103221000 never applies, docs/deploy-ledger.json neverApply).
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh in byte order ("-"
# sorts before "z") and under a collating locale that ignores the dash.
#
# THE CLAIMS, one line each; each fails on the job-board .100 build, S2 and C2 aside:
#   B1  job-board serves 2026-09-09.101 or later;
#   B2  agent-mcp and public-api serve 2026-11-03.1 or later;
#   F1  a list asking for the retired flag has it named in ignoredFilters;
#   F2  that list is not narrowed to the four vendors the flag used to mean;
#   U1  upkeep, asked with the publishable key, is refused as the scheduler's;
#   S1  a status this request made compute reports the watchdog readOnly;
#   S2  that computed status moved the meter's probe count. The count is shared
#       with every other probe in that minute (15 in 20 s measured on .100, with
#       no status read), so growth proves nothing: no growth is a FAIL, and
#       growth is INFO. The suite proves a status is counted;
#   C1  the job-board-dead-chain-kick cron (20261107100000) is active, runs
#       every minute, and its last run in the hour succeeded;
#   C2  the chain's freshest pulse (status.chainWatchdog.pulseAgeMs) is inside
#       the kick's bound: the watchdog's thresholdMs plus 120 s, for the kick's
#       one-minute tick and a hop's first stamp (5.6 s measured). INFO when
#       status reports no pulse or ingest is paused; it judges only the moment
#       it reads, and a memo answer can understate the age by 30 s.
#   Upkeep has no scheduled caller, by decision: an INFO line says so, with
#   status.boardUpkeep as read.
# Not provable from outside, so proved in the suite: no query text and no
# per-person hash in a log line, an allowance note's claim given back, the
# stored flag stripped from user_job_searches (the row is private; the migration
# refuses to finish while any row carries it), and the /v1 and connector
# parameters reaching the board as the vendor list.
#
# READ-ONLY: OPTIONS preflights, one list and up to six status reads with
# x-rb-budget: probe, one upkeep the anon key is refused, and the anon telemetry
# and cron aggregates. Nothing is sent, bought or written.
echo "== 99zzzz. audit-rest held board items: status counted and read-only, upkeep refused, the dead-chain kick, the retired flag (job-board .101, 20261107100000) =="

vdhb_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+:[[:space:]]*//'
}
vdhb_judge() { # $1 fn, $2 date, $3 min
  local h; h=$(vdhb_build "$1")
  if [ -z "$h" ]; then echo "FAIL  $1 preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
  elif build_ge "$1" "$h" "$2" "$3"; then echo "PASS  $1 x-fn-build = $h ($1.$2.$3 or later)"
  else echo "FAIL  $1 x-fn-build = $h, older than $1.$2.$3: this branch's change to it is not serving"; fi
}
vdhb_judge job-board 2026-09-09 101
vdhb_judge agent-mcp 2026-11-03 1
vdhb_judge public-api 2026-11-03 1

vdhb_post() { # $1 json, $2 body file, $3 header file -> prints the HTTP status
  curl -s -m 60 -D "$3" -o "$2" -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$1"
}

# F1, F2: the retired flag, on a list.
VDHB_LIST_CODE=$(vdhb_post '{"action":"list","sendableOnly":true,"limit":25,"includeFacets":false}' /tmp/vd_hb_list.json /tmp/vd_hb_list_h.txt)
# U1: the scheduler's action, without the scheduler's key.
VDHB_UP_CODE=$(vdhb_post '{"action":"upkeep"}' /tmp/vd_hb_upkeep.json /tmp/vd_hb_upkeep_h.txt)

# S1, S2: only a status that computed can show either, and a memo answer says
# its age. A memo lives thirty seconds, so six tries six seconds apart outlast it.
R get_board_anon_hourly '{"p_hours":3}' > /tmp/vd_hb_before.json
VDHB_FRESH=0
VDHB_I=0
while [ "$VDHB_I" -lt 6 ]; do
  VDHB_I=$((VDHB_I + 1))
  VDHB_ST_CODE=$(vdhb_post '{"action":"status"}' /tmp/vd_hb_status.json /tmp/vd_hb_status_h.txt)
  if [ "$VDHB_ST_CODE" = "200" ] && ! tr -d '\r' < /tmp/vd_hb_status_h.txt | grep -qi '^x-status-age-ms:'; then VDHB_FRESH=1; break; fi
  [ "$VDHB_I" -lt 6 ] && sleep 6
done
R get_board_anon_hourly '{"p_hours":3}' > /tmp/vd_hb_after.json
R get_cron_health '{"p_hours":1}' > /tmp/vd_hb_cron.json

VDHB_LIST_CODE="$VDHB_LIST_CODE" VDHB_UP_CODE="$VDHB_UP_CODE" VDHB_ST_CODE="$VDHB_ST_CODE" VDHB_FRESH="$VDHB_FRESH" node -e '
const fs=require("fs");
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const js=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const short=(v)=>JSON.stringify(v??null).slice(0,160);
const E=process.env;

// F1, F2
const list=js("/tmp/vd_hb_list.json");
if(E.VDHB_LIST_CODE!=="200"||!list||!Array.isArray(list.jobs)){ok(false,"a list asking for the retired flag answered HTTP "+E.VDHB_LIST_CODE+" with no jobs array: "+short(list));}
else{
  const ig=Array.isArray(list.ignoredFilters)?list.ignoredFilters:[];
  ok(ig.includes("sendableOnly"),"a list asking for the retired flag has it named in ignoredFilters ("+short(ig)+")");
  const SENDABLE=new Set(["breezy","personio","pinpoint","teamtailor"]);
  const srcs=list.jobs.map((j)=>j&&j.source).filter(Boolean);
  if(srcs.length<10)info("only "+srcs.length+" rows came back, too few to judge whether the flag narrowed them");
  else{const off=srcs.filter((s)=>!SENDABLE.has(s)).length;ok(off>0,off+" of "+srcs.length+" rows on that list come from vendors the flag used to exclude (0 means it still narrows)");}
}

// U1
const up=js("/tmp/vd_hb_upkeep.json");
if(E.VDHB_UP_CODE==="403"&&/scheduler/.test(String(up&&up.error)))ok(true,"upkeep with the publishable key is refused as the scheduler\u0027s action (403)");
else if(E.VDHB_UP_CODE==="400")ok(false,"upkeep answered 400 ("+short(up&&up.error)+"): no build with the action is serving");
else ok(false,"upkeep with the publishable key answered HTTP "+E.VDHB_UP_CODE+": "+short(up)+" (want 403, and a 200 means anyone can run it)");

// S1, S2
const st=js("/tmp/vd_hb_status.json");
if(E.VDHB_FRESH!=="1"){info("no status computed in six tries (each answered from a memo, or HTTP "+E.VDHB_ST_CODE+"): readOnly and the count cannot be judged on this run");}
else{
  const wd=st&&st.chainWatchdog;
  if(!wd)info("status computed with no chainWatchdog (the watchdog read failed, which it survives): readOnly cannot be judged");
  else ok(wd.readOnly===true&&wd.kicked===false,"a status computed for the publishable key reports chainWatchdog readOnly and kicked false (decision "+wd.decision+", readOnly "+wd.readOnly+", kicked "+wd.kicked+")");
  const tot=(rows)=>(Array.isArray(rows)?rows:[]).filter((r)=>r.bh_kind==="probe"&&r.bh_country==="ALL").reduce((n,r)=>n+Number(r.bh_requests||0),0);
  const before=js("/tmp/vd_hb_before.json"),after=js("/tmp/vd_hb_after.json");
  if(!Array.isArray(before)||!Array.isArray(after))info("get_board_anon_hourly unreadable: whether a status is counted cannot be judged here ("+short(after)+")");
  else{const d=tot(after)-tot(before);if(d<1)ok(false,"the meter\u0027s probe count grew by "+d+" across a computed status (want at least 1: status is counted)");else info("the meter\u0027s probe count grew by "+d+" across a computed status: the count is shared with every other probe, so this alone shows nothing (S1 and B1 judge the build, and anonymous-budget tests prove a status is counted)");}
}

// C1
const KICK="job-board-dead-chain-kick";
const cron=js("/tmp/vd_hb_cron.json");
if(!Array.isArray(cron)||cron.length===0)info("get_cron_health unreadable or empty: the schedule cannot be read here");
else{
  const job=cron.find((r)=>r.ch_jobname===KICK);
  if(!job)ok(false,"no cron job is named "+KICK+": migration 20261107100000 has not run, so a dead chain waits for the :x4/:x9 crons (3-8 min)");
  else{
    const runs=Number(job.ch_runs||0),wrong=[];
    if(job.ch_active!==true)wrong.push("it is not active");
    if(job.ch_schedule!=="* * * * *")wrong.push("it is not scheduled every minute");
    if(!(runs>=1))wrong.push("it has not run in the last hour");
    else if(job.ch_last_status!=="succeeded")wrong.push("its last run "+job.ch_last_status+" ("+Number(job.ch_failed||0)+" of "+runs+" failed)");
    ok(!wrong.length,KICK+" is scheduled "+job.ch_schedule+", active "+job.ch_active+", "+runs+" run(s) in the last hour, the last "+job.ch_last_status+(wrong.length?": "+wrong.join("; "):""));
  }
}

// C2
if(!st||typeof st!=="object"||!("catalogSize" in st))info("no status body to read the chain\u0027s pulse from ("+short(st)+")");
else if(st.ingestPaused===true)info("ingest is paused (status.ingestPaused), so no kick is due and the chain\u0027s pulse is not judged");
else{
  const wd=st.chainWatchdog;
  const age=wd&&typeof wd.pulseAgeMs==="number"?wd.pulseAgeMs:null,th=wd&&typeof wd.thresholdMs==="number"?wd.thresholdMs:null;
  if(age===null||th===null)info("status reports no chainWatchdog pulseAgeMs and thresholdMs ("+short(wd)+"): the chain\u0027s pulse cannot be judged here");
  else{
    const bound=th+120000,s=(ms)=>Math.round(ms/1000);
    if(age<=bound)ok(true,"the chain\u0027s freshest pulse is "+s(age)+" s old, inside the dead-chain kick\u0027s bound of "+s(bound)+" s (the watchdog\u0027s threshold "+s(th)+" s plus 120 s; decision "+wd.decision+")");
    else ok(false,"the chain is silent "+s(age-bound)+" s past the dead-chain kick\u0027s bound: its freshest pulse is "+s(age)+" s old against "+s(th)+" s plus 120 s (decision "+wd.decision+"), so no kick restarted it");
  }
}
const bu=st&&typeof st==="object"?st.boardUpkeep:undefined;
info("upkeep has no scheduled caller by decision (20261103221000 neverApply); boardUpkeep "+(bu===undefined?"not in the status read":bu===null?"null":typeof bu.ageMin==="number"?"last ran "+bu.ageMin+" min ago":short(bu)));

info("S13-104 is proved in the suite (a-search-asked-not-to-be-logged-reaches-no-log-line-on-any-path.test.ts), since function logs are not readable from here");
info("S13-040 is proved in the suite (a-refused-allowance-note-gives-its-claim-back.test.ts): a claim stands only for a note notify-owner says it mailed");
info("S13-118 stored searches: migration 20261103220000 refuses to finish while any row carries the key, and the rows are private, so its run is the proof (a-search-saved-with-the-retired-agent-filter-reads-the-whole-board.test.ts)");
'
