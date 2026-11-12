# shellcheck shell=bash
# ── 99zzzz. CONNECT W1 AND W3 (connect-apply-2026-11-07, plan.waves W1 and
# W3): a search is read as people type it, every job link a person pastes is
# read, and the answers fit what a model reads. Rides agent-mcp.2026-11-08.1
# (branch fix/connect-mcp). No migration, no job-board change.
#
# Named 99zzzz-ca3-search so it sorts after 99zzzz-ca3-apply.sh (README.md here).
#
# THE CLAIMS, one line each (the deploy note's W1 and W3 sentences):
#   S1  "registered nurse jobs Austin TX" is searched as registered nurse in
#       Austin, TX: a trailing place with no "in";
#   S2  "Customer Service TX" is searched whole: no town called Service (the
#       recheck's negative; title words before a state code are no city);
#   S3  a location argument "London, UK" is searched as London in GB;
#   S4  "part-time jobs near Manchester UK" keeps the city and the country;
#   S5  "marketing jobs posted this week" is a 7-day window, not title words;
#   S6  "jobs at Humana" resolves the employer by name, with no re-run;
#   S7  "visa sponsorship software engineer" searches the role, with the note
#       that the board cannot filter by sponsorship;
#   S8  "visa sponsorship" alone searches nothing rather than every job;
#   L1  check_jobs_open reads a pasted ?job= link as the open posting it names,
#       and lists what is no job id in unknown, never closed;
#   L2  an employer's EU Greenhouse link is checked as the eu~ id the board
#       holds;
#   G1  get_jobs with descriptions answers within 15,000 characters;
#   G2  get_jobs for more than 3 ids sends cards without descriptions by
#       default, and says so;
#   C1  ChatGPT's search titles are at most 120 characters and carry more
#       than the title (employer, place, the employer's date);
#   Z1  a ZIP code that found nothing gets a hint, never a bare zero.
#
# WHAT WAITS FOR WHAT. Every claim waits for agent-mcp.2026-11-08.1 and prints
# INFO until it serves.
#
# READ-ONLY. One OPTIONS preflight; two job-board list reads with x-rb-budget:
# probe for live ids; thirteen keyless agent-mcp reads (search_jobs, search,
# check_jobs_open, get_jobs), five seconds apart so the keyless per-minute cap
# is not what answers. Nothing is written, sent or pinged.
echo "== 99zzzz. connect W1 and W3: a search read as people type it, every job link read, answers a model can read =="

rm -f /tmp/vd_99cs_*.json /tmp/vd_99cs_*.txt

VD99CS_MCP=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/agent-mcp" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD99CS_LIVE=0
if [ -z "$VD99CS_MCP" ]; then echo "FAIL  agent-mcp preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge agent-mcp "$VD99CS_MCP" "2026-11-08" "1"; then echo "PASS  agent-mcp preflight x-fn-build = $VD99CS_MCP (agent-mcp.2026-11-08.1 or later: the query reader and the job-link reader)"; VD99CS_LIVE=1
else echo "INFO  agent-mcp preflight x-fn-build = $VD99CS_MCP: agent-mcp.2026-11-08.1 is not serving yet, so S1-S8, L1-L2, G1-G2, C1 and Z1 wait for it"; fi

VD99CS_N=0
# vd99cs_call OUT TOOL ARGS_JSON [chatgpt]: one keyless tools/call, spaced.
vd99cs_call() {
  local body="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}"
  [ "$VD99CS_N" -gt 0 ] && sleep 5
  if [ "${4:-}" = chatgpt ]; then MC -H "user-agent: openai-mcp/1.0 (ChatGPT)" -d "$body" > "$1"
  else MC -d "$body" > "$1"; fi
  VD99CS_N=$((VD99CS_N+1))
}

