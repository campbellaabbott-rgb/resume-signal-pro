# shellcheck shell=bash
# ── 99zzzz. BOARD STREAM, LIFECYCLE: a lap's closures read superseded from the
# whole lap, the description sweep asks once per rotation on a keyset, and
# exists answers on the predicate the board serves by (branch fix/bs-lifecycle,
# job-board 2026-09-09.100; no migration; docs/job-board-index-notes.md
# n1440-n1442).
#
# THE CLAIMS, one line each (FAIL only once what it waits for has happened):
#   L1  (S10-002) a lap-proven board logs a re-listed requisition as superseded:
#       72 h after .100's first slice, at least one of the five lapped boards
#       below shows superseded_90d > 0 in get_company_hiring_health (all five
#       read 0 on .96, 2026-11-01, against 1,291 to 46,214 closures); INFO
#       before;
#   L1b (S10-002) and not for most: of the closures O'Reilly and CVS log after
#       the base read (2026-11-01 14:27Z: 1,291 and 5,430 closed, tracking 32
#       and 9 days, none superseded), under 30% read superseded once each
#       board logs 200 (title and place said 17% of each on the 2026-11-01
#       corpus, title alone 92% and 72%). Main's closures between the base
#       read and .100's first slice carry no superseded and dilute the share,
#       so it is judged only once .100 has served at least 24 h and at least
#       as long as that gap: a title-only build then reads 36% or more. INFO
#       before, and once the base's oldest closure nears the 90-day window;
#   L2  (S13-113) status.descSweep reports the sweep's cursor and floor, and a
#       cursor written 10 minutes or more after .100's first slice is
#       first_seen|id (a bare timestamp is main's cursor); INFO while the
#       cursor is null (a walk's start, the boards phase, a settled rotation);
#   L3  (S13-076) exists names the served row test in its answer (rowTest
#       "served": .96 answers none, so this half alone tells the builds apart),
#       answers open for every row the list serves on one small whole-read
#       board, and not for an id no board holds. That a stamped or fenced row
#       reads closed is proven by the unit test only: anon reads no such row.
#
# READ-ONLY. One OPTIONS preflight; job-board status, list and exists reads
# with x-rb-budget: probe; one GET of get_company_hiring_health. Nothing is
# written.
echo "== 99zzzz. Board stream, lifecycle: lap superseded, one sweep ask per rotation, exists on the serving predicate =="

VDBL_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
VDBL_LIVE=0
if [ -z "$VDBL_H" ]; then echo "FAIL  job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VDBL_H" "2026-09-09" "100"; then echo "PASS  job-board preflight x-fn-build = $VDBL_H (2026-09-09.100 or later: the lifecycle fixes)"; VDBL_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VDBL_H: 2026-09-09.100 is not serving yet, so L1-L3 wait for it"; fi

rm -f /tmp/vd_99zzzz_bl_*
if [ "$VDBL_LIVE" = 1 ]; then
  J '{"action":"status"}' > /tmp/vd_99zzzz_bl_status.json
  curl -s -m 60 -G "$B/rest/v1/rpc/get_company_hiring_health" --data-urlencode 'p_tokens={oreillyauto~wd1~oreilly,cvshealth~wd1~CVS_Health_Careers,ejwl~us2~CX,dollartree~wd5~dollartreeus,dominos}' \
    -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_99zzzz_bl_health.json
  J '{"action":"list","companies":["gusto"],"vendor":["greenhouse"],"groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_99zzzz_bl_list.json
  VDBL_IDS=$(node -e 'let j;try{j=JSON.parse(require("fs").readFileSync("/tmp/vd_99zzzz_bl_list.json","utf8"))}catch{j={}}const ids=(j.jobs||[]).map((x)=>x.id).filter((x)=>typeof x==="string");process.stdout.write(JSON.stringify([...ids,"greenhouse:gusto:0000000000"]))' 2>/dev/null)
  J "{\"action\":\"exists\",\"ids\":${VDBL_IDS:-[]}}" > /tmp/vd_99zzzz_bl_exists.json
  node -e '
