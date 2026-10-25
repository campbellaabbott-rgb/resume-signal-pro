# shellcheck shell=bash
# ── 99z. ORACLE HOSTS WITH NO REGION: JPMorgan Chase is read from
# jpmc.fa.oraclecloud.com (branch oh/integration, job-board 2026-09-09.95,
# layoff-filings 2026-10-15.1; docs/job-board-deploy-notes.md, .95).
#
# Named 99z so it sorts after every 99-* section: the loader sources
# verify-deploy.d/*.sh in name order, and a three-digit name (100-) sorts
# right after 10-, before 11-, so it would not run last.
#
# THE CLOCK. Every wait below is measured from status.sliceStats.buildSince,
# the first slice of the serving build, and only when sliceStats.build is the
# build the preflight answers (just after a deploy the last slice is still
# the old bundle's, whose buildSince dates nothing here).
#
# THE CLAIMS, one line each below:
#   - job-board's preflight answers job-board.2026-09-09.95 or later. An older
#     build is INFO and every JPMorgan line waits for it: the old code cannot
#     read a host with no region, so judging its rows would judge nothing;
#   - the serving catalogue carries jpmc~~CX_1001 (the list does not name it
#     an employer we do not carry);
#   - JPMorgan Chase is read at all: it serves rows, and a row with an apply
#     link, within 12 h of the build's first slice (its first visit lands 2-3 h
#     after the deploy). Before 12 h an empty board is INFO; after, FAIL. Any
#     status.recentFailures entry naming JPMorgan Chase is printed as INFO;
#   - JPMorgan Chase serves within 10% of the employer's own "less than 30
#     days" count, read live from its feed, once get_company_fill_curve says
#     its first full read is proven (full_read or lap_proven). Before that the
#     comparison is INFO: a 7,244-posting board takes about 25 visits to read
#     whole, and closed postings stay up until the read completes. Still
#     unproven 72 h after the first slice while serving under half the
#     employer's count is a FAIL (every in-window row lands about 15 h after
#     the first visit);
#   - a served JPMorgan apply link is on jpmc.fa.oraclecloud.com and answers
#     200, and the requisition it names answers on the employer's own detail
#     endpoint. The apply page is a single-page app that answers 200 for a
#     made-up id too, so the detail item is what makes the link a live one;
#   - a served JPMorgan row's description reads back through the board's
#     detail action (a stored one, or one the region-less detail read fetches
#     on the spot, as a seeker's click does);
#   - a regional Oracle board (Hilton, efet~us2~CX_1) still serves, its apply
#     links on efet.fa.us2.oraclecloud.com, and THIS build read its feed: the
#     rows' recheckedAt (the board's read stamp, job_board_verifications,
#     written on every good fetch) is after the build's first slice, or, when
#     the list leaves that stamp off, a row was first seen (inserted, which is
#     all lastSeen records) after it. The shared host builder did not break the
#     boards that have a region. Before such a read it is INFO while the build
#     is under 24 h old (a hot board laps in about 7 h), and FAIL after.
#
# READ-ONLY. One OPTIONS preflight; job-board status, list and detail reads
# sent with x-rb-budget: probe (detail is the seeker's own read); one anon RPC GET of a
# STABLE reader; three GETs to JPMorgan's own host (the feed's first row and
# its facet, one apply page, one requisition detail), paced 1.2 s apart.
echo "== 99z. Oracle hosts with no region: JPMorgan Chase is read from jpmc.fa.oraclecloud.com, and the regional boards still read =="

VD99Z_TOK="jpmc~~CX_1001"
VD99Z_CTL="efet~us2~CX_1"
VD99Z_HOST="jpmc.fa.oraclecloud.com"
VD99Z_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
VD99Z_LIVE=0
if [ -z "$VD99Z_H" ]; then echo "FAIL  job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VD99Z_H" "2026-09-09" "95"; then echo "PASS  job-board preflight x-fn-build = $VD99Z_H (job-board.2026-09-09.95 or later: the build that reads an Oracle host with no region)"; VD99Z_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VD99Z_H: job-board.2026-09-09.95, the build that reads an Oracle host with no region, is not serving yet, so the JPMorgan lines wait for it"; fi