if [ "$VD99CS_LIVE" = 1 ]; then
  # Live ids: six Greenhouse postings, and one EU-region Greenhouse posting.
  J '{"action":"list","vendor":"greenhouse","q":"software engineer","limit":6,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_99cs_gh.json
  J '{"action":"list","companies":["eu~imc","eu~lookers"],"limit":3,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_99cs_eu.json
  VD99CS_IDS=$(node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync("/tmp/vd_99cs_gh.json","utf8"))}catch{}process.stdout.write((j.jobs||[]).filter((x)=>x&&x.source==="greenhouse"&&typeof x.id==="string").map((x)=>x.id).slice(0,6).join(" "))')
  VD99CS_EU=$(node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync("/tmp/vd_99cs_eu.json","utf8"))}catch{}const r=(j.jobs||[]).find((x)=>x&&typeof x.id==="string"&&/^greenhouse:eu~[^:]+:\d+$/.test(x.id));process.stdout.write(r?r.id:"")')
  VD99CS_ID1=${VD99CS_IDS%% *}
  VD99CS_JSON6=$(VD99CS_IDS="$VD99CS_IDS" node -e 'process.stdout.write(JSON.stringify((process.env.VD99CS_IDS||"").split(" ").filter(Boolean)))')
  VD99CS_JSON4=$(VD99CS_IDS="$VD99CS_IDS" node -e 'process.stdout.write(JSON.stringify((process.env.VD99CS_IDS||"").split(" ").filter(Boolean).slice(0,4)))')
  VD99CS_LINKS=$(VD99CS_ID1="$VD99CS_ID1" VD99CS_EU="$VD99CS_EU" node -e 'const e=process.env;const out=[];if(e.VD99CS_ID1)out.push("https://resumebooster.work/jobs?job="+encodeURIComponent(e.VD99CS_ID1));out.push("not-an-id");const m=/^greenhouse:eu~([^:]+):(\d+)$/.exec(e.VD99CS_EU||"");if(m)out.push("https://job-boards.eu.greenhouse.io/"+m[1]+"/jobs/"+m[2]);process.stdout.write(JSON.stringify(out))')

  vd99cs_call /tmp/vd_99cs_s1.json search_jobs '{"query":"registered nurse jobs Austin TX"}'
  vd99cs_call /tmp/vd_99cs_s2.json search_jobs '{"query":"Customer Service TX"}'
  vd99cs_call /tmp/vd_99cs_s3.json search_jobs '{"query":"software engineer","location":"London, UK"}'
  vd99cs_call /tmp/vd_99cs_s4.json search_jobs '{"query":"part-time jobs near Manchester UK"}'
  vd99cs_call /tmp/vd_99cs_s5.json search_jobs '{"query":"marketing jobs posted this week"}'
  vd99cs_call /tmp/vd_99cs_s6.json search_jobs '{"query":"jobs at Humana"}'
  vd99cs_call /tmp/vd_99cs_s7.json search_jobs '{"query":"visa sponsorship software engineer"}'
  vd99cs_call /tmp/vd_99cs_s8.json search_jobs '{"query":"visa sponsorship"}'
  vd99cs_call /tmp/vd_99cs_l.json check_jobs_open "{\"ids\":$VD99CS_LINKS}"
  [ -n "$VD99CS_IDS" ] && vd99cs_call /tmp/vd_99cs_g1.json get_jobs "{\"ids\":$VD99CS_JSON6,\"includeDescription\":true}"
  [ -n "$VD99CS_IDS" ] && vd99cs_call /tmp/vd_99cs_g2.json get_jobs "{\"ids\":$VD99CS_JSON4}"
  vd99cs_call /tmp/vd_99cs_c1.json search '{"query":"software engineer"}' chatgpt
  vd99cs_call /tmp/vd_99cs_z1.json search_jobs '{"query":"registered nurse","location":"78701"}'

  VD99CS_ID1="$VD99CS_ID1" VD99CS_EU="$VD99CS_EU" VD99CS_IDS="$VD99CS_IDS" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const raw=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const res=(f)=>{let j=null;try{j=JSON.parse(raw(f))}catch{}const r=(j&&j.result)||null;if(!r)return null;const text=String(((r.content||[])[0]||{}).text||"");let sc=r.structuredContent;if(!sc){try{sc=JSON.parse(text)}catch{sc={}}}return {r,sc,text}};
// A claim judged on one answer; a refusal for the minute or the day is INFO, never a verdict on the build.
const judge=(tag,f,fn)=>{const x=res(f);if(!x){ok(false,tag+" answered no result: "+JSON.stringify(raw(f).slice(0,160)));return}
  if(x.r.isError&&/allowance is spent|Too many keyless calls/.test(x.text)){info(tag+" refused by the keyless allowance, not judged: "+x.text.slice(0,120));return}
  if(x.r.isError){ok(false,tag+" refused: "+x.text.slice(0,160));return}fn(x.sc)};
