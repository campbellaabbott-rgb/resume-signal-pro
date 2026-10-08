# job-board .90 -- an over-bound greenhouse board reads light in the same
# visit, the oversize registry is keyed by board, a light list over the bound
# is streamed, a plural `vendors` key is named, and the deep lane runs ahead of
# the base rotation (docs/job-board-deploy-notes.md, 2026-09-09.90). Sourced by
# scripts/verify-deploy.sh. Read-only: status, a preflight, list reads with
# x-rb-budget: probe (list logs one search event, as every list probe here
# does), greenhouse's public boards-api light lists and Workday's public CXS
# search. Never verify, report, click or a refresh.
#
# WHEN TO JUDGE. The deploy instant is VD90_AT if set, else
# sliceStats.lightReread.since (written by the first .90 slice). A board's
# claim FAILs only once its turn has come: one cold rotation (5h57m measured
# 2026-10-05/06, +10% = 393 min) for a board visited by the rotation, two for
# pg (base visit plus deep visit). VD90_POLLS=N adds N status reads 60 s apart
# for the deep-lane and cursor-rate lines (default 0: two reads, start and end).
echo "== 90. job-board .90: light re-read in the visit, registry by board, greenhouse streamed light, vendors named, deep lane ahead of base =="
J '{"action":"status"}' > /tmp/vd_90_status_0.json; date +%s > /tmp/vd_90_status_0.t
curl -s -m 30 -o /dev/null -D /tmp/vd_90_preflight.txt -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
node -e '
let st={};try{st=JSON.parse(require("fs").readFileSync("/tmp/vd_90_status_0.json","utf8"))}catch{}
const m=/^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(st.version||""));
const v90=!!m&&(m[1]>"2026-09-09"||(m[1]==="2026-09-09"&&Number(m[2])>=90));
console.log((v90?"PASS":"FAIL")+"  status.version = "+st.version+" (want 2026-09-09.90 or later; .89 = the bundle did not deploy, and every .90 line below is INFO until it does)");'
VD90_FB=$(tr -d '\r' < /tmp/vd_90_preflight.txt | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD90_FB" ]; then echo "FAIL  job-board preflight carries no x-fn-build"
elif build_ge job-board "$VD90_FB" 2026-09-09 90; then echo "PASS  job-board preflight x-fn-build = $VD90_FB (job-board.2026-09-09.90 or later)"
else echo "FAIL  job-board preflight x-fn-build = $VD90_FB (want job-board.2026-09-09.90 or later; over the ~4.5 MB raw-source cap the old bundle keeps serving)"; fi
# Served rows per board (60 a page, the anonymous ceiling), the boards' own
# feeds, and the three vendors-key reads. Workday's pg feed is reused from
# section 89's cache when that is under 30 minutes old.
B="$B" K="$K" node -e '(async()=>{
const fs=require("fs");const {B,K}=process.env;
const H={"Content-Type":"application/json","x-rb-budget":"probe",apikey:K,Authorization:"Bearer "+K};
const list=async(body)=>{try{return await (await fetch(B+"/functions/v1/job-board",{method:"POST",headers:H,body:JSON.stringify(body)})).json()}catch(e){return {err:String(e).slice(0,100)}}};
async function served(v,t){const rows=new Map();let total=null;
  for(let off=0;off<2400;off+=60){const r=await list({action:"list",companies:[t],vendor:[v],groupSimilar:false,includeFacets:false,limit:60,offset:off});
    if(!r||r.err||!Array.isArray(r.jobs))return {err:"list unreadable at offset "+off};
    if(off===0)total=typeof r.total==="number"?r.total:null;
    for(const x of r.jobs)rows.set(x.id,{id:x.id,lastSeen:x.lastSeen});if(r.jobs.length<60)break;}
  return {total,rows:[...rows.values()]};}
async function gh(t){try{const j=await (await fetch("https://boards-api.greenhouse.io/v1/boards/"+t+"/jobs")).json();
  const cut=Date.now()-30*86400000;const all=Array.isArray(j.jobs)?j.jobs:null;if(!all)return {err:"feed has no jobs array"};
  return {n:all.length,ids:all.map((x)=>"greenhouse:"+t+":"+x.id),inWin:all.filter((x)=>x.absolute_url&&Date.parse(x.first_published)>=cut).map((x)=>"greenhouse:"+t+":"+x.id)}}catch(e){return {err:"feed unreadable ("+String(e).slice(0,80)+")"}}}
const days=(p)=>{const s=String(p||"").toLowerCase();if(/today/.test(s))return 0;if(/yesterday/.test(s))return 1;const m=/(\d+)/.exec(s);if(!m||!/day/.test(s))return null;return /\+|more than|over/.test(s)?Number(m[1])+1:Number(m[1])};
async function cxs(tok){
  try{const c=JSON.parse(fs.readFileSync("/tmp/vd_89_cxs_"+tok+".json","utf8"));if(Date.now()-Date.parse(c.at)<1800000&&Array.isArray(c.pos))return c}catch{}
  const [t,dc,site]=tok.split("~");const pos=[];let total=null;
  for(let off=0;off<2000;off+=20){let j;
    try{j=await (await fetch("https://"+t+"."+dc+".myworkdayjobs.com/wday/cxs/"+t+"/"+site+"/jobs",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({appliedFacets:{},limit:20,offset:off,searchText:""})})).json()}catch{return {err:"feed unreadable at offset "+off}}
    if(off===0)total=Number(j.total)||0;
    const p=Array.isArray(j.jobPostings)?j.jobPostings:[];if(!p.length)break;
    p.forEach((x,i)=>{const path=String(x.externalPath||"");pos.push({id:"workday:"+tok+":"+(path.split("_").pop()||(Array.isArray(x.bulletFields)?x.bulletFields[0]:"")||""),at:off+i,d:days(x.postedOn)})});
    if(p.every((x)=>{const d=days(x.postedOn);return d!==null&&d>30}))break;}
  return {total,pos,at:new Date().toISOString()};}
