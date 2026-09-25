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
# Table probes select `*`: a named column that the table lacks answers 400 before
# the permission check runs, which reads as anything but the 401 it should be.
# A refusal probe: 42501 = revoked by name (good); PGRST202 = wrong argument names, NOT absence.
probe() { local out; out=$(R "$1" "$2"); local code; code=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
  case "$code" in 42501) echo "PASS  $1 as anon -> 42501 (revoked by name)";; PGRST202) echo "INFO  $1 -> PGRST202 (argument names differ from the migration, or not applied)";; *) echo "FAIL  $1 as anon -> $code  $(printf '%s' "$out" | head -c 200)";; esac; }
title() { curl -s -m 30 -A "$UA" "$SITE$1" | grep -oE "<title>[^<]*</title>" | head -1; }

echo "== 1. job-board bundle =="
J '{"action":"status"}' > /tmp/vd_status.json
node -e '
const j=require("/tmp/vd_status.json");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
ok(/^2026-09-09\.7[3-9]$|^2026-09-09\.[89]|^2026-09-1/.test(String(j.version)),"status.version = "+j.version+" (want .73 or later)");
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
R get_category_fill_curve '{"p_days":90,"p_min_n":300}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  fill curve non-JSON")}if(!Array.isArray(j))return console.log("INFO  "+JSON.stringify(j).slice(0,120));console.log((j.length&&"still_open_30" in j[0]?"PASS":"FAIL")+"  still_open_30 present ("+j.length+" rows)");console.log((j.filter(r=>r.still_open_30===1).length===0?"PASS":"FAIL")+"  no field publishes still_open_30 = 1.0")})'

echo "== 5d. vendor counts on the facets action (board-wide, one stamp) =="
J '{"action":"facets"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const src=j.sources||{};const cats=j.categories||{};const a=Object.values(src).reduce((x,y)=>x+y,0),b=Object.values(cats).reduce((x,y)=>x+y,0);console.log((Object.keys(src).length>=15?"PASS":"FAIL")+"  sources has "+Object.keys(src).length+" keys");console.log((a===b?"PASS":"FAIL")+"  sum(sources)="+a.toLocaleString()+" vs sum(categories)="+b.toLocaleString());console.log((Object.values(src).every(v=>v!==10000)?"PASS":"FAIL")+"  no source count equals the 10,000 list cap")})'

echo "== 5f. field-panel percentages are the field’s own (hourly field_grid) =="
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

echo "== 5l. the runner’s staging table is closed to every client role =="
for T in _mig_stage _mig_probe; do code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/$T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  $T SELECT as anon -> $code" || echo "FAIL  $T SELECT as anon -> $code"; done
probe _mig_exec '{"p_sql":"select 1"}'

echo "== 5m. .72: the pay-widening disclosure =="
J '{"action":"list","limit":1,"salaryFloor":100000,"hasStatedPay":true,"includeUnstatedPay":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const ig=(j.ignoredFilters||[]).map(x=>typeof x==="string"?x:(x.key||x.name||JSON.stringify(x)));console.log((ig.some(n=>/includeUnstatedPay/.test(n))?"PASS":"FAIL")+"  ignoredFilters names includeUnstatedPay: "+JSON.stringify(ig))})'

