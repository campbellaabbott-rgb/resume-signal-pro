# shellcheck shell=bash
# ── 99zzzzzzz-board-102-catalogue. BOARD .102, THE CATALOGUE LANE (branch
# board/102-catalogue; board program 2026-11-08, spec-102 lane 3). job-board
# 2026-09-09.102 carries 44,499 boards: OD1's six retirements, the nine BB-05
# twins and PRUNE-1024's ten leave (25 keys), six agency boards are labelled,
# thirteen boards are repointed (D13), four are renamed (B05) and Convergint's
# Workday site is appended. layoff-filings 2026-11-11.1 carries the same
# catalogue, byte for byte. Migrations: 20261111130000 (the four names'
# evidence, before the function) and 20261111120000 (the catalogue high-water,
# AFTER .102 serves).
#
# Named 99zzzzzzz so it sorts after every 99zzzzzz- section.
#
# EVERY KEY IS vendor:token. A list scoped to tokens none of which the
# catalogue carries answers as the board's count for an employer it does not
# carry (uncarried.ts): total 0 with the tokens in unknownCompanies, read from
# no row. So that answer proves only that the catalogue dropped a token. The
# rows themselves are counted by get_company_fill_curve's open_roles, which
# reads job_board_postings by token (open and inside the 30-day window, as the
# board serves them); each of the 24 tokens it is asked about is carried by no
# vendor on .102. pinpoint:helsing shares its token with greenhouse:helsing,
# so it is counted by a list scoped to its vendor, which does read the rows.
#
# THE CLOCKS. The build's own clock is status.sliceStats.buildSince when
# sliceStats.build is the serving build. The prune's clock: the orphan prune
# runs in the pass-end serve step, and only while the catalogue is not below
# the high-water mark. The first run of this section that sees .102 serving
# with the mark at the catalogue records that sighting in VD102C_STATE
# (default ~/.config/resumebooster/verify-state/board-102-catalogue.json), or
# VD102C_MIGRATED_AT states when 20261111120000 applied. The rows are judged
# once a serve step of the serving build has finished after that instant.
#
# THE CLAIMS, one line each:
#   B1  job-board serves 2026-09-09.102 or later. Older is INFO (not pasted
#       yet), and a FAIL once layoff-filings serves its build: one paste ships
#       both;
#   B2  layoff-filings serves 2026-11-11.1 or later; INFO before, FAIL once
#       job-board .102 serves;
#   H   status: catalogSize == catalogHighwater and orphanPruneBlocked
#       false, and while exactly .102 serves, the size is 44,499. INFO before
#       .102 and until 20261111120000 behaves as applied; FAIL 24 h after
#       .102's first slice if the mark is still above the catalogue (it applied
#       while .101 served and was raised back, or never applied), or at once if
#       .102 carries another size. A later build may change the catalogue, so
#       on one the 44,499 is not asked, and a size off the mark is INFO;
#   R1  the serving catalogue carries none of the 24 retired tokens that no
#       other vendor carries. The board looks up 5 names a call
#       (NAMES_PER_CALL), so the tokens go 5 to a list call, and a token is
#       uncarried when any of unknownCompanies, companiesUnresolved[].asked,
#       companiesResolved[].asked or companiesNotLookedUp names it: all four
#       name only tokens the catalogue lacks;
#   R2  those 24 tokens serve 0 open rows after the prune's clock (today
#       teamtailor eutalents 3,269 and smartrecruiters JobsForHumanity 143);
#   R3  pinpoint:helsing serves 0 rows, by its vendor. It served 0 before the
#       paste too, so a 0 is INFO, and a row after the prune's clock a FAIL;
#   T   BB-05, per pair: the retired twin serves 0 open rows after the prune's
#       clock, so no posting is listed twice; the LCC fa- twin keeps at least
#       90% of the count saved before the paste (VD102C_LCC_PRE overrides it),
#       and the other kept twins' counts are INFO;
#   A   per labelled board: every served row carries agency true (a list with
#       excludeAgencies serves none), once this build read the board or 24 h
#       after its first slice; a board serving no row is INFO;
#   D   ashby:wayve, ashby:clickhouse and greenhouse:machindustries each serve
#       a row under the new vendor 24 h after the first slice; a list naming
#       the key in unknownCompanies is a FAIL at once;
#   C   workday:convergint~wd501~Gbl serves a row 24 h after the first slice,
#       and the same unknownCompanies rule.
# Not provable from outside, so proved in the suite: the in-place positions of
# the labelled and repointed boards, the hot list, the aliases, the copy's byte
# identity and the four names (the-od1-charter-and-the-dedupe-leave-the-
# catalogue.test.ts, four-boards-print-the-name-their-employer-uses.test.ts).
#
# READ-ONLY. Two OPTIONS preflights; job-board status and list reads sent with
# x-rb-budget: probe; the anon reader get_company_fill_curve. Nothing is
# written to production; the one local file is the state named above.
echo "== 99zzzzzzz. board .102 catalogue: 25 boards out and their rows exited, six labelled, the repoints and Convergint served, the high-water at 44,499 (job-board .102, layoff-filings 2026-11-11.1, 20261111120000) =="

