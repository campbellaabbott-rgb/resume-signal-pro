# shellcheck shell=bash
# ── 92. WAVE 4 ROUND 2, JOB-BOARD: the S12 search, ingest and parser fixes
# (branch w4b/job-board; docs/job-board-deploy-notes.md "## 2026-09-09.93",
# its "Wave 4 round 2" block).
#
# job-board keeps the build string 2026-09-09.93 for this round (.93 has never
# deployed), so the build line alone cannot tell round 1 from round 2. The
# round's own tell is the offset refusal (S12-122): a .93 that answers an
# anonymous offset past 10,000 with rows is round 1 without round 2, and every
# claim below it is then INFO, not FAIL.
#
# THE CLAIMS, one line each below:
#   - job-board serves 2026-09-09.93 or later, and an anonymous offset past
#     10,000 answers 400 offset_too_deep (S12-122);
#   - a body that is not a JSON object answers 400, and an over-long exists id
#     answers not-open with 200 (S12-123);
#   - a q that is not text, or that is only a NUL, is named in ignoredFilters
#     and the list is still served (S12-124);
#   - 'cvs' and 'UPS' take the employer route and their rows are that
#     employer's (S12-014);
#   - 'accountant' takes the SIMPLE route and its first page is accountants,
#     not account managers (S12-018);
#   - 'nurse not night shift' serves no night-shift title, and 'driver
#     -"box truck"' no box-truck title (S12-017);
#   - 'nurse jobs not in Texas' does not lift Texas into the location filter
#     (S12-172);
#   - the pay order's first page is full (S12-035);
#   - the names step of the last pass-end tail says how far it got, and never
#     reads ok while boards wait (S12-015, S12-084);
#   - parse-pdf, parse-docx and fetch-job-posting serve 2026-10-11.26 or later
#     (S12-027, S12-028, S12-038, S12-128).
# INFO only: the experience, salary and country re-derivations (S12-013,
# S12-019, S12-037) run over the rotation after the deploy, so their lines
# print counts to watch, not a verdict.
#
# READ-ONLY. job-board list, exists and status reads on the probe budget, and
# OPTIONS preflights. No write, no maintenance action, no metered fetch.
echo "== 92. wave 4 round 2 job-board: search as typed, refusals that are not 500s, the names cursor =="

VD92_JB=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD92_LIVE=0
if [ -z "$VD92_JB" ]; then echo "FAIL  job-board preflight carries no x-fn-build"
elif build_ge job-board "$VD92_JB" "2026-09-09" "93"; then echo "PASS  job-board preflight x-fn-build = $VD92_JB (job-board.2026-09-09.93 or later)"; VD92_LIVE=1
else echo "FAIL  job-board preflight x-fn-build = $VD92_JB (want job-board.2026-09-09.93 or later: neither wave 4 round is serving)"; fi

