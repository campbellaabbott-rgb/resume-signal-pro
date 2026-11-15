# shellcheck shell=bash
# ── 99zzzzzz. COST AUDIT 2026-11-08, LANE DB-CADENCE (branch cost/db-cadence):
# the database stops paying for work no page reads, and the jobs that stay run
# as often as their output is read.
#
# THE CLAIMS, one line each below. Read from get_cron_health (name, schedule,
# the timeout a command sets, run counts; never a command), the explore cache
# row, the stats rollup rows (a table the anon key reads by policy) and the
# prerendered Ghost Job Index:
#   STEP 1, applied before the functions (20261109100000, 110000, 120000,
#   130000, 131000):
#   - board-recency-ladder is no longer scheduled (audit #3);
#   - refresh-explore-role-rows is no longer scheduled, and the explore row
#     the new writer produces carries none of field_curves, chip_coverage,
#     role_rows or the denominators in totals, and still carries the field
#     grid and the repost index the page reads (#4);
#   - refresh-board-facets runs at 2,17,32,47 with its timeout set (#5);
#   - the nightly purge sets its own timeout, the mark of its rewrite without
#     the report-cache delete the hourly job already runs (#14);
#   - no one-shot index dropper, or the watcher that retires them, is stuck
#     or failing (#14).
#   STEP 2, applied after the functions (20261109121000, 122000):
#   - job-board-stats-rollup runs every 30 minutes with its timeout, its rows
#     are never older than one interval and a run, and rows written after the
#     change carry one total per source and one stamp in both coverage rows
#     (#6);
#   - refresh-ghost-stats runs at :15 with its timeout, and its row is never
#     more than an hour and a run old (#7);
#   - the Ghost Job Index states the cadence those two schedules have.
# BEFORE THE DEPLOY every claim is an INFO line naming today's value and the
# one the deploy brings. A step counts as applied once any of its marks shows
# in cron health. From then on, each claim of that step that does not hold is
# a FAIL, and step 2 seen without step 1 is a FAIL.
# DATED, NOT TRUSTED FOR BEING PRESENT. A row proves new code only when it was
# written after the change. COST_DB_APPLIED_AT (UTC, the moment the LAST of
# the seven files finished applying) dates rows when it is set, either in the
# environment or on the line below. Otherwise the ghost row's own stamp dates
# them once it falls on :15, because only the new schedule runs then and
# 122000 applies last. A row written before that moment is INFO. Two lines
# need no dating. The old explore writer always wrote field_curves, carried
# or empty, so a row without it is the new writer's. And no */30 row is ever
# older than 33 minutes.
# Not provable from outside, so proved in the suite: the facets gate inside
# the command, which index each dropper took (the migration's self-check
# refuses a dropper aimed at a kept twin), and the purge's other deletes.
#
# READ-ONLY: two anon read RPCs, one GET of a table and one GET of a page.
echo "== 99zzzzzz. Cost audit, db-cadence: work nothing reads stops, and the rest runs as often as it is read =="

VDCD_APPLIED_AT="${COST_DB_APPLIED_AT:-}"

rm -f /tmp/vd_cdc_cron.json /tmp/vd_cdc_explore.json /tmp/vd_cdc_rollup.json /tmp/vd_cdc_ghost_page.html
R get_cron_health '{"p_hours":24}' > /tmp/vd_cdc_cron.json
R get_explore_cache '{}' > /tmp/vd_cdc_explore.json
curl -s -m 60 "$B/rest/v1/job_board_stats_rollup?select=k,v,computed_at&k=in.(ghost_stats,date_coverage,desc_coverage)" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_cdc_rollup.json
curl -s -m 30 -A "$UA" "$SITE/ghost-job-index" > /tmp/vd_cdc_ghost_page.html

VDCD_APPLIED="$VDCD_APPLIED_AT" node -e '
const fs=require("fs");
const rd=(p)=>{try{return fs.readFileSync(p,"utf8")}catch{return ""}};
const parse=(s)=>{try{return JSON.parse(s)}catch{return undefined}};
const isErr=(v)=>!!v&&typeof v==="object"&&!Array.isArray(v)&&("code" in v)&&("message" in v);
const out=(s)=>console.log(s);
const now=Date.now();
const ageMin=(iso)=>(now-Date.parse(iso))/60000;
const minOf=(iso)=>new Date(iso).getUTCMinutes();
const hhmm=(iso)=>new Date(iso).toISOString().slice(11,16)+" UTC";
const T={ladder:"board-recency-ladder",role:"refresh-explore-role-rows",facets:"refresh-board-facets",rollup:"job-board-stats-rollup",ghost:"refresh-ghost-stats",purge:"scan-cache-and-telemetry-purge",hourly:"scan-report-cache-retention"};
const NEW={facets:"2,17,32,47 * * * *",rollup:"*/30 * * * *",ghost:"15 * * * *"};
const DROP=["oneshot-drop-postings-company-token-idx","oneshot-drop-temp-resume-expires-idx","oneshot-drop-temp-resume-storage-expires-idx","oneshot-drop-ai-response-cache-expires-idx","oneshot-drop-duplicate-indexes-watch"];