echo "== 5n/5q. agent-mcp: version, tiers, prompts, resources, the unkeyed tier, the sign-in state =="
MC -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-deploy","version":"0"}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  initialize non-JSON")}const r=j.result||{};const v=r.serverInfo&&r.serverInfo.version;const c=r.capabilities||{};const ins=String(r.instructions||"");const si=(r._meta||{})["work.resumebooster/sign-in"]||{};console.log((/^2026-09-04\.(10|1[1-9]|[2-9][0-9])$|^2026-09-[1-3]/.test(String(v))?"PASS":"FAIL")+"  serverInfo.version = "+v+" (want .10 or later)");console.log((c.prompts&&c.resources?"PASS":"FAIL")+"  capabilities: prompts="+!!c.prompts+" resources="+!!c.resources);console.log((/^Live job search/.test(ins)?"PASS":"FAIL")+"  instructions open with the plan head; bytes="+ins.length+(ins.length>2048?" FAIL >2048":""));console.log((/\/jobs\?job=/.test(ins)?"PASS":"FAIL")+"  instructions carry the URL->id sentence");console.log("INFO  sign-in state="+si.state+(si.reason?" reason="+si.reason:"")+" (off = the owner has not enabled the Supabase OAuth server; the server says so in words)")})'
MC -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=((JSON.parse(s).result||{}).tools)||[];const miss=t.filter(x=>!x.outputSchema).map(x=>x.name);console.log("INFO  tools/list: "+t.length+" tools");console.log((miss.length===0?"PASS":"FAIL")+"  every tool declares outputSchema (missing: "+JSON.stringify(miss)+")");for(const n of ["employer_hiring_record","employer_growth","search","fetch"])console.log((t.some(x=>x.name===n)?"PASS":"FAIL")+"  tool present: "+n)})'
MC -d '{"jsonrpc":"2.0","id":3,"method":"prompts/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=((JSON.parse(s).result||{}).prompts)||[];console.log((p.length===3?"PASS":"FAIL")+"  prompts/list -> "+p.length+": "+p.map(x=>x.name).join(","))})'
MC -d '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=((JSON.parse(s).result||{}).resources)||[];console.log((r.length===3?"PASS":"FAIL")+"  resources/list -> "+r.length)})'
MC -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"board_stats","arguments":{}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result)||{};const txt=JSON.stringify(r.content||"");const spent=/allowance is spent/.test(txt);console.log((r.isError?(spent?"INFO":"FAIL"):"PASS")+"  keyless board_stats "+(r.isError?(spent?"refused: this address is over its daily allowance (our own probes) — the wall works":"isError "+txt.slice(0,120)):"answers"+((r.structuredContent||{}).withKey?" with a withKey block":"")))})'
MC -w '\nHTTPSTATUS:%{http_code}' -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"request_application","arguments":{"jobId":"zz"}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const st=(s.match(/HTTPSTATUS:(\d+)/)||[])[1];s=s.replace(/\nHTTPSTATUS:\d+$/,"");if(st==="401")return console.log("PASS  keyless request_application -> 401 (sign-in is ON and the challenge is answered)");let j;try{j=JSON.parse(s)}catch{j=null}const r=(j&&j.result)||{};const txt=JSON.stringify(r).slice(0,300);console.log((r.isError&&/key|sign-in/i.test(txt)?"PASS":"FAIL")+"  keyless request_application refused in band: "+txt.slice(0,120))})'
probe mcp_anon_check '{"p_ip_hash":"0000000000000000","p_global_cap":1,"p_ip_cap":1}'
if [ -n "$RB" ]; then MC -H "Authorization: Bearer $RB" -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"employer_growth","arguments":{"companyTokens":["dominos","tysonfoods~wd5~TSN","zz-not-a-board"]}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result)||{};const rows=((r.structuredContent||{}).employers)||[];console.log((!r.isError&&rows.length===3?"PASS":"FAIL")+"  keyed employer_growth: "+rows.length+" rows, "+rows.map(x=>x.verdict+(x.unknown_reason?"/"+x.unknown_reason:"")).join(","))})'; fi

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

echo "== 5r. the registry’s domain proof and listing =="
wk=$(curl -s -m 20 "$SITE/.well-known/mcp-registry-auth" | head -1); printf '%s' "$wk" | grep -qE '^v=MCPv1; k=(ed25519|ecdsap384); p=' && echo "PASS  /.well-known/mcp-registry-auth -> $wk" || echo "FAIL  /.well-known/mcp-registry-auth -> $wk"
[ -f ~/.config/resumebooster/mcp-registry-auth.txt ] && { [ "$(cat ~/.config/resumebooster/mcp-registry-auth.txt)" = "$wk" ] && echo "PASS  the served proof matches the key in ~/.config/resumebooster" || echo "INFO  the served proof differs from the local key (site not re-baked since the key changed)"; }
# The registry's own search is matched loosely: on 2026-09-22 a search for the
# full namespace "work.resumebooster" answered an EMPTY BODY where the day
# before it answered the row, while "resumebooster" still returned it. So ask
# the looser term and assert the NAME on the row, and treat an unparseable or
# empty body as INFO about the registry, never as a claim about our listing.
curl -s -m 20 "https://registry.modelcontextprotocol.io/v0.1/servers?search=resumebooster" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  registry search returned no parseable body ("+s.length+" bytes) — the listing is unproven by this run, not gone")}const v=(j.servers)||[];const ours=v.map(x=>(x.server||x)).filter(x=>/^work\.resumebooster\//.test(String(x.name)));console.log((ours.length>0?"PASS":"FAIL")+"  registry lists work.resumebooster: "+(ours.map(x=>x.name+"@"+x.version).join(",")||"NOT among "+v.length+" results"))})'

