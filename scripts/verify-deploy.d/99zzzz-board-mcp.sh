# shellcheck shell=bash
# ── 99zzzz. BOARD-STREAM MCP GROUP (2026-11-01 audit: S9-002, S13-103,
# S13-121): a place typed the way a person's AI types it, the keyless page cap
# whatever credential failed, and a perk audit tied to the extractor output it
# judged. Rides job-board 2026-09-09.100, agent-mcp.2026-11-02.1,
# employer-profiles.2026-11-02.1 and migration 20261102164000.
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh (README.md here).
#
# THE CLAIMS, one line each:
#   P1  job-board searches "Austin, TX 78701" as Austin in Texas under every
#       spelling (the ZIP dropped), says so, and finds rows;
#   P2  "New York NY" (no comma) likewise, with what was typed kept as a term;
#   P3  "Washington, D.C." (a dotted code) likewise;
#   M1  agent-mcp reads location "United States" as country US, says so in
#       locationReadAs, and finds rows;
#   M2  agent-mcp reads location "remote" as remote: true, and says so;
#   M3  search_jobs' output schema names locationReadAs;
#   M4  browse_jobs tells the model a country goes in country and remote in
#       remote, and no prompt asks for "City, state, country or 'remote'";
#   K1  a junk bearer at offset 9000 is told the keyless page limit by name,
#       and the board is not asked;
#   V1  the perk draw takes an extractor version, and refuses anon (42501);
#   V2  the unversioned perk draw is gone (PGRST202);
#   V3  the perk record takes a draw id and a version, and refuses anon;
#   V4  the record without them is gone;
#   V5  get_employer_perks, restated, answers the publishable key in shape.
#
# WHAT WAITS FOR WHAT. P1-P3 wait for job-board .100, M1-M4 and K1 for
# agent-mcp.2026-11-02.1 (before it, K1 would spend a counted keyless call
# on the old build); each prints INFO until its build serves. V1-V5 judge the
# migration, which applies before the functions.
#
# READ-ONLY. OPTIONS preflights; job-board list reads with x-rb-budget: probe;
# agent-mcp initialize-free calls: tools/list, prompts/list, prompts/get, and
# two keyless search_jobs calls (one each of today's shared allowance, as
# sections 73, 82 and 92 spend) plus K1, which the fixed build answers
# uncounted; GET probes of two writers, which PostgREST runs read-only; one
# read of the pure perk reader.
echo "== 99zzzz. board-stream MCP: places as typed, the keyless page cap, perk audits tied to their draw (20261102164000) =="

rm -f /tmp/vd_99m_*.json

VD99M_JB=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD99M_JB_LIVE=0
if [ -z "$VD99M_JB" ]; then echo "FAIL  job-board preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
elif build_ge job-board "$VD99M_JB" "2026-09-09" "100"; then echo "PASS  job-board preflight x-fn-build = $VD99M_JB (2026-09-09.100 or later: places read as typed)"; VD99M_JB_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VD99M_JB: 2026-09-09.100 is not serving yet, so P1-P3 wait for it"; fi

VD99M_MCP=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD99M_MCP_LIVE=0
if [ -z "$VD99M_MCP" ]; then echo "FAIL  agent-mcp preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge agent-mcp "$VD99M_MCP" "2026-11-02" "1"; then echo "PASS  agent-mcp preflight x-fn-build = $VD99M_MCP (agent-mcp.2026-11-02.1 or later)"; VD99M_MCP_LIVE=1
else echo "INFO  agent-mcp preflight x-fn-build = $VD99M_MCP: agent-mcp.2026-11-02.1 is not serving yet, so M1-M4 and K1 wait for it"; fi

VD99M_EP=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/employer-profiles" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD99M_EP" ]; then echo "FAIL  employer-profiles preflight carries no x-fn-build (not deployed)"
elif build_ge employer-profiles "$VD99M_EP" "2026-11-02" "1"; then echo "PASS  employer-profiles preflight x-fn-build = $VD99M_EP (employer-profiles.2026-11-02.1 or later: draws and records name their version)"
else echo "FAIL  employer-profiles preflight x-fn-build = $VD99M_EP (want employer-profiles.2026-11-02.1 or later: its owner audit calls the signatures 20261102164000 removed)"; fi

