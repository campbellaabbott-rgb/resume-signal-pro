# shellcheck shell=bash
# ── 99zzzz. THE SEARCH READS WHAT WAS TYPED (branch fix/bs-search, job-board
# 2026-09-09.100, agent-mcp and public-api 2026-11-02.1, migration
# 20261102100000; docs/job-board-deploy-notes.md, .100).
#
# Named 99zzzz so it sorts after 99zzz- (README: past 99, append a letter).
#
# THE CLAIMS, one line each below:
#   - job-board's preflight answers job-board.2026-09-09.100 or later. An older
#     build is INFO and every board line waits for it: the old code is the
#     defect, so judging its answers would judge nothing;
#   - agent-mcp answers agent-mcp.2026-11-02.1 or later (the connector reads a
#     country word only as a whole word naming the country, S13-041), and
#     public-api answers public-api.2026-11-02.1 or later (the /v1 location
#     filter binds a local city name to its country, S13-006). Older is INFO;
#   - supervisor -"team lead" excludes the phrase "team lead", and no served
#     title holds it across a space, a hyphen or a slash (S12-017);
#   - "nurse not requiring travel" excludes "travel", not "requiring", and no
#     served title says travel (S12-017);
#   - "no remote nurse" excludes "remote": excludedTerms names it and no served
#     title says remote (S13-013);
#   - "remote-first engineer" lifts the remote filter and searches exactly
#     what "remote engineer" searches: the same total, and no "first" excluded
#     (S13-077). A count the board did not state is INFO;
#   - "jobs near me" searches no words and says so: ignoredFilters names q
#     (S13-015);
#   - "nurse 94105" drops the ZIP and names it in droppedTerms (S13-014);
#   - "cvs" and "3m" route to their employer on every ask, six asks across
#     whatever isolates answer (S12-014: a cold isolate routed nothing);
#   - location "Wien" browses no row placed in the US unless the row names
#     Austria (S13-006, the job-board branch builder);
#   - q "engineer" in "Wien" is ranked (ranked true, search_jobs among the
#     phases timed), ranks no US row unless it names Austria, and serves a row
#     named Vienna without Wien whose title does not start with "engineer"
#     (the head-term ring finds those by title), which only the anchored arm
#     of migration 20261102100000 can match (S13-006, search_jobs);
#   - q "nurse", limit 50, walked from offset 0 to the seam (nextOffset 200 or
#     more): every page that has more is full, and no card is served twice
#     (S13-012: the seam page served 7 cards).
#
# READ-ONLY. Three OPTIONS preflights; job-board list reads sent with
# x-rb-budget: probe (about 20, the seam walk at most 6 of them).
echo "== 99zzzz. The search reads what was typed: phrases, negated work modes, ZIPs, filler, short employer names, local city names, and the page at the seam =="

VDBS_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
VDBS_LIVE=0
if [ -z "$VDBS_H" ]; then echo "FAIL  job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VDBS_H" "2026-09-09" "100"; then echo "PASS  job-board preflight x-fn-build = $VDBS_H (job-board.2026-09-09.100 or later: the build that reads what was typed)"; VDBS_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VDBS_H: job-board.2026-09-09.100, the build that reads what was typed, is not serving yet, so the board lines wait for it"; fi

for VDBS_FN in agent-mcp public-api; do
  VDBS_FH=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDBS_FN" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  if [ "$VDBS_FN" = agent-mcp ]; then VDBS_WHAT="the connector reads a country word only as a whole word naming the country"; else VDBS_WHAT="the /v1 location filter binds a local city name to its country"; fi
  if [ -z "$VDBS_FH" ]; then echo "FAIL  $VDBS_FN preflight carries no x-fn-build"
  elif build_ge "$VDBS_FN" "$VDBS_FH" "2026-11-02" "1"; then echo "PASS  $VDBS_FN preflight x-fn-build = $VDBS_FH ($VDBS_FN.2026-11-02.1 or later: $VDBS_WHAT)"
  else echo "INFO  $VDBS_FN preflight x-fn-build = $VDBS_FH: $VDBS_FN.2026-11-02.1 ($VDBS_WHAT) is not serving yet"; fi
done

