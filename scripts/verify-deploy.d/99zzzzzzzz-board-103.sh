# shellcheck shell=bash
# ── 99zzzzzzzz-board-103. JOB-BOARD .103: the lap fix's no-owner core, stated
# Crawl-delays across lanes, the held boards, the catalogue clamp, compound
# role words in every spelling, Greenhouse stated pay and the probe label
# (reservation board-103; jobs-clear-2026-11-17 spec.md and spec-final.md
# section 3.6).
#
# Named 99zzzzzzzz so it sorts after every 99zzzzzzz- file in byte order and
# under a collating locale (verify-deploy.d/README.md).
#
# THE CLOCK. Every line but ROOM is INFO until job-board's preflight answers
# job-board.2026-09-09.103 or later; before that nothing past the preflight is
# read. The search lines are judged as soon as .103 answers (the query rewrite
# is code, not data). Every other line waits for a slice of this build
# (status.sliceStats.build is the serving build) and runs from its buildSince.
#
# THE CLAIMS, one tagged line each:
#   ROOM     job-board/** + _shared/** at HEAD is at or under the 4,440,000
#            trigger (spec section 3.2: ROOM fails at the trigger, not at the
#            4,450,000 guard; VD103_TALLY overrides).
#   build    the preflight answers job-board.2026-09-09.103 or later.
#   P1       W4-2: a pass end of this build chains into hop 0 within 90 s
#            (passEnd.hop0At - passEnd.startedAt). FAIL on two consecutive
#            recorded pass ends over 90 s, or with no hop0At 10 min after start.
#   T1       W4-3: a pass-end tail is done within 10 min of its start. FAIL on
#            two consecutive recorded tails that were not.
#   PC1      item 18: the gate is WIRED. For every paced host in
#            status.pacing, minGapMs is at least the host's delay (the
#            checkout's _shared/host-gate.ts table; an unnamed host is an iCIMS
#            tenant at 5,000 ms), and 12 h after buildSince api.lever.co shows
#            reads (else the gate is blind). minGapMs is the gap between two
#            slots the gate granted, so it cannot see a request that bypasses
#            the gate or starts late: PC1 proves the gate is in the path, not
#            the spacing on the wire.
#   IN1      INST: status carries inst; INFO its stamps and reasons.
#   SA1      SUP-a / W4-2: no double chain. Each status read's slice_stats
#            (at, hop) and (workAt, workHop) are kept in VD103_STATE across
#            runs. FAIL when two samples within 10 min cannot sit on one hop
#            sequence: a later hop that a fresh hop-0 chain could not have
#            reached since the earlier sample (at most one hop per 3 s, +2),
#            arriving after a fall or a climb faster than that. INFO the last
#            chain kick.
#   B1       W4-1: bootstrapQueue.pending never rises between two reads while
#            forVersion is this build and catalogSize is unchanged; and the
#            first pending at this build is at most VD103_M6 + 15 (INFO when
#            VD103_M6, the never-read token count, is not given).
#   B2       W4-1: once pending reached 0 at this build, it stays 0.
#   F1       S2: no freshness sample since the first wrap that began after
#            buildSince reads p50 over 300 min or p95 over 600 min. PASS needs
#            two such wraps and four samples; FAIL needs one sample over.
#   FR1      every status read's freshness.computed_at is at most 35 min old
#            (else F1 is unverified, never PASS).
#   DEFERRED spec section 3.6's SMP, B3, L1, FR, SU1, D1, VR1, R1 and AS1 need
#            the T3 one-minute poller's series (or inputs this section does not
#            have): each prints INFO "unverified" so its absence is visible,
#            and .104 is gated on the owner's reading of them, not on this
#            section's exit code.
#   A1       NB-35: status carries audit; 48 h after buildSince its startedAt is
#            at most 26 h old.
#   DS1      status carries dbBand (null until cost2's ring exists; a stamp
#            with no wal_bytes is banded with the max_wal_size bound). With
#            VD103_COST2_APPLIED_AT set, 26 h after it: a band no older than
#            26 h.
#   H1       H8: once a pass end of this build has finished after a run saw the
#            orphan prune unblocked (stamped in VD103_STATE), no held Workable
#            board serves a row (pre-paste weekday-1 153,
#            mercier-consultancy-group 13).
#   PR1      6 h after buildSince: catalogSize equals this checkout's
#            JOB_SOURCES.length (VD103_CATALOG_SIZE overrides), catalogHighwater
#            equals catalogSize, and orphanPruneBlocked is false (20261117110000
#            applied after the first slice).
#   PR2, RT1, RP1, AG1  from the catalogue lane's fixture (VD103_FIXTURE,
#            src/test/fixtures/board-103-catalogue-2026-11-17.json). INFO when
#            this checkout carries none (the lane had not merged). After the
#            same pass end as H1: no pruned key and no repoint's old key serves
#            a row (vendor-scoped counts, five tokens a call), and
#            usasurveyjob serves none. 48 h after buildSince: a repointed board
#            whose M2 read listed in-window postings serves at least one (the
#            spread against M2 is INFO: a feed moves in two days). 24 h after
#            buildSince: every listed Distro row carries agency true.
#   SR <term>  the 13 most-searched terms of 2026-11-17: ranked is true, and
#            the total (or totalAtLeast) is at or above its floor. Back end,
#            front end and full stack developer have floors that rest on the
#            rewrite (0.7 x a spelling it now reads, measured live before .103:
#            backend developer 281, frontend developer 158, full stack engineer
#            1,917), so a reverted rewrite FAILs; every other term's floor is
#            0.75 x its live count before .103 (never fewer, allowing churn).
#   SR pair  back end/backend, front end/frontend, full-stack/full stack and
#            dev ops/devops developer or engineer read the same total (within
#            2%): one search in every spelling.
#   GH <token>  Greenhouse stated pay: of the newest 60 rows this build read on
#            each of the five measured boards, the share whose pay is the
#            board's own stated range (the formatter's "USD 1,000.00" shape;
#            pay the miner read from the description before .103 does not
#            count, so a pre-.103 read cannot pass) is at least
#            0.6 x the share measured on 2026-11-17 (Coinbase 236/259, Airbnb
#            157/200, Databricks 467/902; Robinhood and Figma had pay before and
#            are the control). Judged with 20 or more re-read rows; FAIL when a
#            board has fewer 48 h after buildSince.
#   PROBE    one logged search of a nonce with x-rb-budget: probe and NO
#            declared caller (the only call here without x-rb-caller, because
#            the backstop it proves is the probe header alone), then INFO the
#            owner's SQL: the nonce's row must read caller maintenance, count 1
#            (0 rows means the search was not logged and proves nothing).
#   Lap      the last wrap that began after buildSince is within the bar:
#            VD103_LAP_BAR, else max(640, the longest .102 wrap in section 90's
#            cold-wraps ledger, VD103_LAPS). INFO until such a wrap exists.
#
# READ-ONLY. One OPTIONS preflight; job-board status and list reads with
# x-rb-budget: probe, x-rb-caller: maintenance and noLog; one logged nonce
# search (PROBE). No vendor request. The only write is the local VD103_STATE
# file.
echo "== 99zzzzzzzz. job-board .103: pass-end chain, tail clock, host pacing, held boards, the clamp, the catalogue lane, search reach, Greenhouse pay, the probe label, the lap =="

