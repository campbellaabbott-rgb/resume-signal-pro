# shellcheck shell=bash
# ── 99zzzz. BOARD FIELDS: what the vendor states reaches the row, and an age
# or a story is not a years floor (branch fix/bs-fields,
# job-board 2026-09-09.100; docs/job-board-deploy-notes.md, .100; notes
# n1420-n1427 in docs/job-board-index-notes.md).
#
# Named 99zzzz so it sorts after 99zzz- in byte order and under a collating
# locale (verify-deploy.d/README.md).
#
# THE CLOCK. Every wait is measured from status.sliceStats.buildSince, and
# only when sliceStats.build is the build the preflight answers. A board line
# is judged once this build has read the board: its rows' newest recheckedAt
# (the board read stamp) is after the first slice. Before that it is INFO for
# 24 h, then FAIL. The Domino's sweep line waits 24 h for the
# EXPERIENCE_VERSION 3 sweep, which status does not report.
#
# THE CLAIMS, one line each below:
#   - job-board's preflight answers job-board.2026-09-09.100 or later; older is
#     INFO and every other line waits for it;
#   - no Domino's delivery row is filed Expert on a figure of 15 to 21 years
#     (an age or a story), against a control that the board serves delivery rows;
#   - Breezy pay: national-assemblers-inc serves a row with stated pay and an
#     annual figure;
#   - Breezy type and country: staffmill-oy serves at least 80% of its rows
#     typed and 95% with a country (most say only "Kuopio, FI");
#   - Recruitee type: nozrecrute serves at least half its rows typed
#     (fulltime_permanent and similar codes);
#   - BambooHR type: qualitymoments serves at least 80% of its rows typed;
#   - Lever country: insomniacookies serves 95% of its rows with a country
#     (one corpus posting in 1,110 states none);
#   - Workable country: utopia-life-worth-living serves 95% with a country;
#   - Personio type: metzen serves an internship row;
#   - Lever text: a tryjeeves row first seen after the first slice reads its
#     first requirement list item, and its opening once, against Lever's own
#     posting (INFO while no row is that new);
#   - Personio in another language: a lyceum-technology posting that is
#     empty in the default feed reads its English description through the
#     board's detail action (a seeker's click);
#   - Paylocity: a posting whose page carries no structured data reads a
#     description of 200 characters or more through the board's detail action.
#
# READ-ONLY. One OPTIONS preflight; job-board status, list and detail reads
# sent with x-rb-budget: probe; GETs to the vendors' own public feeds and
# pages (one Lever posting, two Personio feeds, up to three Paylocity pages),
# paced 1.2 s apart.
echo "== 99zzzz. Board fields: vendor-stated pay, type and country reach the row; an age or a story is not a years floor =="

VDBF_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
VDBF_LIVE=0
if [ -z "$VDBF_H" ]; then echo "FAIL  job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VDBF_H" "2026-09-09" "100"; then echo "PASS  job-board preflight x-fn-build = $VDBF_H (job-board.2026-09-09.100 or later: the build that reads these fields)"; VDBF_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VDBF_H: job-board.2026-09-09.100 is not serving yet, so the field lines wait for it"; fi

VDBF_BOARDS='[["breezy","national-assemblers-inc","pay"],["breezy","staffmill-oy","typecountry"],["recruitee","nozrecrute","type50"],["bamboohr","qualitymoments","type80"],["lever","insomniacookies","country"],["workable","utopia-life-worth-living","country"],["personio","metzen","intern"]]'
VDBF_PAYLOCITY='[["d046f154-8f5e-484e-ad23-2a0db3d29231","4218310"],["dcf0d29a-5748-4108-9599-cfa1954ec1f9","4074014"],["c719c45a-5165-498d-828c-fa725512b89a","4577929"]]'

if [ "$VDBF_LIVE" = 1 ]; then
  rm -f /tmp/vd_bf_*.json /tmp/vd_bf_*.xml /tmp/vd_bf_*.html /tmp/vd_bf_pick.txt
  J '{"action":"status"}' > /tmp/vd_bf_status.json
  J '{"action":"list","companies":["dominos"],"q":"delivery","experience":"expert","groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_bf_dominos.json
  J '{"action":"list","companies":["dominos"],"q":"delivery","groupSimilar":false,"includeFacets":false,"limit":5}' > /tmp/vd_bf_dominos_ctl.json
  VDBF_I=0
  for VDBF_ROW in $(printf '%s' "$VDBF_BOARDS" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{for(const [v,t] of JSON.parse(s))console.log(v+"|"+t)})'); do
    J "{\"action\":\"list\",\"companies\":[\"${VDBF_ROW#*|}\"],\"vendor\":[\"${VDBF_ROW%%|*}\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":60}" > "/tmp/vd_bf_board_$VDBF_I.json"
    VDBF_I=$((VDBF_I + 1))
  done
  J '{"action":"list","companies":["tryjeeves"],"vendor":["lever"],"groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_bf_lever.json
  VDBF_H="$VDBF_H" VDBF_BOARDS="$VDBF_BOARDS" node -e '
