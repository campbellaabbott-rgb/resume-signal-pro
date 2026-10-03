#!/usr/bin/env bash
# READ-ONLY post-deploy proof. Sequential, anon key only (plus the owner's own
# free /v1 key from .env.local for the keyed MCP checks). Every line is a claim
# a deploy note made; each prints PASS / FAIL / INFO. Never a write, never a
# refresh/sweep/backfill/verify action, never anything to an employer system.
#
# Lives in the repository (scripts/verify-deploy.sh) since 2026-09-21, after a
# workflow cleanup deleted the scratchpad copy that had grown over a week.
# Usage: bash scripts/verify-deploy.sh   (from anywhere; it cd's to the repo)
set -u
cd "$(dirname "$0")/.."
K=$(grep -h '^VITE_SUPABASE_PUBLISHABLE_KEY\|^VITE_SUPABASE_ANON' .env | head -1 | sed -E 's/^[^=]+=//; s/"//g')
RB=$(grep -h '^RB_API_KEY' .env.local 2>/dev/null | sed -E 's/^[^=]+=//; s/"//g')
B=https://bwhdazbotpblihdxcmho.supabase.co
SITE=https://resumebooster.work
UA="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
# x-rb-budget: probe -- since .85 the board counts anonymous reads per address,
# and this script is our own tooling, not a browser (job-board/anon-budget.ts).
J() { curl -s -m 60 -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$1"; }
R() { curl -s -m 60 -X POST "$B/rest/v1/rpc/$1" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d "${2:-{\}}"; }
MC() { curl -s -m 60 -X POST "$B/functions/v1/agent-mcp" -H "Content-Type: application/json" -H "apikey: $K" -H "mcp-protocol-version: 2025-06-18" "$@"; }
# Table probes select `*`: a named column that the table lacks answers 400 before
# the permission check runs, which reads as anything but the 401 it should be.
# A refusal probe: 42501 = revoked by name (good); PGRST202 = wrong argument names, NOT absence.
probe() { local out; out=$(R "$1" "$2"); local code; code=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
  case "$code" in 42501) echo "PASS  $1 as anon -> 42501 (revoked by name)";; PGRST202) echo "INFO  $1 -> PGRST202 (argument names differ from the migration, or not applied)";; *) echo "FAIL  $1 as anon -> $code  $(printf '%s' "$out" | head -c 200)";; esac; }
title() { curl -s -m 30 -A "$UA" "$SITE$1" | grep -oE "<title>[^<]*</title>" | head -1; }

echo "== 1. job-board bundle =="
J '{"action":"status"}' > /tmp/vd_status.json
node -e '
const j=require("/tmp/vd_status.json");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
ok(/^2026-09-09\.7[3-9]$|^2026-09-09\.[89]|^2026-09-1/.test(String(j.version)),"status.version = "+j.version+" (want .73 or later)");
ok(j.catalogSize===44519,"catalogSize = "+j.catalogSize+" (want 44519)");
ok(j.orphanPruneBlocked===false,"orphanPruneBlocked = "+j.orphanPruneBlocked+" (want false)");
const hw=j.catalogHighwater; ok(typeof hw==="number"?hw<=j.catalogSize:true,"catalogHighwater = "+JSON.stringify(hw)+" (want <= catalogSize)");
const f=j.freshness||{}; console.log("INFO  freshness p50="+f.p50_min+" p95="+f.p95_min+" max="+f.max_min+" (SLA claims 480 / 1,440)");
const ck=j.chainKick||{}; console.log("INFO  chainKick outcome="+ck.outcome+" fromHop="+ck.fromHop+" ageMin="+ck.ageMin);
const r=j.recategorize||{}; console.log("INFO  recategorize rulesVersion="+r.rulesVersion+" stampedVersion="+r.stampedVersion);
const sl=j.staleLane||{}; console.log((sl.windowFull===false?"PASS":"INFO")+"  staleLane.windowFull="+sl.windowFull+" excluded="+sl.excluded);'

echo "== 2. the Remote filter returns no negated titles =="
J '{"action":"list","q":"non-remote","workMode":"remote","limit":10}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const bad=(j.jobs||[]).filter(r=>/\b(non[- ]?remote|not remote|no remote)\b/i.test(r.title||""));console.log((bad.length===0?"PASS":"FAIL")+"  negated-remote titles under workMode=remote: "+bad.length)})'

echo "== 3. company counts are servable =="
J '{"action":"list","limit":1,"includeFacets":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const c=(j.companies||[])[0]||{};console.log((("open" in c)&&!("count" in c)?"PASS":"FAIL")+"  facet row carries `open` and no `count`");console.log("INFO  companiesOpenCount="+j.companiesOpenCount+" totalAllCompanies="+j.totalAllCompanies)})'

echo "== 4. S(30): columns present, the 1.0 leak not live (rows from the hourly cache) =="
# ONE READ SERVES 4, 4a, 4b, 4d AND 4e. Until 2026-09-27 each of those sections
# called the category curve RPC live -- five calls a run at 34-60s each -- and
# that day the function began exhausting its own 60s statement_timeout on the
# REST path (34s on 09-25, 47s at 14:xx, no rows at 18:xx and 23:xx). The two
# pages that had called it on every visit moved the same evening to reading it
# from refresh_stats_cache's fill_curve arm, so the claim this file checks is
# the one a visitor now sees: the rows in stats_cache.fill_curve, and WHEN they
# were computed. The live function is observed once, in 4e, as INFO: it is no
# longer on any path a visitor waits on, and its header may now run to minutes.
#
# Two storage shapes are accepted because the arm and this file were written
# in the same hour by different hands: a bare array of rows (dated by the
# cache root's computed_at, or a sibling fill_curve_computed_at), or
# {computed_at, rows} -- the actively_hiring shape -- dated by its own stamp.
# stale_parts naming the curve means the last refresh kept the previous rows.
MAX_CACHE_MS=2000
MAX_CURVE_AGE_H=3
export MAX_CACHE_MS MAX_CURVE_AGE_H
T0=$(date +%s.%N); R get_stats_cache '{}' > /tmp/vd_sc.json; T1=$(date +%s.%N)
node -e '
const fs=require("fs");const t0=Number(process.argv[1]),t1=Number(process.argv[2]);
let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_sc.json","utf8"))}catch{}
const c=(j&&!Array.isArray(j))?j:(Array.isArray(j)&&j[0])?j[0]:{};
const fc=c.fill_curve;
const rows=Array.isArray(fc)?fc:(fc&&typeof fc==="object"&&Array.isArray(fc.rows))?fc.rows:null;
const own=(fc&&!Array.isArray(fc)&&typeof fc.computed_at==="string")?fc.computed_at:(typeof c.fill_curve_computed_at==="string"?c.fill_curve_computed_at:null);
const stale=Array.isArray(c.stale_parts)?c.stale_parts:[];
fs.writeFileSync("/tmp/vd_cat.json",JSON.stringify(rows));
const err=(c.fill_curve_error&&typeof c.fill_curve_error==="object")?c.fill_curve_error:null;
const variant=(fc&&!Array.isArray(fc)&&fc.variant&&typeof fc.variant==="object")?fc.variant:null;
fs.writeFileSync("/tmp/vd_cat_meta.json",JSON.stringify({cache_ms:Math.round((t1-t0)*1000),cache_keys:Object.keys(c),present:"fill_curve" in c,rows:rows?rows.length:null,own_stamp:own,computed_at:own||(typeof c.computed_at==="string"?c.computed_at:null),root_computed_at:c.computed_at??null,carried:stale.includes("fill_curve"),stale_parts:stale,error:err,variant:variant}));
' "$T0" "$T1"
# Every section below reads what the read above wrote: rows = the curve rows
# or null, m = the meta beside them. No section re-fetches.
CAT() { node -e 'const fs=require("fs");const MAX_CACHE_MS=Number(process.env.MAX_CACHE_MS),MAX_CURVE_AGE_H=Number(process.env.MAX_CURVE_AGE_H);const m=JSON.parse(fs.readFileSync("/tmp/vd_cat_meta.json","utf8"));let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_cat.json","utf8"))}catch{}const rows=Array.isArray(j)&&j.length?j:null;const N=v=>v===null||v===undefined?null:Number(v);(()=>{'"$1"'})();'; }
CAT 'if(!rows)return console.log("FAIL  no fill_curve rows in the cache (4e says why)");
console.log(("still_open_30" in rows[0]?"PASS":"FAIL")+"  still_open_30 present ("+rows.length+" rows)");
console.log((rows.filter(r=>r.still_open_30===1).length===0?"PASS":"FAIL")+"  no field publishes still_open_30 = 1.0");'

# ── 4a-4e. THE POSITIVE CONTROL ON THE DAY-30 GATE (20260925163517 / 163842 /
# 164237 / 164510). Section 4 above predates this deploy and CANNOT tell a
# silent non-apply from a success: it asserts still_open_30 is present and that
# no FIELD publishes exactly 1.0, and both were already true before the change
# (fields ran 0.4725-0.5976; the offending BOARDS published the 1.0). Everything
# below is a claim this deploy makes, judged by behaviour, because migrations
# here go through a staged runner that has been observed editing a file and
# staging it under another name.
echo "== 4a. the re-issued curves publish the counts their gate is built from =="
# The category rows come from the cache read above; the company curve is
# token-scoped and cheap, so it is still read live.
CAT 'if(!rows)return console.log("FAIL  cached category curve rows absent (not written, or the arm timed out on every run so far)");
const need=["events_30","fills_30","relists_30"];
const missing=need.filter(k=>!(k in rows[0]));
// WITHOUT THIS THE FRONTEND WITHHOLDS ALL EIGHTEEN FIELDS FOREVER AND LOOKS
// LIKE A WORKING DEPLOY: its uncontrolled path refuses any row with no
// published event count, so a non-apply is indistinguishable from a page that
// simply has nothing to say until this key is present.
console.log((missing.length===0?"PASS":"FAIL")+"  cached category curve: events_30/fills_30/relists_30 present on the row ("+rows.length+" rows)"+(missing.length?" MISSING "+missing.join(","):""));
for(const k of ["top_board_share_30","dated_cohort_n_30"])
  console.log((k in rows[0]?"PASS":"FAIL")+"  cached category curve: "+k+" present (the two disclosures a pooled figure needs)");'
R get_company_fill_curve '{"p_tokens":["dominos","workday~wd5~Workday"]}' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const fn="get_company_fill_curve";
let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  "+fn+" non-JSON (not applied, or it timed out)")}
if(!Array.isArray(j))return console.log("FAIL  "+fn+" -> "+JSON.stringify(j).slice(0,160));
if(!j.length)return console.log("INFO  "+fn+" returned no rows");
const need=["events_30","fills_30","relists_30"];
const missing=need.filter(k=>!(k in j[0]));
console.log((missing.length===0?"PASS":"FAIL")+"  "+fn+": events_30/fills_30/relists_30 present on the row ("+j.length+" rows)"+(missing.length?" MISSING "+missing.join(","):""));
})'

echo "== 4b. no published share rests on fewer events, fills or precision than the gate names =="
# Judged on the cached rows: they ARE the rows the page renders, and the
# 240-second live read this section used to make is the call that stopped
# answering. Same gates as before.
CAT 'if(!rows)return console.log("FAIL  no cached category rows to judge the gate on");
const MIN_EVENTS=5, MIN_FILLS=5, MAX_HW=0.15, MAX_REL=0.5;
const bad=(pred)=>rows.filter(r=>r.sufficient_30===true&&pred(r)).map(r=>r.category);
const noEv=bad(r=>N(r.events_30)===null||N(r.events_30)<MIN_EVENTS);
const noFi=bad(r=>N(r.fills_30)===null||N(r.fills_30)<MIN_FILLS);
const rel =bad(r=>N(r.relists_30)!==null&&N(r.fills_30)!==null&&N(r.relists_30)>N(r.fills_30));
const hw  =bad(r=>{const lo=N(r.still_open_30_lo),hi=N(r.still_open_30_hi);return lo===null||hi===null||(hi-lo)/2>MAX_HW});
// THE TERM AN ABSOLUTE WIDTH CANNOT EXPRESS: a half-width wider than this share
// of the complement pins nothing, however narrow it is in points.
const prec=bad(r=>{const v=N(r.still_open_30),lo=N(r.still_open_30_lo),hi=N(r.still_open_30_hi);
  return v===null||lo===null||hi===null||v>=1||(hi-lo)/2>MAX_REL*(1-v)});
const line=(n,label)=>console.log((n.length===0?"PASS":"FAIL")+"  "+label+(n.length?": "+n.join(", "):""));
line(noEv,"sufficient_30 with events_30 below the floor");
line(noFi,"sufficient_30 with fills_30 below the floor");
line(rel,"sufficient_30 with relists outnumbering fills");
line(hw,"sufficient_30 with an absolute half-width over the ceiling");
line(prec,"sufficient_30 with a half-width wider than half its own complement");
console.log("INFO  sufficient_30 true on "+rows.filter(r=>r.sufficient_30===true).length+" of "+rows.length+" fields");'

echo "== 4c. the board that opened the defect is refused, by its own published count =="
# p_tokens is PLURAL; p_token singular answers nothing. dominos published
# still_open_30=1.0000 with a zero-width interval and sufficient_30 true on
# 21,708 observations before this change.
R get_company_fill_curve '{"p_tokens":["dominos","oreillyauto~wd1~oreilly","workday~wd5~Workday"]}' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  non-JSON")}
if(!Array.isArray(j))return console.log("FAIL  "+JSON.stringify(j).slice(0,160));
for(const r of j){
  const t=r.company_token, ev=r.events_30, suf=r.sufficient_30, s30=r.still_open_30;
  if(t==="workday~wd5~Workday"){console.log("INFO  "+t+" (the control): S30="+s30+" events_30="+ev+" sufficient_30="+suf);continue;}
  const ok = suf!==true;
  console.log((ok?"PASS":"FAIL")+"  "+t+" refused: S30="+s30+" events_30="+ev+" sufficient_30="+suf);
}})'

echo "== 4d. the coverage the new pool leaves, per field, and how much of it is one board =="
# Not a PASS/FAIL: gate_share_30 ran 0.7381-0.9150 across the eighteen fields at
# 2026-09-25T21:33Z, before this change, and it MUST fall. Printing it is what
# makes the drop visible, and top_board_share_30 is the residual the control
# does not close -- a cap on it would need exactly this measurement first.
CAT 'if(!rows)return console.log("INFO  no cached category rows to print");
for(const r of rows)console.log("INFO  "+String(r.category).padEnd(20)+" gate_share="+String(r.gate_share_30).padEnd(7)+" top_board="+String(r.top_board_share_30).padEnd(7)+" S30="+String(r.still_open_30).padEnd(7)+" n="+String(r.n_at_risk_30).padEnd(7)+" events="+String(r.events_30).padEnd(6)+" sufficient="+r.sufficient_30);'

echo "== 4e. the field curve is served from the hourly cache, and the cache says when =="
# THE VERDICT HERE IS THE CACHE PATH: how fast get_stats_cache answered, whether
# its fill_curve part carries rows, and how old the stamp on THOSE rows is.
# Before 2026-09-27 this section timed the live function and passed under 45s
# with rows; the pages no longer wait on that call, so its speed is no longer a
# claim a visitor can feel. A cache that is present but stale must show as
# stale -- the bar is the hourly cron plus two missed runs. When stale_parts
# names the curve the last refresh kept the previous rows and their earlier
# stamp; that is reported, and the page must print that stamp, not the root.
CAT 'console.log((m.cache_ms<MAX_CACHE_MS?"PASS":"FAIL")+"  get_stats_cache answered in "+m.cache_ms+"ms (bar "+MAX_CACHE_MS+"ms; the pages read this and nothing slower)");
if(!m.present)return console.log("FAIL  stats_cache carries no fill_curve key (keys: "+m.cache_keys.join(",")+"; root computed_at "+m.root_computed_at+"). The refresh_stats_cache arm runs at :27 each hour (20260928011742; :12 before it) -- if that root stamp postdates the migration, the arm did not land");
if(!rows)return console.log("FAIL  fill_curve present but carries no rows: "+JSON.stringify({own_stamp:m.own_stamp,carried:m.carried,stale_parts:m.stale_parts}));
const ageH=(Date.now()-Date.parse(m.computed_at))/36e5;
console.log((Number.isFinite(ageH)&&ageH<MAX_CURVE_AGE_H?"PASS":"FAIL")+"  fill_curve computed_at="+m.computed_at+" ("+ageH.toFixed(2)+"h old, bar "+MAX_CURVE_AGE_H+"h; "+rows.length+" rows; own stamp on the part: "+(m.own_stamp?"yes":"no, root used")+")");
if(m.carried)console.log("INFO  stale_parts names fill_curve: these rows were carried forward from an earlier run; the page must print "+m.computed_at+", not the root "+m.root_computed_at);
if(m.error)console.log("INFO  fill_curve_error on this run: reason="+m.error.reason+" sqlstate="+(m.error.sqlstate||"-")+" at="+m.error.at+" -- "+String(m.error.message||"").slice(0,160)+" (57014 after ~300s = the callee header fired; after ~600s = the outer; after ~1800s = the role default)");
if(m.variant)console.log(((m.variant.p_days===90&&m.variant.p_min_n===300)?"PASS":"FAIL")+"  fill_curve.variant = "+JSON.stringify(m.variant)+" (the pages and /v1 claim the (90, 300) variant)");'
# ONE LIVE OBSERVATION, INFO ONLY, NEVER A VERDICT, AND OFF BY DEFAULT. The
# function's own header is five minutes (20260928003117) and it is still
# anon-callable; a client that gives up at 70s does not cancel the statement
# on the server, so every run of this script would otherwise pin a pooled
# connection for the full header on a path no visitor waits on. Opt in with
# SKIP_LIVE_CURVE=0 when the observation is wanted; the default skips it.
if [ "${SKIP_LIVE_CURVE:-1}" != "1" ]; then
  T0=$(date +%s); curl -s -m 70 -X POST "$B/rest/v1/rpc/get_category_fill_curve" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"p_days":90,"p_min_n":300}' > /tmp/vd_cat_live.json; T1=$(date +%s)
  node -e 'const fs=require("fs");const t=Number(process.argv[1]);let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_cat_live.json","utf8"))}catch{}
const answered=Array.isArray(j)&&j.length>0;
console.log("INFO  live get_category_fill_curve(90,300) on the REST path: "+(answered?j.length+" rows in "+t+"s":(j===null?"no answer within 70s":"no rows in "+t+"s -- "+JSON.stringify(j).slice(0,120)))+" (34s on 09-25, 60s timeouts on 09-27; no visitor waits on this path now)")' "$((T1-T0))"
fi

