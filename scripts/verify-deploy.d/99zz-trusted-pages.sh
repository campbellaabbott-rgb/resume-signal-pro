# shellcheck shell=bash
# ── 99zz. TRUSTED PAGES: the six D7 pages are named, placed and marked up
# honestly (branch trust/pages, riding job-board 2026-09-09.95 with
# oracle-regionless; migrations 20261025100000 and 20261025110000;
# docs/job-board-deploy-notes.md, .95; docs/company-profiles/name-gate-dry-run.md,
# table 1).
#
# Named 99zz so it sorts after 99z-oracle-regionless.sh both in byte order
# ("-" sorts before "z") and under a collating locale that ignores the dash
# ("99zz" after "99zo"); a three-digit name would sort right after 10-.
#
# WHAT WAITS FOR WHAT. The page lines wait for the frontend publish that
# carries this branch's employer-name mirror: the section reads the app's own
# scripts from the Axia posting page and the Honeywell company page and looks
# for the Honeywell Aerospace override. Until it is there every page line is
# INFO. The country lines on the API wait for job-board .95 and for the board's
# own read after the build's first slice (status.sliceStats.buildSince; a
# board read since then by .95 answers with the new reader), and a page's
# country line also waits for a bake built on a later day than that read (the
# page says the day it was built). The stored-name line waits for the
# name-sync lane (version 5) or two days after the first slice.
#
# THE CLAIMS, one line each:
#   N1  the Axia posting page carries a JobPosting whose hiringOrganization is
#       Axia Women's Health and prints no "Axia Logo Horizontal";
#   N2  the Honeywell company page (icfcjb~ocs~CX_1) names Honeywell Aerospace
#       in its title, H1 and CollectionPage, never the bare "Aerospace";
#   N3  the LCS company page (eexs~us2~CX_3001) names LCS, never "All";
#   N4  all four company pages stay indexable (D7: no page drops);
#   N5  LCS names its two sites, not their postings' hirers: the served app
#       carries the rule (PUBLISHER_ONLY_BOARDS in employer-names.ts) and the
#       sitemap lists no posting page of either site, so no JobPosting names
#       LCS as the hirer of a community's job;
#   C1  ThePlace1's rows whose location ends in Nigeria are filed NG, the D7
#       posting among them;
#   C2  Bristol Myers Squibb's "New Brunswick - NJ - US" rows are filed US and
#       none of their pay is CAD, read from every New Brunswick row on the
#       board whatever its country (a CA-filtered list stops returning a row
#       once .95 refiles it, pay and all);
#   C3  each of those two posting pages carries a JobPosting whose
#       addressCountry is the row's country (NG, US), never the old one;
#   R1  talent.reyesholdings.com serves only Reyes Beverage Group's portal and
#       jobportal.martinbrower.com none of the other four brands' portals, so
#       the two pages list different roles; the three new brand boards are
#       carried and serve rows within 12 hours of the first slice;
#   R2  the two Reyes company pages print different open counts;
#   S1  the stored rows of the three named boards carry the new names (search,
#       the API and get_company_intel read the stored rows).
#
# READ-ONLY. GETs of seven public pages, the sitemap and the app scripts the
# pages name, as Googlebot; one OPTIONS preflight; job-board status, list and detail reads
# sent with x-rb-budget: probe. Nothing is written.
echo "== 99zz. Trusted pages: the six D7 pages are named, placed and marked up honestly =="

VDZZ_AXIA_TOK="recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522"
VDZZ_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
VDZZ_LIVE=0
if [ -z "$VDZZ_H" ]; then echo "FAIL  job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VDZZ_H" "2026-09-09" "95"; then echo "PASS  job-board preflight x-fn-build = $VDZZ_H (2026-09-09.95 or later: the build with the country reader, NAME_SYNC_VERSION 5 and the Reyes brand boards)"; VDZZ_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VDZZ_H: 2026-09-09.95 is not serving yet, so the country, Reyes and stored-name lines wait for it"; fi

