# shellcheck shell=bash
# ── 99zzzzzzz-board-102-core. JOB-BOARD .102, LANE 1: the core of index.ts
# (branch board/102-core; spec-102 lane 1). Oversize Recruitee, Pinpoint and
# Workable boards read through the stream or without details (D12, D7), one
# streamed read per slice (CAP-8), USAJOBS closing on its stated date (XR-1),
# no stored tomorrow (BB-10), a 429 deferred and never failed (BB-09), a stale
# chain stamp proves nothing (HB-1), a declined kick relabels no hop (UPK-3), no
# upkeep route (UPK-DROP), PERF-06, BR-04, BR-03, VF-BMS, S14X-063(b), S14X-121,
# the name sync v7, the oversize registry prune, the retired twins, and the
# cold wrap's length in status.
#
# Named 99zzzzzzz so it sorts after every 99zzzzzz- file in byte order and
# under a collating locale (verify-deploy.d/README.md).
#
# THE CLOCK. Every line is INFO until job-board's preflight answers
# job-board.2026-09-09.102 or later; before that no board read is made, and
# the only other line is the local tally (ROOM), which FAILs only when the
# checkout is over the upload cap (an over-cap upload leaves the old build
# serving). Times run from status.sliceStats.buildSince, and only when
# sliceStats.build is the build the preflight answers ("a slice of this build
# has run"). A per-board line is INFO until that board serves a row this
# build read: its recheckedAt (the board's verified_at, which a list row
# carries while the row is not missing) or its lastSeen (the insert time) is
# after buildSince; recheckedAt only off the capped-visit vendors, whose visit
# reads 250 postings, not the posting the row is. Lines that wait on a
# migration or a pass are INFO until it can have happened, then judged.
#
# THE CLAIMS, one tagged line each:
#   ROOM        the counted bytes (job-board/** + _shared/**) of HEAD are under
#               4,450,000 (VDBC_TALLY overrides the measurement).
#   build       the preflight answers x-fn-build .102 or later.
#   PERF-06     the preflight answers Access-Control-Max-Age 7200.
#   D12 registry  status.oversizeBoards: no key of a vendor .102 can read
#               (Lever, Ashby, Greenhouse, Recruitee and Pinpoint through the
#               stream; Workable outside the held three without details) read
#               oversize later than buildSince + 12 h. A Workable key marked
#               bare was read without details and stays registered on purpose;
#               a key marked wait (its at is its first refusal) FAILs once it
#               has waited 2 h for a cold slice's stream, from buildSince + 12 h.
#               lever:usasurveyjob is INFO: spec-102 sends the stream bound it
#               trips to W4. No
#               key the catalogue lacks (the catalogue is this checkout's
#               sources.ts through tsx; VDBC_CATALOG names a JSON file of keys
#               instead). The count is INFO.
#   D12/D7 <vendor>:<token>  countOnly is within 15% of the feed's own
#               in-window count (30 days; undated items count), read by one GET
#               of the feed after robots.txt allows it, at least
#               VDBC_HOST_GAP_S (1.1 s) between requests to one host.
#   D12 held <token>  the three held Workable boards serve no row while .102
#               serves (INFO on a later build: spec section 7 sends them to .103).
#   D12 Pinpoint dates  no trilongroup row carries a date stamped at insert.
#               The posted backfill dates Pinpoint rows from the posting page's
#               own datePosted, so a dated row is INFO, never FAIL by itself.
#   D7 descriptions  descCoverage workable at least 95% within 7 days.
#   CAP-8       no slice record of this build has streamed > 1 (either phase:
#               a hot board has no other read).
#   XR-1        passEnd.steps.sweep.statedClosed > 0 and usajobs closed_90d > 0
#               within 7 days. A row gains closes_at when .102's read reaches
#               it: inserted with one, or, stored, corrected through
#               apply_posting_corrections, unlogged (20261111100000 teaches it
#               the key). The read reaches at most 10,000 of ~18,500, so this
#               line proves closures happen, not that each is exact. No
#               usajobs.gov sampling.
#   BB-10       the newest 20 carry no postedAt later than now + 5 min. Judged
#               16:00-24:00Z (VDBC_HOUR overrides), from 24 h after buildSince
#               (a tomorrow stored by .101 is in the past by then).
#   BB-09       every slice record of this build carries rateLimited, and no
#               failure recorded between two reads names HTTP 429.
#   HB-1        no read answers chain_alive on a chain stamp older than
#               thresholdMs (60 s slack for the two clocks).
#   UPK-3       VDBC_READS status reads (10), VDBC_GAP_S apart (90). A hop that
#               drops to 0 is a restart when a read in the interval was stale,
#               the watchdog kicked inside it, or a pass ended; otherwise it is
#               a relabel when a later read shows the hop above the slices
#               counted since the 0 (the old chain's count came back).
#   UPK-DROP    no boardUpkeep key; dateCoverageSource rollup or unavailable;
#               a rollup no older than twice job-board-stats-rollup's cadence,
#               as get_cron_health reports it (never hard-coded).
#   BR-04       a list answer with hasMore false names nextOffset null.
#   BR-03       exists [a fake id, saved closed ids, an open id] answers
#               unknown = [the fake id]. Ids are saved locally in VDBC_STATE
#               (~/.config/resumebooster/verify-state/board-102-core.json), one
#               open id a run, dropped at 80 days (exits prune at 90). INFO
#               until a saved id reads closed.
#   VF-BMS      no Bristol Myers Squibb New Brunswick (US) row is paid in CAD,
#               24 h after buildSince (20261111110000 applies after the deploy).
#   S14X-063(b) a board a slice named in rawNoRows still serves rows.
#   S14X-121    a board a slice named in srPartial still serves rows (it reached
#               a later page, so page one held postings).
#   S14X-216, NEW-PAYREWRITE  INFO: their tests, build_ge and section 49.
#   Name sync   passEnd.steps.names reads "name sync v7 done" (or complete)
#               after buildSince, then the four boards serve their names.
#   Retired twins  once a serve step has finished after a read that saw the
#               orphan prune unblocked (stamped in VDBC_STATE), no row of the
#               eight retired source:token boards is served.
#   lastWrapMin status carries lastWrapMin and lastWrapAt.
#   Lap         the last wrap that began after buildSince is within 1.1 x the
#               longest of the last 3 laps on the build that served just before
#               .102 (never an older one), read from the lap sampler
#               (VDBC_BASELINE, status.jsonl: a wrap is two samples under 360
#               min apart whose rotation start moved) and from section 90's
#               cold-wraps ledger (VDBC_LAPS), or VDBC_LAP_BAR. INFO with fewer
#               than 3.
#   Cursor      over the status reads of this build, the cold cursor
#               (cursor.cold, as cursorStep.to records it) moves while the slice
#               count does, at no less than half the sampler's pre-.102 rate.
#               The catalogue's retirements shift every position after the
#               first change (on the fallback hot list, index 7; no kept board
#               moves more than 128 places), so the rate, not the place, is
#               compared. INFO with under 5 minutes of cold reads.
#   Stale-read record  INFO only: how many reads of this build, and of the
#               sampler's samples on the build before it, found the chain
#               stamp older than thresholdMs. Not a check: one chain death
#               spans several reads 90 s apart.
#
# READ-ONLY. One OPTIONS preflight; job-board status, list and exists reads,
# sent with x-rb-budget: probe and noLog; two anon read RPCs
# (get_company_hiring_health, get_cron_health); GETs of robots.txt and of up
# to eight public ATS feeds. The only write is the local VDBC_STATE file.
echo "== 99zzzzzzz. job-board .102 lane 1: oversize boards read, one streamed read a slice, USAJOBS stated close, no tomorrow, 429 deferred, chain stamps aged, no relabel, no upkeep, list/exists shapes, names, twins, wrap length =="

