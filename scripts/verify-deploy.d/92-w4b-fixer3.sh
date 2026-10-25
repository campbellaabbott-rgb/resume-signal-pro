# shellcheck shell=bash
# ── 92. WAVE 4 FIX ROUNDS 3 AND 4, CORPUS-FIRST: the question rule and the
# negation, read live after they deploy (branch w4b-fix onto wave4/integration;
# docs/wave4/README.md "Fix round 3", "Fix round 4" and "Descope 2026-10-25").
# The salary rule was the third; it left wave 4 on 2026-10-25 (the miner is
# main's again and SALARY_PARSE_VERSION stays 10), so nothing here reads pay.
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
#     ["part-time"] (main and round 3's "parttime" strikes no title). The
#     title match is main's exact one, so "part-time" strikes a title spelled
#     Part-Time and keeps one spelled Part Time: a residual, main's defect.
#
# READ-ONLY. Five OPTIONS preflights and seven job-board reads on the probe
# budget (one offset read, six list reads).
echo "== 92. w4b fix rounds 3 and 4 (corpus-first): builds and the negation =="

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
  ["/tmp/vd_92t_pt.json","barista not part-time",["part-time"],"the hyphenated word as typed: it strikes Part-Time titles, not Part Time ones"],
]){const d=rd(f);ok(JSON.stringify(d.excludedTerms||[])===JSON.stringify(want),"q \""+q+"\" excludes "+JSON.stringify(d.excludedTerms||null)+" (want "+JSON.stringify(want)+": "+why+")");}'
