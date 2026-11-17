# shellcheck shell=bash
# ── 99zzzzzzz-bugs-ops-alerts-b. THE BUG ROUND OF 2026-11-08, PART B, LANE
# ops-alerts-b (branch bugs/b-ops-alerts): the owner's dashboards and the
# board's outside alarm. Two functions at 2026-11-13.1 (the integrator's
# stamp): get-error-telemetry (S14X-157 exact range counts and a truncated
# flag) and get-analytics (S14X-189 milestones in time order, S14X-190 days
# in the zone the page sends). One migration (S14X-156: the geo and AI
# generation readers count the failures scans write and the Full Analyses
# they never saw). Three owner pages, published by the merge (S14X-156,
# S14X-157, S14X-189, S14X-190, S14X-191, CW2-HB1), and the board-health
# workflow, live on GitHub from the merge (S14X-243).
#
# THE STAGES, read from production, never assumed:
#   functions  each serves 2026-11-13.1 or later: the paste is live. Until
#              then an older build is INFO; no build header is a FAIL.
#   frontend   the published /health-check, /errors or /analytics chunk
#              carries any of this lane's marks below: the merge published.
#              Until then every mark is INFO; from then on a missing mark is
#              a FAIL.
#   workflow   the latest scheduled board-health run used a board-health.yml
#              that calls get_takedowns_today: the lane merged. Until then
#              INFO.
# No line waits on an owner: CW2-HO1, the one owner-gated key, is on
# bugs/b-ops-alerts-owner and has no line here.
#
# THE CLAIMS, one line each:
#   B1  get-error-telemetry serves 2026-11-13.1 or later.
#   B2  get-analytics serves 2026-11-13.1 or later.
#   M1  get_geo_latency_stats and get_ai_generation_metrics_hourly stay
#       closed to anon (the shared probe: 42501 is the PASS). The new bodies
#       are not readable from outside: the-health-page-counts-the-failures-
#       scans-write runs them on pglite, and the migration raises unless its
#       predicates landed.
#   F1  S14X-156: the /health-check chunk prints no "100.0" (three trend
#       cards printed it for an empty or failed read).
#   F2  S14X-157: the /errors chunk says when it shows a sample ("Showing the
#       newest ") and no card is labelled "Last 24 hours" whatever the range.
#   F3  CW2-HB1: /health-check and /errors each reach a visibilitychange
#       listener (in the chunk, or the use-visible-interval chunk it imports).
#   F4  S14X-189: the /analytics chunk says its funnel counts are events.
#   F5  S14X-190: the /analytics chunk names the zone its days are in.
#   F6  S14X-191: the /analytics chunk counts visitors who allowed analytics,
#       and no longer says an empty range proves nobody arrived.
#   C1  the three closure readings board-health now judges are inside its
#       bars on production: the last lap proof within 24 h, the closure
#       population within 3 h, a takedown in the last 24 h. Read the way the
#       workflow reads them; a FAIL here is the alarm that would ring.
#   G1  S14X-243: the latest scheduled board-health run on a file with the
#       closure checks printed "laps last proven" and "takedowns in 24 h", or
#       raised on them. Needs gh signed in; without it, INFO.
#
# READ-ONLY. Two OPTIONS preflights, two anon GET probes, GETs of the site and
# four chunks, one job-board status read with x-rb-budget: probe, one anon GET
# of get_takedowns_today, and gh run list, run view --log and one api GET.
# Nothing is posted to any writer, mailed or written.
echo "== 99zzzzzzz. bug round part B, ops-alerts-b: two builds, two closed readers, the owner pages, the closure readings, the alarm run =="

rm -f /tmp/vd_bob_opt_*.txt /tmp/vd_bob_*.js /tmp/vd_bob_status.json /tmp/vd_bob_takedowns.json /tmp/vd_bob_bh.json /tmp/vd_bob_bh.log /tmp/vd_bob_bh_wf.txt