VD103_GUARD=4450000; VD103_TRIGGER=4440000
VD103_TALLY="${VD103_TALLY:-$(git ls-tree -r -l HEAD -- supabase/functions/job-board supabase/functions/_shared 2>/dev/null | awk '{s+=$4} END {print s+0}')}"
if ! [ "${VD103_TALLY:-0}" -gt 0 ] 2>/dev/null; then echo "INFO  ROOM: no checkout here to measure the upload against the 4,450,000-byte guard"
elif [ "$VD103_TALLY" -gt "$VD103_GUARD" ]; then echo "FAIL  ROOM: job-board/** + _shared/** at HEAD is $VD103_TALLY bytes, over the 4,450,000 guard: Lovable refuses the upload and the old build keeps serving"
elif [ "$VD103_TALLY" -gt "$VD103_TRIGGER" ]; then echo "FAIL  ROOM: job-board/** + _shared/** at HEAD is $VD103_TALLY bytes, over the 4,440,000 trigger ($((VD103_GUARD - VD103_TALLY)) under the guard): a room step comes before this build ships"
else echo "INFO  ROOM: job-board/** + _shared/** at HEAD is $VD103_TALLY bytes, $((VD103_TRIGGER - VD103_TALLY)) to the 4,440,000 trigger, $((VD103_GUARD - VD103_TALLY)) under the 4,450,000 guard"; fi

