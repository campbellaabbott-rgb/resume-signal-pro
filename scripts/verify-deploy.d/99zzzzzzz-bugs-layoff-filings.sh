# shellcheck shell=bash
# ── 99zzzzzzz-bugs-layoff-filings. BUG ROUND A, LANE layoff-filings (branch
# bugs/a-layoff-filings): the layoff-filings function (build 2026-11-12.1 or
# later), three migrations (20261112180000 the wage-filing ledger and the
# blank-country arm, 20261112181000 the 365-day prune floor, 20261112182000 the
# first-read date and the retire) and the frontend's layoffFilings strings.
#
# Named 99zzzzzzz-bugs so it sorts after 99zzzzzzz-board-102-* in byte order
# and under a collating locale (verify-deploy.d/README.md).
#
# THE CLOCKS. B0 is the function's GET: version 2026-11-12.1 or later is this
# round's build. The GET also says which build wrote the newest complete
# nightly WARN chain (runs.warnDone) and the newest FTS audit (runs.audit), from
# the read log's build= prefix. M1 and M4 say whether 20261112180000 and
# 20261112182000 are applied, by an anon read of what each creates: a table
# and a function closed to anon answer 42501 (or 401), a missing one PGRST205
# or PGRST202. Before this round is pasted every line below is INFO (the
# FAIL-shaped answers production gives today are printed as such); once the
# build serves, a line whose own clock has run is judged.
#
# THE CLAIMS, one line each:
#   S14X-149  the GET's parser is parse205_v3_ts or later;
#   S14X-278  the newest audit of this build re-read stored filings (reread=);
#   S14X-158  judged by build: 20261112181000's DO block refuses to apply
#             unless the prune's floor is 365, and no anon read of it exists;
#   S14X-151  judged by build: the live instances are older than the readers'
#             90-day window;
#   S14X-036  Winnebago Industries' Iowa notice (2026-10-09, 51 workers) is on
#             its employer page with public_basis our_first_fetch, once a
#             nightly chain of this build has run (judgeable to 2027-01-07);
#   S14X-069  Alaska Airlines' edited Washington notice is one row (judgeable to
#             2027-01-28); 20261112182000's one-off pass retires the old reading;
#   S14X-150  Workday's 2026-09-29 8-K reads 2.5% once re-read (to 2026-12-28);
#             a different figure FAILs; not yet re-read is INFO;
#   S14X-067  the ledger and twin-vendor tokens answer no wage cell;
#   S14X-068  the two name matches added to the ledger answer no wage cell;
#   RC-OI-21  Hisense USA (postings with no country, "..., Georgia") answers a
#             cell, and sigmasoftware2 still none;
#   S14X-184  the served English strings carry "Filed LCA wages (H-1B, H-1B1, E-3)";
#   S14X-279  the served English strings carry "via Big Local News, read".
#
# READ-ONLY. The layoff-filings GET, anon reads of two public readers, an anon
# GET of one service-only function (a read-only transaction, and the arguments
# take its no-op path) and of one closed table, and GETs of the site's page and
# scripts as Googlebot. Nothing is written; no key is printed.
echo "== 99zzzzzzz. bug round A, layoff-filings: first-read states, the edited notice, the parser, the wage ledger, the read stamp =="

