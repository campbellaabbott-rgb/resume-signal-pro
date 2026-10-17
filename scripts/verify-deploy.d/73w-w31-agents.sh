# shellcheck shell=bash
# ── 73w. WAVE 3, ROUND S11, AGENTS (branch w31/agents, builds 2026-10-09.24 and
# 2026-10-10.24). Sourced by scripts/verify-deploy.sh; J R MC probe build_ge
# $B $K $SITE $UA are in scope. Deploy note: docs/wave3/agents-api.md, "Round
# S11".
#
# THE CLAIMS:
#   - nine functions serve this round's builds (agent-access and
#     generate-application-answers on 2026-10-10.24, the rest 2026-10-09.24;
#     the integration carries four of them later: generate-application-answers
#     2026-10-10.62, send-search-digest 2026-10-09.25, and agent-mcp and
#     apply-agent 2026-10-09.71, the review round's sponsorship, country,
#     refusal and scorer-copy fixes);
#   - the morning shortlist's old unsubscribe link changes nothing on a GET and
#     redirects to the confirm page (S11-132): a made-up id and token are
#     enough, because the GET never reads them;
#   - request_application's description states the pass rule (S11-039) and
#     fit_resume's names the Agent plan (S11-121): tools/list is free;
#   - agent_packet_decide and agent_mark_uncertain stay closed to anon
#     (20261009124000, 20261009124100). What they do is proved in pglite
#     (an-unconfirmed-send-a-failed-send-and-an-approval-below-the-floor).
#
# READ-ONLY. OPTIONS preflights run no function logic; the unsubscribe GET
# writes nothing (that is the claim); tools/list is unmetered; the probes are
# GETs, which PostgREST runs read-only.
echo "== 73w. wave 3 round S11 agents: builds, the shortlist's unsubscribe, the pass rule in the tool text =="

for PAIR in "agent-mcp|2026-10-09|71" "apply-agent|2026-10-09|71" "apply-broker|2026-10-09|24" "agent-access|2026-10-10|24" \
            "generate-application-answers|2026-10-10|62" "send-agent-digest|2026-10-09|24" "send-search-digest|2026-10-09|25" \
            "send-market-pulse|2026-10-09|24" "send-scan-report|2026-10-09|24"; do
  W73W_FN=${PAIR%%|*}; W73W_REST=${PAIR#*|}; W73W_D=${W73W_REST%%|*}; W73W_N=${W73W_REST#*|}
  W73W_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$W73W_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$W73W_H" ]; then echo "FAIL  $W73W_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$W73W_FN" "$W73W_H" "$W73W_D" "$W73W_N"; then echo "PASS  $W73W_FN preflight x-fn-build = $W73W_H ($W73W_FN.$W73W_D.$W73W_N or later)"
  else echo "FAIL  $W73W_FN preflight x-fn-build = $W73W_H (want $W73W_FN.$W73W_D.$W73W_N or later: the previous bundle is still serving)"; fi
done

W73W_LOC=$(curl -s -m 30 -D - -o /dev/null "$B/functions/v1/send-agent-digest?action=unsubscribe&id=00000000-0000-4000-8000-000000000000&token=00000000000000000000000000000000" -H "apikey: $K" | tr -d '\r')
W73W_STATUS=$(printf '%s' "$W73W_LOC" | head -1 | awk '{print $2}')
W73W_TO=$(printf '%s' "$W73W_LOC" | grep -i '^location:' | head -1 | sed -E 's/^[^:]+: *//')
case "$W73W_TO" in
  https://resumebooster.work/email/unsubscribe#list=agent-digest*) echo "PASS  send-agent-digest unsubscribe GET -> $W73W_STATUS to the confirm page (a GET changes nothing)";;
  *) echo "FAIL  send-agent-digest unsubscribe GET -> $W73W_STATUS ${W73W_TO:-no Location} (want 303 to /email/unsubscribe#list=agent-digest: the old bundle unsubscribes on a GET)";;
esac

MC -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' > /tmp/vd_73w_tools.json
node -e '
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
let j=null;try{j=JSON.parse(require("fs").readFileSync("/tmp/vd_73w_tools.json","utf8"))}catch{}
const tools=(j&&j.result&&j.result.tools)||[];
if(!tools.length){console.log("FAIL  agent-mcp tools/list answered no tools");process.exit(0)}
const d=(n)=>String((tools.find((t)=>t.name===n)||{}).description||"");
ok(/On a pass, only a job the agent can submit itself/.test(d("request_application")),"request_application states the pass rule (S11-039)");
ok(/the Agent plan on the key.s account/.test(d("fit_resume")),"fit_resume names the Agent plan (S11-121)");'

probe agent_packet_decide '{"p_user_id":"00000000-0000-4000-8000-000000000000","p_submission_id":0,"p_decision":"retry"}'
probe agent_mark_uncertain '{"p_id":0,"p_reason":"verify-deploy"}'