rm -f /tmp/vd_103_opt.txt
curl -s -m 30 -D /tmp/vd_103_opt.txt -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "x-rb-caller: maintenance" -H "apikey: $K" -H "Authorization: Bearer $K"
VD103_H=$(cat /tmp/vd_103_opt.txt 2>/dev/null | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD103_LIVE=0
if [ -z "$VD103_H" ]; then echo "FAIL  build: job-board preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge job-board "$VD103_H" "2026-09-09" "103"; then echo "PASS  build: job-board preflight x-fn-build = $VD103_H (job-board.2026-09-09.103 or later)"; VD103_LIVE=1
else echo "INFO  build: job-board preflight x-fn-build = $VD103_H: job-board.2026-09-09.103 is not serving yet, so every .103 line waits for it"; fi

if [ "$VD103_LIVE" = 1 ]; then
  rm -f /tmp/vd_103_*.json /tmp/vd_103_*.t /tmp/vd_103_*.txt
  # Every job-board read here but PROBE's declares itself: probe header, maintenance caller, noLog.
  J103() { curl -s -m 60 -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "x-rb-caller: maintenance" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$1"; }
  VD103_A='"noLog":true'
  VD103_HELD="nogigiddy weekday-1 hire-resolve-the-top-recruitment-agency mercier-consultancy mercier-consultancy-group"
  VD103_GH="coinbase airbnb databricks robinhood figma"
  VD103_STATE="${VD103_STATE:-$HOME/.config/resumebooster/verify-state/board-103.json}"
  VD103_FIXTURE="${VD103_FIXTURE:-src/test/fixtures/board-103-catalogue-2026-11-17.json}"
  VD103_TERMS='back end developer|nurse|software engineer|front end developer|registered nurse|ai engineer|customer success|privacy|product designer|data analyst|devops engineer|full stack developer|pharmacist|backend developer|frontend developer|full-stack developer|dev ops engineer'

  VD103_N="${VD103_READS:-2}"; VD103_I=0
  while [ "$VD103_I" -lt "$VD103_N" ]; do
    [ "$VD103_I" -gt 0 ] && sleep "${VD103_GAP_S:-60}"
    J103 '{"action":"status"}' > "/tmp/vd_103_st_$VD103_I.json"; date +%s > "/tmp/vd_103_st_$VD103_I.t"
    VD103_I=$((VD103_I + 1))
  done
  for VD103_T in $VD103_HELD; do J103 "{\"action\":\"list\",\"companies\":[\"$VD103_T\"],\"vendor\":[\"workable\"],\"countOnly\":true,$VD103_A}" > "/tmp/vd_103_held_$VD103_T.json"; done
  for VD103_T in $VD103_GH; do J103 "{\"action\":\"list\",\"companies\":[\"$VD103_T\"],\"vendor\":[\"greenhouse\"],\"limit\":60,$VD103_A}" > "/tmp/vd_103_gh_$VD103_T.json"; done
  VD103_I=0
  while IFS= read -r VD103_Q; do
    [ -n "$VD103_Q" ] || continue
    J103 "{\"action\":\"list\",\"q\":\"$VD103_Q\",\"limit\":60,$VD103_A}" > "/tmp/vd_103_sr_$VD103_I.json"
    printf '%s\t%s\n' "$VD103_I" "$VD103_Q" >> /tmp/vd_103_sr_index.txt
    VD103_I=$((VD103_I + 1))
  done <<< "$(printf '%s' "$VD103_TERMS" | tr '|' '\n')"

  # The catalogue lane's lists, when this checkout carries its fixture: vendor-scoped counts, five tokens a call.
  if [ -f "$VD103_FIXTURE" ]; then
    VD103_I=0
    while IFS= read -r VD103_C; do
      [ -n "$VD103_C" ] || continue
      J103 "{\"action\":\"list\",${VD103_C#*	},\"countOnly\":true,$VD103_A}" > "/tmp/vd_103_cat_$VD103_I.json"
      printf '%s\t%s\n' "$VD103_I" "${VD103_C%%	*}" >> /tmp/vd_103_cat_index.txt
      VD103_I=$((VD103_I + 1))
    done <<< "$(node -e '
const f=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const out=[];
const q=(keys)=>{const t=keys.map((k)=>k.slice(k.indexOf(":")+1));return "\"companies\":"+JSON.stringify(t)+",\"vendor\":"+JSON.stringify([keys[0].slice(0,keys[0].indexOf(":"))])};
const chunk=(kind,keys)=>{const by=new Map();for(const k of keys){if(typeof k!=="string"||!/^[a-z]+:[A-Za-z0-9~_.-]+$/.test(k))continue;const v=k.slice(0,k.indexOf(":"));if(!by.has(v))by.set(v,[]);by.get(v).push(k)}
  for(const ks of by.values())for(let i=0;i<ks.length;i+=5)out.push(kind+"|"+ks.slice(i,i+5).join(",")+"\t"+q(ks.slice(i,i+5)))};
chunk("pruned",(f.pruned||[]).map((p)=>Array.isArray(p)?p[0]:p));
chunk("from",(f.repointed||[]).map((r)=>r&&r.from));
chunk("retired",f.retired||[]);
for(const r of f.repointed||[])if(r&&typeof r.to==="string"&&/^[a-z]+:[A-Za-z0-9~_.-]+$/.test(r.to))out.push("to|"+r.to+"\t"+q([r.to]));
console.log(out.join("\n"))' "$VD103_FIXTURE" 2>/dev/null)"
    VD103_AG=$(node -e 'try{const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).agency;if(a&&/^[a-z]+:[A-Za-z0-9~_.-]+$/.test(a.key))process.stdout.write(a.key)}catch{}' "$VD103_FIXTURE")
    [ -n "$VD103_AG" ] && J103 "{\"action\":\"list\",\"companies\":[\"${VD103_AG#*:}\"],\"vendor\":[\"${VD103_AG%%:*}\"],\"limit\":20,$VD103_A}" > /tmp/vd_103_agency.json
  fi

  # PROBE: the one logged search, probe header and no declared caller.
  VD103_NONCE="vd103-probe-$(date +%s)-$$"
  curl -s -m 60 -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d "{\"action\":\"list\",\"q\":\"$VD103_NONCE\",\"limit\":1}" > /tmp/vd_103_probe.json

  if [ -n "${VD103_CATALOG_SIZE:-}" ]; then VD103_SIZE="$VD103_CATALOG_SIZE"
  else VD103_SIZE=$(npx --no-install tsx --eval 'import { JOB_SOURCES } from "./supabase/functions/job-board/sources.ts"; process.stdout.write(String(JOB_SOURCES.length));' 2>/dev/null); fi
  VD103_DELAYS="${VD103_DELAYS:-$(node -e 'try{const s=require("fs").readFileSync("supabase/functions/_shared/host-gate.ts","utf8");const b=/HOST_DELAY_MS[^=]*=\s*\{([\s\S]*?)\};/.exec(s);const o={};for(const m of (b?b[1]:"").matchAll(/"([a-z0-9.-]+)"\s*:\s*([0-9_]+)/g))o[m[1]]=Number(m[2].replace(/_/g,""));const d=/ICIMS_DEFAULT_DELAY_MS\s*=\s*([0-9_]+)/.exec(s);o["*"]=d?Number(d[1].replace(/_/g,"")):5000;process.stdout.write(JSON.stringify(o))}catch{}')}"

  VD103_H="$VD103_H" VD103_N="$VD103_N" VD103_STATE="$VD103_STATE" VD103_HELD="$VD103_HELD" VD103_GH="$VD103_GH" VD103_SIZE="$VD103_SIZE" VD103_DELAYS="$VD103_DELAYS" \
  VD103_FIXTURE="$VD103_FIXTURE" VD103_NONCE="$VD103_NONCE" VD103_COST2_APPLIED_AT="${VD103_COST2_APPLIED_AT:-}" VD103_LAP_BAR="${VD103_LAP_BAR:-}" VD103_M6="${VD103_M6:-}" \
  VD103_LAPS="${VD103_LAPS:-$HOME/.config/resumebooster/verify-state/cold-wraps.json}" node -e '
const fs=require("fs");const E=process.env;const H=3600000,MIN=60000,now=Date.now();
const read=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync(f,"utf8").slice(0,160).replace(/\s+/g," ")}catch{return "(no answer)"}};
const say=(v,tag,s)=>console.log(v+"  "+tag+": "+s);
const num=(x)=>(typeof x==="number"&&Number.isFinite(x)?x:null);
const ms=(x)=>(typeof x==="string"?Date.parse(x):NaN);
const serving=String(E.VD103_H||"").replace(/^job-board\./,"");
const tOf=(i)=>{try{const t=Number(fs.readFileSync("/tmp/vd_103_st_"+i+".t","utf8").trim())*1000;return Number.isFinite(t)&&t>0?t:now}catch{return now}};
const reads=[];for(let i=0;i<Number(E.VD103_N);i++){const st=read("/tmp/vd_103_st_"+i+".json");if(st&&typeof st==="object"&&!Array.isArray(st))reads.push({st,t:tOf(i),ss:st.sliceStats&&typeof st.sliceStats==="object"?st.sliceStats:null})}
let state={};try{state=JSON.parse(fs.readFileSync(E.VD103_STATE,"utf8"))||{}}catch{}
const save=()=>{try{fs.mkdirSync(require("path").dirname(E.VD103_STATE),{recursive:true});fs.writeFileSync(E.VD103_STATE,JSON.stringify(state,null,1)+"\n")}catch{}};
const total=(x)=>(x&&typeof x.total==="number"?x.total:null);
const rows=(x)=>(x&&Array.isArray(x.jobs)?x.jobs.filter((r)=>r&&typeof r==="object"):null);