echo "== 5s. layoff filings: writers closed, tables locked, readers honest, the mirror full =="
probe refresh_layoff_partition '{}'
probe layoff_matches_rebuild '{}'
for T in layoff_filings layoff_matches layoff_board_names layoff_read_log layoff_employer_aliases; do code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$B/rest/v1/$T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  $T as anon -> $code" || echo "FAIL  $T as anon -> $code"; done
# Four tokens, four different answers the reader must give. thetradesk: "The Trade
# Desk" strips its leading "the" to a two-token name that equals the 8-K filer, so
# it is the proof the mirror is written and the exact match runs. pagerduty: filed
# an Item 2.05 on 2026-08-27 but its board name is ONE token, so by the rule it is
# null until the owner ticks the alias (it is on the batch-2 list). ehac~us6~CX_1
# is Williams-Sonoma: its 26 Aug 8-K was an earnings release (Item 2.02) whose
# exhibit mentions a reduction in force -- not an Item 2.05 -- so the null row is
# the CORRECT answer and a filing surfacing here would be a defect. zz-not-a-board
# is not a board at all and still gets its row, because no row is never "no filing".
R get_employer_layoff_filings '{"p_tokens":["thetradedesk","pagerduty","ehac~us6~CX_1","zz-not-a-board"]}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  reader non-JSON")}if(!Array.isArray(j))return console.log("INFO  reader: "+JSON.stringify(j).slice(0,160));const by=Object.fromEntries(j.map(r=>[r.lf_company_token,r]));const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);ok(j.length===4,"one row per asked token ("+j.length+"/4) -- a null row is an answer, never an omission");const t=by["thetradedesk"];ok(t&&t.lf_source==="sec_8k_205"&&t.lf_relation==="filer","thetradedesk -> "+(t&&t.lf_source?t.lf_source+" "+t.lf_filer+" "+t.lf_event_date+" (exact two-token match: the mirror is written)":"NULL ROW: mirror empty or matcher not run"));const p=by["pagerduty"];console.log((p&&p.lf_source?"PASS":"INFO")+"  pagerduty (one-token name, Item 2.05 filed 2026-08-27) -> "+(p&&p.lf_source?p.lf_source+" via "+p.lf_relation+" (alias ticked)":"null row -- correct until the alias is ticked"));const w=by["ehac~us6~CX_1"];ok(w&&w.lf_source===null,"ehac~us6~CX_1 (Williams-Sonoma; Aug-26 8-K was Item 2.02, not 2.05) -> "+(w&&w.lf_source===null?"null row (correct: not a filing)":"SURFACED "+w.lf_source+" "+w.lf_filer));const z=by["zz-not-a-board"];ok(z&&z.lf_source===null,"unknown token answers a null-source row")})'
R get_layoff_partition '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  partition non-JSON")}if(!Array.isArray(j))return console.log("INFO  partition: "+JSON.stringify(j).slice(0,160));for(const r of j)console.log("INFO  "+String(r.lp_arm).padEnd(7)+" sufficient="+r.lp_sufficient_30+(r.lp_reason?" reason="+r.lp_reason:"")+" taken_down_30="+r.lp_taken_down_30+" ±"+r.lp_half_width_30+" n="+r.lp_n_at_risk_30+" employers="+r.lp_employers_n+" maxshare="+r.lp_max_employer_share);const f=j.find(r=>r.lp_arm==="filed");if(f)console.log((f.lp_sufficient_30||f.lp_reason?"PASS":"FAIL")+"  the filed arm clears the gate or names why not")})'
code=$(curl -s -m 20 -o /tmp/vd_lf.json -w '%{http_code}' -X POST "$B/functions/v1/layoff-filings" -H "Content-Type: application/json" -H "apikey: $K" -d '{"action":"edgar"}'); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  layoff-filings without the cron key -> $code" || echo "FAIL  layoff-filings without the cron key -> $code $(head -c 100 /tmp/vd_lf.json)"