rm -f /tmp/vd_102c_*
vd102c_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+:[[:space:]]*//'
}
VD102C_JB=$(vd102c_build job-board)
VD102C_LF=$(vd102c_build layoff-filings)
VD102C_LIVE=0; build_ge job-board "$VD102C_JB" 2026-09-09 102 && VD102C_LIVE=1
VD102C_LFL=0; build_ge layoff-filings "$VD102C_LF" 2026-11-11 1 && VD102C_LFL=1

# The 24 retired keys whose token no other vendor carries, and the BB-05 pairs (retired twin, kept twin).
VD102C_GONE="teamtailor:eutalents workable:toloka-ai workable:clients-blackbox-inc workable:huzzle smartrecruiters:JobsForHumanity recruitee:vluchtelingenwerkvrijwilligers oracle:login-esms-saasfaukgovprod1~ocs~CX_1 adp:1da67361-03ef-4aa2-8925-9ef512ba7c42 adp:48d65e3f-dbfc-44b9-996a-65283fbdcee9 adp:ba397985-19df-4126-90de-3220631304e5 recruitee:boggimilano recruitee:easyapplyrimutee breezy:cdpdoctor paylocity:0c4c3299-d50f-40e2-aca1-0de562ac280d paylocity:b8c553b7-79ad-4da0-a8b2-3ce8e842324a icims:careers.spglobal.com workday:lbg~wd3~broadbean_external greenhouse:eu~imc greenhouse:dataikujobs greenhouse:applytonumeral greenhouse:starcloud greenhouse:deepmind greenhouse:etchedai ashby:corgi"
VD102C_KEPT="oracle:fa-esms-saasfaukgovprod1~ocs~CX_1 adp:009d7dae-06f5-4976-bb97-c97601e32efe adp:02835ad7-1b2e-4eb2-9773-3454d03b1a3e adp:1b4164c0-a7ce-4c7b-8525-41e0f23310d4 recruitee:boggimilano1 recruitee:easyapplyrekluti breezy:community-dental-partners paylocity:e4d6a57d-f658-427a-a859-5d672ac07e1b paylocity:ff517f63-c379-48fb-acc8-8d66e8d5b076"
VD102C_LABELLED="workable:pavago workable:hire-overseas smartrecruiters:JobMobz1 recruitee:sterkinmatches recruitee:deintraumjobwartet lever:americaatwork"
VD102C_SERVED="ashby:wayve ashby:clickhouse greenhouse:machindustries workday:convergint~wd501~Gbl"

VD102C_TOKS=""
for VD102C_K in $VD102C_GONE; do VD102C_TOKS="$VD102C_TOKS${VD102C_TOKS:+,}\"${VD102C_K#*:}\""; done

J '{"action":"status"}' > /tmp/vd_102c_status.json
VD102C_I=0; VD102C_B=""; VD102C_N=0
for VD102C_K in $VD102C_GONE; do
  VD102C_B="$VD102C_B${VD102C_B:+,}\"${VD102C_K#*:}\""; VD102C_N=$((VD102C_N + 1))
  if [ "$VD102C_N" -eq 5 ]; then J "{\"action\":\"list\",\"companies\":[$VD102C_B],\"countOnly\":true}" > "/tmp/vd_102c_gone_$VD102C_I.json"; VD102C_I=$((VD102C_I + 1)); VD102C_B=""; VD102C_N=0; fi
