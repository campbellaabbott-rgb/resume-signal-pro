# shellcheck shell=bash
# ── 72. WAVE 3, SCAN + AI (S8 debug sweep 2026-10-08, fix_group scan-ai; owner
# decision 1 of 2026-10-08). Deploy note: docs/wave3/scan-ai.md.
#
# THE CLAIMS, one line each below:
#   - every changed function serves its 2026-10-09 build (or later);
#   - 20261009111000 landed: shortlist_candidates has jd_text_scored and is
#     closed to anon, and shortlist_decide exists and refuses anon by name;
#   - 20261009110000 (the limiter's sweep) cannot be observed read-only: INFO;
#   - the homepage a crawler reads says a rescan repeats the report only
#     within the 7-day cache, and states one time to results; llms.txt too;
#   - the browser's bundle: the value table prices the Full Analysis, the
#     verdict labels and the crash notice exist, the resetting countdown key
#     is gone; the free report has no "Premium Only" stack; the Why-not-ChatGPT
#     card names the cache window; the Shortlist page decides through
#     shortlist_decide.
#
# READ-ONLY. OPTIONS preflights run no function logic. One anon table read
# (select of one named column, limit 1) and one anon RPC whose arguments raise
# before any table is touched even if its grant had not landed (an unknown
# action). Crawler-UA GETs of the homepage and llms.txt, and GETs of the
# public JS bundle. No scan, generator, checkout or Shortlist call is made.
echo "== 72. wave 3 scan + AI: redaction, honest offers, one time to results, translated verdicts, whole reports, Shortlist evidence =="

vd72_build() { # $1 fn -> the preflight's x-fn-build header
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}
for PAIR in \
  "free-keyword-scan|1" "free-keyword-scan-stream|1" "shortlist-evaluate|2" \
  "generate-application-answers|1" "generate-apply-package|1" "generate-ats-defense|1" \
  "generate-career-path|1" "generate-career-snapshot|1" "generate-cover-letter|1" \
  "generate-cover-letter-stream|1" "generate-graduate-gameplan|1" "generate-interview-coach|1" \
  "generate-keyword-fix|1" "generate-premium-package|1" "generate-premium-package-stream|1" \
  "generate-product-preview|1"; do
  FN=${PAIR%%|*}; N=${PAIR#*|}
  H=$(vd72_build "$FN")
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (not reachable, or a bundle older than build stamps)"
  elif build_ge "$FN" "$H" "2026-10-09" "$N"; then echo "PASS  $FN preflight x-fn-build = $H ($FN.2026-10-09.$N or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-10-09.$N or later: the previous bundle is still serving)"; fi
done

# 20261009111000. A named column the table lacks fails before the permission
# check, so one read tells all three states apart.
SL72=$(curl -s -m 30 "$B/rest/v1/shortlist_candidates?select=jd_text_scored&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$SL72" in
  *'"42501"'*|*'permission denied'*) echo "PASS  shortlist_candidates has jd_text_scored and refuses anon (42501): 20261009111000 applied (S8-041, S8-110)";;
  *'42703'*|*'does not exist'*|*'PGRST204'*) echo "FAIL  shortlist_candidates.jd_text_scored does not exist: 20261009111000 has not applied";;
  '[]'|'['*) echo "FAIL  shortlist_candidates answered anon with rows or an empty list: the table grants were not revoked";;
  *) echo "FAIL  shortlist_candidates as anon -> ${SL72:0:160}";;
esac
SD72=$(R shortlist_decide '{"p_candidate_id":"00000000-0000-4000-8000-000000000000","p_action":"verify-deploy-probe","p_reason":null}')
SD72C=$(printf '%s' "$SD72" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$SD72C" in
  42501) echo "PASS  shortlist_decide exists and refuses anon by name (42501): a decision and its status are one transaction (S8-041)";;
  PGRST202) echo "FAIL  shortlist_decide not found (PGRST202): 20261009111000 has not applied, and the new Shortlist page cannot record a decision";;
  22023) echo "FAIL  shortlist_decide ran for anon (it refused the probe's action): EXECUTE was not revoked from anon";;
  *) echo "FAIL  shortlist_decide as anon -> $SD72C $(printf '%s' "$SD72" | head -c 160) (want 42501)";;
esac
echo "INFO  20261009110000 (check_rate_limit sweeps only rows older than 1,440 minutes, S8-011) writes on every call, so it is not called here; its DO block checks the live body at apply time and src/test/a-day-allowance-the-limiter-sweeps-is-an-hour.test.ts runs it in pglite"

# The homepage and llms.txt as a crawler reads them.
HOME72=$(curl -s -m 30 -A "$UA" "$SITE/")
if printf '%s' "$HOME72" | grep -qF "Same document, same score"; then echo "FAIL  / (crawler) still promises \"Same document, same score, every time\": the prerender with this wave is not published"
elif printf '%s' "$HOME72" | grep -qF "within 7 days and you get the same report"; then echo "PASS  / (crawler) says a rescan of the same file within 7 days returns the same report (the report cache)"
else echo "FAIL  / (crawler) carries neither reproducibility sentence (the prerender's hero moved?)"; fi
SECS72=$(printf '%s' "$HOME72" | grep -oE '[0-9]+ seconds' | sort -u | tr '\n' ' ')
case "$SECS72" in
  "90 seconds ") echo "PASS  / (crawler) states one time to results: within 90 seconds (SCAN_RESULTS_WITHIN_SECONDS)";;
  "") echo "INFO  / (crawler) states no time to results";;
  *) echo "FAIL  / (crawler) states these durations: $SECS72(want only 90 seconds)";;
