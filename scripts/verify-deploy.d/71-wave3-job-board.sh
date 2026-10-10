# job-board .92, job-fit and application-fit -- wave 3, job-board group
# (docs/job-board-deploy-notes.md, 2026-09-09.92). Sourced by
# scripts/verify-deploy.sh. Read-only: status, OPTIONS preflights, list reads
# with x-rb-budget: probe (each logs one search event, as every list probe in
# this script does), the anon get_company_suggest lookup the Explore page
# makes, and Workday's public CXS list for the S8-003 tenants. Never
# fit-batch (it spends a rate-limit row), verify, report, click or a refresh.
# Every .92 behaviour line is INFO until status.version is .92 or later; a
# line that needs a migration names it.
echo "== 71. job-board .92 (wave 3): Workday language, Teamtailor pages, federal feed, stemmed date/pay orders, cold cursor, employer routes and names, fit limits =="
J '{"action":"status"}' > /tmp/vd_71_status.json
for VD71_FN in job-board job-fit application-fit; do
  curl -s -m 30 -o /dev/null -D /tmp/vd_71_pf_$VD71_FN.txt -X OPTIONS "$B/functions/v1/$VD71_FN" -H "x-rb-budget: probe" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
  VD71_FB=$(tr -d '\r' < /tmp/vd_71_pf_$VD71_FN.txt | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  case "$VD71_FN" in job-board) VD71_D=2026-09-09; VD71_N=92;; *) VD71_D=2026-10-09; VD71_N=1;; esac
  if [ -z "$VD71_FB" ]; then echo "FAIL  $VD71_FN preflight carries no x-fn-build (want $VD71_FN.$VD71_D.$VD71_N or later; job-fit and application-fit had no stamp before .92's wave)"
  elif build_ge "$VD71_FN" "$VD71_FB" "$VD71_D" "$VD71_N"; then echo "PASS  $VD71_FN preflight x-fn-build = $VD71_FB ($VD71_FN.$VD71_D.$VD71_N or later)"
  else echo "FAIL  $VD71_FN preflight x-fn-build = $VD71_FB (want $VD71_FN.$VD71_D.$VD71_N or later; over the ~4.5 MB raw-source cap the old bundle keeps serving)"; fi