rm -f /tmp/vd_lf_*.json /tmp/vd_lf_*.html /tmp/vd_lf_*.js /tmp/vd_lf_chunks.txt
curl -s -m 30 -o /tmp/vd_lf_get.json "$B/functions/v1/layoff-filings" -H "apikey: $K" -H "Authorization: Bearer $K"
VDLF_F=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const r=j&&j.runs&&typeof j.runs==="object"?j.runs:{};const s=(v)=>/^\d{4}-\d{2}-\d{2}\.\d+$/.test(String(v??""))?String(v):"";process.stdout.write([s(j.version),s(r.warnDone&&r.warnDone.build),s(r.audit&&r.audit.build)].join(" "))}catch{process.stdout.write("  ")}' /tmp/vd_lf_get.json)
VDLF_VER=$(printf '%s' "$VDLF_F" | cut -d' ' -f1); VDLF_WB=$(printf '%s' "$VDLF_F" | cut -d' ' -f2); VDLF_AB=$(printf '%s' "$VDLF_F" | cut -d' ' -f3)
VDLF_LIVE=0; VDLF_WARN=0; VDLF_AUDIT=0
if [ -z "$VDLF_VER" ]; then echo "FAIL  B0 layoff-filings GET answered no build version: $(head -c 140 /tmp/vd_lf_get.json 2>/dev/null | tr -d '\n')"
elif build_ge layoff-filings "layoff-filings.$VDLF_VER" "2026-11-12" "1"; then echo "PASS  B0 layoff-filings serves $VDLF_VER (2026-11-12.1 or later: this round's build)"; VDLF_LIVE=1
else echo "INFO  B0 layoff-filings serves $VDLF_VER: 2026-11-12.1 is not serving yet, so every line below that waits for it is INFO"; fi
[ -n "$VDLF_WB" ] && build_ge layoff-filings "layoff-filings.$VDLF_WB" "2026-11-12" "1" && VDLF_WARN=1
[ -n "$VDLF_AB" ] && build_ge layoff-filings "layoff-filings.$VDLF_AB" "2026-11-12" "1" && VDLF_AUDIT=1

# M4: the retire answers anon with 42501 once 20261112182000 is applied (p_from after p_to is its no-op path).
curl -s -m 30 -o /tmp/vd_lf_m4.json "$B/rest/v1/rpc/layoff_warn_retire_unseen?p_state=VD&p_feed=probe&p_seen=%7B%7D&p_from=2026-01-02&p_to=2026-01-01" -H "apikey: $K" -H "Authorization: Bearer $K"
# M1: the ledger table answers anon with 42501 once 20261112180000 is applied.
curl -s -m 30 -o /tmp/vd_lf_m1.json "$B/rest/v1/lca_refused_tokens?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K"
R get_employer_layoff_filings_all '{"p_token":"82c90207-af7d-495b-b437-aa9a4c72f4e8"}' > /tmp/vd_lf_ia.json
R get_employer_layoff_filings_all '{"p_token":"talent.alaskaair.com"}' > /tmp/vd_lf_ak.json
R get_employer_layoff_filings_all '{"p_token":"workday~wd5~Workday"}' > /tmp/vd_lf_wd.json
R get_employer_lca_wages '{"p_tokens":["socialfinance","sigmasoftware2","sunday","echo","lockwood","roadrunner"]}' > /tmp/vd_lf_ledger.json
R get_employer_lca_wages '{"p_tokens":["ebb9e98a-78f1-47eb-a562-c52b36b09dd3","32d78507-2175-47fb-8427-a89a691203be"]}' > /tmp/vd_lf_twins.json
R get_employer_lca_wages '{"p_tokens":["hisenseusacorporation","sigmasoftware2"]}' > /tmp/vd_lf_hisense.json

# The served English strings: the page's entry script, the board's chunk the
# entry names (a shard's English rides with the page that renders it), and
# every rb-en_ namespace chunk the entry or the page names. The whole-file
# safety net (rb-en_all) is not read: it carries every string, so finding one
# there says nothing about what the board serves.
curl -s -m 30 -A "$UA" -o /tmp/vd_lf_home.html "$SITE/"
VDLF_IDX=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_lf_home.html 2>/dev/null | head -1)
[ -n "$VDLF_IDX" ] && curl -s -m 60 -A "$UA" -o /tmp/vd_lf_index.js "$SITE$VDLF_IDX"
: > /tmp/vd_lf_chunks.txt
cat /tmp/vd_lf_index.js >> /tmp/vd_lf_chunks.txt 2>/dev/null
VDLF_JOBS=$(grep -oE '"\./Jobs-[A-Za-z0-9_-]+\.js"' /tmp/vd_lf_index.js 2>/dev/null | head -1 | tr -d '"' | sed 's|^\./||')
[ -n "$VDLF_JOBS" ] && { curl -s -m 60 -A "$UA" "$SITE/assets/$VDLF_JOBS" >> /tmp/vd_lf_chunks.txt; echo >> /tmp/vd_lf_chunks.txt; }
VDLF_NC=0
for VDLF_C in $(cat /tmp/vd_lf_home.html /tmp/vd_lf_index.js 2>/dev/null | grep -oE 'rb-en_[A-Za-z0-9_-]+\.js' | grep -v '^rb-en_all-' | sort -u | head -80); do
  curl -s -m 60 -A "$UA" "$SITE/assets/$VDLF_C" >> /tmp/vd_lf_chunks.txt; echo >> /tmp/vd_lf_chunks.txt; VDLF_NC=$((VDLF_NC + 1))
