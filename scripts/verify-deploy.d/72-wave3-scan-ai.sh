# shellcheck shell=bash
# ── 72. WAVE 3, SCAN + AI (S8 debug sweep 2026-10-08, fix_group scan-ai; owner
# decision 1 of 2026-10-08). Deploy note: docs/wave3/scan-ai.md.
#
# THE CLAIMS, one line each below:
#   - every changed function serves its own build or a later one: 2026-10-09.N,
#     or 2026-10-10.3 for the five main re-stamped 2026-10-10.1 (PR #25; the wave 3
#     integration build, above scan-ai's and agents-api's 10-10.2), so a
#     production serving main's build without this wave's changes FAILs;
#   - 20261009111000 landed: shortlist_candidates has jd_text_scored, and
#     shortlist_decide exists and refuses anon by name; 20261009112000 (the
#     lockdown, held until the new function and page serve, S11-056) closes
#     the table to anon: INFO while the ledger holds it, FAIL once released;
#   - 20261009110000 (the limiter's sweep) cannot be observed read-only: INFO;
#     nor can 20261009111000's decision stamp (it fires on an insert): INFO;
#   - the homepage a crawler reads says a rescan of the same file against the
#     same posting repeats the report within the 7-day cache, and states one
#     time to results; llms.txt too; an industry page states the same bound;
#   - /resume-score as a crawler reads it states the same bound and names the
#     cache window beside its report-ID promise;
#   - the browser's bundle: the value table prices the Full Analysis, the
#     verdict labels and the crash notice exist, the crash notice offers
#     Re-analyze, the partial banner names its reason, the resetting
#     countdown key is gone; the free report has no "Premium Only" stack; the Why-not-ChatGPT
#     card names the cache window; the Shortlist page decides through
#     shortlist_decide; the "auto-rejected" Premium card under the report and
#     the sticky bar's "$3 premium packages" are gone (review round 2);
#   - the Apply kit's Pro bound and the redaction shapes need a signed-in or
#     employer call: INFO, proven by the builds and their tests.
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
  "free-keyword-scan|2026-10-09|5" "free-keyword-scan-stream|2026-10-09|5" "shortlist-evaluate|2026-10-10|62" \
  "generate-application-answers|2026-10-10|62" "generate-apply-package|2026-10-09|62" "generate-ats-defense|2026-10-09|3" \
  "generate-career-path|2026-10-09|4" "generate-career-snapshot|2026-10-10|4" "generate-cover-letter|2026-10-09|62" \
  "generate-cover-letter-stream|2026-10-09|3" "generate-graduate-gameplan|2026-10-10|4" "generate-interview-coach|2026-10-09|4" \
  "generate-keyword-fix|2026-10-09|3" "generate-premium-package|2026-10-09|62" "generate-premium-package-stream|2026-10-09|3" \
  "generate-product-preview|2026-10-10|4" \
  "parse-pdf|2026-10-09|1" "parse-docx|2026-10-09|1" "parse-resume-structured|2026-10-09|2" \
  "analyze-linkedin-profile|2026-10-09|2" "generate-freelance-boost|2026-10-09|2" "generate-resume-roast|2026-10-09|2" \
  "generate-elevator-pitch|2026-10-10|3" "generate-recruiter-view|2026-10-10|3" "generate-summary|2026-10-10|3" \
  "generate-tailored-resume|2026-10-10|3" "generate-tailored-resume-stream|2026-10-10|1" "import-freelance-profile|2026-10-10|3" \
  "test-ai-fallback|2026-10-09|2" \
  "job-fit|2026-10-09|3" "application-fit|2026-10-09|3"; do
  FN=${PAIR%%|*}; REST=${PAIR#*|}; DAY=${REST%%|*}; N=${REST#*|}
  H=$(vd72_build "$FN")
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (not reachable, or a bundle older than build stamps)"
  elif build_ge "$FN" "$H" "$DAY" "$N"; then echo "PASS  $FN preflight x-fn-build = $H ($FN.$DAY.$N or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.$DAY.$N or later: the previous bundle is still serving)"; fi
done
echo "INFO  generate-apply-package's Pro bound (60 kits an hour per account, 600 for all Pro accounts, 503 when the limiter is down) needs a signed-in Pro call; src/test/a-pro-accounts-apply-kits-had-no-bound-at-all.test.ts runs the shipped handler"
echo "INFO  shortlist-evaluate's redaction (letter-spaced, nicknamed and surname-first names; es/pt/de/fr/nl/in/au/jp contact shapes) needs an employer call; src/test/shortlist-redaction-passed-letter-spaced-nicknamed-and-surname-first-names-and-european-addresses.test.ts runs it on a generated PDF"

# 20261009111000. A named column the table lacks fails before the permission
# check, so one read tells all three states apart.
SL72=$(curl -s -m 30 "$B/rest/v1/shortlist_candidates?select=jd_text_scored&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
# 20261009112000 is held in docs/deploy-ledger.json until shortlist-evaluate
# .2026-10-10.62 and the new Shortlist page serve (S11-056); while it is held,
# anon still reaches the table under RLS and reads an empty list.
HOLD72=$(node -e 'const j=JSON.parse(require("fs").readFileSync("docs/deploy-ledger.json","utf8"));process.stdout.write((j.holdUntilVerified||[]).some(h=>h.stamp==="20261009112000")?"held":"released")' 2>/dev/null)
case "$SL72" in
  *'"42501"'*|*'permission denied'*) echo "PASS  shortlist_candidates has jd_text_scored and refuses anon (42501): 20261009111000 and 20261009112000 applied (S8-041, S8-110)";;
  *'42703'*|*'does not exist'*|*'PGRST204'*) echo "FAIL  shortlist_candidates.jd_text_scored does not exist: 20261009111000 has not applied";;
  '[]'|'['*) if [ "$HOLD72" = "held" ]; then echo "INFO  shortlist_candidates has jd_text_scored (20261009111000 applied); anon still reads an empty list under RLS because 20261009112000 is held until shortlist-evaluate .2026-10-10.62 and the new Shortlist page serve (S11-056)"
             else echo "FAIL  shortlist_candidates answered anon with rows or an empty list: 20261009112000 was released but its revoke has not applied"; fi;;
  *) echo "FAIL  shortlist_candidates as anon -> ${SL72:0:160}";;