const li=(sc)=>sc.locationInterpreted||{};const E=process.env;
judge("S1","/tmp/vd_99cs_s1.json",(sc)=>{const l=li(sc);
  ok(l.query==="registered nurse"&&l.location==="Austin, TX","S1 \"registered nurse jobs Austin TX\" read as "+JSON.stringify({query:l.query,location:l.location})+" (want registered nurse in Austin, TX)")});
judge("S2","/tmp/vd_99cs_s2.json",(sc)=>{const l=sc.locationInterpreted;
  ok(Array.isArray(sc.jobs)&&!(l&&/service/i.test(String(l.location||""))),"S2 \"Customer Service TX\" read as "+(l?JSON.stringify({query:l.query,location:l.location}):"the query as typed")+" (want no town called Service)")});
judge("S3","/tmp/vd_99cs_s3.json",(sc)=>{const l=li(sc);
  ok(l.location==="London"&&l.country==="GB"&&l.locationSent==="London, UK","S3 location \"London, UK\" searched as "+JSON.stringify({location:l.location,country:l.country,locationSent:l.locationSent})+" (want London in GB, said back)")});
judge("S4","/tmp/vd_99cs_s4.json",(sc)=>{const l=li(sc);
  ok(l.location==="Manchester"&&l.country==="GB","S4 \"part-time jobs near Manchester UK\" read as "+JSON.stringify({query:l.query,location:l.location,country:l.country})+" (want Manchester in GB)")});
judge("S5","/tmp/vd_99cs_s5.json",(sc)=>{const l=li(sc);
  ok(l.maxAgeDays===7&&l.query==="marketing","S5 \"marketing jobs posted this week\" read as "+JSON.stringify({query:l.query,maxAgeDays:l.maxAgeDays})+" (want marketing within 7 days)")});
judge("S6","/tmp/vd_99cs_s6.json",(sc)=>{const l=li(sc);const lifted=JSON.stringify(l.companies)==="[\"Humana\"]";
  const unread=[sc.companiesUnresolved,sc.unknownCompanies,sc.companiesNotLookedUp].some((v)=>Array.isArray(v)?v.length>0:!!v);
  if(lifted&&sc.employerNote&&unread){info("S6 the board resolves no employer called Humana today ("+String(sc.employerNote).slice(0,100)+"), so the query was searched as typed: a catalogue fact, not this build");return}
  ok(lifted&&!sc.employerNote&&Array.isArray(sc.companiesResolved)&&sc.companiesResolved.length>0,"S6 \"jobs at Humana\": companies "+JSON.stringify(l.companies)+", resolved "+JSON.stringify(sc.companiesResolved||null).slice(0,100)+", "+(sc.jobs||[]).length+" rows (want Humana resolved by name, no re-run as typed)")});
judge("S7","/tmp/vd_99cs_s7.json",(sc)=>{const l=li(sc);
  ok(l.query==="software engineer"&&/cannot filter by visa sponsorship/.test(String(sc.sponsorshipNote||"")),"S7 \"visa sponsorship software engineer\" searched "+JSON.stringify(l.query)+", sponsorshipNote "+(sc.sponsorshipNote?"present":"absent")+" (want software engineer, with the note)")});
judge("S8","/tmp/vd_99cs_s8.json",(sc)=>{
  ok(sc.notSearched===true&&Array.isArray(sc.jobs)&&sc.jobs.length===0&&sc.total===undefined,"S8 \"visa sponsorship\" alone: notSearched "+JSON.stringify(sc.notSearched)+", "+(Array.isArray(sc.jobs)?sc.jobs.length:"no")+" rows, total "+JSON.stringify(sc.total)+" (want nothing searched rather than every job)")});