echo "== 4g. /v1/stats serves the same cached curve to API customers, with its date =="
# /v1 IS NOT ANON-REACHABLE, BY DESIGN: every path past the index requires a
# /v1 key (Authorization: Bearer <key>, checked by api_key_check), and the
# project anon JWT is not one -- measured 2026-09-27T23:55Z: 401 invalid_key.
# The first line below proves that refusal still holds. The read path is the
# owner's own free key from .env.local (RB_API_KEY); without it the rest of
# this section is INFO, not a failure of the deploy.
acode=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$B/functions/v1/public-api/v1/stats" -H "Authorization: Bearer $K" -H "apikey: $K")
[ "$acode" = "401" ] && echo "PASS  /v1/stats with the anon JWT -> 401 (a /v1 key is required; the anon key is not one)" || echo "FAIL  /v1/stats with the anon JWT -> $acode (expected 401)"
if [ -z "$RB" ]; then
  echo "INFO  RB_API_KEY missing from .env.local -- the keyed read of /v1/stats is skipped"
else
  vcode=$(curl -s -m 40 -o /tmp/vd_v1s.json -D /tmp/vd_v1s.h -w '%{http_code}' "$B/functions/v1/public-api/v1/stats" -H "Authorization: Bearer $RB" -H "apikey: $K")
  VCODE="$vcode" VVER="$(tr -d '\r' < /tmp/vd_v1s.h | grep -i '^x-api-version:' | sed -E 's/^[^:]+: *//')" node -e '(()=>{
const fs=require("fs");const MAX_CURVE_AGE_H=Number(process.env.MAX_CURVE_AGE_H);
let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_v1s.json","utf8"))}catch{}
let m={};try{m=JSON.parse(fs.readFileSync("/tmp/vd_cat_meta.json","utf8"))}catch{}
console.log((process.env.VCODE==="200"?"PASS":"FAIL")+"  GET /v1/stats with the owner key -> HTTP "+process.env.VCODE+" X-Api-Version="+process.env.VVER+" apiVersion="+(j&&j.apiVersion));
const l=j&&j.data&&j.data.lifecycle;
if(!l)return console.log("FAIL  data.lifecycle is null: ghost_stats missing from the cache the endpoint read");
const fc=l.fillCurve;
const served=!!(fc&&Array.isArray(fc.data)&&fc.data.length>0);
console.log((served?"PASS":"FAIL")+"  data.lifecycle.fillCurve "+(served?"carries "+fc.data.length+" fields":"is "+JSON.stringify(fc))+" -- the endpoint reads stats_cache.fill_curve, the key 4e judged");
// THE DEPRECATION NOTICE MUST POINT AT A FIELD THAT IS IN THE PAYLOAD. The
// basis is written twice in the function and which one ships is decided by
// whether fillCurve is served; this line checks that the two agree.
const names=/Use fillCurve below instead\./.test(String(l.medianDaysToCloseBasis||""));
console.log(((served?names:!names)?"PASS":"FAIL")+"  medianDaysToCloseBasis "+(names?"names the replacement":"says the replacement is not served yet")+" and fillCurve is "+(served?"served":"null"));
if(!served)return;
const ageH=(Date.now()-Date.parse(String(fc.asOf)))/36e5;
console.log((Number.isFinite(ageH)&&ageH<MAX_CURVE_AGE_H?"PASS":"FAIL")+"  fillCurve.asOf="+fc.asOf+" ("+ageH.toFixed(2)+"h old, bar "+MAX_CURVE_AGE_H+"h) carriedForward="+fc.carriedForward);
console.log((m.computed_at&&fc.asOf===m.computed_at?"PASS":"INFO")+"  fillCurve.asOf "+(fc.asOf===m.computed_at?"equals":"differs from")+" the cache stamp 4e read ("+m.computed_at+")"+(fc.asOf===m.computed_at?"":" -- an hourly refresh between the two reads explains one run of difference"));
console.log(("carriedForward" in fc?"PASS":"FAIL")+"  fillCurve publishes carriedForward (the flag that makes a kept curve visibly older than the cache around it)");
})();'
fi

echo "== 4f. the third day-30 chain on the same page carries the same control =="
R get_layoff_partition '{}' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  non-JSON")}
const rows=Array.isArray(j)?j:[j];
if(!rows.length||!rows[0])return console.log("FAIL  get_layoff_partition returned nothing");
const need=["lp_events_30","lp_fills_30","lp_relists_30","lp_min_events","lp_max_rel_half_width"];
const missing=need.filter(k=>!(k in rows[0]));
console.log((missing.length===0?"PASS":"FAIL")+"  get_layoff_partition publishes the control"+(missing.length?" MISSING "+missing.join(","):""));
for(const r of rows){
  const ev=r.lp_events_30, suf=r.lp_sufficient_30;
  // A row written before 20260925164237 carries NULL here and must not be
  // sufficient: the writer coalesces the count to zero on every row it writes,
  // so NULL means one thing only.
  const ok = !(suf===true && (ev===null||ev===undefined||Number(ev)<5));
  console.log((ok?"PASS":"FAIL")+"  "+r.lp_arm+": sufficient_30="+suf+" events_30="+ev+" fills="+r.lp_fills_30+" relists="+r.lp_relists_30+" reason="+r.lp_reason+" S30="+r.lp_still_open_30+" n="+r.lp_n_at_risk_30);
}
console.log("INFO  a reason of `uncontrolled` here means the migration applied and the refresh has not re-run yet");
})'

echo "== 5d. vendor counts on the facets action (board-wide, one stamp) =="
J '{"action":"facets"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const src=j.sources||{};const cats=j.categories||{};const a=Object.values(src).reduce((x,y)=>x+y,0),b=Object.values(cats).reduce((x,y)=>x+y,0);console.log((Object.keys(src).length>=15?"PASS":"FAIL")+"  sources has "+Object.keys(src).length+" keys");console.log((a===b?"PASS":"FAIL")+"  sum(sources)="+a.toLocaleString()+" vs sum(categories)="+b.toLocaleString());console.log((Object.values(src).every(v=>v!==10000)?"PASS":"FAIL")+"  no source count equals the 10,000 list cap")})'

echo "== 5f. field-panel percentages are the field’s own (hourly field_grid) =="
R get_explore_cache '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  explore cache non-JSON")}const g=(Array.isArray(j)?j[0]:j)||{};const fg=g.field_grid||g.fieldGrid||{};const F=fg.fields||fg;const pct=(k)=>{const f=F[k];return f&&f.n?Math.round(100*(f.work_mode_n||0)/f.n):null};const a=pct("finance"),b=pct("design");console.log((a!==null&&b!==null&&a!==b?"PASS":"INFO")+"  finance work-mode share="+a+"%  design="+b+"% (board-wide was 23% for both)")})'

echo "== 5g. the leaderboard is timed (its own aggregation, 9-25s live) =="
T0=$(date +%s.%N); R get_actively_hiring_companies '{"p_limit":20}' > /dev/null; T1=$(date +%s.%N); echo "INFO  get_actively_hiring_companies answered in $(echo "$T1 - $T0" | bc)s"

echo "== 5i. the leaderboard answers from the hourly cache =="
R get_stats_cache '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const a=j.actively_hiring;const sp=j.stale_parts||[];if(!a)return console.log("INFO  no actively_hiring in the cache yet");const rows=Array.isArray(a.rows)?a.rows.length:(Array.isArray(a)?a.length:null);console.log((rows===20?"PASS":"FAIL")+"  cache.actively_hiring carries "+rows+" rows");console.log((a.computed_at?"PASS":"FAIL")+"  own computed_at = "+a.computed_at);console.log((sp.includes("actively_hiring")?"INFO":"PASS")+"  stale_parts="+JSON.stringify(sp))})'

echo "== 5j. the Other-bucket machinery is closed to every client role =="
probe promote_category '{"p_basis":"rule","p_key":"commis","p_target":"hospitality_retail"}'
probe revert_category '{"p_basis":"rule","p_key":"commis"}'
probe load_category_anchors '{"p_version":"probe","p_rows":[]}'
ZV=$(node -e 'console.log(JSON.stringify("["+Array(384).fill(0).join(",")+"]"))'); probe category_knn "{\"q\":$ZV,\"k\":1}"
code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/job_board_category_anchors?select=id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  anchors table as anon -> $code" || echo "FAIL  anchors table as anon -> $code"

echo "== 5k. get_company_growth is a three-state verdict =="
R get_company_growth '{"p_tokens":["dominos","tysonfoods~wd5~TSN","zz-not-a-board"]}' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  non-JSON")}if(!Array.isArray(j))return console.log("INFO  "+JSON.stringify(j).slice(0,160));
const V=new Set(["grew","no-growth","unknown"]);const RS=new Set(["excluded","series_stale","no_series","too_new","series_gap","too_small","not_in_ledger","windowed_read","failed_read","ledger_gap","pool_replaced"]);const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
ok(j.length===3,"one row per asked token ("+j.length+")");ok(j.every(r=>V.has(r.verdict)),"verdicts in {grew,no-growth,unknown}: "+j.map(r=>r.verdict).join(","));ok(j.every(r=>(r.verdict==="unknown")===(r.unknown_reason!==null)),"unknown_reason iff unknown");ok(j.every(r=>r.unknown_reason===null||RS.has(r.unknown_reason)),"reasons in vocabulary: "+j.map(r=>r.unknown_reason).join(","));ok(j.every(r=>r.window_days===7&&r.ledger_days_expected===9),"window 7 / ledger 9 on every row");
const z=j.find(r=>r.company_token==="zz-not-a-board");ok(!!z&&z.verdict==="unknown"&&z.unknown_reason==="no_series","unknown token -> unknown/no_series");
for(const r of j)console.log("INFO  "+r.company_token+": "+r.verdict+(r.unknown_reason?"/"+r.unknown_reason:"")+" baseline="+r.baseline_served+" latest="+r.latest_served+" removed="+r.removed_departures)})'

echo "== 5l. the runner’s staging table is closed to every client role =="
for T in _mig_stage _mig_probe; do code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/$T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  $T SELECT as anon -> $code" || echo "FAIL  $T SELECT as anon -> $code"; done
probe _mig_exec '{"p_sql":"select 1"}'

echo "== 5m. .72: the pay-widening disclosure =="
J '{"action":"list","limit":1,"salaryFloor":100000,"hasStatedPay":true,"includeUnstatedPay":true}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const ig=(j.ignoredFilters||[]).map(x=>typeof x==="string"?x:(x.key||x.name||JSON.stringify(x)));console.log((ig.some(n=>/includeUnstatedPay/.test(n))?"PASS":"FAIL")+"  ignoredFilters names includeUnstatedPay: "+JSON.stringify(ig))})'

echo "== 5n/5q. agent-mcp: version, tiers, prompts, resources, the unkeyed tier, the sign-in state =="
MC -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-deploy","version":"0"}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  initialize non-JSON")}const r=j.result||{};const v=r.serverInfo&&r.serverInfo.version;const c=r.capabilities||{};const ins=String(r.instructions||"");const si=(r._meta||{})["work.resumebooster/sign-in"]||{};console.log((/^2026-09-04\.(10|1[1-9]|[2-9][0-9])$|^2026-09-[1-3]/.test(String(v))?"PASS":"FAIL")+"  serverInfo.version = "+v+" (want .10 or later)");console.log((c.prompts&&c.resources?"PASS":"FAIL")+"  capabilities: prompts="+!!c.prompts+" resources="+!!c.resources);console.log((/^Live job search/.test(ins)?"PASS":"FAIL")+"  instructions open with the plan head; bytes="+ins.length+(ins.length>2048?" FAIL >2048":""));console.log((/\/jobs\?job=/.test(ins)?"PASS":"FAIL")+"  instructions carry the URL->id sentence");console.log("INFO  sign-in state="+si.state+(si.reason?" reason="+si.reason:"")+" (off = the owner has not enabled the Supabase OAuth server; the server says so in words)")})'
MC -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=((JSON.parse(s).result||{}).tools)||[];const miss=t.filter(x=>!x.outputSchema).map(x=>x.name);console.log("INFO  tools/list: "+t.length+" tools");console.log((miss.length===0?"PASS":"FAIL")+"  every tool declares outputSchema (missing: "+JSON.stringify(miss)+")");for(const n of ["employer_hiring_record","employer_growth","search","fetch"])console.log((t.some(x=>x.name===n)?"PASS":"FAIL")+"  tool present: "+n)})'
MC -d '{"jsonrpc":"2.0","id":3,"method":"prompts/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=((JSON.parse(s).result||{}).prompts)||[];console.log((p.length===3?"PASS":"FAIL")+"  prompts/list -> "+p.length+": "+p.map(x=>x.name).join(","))})'
MC -d '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=((JSON.parse(s).result||{}).resources)||[];console.log((r.length===3?"PASS":"FAIL")+"  resources/list -> "+r.length)})'
MC -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"board_stats","arguments":{}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result)||{};const txt=JSON.stringify(r.content||"");const spent=/allowance is spent/.test(txt);console.log((r.isError?(spent?"INFO":"FAIL"):"PASS")+"  keyless board_stats "+(r.isError?(spent?"refused: this address is over its daily allowance (our own probes) — the wall works":"isError "+txt.slice(0,120)):"answers"+((r.structuredContent||{}).withKey?" with a withKey block":"")))})'
MC -w '\nHTTPSTATUS:%{http_code}' -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"request_application","arguments":{"jobId":"zz"}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const st=(s.match(/HTTPSTATUS:(\d+)/)||[])[1];s=s.replace(/\nHTTPSTATUS:\d+$/,"");if(st==="401")return console.log("PASS  keyless request_application -> 401 (sign-in is ON and the challenge is answered)");let j;try{j=JSON.parse(s)}catch{j=null}const r=(j&&j.result)||{};const txt=JSON.stringify(r).slice(0,300);console.log((r.isError&&/key|sign-in/i.test(txt)?"PASS":"FAIL")+"  keyless request_application refused in band: "+txt.slice(0,120))})'
probe mcp_anon_check '{"p_ip_hash":"0000000000000000","p_global_cap":1,"p_ip_cap":1}'
if [ -n "$RB" ]; then MC -H "Authorization: Bearer $RB" -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"employer_growth","arguments":{"companyTokens":["dominos","tysonfoods~wd5~TSN","zz-not-a-board"]}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result)||{};const rows=((r.structuredContent||{}).employers)||[];console.log((!r.isError&&rows.length===3?"PASS":"FAIL")+"  keyed employer_growth: "+rows.length+" rows, "+rows.map(x=>x.verdict+(x.unknown_reason?"/"+x.unknown_reason:"")).join(","))})'; fi

echo "== 5o. the six-hour pass =="
probe agent_pass_grant '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_stripe_session_id":"zz","p_payment_intent_id":"zz","p_amount_cents":0,"p_session_hours":1,"p_applications_total":1,"p_rate_per_min":1,"p_daily_quota":1,"p_shelf_days":1}'
probe agent_queue_enqueue '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_posting_id":"zz","p_row":{},"p_pass_funded":false}'
probe agent_pass_metrics '{"p_days":7}'
probe custom_access_token_hook '{"event":{}}'
code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/agent_passes?select=applications_used&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  agent_passes as anon -> $code" || echo "FAIL  agent_passes as anon -> $code"
prm=$(curl -s -m 30 -w '\n%{http_code}' "$B/functions/v1/agent-mcp/.well-known/oauth-protected-resource" -H "apikey: $K"); pcode=$(printf '%s' "$prm" | tail -1); printf '%s' "$prm" | sed '$d' | grep -q '"resource"' && [ "$pcode" = "200" ] && echo "PASS  PRM served on the function path" || echo "FAIL  PRM -> HTTP $pcode"
as=$(curl -s -m 20 "$B/.well-known/oauth-authorization-server/auth/v1"); printf '%s' "$as" | grep -q '"registration_endpoint"' && echo "PASS  OAuth AS metadata answers with DCR" || echo "INFO  OAuth AS: $(printf '%s' "$as" | head -c 90) (the owner's dashboard toggle)"
if [ -n "$RB" ]; then MC -H "Authorization: Bearer $RB" -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"key_status","arguments":{}}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const sc=((JSON.parse(s).result||{}).structuredContent)||{};const p=sc.pass||null;console.log((p&&p.state?"PASS":"INFO")+"  key_status.pass.state = "+(p&&p.state))})'; fi

echo "== 5p. no prerendered page is served as the homepage shell =="
HOMET=$(title /)
for p in /agents /pricing /changelog /explore /freelance-boost /data-api /ghost-job-index /jobs; do t=$(title "$p"); if [ -n "$t" ] && [ "$t" != "$HOMET" ]; then echo "PASS  $p -> $t"; else echo "FAIL  $p serves the HOMEPAGE title to crawlers"; fi; done
curl -s -m 30 -A "$UA" "$SITE/agents" > /tmp/vd_agents.html; echo "INFO  /agents tiles: $(grep -oE 'href="#(claude|chatgpt|claude-code|cursor|vscode|more)"' /tmp/vd_agents.html | sort -u | tr '\n' ' ')  GitHub line: $(grep -c 'Using a different agent' /tmp/vd_agents.html)"
echo "INFO  /jobs crawler copy links /agents: $(curl -s -m 30 -A "$UA" "$SITE/jobs" | grep -c 'href="/agents"')"
echo "INFO  homepage strip in crawler copy: $(curl -s -m 30 -A "$UA" "$SITE/" | grep -c 'Bring your own AI agent')"

echo "== 5r. the registry’s domain proof and listing =="
wk=$(curl -s -m 20 "$SITE/.well-known/mcp-registry-auth" | head -1); printf '%s' "$wk" | grep -qE '^v=MCPv1; k=(ed25519|ecdsap384); p=' && echo "PASS  /.well-known/mcp-registry-auth -> $wk" || echo "FAIL  /.well-known/mcp-registry-auth -> $wk"
[ -f ~/.config/resumebooster/mcp-registry-auth.txt ] && { [ "$(cat ~/.config/resumebooster/mcp-registry-auth.txt)" = "$wk" ] && echo "PASS  the served proof matches the key in ~/.config/resumebooster" || echo "INFO  the served proof differs from the local key (site not re-baked since the key changed)"; }
# The registry's own search is matched loosely: on 2026-09-22 a search for the
# full namespace "work.resumebooster" answered an EMPTY BODY where the day
# before it answered the row, while "resumebooster" still returned it. So ask
# the looser term and assert the NAME on the row, and treat an unparseable or
# empty body as INFO about the registry, never as a claim about our listing.
curl -s -m 20 "https://registry.modelcontextprotocol.io/v0.1/servers?search=resumebooster" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  registry search returned no parseable body ("+s.length+" bytes) — the listing is unproven by this run, not gone")}const v=(j.servers)||[];const ours=v.map(x=>(x.server||x)).filter(x=>/^work\.resumebooster\//.test(String(x.name)));console.log((ours.length>0?"PASS":"FAIL")+"  registry lists work.resumebooster: "+(ours.map(x=>x.name+"@"+x.version).join(",")||"NOT among "+v.length+" results"))})'