const cs=rd("/tmp/vd_cdc_cron.json");const cj=parse(cs);
if(!Array.isArray(cj)){out("FAIL  get_cron_health answered "+(cj===undefined?"no JSON (a 60s client timeout, or an HTML error page): "+cs.slice(0,120):JSON.stringify(cj).slice(0,160))+" -- no schedule of this lane can be read");process.exit(0)}
if(!cj.length){out("FAIL  get_cron_health answered no jobs at all, so no schedule of this lane can be read");process.exit(0)}
const J=Object.fromEntries(cj.map((r)=>[r.ch_jobname,r]));
const desc=(r)=>r?(r.ch_schedule+(r.ch_active?"":" PAUSED")+", timeout "+(r.ch_timeout||"none")+", "+r.ch_runs+" runs in 24h"):"not scheduled";

const droppers=DROP.filter((n)=>J[n]);
const s1=[];
if(!J[T.ladder])s1.push(T.ladder+" gone");
if(!J[T.role])s1.push(T.role+" gone");
if(J[T.facets]&&J[T.facets].ch_schedule===NEW.facets)s1.push(T.facets+" on "+NEW.facets);
if(droppers.length)s1.push(droppers.length+" one-shot index job(s) scheduled");
const s2=[];
if(J[T.rollup]&&J[T.rollup].ch_schedule===NEW.rollup)s2.push(T.rollup+" on "+NEW.rollup);
if(J[T.ghost]&&J[T.ghost].ch_schedule===NEW.ghost)s2.push(T.ghost+" on "+NEW.ghost);
const step1=s1.length>0,step2=s2.length>0;
out("INFO  step 1 (before the functions: 20261109100000, 110000, 120000, 130000, 131000) "+(step1?"applied: "+s1.join("; "):"not applied: no mark of it in cron health")+". Step 2 (after the functions: 121000, 122000) "+(step2?"applied: "+s2.join("; "):"not applied"));
if(step2&&!step1)out("FAIL  step 2 shows in cron health ("+s2.join("; ")+") with no mark of step 1: the after-functions files went in first, or step 1 did not take");
out("INFO  runs in the last 24h: "+[T.ladder,T.role,T.facets,T.rollup,T.ghost].map((n)=>n+" "+(J[n]?J[n].ch_runs+" (longest "+J[n].ch_max_seconds+" s)":"-")).join(", "));

// ---- step 1 ----
const gone=(name,mig,why)=>{const r=J[name];
  if(!step1)out("INFO  before "+mig+": "+name+" runs ("+desc(r)+"); the deploy unschedules it, since "+why);
  else if(!r)out("PASS  "+name+" is no longer scheduled ("+mig+"): "+why);
  else out("FAIL  "+name+" is still scheduled ("+desc(r)+") though step 1 shows ("+s1.join("; ")+"): "+mig+" did not take")};
gone(T.ladder,"20261109100000","nothing reads the ladder it rebuilt every five minutes");
gone(T.role,"20261109110000","no page reads the role rows it rebuilt every six hours");
{const r=J[T.facets];
  if(!step1)out("INFO  before 20261109120000: "+T.facets+" runs ("+desc(r)+"); the deploy moves it to "+NEW.facets+", rebuilding only a facets row the board pass left more than 40 minutes old");
  else if(r&&r.ch_schedule===NEW.facets&&r.ch_timeout&&r.ch_active)out("PASS  "+T.facets+" runs on "+NEW.facets+" with its timeout ("+r.ch_timeout+") in the command (20261109120000; the 40-minute gate is in the command too, which this key cannot read, so the suite proves it)");
  else out("FAIL  "+T.facets+": "+desc(r)+". Step 1 shows, and 20261109120000 leaves it on "+NEW.facets+", active, with a timeout in the command")}
{const p=J[T.purge],h=J[T.hourly];
  if(!p)out("INFO  "+T.purge+" is not scheduled, so 20261109131000 had no purge to rewrite");
  else if(!h)out("INFO  "+T.hourly+" is not scheduled, so the nightly purge keeps its report-cache delete as the only one ("+desc(p)+")");
  else if(!step1)out("INFO  before 20261109131000: "+T.purge+" ("+desc(p)+") repeats the report-cache delete "+T.hourly+" ("+h.ch_schedule+") already runs; the deploy removes it and puts a 2min timeout in the command");
  else if(p.ch_timeout&&p.ch_active)out("PASS  "+T.purge+" sets its own timeout ("+p.ch_timeout+"), the mark that 20261109131000 rewrote it without the report-cache delete "+T.hourly+" runs every hour");
  else out("FAIL  "+T.purge+": "+desc(p)+". Step 1 shows, and 20261109131000 leaves the purge active with a timeout in its command")}
