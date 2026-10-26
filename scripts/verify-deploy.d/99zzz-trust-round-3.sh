# shellcheck shell=bash
# ── 99zzz. TRUST ROUND 3: true names, true agency labels, each feed read once,
# true countries, the dedupe's own boards (branch trust/round3, job-board
# 2026-09-09.96, layoff-filings 2026-10-26.1; migrations 20261026100000 and
# 20261026110000; docs/job-board-deploy-notes.md, .96).
#
# Named 99zzz so it sorts after 99zz-trusted-pages.sh both in byte order
# ("-" sorts before "z") and under a collating locale that ignores the dash
# ("99zztrusted..." before "99zzztrust..."); a three-digit name would sort
# right after 10-.
#
# WHAT WAITS FOR WHAT. Every API line waits for job-board .96 on the preflight
# and for a slice of it (status.sliceStats.build, buildSince); until then it is
# INFO. A board's line then waits for that board's own read by .96 (the rows'
# recheckedAt, the board's read stamp, after buildSince), or for a deadline
# after the first slice: 24 h for a board read every cold lap, 48 h where a
# migration must also have run, 72 h for the Oracle dedupe (every community
# site visited once). The stored names (N1) wait for the name-sync lane's
# version 6 to report done, or 48 h: a read alone renames no stored row. The page lines wait for the
# frontend publish whose app scripts carry this round's override mirror (the
# Hong Kong Baptist University row), and a bare token's page also for the
# name-sync lane's version 6.
#
# THE CLAIMS, one line each (FAIL only once what it waits for has happened):
#   N1  each renamed board with open roles serves its rows under its new name,
#       never its old label (36 boards with 5 or more open roles on
#       2026-10-26, plus two LCS communities once they carry rows);
#   N2  every baked page of a renamed board the sitemap lists (company or
#       posting page, up to ten) prints the new name and never the old label
#       (on 2026-10-26 the sitemap listed none of them: INFO until it does);
#   A1  the employers' own boards cleared of the agency flag serve rows with
#       agency false (Convergint 228 open on 2026-10-26 and eleven more);
#   A2  Jobandtalent's three boards serve rows with agency true;
#   A3  no baked company page of a cleared board is the agency variant
#       ("Roles listed by", the staffing-agency banner);
#   I1  each of the six scoped iCIMS boards serves only rows on its own
#       portal (Exelon on careers-exeloncorp, ComEd on careers-comed,
#       Chick-fil-A on careers-chickfila and canadacareers-chickfila,
#       Chick-fil-A Supply LLC on careers-cfasupply, YNV Group on
#       careers-ynvgroup, Teknowledge on careers-teknowledge);
#   I2  the four duplicate hosts are not carried and serve no row;
#   I3  the four Exelon brand boards are carried, each on its own portal;
#   O1  LCS's "All" (eexs~us2~CX_3001, 592 open on 2026-10-26) serves at most
#       30 and a community site (Sedgebrook, CX_10013) serves rows; R+L's
#       "Default" (erhk~us2~CX_1001) serves none and R+L Carriers' CX_1 does;
#   C1  the "Lake Wales, FL", "Greece, NY" and "Peru, IN/IL" rows are filed US,
#       and a "Cardiff, Wales" row is still filed GB (the control);
#   C2  two named postings ("NY - Greece", "Greece, NY #0185") and Kohl's
#       "Lake Wales (1250)" are filed US.
#
# READ-ONLY. One OPTIONS preflight; job-board status, list and detail reads
# sent with x-rb-budget: probe; GETs of the sitemap, LCS's company page, up to
# ten listed pages of this round's boards and the app scripts they name, as
# Googlebot. Nothing is written.
echo "== 99zzz. Trust round 3: true names, agency labels, one feed read once, countries, the dedupe's own boards =="

VDZ3_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
VDZ3_LIVE=0
if [ -z "$VDZ3_H" ]; then echo "FAIL  job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VDZ3_H" "2026-09-09" "96"; then echo "PASS  job-board preflight x-fn-build = $VDZ3_H (2026-09-09.96 or later: trust round 3's names, agency labels, iCIMS scope, Oracle pool sites and country rule)"; VDZ3_LIVE=1
else echo "INFO  job-board preflight x-fn-build = $VDZ3_H: 2026-09-09.96 is not serving yet, so every API line below waits for it"; fi