done
[ -n "$VD102C_B" ] && J "{\"action\":\"list\",\"companies\":[$VD102C_B],\"countOnly\":true}" > "/tmp/vd_102c_gone_$VD102C_I.json"
J '{"action":"list","companies":["helsing"],"vendor":["pinpoint"],"countOnly":true}' > /tmp/vd_102c_helsing.json
R get_company_fill_curve "{\"p_tokens\":[$VD102C_TOKS]}" > /tmp/vd_102c_curve.json
VD102C_I=0
for VD102C_K in $VD102C_KEPT; do
  VD102C_I=$((VD102C_I + 1))
  J "{\"action\":\"list\",\"companies\":[\"${VD102C_K#*:}\"],\"vendor\":[\"${VD102C_K%%:*}\"],\"countOnly\":true}" > "/tmp/vd_102c_kept_$VD102C_I.json"
done
VD102C_I=0
for VD102C_K in $VD102C_LABELLED; do
  VD102C_I=$((VD102C_I + 1))
  J "{\"action\":\"list\",\"companies\":[\"${VD102C_K#*:}\"],\"vendor\":[\"${VD102C_K%%:*}\"],\"countOnly\":true}" > "/tmp/vd_102c_ag_$VD102C_I.json"
  J "{\"action\":\"list\",\"companies\":[\"${VD102C_K#*:}\"],\"vendor\":[\"${VD102C_K%%:*}\"],\"excludeAgencies\":true,\"groupSimilar\":false,\"includeFacets\":false,\"limit\":60}" > "/tmp/vd_102c_agx_$VD102C_I.json"
done
VD102C_I=0
for VD102C_K in $VD102C_SERVED; do
  VD102C_I=$((VD102C_I + 1))
  J "{\"action\":\"list\",\"companies\":[\"${VD102C_K#*:}\"],\"vendor\":[\"${VD102C_K%%:*}\"],\"countOnly\":true}" > "/tmp/vd_102c_served_$VD102C_I.json"
done

VD102C_JB="$VD102C_JB" VD102C_LF="$VD102C_LF" VD102C_LIVE="$VD102C_LIVE" VD102C_LFL="$VD102C_LFL" \
VD102C_GONE="$VD102C_GONE" VD102C_KEPT="$VD102C_KEPT" VD102C_LABELLED="$VD102C_LABELLED" VD102C_SERVED="$VD102C_SERVED" \
VD102C_STATE="${VD102C_STATE:-$HOME/.config/resumebooster/verify-state/board-102-catalogue.json}" \
VD102C_MIGRATED_AT="${VD102C_MIGRATED_AT:-}" VD102C_LCC_PRE="${VD102C_LCC_PRE:-}" node -e '
const fs=require("fs"),path=require("path");const E=process.env;
const out=(s,m)=>console.log(s+"  "+m);
const json=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const peek=(f)=>{try{return fs.readFileSync(f,"utf8").slice(0,140).replace(/\s+/g," ")||"(no answer)"}catch{return "(no answer)"}};
const words=(s)=>String(s||"").split(/\s+/).filter(Boolean);
const tok=(k)=>k.slice(k.indexOf(":")+1);
const CATALOGUE=44499,LIVE=E.VD102C_LIVE==="1",LFL=E.VD102C_LFL==="1",now=Date.now();
const GONE=words(E.VD102C_GONE),KEPT=words(E.VD102C_KEPT),LAB=words(E.VD102C_LABELLED),SERVED=words(E.VD102C_SERVED);
const LCC="oracle:fa-esms-saasfaukgovprod1~ocs~CX_1";
// A count answer: {total} read from rows, or the uncarried answer (the tokens in unknownCompanies, read from no row).
// A name the catalogue lacks is looked up (resolved or unresolved) or, past the fifth, not looked up: every one is uncarried.
const arr=(x)=>(Array.isArray(x)?x:[]);
const notCarried=(j)=>new Set([...arr(j&&j.unknownCompanies),...arr(j&&j.companiesNotLookedUp),...arr(j&&j.companiesUnresolved).map((u)=>u&&u.asked),...arr(j&&j.companiesResolved).map((u)=>u&&u.asked)].filter((x)=>typeof x==="string"));
const count=(f)=>{const j=json(f);if(!j||typeof j!=="object"||typeof j.total!=="number")return null;return {total:j.total,uncarried:notCarried(j),jobs:Array.isArray(j.jobs)?j.jobs:null}};

