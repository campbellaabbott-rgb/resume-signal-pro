# job-board .89 -- the ingest reads what the employers publish
# (docs/job-board-deploy-notes.md, 2026-09-09.89). Sourced by
# scripts/verify-deploy.sh. Read-only: status, a preflight, list and exists
# reads with x-rb-budget: probe (list logs one search event, as every list
# probe here does), anon SELECTs on job_board_verifications, and the vendors'
# own public list feeds. Never verify, report, click or a refresh.
#
# Judge the served counts only after one full cold rotation on .89 (a lap of a
# 2,000-posting Workday board is eight visits; the deep lane takes two a slice).
echo "== 89. job-board ingest (.89): mid-feed Workday zeros, re-dated ids, USAJOBS, light per board, iCIMS page size =="
J '{"action":"status"}' > /tmp/vd_89_status.json
curl -s -m 30 -o /dev/null -D /tmp/vd_89_preflight.txt -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
# Workday verification stamps (anon-readable). 366 read feed_total 0 on 2026-10-05.
for OFF in 0 1000 2000 3000 4000; do
  curl -s -m 60 "$B/rest/v1/job_board_verifications?select=company_token,feed_total&company_token=like.*~wd*&order=company_token&limit=1000&offset=$OFF" \
    -H "apikey: $K" -H "Authorization: Bearer $K" -o "/tmp/vd_89_wd_$OFF.json"
done
# Served counts for the boards each fix names.
for VT in workday:adobe~wd5~external_experienced workday:novartis~wd3~Novartis_Careers workday:pg~wd5~1000 workday:td~wd3~TD_Bank_Careers workday:tmobile~wd1~External \
          usajobs:usajobs greenhouse:lush greenhouse:samsara greenhouse:pulse icims:jobs.zs.com icims:jobs.qxo.com icims:careers.ringpower.com; do
  V=${VT%%:*}; T=${VT#*:}
  printf '%s\t%s\t' "$V" "$T"
  J "{\"action\":\"list\",\"companies\":[\"$T\"],\"vendors\":[\"$V\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":1}" | tr -d '\n'
  echo
done > /tmp/vd_89_served.tsv
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};const js=(s)=>{try{return JSON.parse(s)}catch{return null}};
const st=js(rd("/tmp/vd_89_status.json"))||{};
const n=/^2026-09-09\.(\d+)$/.exec(String(st.version));const v89=!!n&&Number(n[1])>=89;
ok(v89,"status.version = "+st.version+" (want 2026-09-09.89 or later; .87/.88 = the bundle did not deploy, and the lines below describe the old one)");
const fb=(/^x-fn-build:\s*(\S+)/im.exec(rd("/tmp/vd_89_preflight.txt"))||[])[1]||"";
ok(/^job-board\.2026-09-09\.(\d+)$/.test(fb)&&Number(fb.split(".").pop())>=89,"the preflight names the build: x-fn-build = "+(fb||"absent")+" (want job-board.2026-09-09.89 or later)");
// L1-01: a mid-feed zero no longer lands on the stamp.
const stamps=[0,1000,2000,3000,4000].map((o)=>js(rd("/tmp/vd_89_wd_"+o+".json"))).filter(Array.isArray).flat();
const zero=stamps.filter((x)=>x.feed_total===0).length;
if(stamps.length<3000)info("Workday stamps unreadable or short ("+stamps.length+" rows) -- the stamp line cannot be judged");
else (zero<150?ok:(c,m)=>console.log((v89?"FAIL":"INFO")+"  "+m))(zero<150,"Workday verification stamps reading feed_total 0: "+zero+" of "+stamps.length+" (366 on 2026-10-05; under .89 a mid-feed visit writes the lap t0 or keeps the last stated total, so only empty boards read 0, about 44 measured -- want under 150 after one rotation)");
const laps=(st.deepCursor||{}).laps||{};
info("deepCursor.laps: tracking "+laps.tracking+", proven "+laps.proven+" (608 / 400 on 2026-10-05; the 540 mid-feed-zero Workday boards keep their lap entries under .89, so tracking should rise)");
// Served counts.
const rows=rd("/tmp/vd_89_served.tsv").split("\n").filter(Boolean).map((l)=>{const [v,t,...j]=l.split("\t");return {v,t,j:js(j.join("\t"))}});
const served=(v,t)=>{const r=rows.find((x)=>x.v===v&&x.t===t);return r&&r.j&&typeof r.j.total==="number"?r.j.total:null};
const was={"adobe~wd5~external_experienced":[0,518],"novartis~wd3~Novartis_Careers":[0,491],"pg~wd5~1000":[0,475],"td~wd3~TD_Bank_Careers":[248,1250],"tmobile~wd1~External":[255,1502]};
for(const [t,[b,w]] of Object.entries(was)){const s=served("workday",t);
  if(s===null){info("workday:"+t+" list unreadable");continue}
  const want=Math.round(w*0.5);
  console.log((s>=want?"PASS":(v89?"FAIL":"INFO"))+"  workday:"+t+" serves "+s+" (was "+b+" on 2026-10-05; "+w+" in-window on its own feed then; want at least "+want+" after one rotation on .89)");}