const out={gh:{},pg:null,vendors:{}};
await Promise.all(["liquidpersonnel","pulse","lush"].map(async(t)=>{const [f,s]=await Promise.all([gh(t),served("greenhouse",t)]);out.gh[t]={feed:f,served:s}}));
{const tok="pg~wd5~1000";const [f,s]=await Promise.all([cxs(tok),served("workday",tok)]);out.pg={feed:f,served:s}}
const q={companies:["lush"],groupSimilar:false,includeFacets:false,limit:1};
const pick=(r)=>r&&!r.err?{total:r.total??null,ignored:Array.isArray(r.ignoredFilters)?r.ignoredFilters:null}:{err:(r&&r.err)||"unreadable"};
out.vendors.plural=pick(await list({action:"list",...q,vendors:["personio"]}));
out.vendors.none=pick(await list({action:"list",...q}));
out.vendors.singular=pick(await list({action:"list",...q,vendor:["personio"]}));
fs.writeFileSync("/tmp/vd_90_data.json",JSON.stringify(out));
})()'
VD90_N=${VD90_POLLS:-0}; VD90_I=1
while [ "$VD90_I" -le "$VD90_N" ]; do
  sleep 60; J '{"action":"status"}' > "/tmp/vd_90_status_$VD90_I.json"; date +%s > "/tmp/vd_90_status_$VD90_I.t"; VD90_I=$((VD90_I+1))