// B1, B2
const jb=E.VD102C_JB||"",lf=E.VD102C_LF||"";
if(!jb)out("FAIL","B1 job-board preflight carries no x-fn-build (not deployed, or its preflight does not answer)");
else if(LIVE)out("PASS","B1 job-board x-fn-build = "+jb+" (job-board.2026-09-09.102 or later: the 44,499-board catalogue)");
else if(LFL)out("FAIL","B1 job-board x-fn-build = "+jb+", older than .102, while layoff-filings serves "+lf+": one paste ships both, so job-board did not deploy (over the raw-source cap the old bundle keeps serving)");
else out("INFO","B1 job-board x-fn-build = "+jb+": .102 is not serving yet, so every line below that judges .102 waits for it");
if(!lf)out("FAIL","B2 layoff-filings preflight carries no x-fn-build (not deployed, or its preflight does not answer)");
else if(LFL)out("PASS","B2 layoff-filings x-fn-build = "+lf+" (layoff-filings.2026-11-11.1 or later: its copy of the 44,499-board catalogue)");
else if(LIVE)out("FAIL","B2 layoff-filings x-fn-build = "+lf+", older than 2026-11-11.1, while job-board .102 serves: its catalogue copy is not the one .102 carries");
else out("INFO","B2 layoff-filings x-fn-build = "+lf+": 2026-11-11.1 ships with job-board .102");

// The build clock, and the state this section keeps.
const st=json("/tmp/vd_102c_status.json");const ok=!!st&&typeof st==="object"&&"catalogSize" in st;
const ss=ok&&st.sliceStats&&typeof st.sliceStats==="object"?st.sliceStats:null;
const serving=jb.replace(/^job-board\./,"");const ours=LIVE&&!!ss&&ss.build===serving;
const since=ours?Date.parse(ss.buildSince||""):NaN;const ageH=Number.isFinite(since)?(now-since)/3600000:null;
if(LIVE&&!ours)out("INFO","status.sliceStats.build is "+(ss?ss.build:"(none)")+", not the serving "+serving+": no slice of this build has run, so the lines on the build clock wait");
const due24=ageH!==null&&ageH>24;
const waitWhy=()=>ours?"first slice "+ageH.toFixed(1)+" h ago; FAIL after 24 h":"no slice of this build yet";
const SF=E.VD102C_STATE;let state=json(SF);if(!state||typeof state!=="object"||Array.isArray(state))state={};
const save=()=>{try{fs.mkdirSync(path.dirname(SF),{recursive:true});fs.writeFileSync(SF,JSON.stringify(state,null,1)+"\n");return true}catch(e){out("INFO","the state file "+SF+" could not be written ("+String(e&&e.message||e).slice(0,80)+")");return false}};

