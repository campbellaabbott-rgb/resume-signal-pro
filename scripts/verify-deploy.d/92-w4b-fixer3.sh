# shellcheck shell=bash
# ── 92. WAVE 4 FIX ROUNDS 3 AND 4, CORPUS-FIRST: the three rules three rounds
# of fixes and three rechecks went around, read live after they deploy (branch
# w4b-fix onto wave4/integration; docs/wave4/README.md "Fix round 3" and "Fix
# round 4").
#
# THE CLAIMS, one line each below:
#   - the five functions that bundle round 4's question rule serve
#     2026-10-11.33 or later: agent-mcp, public-api,
#     generate-application-answers, generate-apply-package and apply-agent
#     (switched off). No read-only route classifies a label of our choosing,
#     so the rule's behaviour is proved by its 2,385-row corpus test, not here;
#   - job-board (it keeps 2026-09-09.93), judged only once the wave 4 board
#     code serves (the offset tell section 92 job-board reads):
#     "nurse not night shift, TX" excludes ["night shift"] (origin/main and
#     round 2 excluded "night"), "nurse not travel er" excludes ["travel"]
#     (round 2 took "travel er") and "warehouse not forklift San Jose" excludes
#     ["forklift"] (round 2 took "forklift san"); and round 4's: "nurse not
#     south florida" excludes ["south florida"] (main and round 3 took
#     "south"), "nurse not travel or agency" excludes ["travel","agency"] (main
#     and round 3 searched "or agency") and "barista not part-time" excludes
#     ["part-time"] (main and round 3's "parttime" strikes no title);
#   - the salary re-sweep (SALARY_PARSE_VERSION 11), on five live postings read
#     through the detail action. It rewrites a stored business figure only to
#     the pay stated after it and never writes NULL (recheck 3: round 3's
#     NULLed Philips's stated pay): Bbinsurance, whose stored figure is a book
#     of business, has its stated hourly pay; the Airbus placement (S12-019),
#     whose text states no pay after its business figure, keeps that figure
#     (new postings no longer take one); the Philips pay-transparency template
#     ("Target Earning potential is $200,000 to $250,000 annually") and two
#     stated pays beside business words (Paylocity, KIPP) keep their pay.
#     Bbinsurance still showing its old figure is INFO (not reached yet); a
#     salary that turns null, or a stated pay that turns into another figure,
#     is a FAIL; a posting that is gone is INFO.
#
# READ-ONLY. Five OPTIONS preflights and twelve job-board reads on the probe
# budget (one offset read, six list reads, five detail reads).
echo "== 92. w4b fix rounds 3 and 4 (corpus-first): builds, the negation, the salary re-sweep =="

for VD92T_FN in agent-mcp public-api generate-application-answers generate-apply-package apply-agent; do
  VD92T_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD92T_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD92T_H" ]; then echo "FAIL  $VD92T_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$VD92T_FN" "$VD92T_H" "2026-10-11" "33"; then echo "PASS  $VD92T_FN x-fn-build = $VD92T_H ($VD92T_FN.2026-10-11.33 or later: round 4's question rule)"
  else echo "FAIL  $VD92T_FN x-fn-build = $VD92T_H (want $VD92T_FN.2026-10-11.33 or later: round 4's question rule is not serving)"; fi
done
echo "INFO  the question rule's behaviour is proved by src/test/w4b-fix3-questions-corpus.test.ts (2,385 labelled rows), not live: no read-only route classifies a label we choose"

# The wave 4 board code's tell (S12-122), as section 92 job-board reads it.
VD92T_OFF=$(curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","q":"nurse","offset":10001,"limit":1}')
J '{"action":"list","q":"nurse not night shift, TX","limit":5}' > /tmp/vd_92t_tx.json
J '{"action":"list","q":"nurse not travel er","limit":5}' > /tmp/vd_92t_er.json
J '{"action":"list","q":"warehouse not forklift San Jose","limit":5}' > /tmp/vd_92t_sj.json
J '{"action":"list","q":"nurse not south florida","limit":5}' > /tmp/vd_92t_sf.json
J '{"action":"list","q":"nurse not travel or agency","limit":5}' > /tmp/vd_92t_or.json
J '{"action":"list","q":"barista not part-time","limit":5}' > /tmp/vd_92t_pt.json
VD92T_OFF="$VD92T_OFF" node -e '
const fs=require("fs");const live=process.env.VD92T_OFF==="400";
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))||{}}catch{return {}}};
const ok=(c,m)=>console.log((live?(c?"PASS":"FAIL"):"INFO")+"  "+m+(live?"":" (not judged: the wave 4 board code is not serving)"));
for(const [f,q,want,why] of [
  ["/tmp/vd_92t_tx.json","nurse not night shift, TX",["night shift"],"the pinned compound is excluded whole and TX stays in the search"],
  ["/tmp/vd_92t_er.json","nurse not travel er",["travel"],"one negated word: the ER nurse stays wanted"],
  ["/tmp/vd_92t_sj.json","warehouse not forklift San Jose",["forklift"],"a city the place list misses stays in the search"],
  ["/tmp/vd_92t_sf.json","nurse not south florida",["south florida"],"a negated region is one exclusion"],
  ["/tmp/vd_92t_or.json","nurse not travel or agency",["travel","agency"],"not A or B negates both"],
  ["/tmp/vd_92t_pt.json","barista not part-time",["part-time"],"the hyphenated word as typed, which strikes Part-Time titles"],
]){const d=rd(f);ok(JSON.stringify(d.excludedTerms||[])===JSON.stringify(want),"q \""+q+"\" excludes "+JSON.stringify(d.excludedTerms||null)+" (want "+JSON.stringify(want)+": "+why+")");}'