# The round's own tell: an anonymous offset past the ceiling.
VD92_OFF=$(curl -s -m 60 -o /tmp/vd_92_offset.json -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","q":"nurse","offset":10001,"limit":1}')
VD92_R2=0
if [ "$VD92_LIVE" = "1" ]; then
  if [ "$VD92_OFF" = "400" ] && grep -q '"offset_too_deep"' /tmp/vd_92_offset.json; then echo "PASS  an anonymous offset of 10,001 answers 400 offset_too_deep (the round 2 code is serving)"; VD92_R2=1
  else echo "FAIL  an anonymous offset of 10,001 answers $VD92_OFF $(head -c 120 /tmp/vd_92_offset.json) (want 400 offset_too_deep: .93 is serving without wave 4 round 2, S12-122)"; fi
else echo "INFO  the offset refusal is not judged: .93 is not serving (answered $VD92_OFF)"; fi

# S12-123: malformed bodies are 400s, an over-long id is not open.
VD92_NULL=$(curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d 'null')
VD92_ARR=$(curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '[1]')
VD92_LONG=$(node -e 'process.stdout.write("greenhouse:vd92:"+"x".repeat(400))')
VD92_EX=$(curl -s -m 60 -o /tmp/vd_92_exists.json -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d "{\"action\":\"exists\",\"ids\":[\"$VD92_LONG\"]}")

# S12-124, S12-014, S12-018, S12-017, S12-172, S12-035: list reads.
J '{"action":"list","q":123,"limit":1}' > /tmp/vd_92_qnum.json
J '{"action":"list","q":"\u0000","limit":1}' > /tmp/vd_92_qnul.json
J '{"action":"list","q":"cvs","limit":20}' > /tmp/vd_92_cvs.json
J '{"action":"list","q":"UPS","limit":20}' > /tmp/vd_92_ups.json
J '{"action":"list","q":"accountant","limit":20}' > /tmp/vd_92_acct.json
J '{"action":"list","q":"nurse not night shift","limit":60}' > /tmp/vd_92_night.json
J '{"action":"list","q":"driver -\"box truck\"","limit":60}' > /tmp/vd_92_box.json
J '{"action":"list","q":"nurse jobs not in Texas","limit":20}' > /tmp/vd_92_nottx.json
J '{"action":"list","q":"cashier","sort":"salary","limit":60}' > /tmp/vd_92_pay.json
J '{"action":"list","q":"cashier","experience":["expert"],"limit":5}' > /tmp/vd_92_exp.json
J '{"action":"list","q":"Red Deer","country":"US","limit":20}' > /tmp/vd_92_reddeer.json
J '{"action":"list","sort":"salary","limit":60}' > /tmp/vd_92_paytop.json
J '{"action":"status"}' > /tmp/vd_92_status.json

VD92_LIVE="$VD92_LIVE" VD92_R2="$VD92_R2" VD92_NULL="$VD92_NULL" VD92_ARR="$VD92_ARR" VD92_EX="$VD92_EX" VD92_LONG="$VD92_LONG" node -e '
const fs=require("fs");
const r2=process.env.VD92_R2==="1";
const ok=(c,m)=>console.log((c?"PASS":(r2?"FAIL":"INFO"))+"  "+m+(c||r2?"":" (not judged: round 2 is not serving)"));
const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const rows=(j)=>(j&&Array.isArray(j.jobs))?j.jobs:[];
const n=(j)=>j&&typeof j.total==="number"?j.total:(j&&typeof j.totalAtLeast==="number"?j.totalAtLeast:null);

// S12-123
ok(process.env.VD92_NULL==="400"&&process.env.VD92_ARR==="400","a body of null answers "+process.env.VD92_NULL+" and a body of [1] answers "+process.env.VD92_ARR+" (want 400 and 400, not 500)");
const ex=rd("/tmp/vd_92_exists.json");
ok(process.env.VD92_EX==="200"&&ex&&ex.open&&ex.open[process.env.VD92_LONG]===false,"exists with a 416-character id answers "+process.env.VD92_EX+" with it not open (want 200, false; it answered 500)");

// S12-124
for(const [f,label] of [["/tmp/vd_92_qnum.json","q: 123"],["/tmp/vd_92_qnul.json","q: a lone NUL"]]){
  const j=rd(f);const ig=(j&&j.ignoredFilters)||[];
  ok(!!j&&Array.isArray(j.jobs)&&ig.includes("q"),label+" is served ("+(j&&Array.isArray(j.jobs)?j.jobs.length+" row":JSON.stringify(j).slice(0,100))+") with q named in ignoredFilters ("+JSON.stringify(ig)+")");
}

// S12-014
for(const [f,word,re] of [["/tmp/vd_92_cvs.json","cvs",/cvs/i],["/tmp/vd_92_ups.json","UPS",/\bups\b|united parcel/i]]){
  const j=rd(f);const rs=rows(j);const theirs=rs.filter((r)=>re.test(String(r.company||""))||re.test(String(r.token||"")));
  if(!j||rs.length===0){ok(false,"q "+JSON.stringify(word)+" answered no rows ("+JSON.stringify(j).slice(0,120)+")");continue}
  ok(j.searchRoute==="EMPLOYER"&&theirs.length>=Math.ceil(0.8*rs.length),"q "+JSON.stringify(word)+" takes route "+j.searchRoute+" (want EMPLOYER) and "+theirs.length+" of its "+rs.length+" first rows are that employer (want 80% or more)");
}

// S12-018
{const j=rd("/tmp/vd_92_acct.json");const rs=rows(j);
 const acct=rs.filter((r)=>/accountan/i.test(String(r.title||"")));const mgr=rs.filter((r)=>/\baccount (manager|executive|director|representative)\b/i.test(String(r.title||""))&&!/accountan/i.test(String(r.title||"")));
 if(rs.length===0)ok(false,"q \"accountant\" answered no rows");
 else ok(j.searchRoute==="SIMPLE"&&mgr.length===0&&acct.length>=Math.ceil(0.8*rs.length),"q \"accountant\" takes route "+j.searchRoute+" (want SIMPLE): "+acct.length+" of "+rs.length+" first titles say accountant, "+mgr.length+" are account managers or executives (want 80% or more, and 0)"+(mgr.length?": "+mgr.slice(0,3).map((r)=>r.title).join(" | "):""));}

// S12-017
{const j=rd("/tmp/vd_92_night.json");const rs=rows(j);const bad=rs.filter((r)=>/night[- ]?shift/i.test(String(r.title||"")));
 if(rs.length===0)ok(false,"q \"nurse not night shift\" answered no rows (a lone \"not\" phrase must not empty the board)");
 else ok(bad.length===0,"q \"nurse not night shift\" serves "+rs.length+" rows, "+bad.length+" with night shift in the title (want 0)"+(bad.length?": "+bad.slice(0,3).map((r)=>r.title).join(" | "):""));
 const b=rd("/tmp/vd_92_box.json");const bs=rows(b);const bb=bs.filter((r)=>/box[- ]?trucks?/i.test(String(r.title||"")));
 if(bs.length===0)info("q driver -\"box truck\" answered no rows, so the phrase exclusion is not judged");
 else ok(bb.length===0,"q driver -\"box truck\" serves "+bs.length+" rows, "+bb.length+" with box truck in the title (want 0)"+(bb.length?": "+bb.slice(0,3).map((r)=>r.title).join(" | "):""));}

// S12-172
{const j=rd("/tmp/vd_92_nottx.json");const named=JSON.stringify((j&&j.intentFilters)||[]);
 if(!j)ok(false,"q \"nurse jobs not in Texas\" answered no JSON");
 else ok(!/texas|\btx\b/i.test(named),"q \"nurse jobs not in Texas\" lifts no Texas place (intentFilters "+named.slice(0,120)+"; "+(n(j)??"?")+" rows)");}

// S12-035
{const j=rd("/tmp/vd_92_pay.json");const rs=rows(j);
 if(!j||!Array.isArray(j.jobs))ok(false,"the cashier pay order answered no list ("+JSON.stringify(j).slice(0,120)+")");
 else if(j.hasMore===false&&rs.length<60)info("the cashier pay order holds "+rs.length+" rows and no more, so a full page is not owed");
 else ok(rs.length===60,"the cashier pay order fills its page: "+rs.length+" of 60 (route "+j.searchRoute+"; the folded page had 44)");}

// S12-015, S12-084
{const s=rd("/tmp/vd_92_status.json");const nm=s&&s.passEnd&&s.passEnd.steps&&s.passEnd.steps.names;
 if(process.env.VD92_LIVE!=="1"||!nm)info("the names step is not judged: "+(process.env.VD92_LIVE!=="1"?".93 is not serving":"status.passEnd carries no names receipt yet"));
 else{const d=String(nm.detail||"");const waiting=/(\d+) waiting/.exec(d);
  const honest=nm.ok===true?!(waiting&&Number(waiting[1])>0):true;
  ok(honest&&/name sync/i.test(d),"the last names step reads ok:"+nm.ok+(nm.hops?" after "+nm.hops+" hop(s)":"")+" with \""+d.slice(0,140)+"\" (want a receipt that says how far it got, and never ok while boards wait)");}}

// INFO: re-derivations that run over the rotation.
{const e=rd("/tmp/vd_92_exp.json");info("cashier postings filed Expert: "+(n(e)??"?")+" (S12-013: EXPERIENCE_VERSION 2 re-derives every stored row over the following passes; this should fall to near 0)");
 const rdr=rd("/tmp/vd_92_reddeer.json");const ab=rows(rdr).filter((r)=>/,\s*AB\b/.test(String(r.location||"")));info("\"Red Deer\" rows still filed in the US with an Alberta address: "+ab.length+" of "+rows(rdr).length+" (S12-037: COUNTRY_MAP_VERSION 10 re-files them over the rotation; want 0 once it has run)");
 const top=rd("/tmp/vd_92_paytop.json");const airbus=rows(top).filter((r)=>/airbus/i.test(String(r.company||""))&&/800/.test(String(r.salary||"")));info("the pay order first page holds "+airbus.length+" Airbus row(s) priced from a £350K-£800K placement (S12-019: SALARY_PARSE_VERSION 11 re-mines them; want 0 once it has run)");}'

for VD92_FN in parse-pdf parse-docx fetch-job-posting; do
  VD92_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD92_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD92_H" ]; then echo "FAIL  $VD92_FN preflight carries no x-fn-build (the previous bundle is still serving)"
  elif build_ge "$VD92_FN" "$VD92_H" "2026-10-11" "26"; then echo "PASS  $VD92_FN x-fn-build = $VD92_H ($VD92_FN.2026-10-11.26 or later)"
  else echo "FAIL  $VD92_FN x-fn-build = $VD92_H (want $VD92_FN.2026-10-11.26 or later: the S12 parser and link fixes are not serving)"; fi
done
echo "INFO  the link fetcher's Workday, Oracle, Workable and USAJOBS reads (S12-028, S12-038) and the .docx text box (S12-128) are metered or need an upload, so they are proved in the suite, not here"