// H
let migratedSeen=false;
if(!ok)out("FAIL","H status is unreadable: "+peek("/tmp/vd_102c_status.json"));
else{
  const size=st.catalogSize,mark=typeof st.catalogHighwater==="number"?st.catalogHighwater:null,blocked=st.orphanPruneBlocked;
  const said="catalogSize "+size+", catalogHighwater "+mark+", orphanPruneBlocked "+blocked;
  if(!LIVE)out("INFO","H "+said+" on "+(st.version||jb)+": .102 carries "+CATALOGUE+" boards, and 20261111120000 moves the mark to it after .102 serves");
  else if(serving==="2026-09-09.102"&&size!==CATALOGUE)out("FAIL","H the serving bundle carries "+size+" boards, not the "+CATALOGUE+" of .102 ("+said+")");
  else if(serving!=="2026-09-09.102"&&mark!==null&&!(blocked===false&&mark===size))out("INFO","H "+said+" on "+serving+", a build after .102: its catalogue may differ, so the mark is section 49\x27s to judge");
  else if(mark===null)out("INFO","H "+said+": no high-water row, so nothing blocks the prune and the next pass end writes one");
  else if(blocked===false&&mark===size){out("PASS","H "+said+": the prune runs at the next pass end");migratedSeen=true;}
  else if(blocked===false)out("INFO","H "+said+": the mark is below the catalogue, and the next pass end raises it to "+size);
  else if(due24)out("FAIL","H "+said+" "+ageH.toFixed(1)+" h after .102 first sliced: the prune is blocked, so every retired board keeps serving to its 30-day age-out. 20261111120000 has not applied, or applied while .101 served and its pass end raised the mark back: apply it again");
  else out("INFO","H "+said+": 20261111120000 has not applied yet (it runs after .102 serves; "+waitWhy()+")");
}
const atEnv=Date.parse(E.VD102C_MIGRATED_AT||"");
if(migratedSeen&&!state.migratedSeenAt){state.migratedSeenAt=new Date(now).toISOString();state.build=serving;save();}
const migAt=Number.isFinite(atEnv)?atEnv:Date.parse(state.migratedSeenAt||"");
const pe=ok&&st.passEnd&&typeof st.passEnd==="object"?st.passEnd:null;const serve=pe&&pe.steps&&pe.steps.serve;
const serveAt=serve&&serve.doneAt?Date.parse(serve.doneAt):NaN;
const pruned=LIVE&&Number.isFinite(migAt)&&!!pe&&pe.build===serving&&Number.isFinite(serveAt)&&serveAt>migAt;
const pruneWhy=!LIVE?"not .102 yet":!Number.isFinite(migAt)?"20261111120000 has not been seen applied yet (H)":"no pass-end serve step of "+serving+" has finished since "+new Date(migAt).toISOString()+(Number.isFinite(atEnv)?" (VD102C_MIGRATED_AT)":" (first seen applied)")+"; the last finished "+(serve&&serve.doneAt?serve.doneAt+" on "+(pe&&pe.build):"never");
const pruneSaid=pruned?"after the pass-end serve step of "+serve.doneAt+" ("+String(serve.detail||"").slice(0,80)+")":"";

// R1: five calls of at most five tokens, read together.
const GF=fs.readdirSync("/tmp/").filter((f)=>/^vd_102c_gone_\d+\.json$/.test(f)).sort().map((f)=>"/tmp/"+f);
const GP=GF.map(count),G=GP.length&&GP.every(Boolean)?{total:GP.reduce((n,g)=>n+g.total,0),uncarried:new Set(GP.flatMap((g)=>[...g.uncarried]))}:null;
if(!G)out("FAIL","R1 a list scoped to the retired tokens is unreadable ("+GF.length+" call(s)): "+peek(GF[GP.findIndex((g)=>!g)]||"/tmp/vd_102c_gone_0.json"));
else{const carried=GONE.filter((k)=>!G.uncarried.has(tok(k)));
  if(!carried.length)out(LIVE?"PASS":"INFO","R1 the serving catalogue carries none of the 24 retired tokens: lists scoped to them, five a call, name each as a board the catalogue lacks"+(LIVE?"":" (before .102, which should not happen)"));
  else if(LIVE)out("FAIL","R1 the serving catalogue still carries "+carried.length+" retired key(s): "+carried.slice(0,6).join(", ")+(carried.length>6?" ...":""));
  else out("INFO","R1 "+(st&&st.version||jb)+" still carries "+carried.length+" of the 24 retired tokens, which serve "+G.total+" row(s) today; .102 drops them");}