// Search reach: code, not data, so judged as soon as .103 answers.
// [term, live total before .103 (2026-11-17), kind, floor]. reach: the floor rests on the rewrite (0.7 x the
// joined spelling backend developer 281 and frontend developer 158; for full stack, already one spelling, 0.7 x
// full stack engineer 1,917, which developer now finds); kept: 0.75 x before.
const SR=[
  ["back end developer",32,"reach",196],["front end developer",70,"reach",110],["full stack developer",730,"reach",1340],["devops engineer",1117,"kept",838],
  ["software engineer",10000,"kept",7500],["ai engineer",400,"kept",300],["nurse",10000,"kept",7500],["registered nurse",10000,"kept",7500],
  ["customer success",2341,"kept",1756],["privacy",378,"kept",284],["product designer",1365,"kept",1024],["data analyst",1948,"kept",1461],["pharmacist",3293,"kept",2470]];
const idx=new Map(String((()=>{try{return fs.readFileSync("/tmp/vd_103_sr_index.txt","utf8")}catch{return ""}})()).split("\n").filter(Boolean).map((l)=>{const t=l.indexOf("\t");return [l.slice(t+1),l.slice(0,t)]}));
const srOf=(q)=>{const i=idx.get(q);return i===undefined?null:read("/tmp/vd_103_sr_"+i+".json")};
const count=(j)=>(j?(num(j.total)!==null?j.total:num(j.totalAtLeast)):null);
for(const [q,before,kind,floor] of SR){const tag="SR "+q;const j=srOf(q);const n=count(j);
  if(!j||!Array.isArray(j.jobs)){say("FAIL",tag,"the search is unreadable: "+peek("/tmp/vd_103_sr_"+idx.get(q)+".json"));continue}
  const how="total "+(num(j.total)!==null?j.total:"null")+(num(j.totalAtLeast)!==null?" (at least "+j.totalAtLeast+")":"")+", ranked "+j.ranked+", route "+(j.searchRoute??null)+"; live before .103: "+before;
  if(j.ranked!==true)say("FAIL",tag,how+": ranked is not true, so the ranked path did not answer (judge ranked search only by ranked: true)");
  else if(n===null)say("FAIL",tag,how+": no total and no totalAtLeast to judge");
  else if(n<floor)say("FAIL",tag,how+": under the floor "+floor+(kind==="reach"?" (it rests on the rewrite reading every spelling: the rewrite is not live)":" (0.75 x before: fewer jobs reach this search than before .103)"));
  else say("PASS",tag,how+"; floor "+floor);}
for(const [a,b] of [["back end developer","backend developer"],["front end developer","frontend developer"],["full stack developer","full-stack developer"],["devops engineer","dev ops engineer"]]){
  const tag="SR pair "+a+" / "+b;const x=count(srOf(a)),y=count(srOf(b));
  if(x===null||y===null)say("FAIL",tag,"a total is unreadable ("+x+", "+y+")");
  else if(Math.abs(x-y)>Math.max(2,0.02*Math.max(x,y)))say("FAIL",tag,x+" vs "+y+": two spellings of one role read different searches");
  else say("PASS",tag,x+" vs "+y+" (one search in every spelling)");}

// PROBE: the owner reads the row; the nonce search only had to be answered.
{const p=read("/tmp/vd_103_probe.json");
  if(!p||!Array.isArray(p.jobs))say("FAIL","PROBE","the nonce search was not answered as a list: "+peek("/tmp/vd_103_probe.json"));
  else say("INFO","PROBE","owner, service role, a minute after this run: SELECT caller, count(*) FROM job_board_search_events WHERE q = \x27"+E.VD103_NONCE+"\x27 GROUP BY caller; must read maintenance | 1 and no other row (a NULL caller is our probe counted as a visitor; 0 rows means the search was not logged, which proves nothing)");}

if(!reads.length){say("FAIL","status","no status read answered JSON: "+peek("/tmp/vd_103_st_0.json"));save();process.exit(0)}
const S=reads[reads.length-1].st;
const ours=reads.filter((r)=>r.ss&&r.ss.build===serving);const lo=ours[ours.length-1]||null;
const since=lo?ms(lo.ss.buildSince):NaN;const ageH=Number.isFinite(since)?(now-since)/H:null;
const clock=!reads[reads.length-1].ss?"status carries no sliceStats":!lo?"sliceStats.build is "+reads[reads.length-1].ss.build+", not the serving "+serving+": no slice of this build has run yet":ageH===null?"status states no sliceStats.buildSince":"the first slice of this build was "+ageH.toFixed(1)+" h ago";
say("INFO","clock",clock+"; "+reads.length+" status read(s), "+ours.length+" from a slice of this build");
const wait=(tag)=>say("INFO",tag,"waits for a slice of this build ("+clock+")");
if(!lo){for(const t of ["P1","T1","PC1","IN1","SA1","B1","B2","F1","FR1","A1","DS1","H1","PR1","PR2","RT1","RP1","AG1","Lap"])wait(t);for(const t of String(E.VD103_GH).split(" "))wait("GH "+t);save();process.exit(0)}
if(state.build!==serving)state={build:serving,passEnds:[],unblockedAt:null};
if(!Array.isArray(state.passEnds))state.passEnds=[];
for(const k of ["hops","boot","fresh","wraps"])if(!Array.isArray(state[k]))state[k]=[];