if(!droppers.length)out(step1?"INFO  no one-shot index dropper or watcher is left scheduled (20261109130000). Which indexes went cannot be read with this key; the migration self-check refuses a dropper aimed at a kept twin":"INFO  before 20261109130000: no one-shot index dropper is scheduled; the deploy arms one per duplicate and a watcher that retires them");
for(const n of droppers){const r=J[n];const runs=Number(r.ch_runs)||0,failed=Number(r.ch_failed)||0;
  if(runs>=15)out("FAIL  "+n+" is still scheduled after "+runs+" runs (last "+(r.ch_last_status||"none")+"): the watcher has not retired it, so it runs every minute for nothing");
  else if(failed>=3)out("FAIL  "+n+" failed "+failed+" of "+runs+" runs (last "+(r.ch_last_status||"none")+")");
  else out("INFO  "+n+" is still working ("+runs+" runs, "+failed+" failed, last "+(r.ch_last_status||"none")+"); the watcher retires it once its index is gone")}

// ---- step 2 schedules ----
const moved=(key,mig,why)=>{const r=J[T[key]];
  if(!step2)out("INFO  before "+mig+": "+T[key]+" runs ("+desc(r)+"); the after-functions step moves it to "+NEW[key]+", and "+why);
  else if(r&&r.ch_schedule===NEW[key]&&r.ch_timeout&&r.ch_active)out("PASS  "+T[key]+" runs on "+NEW[key]+" with its timeout ("+r.ch_timeout+") in the command ("+mig+")");
  else out("FAIL  "+T[key]+": "+desc(r)+". Step 2 shows ("+s2.join("; ")+"), and "+mig+" leaves it on "+NEW[key]+", active, with a timeout in the command")};
moved("rollup","20261109121000","each run then reads the postings once for both coverage rows, where it read them twice");
moved("ghost","20261109122000","the :27 stats cache copied only the :05 run, never the :35 one");

// ---- the anchor that dates rows ----
const rs=rd("/tmp/vd_cdc_rollup.json");const rj=parse(rs);let rows=null;
if(rj===undefined)out("FAIL  the stats rollup rows answered no JSON (a 60s client timeout, or an HTML error page): "+rs.slice(0,120));
else if(isErr(rj))out((String(rj.code)==="42501"?"INFO":"FAIL")+"  the stats rollup rows are not readable with this key ("+rj.code+": "+String(rj.message).slice(0,100)+")"+(String(rj.code)==="42501"?"; the lines that date them are skipped":""));
else if(!Array.isArray(rj))out("FAIL  the stats rollup rows answered "+JSON.stringify(rj).slice(0,160));
else rows=Object.fromEntries(rj.filter((r)=>r&&typeof r==="object").map((r)=>[r.k,r]));
const given=process.env.VDCD_APPLIED||"";let anchor=null,anchorWhy="";
if(given){const t=Date.parse(given);
  if(!Number.isFinite(t))out("FAIL  COST_DB_APPLIED_AT="+given+" is not a date");
  else if(t>now)out("FAIL  COST_DB_APPLIED_AT="+given+" is in the future");
  else if(!step1||!step2)out("FAIL  COST_DB_APPLIED_AT="+given+" says the lane applied, but cron health shows step "+(!step1?"1":"2")+" not applied");
  else{anchor=t;anchorWhy="COST_DB_APPLIED_AT "+given}}
const g=rows?rows.ghost_stats:null;
if(anchor===null&&step1&&step2&&g&&g.computed_at&&minOf(g.computed_at)===15){anchor=Date.parse(g.computed_at);anchorWhy="the ghost row stamped "+g.computed_at+", a minute only the new schedule runs"}
const undated="cannot be dated against the change (set COST_DB_APPLIED_AT, or re-run once the ghost row falls on :15)";