echo "== 5t. the H-1B wage cells: writer closed, table locked, reader answers a row per token =="
probe oflc_lca_wages_load '{"p_rows":[],"p_run_started_at":"2026-01-01T00:00:00Z","p_prune":false}'
code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$B/rest/v1/oflc_lca_wages?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); { [ "$code" = "401" ] || [ "$code" = "403" ]; } && echo "PASS  oflc_lca_wages as anon -> $code" || echo "FAIL  oflc_lca_wages as anon -> $code"
R get_employer_lca_wages '{"p_tokens":["dominos","thetradedesk","zz-not-a-board"]}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  lca reader non-JSON")}if(!Array.isArray(j))return console.log("FAIL  lca reader: "+JSON.stringify(j).slice(0,180));const toks=new Set(j.map(r=>r.ow_company_token));console.log((toks.size===3?"PASS":"FAIL")+"  one row per asked token ("+toks.size+"/3, "+j.length+" rows) -- no row is never \"does not sponsor\"");const z=j.find(r=>r.ow_company_token==="zz-not-a-board");console.log((z&&z.ow_soc_code===null?"PASS":"FAIL")+"  unknown token answers a null-wage row");const filled=j.filter(r=>r.ow_filings_n>0);console.log("INFO  cells with filings: "+filled.length+" (0 is CORRECT until the load POST is fired)")})'
# THE WHOLE LOAD, NOT ONE TOKEN, AND NO FIGURE TYPED TWICE. This block used to
# spell the label, the publication date, the source file and a proof token here
# in the shell, and to read that ONE token -- so it printed four passes over a
# load that was missing thousands of cells as long as that token's chunk had
# landed, and it would have printed three FAILs on a correct load the day the
# next file shipped. Every figure below is read out of the payload the deploy
# carries, at run time, and the assertions are over the load as a whole. A null
# or zero state here before the POST is CORRECT, not a defect.
LCA_PAYLOAD=supabase/functions/layoff-filings/lca-payload.ts
lcaconst() { grep -m1 "^export const $1 = " "$LCA_PAYLOAD" | sed -E 's/^[^=]*= *"?([^";]*)"?;.*$/\1/'; }
if [ -f "$LCA_PAYLOAD" ]; then
  export LCA_Q="$(lcaconst LCA_FISCAL_QUARTER)" LCA_FILE="$(lcaconst LCA_SOURCE_FILE)" LCA_PUB="$(lcaconst LCA_PUBLISHED_ON)"
  export LCA_FROM="$(lcaconst LCA_COVERAGE_FROM)" LCA_TO="$(lcaconst LCA_COVERAGE_TO)"
  export LCA_CELLS="$(lcaconst LCA_CELL_COUNT)" LCA_TOKENS="$(lcaconst LCA_TOKEN_COUNT)" LCA_WRITES="$(lcaconst LCA_CELL_WRITES)"
  echo "INFO  the bundle carries $LCA_CELLS cells / $LCA_TOKENS tokens / $LCA_WRITES filings, labelled \"$LCA_Q\" ($LCA_FROM..$LCA_TO) from $LCA_FILE published $LCA_PUB"
  R get_lca_load_state '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  lca load state non-JSON")}const r=Array.isArray(j)?j[0]:j;if(!r)return console.log("FAIL  lca load state answered no row");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);if(!Number(r.ls_cells))return console.log("INFO  the period is not loaded yet: 0 cells resident (fire the lca_wages POST)");