echo "== 5s. layoff filings: writers closed, tables locked, readers honest, the mirror full =="
probe refresh_layoff_partition '{}'
probe layoff_matches_rebuild '{}'
for T in layoff_filings layoff_matches layoff_board_names layoff_read_log layoff_employer_aliases; do code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$B/rest/v1/$T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  $T as anon -> $code" || echo "FAIL  $T as anon -> $code"; done
# Four tokens, four different answers the reader must give. thetradesk: "The Trade
# Desk" strips its leading "the" to a two-token name that equals the 8-K filer, so
# it is the proof the mirror is written and the exact match runs. pagerduty: filed
# an Item 2.05 on 2026-08-27 but its board name is ONE token, so by the rule it is
# null until the owner ticks the alias (it is on the batch-2 list). ehac~us6~CX_1
# is Williams-Sonoma: its 26 Aug 8-K was an earnings release (Item 2.02) whose
# exhibit mentions a reduction in force -- not an Item 2.05 -- so the null row is
# the CORRECT answer and a filing surfacing here would be a defect. zz-not-a-board
# is not a board at all and still gets its row, because no row is never "no filing".
R get_employer_layoff_filings '{"p_tokens":["thetradedesk","pagerduty","ehac~us6~CX_1","zz-not-a-board"]}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  reader non-JSON")}if(!Array.isArray(j))return console.log("INFO  reader: "+JSON.stringify(j).slice(0,160));const by=Object.fromEntries(j.map(r=>[r.lf_company_token,r]));const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);ok(j.length===4,"one row per asked token ("+j.length+"/4) -- a null row is an answer, never an omission");const t=by["thetradedesk"];ok(t&&t.lf_source==="sec_8k_205"&&t.lf_relation==="filer","thetradedesk -> "+(t&&t.lf_source?t.lf_source+" "+t.lf_filer+" "+t.lf_event_date+" (exact two-token match: the mirror is written)":"NULL ROW: mirror empty or matcher not run"));const p=by["pagerduty"];console.log((p&&p.lf_source?"PASS":"INFO")+"  pagerduty (one-token name, Item 2.05 filed 2026-08-27) -> "+(p&&p.lf_source?p.lf_source+" via "+p.lf_relation+" (alias ticked)":"null row -- correct until the alias is ticked"));const w=by["ehac~us6~CX_1"];ok(w&&w.lf_source===null,"ehac~us6~CX_1 (Williams-Sonoma; Aug-26 8-K was Item 2.02, not 2.05) -> "+(w&&w.lf_source===null?"null row (correct: not a filing)":"SURFACED "+w.lf_source+" "+w.lf_filer));const z=by["zz-not-a-board"];ok(z&&z.lf_source===null,"unknown token answers a null-source row")})'
R get_layoff_partition '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  partition non-JSON")}if(!Array.isArray(j))return console.log("INFO  partition: "+JSON.stringify(j).slice(0,160));for(const r of j)console.log("INFO  "+String(r.lp_arm).padEnd(7)+" sufficient="+r.lp_sufficient_30+(r.lp_reason?" reason="+r.lp_reason:"")+" taken_down_30="+r.lp_taken_down_30+" ±"+r.lp_half_width_30+" n="+r.lp_n_at_risk_30+" employers="+r.lp_employers_n+" maxshare="+r.lp_max_employer_share);const f=j.find(r=>r.lp_arm==="filed");if(f)console.log((f.lp_sufficient_30||f.lp_reason?"PASS":"FAIL")+"  the filed arm clears the gate or names why not")})'
code=$(curl -s -m 20 -o /tmp/vd_lf.json -w '%{http_code}' -X POST "$B/functions/v1/layoff-filings" -H "Content-Type: application/json" -H "apikey: $K" -d '{"action":"edgar"}'); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  layoff-filings without the cron key -> $code" || echo "FAIL  layoff-filings without the cron key -> $code $(head -c 100 /tmp/vd_lf.json)"

echo "== 5t. the H-1B wage cells: writer closed, table locked, reader answers a row per token =="
probe oflc_lca_wages_load '{"p_rows":[],"p_run_started_at":"2026-01-01T00:00:00Z","p_prune":false}'
code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$B/rest/v1/oflc_lca_wages?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); { [ "$code" = "401" ] || [ "$code" = "403" ]; } && echo "PASS  oflc_lca_wages as anon -> $code" || echo "FAIL  oflc_lca_wages as anon -> $code"
R get_employer_lca_wages '{"p_tokens":["dominos","thetradedesk","zz-not-a-board"]}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  lca reader non-JSON")}if(!Array.isArray(j))return console.log("FAIL  lca reader: "+JSON.stringify(j).slice(0,180));const toks=new Set(j.map(r=>r.ow_company_token));console.log((toks.size===3?"PASS":"FAIL")+"  one row per asked token ("+toks.size+"/3, "+j.length+" rows) -- no row is never \"does not sponsor\"");const z=j.find(r=>r.ow_company_token==="zz-not-a-board");console.log((z&&z.ow_soc_code===null?"PASS":"FAIL")+"  unknown token answers a null-wage row");const filled=j.filter(r=>r.ow_filings_n>0);console.log("INFO  cells with filings: "+filled.length+" (0 is CORRECT until the load POST is fired)")})'
# THE WHOLE LOAD, NOT ONE TOKEN, AND NO FIGURE TYPED TWICE. This block used to
# spell the label, the publication date, the source file and a proof token here
# in the shell, and to read that ONE token -- so it printed four passes over a
# load that was missing thousands of cells as long as that token's chunk had
# landed, and it would have printed three FAILs on a correct load the day the
# next file shipped. Every figure below is read out of the payload the deploy
# carries, at run time, and the assertions are over the load as a whole. A null
# or zero state here before the POST is CORRECT, not a defect.
LCA_PAYLOAD=supabase/functions/layoff-filings/lca-payload.ts
lcaconst() { grep -m1 "^export const $1 = " "$LCA_PAYLOAD" | sed -E 's/^[^=]*= *"?([^";]*)"?;.*$/\1/'; }
if [ -f "$LCA_PAYLOAD" ]; then
  export LCA_Q="$(lcaconst LCA_FISCAL_QUARTER)" LCA_FILE="$(lcaconst LCA_SOURCE_FILE)" LCA_PUB="$(lcaconst LCA_PUBLISHED_ON)"
  export LCA_FROM="$(lcaconst LCA_COVERAGE_FROM)" LCA_TO="$(lcaconst LCA_COVERAGE_TO)"
  export LCA_CELLS="$(lcaconst LCA_CELL_COUNT)" LCA_TOKENS="$(lcaconst LCA_TOKEN_COUNT)" LCA_WRITES="$(lcaconst LCA_CELL_WRITES)"
  echo "INFO  the bundle carries $LCA_CELLS cells / $LCA_TOKENS tokens / $LCA_WRITES filings, labelled \"$LCA_Q\" ($LCA_FROM..$LCA_TO) from $LCA_FILE published $LCA_PUB"
  R get_lca_load_state '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  lca load state non-JSON")}const r=Array.isArray(j)?j[0]:j;if(!r)return console.log("FAIL  lca load state answered no row");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);if(!Number(r.ls_cells))return console.log("INFO  the period is not loaded yet: 0 cells resident (fire the lca_wages POST)");
ok(String(r.ls_cells)===process.env.LCA_CELLS,"every cell landed: "+r.ls_cells+" resident, bundle carries "+process.env.LCA_CELLS);
ok(String(r.ls_tokens)===process.env.LCA_TOKENS,"every board token landed: "+r.ls_tokens+" of "+process.env.LCA_TOKENS);
ok(String(r.ls_filings)===process.env.LCA_WRITES,"the filings behind them: "+r.ls_filings+" of "+process.env.LCA_WRITES);
ok(Number(r.ls_periods)===1,"exactly one labelled period is resident ("+r.ls_periods+") -- more than one is a load that left a mixture");
ok(r.ls_fiscal_quarter===process.env.LCA_Q,"label -> "+r.ls_fiscal_quarter+" (bundle says "+process.env.LCA_Q+")");
ok(String(r.ls_published_on).slice(0,10)===process.env.LCA_PUB,"published on -> "+String(r.ls_published_on).slice(0,10));
ok(r.ls_source_file===process.env.LCA_FILE,"source file -> "+r.ls_source_file);
ok(String(r.ls_coverage_from).slice(0,10)===process.env.LCA_FROM&&String(r.ls_coverage_to).slice(0,10)===process.env.LCA_TO,"the span the figures are about -> "+String(r.ls_coverage_from).slice(0,10)+".."+String(r.ls_coverage_to).slice(0,10));
// THE PLAUSIBILITY BOUND, CHECKED ON WHAT LANDED. The loader refuses a filed
// annual figure outside this band and the bundle re-checks it before posting;
// this is the third place, on the rows the public can actually be shown.
ok(Number(r.ls_wage_low)>=15000&&Number(r.ls_wage_high)<=1500000,"every filed figure is inside the band: "+r.ls_wage_low+" to "+r.ls_wage_high+" (15,000 to 1,500,000)");
console.log("INFO  widest printable range is "+r.ls_max_spread+"x its own floor (teaching hospitals file residents and attendings under one broad SOC); loaded at "+r.ls_loaded_at)})'
  # ...and one employer answered through the reader the component actually asks,
  # so the aggregates above are not the only thing that can see the table.
  # A SAMPLE, not the proof: the assertions above are the proof. This token was
  # the largest filer in the file the bundle carried when this was written, and
  # a null row here is informational -- the next file may not carry it at all.
  PROOF=generalmotors~wd5~Careers_GM
  R get_employer_lca_wages "{\"p_tokens\":[\"$PROOF\"]}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  lca reader non-JSON")}if(!Array.isArray(j)||!j.length)return console.log("INFO  lca reader gave no row for the sample token");const r=j[0];if(r.ow_filings_n===null||r.ow_filings_n===undefined)return console.log("INFO  the sample token answers a null-wage row (correct before the POST, or if it is not in this file)");console.log("PASS  a sample employer reads back: "+r.ow_company_token+" "+r.ow_soc_code+" "+r.ow_worksite_state+" $"+r.ow_wage_low+"-"+r.ow_wage_high+" over "+r.ow_filings_n+" filings, "+r.ow_employer_cells_n+" cells / "+r.ow_employer_filings_n+" applications, "+r.ow_fiscal_quarter+" "+String(r.ow_coverage_from).slice(0,10)+".."+String(r.ow_coverage_to).slice(0,10))})'
else
  echo "INFO  no lca payload in this tree; the load state was not checked against it"
fi

echo "== 5u. the Ontario reader quotes a posting and never judges it =="
ONT=$(J '{"action":"list","country":"CA","location":"ontario","limit":1}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const r=(j.jobs||[])[0];console.log(r?r.id:"")})')
if [ -n "$ONT" ]; then
  R get_ontario_posting_disclosures "{\"p_id\":\"$ONT\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  ontario reader non-JSON")}if(!Array.isArray(j))return console.log("FAIL  ontario reader: "+JSON.stringify(j).slice(0,180));console.log((j.length===1?"PASS":"FAIL")+"  one row for the asked posting ("+j.length+")");const r=j[0]||{};const keys=["od_pay_evidence","od_pay_basis","od_vacancy_evidence","od_ai_evidence","od_canadian_experience_evidence"];console.log((keys.every(k=>k in r)?"PASS":"FAIL")+"  five evidence fields present");console.log((("od_verdict" in r)||("od_compliant" in r)||("od_score" in r)?"FAIL":"PASS")+"  no verdict, no score -- evidence only");console.log("INFO  pay="+JSON.stringify(r.od_pay_evidence)+" basis="+r.od_pay_basis+" vacancy="+JSON.stringify(r.od_vacancy_evidence)+" ai="+JSON.stringify(r.od_ai_evidence)+" canexp="+JSON.stringify(r.od_canadian_experience_evidence))})'
else echo "INFO  no Ontario posting returned to ask about"; fi
R get_ontario_posting_disclosures '{"p_id":"zz-not-a-posting"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  non-JSON")}console.log((Array.isArray(j)&&j.length===0?"PASS":"INFO")+"  a posting outside Ontario/unknown answers no row ("+(Array.isArray(j)?j.length:"?")+")")})'

echo "== 5v. a posting is addressable, and the sitemap advertises only pages that exist =="
SM=$(curl -s -m 30 "$SITE/sitemap.xml")
NP=$(printf '%s' "$SM" | grep -c "jobs/posting/")
echo "$([ "$NP" -gt 0 ] && echo PASS || echo FAIL)  sitemap carries $NP posting URLs"
printf '%s' "$SM" | grep -oE "<loc>[^<]*jobs/posting/[^<]*</loc>" | sed -E 's/<\/?loc>//g' | head -3 > /tmp/vd_posting_urls.txt
HOMET=$(title /)
while read -r u; do
  [ -z "$u" ] && continue
  page=$(curl -s -m 30 -A "$UA" "$u")
  t=$(printf '%s' "$page" | grep -oE "<title>[^<]*</title>" | head -1)
  ld=$(printf '%s' "$page" | grep -c '"@type": *"JobPosting"')
  can=$(printf '%s' "$page" | grep -c 'rel="canonical"')
  if [ -n "$t" ] && [ "$t" != "$HOMET" ] && [ "$ld" -ge 1 ] && [ "$can" -ge 1 ]; then echo "PASS  $(basename "$u") -> $t  (JobPosting blocks $ld, canonical $can)"; else echo "FAIL  $u -> title=$t jobposting=$ld canonical=$can"; fi
done < /tmp/vd_posting_urls.txt
printf '%s' "$SM" | grep -oE "<loc>[^<]*jobs/posting/[^<]*</loc>" | sed -E 's/<\/?loc>//g' | head -1 | while read -r u; do
  printf '%s' "$(curl -s -m 30 -A "$UA" "$u")" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;let x,ok=0,bad=0,vt=null;while((x=m.exec(s))){try{const j=JSON.parse(x[1]);const t=j["@type"];if(t==="JobPosting"){ok++;vt=j.validThrough;for(const k of ["title","description","datePosted","hiringOrganization","jobLocation"])if(!j[k])bad++}}catch{bad++}}console.log((ok===1&&bad===0?"PASS":"FAIL")+"  exactly one parseable JobPosting entity with every required property (entities "+ok+", problems "+bad+")");console.log((vt&&/T\d\d:\d\d:\d\d/.test(vt)?"PASS":"FAIL")+"  validThrough carries a time, not a bare date: "+vt)})'
done

echo "== 5w. the four data pages now serve numbers, and no vendor with zero rows is offered =="
for p in /ghost-job-index /pay-transparency /hiring-trends /entry-level-index; do
  n=$(curl -s -m 30 -A "$UA" "$SITE$p" | sed -E 's/<script[^>]*>.*<\/script>//g; s/<[^>]*>/ /g' | grep -oE "[0-9]" | wc -l | tr -d ' ')
  [ "$n" -gt 20 ] && echo "PASS  $p serves $n digits to a crawler" || echo "FAIL  $p serves $n digits"
done
curl -s -m 30 -A "$UA" "$SITE/jobs" | grep -qi "usajobs" && echo "FAIL  /jobs still offers USAJOBS while it serves no rows" || echo "PASS  USAJOBS is not offered on /jobs (its adapter is unkeyed and serves 0 rows)"
if [ -n "$RB" ]; then
  curl -s -m 30 "$B/functions/v1/public-api/v1/jobs?source=usajobs&limit=1" -H "Authorization: Bearer $RB" -H "apikey: $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("INFO  /v1 non-JSON: "+s.slice(0,120))}const t=JSON.stringify(j).toLowerCase();const refused=/terms|not available|cannot be redistributed|unsupported source/.test(t);console.log((refused?"PASS":"FAIL")+"  /v1 refuses source=usajobs by name: "+JSON.stringify(j).slice(0,200))})'
fi

echo "== 5x. the place the employer stated =="
J '{"action":"list","vendor":["workday"],"limit":100}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const rows=j.jobs||[];const noCountry=rows.filter(r=>!r.country).length;const placeless=rows.filter(r=>/^\s*\d+\s+(locations|sites)\s*$/i.test(String(r.location||""))).length;console.log("INFO  workday sample "+rows.length+": no country "+noCountry+" ("+Math.round(100*noCountry/Math.max(1,rows.length))+"%), \"N Locations\" "+placeless+" -- baseline was 50.3% and 10.4%; the sweep fills these as it re-reads, so a first-day read is EXPECTED to look close to baseline")})'
J '{"action":"list","country":"IL","limit":100}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const rows=j.jobs||[];const bad=rows.filter(r=>/beth israel|israel deaconess/i.test(String(r.company||"")+" "+String(r.location||"")));console.log((bad.length===0?"PASS":"FAIL")+"  no Boston hospital filed under country=IL in a "+rows.length+"-row sample ("+bad.length+" found)");console.log("INFO  country=IL total "+j.total)})'

