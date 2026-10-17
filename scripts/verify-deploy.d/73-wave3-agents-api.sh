# shellcheck shell=bash
# ── 73. WAVE 3, AGENTS + API (branch wave3/agents-api, builds of 2026-10-09 and
# generate-application-answers 2026-10-10.3, the wave 3 integration builds).
# Sourced by scripts/verify-deploy.sh; J R MC probe build_ge $B $K $SITE $UA $RB
# are in scope. Deploy note: docs/wave3/agents-api.md.
#
# THE CLAIMS:
#   - six functions serve the integration builds (agent-mcp .4, apply-agent .3, the
#     rest .2; generate-application-answers 2026-10-10.3, a floor neither
#     main's ledger repair, 10-10.1, nor either branch, 10-10.2, carries);
#   - /v1 is apiVersion 2026-10-09.1 and lists SmartRecruiters beside the
#     federal feed as withheld (owner decision 4); with the owner's key, naming
#     it in source= is a 451 and an unknown employment_type a 400 (S8-078);
#   - a SmartRecruiters employer named by its own token (read off the board)
#     is refused by name in search_jobs' companies, not answered empty;
#   - the connector names both withheld systems in search_jobs' vendor field
#     and in its guide, types no coverage percentage into a tool description
#     (S8-079), and an unkeyed search serves no SmartRecruiters row, links each
#     card to its page with tracking, and says which allowance answered;
#   - the three new or rewritten readers are closed to anon (S8-010, decision
#     4, the adoption reader); the two triggers are proved in pglite only;
#   - the crawler copy of /agents, /data-api and / and llms.txt say what the
#     code does (the withheld systems, the host's own allowance);
#   - the agent card's four sendable systems, in the live bundle if the copy
#     ships in the entry chunk;
#   - inside ChatGPT the guide carries no pass link (Claude's still does), and
#     initialize and the request_application description carry none for any
#     host: purchase text has a ChatGPT edition built at source, and job data
#     is never rewritten (proved by inside-chatgpt-a-job-whose-title-...).
#
# READ-ONLY. OPTIONS preflights run no function logic. The /v1 index answers
# before any key check. initialize, tools/list and the guide (read twice:
# once as ChatGPT's user agent) are free and unmetered. TWO
# unkeyed search_jobs calls are made (two of this address's 25 free calls for
# today); one job-board list with the probe budget reads a SmartRecruiters
# token. The keyed /v1 reads use the owner's own free key (RB_API_KEY in
# .env.local) and cost two calls of its quota; without it they are INFO. The
# probes call revoked readers as anon, which answer 42501 before running.
# The worker changes (S8-006/007/008/043-048/082) run from main in
# apply-worker.yml and are proved by their tests, not here.
echo "== 73. wave 3 agents-api: builds, SmartRecruiters withheld, the host's own allowance, the agent card's four systems =="

