# job-board .91 -- wave 2 of the 2026-10-04 platform sweep, job-board group
# (docs/job-board-deploy-notes.md, 2026-09-09.91). Sourced by
# scripts/verify-deploy.sh. Read-only: status, a preflight, list /
# company-suggest / exists reads with x-rb-budget: probe (a list logs one
# search event, as every list probe in this script does). Never verify,
# report, click or a refresh. Every .91 behaviour line is INFO until
# status.version is .91 or later; the ranked-path state-code line also needs
# migration 20261008100200 and says so.
echo "== 61. job-board .91 (wave 2): state codes, routes under filters, the pay order, symbol counts, floors, chips, OR, typeahead, country, audit, cursor step =="
J '{"action":"status"}' > /tmp/vd_61_status.json
curl -s -m 30 -o /dev/null -D /tmp/vd_61_preflight.txt -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
VD61_FB=$(tr -d '\r' < /tmp/vd_61_preflight.txt | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD61_FB" ]; then echo "FAIL  job-board preflight carries no x-fn-build"
elif build_ge job-board "$VD61_FB" 2026-09-09 91; then echo "PASS  job-board preflight x-fn-build = $VD61_FB (job-board.2026-09-09.91 or later)"
else echo "FAIL  job-board preflight x-fn-build = $VD61_FB (want job-board.2026-09-09.91 or later; over the ~4.5 MB raw-source cap the old bundle keeps serving)"; fi
B="$B" K="$K" node -e '(async()=>{
const fs=require("fs");const {B,K}=process.env;
const H={"Content-Type":"application/json","x-rb-budget":"probe",apikey:K,Authorization:"Bearer "+K};
const call=async(body)=>{try{const r=await fetch(B+"/functions/v1/job-board",{method:"POST",headers:H,body:JSON.stringify(body)});return await r.json()}catch(e){return {err:String(e).slice(0,100)}}};
const list=(b)=>call({action:"list",groupSimilar:false,includeFacets:false,limit:60,...b});
let st={};try{st=JSON.parse(fs.readFileSync("/tmp/vd_61_status.json","utf8"))}catch{}
const m=/^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(st.version||""));
const v91=!!m&&(m[1]>"2026-09-09"||(m[1]==="2026-09-09"&&Number(m[2])>=91));
console.log((v91?"PASS":"FAIL")+"  status.version = "+st.version+" (want 2026-09-09.91 or later; every .91 line below is INFO until it is)");
const late=(c,msg)=>console.log((c?"PASS":(v91?"FAIL":"INFO"))+"  "+msg);
const info=(msg)=>console.log("INFO  "+msg);
const bad=(r)=>!r||r.err||r.error;
const rows=(r)=>Array.isArray(r&&r.jobs)?r.jobs:[];
// L13-01 on browse (the bundle) and on the ranked path (migration 20261008100200).
for(const [place,foreign,was] of [["Maine","MX","32 of 60 on .87, 21 on .90 2026-10-08"],["Indiana","IN","48 of 60 on .90 2026-10-08"],["Delaware","DE","22 of 60 on .90 2026-10-08"]]){
  const r=await list({location:place});
  if(bad(r)){info("L13-01 browse location="+place+": unreadable ("+(r&&(r.err||r.error))+")");continue}
  const f=rows(r).filter((j)=>j.country===foreign).length;
  late(f===0,"L13-01 browse location="+place+": "+f+" of "+rows(r).length+" rows carry country "+foreign+" (want 0; was "+was+"), total "+r.total);
}
// L13-01 residual: a text-derived "Munich, DE" / "Pune, IN" is stored US and still matches (detectCountry follow-up).
{const city={DE:/\b(berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|dusseldorf|leipzig|dresden)\b/i,IN:/\b(bangalore|bengaluru|pune|chennai|hyderabad|mumbai|gurgaon|gurugram|noida|delhi|kolkata|ahmedabad)\b/i};
  const resid=(j,c)=>{const l=String(j.location||"");const m=new RegExp(", "+c+"($|[^A-Za-z])").exec(l);return !!m&&city[c].test(l.slice(0,m.index))&&j.country!==c};
  for(const [q,place,c] of [["Berlin","Delaware","DE"],["Munich","Delaware","DE"],["Pune","Indiana","IN"],["Chennai","Indiana","IN"]]){
    const r=await list({q,location:place});
    if(bad(r)){info("L13-01 residual q="+q+" location="+place+": unreadable");continue}
    const hit=rows(r).filter((j)=>resid(j,c));
    info("L13-01 residual q="+q+" location="+place+": "+hit.length+" of "+rows(r).length+" rows read \""+q+"..., "+c+"\" stored as "+JSON.stringify([...new Set(hit.map((j)=>j.country))])+" (text-derived country; nonzero until detectCountry reads the city before the code), e.g. "+JSON.stringify(hit.slice(0,2).map((j)=>j.location)))}}
{const r=await list({q:"nurse",location:"Maine"});
  if(bad(r))info("L13-01 ranked q=nurse location=Maine: unreadable");
  else{const f=rows(r).filter((j)=>j.country==="MX").length;
    console.log((f===0?"PASS":"INFO")+"  L13-01 ranked q=nurse location=Maine: "+f+" MX rows of "+rows(r).length+" (0 once migration 20261008100200 is applied; INFO, since anon cannot read whether it is)")}}