echo "== 5y. .77: a posted wage counts as stated pay, and the count agrees with the page =="
# DEPLOY ORDER FOR THIS RELEASE: the EDGE BUNDLE (.77 job-board, plus public-api
# and agent-mcp, in ONE publish) goes FIRST, and migration 20260927034117 second,
# as soon after as possible. That is the opposite of the usual order here and the
# reason is in cappedCount: .77 stands down from count_jobs_capped for a
# stated-pay count it could disagree with, so with the bundle in front the page
# and its own headline agree in either SQL version. Bundle-second is the harmful
# order — the old bundle's page would be narrower than the migrated count (a
# headline over by ~16% below the count cap) and the old row audit would report
# every newly-admitted ranked row as an integrity violation, which is a flood on
# an unsampled channel.
#
# WHAT EACH CHECK READS, because two of them changed meaning with the gate:
#   (a) and (a2) read THE EDGE BUNDLE. A stated-pay page must contain at least one
#       row that prints a rate with no annualised figure; under the old predicate
#       that row could not be served at all, so one sighting is proof.
#   (b) reads THE MIGRATION. It is the only live tell for the SQL, judged ONLY by
#       `ranked: true` — a ranked path that quietly fell back to recency would
#       otherwise pass by serving buildQuery's rows. All three SQL functions move
#       in one file, so search_jobs answering with a gap row is that file landing.
#       (b) FAILING WHILE (a) PASSES IS THE HALF-APPLIED STATE: the browse serves
#       the wider set, the ranked tier serves the narrower one, and the migration
#       still needs applying. Nothing is wrong on the page in that state, but the
#       ranked tier is hiding rows it should reach.
#   (c) reads THE EDGE BUNDLE, NOT THE SQL, and it used to read the SQL. Under
#       .77 this count is answered by the exact buildQuery path (see cappedCount's
#       stand-down), so a difference here proves the edge builder moved and says
#       nothing about count_jobs_capped. Do not read a PASS here as the migration.
#   (d) is the check the 2026-07-25 work-mode defect would have failed: walk every
#       row of the filtered body and compare with the published total.
#   (e) is the cost of moving a hot predicate off an index. The pay field carries
#       none; the claim is that one NULL test on a denser column is not slower
#       than the indexed column it replaced, and a claim about latency needs a
#       timing, not an analogy.
# IE is the stratum: small enough to walk exhaustively, and walked row by row
# before the change (2,575 rows / 312 with pay text / 282 with an annual figure,
# 2026-09-27T02:01:53Z). B and K are shell locals here, so they are exported.
B="$B" K="$K" node -e '
const B=process.env.B, K=process.env.K;
const J=async(b)=>{const r=await fetch(B+"/functions/v1/job-board",{method:"POST",headers:{"content-type":"application/json","x-rb-budget":"probe",apikey:K,authorization:"Bearer "+K},body:JSON.stringify(b)});return r.json()};
const timed=async(b)=>{const t=Date.now();const j=await J(b);return [Date.now()-t, j]};
const gap=(rows)=>rows.filter(r=>typeof r.salary==="string"&&r.salary.trim()!==""&&r.salaryMinAnnual==null);
const med=(a)=>a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];
(async()=>{
  const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
  const page=await J({action:"list",country:"IE",hasStatedPay:true,limit:100,groupSimilar:false});
  const g=gap(page.jobs||[]);
  ok(g.length>0,"(a) edge: "+g.length+" of "+(page.jobs||[]).length+" stated-pay rows print a rate with no annual figure"+(g[0]?" e.g. "+JSON.stringify(g[0].salary):" — ZERO means the edge builder is still on the annualised column"));
  const d=page.payTextWithoutAnnual;
  ok(!!d&&typeof d.rows==="number"&&d.rows===g.length,"(a2) the page publishes payTextWithoutAnnual and it matches what the rows show: "+JSON.stringify(d)+" vs counted "+g.length);
  const plain=await J({action:"list",country:"IE",limit:60});
  ok(plain.payTextWithoutAnnual===undefined,"(a3) no pay control, no gap sentence: an ordinary browse must not publish payTextWithoutAnnual (got "+JSON.stringify(plain.payTextWithoutAnnual)+")");
  const rk=await J({action:"list",q:"assistant",country:"IE",hasStatedPay:true,limit:50});
  if(rk.ranked===true){const rg=gap(rk.jobs||[]);ok(rg.length>0,"(b) MIGRATION TELL — ranked RPC: "+rg.length+" of "+(rk.jobs||[]).length+" rows print a rate with no annual figure. ZERO means 20260927034117 has not landed (or was re-staged under another name) and the deploy is half-applied: apply it, then re-run this section.");}
  else console.log("INFO  (b) that query did not answer ranked (ranked="+rk.ranked+"), so search_jobs was not exercised — retry with another term, and do NOT record the migration as verified until it answers");
  const c1=await J({action:"list",countOnly:true,limit:1,country:"IE",hasStatedPay:true});
  const c2=await J({action:"list",countOnly:true,limit:1,country:"IE",hasStatedPay:true,salaryFloor:1});
  ok((c1.total||0)-(c2.total||0)>0,"(c) EDGE, not SQL — stated-pay "+c1.total+" exceeds stated-pay+$1-floor "+c2.total+" by "+((c1.total||0)-(c2.total||0))+" (0 means the edge builder still reads the annualised column)");
  let seen=new Map(), off=0, guard=0;
  while(guard++<40){const p=await J({action:"list",country:"IE",hasStatedPay:true,limit:100,offset:off,groupSimilar:false,sort:"discovered"});
    for(const r of (p.jobs||[])) seen.set(r.id,1);
    if(!p.hasMore) break; off = p.nextOffset ?? off+(p.jobs||[]).length;}
  const within = c1.total!=null && Math.abs(seen.size-c1.total)<=Math.max(5,Math.round(0.03*c1.total));
  ok(within,"(d) the page and its headline agree: walked "+seen.size+" distinct rows against a published total of "+c1.total+" (3% band for drift during the walk)");
  const un=[],ix=[];
  for(let i=0;i<3;i++){const [t]=await timed({action:"list",countOnly:true,limit:1,country:"GB",hasStatedPay:true});un.push(t);
                       const [t2]=await timed({action:"list",countOnly:true,limit:1,country:"GB",salaryFloor:1});ix.push(t2);}
  const mu=med(un), mi=med(ix);
  ok(mu < mi*2.5,"(e) the unindexed pay field is not a latency regression: stated-pay count median "+mu+"ms "+JSON.stringify(un)+" against the indexed floor-column count "+mi+"ms "+JSON.stringify(ix)+" (band 2.5x; a FAIL here is the missing-index case — ship a partial index on the pay field in its own migration)");
})().catch(e=>console.log("FAIL  5y probe threw: "+e.message));
'

echo "== 5z. .78: the employer's own dropdown, and a building is not a policy =="
# DEPLOY ORDER FOR THIS RELEASE: the EDGE BUNDLE (.78 job-board) FIRST, then
# migration 20260927113742 with it or after it, NEVER BEFORE IT. The old bundle
# re-derives remote from a Paylocity site label on every visit and the corrections
# path writes non-null work modes freely, so a migration applied in front of the
# bundle is silently reverted board by board. The migration is an ACCELERATOR, not
# a prerequisite: the corrections path re-writes the re-normalised work mode with
# its nulls whenever the remote boolean moves, so the bundle alone clears the 35
# a lap at a time. What the migration buys is immediacy plus the rows no lap
# reaches (dormant boards, failing boards, rows past a board's per-pass cap).
#
# BASELINES, measured with the anon key through this function's own read paths
# just before the release, because every check below is a COMPARISON:
#   ukg servable inventory 34,055 (facets sourcesAt 2026-09-27T14:52:12Z)
#   ukg rows serving a stated mode 703 — remote 419 / hybrid 78 / onsite 206,
#     countOnly, no cell capped, 2026-09-27T15:0xZ. 703/34,055 = 2.06%.
#   paylocity workMode=remote 2,050, of which 38 carry the head-office token in
#     their location and 35 of those 38 have a site-label residue. Those 35 are
#     the repair's population.
#
# WHAT EACH CHECK READS:
#   (a) THE EDGE BUNDLE, over a ROTATION. The stated-mode share on this vendor is
#       expected to climb from 703 towards 15,000-20,000 as boards lap; it is NOT
#       instant and a low number on deploy day is not a failure. The denominator
#       comes from the FACET (one head-row read, complete by construction), never
#       from a list total, which caps at 10,000 — the note is explicit about that.
#   (b) THE MIGRATION, or the bundle a lap later: zero paylocity rows served
#       remote whose location is a head-office SITE LABEL. 35 today. This is the
#       only check that distinguishes "repaired" from "not yet lapped" on the day
#       of the deploy; a week later the bundle alone would also have cleared them.
#   (c) THE EDGE BUNDLE on named rows, which is the only check that proves the
#       enum is being READ rather than the coverage having drifted. Postings
#       expire, so a missing row here is INFO and not FAIL: pick another from the
#       census in the build report.
B="$B" K="$K" node -e '
const B=process.env.B, K=process.env.K;
const J=async(b)=>{const r=await fetch(B+"/functions/v1/job-board",{method:"POST",headers:{"content-type":"application/json","x-rb-budget":"probe",apikey:K,authorization:"Bearer "+K},body:JSON.stringify(b)});return r.json()};
const HO=/\bhome\s+office\b/i, HOG=/\bhome\s+office\b/gi;
// The site-label residue rule, mirrored from normalize.ts: nothing left, a bare
// cost-centre number, or a residue naming an organisation or a department.
const siteLabel=(s)=>{if(!HO.test(s))return false;const r=s.replace(HOG," ").replace(/[^\p{L}\p{N}]+/gu," ").trim();return r===""||/^[0-9]{3,}$/.test(r)||/\b(inc|llc|corp|foundation|gmbh|departments?)\b/i.test(r)};
(async()=>{
  const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
  const f=await J({action:"facets"});
  const inv=(f.sources||{}).ukg;
  const st=await J({action:"list",countOnly:true,limit:1,vendor:"ukg",workMode:"remote,hybrid,onsite"});
  const parts={};
  for(const m of ["remote","hybrid","onsite"]) parts[m]=(await J({action:"list",countOnly:true,limit:1,vendor:"ukg",workMode:m})).total;
  if(st.countCapped) console.log("INFO  (a) the stated-mode count came back CAPPED, so read the share from the facet and not from this number");
  const share=(inv&&st.total!=null)?(100*st.total/inv):null;
  ok(st.total!=null && st.total>1500,"(a) ukg stated-mode rows "+st.total+" of "+inv+" servable ("+(share==null?"?":share.toFixed(2))+"%, facet stamp "+f.sourcesAt+"), by state "+JSON.stringify(parts)+" — baseline 703/34,055 = 2.06%. This ACCRUES over the rotation: under ~1500 on deploy day means boards have not lapped yet, not that the read is broken. Re-run daily until it settles, and expect 15,000-20,000.");
  let off=0,guard=0,seen=new Set(),tok=0,lab=[];
  while(guard++<60){const r=await J({action:"list",vendor:"paylocity",workMode:"remote",limit:100,offset:off,groupSimilar:false,sort:"discovered"});
    for(const j of (r.jobs||[])){if(seen.has(j.id))continue;seen.add(j.id);const L=String(j.location||"");if(HO.test(L)){tok++;if(siteLabel(L))lab.push(j.id+" "+JSON.stringify(L));}}
    if(!r.hasMore)break; off=r.nextOffset ?? off+(r.jobs||[]).length;}
  ok(lab.length===0,"(b) walked "+seen.size+" paylocity rows served remote: "+tok+" still quote the head-office token and "+lab.length+" of those are a SITE LABEL (baseline 38 and 35; a building is not a work-from-home policy). Remaining: "+JSON.stringify(lab.slice(0,5)));
  const cases=[
    ["ukg:recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845:d840d3e1-a9e5-4a55-9396-ea3931b584f3","onsite","dropdown On-site, nothing in the posting own words; served with NO mode before this bundle"],
    ["ukg:recruiting2~SAL1016SALO~3347ce03-ba60-4bdc-8af2-26369c80b18f:edc33f98-aa88-49d5-920c-e5077e11aa5b","remote","dropdown Remote, silent text; served with NO mode before"],
    ["ukg:recruiting~AUG1000AUG~02a29cd6-e7aa-4501-96be-6336647e3184:692bd5bf-2be4-4ddd-9e24-e32c507bb43f",null,"dropdown On-site against a title reading Hybrid: REFUSED. Served hybrid before, and a served on-site here is the fabrication this build exists to prevent"]];
  for(const [id,want,why] of cases){
    const d=await J({action:"detail",id});
    if(!d||!d.job){console.log("INFO  (c) "+id.slice(-12)+" is no longer servable (postings expire) — take another row of the same shape from the build report: "+why);continue;}
    ok(d.job.workMode===want,"(c) "+id.slice(-12)+" workMode "+JSON.stringify(d.job.workMode)+", expected "+JSON.stringify(want)+" — "+why);
    ok(d.job.remote===(d.job.workMode==="remote"),"(c) "+id.slice(-12)+" boolean and trinary agree (remote="+d.job.remote+")");
  }
})().catch(e=>console.log("FAIL  5z probe threw: "+e.message));
'

echo "== 6. /companies renders =="
echo "INFO  GET /companies -> HTTP $(curl -s -m 30 -o /dev/null -w '%{http_code}' "$SITE/companies")"

# ── 7. THE FUNNEL BUILD OF 2026-09-27 (dedup key + window fix, one visitor id,
# server-side checkout starts, prices in the crawler HTML, two-tier budget).
# Every check is READ-ONLY: OPTIONS preflights run no function logic and spend
# no budget; the anon GET/RPC probes expect a REFUSAL (42501) and a 404 control;
# the cohort reader is a read; the crawler fetches are GETs with the Googlebot
# UA. Nothing here posts an event or mints a session. Migrations here go
# through a staged runner that has edited files and staged them under other
# names, so "applied" is judged by behaviour (7b, 7c, 7d), never by its report.
echo "== 7a. every rebuilt function answers its build on the preflight (deploy proof without a write) =="
for FN in create-checkout create-product-checkout create-subscription-checkout create-agent-checkout create-pass-checkout create-scan-pack-checkout track-ab-event; do
  H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  case "$H" in "$FN.2026-09-27.2") echo "PASS  $FN preflight x-fn-build = $H";; "") echo "FAIL  $FN preflight carries no x-fn-build (the previous bundle is still serving)";; *) echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-09-27.2)";; esac
done

echo "== 7b. checkout_starts exists and is closed to anon by name (a refusal, not an empty answer and not a 404) =="
CS=$(curl -s -m 30 -o /tmp/vd_cs.json -w '%{http_code}' "$B/rest/v1/checkout_starts?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
CSCODE=$(node -e 'try{const j=require("/tmp/vd_cs.json");console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}')
case "$CSCODE" in 42501) echo "PASS  anon GET checkout_starts -> HTTP $CS code 42501 (revoked by name)";; PGRST205) echo "FAIL  checkout_starts does not exist (migration 20260927211436 not applied)";; ROWS:*) echo "FAIL  anon GET checkout_starts -> HTTP $CS $CSCODE (readable: the REVOKE did not land)";; *) echo "FAIL  anon GET checkout_starts -> HTTP $CS $CSCODE";; esac
NC=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/checkout_starts_never_existed?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
[ "$NC" = "404" ] && echo "PASS  negative control checkout_starts_never_existed -> 404" || echo "FAIL  negative control -> HTTP $NC (the 42501 above cannot be read as presence)"
probe record_checkout_start '{"p_stripe_session_id":"cs_probe_anon_denied_000","p_checkout_function":"verify-deploy","p_product_type":"probe","p_product_id":null,"p_visitor_id":null,"p_amount_cents":null,"p_currency":null,"p_origin_path":"/","p_mode":null,"p_metadata":{}}'

echo "== 7c. the writer's key names the variant: later funnel stages leave zero (a day of traffic after deploy) =="
R get_funnel_cohort_stats '{"p_cohort_dimension":"trafficSource","p_days_back":1}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  cohort reader non-JSON: "+s.slice(0,120))}if(!Array.isArray(j))return console.log("FAIL  cohort reader: "+JSON.stringify(j).slice(0,160));const sum=k=>j.reduce((a,r)=>a+Number(r[k]||0),0);const later=["upload_started","scan_started","results_viewed","product_clicked","checkout_started","purchase_completed"];const t={};for(const k of ["landing_view",...later])t[k]=sum(k);console.log("INFO  24h stages: "+JSON.stringify(t)+" (baseline 2026-09-27: landing 136,048/30d, every later stage 0)");const any=later.some(k=>t[k]>0);console.log((any?"PASS":"INFO")+"  a later stage is non-zero"+(any?"":" -- not yet: judge this a day after deploy, not on the hour"))})'

echo "== 7d. the crawler reads the prices: /pricing and /agents carry the plan and pass figures =="
PR=$(curl -s -m 30 -A "$UA" "$SITE/pricing")
for T in 45 99 29; do N=$(printf '%s' "$PR" | grep -o "\$$T" | wc -l | tr -d ' '); [ "$N" -ge 5 ] && echo "PASS  /pricing carries \$$T x$N (want >= 5; baseline 0 for 45 and 99)" || echo "FAIL  /pricing carries \$$T x$N (want >= 5)"; done
DESC=$(printf '%s' "$PR" | grep -o '<meta name="description" content="[^"]*"' | head -1)
case "$DESC" in *"pass for your own agent."\") echo "PASS  /pricing description ends with the pass sentence";; *) echo "FAIL  /pricing description: ${DESC:0:200} (baseline: cut at 'purchases (\"')";; esac
AG=$(curl -s -m 30 -A "$UA" "$SITE/agents")
for T in 99 29; do N=$(printf '%s' "$AG" | grep -o "\$$T" | wc -l | tr -d ' '); [ "$N" -ge 5 ] && echo "PASS  /agents carries \$$T x$N (want >= 5; baseline 0)" || echo "FAIL  /agents carries \$$T x$N (want >= 5)"; done

echo "== 7e. the retired job sitemap is GONE, terminally (the ~733k-URL crawl trap) =="
# .82's claim. Removing the robots.txt line on 2026-09-23 removed the sign; the
# route kept serving, and eight days later the index still answered with 30
# pages and page 0 still listed 24,449 URLs in 3.3 MB, uncached, to any crawler
# that asked. 410 and not 404 is the whole point: a 404 is retried for months.
for Q in "action=sitemap" "action=sitemap&page=0"; do
  C=$(curl -s -m 60 -o /tmp/vd_sm.txt -w '%{http_code}' "$B/functions/v1/job-board?$Q")
  SZ=$(wc -c < /tmp/vd_sm.txt | tr -d ' ')
  case "$C" in
    410) echo "PASS  ?$Q -> 410 Gone (${SZ}b)";;
    200) echo "FAIL  ?$Q -> 200 (${SZ}b) — the old bundle is still serving the sitemap; the deploy did not land";;
    404) echo "FAIL  ?$Q -> 404 — crawlers retry a 404 for months; this must be 410";;
    *)   echo "FAIL  ?$Q -> HTTP $C (${SZ}b)";;
  esac
done
# And it really is gone, not merely refusing one spelling: no sitemap XML in the body.
grep -qiE '<urlset|<sitemapindex|<loc>' /tmp/vd_sm.txt \
  && echo "FAIL  the response still carries sitemap XML" \
  || echo "PASS  no sitemap XML in the response body"