const us=served("usajobs","usajobs");
const ov=(st.oversizeBoards||[]).map((o)=>o.token);
console.log(((us??0)>0?"PASS":(v89?"FAIL":"INFO"))+"  usajobs serves "+us+" (0 since it joined: every 500-row page was over the 4 MB bound; pages of 100 under .89)");
console.log((!ov.includes("usajobs")?"PASS":(v89?"FAIL":"INFO"))+"  usajobs is "+(ov.includes("usajobs")?"STILL":"no longer")+" in status.oversizeBoards");
const usCur=((st.deepCursor||{}).top||[]);const usc=Array.isArray(usCur)?usCur.find((x)=>x&&(x.token==="usajobs"||x[0]==="usajobs")):null;
info("usajobs deep cursor: "+JSON.stringify(usc||null)+" (advances by ~300 a visit and wraps at the feed end or at 10,000, the API result cap; it must never sit still while usajobs fails)");
for(const t of ["lush","samsara"]){const s=served("greenhouse",t);
  console.log(((s??0)>0&&!ov.includes(t)?"PASS":(v89?"FAIL":"INFO"))+"  greenhouse:"+t+" serves "+s+(ov.includes(t)?", still oversize":"")+" (light mode is per board since .89; was refused for sharing its token)");}
// pulse enrols in light mode too, but its LIGHT list is 20.6 MB (2,703 jobs, ~7 KB of metadata each, measured 2026-10-05):
// still over the 4 MB bound, and greenhouse has no streamed reader (SLIM_SPECS), so it stays deferred. Not a .89 claim.
{const s=served("greenhouse","pulse");info("greenhouse:pulse serves "+s+(ov.includes("pulse")?", in oversizeBoards":"")+" (expected: still deferred -- its light list alone is 20.6 MB; needs a greenhouse streamed reader)");}
for(const t of ["jobs.zs.com","jobs.qxo.com","careers.ringpower.com"]){const s=served("icims",t);
  console.log(((s??0)>0&&!ov.includes(t)?"PASS":(v89?"FAIL":"INFO"))+"  icims:"+t+" serves "+s+(ov.includes(t)?", still oversize":"")+" (page 1 over 4 MB at 100 rows; retried at 50/25 since .89)");}
const top=((st.deepCursor||{}).top||[]);const dom=Array.isArray(top)?top.find((x)=>x&&(x.token==="dominos"||x[0]==="dominos")):null;
info("smartrecruiters dominos deep cursor: "+JSON.stringify(dom||null)+" (since .89 a visit advances it by 250, not 2,000)");
info("dormantBoards = "+st.dormantBoards+" (496 on 2026-10-05; the boards of a shared token are tracked apart since .89, so a dead twin can now reach dormancy)");
'
# L1-02, from open PR #5's 7i: every in-window id on the vendor's own feed has a row.
# Published before the board's last read (recheckedAt) less an hour and still
# missing = the read saw it and stored nothing (the tombstone refused a re-dated id).
for VT in ashby:openai ashby:snowflake greenhouse:anthropic greenhouse:databricks lever:palantir; do
  V=${VT%%:*}; T=${VT#*:}
  case "$V" in
    greenhouse) U="https://boards-api.greenhouse.io/v1/boards/$T/jobs";;
    ashby) U="https://api.ashbyhq.com/posting-api/job-board/$T";;
    lever) U="https://api.lever.co/v0/postings/$T?mode=json";;
  esac
  curl -s --compressed -m 120 "$U" -o /tmp/vd_89_feed.json
  J "{\"action\":\"list\",\"companies\":[\"$T\"],\"vendors\":[\"$V\"],\"groupSimilar\":false,\"includeFacets\":false,\"limit\":1}" > /tmp/vd_89_list.json
  node -e '(async()=>{