// The pass ends this build has run, recorded across runs (two consecutive ones decide P1 and T1).
const pe=S.passEnd&&typeof S.passEnd==="object"?S.passEnd:null;
if(pe&&ms(pe.startedAt)>since){const r={startedAt:pe.startedAt,hop0At:pe.hop0At??null,doneAt:pe.doneAt??null};const i=state.passEnds.findIndex((x)=>x.startedAt===r.startedAt);if(i<0)state.passEnds.push(r);else state.passEnds[i]=r;state.passEnds=state.passEnds.slice(-6)}
const PE=state.passEnds;
{const tag="P1";const gap=(x)=>{const h=ms(x.hop0At),s=ms(x.startedAt);return Number.isFinite(h)?h-s:now-s>10*MIN?Infinity:null};
  const g=PE.map(gap).filter((x)=>x!==null);const late=(x)=>x>90000;const fmt=(x)=>x===Infinity?"no hop0At":Math.round(x/1000)+" s";
  if(!g.length)say("INFO",tag,"no pass end of this build yet (or its hop 0 is not 10 min late)");
  else if(g.length>=2&&late(g[g.length-1])&&late(g[g.length-2]))say("FAIL",tag,"the last two pass ends reached hop 0 after "+g.slice(-2).map(fmt).join(" and ")+" (over 90 s): the pass end does not chain into the next pass");
  else say(late(g[g.length-1])?"INFO":"PASS",tag,"pass end to hop 0: "+g.slice(-3).map(fmt).join(", ")+" (bar 90 s; one late pass end alone is INFO)");}
{const tag="T1";const dur=(x)=>{const d=ms(x.doneAt),s=ms(x.startedAt);return Number.isFinite(d)?d-s:now-s>10*MIN?Infinity:null};
  const g=PE.map(dur).filter((x)=>x!==null);const late=(x)=>x>10*MIN;const fmt=(x)=>x===Infinity?"not done":Math.round(x/MIN)+" min";
  if(!g.length)say("INFO",tag,"no pass-end tail of this build has finished or run 10 min yet");
  else if(g.length>=2&&late(g[g.length-1])&&late(g[g.length-2]))say("FAIL",tag,"the last two tails took "+g.slice(-2).map(fmt).join(" and ")+" (bar 10 min): the names step holds the tail open");
  else say(late(g[g.length-1])?"INFO":"PASS",tag,"tails: "+g.slice(-3).map(fmt).join(", ")+" (bar 10 min)");}

// PC1: every paced host keeps its stated gap.
{const tag="PC1";let D={};try{D=JSON.parse(E.VD103_DELAYS||"{}")||{}}catch{}
  const P=S.pacing;
  if(!P||typeof P!=="object"||Array.isArray(P))say("FAIL",tag,"status carries no pacing object: "+String(JSON.stringify(P)).slice(0,120));
  else if(!D["api.lever.co"])say("FAIL",tag,"the checkout names no delay for api.lever.co (the host-gate table is unreadable here)");
  else{const bad=Object.entries(P).filter(([h,v])=>v&&num(v.minGapMs)!==null&&v.minGapMs<(D[h]??D["*"]??5000));
    const lv=P["api.lever.co"];const blind=ageH>=12&&!(lv&&num(lv.reads)>0);
    const s=Object.keys(P).length+" paced host(s): "+JSON.stringify(Object.entries(P).slice(0,6).map(([h,v])=>[h,v&&v.reads,v&&v.minGapMs]));
    if(bad.length)say("FAIL",tag,bad.length+" host(s) read closer than their stated delay: "+JSON.stringify(bad.slice(0,5).map(([h,v])=>[h,v.minGapMs,D[h]??D["*"]])));
    else if(blind)say("FAIL",tag,"12 h after buildSince api.lever.co shows no paced read: the gate is blind to Lever ("+s+")");
    else if(!Object.values(P).some((v)=>v&&num(v.reads)>0))say("INFO",tag,"no paced read recorded yet ("+s+")");
    else say("PASS",tag,s+"; none under its delay: the gate is wired (it grants slots a delay apart; a read that bypasses it is not seen here)");}}

// IN1, SA1, A1, DS1: the status fields this build adds.
{const I=S.inst;if(!I||typeof I!=="object")say("FAIL","IN1","status carries no inst: the crash stamps are not readable");
  else say("INFO","IN1","inst: "+num(I.countThisBuild)+" stamp(s) on this build; reasons "+JSON.stringify((Array.isArray(I.lastStamps)?I.lastStamps:[]).slice(0,5).map((x)=>x&&[x.reason,x.build,x.at]))+"; heartbeat "+String(JSON.stringify(I.lastHeartbeat)).slice(0,120));}
