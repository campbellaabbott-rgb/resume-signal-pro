# shellcheck shell=bash
# ── 99zzzzzzz-board-102-normalize. JOB-BOARD .102, LANE 2: the readers in
# normalize.ts (branch board/102-normalize; spec-102 lane 2). Country names the
# place text states, the SmartRecruiters code where we read none, Hong Kong
# ahead of China, a vendor's own code beside a bare state-like code, one
# entity decode on Teamtailor and Personio titles, and a trade that is not a
# work mode. COUNTRY_MAP_VERSION 13 re-derives the rows stored with no country.
#
# Named 99zzzzzzz so it sorts after every 99zzzzzz- file in byte order and
# under a collating locale (verify-deploy.d/README.md).
#
# THE CLOCK. Every line is INFO until job-board's preflight answers
# job-board.2026-09-09.102 or later; before that no board read is made. Times
# run from status.sliceStats.buildSince, and only when sliceStats.build is the
# build the preflight answers. A row is "re-read" when its lastSeen is after
# buildSince: the build that serves it has read it. A board line is INFO until
# its rows include one re-read, or until 48 h after buildSince. Status reports
# no country backfill key, so the backfill is judged by behaviour: a row with
# no country is INFO until 48 h after buildSince, then judged.
#
# WHOSE READING. Some vendors state a country code that wins over the place
# text (lever, workable, breezy, icims, oracle, rippling, paylocity, adp, ukg,
# usajobs; for the seventeen names also smartrecruiters and workday, whose
# stated code or place payload can decide). A row from one of them that
# disagrees with the place is INFO, never FAIL: this lane changes the reading
# of the place, not the vendor's claim.
#
# THE CLAIMS, one line each:
#   P1  ThePlace1 (verifier line 1909 re-read): every row whose location ends
#       in Nigeria reads NG (the vendor states ng on all of them).
#   W1  location Wien, read to the end of the list (line 2154 re-read): no row
#       names a US state and ZIP.
#   W2  WorldStrides' row at "1919 Gallows Road Suite 700 Vienna VA 22182; ..."
#       reads US.
#   N1  the seventeen names, one line each: up to 10 rows whose location ends
#       in ", <name>" read its code (NG GH BD ET UG TZ RW SN CI CM DZ LK NP KZ QA
#       JO LB). Any other code FAILs. A name with no such row is INFO.
#   H1  S14X-249: of up to 50 'Hong Kong' rows re-read since buildSince, none is
#       filed CN.
#   V1  S14X-120: twenty Breezy rows picked live on 2026-11-15, each with a
#       feed code that is not US or CA beside a bare code that is also a US
#       state ("Perth, WA" with AU), carry the feed's code once re-read. No
#       iCIMS row of that shape was live; on these boards main reads the same,
#       so this is a regression guard for the shared reader.
#   E1  S14X-216, the row half: no Teamtailor or Personio row re-read since
#       buildSince carries a literal "&amp;" in its title or department.
#   R1  BR-08: of the 'Remote Sensing' and 'Remote Pilot' postings first posted
#       and read after buildSince, at most 5% are filed remote with no remote
#       place and no mode outside the trade in the title. Rows from vendors
#       with a workplace field are left out (their field decides). INFO until
#       5 such rows exist.
#
# READ-ONLY. One OPTIONS preflight, then job-board status and list reads sent
# with x-rb-budget: probe and noLog. Nothing else is called.
echo "== 99zzzzzzz. job-board .102 lane 2: countries the place names, the stated SmartRecruiters code, Hong Kong ahead of China, a vendor's own code, one entity decode, a trade that is not a mode =="

VDBN_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
VDBN_LIVE=0
if [ -z "$VDBN_H" ]; then echo "FAIL  job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VDBN_H" "2026-09-09" "102"; then echo "PASS  job-board preflight x-fn-build = $VDBN_H (job-board.2026-09-09.102 or later: the build whose readers these lines judge)"; VDBN_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VDBN_H: job-board.2026-09-09.102 is not serving yet, so every lane-2 line waits for it"; fi