# ── 7f. THE MONEY PATHS OF 2026-10-01: the $5 analysis was refused by a stale
# amount floor and by the webhook's claim; the $7 apply kit accepted only
# product types no checkout mints and its server callers sent no session; ATS
# Defense re-claimed sessions its callers had claimed; three writers recorded
# claims with no product; and the delayed email enqueue was anon-executable.
# READ-ONLY: OPTIONS preflights and a GET to the webhook run no function logic
# and spend no budget; the column probes are selects that RLS answers empty;
# queue_wrapper_exposure is an invoker-rights catalog read returning two
# numbers. No queue wrapper is CALLED here -- if the revoke had not landed,
# such a call would run, and could create a queue or send mail -- and nothing
# mints, claims or redeems a session.
echo "== 7f. the paid products are deliverable, and the queue wrappers are closed to anon =="
for FN in analyze-resume generate-apply-package generate-ats-defense verify-product-purchase verify-scan-pack-purchase retry-failed-deliveries; do
  H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  case "$H" in "$FN.2026-10-01.1") echo "PASS  $FN preflight x-fn-build = $H";; "") echo "FAIL  $FN preflight carries no x-fn-build (the previous bundle is still serving; baseline 2026-10-01: none)";; *) echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-10-01.1)";; esac
done
WH=$(curl -s -m 30 -D - -o /dev/null "$B/functions/v1/stripe-webhook" | tr -d '\r')
WS=$(printf '%s' "$WH" | head -1 | awk '{print $2}')
WB=$(printf '%s' "$WH" | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
[ "$WS" = "405" ] && [ "$WB" = "stripe-webhook.2026-10-01.1" ] && echo "PASS  stripe-webhook GET -> 405 with x-fn-build = $WB" || echo "FAIL  stripe-webhook GET -> HTTP $WS x-fn-build='$WB' (want 405 and stripe-webhook.2026-10-01.1; baseline: 405 with none)"
# ORDER. The webhook ships in the SAME deploy as analyze-resume. The new
# analyze-resume accepts an old webhook's claim (no product, no address), so a
# buyer is no longer refused if it lands first -- but the old webhook still
# routes a full analysis to "No resume session ID" and the retry queue, and
# nothing proves which webhook is live until this marker does.
ARB=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/analyze-resume" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
if [ "$ARB" = "analyze-resume.2026-10-01.1" ] && [ "$WB" != "stripe-webhook.2026-10-01.1" ]; then echo "FAIL  analyze-resume serves $ARB but stripe-webhook does not ('$WB'): the webhook is behind -- deploy it"; else echo "PASS  stripe-webhook is not behind analyze-resume (analyze-resume '$ARB', webhook '$WB')"; fi
# The columns the new writes name. A select of a column the table lacks answers
# 400 42703 before RLS runs; present, RLS answers an empty list.
for Q in "used_stripe_sessions?select=session_id,product_type,ip_address" "purchased_content?select=stripe_session_id,product_type,generated_content,customer_email" "product_deliveries?select=stripe_session_id,product_type,status,max_retries,generation_success,content_generation_completed_at"; do
  C=$(curl -s -m 30 -o /tmp/vd_7f.json -w '%{http_code}' "$B/rest/v1/$Q&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  [ "$C" = "200" ] && echo "PASS  ${Q%%\?*} carries every column the money paths write (HTTP 200)" || echo "FAIL  ${Q%%\?*} -> HTTP $C $(head -c 160 /tmp/vd_7f.json)"
done
NCC=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/used_stripe_sessions?select=no_such_column_probe&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
[ "$NCC" = "400" ] && echo "PASS  negative control: a column the table lacks -> 400 (so the 200s above mean present)" || echo "FAIL  negative control -> HTTP $NCC (the 200s above cannot be read as presence)"
R queue_wrapper_exposure '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  queue_wrapper_exposure non-JSON: "+s.slice(0,160))}if(j&&j.code==="PGRST202")return console.log("FAIL  queue_wrapper_exposure does not exist (migration 20261002104317 not applied)");if(typeof j?.open_to_clients!=="number")return console.log("FAIL  queue_wrapper_exposure -> "+JSON.stringify(j).slice(0,160));console.log((j.definers>=5?"PASS":"FAIL")+"  "+j.definers+" definer function(s) in public touch pgmq (want >= 5: the five email wrappers)");console.log((j.open_to_clients===0?"PASS":"FAIL")+"  "+j.open_to_clients+" of them executable by anon or authenticated (want 0; baseline 2026-10-01: the delayed enqueue, 1)")})'
echo "INFO  the purchase itself cannot be proved read-only: the first paid full_analysis and apply_assistant after deploy should leave product_deliveries status=delivered (owner: check Stripe and the Account page purchase list)"

echo "== 7g. a week of takedowns cannot outnumber its own quarter (20261002113617, frontend before and after) =="
# THE CLAIM: the weekly series and the /jobs ticker count takedowns on the filter
# the 90-day total uses (flagged batches out), the weekly series reports what it
# excluded as closed_flagged, and both pages withhold a week whose flagged records
# outnumber the admitted ones or that reads above twice the record's weekly
# average. DEPLOY ORDER: frontend first (its verdict judges an old five-column row
# by the ceiling alone), then the migration, then a frontend REBUILD (the
# prerender reads the cache at build time). Judge after the next :27 stats-cache
# tick, and run this section again after the tick after that, so the cron -- not
# a one-off call -- is what is proven to write the new shape.
# The same change makes the two other pages that print closed_90d beside the
# ledger depth (the Ghost Job Index opener, the /data-api hero tile) print the
# days the count covers, capped at 90, and the depth beside it once the ledger
# is deeper: (k) reads both deployed chunks for that clause.
#
# BASELINES, read with the anon key 2026-10-01/02 before the change: weekly closed
# 845,110 / 870,536 / 806,570 for the weeks of 09-07, 09-14, 09-21 (byte-stable
# from 09-23 to 10-01, so the ledger is append-only for past weeks); five weeks
# summed to 3,194,350 against closed_90d 1,852,789-1,854,930 (observed_days 79);
# get_hiring_trends answered in 7-13s against a 20s header; the ticker read
# 130,373. Every check is a read: RPC reads with the anon key, two GETs.
B="$B" K="$K" SITE="$SITE" UA="$UA" node -e '
const B=process.env.B,K=process.env.K,SITE=process.env.SITE,UA=process.env.UA;
const R=async(fn,args={})=>{const t0=Date.now();const r=await fetch(B+"/rest/v1/rpc/"+fn,{method:"POST",headers:{"content-type":"application/json",apikey:K,authorization:"Bearer "+K},body:JSON.stringify(args)});const txt=await r.text();let j=null;try{j=JSON.parse(txt)}catch{}return {status:r.status,ms:Date.now()-t0,j,txt}};
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const info=(m)=>console.log("INFO  "+m);
const fmt=(n)=>typeof n==="number"?n.toLocaleString("en-US"):String(n);
// The verdict, mirrored from src/lib/hiring-trends-trust.ts (the page) and the
// prerender builder: unreadable, then above the ceiling, then flagged majority.
// The ceiling divides closed_90d by observed_days CAPPED AT 90 -- the ledger
// outlives the 90-day count, and uncapped the ceiling sinks after day 90.
const verdictOf=(w,g)=>{const n=(v)=>typeof v==="number"&&Number.isFinite(v)&&v>=0?v:null;const c=n(w&&w.closed),f=n(w&&w.closed_flagged),t=n(g&&g.closed_90d),d=n(g&&g.observed_days);const ceil=t!==null&&d!==null&&d>0?t/Math.min(d,90)*14:null;
  if(c===null)return{state:"held",reason:"unreadable",ceil};if(ceil!==null&&c>ceil)return{state:"held",reason:"exceeds_record",ceil};if(f!==null&&f>c)return{state:"held",reason:"flagged_majority",ceil};return{state:"published",closed:c,ceil}};
const PRE={"2026-09-07":845110,"2026-09-14":870536,"2026-09-21":806570};
(async()=>{
  const sc=await R("get_stats_cache");
  const c=(sc.j&&!Array.isArray(sc.j))?sc.j:(Array.isArray(sc.j)&&sc.j[0])?sc.j[0]:{};
  const rows=Array.isArray(c.hiring_trends)?c.hiring_trends:[];
  const g=(c.ghost_stats&&typeof c.ghost_stats==="object")?c.ghost_stats:{};
  const stale=Array.isArray(c.stale_parts)?c.stale_parts:[];
  info("stats_cache computed_at="+c.computed_at+", "+rows.length+" weekly rows, closed_90d="+fmt(g.closed_90d)+", observed_days="+g.observed_days);
  const shaped=rows.filter(r=>typeof r.closed_flagged==="number").length;
  ok(rows.length>0&&shaped===rows.length,"(a) every cached hiring_trends row carries a numeric closed_flagged ("+shaped+"/"+rows.length+"). Only the new body can write it: 0 means the migration has not landed or no hourly tick has run since -- never judge by the runner saying applied");
  ok(!stale.includes("hiring_trends"),"(b) stale_parts does not name hiring_trends ("+JSON.stringify(stale)+"). Named, the refresh timed out or errored and carried the OLD inflated rows forward under a fresh stamp");
  let seen=0;
  for(const r of rows){const w=String(r.week_start).slice(0,10);if(PRE[w]===undefined)continue;seen++;const s=(Number(r.closed)||0)+(Number(r.closed_flagged)||0);const d=Math.abs(s-PRE[w])/PRE[w];
    ok(typeof r.closed_flagged==="number"&&d<=0.005,"(c) week "+w+": closed "+fmt(r.closed)+" + closed_flagged "+fmt(r.closed_flagged)+" = "+fmt(s)+" against the pre-deploy "+fmt(PRE[w])+" ("+(100*d).toFixed(2)+"% apart, want <= 0.5%). The partition is the proof nothing was lost or invented")}
  if(seen===0)info("(c) none of the three baseline weeks is still inside the 35-day window, so the partition check has nothing to compare -- (a), (b) and (d) carry the proof");
  const sum=rows.reduce((a,r)=>a+(Number(r.closed)||0),0);
  ok(typeof g.closed_90d==="number"&&sum<=g.closed_90d,"(d) the weeks sum to "+fmt(sum)+" against closed_90d "+fmt(g.closed_90d)+" -- a week cannot outnumber its own quarter (pre-deploy 3,194,350 against 1,852,789)");
  for(const r of rows){const v=verdictOf(r,g);info("week "+String(r.week_start).slice(0,10)+": closed "+fmt(r.closed)+", closed_flagged "+fmt(r.closed_flagged)+" -> "+(v.state==="held"?"withheld ("+v.reason+")":"printed")+(v.ceil?" [ceiling "+fmt(Math.round(v.ceil))+"]":""))}
  const last=rows.length>1?rows[rows.length-2]:null;const v=last?verdictOf(last,g):null;
  // INFO, not PASS: this applies the verdict to the cache, so it cannot fail by
  // construction. Whether the DEPLOYED page applies it is (i).
  info("(e) what the new page renders for the last complete week ("+(last?String(last.week_start).slice(0,10):"none")+"): "+(!v?"no week to judge":v.state==="held"?"a dash, withheld for "+v.reason:fmt(v.closed))+". Expect the weeks of 09-07 to 09-28 withheld until the Workday collector is fixed; the tile returns with the first clean full week, and the threshold is not to be relaxed to bring it back sooner");
  const live=await R("get_hiring_trends");
  ok(live.status===200&&Array.isArray(live.j)&&live.ms<45000,"(f) get_hiring_trends live: HTTP "+live.status+" in "+(live.ms/1000).toFixed(1)+"s (want under 45s against the 60s header; pre-fix 7-13s against 20s). Over it, drop the anti-join in posted_closed first"+(live.status!==200?" -- "+live.txt.slice(0,160):""));
  if(Array.isArray(live.j))ok(live.j.length>0&&live.j.every(r=>typeof r.closed_flagged==="number"),"(f) the live answer carries closed_flagged on every row");
  const td=await R("get_takedowns_today");
  const hrs=Math.max(1,Math.ceil((Date.now()-Date.parse(new Date().toISOString().slice(0,10)+"T00:00:00Z"))/3600000));
  const bf=await R("get_board_flow",{p_hours:hrs});const f=Array.isArray(bf.j)?bf.j[0]:bf.j;
  info("(g) get_takedowns_today = "+fmt(td.j)+" against get_board_flow("+hrs+") closed minus superseded = "+(f&&typeof f.closed==="number"?fmt(f.closed-f.superseded):"?")+". The ticker now drops flagged batches the flow still counts, so it reads lower by about the flagged share (pre-deploy 130,373 on 2026-10-01). INFO only: the gap collapses once the collector is fixed");
  const html=await (await fetch(SITE+"/hiring-trends",{headers:{"user-agent":UA}})).text();
  const t=html.replace(/<[^>]*>/g," ").replace(/\s+/g," ");
  // ONE CHECK, because the old build ALSO printed no figure for a held week (its
  // row went null and vanished), so "no opposite-pair label" alone passes before
  // the rebuild. What only the new build prints is a withheld reason or a figure
  // under the ceiling, and never the old label beside either.
  const m=t.match(/([0-9][0-9,]*) — closure events logged that week/);const held=/Takedowns — withheld for that week/.test(t);
  const ceil=verdictOf({closed:0},g).ceil;
  ok(!/opposite pair/.test(t)&&(held||(!!m&&(ceil===null||Number(m[1].replace(/,/g,""))<=ceil))),"(h) crawler HTML: "+(/opposite pair/.test(t)?"still carries the opposite-pair label":held?"the week is withheld, with its reason":m?"prints "+m[1]+" (ceiling "+fmt(Math.round(ceil))+")":"neither a withheld reason nor a weekly takedown figure -- the prerender predates this build (rebuild AFTER the migration) or could not read the cache"));
  // The ceiling reason has to name the rule the verdict applies: twice the
  // average WEEK of the record. The first build of this change said its daily
  // figure, seven times stricter than the arithmetic, so every week it printed
  // broke the rule it stated.
  if(held)ok(!/twice the daily average/.test(t),"(h2) crawler HTML: the withheld reason "+(/twice the daily average/.test(t)?"still states the daily-figure rule the verdict never applied -- the prerender predates the copy fix":"does not state the daily-figure rule"));
  const shell=await (await fetch(SITE+"/")).text();
  const entry=(shell.match(/src="(\/assets\/index-[^"]+\.js)"/)||[])[1];
  if(!entry){info("(i) could not locate the entry bundle in the homepage shell; open /hiring-trends in a browser instead: the takedown tile must read a dash with a Withheld sentence, never 806,570");return}
  const js=await (await fetch(SITE+entry)).text();
  // The 90-day count beside the ledger depth: from about 2026-10-12 the ledger
  // is deeper than the count, and the old copy printed the depth as the window.
  for(const [name,needle] of [["GhostJobIndex","(our record runs "],["DataApi",", from a record "]]){const ch=(js.match(new RegExp(name+"-[\\w-]+\\.js"))||[])[0];if(!ch){info("(k) the entry bundle names no "+name+" chunk; open the page in a browser instead");continue}
    const src=await (await fetch(SITE+"/assets/"+ch)).text();ok(src.includes(needle),"(k) the deployed "+name+" chunk ("+ch+") names the record depth beside the 90-day count once the ledger outlives it -- absent means the page still prints observed_days as the window of a 90-day count")}
  const chunk=(js.match(/HiringTrends-[\w-]+\.js/)||[])[0];
  if(!chunk){info("(i) the entry bundle names no HiringTrends chunk; check /hiring-trends in a browser instead");return}
  const code=await (await fetch(SITE+"/assets/"+chunk)).text();
  ok(code.includes("takedowns logged last week")&&code.includes("takedowns withheld"),"(i) the deployed /hiring-trends chunk ("+chunk+") carries the verdict path -- absent means the hydrated page still prints the raw weekly count");
  ok(/twice the average week of our (own )?90-day closure record/.test(code)&&!/twice the daily average/.test(code),"(j) the deployed chunk states the ceiling as twice the average week of the record, and nowhere as its daily figure -- failing means the copy that shipped with the first build of this change is still live");
})().catch(e=>console.log("FAIL  7g probe threw: "+e.message));
'

echo "== 7h. a day-30 share needs thirty days of reading in full (the watch floor: 20261002121417 / 121843 / 122309) =="
# The three re-issues admit a role to any day-30 chain only if its board was
# read in full from before the role was posted; lap boards are refused for a
# reason of their own. The staged runner has renamed and edited files before,
# so every line below judges BEHAVIOUR: the two new columns on the company
# curve are the proof it applied, and the named boards are the ones the defect
# was reproduced on (careers.ulta.com published 0.9431 with sufficient_30 true
# on 2026-10-01). Read-only: one RPC read on five named boards, one facet list
# for the largest boards (the same call section 3 makes) and three reads of
# fifty of them, the explore cache, the stats-cache read section 4 already
# made, and the stored layoff arms. A read that errs or times out is a FAIL
# naming its code, never an INFO: a claim nothing evaluated has not passed.
R get_company_fill_curve '{"p_tokens":["careers.ulta.com","dominos","catalent~wd1~External","adventisthealthcare~wd1~AdventistHealthCareCareers","AbbVie"]}' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  get_company_fill_curve non-JSON: "+s.slice(0,160))}
if(!Array.isArray(j)||!j.length)return console.log("FAIL  get_company_fill_curve -> "+JSON.stringify(j).slice(0,160));
const keyed=j.every(r=>("watched_from" in r)&&("insufficient_reason_30" in r));
console.log((keyed?"PASS":"FAIL")+"  every row carries watched_from and insufficient_reason_30"+(keyed?" (20261002121417 applied)":" -- the old shape is serving: 20261002121417 did not apply"));
if(!keyed)return;
const by=Object.fromEntries(j.map(r=>[r.company_token,r]));
const line=r=>"bucket="+r.observability_bucket+" sufficient_30="+r.sufficient_30+" S30="+r.still_open_30+" watched_from="+r.watched_from+" reason="+r.insufficient_reason_30+" cohort_to="+r.cohort_to;
for(const t of ["careers.ulta.com","dominos"]){const r=by[t];if(!r){console.log("INFO  "+t+" returned no row");continue}
  if(r.observability_bucket!=="lap_proven"){console.log("INFO  "+t+" is no longer lap_proven: "+line(r));continue}
  const ok=r.insufficient_reason_30==="lap"&&r.sufficient_30===false&&r.still_open_30===null;
  console.log((ok?"PASS":"FAIL")+"  "+t+" refused as a lap board: "+line(r)+" (baseline: Ulta 0.9431, sufficient_30 TRUE)")}
for(const t of ["catalent~wd1~External","adventisthealthcare~wd1~AdventistHealthCareCareers"]){const r=by[t];if(!r){console.log("INFO  "+t+" returned no row");continue}
  if(r.observability_bucket==="lap_proven"){console.log((r.insufficient_reason_30==="lap"?"PASS":"FAIL")+"  "+t+" is lap_proven now and must read lap: "+line(r));continue}
  // A truncated read inside 2026-09-23..10-01 (measured the night of the fix)
  // must hold the floor at or after its day; the ledger is never pruned, so
  // this stays true until the board stops being full_read.
  const ok=typeof r.watched_from==="string"&&r.watched_from>="2026-09-23";
  console.log((ok?"PASS":"FAIL")+"  "+t+" floored at its last cut-short read: "+line(r)+" (want watched_from >= 2026-09-23; baseline S30 0.87-0.93 with sufficient_30 TRUE)")}
const a=by["AbbVie"];
if(!a)console.log("INFO  AbbVie returned no row");
else if(a.watched_from===null&&a.insufficient_reason_30==="watch")console.log("FAIL  AbbVie reads watch with no floor: job_board_board_watch holds no row for it -- the tenure table is not seeded, and every full_read board is being refused ("+line(a)+")");
else{const ok=a.sufficient_30===true&&a.insufficient_reason_30===null&&typeof a.watched_from==="string"&&a.watched_from<="2026-08-06";
  console.log((ok?"PASS":"FAIL")+"  AbbVie (read in full since 2026-08-02) keeps its figure: "+line(a)+" (want sufficient, floor on or before 2026-08-06, S30 about 0.29)")}
})'
# THE LARGEST BOARDS, IN CHUNKS, AND A CHUNK THAT ERRS IS A FAIL. The company
# curve carries a 25-second header; one call over the 150 facet tokens took
# 17s before the floor added its joins, and a timeout (57014) comes back from
# PostgREST as a JSON object, not an array. Until 2026-10-02 this section
# printed that as INFO "returned no rows", so the three claims below could go
# unevaluated with no FAIL anywhere. Fifty tokens a call took 2.7s to 8.3s
# that morning (pre-fix, read-only). Every chunk that answers anything but an
# array prints FAIL with its error code, and so does a facet list that names
# no company: a check that could not run is not a check that passed.
CHUNK7H=50
export CHUNK7H
J '{"action":"list","limit":1,"includeFacets":true}' > /tmp/vd_7h_facets.json
node -e 'let t=[];try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_7h_facets.json","utf8"));t=(j.companies||[]).map(c=>c&&c.token).filter(x=>typeof x==="string").slice(0,150)}catch{}
require("fs").writeFileSync("/tmp/vd_7h_tokens.json",JSON.stringify(t))'
NCH7H=$(node -e 'const t=JSON.parse(require("fs").readFileSync("/tmp/vd_7h_tokens.json","utf8"));process.stdout.write(String(Math.ceil(t.length/Number(process.env.CHUNK7H))))')
i7h=0
while [ "$i7h" -lt "$NCH7H" ]; do
  R get_company_fill_curve "$(node -e 'const t=JSON.parse(require("fs").readFileSync("/tmp/vd_7h_tokens.json","utf8"));const k=Number(process.env.CHUNK7H),i=Number(process.argv[1]);process.stdout.write(JSON.stringify({p_tokens:t.slice(i*k,i*k+k)}))' "$i7h")" > "/tmp/vd_7h_chunk_$i7h.json"
  i7h=$((i7h+1))