// SA1: one hop sequence. Hops climb at most one per 3 s (+2 for stamps written seconds apart), and every reset
// starts a fresh chain at hop 0, so two samples within 10 min that no single sequence could join are two chains.
{const tag="SA1";const add=(t,h)=>{if(Number.isFinite(t)&&t>=since+10*MIN&&typeof h==="number"&&!state.hops.some(([x,y])=>x===t&&y===h))state.hops.push([t,h])};
  for(const r of reads)if(r.ss&&r.ss.build===serving){add(ms(r.ss.at),r.ss.hop);add(ms(r.ss.workAt),r.ss.workHop)}
  state.hops=state.hops.filter(([t])=>now-t<=24*H).sort((a,b)=>a[0]-b[0]).slice(-200);
  const Hs=state.hops;let two=null,pairs=0;
  for(let i=0;i<Hs.length&&!two;i++)for(let j=i+1;j<Hs.length&&Hs[j][0]-Hs[i][0]<=10*MIN;j++){pairs++;const [ti,hi]=Hs[i],[tj,hj]=Hs[j];const room=(tj-ti)/3000+2;
    if((hj>=hi&&hj-hi>room)||(hj<hi&&hj>room)){two=[Hs[i],Hs[j]];break}}
  const fmt=(x)=>"hop "+x[1]+" at "+new Date(x[0]).toISOString();const kick="last chain kick "+String(JSON.stringify(S.chainKick??null)).slice(0,160);
  if(two)say("FAIL",tag,fmt(two[0])+" then "+fmt(two[1])+": no one hop sequence holds both, so two chains were advancing within 10 min (a double chain); "+kick);
  else if(!pairs)say("INFO",tag,Hs.length+" hop sample(s), none two within 10 min yet; "+kick);
  else say("PASS",tag,Hs.length+" hop sample(s), "+pairs+" pair(s) within 10 min, one sequence; "+kick);}
// B1 and B2: the bootstrap queue at this build only drains.
{const cs=num(S.catalogSize);for(const r of reads){const b=r.st.bootstrapQueue;if(b&&b.forVersion===serving&&typeof b.pending==="number"&&!state.boot.some((x)=>x[0]===r.t))state.boot.push([r.t,b.pending,num(r.st.catalogSize)])}
  state.boot=state.boot.sort((a,b)=>a[0]-b[0]).slice(-200);const Bs=state.boot;
  let rise=null,regrow=null,zero=null;
  for(let i=0;i<Bs.length;i++){if(zero===null&&Bs[i][1]===0)zero=Bs[i];if(i&&Bs[i][2]===Bs[i-1][2]){if(!rise&&Bs[i][1]>Bs[i-1][1])rise=[Bs[i-1],Bs[i]];if(!regrow&&zero&&Bs[i][0]>zero[0]&&Bs[i][1]>0)regrow=Bs[i]}}
  const m6=Number(E.VD103_M6||"NaN");const first=Bs.length?Bs[0][1]:null;const f=(x)=>x[1]+" at "+new Date(x[0]).toISOString();
  const s1="first pending at this build "+first+(Number.isFinite(m6)?" (bar M6 "+m6+" + 15)":"")+"; "+Bs.length+" read(s) at forVersion "+serving+", catalogSize "+cs;
  if(!Bs.length)say("INFO","B1","no read yet shows the queue at forVersion "+serving+" (bootstrapQueue "+String(JSON.stringify(S.bootstrapQueue??null)).slice(0,120)+")");
  else if(rise)say("FAIL","B1","pending rose from "+f(rise[0])+" to "+f(rise[1])+" at an unchanged version and catalogue: the queue was seeded again");
  else if(Number.isFinite(m6)&&first>m6+15)say("FAIL","B1",s1+": the seed holds more than what is new");
  else say(Number.isFinite(m6)?"PASS":"INFO","B1",s1+(Number.isFinite(m6)?"":" (VD103_M6 unset: the bound is unjudged)"));
  if(regrow)say("FAIL","B2","pending reached 0 at "+new Date(zero[0]).toISOString()+" and was "+f(regrow)+": an empty queue was seeded again at an unchanged version");
  else if(zero)say("PASS","B2","pending reached 0 at "+new Date(zero[0]).toISOString()+" and stayed 0 over "+Bs.filter((x)=>x[0]>zero[0]).length+" later read(s)");
  else say("INFO","B2","pending has not reached 0 at this build yet ("+(Bs.length?Bs[Bs.length-1][1]:"no read")+")");}
// F1 and FR1: freshness on the judged laps (the wraps that began after buildSince).
{const w=num(S.lastWrapMin),wa=ms(S.lastWrapAt);if(w!==null&&Number.isFinite(wa)&&wa-w*MIN>=since&&!state.wraps.some((x)=>x[0]===wa))state.wraps.push([wa,w]);
  state.wraps=state.wraps.sort((a,b)=>a[0]-b[0]).slice(-10);
  const stale=[];for(const r of reads){const fr=r.st.freshness;const c=fr&&ms(fr.computed_at);
    if(!fr||!Number.isFinite(c)||r.t-c>35*MIN)stale.push(fr&&fr.computed_at||null);
    else if(typeof fr.p50_min==="number"&&typeof fr.p95_min==="number"&&!state.fresh.some((x)=>x[0]===c))state.fresh.push([c,fr.p50_min,fr.p95_min])}
  state.fresh=state.fresh.filter(([t])=>t>=since).sort((a,b)=>a[0]-b[0]).slice(-400);
  if(stale.length)say("FAIL","FR1","freshness.computed_at is over 35 min old (or missing) at "+stale.length+" read(s): "+JSON.stringify(stale.slice(0,3))+"; F1 is unverified, never PASS");
  else say("PASS","FR1","freshness.computed_at within 35 min at each of "+reads.length+" read(s)");
  const from=state.wraps.length?state.wraps[0][0]-state.wraps[0][1]*MIN:null;const J=from===null?[]:state.fresh.filter(([t])=>t>=from);
  const over=J.filter(([,p50,p95])=>p50>300||p95>600);const mx=(k)=>J.length?Math.max(...J.map((x)=>x[k])):null;
  const s2=J.length+" sample(s) since the first judged lap began, max p50 "+mx(1)+" min, max p95 "+mx(2)+" min, "+state.wraps.length+" judged wrap(s) seen";
  if(over.length)say("FAIL","F1",s2+": "+over.length+" over p50 300 or p95 600, first "+JSON.stringify([new Date(over[0][0]).toISOString(),over[0][1],over[0][2]])+" (S2 fails: the tranches hold and .104 is the contingency)");
  else if(from===null)say("INFO","F1","no wrap that began after buildSince yet, so no judged lap ("+state.fresh.length+" sample(s) kept)");
  else if(stale.length||state.wraps.length<2||J.length<4)say("INFO","F1",s2+" (unverified: PASS needs two judged wraps, four samples and FR1 PASS)");
  else say("PASS","F1",s2);}
