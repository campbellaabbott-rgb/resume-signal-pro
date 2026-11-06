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
# intel, the refused wage cells answer until the owner's lca_wages load has run,
# lf_workforce is absent;
# job-fit/application-fit carry no x-fn-build; the peso line PASSes (0 of 47).
echo "== 77. wave 3 board-data-ingest: board explanations, phone header, layoff filings, landers, wage cells, parsers =="

# ── function builds ─────────────────────────────────────────────────────────
for PAIR in "agent-runner|2026-10-09|2" "public-api|2026-10-09|71" "send-search-digest|2026-10-09|25" "agent-mcp|2026-10-09|71" "job-fit|2026-10-09|3" "application-fit|2026-10-09|3"; do
  W77_FN=${PAIR%%|*}; W77_REST=${PAIR#*|}; W77_D=${W77_REST%%|*}; W77_N=${W77_REST#*|}
  W77_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$W77_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$W77_H" ]; then echo "FAIL  $W77_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$W77_FN" "$W77_H" "$W77_D" "$W77_N"; then echo "PASS  $W77_FN x-fn-build = $W77_H (the fit score is capped at 100: L8-13)"
  else echo "FAIL  $W77_FN x-fn-build = $W77_H (want $W77_FN.$W77_D.$W77_N or later: a fit score can still read 140)"; fi
done
W77_LF=$(curl -s -m 30 "$B/functions/v1/layoff-filings" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).version||"none")}catch{console.log("unparsed")}})')
if build_ge "lf" "lf.$W77_LF" "2026-10-09" "3"; then echo "PASS  layoff-filings version = $W77_LF (IL earliest notice date, OR counts, refused feeds re-read, SEC retries, MA updates, lca refusals)"
else echo "FAIL  layoff-filings version = $W77_LF (want 2026-10-09.3 or later: the integration build carrying board-data-ingest and tests-ci; 2026-09-25.1 = the previous build)"; fi