VDBC_CAP=4450000
VDBC_TALLY="${VDBC_TALLY:-$(git ls-tree -r -l HEAD -- supabase/functions/job-board supabase/functions/_shared 2>/dev/null | awk '{s+=$4} END {print s+0}')}"
if ! [ "${VDBC_TALLY:-0}" -gt 0 ] 2>/dev/null; then echo "INFO  ROOM: no checkout here to measure the upload against the 4,450,000-byte cap"
elif [ "$VDBC_TALLY" -gt "$VDBC_CAP" ]; then echo "FAIL  ROOM: job-board/** + _shared/** at HEAD is $VDBC_TALLY bytes, over the 4,450,000 cap: Lovable refuses the upload and the old build keeps serving"
else echo "INFO  ROOM: job-board/** + _shared/** at HEAD is $VDBC_TALLY bytes, $((VDBC_CAP - VDBC_TALLY)) under the 4,450,000 cap"; fi

rm -f /tmp/vd_bc_opt.txt
curl -s -m 30 -D /tmp/vd_bc_opt.txt -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K"
VDBC_H=$(cat /tmp/vd_bc_opt.txt 2>/dev/null | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VDBC_MAXAGE=$(cat /tmp/vd_bc_opt.txt 2>/dev/null | tr -d '\r' | grep -i '^access-control-max-age:' | head -1 | sed -E 's/^[^:]+: *//')
VDBC_LIVE=0
if [ -z "$VDBC_H" ]; then echo "FAIL  build: job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VDBC_H" "2026-09-09" "102"; then echo "PASS  build: job-board preflight x-fn-build = $VDBC_H (job-board.2026-09-09.102 or later)"; VDBC_LIVE=1
else echo "INFO  build: job-board preflight x-fn-build = $VDBC_H: job-board.2026-09-09.102 is not serving yet, so every lane-1 line waits for it (an over-cap upload would leave this build serving: see ROOM)"; fi
if [ "$VDBC_LIVE" != 1 ]; then echo "INFO  PERF-06: preflight Access-Control-Max-Age = ${VDBC_MAXAGE:-(none)} (7200 from .102)"
elif [ "$VDBC_MAXAGE" = 7200 ]; then echo "PASS  PERF-06: preflight Access-Control-Max-Age = 7200 (a browser asks once per two hours)"
else echo "FAIL  PERF-06: preflight Access-Control-Max-Age = ${VDBC_MAXAGE:-(none)}, want 7200"; fi

if [ "$VDBC_LIVE" = 1 ]; then
  rm -f /tmp/vd_bc_*.json /tmp/vd_bc_*.t /tmp/vd_bc_*.code /tmp/vd_bc_*.robots /tmp/vd_bc_*.txt
  VDBC_A='"groupSimilar":false,"includeFacets":false,"noLog":true'
  VDBC_BOARDS="recruitee:transperfect recruitee:vdkgroep recruitee:riedmair recruitee:livezoku pinpoint:trilongroup workable:cxg workable:tehora workable:solution-sft"
  VDBC_HELD="nogigiddy weekday-1 hire-resolve-the-top-recruitment-agency"
  VDBC_NAMED="ashby:creatoriq ashby:harmattan-ai personio:deag-deutsche-entertainment-ag lever:americaatwork"
  VDBC_TWINS="pinpoint:helsing greenhouse:wayve greenhouse:clickhouse lever:swordhealth greenhouse:lovable greenhouse:kalshi greenhouse:webflow greenhouse:worldlabs"
  VDBC_STATE="${VDBC_STATE:-$HOME/.config/resumebooster/verify-state/board-102-core.json}"
  VDBC_UA="resumebooster.work job board (contact: support@resumebooster.work)"

  VDBC_N="${VDBC_READS:-10}"; VDBC_I=0
  while [ "$VDBC_I" -lt "$VDBC_N" ]; do
    [ "$VDBC_I" -gt 0 ] && sleep "${VDBC_GAP_S:-90}"
    J '{"action":"status"}' > "/tmp/vd_bc_st_$VDBC_I.json"; date +%s > "/tmp/vd_bc_st_$VDBC_I.t"
    VDBC_I=$((VDBC_I + 1))
  done

  if [ -n "${VDBC_CATALOG:-}" ]; then cp "$VDBC_CATALOG" /tmp/vd_bc_catalog.json 2>/dev/null
  else npx --no-install tsx --eval 'import { JOB_SOURCES } from "./supabase/functions/job-board/sources.ts"; const seen = new Set<string>(), dup = new Set<string>(); for (const s of JOB_SOURCES) { if (seen.has(s.token)) dup.add(s.token); else seen.add(s.token); } process.stdout.write(JSON.stringify(JOB_SOURCES.map((s) => (dup.has(s.token) ? s.source + ":" + s.token : s.token))));' > /tmp/vd_bc_catalog.json 2>/dev/null; fi

  for VDBC_P in $VDBC_BOARDS; do
    J "{\"action\":\"list\",\"companies\":[\"${VDBC_P#*:}\"],\"vendor\":[\"${VDBC_P%%:*}\"],\"countOnly\":true,$VDBC_A}" > "/tmp/vd_bc_n_${VDBC_P#*:}.json"
    J "{\"action\":\"list\",\"companies\":[\"${VDBC_P#*:}\"],\"vendor\":[\"${VDBC_P%%:*}\"],\"limit\":60,$VDBC_A}" > "/tmp/vd_bc_l_${VDBC_P#*:}.json"
  done
  for VDBC_T in $VDBC_HELD; do J "{\"action\":\"list\",\"companies\":[\"$VDBC_T\"],\"vendor\":[\"workable\"],\"countOnly\":true,$VDBC_A}" > "/tmp/vd_bc_h_$VDBC_T.json"; done
  for VDBC_P in $VDBC_NAMED; do J "{\"action\":\"list\",\"companies\":[\"${VDBC_P#*:}\"],\"vendor\":[\"${VDBC_P%%:*}\"],\"limit\":60,$VDBC_A}" > "/tmp/vd_bc_name_${VDBC_P#*:}.json"; done
  for VDBC_P in $VDBC_TWINS; do J "{\"action\":\"list\",\"companies\":[\"${VDBC_P#*:}\"],\"vendor\":[\"${VDBC_P%%:*}\"],\"limit\":5,$VDBC_A}" > "/tmp/vd_bc_twin_${VDBC_P%%:*}_${VDBC_P#*:}.json"; done
  J "{\"action\":\"list\",\"q\":\"\",\"sort\":\"newest\",\"limit\":20,$VDBC_A}" > /tmp/vd_bc_newest.json
  VDBC_OFF=0; VDBC_I=0
  while [ "$VDBC_I" -lt 3 ]; do
    J "{\"action\":\"list\",\"companies\":[\"bristolmyerssquibb~wd5~BMS\"],\"location\":\"New Brunswick\",\"limit\":60,\"offset\":$VDBC_OFF,$VDBC_A}" > "/tmp/vd_bc_bms_$VDBC_I.json"
    VDBC_NEXT=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const o=Number(process.argv[2]);process.stdout.write(j&&Array.isArray(j.jobs)&&j.jobs.length&&j.hasMore===true?String(o+j.jobs.length):"")}catch{}' "/tmp/vd_bc_bms_$VDBC_I.json" "$VDBC_OFF")
    VDBC_I=$((VDBC_I + 1))
    [ -n "$VDBC_NEXT" ] || break
    VDBC_OFF=$VDBC_NEXT
  done
  R get_company_hiring_health '{"p_tokens":["usajobs"]}' > /tmp/vd_bc_hh.json
  R get_cron_health '{"p_hours":48}' > /tmp/vd_bc_cron.json

  # The boards a slice of this build named in rawNoRows or srPartial, each read by count.
  VDBC_I=0
  for VDBC_K in $(VDBC_N="$VDBC_N" VDBC_H="$VDBC_H" node -e '
const fs=require("fs");const out=new Map();const serving=String(process.env.VDBC_H||"").replace(/^job-board\./,"");
for(let i=0;i<Number(process.env.VDBC_N);i++){let s;try{s=JSON.parse(fs.readFileSync("/tmp/vd_bc_st_"+i+".json","utf8")).sliceStats}catch{continue}
  if(!s||s.build!==serving||!(Date.parse(s.at||"")>Date.parse(s.buildSince||"")))continue;
  for(const kind of ["rawNoRows","srPartial"])for(const k of Array.isArray(s[kind])?s[kind]:[])if(typeof k==="string"&&/^[A-Za-z0-9~_.:-]+$/.test(k)&&[...out.values()].filter((v)=>v===kind).length<10&&!out.has(kind+"|"+k))out.set(kind+"|"+k,kind)}
console.log([...out.keys()].join("\n"))'); do
    VDBC_KEY=${VDBC_K#*|}
    case "$VDBC_KEY" in
      *:*) VDBC_Q="\"companies\":[\"${VDBC_KEY#*:}\"],\"vendor\":[\"${VDBC_KEY%%:*}\"]";;
      *) if [ "${VDBC_K%%|*}" = srPartial ]; then VDBC_Q="\"companies\":[\"$VDBC_KEY\"],\"vendor\":[\"smartrecruiters\"]"; else VDBC_Q="\"companies\":[\"$VDBC_KEY\"]"; fi;;
    esac
    J "{\"action\":\"list\",$VDBC_Q,\"countOnly\":true,$VDBC_A}" > "/tmp/vd_bc_r_$VDBC_I.json"
    printf '%s\t%s\n' "$VDBC_I" "$VDBC_K" >> /tmp/vd_bc_r_index.txt
    VDBC_I=$((VDBC_I + 1))
  done

  # BR-03: a fake id, the ids saved by earlier runs, and an open id from the newest list.
  VDBC_EX=$(VDBC_STATE="$VDBC_STATE" node -e '
const fs=require("fs");let st={};try{st=JSON.parse(fs.readFileSync(process.env.VDBC_STATE,"utf8"))||{}}catch{}
let open=null;try{const j=JSON.parse(fs.readFileSync("/tmp/vd_bc_newest.json","utf8"));const r=(j.jobs||[]).find((x)=>x&&typeof x.id==="string");open=r?r.id:null}catch{}
const now=Date.now();const saved=(Array.isArray(st.ids)?st.ids:[]).filter((x)=>x&&typeof x.id==="string"&&now-Date.parse(x.savedAt)<80*86400000&&x.id!==open).slice(-10).map((x)=>x.id);
const fake="greenhouse:verify-never-held:"+now;
fs.writeFileSync("/tmp/vd_bc_exists_ask.json",JSON.stringify({fake,saved,open}));
process.stdout.write(JSON.stringify({action:"exists",ids:[fake,...saved,...(open?[open]:[])]}))')
  [ -n "$VDBC_EX" ] && J "$VDBC_EX" > /tmp/vd_bc_exists.json

  # D12/D7: the feeds of the boards this build has read, robots.txt first, one host at a time.
  VDBC_SEEN=" "
  for VDBC_P in $(VDBC_N="$VDBC_N" VDBC_BOARDS="$VDBC_BOARDS" VDBC_H="$VDBC_H" node -e '
const fs=require("fs");const serving=String(process.env.VDBC_H||"").replace(/^job-board\./,"");let since=NaN;
for(let i=Number(process.env.VDBC_N)-1;i>=0;i--){let s;try{s=JSON.parse(fs.readFileSync("/tmp/vd_bc_st_"+i+".json","utf8")).sliceStats}catch{continue}if(s&&s.build===serving){since=Date.parse(s.buildSince||"");break}}
for(const p of String(process.env.VDBC_BOARDS).split(" ")){let j;try{j=JSON.parse(fs.readFileSync("/tmp/vd_bc_l_"+p.slice(p.indexOf(":")+1)+".json","utf8"))}catch{continue}
  if(Number.isFinite(since)&&Array.isArray(j.jobs)&&j.jobs.some((r)=>r&&(Date.parse(r.recheckedAt||"")>since||Date.parse(r.lastSeen||"")>since)))console.log(p)}'); do
    VDBC_T=${VDBC_P#*:}
    case "${VDBC_P%%:*}" in
      recruitee) VDBC_HOST="$VDBC_T.recruitee.com"; VDBC_PATH="/api/offers/";;
      pinpoint) VDBC_HOST="$VDBC_T.pinpointhq.com"; VDBC_PATH="/postings.json";;
      *) VDBC_HOST="apply.workable.com"; VDBC_PATH="/api/v1/widget/accounts/$VDBC_T?details=false";;
    esac
    case "$VDBC_SEEN" in *" $VDBC_HOST "*) ;; *)
      curl -s -m 30 -A "$VDBC_UA" -o "/tmp/vd_bc_robots_$VDBC_HOST.txt" -w '%{http_code}' "https://$VDBC_HOST/robots.txt" > "/tmp/vd_bc_robots_$VDBC_HOST.code"
      VDBC_SEEN="$VDBC_SEEN$VDBC_HOST ";;
    esac
    sleep "${VDBC_HOST_GAP_S:-1.1}"
    if node -e '
