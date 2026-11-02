# shellcheck shell=bash
# ── 99zzzz. THE FREE-SCAN WAVE, ENGINE HALF (register S13/S10, 2026-11-01).
#
# THE CLAIMS, one line each below:
#   - free-keyword-scan, free-keyword-scan-stream and parse-docx serve
#     2026-11-01.1 or a later build, so a production still serving the
#     previous bundles FAILs;
#   - 20261101100000 (S13-050) landed: get_public_scan_insights answers with
#     scorer 'primary' and an 'excluded' count of fallback-scanner and
#     rule-based scans, and publishes no software_engineering industry beside
#     technology;
#   - 20261101110000 (S13-080) landed: log_seniority_correction answers the
#     publishable key (a refused correction, mid to mid, comes back false: the
#     function ran and refused before spending its budget or writing), and
#     seniority_corrections refuses anon by name (42501), where RLS alone held
#     it before;
#   - the census still reports no allowlisted function uncallable and no
#     closed table open;
#   - the report's new fields (resumeTruncated, languageNotice,
#     rewriteTemplate, scoreProjection) and the Word-bullet reading need a
#     scan or an upload: INFO, proven by the builds and their tests.
#
# READ-ONLY. OPTIONS preflights run no function logic. Two anon RPC reads
# (get_public_scan_insights, client_callable_census: aggregates and catalogue
# counts). log_seniority_correction is asked with a GET, which PostgREST runs
# in a READ ONLY transaction, with two equal levels the function refuses
# before it touches a table: had the validation regressed, the budget's
# insert would fail in the read-only transaction (25006), never write. One
# anon table read selecting one named column. No scan, upload or checkout.
echo "INFO  == 99zzzz. free-scan wave, engine: builds, one scorer's benchmark, the level correction within a budget =="

vdfse_build() { # $1 fn -> the preflight's x-fn-build header
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}
for FN in free-keyword-scan free-keyword-scan-stream parse-docx; do
  H=$(vdfse_build "$FN")
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (not reachable, or the previous bundle is still serving)"
  elif build_ge "$FN" "$H" 2026-11-01 1; then echo "PASS  $FN preflight x-fn-build = $H ($FN.2026-11-01.1 or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-11-01.1 or later: the previous bundle is still serving)"; fi
done
echo "INFO  the free report's resumeTruncated, languageNotice, weakestBullets[].rewriteTemplate and scoreProjection need a scan; src/test/the-free-scan-reads-the-whole-resume-and-says-what-it-could-not.test.ts runs the shipped handler"
echo "INFO  Word's bullet button read as bullets needs an upload; src/test/word-bullets-are-bullets-in-the-text-the-scanner-reads.test.ts and supabase/functions/parse-docx/docx_test.ts run it on built documents"

# 20261101100000. Before it, the answer has no scorer and no exclusion counts.
INS_FSE=$(R get_public_scan_insights)
VD_BODY="$INS_FSE" node -e '
const ok=(c,m)=>console.log((c?"PASS  ":"FAIL  ")+m);
let r=null;try{r=JSON.parse(process.env.VD_BODY||"")}catch{}
if(!r||typeof r!=="object"||Array.isArray(r)){ok(false,"get_public_scan_insights as anon -> "+String(process.env.VD_BODY||"").slice(0,200));process.exit(0)}
const ex=r.excluded;
ok(r.scorer==="primary"&&ex&&typeof ex==="object"&&Number.isFinite(ex.fallback_scanner)&&Number.isFinite(ex.rule_based_report),
  "the score benchmark is the primary scanner'"'"'s, and says what it left out: scorer="+JSON.stringify(r.scorer)+", excluded="+JSON.stringify(ex)+" (20261101100000, S13-050)");
const ind=Array.isArray(r.industries)?r.industries.map((i)=>i&&i.industry):null;
if(!ind)ok(false,"get_public_scan_insights carries no industries list: "+JSON.stringify(r).slice(0,160));
else if(!ind.length)console.log("INFO  the benchmark publishes no industry yet (none has 25 primary-scanner scans), so one vocabulary cannot be judged");
else ok(!ind.includes("software_engineering"),"the benchmark lists technology once, with no software_engineering beside it: "+ind.join(", "));'

# 20261101110000. A GET runs read-only; mid -> mid is refused before the budget.
LSC_FSE=$(curl -s -m 30 "$B/rest/v1/rpc/log_seniority_correction?p_detected_level=mid&p_corrected_level=mid" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$LSC_FSE" in
  false) echo "PASS  log_seniority_correction answers the publishable key and refuses a correction to the level detected before spending or writing (false): 20261101110000 applied (S13-080)";;
  true) echo "FAIL  log_seniority_correction accepted mid -> mid: its validation is not the shipped one";;
  *'"42501"'*|*'permission denied'*) echo "FAIL  log_seniority_correction as anon -> 42501: 20261101110000 has not applied, so the report's level control still records nothing";;
  *'25006'*|*'read-only transaction'*) echo "FAIL  log_seniority_correction reached a write before refusing mid -> mid (25006 in the read-only GET): the validation does not run first";;
  *'PGRST202'*) echo "FAIL  log_seniority_correction not found (PGRST202)";;
  *) echo "FAIL  log_seniority_correction GET -> ${LSC_FSE:0:160}";;
esac
SC_FSE=$(curl -s -m 30 "$B/rest/v1/seniority_corrections?select=id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$SC_FSE" in
  *'"42501"'*|*'permission denied'*) echo "PASS  seniority_corrections refuses anon by name (42501): the table is closed and only the function writes it";;
  '[]') echo "FAIL  seniority_corrections answered anon with an empty list: RLS alone holds it, 20261101110000's revoke has not applied";;
  '['*) echo "FAIL  seniority_corrections answered anon with rows: ${SC_FSE:0:120}";;
  *) echo "FAIL  seniority_corrections as anon -> ${SC_FSE:0:160}";;
esac

CEN_FSE=$(R client_callable_census)
VD_BODY="$CEN_FSE" node -e '
const ok=(c,m)=>console.log((c?"PASS  ":"FAIL  ")+m);
let c=null;try{c=JSON.parse(process.env.VD_BODY||"")}catch{}
if(!c||typeof c!=="object"||Array.isArray(c)||!("allowlisted" in c)){ok(false,"client_callable_census as anon -> "+String(process.env.VD_BODY||"").slice(0,200));process.exit(0)}
ok(Array.isArray(c.allowlisted_not_callable)&&c.allowlisted_not_callable.length===0&&Array.isArray(c.closed_tables_still_open)&&c.closed_tables_still_open.length===0,
  "the census: "+c.allowlisted+" allowlisted; uncallable "+JSON.stringify(c.allowlisted_not_callable)+", closed tables open "+JSON.stringify(c.closed_tables_still_open)+" (want both empty)");'