esac
# A read-only GET, never a POST: shortlist_decide WRITES (a decision row and a
# status), and a POST would commit had its revoke regressed (S8-125, the rule
# section 63/65's probe follows). PostgREST runs a GET in a READ ONLY
# transaction; p_reason defaults to NULL, so the GET leaves it out.
SD72=$(curl -s -m 60 "$B/rest/v1/rpc/shortlist_decide?p_candidate_id=00000000-0000-4000-8000-000000000000&p_action=verify-deploy-probe" -H "apikey: $K" -H "Authorization: Bearer $K")
SD72C=$(printf '%s' "$SD72" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$SD72C" in
  42501) echo "PASS  shortlist_decide exists and refuses anon by name (42501): a decision and its status are one transaction (S8-041)";;
  PGRST202) echo "FAIL  shortlist_decide not found (PGRST202): 20261009111000 has not applied, and the new Shortlist page cannot record a decision";;
  22023|25006) echo "FAIL  shortlist_decide ran for anon ($SD72C: it refused the probe's action, or tried to write and only the read-only GET stopped it): EXECUTE was not revoked from anon";;
  *) echo "FAIL  shortlist_decide as anon -> $SD72C $(printf '%s' "$SD72" | head -c 160) (want 42501)";;
esac
echo "INFO  20261009110000 (check_rate_limit sweeps only rows older than 1,440 minutes, S8-011) writes on every call, so it is not called here; its DO block checks the live body at apply time and src/test/a-day-allowance-the-limiter-sweeps-is-an-hour.test.ts runs it in pglite"
echo "INFO  20261009112000's shortlist_decisions_stamp trigger (server clock and JWT actor; advance/reject only through shortlist_decide) fires on an insert, so it is not exercised here; its DO block checks the trigger at apply time and the pglite test runs it"

