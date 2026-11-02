# shellcheck shell=bash
# ── 99zzzz-board-reach. CRAWLER REACH: the Workday tenants that refuse `*` on
# their first page are read, UKG boards over 600 and Oracle tenants over
# 10,000 prove their laps, and an iCIMS later-page refusal no longer fails the
# visit (branch fix/bs-reach, job-board 2026-09-09.100; notes n1430-n1433).
#
# THE CLOCK. Every wait below is measured from status.sliceStats.buildSince,
# the first slice of the serving build, and only when sliceStats.build is the
# build the preflight answers (just after a deploy the last slice is still
# the old bundle's, whose buildSince dates nothing here).
#
# THE CLAIMS, one line each below:
#   - job-board's preflight answers job-board.2026-09-09.100 or later (the
#     build carrying all four fixes; the iCIMS rule, S13-035, has no read-only
#     live sign of its own and is proven by its test). An older build is INFO
#     and every other line waits for it;
#   - each of five Workday boards that answered HTTP 500 on every visit and
#     served 0 rows on 2026-11-01 (Truist, Geico, WVU Medicine UHA and WVUH,
#     7-Eleven) is carried and serves rows within 36 h of the
#     build's first slice (a dormant board is rechecked every 12 h). Before
#     36 h an empty board is INFO; after, FAIL;
#   - Ollie's Bargain Outlet (UKG, 1,392 postings on 2026-11-01, bucket
#     unprovable that day) proves a lap: its fill-curve
#     bucket reads lap_proven within 5 days of the first slice. Before 5 days
#     another bucket is INFO; after, FAIL;
#   - each of Kroger, AutoZone, Marriott and Kotak (Oracle, over 10,000, all
#     lap_pending on 2026-11-01) proves
#     a lap within 7 days of the first slice, when the employer's own row 9,999
#     (read live) is posted more than a day before the 30-day fence. A floor
#     inside the fence is INFO (the build declines to prove there). A proven
#     lap also closes what the read no longer lists: once the bucket reads
#     lap_proven, the board's open dated rows number no more than the 10,000
#     a capped read can serve plus 3% for postings added during the lap
#     (Marriott 13,309, AutoZone 11,567 and Kroger 10,337 on 2026-11-01; a
#     build that proves the lap but stamps nothing keeps them there).
#
# READ-ONLY. One OPTIONS preflight; job-board status and list reads sent with
# x-rb-budget: probe; one anon GET of the fill-curve reader; four GETs to the
# Oracle tenants' own CE REST feeds (one row each), paced 1.2 s apart.
echo "== 99zzzz-board-reach. Crawler reach: Workday first pages, UKG and Oracle laps =="

VDBR_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
VDBR_LIVE=0
if [ -z "$VDBR_H" ]; then echo "FAIL  job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VDBR_H" "2026-09-09" "100"; then echo "PASS  job-board preflight x-fn-build = $VDBR_H (job-board.2026-09-09.100 or later: the Workday first-page rule, the UKG and ADP cursor, the Oracle cap and the iCIMS later-page rule)"; VDBR_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VDBR_H: job-board.2026-09-09.100 is not serving yet, so the reach lines wait for it"; fi

if [ "$VDBR_LIVE" = 1 ]; then
  rm -f /tmp/vd_br_status.json /tmp/vd_br_curve.json /tmp/vd_br_wd_*.json /tmp/vd_br_ora_*.json
  J '{"action":"status"}' > /tmp/vd_br_status.json
  for t in truist~wd1~careers geico~wd1~External wvumedicine~wd1~UHA wvumedicine~wd1~WVUH 7eleven~wd3~7eleven; do
    J "{\"action\":\"list\",\"companies\":[\"$t\"],\"vendor\":[\"workday\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":1}" > "/tmp/vd_br_wd_$t.json"
  done
  curl -s -m 60 "$B/rest/v1/rpc/get_company_fill_curve?p_tokens=%7B%22recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845%22,%22eluq~us2~CX_1%22,%22egud~us2~CX_1%22,%22ejwl~us2~CX%22,%22hcbt~em2~CX_1001%22%7D" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_br_curve.json
  for t in eluq~us2~CX_1 egud~us2~CX_1 ejwl~us2~CX hcbt~em2~CX_1001; do
    VDBR_HOST="$(echo "$t" | cut -d'~' -f1).fa.$(echo "$t" | cut -d'~' -f2).oraclecloud.com"; VDBR_SITE=$(echo "$t" | cut -d'~' -f3)
    sleep 1.2
    curl -s -m 60 "https://$VDBR_HOST/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs%3BsiteNumber%3D$VDBR_SITE%2Climit%3D1%2Coffset%3D9999%2CsortBy%3DPOSTING_DATES_DESC" > "/tmp/vd_br_ora_$t.json"
  done
  VDBR_H="$VDBR_H" node -e '