const fs=require("fs");const [V,T,B,K]=process.argv.slice(1);const cut=Date.now()-30*86400000;
let feed;try{feed=JSON.parse(fs.readFileSync("/tmp/vd_89_feed.json","utf8"))}catch{return console.log("INFO  "+V+":"+T+" vendor feed unreadable -- cannot judge")}
const ms=(x)=>typeof x==="number"?x:Date.parse(String(x??""));const t=(x)=>{const n=ms(x);return Number.isFinite(n)&&n>=cut};
const inWin=V==="greenhouse"?(feed.jobs||[]).filter(x=>t(x.first_published)&&x.absolute_url).map(x=>({id:"greenhouse:"+T+":"+x.id,at:ms(x.first_published)}))
  :V==="ashby"?(feed.jobs||[]).filter(x=>x.isListed!==false&&t(x.publishedAt)&&(x.jobUrl||x.applyUrl)).map(x=>({id:"ashby:"+T+":"+x.id,at:ms(x.publishedAt)}))
  :(Array.isArray(feed)?feed:[]).filter(x=>t(x.createdAt)&&(x.hostedUrl||x.applyUrl)).map(x=>({id:"lever:"+T+":"+x.id,at:ms(x.createdAt)}));
let l;try{l=JSON.parse(fs.readFileSync("/tmp/vd_89_list.json","utf8"))}catch{return console.log("INFO  "+V+":"+T+" list non-JSON")}
const open={};
for(let i=0;i<inWin.length;i+=200){
  let r;try{r=await (await fetch(B+"/functions/v1/job-board",{method:"POST",headers:{"Content-Type":"application/json","x-rb-budget":"probe",apikey:K,Authorization:"Bearer "+K},body:JSON.stringify({action:"exists",ids:inWin.slice(i,i+200).map(x=>x.id)})})).json()}catch{r=null}
  if(!r||!r.open)return console.log("INFO  "+V+":"+T+" exists unreadable -- missing ids not counted");
  Object.assign(open,r.open);
}
const missing=inWin.filter(x=>open[x.id]!==true);
const readAt=ms(((l.jobs||[])[0]||{}).recheckedAt);
if(!Number.isFinite(readAt)){console.log((missing.length?"INFO":"PASS")+"  "+V+":"+T+" missing in-window ids: "+missing.length+" of "+inWin.length+(missing.length?" (no recheckedAt on a served row: cannot tell refused from not yet read)":""));return}
const refused=missing.filter(x=>x.at<readAt-3600000),unread=missing.length-refused.length;
const ex=refused.sort((a,b)=>b.at-a.at).slice(0,5).map(x=>x.id.slice(x.id.lastIndexOf(":")+1,x.id.lastIndexOf(":")+9)+" "+new Date(x.at).toISOString().slice(0,10)).join(", ");
console.log((refused.length===0?"PASS":"FAIL")+"  "+V+":"+T+" in-window ids with no row: "+refused.length+" published over an hour before the last read ("+new Date(readAt).toISOString().slice(0,16)+"Z), "+unread+" since (not yet read)"+(refused.length?" -- e.g. "+ex+". Before .89: openai 7, snowflake 12-13 (re-dated ids refused at the aged-out tombstone); after one read on .89 a re-dated id walks back in, and one still listed here is missing for another reason":""));
})();' "$V" "$T" "$B" "$K"
done
