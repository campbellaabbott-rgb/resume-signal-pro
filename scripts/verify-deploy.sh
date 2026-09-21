#!/usr/bin/env bash
# READ-ONLY post-deploy proof. Sequential, anon key only (plus the owner's own
# free /v1 key from .env.local for the keyed MCP checks). Every line is a claim
# a deploy note made; each prints PASS / FAIL / INFO. Never a write, never a
# refresh/sweep/backfill/verify action, never anything to an employer system.
#
# Lives in the repository (scripts/verify-deploy.sh) since 2026-09-21, after a
# workflow cleanup deleted the scratchpad copy that had grown over a week.
# Usage: bash scripts/verify-deploy.sh   (from anywhere; it cd's to the repo)
set -u
cd "$(dirname "$0")/.."
K=$(grep -h '^VITE_SUPABASE_PUBLISHABLE_KEY\|^VITE_SUPABASE_ANON' .env | head -1 | sed -E 's/^[^=]+=//; s/"//g')
RB=$(grep -h '^RB_API_KEY' .env.local 2>/dev/null | sed -E 's/^[^=]+=//; s/"//g')
B=https://bwhdazbotpblihdxcmho.supabase.co
SITE=https://resumebooster.work
UA="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
J() { curl -s -m 60 -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$1"; }
R() { curl -s -m 60 -X POST "$B/rest/v1/rpc/$1" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d "${2:-{\}}"; }
MC() { curl -s -m 60 -X POST "$B/functions/v1/agent-mcp" -H "Content-Type: application/json" -H "apikey: $K" -H "mcp-protocol-version: 2025-06-18" "$@"; }
# A refusal probe: 42501 = revoked by name (good); PGRST202 = wrong argument names, NOT absence.
probe() { local out; out=$(R "$1" "$2"); local code; code=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
  case "$code" in 42501) echo "PASS  $1 as anon -> 42501 (revoked by name)";; PGRST202) echo "INFO  $1 -> PGRST202 (argument names differ from the migration, or not applied)";; *) echo "FAIL  $1 as anon -> $code  $(printf '%s' "$out" | head -c 200)";; esac; }
title() { curl -s -m 30 -A "$UA" "$SITE$1" | grep -oE "<title>[^<]*</title>" | head -1; }

echo "== 1. job-board bundle =="
J '{"action":"status"}' > /tmp/vd_status.json
node -e '
const j=require("/tmp/vd_status.json");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
ok(/^2026-09-09\.7[2-9]$|^2026-09-1/.test(String(j.version)),"status.version = "+j.version+" (want .72 or later)");
ok(j.catalogSize===44519,"catalogSize = "+j.catalogSize+" (want 44519)");
ok(j.orphanPruneBlocked===false,"orphanPruneBlocked = "+j.orphanPruneBlocked+" (want false)");
const hw=j.catalogHighwater; ok(typeof hw==="number"?hw<=j.catalogSize:true,"catalogHighwater = "+JSON.stringify(hw)+" (want <= catalogSize)");
const f=j.freshness||{}; console.log("INFO  freshness p50="+f.p50_min+" p95="+f.p95_min+" max="+f.max_min+" (SLA claims 480 / 1,440)");
const ck=j.chainKick||{}; console.log("INFO  chainKick outcome="+ck.outcome+" fromHop="+ck.fromHop+" ageMin="+ck.ageMin);
const r=j.recategorize||{}; console.log("INFO  recategorize rulesVersion="+r.rulesVersion+" stampedVersion="+r.stampedVersion);
const sl=j.staleLane||{}; console.log((sl.windowFull===false?"PASS":"INFO")+"  staleLane.windowFull="+sl.windowFull+" excluded="+sl.excluded);'

echo "== 2. the Remote filter returns no negated titles =="
J '{"action":"list","q":"non-remote","workMode":"remote","limit":10}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const bad=(j.jobs||[]).filter(r=>/\b(non[- ]?remote|not remote|no remote)\b/i.test(r.title||""));console.log((bad.length===0?"PASS":"FAIL")+"  negated-remote titles under workMode=remote: "+bad.length)})'

echo "== 3. company counts are servable =="
J '{"action":"list","limit":1,"includeFacets":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const c=(j.companies||[])[0]||{};console.log((("open" in c)&&!("count" in c)?"PASS":"FAIL")+"  facet row carries `open` and no `count`");console.log("INFO  companiesOpenCount="+j.companiesOpenCount+" totalAllCompanies="+j.totalAllCompanies)})'