done
node -e '(()=>{const fs=require("fs");const rd=f=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
let toks=[];try{toks=JSON.parse(rd("/tmp/vd_7h_tokens.json"))}catch{}
if(!toks.length)return console.log("FAIL  largest-boards check not evaluated: the facet list named no company -- "+rd("/tmp/vd_7h_facets.json").slice(0,120));
const k=Number(process.env.CHUNK7H),n=Math.ceil(toks.length/k),j=[];let failed=0;
for(let i=0;i<n;i++){const s=rd("/tmp/vd_7h_chunk_"+i+".json");let b;
  try{b=JSON.parse(s)}catch{failed++;console.log("FAIL  largest boards, chunk "+(i+1)+" of "+n+": no JSON (a 60s client timeout, or an HTML error page) -- "+s.slice(0,120));continue}
  if(!Array.isArray(b)){failed++;console.log("FAIL  largest boards, chunk "+(i+1)+" of "+n+": error "+((b&&b.code)||"without a code")+" -- "+String((b&&b.message)||JSON.stringify(b)).slice(0,140)+((b&&b.code)==="57014"?" (the function hit its own 25s header)":""));continue}
  j.push(...b)}
if(!j.length)return console.log("FAIL  largest boards: no chunk answered with rows, so none of the three claims was evaluated");
const over=" ("+j.length+" of "+toks.length+" boards"+(failed?"; "+failed+" chunk(s) failed above":"")+")";
if(!j.every(r=>"insufficient_reason_30" in r))return console.log("FAIL  largest boards: no watch-floor columns on the rows -- the old get_company_fill_curve is serving, so nothing below can be judged"+over);
const bad=j.filter(r=>r.sufficient_30===true&&(r.observability_bucket==="lap_proven"||r.watched_from===null||r.watched_from===undefined||String(r.watched_from)>=String(r.cohort_to)));
console.log((bad.length===0&&!failed?"PASS":"FAIL")+"  largest boards: no sufficient_30 row is lap_proven or lacks a floor before cohort_to"+over+(bad.length?" -- "+bad.slice(0,8).map(r=>r.company_token+"("+r.observability_bucket+","+r.watched_from+")").join(", "):""));
const lapWrong=j.filter(r=>r.observability_bucket==="lap_proven"&&r.insufficient_reason_30!=="lap");
console.log((lapWrong.length===0&&!failed?"PASS":"FAIL")+"  every lap_proven board among them reads reason lap"+over+(lapWrong.length?" -- "+lapWrong.slice(0,8).map(r=>r.company_token+"="+r.insufficient_reason_30).join(", "):""));
const mute=j.filter(r=>(r.sufficient_30===true)!==(r.insufficient_reason_30===null));
console.log((mute.length===0&&!failed?"PASS":"FAIL")+"  a refused row always names its reason and a sufficient row never does"+over+(mute.length?" -- "+mute.slice(0,8).map(r=>r.company_token).join(", "):""));
const tally={};for(const r of j){const t=r.insufficient_reason_30===null?"sufficient":r.insufficient_reason_30;tally[t]=(tally[t]||0)+1}
console.log("INFO  largest-boards day-30 verdicts: "+JSON.stringify(tally)+" (before the fix 107 of the top 150 were sufficient, 100 of them lap_proven)");
})()'
# THE FIELD ROWS, FROM THE CACHE PRODUCTION ACTUALLY HAS. Read-only on
# 2026-10-02 at 01:40Z and 03:48Z: get_stats_cache carries no fill_curve part
# (20260928004823 and 20260928011742 have not applied there), so a check that
# read only that part printed "no cached field rows" on every run and never
# judged the field grain at all. The rows that exist are get_explore_cache's
# field_curves -- get_category_fill_curve(90, 300) keyed by category,
# rewritten whole at :07 -- and that is what is judged here; the stats part is
# judged the same way whenever it exists.
# DATED AGAINST THE APPLY, NOT TRUSTED FOR BEING PRESENT. The re-issue removes
# both parts at apply, but a :07 run already scanning when it commits finishes
# on the definition it began with and then replaces its whole row, putting the
# pre-fix pool back, stamped with the run's start -- before the apply. So a
# stamp before the apply is a FAIL, and only rows stamped at or after it can
# have come from the floor: necessary, not sufficient (the next paragraph).
# The apply time is not readable with the anon key, so it is an input: set
# DAY30_APPLIED_AT (UTC, the moment the LAST of the three files finished
# applying, which dates both chains safely) in the environment or on the line
# below once it is known. Until then the dating lines -- the field rows' and
# the layoff arm's -- read FAIL, which is the point.
# WHAT A STAMP PROVES, AND WHAT THE GATE SHARE CANNOT. A stamp at or after
# the apply says WHEN the rows were computed, never WHICH definition computed
# them: 121843 is a file of its own, and the staged runner can fail it, or
# edit it and stage it under another name, while 121417 and 122309 land. Its
# shape is unchanged, so nothing the anon key can read names the definition;
# the body can, with service role, and a line below prints the query. What is
# left is gate_share_30, and it is DRIFT-LIMITED. Per field it moved by up to
# 0.16 between one hourly run of the old pool and the next (finance 0.6927 at
# 2026-10-02 00:07Z, 0.5374 at 01:07Z; healthcare 0.8226 at 04:07Z, 0.6808
# at 05:07Z, on the same cohort), and at 04:07Z the old definition already
# sat below the highest of its three earlier readings on 7 of 18 fields -- so
# the per-field line is corroboration, printed as INFO and never as a
# verdict; BASE_HI is each field's highest over the readings beside
# POOLED_HI. Pooled over the fields by their dated cohorts the old pool is
# steadier (POOLED_HI is the highest of the hourly readings recorded beside
# it), but the floor's own size is not known well enough to put a pass bar
# under the old pool: on the read-only walk of every catalogue board at
# 2026-10-01T22:51Z, lap_proven boards carried 11.9% to 19.1% of the day-30
# cohort on boards with five events of their own, depending on the weight,
# and the watch clip on full_read boards cannot be measured from outside
# before the apply. Lap refusal alone takes POOLED_HI only to 0.56-0.61,
# inside the old pool's own spread. So the pooled line FAILs only in the
# direction that is sound -- at or above POOLED_HI, where the floor could
# leave it only if the old pool had drifted about 0.09 past every reading on
# record -- and is INFO otherwise: below POOLED_HI is consistent with the
# floor, and is not proof of it.
DAY30_APPLIED_AT="${DAY30_APPLIED_AT:-}"
export DAY30_APPLIED_AT
R get_explore_cache '{}' > /tmp/vd_7h_explore.json
node -e '(()=>{const fs=require("fs");const rd=f=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
// The highest gate_share_30 of each field over the same readings: corroboration only.
const BASE_HI={admin:0.4773,legal:0.4709,other:0.7029,sales:0.6867,design:0.4618,data_ai:0.5689,finance:0.6972,product:0.5235,science:0.6174,customer:0.5722,security:0.6022,education:0.6572,marketing:0.4389,people_hr:0.4626,healthcare:0.8226,operations:0.7141,engineering:0.6918,hospitality_retail:0.6367};
// The old pool, gate_share_30 pooled over the eighteen fields by dated_cohort_n_30:
// 2026-10-01 21:07Z 0.6453, 22:07Z 0.6133, 23:07Z 0.6518; 2026-10-02 00:07Z 0.6738, 01:07Z 0.6603, 03:07Z 0.6574, 04:07Z 0.6889, 05:07Z 0.6440
const POOLED_HI=0.6889;
const MAX_EXPLORE_AGE_MIN=75;
const applied=process.env.DAY30_APPLIED_AT||"",at=Date.parse(applied);
if(applied&&!Number.isFinite(at))console.log("FAIL  DAY30_APPLIED_AT="+applied+" is not a timestamp, so no field row below can be dated against the apply");
const N=v=>v===null||v===undefined?null:Number(v);
const judge=(label,rows,stamp,carried)=>{
  if(carried)console.log("FAIL  "+label+": carried forward from an earlier run (stale_parts names it) -- the run stamped "+stamp+" could not compute the curve, and the carried rows carry no stamp of their own, so they cannot be shown to come from the floor");
  const t=Date.parse(stamp);let dated=false;
  if(!Number.isFinite(t))console.log("FAIL  "+label+": no usable stamp ("+stamp+")");
  else if(!applied)console.log("FAIL  "+label+" computed_at="+stamp+" cannot be dated against the apply: set DAY30_APPLIED_AT to the UTC time the last of 20261002121417 / 121843 / 122309 finished applying (a run already scanning at the apply writes the pre-fix pool back, stamped before it)");
  else if(!Number.isFinite(at)){}
  else if(t<at)console.log("FAIL  "+label+" computed_at="+stamp+" is BEFORE the apply ("+applied+"): a run that began before 20261002121843 committed, which may have written the pre-fix pool back over the withhold -- re-run after the next refresh");
  else if(!carried){dated=true;console.log("PASS  "+label+" computed_at="+stamp+" is dated at or after the apply ("+applied+"): the run that wrote these rows began after 20261002121843 committed -- a stamp says when, not which definition")}
  const ng=dated?"":" -- not graded: these rows are not dated after the apply";
  let num=0,den=0;
  for(const r of rows){const d=N(r.dated_cohort_n_30);if(!(d>0))continue;num+=(N(r.gate_share_30)||0)*d;den+=d}
  if(!den)console.log((dated?"FAIL":"INFO")+"  "+label+": no field publishes dated_cohort_n_30, so gate_share_30 cannot be pooled"+ng);
  else{const p=num/den;
    console.log((dated&&p>=POOLED_HI?"FAIL":"INFO")+"  "+label+": gate_share_30 pooled over "+den+" dated roles = "+p.toFixed(4)+" (the highest reading of the old pool "+POOLED_HI+")"+(!dated?ng:p>=POOLED_HI?" -- at or above every reading of the old pool: 20261002121843 did not take, or the old pool drifted past every reading on record; read the body with service role":" -- below it: consistent with the floor, NOT proof of it, because the old pool has read lower too"))}
  const fell=[],held=[];
  for(const r of rows){const b=BASE_HI[r.category],g=N(r.gate_share_30);if(b===undefined)continue;if(g===null||g<b)fell.push(r.category);else held.push(r.category+" "+g+" >= "+b)}
  console.log("INFO  "+label+": corroboration only, drift-limited -- gate_share_30 below its highest pre-fix reading on "+fell.length+" of "+rows.length+" field(s)"+(held.length?"; HELD on "+held.join(", "):"")+ng);
  const leak=rows.filter(r=>!(N(r.gate_share_30)>0)&&r.still_open_30!==null&&r.still_open_30!==undefined);
  const hollow=rows.filter(r=>r.sufficient_30===true&&(r.still_open_30===null||r.still_open_30===undefined||!(N(r.gate_share_30)>0)));
  console.log((!dated?"INFO":leak.length||hollow.length?"FAIL":"PASS")+"  "+label+": no field with nothing admitted carries a figure, and no sufficient field lacks one"+(leak.length?" -- a figure with nothing admitted: "+leak.map(r=>r.category).join(", "):"")+(hollow.length?" -- sufficient with no figure: "+hollow.map(r=>r.category).join(", "):"")+ng);
  const refused=rows.filter(r=>r.sufficient_30!==true).map(r=>r.category+"(gate="+r.gate_share_30+")");
  console.log("INFO  "+label+": fields not sufficient under the floor: "+(refused.length?refused.join(", "):"none")+" -- each must render a reason on the page, never a number");
};
const s=rd("/tmp/vd_7h_explore.json");let j;try{j=JSON.parse(s)}catch{}
const g=Array.isArray(j)?j[0]:j;
if(j===undefined)console.log("FAIL  get_explore_cache answered no JSON (a 60s client timeout, or an HTML error page) -- "+s.slice(0,120));
else if(!g||typeof g!=="object"||("code" in g&&"message" in g))console.log("FAIL  get_explore_cache errored: "+JSON.stringify(g).slice(0,160));
else{
  const root=g.computed_at,ageMin=(Date.now()-Date.parse(root))/6e4;
  const stale=Array.isArray(g.stale_parts)?g.stale_parts:[];
  if(!Number.isFinite(ageMin))console.log("FAIL  explore cache carries no usable computed_at ("+root+")");
  else if(ageMin>MAX_EXPLORE_AGE_MIN)console.log("FAIL  explore cache last ran "+Math.round(ageMin)+" min ago (computed_at "+root+"): the :07 refresh has stopped, so its rows reflect nothing recent");
  if(!("field_curves" in g)){
    if(Number.isFinite(at)&&Date.parse(root)>=at)console.log("FAIL  explore cache: a run that began after the apply wrote no field_curves key, which refresh_explore_cache always writes -- something else replaced the row");
    else console.log("INFO  explore cache: field_curves withheld at apply (20261002121843) and no :07 run has completed since (root computed_at "+root+"); re-run after the next :07 -- the absence cannot outlive the "+MAX_EXPLORE_AGE_MIN+"-minute bar above without a FAIL");
  }else{
    const fc=g.field_curves;
    const rows=fc&&typeof fc==="object"&&!Array.isArray(fc)?Object.entries(fc).map(([category,r])=>Object.assign({category},r)):[];
    if(!rows.length)console.log("FAIL  explore cache: field_curves is empty"+(stale.includes("field_curves")?" and stale_parts names it":"")+" -- the :07 run could not compute the field curve and had nothing to carry, so the field rows are blank (the five-minute header is the suspect: the floor added a join per observability row)");
    else judge("explore cache field_curves ("+rows.length+" fields)",rows,root,stale.includes("field_curves"));
  }
}
console.log("INFO  20261002121843 has no anon-readable proof of its own (its result shape is unchanged); with service role: SELECT pg_get_functiondef(\x27public.get_category_fill_curve(int, int)\x27::regprocedure) LIKE \x27%watched_from%\x27 -- true once it applied (its own self-verify raises otherwise)");
let m=null;try{m=JSON.parse(rd("/tmp/vd_cat_meta.json"))}catch{}
const keys=m&&Array.isArray(m.cache_keys)?m.cache_keys:[];
if(!m)console.log("FAIL  section 4 left no stats-cache meta to read");
else if(!keys.length||(keys.includes("code")&&keys.includes("message")))console.log("FAIL  get_stats_cache errored or answered nothing (keys: "+keys.join(",")+")");
else if(!m.present)console.log("INFO  stats cache carries no fill_curve part (20260928004823 not live in production as of 2026-10-02, or withheld at apply and no :27 run since) -- the explore arm above is the field check");
else{let r=null;try{r=JSON.parse(rd("/tmp/vd_cat.json"))}catch{}
  if(!Array.isArray(r)||!r.length)console.log("FAIL  stats cache fill_curve is present but carries no rows (stale_parts "+JSON.stringify(m.stale_parts)+")");
  else judge("stats cache fill_curve ("+r.length+" fields)",r,m.computed_at,m.carried);
}
})()'
# THE LAYOFF ARMS ARE DATED THE SAME WAY, AND FOR THE SAME REASON. Until
# 2026-10-02 the recomputed control arm passed on gate_share_30 under one
# pre-fix reading, 0.7395 (stored 2026-10-01T05:10Z). The next day the OLD
# writer, 20261002122309 not applied, stored 0.717 at 05:10Z, and this line
# printed "PASS ... recomputed under the floor" on production with no floor
# in it -- the field grain's drift, on the third chain. 122309 nulls the
# stored counts at apply, so a recomputed arm stamped before the apply means
# it did not take, and one stamped after it is dated, not proven; the gate
# share then FAILs only at or above the highest reading of the old arm.
# The old control arm, gate_share_30 as stored by the 05:10 refresh:
# 2026-10-01T05:10Z 0.7395, 2026-10-02T05:10Z 0.7170
LAYOFF_HI=0.7395
export LAYOFF_HI
R get_layoff_partition '{}' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  get_layoff_partition answered no JSON -- "+s.slice(0,120))}
if(j&&!Array.isArray(j)&&("code" in j||"message" in j))return console.log("FAIL  get_layoff_partition errored: "+((j.code)||"without a code")+" -- "+String(j.message||"").slice(0,140));
const rows=Array.isArray(j)?j:[j];const c=rows.find(r=>r&&r.lp_arm==="control");
if(!c)return console.log("FAIL  no control arm -- "+JSON.stringify(j).slice(0,120));
if(rows.every(r=>r.lp_reason==="uncontrolled"))return console.log("PASS  both stored arms withheld (reason uncontrolled): 20261002122309 applied and the 05:10 refresh has not re-run since; control computed_at="+c.lp_computed_at);
const HI=Number(process.env.LAYOFF_HI),applied=process.env.DAY30_APPLIED_AT||"",at=Date.parse(applied),t=Date.parse(c.lp_computed_at);
const line="gate_share_30="+c.lp_gate_share_30+" S30="+c.lp_still_open_30+" sufficient="+c.lp_sufficient_30+" reason="+c.lp_reason+" computed_at="+c.lp_computed_at;
if(!applied)return console.log("FAIL  layoff control arm recomputed but cannot be dated against the apply: set DAY30_APPLIED_AT to the UTC time the last of 20261002121417 / 121843 / 122309 finished applying -- "+line);
if(!Number.isFinite(at))return console.log("FAIL  layoff control arm: DAY30_APPLIED_AT="+applied+" is not a timestamp -- "+line);
if(!Number.isFinite(t))return console.log("FAIL  layoff control arm carries no usable stamp -- "+line);
if(t<at)return console.log("FAIL  layoff control arm stored BEFORE the apply ("+applied+") and not withheld: 20261002122309 nulls the stored counts at apply, so this is the old writer still serving -- "+line);
console.log((c.lp_reason==="uncontrolled"?"FAIL":"PASS")+"  layoff control arm is dated at or after the apply ("+applied+")"+(c.lp_reason==="uncontrolled"?" but still reads uncontrolled: the refresh after the apply wrote no counts":": stored by a refresh that began after the apply -- a stamp says when, not which writer")+" -- "+line);
const g=c.lp_gate_share_30===null||c.lp_gate_share_30===undefined?NaN:Number(c.lp_gate_share_30);
console.log((!(g<HI)?"FAIL":"INFO")+"  layoff control arm: gate_share_30="+c.lp_gate_share_30+" (the highest reading of the old arm "+HI+")"+(!(g<HI)?" -- at or above it, or no number: 20261002122309 did not take, or the old arm drifted past every reading on record":" -- below it: consistent with the floor, NOT proof of it, because the old arm has read lower too"));
})'