# The homepage and llms.txt as a crawler reads them.
HOME72=$(curl -s -m 30 -A "$UA" "$SITE/")
if printf '%s' "$HOME72" | grep -qF "Same document, same score"; then echo "FAIL  / (crawler) still promises \"Same document, same score, every time\": the prerender with this wave is not published"
elif printf '%s' "$HOME72" | grep -qF "against the same posting within 7 days and you get the same report"; then echo "PASS  / (crawler) says a rescan of the same file against the same posting within 7 days returns the same report (the report cache's key and window)"
elif printf '%s' "$HOME72" | grep -qF "Rescan the same file within 7 days"; then echo "FAIL  / (crawler) still promises the same report for the same file alone; the cache is keyed on the posting too (review round 2)"
else echo "FAIL  / (crawler) carries neither reproducibility sentence (the prerender's hero moved?)"; fi
SECS72=$(printf '%s' "$HOME72" | grep -oE '[0-9]+ seconds' | sort -u | tr '\n' ' ')
case "$SECS72" in
  "90 seconds ") echo "PASS  / (crawler) states one time to results: within 90 seconds (SCAN_RESULTS_WITHIN_SECONDS)";;
  "") echo "INFO  / (crawler) states no time to results";;
  *) echo "FAIL  / (crawler) states these durations: $SECS72(want only 90 seconds)";;
esac
LLMS72=$(curl -s -m 30 -A "$UA" "$SITE/llms.txt")
if printf '%s' "$LLMS72" | grep -qF "same document → same report ID"; then echo "FAIL  llms.txt still says \"reproducible (same document → same report ID)\" with no cache window"
elif printf '%s' "$LLMS72" | grep -qF "same job posting within 7 days returns the same report"; then echo "PASS  llms.txt: a rescan of the same file against the same job posting within 7 days returns the same report"
elif printf '%s' "$LLMS72" | grep -qF "same file within 7 days returns the same report"; then echo "FAIL  llms.txt promises the same report for the same file alone (the cache is keyed on the posting too)"
else echo "FAIL  llms.txt carries neither sentence (${#LLMS72} bytes)"; fi

# An industry page as a crawler reads it (its FAQ and FAQPage JSON-LD come from industry-faqs.ts).
IND72=$(curl -s -m 30 -A "$UA" "$SITE/industries/healthcare")
if printf '%s' "$IND72" | grep -qF "in about 20 seconds"; then echo "FAIL  /industries/healthcare (crawler) still says \"in about 20 seconds\": the prerender with this wave is not published"
elif printf '%s' "$IND72" | grep -qF "within 90 seconds"; then echo "PASS  /industries/healthcare (crawler) states the scan's bound: within 90 seconds"
else echo "FAIL  /industries/healthcare (crawler) states neither time (${#IND72} bytes)"; fi