// R2, and the retired twins of T
const C=json("/tmp/vd_102c_curve.json");let open=null;
if(!Array.isArray(C))out("FAIL","R2 get_company_fill_curve is unreadable: "+peek("/tmp/vd_102c_curve.json"));
else{open=new Map(C.filter((r)=>r&&typeof r.company_token==="string").map((r)=>[r.company_token,Number(r.open_roles)]));
  const absent=GONE.filter((k)=>!open.has(tok(k))||!Number.isFinite(open.get(tok(k))));
  if(absent.length){out("FAIL","R2 get_company_fill_curve answered "+C.length+" row(s) for the 24 retired tokens and none (or no open_roles) for: "+absent.slice(0,6).join(", ")+": it answers one row per token asked, so a board that kept its rows could hide behind this");open=null;}
  else{const left=GONE.filter((k)=>open.get(tok(k))>0),sum=left.reduce((n,k)=>n+open.get(tok(k)),0);
    const named=left.map((k)=>k+" "+open.get(tok(k))).slice(0,8).join(", ")+(left.length>8?" ...":"");
    if(!LIVE||!pruned)out("INFO","R2 the 24 retired tokens serve "+sum+" open row(s) on "+left.length+" board(s)"+(left.length?" ("+named+")":"")+"; judged once the prune runs: "+pruneWhy);
    else if(!left.length){const pre=state.prePaste&&state.prePaste.gone;const preSum=pre?Object.values(pre).reduce((n,v)=>n+(Number(v)||0),0):null;
      out("PASS","R2 the 24 retired tokens serve 0 open rows "+pruneSaid+(preSum!==null?" (they served "+preSum+" before the paste)":""));}
    else out("FAIL","R2 "+sum+" open row(s) of "+left.length+" retired board(s) still serve "+pruneSaid+": "+named+" (the orphan prune keys on the token; is status.orphanPruneBlocked true, or did the serve step skip the prune?)");}}
// R3
const H3=count("/tmp/vd_102c_helsing.json");
if(!H3)out("FAIL","R3 the pinpoint:helsing list is unreadable: "+peek("/tmp/vd_102c_helsing.json"));
else if(H3.uncarried.has("helsing"))out("FAIL","R3 the serving catalogue carries no helsing board at all: greenhouse:helsing, Helsing\x27s own board, must stay");
else if(H3.total===0)out("INFO","R3 pinpoint:helsing serves 0 rows by its vendor; it served 0 before the paste too, so this guards only");
else if(pruned||due24)out("FAIL","R3 pinpoint:helsing still serves "+H3.total+" row(s) by its vendor"+(pruned?" "+pruneSaid:" 24 h after .102 first sliced")+": its token stays carried by greenhouse, so only the retired-twin arm takes them");
else out("INFO","R3 pinpoint:helsing serves "+H3.total+" row(s) by its vendor; "+(LIVE?waitWhy():"not .102 yet"));

// T
const kept=KEPT.map((k,i)=>({k,b:GONE[6+i],c:count("/tmp/vd_102c_kept_"+(i+1)+".json")}));
const pre=state.prePaste&&state.prePaste.kept||{};
kept.forEach(({k,b,c})=>{
  const bo=open?open.get(tok(b)):null;
  if(!c){out("FAIL","T "+k+": the kept twin\x27s count is unreadable: "+peek("/tmp/vd_102c_kept_"+(KEPT.indexOf(k)+1)+".json"));return}
  if(bo===null||bo===undefined){out("INFO","T "+b+" -> "+k+": the retired twin\x27s rows cannot be counted (R2)");return}
  if(!LIVE||!pruned)out("INFO","T "+b+" serves "+bo+" open row(s) beside its twin "+k+" ("+c.total+"); judged once the prune runs: "+pruneWhy);
  else if(bo===0)out("PASS","T "+b+" serves 0 open rows "+pruneSaid+", so none of its postings is listed twice beside "+k+" ("+c.total+")");
  else out("FAIL","T "+b+" still serves "+bo+" open row(s) "+pruneSaid+", each one listed twice beside its twin "+k);
});
{const lcc=kept.find((x)=>x.k===LCC);const envPre=Number(E.VD102C_LCC_PRE);const p=E.VD102C_LCC_PRE&&Number.isFinite(envPre)?envPre:Number.isFinite(Number(pre[LCC]))?Number(pre[LCC]):null;
  if(lcc&&lcc.c){
    if(!LIVE)out("INFO","T "+LCC+" (LCC) serves "+lcc.c.total+" row(s) today; after the paste it keeps at least 90% of the count saved before it");
    else if(p===null||p<=0)out("INFO","T "+LCC+" (LCC) serves "+lcc.c.total+" row(s), and no count was saved before the paste (VD102C_LCC_PRE states one), so the 90% line is not judged");
    else if(!pruned)out("INFO","T "+LCC+" (LCC) serves "+lcc.c.total+" of the "+p+" saved before the paste; judged once the prune runs: "+pruneWhy);
    else if(lcc.c.total>=Math.ceil(0.9*p))out("PASS","T "+LCC+" (LCC) keeps "+lcc.c.total+" row(s) of the "+p+" saved before the paste (at least 90%) "+pruneSaid);
    else out("FAIL","T "+LCC+" (LCC) serves "+lcc.c.total+" row(s), under 90% of the "+p+" saved before the paste, "+pruneSaid+": the retired twin took the kept twin\x27s postings with it");}
  const rest=kept.filter((x)=>x.k!==LCC&&x.c).map((x)=>x.k+" "+x.c.total+(Number.isFinite(Number(pre[x.k]))?" (saved "+pre[x.k]+")":""));
  if(rest.length)out("INFO","T the other kept twins serve: "+rest.join(", "));}