const fs=require("fs");const E=process.env;
const read=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync(f,"utf8").slice(0,160).replace(/\s+/g," ")}catch{return "(no answer)"}};
const S=read("/tmp/vd_bf_status.json");
const ss=S&&S.sliceStats&&typeof S.sliceStats==="object"?S.sliceStats:null;const since=ss?Date.parse(ss.buildSince||""):NaN;
const serving=String(E.VDBF_H||"").replace(/^job-board\./,"");const ours=!!ss&&ss.build===serving;
const ageH=ours&&Number.isFinite(since)?(Date.now()-since)/3600000:null;
const clock=ss&&!ours?"sliceStats.build is "+ss.build+", not the serving "+serving+": no slice of this build has run yet":(ageH===null?"status states no sliceStats.buildSince, so nothing is timed":"the first slice of this build was "+ageH.toFixed(1)+" h ago");
if(ageH===null)console.log("INFO  "+clock+"; every timed line below is INFO until it has");
const late=ageH!==null&&ageH>=24;
const rows=(x)=>x&&Array.isArray(x.jobs)?x.jobs:null;
const pick=[];
// Domino\u2019s delivery rows: an age or a story read as 15 to 21 years.
{const D=rows(read("/tmp/vd_bf_dominos.json")),C=read("/tmp/vd_bf_dominos_ctl.json");
 if(!D||!C||typeof C.total!=="number")console.log("FAIL  the Domino\u2019s delivery lists are unreadable: "+peek("/tmp/vd_bf_dominos.json")+" / "+peek("/tmp/vd_bf_dominos_ctl.json"));
 else if(C.total===0)console.log("INFO  Domino\u2019s serves no delivery row, so the age line has nothing to judge");
 else{const bad=D.filter((r)=>r&&/deliver|driver/i.test(String(r.title||""))&&r.experienceBand==="expert"&&typeof r.minYears==="number"&&r.minYears>=15&&r.minYears<=21);
  const say=bad.length+" Domino\u2019s delivery row(s) filed Expert on 15 to 21 years (of "+C.total+" delivery rows served)"+(bad.length?": "+JSON.stringify(bad.slice(0,3).map((r)=>[r.id,r.title,r.minYears])):"");
  if(!bad.length)console.log("PASS  "+say);else if(late)console.log("FAIL  "+say+", 24 h after the first slice: the v3 sweep did not clear the age lines");else console.log("INFO  "+say+"; the EXPERIENCE_VERSION 3 sweep re-derives stored rows after the deploy ("+clock+"; FAIL from 24 h)")}}
// Boards this build must have read.
const BOARDS=JSON.parse(E.VDBF_BOARDS);
BOARDS.forEach(([v,t,kind],i)=>{
  const L=read("/tmp/vd_bf_board_"+i+".json");const J=rows(L);
  if(!J){console.log("FAIL  the "+v+" list for "+t+" is unreadable: "+peek("/tmp/vd_bf_board_"+i+".json"));return}
  if(Array.isArray(L.unknownCompanies)&&L.unknownCompanies.includes(t)){console.log("FAIL  the catalogue no longer carries "+v+" board "+t+": re-point this line at another board the corpus names");return}
  if(!J.length){console.log((late?"FAIL":"INFO")+"  "+v+" board "+t+" serves no rows ("+clock+")");return}
  const stamp=Math.max(...J.map((r)=>Date.parse((r&&r.recheckedAt)||"")).filter(Number.isFinite));
  const read_=Number.isFinite(stamp)&&Number.isFinite(since)&&ours&&stamp>=since;
  const n=J.length,count=(f)=>J.filter(f).length;
  let ok,say;
  if(kind==="pay"){const k=count((r)=>r.salary&&typeof r.salaryMinAnnual==="number"&&r.salaryMinAnnual>0);ok=k>0;say=k+" of "+n+" rows carry the stated pay with an annual figure"}
  else if(kind==="typecountry"){const a=count((r)=>r.employmentType),c=count((r)=>r.country);ok=a>=0.8*n&&c>=0.95*n;say=a+" of "+n+" rows typed (want 80%), "+c+" of "+n+" with a country (want 95%)"}
  else if(kind==="type50"){const a=count((r)=>r.employmentType);ok=a>=0.5*n;say=a+" of "+n+" rows typed (want half)"}
  else if(kind==="type80"){const a=count((r)=>r.employmentType);ok=a>=0.8*n;say=a+" of "+n+" rows typed (want 80%)"}
  else if(kind==="country"){const c=count((r)=>r.country);ok=c>=0.95*n;say=c+" of "+n+" rows with a country (want 95%)"}
  else if(kind==="intern"){const a=count((r)=>r.employmentType==="internship");ok=a>0;say=a+" of "+n+" rows filed internship"}
  const read_say=Number.isFinite(stamp)?"read "+((Date.now()-stamp)/3600000).toFixed(1)+" h ago":"no read stamp on its rows";
  if(read_)console.log((ok?"PASS":"FAIL")+"  "+v+" board "+t+": "+say+" ("+read_say+", after the first slice of this build)");
  else if(late)console.log("FAIL  "+v+" board "+t+" has not been read by this build 24 h after its first slice ("+read_say+"): "+say);
  else console.log("INFO  "+v+" board "+t+": "+say+", but it was "+read_say+", before this build read it ("+clock+"; FAIL from 24 h)");
});
// A Lever row new enough to carry the whole posting.
{const J=rows(read("/tmp/vd_bf_lever.json"));
 if(!J)console.log("FAIL  the lever list for tryjeeves is unreadable: "+peek("/tmp/vd_bf_lever.json"));
 else{const fresh=ours&&Number.isFinite(since)?J.filter((r)=>r&&Date.parse(r.lastSeen||"")>=since):[];
  if(!fresh.length)console.log("INFO  no tryjeeves row was first seen after the first slice of this build yet ("+J.length+" served; "+clock+"): the Lever text line waits for a new posting");
  else pick.push(fresh[0].id)}}
