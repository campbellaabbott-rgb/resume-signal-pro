# shellcheck shell=bash
# ── 99zzzzzz. COST AUDIT 2026-11-08, LANE DB-HEAVY (branch cost/db-heavy):
# the database stops re-doing work whose answer did not change.
#
# THE CLAIMS, one line each below:
#   - E1  the re-embed queue (20261109150000) is closed to the publishable
#         key: its SELECT answers 42501, never rows and never an empty 200;
#   - P1  the four functions this lane wrote or rewrote that no page calls
#         refuse the publishable key by name (42501): get_embed_batch, the
#         perk extractor's version and its work gate (20261109160000), and
#         the writer of the /jobs aggregates (20261109170000, which leaves it
#         unscheduled until the owner has read the readers' calls);
#   - L1  the three /jobs readers still answer the publishable key, each on
#         its own rules: the country picker at most 40 countries, largest
#         first, each with at least 10 open postings; the salary benchmarks
#         one row per category, each over at least 30 postings with a
#         median, the unnamed category last; the takedown ticker a whole number, always
#         counted live. Once the owner schedules the writer and its row is
#         fresh, the country and salary answers come from it, so a row
#         written in the wrong order or shape FAILs here;
#   - V1  the vendor wall (get_board_vendor_counts, now read from the small
#         facets_head row, 20261109175000) answers the same open total, as_of
#         and per-vendor counts as the big facets row (get_job_board_facets).
#         The wall is read before and after the big row: when its as_of moved
#         in between, a refresh landed mid-check and the line is INFO.
# BEFORE THE DEPLOY: E1 answers PGRST205 (no such table) and the three new
# functions PGRST202 -- INFO lines, never FAIL. get_embed_batch already
# refuses. L1 and V1 hold before the deploy too (the readers count live and
# the wall reads the big row), so a FAIL there is a FAIL either side of it.
# Not provable from outside, so proved in the suite and named in the INFO
# lines at the end: the closure verdicts written only on change (20261109140000), the
# closure index's one-shot build (20261109141000), the description trigger, the perk gate in
# the cron command, and whether the readers are answering a cached row.
#
# READ-ONLY. Every request is a GET with the publishable key: PostgREST runs
# a GET in a read-only transaction, the readers only read, and a probe of a
# writer can only be refused (42501) or stopped (25006), never write.
echo "== 99zzzzzz. Cost audit, db-heavy: the re-embed queue and the new writers refuse a stranger; the /jobs readers and the vendor wall answer on their own rules =="

vdch_get() { # $1 path under /rest/v1, $2 out file -> "<status> <seconds>"
  rm -f "$2"
  curl -s -m 60 -o "$2" -w '%{http_code} %{time_total}' "$B/rest/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K"
}

# ---- E1: the re-embed queue ----
VDCH_E1=$(vdch_get "job_board_embed_requeue?select=*&limit=1" /tmp/vd_ch_queue.json)
VDCH_STATUS="$VDCH_E1" node -e '
const fs=require("fs");let raw="";try{raw=fs.readFileSync("/tmp/vd_ch_queue.json","utf8")}catch{}
const code=String(process.env.VDCH_STATUS||"").split(" ")[0];
let j=null;try{j=JSON.parse(raw)}catch{}
const c=j&&typeof j==="object"&&!Array.isArray(j)?String(j.code||""):"";
if((code==="401"||code==="403")&&c==="42501")console.log("PASS  E1 job_board_embed_requeue SELECT as anon -> "+code+" 42501 (revoked by name)");
else if(c==="PGRST205"||c==="42P01")console.log("INFO  E1 job_board_embed_requeue does not exist yet ("+c+"): 20261109150000 has not applied");
else if(code==="200"&&Array.isArray(j))console.log("FAIL  E1 job_board_embed_requeue answers anon 200 with "+j.length+" row(s): the client roles hold a grant on it (an empty answer is RLS hiding rows, not a refusal)");
else console.log("FAIL  E1 job_board_embed_requeue SELECT as anon -> HTTP "+code+" "+raw.slice(0,160));
'

# ---- P1: the writers and the service-only readers ----
probe get_embed_batch '{"p_limit":1}'
probe employer_perk_extractor_version '{}'
probe employer_perk_sweep_due '{}'
probe refresh_jobs_live_aggregates '{}'