# The gate's control boards: which of them hold a printable wage cell in the
# bundle, by the rules the loader runs (empty without tsx: the line says so).
W77_LCA=$(npx --no-install tsx scripts/verify-lca-post-refusal.mjs siei crown-equipment RolandBerger techster rystad-energy 2>/dev/null)
B="$B" K="$K" SITE="$SITE" W77_LCA="$W77_LCA" node -e '
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
  // THE HEADER IS NOT IN THE ENTRY. Rollup put Header beside Footer in a
  // shared chunk (Footer-*.js) that pages load and the shell modulepreloads,
  // so a search of index-*.js read FAIL on 2026-10-11 while the live header
  // carried the menu. Walk the chunk graph instead: the entry, then what the
  // shell preloads, then every chunk the entry and each fetched chunk name
  // (a "./X-hash.js" import or an "assets/X-hash.js" preload entry), and take
  // the chunk that renders the header. POSITIVE CONTROL: that chunk is found
  // by header.mainNavAriaLabel, which the header has carried since June; a
  // walk that cannot find it judges nothing about the phone menu.
  const refs=(src)=>[...new Set([...String(src).matchAll(/(?:\.\/|\/?assets\/)([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.js)/g)].map((m)=>m[1]))];
  const holding=async(has,cap=150)=>{
    const entryName=mainPath?mainPath.replace(/^\/assets\//,""):"";
    if(has(main))return{name:entryName,src:main,read:1};
    const seen=new Set([entryName]);const queue=[...refs(shell),...refs(main)];let read=1;
    while(queue.length&&read<cap){const name=queue.shift();if(seen.has(name))continue;seen.add(name);
      const src=await get(SITE+"/assets/"+name);read++;if(!src)continue;
      if(has(src))return{name,src,read};
      for(const r of refs(src))if(!seen.has(r))queue.push(r);}
    return{name:null,src:"",read};
  };
  if(!main){ok(false,"could not load the live entry chunk -- no bundle claim below can be judged")}
  else{
    const hdr=await holding((s)=>s.includes("header.mainNavAriaLabel"));
    if(!hdr.name)ok(false,"no chunk reachable from the entry renders the header (header.mainNavAriaLabel, after reading "+hdr.read+" chunks): the phone menu cannot be judged");
    else ok(hdr.src.includes("phone-nav")&&hdr.src.includes("header.menu"),"the header has a phone menu (phone-nav, header.menu in "+hdr.name+", the chunk that renders the header): the nav and Sign in under 640px, Start no longer clipped (S8-093)");
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
    // THE FIT OFFER MAY SIT ONE CHUNK DOWN. Since the design upgrade the
    // posting page renders the shared posting component, which rollup puts in
    // its own chunk (imported by the posting page and the board), and labels
    // the offer "Check my fit, free" under the listing namespace. So the line
    // reads the posting chunk and every chunk it imports, and accepts either
    // label: the old page key or the shared component key.
    const fitOffer=(s)=>s.includes("jobPostingPage.scoreCta")||s.includes("listing.actions.checkFit");
    let fitIn=post&&fitOffer(post)?postName:null;
    if(post&&!fitIn){for(const r of refs(post).slice(0,40)){const s=await get(SITE+"/assets/"+r);if(s&&fitOffer(s)){fitIn=r;break}}}
    ok(!!fitIn,(postName||"JobPosting chunk")+": a posting offers the free score against it beside Apply"+(fitIn&&fitIn!==postName?" (in "+fitIn+", which the posting chunk imports)":""));
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
  // TWO DIFFERENT THINGS HIDE A WAGE CELL, and the old line blamed the wrong one
  // for sigmasoftware2. THE LEDGER (S8-024): lca_wages refuses a name that is not
  // this employer, but the table keeps the last load until the owner runs it
  // again, so these answer another employer\x27s filings until then.
  const REFUSED=["sigmasoftware2","socialfinance","sunday","echo"];
  const led=await R("get_employer_lca_wages",{p_tokens:REFUSED});
  if(!Array.isArray(led.j))ok(false,"get_employer_lca_wages as anon -> HTTP "+led.status+" "+led.t.slice(0,120));
  else{const lit=led.j.filter((r)=>r.ow_soc_code!=null||r.ow_employer_filings_n!=null);
    if(led.j.length!==REFUSED.length)ok(false,"get_employer_lca_wages answered "+led.j.length+" rows for "+REFUSED.length+" refused tokens: "+led.t.slice(0,120));
    else ok(!lit.length,lit.length?lit.length+" refused token(s) still answer a wage cell or an employer count, each another employer\x27s filings under this name: "+lit.map((r)=>r.ow_company_token+" = "+(r.ow_soc_code?r.ow_worksite_state+" "+r.ow_wage_low+"-"+r.ow_wage_high:"no cell")+", "+r.ow_employer_filings_n+" filings").join("; ")+". OWNER: run POST {action:\"lca_wages\"} on layoff-filings (the x-layoff-cron key, or one net.http_post from a Lovable SQL session reading the vault); section 5t judges the load":"the "+REFUSED.length+" refused tokens answer no cell and no employer count ("+REFUSED.join(", ")+"): the owner\x27s lca_wages load has run since the refusals shipped");}
  // THE GATE (20261009160300): a board with no live US posting prints no cell.
  // Its premise is read live on a control board, so a board that starts hiring in
  // the US, or stops serving, cannot read as the gate working. A null from the
  // reader is not vacuous either: the last line asks a board that must answer.
  let printable=null;try{printable=JSON.parse(process.env.W77_LCA||"").printable}catch{}
  const L=async(body)=>{try{return await (await fetch(B+"/functions/v1/job-board",{method:"POST",headers:{"content-type":"application/json","x-rb-budget":"probe",apikey:K,authorization:"Bearer "+K},body:JSON.stringify(body)})).json()}catch{return {}}};
  let ctrl=null,ctrlAll=0;
  for(const t of ["siei","crown-equipment","RolandBerger","techster","rystad-energy"]){
    if(printable&&!printable.includes(t))continue;
    const us=await L({action:"list",country:"US",companies:[t],groupSimilar:false,includeFacets:false,limit:1});if(us.total!==0)continue;
    const all=await L({action:"list",companies:[t],groupSimilar:false,includeFacets:false,limit:1});if(all.total>0){ctrl=t;ctrlAll=all.total;break}}
  if(!ctrl)info("no candidate board is live with no US posting"+(printable?" and a printable cell in the bundle":"")+", so the gate is not judged (20261009160300)");
  else{const c=await R("get_employer_lca_wages",{p_tokens:[ctrl]});
    if(!Array.isArray(c.j))ok(false,"get_employer_lca_wages as anon -> HTTP "+c.status+" "+c.t.slice(0,120));
    else{const dark=!!c.j[0]&&c.j[0].ow_soc_code==null;const said="a board with no live US posting prints no H-1B wage cell ("+ctrl+": 0 US rows of "+ctrlAll+" served"+(printable?", and a printable cell in the bundle":"; its bundle cell not checked, tsx unavailable")+"; it answers "+(c.j[0]&&c.j[0].ow_soc_code?c.j[0].ow_worksite_state+" "+c.j[0].ow_wage_low+"-"+c.j[0].ow_wage_high:"none")+"; 20261009160300)";
      // A control with no cell of its own answers null whether or not the gate works, so with no reading of the bundle a null is not judged; a lit cell is a FAIL either way.
      if(printable||!dark)ok(dark,said);else info(said+": not judged");}}
  {const t="generalmotors~wd5~Careers_GM";const c=await R("get_employer_lca_wages",{p_tokens:[t]});
    if(!Array.isArray(c.j))ok(false,"get_employer_lca_wages as anon -> HTTP "+c.status+" "+c.t.slice(0,120));
    else ok(!!c.j[0]&&c.j[0].ow_soc_code!=null,t+(c.j[0]&&c.j[0].ow_soc_code!=null?" answers a wage cell ("+c.j[0].ow_worksite_state+", "+c.j[0].ow_filings_n+" filings): the reader still lights a board that hires in the US, so the nulls above are not a dead reader":" answers no cell: the reader is dark for a board with US postings and a bundle cell, so the nulls above prove nothing"));}
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