// Before the paste, save what the paste is judged against.
if(!LIVE&&open&&kept.every((x)=>x.c)){
  state.prePaste={at:new Date(now).toISOString(),build:serving,kept:Object.fromEntries(kept.map((x)=>[x.k,x.c.total])),gone:Object.fromEntries(GONE.map((k)=>[k,open.get(tok(k))]))};
  if(save())out("INFO","T saved the kept twins\x27 counts and the retired boards\x27 rows before the paste to "+SF+" (LCC "+state.prePaste.kept[LCC]+")");}

// A
const readSince=(rows)=>{const t=(rows||[]).map((r)=>Date.parse((r&&r.recheckedAt)||"")).filter(Number.isFinite);return t.length>0&&Number.isFinite(since)&&Math.min(...t)>=since};
LAB.forEach((k,i)=>{
  const c=count("/tmp/vd_102c_ag_"+(i+1)+".json"),u=count("/tmp/vd_102c_agx_"+(i+1)+".json");
  if(!c||!u||!u.jobs){out("FAIL","A "+k+": the list is unreadable: "+peek("/tmp/vd_102c_ag_"+(i+1)+".json")+" / "+peek("/tmp/vd_102c_agx_"+(i+1)+".json"));return}
  if(c.uncarried.has(tok(k))){out(LIVE?"FAIL":"INFO","A "+k+": the serving catalogue does not carry it (unknownCompanies), and OD1 labels it rather than retiring it");return}
  if(!LIVE){out("INFO","A "+k+" serves "+c.total+" row(s), "+u.total+" without the agency flag; .102 labels the board");return}
  if(c.total===0){out("INFO","A "+k+" serves no row, so its label is not judged");return}
  if(u.total===0){out("PASS","A "+k+": all "+c.total+" served row(s) carry agency true (excludeAgencies serves none)");return}
  const read=readSince(u.jobs);
  if(read||due24)out("FAIL","A "+k+": "+u.total+" of "+c.total+" served row(s) carry no agency flag "+(read?"though this build read the board":"24 h after .102 first sliced"));
  else out("INFO","A "+k+": "+u.total+" of "+c.total+" row(s) carry no agency flag yet; the board has not been read by this build ("+waitWhy()+")");
});

// D, C
SERVED.forEach((k,i)=>{
  const id=k.startsWith("workday:")?"C":"D",c=count("/tmp/vd_102c_served_"+(i+1)+".json");
  if(!c){out("FAIL",id+" "+k+": the count is unreadable: "+peek("/tmp/vd_102c_served_"+(i+1)+".json"));return}
  const un=c.uncarried.has(tok(k));
  if(!LIVE){out("INFO",id+" "+k+(un?" is not carried before .102":" serves "+c.total+" row(s) before .102")+"; .102 carries it");return}
  if(un)out("FAIL",id+" "+k+": the serving catalogue does not carry it (unknownCompanies names it)");
  else if(c.total>0)out("PASS",id+" "+k+" serves "+c.total+" row(s) under its new key");
  else if(due24)out("FAIL",id+" "+k+" serves no row 24 h after .102 first sliced: the board has not been read, or its feed is not the one the repoint names");
  else out("INFO",id+" "+k+" serves no row yet ("+waitWhy()+")");
});
'