done
J '{"action":"status"}' > "/tmp/vd_90_status_$VD90_I.json"; date +%s > "/tmp/vd_90_status_$VD90_I.t"
VD90_AT="${VD90_AT:-}" VD90_LAST="$VD90_I" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};const js=(s)=>{try{return JSON.parse(s)}catch{return null}};
const S=[];for(let i=0;i<=Number(process.env.VD90_LAST);i++){const s=js(rd("/tmp/vd_90_status_"+i+".json"));const t=Number(rd("/tmp/vd_90_status_"+i+".t"));if(s&&typeof s==="object"&&!Array.isArray(s))S.push({s,t:t*1000})}
const st=S.length?S[S.length-1].s:{};
const m=/^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(st.version||""));
const v90=!!m&&(m[1]>"2026-09-09"||(m[1]==="2026-09-09"&&Number(m[2])>=90));
const late=(c,m)=>console.log((c?"PASS":(v90?"FAIL":"INFO"))+"  "+m);
const ss=st.sliceStats||{};const lr=ss.lightReread;
const atEnv=Date.parse(process.env.VD90_AT||"");const atLr=lr&&typeof lr.since==="string"?Date.parse(lr.since):NaN;
const at=Number.isFinite(atEnv)?atEnv:(v90&&Number.isFinite(atLr)?atLr:NaN);
const hrs=Number.isFinite(at)?(Date.now()-at)/3600000:0,ROT=393/60;
info("deploy instant "+(Number.isFinite(at)?new Date(at).toISOString()+" ("+(Number.isFinite(atEnv)?"VD90_AT":"sliceStats.lightReread.since")+"), "+hrs.toFixed(1)+"h ago":"unknown (not .90 yet)")+"; a board visited by the cold rotation is judged after "+ROT.toFixed(1)+"h, pg after "+(2*ROT).toFixed(1)+"h");
const due=(h)=>v90&&hrs>=h;
const verdict=(good,h,msg,wait)=>console.log((good?"PASS":(due(h)?"FAIL":"INFO"))+"  "+msg+(good||due(h)?"":" -- "+(v90?wait+"; "+hrs.toFixed(1)+"h of "+h.toFixed(1)+"h so far":"not .90 yet")));
// Greenhouse registry entries; one stamped at or after the deploy was written by a .90 visit.
const ob=Array.isArray(st.oversizeBoards)?st.oversizeBoards:[];
const ghE=ob.filter((e)=>e.source==="greenhouse");
const fresh=(e)=>Number.isFinite(at)&&Date.parse(e.at)>=at;
const ghNew=ghE.filter(fresh),ghOld=ghE.filter((e)=>!fresh(e));
const ghName=(e)=>(e.key||e.source+":"+e.token)+" "+e.mb+"MB at "+e.at;
// F1: sliceStats.lightReread = running totals {enrolled, reread, ok, deferred, since}.
const nn=(x)=>Number.isInteger(x)&&x>=0;
const shape=!!lr&&typeof lr==="object"&&["enrolled","reread","ok","deferred"].every((k)=>nn(lr[k]))&&Number.isFinite(atLr);
late(shape,"sliceStats.lightReread = "+JSON.stringify(lr??null)+" (want {enrolled, reread, ok, deferred} as counts and since an instant; every .90 slice writes it)");
if(shape){
  ok(lr.enrolled===lr.reread+lr.deferred&&lr.ok<=lr.reread,"lightReread counters agree: enrolled "+lr.enrolled+" = reread "+lr.reread+" + deferred "+lr.deferred+", ok "+lr.ok+" <= reread");
  const lh=(Date.now()-atLr)/3600000;
  if(lh<24)info("lightReread covers "+lh.toFixed(1)+"h; the 24h reading (enrolled >= 1, ok == reread, deferred near 0) is due at "+new Date(atLr+86400000).toISOString());
  else console.log((lr.enrolled>=1?"PASS":"INFO")+"  lightReread.enrolled = "+lr.enrolled+" over "+lh.toFixed(0)+"h"+(lr.enrolled>=1?"":" (no greenhouse board crossed the byte bound: the path is unexercised, not broken)"));
  console.log((lr.ok===lr.reread?"PASS":"INFO")+"  lightReread.ok = reread ("+lr.ok+" of "+lr.reread+")"+(lr.ok===lr.reread?": every light re-read landed":": "+(lr.reread-lr.ok)+" light re-read(s) did not land -- by design when the light list is itself over the bound and the streamed read lands the board; "+(ghNew.length?"the greenhouse entries registered on a .90 visit are judged below":"no greenhouse board is registered from a .90 visit, so each left oversizeBoards")+" (logs `streamed read of greenhouse:`)"));
  console.log((lr.deferred===0?"PASS":"INFO")+"  lightReread.deferred = "+lr.deferred+(lr.deferred===0?"":" (the start gate refused the re-read; each such board reads light on its next visit, a rotation later. Regularly above 0 = .91 adds a one-shot re-offer lane)"));
}
const LS=ss.lightSet,LC=ss.lightCap;
ok(typeof LS==="number"&&typeof LC==="number"&&LS<=LC&&LC===500,"sliceStats.lightSet = "+LS+" of lightCap "+LC+" (cap stays 500)");
info("lightSet "+LS+" against 110 at diagnosis"+(shape?" and lightReread.enrolled "+lr.enrolled:"")+" (the in-memory count of one isolate; the content-payload threshold path enrols too, so a rise above enrolled is that path; enrolled can also rise with no change to the row, when an isolate whose light-row read failed re-enrols in memory boards the row already holds. Staying far below 110 across runs = the row shrank: read it with service role)");
// F2: status rows carry the board key.
const badKey=ob.filter((e)=>!(typeof e.key==="string"&&(e.key===e.token||e.key===e.source+":"+e.token)));
late(ob.length>0&&badKey.length===0,"oversizeBoards rows carry key = token or source:token ("+ob.length+" rows, oversizeBoardCount "+st.oversizeBoardCount+")"+(badKey.length?"; without a valid key: "+badKey.slice(0,6).map((e)=>(e.source||"?")+":"+e.token+" key="+JSON.stringify(e.key)).join(", "):""));
const sharedKeys=ob.filter((e)=>typeof e.key==="string"&&e.key.includes(":"));
info("shared-token registry keys: "+(sharedKeys.map((e)=>e.key).join(", ")||"none")+" (a read by the twin must not remove one: poll status while cursor.cold passes the twin, e.g. afg on workable/bamboohr)");
// F1 + F3: greenhouse registry entries narrow to none. One a .90 visit registered may be a one-off deferral
// (gate refused the light re-read, the re-read failed for another reason, the stream did not start or finish)
// until its next turn has passed. A board deferred at every turn is re-stamped each time, so its stamp alone
// cannot FAIL it: the named boards are judged by their served lines below.
for(const e of ghNew){const eh=(Date.now()-Date.parse(e.at))/3600000,past=v90&&eh>=ROT;
  console.log((past?"FAIL":"INFO")+"  greenhouse board deferred as oversize on a .90 visit: "+ghName(e)+(past?", still registered "+eh.toFixed(1)+"h later, past its next cold turn":" -- a one-off deferral when the start gate refused its light re-read (lightReread.deferred "+(shape?lr.deferred:"?")+"), the light re-read failed for another reason, or its streamed light read did not start or finish; "+(v90?"it reads at its next turn, FAIL if still registered "+Math.round(ROT*60)+" min after this stamp. A light list the stream can never read is re-stamped at every turn and stays INFO here: the same key in runs a rotation apart is that defect":"not .90 yet"))+" (logs `light re-read:` / `streamed read of greenhouse:`)");}
