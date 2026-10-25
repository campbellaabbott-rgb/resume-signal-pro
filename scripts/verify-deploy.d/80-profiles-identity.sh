# shellcheck shell=bash
# ── 80. COMPANY PROFILES, PHASE 0: IDENTITY (migrations 20261012100000 and
# 20261012101000, and the frontend build that reads src/lib/board-collisions.ts).
# One line per claim, PASS / FAIL / INFO.
#
# Ships: employer_segment(token) and employer_key(source, token), private to
# the service role; get_company_intel, get_similar_companies and
# get_company_financials pooling by the employer key; company_financials.
# matched_source; intel's open_by_source; and company pages of a token two
# hiring systems carry showing only the per-vendor split.
#
# READ-ONLY: two GET refusal probes, anon RPC reads of get_company_financials
# and get_company_intel (both readers the site itself calls), and GETs of the
# site shell and its board chunk. Nothing is written, sent or triggered.
# PRE-DEPLOY (expected, from this branch on 2026-10-11): both probes answer
# PGRST202 (absent); blackstone answers BX and costar answers CSGP (FAIL);
# trustmark answers TRMK (FAIL); the intel answer carries no open_by_source;
# the board chunk carries no jobsPage.collision literal.
echo "== 80. company profiles phase 0: identity (employer key, SEC figures matched to one board, shared-token pages) =="

probe employer_segment '{"p_token":"blackstone"}'
probe employer_key '{"p_source":"workday","p_token":"blackstone"}'

B="$B" K="$K" SITE="$SITE" node -e '
const B=process.env.B,K=process.env.K,SITE=process.env.SITE;
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const info=(m)=>console.log("INFO  "+m);
const R=async(fn,args={})=>{try{const r=await fetch(B+"/rest/v1/rpc/"+fn,{method:"POST",headers:{"content-type":"application/json",apikey:K,authorization:"Bearer "+K},body:JSON.stringify(args)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=undefined}return{status:r.status,j,t}}catch(e){return{status:0,j:undefined,t:String(e)}}};
const get=async(u)=>{try{const r=await fetch(u);return r.ok?await r.text():""}catch{return ""}};
const tick=(r)=>r.j&&typeof r.j==="object"?r.j.ticker:null;
(async()=>{
  // ── SEC figures attach only to the board they were matched for ──────────
  const pairs=[
    ["blackstone","Blackstone Shooting Sports (Workable)","blackstone~wd1~blackstone_careers","BX"],
    ["costar","Co-Star (Greenhouse)","costar~wd1~CoStarCareers","CSGP"],
    ["accenture","the Pinpoint board (one source per row)","accenture~wd103~AccentureCareers","ACN"],
  ];
  for(const [plain,label,tenant,want] of pairs){
    const a=await R("get_company_financials",{p_token:plain}),b=await R("get_company_financials",{p_token:tenant});
    if(a.status!==200||b.status!==200){ok(false,"get_company_financials as anon -> "+a.status+"/"+b.status+" "+a.t.slice(0,120));continue}
    ok(a.j===null,plain+" carries no SEC card: "+label+" is not the filer (answered "+(tick(a)||"null")+"; 20261012101000)");
    if(tick(b)===want)ok(true,tenant+" keeps "+want+" (matched_source is its hiring system)");
    else info(tenant+" answered "+(tick(b)||"null")+": no "+want+" card while the tenant holds no stored posting; judge again after its next read");
  }
  const tm=await R("get_company_financials",{p_token:"trustmark~wd1~trustmarkcareers"});
  if(tm.status!==200)ok(false,"get_company_financials(trustmark) as anon -> "+tm.status);
  else ok(tm.j===null,"trustmark (Trustmark Companies, read and rejected by 20260918200000) carries no TRMK card (answered "+(tick(tm)||"null")+")");
  // ── intel pools by the employer key and splits a shared token ───────────
  const c=await R("get_company_intel",{p_token:"clear"});
  if(c.status!==200||!c.j)ok(false,"get_company_intel(clear) as anon -> HTTP "+c.status+" "+c.t.slice(0,120));
  else{
    const rows=c.j.open_by_source;
    ok(Array.isArray(rows),"get_company_intel returns open_by_source, the per-vendor open roles a shared token page prints ("+JSON.stringify(rows)+")");
    if(Array.isArray(rows))info("clear: "+rows.map(r=>r.source+" "+r.open_roles).join(", ")+" (BambooHR and Greenhouse both carry the token)");
  }
  // Two clients under the SAME vendor path (recruiting~): pooled, they answer byte-identical intel.
  const ua=await R("get_company_intel",{p_token:"recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845"});
  const ub=await R("get_company_intel",{p_token:"recruiting~RED1001RMI~fa9d032b-b0dd-4c99-8ebe-c09d9352c68c"});
  if(ua.status===200&&ub.status===200&&ua.j&&ub.j){
    if(ua.j.usd_n>0||ub.j.usd_n>0)ok(ua.t!==ub.t,"two UKG clients under recruiting~ (Ollie’s, Redner’s) answer their own intel, not one pooled answer (usd_n "+ua.j.usd_n+" / "+ub.j.usd_n+")");
    else info("Ollie’s and Redner’s both answered no stated USD pay; nothing to compare");
  }else ok(false,"get_company_intel on two UKG tokens -> "+ua.status+"/"+ub.status);
  // ── the frontend: the shared-token split ships in the board chunk ───────
  const shell=await get(SITE+"/");
  const mainPath=(shell.match(/\/assets\/index-[^"]*\.js/)||[])[0];
  const main=mainPath?await get(SITE+mainPath):"";
  const m=main.match(/"\.\/Jobs-[A-Za-z0-9_-]*\.js"/);
  const jobs=m?await get(SITE+"/assets/"+m[0].slice(3,-1)):"";
  if(!jobs)ok(false,"could not load the board chunk from the live entry: the shared-token claim cannot be judged");
  else ok(jobs.includes("jobsPage.collision.title")&&jobs.includes("open_by_source"),"a company page of a token two hiring systems carry shows the per-vendor split instead of employer facts (jobsPage.collision, open_by_source)");
})();
'