// ---- the ghost row ----
if(rows){
  if(!g||!g.computed_at)out((step2?"FAIL":"INFO")+"  the stats rollup carries no ghost_stats row");
  else{const m=minOf(g.computed_at),a=ageMin(g.computed_at),after=anchor!==null&&Date.parse(g.computed_at)>anchor+60000;
    if(!step2)out("INFO  before 20261109122000: the ghost row was written at "+hhmm(g.computed_at)+" ("+Math.round(a)+" min ago) on the :05/:35 schedule; the :27 stats cache copies only the :05 run");
    else if(a>65)out("FAIL  the ghost row was written "+Math.round(a)+" min ago ("+g.computed_at+"): no :15 run has written it for over an hour since the schedule moved");
    else if(m===15)out("PASS  the ghost row was written at "+hhmm(g.computed_at)+", "+Math.round(a)+" min ago: the hourly :15 run, twelve minutes before the :27 stats cache copies it");
    else if(after)out("FAIL  the ghost row was written at "+hhmm(g.computed_at)+", after the change ("+anchorWhy+"), on a minute the :15 schedule never runs: another job still runs the old one");
    else out("INFO  the ghost row was written at "+hhmm(g.computed_at)+" ("+Math.round(a)+" min ago) on the earlier schedule; the first :15 run replaces it")}}

// ---- the coverage rows ----
if(rows){const d=rows.date_coverage,e=rows.desc_coverage;
  if(!d||!e||!Array.isArray(d.v)||!Array.isArray(e.v))out((step2?"FAIL":"INFO")+"  the stats rollup lacks a coverage row (date_coverage "+(d?"present":"absent")+", desc_coverage "+(e?"present":"absent")+")");
  else{const at=d.computed_at,a=ageMin(at),m=minOf(at);
    const td=Object.fromEntries(d.v.map((r)=>[String(r.source),Number(r.total)])),te=Object.fromEntries(e.v.map((r)=>[String(r.source),Number(r.total)]));
    const keys=[...new Set([...Object.keys(td),...Object.keys(te)])];
    const off=keys.filter((k)=>td[k]!==te[k]);
    const same=Date.parse(d.computed_at)===Date.parse(e.computed_at);
    if(!step2)out("INFO  before 20261109121000: the coverage rows were written at "+hhmm(at)+" ("+Math.round(a)+" min ago) by two passes over the postings, and agree on "+(keys.length-off.length)+" of "+keys.length+" source totals");
    else{
      if(a>33)out("FAIL  the coverage rows were written "+Math.round(a)+" min ago ("+at+"): on */30 no row is older than one interval and a run, so the rollup has stopped");
      const after=anchor!==null&&Date.parse(at)>anchor;
      if(!after)out("INFO  the coverage rows ("+hhmm(at)+", "+Math.round(a)+" min ago) "+(anchor===null?undated:"predate the change ("+anchorWhy+")")+"; the first */30 run after it writes both from one pass");
      else if(!keys.length)out("INFO  the coverage rows written after the change carry no source");
      else{const why=[off.length?"disagree on "+off.length+" source total(s) ("+off.slice(0,4).map((k)=>k+": "+(k in td?td[k]:"absent")+" vs "+(k in te?te[k]:"absent")).join(", ")+")":"",same?"":"carry different stamps ("+d.computed_at+" vs "+e.computed_at+")",(m===0||m===30)?"":"fall on minute "+m+", which */30 never runs"].filter(Boolean);
        if(why.length)out("FAIL  the coverage rows written at "+at+", after the change ("+anchorWhy+"), "+why.join("; ")+". One grouped pass writes the same total and stamp to both, on :00 or :30");
        else out("PASS  the coverage rows written at "+hhmm(at)+", after the change, carry the same total for all "+keys.length+" sources under one stamp: the one grouped pass of 20261109121000, on the */30 schedule")}}}}

