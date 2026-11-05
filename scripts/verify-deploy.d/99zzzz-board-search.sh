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
#   - "cdl not required driver" keeps main's one-word reading: it excludes
#     "required" only, never "driver" (a participle follows its noun);
#   - "no remote nurse" excludes "remote": excludedTerms names it and no served
#     title says remote unless the title itself says it is not remote
#     ("Not Remote", "Non-Remote": what the exclusion asks for) (S13-013);
#   - "remote-first engineer" lifts the remote filter and searches exactly
#     what "remote engineer" searches: the same total, and no "first" excluded
#     (S13-077). A count the board did not state is INFO;
#   - "medical coder-remote" lifts the remote filter and searches exactly what
#     "medical coder remote" searches (the word before the hyphen stays);
#   - "jobs near me" searches no words and says so: ignoredFilters names q
#     (S13-015); "career", filler that asks for no place near the searcher,
#     keeps main's title search: q is not named and rows are served;
#   - "nurse 94105" drops the ZIP and names it in droppedTerms (S13-014);
#     "quality engineer iso 13485" keeps 13485, a number stored titles hold;
#   - "cvs" and "3m" route to their employer on every ask, six asks across
#     whatever isolates answer (S12-014: a cold isolate routed nothing);
#   - location "Wien" browses no row filed in the US unless the row names
#     Austria (S13-006, the job-board branch builder);
#   - no row under location "Wien", read to the end of the list, has a location
#     that names a US state and ZIP, unless the row names Austria too. The alias
#     refusal stops only rows filed in the US, so a Vienna, Virginia row with no
#     country on file passes it. It FAILs today on two WorldStrides rows, and the
#     next job-board round owes the fix. An unreadable page is a FAIL. No rows, a
#     walk cut short, or a walk that read fewer rows than the last page's total
#     are INFO;
#   - q "engineer" in "Wien" is ranked (ranked true, search_jobs among the
#     phases timed), ranks no row filed in the US unless it names Austria, and serves a row
#     named Vienna without Wien whose title does not start with "engineer"
#     (the head-term ring finds those by title), which only the anchored arm
#     of migration 20261102100000 can match (S13-006, search_jobs);
#   - four queries walked from offset 0 to their seam (nurse at limit 50; crew
#     member, caregiver and customer service at the site's 60): a page short at
#     the seam makes its one extra read (phaseMs.seam_topup), asked once more
#     because a read that timed out serves the short page by design; nextOffset
#     resumes past the rows it used; no card is served twice (S13-012: the seam
#     page served 7 cards). THE PROMISE IS THE CONTINUATION, NOT A FULL PAGE: the
#     code ships one read, and n1417 says rows that fold into few clusters stay
#     short (6 of 34 seam pages on 2026-11-04). So every page short after its read
#     is named; one under half a page is a FAIL, the reported symptom still open
#     (the next job-board round owes it more reads). The ring's seam page answers
#     the ring's end plus the deep rows its read used, so a short page answering
#     exactly the ring's end made no read, or a read that added nothing: a FAIL at
#     any offset below the ring's end. A page past its seam that folds short with
#     no read is the limit the deploy notes disclose, and INFO. The PASS needs at
#     least one page that made the read: with none the continuation was not
#     exercised, and the line is INFO.
#
# READ-ONLY. Three OPTIONS preflights; job-board list reads sent with
# x-rb-budget: probe (about 60: the seam walks read at most 6 pages each, and a
# short page twice; the walk of every row under Wien reads at most 20 pages).
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
  J '{"action":"list","q":"cdl not required driver","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_participle.json
  J '{"action":"list","q":"no remote nurse","limit":20,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_noremote.json
  J '{"action":"list","q":"remote-first engineer","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_rf.json
  J '{"action":"list","q":"remote engineer","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_rp.json
  J '{"action":"list","q":"medical coder-remote","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_hh.json
  J '{"action":"list","q":"medical coder remote","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_hp.json
  J '{"action":"list","q":"jobs near me","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_nearme.json
  J '{"action":"list","q":"career","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_career.json
  J '{"action":"list","q":"nurse 94105","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_zip.json
  J '{"action":"list","q":"quality engineer iso 13485","limit":5,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_iso.json
  for VDBS_I in 1 2 3 4; do J '{"action":"list","q":"cvs","limit":3,"groupSimilar":false,"includeFacets":false}' > "/tmp/vd_bsearch_route_cvs_$VDBS_I.json"; done
  for VDBS_I in 1 2; do J '{"action":"list","q":"3m","limit":3,"groupSimilar":false,"includeFacets":false}' > "/tmp/vd_bsearch_route_3m_$VDBS_I.json"; done
  J '{"action":"list","q":"","location":"Wien","limit":50,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_wien_browse.json
  J '{"action":"list","q":"engineer","location":"Wien","limit":50,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_bsearch_wien_ranked.json
  # Every row under Wien, to the end of the list: the first page need not hold the row the refusal cannot stop.
  VDBS_OFF=0; VDBS_N=0
  while [ "$VDBS_N" -lt 20 ]; do
    VDBS_F="/tmp/vd_bsearch_wienall_$VDBS_N.json"
    J "{\"action\":\"list\",\"q\":\"\",\"location\":\"Wien\",\"limit\":60,\"offset\":$VDBS_OFF,\"groupSimilar\":false,\"includeFacets\":false}" > "$VDBS_F"
    VDBS_NEXT=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const o=Number(process.argv[2]);process.stdout.write(j&&Array.isArray(j.jobs)&&j.jobs.length&&j.hasMore===true?String(Number.isInteger(j.nextOffset)&&j.nextOffset>o?j.nextOffset:o+j.jobs.length):"")}catch{}' "$VDBS_F" "$VDBS_OFF")
    VDBS_N=$((VDBS_N + 1))
    [ -n "$VDBS_NEXT" ] || break
    VDBS_OFF=$VDBS_NEXT
  done
  # Each walk stops at the page that carries the top-up, at a short page, at the
  # ring's end or when there is no more: the ring's seam sits past nextOffset 200
  # (crew member read 171 to 286 before it reached its own). The ring's end is
  # paging.ts RING_WINDOW; a test holds this number to it.
  VDBS_RING=400
  while IFS='|' read -r VDBS_W VDBS_Q VDBS_L; do
    VDBS_OFF=0; VDBS_N=0
    while [ "$VDBS_N" -lt 6 ]; do
      VDBS_F="/tmp/vd_bsearch_walk_${VDBS_W}_$VDBS_N.json"
      VDBS_ASK="{\"action\":\"list\",\"q\":\"$VDBS_Q\",\"limit\":$VDBS_L,\"offset\":$VDBS_OFF,\"groupSimilar\":true,\"includeFacets\":false}"
      J "$VDBS_ASK" > "$VDBS_F"
      if node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j&&j.hasMore===true&&Array.isArray(j.jobs)&&j.jobs.length<Number(process.argv[2])&&!(j.phaseMs&&"seam_topup" in j.phaseMs)?0:1)}catch{process.exit(1)}' "$VDBS_F" "$VDBS_L"; then J "$VDBS_ASK" > "$VDBS_F"; fi
      VDBS_NEXT=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const topup=!!(j&&j.phaseMs&&"seam_topup" in j.phaseMs);const short=j&&Array.isArray(j.jobs)&&j.jobs.length<Number(process.argv[2]);process.stdout.write(j&&j.hasMore===true&&Number.isInteger(j.nextOffset)&&!topup&&!short&&j.nextOffset<Number(process.argv[3])?String(j.nextOffset):"")}catch{}' "$VDBS_F" "$VDBS_L" "$VDBS_RING")
      VDBS_N=$((VDBS_N + 1))
      if [ -z "$VDBS_NEXT" ] || [ "$VDBS_NEXT" -le "$VDBS_OFF" ]; then break; fi
      VDBS_OFF=$VDBS_NEXT
    done
  done <<'VDBS_WALKS'