# A tool landing as a crawler reads it (its meta description and FAQ come from tool-landings.ts).
RS72=$(curl -s -m 30 -A "$UA" "$SITE/resume-score")
if printf '%s' "$RS72" | grep -qF "in about 20 seconds"; then echo "FAIL  /resume-score (crawler) still says \"in about 20 seconds\": the prerender with this wave is not published"
elif printf '%s' "$RS72" | grep -qF "within 90 seconds"; then echo "PASS  /resume-score (crawler) states the scan's bound: within 90 seconds"
else echo "FAIL  /resume-score (crawler) states neither time (${#RS72} bytes)"; fi
if printf '%s' "$RS72" | grep -qF "Reproducible report ID"; then echo "FAIL  /resume-score (crawler) still promises a reproducible report ID with no window"
elif printf '%s' "$RS72" | grep -qE "same (file and )?posting within 7 days"; then echo "PASS  /resume-score (crawler) names the posting and the 7-day cache window beside the report ID"
elif printf '%s' "$RS72" | grep -qF "same file within 7 days"; then echo "FAIL  /resume-score (crawler) names the 7-day window but not the posting the cache is keyed on"
else echo "FAIL  /resume-score (crawler) carries neither report-ID sentence"; fi

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
              "fullAnalysisDesc|the free report's two honest offers (owner decision 1)" \
              "Re-analyze to scan again|the crash notice offers Re-analyze past the saved report (review of S8-117)" \
              "left some sections empty|the partial banner says a thin reply is not an outage (review of S8-067)"; do
    S=${PAIR%%|*}; WHY=${PAIR#*|}
    if printf '%s' "$EN72" | grep -qF "$S"; then echo "PASS  English strings carry $S: $WHY"
    else echo "FAIL  English strings lack $S: $WHY -- the frontend with this wave is not published"; fi
  done
  if printf '%s' "$EN72" | grep -qF "resultsExpiry"; then echo "FAIL  English strings still carry resultsExpiry (the resetting \"saved for N more hours\" countdown)"
  else echo "PASS  the resetting results countdown is gone from the English strings"; fi
  if printf '%s' "$EN72" | grep -qF "being auto-rejected"; then echo "FAIL  English strings still carry the \"auto-rejected\" Premium card shown under the report (review round 2)"
  else echo "PASS  the \"auto-rejected\" Premium card under the report is gone from the English strings"; fi
  if printf '%s' "$EN72" | grep -qF "Premium packages from"; then echo "FAIL  the sticky bar still says \"Premium packages from\" the hidden \$3 product"
  elif printf '%s' "$EN72" | grep -qF "Applies the fixes your free scan finds"; then echo "PASS  the sticky bar names the Full Analysis and what it does"
  else echo "FAIL  the sticky bar's line is neither the old nor the new one"; fi
fi
IDX72=$(printf '%s' "$MAINB72" | grep -o '\./Index-[A-Za-z0-9_-]*\.js' | head -1)
if [ -z "$IDX72" ]; then echo "FAIL  the main bundle names no Index chunk (frontend layout moved)"
else
  IDXB72=$(curl -s -m 30 "$SITE/assets/${IDX72#./}")
  if printf '%s' "$IDXB72" | grep -qF "reproducible on rescan"; then echo "FAIL  the Why-not-ChatGPT card still promises a score reproducible on any rescan"
  elif printf '%s' "$IDXB72" | grep -qF "against the same posting within"; then echo "PASS  the Why-not-ChatGPT card names the posting and the report cache's window"
  elif printf '%s' "$IDXB72" | grep -qF "days returns the same report"; then echo "FAIL  the Why-not-ChatGPT card names the window but not the posting the cache is keyed on"
  else echo "FAIL  the Why-not-ChatGPT card carries neither sentence"; fi
  FKR72=$(printf '%s' "$IDXB72" | grep -o '\./FreeKeywordResults-[A-Za-z0-9_-]*\.js' | head -1)
  if [ -z "$FKR72" ]; then echo "FAIL  the Index chunk names no FreeKeywordResults chunk"
  else
    FKRB72=$(curl -s -m 30 "$SITE/assets/${FKR72#./}")
    if printf '%s' "$FKRB72" | grep -qF "Premium Only"; then echo "FAIL  the free report still shows the invented \"Premium Only\" issues"
    elif printf '%s' "$FKRB72" | grep -qE "freeResults\.applyBridge|Prepare this exact application|productId:\"applyAssistant\""; then echo "FAIL  the free report still sells a third product: the \"Prepare this exact application\" card and its \$7 Apply Assistant checkout (review of the integration)"
    elif printf '%s' "$FKRB72" | grep -qF "report-next-steps"; then echo "PASS  the free report ends in one Next steps section with the two offers, no \"Premium Only\" stack and no Apply Assistant card"
    else echo "FAIL  the free report chunk has neither the old stack nor the Next steps section"; fi
  fi
fi
SLC72=$(printf '%s' "$MAINB72" | grep -o '\./Shortlist-[A-Za-z0-9_-]*\.js' | head -1)
if [ -z "$SLC72" ]; then echo "INFO  the main bundle names no Shortlist chunk (layout moved); the pglite test proves the database half"
elif curl -s -m 30 "$SITE/assets/${SLC72#./}" | grep -qF "shortlist_decide"; then echo "PASS  the Shortlist page records a decision through shortlist_decide"
else echo "FAIL  the Shortlist page still writes the decision and the status in two unchecked calls"; fi
