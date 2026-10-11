# shellcheck shell=bash
# ── 77. WAVE 3, BOARD + DATA + INGEST (group board-data-ingest; deploy note
# docs/wave3/board-data-ingest.md). One line per claim, PASS / FAIL / INFO.
#
# Ships: a frontend build (board, header, posting page, Ghost Index, layoff
# lines, skip link, visit recorder); layoff-filings 2026-10-09.3 (the integration build, with tests-ci's header); agent-runner,
# public-api, send-search-digest, agent-mcp, job-fit and application-fit
# rebuilt for the fit clamp (the integration builds: agent-mcp .4, the rest .2); four migrations 20261009160000 .. 160300; and job-board
# parser changes that ride the job-board group's .92 build (judged INFO here,
# their verifier is the job-board group's).
#
# READ-ONLY: GETs of the site shell and its chunks, OPTIONS preflights, the
# layoff-filings GET (version only), and anon RPC reads of four public readers
# the site itself calls (get_employer_layoff_filings, get_company_intel,
# get_employer_lca_wages, get_layoff_partition) plus job-board status/list with
# x-rb-budget: probe. Nothing is written, sent or triggered.
# PRE-DEPLOY (2026-10-10, run from this branch): every build line FAILs, the
# bundle literal lines FAIL, eu~lookers and eu~rubyhotels answer identical
# intel, sigmasoftware2 answers a TX wage cell, lf_workforce is absent;
# job-fit/application-fit carry no x-fn-build; the peso line PASSes (0 of 47).
echo "== 77. wave 3 board-data-ingest: board explanations, phone header, layoff filings, landers, wage cells, parsers =="

# ── function builds ─────────────────────────────────────────────────────────
for PAIR in "agent-runner|2026-10-09|2" "public-api|2026-10-09|2" "send-search-digest|2026-10-09|3" "agent-mcp|2026-10-09|4" "job-fit|2026-10-09|2" "application-fit|2026-10-09|2"; do
  W77_FN=${PAIR%%|*}; W77_REST=${PAIR#*|}; W77_D=${W77_REST%%|*}; W77_N=${W77_REST#*|}
  W77_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$W77_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$W77_H" ]; then echo "FAIL  $W77_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$W77_FN" "$W77_H" "$W77_D" "$W77_N"; then echo "PASS  $W77_FN x-fn-build = $W77_H (the fit score is capped at 100: L8-13)"
  else echo "FAIL  $W77_FN x-fn-build = $W77_H (want $W77_FN.$W77_D.$W77_N or later: a fit score can still read 140)"; fi
done
W77_LF=$(curl -s -m 30 "$B/functions/v1/layoff-filings" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).version||"none")}catch{console.log("unparsed")}})')
if build_ge "lf" "lf.$W77_LF" "2026-10-09" "3"; then echo "PASS  layoff-filings version = $W77_LF (IL earliest notice date, OR counts, refused feeds re-read, SEC retries, MA updates, lca refusals)"
else echo "FAIL  layoff-filings version = $W77_LF (want 2026-10-09.3 or later: the integration build carrying board-data-ingest and tests-ci; 2026-09-25.1 = the previous build)"; fi