# B1, B2.
VDBOB_N=0
for VDBOB_SPEC in "get-error-telemetry:exact range counts and a truncated flag beside its newest 1,000 rows (S14X-157)" \
                  "get-analytics:time milestones in the order a visitor reaches them, days in the zone the page sends (S14X-189, S14X-190)"; do
  VDBOB_N=$((VDBOB_N + 1))
  VDBOB_FN=${VDBOB_SPEC%%:*}; VDBOB_WHAT=${VDBOB_SPEC#*:}
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDBOB_FN" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" | tr -d '\r' > "/tmp/vd_bob_opt_$VDBOB_FN.txt"
  VDBOB_H=$(grep -i '^x-fn-build:' "/tmp/vd_bob_opt_$VDBOB_FN.txt" | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VDBOB_H" ]; then echo "FAIL  B$VDBOB_N $VDBOB_FN preflight carries no x-fn-build (want $VDBOB_FN.2026-11-13.1 or later): the function is not deployed, or its preflight does not answer"
  elif build_ge "$VDBOB_FN" "$VDBOB_H" 2026-11-13 1; then echo "PASS  B$VDBOB_N $VDBOB_FN x-fn-build = $VDBOB_H (2026-11-13.1 or later: $VDBOB_WHAT)"
  else echo "INFO  B$VDBOB_N $VDBOB_FN x-fn-build = $VDBOB_H: the part-B paste with 2026-11-13.1 has not landed (section 49 lists the gap)"; fi
done

# M1.
probe get_geo_latency_stats '{"p_hours_back":1}'
probe get_ai_generation_metrics_hourly '{"p_hours_back":1}'

# F1-F6. The entry names each lazy page chunk; a page that imports the
# visible-interval chunk has it fetched beside it.
VDBOB_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
[ -n "$VDBOB_MAIN" ] && curl -s -m 30 "$SITE$VDBOB_MAIN" -o /tmp/vd_bob_entry.js
for VDBOB_PAGE in HealthCheck ErrorDashboard AnalyticsDashboard; do
  VDBOB_C=$(grep -oE "(\./|assets/)$VDBOB_PAGE-[A-Za-z0-9_-]+\.js" /tmp/vd_bob_entry.js 2>/dev/null | head -1 | sed -E 's#^(\./|assets/)##')
  [ -n "$VDBOB_C" ] && curl -s -m 30 "$SITE/assets/$VDBOB_C" -o "/tmp/vd_bob_$VDBOB_PAGE.js"
  : > "/tmp/vd_bob_${VDBOB_PAGE}_deps.js"
  for VDBOB_D in $(grep -oE 'use-visible-interval-[A-Za-z0-9_-]+\.js' "/tmp/vd_bob_$VDBOB_PAGE.js" 2>/dev/null | sort -u); do
    curl -s -m 30 "$SITE/assets/$VDBOB_D" >> "/tmp/vd_bob_${VDBOB_PAGE}_deps.js"
  done
done
VDBOB_MAIN=$VDBOB_MAIN node -e '
const fs=require("fs");
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const hc=rd("/tmp/vd_bob_HealthCheck.js"),ed=rd("/tmp/vd_bob_ErrorDashboard.js"),ad=rd("/tmp/vd_bob_AnalyticsDashboard.js");
const hcd=rd("/tmp/vd_bob_HealthCheck_deps.js"),edd=rd("/tmp/vd_bob_ErrorDashboard_deps.js");
const gone=[["HealthCheck",hc],["ErrorDashboard",ed],["AnalyticsDashboard",ad]].filter(([,s])=>!s).map(([n])=>n);
if(gone.length){console.log("FAIL  F1 the served entry ("+(process.env.VDBOB_MAIN||"none found")+") names no chunk for "+gone.join(", ")+", or it did not load: the frontend is not serving, or the bundle layout moved, so the owner pages cannot be judged");process.exit(0)}
const sampleNote=ed.includes("Showing the newest ");
const listens=(a,b)=>(a+b).includes("visibilitychange");
const marks={sampleNote,events:ad.includes("Counts are events"),consent:ad.includes("allowed analytics"),zone:ad.includes("days in "),visible:listens(hc,hcd)||listens(ed,edd)};
const published=Object.values(marks).some(Boolean);
const line=(id,ok,pass,fail,today)=>console.log(published?(ok?"PASS  "+id+" "+pass:"FAIL  "+id+" "+fail):"INFO  "+id+" the lane publish has not landed (no mark of it in the three page chunks); once it has, the claim is that "+pass+"; today: "+today);
const n100=(hc.match(/"100\.0"/g)||[]).length;
line("F1 (S14X-156)",n100===0,"the /health-check chunk prints no 100.0 for an empty or failed trend card","the /health-check chunk still carries \"100.0\" "+n100+" time(s): a trend card prints a perfect rate for a read that failed or found nothing",n100+" \"100.0\" literal(s)");
const old24=ed.includes("\"Last 24 hours\"");
line("F2 (S14X-157)",sampleNote&&!old24,"the /errors chunk says when it shows a sample and labels its total with the range picked","the /errors chunk "+(!sampleNote?"never says it shows a sample of the range":"still labels a card Last 24 hours whatever the range"),(old24?"a card says Last 24 hours":"no fixed label")+", "+(sampleNote?"a sample note":"no sample note"));
const hcv=listens(hc,hcd),edv=listens(ed,edd);
line("F3 (CW2-HB1)",hcv&&edv,"/health-check and /errors each stop polling in a hidden tab (a visibilitychange listener)","no visibilitychange listener reaches "+[hcv?"":"/health-check",edv?"":"/errors"].filter(Boolean).join(" or ")+": a hidden tab keeps polling",(hcv||edv?"a listener":"no listener"));
line("F4 (S14X-189)",marks.events,"the /analytics funnels say their counts are events, not people","the /analytics chunk never says its funnel counts are events: they read as users",marks.events?"the events note":"no events note");
line("F5 (S14X-190)",marks.zone,"the /analytics chunk names the zone its days are in","the /analytics chunk names no zone for its days",marks.zone?"a zone":"no zone");
const oldEmpty=ad.includes("the pipeline is verified working");
line("F6 (S14X-191)",marks.consent&&!oldEmpty,"the /analytics Audience card counts visitors who allowed analytics and no longer calls an empty range proof that nobody came","the /analytics chunk "+(!marks.consent?"never says its visitors are those who allowed analytics":"still says an empty range proves nobody arrived"),(oldEmpty?"the empty range is called proof":"no proof claim")+", "+(marks.consent?"the consent label":"no consent label"));
'

# C1. The status read is the board probe the workflow sends; the count is a GET.
J '{"action":"status"}' > /tmp/vd_bob_status.json
curl -s -m 30 "$B/rest/v1/rpc/get_takedowns_today" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_bob_takedowns.json
node -e '
const fs=require("fs");
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return undefined}};
const st=rd("/tmp/vd_bob_status.json"),td=rd("/tmp/vd_bob_takedowns.json");
const age=(iso)=>{const t=typeof iso==="string"?Date.parse(iso):NaN;return Number.isFinite(t)?Math.floor((Date.now()-t)/60000):null};
const lap=age(st&&st.deepCursor&&st.deepCursor.laps?st.deepCursor.laps.lastProvenAt:null);
const pop=age(st&&st.closurePopulation?st.closurePopulation.as_of:null);
const n=typeof td==="number"?Math.floor(td):null;
const bad=[];
if(lap===null)bad.push("no last lap proof in the status answer");else if(lap>1440)bad.push("the last lap proof is "+lap+" min old (bar 1440)");
if(pop===null)bad.push("no closure population as_of in the status answer");else if(pop>180)bad.push("the closure population is "+pop+" min old (bar 180)");
if(n===null)bad.push("get_takedowns_today answered no count ("+JSON.stringify(td===undefined?"non-JSON":td).slice(0,120)+")");else if(n===0)bad.push("no takedown in the last 24 hours");
if(bad.length)console.log("FAIL  C1 the closure readings board-health judges are outside its bars: "+bad.join("; ")+". Once the lane merges, the alarm opens its issue on this");
else console.log("PASS  C1 the closure readings board-health judges are inside its bars: laps last proven "+lap+" min ago (bar 1440), closure population "+pop+" min old (bar 180), takedowns in 24 h = "+n);
'