for PAIR in "agent-mcp|2026-10-09|71" "public-api|2026-10-09|71" "apply-agent|2026-10-09|71" "apply-broker|2026-10-09|24" "send-agent-digest|2026-10-09|24" "generate-application-answers|2026-10-10|62"; do
  W73_FN=${PAIR%%|*}; W73_REST=${PAIR#*|}; W73_D=${W73_REST%%|*}; W73_N=${W73_REST#*|}
  W73_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$W73_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$W73_H" ]; then echo "FAIL  $W73_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$W73_FN" "$W73_H" "$W73_D" "$W73_N"; then echo "PASS  $W73_FN preflight x-fn-build = $W73_H ($W73_FN.$W73_D.$W73_N or later)"
  else echo "FAIL  $W73_FN preflight x-fn-build = $W73_H (want $W73_FN.$W73_D.$W73_N or later: the previous bundle is still serving)"; fi
done

curl -s -m 30 -o /tmp/vd_73_v1.json "$B/functions/v1/public-api/v1" -H "apikey: $K" -H "Authorization: Bearer $K"
node -e '
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
let j=null;try{j=JSON.parse(require("fs").readFileSync("/tmp/vd_73_v1.json","utf8"))}catch{}
if(!j){console.log("FAIL  /v1 index did not answer JSON");process.exit(0)}
const v=String(j.apiVersion||"none");
ok(/^2026-10-(09\.[1-9]|1[0-9]|2[0-9]|3[01])/.test(v)||/^2026-1[12]-|^202[7-9]-/.test(v),"/v1 apiVersion = "+v+" (want 2026-10-09.1 or later; 2026-10-08.1 = wave 2 only, 2026-09-30.1 = neither)");
const ex=((j.restrictions||{}).excludedSources)||[];
ok(ex.includes("smartrecruiters")&&ex.includes("usajobs"),"/v1 restrictions.excludedSources = "+JSON.stringify(ex)+" (want usajobs and smartrecruiters)");'

if [ -z "${RB:-}" ]; then
  echo "INFO  RB_API_KEY missing from .env.local -- the keyed /v1 reads (source=smartrecruiters -> 451, employment_type=zzz -> 400) are skipped"
else
  W73_SR=$(curl -s -m 30 -o /tmp/vd_73_sr.json -w '%{http_code}' "$B/functions/v1/public-api/v1/jobs?source=smartrecruiters&limit=1" -H "Authorization: Bearer $RB" -H "apikey: $K")
  W73_ET=$(curl -s -m 30 -o /tmp/vd_73_et.json -w '%{http_code}' "$B/functions/v1/public-api/v1/jobs?employment_type=zzz&limit=1" -H "Authorization: Bearer $RB" -H "apikey: $K")
  W73_SR="$W73_SR" W73_ET="$W73_ET" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const s=rd("/tmp/vd_73_sr.json"), e=rd("/tmp/vd_73_et.json");
ok(process.env.W73_SR==="451","/v1/jobs?source=smartrecruiters -> "+process.env.W73_SR+" "+JSON.stringify(s).slice(0,140)+" (want 451; 200 = the old build serves SmartRecruiters)");
ok(process.env.W73_ET==="400","/v1/jobs?employment_type=zzz -> "+process.env.W73_ET+" "+JSON.stringify(e&&e.error||e).slice(0,140)+" (want 400 naming the valid values; 200 = unvalidated)");'
fi

MC -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' > /tmp/vd_73_tools.json
MC -d '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"resumebooster://guide"}}' > /tmp/vd_73_guide.json
MC -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"engineer","limit":5}}}' > /tmp/vd_73_search.json
MC -A "openai-mcp/1.0.0" -d '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"resumebooster://guide"}}' > /tmp/vd_73_guide_gpt.json
MC -d '{"jsonrpc":"2.0","id":5,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-deploy","version":"1"}}}' > /tmp/vd_73_init.json
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const tl=rd("/tmp/vd_73_tools.json"), gd=rd("/tmp/vd_73_guide.json"), se=rd("/tmp/vd_73_search.json"), gg=rd("/tmp/vd_73_guide_gpt.json"), it=rd("/tmp/vd_73_init.json");
const tools=((tl||{}).result||{}).tools||[];
if(!tools.length){console.log("FAIL  agent-mcp tools/list answered no tools");}
else{
  const sj=tools.find(t=>t.name==="search_jobs")||{};
  const vd=String((((sj.inputSchema||{}).properties||{}).vendor||{}).description||"");
  ok(/smartrecruiters/i.test(vd),"search_jobs vendor field names SmartRecruiters as not available ("+(vd.match(/Not available here:[^—]*/)||["absent"])[0].trim()+")");
  // A coverage figure reads "~13%" or "28% of the board"; a gate ("at least 25% more") is not one.
  const COV=/~\s?\d+(\.\d+)?\s?%|\d+(\.\d+)?\s?% of (the board|postings|all postings|employers|jobs)/i;
  const pct=tools.filter(t=>COV.test(String(t.description||"")+JSON.stringify(t.inputSchema||{}))).map(t=>t.name);
  ok(pct.length===0,"no tool description or field types a coverage percentage (S8-079)"+(pct.length?": "+pct.join(", "):""));
  const ra=tools.find(t=>t.name==="request_application")||{};
  ok(ra.description&&!/agents\/pass/.test(String(ra.description)),"the request_application description carries no pass link (every host sees it; present = the old build)");
}
const ggt=String(((((gg||{}).result||{}).contents)||[{}])[0].text||"");
if(!ggt){console.log("FAIL  the guide read as ChatGPT answered no text");}
else ok(!/agents\/pass/.test(ggt),"the guide read as ChatGPT carries no pass link (present = the old build: only tools/call was filtered)");
const ins=String((((it||{}).result)||{}).instructions||"");
if(!ins){console.log("FAIL  initialize answered no instructions");}
else ok(!/agents\/pass/.test(ins),"initialize.instructions carry no pass link for any host (present = the old build)");
const gt=String(((((gd||{}).result||{}).contents)||[{}])[0].text||"");
if(!gt){console.log("FAIL  the guide resource answered no text");}
else{
  ok(/SmartRecruiters/.test(gt)&&/federal/.test(gt),"the guide names both withheld systems");
  ok(/Claude.s users share/.test(gt)&&/each user has their own/.test(gt),"the guide states the host allowance (ChatGPT per user, Claude a shared pool)");
  ok(/agents\/pass/.test(gt),"the guide read outside ChatGPT still names where a pass is bought");
}
const r=(se||{}).result||{};
const sc=r.structuredContent||(()=>{try{return JSON.parse(((r.content||[])[0]||{}).text||"{}")}catch{return{}}})();
if(r.isError){info("unkeyed search_jobs refused (this address may have spent its 25 today): "+String(((r.content||[])[0]||{}).text||"").slice(0,160));}
else if(!Array.isArray(sc.jobs)){console.log("FAIL  unkeyed search_jobs -> "+JSON.stringify(se).slice(0,160));}
else{
  ok(sc.jobs.every(j=>!/^smartrecruiters:/.test(String(j.id||""))&&j.source!=="smartrecruiters"),"unkeyed search serves no SmartRecruiters row ("+sc.jobs.length+" rows)");
  ok(sc.jobs.length>0&&sc.jobs.every(j=>/^https:\/\/resumebooster\.work\/jobs\?job=.*utm_source=mcp/.test(String(j.siteUrl||""))),"every card links to its page on the site with utm_source=mcp ("+String((sc.jobs[0]||{}).siteUrl||"none").slice(0,90)+")");
  const u=sc.unkeyed||{};
  ok(typeof u.allowance==="string","the unkeyed block says which allowance answered (allowance="+u.allowance+", "+u.callsLeftToday+" of "+u.ipCap+" left; absent = the old build)");
  info("relatedTotal="+sc.relatedTotal+" relatedCapped="+sc.relatedCapped+" filterCoverageAt="+sc.filterCoverageAt+" (S8-077 pass-through; absent when the board sent none)");
}'