if [ "$VDBS_LIVE" = 1 ]; then
  rm -f /tmp/vd_bsearch_*.json
  J '{"action":"list","q":"supervisor -\"team lead\"","limit":20,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_phrase.json
  J '{"action":"list","q":"nurse not requiring travel","limit":20,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_verb.json
  J '{"action":"list","q":"no remote nurse","limit":20,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_noremote.json
  J '{"action":"list","q":"remote-first engineer","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_rf.json
  J '{"action":"list","q":"remote engineer","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_rp.json
  J '{"action":"list","q":"jobs near me","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_nearme.json
  J '{"action":"list","q":"nurse 94105","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_zip.json
  for VDBS_I in 1 2 3 4; do J '{"action":"list","q":"cvs","limit":3,"groupSimilar":false,"includeFacets":false}' > "/tmp/vd_bsearch_route_cvs_$VDBS_I.json"; done
  for VDBS_I in 1 2; do J '{"action":"list","q":"3m","limit":3,"groupSimilar":false,"includeFacets":false}' > "/tmp/vd_bsearch_route_3m_$VDBS_I.json"; done
  J '{"action":"list","q":"","location":"Wien","limit":50,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_wien_browse.json
  J '{"action":"list","q":"engineer","location":"Wien","limit":50,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_wien_ranked.json
  VDBS_OFF=0; VDBS_N=0
  while [ "$VDBS_N" -lt 6 ]; do
    J "{\"action\":\"list\",\"q\":\"nurse\",\"limit\":50,\"offset\":$VDBS_OFF,\"groupSimilar\":true,\"includeFacets\":false}" > "/tmp/vd_bsearch_walk_$VDBS_N.json"
    VDBS_NEXT=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j&&j.hasMore===true&&Number.isInteger(j.nextOffset)?String(j.nextOffset):"")}catch{}' "/tmp/vd_bsearch_walk_$VDBS_N.json")
    VDBS_N=$((VDBS_N + 1))
    if [ -z "$VDBS_NEXT" ] || [ "$VDBS_NEXT" -ge 200 ] || [ "$VDBS_NEXT" -le "$VDBS_OFF" ]; then break; fi
    VDBS_OFF=$VDBS_NEXT
  done
  if ! node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync('/tmp/vd_bsearch_rf.json','utf8')),b=JSON.parse(fs.readFileSync('/tmp/vd_bsearch_rp.json','utf8'));process.exit(a.total===b.total?0:1)" 2>/dev/null; then
    J '{"action":"list","q":"remote-first engineer","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_rf2.json
    J '{"action":"list","q":"remote engineer","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_rp2.json
  fi
  node -e '