rm -f /tmp/vd_99zzz_*
curl -s -m 60 -A "$UA" -o /tmp/vd_99zzz_sitemap.xml "$SITE/sitemap.xml" 2>/dev/null
curl -s -m 60 -A "$UA" -o /tmp/vd_99zzz_lcs.html "$SITE/jobs/company/eexs~us2~CX_3001" 2>/dev/null
# The renamed boards N1 reads: vendor, token, old label, new name.
VDZ3_NAMES='[
["adp","bb661c48-7edc-400c-adfb-40f8f7743374","HRH Secaucus University Transparent","Hudson Regional Health"],
["adp","b3bc545f-6177-4880-8881-2ac6904aec6b","BookmarkLogo PrimaryStacked Fullcolor","Bookmark Medical"],
["adp","71562ff3-8368-4253-b712-0c0c15bc181b","MCA (White Space)","Mobile Communications America"],
["adp","582157cb-34cb-4bca-8237-ec7c1f3fd8d1","Modineer Transparent","Modineer"],
["adp","a4238dcf-5c61-4963-9b15-def8050f8004","transparent background","ATC Drivetrain"],
["adp","6a0a1cc7-b180-45b3-a723-1c8159d2f829","mc cmyk (3)","Merrimack College"],
["adp","06ac6923-7485-4dbc-af8c-2d543fd02bde","IPG All Companies IPG Right (RGB) (1)","Indel Power Group"],
["adp","98617f59-2ed0-4bd6-9f68-20fa241f2e5a","VAUPELL cmyk","Vaupell"],
["adp","61eae558-f513-41ba-9f35-9cd7387146b8","BOD Color@2x","Banko Overhead Doors"],
["adp","c65bb879-0106-458b-ba3a-1d1c1287115f","FBT Gibbons Linear CMYK","FBT Gibbons"],
["adp","36278fed-189f-477f-a74e-30a70a38d2c3","TERI Transparent Background","TERI"],
["adp","bf5dbe8a-7475-427e-966d-4942d6eddde3","CiprianiWerner WordMark","Cipriani & Werner"],
["adp","67bfed39-352a-407e-bb98-1ee7787db55a","TFA Transparent Background","The Florida Aquarium"],
["adp","33f858b8-3c41-480e-a1e6-b328430e1cdd","HDC FullColor","HDC MidAtlantic"],
["adp","33719718-bd74-496b-9eb7-d8baee2c8ea7","MCN NewTag CMYK","MCN Build"],
["adp","a771ec58-05da-4fe2-8ec6-fc8ee1a9e309","EH Logo@4x","Emmanuel Hospice"],
["adp","d5874300-92af-4404-8c7d-f22dacd18835","anm logo@2x","ANM"],
["adp","8d661a1d-66d3-4337-be21-bf05f238bb42","USGBC GBCI Lockup 2000px","U.S. Green Building Council"],
["adp","6aa48373-3ed3-4d60-ad3e-50273d106d20","Nongshim (english)horizontal","Nongshim USA"],
["adp","ef82fdaa-4e54-44dc-a222-b12d9b478366","ConnectLife CMYK","ConnectLife"],
["adp","68553c3c-1468-4491-bd06-4ce87445742a~9200535968617_2","Harrington Light Background (002)","Harrington Hoists"],
["adp","d290c04e-0230-4cd9-8bf0-f116bfab1405~19000101_000003","Synchron Temp Forest Green 13452A","Synchron"],
["ashby","lemonade","Jobs","Lemonade"],
["ashby","ftmo","Jobs","FTMO"],
["lever","vacancies","Vacancies","United Tech"],
["greenhouse","corelight","Job Board","Corelight"],
["greenhouse","notexternal","Only External Postings","Blueprint Technologies"],
["greenhouse","xebiacee","Poland and Eastern Europe","Xebia Poland and Central-Eastern Europe"],
["greenhouse","alphasightsresumedrop","AlphaSights Campus Recruiting","AlphaSights"],
["oracle","fa-ewqq-saasfaprod1~ocs~CX_1","HKBU e-Recruitment System","Hong Kong Baptist University"],
["oracle","fa-exux-saasfaprod1~ocs~CX_1","Government of Nunavut Recruitment","Government of Nunavut"],
["oracle","fa-evxn-saasfaukgovprod1~ocs~CX_1001","Scottish Government OGD Recruitment","Scottish Government"],
["oracle","fa-evxn-saasfaukgovprod1~ocs~CX_1","Scottish Government Recruitment","Scottish Government"],
["oracle","fa-evlo-saasfaprod1~ocs~CX_1","ENBD Recruitment Team","Emirates NBD"],
["oracle","fa-evlo-saasfaprod1~ocs~CX_2","Emirate Islamic Bank Recruitment Team","Emirates Islamic"],
["oracle","ejgo~em2~CX_1","Farrans Recruitment Team","Farrans"],
["oracle","eexs~us2~CX_12051","Eastcasle Place","Eastcastle Place"],
["oracle","eexs~us2~CX_21005","RSL - Farmington Hills","Rose Senior Living Farmington Hills"]
]'
VDZ3_CLEARED='["recruiting2~CON1074CVTG~1831b61a-1945-44fa-afd8-624795c9b30d","recruiting~ban1010~e9066a66-c3b9-e25c-d036-116705c05e46","recruiting~LAF1002LAFA~1a07d948-3361-48d7-89f2-002c5a48346c","recruiting2~SAP1000SPID~5e557a61-9707-4f47-8f76-9c11b2bfbf9e","recruiting~KIL1000~68c62bcb-20f8-3231-d728-9190572df832","recruiting~LOW1003LFCS~cfc2ee58-1207-4e12-a838-876cbc96b1f9","d290c04e-0230-4cd9-8bf0-f116bfab1405~19000101_000003","4a8a08f1-ff6c-4d60-8308-4b09a199dd38","eify~us6~CX_1001","alphasightsresumedrop","geant","paradise-media-recruitment"]'