const [f,code,p]=process.argv.slice(1);const c=Number(code);
if(c>=400&&c<500)process.exit(0);
if(!(c>=200&&c<300))process.exit(1);
let txt="";try{txt=require("fs").readFileSync(f,"utf8")}catch{process.exit(1)}
const groups=[];let cur=null,lastUA=false;
for(const raw of txt.split(/\r?\n/)){const l=raw.replace(/#.*/,"").trim();const m=/^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l);if(!m)continue;const k=m[1].toLowerCase(),v=m[2].trim();
  if(k==="user-agent"){if(!cur||!lastUA){cur={ua:[],rules:[]};groups.push(cur)}cur.ua.push(v.toLowerCase());lastUA=true}
  else{lastUA=false;if(cur&&(k==="allow"||k==="disallow")&&v)cur.rules.push([k,v])}}
const mine=groups.filter((g)=>g.ua.some((u)=>u.includes("resumebooster")));const use=mine.length?mine:groups.filter((g)=>g.ua.includes("*"));
const rx=(v)=>{const end=v.endsWith("$");const b=(end?v.slice(0,-1):v).replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*");return new RegExp("^"+b+(end?"$":""))};
let best=null;for(const [k,v] of use.flatMap((g)=>g.rules)){if(rx(v).test(p)&&(!best||v.length>best.n||(v.length===best.n&&k==="allow")))best={k,n:v.length}}
process.exit(best&&best.k==="disallow"?1:0)' "/tmp/vd_bc_robots_$VDBC_HOST.txt" "$(cat "/tmp/vd_bc_robots_$VDBC_HOST.code" 2>/dev/null)" "$VDBC_PATH"; then
      curl -s -m 60 -A "$VDBC_UA" "https://$VDBC_HOST$VDBC_PATH" > "/tmp/vd_bc_feed_$VDBC_T.json"
    else echo "$VDBC_HOST$VDBC_PATH" > "/tmp/vd_bc_feed_$VDBC_T.robots"; fi
  done

  VDBC_H="$VDBC_H" VDBC_N="$VDBC_N" VDBC_STATE="$VDBC_STATE" VDBC_BOARDS="$VDBC_BOARDS" VDBC_HELD="$VDBC_HELD" VDBC_NAMED="$VDBC_NAMED" VDBC_TWINS="$VDBC_TWINS" \
  VDBC_HOUR="${VDBC_HOUR:-}" VDBC_LAPS="${VDBC_LAPS:-$HOME/.config/resumebooster/verify-state/cold-wraps.json}" VDBC_LAP_BAR="${VDBC_LAP_BAR:-}" \
  VDBC_BASELINE="${VDBC_BASELINE:-$HOME/.config/resumebooster/jobs-data-2026-11-07/plan/baseline/status.jsonl}" node -e '
const fs=require("fs");const E=process.env;const H=3600000;const now=Date.now();
const read=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync(f,"utf8").slice(0,160).replace(/\s+/g," ")}catch{return "(no answer)"}};
const say=(v,tag,s)=>console.log(v+"  "+tag+": "+s);
const num=(x)=>(typeof x==="number"&&Number.isFinite(x)?x:null);
const serving=String(E.VDBC_H||"").replace(/^job-board\./,"");
const reads=[];for(let i=0;i<Number(E.VDBC_N);i++){const st=read("/tmp/vd_bc_st_"+i+".json");const t=Number(String(fs.existsSync("/tmp/vd_bc_st_"+i+".t")?fs.readFileSync("/tmp/vd_bc_st_"+i+".t","utf8"):"").trim())*1000;if(st&&typeof st==="object"&&!Array.isArray(st))reads.push({i,st,t:Number.isFinite(t)&&t>0?t:now,ss:st.sliceStats&&typeof st.sliceStats==="object"?st.sliceStats:null})}
if(!reads.length){say("FAIL","status","no status read answered JSON: "+peek("/tmp/vd_bc_st_0.json"));process.exit(0)}
const last=reads[reads.length-1];const S=last.st;
const served=S.version===serving;
const ours=reads.filter((r)=>r.ss&&r.ss.build===serving);const lo=ours[ours.length-1]||null;
const since=lo?Date.parse(lo.ss.buildSince||""):NaN;const ageH=Number.isFinite(since)?(now-since)/H:null;
const clock=!last.ss?"status carries no sliceStats":!lo?"sliceStats.build is "+last.ss.build+", not the serving "+serving+": no slice of this build has run yet":ageH===null?"status states no sliceStats.buildSince":"the first slice of this build was "+ageH.toFixed(1)+" h ago";
say("INFO","clock",clock+"; "+reads.length+" status read(s), "+ours.length+" from a slice of this build");
const wait=(tag)=>say("INFO",tag,"waits for a slice of this build ("+clock+")");
const rows=(x)=>(x&&Array.isArray(x.jobs)?x.jobs.filter((r)=>r&&typeof r==="object"):null);
const total=(x)=>(x&&typeof x.total==="number"?x.total:null);
const CAPPED=new Set(["workday","oracle","icims","smartrecruiters","rippling","usajobs","teamtailor"]);
const fresh=(r)=>Number.isFinite(since)&&((!CAPPED.has(String(r.source))&&Date.parse(r.recheckedAt||"")>since)||Date.parse(r.lastSeen||"")>since);
let state={};try{state=JSON.parse(fs.readFileSync(E.VDBC_STATE,"utf8"))||{}}catch{}
const held=new Set(String(E.VDBC_HELD).split(" "));