# [token, id, the feed's own code, the city the list is narrowed by], read from each board's Breezy feed on 2026-11-15.
VDBN_S120='[["ablefy","breezy:ablefy:b62cf6642cb301-account-executive-m-w-x-outbound","DE","Berlin"],["ablefy","breezy:ablefy:f40a04c66a0201-head-of-marketing-fractional-or-permanent-f-m-x","DE","Berlin"],["respond-io","breezy:respond-io:27beb21d1475-business-development-representative-german-speaker","DE","Berlin"],["aimpoint-digital","breezy:aimpoint-digital:f7f9d7e51231-senior-data-engineer-2026-col","CO","Medell"],["nortedigital","breezy:nortedigital:e57cc1dc289f-performance-manager","CO","Bogot"],["yiyienglish","breezy:yiyienglish:e6f6b3dfe3e3-teach-english-from-home-with-yiyi","CO","Bogot"],["capricorn","breezy:capricorn:eac5f54fab8c01-accounts-officer","AU","Perth"],["capricorn","breezy:capricorn:2ae8cf88f27c01-application-engineer","AU","Perth"],["dyflex","breezy:dyflex:429cb90e7d3d-sap-customer-success-manager-perth","AU","Perth"],["cove","breezy:cove:471950b932a4-account-associate-account-management","ID","Jakarta"],["cove","breezy:cove:f9f04812d422-project-manager-construction-real-estate","ID","Jakarta"],["cove","breezy:cove:63a64bd27fc8-tenant-experience-intern","ID","Jakarta"],["gozem","breezy:gozem:e4a6760eaf52-comptable-experimente","GA","Libreville"],["nexo","breezy:nexo:b04e376692fb01-head-of-marketing-argentina","AR","Buenos Aires"],["social-discovery-ventures","breezy:social-discovery-ventures:8216245e105101-junior-partner-account-manager-spanish-english-russian","AR","Buenos Aires"],["nucleusteq","breezy:nucleusteq:687f31c86ba8-accounts-executive","IN","Indore"],["nucleusteq","breezy:nucleusteq:2214541087a9-data-engineer-gcp","IN","Indore"],["sa-global","breezy:sa-global:0de29dfa8bfc01-hr-business-partner-ma-and-fr-and-global-people-data-systems-lead","MA","Casablanca"],["sa-global","breezy:sa-global:928af4c7f37601-hr-operations-specialist-emea","MA","Casablanca"],["yiyienglish","breezy:yiyienglish:2b42cc596e52-teach-english-from-home-with-yiyi","PA","Panama City"]]'
# [the term the list is narrowed by, the code, the names a location may end in].
VDBN_NAMES='[["Nigeria","NG",["Nigeria"]],["Ghana","GH",["Ghana"]],["Bangladesh","BD",["Bangladesh"]],["Ethiopia","ET",["Ethiopia"]],["Uganda","UG",["Uganda"]],["Tanzania","TZ",["Tanzania","United Republic of Tanzania"]],["Rwanda","RW",["Rwanda"]],["Senegal","SN",["Senegal"]],["Ivoire","CI",["Côte d’Ivoire","Côte d'"'"'Ivoire","Cote d'"'"'Ivoire","Cote d’Ivoire","Ivory Coast"]],["Cameroon","CM",["Cameroon"]],["Algeria","DZ",["Algeria"]],["Sri Lanka","LK",["Sri Lanka"]],["Nepal","NP",["Nepal"]],["Kazakhstan","KZ",["Kazakhstan"]],["Qatar","QA",["Qatar"]],["Jordan","JO",["Jordan"]],["Lebanon","LB",["Lebanon"]]]'