# ── P1-P3: a place as the model types it ──
if [ "$VD99M_JB_LIVE" = 1 ]; then
  J '{"action":"list","q":"software engineer","location":"Austin, TX 78701","limit":1}' > /tmp/vd_99m_p1.json
  J '{"action":"list","q":"software engineer","location":"New York NY","limit":1}' > /tmp/vd_99m_p2.json
  J '{"action":"list","q":"software engineer","location":"Washington, D.C.","limit":1}' > /tmp/vd_99m_p3.json
  node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const CASES=[["P1","/tmp/vd_99m_p1.json","Austin, TX 78701",["Austin, TX","Austin, Texas","Austin,TX"]],
  ["P2","/tmp/vd_99m_p2.json","New York NY",["New York, NY","New York, New York","New York,NY","New York NY"]],
  ["P3","/tmp/vd_99m_p3.json","Washington, D.C.",["Washington, DC","Washington, District of Columbia","Washington,DC","Washington, D.C."]]];
for(const [id,f,typed,want] of CASES){const j=rd(f);
  if(!j||typeof j!=="object"){ok(false,id+" job-board list for "+JSON.stringify(typed)+" answered no JSON");continue}
  const got=Array.isArray(j.locationSearched)?j.locationSearched:[];const total=Number(j.total);
  ok(j.locationExpandedFrom===typed&&want.every((t)=>got.includes(t))&&total>0,id+" location "+JSON.stringify(typed)+" searched as "+JSON.stringify(got)+" (from "+JSON.stringify(j.locationExpandedFrom)+"), total "+j.total+" (want every one of "+JSON.stringify(want)+" and rows)")}'
else
  echo "INFO  P1-P3 wait for job-board 2026-09-09.100"
fi

# ── M1-M4, K1: the connector ──
if [ "$VD99M_MCP_LIVE" = 1 ]; then
  MC -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"software engineer","location":"United States","limit":1}}}' > /tmp/vd_99m_m1.json
  MC -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"software engineer","location":"remote","limit":1}}}' > /tmp/vd_99m_m2.json
  MC -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}' > /tmp/vd_99m_tools.json
  MC -d '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"browse_jobs","arguments":{"what":"nurse","where":"Texas"}}}' > /tmp/vd_99m_prompt.json
  MC -d '{"jsonrpc":"2.0","id":5,"method":"prompts/list","params":{}}' > /tmp/vd_99m_prompts.json
  MC -H "Authorization: Bearer x" -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"search_jobs","arguments":{"query":"software engineer","offset":9000}}}' > /tmp/vd_99m_k1.json
  node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const raw=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const sc=(f)=>{const j=rd(f);return j&&j.result&&!j.result.isError?(j.result.structuredContent||null):null};
