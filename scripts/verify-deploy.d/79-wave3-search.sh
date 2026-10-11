# job-board .92 search group (S11-002, S11-003, S11-004, S11-009; migration
# 20261009101000; docs/job-board-deploy-notes.md, .92, "SEARCH GROUP").
# Sourced by scripts/verify-deploy.sh. Read-only: status and list reads with
# x-rb-budget: probe (each logs one search event, as every list probe here
# does). Every line is INFO until status.version is .92 or later; the SQL lines
# also need 20261009101000.
echo "== 79. search (wave 3): the place reads its index, a leading state code is a state, plural short-word searches, the description tier on a clock =="
B="$B" K="$K" node -e '(async()=>{
const {B,K}=process.env;
const H={"Content-Type":"application/json","x-rb-budget":"probe",apikey:K,Authorization:"Bearer "+K};
const call=async(body)=>{const t0=Date.now();try{const r=await fetch(B+"/functions/v1/job-board",{method:"POST",headers:H,body:JSON.stringify(body)});let j;try{j=await r.json()}catch{j={}}return {...j,_status:r.status,_ms:Date.now()-t0}}catch(e){return {err:String(e).slice(0,100),_ms:Date.now()-t0}}};
const list=(b)=>call({action:"list",groupSimilar:false,includeFacets:false,limit:60,...b});
const st=await call({action:"status"});
const m=/^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(st.version||""));
const v92=!!m&&(m[1]>"2026-09-09"||(m[1]==="2026-09-09"&&Number(m[2])>=92));
const late=(c,msg)=>console.log((c?"PASS":(v92?"FAIL":"INFO"))+"  "+msg);
const info=(msg)=>console.log("INFO  "+msg);
const bad=(r)=>!r||r.err||r.error;
const rows=(r)=>Array.isArray(r&&r.jobs)?r.jobs:[];
const sj=(r)=>r&&r.phaseMs&&r.phaseMs.search_jobs;
try{
// S11-002: role + small city stays ranked, inside the clock (.91: 57014 after ~8.1 s, served at ~9.5 s).
for(const city of ["Boise","Knoxville","Leeds"]){
  const r=await list({q:"manager",location:city});
  late(!bad(r)&&r.ranked===true&&!r.rankedFellBack&&Number(sj(r))<3000,"S11-002 q=manager location="+city+": ranked "+(r&&r.ranked)+", rankedFellBack "+JSON.stringify(r&&r.rankedFellBack)+", search_jobs "+sj(r)+" ms, request "+(r&&r._ms)+" ms (want ranked, no fallback, search_jobs under 3 s; .91 57014 at ~8.1 s)");
}
// S11-003: a state counts the rows that lead with its code (.91: Texas 121 < "TX - " 130 for pharmacist).
{const tx=await list({q:"pharmacist",location:"Texas",countOnly:true});const lead=await list({q:"pharmacist",location:"TX - ",countOnly:true});
  late(!bad(tx)&&!bad(lead)&&typeof tx.total==="number"&&typeof lead.total==="number"&&tx.total>=lead.total,"S11-003 q=pharmacist: location=Texas total "+(tx&&tx.total)+" vs location=\"TX - \" total "+(lead&&lead.total)+" (want Texas >= the leading-code rows; .91: 121 vs 130)");}
{const r=await list({location:"South Dakota"});const lead=rows(r).filter((j)=>/^SD, /.test(String(j.location||""))).length;
  info("S11-003 location=South Dakota: "+lead+" of "+rows(r).length+" newest rows lead with \"SD, \" (Sanford; 0 on .91, any is the fix, none can be sampling)");}
// S11-004: plural short-word searches stem the long word (.91: QA engineers total 2).
for(const [q,floor] of [["QA engineers",50],["UX designers",50],["HR managers",20]]){
  const r=await list({q,countOnly:true});const n=typeof r.total==="number"?r.total:(r&&r.totalAtLeast);
  late(!bad(r)&&Number(n)>=floor,"S11-004 q=\""+q+"\" countOnly: total "+(r&&r.total)+", totalAtLeast "+(r&&r.totalAtLeast)+" (want >= "+floor+"; .91: QA engineers 2, UX designers 2, HR managers 4)");
}
{const r=await list({q:"IT technicians"});const it=rows(r).filter((j)=>/\bit\b/i.test(String(j.title||""))).length;
  late(!bad(r)&&r.searchRoute==="SIMPLE"&&rows(r).length>0&&it===rows(r).length,"S11-004 q=\"IT technicians\": route "+(r&&r.searchRoute)+", "+it+" of "+rows(r).length+" titles carry IT, total "+(r&&r.total)+" (want SIMPLE and every title IT; .91: route null, total 10000, Wynn Gaming Technicians first)");}
// S11-009: country + pay basis stays ranked inside the clock (.91: 57014 after 8.12 s).
for(const b of [{q:"manager",country:"GB",payBasis:"hourly"},{q:"experience",country:"CA",payBasis:"salaried"}]){
  const r=await list(b);
  late(!bad(r)&&r.ranked===true&&!r.rankedFellBack&&r._ms<7000,"S11-009 "+JSON.stringify(b)+": ranked "+(r&&r.ranked)+", rankedFellBack "+JSON.stringify(r&&r.rankedFellBack)+", relatedTotal "+(r&&r.relatedTotal)+", relatedUnavailable "+(r&&r.relatedUnavailable)+", request "+(r&&r._ms)+" ms (want ranked, no fallback, under 7 s; relatedUnavailable when the description tier missed its 2.5 s clock)");
}
}catch(e){console.log("INFO  section 79 stopped early: "+String(e).slice(0,160))}
})()'