// ---- the explore row ----
{const es=rd("/tmp/vd_cdc_explore.json");const ej=parse(es);const RET=["field_curves","chip_coverage","role_rows"];
  if(ej===undefined)out("FAIL  get_explore_cache answered no JSON (a 60s client timeout, or an HTML error page): "+es.slice(0,120));
  else{const x=Array.isArray(ej)?ej[0]:ej;
    if(!x||typeof x!=="object"||isErr(x))out("FAIL  get_explore_cache answered "+JSON.stringify(x).slice(0,160));
    else{const root=String(x.computed_at);const has=RET.filter((k)=>k in x);
      const tot=x.totals&&typeof x.totals==="object"?Object.keys(x.totals).filter((k)=>k!=="repost_flagged_n"):[];
      const fg=x.field_grid&&x.field_grid.fields&&typeof x.field_grid.fields==="object"?Object.keys(x.field_grid.fields).length:0;
      const rp=x.repost_index&&typeof x.repost_index==="object"&&!Array.isArray(x.repost_index)?Object.keys(x.repost_index).length:-1;
      const read="field_grid "+fg+" fields, repost_index "+(rp<0?"absent":rp+" boards");
      const extra=[...has,tot.length?tot.length+" denominators in totals":""].filter(Boolean).join(", ");
      const size=JSON.stringify(x).length;
      if(!step1)out("INFO  before 20261109110000: the explore row ("+root+", "+size+" bytes) carries "+(extra||"none of the retired parts")+" beside the "+read+" the page reads; the first :07 run on the new writer drops them");
      else if(!has.length){
        if(!tot.length&&fg>0&&rp>=0)out("PASS  the explore row ("+root+", "+size+" bytes) comes from the new writer: none of field_curves, chip_coverage or role_rows, no denominators in totals, and the "+read+" the page reads");
        else out("FAIL  the explore row ("+root+") comes from the new writer, but "+[tot.length?"its totals carry "+tot.join(", "):"",fg>0?"":"it has no field grid",rp>=0?"":"it has no repost index"].filter(Boolean).join("; ")+" (20261109110000 writes only repost_flagged_n in totals, beside the field grid and the repost index the page reads)")}
      else if(anchor!==null&&Date.parse(root)>anchor)out("FAIL  the explore row written at "+root+", after the change ("+anchorWhy+"), still carries "+extra+": refresh_explore_cache was not re-issued by 20261109110000");
      else out("INFO  the explore row ("+root+") still carries "+extra+". It "+(anchor===null?"was written before the change or by the old definition, which this key cannot tell apart (set COST_DB_APPLIED_AT, or re-run after the next :07 run)":"was written before the change ("+anchorWhy+")")+"; the first :07 run on the new writer drops them")}}}

// ---- the published cadence ----
{const html=rd("/tmp/vd_cdc_ghost_page.html");
  if(!/<html|<body|<main/i.test(html))out("FAIL  /ghost-job-index answered no page to a crawler: "+html.slice(0,120).replace(/\s+/g," "));
  else{const text=html.replace(/<[^>]+>/g," ").replace(/\s+/g," ");
    const phraseFor=(expr)=>{const mi=String(expr).trim().split(/\s+/)[0];const st=/^\*\/(\d+)$/.exec(mi);if(st)return "recomputed every "+st[1]+" minutes";const n=mi.split(",").length;return n===1?"recomputed once an hour":n===2?"recomputed twice an hour":"recomputed "+n+" times an hour"};
    const all=(re)=>{const f=[];let mm;while((mm=re.exec(text)))f.push(mm[1]);return [...new Set(f)]};
    const said={rollup:all(/Measured from each feed[^,]{0,80}verification stamp[^,]{0,40}, (recomputed [a-z0-9 ]+?)[.;]/g),ghost:all(/Measured (?!from)[^,]{0,40}, (recomputed [a-z0-9 ]+?)[.;]/g)};
    for(const [key,label] of [["ghost","ghost index figures"],["rollup","feed freshness figures"]]){const r=J[T[key]];
      if(!r){out("INFO  "+T[key]+" is not scheduled, so the cadence /ghost-job-index states for the "+label+" is not judged");continue}
      const want=phraseFor(r.ch_schedule),found=said[key];
      if(!found.length)out("INFO  /ghost-job-index states no cadence for the "+label+" (a build that could not read them prints no figures)");
      else if(found.every((p)=>p===want))out("PASS  /ghost-job-index says \""+want+"\" for the "+label+", and "+T[key]+" runs on "+r.ch_schedule);
      else if(step2)out("FAIL  /ghost-job-index says \""+found.join("\", \"")+"\" for the "+label+", but "+T[key]+" runs on "+r.ch_schedule+" (\""+want+"\"): the published cadence went false with this deploy (DATA_PAGE_CADENCE in scripts/prerender-seo.mjs)");
      else out("INFO  /ghost-job-index already says \""+found.join("\", \"")+"\" for the "+label+" while "+T[key]+" still runs on "+r.ch_schedule+": the frontend publishes at merge, before 20261109121000 and 122000 apply")}}}

// ---- the paid API says the same cadence ----
out("INFO  /v1/stats (keyed, not read here) says its rollup is recomputed every 30 minutes from public-api 2026-11-09.1 on, which section 49 holds to main\u0027s build; the sentence is held to the newest schedule of job-board-stats-rollup by src/test/a-data-page-that-serves-no-number-is-an-empty-page.test.ts");
'
