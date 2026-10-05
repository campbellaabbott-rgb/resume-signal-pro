# shellcheck shell=bash
# ── 45. THE AGENT AND THE DATA API, 2026-10-05 (platform debug sweep, agents-api).
# agent-access answers only the signed-in caller (2.09) and knows the pass
# (L3-02); agent-connect's mint is bounded (api_key_issue_agent, 20261005130000);
# the mandate's address is the account's (1.07); the claim reads the pause, the
# blocklist and funding, an owner can approve or stop a packet, the queue read
# skips prepared rows, the cooldown counts what is on its way, the wake counts
# claimable work (20261005133000); MCP answers the guide to every caller and
# resources/templates/list; /v1 refuses fractional limits and unparseable
# salaries and dates, and its quota Retry-After runs to midnight UTC.
#
# READ-ONLY. OPTIONS preflights run no function logic. agent-access is called
# with the publishable key only, so it refuses at the session check before any
# read. The MCP probes are the free listing and the free guide (with a made-up
# key, which the guide must not even look at). The RPC probes below are, even
# if a revoke had NOT landed, either pure readers or argument refusals that
# return before any statement writes (null user, row id 0); the claim, which
# parks packets, is never called. /v1 probes need RB_API_KEY and cost one call
# of our own key's quota each.
echo "== 45. the agent and the data API: who agent-access answers, bounded keys, the claim's gates (20261005130000, 20261005133000) =="

vd45_build_ok() { # $1 fn, $2 header value, $3 minimum date part (YYYY-MM-DD)
  case "$2" in "$1".20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].*) ;; *) return 1;; esac
  local d="${2#"$1".}"; d="${d%%.*}"
  [ "$d" = "$3" ] || [ "$d" \> "$3" ]
}
for FN in agent-access agent-connect agent-pass-status apply-agent apply-broker agent-runner public-api agent-mcp; do
  H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (the previous bundle is still serving)"
  elif vd45_build_ok "$FN" "$H" "2026-10-05"; then echo "PASS  $FN preflight x-fn-build = $H (2026-10-05 or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-10-05.N or later)"; fi
done

# 2.09: no answer about an address in a body. The old function answered 200
# {active,status,currentPeriodEnd,stripeCustomerId} to anyone.
AA=$(curl -s -m 30 -w '\n%{http_code}' -X POST "$B/functions/v1/agent-access" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"email":"verify-probe@example.invalid"}')
AA_CODE=$(printf '%s' "$AA" | tail -1); AA_BODY=$(printf '%s' "$AA" | sed '$d')
if [ "$AA_CODE" = "401" ] && ! printf '%s' "$AA_BODY" | grep -q 'stripeCustomerId\|currentPeriodEnd'; then
  echo "PASS  agent-access with no session -> 401, and no subscription fields for the address in the body"
else
  echo "FAIL  agent-access with no session -> $AA_CODE $(printf '%s' "$AA_BODY" | head -c 160) (want 401 signed_out; 200 means the email oracle is still serving)"
fi

# L9-16 and L9-08: the listing a strict client asks for, and the guide for a
# caller holding a key the server does not know.
TL=$(MC -d '{"jsonrpc":"2.0","id":1,"method":"resources/templates/list"}')
if printf '%s' "$TL" | grep -q '"resourceTemplates":\[\]'; then echo "PASS  resources/templates/list -> an empty list"
else echo "FAIL  resources/templates/list -> $(printf '%s' "$TL" | head -c 160) (want {resourceTemplates: []})"; fi
GD=$(MC -H "Authorization: Bearer rb_live_0000000000000000000000000000000000000000000000000000000000000000" -d '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"resumebooster://guide"}}')
if printf '%s' "$GD" | grep -q '"contents"'; then echo "PASS  the guide answers a caller holding an unknown key (free, before the credential)"
else echo "FAIL  the guide with an unknown key -> $(printf '%s' "$GD" | head -c 160) (want contents; 'not recognised' = the old order)"; fi

# The new definers are service-role only. Each call below is harmless even if
# a revoke had not landed (see the head of this file).
probe agent_packet_decide '{"p_user_id":null,"p_submission_id":null,"p_decision":"verify"}'
probe agent_queue_refuse '{"p_row_id":0,"p_reason":"verify-probe"}'
probe agent_unclaim_submission '{"p_submission_id":0}'
probe agent_queue_unprepared '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_statuses":[],"p_pass_only":false,"p_limit":1}'
probe api_key_issue_agent '{"p_user_id":null,"p_email":"","p_key_hash":"","p_key_prefix":""}'
MT=$(curl -s -m 30 -w '\n%{http_code}' "$B/rest/v1/api_key_agent_mints?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
MT_CODE=$(printf '%s' "$MT" | tail -1)
case "$MT_CODE" in
  401|403) echo "PASS  api_key_agent_mints as anon -> $MT_CODE (closed)";;
  404) echo "INFO  api_key_agent_mints -> 404 (20261005130000 not applied yet)";;
  *) echo "FAIL  api_key_agent_mints as anon -> $MT_CODE $(printf '%s' "$MT" | sed '$d' | head -c 120)";;
esac

if [ -z "$RB" ]; then
  echo "INFO  RB_API_KEY missing from .env.local -- the keyed /v1 parameter probes are skipped"
else
  for Q in "jobs?limit=1.5" "jobs?salary_min=100k" "jobs?posted_after=last-week" "changes?since=$(date -u -v-1d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '1 day ago' +%Y-%m-%dT00:00:00Z)&limit=1.5" "companies?limit=2.5"; do
    VC=$(curl -s -m 40 -o /tmp/vd_45_v1.json -w '%{http_code}' "$B/functions/v1/public-api/v1/$Q" -H "Authorization: Bearer $RB" -H "apikey: $K")
    if [ "$VC" = "400" ] && grep -q '"invalid_value"' /tmp/vd_45_v1.json; then echo "PASS  /v1/$Q -> 400 invalid_value"
    else echo "FAIL  /v1/$Q -> $VC $(head -c 160 /tmp/vd_45_v1.json) (want 400 invalid_value)"; fi
  done
  # The count-ordered walk's cursor carries the order it began in.
  curl -s -m 40 -o /tmp/vd_45_co.json "$B/functions/v1/public-api/v1/companies?limit=3" -H "Authorization: Bearer $RB" -H "apikey: $K"
  node -e '
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
let j=null;try{j=require("/tmp/vd_45_co.json")}catch{}
const cur=j&&j.page&&j.page.nextCursor;
let ep=null;try{ep=JSON.parse(Buffer.from(String(cur).replace(/-/g,"+").replace(/_/g,"/"),"base64").toString()).ep}catch{}
ok(typeof ep==="string"&&/^count:\d+$/.test(ep),"/v1/companies first page issues a count-order cursor (ep="+ep+"), so page two continues the same order");'
fi