ok(String(r.ls_cells)===process.env.LCA_CELLS,"every cell landed: "+r.ls_cells+" resident, bundle carries "+process.env.LCA_CELLS);
ok(String(r.ls_tokens)===process.env.LCA_TOKENS,"every board token landed: "+r.ls_tokens+" of "+process.env.LCA_TOKENS);
ok(String(r.ls_filings)===process.env.LCA_WRITES,"the filings behind them: "+r.ls_filings+" of "+process.env.LCA_WRITES);
ok(Number(r.ls_periods)===1,"exactly one labelled period is resident ("+r.ls_periods+") -- more than one is a load that left a mixture");
ok(r.ls_fiscal_quarter===process.env.LCA_Q,"label -> "+r.ls_fiscal_quarter+" (bundle says "+process.env.LCA_Q+")");
ok(String(r.ls_published_on).slice(0,10)===process.env.LCA_PUB,"published on -> "+String(r.ls_published_on).slice(0,10));
ok(r.ls_source_file===process.env.LCA_FILE,"source file -> "+r.ls_source_file);
ok(String(r.ls_coverage_from).slice(0,10)===process.env.LCA_FROM&&String(r.ls_coverage_to).slice(0,10)===process.env.LCA_TO,"the span the figures are about -> "+String(r.ls_coverage_from).slice(0,10)+".."+String(r.ls_coverage_to).slice(0,10));
// THE PLAUSIBILITY BOUND, CHECKED ON WHAT LANDED. The loader refuses a filed
// annual figure outside this band and the bundle re-checks it before posting;
// this is the third place, on the rows the public can actually be shown.
ok(Number(r.ls_wage_low)>=15000&&Number(r.ls_wage_high)<=1500000,"every filed figure is inside the band: "+r.ls_wage_low+" to "+r.ls_wage_high+" (15,000 to 1,500,000)");
console.log("INFO  widest printable range is "+r.ls_max_spread+"x its own floor (teaching hospitals file residents and attendings under one broad SOC); loaded at "+r.ls_loaded_at)})'
  # ...and one employer answered through the reader the component actually asks,
  # so the aggregates above are not the only thing that can see the table.
  # A SAMPLE, not the proof: the assertions above are the proof. This token was
  # the largest filer in the file the bundle carried when this was written, and
  # a null row here is informational -- the next file may not carry it at all.
  PROOF=generalmotors~wd5~Careers_GM
  R get_employer_lca_wages "{\"p_tokens\":[\"$PROOF\"]}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  lca reader non-JSON")}if(!Array.isArray(j)||!j.length)return console.log("INFO  lca reader gave no row for the sample token");const r=j[0];if(r.ow_filings_n===null||r.ow_filings_n===undefined)return console.log("INFO  the sample token answers a null-wage row (correct before the POST, or if it is not in this file)");console.log("PASS  a sample employer reads back: "+r.ow_company_token+" "+r.ow_soc_code+" "+r.ow_worksite_state+" $"+r.ow_wage_low+"-"+r.ow_wage_high+" over "+r.ow_filings_n+" filings, "+r.ow_employer_cells_n+" cells / "+r.ow_employer_filings_n+" applications, "+r.ow_fiscal_quarter+" "+String(r.ow_coverage_from).slice(0,10)+".."+String(r.ow_coverage_to).slice(0,10))})'
else
  echo "INFO  no lca payload in this tree; the load state was not checked against it"
fi

echo "== 5u. the Ontario reader quotes a posting and never judges it =="
ONT=$(J '{"action":"list","country":"CA","location":"ontario","limit":1}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const r=(j.jobs||[])[0];console.log(r?r.id:"")})')
if [ -n "$ONT" ]; then
  R get_ontario_posting_disclosures "{\"p_id\":\"$ONT\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  ontario reader non-JSON")}if(!Array.isArray(j))return console.log("FAIL  ontario reader: "+JSON.stringify(j).slice(0,180));console.log((j.length===1?"PASS":"FAIL")+"  one row for the asked posting ("+j.length+")");const r=j[0]||{};const keys=["od_pay_evidence","od_pay_basis","od_vacancy_evidence","od_ai_evidence","od_canadian_experience_evidence"];console.log((keys.every(k=>k in r)?"PASS":"FAIL")+"  five evidence fields present");console.log((("od_verdict" in r)||("od_compliant" in r)||("od_score" in r)?"FAIL":"PASS")+"  no verdict, no score -- evidence only");console.log("INFO  pay="+JSON.stringify(r.od_pay_evidence)+" basis="+r.od_pay_basis+" vacancy="+JSON.stringify(r.od_vacancy_evidence)+" ai="+JSON.stringify(r.od_ai_evidence)+" canexp="+JSON.stringify(r.od_canadian_experience_evidence))})'
else echo "INFO  no Ontario posting returned to ask about"; fi
R get_ontario_posting_disclosures '{"p_id":"zz-not-a-posting"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  non-JSON")}console.log((Array.isArray(j)&&j.length===0?"PASS":"INFO")+"  a posting outside Ontario/unknown answers no row ("+(Array.isArray(j)?j.length:"?")+")")})'