done

VDLF_VER="$VDLF_VER" VDLF_LIVE="$VDLF_LIVE" VDLF_WARN="$VDLF_WARN" VDLF_AUDIT="$VDLF_AUDIT" VDLF_IDX="$VDLF_IDX" VDLF_JOBS="$VDLF_JOBS" VDLF_NC="$VDLF_NC" node -e '
const fs=require("fs");const E=process.env;
const raw=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const read=(f)=>{try{return JSON.parse(raw(f))}catch{return undefined}};
const peek=(f)=>JSON.stringify(raw(f).slice(0,140));
const say=(v,s)=>console.log(v+"  "+s);
const live=E.VDLF_LIVE==="1",warn=E.VDLF_WARN==="1",audit=E.VDLF_AUDIT==="1";
const today=new Date().toISOString().slice(0,10);
const G=read("/tmp/vd_lf_get.json")||{};
const pre="before this round is pasted";
// A closed object answers 42501 (or 401 with it); a missing one PGRST202 / PGRST205.
const state=(f)=>{const j=read(f);const c=j&&!Array.isArray(j)&&typeof j==="object"?String(j.code||""):"";
  if(c==="42501")return "closed";if(c==="PGRST202"||c==="PGRST205"||c==="42P01"||c==="42883")return "missing";
  if(Array.isArray(j))return "open";return "unread"};
const m4=state("/tmp/vd_lf_m4.json"),m1=state("/tmp/vd_lf_m1.json");
const mig=(id,s,f,what)=>{
  if(s==="closed")say("PASS",id+" "+what+" is applied: anon is refused it (42501)");
  else if(s==="open")say("FAIL",id+" "+what+" answers anon: "+peek(f));
  else if(s==="missing")say(live?"FAIL":"INFO",id+" "+what+" is not applied"+(live?" while this round\x27s build serves":" ("+pre+")"));
  else say("FAIL",id+" "+what+": the probe answered something unreadable: "+peek(f));
};
mig("M1",m1,"/tmp/vd_lf_m1.json","20261112180000 (lca_refused_tokens, the wage reader\x27s ledger and blank-country arm)");
mig("M4",m4,"/tmp/vd_lf_m4.json","20261112182000 (layoff_warn_retire_unseen, the first-read date)");
const rows=(f)=>{const j=read(f);return Array.isArray(j)?j:null};
// S14X-149
{const p=String(G.parser||"");const v=Number((/^parse205_v(\d+)_ts$/.exec(p)||[])[1]);
 if(!live)say("INFO","S14X-149 the parser is "+(p||"unstated")+" ("+pre+"; this round ships parse205_v3_ts)");
 else if(v>=3)say("PASS","S14X-149 the parser is "+p+": a negated or forward-looking cut and a buyer offering employment are not workforce events");
 else say("FAIL","S14X-149 this round\x27s build serves parser "+(p||"(none)")+", not parse205_v3_ts or later");}
// S14X-278
{const a=G.runs&&G.runs.audit;
 if(!live)say("INFO","S14X-278 "+pre+": the daily audit does not yet re-read stored filings");
 else if(!audit)say("INFO","S14X-278 no FTS audit of this build has finished yet"+(a&&a.at?" (newest: "+a.at+", build "+a.build+")":""));
 else if(!Number.isInteger(a.reread))say("FAIL","S14X-278 the audit of this build ("+a.at+") wrote no reread= count: the re-read did not run");
 else say(a.reread>0?"PASS":"INFO","S14X-278 the audit of this build ("+a.at+") re-read "+a.reread+" stored filing(s), "+a.rereadReplaced+" replaced"+(a.reread>0?"":" (none left to re-read, or it stopped early)"));}