done
B="$B" K="$K" node -e '(async()=>{
const fs=require("fs");const {B,K}=process.env;
const H={"Content-Type":"application/json","x-rb-budget":"probe",apikey:K,Authorization:"Bearer "+K};
const call=async(body)=>{try{const r=await fetch(B+"/functions/v1/job-board",{method:"POST",headers:H,body:JSON.stringify(body)});const s=r.status;let j;try{j=await r.json()}catch{j={}}return {...j,_status:s}}catch(e){return {err:String(e).slice(0,100)}}};
const rpc=async(fn,args)=>{try{const r=await fetch(B+"/rest/v1/rpc/"+fn,{method:"POST",headers:{"Content-Type":"application/json",apikey:K,Authorization:"Bearer "+K},body:JSON.stringify(args)});return await r.json()}catch(e){return {err:String(e).slice(0,100)}}};
const list=(b)=>call({action:"list",groupSimilar:false,includeFacets:false,limit:60,...b});
let st={};try{st=JSON.parse(fs.readFileSync("/tmp/vd_71_status.json","utf8"))}catch{}
const m=/^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(st.version||""));
const v92=!!m&&(m[1]>"2026-09-09"||(m[1]==="2026-09-09"&&Number(m[2])>=92));
console.log((v92?"PASS":"FAIL")+"  status.version = "+st.version+" (want 2026-09-09.92 or later; every .92 line below is INFO until it is)");
const late=(c,msg)=>console.log((c?"PASS":(v92?"FAIL":"INFO"))+"  "+msg);
const soft=(c,msg)=>console.log((c?"PASS":"INFO")+"  "+msg);
const info=(msg)=>console.log("INFO  "+msg);
const bad=(r)=>!r||r.err||r.error;
const rows=(r)=>Array.isArray(r&&r.jobs)?r.jobs:[];
try{
// S8-003: what the tenants answer (their public CXS list), then what the board holds of them.
const T=[["truist","wd1","careers"],["geico","wd1","External"],["7eleven","wd3","7eleven"],["wvumedicine","wd1","UHA"]];
for(const [t,w,s] of T){
  const ask=async(lang)=>{try{const r=await fetch("https://"+t+"."+w+".myworkdayjobs.com/wday/cxs/"+t+"/"+s+"/jobs",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json","Accept-Language":lang},body:JSON.stringify({appliedFacets:{},limit:1,offset:0,searchText:""})});let j={};try{j=await r.json()}catch{}return r.status+(typeof j.total==="number"?" total "+j.total:"")}catch(e){return "unreachable"}};
  info("S8-003 "+t+"~"+w+"~"+s+" public CXS list: Accept-Language * -> "+(await ask("*"))+", en-US -> "+(await ask("en-US,en;q=0.9"))+" (measured 2026-10-08: 500 under *, 200 under en-US)");
  const r=await list({companies:[t+"~"+w+"~"+s],limit:1});
  soft(!bad(r)&&typeof r.total==="number"&&r.total>0,"S8-003 board "+t+"~"+w+"~"+s+": total "+(r&&r.total)+" (want > 0 once .92 has read it: a dormant board is re-probed within 12h, a failing one by the retry lane; 0 or absent before)");
}
// S8-003 review: a tenant that answers * in French keeps its French rows (en-US only after a 500).
{const T2=[["desjardins","wd10","desjardins"],["cbcrc","wd3","CBC_Radio-Canada_Jobs"]];
  for(const [t,w,s] of T2){
    const titles=async(lang)=>{try{const r=await fetch("https://"+t+"."+w+".myworkdayjobs.com/wday/cxs/"+t+"/"+s+"/jobs",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json","Accept-Language":lang},body:JSON.stringify({appliedFacets:{},limit:20,offset:0,searchText:""})});const j=await r.json();return new Set((j.jobPostings||[]).map((p)=>p.title))}catch{return null}};
    const star=await titles("*"),en=await titles("en-US,en;q=0.9");const r=await list({companies:[t+"~"+w+"~"+s]});
    if(!star||!en||bad(r)){info("S8-003 "+t+": tenant or board unreadable");continue}
    const stored=rows(r).map((j)=>j.title);const enOnly=stored.filter((x)=>en.has(x)&&!star.has(x));const starOnly=stored.filter((x)=>star.has(x)&&!en.has(x));
    console.log((enOnly.length===0?"PASS":"FAIL")+"  S8-003 "+t+"~"+w+"~"+s+": "+enOnly.length+" of "+stored.length+" stored titles are the English-only answer, "+starOnly.length+" the tenant\x27s own (*) answer, e.g. "+JSON.stringify(enOnly.slice(0,2))+" (want 0 English-only: the board reads Workday under * and asks en-US only after a 500)");
  }}
// S8-002: a Teamtailor board past 100 postings, read a page at a time.
for(const [tok,size] of [["eutalents",2600],["anicuraglobal",642],["tutoringjobs",534]]){
  const r=await list({companies:[tok],limit:1});
  soft(!bad(r)&&typeof r.total==="number"&&r.total>100,"S8-002 teamtailor:"+tok+" stored "+(r&&r.total)+" (its jobs.rss walked to "+size+" on 2026-10-08; want > 100 after .92 has visited it, 250 more per visit; <= 100 before)");
}
info("S8-002 repair 20261009100000: no anon probe (job_board_closures and job_board_closure_repairs are closed to anon); its NOTICE names the closures marked suspect");
// S8-023 / S8-083: the federal feed.
{const dc=Array.isArray(st.descCoverage)?st.descCoverage.find((x)=>x&&x.source==="usajobs"):null;
  soft(!!dc&&dc.described>0,"S8-023 descCoverage usajobs: "+(dc?dc.described+" of "+dc.total+" described":"absent")+" (0 of 7,927 on .91; new federal rows carry a body from .92, stored ones stay null until they close)");}
{const r=await list({companies:["usajobs"],country:"DE",limit:5});
  soft(!bad(r)&&typeof r.total==="number"&&r.total>0,"S8-083 usajobs country=DE: total "+(r&&r.total)+", e.g. "+JSON.stringify(rows(r).slice(0,2).map((j)=>j.location))+" (want > 0 once .92 re-reads the feed; every federal row was stored US)");}
{const r=await list({companies:["usajobs"],country:"US",location:"Puerto Rico",limit:5});
  soft(!bad(r)&&typeof r.total==="number"&&r.total>0,"S8-083 usajobs country=US location=Puerto Rico: total "+(r&&r.total)+", e.g. "+JSON.stringify(rows(r).slice(0,2).map((j)=>j.location))+" (want > 0: a US territory, its own CountryCode in the feed, is stored US; 0 can also mean no open Puerto Rico post)");}
{const r=await list({companies:["usajobs"],limit:60});
  const wm=rows(r).filter((j)=>j.workMode||j.work_mode).length;const per=rows(r).filter((j)=>/per (hour|year|day|week)/i.test(String(j.salary||""))).length;
  soft(!bad(r)&&wm>0&&per>0,"S8-023 usajobs first page: "+wm+" of "+rows(r).length+" state a work mode, "+per+" a pay period (60/60 null on .91)");}
// S8-022: the federal feed is named as itself (migration 20261009100200 + the facets cron).
{const tq=async(q)=>{const t0=Date.now();const r=await rpc("get_company_suggest",{p_q:q});return [r,Date.now()-t0]};
  const [a,ta]=await tq("veterans health");const [b,tb]=await tq("western area");const [c,tc]=await tq("zzz nothing");
  const names=(x)=>Array.isArray(x)?x.map((h)=>h.name):[];
  const ok=names(a).includes("U.S. federal agencies (USAJOBS)")&&!names(b).includes("Western Area Power Administration");
  console.log((ok?"PASS":"FAIL")+"  S8-022 get_company_suggest veterans health -> "+JSON.stringify(names(a))+", western area -> "+JSON.stringify(names(b))+" (want the feed\x27s own name for both; FAIL until 20261009100200 is applied and the refresh-board-facets cron has run, 15 min)");
  const errs=[a,b,c].filter((x)=>!Array.isArray(x)).map((x)=>JSON.stringify(x).slice(0,90));
  console.log((!errs.length&&Math.max(ta,tb,tc)<2500?"PASS":"FAIL")+"  S8-022 get_company_suggest round trips "+ta+"/"+tb+"/"+tc+" ms"+(errs.length?" errors "+errs.join(" | "):"")+" (want arrays, each under 2,500 ms; its own timeout is 5s, and the first draft of 20261009100200 took 76s at 32k facet entries in pglite)");}
// S8-027: the date and pay orders match stemmed titles.
for(const sort of ["newest","salary"]){
  const r=await list({q:"teachers",sort});
  // A plain singular title: "teacher", no plural, no loose "s" token (the .90 matcher was teachers | teacher & s, so it served only plurals, possessives and stray-s titles).
  const plain=rows(r).filter((j)=>{const t=String(j.title||"");return /\bteacher\b/i.test(t)&&!/\bteachers\b/i.test(t)&&!/(^|[^a-z])s([^a-z]|$)/i.test(t)}).length;
  late(!bad(r)&&plain>0,"S8-027 q=teachers sort="+sort+": "+plain+" of "+rows(r).length+" titles are a plain singular \"teacher\" with no stray s, route "+(r&&r.searchRoute)+", hasMore "+(r&&r.hasMore)+" (want > 0; .90 served 0: plurals, Teacher\x27s Aide and stray-s titles, 243 rows of 4,610)");
}
// S8-090: employer names with filler words route; "constructor" is a query.
{const r=await list({q:"bank of america",limit:5});
  late(!bad(r)&&r.searchRoute==="EMPLOYER"&&r.companyMatched==="Bank of America","S8-090 q=\"bank of america\": searchRoute "+(r&&r.searchRoute)+", companyMatched "+(r&&r.companyMatched)+" (want EMPLOYER / Bank of America; .90: null, droppedTerms [of])");}
{const r=await list({q:"constructor",limit:5});
  late(!!r&&r._status===200&&!r.error,"S8-090 q=constructor: HTTP "+(r&&r._status)+" "+(r&&r.error?JSON.stringify(r.error):"")+" (want 200; .90 answered 500 \"Job board temporarily unavailable\")");}
// S8-088 (wave 2, 3253823f): a rare term keeps its exact count on page one.
{const r=await list({q:"sommelier"});
  late(!bad(r)&&typeof r.total==="number","S8-088 q=sommelier: total "+(r&&r.total)+", totalAtLeast "+(r&&r.totalAtLeast)+", relatedTotal "+(r&&r.relatedTotal)+" (fixed by wave 2 .91: want an exact total; .90 published null with totalAtLeast 60)");}
// S8-087: the cold cursor passes a prefix (to - from may now exceed started by the dormant skips).
{const cs=(st.sliceStats||{}).cursorStep;
  if(!cs)info("S8-087 sliceStats.cursorStep "+JSON.stringify(cs)+" (null on a hot slice; re-run during the cold phase)");
  else{const n=Number(st.coldBoards)||0;const step=n?((cs.to-cs.from)%n+n)%n:cs.to-cs.from;
    info("S8-087 cursorStep "+JSON.stringify(cs)+": stepped "+step+" for "+cs.started+" started (on .92 a step above started is dormant skips passed, below it a deferral ahead of later starts; on .91 it always equals started)")}}
// F1 (server half): employer names (migration 20261009100100).
for(const [tok,want] of [["ms~wd5~external","Morgan Stanley"],["rmit~wd3~RMIT_Careers","RMIT University"],["cc","Climate Corps"]]){
  const r=await list({companies:[tok],limit:1});const got=rows(r)[0]&&rows(r)[0].company;
  if(bad(r)||!rows(r).length)info("F1 "+tok+": no open row to read a name from");
  else console.log((got===want?"PASS":"FAIL")+"  F1 "+tok+" stored as "+JSON.stringify(got)+" (want "+want+"; FAIL until 20261009100100 is applied)");
}
// S8-062: no anon probe that does not spend a limiter row; the build lines above carry it.
info("S8-062 job-fit / application-fit: keyed on the platform address hourly, a limiter error is 503; not probed (a fit-batch call spends a check_rate_limit row). Judge by the two x-fn-build lines above.");
info("S8-030 / S8-031 / S8-084 / S8-085 / S8-086 / S8-089: no anon probe; see the .92 note for the status fields and logs to watch");
}catch(e){console.log("INFO  section 71 stopped early: "+String(e).slice(0,160))}
})()'
