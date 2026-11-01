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
#   L2  (S13-113) status.descSweep reports the sweep's cursor and floor, and a
#       cursor written 10 minutes or more after .100's first slice is
#       first_seen|id (a bare timestamp is main's cursor); INFO while the
#       cursor is null (a walk's start, the boards phase, a settled rotation);
#   L3  (S13-076) exists answers open for every row the list serves on one
#       small whole-read board, and not for an id no board holds (anon reads no
#       stamped row; the stamped half is the unit test's).
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
  else console.log("INFO  L1 superseded_90d still 0 on all five ("+line+"); "+(ageH===null?"no .100 slice yet":"waits 72 h after .100 first slice ("+ageH.toFixed(1)+" h so far)"))}
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
else if(!served.length)console.log("INFO  L3 the list served no gusto rows today, so exists has nothing served to agree with");
else{const shut=served.filter((id)=>open[id]!==true);const fake=open["greenhouse:gusto:0000000000"];
  if(shut.length||fake!==false)console.log("FAIL  L3 exists disagrees with the list: "+shut.length+" of "+served.length+" served rows not open"+(shut.length?" (e.g. "+shut.slice(0,3).join(", ")+")":"")+", an id no board holds read "+JSON.stringify(fake));
  else console.log("PASS  L3 exists answers open for all "+served.length+" rows the list serves on gusto and false for an id no board holds")}
' 2>&1
fi