const why=(f)=>raw(f).slice(0,160);
const m1=sc("/tmp/vd_99m_m1.json");
if(!m1)ok(false,"M1 keyless search_jobs location \"United States\" answered no result: "+why("/tmp/vd_99m_m1.json"));
else{const r=m1.locationReadAs||{};ok(r.country==="US"&&r.location===undefined&&r.sent==="United States"&&Number(m1.total)>0,"M1 location \"United States\" read as "+JSON.stringify(m1.locationReadAs||null)+", total "+m1.total+" (want country US, no location text, rows)")}
const m2=sc("/tmp/vd_99m_m2.json");
if(!m2)ok(false,"M2 keyless search_jobs location \"remote\" answered no result: "+why("/tmp/vd_99m_m2.json"));
else{const r=m2.locationReadAs||{};ok(r.remote===true&&r.location===undefined&&Number(m2.total)>0,"M2 location \"remote\" read as "+JSON.stringify(m2.locationReadAs||null)+", total "+m2.total+" (want remote: true, no location text, rows)")}
const tools=((rd("/tmp/vd_99m_tools.json")||{}).result||{}).tools||[];const sj=tools.find((t)=>t.name==="search_jobs");
const props=sj&&sj.outputSchema&&sj.outputSchema.properties||{};
ok(!!props.locationReadAs,"M3 search_jobs output schema names locationReadAs ("+(sj?Object.keys(props).length+" properties":"no search_jobs in tools/list")+")");
const ptext=JSON.stringify(((rd("/tmp/vd_99m_prompt.json")||{}).result||{}).messages||[]);const plist=raw("/tmp/vd_99m_prompts.json");
ok(/only a country goes in country as its ISO-2 code/.test(ptext)&&plist.includes("browse_jobs")&&!plist.includes("City, state, country or"),"M4 browse_jobs asks for a country in country and remote in remote, and no prompt asks for \"City, state, country or remote\" ("+(ptext.length>2?"prompt read":"no prompt text")+")");
const k1=rd("/tmp/vd_99m_k1.json");const k=k1&&k1.result&&k1.result.structuredContent;
ok(!!k&&k.pageLimitReached===true&&Array.isArray(k.jobs)&&k.jobs.length===0,"K1 a junk bearer at offset 9000 is told pageLimitReached by name with no rows: "+JSON.stringify(k?{pageLimitReached:k.pageLimitReached,jobs:Array.isArray(k.jobs)?k.jobs.length:null,total:k.total}:why("/tmp/vd_99m_k1.json")))'
else
  echo "INFO  M1-M4 and K1 wait for agent-mcp.2026-11-02.1"
fi

# ── V1-V5: the perk audit migration ──
# vd99m_gone FN QS: the signature with these arguments must NOT exist (PGRST202).
vd99m_gone() { local out; out=$(curl -s -m 60 "$B/rest/v1/rpc/$1?$2" -H "apikey: $K" -H "Authorization: Bearer $K"); local code; code=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
  case "$code" in PGRST202) echo "PASS  $3: $1($2) is not in the catalogue (PGRST202)";; *) echo "FAIL  $3: $1($2) answered $code  $(printf '%s' "$out" | head -c 160)";; esac; }
# vd99m_closed FN QS: the signature exists and refuses anon by name (42501); PGRST202 means it is not there.
vd99m_closed() { local out; out=$(curl -s -m 60 "$B/rest/v1/rpc/$1?$2" -H "apikey: $K" -H "Authorization: Bearer $K"); local code; code=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
  case "$code" in 42501) echo "PASS  $3: $1 refuses anon by name (42501)";; PGRST202) echo "FAIL  $3: $1($2) is not in the catalogue (20261102164000 has not applied)";; 25006) echo "FAIL  $3: $1 is CALLABLE as anon (only this read-only GET stopped its write)";; *) echo "FAIL  $3: $1 answered $code  $(printf '%s' "$out" | head -c 160)";; esac; }
vd99m_closed employer_perk_audit_draw "p_perk=health&p_version=2&p_rows=1" "V1 the versioned draw"
vd99m_gone employer_perk_audit_draw "p_perk=health&p_rows=1" "V2 the unversioned draw is gone"
vd99m_closed employer_perk_audit_record "p_perk=health&p_mode=launch&p_judged=60&p_correct=60&p_draw_id=1&p_version=2&p_note=verify" "V3 the record that names its draw"
vd99m_gone employer_perk_audit_record "p_perk=health&p_mode=launch&p_judged=60&p_correct=60&p_note=verify" "V4 the record without a draw is gone"
R get_employer_perks '{"p_token":"ramp"}' > /tmp/vd_99m_perks.json
node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_99m_perks.json","utf8"))}catch{}
const ok=!!j&&typeof j==="object"&&!Array.isArray(j)&&Array.isArray(j.perks)&&Array.isArray(j.published_keys)&&Array.isArray(j.withheld)&&j.expiry_days===45;
console.log((ok?"PASS":"FAIL")+"  V5 get_employer_perks(ramp), restated, answers in shape: "+JSON.stringify(j).slice(0,160))'