B="$B" K="$K" SITE="$SITE" node -e '
const B=process.env.B,K=process.env.K,SITE=process.env.SITE;
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const info=(m)=>console.log("INFO  "+m);
const R=async(fn,args={})=>{try{const r=await fetch(B+"/rest/v1/rpc/"+fn,{method:"POST",headers:{"content-type":"application/json",apikey:K,authorization:"Bearer "+K},body:JSON.stringify(args)});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return{status:r.status,j,t}}catch(e){return{status:0,j:null,t:String(e)}}};
const get=async(u)=>{try{const r=await fetch(u);return r.ok?await r.text():""}catch{return ""}};
(async()=>{
  // ── the frontend bundle: literals the fixes introduced ──────────────────
  const shell=await get(SITE+"/");
  const mainPath=(shell.match(/\/assets\/index-[^"]*\.js/)||[])[0];
  const main=mainPath?await get(SITE+mainPath):"";
  const chunk=(name)=>{const m=main.match(new RegExp("\"\\./"+name+"-[A-Za-z0-9_-]*\\.js\""));return m?m[0].slice(3,-1):null};
  if(!main){ok(false,"could not load the live entry chunk -- no bundle claim below can be judged")}
  else{
    ok(main.includes("phone-nav")&&main.includes("header.menu"),"the header has a phone menu (phone-nav, header.menu): the nav and Sign in under 640px, Start no longer clipped (S8-093)");
    ok(main.includes("a[href=\"#main-content\"]"),"the skip link lands on every page: the fallback handler is in the entry (S8-095)");
    const jobsName=chunk("Jobs"),postName=chunk("JobPosting"),ghostName=chunk("GhostJobIndex");
    const jobs=jobsName?await get(SITE+"/assets/"+jobsName):"";
    if(!jobs){ok(false,"could not load the board chunk from the entry")}else{
      ok(jobs.includes("jobsPage.sortNoStatedPayTitle"),jobsName+": an empty pay page says no match states pay, not that nothing matches (sortUnavailable)");
      ok(jobs.includes("jobsPage.intentUndo")&&jobs.includes("noIntent"),jobsName+": a lifted phrase can be undone (noIntent)");
      ok(jobs.includes("jobsPage.facetWithheld"),jobsName+": withheld field counts are named (facetSource withheld); the same chunk carries S8-028 divider gating, S8-091 per-address scroll and S8-092 one churn rule (logic, no literal)");
      ok(jobs.includes("jobsPage.layoffChipSecExit")||main.includes("jobsPage.layoffChipSecExit"),"an exit-cost 8-K prints a neutral chip and sentence (S8-026, needs lf_workforce below)");
    }
    const post=postName?await get(SITE+"/assets/"+postName):"";
    ok(post.includes("jobPostingPage.scoreCta"),(postName||"JobPosting chunk")+": a posting offers the free score against it beside Apply");
    const ghost=ghostName?await get(SITE+"/assets/"+ghostName):"";
    const anyGhost=ghost+main;
    ok(anyGhost.includes("stamp a notice a median"),"the Ghost Index names the state stamp lag, not a feed arrival lag (S8-096)");
  }
  // ── migrations, through the readers the site calls ──────────────────────
  const lf=await R("get_employer_layoff_filings",{p_tokens:["thetradesk","acme-no-such-board"]});
  if(!Array.isArray(lf.j)){ok(false,"get_employer_layoff_filings as anon -> HTTP "+lf.status+" "+lf.t.slice(0,120))}
  else ok(lf.j.length>0&&lf.j.every(r=>Object.prototype.hasOwnProperty.call(r,"lf_workforce")),"get_employer_layoff_filings returns lf_workforce on every row (20261009160000)");
  const a=await R("get_company_intel",{p_token:"eu~lookers"}),b=await R("get_company_intel",{p_token:"eu~rubyhotels"});
  if(a.status!==200||b.status!==200){ok(false,"get_company_intel as anon -> "+a.status+"/"+b.status)}
  else ok(a.t!==b.t,"eu~lookers and eu~rubyhotels answer their own intel, not one pooled answer (20261009160200; usd_n "+(a.j&&a.j.usd_n)+" / "+(b.j&&b.j.usd_n)+")");
  const w=await R("get_employer_lca_wages",{p_tokens:["sigmasoftware2"]});
  if(!Array.isArray(w.j)){ok(false,"get_employer_lca_wages as anon -> HTTP "+w.status+" "+w.t.slice(0,120))}
  else ok(w.j[0]&&w.j[0].ow_soc_code==null,"a board with no live US posting prints no H-1B wage cell (sigmasoftware2: "+(w.j[0]&&w.j[0].ow_soc_code?w.j[0].ow_worksite_state+" "+w.j[0].ow_wage_low+"-"+w.j[0].ow_wage_high:"none")+"; 20261009160300)");
  const sf=await R("get_employer_lca_wages",{p_tokens:["socialfinance","sunday"]});
  if(Array.isArray(sf.j))info("ledger/twin cells still in the table until the owner runs POST {action:\"lca_wages\"} on the new layoff-filings: "+sf.j.map(r=>r.ow_company_token+"="+(r.ow_soc_code?"cell":"none")).join(", "));
  const p=await R("get_layoff_partition");
  const rows=Array.isArray(p.j)?p.j:[];
  const lag=rows.map(r=>r.lp_warn_lag_p50_days).find(v=>v!=null);
  if(lag==null)info("get_layoff_partition carries no stamp lag yet (HTTP "+p.status+")");
  else ok(Number(lag)>=0,"the published state stamp lag is not negative ("+lag+" days; Illinois notices dated after their stamp are superseded by 20261009160100 and refused at ingest)");
  // ── job-board parsers (ride the job-board group build; INFO) ────────────
  const st=await (await fetch(B+"/functions/v1/job-board",{method:"POST",headers:{"content-type":"application/json","x-rb-budget":"probe",apikey:K,authorization:"Bearer "+K},body:JSON.stringify({action:"status"})})).json().catch(()=>({}));
  info("job-board status.version = "+st.version+": the parser changes (pay currencies, up-to ceilings, per-figure periods, Recruitee/Lever pay, country, seniority, non-Latin cards) serve from the job-board group build that carries this branch (.92 or later)");
  const lst=await (await fetch(B+"/functions/v1/job-board",{method:"POST",headers:{"content-type":"application/json","x-rb-budget":"probe",apikey:K,authorization:"Bearer "+K},body:JSON.stringify({action:"list",location:"Bangalore",groupSimilar:false,limit:60})})).json().catch(()=>({}));
  if(Array.isArray(lst.jobs)){const us=lst.jobs.filter(j=>/, IN$/.test(String(j.location||""))&&j.country==="US").length;info("location Bangalore: "+us+" of "+lst.jobs.length+" rows end \", IN\" and are stored US (falls as boards are re-read after the job-board build: L7-14)")}
  // A bare "$" in Colombia/Argentina is the peso only at a million a year or more (review of L13-19):
  // remote US-dollar jobs placed there must keep USD after the v10 salary re-read.
  let peso=0,seen=0;
  for(const c of ["CO","AR"]){const r=await (await fetch(B+"/functions/v1/job-board",{method:"POST",headers:{"content-type":"application/json","x-rb-budget":"probe",apikey:K,authorization:"Bearer "+K},body:JSON.stringify({action:"list",country:c,hasStatedPay:true,limit:100})})).json().catch(()=>({}));
    for(const j of (r.jobs||[])){const s=String(j.salary||"");if(!/^\$/.test(s)||/million|\bM\b/i.test(s))continue;const big=(s.match(/[\d][\d,.]*/g)||[]).some(x=>Number(x.replace(/[,.]/g,""))>=1e6);if(big)continue;seen++;if(["COP","ARS"].includes(j.salaryCurrency))peso++}}
  ok(peso===0,"bare-$ CO/AR pay under a million is not labelled in pesos ("+peso+" of "+seen+" rows; Bogota \"$75,000-$100,000\" is US dollars)");
})();
'