echo "== 4. S(30): columns present, the 1.0 leak not live =="
R get_category_fill_curve '{"p_days":30,"p_window":90}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  fill curve non-JSON")}if(!Array.isArray(j))return console.log("INFO  "+JSON.stringify(j).slice(0,120));console.log((j.length&&"still_open_30" in j[0]?"PASS":"FAIL")+"  still_open_30 present ("+j.length+" rows)");console.log((j.filter(r=>r.still_open_30===1).length===0?"PASS":"FAIL")+"  no field publishes still_open_30 = 1.0")})'

echo "== 5d. vendor counts on the facets action (board-wide, one stamp) =="
J '{"action":"facets"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const src=j.sources||{};const cats=j.categories||{};const a=Object.values(src).reduce((x,y)=>x+y,0),b=Object.values(cats).reduce((x,y)=>x+y,0);console.log((Object.keys(src).length>=15?"PASS":"FAIL")+"  sources has "+Object.keys(src).length+" keys");console.log((a===b?"PASS":"FAIL")+"  sum(sources)="+a.toLocaleString()+" vs sum(categories)="+b.toLocaleString());console.log((Object.values(src).every(v=>v!==10000)?"PASS":"FAIL")+"  no source count equals the 10,000 list cap")})'

echo "== 5f. field-panel percentages are the field\x27s own (hourly field_grid) =="
R get_explore_cache '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  explore cache non-JSON")}const g=(Array.isArray(j)?j[0]:j)||{};const fg=g.field_grid||g.fieldGrid||{};const F=fg.fields||fg;const pct=(k)=>{const f=F[k];return f&&f.n?Math.round(100*(f.work_mode_n||0)/f.n):null};const a=pct("finance"),b=pct("design");console.log((a!==null&&b!==null&&a!==b?"PASS":"INFO")+"  finance work-mode share="+a+"%  design="+b+"% (board-wide was 23% for both)")})'

echo "== 5g. the leaderboard is timed (its own aggregation, 9-25s live) =="
T0=$(date +%s.%N); R get_actively_hiring_companies '{"p_limit":20}' > /dev/null; T1=$(date +%s.%N); echo "INFO  get_actively_hiring_companies answered in $(echo "$T1 - $T0" | bc)s"

echo "== 5i. the leaderboard answers from the hourly cache =="
R get_stats_cache '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const a=j.actively_hiring;const sp=j.stale_parts||[];if(!a)return console.log("INFO  no actively_hiring in the cache yet");const rows=Array.isArray(a.rows)?a.rows.length:(Array.isArray(a)?a.length:null);console.log((rows===20?"PASS":"FAIL")+"  cache.actively_hiring carries "+rows+" rows");console.log((a.computed_at?"PASS":"FAIL")+"  own computed_at = "+a.computed_at);console.log((sp.includes("actively_hiring")?"INFO":"PASS")+"  stale_parts="+JSON.stringify(sp))})'

echo "== 5j. the Other-bucket machinery is closed to every client role =="
probe promote_category '{"p_basis":"rule","p_key":"commis","p_target":"hospitality_retail"}'
probe revert_category '{"p_basis":"rule","p_key":"commis"}'
probe load_category_anchors '{"p_version":"probe","p_rows":[]}'
ZV=$(node -e 'console.log(JSON.stringify("["+Array(384).fill(0).join(",")+"]"))'); probe category_knn "{\"q\":$ZV,\"k\":1}"
code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/job_board_category_anchors?select=id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  anchors table as anon -> $code" || echo "FAIL  anchors table as anon -> $code"