0|nurse|50
1|crew member|60
2|caregiver|60
3|customer service|60
VDBS_WALKS
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
// S12-017, a participle.
{const j=read("participle");if(!ok(j))unreadable("participle","cdl not required driver");else{
  const ex=JSON.stringify(j.excludedTerms??null);
  if(ex!=="[\"required\"]")say("FAIL","cdl not required driver excludes "+ex+" (want [\"required\"], main\u2019s reading: the word after a participle is not its object)");
  else say("PASS","cdl not required driver excludes [\"required\"] only, as main reads it, and still searches driver");}}
// S13-013.
{const j=read("noremote");if(!ok(j))unreadable("noremote","no remote nurse");else{
  const ex=Array.isArray(j.excludedTerms)?j.excludedTerms:[];const hit=titles(j).filter((t)=>/remote/i.test(t.replace(/\b(?:non|not|no)[-\s]?remote\b|\bnot\s+(?:a\s+|an\s+|fully\s+)?remote\b|\bremote\s*[:=(\u2013\u2014-]\s*(?:no|none)\b/gi," ")));
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
{const a=read("hh"),b=read("hp");
  if(!ok(a)||!ok(b))say("FAIL","medical coder-remote: a list is unreadable: "+peek(ok(a)?"hp":"hh"));
  else if(!(Array.isArray(a.intentFilters)&&a.intentFilters.includes("remote")))say("FAIL","medical coder-remote lifts "+JSON.stringify(a.intentFilters??null)+" (want the remote filter)");
  else if(typeof a.total!=="number"||typeof b.total!=="number")say("INFO","medical coder-remote lifts the remote filter, but a total is unstated ("+a.total+" / "+b.total+"), so the two searches were not compared");
  else if(a.total!==b.total)say("FAIL","medical coder-remote counts "+a.total+" and medical coder remote "+b.total+": the word before the hyphen was dropped or changed");
  else say("PASS","medical coder-remote lifts the remote filter and counts "+a.total+", exactly what medical coder remote counts");}
// S13-015.
{const j=read("nearme");if(!ok(j))unreadable("nearme","jobs near me");else{
  const ig=Array.isArray(j.ignoredFilters)?j.ignoredFilters:[];
  if(!ig.includes("q"))say("FAIL","jobs near me: ignoredFilters is "+JSON.stringify(j.ignoredFilters??null)+", not naming q (words no title holds were searched)");
  else say("PASS","jobs near me searches no words and names q in ignoredFilters");}}
{const j=read("career");if(!ok(j))unreadable("career","career");else{
  const ig=Array.isArray(j.ignoredFilters)?j.ignoredFilters:[];
  if(ig.includes("q"))say("FAIL","career: ignoredFilters names q, so a title word (Career Advisor, Career Coach) was cleared to the whole board");
  else if(!j.jobs.length)say("FAIL","career keeps q but served no row (main served 7,616 title matches)");
  else say("PASS","career keeps main\u2019s title search: q is not named, "+j.jobs.length+" rows served (e.g. "+JSON.stringify(titles(j)[0])+")");}}
// S13-014.
{const j=read("zip");if(!ok(j))unreadable("zip","nurse 94105");else{
  const d=Array.isArray(j.droppedTerms)?j.droppedTerms:[];
  if(!d.includes("94105"))say("FAIL","nurse 94105: droppedTerms is "+JSON.stringify(j.droppedTerms??null)+", not naming the ZIP");
  else say("PASS","nurse 94105 drops the ZIP and names it in droppedTerms");}}
{const j=read("iso");if(!ok(j))unreadable("iso","quality engineer iso 13485");else{
  const d=Array.isArray(j.droppedTerms)?j.droppedTerms:[];
  if(d.includes("13485"))say("FAIL","quality engineer iso 13485 drops 13485 as a ZIP (droppedTerms "+JSON.stringify(d)+"), though stored titles hold it");
  else say("PASS","quality engineer iso 13485 keeps 13485 searched (droppedTerms "+JSON.stringify(j.droppedTerms??null)+")");}}
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
  if(us.length)say("FAIL","location Wien browses "+us.length+" of "+j.jobs.length+" rows filed in the US: "+JSON.stringify(us.slice(0,3).map((x)=>x.location)));
  else if(!j.jobs.length)say("FAIL","location Wien browses no row at all (Vienna, Austria has hundreds)");
  else say("PASS","location Wien browses "+j.jobs.length+" rows, none filed in the US without naming Austria");}}
// The refusal reads the row\u2019s country, so this reads what the row says. DE is left out of the codes: a German row can read DE 10115.
{const US_ZIP=/(?:^|[\s,])(?:A[KLRZ]|C[AOT]|DC|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY]|Virginia|Illinois|Georgia|Maryland|Missouri|Ohio|New Jersey|Maine|South Dakota)[\s,]+\d{5}(?:-\d{4})?\b/;
  const pages=[];for(let n=0;n<20;n++){const raw=(()=>{try{return fs.readFileSync("/tmp/vd_bsearch_wienall_"+n+".json","utf8")}catch{return null}})();if(raw===null)break;let j=null;try{j=JSON.parse(raw)}catch{}pages.push(j)}
  const bad=pages.findIndex((j)=>!ok(j));
  if(!pages.length||bad>=0)unreadable("wienall_"+Math.max(bad,0),"location Wien, page "+Math.max(bad,0)+" of the walk to its end");
  else{const rows=pages.flatMap((j)=>j.jobs),hit=rows.filter((x)=>US_ZIP.test(String(x.location||""))&&!/austria/i.test(String(x.location||""))),last=pages[pages.length-1],stated=typeof last.total==="number";
    const why=hit.some((x)=>x.country==null)?": the alias refusal stops only rows filed in the US, so a row with no country on file passes it":hit.some((x)=>x.country==="US")?": a row filed in the US, which the alias refusal should stop":"";
    if(hit.length)say("FAIL","location Wien serves "+hit.length+" of "+rows.length+" rows whose location names a US state and ZIP: "+JSON.stringify(hit.slice(0,3).map((x)=>x.location))+" ("+[...new Set(hit.map((x)=>String(x.company)))].slice(0,3).join(", ")+"; country "+JSON.stringify([...new Set(hit.map((x)=>x.country??null))])+")"+why+". The next job-board round owes the fix");
    else if(!rows.length)say("INFO","location Wien served no row, so no location was read for a US state and ZIP");
    else if(last.hasMore===true)say("INFO","location Wien: none of the "+rows.length+" rows read names a US state and ZIP, but the walk stopped before the end of the list");
    else if(stated?rows.length<last.total:last.hasMore!==false)say("INFO","location Wien: none of the "+rows.length+" rows read names a US state and ZIP, but it read "+rows.length+" of "+(stated?last.total:"an unstated total")+", so the list was not read to its end");
    else say("PASS","location Wien: none of its "+rows.length+" rows names a US state and ZIP");}}
{const j=read("wien_ranked");if(!ok(j))unreadable("wien_ranked","engineer in Wien (ranked)");else{
  const us=usUnnamed(j);const viennaOnly=j.jobs.filter((x)=>/vienna/i.test(String(x.location||""))&&!/wien/i.test(String(x.location||"")));
  const anchored=viennaOnly.filter((x)=>!/^engineer\b/i.test(String(x.title||"")));
  if(j.ranked!==true)say("FAIL","engineer in Wien was not ranked (ranked "+JSON.stringify(j.ranked)+(j.rankedFellBack?", fell back: "+String(j.rankedFellBack).slice(0,120):"")+"): the anchored arm cannot be judged on this answer");
  else if(!(j.phaseMs&&typeof j.phaseMs.search_jobs==="number"))say("FAIL","engineer in Wien was ranked but search_jobs did not run (phases "+JSON.stringify(Object.keys(j.phaseMs||{}))+"): its rows are not the answer of search_jobs");
  else if(us.length)say("FAIL","engineer in Wien ranks "+us.length+" of "+j.jobs.length+" rows filed in the US: "+JSON.stringify(us.slice(0,3).map((x)=>x.location)));
  else if(!viennaOnly.length)say("FAIL","engineer in Wien serves "+j.jobs.length+" rows and none named Vienna without Wien: search_jobs has no anchored arm (migration 20261102100000 not applied?)");
  else if(!anchored.length)say("FAIL","engineer in Wien serves "+viennaOnly.length+" rows named Vienna without Wien, and none named Vienna without Wien outside the titles the head-term ring finds (every one starts with engineer): no evidence of the anchored arm of search_jobs");
  else say("PASS","engineer in Wien ranks "+j.jobs.length+" rows, none filed in the US without naming Austria, "+anchored.length+" of them named Vienna with a title the head-term ring does not find (the anchored arm of 20261102100000)");}}