fs.writeFileSync("/tmp/vd_bf_pick.txt",pick.join("\n"));
' 2>&1 || echo "FAIL  99zzzz judge threw (see the lines above)"

  VDBF_LEVER=$(sed -n 1p /tmp/vd_bf_pick.txt 2>/dev/null)
  if [ -n "$VDBF_LEVER" ]; then
    sleep 1.2
    curl -s -m 60 "https://api.lever.co/v0/postings/tryjeeves/${VDBF_LEVER##*:}" > /tmp/vd_bf_lever_vendor.json
    J "{\"action\":\"detail\",\"id\":\"$VDBF_LEVER\"}" > /tmp/vd_bf_lever_detail.json
    VDBF_LEVER="$VDBF_LEVER" node -e '
const fs=require("fs");const read=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const P=read("/tmp/vd_bf_lever_vendor.json"),D=read("/tmp/vd_bf_lever_detail.json");const id=process.env.VDBF_LEVER;
const flat=(s)=>String(s||"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const words=(s,k)=>(flat(s).match(new RegExp("[A-Za-z0-9]+(?: [A-Za-z0-9]+){"+(k-1)+"}"))||[""])[0];
if(!P||typeof P!=="object"||!P.id)console.log("INFO  Lever answered no posting for "+id+" (it may have closed between the list and the read)");
else if(!D||typeof D!=="object"||typeof D.description!=="string")console.log("FAIL  the board detail read for "+id+" carries no description: "+JSON.stringify(D).slice(0,160));
else{const li=(P.lists||[]).map((l)=>/<li>([\s\S]*?)<\/li>/.exec(String(l&&l.content||""))).find(Boolean);const item=li?words(li[1],4):"";
 const open=words(P.descriptionPlain,6);const d=flat(D.description);const times=open?d.split(open).length-1:1;
 if(!item)console.log("INFO  Lever posting "+id+" has no list item to look for");
 else console.log((d.includes(item)&&times===1?"PASS":"FAIL")+"  Lever row "+id+", first seen after this build, stores its first list item ("+JSON.stringify(item)+": "+(d.includes(item)?"present":"MISSING")+") and its opening "+times+" time(s) (want 1)")}
' || echo "FAIL  99zzzz Lever judge threw"
  fi

  # Personio: a posting empty in the default feed, read through the board's detail action.
  rm -f /tmp/vd_bf_pde.xml /tmp/vd_bf_pen.xml
  sleep 1.2
  curl -s -m 60 "https://lyceum-technology.jobs.personio.de/xml" > /tmp/vd_bf_pde.xml
  sleep 1.2
  curl -s -m 60 "https://lyceum-technology.jobs.personio.de/xml?language=en" > /tmp/vd_bf_pen.xml
  VDBF_PIDS=$(node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const blocks=(x)=>x.match(/<position>[\s\S]*?<\/position>/g)||[];const id=(b)=>(/<id>\s*(\d+)\s*<\/id>/.exec(b)||[])[1];
const EMPTY=/<jobDescriptions>\s*<\/jobDescriptions>|<jobDescriptions\s*\/>/;
const en=new Map(blocks(rd("/tmp/vd_bf_pen.xml")).filter((b)=>!EMPTY.test(b)&&/<jobDescription>/.test(b)).map((b)=>[id(b),b]));
const out=blocks(rd("/tmp/vd_bf_pde.xml")).filter((b)=>EMPTY.test(b)&&en.has(id(b))).map(id).slice(0,3);
console.log(out.join(" "));')
  if [ -z "$VDBF_PIDS" ]; then echo "INFO  lyceum-technology's default Personio feed has no posting that only its English feed describes today, so the language line has nothing to judge"
  else
    VDBF_PDONE=0
    for VDBF_P in $VDBF_PIDS; do
      [ "$VDBF_PDONE" = 1 ] && break
      sleep 1.2
      rm -f /tmp/vd_bf_pdetail.json
      J "{\"action\":\"detail\",\"id\":\"personio:lyceum-technology:$VDBF_P\"}" > /tmp/vd_bf_pdetail.json
      VDBF_V=$(VDBF_P="$VDBF_P" node -e '
const fs=require("fs");let D=null;try{D=JSON.parse(fs.readFileSync("/tmp/vd_bf_pdetail.json","utf8"))}catch{}
const x=fs.readFileSync("/tmp/vd_bf_pen.xml","utf8");const b=(x.match(/<position>[\s\S]*?<\/position>/g)||[]).find((q)=>new RegExp("<id>\\s*"+process.env.VDBF_P+"\\s*</id>").test(q))||"";
const v=(/<value>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/value>/.exec(b)||[])[1]||"";
const flat=(s)=>String(s||"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const w=(flat(v).match(/[A-Za-z0-9]+(?: [A-Za-z0-9]+){3}/)||[""])[0];
if(!D||!D.job)console.log("SKIP");else console.log(w&&flat(D.description).includes(w)?"PASS "+w:"FAIL "+w+" | "+flat(D.description).slice(0,80));')
      case "$VDBF_V" in
        SKIP) ;;
        PASS*) echo "PASS  personio:lyceum-technology:$VDBF_P, empty in the default feed, reads its English description through the board's detail (\"${VDBF_V#PASS }\")"; VDBF_PDONE=1 ;;
        *) echo "FAIL  personio:lyceum-technology:$VDBF_P, empty in the default feed, does not read its English description through the board's detail (want, then got: ${VDBF_V#FAIL })"; VDBF_PDONE=1 ;;
      esac
    done
    [ "$VDBF_PDONE" = 0 ] && echo "INFO  none of lyceum-technology's English-only postings ($VDBF_PIDS) is served on the board today"
  fi

  # Paylocity: a page with no structured data, read through the board's detail action.
  VDBF_YDONE=0
  for VDBF_Y in $(printf '%s' "$VDBF_PAYLOCITY" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{for(const [t,e] of JSON.parse(s))console.log(t+"|"+e)})'); do
    [ "$VDBF_YDONE" = 1 ] && break
    sleep 1.2
    rm -f /tmp/vd_bf_ypage.html /tmp/vd_bf_ydetail.json
    curl -s -m 60 "https://recruiting.paylocity.com/recruiting/jobs/Details/${VDBF_Y#*|}" > /tmp/vd_bf_ypage.html
    grep -q 'class="job-preview-details"' /tmp/vd_bf_ypage.html 2>/dev/null || continue
    grep -q '"JobPosting"' /tmp/vd_bf_ypage.html 2>/dev/null && continue
    J "{\"action\":\"detail\",\"id\":\"paylocity:${VDBF_Y%%|*}:${VDBF_Y#*|}\"}" > /tmp/vd_bf_ydetail.json
    VDBF_V=$(node -e 'const fs=require("fs");let D=null;try{D=JSON.parse(fs.readFileSync("/tmp/vd_bf_ydetail.json","utf8"))}catch{}
if(!D||!D.job)console.log("SKIP");else console.log(String(typeof D.description==="string"?D.description.trim().length:0));')
    [ "$VDBF_V" = "SKIP" ] && continue
    VDBF_YDONE=1
    if [ "$VDBF_V" -ge 200 ] 2>/dev/null; then echo "PASS  paylocity:${VDBF_Y%%|*}:${VDBF_Y#*|}, whose page carries no structured data, reads a $VDBF_V-character description through the board's detail (want 200 or more)"
    else echo "FAIL  paylocity:${VDBF_Y%%|*}:${VDBF_Y#*|}, whose page carries no structured data, reads a ${VDBF_V:-0}-character description through the board's detail (want 200 or more: the page-text fallback is not reading it)"; fi
  done
  [ "$VDBF_YDONE" = 0 ] && echo "INFO  none of the corpus Paylocity postings without structured data is still open and served, so the fallback line has nothing to judge"
fi