if [ "$VDBN_LIVE" = 1 ]; then
  rm -f /tmp/vd_bn_*.json
  VDBN_A='"groupSimilar":false,"includeFacets":false,"noLog":true'
  J '{"action":"status"}' > /tmp/vd_bn_status.json
  J "{\"action\":\"list\",\"companies\":[\"ThePlace1\"],\"vendor\":[\"smartrecruiters\"],\"limit\":60,$VDBN_A}" > /tmp/vd_bn_place.json
  J "{\"action\":\"list\",\"companies\":[\"world4822stri986des\"],\"vendor\":[\"greenhouse\"],\"limit\":60,$VDBN_A}" > /tmp/vd_bn_worldstrides.json
  # Every row under Wien, to the end of the list (at most 20 pages).
  VDBN_OFF=0; VDBN_N=0
  while [ "$VDBN_N" -lt 20 ]; do
    VDBN_F="/tmp/vd_bn_wien_$VDBN_N.json"
    J "{\"action\":\"list\",\"q\":\"\",\"location\":\"Wien\",\"limit\":60,\"offset\":$VDBN_OFF,$VDBN_A}" > "$VDBN_F"
    VDBN_NEXT=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const o=Number(process.argv[2]);process.stdout.write(j&&Array.isArray(j.jobs)&&j.jobs.length&&j.hasMore===true?String(Number.isInteger(j.nextOffset)&&j.nextOffset>o?j.nextOffset:o+j.jobs.length):"")}catch{}' "$VDBN_F" "$VDBN_OFF")
    VDBN_N=$((VDBN_N + 1))
    [ -n "$VDBN_NEXT" ] || break
    VDBN_OFF=$VDBN_NEXT
  done
  VDBN_I=0
  for VDBN_T in $(printf '%s' "$VDBN_NAMES" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{for(const [t] of JSON.parse(s))console.log(encodeURIComponent(t))})'); do
    J "{\"action\":\"list\",\"q\":\"\",\"location\":\"$(node -e 'process.stdout.write(decodeURIComponent(process.argv[1]))' "$VDBN_T")\",\"limit\":60,$VDBN_A}" > "/tmp/vd_bn_name_$VDBN_I.json"
    VDBN_I=$((VDBN_I + 1))
  done
  for VDBN_P in 0 60; do J "{\"action\":\"list\",\"q\":\"\",\"location\":\"Hong Kong\",\"limit\":60,\"offset\":$VDBN_P,$VDBN_A}" > "/tmp/vd_bn_hk_$VDBN_P.json"; done
  VDBN_I=0
  for VDBN_TC in $(printf '%s' "$VDBN_S120" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const seen=new Set();for(const [t,,,c] of JSON.parse(s)){const k=t+"|"+c;if(!seen.has(k)){seen.add(k);console.log(encodeURIComponent(k))}}})'); do
    VDBN_TC=$(node -e 'process.stdout.write(decodeURIComponent(process.argv[1]))' "$VDBN_TC")
    J "{\"action\":\"list\",\"companies\":[\"${VDBN_TC%%|*}\"],\"vendor\":[\"breezy\"],\"location\":\"${VDBN_TC#*|}\",\"limit\":60,$VDBN_A}" > "/tmp/vd_bn_s120_$VDBN_I.json"
    VDBN_I=$((VDBN_I + 1))
  done
  for VDBN_V in teamtailor personio; do
    for VDBN_P in 0 60 120; do J "{\"action\":\"list\",\"vendor\":[\"$VDBN_V\"],\"limit\":60,\"offset\":$VDBN_P,$VDBN_A}" > "/tmp/vd_bn_ent_${VDBN_V}_$VDBN_P.json"; done
    J "{\"action\":\"list\",\"q\":\"amp\",\"vendor\":[\"$VDBN_V\"],\"limit\":60,$VDBN_A}" > "/tmp/vd_bn_ent_${VDBN_V}_amp.json"
  done
  for VDBN_P in 0 60; do
    J "{\"action\":\"list\",\"q\":\"\\\"remote sensing\\\"\",\"limit\":60,\"offset\":$VDBN_P,$VDBN_A}" > "/tmp/vd_bn_trade_sensing_$VDBN_P.json"
    J "{\"action\":\"list\",\"q\":\"\\\"remote pilot\\\"\",\"limit\":60,\"offset\":$VDBN_P,$VDBN_A}" > "/tmp/vd_bn_trade_pilot_$VDBN_P.json"
  done
  VDBN_H="$VDBN_H" VDBN_S120="$VDBN_S120" VDBN_NAMES="$VDBN_NAMES" node -e '
