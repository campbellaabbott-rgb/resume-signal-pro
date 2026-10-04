# job-board .88 -- an anonymous caller cannot steer the ingest, forge the
# incident record, or pull more than a page (docs/job-board-deploy-notes.md,
# 2026-09-09.88). Sourced by scripts/verify-deploy.sh. Read-only: status, a
# preflight, and list reads (list logs one search event, as every list probe
# in this script does). Never verify, report, click, audit or vendor-health:
# those write or fetch from employers, and their refusals are proven in
# src/test/an-anonymous-caller-cannot-steer-the-ingest-or-pull-more-than-a-page.test.ts.
echo "== 88. job-board abuse guards (.88) =="
J '{"action":"status"}' > /tmp/vd_88_status.json
curl -s -m 30 -o /dev/null -D /tmp/vd_88_preflight.txt -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
VD88=$(node -e 'try{const v=String(JSON.parse(require("fs").readFileSync("/tmp/vd_88_status.json","utf8")).version||"");const m=/^2026-09-09\.(\d+)$/.exec(v);console.log(m&&Number(m[1])>=88?"yes":"no")}catch{console.log("no")}')
if [ "$VD88" = "yes" ]; then
  # A BROWSER-SHAPED read, ON PURPOSE (as 7j makes one): the page's ceiling is
  # what is being proven. 'browser' is no tooling kind -- only build and probe
  # are -- so the board counts this one read as kind address, like a person.
  curl -s -m 60 -o /tmp/vd_88_browser.json -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "x-rb-budget: browser" \
    -H "Content-Type: application/json" -H "Origin: https://resumebooster.work" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -d '{"action":"list","limit":1000,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_88_browser_code.txt
  # Our tooling's ceiling: 200 a call.
  J '{"action":"list","limit":200,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_88_probe.json
  # Only on .88: before it, this exact request was the forgery (defect-sweep 2.24).
  J '{"action":"list","companies":["\"dominos\""],"limit":1,"groupSimilar":false,"includeFacets":false}' > /tmp/vd_88_quoted.json
else
  : > /tmp/vd_88_browser.json; : > /tmp/vd_88_probe.json; : > /tmp/vd_88_quoted.json; echo "" > /tmp/vd_88_browser_code.txt
fi
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};const js=(f)=>{try{return JSON.parse(rd(f))}catch{return null}};
const st=js("/tmp/vd_88_status.json")||{};
const n=/^2026-09-09\.(\d+)$/.exec(String(st.version));const v88=!!n&&Number(n[1])>=88;
ok(v88,"status.version = "+st.version+" (want 2026-09-09.88 or later; .87 = the bundle did not deploy, and none of the lines below can pass)");
const fb=(/^x-fn-build:\s*(\S+)/im.exec(rd("/tmp/vd_88_preflight.txt"))||[])[1]||"";
ok(/^job-board\.2026-09-09\.(\d+)$/.test(fb)&&Number(fb.split(".").pop())>=88,"the preflight names the build: x-fn-build = "+(fb||"absent")+" (want job-board.2026-09-09.88 or later)");
const dl=st.demandLane;
ok(!!dl&&dl.perSlice===1&&dl.perHour===12&&dl.cooldownMin===180,"status.demandLane rules = "+JSON.stringify(dl&&{perSlice:dl.perSlice,perHour:dl.perHour,cooldownMin:dl.cooldownMin})+" (want one board a slice, twelve an hour, 180 min cooldown; absent = .88 not serving)");
if(dl){ok(typeof dl.servedLastHour==="number"&&dl.servedLastHour<=12,"demand boards served in the last hour = "+dl.servedLastHour+" (at most 12; more = a second writer of the demand row)");info("demand lane: "+dl.queued+" queued, "+dl.cooling+" cooling");}
const fc=st.filterContract||{};
ok(!!fc.incidents&&typeof fc.incidents==="object"&&!Array.isArray(fc.incidents),"status.filterContract.incidents is a per-field map: "+JSON.stringify(fc.incidents||null).slice(0,160)+" (absent = .88 not serving)");
if(fc.incidents)info("filter-integrity incidents by field: "+(Object.keys(fc.incidents).map((f)=>f+" "+fc.incidents[f].ageMin+"m ago").join(", ")||"none since .88")+" (the legacy single row is no longer read)");
if(v88){
  const code=rd("/tmp/vd_88_browser_code.txt").trim();const br=js("/tmp/vd_88_browser.json")||{};
  if(code==="429")info("browser-shaped list refused 429 code "+br.code+" (requirePass or a block covers this machine): the ceiling could not be read from here");
  else{const rows=Array.isArray(br.jobs)?br.jobs.length:-1;ok(rows>0&&rows<=60,"a browser asking list for 1000 rows gets "+rows+" (want 1..60, the page size; 200 = the cap is not applied)");}
  const pr=js("/tmp/vd_88_probe.json")||{};const prows=Array.isArray(pr.jobs)?pr.jobs.length:-1;
  if(prows>=0&&prows<=60&&pr.hasMore===false)info("tooling read returned "+prows+" rows with nothing more to read: cannot show the 200 ceiling");
  else ok(prows>60&&prows<=200,"our tooling header still reads up to 200 a call: got "+prows+" (want 61..200; 60 = the bake would need 3x the calls)");
  const q=js("/tmp/vd_88_quoted.json")||{};
  ok(Array.isArray(q.ignoredFilters)&&q.ignoredFilters.includes("companies"),"a quoted company token is refused and named: ignoredFilters = "+JSON.stringify(q.ignoredFilters||null)+" (want it to include companies)");
  ok(!q.filterIntegrity,"and it trips no filter-integrity incident (filterIntegrity = "+JSON.stringify(q.filterIntegrity||null)+")");
}'