// D12 registry.
if(!lo)wait("D12 registry");else{
  const reg=lo.st.oversizeBoards;const cat=read("/tmp/vd_bc_catalog.json");const keys=Array.isArray(cat)&&cat.length>1000?new Set(cat):null;
  if(!Array.isArray(reg))say("FAIL","D12 registry","status carries no oversizeBoards list: "+String(JSON.stringify(reg)).slice(0,120));
  else{
    const STREAMS=new Set(["lever","ashby","greenhouse","recruitee","pinpoint"]);
    const W4=new Set(["usasurveyjob"]);const at=(e)=>Date.parse(e.at||"");
    // A bare key an older build wrote for a token now shared is read as its own vendor:token.
    const lost=keys?reg.filter((e)=>!keys.has(e.key)&&(String(e.key).includes(":")||!keys.has(e.source+":"+e.key))):[];
    // An uncatalogued key is a miss of the prune, named once below, not a board the build failed to read.
    const late=reg.filter((e)=>!lost.includes(e)&&!e.bare&&!W4.has(e.token)&&(e.wait?now-at(e)>=2*H&&now-since>12*H:at(e)>since+12*H)&&(STREAMS.has(e.source)||(e.source==="workable"&&!held.has(e.token))));
    const fmt=(a)=>JSON.stringify(a.slice(0,5).map((e)=>[e.key,e.source,e.mb,e.at]));
    if(late.length||lost.length)say("FAIL","D12 registry",(late.length?late.length+" board(s) the stream or a details-free read should now read were still oversize 12 h after buildSince: "+fmt(late):"")+(late.length&&lost.length?"; ":"")+(lost.length?lost.length+" key(s) name a board the catalogue does not carry (the registry prune keeps only catalogued boards): "+fmt(lost):""));
    else if(!reg.length)say("INFO","D12 registry","the registry is empty (expected at least the three held Workable boards)");
    else if(!keys)say("INFO","D12 registry","no key read oversize past buildSince + 12 h"+(ageH<12?" (the 12 h have not passed)":"")+"; the catalogue could not be read here (tsx), so uncatalogued keys are not judged");
    else say("PASS","D12 registry",reg.length+" key(s), every one catalogued, none a board the stream or a details-free read reads still oversize past buildSince + 12 h"+(ageH<12?" (the 12 h have not passed: the catalogue half is judged)":""));
    say("INFO","D12 registry count",reg.length+" (expected: the three held Workable boards, the Workable boards read without details (bare), and any board waiting for a cold slice\x27s stream): "+JSON.stringify(reg.map((e)=>e.key+(e.bare?" bare":e.wait?" wait":""))));
  }
}

// D12/D7 counts against the feeds.
const DAY=86400000;
const feedCount=(v,j)=>{const inWin=(d)=>{const t=Date.parse(d||"");return !Number.isFinite(t)||now-t<=30*DAY};
  if(v==="recruitee")return Array.isArray(j&&j.offers)?j.offers.filter((o)=>o&&inWin(o.published_at||o.created_at)).length:null;
  if(v==="pinpoint")return Array.isArray(j&&j.data)?j.data.length:null;
  return Array.isArray(j&&j.jobs)?j.jobs.filter((o)=>o&&inWin(o.published_on||o.created_at)).length:null};