esac
LLMS72=$(curl -s -m 30 -A "$UA" "$SITE/llms.txt")
if printf '%s' "$LLMS72" | grep -qF "same document → same report ID"; then echo "FAIL  llms.txt still says \"reproducible (same document → same report ID)\" with no cache window"
elif printf '%s' "$LLMS72" | grep -qF "within 7 days returns the same report"; then echo "PASS  llms.txt: a rescan of the same file within 7 days returns the same report"
else echo "FAIL  llms.txt carries neither sentence (${#LLMS72} bytes)"; fi

# The bundle the browser loads.
MAIN72=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
MAINB72=$( [ -n "$MAIN72" ] && curl -s -m 60 "$SITE$MAIN72" )
EN72=""
for CAND in main $(printf '%s' "$MAINB72" | grep -o '"\./en-[A-Za-z0-9_-]*\.js"' | tr -d '"' | sed 's|^\./||' | sort -u); do
  if [ "$CAND" = main ]; then BODY72=$MAINB72; else BODY72=$(curl -s -m 30 "$SITE/assets/$CAND"); fi
  printf '%s' "$BODY72" | grep -q "timeToResults" || continue
  EN72=$BODY72; break
done
if [ -z "$EN72" ]; then
  echo "FAIL  could not find the English strings the browser loads (frontend not published, or the bundle layout moved)"
else
  if printf '%s' "$EN72" | grep -qF '$5 – $25 one-time'; then echo "FAIL  the value table still prices us at a typed \"\$5 – \$25 one-time\": the frontend with this wave is not published"
  elif printf '%s' "$EN72" | grep -qF 'Free scan · Full Analysis'; then echo "PASS  the value table names the Full Analysis price checkout charges"
  else echo "FAIL  the value table's cost line is neither the old range nor the new price"; fi
  for PAIR in "careerReportEnum|verdict labels in the reader's language from the English values (S8-034)" \
              "reportCrash|the report's crash notice says to scan again (S8-117)" \
              "fullAnalysisDesc|the free report's two honest offers (owner decision 1)"; do
    S=${PAIR%%|*}; WHY=${PAIR#*|}
    if printf '%s' "$EN72" | grep -qF "$S"; then echo "PASS  English strings carry $S: $WHY"
    else echo "FAIL  English strings lack $S: $WHY -- the frontend with this wave is not published"; fi
  done
  if printf '%s' "$EN72" | grep -qF "resultsExpiry"; then echo "FAIL  English strings still carry resultsExpiry (the resetting \"saved for N more hours\" countdown)"
  else echo "PASS  the resetting results countdown is gone from the English strings"; fi
fi
IDX72=$(printf '%s' "$MAINB72" | grep -o '\./Index-[A-Za-z0-9_-]*\.js' | head -1)
if [ -z "$IDX72" ]; then echo "FAIL  the main bundle names no Index chunk (frontend layout moved)"
else
  IDXB72=$(curl -s -m 30 "$SITE/assets/${IDX72#./}")
  if printf '%s' "$IDXB72" | grep -qF "reproducible on rescan"; then echo "FAIL  the Why-not-ChatGPT card still promises a score reproducible on any rescan"
  elif printf '%s' "$IDXB72" | grep -qF "days returns the same report"; then echo "PASS  the Why-not-ChatGPT card names the report cache's window"
  else echo "FAIL  the Why-not-ChatGPT card carries neither sentence"; fi
  FKR72=$(printf '%s' "$IDXB72" | grep -o '\./FreeKeywordResults-[A-Za-z0-9_-]*\.js' | head -1)
  if [ -z "$FKR72" ]; then echo "FAIL  the Index chunk names no FreeKeywordResults chunk"
  else
    FKRB72=$(curl -s -m 30 "$SITE/assets/${FKR72#./}")
    if printf '%s' "$FKRB72" | grep -qF "Premium Only"; then echo "FAIL  the free report still shows the invented \"Premium Only\" issues"
    elif printf '%s' "$FKRB72" | grep -qF "report-next-steps"; then echo "PASS  the free report ends in one Next steps section with the two offers, no \"Premium Only\" stack"
    else echo "FAIL  the free report chunk has neither the old stack nor the Next steps section"; fi
  fi
fi
SLC72=$(printf '%s' "$MAINB72" | grep -o '\./Shortlist-[A-Za-z0-9_-]*\.js' | head -1)
if [ -z "$SLC72" ]; then echo "INFO  the main bundle names no Shortlist chunk (layout moved); the pglite test proves the database half"
elif curl -s -m 30 "$SITE/assets/${SLC72#./}" | grep -qF "shortlist_decide"; then echo "PASS  the Shortlist page records a decision through shortlist_decide"
else echo "FAIL  the Shortlist page still writes the decision and the status in two unchecked calls"; fi