// Spec section 3.6 lines this section does not judge: the T3 poller series (or an input not here) decides them.
for(const [t,why] of [["SMP","the T3 poll series"],["B3","each repointed token\x27s recheckedAt against M6 / 45 per min + 30 min"],["L1","active slice-minutes against M1 over two judged laps"],["FR","the slice-minute delta against M1"],["SU1","recovery after each 546 or RateLimitError from the one-minute poll"],["D1","deaths per 1,000 boards against M1"],["VR1","floored vendors\x27 cold visits a day against M1"],["R1","the T2 robots ledger"],["AS1","the Ashby questions probe (bug round A owns the stop)"]])
  say("INFO",t,"unverified: needs "+why+"; this section does not judge it, so the owner reads it before .104");
{const A=S.audit;if(!A||typeof A!=="object")say("FAIL","A1","status carries no audit stamps");
  else{const st=ms(A.startedAt);const s="audit startedAt "+(A.startedAt??null)+", doneAt "+(A.doneAt??null);
    if(ageH<48)say("INFO","A1",s+" (judged 48 h after buildSince)");
    else if(!Number.isFinite(st)||now-st>26*H)say("FAIL","A1",s+": no audit run started in the last 26 h");
    else say("PASS","A1",s);}}
{const tag="DS1";const has=Object.prototype.hasOwnProperty.call(S,"dbBand");const b=S.dbBand;const c2=ms(E.VD103_COST2_APPLIED_AT||"");
  if(!has)say("FAIL",tag,"status carries no dbBand key");
  else if(!Number.isFinite(c2)||now-c2<26*H)say("INFO",tag,"dbBand "+JSON.stringify(b)+(Number.isFinite(c2)?" (judged 26 h after cost2 applied)":" (VD103_COST2_APPLIED_AT unset: null until cost2s ring carries wal_bytes)"));
  else if(!b||!Number.isFinite(ms(b.at))||now-ms(b.at)>26*H)say("FAIL",tag,"dbBand "+JSON.stringify(b)+": no band read in the last 26 h, 26 h after cost2 applied");
  else say("PASS",tag,"dbBand "+JSON.stringify(b));}

// The clamp and the pass end that follows it.
const blocked=S.orphanPruneBlocked;
if(blocked===false&&!state.unblockedAt)state.unblockedAt=new Date(now).toISOString();
const prunedAfter=Number.isFinite(ms(state.unblockedAt))&&PE.some((x)=>ms(x.doneAt)>ms(state.unblockedAt));
const afterWhy=prunedAfter?"a pass end finished after the prune was seen unblocked":"no pass end has finished since a run saw the orphan prune unblocked"+(state.unblockedAt?" ("+state.unblockedAt+")":" (orphanPruneBlocked "+blocked+")");
{const tag="PR1";const size=Number(E.VD103_SIZE);const cs=num(S.catalogSize),hw=num(S.catalogHighwater);
  const s="catalogSize "+cs+", catalogHighwater "+hw+", orphanPruneBlocked "+blocked+"; this checkout carries "+(Number.isFinite(size)&&size>0?size:"(unreadable)");
  if(!(Number.isFinite(size)&&size>1000))say("INFO",tag,s+" (the checkout catalogue is unreadable here: VD103_CATALOG_SIZE sets it)");
  else if(ageH<6)say("INFO",tag,s+" (judged 6 h after buildSince: 20261117110000 applies after the first slice)");
  else if(cs!==size||hw!==cs||blocked!==false)say("FAIL",tag,s+": "+(cs!==size?"the live catalogue is not this checkout\x27s":hw!==cs?"the high-water is not the catalogue (apply 20261117110000, unedited)":"the orphan prune is blocked"));
  else say("PASS",tag,s);}
{const tag="H1";const c=String(E.VD103_HELD).split(" ").map((t)=>[t,total(read("/tmp/vd_103_held_"+t+".json"))]);
  const bad=c.filter(([,n])=>n===null);const serv=c.filter(([,n])=>n>0);
  if(bad.length)say("FAIL",tag,"unreadable count for "+bad.map(([t])=>t).join(", ")+": "+peek("/tmp/vd_103_held_"+bad[0][0]+".json"));
  else if(!prunedAfter)say("INFO",tag,JSON.stringify(c)+" ("+afterWhy+")");
  else if(serv.length)say("FAIL",tag,JSON.stringify(serv)+": a held board still serves rows after the pass end that prunes them");
  else say("PASS",tag,"the five held boards serve no row ("+afterWhy+")");}