const fs=require("fs");const E=process.env;
const read=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync(f,"utf8").slice(0,160).replace(/\s+/g," ")}catch{return "(no answer)"}};
const S=read("/tmp/vd_br_status.json"),C=read("/tmp/vd_br_curve.json");
const ss=S&&S.sliceStats&&typeof S.sliceStats==="object"?S.sliceStats:null;const since=ss?Date.parse(ss.buildSince||""):NaN;
const serving=String(E.VDBR_H||"").replace(/^job-board\./,"");const stale=!!ss&&!!ss.build&&ss.build!==serving;
const ageH=!stale&&!!ss&&ss.build===serving&&Number.isFinite(since)?(Date.now()-since)/3600000:null;
const clock=stale?"sliceStats.build is "+ss.build+", not the serving "+serving+": no slice of this build has run yet":(ageH===null?"status states no sliceStats.buildSince, so the wait is not timed":"the first slice of this build was "+ageH.toFixed(1)+" h ago");
if(stale)console.log("INFO  "+clock+"; re-run once it has");
else if(ageH===null)console.log("FAIL  job-board status states no sliceStats.buildSince (with sliceStats.build), so nothing dates this build: "+peek("/tmp/vd_br_status.json"));
const due=(h)=>ageH!==null&&ageH>h;
const names={"truist~wd1~careers":"Truist","geico~wd1~External":"Geico","wvumedicine~wd1~UHA":"WVU Medicine UHA","wvumedicine~wd1~WVUH":"WVU Medicine WVUH","7eleven~wd3~7eleven":"7-Eleven"};
for(const [t,n] of Object.entries(names)){
  const L=read("/tmp/vd_br_wd_"+t+".json");
  if(!L||typeof L!=="object"||typeof L.total!=="number"){console.log("FAIL  job-board list for "+t+" is unreadable: "+peek("/tmp/vd_br_wd_"+t+".json"));continue}
  if(Array.isArray(L.unknownCompanies)&&L.unknownCompanies.includes(t)){console.log("FAIL  the serving catalogue does NOT carry "+n+" ("+t+"), so its rows cannot be judged");continue}
  if(L.total>0)console.log("PASS  "+n+" ("+t+") serves "+L.total+" rows (it served 0 on 2026-11-01, while its first page answered HTTP 500 in the runtime language)");
  else if(due(36))console.log("FAIL  "+n+" ("+t+") serves 0 rows "+ageH.toFixed(1)+" h after the first slice of this build: a dormant board is rechecked every 12 h, so its first page is still failing");
  else console.log("INFO  "+n+" ("+t+") serves 0 rows yet; "+clock+" (a dormant board is rechecked every 12 h; FAIL after 36 h)");
}
const curve=Array.isArray(C)?C:null;
const rowOf=(t)=>curve&&curve.find((x)=>x&&x.company_token===t);const bucketOf=(t)=>{const r=rowOf(t);return r?r.observability_bucket:null};
if(!curve)console.log("FAIL  the fill-curve read is unreadable: "+peek("/tmp/vd_br_curve.json"));
else{
  const OL="Ollie"+String.fromCharCode(39)+"s Bargain Outlet";const oll="recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845";const b=bucketOf(oll);
  if(b==="lap_proven")console.log("PASS  "+OL+" (UKG, over 600 postings) has proven a lap (fill-curve bucket lap_proven): its walk resumes past 600 and wraps at the end of the feed");
  else if(due(120))console.log("FAIL  "+OL+" (UKG) still reads bucket "+b+" "+ageH.toFixed(1)+" h after the first slice of this build: a three-visit lap should have proven within 5 days");
  else console.log("INFO  "+OL+" (UKG) reads bucket "+b+"; "+clock+" (FAIL after 5 days without lap_proven)");
  const fence=Date.now()-30*86400000;
  const ora={"eluq~us2~CX_1":"Kroger","egud~us2~CX_1":"AutoZone","ejwl~us2~CX":"Marriott","hcbt~em2~CX_1001":"Kotak"};
  for(const [t,n] of Object.entries(ora)){
    const F=read("/tmp/vd_br_ora_"+t+".json");const it=F&&Array.isArray(F.items)?F.items[0]:null;
    const row=it&&Array.isArray(it.requisitionList)?it.requisitionList[0]:null;const floor=row?Date.parse(String(row.PostedDate||"")):NaN;
    const b=bucketOf(t);
    const at=Number.isFinite(floor)?"its own row 9,999 is posted "+String(row.PostedDate)+" (TotalJobsCount "+it.TotalJobsCount+")":"its own feed served no row 9,999 ("+peek("/tmp/vd_br_ora_"+t+".json")+")";
    const cr=rowOf(t)||{};const dated=Number(cr.open_roles)-Number(cr.undated_open||0);
    if(b==="lap_proven"&&!(dated<=10300))console.log("FAIL  "+n+" ("+t+", Oracle) reads bucket lap_proven but still holds "+cr.open_roles+" open rows ("+(cr.undated_open||0)+" undated), more than the 10,000 a capped read can serve plus 3%: the lap proved and closed nothing it no longer lists; "+at);
    else if(b==="lap_proven")console.log("PASS  "+n+" ("+t+", Oracle) has proven a lap at the 10,000 cap (bucket lap_proven) and holds "+dated+" open dated rows, within the 10,300 a capped read can serve; "+at);
    else if(!Number.isFinite(floor))console.log("INFO  "+n+" ("+t+") reads bucket "+b+", and "+at+": under 10,000 now, or the feed did not answer, so the cap rule is not judged");
    else if(floor+86400000>=fence)console.log("INFO  "+n+" ("+t+") reads bucket "+b+": "+at+", inside the 30-day fence, so the build rightly declines to prove a capped lap");
    else if(due(168))console.log("FAIL  "+n+" ("+t+") still reads bucket "+b+" "+ageH.toFixed(1)+" h after the first slice of this build, and "+at+", older than the fence: a capped lap should have proven within 7 days");
    else console.log("INFO  "+n+" ("+t+") reads bucket "+b+"; "+at+"; "+clock+" (FAIL after 7 days without lap_proven)");
  }
}
' 2>&1 || echo "FAIL  99zzzz-board-reach judge threw (see the lines above)"
fi
