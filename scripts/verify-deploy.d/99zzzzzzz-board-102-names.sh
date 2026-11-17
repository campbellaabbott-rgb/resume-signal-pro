# shellcheck shell=bash
# ── 99zzzzzzz-board-102-names. THE WORKDAY NAMES (board/102-names; owner
# decision OD9 (a), board program BB-02). Migration 20261111150000 writes 431
# company_name_overrides keys over 370 Workday tenants that print their tenant
# code, each with its evidence from the 2026-11-08 capture, and re-arms
# job-board's name-sync lane, which renames the stored rows a board at a time
# from the next pass end (job-board 2026-09-09.102, NAME_SYNC_VERSION 7). It
# applies after the frontend publish that carries src/lib/employer-names.ts
# with the same rows.
#
# Named 99zzzzzzz so it sorts after every 99zzzzzz- section.
#
# THE CLOCK. Whether the file has applied is read from the staged runner's
# record in this checkout, as section 49 reads it: scripts/deploy-ledger.mjs
# migrations(), no network. Pending, every line below is INFO and says so.
# Applied, the clock is the commit time of the drizzle stub that names it
# (VD102N_APPLIED_AT overrides it), and the boards are judged once the
# job-board status action's passEnd.steps.names reads "name sync vN complete"
# or "done" (N >= 7) with a doneAt after the clock: the lane stamps its
# version only when a walk has finished, and the file removed the stamp.
#
# THE CLAIMS, one line each:
#   N0  the file's state, and the clock (INFO);
#   N1  job-board serves 2026-09-09.102 or later, whose lane carries
#       NAME_SYNC_VERSION 7: older is INFO before the file applies, and a FAIL
#       after it, since an older lane would not walk these boards;
#   N2  the name-sync lane finished a walk after the file applied: INFO until
#       then, FAIL 48 h after the clock;
#   N3  each of six named boards (a tenant key the re-check corrected, two the
#       re-check judged right, an exact site on a tenant of several employers,
#       the board kept by its site on a hosting tenant, and one of the
#       stratum's tenant keys) serves only the new name once the walk is done;
#       a board serving no row is INFO;
#   N4  gi~wd1~Global_Infrastructure, a shared site the re-check left out, is
#       never shown as the corpus's "Sidara" (INFO until the walk is done).
# Not provable from outside, so proved in the suite: the list, its evidence,
# the classes left out, the hand-set rows kept and the refusals
# (workday-boards-named-by-a-tenant-code-print-the-brand-on-their-own-career-site.test.ts).
#
# READ-ONLY. One OPTIONS preflight; job-board status and list reads sent with
# x-rb-budget: probe (J); git and file reads. Nothing is written anywhere.
echo "== 99zzzzzzz. board .102 names: 431 Workday names print the brand on their own career site once the name-sync lane has walked (20261111150000, job-board .102) =="

rm -f /tmp/vd_102n_*
VD102N_JB=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/job-board" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+:[[:space:]]*//')
VD102N_LIVE=0; build_ge job-board "$VD102N_JB" 2026-09-09 102 && VD102N_LIVE=1

# The file's state in the staged runner's record, and the commit time of the stub that ran it.
node --input-type=module -e '
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const out = { state: "unreadable", file: null, stub: null, why: "" };
try {
  const L = await import(process.cwd() + "/scripts/deploy-ledger.mjs");
  const m = L.migrations(JSON.parse(readFileSync("docs/deploy-ledger.json", "utf8")));
  const file = readdirSync("supabase/migrations").find((f) => f.startsWith("20261111150000_")) ?? null;
  out.file = file;
  if (!file) { out.state = "absent"; out.why = "this checkout carries no 20261111150000 file"; }
  else if (m.applied.includes(file)) {
    out.state = "applied";
    const name = file.replace(/\.sql$/, "");
    out.stub = readdirSync("drizzle/migrations").filter((f) => f.endsWith(".sql")).find((f) => readFileSync("drizzle/migrations/" + f, "utf8").includes(name) || f.includes("20261111150000")) ?? null;
  } else if (m.pending.includes(file) || m.hold.includes(file)) { out.state = "pending"; out.why = "no drizzle stub in this checkout names it (pull main after Lovable applies it)"; }
  else { out.state = "other"; out.why = "the ledger lists it neither applied nor pending"; }
} catch (e) { out.why = String(e && e.message || e).slice(0, 160); }
writeFileSync("/tmp/vd_102n_mig.json", JSON.stringify(out));
' 2>/dev/null
VD102N_STUB=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_102n_mig.json","utf8"));process.stdout.write(j.stub||"")}catch{}' 2>/dev/null)
VD102N_STUB_AT=""
[ -n "$VD102N_STUB" ] && VD102N_STUB_AT=$(git log -1 --format=%cI -- "drizzle/migrations/$VD102N_STUB" 2>/dev/null)