# ---- L1: the /jobs readers ----
VDCH_LC=$(vdch_get "rpc/get_country_facet" /tmp/vd_ch_country.json)
VDCH_LS=$(vdch_get "rpc/get_salary_benchmarks" /tmp/vd_ch_salary.json)
VDCH_LT=$(vdch_get "rpc/get_takedowns_today" /tmp/vd_ch_takedowns.json)
VDCH_LC="$VDCH_LC" VDCH_LS="$VDCH_LS" VDCH_LT="$VDCH_LT" node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const st=(v)=>{const [code,secs]=String(v||"").split(" ");return {code,secs:Number(secs)}};
const parse=(f)=>{const raw=rd(f);try{return {raw,j:JSON.parse(raw)}}catch{return {raw,j:undefined}}};
const int=(x)=>Number.isInteger(x);
const C=parse("/tmp/vd_ch_country.json"),S=parse("/tmp/vd_ch_salary.json"),T=parse("/tmp/vd_ch_takedowns.json");
const sc=st(process.env.VDCH_LC),ss=st(process.env.VDCH_LS),stt=st(process.env.VDCH_LT);
{ const why=[];const a=C.j;
  if(sc.code!=="200")why.push("HTTP "+sc.code);
  if(!Array.isArray(a))why.push("not an array");
  else{
    if(a.length===0)why.push("no country at all");
    if(a.length>40)why.push(a.length+" countries (the cap is 40)");
    const bad=a.filter((r)=>!r||typeof r.country!=="string"||r.country===""||!int(r.n)||r.n<10);
    if(bad.length)why.push(bad.length+" row(s) without a named country and at least 10 postings: "+JSON.stringify(bad[0]));
    for(let i=1;i<a.length;i++)if(int(a[i].n)&&int(a[i-1].n)&&a[i].n>a[i-1].n){why.push("not largest first at row "+(i+1)+": "+a[i-1].n+" then "+a[i].n);break}
    if(new Set(a.map((r)=>r&&r.country)).size!==a.length)why.push("a country listed twice");
  }
  if(why.length)console.log("FAIL  L1 get_country_facet as anon: "+why.join("; ")+" -- "+C.raw.slice(0,160));
  else console.log("PASS  L1 get_country_facet answers "+a.length+" countries, largest first ("+a[0].country+" "+a[0].n.toLocaleString("en-US")+"), each with at least 10 open postings");
}
{ const why=[];const a=S.j;
  if(ss.code!=="200")why.push("HTTP "+ss.code);
  if(!Array.isArray(a))why.push("not an array");
  else{
    if(a.length===0)why.push("no category at all");
    const bad=a.filter((r)=>!r||typeof r.currency!=="string"||!int(r.n)||r.n<30||!(typeof r.median_annual_min==="number"&&r.median_annual_min>=0));
    if(bad.length)why.push(bad.length+" row(s) without a currency, 30 postings and a median: "+JSON.stringify(bad[0]));
    if(new Set(a.map((r)=>r&&r.category)).size!==a.length)why.push("a category listed twice");
    const firstNull=a.findIndex((r)=>r&&r.category===null);
    if(firstNull>=0&&firstNull!==a.length-1)why.push("the unnamed category is not last");
  }
  if(why.length)console.log("FAIL  L1 get_salary_benchmarks as anon: "+why.join("; ")+" -- "+S.raw.slice(0,160));
  else console.log("PASS  L1 get_salary_benchmarks answers "+a.length+" categories, one row each, every one over at least 30 postings with a median");
}
{ const n=T.j;
  if(stt.code!=="200"||!int(n)||n<0)console.log("FAIL  L1 get_takedowns_today as anon -> HTTP "+stt.code+" "+T.raw.slice(0,120));
  else console.log("PASS  L1 get_takedowns_today answers a whole number: "+n.toLocaleString("en-US"));
}
const secs=[sc.secs,ss.secs,stt.secs].map((x)=>Number.isFinite(x)?x.toFixed(2)+"s":"?");
console.log("INFO  L1 answered in "+secs.join(" / ")+" (country / salary / takedowns, network included). 20261109170000 schedules no writer, so each counts the board live as before it; once the owner schedules refresh_jobs_live_aggregates, country and salary are a read of one row while it is under two hours old, and takedowns stays live");
'

