# shellcheck shell=bash
# ── 92. WAVE 4 FIX ROUND 3, CORPUS-FIRST: the three rules two rounds of fixes
# and two rechecks went around, read live after they deploy (branch w4b-fix
# onto wave4/integration; docs/wave4/README.md "Fix round 3: corpus-first").
#
# THE CLAIMS, one line each below:
#   - the five functions that bundle round 3's question rule serve
#     2026-10-11.32 or later: agent-mcp, public-api,
#     generate-application-answers, generate-apply-package and apply-agent
#     (switched off). No read-only route classifies a label of our choosing,
#     so the rule's behaviour is proved by its 1,536-row corpus test, not here;
#   - job-board (it keeps 2026-09-09.93), judged only once the wave 4 board
#     code serves (the offset tell section 92 job-board reads):
#     "nurse not night shift, TX" excludes ["night shift"] (origin/main and
#     round 2 excluded "night"), "nurse not travel er" excludes ["travel"]
#     (round 2 took "travel er") and "warehouse not forklift San Jose" excludes
#     ["forklift"] (round 2 took "forklift san"); only round 3 answers all three;
#   - the salary re-sweep (SALARY_PARSE_VERSION 11), on four live postings read
#     through the detail action: the Airbus placement (S12-019), whose stored
#     figure is the facility's business revenue, has no salary; Bbinsurance,
#     whose stored figure is a book of business, has its stated hourly pay; and
#     two stated pays beside business words (Paylocity, KIPP) keep their pay.
#     A posting still showing its old business figure is INFO (the re-sweep has
#     not reached it yet); a stated pay that turns null or into another figure
#     is a FAIL; a posting that is gone is INFO.
#
# READ-ONLY. Five OPTIONS preflights and eight job-board reads on the probe
# budget (one offset read, three list reads, four detail reads).
echo "== 92. w4b fix round 3 (corpus-first): builds, the negation, the salary re-sweep =="

for VD92T_FN in agent-mcp public-api generate-application-answers generate-apply-package apply-agent; do
  VD92T_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD92T_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD92T_H" ]; then echo "FAIL  $VD92T_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$VD92T_FN" "$VD92T_H" "2026-10-11" "32"; then echo "PASS  $VD92T_FN x-fn-build = $VD92T_H ($VD92T_FN.2026-10-11.32 or later: round 3's question rule)"
  else echo "FAIL  $VD92T_FN x-fn-build = $VD92T_H (want $VD92T_FN.2026-10-11.32 or later: round 3's question rule is not serving)"; fi
done
echo "INFO  the question rule's behaviour is proved by src/test/w4b-fix3-questions-corpus.test.ts (1,536 labelled rows), not live: no read-only route classifies a label we choose"

# The wave 4 board code's tell (S12-122), as section 92 job-board reads it.
VD92T_OFF=$(curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","q":"nurse","offset":10001,"limit":1}')
J '{"action":"list","q":"nurse not night shift, TX","limit":5}' > /tmp/vd_92t_tx.json
J '{"action":"list","q":"nurse not travel er","limit":5}' > /tmp/vd_92t_er.json
J '{"action":"list","q":"warehouse not forklift San Jose","limit":5}' > /tmp/vd_92t_sj.json
VD92T_OFF="$VD92T_OFF" node -e '
const fs=require("fs");const live=process.env.VD92T_OFF==="400";
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))||{}}catch{return {}}};
const ok=(c,m)=>console.log((live?(c?"PASS":"FAIL"):"INFO")+"  "+m+(live?"":" (not judged: the wave 4 board code is not serving)"));
for(const [f,q,want,why] of [
  ["/tmp/vd_92t_tx.json","nurse not night shift, TX",["night shift"],"the pinned compound is excluded whole and TX stays in the search"],
  ["/tmp/vd_92t_er.json","nurse not travel er",["travel"],"one negated word: the ER nurse stays wanted"],
  ["/tmp/vd_92t_sj.json","warehouse not forklift San Jose",["forklift"],"a city the place list misses stays in the search"],
]){const d=rd(f);ok(JSON.stringify(d.excludedTerms||[])===JSON.stringify(want),"q \""+q+"\" excludes "+JSON.stringify(d.excludedTerms||null)+" (want "+JSON.stringify(want)+": "+why+")");}'

# The v11 re-sweep, on four postings the salary corpus read live on 2026-10-24.
J '{"action":"detail","id":"workday:ag~wd3~Airbus:JR10428421"}' > /tmp/vd_92t_airbus.json
J '{"action":"detail","id":"workday:bbinsurance~wd1~Careers:0000003072"}' > /tmp/vd_92t_bb.json
J '{"action":"detail","id":"paylocity:8a6852cc-82d6-47e2-9e95-214ed5a77edf:4257268"}' > /tmp/vd_92t_pl.json
J '{"action":"detail","id":"smartrecruiters:KIPP:744000153836599"}' > /tmp/vd_92t_kipp.json
node -e '
const fs=require("fs");
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))||{}}catch{return {}}};
for(const [f,who,old,want] of [
  ["/tmp/vd_92t_airbus.json","Airbus placement (S12-019)","£350K to £800K annually",null],
  ["/tmp/vd_92t_bb.json","Bbinsurance account manager","$500,000 - $1,000,000","$50.00 - $53.00 Hourly"],
  ["/tmp/vd_92t_pl.json","Paylocity advisor (stated base salary)","$225,000 to $275,000","$225,000 to $275,000"],
  ["/tmp/vd_92t_kipp.json","KIPP leader (stated salary)","$300,000 - $350,000","$300,000 - $350,000"],
]){
  const d=rd(f);const j=d.job;
  if(!j||typeof j!=="object"){console.log("INFO  "+who+": no posting row to read ("+String(d.error||(d.closed?"closed":"gone")).slice(0,60)+"); not judged");continue;}
  const s=j.salary??null;const show=JSON.stringify(s);
  if(s===want)console.log("PASS  "+who+" salary "+show+(want===null?" (the business figure left the pay sort)":old===want?" (a stated pay beside business words keeps its pay)":" (the re-sweep took the stated pay, not the business figure)"));
  else if(s===old)console.log("INFO  "+who+" salary "+show+" is the old business figure: the v11 re-sweep has not reached it yet (owner: backfill-salary logs \"salary backfill complete ... (v11)\" when it is done; run again then)");
  else console.log("FAIL  "+who+" salary "+show+" (want "+JSON.stringify(want)+(want===null?", or the old figure until the re-sweep reaches it":": a stated pay must never be NULLed or replaced")+")");
}'