# The v11 re-sweep, on five postings the salary corpora read live on 2026-10-24.
J '{"action":"detail","id":"workday:ag~wd3~Airbus:JR10428421"}' > /tmp/vd_92t_airbus.json
J '{"action":"detail","id":"workday:bbinsurance~wd1~Careers:0000003072"}' > /tmp/vd_92t_bb.json
J '{"action":"detail","id":"paylocity:8a6852cc-82d6-47e2-9e95-214ed5a77edf:4257268"}' > /tmp/vd_92t_pl.json
J '{"action":"detail","id":"smartrecruiters:KIPP:744000153836599"}' > /tmp/vd_92t_kipp.json
J '{"action":"detail","id":"workday:philips~wd3~jobs-and-careers:593574-1"}' > /tmp/vd_92t_ph.json
node -e '
const fs=require("fs");
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))||{}}catch{return {}}};
for(const [f,who,old,want] of [
  ["/tmp/vd_92t_airbus.json","Airbus placement (S12-019)","£350K to £800K annually","£350K to £800K annually"],
  ["/tmp/vd_92t_bb.json","Bbinsurance account manager","$500,000 - $1,000,000","$50.00 - $53.00 Hourly"],
  ["/tmp/vd_92t_pl.json","Paylocity advisor (stated base salary)","$225,000 to $275,000","$225,000 to $275,000"],
  ["/tmp/vd_92t_kipp.json","KIPP leader (stated salary)","$300,000 - $350,000","$300,000 - $350,000"],
  ["/tmp/vd_92t_ph.json","Philips account manager (Target Earning potential)","$200,000 to $250,000 annually","$200,000 to $250,000 annually"],
]){
  const d=rd(f);const j=d.job;
  if(!j||typeof j!=="object"){console.log("INFO  "+who+": no posting row to read ("+String(d.error||(d.closed?"closed":"gone")).slice(0,60)+"); not judged");continue;}
  const s=j.salary??null;const show=JSON.stringify(s);
  if(s===want)console.log("PASS  "+who+" salary "+show+(old!==want?" (the re-sweep took the stated pay, not the business figure)":who.startsWith("Airbus")?" (no stated pay follows the business figure, and the re-sweep never writes NULL)":" (a stated pay beside business words keeps its pay)"));
  else if(s===old)console.log("INFO  "+who+" salary "+show+" is the old business figure: the v11 re-sweep has not reached it yet (owner: backfill-salary logs \"salary backfill complete ... (v11)\" when it is done; run again then)");
  else console.log("FAIL  "+who+" salary "+show+" (want "+JSON.stringify(want)+(s===null?": the re-sweep must never write NULL":": a stored salary must never be replaced by another figure")+")");
}'