const fs=require("fs");
const read=(f)=>{try{return JSON.parse(fs.readFileSync("/tmp/vd_bsearch_"+f+".json","utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync("/tmp/vd_bsearch_"+f+".json","utf8").slice(0,160).replace(/\s+/g," ")}catch{return "(no answer)"}};
const ok=(j)=>j&&Array.isArray(j.jobs);
const titles=(j)=>j.jobs.map((x)=>String(x.title||""));
const say=(v,s)=>console.log(v+"  "+s);
const unreadable=(f,what)=>say("FAIL",what+": the list is unreadable: "+peek(f));
// S12-017, the phrase.
{const j=read("phrase");if(!ok(j))unreadable("phrase","supervisor -\"team lead\"");else{
  const ex=JSON.stringify(j.excludedTerms??null);const hit=titles(j).filter((t)=>/(^|[^a-z0-9])team[\s\/-]+leads?([^a-z0-9]|$)/i.test(t));
  if(ex!=="[\"team lead\"]")say("FAIL","supervisor -\"team lead\" excludes "+ex+" (want [\"team lead\"], the phrase whole)");
  else if(hit.length)say("FAIL","supervisor -\"team lead\" names the phrase excluded but serves "+JSON.stringify(hit.slice(0,3)));
  else if(!j.jobs.length)say("INFO","supervisor -\"team lead\" excludes [\"team lead\"] but served no row, so no title was checked");
  else say("PASS","supervisor -\"team lead\" excludes [\"team lead\"] and none of its "+j.jobs.length+" titles holds the phrase");}}
// S12-017, the verb.
{const j=read("verb");if(!ok(j))unreadable("verb","nurse not requiring travel");else{
  const ex=JSON.stringify(j.excludedTerms??null);const hit=titles(j).filter((t)=>/(^|[^a-z0-9])travel([^a-z0-9]|$)/i.test(t));
  if(ex!=="[\"travel\"]")say("FAIL","nurse not requiring travel excludes "+ex+" (want [\"travel\"]: \"requiring\" is the verb, not the excluded word)");
  else if(hit.length)say("FAIL","nurse not requiring travel names travel excluded but serves "+JSON.stringify(hit.slice(0,3)));
  else if(!j.jobs.length)say("INFO","nurse not requiring travel excludes [\"travel\"] but served no row");
  else say("PASS","nurse not requiring travel excludes [\"travel\"] and none of its "+j.jobs.length+" titles says travel");}}
// S13-013.
{const j=read("noremote");if(!ok(j))unreadable("noremote","no remote nurse");else{
  const ex=Array.isArray(j.excludedTerms)?j.excludedTerms:[];const hit=titles(j).filter((t)=>/remote/i.test(t));
  if(!ex.includes("remote"))say("FAIL","no remote nurse: excludedTerms is "+JSON.stringify(j.excludedTerms??null)+", not naming remote (the negated work mode was searched or dropped silently)");
  else if(hit.length)say("FAIL","no remote nurse names remote excluded but serves "+JSON.stringify(hit.slice(0,3)));
  else if(!j.jobs.length)say("INFO","no remote nurse excludes remote but served no row");
  else say("PASS","no remote nurse excludes remote and none of its "+j.jobs.length+" titles says remote");}}
// S13-077.
{const a=read("rf2")??read("rf"),b=read("rp2")??read("rp");
  if(!ok(a)||!ok(b))say("FAIL","remote-first engineer: a list is unreadable: "+peek(ok(a)?"rp":"rf"));
  else{const ifl=JSON.stringify(a.intentFilters??null);const ex=Array.isArray(a.excludedTerms)?a.excludedTerms:[];
    if(!(Array.isArray(a.intentFilters)&&a.intentFilters.includes("remote")))say("FAIL","remote-first engineer lifts "+ifl+" (want the remote filter)");
    else if(ex.some((t)=>/first/i.test(t)))say("FAIL","remote-first engineer excludes "+JSON.stringify(ex)+": the hyphened word was left behind as a NOT");
    else if(typeof a.total!=="number"||typeof b.total!=="number")say("INFO","remote-first engineer lifts the remote filter, but a total is unstated (remote-first "+a.total+", remote "+b.total+"), so the two searches were not compared");
    else if(a.total!==b.total)say("FAIL","remote-first engineer counts "+a.total+" and remote engineer "+b.total+", asked twice: the two did not search the same words");
    else say("PASS","remote-first engineer lifts the remote filter and counts "+a.total+", exactly what remote engineer counts");}}
// S13-015.
{const j=read("nearme");if(!ok(j))unreadable("nearme","jobs near me");else{
  const ig=Array.isArray(j.ignoredFilters)?j.ignoredFilters:[];
  if(!ig.includes("q"))say("FAIL","jobs near me: ignoredFilters is "+JSON.stringify(j.ignoredFilters??null)+", not naming q (words no title holds were searched)");
  else say("PASS","jobs near me searches no words and names q in ignoredFilters");}}
// S13-014.
{const j=read("zip");if(!ok(j))unreadable("zip","nurse 94105");else{
  const d=Array.isArray(j.droppedTerms)?j.droppedTerms:[];
  if(!d.includes("94105"))say("FAIL","nurse 94105: droppedTerms is "+JSON.stringify(j.droppedTerms??null)+", not naming the ZIP");
  else say("PASS","nurse 94105 drops the ZIP and names it in droppedTerms");}}
// S12-014.
{const want={cvs:"CVS Health","3m":"3M"};const asks=[...[1,2,3,4].map((i)=>["cvs",i]),...[1,2].map((i)=>["3m",i])];
  const bad=[];let read_=0;
  for(const [q,i] of asks){const j=read("route_"+q+"_"+i);if(!ok(j)){bad.push(q+"#"+i+" unreadable: "+peek("route_"+q+"_"+i));continue}read_++;
    if(j.searchRoute!=="EMPLOYER"||j.companyMatched!==want[q])bad.push(q+"#"+i+" routed "+j.searchRoute+" ("+(j.searchRouteReason||"no reason")+")");}
  if(bad.length)say("FAIL","a short employer name did not route on every ask: "+JSON.stringify(bad));
  else say("PASS","cvs and 3m route to CVS Health and 3M on all "+read_+" asks");}
// S13-006.
const usUnnamed=(j)=>j.jobs.filter((x)=>x.country==="US"&&!/austria/i.test(String(x.location||"")));
{const j=read("wien_browse");if(!ok(j))unreadable("wien_browse","location Wien (browse)");else{
  const us=usUnnamed(j);
  if(us.length)say("FAIL","location Wien browses "+us.length+" of "+j.jobs.length+" rows placed in the US: "+JSON.stringify(us.slice(0,3).map((x)=>x.location)));
  else if(!j.jobs.length)say("FAIL","location Wien browses no row at all (Vienna, Austria has hundreds)");
  else say("PASS","location Wien browses "+j.jobs.length+" rows, none placed in the US without naming Austria");}}
{const j=read("wien_ranked");if(!ok(j))unreadable("wien_ranked","engineer in Wien (ranked)");else{
  const us=usUnnamed(j);const viennaOnly=j.jobs.filter((x)=>/vienna/i.test(String(x.location||""))&&!/wien/i.test(String(x.location||"")));
  const anchored=viennaOnly.filter((x)=>!/^engineer\b/i.test(String(x.title||"")));
  if(j.ranked!==true)say("FAIL","engineer in Wien was not ranked (ranked "+JSON.stringify(j.ranked)+(j.rankedFellBack?", fell back: "+String(j.rankedFellBack).slice(0,120):"")+"): the anchored arm cannot be judged on this answer");
  else if(!(j.phaseMs&&typeof j.phaseMs.search_jobs==="number"))say("FAIL","engineer in Wien was ranked but search_jobs did not run (phases "+JSON.stringify(Object.keys(j.phaseMs||{}))+"): its rows are not the answer of search_jobs");
  else if(us.length)say("FAIL","engineer in Wien ranks "+us.length+" of "+j.jobs.length+" rows placed in the US: "+JSON.stringify(us.slice(0,3).map((x)=>x.location)));
  else if(!viennaOnly.length)say("FAIL","engineer in Wien serves "+j.jobs.length+" rows and none named Vienna without Wien: search_jobs has no anchored arm (migration 20261102100000 not applied?)");
  else if(!anchored.length)say("FAIL","engineer in Wien serves "+viennaOnly.length+" rows named Vienna without Wien, and none named Vienna without Wien outside the titles the head-term ring finds (every one starts with engineer): no evidence of the anchored arm of search_jobs");
  else say("PASS","engineer in Wien ranks "+j.jobs.length+" rows, none placed in the US without naming Austria, "+anchored.length+" of them named Vienna with a title the head-term ring does not find (the anchored arm of 20261102100000)");}}
// S13-012.
{const pages=[];for(let n=0;n<6;n++){const raw=(()=>{try{return fs.readFileSync("/tmp/vd_bsearch_walk_"+n+".json","utf8")}catch{return null}})();if(raw===null)break;let j=null;try{j=JSON.parse(raw)}catch{}pages.push(j)}
  const bad=pages.findIndex((j)=>!ok(j));
  if(!pages.length||bad>=0)say("FAIL","the seam walk for nurse: page "+(bad<0?0:bad)+" is unreadable: "+peek("walk_"+(bad<0?0:bad)));
  else{let off=0;const seen=new Set();const dup=[];const short=[];const offs=[];
    for(const j of pages){offs.push(off+":"+j.jobs.length);for(const x of j.jobs){const id=String(x.id);if(seen.has(id))dup.push(id);seen.add(id)}
      if(j.hasMore===true&&j.jobs.length<50)short.push("offset "+off+" served "+j.jobs.length+" cards"+(j.phaseMs&&"seam_topup" in j.phaseMs?" (seam top-up ran)":""));
      off=j.nextOffset;}
    const last=pages[pages.length-1];const crossed=!(last.hasMore===true)||(Number.isInteger(last.nextOffset)&&last.nextOffset>=200);
    if(short.length)say("FAIL","the seam walk for nurse (limit 50) served short pages that had more: "+JSON.stringify(short)+" over "+JSON.stringify(offs));
    else if(dup.length)say("FAIL","the seam walk for nurse served a card twice: "+JSON.stringify(dup.slice(0,3)));
    else if(!crossed)say("INFO","the seam walk for nurse stopped after "+pages.length+" full pages without reaching the seam: "+JSON.stringify(offs));
    else say("PASS","the seam walk for nurse (limit 50) served "+pages.length+" full pages to nextOffset "+last.nextOffset+", none short and no card twice: "+JSON.stringify(offs));}}
' || echo "FAIL  section 99zzzz judge threw"
fi