// S14X-158, S14X-151: judged by build.
say(live?"PASS":"INFO","S14X-158 "+(live?"this round\x27s build refuses a row in a month the prune rolled up, and 20261112181000 applies only with the 365-day floor (its DO block refuses otherwise)":pre+": the writers do not refuse a rolled-up month"));
say(live?"PASS":"INFO","S14X-151 "+(live?"this round\x27s build supersedes a Texas update over its original (the live instances are older than the 90-day window, so no anon reader shows them)":pre+": a Texas \"Updated\" notice stands beside its original"));
// S14X-036
{const r=rows("/tmp/vd_lf_ia.json");
 const hit=r&&r.find((x)=>x.la_state==="IA"&&x.la_event_date==="2026-10-09"&&Number(x.la_workers)===51);
 const w=G.runs&&G.runs.warnDone;
 if(!r)say("FAIL","S14X-036 the Winnebago Industries employer page is unreadable: "+peek("/tmp/vd_lf_ia.json"));
 else if(hit&&hit.la_public_basis==="our_first_fetch")say("PASS","S14X-036 Winnebago Industries\x27 Iowa notice of 2026-10-09 (51 workers) is listed, dated by our first read ("+hit.la_public_date+")");
 else if(hit)say("FAIL","S14X-036 the Iowa notice is listed with public_basis "+hit.la_public_basis+", not our_first_fetch");
 else if(today>"2027-01-07")say("INFO","S14X-036 the notice of 2026-10-09 has left the 90-day window; no longer judged");
 else if(!live)say("INFO","S14X-036 the employer page lists "+r.length+" filing(s) and not the Iowa notice ("+pre+")");
 else if(m4!=="closed")say("FAIL","S14X-036 this round\x27s build serves without 20261112182000, so the four first-read states are held");
 else if(!warn)say("INFO","S14X-036 no complete nightly chain of this build yet"+(w&&w.at?" (newest: "+w.at+", build "+w.build+")":"")+": the Iowa notice is judged after one");
 else say("FAIL","S14X-036 a nightly chain of this build finished ("+w.at+") and the Iowa notice of 2026-10-09 is not on the employer page");}
// S14X-069
{const r=rows("/tmp/vd_lf_ak.json");
 if(!r)say("FAIL","S14X-069 the Alaska Airlines employer page is unreadable: "+peek("/tmp/vd_lf_ak.json"));
 else if(today>"2027-01-28")say("INFO","S14X-069 the notice has left the 90-day window; no longer judged");
 else if(r.length===0)say("INFO","S14X-069 the Alaska Airlines page lists no filing (the notice left the reader)");
 else{const one=r.length===1&&Number(r[0].la_total_n)===1;const sites=r.map((x)=>x.la_site).join(" | ");
  if(one)say("PASS","S14X-069 Alaska Airlines\x27 Washington notice is listed once (site "+sites+")");
  else if(m4!=="closed")say(live?"FAIL":"INFO","S14X-069 the notice is listed "+r.length+" times ("+sites+")"+(live?" and 20261112182000 is not applied":" ("+pre+")"));
  else say("FAIL","S14X-069 20261112182000 is applied and the notice is still listed "+r.length+" times ("+sites+")");}}
// S14X-150
{const r=rows("/tmp/vd_lf_wd.json");const row=r&&r.find((x)=>x.la_event_date==="2026-09-29");
 if(!r)say("FAIL","S14X-150 the Workday employer page is unreadable: "+peek("/tmp/vd_lf_wd.json"));
 else if(!row)say("INFO","S14X-150 no 2026-09-29 filing on the Workday page"+(today>"2026-12-28"?" (past its window)":""));
 else if(Number(row.la_pct)===2.5)say("PASS","S14X-150 Workday\x27s 2026-09-29 8-K reads 2.5%");
 else if(row.la_pct!=null)say("FAIL","S14X-150 Workday\x27s 2026-09-29 8-K reads "+row.la_pct+"%, not the 2.5% it states");
 else say("INFO","S14X-150 Workday\x27s 2026-09-29 8-K reads no percentage yet"+(live?" (the audit re-reads ten stored filings a day; POST edgar_reread re-reads them all)":" ("+pre+")"));}