verdict(ghOld.length===0,ROT,"greenhouse oversizeBoards entries: "+(ghOld.map(ghName).join(", ")||"none")+" registered before the deploy"+(ghNew.length?" ("+ghNew.length+" more from a .90 visit, judged above)":"")+" (lush, pulse, liquidpersonnel on 2026-10-06 03:20Z; pulse and liquidpersonnel at 16:40Z; want none)","each leaves at its cold turn");
// F1 + F3: served against the light list of the board itself.
const D=js(rd("/tmp/vd_90_data.json"))||{};
for(const t of ["liquidpersonnel","pulse","lush"]){
  const x=(D.gh||{})[t];
  if(!x||!x.feed||!x.served||x.feed.err||x.served.err){info("greenhouse:"+t+" "+((x&&((x.feed&&x.feed.err)||(x.served&&x.served.err)))||"unreadable")+" -- cannot judge");continue}
  const onFeed=new Set(x.feed.ids),inWin=new Set(x.feed.inWin);
  const servedIn=x.served.rows.filter((r)=>inWin.has(r.id)).length;
  const ghosts=x.served.rows.filter((r)=>!onFeed.has(r.id));
  const since=Number.isFinite(at)?x.served.rows.filter((r)=>Date.parse(r.lastSeen)>=at).length:0;
  const want=Math.ceil(inWin.size*0.9);
  verdict(inWin.size>0&&servedIn>=want,ROT,"greenhouse:"+t+" serves "+servedIn+" of "+inWin.size+" in-window postings on its own light list (want at least "+want+"; "+x.feed.n+" on the list; total "+x.served.total+", "+since+" inserted since the deploy)","its cold turn has not come");
  const gm=Math.max(3,Math.ceil(x.served.rows.length*0.03));
  verdict(ghosts.length<=gm,ROT,"greenhouse:"+t+" serves "+ghosts.length+" id(s) no longer on its light list (want at most "+gm+", the closures since its last read)"+(ghosts.length?": e.g. "+ghosts.slice(0,4).map((r)=>r.id.split(":").pop()).join(", "):"")+(t==="lush"?" (lush served 19 such ids on 2026-10-06, e.g. 8148060)":""),"its cold turn has not come");
}
// F5: the plural key is named, not aliased.
const V=D.vendors||{};
if(!V.plural||V.plural.err||!V.none||V.none.err||!V.singular||V.singular.err)info("vendors-key reads unreadable -- cannot judge: "+JSON.stringify(V).slice(0,200));
else{
  late(Array.isArray(V.plural.ignored)&&V.plural.ignored.includes("vendors"),"{vendors:[personio], companies:[lush]} names vendors in ignoredFilters ("+JSON.stringify(V.plural.ignored)+")");
  ok(V.plural.total===V.none.total,"the plural key is not an alias: its total "+V.plural.total+" = the unfiltered companies:[lush] total "+V.none.total);
  ok(!(V.singular.ignored||[]).some((k)=>k==="vendor"||k==="vendors"),"{vendor:[personio], companies:[lush]} names no vendor key ("+JSON.stringify(V.singular.ignored)+"; total "+V.singular.total+", 3 on 2026-10-06)");
}
// F7: the deep lane visits what it selects; bootstrap gives up the deep take.
const lanes=[];for(const x of S){const l=(x.s.deepCursor||{}).lane;if(l&&typeof l.at==="string"&&!lanes.some((y)=>y.at===l.at)&&(!Number.isFinite(at)||Date.parse(l.at)>=at))lanes.push(l)}
const hit=lanes.filter((l)=>Number(l.selected)>=1&&Number(l.visited)>=Number(l.selected)).length;
const laneTxt=lanes.map((l)=>l.visited+"/"+l.selected+" of "+l.candidates).join(", ")||"none";
if(!v90||lanes.length===0)info("deepCursor.lane visited/selected in "+lanes.length+" cold slice(s) since the deploy: "+laneTxt+(v90?"":" (on .89: 0/2 in every slice sampled)"));
else if(lanes.length>=10)ok(hit/lanes.length>=0.9,"deepCursor.lane visited == selected in "+hit+" of "+lanes.length+" cold slices (want at least 90%): "+laneTxt);
else if(hit===0)ok(false,"deepCursor.lane visited nothing in "+lanes.length+" cold slice(s): "+laneTxt+" (the .89 signature; set VD90_POLLS=10 for a fair sample)");
else console.log((hit===lanes.length?"PASS":"INFO")+"  deepCursor.lane visited == selected in "+hit+" of "+lanes.length+" cold slice(s): "+laneTxt+" (the claim is 90% of cold slices; set VD90_POLLS=10 for a fair sample)");
const dc=st.deepCursor||{},laps=dc.laps||{};
info("deepCursor.laps.proven = "+laps.proven+" (tracking "+laps.tracking+"; 841 / 1,024 on .89 at 2026-10-06 16:40Z; want rising over 24h), deepCursor.boards = "+dc.boards+" (649 then; want flat or falling)");
const bq=(st.bootstrapQueue||{}).lastSlice||{};
if(v90&&typeof bq.drained==="number"&&(!Number.isFinite(at)||Date.parse(bq.at)>=at))ok(bq.drained<=24,"bootstrapQueue.lastSlice.drained = "+bq.drained+" (want at most 24 at rest, 9 at shed L1: the deep take comes out of the bootstrap take; 25 on .89, so 25 here can also be a .89 isolate still serving)");
else info("bootstrapQueue.lastSlice = "+JSON.stringify(bq)+" (24 at rest on .90, 25 on .89)");
// F7: the cold cursor rate, by cursor advance only.
let dCold=0,dMin=0,back=0;for(let i=1;i<S.length;i++){const a=S[i-1].s.cursor||{},b=S[i].s.cursor||{};const L=Number(S[i].s.coldBoards)||0;if(typeof a.cold!=="number"||typeof b.cold!=="number")continue;const d=b.cold-a.cold;if(d>=0&&!(L>0&&d>L/2))dCold+=d;else if(L>0&&d<0&&-d>L/2)dCold+=d+L;else back++;dMin+=(S[i].t-S[i-1].t)/60000}
info("cold cursor "+JSON.stringify((S[0]||{s:{}}).s.cursor)+" -> "+JSON.stringify(st.cursor)+": "+dCold+" boards in "+dMin.toFixed(1)+" min"+(dMin>0?" = "+(dCold/dMin).toFixed(0)+"/min":"")+(back?", "+back+" backward step(s) not counted (a slice resuming behind the last persisted cursor; .89 did it too, 2026-10-06)":"")+" (reference on .89: 83-131/min in cold-only samples, 44,399 boards in 5h57m; the cursor moves a slice (up to 80 boards) at a time and a hot phase parks it, so a sample of a few minutes reads high or low; set VD90_POLLS=30 for a usable one and take your own pre-deploy baseline)");
const age=Number(st.lastRotationAgeMin);
if(v90&&Number.isFinite(age)&&Number.isFinite(at)&&age*60000<=Date.now()-at)ok(age<=393,"the cold rotation running on .90 is "+age+" min old (want at most 393 = 5h57m + 10%; past it, roll back with DEEP_LANE_TAKE = 0)");
else info("lastRotationAgeMin = "+age+" (the rotation in progress began before the deploy, or not .90 yet; the first rotation wholly on .90 must wrap within 393 min)");
// F7: pg against its own feed.
const P=D.pg||{};
if(!P.feed||!P.served||P.feed.err||P.served.err||!Array.isArray(P.feed.pos))info("workday:pg~wd5~1000 "+((P.feed&&P.feed.err)||(P.served&&P.served.err)||"unreadable")+" -- cannot judge");
else{
  const W=260,pos=new Map(P.feed.pos.map((p)=>[p.id,p.at]));const inWin=new Set(P.feed.pos.filter((p)=>p.d===null||p.d<=30).map((p)=>p.id));
  const servedIn=P.served.rows.filter((r)=>inWin.has(r.id)).length;
  const wins=[...new Set(P.served.rows.filter((r)=>Number.isFinite(at)&&Date.parse(r.lastSeen)>=at&&pos.has(r.id)).map((r)=>Math.floor(pos.get(r.id)/W)))].sort((a,b)=>a-b).map((w)=>"["+w*W+","+(w+1)*W+")").join(" ")||"none";
  const want=Math.ceil(inWin.size*0.9);
  verdict(inWin.size>0&&servedIn>=want,2*ROT,"workday:pg~wd5~1000 serves "+servedIn+" of "+inWin.size+" in-window postings on its own CXS feed (want at least "+want+"; feed total "+P.feed.total+"; served total "+P.served.total+"; windows holding a row inserted since the deploy: "+wins+"; 0 at 03:20Z and 465 at 16:40Z on 2026-10-06, .89)","a base visit and a deep visit have not both come");
}
'