// L8-04: a filter keeps the route.
{const r=await list({q:"it manager",country:"GB"});
  late(!bad(r)&&r.searchRoute==="SIMPLE","L8-04 q=\"it manager\" country=GB: searchRoute="+(r&&r.searchRoute)+" (want SIMPLE; .90 stood the router down), first titles "+JSON.stringify(rows(r).slice(0,3).map((j)=>j.title)))}
// L8-01 / L8-02: the pay order.
{const r=await list({q:"rn",country:"US",sort:"salary"});
  late(!bad(r)&&r.searchRoute==="SALARY","L8-01 q=rn country=US sort=salary: searchRoute="+(r&&r.searchRoute)+" (want SALARY, never the substring path), first titles "+JSON.stringify(rows(r).slice(0,3).map((j)=>j.title)))}
{const r=await list({q:"dominos",sort:"salary"});
  late(!bad(r)&&r.searchRoute==="SALARY"&&r.companyMatched==="Domino\x27s","L8-02 q=dominos sort=salary: searchRoute="+(r&&r.searchRoute)+", companyMatched="+(r&&r.companyMatched)+" (want SALARY over Domino\x27s own tokens)")}
{const r=await list({q:"rn",country:"US",sort:"salary",countOnly:true});
  late(!bad(r)&&r.total===null&&r.countUnavailable===true,"L8-01 countOnly sort=salary: total="+(r&&r.total)+" countUnavailable="+(r&&r.countUnavailable)+" (want null/true, never the substring count)")}
// L8-17: symbols and pay figures.
{const a=await list({q:"c#"});const b=await list({q:"c++"});
  const ok=(r)=>!bad(r)&&r.total===null&&r.countUnavailable===true;
  late(ok(a)&&ok(b),"L8-17 q=c# / q=c++: totals "+(a&&a.total)+" / "+(b&&b.total)+", floors "+(a&&a.totalAtLeast)+" / "+(b&&b.totalAtLeast)+" (want null with countUnavailable; .90 published the bare letter\x27s count, 2,067, for both)")}
for(const q of ["new grad 2026","401k","1099 sales"]){const r=await list({q,limit:1});
  late(!bad(r)&&r.salaryFromQuery===undefined,"L8-17 q=\""+q+"\": salaryFromQuery="+(r&&r.salaryFromQuery)+" (want absent: not a pay floor)")}
{const r=await list({q:"100k engineer",limit:1});
  console.log((!bad(r)&&r.salaryFromQuery===100000?"PASS":"FAIL")+"  L8-17 q=\"100k engineer\": salaryFromQuery="+(r&&r.salaryFromQuery)+" (want 100000: a real figure still lifts)")}
// L8-16: a deep page keeps the exact count.
{const a=await list({q:"nurse",country:"GB"});const d=await list({q:"nurse",country:"GB",offset:400});
  if(bad(a)||bad(d)||typeof a.total!=="number")info("L8-16 q=nurse GB: no exact total at offset 0 ("+(a&&a.total)+"), nothing to hold the deep page to");
  else{const over=d.total===null&&typeof d.totalAtLeast==="number"&&d.totalAtLeast>a.total;
    late(!over,"L8-16 q=nurse GB: offset 0 total "+a.total+", offset 400 total "+d.total+" totalAtLeast "+d.totalAtLeast+" (want no floor above the exact count; .87 said 460 over 314)")}}
// L13-24: chips under a text query.
{const r=await call({action:"list",q:"rn",country:"US",facetCounts:true});
  late(!bad(r)&&r.facetSource==="withheld","L13-24 facetCounts q=rn US: facetSource="+(r&&r.facetSource)+", "+Object.keys((r&&r.categories)||{}).length+" categories numbered (want withheld; .87 said legal 1,159 over a list of 8)")}
