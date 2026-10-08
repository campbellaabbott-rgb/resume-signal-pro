# shellcheck shell=bash
# ── 64. WAVE 2, DATA PAGES AND THEIR SQL (platform sweep 2026-10-04,
# data-pages-sql group; deploy note docs/wave2/data-pages-sql.md).
#
# Nine migrations (20261008110000 .. 20261008113500) and a frontend build:
#   L13-12  both fill curves drop a doubted closure whose posting was seen again
#   L11-02  get_company_fill_curve gains filled_roles_90d / relisted_roles_90d;
#           the board and the account tracker print and judge on them
#   L2-06   /hiring-trends draws only weeks inside the 30-day fence
#   L2-21   get_hiring_trends returns live_new; the remote tile divides by it
#   L2-22   week labels are formatted in UTC
#   L11-10  get_trending_categories adds closed postings back to both windows
#   L11-06  get_takedowns_today is the last 24 hours; the copy says so
#   L11-04  get_public_scan_insights counts free, free-stream and paid only
#   L13-16  closure / exit rollups read whole ended months, also on NULL; the
#           layoff rollup rolls whole months additively; both retention jobs
#           carry their header
#   L2-10 / L2-11 / L11-03  three page fixes, judged in the deployed chunks
#
# READ-ONLY: anon RPC reads the verifier already makes (get_company_fill_curve
# on five named boards, get_stats_cache, get_takedowns_today,
# get_public_scan_insights, get_cron_health), and GETs of the site shell and
# its chunks. Nothing is refreshed, written or called on anyone's behalf.
# PRE-DEPLOY (2026-10-08 03:27Z cache): the week of 09-07 drawn at 211,810
# beside 261,469 / 261,697 / 288,403 (a Thursday: past the fence); 14 of 15
# fields "up"; J&J (jj~wd5~JJ) fills_90d 2,687, relists_90d 0, dated_n 6,741;
# scan insights overall.n 375; both retention jobs ch_timeout null.
echo "== 64. wave 2 data pages: role counts, seen-again rows, fenced weeks, rolling 24h, real scans, whole-month rollups (20261008110000-113500) =="

