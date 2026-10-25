# shellcheck shell=bash
# ── 92. WAVE 4 FIX ROUNDS 3 AND 4, CORPUS-FIRST: the question rule's builds,
# and the negation (origin/main's again since the descope), read live after
# they deploy (branch w4b-fix onto wave4/integration;
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
#     code serves (the offset tell section 92 job-board reads): the search
#     exclusion answers exactly as origin/main's does. Rounds 3 and 4 changed
#     how far "not" reaches and the descope of 2026-10-25 put main's rule
#     back, byte for byte (S12-017 is its own search project), so eight
#     negations must give main's excludedTerms: "nurse not night shift, TX"
#     ["night"], "nurse not travel er" ["travel"], "warehouse not forklift
#     San Jose" ["forklift"], "nurse not south florida" ["south"], "nurse not
#     travel or agency" ["travel"], "barista not part-time" ["parttime"],
#     "clerk not a/p" ["ap"] and "cashier not part time" ["part"]. An answer
#     from round 3, round 4 or the first descope (a compound or place taken
#     whole, both words of "A or B", a typed hyphen kept, a slash pair split or
#     dropped) reads FAIL.
#
# READ-ONLY. Five OPTIONS preflights and nine job-board reads on the probe
# budget (one offset read, eight list reads).
echo "== 92. w4b fix rounds 3 and 4 (corpus-first): builds, and the negation is origin/main's =="

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
J '{"action":"list","q":"clerk not a/p","limit":5}' > /tmp/vd_92t_ap.json
J '{"action":"list","q":"cashier not part time","limit":5}' > /tmp/vd_92t_sp.json
VD92T_OFF="$VD92T_OFF" node -e '
const fs=require("fs");const live=process.env.VD92T_OFF==="400";
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))||{}}catch{return {}}};
const ok=(c,m)=>console.log((live?(c?"PASS":"FAIL"):"INFO")+"  "+m+(live?"":" (not judged: the wave 4 board code is not serving)"));
for(const [f,q,want,why] of [
  ["/tmp/vd_92t_tx.json","nurse not night shift, TX",["night"],"one word after not; the compound rule left wave 4"],
  ["/tmp/vd_92t_er.json","nurse not travel er",["travel"],"one word after not: the ER nurse stays wanted"],
  ["/tmp/vd_92t_sj.json","warehouse not forklift San Jose",["forklift"],"one word after not: San Jose stays in the search"],
  ["/tmp/vd_92t_sf.json","nurse not south florida",["south"],"one word after not; the pinned-region rule left wave 4"],
  ["/tmp/vd_92t_or.json","nurse not travel or agency",["travel"],"one word after not; the A-or-B rule left wave 4"],
  ["/tmp/vd_92t_pt.json","barista not part-time",["parttime"],"the hyphen folded away, as main does"],
  ["/tmp/vd_92t_ap.json","clerk not a/p",["ap"],"a slash pair joined, as main does"],
  ["/tmp/vd_92t_sp.json","cashier not part time",["part"],"one word after not, so every Part-Time spelling is struck"],
]){const d=rd(f);ok(JSON.stringify(d.excludedTerms||[])===JSON.stringify(want),"q \""+q+"\" excludes "+JSON.stringify(d.excludedTerms||null)+" (want origin/main\x27s "+JSON.stringify(want)+": "+why+")");}'