echo "== 7i. .84: the marquee boards too big to hold serve again (light set 500; lever/ashby read a posting at a time) =="
# .84's claim. On 2026-10-01 these nine served ZERO while their own feeds held
# 12-602 postings inside the 30-day window: the 4 MB byte bound refused their
# list bodies, a refused board is deferred with no verification stamp, and the
# 03:41 sweep then hides everything it holds. Greenhouse recovers when each
# board trips once more and enrols in the (now 500-slot) light set, so give it
# TWO cold rotations after the deploy; lever/ashby read in the same visit, so
# ONE. The light set's SIZE is judged only after one full cold rotation too: at
# publish it holds what .81 persisted (at most 50). lastRotationAgeMin below
# resets at each wrap. Every probe is a read: the board's own list/status
# actions, and the vendors' public GET feeds. The detail action is NOT used
# here — it writes a fetched description back.
J '{"action":"status"}' > /tmp/vd_7i_status.json
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const j=JSON.parse(fs.readFileSync("/tmp/vd_7i_status.json","utf8"));
ok(/^2026-09-09\.(\d+)$/.test(String(j.version))&&Number(String(j.version).split(".").pop())>=84,"status.version = "+j.version+" (want 2026-09-09.84 or later, which carry .84; .81 means the bundle did not deploy)");
const ss=j.sliceStats||{};
const LS=ss.lightSet,LC=ss.lightCap;
ok(typeof LS==="number"&&typeof LC==="number"&&LS<LC,"sliceStats.lightSet = "+LS+" of lightCap "+LC+" (want both present and set < cap: not saturated; judged now)");
if(typeof LS==="number"&&typeof LC==="number"&&LS<LC)console.log((LS>=100?"PASS":"INFO")+"  sliceStats.lightSet = "+LS+" (want >= 100, but only once a full cold rotation has run since the publish: the row .81 persisted holds at most 50 and the set grows by one per over-bound visit, so ~50 at publish rising to ~103. Still under 100 after lastRotationAgeMin has reset TWICE since the publish is a FAIL)");
console.log("INFO  lastRotationAgeMin = "+j.lastRotationAgeMin+" — greenhouse needs two cold rotations after the deploy, lever/ashby one");
const ck=j.chainKick||{};ok(ck.status===200,"chainKick.status = "+ck.status+" ("+ck.outcome+", ageMin "+ck.ageMin+")");
ok(ss.wallStopped===false,"sliceStats.wallStopped = "+ss.wallStopped+" (a streamed read must not push slices into the wall)");
ok(typeof ss.heapMb==="number"&&ss.heapMb<100,"sliceStats.heapMb = "+ss.heapMb+" (want < 100; baseline 37-45)");
let prev=null;try{prev=JSON.parse(fs.readFileSync("/tmp/vd_status.json","utf8"))}catch{}
if(prev&&prev.cursor&&j.cursor){const a=prev.cursor,b=j.cursor;const moved=b.cold!==a.cold||b.coldDone!==a.coldDone||b.hot!==a.hot;console.log((moved?"PASS":"INFO")+"  cursor "+JSON.stringify(a)+" -> "+JSON.stringify(b)+(moved?" (ingest is moving)":" (no motion since section 1: a hot phase parks the cold cursor; re-run before calling the chain dead)"))}
const nine=["anthropic","databricks","cloudflare","mongodb","okta","spacex","openai","snowflake","palantir"];
const ob=Array.isArray(j.oversizeBoards)?j.oversizeBoards:[];
const named=ob.filter(e=>nine.includes(e.token));
ok(named.length===0,"oversizeBoards names none of the nine"+(named.length?": "+named.map(e=>e.source+":"+e.token+" "+e.mb+"MB").join(", "):""));
const followUp=["lush","samsara","pulse","liquidpersonnel"];
const gh=ob.filter(e=>e.source==="greenhouse");const ghOther=gh.filter(e=>!followUp.includes(e.token));
ok(ghOther.length===0,"greenhouse registry entries are only the shared-token / oversize-light-list follow-up ("+gh.map(e=>e.token).join(", ")+")"+(ghOther.length?" — unexpected: "+ghOther.map(e=>e.token).join(", "):""));
const lv=ob.filter(e=>e.source==="lever"),ab=ob.filter(e=>e.source==="ashby");
console.log("INFO  lever entries still deferred (slow or over budget): "+(lv.map(e=>e.token+" "+e.mb+"MB").join(", ")||"none"));
console.log("INFO  ashby entries still deferred (bjakcareer expected: over the retained budget): "+(ab.map(e=>e.token+" "+e.mb+"MB").join(", ")||"none"));
console.log("INFO  oversizeBoardCount = "+j.oversizeBoardCount+" (140 on 2026-10-01; status shows only the newest 50, so judge the drop, not zero)");'
# Served vs the vendor's own in-window count, per board. In-window is the field
# each normaliser stores: greenhouse first_published, ashby publishedAt, lever createdAt.
for VT in greenhouse:anthropic greenhouse:databricks greenhouse:cloudflare greenhouse:mongodb greenhouse:okta greenhouse:spacex ashby:openai ashby:snowflake lever:palantir; do
  V=${VT%%:*}; T=${VT#*:}
  case "$V" in
    greenhouse) U="https://boards-api.greenhouse.io/v1/boards/$T/jobs";;
    ashby) U="https://api.ashbyhq.com/posting-api/job-board/$T";;
    lever) U="https://api.lever.co/v0/postings/$T?mode=json";;
  esac
  curl -s --compressed -m 120 "$U" -o /tmp/vd_7i_feed.json
  J "{\"action\":\"list\",\"companies\":[\"$T\"],\"vendors\":[\"$V\"],\"groupSimilar\":false,\"limit\":1}" > /tmp/vd_7i_list.json
  node -e '(()=>{
const fs=require("fs");const [V,T]=process.argv.slice(1);const cut=Date.now()-30*86400000;
let feed;try{feed=JSON.parse(fs.readFileSync("/tmp/vd_7i_feed.json","utf8"))}catch{return console.log("INFO  "+V+":"+T+" vendor feed unreadable — cannot judge")}
const t=(x)=>{const n=typeof x==="number"?x:Date.parse(String(x??""));return Number.isFinite(n)&&n>=cut};
const want=V==="greenhouse"?(feed.jobs||[]).filter(x=>t(x.first_published)).length:V==="ashby"?(feed.jobs||[]).filter(x=>x.isListed!==false&&t(x.publishedAt)).length:(Array.isArray(feed)?feed:[]).filter(x=>t(x.createdAt)).length;
let l;try{l=JSON.parse(fs.readFileSync("/tmp/vd_7i_list.json","utf8"))}catch{return console.log("FAIL  "+V+":"+T+" list non-JSON")}
const got=Number(l.total);const tol=Math.max(2,Math.round(want*0.1));
const pass=got>0&&Math.abs(got-want)<=tol;
console.log((pass?"PASS":"FAIL")+"  "+V+":"+T+" serves "+got+" vs "+want+" in-window on its own feed (want within +/-"+tol+")"+(got===0?" — still dark; judge only after "+(V==="greenhouse"?"two cold rotations":"one cold rotation")+" since the deploy":""));})();' "$V" "$T"
done
# The flapping. The 03:41 UTC sweep zeroed boards that went 48 h unread; re-run
# this line on each of the next two mornings AFTER 03:41 UTC.
for T in okta anthropic axon; do
  J "{\"action\":\"list\",\"companies\":[\"$T\"],\"vendors\":[\"greenhouse\"],\"groupSimilar\":false,\"limit\":1}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return console.log("FAIL  list non-JSON")}const n=Number(j.total);console.log((n>0?"PASS":"FAIL")+"  greenhouse:'"$T"' total = "+n+" (must not return to 0 after a 03:41 UTC sweep; repeat on the next two mornings)")})'
done
# Streamed descriptions arrive with the read (lever/ashby have no filler): the
# share of openai rows holding stored text, read through the list filter.
OA=$(J '{"action":"list","companies":["openai"],"vendors":["ashby"],"groupSimilar":false,"limit":1}')
OD=$(J '{"action":"list","companies":["openai"],"vendors":["ashby"],"groupSimilar":false,"hasDescription":true,"limit":1}')
node -e 'const a=JSON.parse(process.argv[1]||"{}"),d=JSON.parse(process.argv[2]||"{}");const n=Number(a.total),k=Number(d.total);console.log((n>0&&k>=0.9*n?"PASS":"FAIL")+"  ashby:openai rows with a stored description: "+k+" of "+n+" (want >= 90%; 4 of 281 were the oldest, dropped by the retention ceiling, on 2026-10-01)")' "$OA" "$OD"

echo "== 7j. .85: the anonymous board budget -- counted per address, observed first, our servers exempt =="
# .85's claim. The board counts list/detail/facets/company-suggest/exists/
# semantic-search/application-questions/verify per address per UTC day
# (anon-budget.ts, migration 20261002140000) and ships OBSERVING: the
# migration seeds {"enforce": false}. Enforcement is the owner's one statement
# in docs/job-board-deploy-notes.md, and only once every line here is PASS --
# above all the address the function derives (budget-echo) matching the one
# Cloudflare reports for this machine (/cdn-cgi/trace), the same answer when
# the request WRITES those headers itself, and no internal caller arriving
# without its reader proof (unproven_*). Every probe is a read; the only rows
# written are this script's own counted calls.
J '{"action":"status"}' > /tmp/vd_7j_status.json
curl -s -m 30 "$B/cdn-cgi/trace" > /tmp/vd_7j_trace.txt
# FORGERY. The gate trusts cf-connecting-ip, the last x-forwarded-for hop and
# cf-ipcountry. If a caller could write them through, it could pick a fresh
# bucket per request, land in the never-refused 'unknown' bucket with a
# private address, or claim another country. budget-echo is uncounted and
# reads no database. The first request forges all three (TEST-NET addresses
# and a country that is not this machine's); the second leaves out
# cf-connecting-ip, so if the platform refuses any request carrying it, the
# other two forgeries are still measured.
LOC7J=$(sed -n 's/^loc=//p' /tmp/vd_7j_trace.txt | tr -d '\r')
FCC7J=AQ; [ "$LOC7J" = "AQ" ] && FCC7J=TV
printf '%s' "$FCC7J" > /tmp/vd_7j_forged_cc.txt
curl -s -m 30 -o /tmp/vd_7j_echo_forged.json -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -H "cf-connecting-ip: 192.0.2.77" -H "x-forwarded-for: 192.0.2.78" -H "cf-ipcountry: $FCC7J" -d '{"action":"budget-echo"}' > /tmp/vd_7j_echo_forged_code.txt
curl -s -m 30 -o /tmp/vd_7j_echo_forged_xff.json -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -H "x-forwarded-for: 192.0.2.78" -H "cf-ipcountry: $FCC7J" -d '{"action":"budget-echo"}' > /tmp/vd_7j_echo_forged_xff_code.txt
J '{"action":"budget-echo"}' > /tmp/vd_7j_echo_probe.json
curl -s -m 30 -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"budget-echo"}' > /tmp/vd_7j_echo_plain.json
curl -s -m 30 -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -H "x-rsp-caller: mcp" -H "x-rb-reader: 00000000000000000000000000000000" -d '{"action":"budget-echo"}' > /tmp/vd_7j_echo_mcp.json
MC -d '{"jsonrpc":"2.0","id":71,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-deploy-7j","version":"0"}}}' > /tmp/vd_7j_mcp_init.json
R get_board_anon_hourly '{"p_hours":3}' > /tmp/vd_7j_before.json
# The traffic the deltas below must see: one probe-declared list, one
# undeclared facets read (kind address), one keyless MCP board_stats (reaches
# the board through agent-mcp's board(): must NOT land as unproven_mcp), and,
# with the owner's key, one /v1 ranked read (must NOT land as unproven_api).
J '{"action":"list","limit":1}' > /dev/null
curl -s -m 60 -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"facets"}' > /dev/null
MC -d '{"jsonrpc":"2.0","id":72,"method":"tools/call","params":{"name":"board_stats","arguments":{}}}' > /tmp/vd_7j_mcp_call.json
if [ -n "$RB" ]; then curl -s -m 60 -o /dev/null -w '%{http_code}' "$B/functions/v1/public-api/v1/jobs?engine=ranked&limit=1&q=nurse" -H "Authorization: Bearer $RB" -H "apikey: $K" > /tmp/vd_7j_v1.txt; else printf 'none' > /tmp/vd_7j_v1.txt; fi
R get_board_anon_hourly '{"p_hours":3}' > /tmp/vd_7j_after.json
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};const js=(f)=>{try{return JSON.parse(rd(f))}catch{return null}};
const st=js("/tmp/vd_7j_status.json")||{};
ok(/^2026-09-09\.(\d+)$/.test(String(st.version))&&Number(String(st.version).split(".").pop())>=85,"status.version = "+st.version+" (want 2026-09-09.85 or later, which carry it)");
const ab=st.anonBudget;
ok(!!ab&&typeof ab==="object","status.anonBudget present"+(ab?"":" -- the .85 bundle is not serving"));
if(ab){
  ok(ab.settingPresent===true,"anonBudget.settingPresent = "+ab.settingPresent+" (the migration seeds the row; false = 20261002140000 not applied)");
  if(ab.countriesListed===0)console.log("PASS  country switch OFF (countriesListed 0)");
  else ok(false,"country switch is ON or malformed: countriesListed = "+JSON.stringify(ab.countriesListed)+" -- only the owner turns it on; if they did, this line is expected");
  info("anonBudget.enforce = "+ab.enforce+(ab.enforce===false?" (observe-first: counting, never refusing; enable with the one statement in the deploy note once this section is all PASS)":" (ENFORCING)"));
  const d=ab.defaults||{};ok(d.address===10000&&d.build===15000&&d.probe===10000,"default caps address/build/probe = "+d.address+"/"+d.build+"/"+d.probe+" (want 10000/15000/10000, one day row per address)");
  if(ab.overrides&&Object.keys(ab.overrides).length)info("cap overrides in the setting row: "+JSON.stringify(ab.overrides));
}
const init=js("/tmp/vd_7j_mcp_init.json")||{};const mv=((init.result||{}).serverInfo||{}).version;
ok(mv==="2026-09-04.11","agent-mcp serverInfo.version = "+mv+" (want exactly 2026-09-04.11: the build that sends the reader proof)");
const kv={};for(const l of rd("/tmp/vd_7j_trace.txt").split("\n")){const i=l.indexOf("=");if(i>0)kv[l.slice(0,i)]=l.slice(i+1).trim()}
const plain=js("/tmp/vd_7j_echo_plain.json")||{},probe=js("/tmp/vd_7j_echo_probe.json")||{},mcp=js("/tmp/vd_7j_echo_mcp.json")||{};
ok(plain.source==="cf"||plain.source==="xff","budget-echo source = "+plain.source+" (want cf or xff; none = the platform hands the function no client address, so everyone is unknown_address)");
ok(!!kv.ip&&plain.address===kv.ip,"the address the function derives = "+plain.address+" vs Cloudflare trace ip = "+kv.ip+" (must match before enforcing)");
const loc=/^[A-Z]{2}$/.test(kv.loc||"")&&kv.loc!=="XX"?kv.loc:"XX";
// .86: no cf-ipcountry reaches the function on this platform, so the country
// is CN when the address is in a block APNIC delegated to China and XX for
// everything else (countrySource registry / none). Only a cf source can name
// the country of this machine; without one the right answer here is XX unless
// this machine is in mainland China. .85 has no countrySource and is judged
// the old way, which is how the inert switch was found.
const ccWant=plain.countrySource==="cf"||!plain.countrySource?loc:(loc==="CN"?"CN":"XX");
ok(plain.country===ccWant,"the country the function reads = "+plain.country+" (source "+(plain.countrySource||"unnamed: .85")+") vs trace loc = "+kv.loc+", want "+ccWant+(plain.countrySource&&plain.countrySource!=="cf"?" (no cf-ipcountry arrives; .86 reads mainland China from the address and calls the rest XX)":" (XX here makes the country switch inert)"));
ok(plain.kind==="address"&&plain.exempt===false,"an undeclared anon read classifies as kind address, counted ("+plain.kind+", exempt "+plain.exempt+")");
const fcc=rd("/tmp/vd_7j_forged_cc.txt").trim()||"AQ";const echoes=plain.source==="cf"||plain.source==="xff";
const forged=(f,code,what,refusable)=>{const e=js(f);const c=rd(code).trim();
  // Judged against the UNFORGED echo, not the trace country: on .86 the
  // registry and Cloudflare can disagree about this machine without any header
  // getting through, and that disagreement is the country line above to report.
  if(e&&typeof e.source==="string")return ok(!!kv.ip&&e.address===kv.ip&&e.address===plain.address&&e.country===plain.country&&(e.countrySource??null)===(plain.countrySource??null),what+" is read as "+e.address+" / "+e.country+" vs the unforged "+plain.address+" / "+plain.country+" and trace ip "+kv.ip+" (must match before enforcing: a header the caller writes must not pick its bucket, the unknown_address escape or its country)");
  if(refusable&&echoes&&/^4[0-9][0-9]$/.test(c))return ok(true,what+" was refused by the platform before the function (HTTP "+c+"), so it never reaches the gate");
  ok(false,what+" -> HTTP "+c+" with no echo ("+rd(f).slice(0,80)+")");};