B="$B" K="$K" SITE="$SITE" node -e '
const B=process.env.B,K=process.env.K,SITE=process.env.SITE;
const R=async(fn,args={})=>{const t0=Date.now();try{const r=await fetch(B+"/rest/v1/rpc/"+fn,{method:"POST",headers:{"content-type":"application/json",apikey:K,authorization:"Bearer "+K},body:JSON.stringify(args)});const txt=await r.text();let j=null;try{j=JSON.parse(txt)}catch{}return {status:r.status,ms:Date.now()-t0,j,txt}}catch(e){return {status:0,ms:Date.now()-t0,j:null,txt:String(e)}}};
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const info=(m)=>console.log("INFO  "+m);
const fmt=(n)=>typeof n==="number"?n.toLocaleString("en-US"):String(n);
const num=(v)=>typeof v==="number"&&Number.isFinite(v);
(async()=>{
  // (a) L11-02: the role counts exist, and a role count never exceeds the event count it is drawn from.
  const fc=await R("get_company_fill_curve",{p_tokens:["jj~wd5~JJ","dominos","AbbVie","careers.ulta.com","catalent~wd1~External"]});
  if(!Array.isArray(fc.j)||!fc.j.length){ok(false,"(a) get_company_fill_curve as anon -> HTTP "+fc.status+" "+fc.txt.slice(0,160))}
  else{
    const shaped=fc.j.filter(r=>num(r.filled_roles_90d)&&num(r.relisted_roles_90d));
    ok(shaped.length===fc.j.length,"(a) every row carries filled_roles_90d and relisted_roles_90d ("+shaped.length+"/"+fc.j.length+"). Only 20261008110000 writes them: 0 means it has not applied");
    const bad=shaped.filter(r=>r.filled_roles_90d>r.fills_90d);
    ok(shaped.length>0&&bad.length===0,"(a2) filled_roles_90d <= fills_90d on every board (a role that stayed down is one fill event; more roles than events is a counting fault)"+(bad.length?": "+bad.map(r=>r.company_token).join(", "):""));
    const jj=fc.j.find(r=>r.company_token==="jj~wd5~JJ");
    if(jj)info("(a3) J&J: fill events "+fmt(jj.fills_90d)+", roles that stayed down "+fmt(jj.filled_roles_90d)+", roles that came back "+fmt(jj.relisted_roles_90d)+", same-title re-list events "+fmt(jj.relists_90d)+", dated_n "+fmt(jj.dated_n)+" (pre-deploy 2,687 / - / - / 0 / 6,741; register 2026-10-04: 2,499 events against at most 1,799 roles and 403 back). dated_n falls by the doubted rows whose postings were seen again (L13-12)");
  }
  // (a4/a5) THE COST, MEASURED WHERE THE BOARD PAYS IT. The role counts and the
  // seen-again test run inside the RPC /jobs calls for every visible employer
  // (25s header). (a4) a heavy batch: the biggest Workday and flap boards we
  // hold; (a5) the first page of the board, its tokens as the page sends them.
  // Pre-deploy 2026-10-08 ~08:00Z, old body, cold / warm: (a4) 16 tokens 1.9s /
  // 1.0s; (a5) 24 tokens 2.2s / 0.5s. pglite puts the new body at 1.4-1.6x the
  // old; FAIL is half the header, the point at which a cold read starts to
  // brush it.
  const HEAVY=["jj~wd5~JJ","emqk~ca3~CX_1","dominos","AbbVie","careers.ulta.com","catalent~wd1~External","target~wd5~targetcareers","sysco~wd5~syscocareers","vanguard~wd5~vanguard_external","viatris~wd5~External","warnerbros~wd5~global","workday~wd5~Workday","zoom~wd5~Zoom","zillow~wd5~Zillow_Group_External","fa-exvn-saasfaprod1~ocs~CX_1","ciandt"];
  const timed=async(label,toks)=>{const runs=[];for(let i=0;i<2;i++){const r=await R("get_company_fill_curve",{p_tokens:toks});runs.push(r);if(r.status!==200)break}
    const bad=runs.find(r=>r.status!==200||!Array.isArray(r.j));
    if(bad){ok(false,label+" get_company_fill_curve("+toks.length+" tokens) -> HTTP "+bad.status+" after "+bad.ms+"ms "+bad.txt.slice(0,120)+" -- the board shows healthFailed for every employer in such a batch");return}
    const worst=Math.max(...runs.map(r=>r.ms));
    ok(worst<12500,label+" get_company_fill_curve("+toks.length+" tokens) answered in "+runs.map(r=>(r.ms/1000).toFixed(1)+"s").join(" then ")+" (FAIL at 12.5s, half its 25s header)");};
  await timed("(a4) heavy batch:",HEAVY);
  try{const l=await (await fetch(B+"/functions/v1/job-board",{method:"POST",headers:{"content-type":"application/json","x-rb-budget":"probe",apikey:K,authorization:"Bearer "+K},body:JSON.stringify({action:"list",limit:60})})).json();
    const toks=[...new Set((l.jobs||[]).map(j=>j.token).filter(Boolean))].slice(0,200);
    if(toks.length)await timed("(a5) first page of /jobs:",toks);else info("(a5) job-board list returned no tokens");
  }catch(e){info("(a5) job-board list unreadable: "+e.message)}
  // (b..e) the hourly cache: weeks, live_new, fields, the field curve.
  const sc=await R("get_stats_cache");
  const c=(sc.j&&!Array.isArray(sc.j))?sc.j:(Array.isArray(sc.j)&&sc.j[0])?sc.j[0]:{};
  const at=Date.parse(c.computed_at);
  const rows=Array.isArray(c.hiring_trends)?c.hiring_trends:[];
  const stale=Array.isArray(c.stale_parts)?c.stale_parts:[];
  info("stats_cache computed_at="+c.computed_at+", stale_parts="+JSON.stringify(stale)+", "+rows.length+" weekly rows");
  const live=rows.filter(r=>num(r.live_new));
  ok(rows.length>0&&live.length===rows.length,"(b) every cached hiring_trends row carries live_new ("+live.length+"/"+rows.length+"), the population remote_new is counted over (L2-21). 0 means 20261008111000 has not applied or no :27 tick has run since");
  const past=rows.filter(r=>Date.parse(String(r.week_start).slice(0,10)+"T00:00:00Z")<at-30*86400000);
  ok(rows.length>0&&past.length===0,"(c) no cached week starts more than 30 days before the cache stamp (L2-06)"+(past.length?": "+past.map(r=>String(r.week_start).slice(0,10)+" "+fmt(r.new_postings)).join(", ")+" -- a half-week the fence had already emptied":"")+(new Date(at).getUTCDay()===1||new Date(at).getUTCDay()===2?" [stamped on a Monday or Tuesday, when no week reaches past the fence: (b) carries the proof]":""));
  const full=rows.slice(0,-1);
  for(const r of full)if(num(r.live_new)&&r.live_new>0)info("(c2) week "+String(r.week_start).slice(0,10)+": "+fmt(r.new_postings)+" new, remote "+(100*r.remote_new/r.live_new).toFixed(1)+"% of the "+fmt(r.live_new)+" still held (the page printed remote_new / new_postings = "+(100*r.remote_new/r.new_postings).toFixed(1)+"% before)");
  const cats=Array.isArray(c.trending_categories)?c.trending_categories:[];
  const judged=cats.filter(x=>num(x.prior7)&&x.prior7>=20);
  const up=judged.filter(x=>x.last7>x.prior7).length;
  const sum=(k)=>judged.reduce((a,x)=>a+x[k],0);
  info("(d) trending fields: "+up+" of "+judged.length+" up; fields together "+(judged.length?((100*(sum("last7")-sum("prior7"))/sum("prior7")).toFixed(1)+"%"):"n/a")+" (pre-deploy 14 of 15 up, +25.6% together, while the weekly series moved a few per cent). After 20261008111500 a flat market reads near flat; a lopsided count alone is not a failure");
  const fcp=c.fill_curve&&typeof c.fill_curve==="object"?c.fill_curve:null;
  info("(e) field curve part computed_at="+(fcp&&fcp.computed_at)+", "+(fcp&&Array.isArray(fcp.rows)?fcp.rows.length:"no")+" rows"+(stale.includes("fill_curve")?" -- STALE: the last run carried the previous rows":"")+". 20261008110500 withholds the part on apply; the next :27 run must write it again (pages say \"not yet computed\" until then)");
  // (f) L11-06: the ticker is a rolling day. INFO, not PASS: no anon read
  // separates a rolling 24 hours from a since-midnight count reliably (the
  // weekly series excludes showcase boards the ticker keeps, and the night
  // hours carry the Workday flap). Pre-deploy at 03h UTC it read 5,007 against
  // a weekly admitted average of 12,436 a day; the behaviour is executed in
  // today-on-the-takedown-ticker-was-since-midnight-utc, and (i2) proves the
  // copy that names the window shipped.
  const td=await R("get_takedowns_today");
  const last=full.length?full[full.length-1]:null;
  const day=last&&num(last.closed)?last.closed/7:null;
  const h=new Date().getUTCHours();
  if(!num(td.j))ok(false,"(f) get_takedowns_today as anon -> HTTP "+td.status+" "+td.txt.slice(0,120));
  else info("(f) get_takedowns_today = "+fmt(td.j)+" at "+h+"h UTC"+(day?" (the weekly series averages "+fmt(Math.round(day))+" admitted takedowns a day)":"")+". After 20261008111000 it is the last 24 hours at any hour, so it should not collapse toward zero just after midnight UTC");
  // (g) L11-04
  const ps=await R("get_public_scan_insights");
  const o=ps.j&&ps.j.overall;
  if(o&&num(o.n))info("(g) score benchmark overall.n = "+o.n+" (as_of "+ps.j.as_of+"; pre-deploy 375 with at least ~22 synthetic rows inside). Expect it to drop by the synthetic count in the 180-day window once 20261008112000 applies");
  else ok(false,"(g) get_public_scan_insights as anon -> HTTP "+ps.status+" "+ps.txt.slice(0,120));
  // (h) L13-16: both retention jobs carry the header their function asks for.
  const ch=await R("get_cron_health",{p_hours:48});
  if(!Array.isArray(ch.j))info("(h) get_cron_health unreadable: "+ch.txt.slice(0,140));
  else for(const name of ["job-board-closures-rollup-retention","job-board-exits-rollup-retention"]){
    const j=ch.j.find(x=>x.ch_jobname===name);
    if(!j){ok(false,"(h) "+name+" is not scheduled");continue}
    ok(j.ch_timeout==="10min","(h) "+name+" command sets statement_timeout "+JSON.stringify(j.ch_timeout)+" (want 10min; null = held to the session two minutes, the state 20261001090000 left it in)");
    info("(h2) "+name+": "+j.ch_runs+" runs / "+j.ch_failed+" failed / "+j.ch_timeouts+" timeouts in 48h, last "+j.ch_last_start+" "+j.ch_last_status+" in "+j.ch_last_seconds+"s. Each run rolls one ended month: July, August and September over the first three nights, then one a month");
  }
  // (i) the deployed chunks.
  const shell=await (await fetch(SITE+"/")).text();
  const entry=(shell.match(/src="(\/assets\/index-[^"]+\.js)"/)||[])[1];
  if(!entry){info("(i) could not locate the entry bundle; open /jobs, /hiring-trends, /pay-transparency and /entry-level-index in a browser instead");return}
  const js=await (await fetch(SITE+entry)).text();
  const chunk=async(name)=>{const ch=(js.match(new RegExp("\\b"+name+"-[\\w-]+\\.js"))||[])[0];return ch?{ch,src:await (await fetch(SITE+"/assets/"+ch)).text()}:null};
  const jobs=await chunk("Jobs");
  if(jobs){
    ok(jobs.src.includes("filled_roles_90d")&&jobs.src.includes("relisted_roles_90d"),"(i1) the deployed Jobs chunk ("+jobs.ch+") reads the role counts (L11-02)");
    ok(jobs.src.includes("takedownsLast24h")&&!/["\x27]jobsPage\.takedownsToday["\x27]/.test(jobs.src),"(i2) the Jobs chunk prints the takedown ticker as the last 24 hours, not today (L11-06)");
    ok(!jobs.src.includes("intel.net7d"),"(i3) the company intel strip no longer prints a net-new count (L11-03)");
    ok(jobs.src.includes("jobsPage.repostTipRoles"),"(i8) the card slot carries the role caution the detail pane prints, so a card can no longer praise an employer its pane warns about (L11-02 follow-up)");
  }else info("(i1-3) the entry bundle names no Jobs chunk");
  const acc=await chunk("Account");
  if(acc)ok(acc.src.includes("filled_roles_90d")&&!acc.src.includes("verdictFills"),"(i4) the deployed Account chunk ("+acc.ch+") quotes roles that stayed down, never \"genuinely fills\" (L11-02)");else info("(i4) no Account chunk named");
  const ht=await chunk("HiringTrends");
  if(ht)ok(/timeZone:\s*"UTC"/.test(ht.src)&&ht.src.includes("still on the board state remote"),"(i5) the deployed HiringTrends chunk ("+ht.ch+") labels weeks in UTC and divides the remote share by the rows still held (L2-22, L2-21)");else info("(i5) no HiringTrends chunk named");
  const pt=await chunk("PayTransparencyIndex");
  if(pt)ok(pt.src.includes("We could not read this figure just now")&&!pt.src.includes("get_pay_transparency"),"(i6) the deployed PayTransparencyIndex chunk ("+pt.ch+") says a figure could not be read and never calls the revoked aggregates (L2-10)");else info("(i6) no PayTransparencyIndex chunk named");
  const el=await chunk("EntryLevelIndex");
  if(el)ok(el.src.includes("Counted when this page loaded")&&!el.src.includes("at page load"),"(i7) the deployed EntryLevelIndex chunk ("+el.ch+") prints when it counted and no \"live at page load\" claim (L2-11)");else info("(i7) no EntryLevelIndex chunk named");
})().catch(e=>console.log("FAIL  64 probe threw: "+e.message));
'