const fs=require("fs");const E=process.env;
const read=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync(f,"utf8").slice(0,160).replace(/\s+/g," ")}catch{return "(no answer)"}};
const rows=(x)=>x&&Array.isArray(x.jobs)?x.jobs.filter((r)=>r&&typeof r==="object"):null;
const say=(v,s)=>console.log(v+"  "+s);
const S=read("/tmp/vd_bn_status.json");
const ss=S&&S.sliceStats&&typeof S.sliceStats==="object"?S.sliceStats:null;
const serving=String(E.VDBN_H||"").replace(/^job-board\./,"");const ours=!!ss&&ss.build===serving;
const since=ours?Date.parse(ss.buildSince||""):NaN;const ageH=Number.isFinite(since)?(Date.now()-since)/3600000:null;
const clock=!ss?"status carries no sliceStats":!ours?"sliceStats.build is "+ss.build+", not the serving "+serving+": no slice of this build has run yet":ageH===null?"status states no sliceStats.buildSince":"the first slice of this build was "+ageH.toFixed(1)+" h ago";
const late=ageH!==null&&ageH>=48;
const fresh=(r)=>Number.isFinite(since)&&Date.parse(r.lastSeen||"")>since;
const freshNew=(r)=>fresh(r)&&Date.parse(r.postedAt||"")>since;
const CODED=new Set(["lever","workable","breezy","icims","oracle","rippling","paylocity","adp","ukg","usajobs"]);
const CODED17=new Set([...CODED,"smartrecruiters","workday"]);
const MODED=new Set(["lever","ashby","smartrecruiters","bamboohr","recruitee","rippling","oracle","workable"]);
const ids=(a)=>JSON.stringify(a.slice(0,3).map((r)=>[r.id,r.location,r.country??null]));
if(ageH===null)say("INFO",clock+": every line below is INFO until a slice of this build has run");
// The one rule for a reading this build owes: right; wrong and re-read (FAIL); no country, 48 h on (FAIL); else waiting.
function judge(label,J,want,failable){
  if(!J){say("FAIL",label+": the list is unreadable");return}
  const right=J.filter(want),wrong=J.filter((r)=>!want(r));
  const fails=wrong.filter((r)=>failable(r)&&(fresh(r)||(r.country==null&&late)));
  const vend=wrong.filter((r)=>!failable(r));
  const waiting=wrong.filter((r)=>failable(r)&&!fails.includes(r));
  const n=J.length,re=J.filter(fresh).length;
  const tail=" ("+re+" re-read since buildSince; "+clock+")"+(vend.length?"; "+vend.length+" from a vendor that states another code, left to it: "+ids(vend):"");
  if(fails.length)say("FAIL",label+": "+fails.length+" of "+n+" read otherwise after this build read them, or still have no country 48 h on: "+ids(fails)+tail);
  else if(!n)say("INFO",label+": no such row is served"+tail);
  else if(ageH===null)say("INFO",label+": "+right.length+" of "+n+" read right, judged once this build has run"+tail);
  else if(waiting.length)say("INFO",label+": "+right.length+" of "+n+" read right; "+waiting.length+" wait for this build to read them"+(waiting.some((r)=>r.country==null)?" or for the backfill (FAIL from 48 h)":"")+": "+ids(waiting)+tail);
  else if(!re&&!late)say("INFO",label+": "+right.length+" of "+n+" read right, but none was read by this build yet (the backfill has until 48 h)"+tail);
  else say("PASS",label+": "+right.length+" of "+n+" read right"+(re?"":", 48 h after the first slice")+tail);
}
// P1
{const J=rows(read("/tmp/vd_bn_place.json"));
 if(!J)say("FAIL","ThePlace1 list is unreadable: "+peek("/tmp/vd_bn_place.json"));
 else judge("ThePlace1 rows whose location ends in Nigeria read NG",J.filter((r)=>/Nigeria\s*$/i.test(String(r.location||""))),(r)=>r.country==="NG",()=>true)}
// W1
{const US_ZIP=/(?:^|[\s,])(?:A[KLRZ]|C[AOT]|DC|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])[\s,]+\d{5}(?:-\d{4})?\b/;
 const pages=[];for(let n=0;n<20;n++){if(!fs.existsSync("/tmp/vd_bn_wien_"+n+".json"))break;pages.push(read("/tmp/vd_bn_wien_"+n+".json"))}
 const bad=pages.findIndex((j)=>!rows(j));
 if(!pages.length||bad>=0)say("FAIL","location Wien, page "+Math.max(bad,0)+" of the walk is unreadable: "+peek("/tmp/vd_bn_wien_"+Math.max(bad,0)+".json"));
 else{const all=pages.flatMap(rows),hit=all.filter((r)=>US_ZIP.test(String(r.location||""))&&!/austria|österreich/i.test(String(r.location||"")));
  const last=pages[pages.length-1],ended=last.hasMore!==true;
  const now=ageH===null?[]:hit.filter((r)=>r.country==="US"||fresh(r)||late);
  if(now.length)say("FAIL","location Wien serves "+now.length+" of "+all.length+" rows whose location names a US state and ZIP, read by this build or 48 h on: "+ids(now)+" ("+clock+")");
  else if(hit.length)say("INFO","location Wien serves "+hit.length+" of "+all.length+" rows naming a US state and ZIP, not yet read by this build: "+ids(hit)+"; the backfill files them US and the alias refusal stops them (FAIL from 48 h; "+clock+")");
  else if(!all.length)say("INFO","location Wien served no row, so nothing was read for a US state and ZIP");
  else if(!ended)say("INFO","location Wien: none of the "+all.length+" rows read names a US state and ZIP, but the walk stopped before the end of the list");
  else if(!all.some(fresh)&&!late)say("INFO","location Wien: none of its "+all.length+" rows names a US state and ZIP, but none was read by this build yet ("+clock+")");
  else say("PASS","location Wien: none of its "+all.length+" rows names a US state and ZIP ("+all.filter(fresh).length+" read by this build)")}}