rm -f /tmp/vd_99zz_*
VDZZ_P() { curl -s -m 60 -A "$UA" -o "/tmp/vd_99zz_$1.html" -w '%{http_code}' "$SITE$2" > "/tmp/vd_99zz_$1.code" 2>/dev/null; }
VDZZ_P axia "/jobs/posting/ukg/$VDZZ_AXIA_TOK/238cdd44-9089-429c-a963-8de91422a9af"
VDZZ_P honeywell "/jobs/company/icfcjb~ocs~CX_1"
VDZZ_P lcs "/jobs/company/eexs~us2~CX_3001"
VDZZ_P place "/jobs/posting/smartrecruiters/ThePlace1/744000154839819"
VDZZ_P bms "/jobs/posting/workday/bristolmyerssquibb~wd5~BMS/R1607072-1"
VDZZ_P talent "/jobs/company/talent.reyesholdings.com/"
VDZZ_P mb "/jobs/company/jobportal.martinbrower.com/"
curl -s -m 60 -A "$UA" -o /tmp/vd_99zz_sitemap.xml "$SITE/sitemap.xml" 2>/dev/null
# The app's own scripts those pages name: the mirror rides one of them.
: > /tmp/vd_99zz_assets.txt
node -e '
const fs=require("fs");const out=new Set();
for(const f of ["/tmp/vd_99zz_axia.html","/tmp/vd_99zz_honeywell.html"]){let h="";try{h=fs.readFileSync(f,"utf8")}catch{}
  for(const m of h.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\srel="modulepreload"[^>]*\shref)="(\/assets\/[A-Za-z0-9_.-]+\.js)"/g))out.add(m[1]);}
fs.writeFileSync("/tmp/vd_99zz_assets.txt",[...out].slice(0,30).map((u)=>u+"\n").join(""));
' 2>/dev/null
VDZZ_I=0
while IFS= read -r VDZZ_A || [ -n "$VDZZ_A" ]; do
  [ -n "$VDZZ_A" ] || continue
  VDZZ_I=$((VDZZ_I + 1))
  curl -s -m 60 -o "/tmp/vd_99zz_asset_$VDZZ_I.js" "$SITE$VDZZ_A" 2>/dev/null
done < /tmp/vd_99zz_assets.txt 2>/dev/null

if [ "$VDZZ_LIVE" = 1 ]; then
  J '{"action":"status"}' > /tmp/vd_99zz_status.json
  J '{"action":"list","companies":["ThePlace1"],"vendor":["smartrecruiters"],"groupSimilar":false,"includeFacets":false,"limit":50}' > /tmp/vd_99zz_place_list.json
  for VDZZ_O in 0 100 200; do
    J "{\"action\":\"list\",\"companies\":[\"bristolmyerssquibb~wd5~BMS\"],\"location\":\"New Brunswick\",\"groupSimilar\":false,\"includeFacets\":false,\"limit\":100,\"offset\":$VDZZ_O}" > "/tmp/vd_99zz_bms_nb_$VDZZ_O.json"
    node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j&&j.hasMore?0:1)}catch{process.exit(1)}' "/tmp/vd_99zz_bms_nb_$VDZZ_O.json" || break
  done
  J '{"action":"detail","id":"smartrecruiters:ThePlace1:744000154839819"}' > /tmp/vd_99zz_place_detail.json
  J '{"action":"detail","id":"workday:bristolmyerssquibb~wd5~BMS:R1607072-1"}' > /tmp/vd_99zz_bms_detail.json
  for VDZZ_T in talent.reyesholdings.com jobportal.martinbrower.com; do
    for VDZZ_O in 0 100 200 300 400; do
      J "{\"action\":\"list\",\"companies\":[\"$VDZZ_T\"],\"vendor\":[\"icims\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":100,\"offset\":$VDZZ_O}" > "/tmp/vd_99zz_reyes_${VDZZ_T}_$VDZZ_O.json"
      node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(j&&j.hasMore?0:1)}catch{process.exit(1)}' "/tmp/vd_99zz_reyes_${VDZZ_T}_$VDZZ_O.json" || break
    done
  done
  J '{"action":"list","companies":["jobportal.reyescocacola.com","jobportal.reyesfleet.com","jobportal.reyesholdings.com"],"vendor":["icims"],"groupSimilar":false,"includeFacets":false,"limit":50}' > /tmp/vd_99zz_reyes_new.json
  J "{\"action\":\"list\",\"companies\":[\"$VDZZ_AXIA_TOK\",\"icfcjb~ocs~CX_1\",\"eexs~us2~CX_3001\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":30}" > /tmp/vd_99zz_names.json