// L8-07: OR.
{const r=await list({q:"welder OR fabricator",limit:1});
  const d=Array.isArray(r&&r.droppedTerms)?r.droppedTerms:[];
  late(!bad(r)&&!d.includes("or"),"L8-07 q=\"welder OR fabricator\": droppedTerms "+JSON.stringify(d)+", total "+(r&&r.total)+" (want \"or\" not dropped; .87 answered 54 as an AND)")}
// L8-08: typeahead.
{const r=await call({action:"company-suggest",q:"dominos"});
  const n=Array.isArray(r&&r.companies)?r.companies.map((c)=>c.name):[];
  late(n.some((x)=>/domino/i.test(String(x))),"L8-08 company-suggest q=dominos: "+JSON.stringify(n.slice(0,3))+" (want Domino\x27s)")}
// L8-10 / L13-68: values named, not answered with zero.
{const uk=await list({q:"nurse",country:"UK",limit:1});const gb=await list({q:"nurse",country:"GB",limit:1});const xx=await list({q:"nurse",country:"XX",limit:1});
  const ig=(r)=>Array.isArray(r&&r.ignoredFilters)?r.ignoredFilters:[];
  late(!bad(uk)&&!ig(uk).includes("country")&&uk.total===gb.total,"L8-10 country=UK: total "+(uk&&uk.total)+" vs GB "+(gb&&gb.total)+", ignored "+JSON.stringify(ig(uk))+" (want UK read as GB)");
  late(ig(xx).includes("country"),"L8-10 country=XX: ignoredFilters "+JSON.stringify(ig(xx))+" (want country named)")}
{const r=await list({q:"nurse",maxAgeDays:1.5,limit:1});
  const ig=Array.isArray(r&&r.ignoredFilters)?r.ignoredFilters:[];
  late(ig.includes("maxAgeDays")&&!r.rankedFellBack,"L13-68 maxAgeDays=1.5: ignoredFilters "+JSON.stringify(ig)+", rankedFellBack "+(r&&r.rankedFellBack)+" (want named, ranking intact)")}
// L1-07: the audit.
{const fa=st.filterAudit||{};
  if(!("incomplete" in fa))info("L1-07 status.filterAudit has no incomplete key yet (absent before .91, then null until the next daily audit runs)");
  else{const f=Array.isArray(fa.findings)?fa.findings:[];const rl=f.filter((x)=>/RateLimitError/.test(String(x.detail||""))&&x.kind!=="throttled").length;
    const fresh=String(fa.at||"")>"2026-10-08";
    (fresh?late:((c,msg)=>info(msg)))(rl===0,"L1-07 filterAudit at "+fa.at+": "+rl+" RateLimitError findings not called throttled, throttledCases "+fa.throttledCases+", incomplete "+fa.incomplete+" (want 0; judged on an audit run after 2026-10-08)")}}
// (c): the cursor step.
{const cs=(st.sliceStats||{}).cursorStep;
  if(cs===undefined)late(false,"(c) sliceStats.cursorStep absent (want present on .91: null on a hot slice, {from,admitted,to,base,started} on a cold one)");
  else if(cs===null)info("(c) sliceStats.cursorStep null: the last slice was hot; re-run during the cold phase");
  else{const n=Number(st.coldBoards)||Number((st.cursor||{}).coldBoards)||0;const want=n?(cs.from+cs.started)%n:cs.from+cs.started;
    late(cs.to===want||cs.to===cs.from+cs.started,"(c) cursorStep "+JSON.stringify(cs)+": to = from + started (the admitted value is the optimistic write a poll can see first)")}}
// (a): SNOWFLAKE-3, judged by what is stored now (the board may have unlisted them).
{const ids=["ashby:snowflake:66eeda70-4d91-43a4-bb84-998c26f329f5","ashby:snowflake:37033502-bd37-4f77-a92e-9b7934998857","ashby:snowflake:132a2e95-7ec0-488c-94d2-b0917c597ef9"];
  const r=await call({action:"exists",ids});const o=(r&&r.open)||{};
  info("(a) SNOWFLAKE-3 stored: "+ids.map((i)=>i.slice(16,24)+"="+o[i]).join(" ")+" (all three were inserted by .90 at 2026-10-08T02:00:57Z with their feed dates unchanged, so the 10-07 refusal was transient and not a tombstone; the service-role read in the .91 note settles it)")}
info("(b) per-board stamps: no anon probe (job_board_verifications and get_stalest_boards are closed to anon); 48h after the migration, a deferred shared twin\x27s rows its feed no longer lists stop carrying a recheckedAt newer than its own last read");
})()'