forged("/tmp/vd_7j_echo_forged.json","/tmp/vd_7j_echo_forged_code.txt","FORGERY: a request writing cf-connecting-ip 192.0.2.77, x-forwarded-for 192.0.2.78 and cf-ipcountry "+fcc,true);
forged("/tmp/vd_7j_echo_forged_xff.json","/tmp/vd_7j_echo_forged_xff_code.txt","FORGERY: a request writing x-forwarded-for 192.0.2.78 and cf-ipcountry "+fcc,false);
ok(probe.kind==="probe"&&probe.exempt===false,"x-rb-budget: probe classifies as kind probe ("+probe.kind+")");
ok(mcp.kind==="unproven_mcp"&&mcp.exempt===false,"a declared mcp caller with a wrong reader proof classifies as unproven_mcp, counted ("+mcp.kind+")");
const before=js("/tmp/vd_7j_before.json"),after=js("/tmp/vd_7j_after.json");
if(!Array.isArray(after)){ok(false,"get_board_anon_hourly as anon -> "+JSON.stringify(after).slice(0,160)+" (PGRST202 = 20261002140000 not applied)");}
else{
  const want=["bh_hour","bh_kind","bh_country","bh_requests","bh_over_cap","bh_addresses","bh_addresses_over_cap","bh_top_address_requests","bh_bare_requests"];
  const keys=[...new Set(after.flatMap((r)=>Object.keys(r)))];
  ok(after.length>0&&keys.every((k)=>want.includes(k)),"the reader answers anon with aggregates only: "+after.length+" rows, keys "+keys.join(","));
  const tot=(rows,kind)=>(Array.isArray(rows)?rows:[]).filter((r)=>r.bh_kind===kind&&r.bh_country==="ALL").reduce((n,r)=>n+Number(r.bh_requests||0),0);
  const delta=(kind)=>tot(after,kind)-tot(before,kind);
  ok(delta("probe")>=1,"kind probe grew by "+delta("probe")+" across this section (want >= 1: the gate is wired and counting)");
  ok(delta("address")>=1,"kind address grew by "+delta("address")+" (want >= 1; other browsers share this kind, so more is normal)");
  const call=js("/tmp/vd_7j_mcp_call.json")||{};const mcpOk=!!call.result&&!call.result.isError;
  if(mcpOk)ok(delta("unproven_mcp")===0,"a keyless MCP board_stats reached the board and did not land as unproven_mcp (delta "+delta("unproven_mcp")+")");
  else info("MCP control call did not answer cleanly ("+JSON.stringify(call).slice(0,100)+") -- unproven_mcp delta "+delta("unproven_mcp")+" is unproven");
  const v1=rd("/tmp/vd_7j_v1.txt").trim();
  if(v1==="200")ok(delta("unproven_api")===0,"a /v1 ranked read reached the board and did not land as unproven_api (delta "+delta("unproven_api")+")");
  else info("/v1 ranked control: "+(v1==="none"?"no RB_API_KEY in .env.local":"HTTP "+v1)+" -- unproven_api delta "+delta("unproven_api")+" cannot be read as proof");
  for(const k of ["unproven_api","unproven_mcp","unproven_digest"])if(tot(after,k)>0)info(k+" in the last 3h: "+tot(after,k)+" (an internal caller without its reader proof: deploy skew, or a missing service key)");
  const unk=tot(after,"unknown_address");ok(unk===0,"unknown_address in the last 3h = "+unk+" (want 0: the platform names every caller)");
  const addrAll=tot(after,"address");const real=after.filter((r)=>r.bh_kind==="address"&&r.bh_country!=="ALL"&&r.bh_country!=="XX").reduce((n,r)=>n+Number(r.bh_requests||0),0);
  if(plain.countrySource)info("address requests read as a real country: "+real+" of "+addrAll+" in the last 3h (.86: CN from the registry, as no cf-ipcountry arrives -- the mainland share of the browser traffic; hours before the .86 publish read XX whatever their origin)");
  else if(addrAll>=50)ok(real>0,"address requests with a real country: "+real+" of "+addrAll+(real>0?"":" -- country switch inert: cf-ipcountry is not reaching the function"));
  else info("address requests with a real country: "+real+" of "+addrAll+" (too few to judge; want >= 50)");
  for(const r of after.filter((x)=>x.bh_kind==="address"&&x.bh_country!=="ALL").slice(0,40))info(String(r.bh_hour).slice(0,13)+"h "+r.bh_country+": "+r.bh_requests+" requests, "+r.bh_addresses+" addresses, "+r.bh_addresses_over_cap+" over the cap, busiest "+r.bh_top_address_requests+", bare "+r.bh_bare_requests);
}'
for T in job_board_anon_meter job_board_anon_hourly; do code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/$T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  $T SELECT as anon -> $code" || echo "FAIL  $T SELECT as anon -> $code"; done
# The counter, called as anon with its real argument names. A 200 here is a
# FAIL, and the row it wrote (bucket verify:anon-probe) says so in the meter.
probe job_board_anon_check '{"p_bucket":"verify:anon-probe","p_kind":"probe","p_country":"US","p_address_cap":0,"p_build_cap":0,"p_probe_cap":0,"p_bare":true}'
# The frontend that renders the refusal shipped: the served /jobs chunk (or a
# chunk it imports) carries the error word the page matches on.
SITE="$SITE" node -e '
(async()=>{const S=process.env.SITE;const html=await (await fetch(S+"/jobs")).text();
const m=html.match(/assets\/Jobs-[A-Za-z0-9_-]+\.js/);if(!m)return console.log("INFO  /jobs served no Jobs-*.js chunk reference (prerendered shell?) -- check the bundle by hand");
const seen=new Set();const grab=async(p)=>{if(seen.has(p)||seen.size>40)return "";seen.add(p);try{return await (await fetch(S+"/"+p)).text()}catch{return ""}};
const main=await grab(m[0]);let hit=main.includes("board_budget");
if(!hit)for(const d of [...new Set([...main.matchAll(/["(]\.\/([A-Za-z0-9_.-]+\.js)[")]/g)].map((x)=>"assets/"+x[1]))]){if((await grab(d)).includes("board_budget")){hit=true;break}}
console.log((hit?"PASS":"FAIL")+"  the served frontend knows the board budget refusal ("+m[0]+(hit?"":", "+seen.size+" chunks read")+")")})().catch((e)=>console.log("INFO  frontend check could not run: "+e))'

echo "== 7k. .86: the country is read from the address, because the platform sends none =="
# 7j found cf-ipcountry never reaches the function (every row XX, 2026-10-03),
# so the country switch was inert. .86 looks the address up against APNIC's
# China delegations (job-board/geo-cn.ts, cn-ranges.ts). From outside, this
# machine's own echo proves the new path runs (it names its source) and the
# telemetry shows whether any browser traffic reads CN; that a mainland
# address reads CN is held by the unit tests, since no request from here can
# carry one (Cloudflare refuses a written cf-connecting-ip).
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const js=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const st=js("/tmp/vd_7j_status.json")||{};const e=js("/tmp/vd_7j_echo_plain.json")||{};const rows=js("/tmp/vd_7j_after.json");
ok(/^2026-09-09\.(\d+)$/.test(String(st.version))&&Number(String(st.version).split(".").pop())>=86,"status.version = "+st.version+" (want 2026-09-09.86 or later, which carry it)");
ok(["cf","registry","none"].includes(e.countrySource),"budget-echo names where its country came from: countrySource = "+e.countrySource+" (absent = the .86 bundle is not serving)");
if(Array.isArray(rows)){const cn=rows.filter((r)=>r.bh_kind==="address"&&r.bh_country==="CN");
  if(cn.length)for(const r of cn)info(String(r.bh_hour).slice(0,13)+"h CN: "+r.bh_requests+" requests, "+r.bh_addresses+" addresses, "+r.bh_over_cap+" over the cap");
  else info("no address rows read CN in the last 3h: either no mainland browser traffic since the publish, or the scraper is not on mainland blocks -- read the next 04-18 UTC plateau before deciding the country switch")}
const ab=st.anonBudget||{};info("country switch: countriesListed "+ab.countriesListed+", countryCap "+ab.countryCap+", enforce "+ab.enforce+" (a listed country is refused only while enforce is true)");'

echo "== 7l. .87: the network and the board pass -- a rotating pool is seen by its /24, a browser can be asked for a pass =="
# .87 claim. The harvest rotates ~180-340 addresses an hour and reads no CN, so
# .87 hands the counter each caller's /24 (/48 for IPv6) and its Turnstile
# board-pass state (plus a valid pass's id, which the counter meters against
# passCap -- past it the pass reads "spent"), and migration 20261003180000 adds
# blockedNetworks, requirePass and the network telemetry
# (get_board_anon_networks, aggregates by /16 or /32 only). Under requirePass
# unproven_* is asked for a pass and passless build/probe share one row per
# kind. Every rule is inert until the owner sets a key. Every
# probe here is a read: budget-echo and board-pass make no database call, and
# board-pass with a junk token asks Cloudflare at most (503 while no secret).
J '{"action":"budget-echo"}' > /tmp/vd_7l_echo.json
curl -s -m 30 -o /tmp/vd_7l_pass.json -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"board-pass","token":"verify-deploy-not-a-token"}' > /tmp/vd_7l_pass_code.txt
R get_board_anon_networks '{"p_hours":3,"p_limit":200}' > /tmp/vd_7l_networks.json
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};const js=(f)=>{try{return JSON.parse(rd(f))}catch{return null}};
const st=js("/tmp/vd_7j_status.json")||{};const e=js("/tmp/vd_7l_echo.json")||{};const ab=st.anonBudget||{};
const v87=/^2026-09-09\.(\d+)$/.test(String(st.version))&&Number(String(st.version).split(".").pop())>=87;
ok(v87,"status.version = "+st.version+" (want 2026-09-09.87 or later)");
const k=String(e.addressKey||"");const v4=/^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(k);const v6=/^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+):[0-9a-f]+::\/64$/.exec(k);
const wantNet=v4?v4[1]+"."+v4[2]+"."+v4[3]+".0/24":v6?v6[1]+":"+v6[2]+":"+v6[3]+"::/48":null;
ok("net" in e&&e.net===wantNet,"budget-echo carries the network of its address: net = "+e.net+" for addressKey "+(e.addressKey||"none")+" (want "+wantNet+"; absent = the .87 bundle is not serving)");
const states=["valid","invalid","none","unconfigured"];
ok(states.includes(e.passState),"budget-echo carries a pass state: passState = "+e.passState+" (want one of "+states.join("/")+")");
const p=ab.pass;
ok(!!p&&typeof p.configured==="boolean"&&typeof p.required==="boolean"&&(p.cap===null||typeof p.cap==="number"),"status.anonBudget.pass = "+JSON.stringify(p)+" (want {configured, required, cap}; cap null = the default 600 reads per pass)");
if(p){
  ok(e.passState===(p.configured?"none":"unconfigured"),"this machine sends no pass, so it reads as "+(p.configured?"none":"unconfigured")+" (got "+e.passState+")");
  info("bot check: secret "+(p.configured?"SET":"not set")+", requirePass "+p.required+", passCap "+(p.cap===null||p.cap===undefined?"600 (default)":p.cap)+(p.required&&!p.configured?" (no effect: unconfigured is never refused)":"")+(p.required&&p.configured?" (REQUIRED: browsers and unproven declarations without a valid pass are refused while enforce is true; passless build/probe share one row per kind)":""));
}
ok(typeof ab.networksListed==="number","status.anonBudget.networksListed = "+JSON.stringify(ab.networksListed)+" (a number; invalid = blockedNetworks is not an array and blocks nothing)");
if(ab.networksListed>0)info("blockedNetworks lists "+ab.networksListed+" entries (refused only while enforce is true; enforce = "+ab.enforce+")");
const pc=rd("/tmp/vd_7l_pass_code.txt").trim();const pb=js("/tmp/vd_7l_pass.json")||{};
if(!p||!p.configured)ok(pc==="503"&&pb.error==="board_pass_unconfigured","board-pass without the secret -> HTTP "+pc+" "+JSON.stringify(pb).slice(0,80)+" (want 503 board_pass_unconfigured; 400 Unknown action = the .87 bundle is not serving)");
else ok(pc==="403"&&pb.error==="board_pass_failed","board-pass with a junk token -> HTTP "+pc+" "+JSON.stringify(pb).slice(0,120)+" (want 403 board_pass_failed with Cloudflare codes)");
const rows=js("/tmp/vd_7l_networks.json");
if(!Array.isArray(rows))ok(false,"get_board_anon_networks as anon -> "+JSON.stringify(rows).slice(0,160)+" (PGRST202 = 20261003180000 not applied)");
else{
  const want=["bn_hour","bn_net","bn_kind","bn_pass","bn_requests","bn_over_cap"];const keys=[...new Set(rows.flatMap((r)=>Object.keys(r)))];
  ok(keys.every((x)=>want.includes(x)),"get_board_anon_networks answers anon with aggregate keys only: "+rows.length+" rows, keys "+(keys.join(",")||"none"));
  ok(rows.every((r)=>r.bn_net==="none"||/^[0-9.]+\/16$|^[0-9a-f:]+\/32$/.test(String(r.bn_net))),"every network it publishes is a /16 or a /32, or none: no address leaves");
  const total=rows.reduce((n,r)=>n+Number(r.bn_requests||0),0);const real=rows.filter((r)=>r.bn_net!=="none").reduce((n,r)=>n+Number(r.bn_requests||0),0);
  if(v87&&total>=20)ok(real>0,"requests that reached the counter with a network: "+real+" of "+total+" in the top rows of the last 3h (0 = p_net is not reaching SQL)");
  else info("requests with a network: "+real+" of "+total+" (too few to judge, or not .87: calls before the .87 publish read none)");
  const by=new Map();for(const r of rows){const m=by.get(r.bn_net)||{req:0,over:0,kinds:new Set()};m.req+=Number(r.bn_requests||0);m.over+=Number(r.bn_over_cap||0);m.kinds.add(r.bn_kind);by.set(r.bn_net,m)}
  for(const [net,m] of [...by.entries()].sort((a,b)=>b[1].req-a[1].req).slice(0,15))info("top network "+net+": "+m.req+" requests, "+m.over+" over the cap, kinds "+[...m.kinds].join("/"));
  const split={};for(const r of rows.filter((x)=>x.bn_kind==="address"||x.bn_kind==="unknown_address"))split[r.bn_pass]=(split[r.bn_pass]||0)+Number(r.bn_requests||0);
  info("browser pass states in the last 3h (kinds address and unknown_address): "+(Object.entries(split).map(([s,n])=>s+" "+n).join(", ")||"none")+" -- require the pass only once real browsers arrive valid");
  if(split.spent)info("spent: "+split.spent+" requests carried a pass already used past passCap -- one solve shared across many callers, or a very heavy reader");
  const tools=rows.filter((r)=>r.bn_kind==="build"||r.bn_kind==="probe");const toolNets=new Set(tools.map((r)=>r.bn_net)).size;
  info("tooling declarations (build/probe) in the last 3h: "+tools.reduce((n,r)=>n+Number(r.bn_requests||0),0)+" requests from "+toolNets+" networks (our bake and probes come from a handful; many networks = the public header is being borrowed)");
  const unproven=rows.filter((r)=>/^unproven_/.test(String(r.bn_kind))).reduce((n,r)=>n+Number(r.bn_requests||0),0);
  info("unproven api/mcp/digest declarations in the last 3h: "+unproven+" (must be 0 before REQUIRE THE PASS: requirePass refuses them without a pass)");
}'
code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/job_board_anon_net_hourly?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"); [ "$code" = "401" ] || [ "$code" = "403" ] && echo "PASS  job_board_anon_net_hourly SELECT as anon -> $code" || echo "FAIL  job_board_anon_net_hourly SELECT as anon -> $code"
# The ten-argument counter, called as anon with its real argument names: 42501.
probe job_board_anon_check '{"p_bucket":"verify:anon-probe","p_kind":"probe","p_country":"US","p_address_cap":0,"p_build_cap":0,"p_probe_cap":0,"p_bare":true,"p_net":"192.0.2.0/24","p_pass":"none","p_pass_id":"00000000000000ab"}'

echo "done."