echo "== 5k. get_company_growth is a three-state verdict =="
R get_company_growth '{"p_tokens":["dominos","tysonfoods~wd5~TSN","zz-not-a-board"]}' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  non-JSON")}if(!Array.isArray(j))return console.log("INFO  "+JSON.stringify(j).slice(0,160));
const V=new Set(["grew","no-growth","unknown"]);const RS=new Set(["excluded","series_stale","no_series","too_new","series_gap","too_small","not_in_ledger","windowed_read","failed_read","ledger_gap","pool_replaced"]);const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
ok(j.length===3,"one row per asked token ("+j.length+")");ok(j.every(r=>V.has(r.verdict)),"verdicts in {grew,no-growth,unknown}: "+j.map(r=>r.verdict).join(","));ok(j.every(r=>(r.verdict==="unknown")===(r.unknown_reason!==null)),"unknown_reason iff unknown");ok(j.every(r=>r.unknown_reason===null||RS.has(r.unknown_reason)),"reasons in vocabulary: "+j.map(r=>r.unknown_reason).join(","));ok(j.every(r=>r.window_days===7&&r.ledger_days_expected===9),"window 7 / ledger 9 on every row");
const z=j.find(r=>r.company_token==="zz-not-a-board");ok(!!z&&z.verdict==="unknown"&&z.unknown_reason==="no_series","unknown token -> unknown/no_series");
for(const r of j)console.log("INFO  "+r.company_token+": "+r.verdict+(r.unknown_reason?"/"+r.unknown_reason:"")+" baseline="+r.baseline_served+" latest="+r.latest_served+" removed="+r.removed_departures)})'

echo "== 5l. the runner\x27s staging table is closed to every client role =="
for T in _mig_stage _mig_probe; do code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/$T?select=name&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  $T SELECT as anon -> $code" || echo "FAIL  $T SELECT as anon -> $code"; done
probe _mig_exec '{"p_sql":"select 1"}'

echo "== 5m. .72: the pay-widening disclosure =="
J '{"action":"list","limit":1,"salaryFloor":100000,"hasStatedPay":true,"includeUnstatedPay":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const ig=(j.ignoredFilters||[]).map(x=>typeof x==="string"?x:(x.key||x.name||JSON.stringify(x)));console.log((ig.some(n=>/includeUnstatedPay/.test(n))?"PASS":"FAIL")+"  ignoredFilters names includeUnstatedPay: "+JSON.stringify(ig))})'

echo "== 5n/5q. agent-mcp: version, tiers, prompts, resources, the unkeyed tier, the sign-in state =="
MC -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-deploy","version":"0"}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  initialize non-JSON")}const r=j.result||{};const v=r.serverInfo&&r.serverInfo.version;const c=r.capabilities||{};const ins=String(r.instructions||"");const si=(r._meta||{})["work.resumebooster/sign-in"]||{};console.log((/^2026-09-04\.[8-9]$|^2026-09-04\.[1-9][0-9]$|^2026-09-[1-3]/.test(String(v))?"PASS":"INFO")+"  serverInfo.version = "+v+" (want .8 or later)");console.log((c.prompts&&c.resources?"PASS":"FAIL")+"  capabilities: prompts="+!!c.prompts+" resources="+!!c.resources);console.log((/^Live job search/.test(ins)?"PASS":"FAIL")+"  instructions open with the plan head; bytes="+ins.length+(ins.length>2048?" FAIL >2048":""));console.log((/\/jobs\?job=/.test(ins)?"PASS":"FAIL")+"  instructions carry the URL->id sentence");console.log("INFO  sign-in state="+si.state+(si.reason?" reason="+si.reason:"")+" (off = the owner has not enabled the Supabase OAuth server; the server says so in words)")})'
MC -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=((JSON.parse(s).result||{}).tools)||[];const miss=t.filter(x=>!x.outputSchema).map(x=>x.name);console.log("INFO  tools/list: "+t.length+" tools");console.log((miss.length===0?"PASS":"FAIL")+"  every tool declares outputSchema (missing: "+JSON.stringify(miss)+")");for(const n of ["employer_hiring_record","employer_growth","search","fetch"])console.log((t.some(x=>x.name===n)?"PASS":"FAIL")+"  tool present: "+n)})'
MC -d '{"jsonrpc":"2.0","id":3,"method":"prompts/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=((JSON.parse(s).result||{}).prompts)||[];console.log((p.length===3?"PASS":"FAIL")+"  prompts/list -> "+p.length+": "+p.map(x=>x.name).join(","))})'
MC -d '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=((JSON.parse(s).result||{}).resources)||[];console.log((r.length===3?"PASS":"FAIL")+"  resources/list -> "+r.length)})'
MC -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"board_stats","arguments":{}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result)||{};const txt=JSON.stringify(r.content||"");const spent=/allowance is spent/.test(txt);console.log((r.isError?(spent?"INFO":"FAIL"):"PASS")+"  keyless board_stats "+(r.isError?(spent?"refused: this address is over its daily allowance (our own probes) — the wall works":"isError "+txt.slice(0,120)):"answers"+((r.structuredContent||{}).withKey?" with a withKey block":"")))})'
MC -w '\nHTTPSTATUS:%{http_code}' -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"request_application","arguments":{"jobId":"zz"}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const st=(s.match(/HTTPSTATUS:(\d+)/)||[])[1];s=s.replace(/\nHTTPSTATUS:\d+$/,"");if(st==="401")return console.log("PASS  keyless request_application -> 401 (sign-in is ON and the challenge is answered)");let j;try{j=JSON.parse(s)}catch{j=null}const r=(j&&j.result)||{};const txt=JSON.stringify(r).slice(0,300);console.log((r.isError&&/key|sign-in/i.test(txt)?"PASS":"FAIL")+"  keyless request_application refused in band: "+txt.slice(0,120))})'
probe mcp_anon_check '{"p_ip_hash":"0000000000000000","p_global_cap":1,"p_ip_cap":1}'
if [ -n "$RB" ]; then MC -H "Authorization: Bearer $RB" -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"employer_growth","arguments":{"companyTokens":["dominos","tysonfoods~wd5~TSN","zz-not-a-board"]}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result)||{};const rows=((r.structuredContent||{}).rows)||[];console.log((!r.isError&&rows.length===3?"PASS":"INFO")+"  keyed employer_growth: "+rows.length+" rows, "+rows.map(x=>x.verdict+(x.unknown_reason?"/"+x.unknown_reason:"")).join(","))})'; fi