for(const p of String(E.VDBC_BOARDS).split(" ")){const v=p.slice(0,p.indexOf(":")),t=p.slice(p.indexOf(":")+1);const tag="D12/D7 "+p;
  if(!lo){wait(tag);continue}
  const n=total(read("/tmp/vd_bc_n_"+t+".json"));const L=rows(read("/tmp/vd_bc_l_"+t+".json"));
  if(n===null||!L){say("FAIL",tag,"the board count or list is unreadable: "+peek(n===null?"/tmp/vd_bc_n_"+t+".json":"/tmp/vd_bc_l_"+t+".json"));continue}
  const re=L.filter(fresh).length;
  if(!re){say("INFO",tag,n+" served, none read after buildSince yet ("+clock+")");continue}
  if(fs.existsSync("/tmp/vd_bc_feed_"+t+".robots")){say("INFO",tag,n+" served; the feed was not read: robots.txt disallows "+peek("/tmp/vd_bc_feed_"+t+".robots"));continue}
  const f=feedCount(v,read("/tmp/vd_bc_feed_"+t+".json"));
  if(f===null){say("INFO",tag,n+" served; the feed did not answer a list (the vendor, not this build): "+peek("/tmp/vd_bc_feed_"+t+".json"));continue}
  if(!f){say("INFO",tag,n+" served; the feed lists nothing in the 30-day window, so there is nothing to compare");continue}
  const ok=Math.abs(n-f)<=0.15*f;
  say(ok?"PASS":"FAIL",tag,n+" served against "+f+" in-window on the feed ("+(f?Math.round(100*n/f):0)+"%, want 85-115%; "+re+" of the first "+L.length+" rows read after buildSince)");
}
for(const t of held){const tag="D12 held "+t;if(!lo){wait(tag);continue}
  const n=total(read("/tmp/vd_bc_h_"+t+".json"));
  if(n===null)say("FAIL",tag,"the count is unreadable: "+peek("/tmp/vd_bc_h_"+t+".json"));
  else say(n>0?(serving==="2026-09-09.102"?"FAIL":"INFO"):"PASS",tag,n+" row(s) served (a held board stays dark until the mill screen and an owner call"+(n>0&&serving!=="2026-09-09.102"?"; on "+serving+", a later build may serve it under spec section 7":"")+")");}
{const tag="D12 Pinpoint dates";if(!lo)wait(tag);else{const L=rows(read("/tmp/vd_bc_l_trilongroup.json"));
  if(!L)say("FAIL",tag,"the trilongroup list is unreadable: "+peek("/tmp/vd_bc_l_trilongroup.json"));
  else{const dated=L.filter((r)=>r.postedAt);const stamped=dated.filter((r)=>Math.abs(Date.parse(r.postedAt)-Date.parse(r.lastSeen||""))<5*60000);
    if(stamped.length)say("FAIL",tag,stamped.length+" of "+L.length+" trilongroup rows carry a date stamped at insert; the feed states none: "+JSON.stringify(stamped.slice(0,3).map((r)=>[r.id,r.postedAt,r.lastSeen])));
    else if(!L.length)say("INFO",tag,"trilongroup serves no row yet");
    else say("PASS",tag,"no trilongroup row carries a date stamped at insert ("+L.length+" read"+(dated.length?"; "+dated.length+" dated later by the posted backfill from the posting page":"")+")");}}}

// D7 descriptions.
{const tag="D7 descriptions";if(!lo)wait(tag);else{const d=Array.isArray(S.descCoverage)?S.descCoverage.find((x)=>x&&x.source==="workable"):null;
  if(!d||!(d.total>0))say("INFO",tag,"descCoverage has no workable entry to judge: "+String(JSON.stringify(S.descCoverage)).slice(0,120));
  else{const pct=100*d.described/d.total;const s=d.described+" of "+d.total+" Workable rows described ("+pct.toFixed(1)+"%; want at least 95% within 7 days; about 86.7% with no filler; rollup "+S.descCoverageAgeMin+" min old)";
    say(pct>=95?"PASS":ageH>=168?"FAIL":"INFO",tag,s);}}}

// XR-1.
{const tag="XR-1";if(!lo)wait(tag);else{const sw=((lo.st.passEnd||{}).steps||{}).sweep||{};const sc=num(sw.statedClosed);const hh=read("/tmp/vd_bc_hh.json");
  const u=Array.isArray(hh)?hh.find((x)=>x&&x.company_token==="usajobs"):null;const closed=u?Number(u.closed_90d):null;
  if(u)say("INFO","XR-1 usajobs open","open_roles "+u.open_roles+" (18,503 on 2026-11-14)");
  const s="passEnd.steps.sweep.statedClosed "+sc+" (sweep done "+(sw.doneAt||null)+"), usajobs closed_90d "+(u?closed:"unreadable: "+peek("/tmp/vd_bc_hh.json"));
  if(sc>0&&closed>0)say("PASS",tag,s);
  else say(ageH>=168?"FAIL":"INFO",tag,s+(ageH>=168?" (want both above 0 within 7 days of this build)":"; judged 7 days after buildSince (a row gains closes_at when a read by this build reaches it, a stored one as an unlogged correction)"));}}

// BB-10.
{const tag="BB-10";const hour=E.VDBC_HOUR!==""&&E.VDBC_HOUR!==undefined?Number(E.VDBC_HOUR):new Date(now).getUTCHours();const L=rows(read("/tmp/vd_bc_newest.json"));
  if(!L)say("FAIL",tag,"the newest list is unreadable: "+peek("/tmp/vd_bc_newest.json"));
  else{const ahead=L.filter((r)=>Date.parse(r.postedAt||"")>now+5*60000);const s=ahead.length+" of the newest "+L.length+" rows carry a postedAt later than now + 5 min"+(ahead.length?": "+JSON.stringify(ahead.slice(0,3).map((r)=>[r.id,r.postedAt])):"");
    if(hour<16)say("INFO",tag,s+" (judged 16:00-24:00Z, when a feed in a zone ahead already states tomorrow; it is "+hour+"Z)");
    else if(!lo||ageH<24)say("INFO",tag,s+" (judged from 24 h after buildSince: a tomorrow stored before this build has passed by then; "+clock+")");
    else say(ahead.length?"FAIL":L.length?"PASS":"INFO",tag,s);}}

// CAP-8, BB-09: every slice record of this build seen.
// A slice record of this build: stampSliceWork stamps build first, so the record is ours once its at follows buildSince.
const oursRec=ours.filter((r)=>Date.parse(r.ss.at||"")>Date.parse(r.ss.buildSince||""));
const recs=[...new Map(oursRec.map((r)=>[String(r.ss.at),r.ss])).values()];
{const tag="CAP-8";if(!recs.length)wait(tag);else{const bad=recs.filter((s)=>num(s.streamed)===null||s.streamed>1);
  say(bad.length?"FAIL":"PASS",tag,bad.length?bad.length+" slice record(s) of this build broke the envelope (want streamed 0 or 1): "+JSON.stringify(bad.slice(0,3).map((s)=>[s.at,s.lastPhase,s.streamed])):recs.length+" slice record(s) of this build, streamed "+JSON.stringify(recs.map((s)=>s.lastPhase+" "+s.streamed))+" (at most 1 a slice, either phase)");}}
{const tag="BB-09";if(!recs.length)wait(tag);else{
  const noKey=recs.filter((s)=>!Array.isArray(s.rateLimited));const new429=[];
  const sv=reads.filter((r)=>r.st.version===serving);
  for(let i=1;i<sv.length;i++){const a=sv[i-1].st,b=sv[i].st;const fa=num(a.failedCount),fb=num(b.failedCount);if(fa===null||fb===null||!Array.isArray(b.recentFailures))continue;
    const d=fb-fa;const fresh_=d>0?b.recentFailures.slice(-Math.min(d,10)):d<0?b.recentFailures.slice(-Math.min(fb,10)):[];
    for(const x of fresh_)if(/HTTP 429/.test(String(x)))new429.push(x)}
  const stale429=(Array.isArray(S.recentFailures)?S.recentFailures:[]).filter((x)=>/HTTP 429/.test(String(x))).length;
  if(noKey.length||new429.length)say("FAIL",tag,(noKey.length?noKey.length+" slice record(s) of this build carry no rateLimited":"")+(noKey.length&&new429.length?"; ":"")+(new429.length?new429.length+" failure(s) recorded between two reads name HTTP 429 (a refusal for load is a deferral, never a failure): "+JSON.stringify(new429.slice(0,3)):""));
  else say("PASS",tag,recs.length+" slice record(s) carry rateLimited "+JSON.stringify(recs.map((s)=>(s.rateLimited||[]).length))+"; no failure recorded across "+sv.length+" reads names HTTP 429"+(stale429?" ("+stale429+" older entr"+(stale429>1?"ies":"y")+" from before this build still in recentFailures)":""));}}