# The listed pages of this round's boards: renamed (N2) or cleared (A3), at most ten.
VDZ3_NAMES="$VDZ3_NAMES" VDZ3_CLEARED="$VDZ3_CLEARED" node -e '
const fs=require("fs");let sm="";try{sm=fs.readFileSync("/tmp/vd_99zzz_sitemap.xml","utf8")}catch{}
const names=JSON.parse(process.env.VDZ3_NAMES).map((x)=>x[1]),cleared=JSON.parse(process.env.VDZ3_CLEARED);
const out=[];for(const m of sm.matchAll(/<loc>https?:\/\/[^/<]+(\/jobs\/(company|posting\/[a-z]+)\/([^/<]+)[^<]*)<\/loc>/g)){
  const path=m[1],tok=decodeURIComponent(m[3]);const kind=m[2]==="company"?"company":"posting";
  if(names.includes(tok)||cleared.includes(tok))out.push([path,kind,tok].join("\t"));}
fs.writeFileSync("/tmp/vd_99zzz_pages.txt",out.slice(0,10).map((l)=>l+"\n").join(""));
' 2>/dev/null
VDZ3_I=0
while IFS="$(printf '\t')" read -r VDZ3_PATH VDZ3_KIND VDZ3_TOK || [ -n "${VDZ3_PATH:-}" ]; do
  [ -n "$VDZ3_PATH" ] || continue
  VDZ3_I=$((VDZ3_I + 1))
  curl -s -m 60 -A "$UA" -o "/tmp/vd_99zzz_pg_$VDZ3_I.html" "$SITE$VDZ3_PATH" 2>/dev/null
done < /tmp/vd_99zzz_pages.txt 2>/dev/null
# The app scripts those pages and LCS's company page name: the mirror rides one of them.
: > /tmp/vd_99zzz_assets.txt
node -e '
const fs=require("fs");const out=new Set();
for(const f of ["/tmp/vd_99zzz_lcs.html",...Array.from({length:10},(_,i)=>"/tmp/vd_99zzz_pg_"+(i+1)+".html")]){let h="";try{h=fs.readFileSync(f,"utf8")}catch{}
  for(const m of h.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\srel="modulepreload"[^>]*\shref)="(\/assets\/[A-Za-z0-9_.-]+\.js)"/g))out.add(m[1]);}
fs.writeFileSync("/tmp/vd_99zzz_assets.txt",[...out].slice(0,30).map((u)=>u+"\n").join(""));
' 2>/dev/null
VDZ3_I=0
while IFS= read -r VDZ3_A || [ -n "$VDZ3_A" ]; do
  [ -n "$VDZ3_A" ] || continue
  VDZ3_I=$((VDZ3_I + 1))
  curl -s -m 60 -o "/tmp/vd_99zzz_asset_$VDZ3_I.js" "$SITE$VDZ3_A" 2>/dev/null
done < /tmp/vd_99zzz_assets.txt 2>/dev/null