# ---- V1: the vendor wall against the big facets row ----
vdch_get "rpc/get_board_vendor_counts" /tmp/vd_ch_vc1.json > /dev/null
VDCH_VF=$(vdch_get "rpc/get_job_board_facets" /tmp/vd_ch_facets.json)
vdch_get "rpc/get_board_vendor_counts" /tmp/vd_ch_vc2.json > /dev/null
VDCH_VF="$VDCH_VF" node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const parse=(f)=>{const raw=rd(f);try{const j=JSON.parse(raw);return {raw,j:j&&typeof j==="object"&&!Array.isArray(j)?j:null}}catch{return {raw,j:null}}};
const v1=parse("/tmp/vd_ch_vc1.json"),v2=parse("/tmp/vd_ch_vc2.json"),f=parse("/tmp/vd_ch_facets.json");
const sorted=(o)=>JSON.stringify(Object.keys(o||{}).sort().map((k)=>[k,o[k]]));
if(!v1.j||!v2.j)console.log("FAIL  V1 get_board_vendor_counts as anon did not answer an object: "+(v1.j?v2.raw:v1.raw).slice(0,160));
else if(!f.j)console.log("FAIL  V1 get_job_board_facets as anon did not answer an object (HTTP "+String(process.env.VDCH_VF||"").split(" ")[0]+"): "+f.raw.slice(0,160));
else if(v1.j.as_of!==v2.j.as_of)console.log("INFO  V1 a facets refresh landed mid-check (the wall read "+v1.j.as_of+" then "+v2.j.as_of+"): nothing to compare this run");
else if(f.j.cached!==true||!f.j.as_of)console.log("INFO  V1 the facets cache is cold (cached "+JSON.stringify(f.j.cached)+"): the wall has nothing to agree with");
else{
  const why=[];
  if(v1.j.cached!==true)why.push("the wall says cached "+JSON.stringify(v1.j.cached)+" beside a warm facets row");
  if(v1.j.as_of!==f.j.as_of)why.push("as_of "+v1.j.as_of+" vs "+f.j.as_of);
  if(v1.j.openTotal!==f.j.openTotal)why.push("openTotal "+v1.j.openTotal+" vs "+f.j.openTotal);
  if(sorted(v1.j.sourcesFacet)!==sorted(f.j.sourcesFacet))why.push("sourcesFacet differs: "+sorted(v1.j.sourcesFacet).slice(0,120)+" vs "+sorted(f.j.sourcesFacet).slice(0,120));
  if(Object.keys(v1.j.sourcesFacet||{}).length===0)why.push("no vendor counted");
  if(why.length)console.log("FAIL  V1 the vendor wall disagrees with the facets row it is cut from: "+why.join("; "));
  else console.log("PASS  V1 the vendor wall answers the facets row'"'"'s own pass: "+Object.keys(v1.j.sourcesFacet).length+" vendors, openTotal "+Number(v1.j.openTotal).toLocaleString("en-US")+", as_of "+v1.j.as_of+" ("+v1.raw.length.toLocaleString("en-US")+" bytes against "+f.raw.length.toLocaleString("en-US")+")");
}
'

echo "INFO  Not readable with the publishable key; in the SQL editor: (closure verdicts) SELECT count(*) FILTER (WHERE as_of > now() - interval '35 minutes') AS rewritten_last_pass, count(*) FROM public.job_board_board_observability -- after 20261109140000 the first number is the boards that changed bucket, not every board; (closure index) SELECT i.indisvalid FROM pg_index i WHERE i.indexrelid = to_regclass('public.job_board_closures_absence_basis_idx') -- true once built, and SELECT jobname FROM cron.job WHERE jobname LIKE 'oneshot-closures-absence-basis-idx%' is empty once the watcher has seen it (three failed builds also empty it, with no index: run the CREATE INDEX CONCURRENTLY by hand)"
echo "INFO  In the SQL editor: (re-embed queue) SELECT count(*), min(queued_at) FROM public.job_board_embed_requeue -- drains as the embed sweep stores text embeddings; (perk gate) SELECT command FROM cron.job WHERE jobname = 'employer-perks-sweep' names public.employer_perk_sweep_due() once 20261109161000 applied"
echo "INFO  OWNER, the measurement 20261109170000 waits for: SELECT calls, round(mean_exec_time) AS ms, left(query, 80) FROM pg_stat_statements WHERE query ILIKE '%get_country_facet%' OR query ILIKE '%get_salary_benchmarks%' -- read twice a day apart; if each reader gains more than 24 calls a day, scheduling the writer saves work (the migration's notice prints the cron.schedule, at :52 with its own 3min timeout), else leave it unscheduled and every call counts live as today"