echo "== 5o. the six-hour pass =="
probe agent_pass_grant '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_stripe_session_id":"zz","p_payment_intent_id":"zz","p_amount_cents":0,"p_session_hours":1,"p_applications_total":1,"p_rate_per_min":1,"p_daily_quota":1,"p_shelf_days":1}'
probe agent_queue_enqueue '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_posting_id":"zz","p_row":{},"p_pass_funded":false}'
probe agent_pass_metrics '{"p_days":7}'
probe custom_access_token_hook '{"event":{}}'
code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/agent_passes?select=applications_used&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  agent_passes as anon -> $code" || echo "FAIL  agent_passes as anon -> $code"
prm=$(curl -s -m 30 -w '\n%{http_code}' "$B/functions/v1/agent-mcp/.well-known/oauth-protected-resource" -H "apikey: $K"); pcode=$(printf '%s' "$prm" | tail -1); printf '%s' "$prm" | sed '$d' | grep -q '"resource"' && [ "$pcode" = "200" ] && echo "PASS  PRM served on the function path" || echo "FAIL  PRM -> HTTP $pcode"
as=$(curl -s -m 20 "$B/.well-known/oauth-authorization-server/auth/v1"); printf '%s' "$as" | grep -q '"registration_endpoint"' && echo "PASS  OAuth AS metadata answers with DCR" || echo "INFO  OAuth AS: $(printf '%s' "$as" | head -c 90) (the owner's dashboard toggle)"
if [ -n "$RB" ]; then MC -H "Authorization: Bearer $RB" -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"key_status","arguments":{}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const sc=((JSON.parse(s).result||{}).structuredContent)||{};const p=sc.pass||null;console.log((p&&p.state?"PASS":"INFO")+"  key_status.pass.state = "+(p&&p.state))})'; fi

echo "== 5p. no prerendered page is served as the homepage shell =="
HOMET=$(title /)
for p in /agents /pricing /changelog /explore /freelance-boost /data-api /ghost-job-index /jobs; do t=$(title "$p"); if [ -n "$t" ] && [ "$t" != "$HOMET" ]; then echo "PASS  $p -> $t"; else echo "FAIL  $p serves the HOMEPAGE title to crawlers"; fi; done
curl -s -m 30 -A "$UA" "$SITE/agents" > /tmp/vd_agents.html; echo "INFO  /agents tiles: $(grep -oE 'href="#(claude|chatgpt|claude-code|cursor|vscode|more)"' /tmp/vd_agents.html | sort -u | tr '\n' ' ')  GitHub line: $(grep -c 'Using a different agent' /tmp/vd_agents.html)"
echo "INFO  /jobs crawler copy links /agents: $(curl -s -m 30 -A "$UA" "$SITE/jobs" | grep -c 'href="/agents"')"
echo "INFO  homepage strip in crawler copy: $(curl -s -m 30 -A "$UA" "$SITE/" | grep -c 'Bring your own AI agent')"