if [ "$VDZ3_LIVE" = 1 ]; then
  J '{"action":"status"}' > /tmp/vd_99zzz_status.json
  VDZ3_N=0
  for VDZ3_T in $(printf '%s' "$VDZ3_NAMES" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const [v,t] of JSON.parse(s))console.log(v+"|"+t)})'); do
    VDZ3_N=$((VDZ3_N + 1))
    J "{\"action\":\"list\",\"companies\":[\"${VDZ3_T#*|}\"],\"vendor\":[\"${VDZ3_T%%|*}\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":3}" > "/tmp/vd_99zzz_name_$VDZ3_N.json"
  done
  J "{\"action\":\"list\",\"companies\":$VDZ3_CLEARED,\"groupSimilar\":false,\"includeFacets\":false,\"limit\":60}" > /tmp/vd_99zzz_cleared.json
  J '{"action":"list","companies":["jobandtalent","multitempo"],"vendor":["teamtailor","lever"],"groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_99zzz_jobandtalent.json
  for VDZ3_T in careers.delmarva.com careers.comed.com careers.baycenterfoods.com careers.chick-fil-a.com careers.ynvgroup.com careers.monifai.com; do
    J "{\"action\":\"list\",\"companies\":[\"$VDZ3_T\"],\"vendor\":[\"icims\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":60}" > "/tmp/vd_99zzz_icims_$VDZ3_T.json"
  done
  J '{"action":"list","companies":["careers.bpas.com","careers.keysight.com","careers.goldennugget.com","talent.lla.com"],"vendor":["icims"],"groupSimilar":false,"includeFacets":false,"limit":5}' > /tmp/vd_99zzz_pruned.json
  J '{"action":"list","companies":["careers.bge.com","careers.peco.com","careers.pepco.com","careers.atlanticcityelectric.com"],"vendor":["icims"],"groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_99zzz_brands.json
  for VDZ3_T in eexs~us2~CX_3001 eexs~us2~CX_10013 erhk~us2~CX_1001 erhk~us2~CX_1; do
    J "{\"action\":\"list\",\"companies\":[\"$VDZ3_T\"],\"vendor\":[\"oracle\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":1}" > "/tmp/vd_99zzz_oracle_$VDZ3_T.json"
  done
  J '{"action":"list","location":"Lake Wales","groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_99zzz_lakewales.json
  J '{"action":"list","location":"Greece","groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_99zzz_greece.json
  J '{"action":"list","location":"Peru","groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_99zzz_peru.json
  J '{"action":"list","location":"Cardiff","groupSimilar":false,"includeFacets":false,"limit":60}' > /tmp/vd_99zzz_cardiff.json
  J '{"action":"detail","id":"workday:cvshealth~wd1~CVS_Health_Careers:R1075322"}' > /tmp/vd_99zzz_d_cvs.json
  J '{"action":"detail","id":"workday:bjswholesaleclub~wd1~BJsCareers:R255468"}' > /tmp/vd_99zzz_d_bjs.json
  J '{"action":"detail","id":"workday:kohls~wd504~kohlscareers:R504030"}' > /tmp/vd_99zzz_d_kohls.json
fi

VDZ3_LIVE="$VDZ3_LIVE" VDZ3_H="$VDZ3_H" VDZ3_NAMES="$VDZ3_NAMES" VDZ3_CLEARED="$VDZ3_CLEARED" node -e '
const fs=require("fs");const E=process.env;const LIVE=E.VDZ3_LIVE==="1";
const txt=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const json=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>txt(f).slice(0,140).replace(/\s+/g," ")||"(no answer)";
const out=(s,m)=>console.log(s.padEnd(5)+" "+m);
const host=(u)=>{try{return new URL(u).hostname}catch{return "?"}};
const rowsOf=(f)=>{const j=json(f);return j&&Array.isArray(j.jobs)?j.jobs:null};
const readBy=(rows)=>{const t=(rows||[]).map((r)=>Date.parse((r&&r.recheckedAt)||"")).filter(Number.isFinite);return t.length?Math.min(...t):null};
// The serving build and its first slice.
const S=json("/tmp/vd_99zzz_status.json");const ss=S&&S.sliceStats&&typeof S.sliceStats==="object"?S.sliceStats:null;
const serving=String(E.VDZ3_H||"").replace(/^job-board\./,"");const ours=LIVE&&!!ss&&ss.build===serving;
const since=ours?Date.parse(ss.buildSince||""):NaN;const ageH=Number.isFinite(since)?(Date.now()-since)/3600000:null;
if(LIVE&&!ours)out("INFO","status.sliceStats.build is "+(ss?ss.build:"(none)")+", not the serving "+serving+": no slice of this build has run, so the API lines wait");
const readSince=(rows)=>{const r=readBy(rows);return r!==null&&Number.isFinite(since)&&r>=since};
const due=(rows,h)=>readSince(rows)||(ageH!==null&&ageH>h);
const waitWhy=(h)=>ours?"the board has not been read by this build yet (first slice "+ageH.toFixed(1)+" h ago; FAIL after "+h+" h)":"no slice of this build yet";
const steps=S&&S.passEnd&&S.passEnd.steps;const nd=steps&&steps.names&&String(steps.names.detail||"");const lane=/name sync v(\d+) (?:complete|done)/.exec(nd||"");const laneDone=!!lane&&Number(lane[1])>=6;
// N1
if(!LIVE)out("INFO","N1 renamed boards: wait for job-board .96");
else{const L=JSON.parse(E.VDZ3_NAMES);const stale=[],good=[],empty=[],waiting=[];let bad=0;
  L.forEach(([v,t,old,nw],i)=>{const rows=rowsOf("/tmp/vd_99zzz_name_"+(i+1)+".json");
    if(rows===null){bad++;stale.push(t+": unreadable "+peek("/tmp/vd_99zzz_name_"+(i+1)+".json"));return}
    if(!rows.length){empty.push(t);return}
    const wrong=rows.filter((r)=>r.company!==nw);
    if(!wrong.length){good.push(nw);return}
    const msg=v+":"+t+" serves \""+wrong[0].company+"\""+(wrong[0].company===old?" (its old label)":"")+", want \""+nw+"\"";
    if(laneDone||(ageH!==null&&ageH>48))stale.push(msg);else waiting.push(msg)});
  if(stale.length)out("FAIL","N1 "+stale.length+" renamed board(s) still print another name"+(laneDone?" after the name-sync lane reported version "+lane[1]+" done":" 48 h after the first slice")+": "+stale.slice(0,6).join("; ")+(stale.length>6?" ...":"")+" (migration 20261026100000 goes before job-board .96; the bare tokens are RENAMED_TOKENS)");
  else if(good.length)out("PASS","N1 "+good.length+" renamed board(s) serve their new names"+(waiting.length?", "+waiting.length+" still wait for the lane":"")+(empty.length?"; "+empty.length+" served no row":""));
  else out("INFO","N1 no renamed board served a row under its new name yet: "+waiting.length+" wait for the lane ("+(nd||"no names step in passEnd")+"), "+empty.length+" served no row");
  if(!stale.length&&waiting.length)out("INFO","N1 waiting: "+waiting.slice(0,4).join("; ")+(waiting.length>4?" ...":""));}