// W2
{const J=rows(read("/tmp/vd_bn_worldstrides.json"));
 if(!J)say("FAIL","the WorldStrides list is unreadable: "+peek("/tmp/vd_bn_worldstrides.json"));
 else judge("WorldStrides rows at a Virginia street address read US",J.filter((r)=>/Gallows Road|West Water Street/i.test(String(r.location||""))),(r)=>r.country==="US",()=>true)}
// N1
JSON.parse(E.VDBN_NAMES).forEach(([term,code,names],i)=>{
  const J=rows(read("/tmp/vd_bn_name_"+i+".json"));
  if(!J){say("FAIL","the list under location "+term+" is unreadable: "+peek("/tmp/vd_bn_name_"+i+".json"));return}
  const ends=new RegExp(",\\s*(?:"+names.map((n)=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")\\s*\\.?\\s*$","i");
  const one=(r)=>{const l=String(r.location||"");if(!ends.test(l)||/;|·|\||\+|\bor\b|\band\b|\//i.test(l))return false;
    const segs=l.split(",").map((s)=>s.trim());
    if((code==="JO"||code==="LB")&&segs.some((s)=>/^[A-Z]{2}$/.test(s)||/\b\d{5}\b/.test(s)))return false;
    return true};
  const pick=J.filter(one).sort((a,b)=>(fresh(b)?1:0)-(fresh(a)?1:0)).slice(0,10);
  judge("places ending in "+names[0]+" read "+code,pick,(r)=>r.country===code,(r)=>!CODED17.has(String(r.source)));
});
// H1
{const P=[0,60].map((o)=>read("/tmp/vd_bn_hk_"+o+".json"));
 if(!rows(P[0]))say("FAIL","the list under location Hong Kong is unreadable: "+peek("/tmp/vd_bn_hk_0.json"));
 else{const all=P.flatMap((j)=>rows(j)||[]).filter((r)=>/hong\s*kong/i.test(String(r.location||""))&&!/;|·|\||\bor\b|\band\b|\/|\+|shanghai|beijing|shenzhen|guangzhou|mainland/i.test(String(r.location||"")));
  const re=all.filter(fresh).slice(0,50),cn=re.filter((r)=>r.country==="CN");
  const ours_=cn.filter((r)=>!CODED.has(String(r.source))),vend=cn.filter((r)=>CODED.has(String(r.source)));
  const tail=vend.length?"; "+vend.length+" filed CN by a vendor that states it, left to it: "+ids(vend):"";
  if(ours_.length)say("FAIL","S14X-249: "+ours_.length+" of "+re.length+" Hong Kong rows read by this build are filed CN: "+ids(ours_)+tail);
  else if(!re.length)say("INFO","S14X-249: none of "+all.length+" Hong Kong rows was read by this build yet ("+clock+")");
  else say("PASS","S14X-249: none of "+re.length+" Hong Kong rows read by this build is filed CN by its place"+tail)}}
// V1
{const PICK=JSON.parse(E.VDBN_S120);const byKey=new Map();let k=0;const seen=new Set();
 for(const [t,,,c] of PICK){const key=t+"|"+c;if(seen.has(key))continue;seen.add(key);byKey.set(key,read("/tmp/vd_bn_s120_"+(k++)+".json"))}
 const unread=[...byKey].filter(([,j])=>!rows(j)).map(([key])=>key);
 if(unread.length)say("FAIL","S14X-120: the list for "+unread.join(", ")+" is unreadable");
 else{const got=PICK.map(([t,id,code,c])=>({id,code,r:rows(byKey.get(t+"|"+c)).find((x)=>x.id===id)}));
  const served=got.filter((g)=>g.r),re=served.filter((g)=>fresh(g.r)),bad=re.filter((g)=>g.r.country!==g.code);
  const wait=served.filter((g)=>!fresh(g.r)&&g.r.country!==g.code);
  if(bad.length)say("FAIL","S14X-120: "+bad.length+" of "+re.length+" rows read by this build do not carry the feed code beside a bare state-like code: "+JSON.stringify(bad.slice(0,3).map((g)=>[g.id,g.r.location,g.code,g.r.country??null])));
  else if(!re.length)say("INFO","S14X-120: "+served.length+" of the 20 picked rows are served, none read by this build yet ("+clock+")"+(wait.length?"; "+wait.length+" read otherwise today":""));
  else say("PASS","S14X-120: "+re.length+" of the 20 picked rows, read by this build, carry the feed code beside a bare state-like code ("+served.length+" served"+(wait.length?"; "+wait.length+" not yet re-read read otherwise":"")+")")}}
// E1
{const files=[];for(const v of ["teamtailor","personio"])for(const p of ["0","60","120","amp"])files.push("/tmp/vd_bn_ent_"+v+"_"+p+".json");
 const first=["/tmp/vd_bn_ent_teamtailor_0.json","/tmp/vd_bn_ent_personio_0.json"].filter((f)=>!rows(read(f)));
 if(first.length)say("FAIL","S14X-216: "+first.map((f)=>f+": "+peek(f)).join(" / ")+" is unreadable");
 else{const m=new Map();for(const f of files)for(const r of rows(read(f))||[])if(/^(teamtailor|personio):/.test(String(r.id))&&!m.has(r.id))m.set(r.id,r);
  const all=[...m.values()],re=all.filter(fresh),txt=(r)=>String(r.title||"")+" ‖ "+String(r.department||"");
  const bad=re.filter((r)=>/&amp;/i.test(txt(r))),amp=re.filter((r)=>/&(?!amp;)/.test(txt(r))),old=all.filter((r)=>!fresh(r)&&/&amp;/i.test(txt(r)));
  if(bad.length)say("FAIL","S14X-216: "+bad.length+" of "+re.length+" Teamtailor and Personio rows read by this build carry a literal &amp; in the title or department: "+JSON.stringify(bad.slice(0,3).map((r)=>[r.id,r.title,r.department??null])));
  else if(!re.length)say("INFO","S14X-216: none of "+all.length+" Teamtailor and Personio rows was read by this build yet ("+clock+")"+(old.length?"; "+old.length+" read before it carry &amp;":""));
  else if(!amp.length)say("INFO","S14X-216: none of the "+re.length+" rows read by this build carries an ampersand, so the decode has nothing to show"+(old.length?" ("+old.length+" read before it carry &amp;)":""));
  else say("PASS","S14X-216: none of "+re.length+" Teamtailor and Personio rows read by this build carries &amp;; "+amp.length+" carry a decoded & (e.g. "+JSON.stringify(amp[0].title)+")"+(old.length?"; "+old.length+" read before it still do":""))}}
// R1
{const files=["sensing_0","sensing_60","pilot_0","pilot_60"].map((x)=>"/tmp/vd_bn_trade_"+x+".json");
 const un=["/tmp/vd_bn_trade_sensing_0.json","/tmp/vd_bn_trade_pilot_0.json"].filter((f)=>!rows(read(f)));
 if(un.length)say("FAIL","BR-08: "+un.map((f)=>f+": "+peek(f)).join(" / ")+" is unreadable");
 else{const m=new Map();for(const f of files)for(const r of rows(read(f))||[])if(!m.has(r.id))m.set(r.id,r);
  const TRADE=/\bremote[\s-]+(?:sens\w*|pilot\w*)/gi;
  const trade=[...m.values()].filter((r)=>/\bremote[\s-]+(?:sens|pilot)/i.test(String(r.title||"")));
  const judged=trade.filter((r)=>freshNew(r)&&!MODED.has(String(r.source)));
  const bad=judged.filter((r)=>r.workMode==="remote"&&!/remote|anywhere|home|telework|virtual/i.test(String(r.location||""))&&!/remote|home/i.test(String(r.title||"").replace(TRADE," ")));
  const share=judged.length?bad.length/judged.length:0;
  if(judged.length<5)say("INFO","BR-08: "+judged.length+" Remote Sensing or Remote Pilot posting(s) first posted and read after buildSince (want 5 to judge; "+trade.length+" served in all; "+clock+")");
  else if(share>0.05)say("FAIL","BR-08: "+bad.length+" of "+judged.length+" new Remote Sensing or Remote Pilot postings are filed remote with no remote place and no mode beside the trade (want at most 5%): "+JSON.stringify(bad.slice(0,3).map((r)=>[r.id,r.title,r.location])));
  else say("PASS","BR-08: "+bad.length+" of "+judged.length+" new Remote Sensing or Remote Pilot postings are filed remote on the trade alone (at most 5%)")}}
' 2>&1 || echo "FAIL  99zzzzzzz judge threw (see the lines above)"
fi
