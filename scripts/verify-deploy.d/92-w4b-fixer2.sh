# shellcheck shell=bash
# ── 92. WAVE 4 ROUND 2, THE FIXER AFTER THE RECHECK: the recheck's findings on
# the review's fixes (branch w4b-fix onto wave4/integration; docs/wave4/README.md
# "Fixes after the recheck").
#
# THE CLAIMS, one line each below:
#   - every function the recheck's fixes changed serves 2026-10-11.31 or later:
#     generate-career-path (a confirmed past buyer is remembered), and the five
#     that bundle the widened classifier (agent-mcp, public-api,
#     generate-application-answers, generate-apply-package, apply-agent);
#   - career_path_past_buyers (20261011213000) is closed to the anon key;
#   - job-board (it keeps 2026-09-09.93): "warehouse not forklift Dallas"
#     excludes only "forklift" and keeps Dallas in the search (judged only once
#     the round-2 board code serves, by the same offset tell section 92
#     job-board reads).
# INFO only: 20261011212000 (account deletion takes the Full Analysis) is
# proved by its own self-check; the owner's read is printed. The salary rule
# left wave 4 on 2026-10-25 (the miner is main's), so nothing here reads it.
#
# READ-ONLY. OPTIONS preflights, one anon table read that must be refused, and
# one job-board list read on the probe budget.
echo "== 92. w4b fixer after the recheck: by build and by behaviour =="

for VD92R_FN in generate-career-path agent-mcp public-api generate-application-answers generate-apply-package apply-agent; do
  VD92R_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD92R_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD92R_H" ]; then echo "FAIL  $VD92R_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$VD92R_FN" "$VD92R_H" "2026-10-11" "31"; then echo "PASS  $VD92R_FN x-fn-build = $VD92R_H ($VD92R_FN.2026-10-11.31 or later: the recheck's fixes)"
  else echo "FAIL  $VD92R_FN x-fn-build = $VD92R_H (want $VD92R_FN.2026-10-11.31 or later: the recheck's fixes are not serving)"; fi
done

VD92R_PBC=$(curl -s -m 30 -o /tmp/vd_92r_pb.json -w '%{http_code}' "$B/rest/v1/career_path_past_buyers?select=stripe_session_id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$VD92R_PBC" in
  401|403) echo "PASS  career_path_past_buyers as anon -> $VD92R_PBC (closed)";;
  404) echo "INFO  career_path_past_buyers -> 404 (20261011213000 not applied yet)";;
  *) echo "FAIL  career_path_past_buyers as anon -> $VD92R_PBC $(head -c 120 /tmp/vd_92r_pb.json 2>/dev/null) (want 401 or 403)";;
esac

# The round-2 board code's tell (S12-122), as section 92 job-board reads it.
VD92R_OFF=$(curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","q":"nurse","offset":10001,"limit":1}')
J '{"action":"list","q":"warehouse not forklift Dallas","limit":20}' > /tmp/vd_92r_dallas.json
VD92R_OFF="$VD92R_OFF" node -e '
const fs=require("fs");const r2=process.env.VD92R_OFF==="400";
const ok=(c,m)=>console.log((r2?(c?"PASS":"FAIL"):"INFO")+"  "+m+(r2?"":" (not judged: the round-2 board code is not serving)"));
let d={};try{d=JSON.parse(fs.readFileSync("/tmp/vd_92r_dallas.json","utf8"))||{}}catch{}
ok(JSON.stringify(d.excludedTerms||[])==="[\"forklift\"]","q \"warehouse not forklift Dallas\" excludes "+JSON.stringify(d.excludedTerms||null)+" (want [\"forklift\"]: Dallas stays in the search)");'

echo "INFO  owner, service role: SELECT prosrc LIKE '\''%public.resume_analyses%'\'' FROM pg_proc WHERE proname = '\''account_erase_personal_data'\'' must be true (20261011212000); SELECT relrowsecurity FROM pg_class WHERE relname = '\''career_path_past_buyers'\'' must be true (20261011213000)"