if [ "$VD99Z_LIVE" = 1 ]; then
  rm -f /tmp/vd_99z_jpmc.json /tmp/vd_99z_curve.json /tmp/vd_99z_feed.json /tmp/vd_99z_ctl.json /tmp/vd_99z_status.json /tmp/vd_99z_req.json /tmp/vd_99z_detail.json /tmp/vd_99z_pick.txt
  J "{\"action\":\"list\",\"companies\":[\"$VD99Z_TOK\"],\"vendor\":[\"oracle\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":5}" > /tmp/vd_99z_jpmc.json
  curl -s -m 60 "$B/rest/v1/rpc/get_company_fill_curve?p_tokens=%7B%22jpmc~~CX_1001%22%7D" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_99z_curve.json
  curl -s -m 60 "https://$VD99Z_HOST/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs%3BsiteNumber%3DCX_1001%2Climit%3D1%2Coffset%3D0%2CsortBy%3DPOSTING_DATES_DESC" > /tmp/vd_99z_feed.json
  J "{\"action\":\"list\",\"companies\":[\"$VD99Z_CTL\"],\"vendor\":[\"oracle\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":20}" > /tmp/vd_99z_ctl.json
  J '{"action":"status"}' > /tmp/vd_99z_status.json
  VD99Z_TOK="$VD99Z_TOK" VD99Z_CTL="$VD99Z_CTL" VD99Z_HOST="$VD99Z_HOST" VD99Z_H="$VD99Z_H" node -e '