// HB-1.
{const tag="HB-1";const sv=reads.filter((r)=>r.st.version===serving);if(!sv.length)say("INFO",tag,"no status read was answered by "+serving);else{const alive=sv.filter((r)=>r.st.chainWatchdog&&r.st.chainWatchdog.decision==="chain_alive");
  const bad=alive.filter((r)=>{const cw=r.st.chainWatchdog,ck=r.st.chainKick||{};return Date.parse(cw.at)-Date.parse(ck.at)>Number(cw.thresholdMs)+60000});
  if(bad.length)say("FAIL",tag,bad.length+" read(s) answered chain_alive on a chain stamp older than thresholdMs: "+JSON.stringify(bad.slice(0,3).map((r)=>[r.st.chainWatchdog.at,(r.st.chainKick||{}).at,r.st.chainWatchdog.thresholdMs])));
  else if(!alive.length)say("INFO",tag,"no read answered chain_alive, so the age bound was not exercised (decisions: "+JSON.stringify(sv.map((r)=>(r.st.chainWatchdog||{}).decision))+")");
  else say("PASS",tag,alive.length+" chain_alive answer(s), each on a stamp younger than thresholdMs");}}

// UPK-3.
{const tag="UPK-3";const ours=oursRec;if(ours.length<2)say("INFO",tag,"needs two status reads after a slice of this build ("+ours.length+")");else{
  const stale=(r)=>{const cw=r.st.chainWatchdog||{};return num(cw.pulseAgeMs)!==null&&num(cw.thresholdMs)!==null&&cw.pulseAgeMs>cw.thresholdMs};
  const relabels=[],restarts=[],unknown=[];
  for(let i=1;i<ours.length;i++){const a=ours[i-1],b=ours[i];if(!(Number(a.ss.hop)>0&&Number(b.ss.hop)===0&&a.ss.at!==b.ss.at))continue;
    const kick=Date.parse(((b.st.chainWatchdog||{}).lastKick||{}).at||"");const pe=Date.parse((b.st.passEnd||{}).startedAt||"");
    if(stale(a)||stale(b)||(kick>a.t-60000&&kick<=b.t+60000)||pe>=Date.parse(a.ss.at)-5*60000){restarts.push(b.ss.at);continue}
    const c=ours.slice(i+1).find((x)=>num(x.ss.slices)!==null&&num(b.ss.slices)!==null&&x.ss.slices>b.ss.slices);
    if(!c){unknown.push(b.ss.at);continue}
    (Number(c.ss.hop)>c.ss.slices-b.ss.slices?relabels:restarts).push([a.ss.hop,0,c.ss.hop,c.ss.slices-b.ss.slices])}
  if(relabels.length)say("FAIL",tag,relabels.length+" drop(s) to hop 0 with no stale read, no kick and no pass end between, after which the old count came back ([before, 0, later hop, slices since]): "+JSON.stringify(relabels.slice(0,3)));
  else if(unknown.length)say("INFO",tag,unknown.length+" drop(s) to hop 0 with no stale read in the interval and no later read to tell a restart from a relabel: "+JSON.stringify(unknown));
  else say("PASS",tag,"hops across "+ours.length+" reads "+JSON.stringify(ours.map((r)=>r.ss.hop))+(restarts.length?"; "+restarts.length+" drop(s) to 0 were real restarts":"; no drop to 0"));}}

// UPK-DROP.
{const tag="UPK-DROP";if(!served)say("INFO",tag,"status answered version "+S.version+", not "+serving);else{
  const errs=[];if("boardUpkeep" in S)errs.push("status still carries boardUpkeep");
  if(!["rollup","unavailable"].includes(S.dateCoverageSource))errs.push("dateCoverageSource is "+JSON.stringify(S.dateCoverageSource)+", want rollup or unavailable");
  const cron=read("/tmp/vd_bc_cron.json");const job=Array.isArray(cron)?cron.find((x)=>x&&x.ch_jobname==="job-board-stats-rollup"):null;
  const sch=job?String(job.ch_schedule||""):"";const m=/^\*\/(\d+) \* \* \* \*$/.exec(sch);const cad=m?Number(m[1]):/^\d+ \* \* \* \*$/.test(sch)?60:null;
  const age=num(S.dateCoverageAgeMin);
  if(S.dateCoverageSource==="rollup"&&cad&&age!==null&&age>2*cad)errs.push("the date-coverage rollup is "+age+" min old, over twice the "+cad+"-min cadence ("+sch+")");
  if(errs.length)say("FAIL",tag,errs.join("; "));
  else say(cad||S.dateCoverageSource!=="rollup"?"PASS":"INFO",tag,"no boardUpkeep key; dateCoverageSource "+S.dateCoverageSource+(S.dateCoverageSource==="rollup"?", "+age+" min old"+(cad?" (cadence "+sch+", bound "+2*cad+" min)":"; job-board-stats-rollup cadence unreadable from get_cron_health: "+peek("/tmp/vd_bc_cron.json")):""));}}

// BR-04.
{const tag="BR-04";const ans=[...String(E.VDBC_NAMED).split(" ").map((p)=>"/tmp/vd_bc_name_"+p.slice(p.indexOf(":")+1)+".json"),...[0,1,2].map((i)=>"/tmp/vd_bc_bms_"+i+".json")].map((f)=>[f,read(f)]).filter(([,j])=>j&&Array.isArray(j.jobs)&&j.hasMore===false);
  const bad=ans.filter(([,j])=>j.nextOffset!==null);
  if(bad.length)say("FAIL",tag,bad.length+" list answer(s) with nothing after them still name a next offset (want the key, null): "+JSON.stringify(bad.slice(0,3).map(([f,j])=>[f.replace(/^.*vd_bc_/,""),j.jobs.length,"nextOffset" in j?j.nextOffset:"(no key)"])));
  else if(!ans.length)say("INFO",tag,"no list answer here ended its results (hasMore false), so nothing to judge");
  else say("PASS",tag,ans.length+" list answer(s) that ended their results name nextOffset null");}