const fs=require("fs");const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const st=rd("/tmp/vd_99zzzz_bl_status.json"),hh=rd("/tmp/vd_99zzzz_bl_health.json"),ls=rd("/tmp/vd_99zzzz_bl_list.json"),ex=rd("/tmp/vd_99zzzz_bl_exists.json");
const ss=(st&&st.sliceStats)||{};const ours=/^2026-09-09\.(\d+)$/.exec(String(ss.build||""));const sliced=!!ours&&Number(ours[1])>=100;
const since=sliced?Date.parse(ss.buildSince||""):NaN;const ageH=Number.isFinite(since)?(Date.now()-since)/3600000:null;
// L1
if(!Array.isArray(hh))console.log("FAIL  L1 get_company_hiring_health did not answer rows: "+JSON.stringify(hh).slice(0,200));
else{const pos=hh.filter((r)=>Number(r.superseded_90d)>0);const line=hh.map((r)=>String(r.company_token).split("~")[0]+" "+r.superseded_90d+"/"+r.closed_90d).join(", ");
  if(pos.length)console.log("PASS  L1 a lapped board logs re-listed requisitions as superseded: superseded/fills over 90 days "+line+" (all five read 0 on .96)");
  else if(ageH!==null&&ageH>=72)console.log("FAIL  L1 72 h after .100 first slice ("+ss.buildSince+") every lapped board still reads superseded_90d = 0 ("+line+"): the lap closures still read superseded from one window, or no lap closed");
  else console.log("INFO  L1 superseded_90d still 0 on all five ("+line+"); "+(ageH===null?"no .100 slice yet":"waits 72 h after .100 first slice ("+ageH.toFixed(1)+" h so far)"))
  const BASE={oreillyauto:[1291,32],cvshealth:[5430,9]},baseAt=Date.parse(process.env.VDBL_BASE_AT||"2026-11-01T14:27:00Z"),daysOn=(Date.now()-baseAt)/86400000;
  const got=hh.map((r)=>{const k=String(r.company_token).split("~")[0],b=BASE[k];if(!b)return null;const s=Number(r.superseded_90d);return{k,s,n:s+Number(r.closed_90d)-b[0],roll:b[1]+daysOn>=85}}).filter(Boolean);
  const said=got.map((g)=>g.k+" "+g.s+" of "+g.n).join(", ");const lagH=Number.isFinite(since)?(since-baseAt)/3600000:null;
  if(got.length<2||got.some((g)=>!Number.isFinite(g.n)||g.n<0))console.log("INFO  L1b cannot read new closures against the base for O\u0027Reilly and CVS ("+(said||"no rows")+")");
  else if(got.some((g)=>g.roll))console.log("INFO  L1b the base read is "+daysOn.toFixed(0)+" days old: its oldest closures leave the 90-day window, so closed_90d less the base no longer counts new closures; re-base");
  else if(lagH===null||ageH===null)console.log("INFO  L1b waits for .100 first slice ("+said+")");
  else if(ageH<Math.max(24,lagH))console.log("INFO  L1b .100 first sliced "+lagH.toFixed(0)+" h after the base read and has served "+ageH.toFixed(0)+" h: judged at "+Math.max(24,lagH).toFixed(0)+" h, when main\u2019s closures in between can no longer outweigh this build\u2019s ("+said+")");
  else{const hi=got.filter((g)=>g.n>=200&&g.s/g.n>=0.3);
    if(hi.length)console.log("FAIL  L1b 30% or more of the closures logged since the base read are superseded ("+said+"): a lap keys a relist on title alone again (92% and 72% on the corpus, title and place 17%)");
    else if(got.every((g)=>g.n>=200))console.log("PASS  L1b under 30% of the closures logged since the base read are superseded (superseded of new: "+said+")");
    else console.log("INFO  L1b fewer than 200 closures logged since the base read on one board ("+said+"): re-run")}}
// L2
const ds=st&&st.descSweep;
if(!ds||typeof ds!=="object")console.log("FAIL  L2 status carries no descSweep: "+JSON.stringify(st).slice(0,200));
else if(!("cursor" in ds)||!("floor" in ds))console.log("FAIL  L2 status.descSweep has no cursor/floor keys on "+(ss.build||"?")+": "+JSON.stringify(ds));
else{const written=Date.now()-Number(ds.ageMin)*60000;const judged=Number.isFinite(since)&&Number.isFinite(written)&&written>=since+10*60000;
  const c=ds.cursor;const keyset=typeof c==="string"&&/^\d{4}-\d\d-\d\dT[^|]+\|.+/.test(c);
  if(c===null)console.log("INFO  L2 status.descSweep carries cursor and floor ("+JSON.stringify(ds)+"); the cursor is null right now (the start of a walk, the boards phase or a settled rotation): re-run to judge its shape");
  else if(keyset)console.log("PASS  L2 the description sweep pages on first_seen|id: cursor "+c+", floor "+ds.floor);
  else if(judged)console.log("FAIL  L2 a cursor written after .100 first slice is not first_seen|id: "+JSON.stringify(c)+" (the bare first_seen of main skips rows one insert stamped alike)");
  else console.log("INFO  L2 cursor "+JSON.stringify(c)+" was written before .100 had served 10 minutes: re-run")}
// L3
const served=((ls&&ls.jobs)||[]).map((x)=>x.id).filter((x)=>typeof x==="string");const open=(ex&&ex.open)||null;
if(!open)console.log("FAIL  L3 exists did not answer an open map: "+JSON.stringify(ex).slice(0,200));
else if(ex.rowTest!=="served")console.log("FAIL  L3 exists answers rowTest "+JSON.stringify(ex.rowTest)+", not \"served\": this is the row-only exists of .96 (an open map from it reads the same on a whole-read board)");
else if(!served.length)console.log("INFO  L3 the list served no gusto rows today, so exists has nothing served to agree with");
else{const shut=served.filter((id)=>open[id]!==true);const fake=open["greenhouse:gusto:0000000000"];
  if(shut.length||fake!==false)console.log("FAIL  L3 exists disagrees with the list: "+shut.length+" of "+served.length+" served rows not open"+(shut.length?" (e.g. "+shut.slice(0,3).join(", ")+")":"")+", an id no board holds read "+JSON.stringify(fake));
  else console.log("PASS  L3 exists names the served row test and answers open for all "+served.length+" rows the list serves on gusto and false for an id no board holds")}
' 2>&1
fi
