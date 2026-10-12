# shellcheck shell=bash
# ── 92. WAVE 4 ROUND 2, THE AGENTS API: the S12 sweep's connector and /v1
# fixes (branch w4b/agents-api; docs/wave4/README.md).
#
# THE CLAIMS, one line each below:
#   - agent-mcp and public-api serve 2026-10-11.27 or later;
#   - a keyless tools/list declares countCapped, rankedFellBack and the
#     board's employer notes (unknownCompanies, companiesUnresolved,
#     companiesNotLookedUp) on search_jobs (S12-040, S12-041, S12-080), lets
#     apply_myself's route say null for a system nobody measured (S12-174),
#     and is still 25,000 bytes or less;
#   - a keyless search scoped to "CVS" never answers with other employers'
#     rows: either the rows are CVS's and companiesResolved says which boards,
#     or there are none and unknownCompanies or companiesUnresolved says why
#     (S12-080);
#   - a search that only says it is ChatGPT is not logged (S12-085): this
#     run's nonce, the owner's SQL below, must count 0;
#   - with RB_API_KEY, a /v1 job object carries last_verified_at and last_seen
#     holds the same value (S12-121), and an empty page for a company_token
#     the board has never read names it in disclosures.unknownCompanies
#     (S12-040).
# Not provable from outside, so proved in the suite: the keyed daily bucket
# hash (S12-175; the owner's step sets MCP_BUCKET_SECRET), board_stats and
# refunds sized to the bucket (S12-176), the bundled OpenAI egress list
# (S12-085), the drafting rule and the hint (S12-081, S12-082), and the
# Greenhouse hidden fields and consent flags (S12-173).
#
# READ-ONLY. tools/list is free and unmetered. TWO keyless lookups are spent
# (the CVS search and the nonce search: two of this connection's 100 for
# today), and only once the preflight shows this build. With RB_API_KEY, two
# GETs of the owner's own key.
echo "== 92. wave 4 round 2, agents API: employer names, honest counts, no ChatGPT log, last_verified_at =="

VD92_LIVE=0
VD92_API=0
for VD92_FN in agent-mcp public-api; do
  VD92_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD92_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD92_H" ]; then echo "FAIL  $VD92_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$VD92_FN" "$VD92_H" "2026-10-11" "27"; then
    echo "PASS  $VD92_FN preflight x-fn-build = $VD92_H ($VD92_FN.2026-10-11.27 or later: the S12 agents-api fixes)"
    [ "$VD92_FN" = "agent-mcp" ] && VD92_LIVE=1
    [ "$VD92_FN" = "public-api" ] && VD92_API=1
  else echo "FAIL  $VD92_FN preflight x-fn-build = $VD92_H (want $VD92_FN.2026-10-11.27 or later: the S12 agents-api fixes are not serving)"; fi
done

MC -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' > /tmp/vd_92_tools.json
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
let raw="";try{raw=fs.readFileSync("/tmp/vd_92_tools.json","utf8")}catch{}
let tools=[];try{tools=JSON.parse(raw).result.tools||[]}catch{}
if(!tools.length){console.log("FAIL  keyless tools/list answered no tools: "+raw.slice(0,140));process.exit(0)}
const sj=tools.find((t)=>t.name==="search_jobs")||{};const props=((sj.outputSchema||{}).properties)||{};
const want=["countCapped","rankedFellBack","unknownCompanies","companiesUnresolved","companiesNotLookedUp","companiesResolved"];
const missing=want.filter((k)=>!props[k]);
ok(missing.length===0,"search_jobs declares "+want.join(", ")+(missing.length?" (missing: "+missing.join(", ")+")":""));
ok(/countCapped/.test(String(sj.description||""))&&!/exact totals when knowable/.test(String(sj.description||"")),"search_jobs says a total is a floor when countCapped, not that totals are exact: "+JSON.stringify(String(sj.description||"").slice(0,160)));
const am=tools.find((t)=>t.name==="apply_myself")||{};const route=((((am.outputSchema||{}).properties)||{}).route||{}).properties||{};
const t=(x)=>JSON.stringify((x||{}).type);
ok(/null/.test(t(route.needsEmployerAccount))&&/null/.test(t(route.captchaLikely)),"apply_myself route may say null (not measured) for needsEmployerAccount "+t(route.needsEmployerAccount)+" and captchaLikely "+t(route.captchaLikely));
const bytes=Buffer.byteLength(raw);ok(bytes<=25000,"keyless tools/list is "+bytes+" bytes (want 25,000 or less)");'

VD92_NONCE="vdgpt92$(date +%s)"
if [ "$VD92_LIVE" != "1" ]; then
  echo "INFO  the CVS search and the ChatGPT nonce search were not made: agent-mcp is older than 2026-10-11.27, and an older bundle answers them as the sweep found it"