// BR-03.
{const tag="BR-03";const ask=read("/tmp/vd_bc_exists_ask.json");const ex=read("/tmp/vd_bc_exists.json");
  if(!ask||!ex||typeof ex!=="object"||!ex.open)say("FAIL",tag,"exists is unreadable: "+peek("/tmp/vd_bc_exists.json"));
  else if(!("unknown" in ex))say("FAIL",tag,"exists answers no unknown key");
  else if(ex.unknown===null)say("INFO",tag,"exists answered unknown null (one of its reads failed), so nothing is judged");
  else{const U=new Set(Array.isArray(ex.unknown)?ex.unknown:[]);const closed=ask.saved.filter((id)=>ex.open[id]===false);const errs=[];
    if(!U.has(ask.fake))errs.push("the fake id "+ask.fake+" is not unknown");
    if(ask.open&&U.has(ask.open))errs.push("the open id "+ask.open+" is called unknown");
    const lost=ask.saved.filter((id)=>U.has(id));if(lost.length)errs.push(lost.length+" saved id(s) the board served within 80 days are called unknown: "+JSON.stringify(lost.slice(0,3)));
    if(errs.length)say("FAIL",tag,errs.join("; "));
    else if(!closed.length)say("INFO",tag,"the fake id is unknown and "+(ask.open?"the open id is not":"no open id was read")+"; no saved id reads closed yet ("+ask.saved.length+" saved), so the closed half waits");
    else say("PASS",tag,"unknown = [the fake id] only, with "+closed.length+" closed and "+(ask.saved.length-closed.length+(ask.open?1:0))+" open id(s) asked");
    if(ask.open){const ids=(Array.isArray(state.ids)?state.ids:[]).filter((x)=>x&&x.id!==ask.open&&now-Date.parse(x.savedAt)<80*DAY);ids.push({id:ask.open,savedAt:new Date(now).toISOString()});state.ids=ids.slice(-20)}}}

// VF-BMS.
{const tag="VF-BMS";if(!lo)wait(tag);else{const pages=[0,1,2].map((i)=>"/tmp/vd_bc_bms_"+i+".json").filter((f)=>fs.existsSync(f)).map(read);
  if(!pages.length||pages.some((p)=>!rows(p)))say("FAIL",tag,"the Bristol Myers Squibb New Brunswick list is unreadable: "+peek("/tmp/vd_bc_bms_0.json"));
  else{const L=pages.flatMap(rows).filter((r)=>r.country==="US"||/\bNJ\b|New Jersey/i.test(String(r.location||"")));const cad=L.filter((r)=>r.salaryCurrency==="CAD");
    if(!L.length)say("INFO",tag,"no New Brunswick (US) row is served");
    else if(cad.length)say(ageH>=24?"FAIL":"INFO",tag,cad.length+" of "+L.length+" New Brunswick (US) rows are paid in CAD"+(ageH>=24?"":"; 20261111110000 re-reads them after the deploy (FAIL from 24 h)")+": "+JSON.stringify(cad.slice(0,3).map((r)=>r.id)));
    else say("PASS",tag,"none of "+L.length+" New Brunswick (US) rows is paid in CAD");}}}

// S14X-063(b), S14X-121.
{const idx=(fs.existsSync("/tmp/vd_bc_r_index.txt")?fs.readFileSync("/tmp/vd_bc_r_index.txt","utf8"):"").split("\n").filter(Boolean).map((l)=>{const [i,k]=l.split("\t");const [kind,key]=[k.slice(0,k.indexOf("|")),k.slice(k.indexOf("|")+1)];return {kind,key,n:total(read("/tmp/vd_bc_r_"+i+".json")),f:"/tmp/vd_bc_r_"+i+".json"}});
  for(const [kind,tag,what] of [["rawNoRows","S14X-063(b)","whose items did not normalise"],["srPartial","S14X-121","whose later SmartRecruiters page failed"]]){
    if(!lo){wait(tag);continue}
    const mine=idx.filter((x)=>x.kind===kind);
    if(!mine.length){say("INFO",tag,"no slice record read here names a board "+what);continue}
    const bad=mine.filter((x)=>x.n===0),un=mine.filter((x)=>x.n===null);
    if(bad.length||un.length)say("FAIL",tag,(bad.length?bad.length+" board(s) "+what+" serve no row (the read was kept, so its rows must stay): "+JSON.stringify(bad.map((x)=>x.key)):"")+(bad.length&&un.length?"; ":"")+(un.length?"the count is unreadable for "+JSON.stringify(un.map((x)=>x.key))+": "+peek(un[0].f):""));
    else say("PASS",tag,mine.length+" board(s) "+what+" still serve rows: "+JSON.stringify(mine.map((x)=>[x.key,x.n])));}}
say("INFO","S14X-216","the log half is proved by a-title-that-differs-only-by-entities-is-our-reading.test.ts, build_ge and section 49; the row half is in the normalize section");
say("INFO","NEW-PAYREWRITE","no live surface of its own: proved by its test, build_ge and section 49");

// Name sync.
{const tag="Name sync";if(!lo)wait(tag);else{const ns=((lo.st.passEnd||{}).steps||{}).names||{};const m=/^name sync v(\d+) (done|complete)/.exec(String(ns.detail||""));
  if(!(m&&Number(m[1])>=7&&Date.parse(ns.doneAt||"")>since))say("INFO",tag,"the names step has not finished v7 on this build: "+JSON.stringify([ns.detail||null,ns.doneAt||null]));
  else{const WANT={creatoriq:"CreatorIQ","harmattan-ai":"Harmattan AI","deag-deutsche-entertainment-ag":"DEAG Deutsche Entertainment AG",americaatwork:"America At Work"};
    for(const p of String(E.VDBC_NAMED).split(" ")){const t=p.slice(p.indexOf(":")+1);const L=rows(read("/tmp/vd_bc_name_"+t+".json"));const tg=tag+" "+p;
      if(!L)say("FAIL",tg,"the list is unreadable: "+peek("/tmp/vd_bc_name_"+t+".json"));
      else if(!L.length)say("INFO",tg,"serves no row to read a name from");
      else{const wrong=L.filter((r)=>r.company!==WANT[t]);say(wrong.length?"FAIL":"PASS",tg,wrong.length?wrong.length+" of "+L.length+" rows still read "+JSON.stringify([...new Set(wrong.map((r)=>r.company))])+", want "+JSON.stringify(WANT[t])+" ("+ns.detail+")":L.length+" row(s) read "+JSON.stringify(WANT[t]));}}}}}

// Retired twins.
{const tag="Retired twins";if(!lo)wait(tag);else{
  if(lo.st.orphanPruneBlocked===false&&!state.unblockedSeenAt)state.unblockedSeenAt=new Date(lo.t).toISOString();
  const serve=Date.parse((((lo.st.passEnd||{}).steps||{}).serve||{}).doneAt||"");const seen=Date.parse(state.unblockedSeenAt||"");
  if(!(serve>seen))say("INFO",tag,"no serve step has finished since a read saw the orphan prune unblocked (blocked now: "+lo.st.orphanPruneBlocked+", catalog "+lo.st.catalogSize+" against high-water "+lo.st.catalogHighwater+"; 20261111120000 resets it)");
  else{const bad=[];let unread=0;for(const k of String(E.VDBC_TWINS).split(" ")){const L=rows(read("/tmp/vd_bc_twin_"+k.replace(":","_")+".json"));if(!L){unread++;continue}const own=L.filter((r)=>String(r.id||"").startsWith(k+":"));if(own.length)bad.push([k,own.length])}
    if(bad.length||unread)say("FAIL",tag,(bad.length?bad.length+" retired board(s) still serve rows after an unblocked prune: "+JSON.stringify(bad):"")+(bad.length&&unread?"; ":"")+(unread?unread+" list(s) unreadable":""));
    else say("PASS",tag,"none of the eight retired source:token boards serves a row");}}}