fi

VDZZ_LIVE="$VDZZ_LIVE" VDZZ_H="$VDZZ_H" node -e '
const fs=require("fs");const E=process.env;const LIVE=E.VDZZ_LIVE==="1";
const txt=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const json=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>txt(f).slice(0,140).replace(/\s+/g," ")||"(no answer)";
const out=(s,m)=>console.log(s.padEnd(5)+" "+m);
const page=(k)=>{const h=txt("/tmp/vd_99zz_"+k+".html");const code=txt("/tmp/vd_99zz_"+k+".code").trim();
  const lds=[...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m)=>{try{return JSON.parse(m[1].replace(/\\u003c/g,"<"))}catch{return {}}}).flatMap((x)=>Array.isArray(x&&x["@graph"])?x["@graph"]:[x]);
  const robots=((h.match(/<meta name="robots" content="([^"]*)"/)||[])[1]||"");
  return {h,code,lds,robots,title:((h.match(/<title>([^<]*)<\/title>/)||[])[1]||""),h1:((h.match(/<h1[^>]*>([^<]*)/)||[])[1]||"").trim(),
    built:((h.match(/checked against the board when it was built, (\d{4}-\d{2}-\d{2})/)||[])[1]||null),
    jp:lds.find((x)=>x&&x["@type"]==="JobPosting")||null,coll:lds.find((x)=>x&&x["@type"]==="CollectionPage")||null,
    gone:code==="404"||code==="410"||/noindex/i.test(robots)};};
const jpName=(jp)=>jp&&jp.hiringOrganization&&jp.hiringOrganization.name;
const jpCountry=(jp)=>{if(!jp)return null;const locs=Array.isArray(jp.jobLocation)?jp.jobLocation:[jp.jobLocation];const a=locs.map((l)=>l&&l.address&&l.address.addressCountry).filter(Boolean);return a.length?a.join(","):null};
// The publish that carries the names: an app script holds the Honeywell Aerospace override.
let assets=0,pub=false,rule=false;for(let i=1;i<=30;i++){const s=txt("/tmp/vd_99zz_asset_"+i+".js");if(!s)continue;assets++;if(/icfcjb~ocs~CX_1["\x27`]\s*,\s*["\x27`]Honeywell Aerospace/.test(s))pub=true;if(/["\x27`]eexs~us2~CX_11009["\x27`]\s*,\s*["\x27`]eexs~us2~CX_3001["\x27`]\s*\]/.test(s))rule=true}
if(pub)out("INFO","the served app carries the employer names (an app script holds the Honeywell Aerospace override, of "+assets+" read): the page lines below are judged");
else out("INFO","the served app does not carry the employer names yet ("+assets+" app script(s) read, none holds the Honeywell Aerospace override): the page lines below are INFO until the frontend publish after this branch");
const wait=(m)=>out(pub?"FAIL":"INFO",m+(pub?"":" (before the publish that carries the names)"));
// N1
const ax=page("axia");
if(!ax.h)out("FAIL","the Axia posting page did not answer: "+ax.code);
else if(ax.gone)out("INFO","the Axia posting page is gone or noindex (HTTP "+ax.code+", robots \""+ax.robots+"\"): the posting closed or left its window, so its markup is not judged");
else{const n=jpName(ax.jp),old=/Axia Logo Horizontal/.test(ax.h);
  if(n==="Axia Women\x27s Health"&&!old)out("PASS","the Axia posting page carries a JobPosting naming Axia Women\x27s Health and prints no logo text");
  else wait("the Axia posting page "+(old?"still prints \"Axia Logo Horizontal\"; ":"")+(ax.jp?"carries a JobPosting naming "+JSON.stringify(n):"carries no JobPosting")+", want hiringOrganization \"Axia Women\x27s Health\" (the gate passes it)");}