# G1.
if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  echo "INFO  G1 (S14X-243) gh is not installed or not signed in: the latest scheduled board-health run is not read"
else
  gh run list --workflow board-health.yml --event schedule --limit 1 --json databaseId,createdAt,conclusion,headSha > /tmp/vd_bob_bh.json 2>/dev/null
  VDBOB_RUN=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync("/tmp/vd_bob_bh.json","utf8"))[0]||{};process.stdout.write(String(r.databaseId||"")+" "+String(r.headSha||""))}catch{}')
  VDBOB_ID=${VDBOB_RUN%% *}; VDBOB_SHA=${VDBOB_RUN#* }
  case "$VDBOB_ID$VDBOB_SHA" in *[!0-9a-f]*) VDBOB_ID=""; VDBOB_SHA="";; esac
  if [ -n "$VDBOB_ID" ] && [ -n "$VDBOB_SHA" ]; then
    gh run view "$VDBOB_ID" --log > /tmp/vd_bob_bh.log 2>/dev/null
    gh api -H "Accept: application/vnd.github.raw" "repos/{owner}/{repo}/contents/.github/workflows/board-health.yml?ref=$VDBOB_SHA" > /tmp/vd_bob_bh_wf.txt 2>/dev/null
  fi
  node -e '
const fs=require("fs");
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
let run=null;try{run=JSON.parse(rd("/tmp/vd_bob_bh.json"))[0]||null}catch{}
if(!run||!run.databaseId){console.log("INFO  G1 (S14X-243) GitHub lists no scheduled board-health run (section 78 judges the schedule)");process.exit(0)}
const at="run "+run.databaseId+" at "+run.createdAt+" ("+run.conclusion+")";
const wf=rd("/tmp/vd_bob_bh_wf.txt"),log=rd("/tmp/vd_bob_bh.log");
if(!wf){console.log("INFO  G1 (S14X-243) the board-health.yml of the latest scheduled "+at+" could not be read, so its closure checks cannot be judged");process.exit(0)}
if(!wf.includes("get_takedowns_today")){console.log("INFO  G1 (S14X-243) the latest scheduled "+at+" ran a board-health.yml without the closure checks: the lane has not merged, or no scheduled run has fired since");process.exit(0)}
if(!log){console.log("INFO  G1 (S14X-243) the log of the latest scheduled "+at+" could not be read");process.exit(0)}
const raised=log.split("\n").find((l)=>/::error/.test(l)&&/lap proof|closure population|takedown/.test(l));
if(/laps last proven -?\d+ min ago/.test(log)&&/takedowns in 24 h = \d+/.test(log)){const m=/laps last proven -?\d+ min ago.*takedowns in 24 h = \d+/.exec(log);console.log("PASS  G1 (S14X-243) the latest scheduled "+at+" judged the closures and printed: "+(m?m[0]:"both lines"))}
else if(raised)console.log("FAIL  G1 (S14X-243) the latest scheduled "+at+" raised the alarm on the closures: "+raised.replace(/^.*::error[^:]*::/,"").slice(0,300));
else if(run.conclusion!=="success")console.log("INFO  G1 (S14X-243) the latest scheduled "+at+" failed on something other than the closures, so it printed no healthy line; section 78 and the board-health issue carry it");
else console.log("FAIL  G1 (S14X-243) the latest scheduled "+at+" ran the closure checks but printed neither the laps and takedowns line nor a closure failure: the probe does not read them");
'
fi
