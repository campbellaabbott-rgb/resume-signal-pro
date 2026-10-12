# shellcheck shell=bash
# ── 85. WAVE 4, THE KEYLESS ALLOWANCE: split by the platform the call came
# from, capped per minute, counted only in SQL the clients cannot call, and
# the protocol fixes beside it (owner decision 2026-10-11, economics 1(b);
# branch w4/mcp; docs/wave4/README.md).
#
# THE CLAIMS, one line each below:
#   - the counted keyless search section 82 made answered from the "other"
#     share as one connection: partition other, a bucket of 100, a share of
#     4,000 and a day of 20,000 for everyone;
#   - the guide states the owner's figures: 20,000 a day split Claude 10,000
#     / ChatGPT 6,000 (200 a person, 2,000 for calls that name nobody) /
#     other 4,000 (100 a connection), per minute 60 overall with Claude 30,
#     ChatGPT 20 and other 15, and the forms pool at 5,000 a day and 20 a
#     minute, and a keyless page to offset 200;
#   - mcp_anon_check_v2, mcp_anon_refund, mcp_count_call, the alert claim, the
#     two owner readers and api_key_fit_allowance refuse anon (42501), and
#     mcp_calls_daily and mcp_allowance_alerts are closed tables;
#   - a null JSON-RPC body answers -32600; CORS allows mcp-session-id,
#     mcp-protocol-version and last-event-id and exposes WWW-Authenticate; the
#     protected-resource document answers 404 while sign-in is off.
#
# READ-ONLY and FREE: no lookup is spent here (the allowance block is read off
# section 82's search); the guide, the preflight, the null body and the PRM
# read are unmetered; the probes are GETs, which PostgREST runs read-only. A
# per-minute refusal itself cannot be provoked without spending 60 calls: it is
# proved in pglite (a-script-cannot-hold-the-database-for-a-minute, which runs
# mcp_anon_check_v2 itself), and the guide's statement of the caps is read here.
echo "== 85. wave 4 allowance: the split by platform, the per-minute caps, the closed counters, the protocol fixes =="

# api-key-request: the key it mints states its free fit allowance (limits.fitPerDay) beside its request limits.
VD85_AK=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/api-key-request" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD85_AK" ]; then echo "FAIL  api-key-request preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge api-key-request "$VD85_AK" "2026-10-11" "1"; then echo "PASS  api-key-request preflight x-fn-build = $VD85_AK (api-key-request.2026-10-11.1 or later)"
else echo "FAIL  api-key-request preflight x-fn-build = $VD85_AK (want api-key-request.2026-10-11.1 or later)"; fi

MC -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"resumebooster://guide"}}' > /tmp/vd_85_guide.json
VD85_PRE=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "apikey: $K" -H "Origin: https://claude.ai" -H "Access-Control-Request-Method: POST" | tr -d '\r')
printf '%s' "$VD85_PRE" > /tmp/vd_85_pre.h
VD85_NULL=$(curl -s -m 30 -X POST "$B/functions/v1/agent-mcp" -H "Content-Type: application/json" -H "apikey: $K" -H "mcp-protocol-version: 2025-06-18" -d 'null')
printf '%s' "$VD85_NULL" > /tmp/vd_85_null.json
VD85_PRM=$(curl -s -m 30 -o /tmp/vd_85_prm.json -w '%{http_code}' "$B/functions/v1/agent-mcp/.well-known/oauth-protected-resource" -H "apikey: $K")
VD85_PRM="$VD85_PRM" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const raw=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
// The allowance block of section 82s counted search.
{const j=rd("/tmp/vd_82_search.json");const r=(j&&j.result)||null;
  const sc=r?(r.structuredContent||(()=>{try{return JSON.parse(((r.content||[])[0]||{}).text||"{}")}catch{return{}}})()):null;
  const u=sc&&sc.unkeyed;
  if(!u)info("no counted keyless search from section 82 to read the allowance block off (its wave-4 build line, or the allowance, stopped it)");
  else ok(u.partition==="other"&&u.allowance==="connection"&&u.ipCap===100&&u.partitionCap===4000&&u.globalCap===20000,"a keyless call from outside Claude and ChatGPT is counted as one connection in the other share (partition "+u.partition+", allowance "+u.allowance+", bucket "+u.ipCap+", share "+u.partitionCap+", day "+u.globalCap+"; want other/connection/100/4000/20000)");}