# A SmartRecruiters employer's own token, from the board, through search_jobs.
W73_SRTOK=$(J '{"action":"list","vendor":"smartrecruiters","limit":1}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=(JSON.parse(s).jobs||[])[0]||{};console.log(r.source==="smartrecruiters"&&r.token?r.token:"")}catch{console.log("")}})')
if [ -z "$W73_SRTOK" ]; then echo "INFO  the board answered no SmartRecruiters row -- the connector's per-employer refusal is proved by the-connector-handed-on-smartrecruiters-..."
else
  MC -d "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"search_jobs\",\"arguments\":{\"query\":\"\",\"companies\":[\"$W73_SRTOK\"],\"limit\":1}}}" > /tmp/vd_73_srco.json
  W73_SRTOK="$W73_SRTOK" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_73_srco.json","utf8"))}catch{}
const t=String(((((j||{}).result||{}).content)||[{}])[0].text||"");const tok=process.env.W73_SRTOK;
if(/allowance|free calls|limit/i.test(t)&&!/cannot be served/.test(t)){console.log("INFO  unkeyed search_jobs refused for its allowance, not its employer: "+t.slice(0,140));}
else ok(t.includes(tok+" cannot be served by this server"),"search_jobs companies:[\""+tok+"\"] (a SmartRecruiters employer token) is refused by name ("+t.slice(0,120).replace(/\s+/g," ")+"; an empty page or rows = agent-mcp .3 or 20261009122000 not live)");'
fi