const fs=require("fs");const E=process.env;
const read=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync(f,"utf8").slice(0,160).replace(/\s+/g," ")}catch{return "(no answer)"}};
const L=read("/tmp/vd_99z_jpmc.json"),C=read("/tmp/vd_99z_curve.json"),F=read("/tmp/vd_99z_feed.json"),X=read("/tmp/vd_99z_ctl.json"),S=read("/tmp/vd_99z_status.json");
const pick=[];
const ss=S&&S.sliceStats&&typeof S.sliceStats==="object"?S.sliceStats:null;const since=ss?Date.parse(ss.buildSince||""):NaN;
const serving=String(E.VD99Z_H||"").replace(/^job-board\./,"");const ours=!!ss&&ss.build===serving;
const ageH=ours&&Number.isFinite(since)?(Date.now()-since)/3600000:null;
const after=()=>ageH.toFixed(1)+" h after the first slice of this build";
const clock=ss&&!ours?"sliceStats.build is "+ss.build+", not the serving "+serving+": no slice of this build has run yet, so nothing here is timed":(ageH===null?"status states no sliceStats.buildSince, so the wait is not timed here":"the first slice of this build was "+ageH.toFixed(1)+" h ago");
if(ss&&!ours)console.log("INFO  "+clock+"; re-run once it has");
const fails=S&&Array.isArray(S.recentFailures)?S.recentFailures.filter((x)=>typeof x==="string"&&/^JPMorgan Chase \(/.test(x)):[];
if(fails.length)console.log("INFO  job-board recent failures name JPMorgan Chase: "+JSON.stringify(fails));
if(!L||typeof L!=="object"||Array.isArray(L)){console.log("FAIL  job-board list for "+E.VD99Z_TOK+" is unreadable: "+peek("/tmp/vd_99z_jpmc.json"))}
else{
  const unknown=Array.isArray(L.unknownCompanies)&&L.unknownCompanies.includes(E.VD99Z_TOK);
  console.log((unknown?"FAIL":"PASS")+"  the serving catalogue "+(unknown?"does NOT carry ":"carries ")+E.VD99Z_TOK+(unknown?" (the list names it an employer we do not carry: the catalogue entry did not ship)":" (the list does not name it an employer we do not carry)"));
  const served=typeof L.total==="number"?L.total:null;const jobs=Array.isArray(L.jobs)?L.jobs:[];
  const curve=Array.isArray(C)?C.find((r)=>r&&r.company_token===E.VD99Z_TOK):null;
  const bucket=curve?curve.observability_bucket:null;const proven=bucket==="full_read"||bucket==="lap_proven";
  const facet=F&&Array.isArray(F.items)&&F.items[0]&&Array.isArray(F.items[0].postingDatesFacet)?F.items[0].postingDatesFacet.find((x)=>Number(x.Id)===30):null;
  const vendor=facet&&typeof facet.TotalCount==="number"?facet.TotalCount:null;
  const total=F&&Array.isArray(F.items)&&F.items[0]?F.items[0].TotalJobsCount:null;
  const against=vendor===null?"; its own feed did not state a less-than-30-days count: "+peek("/tmp/vd_99z_feed.json"):" against "+vendor+" posted in the last 30 days on its own feed (TotalJobsCount "+total+")";
  if((served===null||served===0)&&ageH!==null&&ageH>12){console.log("FAIL  JPMorgan Chase serves "+served+" rows "+after()+against+" (fill-curve bucket "+bucket+"): its first visit lands 2-3 h after the deploy, so after 12 h the region-less board is not being read")}
  else if(served===null||served===0){console.log("INFO  JPMorgan Chase serves "+served+" rows"+against+": a new board is first read 2-3 h after the deploy, behind the bootstrap backlog; "+clock+"; re-run later (fill-curve bucket "+bucket+"; FAIL once 12 h have passed)")}
  else if(vendor===null){console.log("INFO  JPMorgan Chase serves "+served+" rows"+against)}
  else{
    const ratio=served/vendor;const within=Math.abs(ratio-1)<=0.10;
    const msg="JPMorgan Chase serves "+served+" rows against "+vendor+" posted in the last 30 days on its own feed (ratio "+ratio.toFixed(3)+", tolerance 10%; TotalJobsCount "+total+"; fill-curve bucket "+bucket+")";
    if(!proven&&ageH!==null&&ageH>72&&ratio<0.5)console.log("FAIL  "+msg+": its first full read is still not proven "+after()+", and it serves under half the count on the employer feed (every in-window row lands about 15 h after the first visit)");
    else if(!proven)console.log("INFO  "+msg+": its first full read is not proven yet, so the count is not judged (closed postings stay up until a read completes; about 25 visits a lap; FAIL if still unproven and under half after 72 h)");
    else console.log((within?"PASS":"FAIL")+"  "+msg+(within?"":": a proven full read should serve the in-window count"));
  }
  const j=jobs.find((x)=>x&&typeof x.applyUrl==="string"&&x.applyUrl);
  if(!j&&ageH!==null&&ageH>12){console.log("FAIL  no JPMorgan row with an apply link is served "+after()+": the first visit lands 2-3 h after the deploy, so the region-less read or its apply links are broken")}
  else if(!j){console.log("INFO  no JPMorgan row with an apply link is served yet, so the apply link and description lines wait for the first read ("+clock+"; FAIL once 12 h have passed)")}
  else{
    let host="";try{host=new URL(j.applyUrl).hostname}catch{}
    const id=String(j.id||"").split(":").pop();
    console.log((host===E.VD99Z_HOST?"PASS":"FAIL")+"  a served JPMorgan apply link is on "+(host||"(unparseable)")+(host===E.VD99Z_HOST?"":" (want "+E.VD99Z_HOST+")")+": "+j.applyUrl);
    if(host===E.VD99Z_HOST&&/^\d{1,15}$/.test(id))pick.push(j.applyUrl,id,j.id);
  }
}
if(!X||!Array.isArray(X.jobs)){console.log("FAIL  job-board list for the regional control "+E.VD99Z_CTL+" is unreadable: "+peek("/tmp/vd_99z_ctl.json"))}
else{
  const hosts=[...new Set(X.jobs.map((x)=>{try{return new URL(x.applyUrl).hostname}catch{return "(unparseable)"}}))];
  const want=E.VD99Z_CTL.split("~")[0]+".fa."+E.VD99Z_CTL.split("~")[1]+".oraclecloud.com";
  const ok=typeof X.total==="number"&&X.total>=100&&hosts.length===1&&hosts[0]===want;
  console.log((ok?"PASS":"FAIL")+"  the regional Oracle control "+E.VD99Z_CTL+" serves "+X.total+" rows (want 100 or more), apply links on "+JSON.stringify(hosts)+" (want [\""+want+"\"])");
  const newestOf=(k)=>{const t=X.jobs.map((x)=>Date.parse((x&&x[k])||"")).filter(Number.isFinite);return t.length?Math.max(...t):null};
  const stamp=newestOf("recheckedAt"),ins=newestOf("lastSeen");
  const age=(t)=>((Date.now()-t)/3600000).toFixed(1)+" h ago";
  const fetched=stamp===null?"the list carried no read stamp (recheckedAt)":"its feed was last fetched "+age(stamp);
  const host=": the host builder still reaches a host with a region";
  if(stamp===null&&ins===null)console.log("FAIL  the regional Oracle control "+E.VD99Z_CTL+" served no row with a read stamp (recheckedAt) or a first-seen time (lastSeen), so nothing shows a read reached it");
  else if(!ss||!Number.isFinite(since))console.log("FAIL  job-board status states no sliceStats.buildSince, so nothing dates this build against the control ("+fetched+"): "+peek("/tmp/vd_99z_status.json"));
  else if(!ours)console.log("INFO  the regional Oracle control "+E.VD99Z_CTL+" is not judged against this build: "+clock+" ("+fetched+")");
  else if(stamp!==null&&stamp>=since)console.log("PASS  the regional Oracle control "+E.VD99Z_CTL+" was read by this build: its feed was last fetched "+age(stamp)+" (recheckedAt, the board read stamp), after the first slice of this build "+age(since)+" (sliceStats.build "+ss.build+")"+host);
  else if(ins!==null&&ins>=since)console.log("PASS  the regional Oracle control "+E.VD99Z_CTL+" was read by this build: a row it first saw (inserted) "+age(ins)+", after the first slice of this build "+age(since)+" (sliceStats.build "+ss.build+"; "+fetched+")"+host);
  else if(Date.now()-since<24*3600000)console.log("INFO  the regional Oracle control "+E.VD99Z_CTL+": "+fetched+", before the first slice of this build "+age(since)+", and no row was first seen since: a hot board laps in about 7 h, so re-run once the build is older");
  else console.log("FAIL  the regional Oracle control "+E.VD99Z_CTL+": "+fetched+", before the first slice of this build "+age(since)+", and no row was first seen since: more than 24 h without a read on a host with a region");
}
fs.writeFileSync("/tmp/vd_99z_pick.txt",pick.join("\n"));
' 2>&1 || echo "FAIL  99z judge threw (see the lines above)"
  VD99Z_URL=$(sed -n 1p /tmp/vd_99z_pick.txt 2>/dev/null); VD99Z_ID=$(sed -n 2p /tmp/vd_99z_pick.txt 2>/dev/null); VD99Z_JOB=$(sed -n 3p /tmp/vd_99z_pick.txt 2>/dev/null)
  if [ -n "$VD99Z_URL" ] && [ -n "$VD99Z_ID" ]; then
    sleep 1.2
    VD99Z_CODE=$(curl -s -m 60 -o /dev/null -w '%{http_code}' "$VD99Z_URL")
    if [ "$VD99Z_CODE" = "200" ]; then echo "PASS  the JPMorgan apply link answers 200 on the employer's own host"; else echo "FAIL  the JPMorgan apply link answers HTTP $VD99Z_CODE (want 200): $VD99Z_URL"; fi
    sleep 1.2
    curl -s -m 60 "https://$VD99Z_HOST/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById%3BId%3D$VD99Z_ID%2CsiteNumber%3DCX_1001" > /tmp/vd_99z_req.json
    VD99Z_ID="$VD99Z_ID" node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_99z_req.json","utf8"))}catch{}
const n=j&&Array.isArray(j.items)?j.items.length:null;
if(n===null)console.log("FAIL  the employer detail endpoint answered no readable JSON for requisition "+process.env.VD99Z_ID);
else console.log((n>0?"PASS":"FAIL")+"  requisition "+process.env.VD99Z_ID+" answers on the employer detail endpoint with "+n+" item(s) (want 1: the served link names a live requisition, which a 200 from the apply page alone cannot show)");
' || echo "FAIL  99z detail judge threw"
    sleep 1.2
    J "{\"action\":\"detail\",\"id\":\"$VD99Z_JOB\"}" > /tmp/vd_99z_detail.json
    VD99Z_JOB="$VD99Z_JOB" node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_99z_detail.json","utf8"))}catch{}
if(!j||typeof j!=="object")console.log("FAIL  the board detail read for "+process.env.VD99Z_JOB+" is unreadable");
else if(j.agedOut||j.closed)console.log("INFO  "+process.env.VD99Z_JOB+" left the serving window between the list and the detail read ("+(j.agedOut?"aged out":"closed")+"); re-run");
else{const d=typeof j.description==="string"?j.description.trim():"";console.log((d.length>=200?"PASS":"FAIL")+"  the board reads a "+d.length+"-character description for "+process.env.VD99Z_JOB+" (want 200 or more: the detail read on the region-less host works)")}
' || echo "FAIL  99z description judge threw"
  fi
fi