// lastWrapMin.
{const tag="lastWrapMin";if(!served)say("INFO",tag,"status answered version "+S.version+", not "+serving);
  else if(!("lastWrapMin" in S)||!("lastWrapAt" in S))say("FAIL",tag,"status carries no "+(!("lastWrapMin" in S)?"lastWrapMin":"lastWrapAt"));
  else say("PASS",tag,"status carries lastWrapMin "+S.lastWrapMin+" and lastWrapAt "+S.lastWrapAt);}

// The lap sampler (status.jsonl), and the build that served just before .102: the only build a baseline is read from.
const SAMP=String((()=>{try{return fs.readFileSync(E.VDBC_BASELINE,"utf8")}catch{return ""}})()).split("\n").map((l)=>{try{return JSON.parse(l)}catch{return null}}).filter((x)=>x&&x.status&&typeof x.status==="object"&&Number.isFinite(Date.parse(x.sampledAt))).map((x)=>({t:Date.parse(x.sampledAt),st:x.status,ss:x.status.sliceStats&&typeof x.status.sliceStats==="object"?x.status.sliceStats:null}));
const bv=(b)=>{const m=/^(\d{4}-\d\d-\d\d)\.(\d+)$/.exec(String(b||""));return m?[m[1],Number(m[2])]:null};
const pre=(b)=>{const v=bv(b);return !!v&&(v[0]<"2026-09-09"||(v[0]==="2026-09-09"&&v[1]<102))};
const LAPS=read(E.VDBC_LAPS);const LEDGER=LAPS&&Array.isArray(LAPS.wraps)?LAPS.wraps.filter((w)=>w&&typeof w==="object"):[];
const lastPre=[...SAMP.map((x)=>x.st.version),...LEDGER.map((w)=>w.build)].filter(pre).sort((a,b)=>{const x=bv(a),y=bv(b);return x[0]<y[0]?-1:x[0]>y[0]?1:x[1]-y[1]}).pop()||null;

// Cursor (spec risk 5): the cold cursor moves with the slice count, at no less than half the pre-.102 rate.
{const tag="Cursor";const rate=(xs)=>{let d=0,m=0;for(let i=1;i<xs.length;i++){const a=xs[i-1],b=xs[i];const mm=(b.t-a.t)/60000;
    if(!(mm>0&&mm<=15)||!a.ss||!b.ss||a.ss.lastPhase!=="cold"||b.ss.lastPhase!=="cold")continue;
    const ca=num((a.st.cursor||{}).cold),cb=num((b.st.cursor||{}).cold),n=num(b.st.coldBoards);if(ca===null||cb===null||!n)continue;
    let x=cb-ca;if(x<0)x+=n;if(x>n/2)continue;d+=x;m+=mm}return {d,m,r:m>0?d/m:null}};
  const base=rate(SAMP.filter((x)=>x.st.version===lastPre)),post=rate(ours);
  const sl=ours.map((r)=>num(r.ss.slices)).filter((x)=>x!==null);const dSl=sl.length>1?sl[sl.length-1]-sl[0]:0;
  const tos=[...new Set(ours.map((r)=>(r.ss.cursorStep||{}).to).filter((x)=>typeof x==="number"))];
  const bTxt=base.m>=60?(base.r).toFixed(0)+"/min over "+Math.round(base.m)+" min of cold samples on "+lastPre:"no usable baseline ("+Math.round(base.m)+" min of cold samples on "+lastPre+" in "+E.VDBC_BASELINE+")";
  const s="the cold cursor moved "+post.d+" boards in "+post.m.toFixed(1)+" min of cold reads"+(post.r!==null?" = "+post.r.toFixed(0)+"/min":"")+"; slices +"+dSl+", cursorStep.to "+JSON.stringify(tos.slice(-6))+"; baseline "+bTxt;
  if(!lo)wait(tag);
  else if(post.m<5)say("INFO",tag,s+" (under 5 min of cold reads: the hot phase parks the cursor; VDBC_READS adds reads)");
  else if(dSl>1&&post.d===0)say("FAIL",tag,s+": the slices ran and the cursor did not move (judge liveness by both)");
  else if(base.m>=60&&post.r<0.5*base.r)say("FAIL",tag,s+": under half the pre-.102 rate");
  else say(base.m>=60?"PASS":"INFO",tag,s+(base.m>=60?" (at least half the pre-.102 rate)":""));}

// Lap.
{const tag="Lap";
  const derived=[];const samp=SAMP.filter((x)=>x.st.version===lastPre);
  for(let i=1;i<samp.length;i++){const a=samp[i-1],b=samp[i];const aa=num(a.st.lastRotationAgeMin),ba=num(b.st.lastRotationAgeMin);if(aa===null||ba===null||b.t-a.t>=360*60000)continue;
    const sa=a.t-aa*60000,sb=b.t-ba*60000;if(sb-sa>60*60000)derived.push({endedAt:new Date(sb).toISOString(),wrapMin:Math.round((sb-sa)/60000)})}
  const all=[...derived,...LEDGER.filter((w)=>w.build===lastPre&&num(Number(w.wrapMin))).map((w)=>({endedAt:w.endedAt,wrapMin:Number(w.wrapMin)}))].filter((w)=>Number.isFinite(Date.parse(w.endedAt))).sort((a,b)=>Date.parse(a.endedAt)-Date.parse(b.endedAt));
  const uniq=all.filter((w,i)=>!all.slice(0,i).some((v)=>Math.abs(Date.parse(v.endedAt)-Date.parse(w.endedAt))<15*60000));
  const base=uniq.slice(-3).map((w)=>w.wrapMin);
  const bar=num(Number(E.VDBC_LAP_BAR))||(base.length>=3?Math.round(1.1*Math.max(...base)):null);
  const w=num(S.lastWrapMin),at=Date.parse(S.lastWrapAt||"");const on=w!==null&&Number.isFinite(at)&&Number.isFinite(since)&&at-w*60000>=since;
  const isStale=(r)=>{const cw=r.st.chainWatchdog||{};return num(cw.pulseAgeMs)!==null&&cw.pulseAgeMs>cw.thresholdMs};const stale=ours.filter(isStale).length;
  if(!bar)say("INFO",tag,"fewer than 3 baseline laps on "+lastPre+" ("+JSON.stringify(base)+" from "+E.VDBC_BASELINE+" and "+E.VDBC_LAPS+"; VDBC_LAP_BAR sets the bar), so the lap is not judged; last wrap "+w+" min");
  else if(!lo||!on)say("INFO",tag,"no wrap that began after buildSince yet (last wrap "+w+" min, at "+(S.lastWrapAt||null)+"); bar "+bar+" min");
  else say(w<=bar?"PASS":"FAIL",tag,"the last wrap on this build took "+w+" min (bar "+bar+" = 1.1 x the longest of "+(E.VDBC_LAP_BAR?"the bar given":JSON.stringify(base)+" on "+lastPre)+")");
  say("INFO","Stale-read record",stale+" of "+ours.length+" read(s) of this build were stale (pulseAgeMs > thresholdMs); the sampler saw "+samp.filter(isStale).length+" of "+samp.length+" on "+lastPre+". A record, not a check: one chain death spans several reads 90 s apart, so a share of reads cannot judge one; the owner OD5 log read decides the 1.5x rule");}

try{fs.mkdirSync(require("path").dirname(E.VDBC_STATE),{recursive:true});fs.writeFileSync(E.VDBC_STATE,JSON.stringify(state,null,1)+"\n")}catch{}
'
fi