probe v1_withheld_company_tokens '{"p_sources":["smartrecruiters"]}'
# Typed values, never null: a GET query string cannot carry a SQL NULL, so
# probe() refuses one (it printed FAIL here on 2026-10-11 without asking).
# Revoked from anon, the function answers 42501 before reading either value.
probe agent_packet_pass_funds '{"p_pass_id":"00000000-0000-4000-8000-0000000000aa","p_refunded_at":"2026-10-11T00:00:00Z"}'
probe agent_adoption_metrics '{"p_days":1}'
echo "INFO  agent_mandates_resume_in_own_folder (20261009120000) and agent_submissions_owner_status_trg (20261009121000) are triggers: proved in pglite (a-mandate-could-send..., a-refunded-pass-packet...), not probed here"

curl -s -m 30 -A "$UA" "$SITE/agents" > /tmp/vd_73_agents.html
curl -s -m 30 -A "$UA" "$SITE/data-api" > /tmp/vd_73_dataapi.html
curl -s -m 30 -A "$UA" "$SITE/" > /tmp/vd_73_home.html
curl -s -m 30 "$SITE/llms.txt" > /tmp/vd_73_llms.txt
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const a=rd("/tmp/vd_73_agents.html"), d=rd("/tmp/vd_73_dataapi.html"), h=rd("/tmp/vd_73_home.html"), l=rd("/tmp/vd_73_llms.txt");
const W="withheld until SmartRecruiters (SAP) permits it";
ok(a.includes(W),"/agents crawler copy names the withheld systems");
ok(d.includes(W),"/data-api crawler copy names the withheld systems");
ok(/from Claude, whose servers carry every user, calls come first from a pool of \d+ a day/.test(a),"/agents crawler copy states the host allowance (the address gloss)");
ok(h.includes("from ChatGPT each person has their own"),"/ crawler copy (the agent strip) states the host allowance");
ok(l.includes("Claude&#39;s users share a larger daily pool first")||l.includes("Claude'"'"'s users share a larger daily pool first"),"llms.txt states the host allowance");'

# The agent card and the front-page split are client-rendered; their English
# copy ships in the main bundle when en.json is in the entry chunk.
W73_JS=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_73_home.html | head -1)
if [ -z "$W73_JS" ]; then echo "INFO  no entry chunk named on / -- the agent card copy is proved by the-agent-card-said-it-applies-on-seven-systems-and-it-sends-on-four"
else
  curl -s -m 60 "$SITE$W73_JS" > /tmp/vd_73_entry.js
  if grep -q "a form the agent cannot finish on its own yet" /tmp/vd_73_entry.js; then echo "PASS  the live entry chunk carries the new 'you press send' blurb (agent card / front page name the four sendable systems)"
  elif grep -q "These use a CAPTCHA or a human check. We never solve or bypass one" /tmp/vd_73_entry.js; then echo "FAIL  the live entry chunk still carries the old blurb: the frontend with the four-system agent copy is not deployed"
  else echo "INFO  neither blurb is in the entry chunk $W73_JS (the locale ships elsewhere) -- proved by the-agent-card-said-it-applies-on-seven-systems-and-it-sends-on-four"; fi
fi