// The catalogue lane, from its fixture.
const FX=read(E.VD103_FIXTURE);
if(!FX){for(const t of ["PR2","RT1","RP1","AG1"])say("INFO",t,"this checkout carries no catalogue-lane fixture ("+E.VD103_FIXTURE+"): the lane had not merged, so .103 prunes, repoints and retires nothing");}
else{
  const cat=new Map(String((()=>{try{return fs.readFileSync("/tmp/vd_103_cat_index.txt","utf8")}catch{return ""}})()).split("\n").filter(Boolean).map((l)=>{const t=l.indexOf("\t");return [l.slice(t+1),total(read("/tmp/vd_103_cat_"+l.slice(0,t)+".json"))]}));
  const of=(kind)=>[...cat.entries()].filter(([k])=>k.startsWith(kind+"|")).map(([k,n])=>[k.slice(kind.length+1),n]);
  const judge=(tag,kinds,what)=>{const c=kinds.flatMap(of);const bad=c.filter(([,n])=>n===null);const serv=c.filter(([,n])=>n>0);
    if(!c.length)say("INFO",tag,"the fixture lists no "+what);
    else if(bad.length)say("FAIL",tag,bad.length+" count(s) unreadable, first "+bad[0][0]);
    else if(!prunedAfter)say("INFO",tag,c.length+" call(s), "+serv.length+" still serving ("+afterWhy+")");
    else if(serv.length)say("FAIL",tag,serv.length+" of "+c.length+" call(s) still serve rows after the pass end that prunes them: "+JSON.stringify(serv.slice(0,5)));
    else say("PASS",tag,c.length+" vendor-scoped call(s) over the "+what+": none serves a row");};
  judge("PR2",["pruned","from"],"pruned keys and repoints\x27 old keys");
  judge("RT1",["retired"],"retired keys");
  {const tag="RP1";const M=new Map((FX.repointed||[]).filter((r)=>r&&r.to).map((r)=>[r.to,r]));const c=of("to");
    const zero=c.filter(([k,n])=>n===0&&(M.get(k)||{}).inWindow>0);const spread=c.filter(([k,n])=>{const w=(M.get(k)||{}).inWindow;return typeof w==="number"&&n!==null&&Math.abs(n-w)>Math.max(3,0.15*w)}).map(([k,n])=>[k,n,(M.get(k)||{}).inWindow]);
    if(!c.length)say("INFO",tag,"the fixture lists no repoint");
    else if(c.some(([,n])=>n===null))say("FAIL",tag,"a repointed board\x27s count is unreadable");
    else if(ageH<48)say("INFO",tag,c.length+" repointed board(s); serving none yet: "+JSON.stringify(zero.map(([k])=>k).slice(0,8))+" (judged 48 h after buildSince)");
    else if(zero.length)say("FAIL",tag,zero.length+" repointed board(s) serve no row though M2 read in-window postings: "+JSON.stringify(zero.slice(0,8)));
    else say("PASS",tag,c.length+" repointed board(s) serve rows");
    if(c.length)say("INFO","RP1 spread","outside max(3, 15%) of the M2 in-window count: "+JSON.stringify(spread.slice(0,10))+" (a feed moves; INFO)");}
  {const tag="AG1";const L=rows(read("/tmp/vd_103_agency.json"));const key=FX.agency&&FX.agency.key;
    if(!key)say("INFO",tag,"the fixture names no agency board");
    else if(!L)say("FAIL",tag,key+": the list is unreadable: "+peek("/tmp/vd_103_agency.json"));
    else if(!L.length)say("INFO",tag,key+" serves no row to judge");
    else if(ageH<24)say("INFO",tag,key+": "+L.filter((r)=>r.agency===true).length+" of "+L.length+" listed rows carry agency true (judged 24 h after buildSince)");
    else{const off=L.filter((r)=>r.agency!==true);say(off.length?"FAIL":"PASS",tag,key+": "+(L.length-off.length)+" of "+L.length+" listed rows carry agency true");}}
}

// GH: Greenhouse stated pay on the five measured boards.
const GHM={coinbase:[236,259],airbnb:[157,200],databricks:[467,902],robinhood:[157,166],figma:[92,139]};
for(const t of String(E.VD103_GH).split(" ")){const tag="GH "+t;const L=rows(read("/tmp/vd_103_gh_"+t+".json"));const [p,n]=GHM[t]||[0,1];const want=p/n;
  if(!L){say("FAIL",tag,"the list is unreadable: "+peek("/tmp/vd_103_gh_"+t+".json"));continue}
  const fresh=L.filter((r)=>ms(r.recheckedAt)>since||ms(r.lastSeen)>since);const paid=fresh.filter((r)=>typeof r.salary==="string"&&/^[A-Z]{3} \d[\d,]*\.\d{2}\b/.test(r.salary)).length;
  const s=paid+" of "+fresh.length+" rows this build read carry the board\x27s stated range ("+L.length+" listed; pay mined from the description does not count); measured share "+(want*100).toFixed(0)+"%"+(t==="robinhood"||t==="figma"?" (control: pay before .103 too)":"");
  if(fresh.length<20)say(ageH>=48?"FAIL":"INFO",tag,s+(ageH>=48?": under 20 rows re-read 48 h after buildSince":" (judged with 20 re-read rows)"));
  else if(paid/fresh.length<0.6*want)say("FAIL",tag,s+": under 0.6 x the measured share, so the stated range does not reach the row");
  else say("PASS",tag,s);}

// Lap.
{const tag="Lap";const LAPS=read(E.VD103_LAPS);const led=LAPS&&Array.isArray(LAPS.wraps)?LAPS.wraps.filter((w)=>w&&w.build==="2026-09-09.102"&&num(Number(w.wrapMin))):[];
  const bar=num(Number(E.VD103_LAP_BAR))||Math.max(640,...led.map((w)=>Number(w.wrapMin)));
  const w=num(S.lastWrapMin),at=ms(S.lastWrapAt);const on=w!==null&&Number.isFinite(at)&&at-w*MIN>=since;
  if(!on)say("INFO",tag,"no wrap that began after buildSince yet (last wrap "+w+" min, at "+(S.lastWrapAt??null)+"); bar "+bar+" min");
  else say(w<=bar?"PASS":"FAIL",tag,"the last wrap on this build took "+w+" min (bar "+bar+" = "+(E.VD103_LAP_BAR?"the bar given":"max(640, "+led.length+" .102 wrap(s) in the ledger)")+")");}
save();
'
fi