judge("L1","/tmp/vd_99cs_l.json",(sc)=>{
  const unk=Array.isArray(sc.unknown)&&sc.unknown.includes("not-an-id")&&!(sc.closed||[]).includes("not-an-id");
  if(!E.VD99CS_ID1){ok(unk,"L1 the board answered no Greenhouse posting to paste; not-an-id is listed "+(unk?"in unknown":"elsewhere")+" (want unknown, never closed)");return}
  const link="https://resumebooster.work/jobs?job="+encodeURIComponent(E.VD99CS_ID1);const open=sc.open||{};const read=(sc.readAs||{})[link]===E.VD99CS_ID1;
  // Read as its posting but not open: the posting closed between the list and the check.
  if(read&&unk&&open[link]===false){info("L1 the pasted link was read as "+E.VD99CS_ID1+", which closed between the list and the check; not-an-id is in unknown");return}
  ok(read&&open[link]===true&&unk,"L1 a pasted ?job= link: read as "+JSON.stringify((sc.readAs||{})[link])+", open "+JSON.stringify(open[link])+"; not-an-id "+(unk?"in unknown":"NOT in unknown")+" (want the posting id, open, and unknown)")});
judge("L2","/tmp/vd_99cs_l.json",(sc)=>{
  if(!E.VD99CS_EU){info("L2 the board answered no EU-region Greenhouse posting (eu~imc, eu~lookers) to paste");return}
  const m=/^greenhouse:eu~([^:]+):(\d+)$/.exec(E.VD99CS_EU);const link="https://job-boards.eu.greenhouse.io/"+m[1]+"/jobs/"+m[2];
  if((sc.readAs||{})[link]===E.VD99CS_EU&&(sc.open||{})[link]===false){info("L2 the EU link was read as "+E.VD99CS_EU+", which closed between the list and the check");return}
  ok((sc.readAs||{})[link]===E.VD99CS_EU&&(sc.open||{})[link]===true,"L2 an EU Greenhouse link "+link+" read as "+JSON.stringify((sc.readAs||{})[link])+", open "+JSON.stringify((sc.open||{})[link])+" (want "+E.VD99CS_EU+", open)")});
if(!E.VD99CS_IDS){info("G1 and G2: the board answered no Greenhouse postings to read")}else{
judge("G1","/tmp/vd_99cs_g1.json",(sc)=>{const jobs=sc.jobs||[];const total=jobs.reduce((a,j)=>a+(typeof j.description==="string"?j.description.length:0),0);
  if(total>15000){ok(false,"G1 get_jobs with descriptions answered "+total+" characters of description over "+jobs.length+" postings (want at most 15,000)");return}
  if(sc.truncatedForSize!==true){info("G1 the "+jobs.length+" descriptions came to "+total+" characters uncut, so the 15,000 budget had nothing to cut");return}
  ok(total>0,"G1 get_jobs with descriptions: "+total+" characters over "+jobs.length+" postings, cut to fit (want at most 15,000)")});
judge("G2","/tmp/vd_99cs_g2.json",(sc)=>{const jobs=sc.jobs||[];const withText=jobs.filter((j)=>typeof j.description==="string"&&j.description.length>0).length;
  ok(jobs.length>0&&withText===0&&/Cards only/.test(String(sc.descriptionsOmitted||"")),"G2 get_jobs for "+jobs.length+" ids by default: "+withText+" with a description, descriptionsOmitted "+(sc.descriptionsOmitted?"present":"absent")+" (want cards only, said)")})}
judge("C1","/tmp/vd_99cs_c1.json",(sc)=>{const rs=sc.results||[];
  if(!rs.length){info("C1 ChatGPT\x27s search answered no results to measure");return}
  const long=rs.filter((r)=>String(r.title||"").length>120);const rich=rs.filter((r)=>String(r.title||"").includes(" — "));
  ok(long.length===0&&rich.length>0,"C1 ChatGPT\x27s search: "+rs.length+" titles, longest "+Math.max(...rs.map((r)=>String(r.title||"").length))+" characters, "+rich.length+" carrying the employer, place or date (want at most 120, and more than the title)")});
judge("Z1","/tmp/vd_99cs_z1.json",(sc)=>{
  if(Array.isArray(sc.jobs)&&sc.jobs.length){info("Z1 location 78701 matched "+sc.jobs.length+" rows today, so there was no empty answer to hint on");return}
  ok(sc.locationUnrecognised===true&&/ZIP/.test(String(sc.locationHint||"")),"Z1 location 78701 that found nothing: locationHint "+JSON.stringify(String(sc.locationHint||"").slice(0,90))+" (want the ZIP hint, not a bare zero)")});'
else
  echo "INFO  S1-S8, L1-L2, G1-G2, C1 and Z1 wait for agent-mcp.2026-11-08.1"
fi