echo "== 5v. a posting is addressable, and the sitemap advertises only pages that exist =="
SM=$(curl -s -m 30 "$SITE/sitemap.xml")
NP=$(printf '%s' "$SM" | grep -c "jobs/posting/")
echo "$([ "$NP" -gt 0 ] && echo PASS || echo FAIL)  sitemap carries $NP posting URLs"
printf '%s' "$SM" | grep -oE "<loc>[^<]*jobs/posting/[^<]*</loc>" | sed -E 's/<\/?loc>//g' | head -3 > /tmp/vd_posting_urls.txt
HOMET=$(title /)
while read -r u; do
  [ -z "$u" ] && continue
  page=$(curl -s -m 30 -A "$UA" "$u")
  t=$(printf '%s' "$page" | grep -oE "<title>[^<]*</title>" | head -1)
  ld=$(printf '%s' "$page" | grep -c '"@type": *"JobPosting"')
  can=$(printf '%s' "$page" | grep -c 'rel="canonical"')
  if [ -n "$t" ] && [ "$t" != "$HOMET" ] && [ "$ld" -ge 1 ] && [ "$can" -ge 1 ]; then echo "PASS  $(basename "$u") -> $t  (JobPosting blocks $ld, canonical $can)"; else echo "FAIL  $u -> title=$t jobposting=$ld canonical=$can"; fi
done < /tmp/vd_posting_urls.txt
printf '%s' "$SM" | grep -oE "<loc>[^<]*jobs/posting/[^<]*</loc>" | sed -E 's/<\/?loc>//g' | head -1 | while read -r u; do
  printf '%s' "$(curl -s -m 30 -A "$UA" "$u")" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;let x,ok=0,bad=0,vt=null;while((x=m.exec(s))){try{const j=JSON.parse(x[1]);const t=j["@type"];if(t==="JobPosting"){ok++;vt=j.validThrough;for(const k of ["title","description","datePosted","hiringOrganization","jobLocation"])if(!j[k])bad++}}catch{bad++}}console.log((ok===1&&bad===0?"PASS":"FAIL")+"  exactly one parseable JobPosting entity with every required property (entities "+ok+", problems "+bad+")");console.log((vt&&/T\d\d:\d\d:\d\d/.test(vt)?"PASS":"FAIL")+"  validThrough carries a time, not a bare date: "+vt)})'
done

echo "== 5w. the four data pages now serve numbers, and no vendor with zero rows is offered =="
for p in /ghost-job-index /pay-transparency /hiring-trends /entry-level-index; do
  n=$(curl -s -m 30 -A "$UA" "$SITE$p" | sed -E 's/<script[^>]*>.*<\/script>//g; s/<[^>]*>/ /g' | grep -oE "[0-9]" | wc -l | tr -d ' ')
  [ "$n" -gt 20 ] && echo "PASS  $p serves $n digits to a crawler" || echo "FAIL  $p serves $n digits"
done
curl -s -m 30 -A "$UA" "$SITE/jobs" | grep -qi "usajobs" && echo "FAIL  /jobs still offers USAJOBS while it serves no rows" || echo "PASS  USAJOBS is not offered on /jobs (its adapter is unkeyed and serves 0 rows)"
if [ -n "$RB" ]; then
  curl -s -m 30 "$B/functions/v1/public-api/v1/jobs?source=usajobs&limit=1" -H "Authorization: Bearer $RB" -H "apikey: $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  /v1 non-JSON: "+s.slice(0,120))}const t=JSON.stringify(j).toLowerCase();const refused=/terms|not available|cannot be redistributed|unsupported source/.test(t);console.log((refused?"PASS":"FAIL")+"  /v1 refuses source=usajobs by name: "+JSON.stringify(j).slice(0,200))})'
fi

echo "== 5x. the place the employer stated =="
J '{"action":"list","vendor":["workday"],"limit":100}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const rows=j.jobs||[];const noCountry=rows.filter(r=>!r.country).length;const placeless=rows.filter(r=>/^\s*\d+\s+(locations|sites)\s*$/i.test(String(r.location||""))).length;console.log("INFO  workday sample "+rows.length+": no country "+noCountry+" ("+Math.round(100*noCountry/Math.max(1,rows.length))+"%), \"N Locations\" "+placeless+" -- baseline was 50.3% and 10.4%; the sweep fills these as it re-reads, so a first-day read is EXPECTED to look close to baseline")})'
J '{"action":"list","country":"IL","limit":100}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const rows=j.jobs||[];const bad=rows.filter(r=>/beth israel|israel deaconess/i.test(String(r.company||"")+" "+String(r.location||"")));console.log((bad.length===0?"PASS":"FAIL")+"  no Boston hospital filed under country=IL in a "+rows.length+"-row sample ("+bad.length+" found)");console.log("INFO  country=IL total "+j.total)})'

echo "== 6. /companies renders =="
echo "INFO  GET /companies -> HTTP $(curl -s -m 30 -o /dev/null -w '%{http_code}' "$SITE/companies")"
echo "done."