# The boards: key, the name it must serve.
VD102N_NAMED="nghs~wd1~External|Northeast Georgia Health System
owensminor~wd1~OMCareers|Owens & Minor
beigene~wd5~BeiGene|BeOne
pfg~wd3~SaveonfoodsCareers|Save-On-Foods
maxar~wd1~Vantor|Vantor
utaustin~wd1~UTstaff|University of Texas at Austin"
J '{"action":"status"}' > /tmp/vd_102n_status.json
VD102N_I=0
while IFS='|' read -r VD102N_T VD102N_N; do
  [ -z "$VD102N_T" ] && continue
  VD102N_I=$((VD102N_I + 1))
  J "{\"action\":\"list\",\"companies\":[\"$VD102N_T\"],\"vendor\":[\"workday\"],\"limit\":20,\"groupSimilar\":false,\"includeFacets\":false,\"noLog\":true}" > "/tmp/vd_102n_list_$VD102N_I.json"
done <<EOF
$VD102N_NAMED
EOF
J '{"action":"list","companies":["gi~wd1~Global_Infrastructure"],"vendor":["workday"],"limit":20,"groupSimilar":false,"includeFacets":false,"noLog":true}' > /tmp/vd_102n_gi.json

VD102N_JB="$VD102N_JB" VD102N_LIVE="$VD102N_LIVE" VD102N_NAMED="$VD102N_NAMED" VD102N_STUB="$VD102N_STUB" VD102N_STUB_AT="$VD102N_STUB_AT" \
VD102N_APPLIED_AT="${VD102N_APPLIED_AT:-}" node -e '
const fs=require("fs");const E=process.env;
const out=(s,m)=>console.log(s+"  "+m);
const json=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync(f,"utf8").slice(0,140).replace(/\s+/g," ")||"(no answer)"}catch{return "(no answer)"}};
const rows=(x)=>(x&&Array.isArray(x.jobs)?x.jobs.filter((r)=>r&&typeof r==="object"):null);
const LIVE=E.VD102N_LIVE==="1",now=Date.now();
const NAMED=String(E.VD102N_NAMED||"").split("\n").filter(Boolean).map((l)=>{const i=l.indexOf("|");return {token:l.slice(0,i),name:l.slice(i+1)}});

// N0: the file and the clock.
const mig=json("/tmp/vd_102n_mig.json")||{state:"unreadable",why:"(no answer)"};
const atEnv=Date.parse(E.VD102N_APPLIED_AT||""),atStub=Date.parse(E.VD102N_STUB_AT||"");
const at=Number.isFinite(atEnv)?atEnv:atStub;
const applied=mig.state==="applied";
if(!applied)out(mig.state==="unreadable"?"FAIL":"INFO","N0 20261111150000 is "+mig.state+": "+mig.why+(mig.state==="unreadable"?" (scripts/deploy-ledger.mjs migrations() could not be read)":"; nothing below is judged until it applies"));
else if(!Number.isFinite(at))out("INFO","N0 "+mig.file+" applied (drizzle "+(E.VD102N_STUB||"stub not found")+"), but its commit time is unreadable: set VD102N_APPLIED_AT to judge the boards");
else out("INFO","N0 "+mig.file+" applied: drizzle "+(E.VD102N_STUB||"(VD102N_APPLIED_AT)")+" at "+new Date(at).toISOString()+(Number.isFinite(atEnv)?" (VD102N_APPLIED_AT)":"")+", "+((now-at)/3600000).toFixed(1)+" h ago");
const ageH=applied&&Number.isFinite(at)?(now-at)/3600000:null;