// S13-012.
{const WALKS=[["nurse",50],["crew member",60],["caregiver",60],["customer service",60]];
  // The ring seam (paging.ts RING_WINDOW, passed in) and the 200 window a query with no ring stops at.
  const RING=Number(process.argv[1]),WINDOW=200;
  const reached=[],after=[],deep=[];let broke=false,seamPages=0;
  WALKS.forEach(([who,limit],w)=>{
    const pages=[];for(let n=0;n<6;n++){const raw=(()=>{try{return fs.readFileSync("/tmp/vd_bsearch_walk_"+w+"_"+n+".json","utf8")}catch{return null}})();if(raw===null)break;let j=null;try{j=JSON.parse(raw)}catch{}pages.push(j)}
    const bad=pages.findIndex((j)=>!ok(j));
    if(!pages.length||bad>=0){broke=true;say("FAIL","the seam walk for "+who+": page "+(bad<0?0:bad)+" is unreadable: "+peek("walk_"+w+"_"+(bad<0?0:bad)));return}
    let off=0,pastSeam=false;const seen=new Set();const dup=[],noRead=[],nothing=[],offs=[];
    for(const j of pages){offs.push(off+":"+j.jobs.length);for(const x of j.jobs){const id=String(x.id);if(seen.has(id))dup.push(id);seen.add(id)}
      const topup=!!(j.phaseMs&&"seam_topup" in j.phaseMs),short=j.hasMore===true&&j.jobs.length<limit;
      if(topup)seamPages++;
      if(short&&topup){
        if(j.nextOffset===RING||j.nextOffset===WINDOW)nothing.push(off);
        else if(j.jobs.length*2<limit)say("FAIL","the seam page for "+who+" (limit "+limit+") at offset "+off+" served "+j.jobs.length+" cards after its one top-up read, under half a page (nextOffset "+j.nextOffset+"): it continued as promised, and one read did not come near filling it. The next job-board round owes it more reads (S13-012)");
        else after.push(who+"@"+limit+" offset "+off+": "+j.jobs.length+" cards");}
      else if(short&&limit-j.jobs.length>2){
        if(off<WINDOW||(off<RING&&j.nextOffset===RING))noRead.push("offset "+off+" served "+j.jobs.length+" cards");
        else{pastSeam=true;deep.push(who+"@"+limit+" offset "+off+" folded to "+j.jobs.length+" cards");}}
      off=j.nextOffset;}
    const last=pages[pages.length-1];const crossed=last.hasMore!==true||!!(last.phaseMs&&"seam_topup" in last.phaseMs)||pastSeam||(Number.isInteger(last.nextOffset)&&last.nextOffset>=RING);
    if(noRead.length){broke=true;say("FAIL","the seam walk for "+who+" (limit "+limit+") served short pages that had more: "+JSON.stringify(noRead)+" over "+JSON.stringify(offs)+", with no top-up read on either ask (S13-012: the continuation did not run)")}
    else if(nothing.length){broke=true;say("FAIL","the seam walk for "+who+" (limit "+limit+"): the top-up read at offset "+nothing.join(", ")+" added nothing (nextOffset stayed at the seam)")}
    else if(dup.length){broke=true;say("FAIL","the seam walk for "+who+" served a card twice: "+JSON.stringify(dup.slice(0,3)))}
    else if(!crossed)say("INFO","the seam walk for "+who+" stopped after "+pages.length+" full pages without reaching the seam: "+JSON.stringify(offs));
    else reached.push(who+"@"+limit+" "+JSON.stringify(offs)+" to "+last.nextOffset);});
  if(!broke&&reached.length&&seamPages>0)say("PASS","the seam walk continues past the seam on "+reached.length+" of "+WALKS.length+" queries ("+seamPages+" page(s) made the extra read, no card twice): "+reached.join("; "));
  else if(!broke&&reached.length)say("INFO","no page of the "+WALKS.length+" walks made the extra read: "+reached.join("; ")+" (none was short at its seam, so the continuation was not exercised)");
  if(after.length)say("INFO",after.length+" of "+seamPages+" seam page(s) stayed short after their one read: "+after.join("; ")+" (the code promises the continuation, not a full page; the next job-board round owes more reads)");
  if(deep.length)say("INFO","past its seam "+deep.join("; ")+" with no extra read: the limit the deploy notes disclose");}
' "$VDBS_RING" || echo "FAIL  section 99zzzz judge threw"
fi