else
  MC -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"pharmacist","companies":"CVS","limit":10}}}' > /tmp/vd_92_cvs.json
  MC -A "openai-mcp/1.0 (ChatGPT); verify-deploy-92" -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"search_jobs\",\"arguments\":{\"query\":\"$VD92_NONCE\",\"limit\":1}}}" > /tmp/vd_92_gpt.json
  VD92_NONCE="$VD92_NONCE" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const spent=(r,t)=>r.isError&&/allowance is spent|Too many keyless calls/.test(t);
const c=((rd("/tmp/vd_92_cvs.json")||{}).result)||{};const ct=String(((c.content||[])[0]||{}).text||"");const sc=c.structuredContent||{};
if(spent(c,ct))info("the CVS search was refused for the allowance: "+ct.slice(0,120));
else if(c.isError)ok(false,"the CVS search failed: "+ct.slice(0,160));
else{
  const jobs=Array.isArray(sc.jobs)?sc.jobs:[];const resolved=Array.isArray(sc.companiesResolved)?sc.companiesResolved:[];
  const tokens=new Set(resolved.flatMap((x)=>Array.isArray(x.tokens)?x.tokens:[]));
  const noted=Array.isArray(sc.unknownCompanies)||Array.isArray(sc.companiesUnresolved)||/could not apply/.test(JSON.stringify(sc.ignoredFilters||[]));
  if(jobs.length===0)ok(noted,"a search scoped to \"CVS\" with no rows says why (unknownCompanies "+JSON.stringify(sc.unknownCompanies||null)+", companiesUnresolved "+JSON.stringify((sc.companiesUnresolved||[]).map((u)=>u.asked))+"): never a silent 0");
  else{
    const strays=jobs.filter((j)=>!tokens.has(j.companyToken)).map((j)=>j.companyToken);
    ok(tokens.size>0&&strays.length===0,"a search scoped to \"CVS\" answers only the boards it resolved to ("+[...tokens].slice(0,3).join(", ")+"): "+jobs.length+" rows"+(strays.length?", strays from "+[...new Set(strays)].slice(0,4).join(", ")+" (the whole board under one employer name)":""));
  }
}
const g=((rd("/tmp/vd_92_gpt.json")||{}).result)||{};const gt=String(((g.content||[])[0]||{}).text||"");
if(spent(g,gt))info("the ChatGPT nonce search was refused for the allowance: "+gt.slice(0,120));
else{
  ok(!g.isError,"a search that says it is ChatGPT answers"+(g.isError?": "+gt.slice(0,120):""));
  info("owner, service role, a minute after this run: SELECT count(*) FROM job_board_search_events WHERE q = '\''"+process.env.VD92_NONCE+"'\'' must be 0 (S12-085: a caller that says it is ChatGPT is never logged, from anywhere; 1 means the no-log flag still follows OpenAI'\''s egress list). Section 86'\''s nonce line asking for 1 predates this fix.");
}'
fi

if [ -z "${RB:-}" ]; then
  echo "INFO  RB_API_KEY missing from .env.local -- /v1 last_verified_at and the never-read company_token disclosure are not read here"
elif [ "$VD92_API" != "1" ]; then
  echo "INFO  /v1 is not read: public-api is older than 2026-10-11.27"
else
  curl -s -m 60 -o /tmp/vd_92_v1.json "$B/functions/v1/public-api/v1/jobs?limit=3" -H "Authorization: Bearer $RB" -H "apikey: $K"
  curl -s -m 60 -o /tmp/vd_92_v1u.json "$B/functions/v1/public-api/v1/jobs?company_token=zz-never-carried-$VD92_NONCE" -H "Authorization: Bearer $RB" -H "apikey: $K"
  VD92_NONCE="$VD92_NONCE" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const a=rd("/tmp/vd_92_v1.json")||{};const rows=Array.isArray(a.data)?a.data:[];
if(!rows.length)console.log("INFO  /v1/jobs answered no rows to read last_verified_at on: "+JSON.stringify(a).slice(0,140));
else{
  ok(rows.every((r)=>"last_verified_at" in r),"every /v1 job object carries last_verified_at ("+rows.map((r)=>r.last_verified_at).join(", ")+")");
  ok(rows.every((r)=>r.last_seen===r.last_verified_at),"last_seen holds the same value, never the insert time");
  const later=rows.filter((r)=>r.last_verified_at&&r.first_seen&&Date.parse(r.last_verified_at)>=Date.parse(r.first_seen)).length;
  const dated=rows.filter((r)=>r.last_verified_at&&r.first_seen).length;
  if(dated)ok(later===dated,"last_verified_at is on or after first_seen on "+later+" of "+dated+" rows");
  else console.log("INFO  no row carried both stamps to compare");
}
const u=rd("/tmp/vd_92_v1u.json")||{};const tok="zz-never-carried-"+process.env.VD92_NONCE;
ok(Array.isArray(u.data)&&u.data.length===0&&Array.isArray(((u.disclosures||{}).unknownCompanies))&&u.disclosures.unknownCompanies.includes(tok),"an empty /v1 page for a company_token the board has never read names it ("+JSON.stringify((u.disclosures||{}).unknownCompanies||null)+")");'
fi