echo "== 5r. the registry\x27s domain proof and listing =="
wk=$(curl -s -m 20 "$SITE/.well-known/mcp-registry-auth" | head -1); printf '%s' "$wk" | grep -qE '^v=MCPv1; k=(ed25519|ecdsap384); p=' && echo "PASS  /.well-known/mcp-registry-auth -> $wk" || echo "FAIL  /.well-known/mcp-registry-auth -> $wk"
[ -f ~/.config/resumebooster/mcp-registry-auth.txt ] && { [ "$(cat ~/.config/resumebooster/mcp-registry-auth.txt)" = "$wk" ] && echo "PASS  the served proof matches the key in ~/.config/resumebooster" || echo "INFO  the served proof differs from the local key (site not re-baked since the key changed)"; }
curl -s -m 20 "https://registry.modelcontextprotocol.io/v0.1/servers?search=work.resumebooster" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=(JSON.parse(s).servers)||[];console.log((v.length>0?"PASS":"FAIL")+"  registry lists work.resumebooster: "+v.map(x=>(x.server||x).name+"@"+(x.server||x).version).join(","))})'

echo "== 5s. layoff filings: writers closed, tables locked, readers honest, the mirror full =="
probe refresh_layoff_partition '{}'
probe layoff_matches_rebuild '{}'
for T in layoff_filings layoff_matches layoff_board_names layoff_read_log layoff_employer_aliases; do code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$B/rest/v1/$T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  $T as anon -> $code" || echo "FAIL  $T as anon -> $code"; done
R get_employer_layoff_filings '{"p_tokens":["ehac~us6~CX_1","thetradedesk","workday~wd5~Workday","zz-not-a-board"]}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  reader non-JSON")}if(!Array.isArray(j))return console.log("INFO  reader: "+JSON.stringify(j).slice(0,160));const by=Object.fromEntries(j.map(r=>[r.lf_company_token,r]));console.log((j.length===4?"PASS":"FAIL")+"  one row per asked token ("+j.length+"/4) — a null row is an answer, never an omission");const z=by["zz-not-a-board"];console.log((z&&z.lf_source===null?"PASS":"FAIL")+"  unknown token answers a null-source row");for(const t of ["ehac~us6~CX_1","thetradedesk"]){const r=by[t];console.log((r&&r.lf_source?"PASS":"INFO")+"  "+t+" (two-word filer) -> "+(r&&r.lf_source?r.lf_source+" "+r.lf_filer+" "+r.lf_event_date:"no filing surfaced (mirror not written, or nothing in window)"))}const w=by["workday~wd5~Workday"];console.log("INFO  workday~wd5~Workday (single-word name; needs a curated alias) -> "+(w&&w.lf_source?w.lf_source+" via "+w.lf_relation:"null row — correct until an alias is ticked"))})'
R get_layoff_partition '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  partition non-JSON")}if(!Array.isArray(j))return console.log("INFO  partition: "+JSON.stringify(j).slice(0,160));for(const r of j)console.log("INFO  "+String(r.lp_arm).padEnd(7)+" sufficient="+r.lp_sufficient_30+(r.lp_reason?" reason="+r.lp_reason:"")+" taken_down_30="+r.lp_taken_down_30+" ±"+r.lp_half_width_30+" n="+r.lp_n_at_risk_30+" employers="+r.lp_employers_n+" maxshare="+r.lp_max_employer_share);const f=j.find(r=>r.lp_arm==="filed");if(f)console.log((f.lp_sufficient_30||f.lp_reason?"PASS":"FAIL")+"  the filed arm clears the gate or names why not")})'
code=$(curl -s -m 20 -o /tmp/vd_lf.json -w '%{http_code}' -X POST "$B/functions/v1/layoff-filings" -H "Content-Type: application/json" -H "apikey: $K" -d '{"action":"edgar"}'); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  layoff-filings without the cron key -> $code" || echo "FAIL  layoff-filings without the cron key -> $code $(head -c 100 /tmp/vd_lf.json)"

echo "== 6. /companies renders =="
echo "INFO  GET /companies -> HTTP $(curl -s -m 30 -o /dev/null -w '%{http_code}' "$SITE/companies")"
echo "done."