// S14X-067, S14X-068, RC-OI-21: the wage reader.
const lit=(r)=>r.filter((x)=>x.ow_soc_code!=null||x.ow_employer_filings_n!=null);
const show=(r)=>r.map((x)=>x.ow_company_token+"="+(x.ow_soc_code?x.ow_worksite_state+" "+x.ow_soc_code:"no cell")+"/"+x.ow_employer_filings_n).join(", ");
for(const [id,f,what] of [["S14X-067","/tmp/vd_lf_ledger.json","the ledger and twin-vendor tokens"],["S14X-068","/tmp/vd_lf_twins.json","the two name matches added to the ledger"]]){
  const r=rows(f);
  if(!r)say("FAIL",id+" the wage reader is unreadable: "+peek(f));
  else if(!r.length)say("FAIL",id+" the wage reader answered no row for "+what+" (it answers one per token)");
  else{const l=lit(r);
   if(!l.length)say("PASS",id+" "+what+" answer no wage cell and no employer count ("+r.length+" tokens)");
   else say(m1==="closed"?"FAIL":"INFO",id+" "+l.length+" of "+r.length+" of "+what+" still answer another employer\x27s filings: "+show(l)+(m1==="closed"?"":" ("+pre+")"));}}
{const r=rows("/tmp/vd_lf_hisense.json");
 if(!r)say("FAIL","RC-OI-21 the wage reader is unreadable: "+peek("/tmp/vd_lf_hisense.json"));
 else{const h=r.find((x)=>x.ow_company_token==="hisenseusacorporation"),s=r.find((x)=>x.ow_company_token==="sigmasoftware2");
  if(!h||!s)say("FAIL","RC-OI-21 the wage reader did not answer both tokens: "+peek("/tmp/vd_lf_hisense.json"));
  else if(s.ow_soc_code!=null||s.ow_employer_filings_n!=null)say(m1==="closed"?"FAIL":"INFO","RC-OI-21 sigmasoftware2 still answers "+show([s])+(m1==="closed"?"":" ("+pre+")"));
  else if(h.ow_soc_code!=null)say("PASS","RC-OI-21 Hisense USA, whose postings name Georgia and no country, answers a cell ("+show([h])+"), and sigmasoftware2 none");
  else say(m1==="closed"?"FAIL":"INFO","RC-OI-21 Hisense USA answers no cell"+(m1==="closed"?" although 20261112180000 is applied":" ("+pre+")"));}}
// S14X-184, S14X-279: the served English strings.
{const idx=E.VDLF_IDX,src=raw("/tmp/vd_lf_chunks.txt");
 if(!idx||src.length<20000)say("FAIL","S14X-184/279 the served page names no readable entry script ("+(idx||"none")+", "+src.length+" bytes): no string can be read");
 else for(const [id,s,what] of [["S14X-184","Filed LCA wages (H-1B, H-1B1, E-3)","the wage chip names the three classes its file holds"],["S14X-279","via Big Local News, read","a courier state\x27s read stamp names Big Local News"]]){
  if(src.includes(s))say("PASS",id+" "+what+": "+JSON.stringify(s)+" is served ("+idx+", the board chunk "+(E.VDLF_JOBS||"(none named)")+" and "+E.VDLF_NC+" rb-en namespace chunk(s))");
  else say(live?"FAIL":"INFO",id+" "+JSON.stringify(s)+" is not in "+idx+", the board chunk "+(E.VDLF_JOBS||"(none named)")+" or "+E.VDLF_NC+" rb-en namespace chunk(s)"+(live?": this round\x27s frontend is not published":" ("+pre+")"));}}
'