// The publish that carries this round: an app script holds the Hong Kong Baptist University override.
let assets=0,pub=false;for(let i=1;i<=30;i++){const s=txt("/tmp/vd_99zzz_asset_"+i+".js");if(!s)continue;assets++;if(/fa-ewqq-saasfaprod1~ocs~CX_1["\x27`]\s*,\s*["\x27`]Hong Kong Baptist University/.test(s))pub=true}
out("INFO",pub?"the served app carries this round\x27s employer names (of "+assets+" app script(s) read): the page lines below are judged":"the served app does not carry this round\x27s employer names yet ("+assets+" app script(s) read): the page lines below are INFO until the frontend publish after this branch");
const pages=txt("/tmp/vd_99zzz_pages.txt").split("\n").filter(Boolean).map((l,i)=>{const [path,kind,tok]=l.split("\t");const h=txt("/tmp/vd_99zzz_pg_"+(i+1)+".html");
  const lds=[...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m)=>{try{return JSON.parse(m[1].replace(/\\u003c/g,"<"))}catch{return {}}}).flatMap((x)=>Array.isArray(x&&x["@graph"])?x["@graph"]:[x]);
  const jp=lds.find((x)=>x&&x["@type"]==="JobPosting");const coll=lds.find((x)=>x&&x["@type"]==="CollectionPage");
  const title=((h.match(/<title>([^<]*)<\/title>/)||[])[1]||""),h1=((h.match(/<h1[^>]*>([^<]*)/)||[])[1]||"").trim();
  const jpName=jp&&jp.hiringOrganization&&jp.hiringOrganization.name;
  // The names the page prints for its employer: the JobPosting hirer, the CollectionPage subject, the H1 and the title.
  const printed=new Set([jpName,coll&&coll.about&&coll.about.name,(/^(?:Open roles at|Roles listed by) (.+)$/.exec(h1)||[])[1],(/^(.+?) jobs:/.exec(title)||[])[1]].filter(Boolean));
  return {path,kind,tok,h,title,h1,jpName,printed,baked:!!(jp||coll)}});
// N2
{const L=new Map(JSON.parse(E.VDZ3_NAMES).map(([,t,old,nw])=>[t,{old,nw}]));const mine=pages.filter((p)=>L.has(p.tok));
  if(!txt("/tmp/vd_99zzz_sitemap.xml"))out("FAIL","N2 the sitemap did not answer");
  else if(!mine.length)out("INFO","N2 the sitemap lists no page of a renamed board, so no page is judged");
  else for(const p of mine){const {old,nw}=L.get(p.tok);const oldShown=p.printed.has(old);const shows=p.printed.has(nw);
    if(!p.h)out("FAIL","N2 "+p.path+" did not answer");
    else if(!p.baked)out("INFO","N2 "+p.path+" is not a baked page (no CollectionPage or JobPosting), so it is not judged");
    else if(!oldShown&&shows)out("PASS","N2 "+p.path+" names "+nw+" and never \""+old+"\" ("+[...p.printed].join(" / ")+")");
    else if(pub&&(p.tok.includes("~")||laneDone))out("FAIL","N2 "+p.path+(oldShown?" names the old label \""+old+"\"":" does not name "+nw)+" (it names "+([...p.printed].join(" / ")||"nobody")+")");
    else out("INFO","N2 "+p.path+" prints title \""+p.title+"\": it waits for "+(pub?"the name-sync lane\x27s version 6 and a bake after it":"the publish that carries this round"));}}
// A1, A2
if(!LIVE)out("INFO","A1/A2 agency labels: wait for job-board .96");
else{
  const C=rowsOf("/tmp/vd_99zzz_cleared.json");
  if(C===null)out("FAIL","A1 the cleared boards\x27 list is unreadable: "+peek("/tmp/vd_99zzz_cleared.json"));
  else{const fl=C.filter((r)=>r.agency===true),toks=new Set(C.map((r)=>r.token));const flRead=fl.filter((r)=>readSince([r]));
    if(!C.length)out("INFO","A1 none of the cleared boards served a row, so the label is not judged");
    else if(!fl.length)out("PASS","A1 "+C.length+" row(s) on "+toks.size+" employers\x27 own boards carry agency false (Convergint and the other cleared boards)");
    else if(flRead.length||(ageH!==null&&ageH>24))out("FAIL","A1 "+fl.length+" row(s) on "+[...new Set(fl.map((r)=>r.token))].slice(0,4).join(", ")+" still carry the agency flag "+(flRead.length?"after this build read the board":"24 h after the first slice")+" (each visit re-stamps up to 1,000 rows)");
    else out("INFO","A1 "+fl.length+" row(s) still carry the agency flag; "+waitWhy(24));}
  const JT=rowsOf("/tmp/vd_99zzz_jobandtalent.json");
  if(JT===null)out("FAIL","A2 Jobandtalent\x27s list is unreadable: "+peek("/tmp/vd_99zzz_jobandtalent.json"));
  else{const un=JT.filter((r)=>r.agency!==true);const unRead=un.filter((r)=>readSince([r]));
    if(!JT.length)out("INFO","A2 Jobandtalent\x27s boards served no row, so the label is not judged");
    else if(!un.length)out("PASS","A2 "+JT.length+" row(s) on Jobandtalent\x27s boards carry agency true ("+[...new Set(JT.map((r)=>r.token))].join(", ")+")");
    else if(unRead.length||(ageH!==null&&ageH>24))out("FAIL","A2 "+un.length+" of "+JT.length+" Jobandtalent row(s) carry no agency flag "+(unRead.length?"after this build read the board":"24 h after the first slice"));
    else out("INFO","A2 "+un.length+" Jobandtalent row(s) carry no agency flag yet; "+waitWhy(24));}
}
// A3
{const C=new Set(JSON.parse(E.VDZ3_CLEARED));const mine=pages.filter((p)=>C.has(p.tok)&&p.kind==="company");
  if(!mine.length)out("INFO","A3 the sitemap lists no company page of a cleared board, so the agency variant is not judged");
  else for(const p of mine){const agencyPage=/Roles listed by|a staffing agency\x27s board/i.test(p.h);
    if(!p.baked)out("INFO","A3 "+p.path+" is not a baked page, so it is not judged");
    else if(!agencyPage)out("PASS","A3 "+p.path+" is an employer\x27s page (H1 \""+p.h1+"\")");
    else if(pub)out("FAIL","A3 "+p.path+" is still the agency variant (H1 \""+p.h1+"\") after the publish that carries this round");
    else out("INFO","A3 "+p.path+" is the agency variant until the publish after this branch (the bake reads the catalogue\x27s flag)");}}
// I1, I2, I3
if(!LIVE)out("INFO","I1/I2/I3 iCIMS scope: wait for job-board .96");
else{
  const OWN={"careers.delmarva.com":["careers-exeloncorp.icims.com"],"careers.comed.com":["careers-comed.icims.com"],"careers.baycenterfoods.com":["careers-chickfila.icims.com","canadacareers-chickfila.icims.com"],"careers.chick-fil-a.com":["careers-cfasupply.icims.com"],"careers.ynvgroup.com":["careers-ynvgroup.icims.com"],"careers.monifai.com":["careers-teknowledge.icims.com"]};
  const FEED={"careers.delmarva.com":"exelon","careers.comed.com":"exelon","careers.baycenterfoods.com":"cfa","careers.chick-fil-a.com":"cfa","careers.ynvgroup.com":"ynv","careers.monifai.com":"ynv"};
  const PORTALS={exelon:["careers-exeloncorp.icims.com","careers-comed.icims.com","careers-bge.icims.com","careers-delmarva.icims.com","careers-atlanticcityelectric.icims.com","careers-peco.icims.com","careers-pepco.icims.com"],cfa:["careers-chickfila.icims.com","canadacareers-chickfila.icims.com","careers-cfasupply.icims.com"],ynv:["careers-ynvgroup.icims.com","careers-teknowledge.icims.com"]};
  for(const t of Object.keys(OWN)){const rows=rowsOf("/tmp/vd_99zzz_icims_"+t+".json");
    if(rows===null){out("FAIL","I1 "+t+": the list is unreadable: "+peek("/tmp/vd_99zzz_icims_"+t+".json"));continue}
    const other=rows.filter((r)=>PORTALS[FEED[t]].includes(host(r.applyUrl))&&!OWN[t].includes(host(r.applyUrl)));
    if(!rows.length)out("INFO","I1 "+t+" served no row, so its scope is not judged");
    else if(!other.length)out("PASS","I1 "+t+" serves "+rows.length+" row(s), none on another portal of its feed");
    else if(due(rows,48))out("FAIL","I1 "+t+" serves "+other.length+" of "+rows.length+" row(s) on another portal of its feed ("+[...new Set(other.map((r)=>host(r.applyUrl)))].join(", ")+") (migration 20261026110000, after .96 serves, moves them; re-run it if it ran early)");
    else out("INFO","I1 "+t+": "+other.length+" of "+rows.length+" row(s) on another portal; "+waitWhy(48));}
  const P=json("/tmp/vd_99zzz_pruned.json");
  if(!P||!Array.isArray(P.jobs))out("FAIL","I2 the duplicate hosts\x27 list is unreadable: "+peek("/tmp/vd_99zzz_pruned.json"));
  else{const un=new Set(Array.isArray(P.unknownCompanies)?P.unknownCompanies:[]);const carried=["careers.bpas.com","careers.keysight.com","careers.goldennugget.com","talent.lla.com"].filter((t)=>!un.has(t));
    if(carried.length)out("FAIL","I2 the serving catalogue still carries "+carried.join(", "));
    else if(!P.jobs.length)out("PASS","I2 the four duplicate hosts are not carried and serve no row");
    else if(ageH!==null&&ageH>24)out("FAIL","I2 the four duplicate hosts serve "+P.total+" row(s) 24 h after the first slice: the orphan prune has not exited them (status.orphanPruneBlocked?)");
    else out("INFO","I2 the four duplicate hosts are not carried; "+P.total+" stored row(s) wait for the orphan prune at a pass end");}
  const BR=json("/tmp/vd_99zzz_brands.json");
  if(!BR||!Array.isArray(BR.jobs))out("FAIL","I3 the Exelon brand boards\x27 list is unreadable: "+peek("/tmp/vd_99zzz_brands.json"));
  else{const un=Array.isArray(BR.unknownCompanies)?BR.unknownCompanies:[];const WANT={"careers.bge.com":"careers-bge.icims.com","careers.peco.com":"careers-peco.icims.com","careers.pepco.com":"careers-pepco.icims.com","careers.atlanticcityelectric.com":"careers-atlanticcityelectric.icims.com"};
    const off=BR.jobs.filter((r)=>WANT[r.token]&&host(r.applyUrl)!==WANT[r.token]);const serving=new Set(BR.jobs.map((r)=>r.token));
    if(un.length)out("FAIL","I3 the serving catalogue does not carry "+un.join(", "));
    else if(off.length)out("FAIL","I3 "+off.length+" brand-board row(s) apply off their own portal ("+off.slice(0,3).map((r)=>r.token+" -> "+host(r.applyUrl)).join("; ")+")");
    else if(serving.has("careers.bge.com"))out("PASS","I3 the four Exelon brand boards are carried; "+serving.size+" serve rows, each on its own portal ("+BR.total+" in all)");
    else if(ageH!==null&&ageH>12)out("FAIL","I3 Baltimore Gas and Electric Company (10 open on 2026-10-26) serves no row "+ageH.toFixed(1)+" h after the first slice (a new board is first read 2-3 h after the deploy)");
    else out("INFO","I3 the four Exelon brand boards are carried; "+serving.size+" serve rows so far (first visit 2-3 h after the deploy; FAIL after 12 h)");}
}
// O1
if(!LIVE)out("INFO","O1 the Oracle pool sites: wait for job-board .96");
else{const tot=(t)=>{const j=json("/tmp/vd_99zzz_oracle_"+t+".json");return j&&typeof j.total==="number"?j.total:null};
  const all=tot("eexs~us2~CX_3001"),comm=tot("eexs~us2~CX_10013"),def=tot("erhk~us2~CX_1001"),rl=tot("erhk~us2~CX_1");
  if([all,comm,def,rl].some((x)=>x===null))out("FAIL","O1 an Oracle list is unreadable (All "+all+", Sedgebrook "+comm+", Default "+def+", R+L Carriers "+rl+")");
  else{const ok=all<=30&&comm>0&&def===0&&rl>0;const msg="LCS \"All\" serves "+all+" (592 on 2026-10-26; want 30 or fewer), Sedgebrook "+comm+" (want more than 0), R+L \"Default\" "+def+" (want 0), R+L Carriers "+rl+" (want more than 0)";
    if(ok)out("PASS","O1 "+msg);else if(ageH!==null&&ageH>72)out("FAIL","O1 "+msg+", 72 h after the first slice: every community site has been visited since");else out("INFO","O1 "+msg+": each site moves its requisitions on its next visit ("+(ours?"first slice "+ageH.toFixed(1)+" h ago; FAIL after 72 h":"no slice of this build yet")+")");}}
// C1
if(!LIVE)out("INFO","C1/C2 countries: wait for job-board .96");
else{const FIX=[["lakewales",/Lake Wales,?\s*FL\b|\bFL\s*-\s*Lake Wales|Lake Wales FL\b/i,"Lake Wales, FL"],["greece",/Greece,?\s*NY\b|\bNY\s*-\s*Greece\b|Greece NY\b/i,"Greece, NY"],["peru",/^(?:IN|IL)\s*-\s*Peru$|Peru,\s*(?:IN|IL)\b/,"Peru, IN/IL"]];
  for(const [k,re,label] of FIX){const rows=rowsOf("/tmp/vd_99zzz_"+k+".json");
    if(rows===null){out("FAIL","C1 the "+label+" list is unreadable: "+peek("/tmp/vd_99zzz_"+k+".json"));continue}
    const hit=rows.filter((r)=>re.test(String(r.location||"")));const wrong=hit.filter((r)=>r.country!=="US");const wrongRead=wrong.filter((r)=>readSince([r]));
    if(!hit.length)out("INFO","C1 no "+label+" row is served, so nothing to judge");
    else if(!wrong.length)out("PASS","C1 "+hit.length+" "+label+" row(s), all filed US");
    else if(wrongRead.length||(ageH!==null&&ageH>24))out("FAIL","C1 "+wrong.length+" of "+hit.length+" "+label+" row(s) still filed "+[...new Set(wrong.map((r)=>r.country||"(none)"))].join("/")+" ("+wrong.slice(0,2).map((r)=>JSON.stringify(r.location)).join(", ")+")"+(wrongRead.length?" after this build read the board":" 24 h after the first slice"));
    else out("INFO","C1 "+wrong.length+" of "+hit.length+" "+label+" row(s) still filed otherwise; "+waitWhy(24));}
  const CD=rowsOf("/tmp/vd_99zzz_cardiff.json");const cw=(CD||[]).filter((r)=>/Cardiff,?\s*Wales/i.test(String(r.location||"")));
  if(CD===null)out("FAIL","C1 the Cardiff list is unreadable: "+peek("/tmp/vd_99zzz_cardiff.json"));
  else if(!cw.length)out("INFO","C1 control: no \"Cardiff, Wales\" row is served, so the control is not judged");
  else{const notGb=cw.filter((r)=>r.country!=="GB");out(notGb.length?"FAIL":"PASS","C1 control: "+(cw.length-notGb.length)+" of "+cw.length+" \"Cardiff, Wales\" row(s) filed GB"+(notGb.length?" (the rule must leave Wales a country: "+notGb.slice(0,2).map((r)=>r.country).join("/")+")":""));}
  // C2
  for(const [k,label,h] of [["cvs","CVS Health R1075322 (\"NY - Greece\")",24],["bjs","BJ\x27s R255468 (\"Greece, NY #0185\")",24],["kohls","Kohl\x27s R504030 (\"Lake Wales (1250)\", placed by migration 20261026110000)",48]]){
    const d=json("/tmp/vd_99zzz_d_"+k+".json");const j=d&&d.job;
    if(!d)out("FAIL","C2 "+label+": the detail is unreadable: "+peek("/tmp/vd_99zzz_d_"+k+".json"));
    else if(!j||d.gone)out("INFO","C2 "+label+" is no longer served (closed), so it is not judged");
    else if(j.country==="US")out("PASS","C2 "+label+" is filed US");
    else if((j.recheckedAt&&readSince([j])&&k!=="kohls")||(ageH!==null&&ageH>h))out("FAIL","C2 "+label+" is filed "+(j.country||"(none)")+(k==="kohls"?" "+h+" h after the first slice: apply migration 20261026110000":" after this build read it"));
    else out("INFO","C2 "+label+" is filed "+(j.country||"(none)")+"; "+waitWhy(h));}
}
' 2>&1 || echo "FAIL  99zzz judge threw (see the lines above)"