// The guide states the figures.
{const t=String(((((rd("/tmp/vd_85_guide.json")||{}).result||{}).contents)||[{}])[0].text||"");
  if(!t)console.log("FAIL  the guide resource answered no text");
  else{
    const want=[
      ["the day and its split","20,000 a day for everyone together, split by where the call comes from: Claude 10,000"],
      ["ChatGPT per person and without an id","ChatGPT 6,000 (200 for each person ChatGPT identifies, 2,000 shared by calls that identify nobody)"],
      ["everyone else per connection","4,000 for everyone else (100 for each internet connection)"],
      ["the per-minute caps","Per minute: 60 for everyone together; Claude 30, ChatGPT 20, everyone else 15."],
      ["the forms pool","(5,000 a day, 20 a minute), so applying never spends a lookup"],
      ["the keyless page","one page of 10 rows to offset 200"],
    ];
    for(const [what,s] of want)ok(t.includes(s),"the guide states "+what+": "+JSON.stringify(s));
    ok(!/\$\d|\bAgent (?:Pass|plan)\b|agents\/pass/.test(t),"the guide names no price, no Agent plan or Pass, and no pass link");
  }}
// Protocol (spec D2 2.6).
{const h=raw("/tmp/vd_85_pre.h");const get=(n)=>{const m=new RegExp("^"+n+":\\s*(.*)$","im").exec(h);return m?m[1].toLowerCase():""};
  const allow=get("access-control-allow-headers"),expose=get("access-control-expose-headers");
  const need=["mcp-session-id","mcp-protocol-version","last-event-id"].filter((x)=>!allow.includes(x));
  ok(need.length===0,"CORS allows mcp-session-id, mcp-protocol-version and last-event-id"+(need.length?" (missing "+need.join(", ")+"; allow-headers: "+allow+")":""));
  ok(expose.includes("www-authenticate"),"CORS exposes WWW-Authenticate (expose-headers: "+(expose||"none")+")");}
{const j=rd("/tmp/vd_85_null.json");const code=j&&j.error&&j.error.code;
  ok(code===-32600,"a null JSON-RPC body answers -32600 (got "+JSON.stringify(j?j.error||j:raw("/tmp/vd_85_null.json").slice(0,80))+")");}
{const si=((((rd("/tmp/vd_82_init.json")||{}).result)||{})._meta||{})["work.resumebooster/sign-in"]||{};const code=process.env.VD85_PRM;
  if(si.state==="off")ok(code==="404","the protected-resource document answers "+code+" while sign-in is off (want 404: a host must not start a sign-in that cannot finish)");
  else if(si.state==="on")ok(code==="200"&&/"resource"/.test(raw("/tmp/vd_85_prm.json")),"the protected-resource document answers "+code+" while sign-in is on (want 200 with its resource)");
  else info("sign-in state "+JSON.stringify(si.state)+": the protected-resource answer ("+code+") is not judged");}'

probe mcp_anon_check_v2 '{"p_bucket":"verify:85","p_bucket_cap":1,"p_global_bucket":"global:verify","p_global_cap":1}'
probe mcp_anon_refund '{"p_bucket":"verify:85","p_global_bucket":"global:verify","p_overall":false}'
probe mcp_count_call '{"p_host":"other","p_surface":"keyless","p_tool":"search_jobs","p_outcome":"ok"}'
probe mcp_allowance_alert_claim '{"p_share":"global:verify","p_used":0,"p_cap":1}'
probe mcp_connector_report '{"p_days":1}'
probe mcp_free_key_leads '{"p_days":1}'
probe api_key_fit_allowance '{"p_key_id":"00000000-0000-4000-8000-000000000085","p_endpoint":"/v1/fit"}'
for VD85_T in mcp_calls_daily mcp_allowance_alerts; do
  code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/$VD85_T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  { [ "$code" = "401" ] || [ "$code" = "403" ]; } && echo "PASS  $VD85_T SELECT as anon -> $code" || echo "FAIL  $VD85_T SELECT as anon -> $code (want 401 or 403: service-role only)"
done
echo "INFO  the per-minute refusal (Retry-After, nothing counted) and the share partitions under load are proved in pglite: a-script-cannot-hold-the-database-for-a-minute and a-scraper-cannot-spend-claude-users-share run mcp_anon_check_v2 itself"
echo "INFO  owner, service role: SELECT host, surface, tool, outcome, sum(calls) FROM mcp_calls_daily WHERE day = current_date GROUP BY 1,2,3,4 -- the connector's calls by host and outcome, never by who; mcp_connector_report(7) and mcp_free_key_leads(7) are the two readers"