// N2, N3
for(const [k,want,old,path] of [["honeywell","Honeywell Aerospace","Aerospace","/jobs/company/icfcjb~ocs~CX_1"],["lcs","LCS","All","/jobs/company/eexs~us2~CX_3001"]]){
  const p=page(k);
  if(!p.h){out("FAIL",path+" did not answer: "+p.code);continue}
  const about=p.coll&&p.coll.about&&p.coll.about.name;
  const ok=about===want&&p.h1.includes(want)&&p.title.startsWith(want);
  if(ok)out("PASS",path+" names "+want+" in its title, H1 and CollectionPage (title \""+p.title+"\")");
  else wait(path+" prints title \""+p.title+"\", H1 \""+p.h1+"\", CollectionPage about "+JSON.stringify(about)+": want "+want+(about===old?", not the refused \""+old+"\"":""));
}
// N4
for(const [k,path] of [["honeywell","/jobs/company/icfcjb~ocs~CX_1"],["lcs","/jobs/company/eexs~us2~CX_3001"],["talent","/jobs/company/talent.reyesholdings.com/"],["mb","/jobs/company/jobportal.martinbrower.com/"]]){
  const p=page(k);
  if(!p.h)out("FAIL",path+" did not answer: "+p.code);
  else out(/noindex/i.test(p.robots)||p.code!=="200"?"FAIL":"PASS",path+" answers "+p.code+" with robots \""+p.robots+"\" (D7: it stays indexable)");
}
// N5
const lcsPostings=[...txt("/tmp/vd_99zz_sitemap.xml").matchAll(/<loc>[^<]*\/jobs\/posting\/oracle\/(eexs~us2~CX_(?:3001|11009))\/[^<]*<\/loc>/g)].length;
if(rule)out("PASS","the served app carries the rule that LCS\x27s two sites (eexs~us2~CX_3001, CX_11009) name no hirer for their postings: no posting page, no JobPosting");
else wait("the served app does not carry the rule that LCS\x27s two sites name no hirer for their postings (no app script holds PUBLISHER_ONLY_BOARDS), so a posting there would be marked up with LCS as its hirer");
if(!txt("/tmp/vd_99zz_sitemap.xml"))out("FAIL","the sitemap did not answer");
else if(!lcsPostings)out("PASS","the sitemap lists no posting page of LCS\x27s two sites");
else wait("the sitemap lists "+lcsPostings+" posting page(s) of LCS\x27s two sites, each a page naming LCS as the hirer of a community\x27s job");
// The serving build and its first slice.
const S=json("/tmp/vd_99zz_status.json");const ss=S&&S.sliceStats&&typeof S.sliceStats==="object"?S.sliceStats:null;
const serving=String(E.VDZZ_H||"").replace(/^job-board\./,"");const ours=!!ss&&ss.build===serving;const since=ours?Date.parse(ss.buildSince||""):NaN;
const ageH=Number.isFinite(since)?(Date.now()-since)/3600000:null;
if(LIVE&&!ours)out("INFO","status.sliceStats.build is "+(ss?ss.build:"(none)")+", not the serving "+serving+": no slice of this build has run, so the API lines wait");
const readBy=(rows)=>{const t=rows.map((r)=>Date.parse((r&&r.recheckedAt)||"")).filter(Number.isFinite);return t.length?Math.max(...t):null};
const dayOf=(t)=>new Date(t).toISOString().slice(0,10);
// C1, C2 on the API; C3 on the pages.
const countryCase=(label,rows,want,detailFile,pageKey,extra)=>{
  if(!LIVE)return out("INFO",label+": waits for job-board .95");
  const d=json(detailFile);const dj=d&&d.job;
  if(!Array.isArray(rows))return out("FAIL",label+": the list is unreadable");
  const wrong=rows.filter((r)=>r.country!==want);const filedAs=(r)=>r.country||"(none)";const read=readBy(rows);const readSince=read!==null&&Number.isFinite(since)&&read>=since;
  const bad=wrong.length||(extra?extra(rows):"");
  if(!rows.length)out("INFO",label+": no such row is served (closed or out of window), so nothing to judge");
  else if(!bad)out("PASS",label+": "+rows.length+" row(s), all filed "+want+(extra?" and none with the old currency":""));
  else if(readSince||(ageH!==null&&ageH>24))out("FAIL",label+": "+(wrong.length?wrong.length+" of "+rows.length+" still filed "+[...new Set(wrong.map(filedAs))].join("/"):"")+(extra?" "+extra(rows):"")+(readSince?" after this build read the board":" more than 24 h after the first slice"));
  else out("INFO",label+": "+wrong.length+" of "+rows.length+" still filed otherwise; the board has not been read by this build yet ("+(ours?"first slice "+ageH.toFixed(1)+" h ago":"no slice of this build yet")+")");
  const p=page(pageKey);const jc=jpCountry(p.jp);const djOk=dj&&dj.country===want;
  if(!p.h)out("FAIL",label+" page did not answer: "+p.code);
  else if(p.gone)out("INFO",label+" page is gone or noindex (HTTP "+p.code+"): its markup is not judged");
  else if(jc===want)out("PASS",label+" page carries a JobPosting with addressCountry "+want);
  else if(p.jp)out("FAIL",label+" page carries a JobPosting with addressCountry "+jc+", want "+want);
  else if(pub&&djOk&&p.built&&read!==null&&p.built>dayOf(read))out("FAIL",label+" page (built "+p.built+") carries no JobPosting although the row reads "+want+" since "+dayOf(read)+": the country rule now passes it");
  else out("INFO",label+" page carries no JobPosting yet (row "+(dj?"filed "+dj.country:"not read")+", page built "+(p.built||"?")+(pub?"":", before the publish that carries the names")+"): it waits for a bake after the row is placed");
};
const PL=json("/tmp/vd_99zz_place_list.json");
countryCase("ThePlace1 rows whose location ends in Nigeria",PL&&Array.isArray(PL.jobs)?PL.jobs.filter((r)=>/Nigeria\s*$/.test(String(r.location||""))):null,"NG","/tmp/vd_99zz_place_detail.json","place");
const BN=[0,100,200].map((o)=>json("/tmp/vd_99zz_bms_nb_"+o+".json")).filter(Boolean);const bmsDetail=json("/tmp/vd_99zz_bms_detail.json");
const bmsRows=BN.length&&Array.isArray(BN[0].jobs)?[...BN.flatMap((j)=>Array.isArray(j.jobs)?j.jobs:[]).filter((r)=>/-\s*NJ\s*-\s*US\s*$/.test(String(r.location||""))),...(bmsDetail&&bmsDetail.job?[bmsDetail.job]:[])]:null;
countryCase("Bristol Myers Squibb rows at \"New Brunswick - NJ - US\" (every New Brunswick row on the board, whatever its country, plus the D7 posting)",bmsRows?[...new Map(bmsRows.map((r)=>[r.id,r])).values()]:null,"US","/tmp/vd_99zz_bms_detail.json","bms",(rows)=>{const c=rows.filter((r)=>r.salaryCurrency==="CAD").length;return c?c+" with pay in CAD":""});
// R1
if(LIVE){
  const rows=(t)=>{const a=[];for(const o of [0,100,200,300,400]){const j=json("/tmp/vd_99zz_reyes_"+t+"_"+o+".json");if(j&&Array.isArray(j.jobs))a.push(...j.jobs)}return a};
  const host=(u)=>{try{return new URL(u).hostname}catch{return "?"}};
  const T=rows("talent.reyesholdings.com"),M=rows("jobportal.martinbrower.com");
  const others=new Set(["careers-reyesbeveragegroup.icims.com","careers-reyescocacola.icims.com","careers-reyesfleetmanagement.icims.com","careers-reyesholdings.icims.com"]);
  const tBad=T.filter((r)=>host(r.applyUrl)!=="careers-reyesbeveragegroup.icims.com"),mBad=M.filter((r)=>others.has(host(r.applyUrl)));
  const req=(r)=>String(r.id||"").split(":").pop();const mReq=new Set(M.map(req));const shared=T.filter((r)=>mReq.has(req(r))).length;
  const read=readBy([...T,...M]);const readSince=read!==null&&Number.isFinite(since)&&Math.min(readBy(T)??0,readBy(M)??0)>=since;
  const msg="talent.reyesholdings.com serves "+T.length+" row(s), "+tBad.length+" off Reyes Beverage Group\x27s portal; jobportal.martinbrower.com serves "+M.length+", "+mBad.length+" on another brand\x27s portal; "+shared+" requisition(s) on both";
  if(!T.length&&!M.length)out("FAIL","neither Reyes board serves a row: "+peek("/tmp/vd_99zz_reyes_talent.reyesholdings.com_0.json"));
  else if(!tBad.length&&!mBad.length&&!shared)out("PASS",msg);
  else if(readSince||(ageH!==null&&ageH>24))out("FAIL",msg+(readSince?" after this build read both boards":" more than 24 h after the first slice")+" (migration 20261025110000 applied after .95 moves them; re-run it if it ran early)");
  else out("INFO",msg+": the boards have not both been read by this build yet");
  const N=json("/tmp/vd_99zz_reyes_new.json");
  if(!N||!Array.isArray(N.jobs))out("FAIL","the three new Reyes boards\x27 list is unreadable: "+peek("/tmp/vd_99zz_reyes_new.json"));
  else{const un=Array.isArray(N.unknownCompanies)?N.unknownCompanies:[];const toks=new Set(N.jobs.map((r)=>r.token));
    if(un.length)out("FAIL","the serving catalogue does not carry "+un.join(", "));
    else if(toks.size===3)out("PASS","the three new Reyes brand boards are carried and each serves rows ("+N.total+" in all)");
    else if(ageH!==null&&ageH>12)out("FAIL","only "+toks.size+" of the three new Reyes brand boards serve rows "+ageH.toFixed(1)+" h after the first slice (a new board is first read 2-3 h after the deploy)");
    else out("INFO","the three new Reyes brand boards are carried; "+toks.size+" serve rows so far (first visit 2-3 h after the deploy; FAIL after 12 h)");}
  // R2
  const tp=page("talent"),mp=page("mb");const cnt=(p)=>{const m=p.title.match(/: ([\d,]+) open roles/);return m?m[1]:null};
  const clean=!tBad.length&&!mBad.length&&!shared;
  if(!tp.h||!mp.h)out("FAIL","a Reyes company page did not answer");
  else if(cnt(tp)!==null&&cnt(tp)!==cnt(mp))out("PASS","the two Reyes company pages print different open counts ("+cnt(tp)+" and "+cnt(mp)+"): each lists its own brand");
  else if(clean&&pub)out("FAIL","the two Reyes company pages still print the same open count ("+cnt(tp)+") although the boards no longer share a row");
  else out("INFO","the two Reyes company pages print "+cnt(tp)+" and "+cnt(mp)+" open roles: they wait for the brand boards and a publish after them");
}else{out("INFO","the Reyes boards wait for job-board .95")}
// S1
if(LIVE){
  const NM=json("/tmp/vd_99zz_names.json");const want={"recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522":"Axia Women\x27s Health","icfcjb~ocs~CX_1":"Honeywell Aerospace","eexs~us2~CX_3001":"LCS"};
  const steps=S&&S.passEnd&&S.passEnd.steps;const nd=steps&&steps.names&&String(steps.names.detail||"");const lane=/name sync v(\d+) (?:complete|done)/.exec(nd||"");const laneDone=!!lane&&Number(lane[1])>=5;
  if(!NM||!Array.isArray(NM.jobs))out("FAIL","the named boards\x27 list is unreadable: "+peek("/tmp/vd_99zz_names.json"));
  else{const stale=NM.jobs.filter((r)=>want[r.token]&&r.company!==want[r.token]);const seen=new Set(NM.jobs.map((r)=>r.token));
    const m=Object.keys(want).filter((t)=>seen.has(t)).length+" of 3 boards served";
    if(!NM.jobs.length)out("INFO","none of the three named boards served a row, so the stored names are not judged");
    else if(!stale.length)out("PASS","the stored rows read the employer names ("+m+")");
    else if(laneDone||(ageH!==null&&ageH>48))out("FAIL",stale.length+" stored row(s) still carry an old name ("+[...new Set(stale.map((r)=>r.token+" = "+r.company))].join("; ")+") "+(laneDone?"after the name-sync lane reported version "+lane[1]+" done":"more than 48 h after the first slice")+": migration 20261025100000 must be applied before job-board .95, or the lane finished without its rows");
    else out("INFO",stale.length+" stored row(s) still carry an old name; the name-sync lane has not reported version 5 done ("+(nd||"no names step in passEnd")+")");}
}
' 2>&1 || echo "FAIL  99zz judge threw (see the lines above)"