// N1
const jb=E.VD102N_JB||"";
if(!jb)out("FAIL","N1 job-board preflight carries no x-fn-build (not deployed, or its preflight does not answer)");
else if(LIVE)out("PASS","N1 job-board x-fn-build = "+jb+" (2026-09-09.102 or later: the name-sync lane at NAME_SYNC_VERSION 7)");
else if(applied)out("FAIL","N1 job-board x-fn-build = "+jb+", older than .102, while 20261111150000 has applied: that lane does not walk these boards at version 7");
else out("INFO","N1 job-board x-fn-build = "+jb+": older than .102, and 20261111150000 has not applied");

// N2
const st=json("/tmp/vd_102n_status.json");
const ns=st&&st.passEnd&&st.passEnd.steps&&st.passEnd.steps.names||null;
const said=JSON.stringify([ns&&ns.detail||null,ns&&ns.doneAt||null]);
const m=/^name sync v(\d+) (complete|done)/.exec(String(ns&&ns.detail||""));
const doneAt=Date.parse(ns&&ns.doneAt||"");
const walked=applied&&Number.isFinite(at)&&!!m&&Number(m[1])>=7&&Number.isFinite(doneAt)&&doneAt>at;
if(!st||typeof st!=="object")out("FAIL","N2 job-board status is unreadable: "+peek("/tmp/vd_102n_status.json"));
else if(!applied||ageH===null)out("INFO","N2 the names step reads "+said+"; judged once 20261111150000 has applied");
else if(walked)out("PASS","N2 the name-sync lane finished a walk "+((doneAt-at)/3600000).toFixed(1)+" h after the file applied: "+said);
else if(ageH>48)out("FAIL","N2 no name-sync walk has finished in the "+ageH.toFixed(1)+" h since 20261111150000 applied: the names step reads "+said+" (is name_sync_version back without a walk, or does the step stop on its clock every pass?)");
else out("INFO","N2 the names step reads "+said+": no walk has finished since the file applied "+ageH.toFixed(1)+" h ago (FAIL after 48 h)");

// N3
NAMED.forEach(({token,name},i)=>{
  const f="/tmp/vd_102n_list_"+(i+1)+".json",j=json(f),L=rows(j),tag="N3 workday:"+token;
  if(!L){out("FAIL",tag+": the list is unreadable: "+peek(f));return}
  if(Array.isArray(j.unknownCompanies)&&j.unknownCompanies.includes(token)){out("FAIL",tag+": the serving catalogue does not carry it (unknownCompanies)");return}
  const shown=[...new Set(L.map((r)=>r.company))];
  if(!L.length){out("INFO",tag+" serves no row to read a name from");return}
  const wrong=L.filter((r)=>r.company!==name);
  if(!walked)out("INFO",tag+": "+L.length+" row(s) read "+JSON.stringify(shown)+"; "+JSON.stringify(name)+" is judged once the lane has walked since 20261111150000 applied");
  else if(!wrong.length)out("PASS",tag+": all "+L.length+" row(s) read "+JSON.stringify(name));
  else out("FAIL",tag+": "+wrong.length+" of "+L.length+" row(s) read "+JSON.stringify([...new Set(wrong.map((r)=>r.company))])+", want "+JSON.stringify(name)+" after the walk ("+said+")");
});

// N4
{const j=json("/tmp/vd_102n_gi.json"),L=rows(j),tag="N4 workday:gi~wd1~Global_Infrastructure";
  if(!L)out("FAIL",tag+": the list is unreadable: "+peek("/tmp/vd_102n_gi.json"));
  else if(!L.length)out("INFO",tag+" serves no row to read a name from");
  else{const sid=L.filter((r)=>r.company==="Sidara");const shown=JSON.stringify([...new Set(L.map((r)=>r.company))]);
    if(!walked)out("INFO",tag+": "+L.length+" row(s) read "+shown+"; judged once the lane has walked");
    else if(sid.length)out("FAIL",tag+": "+sid.length+" of "+L.length+" row(s) read \"Sidara\", one member\x27s name on a site the re-check found shared by TYLin, Introba and Landrum & Brown");
    else out("PASS",tag+": none of "+L.length+" row(s) reads \"Sidara\" (they read "+shown+"): the shared site took no one member\x27s name");}}
'
