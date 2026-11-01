# shellcheck shell=bash
# ── 57. THE FULL ANALYSIS AND THE PAID WRITERS FINISH INSIDE THEIR TIME, AND THE
# ANALYSIS IS WRITTEN IN THE BUYER'S LANGUAGE (branch fix/full-analysis-timeout:
# S13-001, S10-009, S13-003, S13-052, S13-008, S13-064, S13-065, S12-147).
#
# THE CLAIMS, one line each below:
#   - the 23 functions whose bundles moved serve 2026-10-28.1 or later: the
#     Full Analysis in parallel parts with measured caps, a reply in the
#     buyer's language and caps grown for it (analyze-resume); a model that
#     timed out is not asked again, and a cut-off, empty or unreadable reply
#     goes to the next model (_shared/ai-fallback.ts, in every writer's
#     bundle); interview prep in two calls of seven (generate-interview-coach);
#     the paid writers inside one 125 s deadline (cover letter, premium
#     package, tailored résumé, ATS defense, freelance boost); a reply logged
#     by its shape, never its words (parse-resume-structured,
#     generate-apply-package, generate-tailored-resume); the preview's measured
#     cap and a diagnostic that passes only on written text
#     (generate-product-preview, test-ai-fallback); the whole résumé in a
#     tailored résumé; hidden posting text dropped where the HTML still is
#     (fetch-job-posting, and every writer that imports _shared/posting-text.ts);
#   - the published success page sends the page's language with each of its
#     three analyze-resume asks, and the report labels its fixed choices
#     through analysisResults.enum (S13-003, S13-052);
#   - the published English strings carry those labels.
# Not provable from outside, so proved in the suite (no model is ever called
# here): the language line every part reads, the caps and their factors,
# the next-model walks and deadlines, the log lines' shapes, the hidden-text
# drop on real-shaped pages, and the other eight locales' labels.
#
# READ-ONLY: OPTIONS preflights (no function logic runs) and GETs of the
# site's entry script and two of its chunks. Nothing is sent, bought or written.
echo "== 57. full analysis and paid writers in their time, the analysis in the buyer's language (2026-10-28.1) =="

vd57_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

for VD57_FN in analyze-resume fetch-job-posting generate-application-answers generate-apply-package generate-ats-defense generate-career-path generate-career-snapshot generate-cover-letter generate-cover-letter-stream generate-freelance-boost generate-graduate-gameplan generate-interview-coach generate-keyword-fix generate-premium-package generate-premium-package-stream generate-product-preview generate-recruiter-view generate-resume-roast generate-summary generate-tailored-resume import-freelance-profile parse-resume-structured test-ai-fallback; do
  VD57_H=$(vd57_build "$VD57_FN")
  if [ -z "$VD57_H" ]; then echo "FAIL  $VD57_FN preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
  elif build_ge "$VD57_FN" "$VD57_H" "2026-10-28" "1"; then echo "PASS  $VD57_FN x-fn-build = $VD57_H ($VD57_FN.2026-10-28.1 or later)"
  else echo "FAIL  $VD57_FN x-fn-build = $VD57_H, older than $VD57_FN.2026-10-28.1: this branch's change to it is not serving"; fi
done

# The published page: the entry names the Success chunk, which holds the
# report (AnalysisResults) and imports the English analysisResults strings.
VD57_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD57_MAINJS=""
[ -n "$VD57_MAIN" ] && VD57_MAINJS=$(curl -s -m 30 "$SITE$VD57_MAIN")
VD57_SUCC=$(printf '%s' "$VD57_MAINJS" | grep -o '"\./Success-[A-Za-z0-9_-]*\.js"' | head -1 | tr -d '"' | sed 's|^\./||')
if [ -z "$VD57_SUCC" ]; then
  echo "FAIL  the served entry (${VD57_MAIN:-none found}) names no Success chunk: the frontend is not serving, or the bundle layout moved, so the page's asks and labels cannot be judged"
else
  VD57_SJS=$(curl -s -m 30 "$SITE/assets/$VD57_SUCC")
  VD57_ASKS=$(printf '%s' "$VD57_SJS" | grep -o 'analyze-resume",{body:{[^}]*}' | wc -l | tr -d ' ')
  VD57_LANG=$(printf '%s' "$VD57_SJS" | grep -o 'analyze-resume",{body:{[^}]*}' | grep -c 'language:')
  if [ "$VD57_ASKS" = 0 ]; then echo "FAIL  the Success chunk ($VD57_SUCC) has no analyze-resume ask in the shape this line reads: the bundle layout moved"
  elif [ "$VD57_LANG" = "$VD57_ASKS" ] && [ "$VD57_ASKS" -ge 3 ]; then echo "PASS  the published success page sends the page's language with all $VD57_ASKS analyze-resume asks ($VD57_SUCC)"
  else echo "FAIL  the published success page sends a language with $VD57_LANG of its $VD57_ASKS analyze-resume asks ($VD57_SUCC): S13-003's page half is not serving"; fi
  if printf '%s' "$VD57_SJS" | grep -qF 'analysisResults.enum.'; then echo "PASS  the published report labels its fixed choices through analysisResults.enum ($VD57_SUCC)"
  else echo "FAIL  the published report ($VD57_SUCC) reads no analysisResults.enum label: S13-052 is not serving, so a translated analysis still prints its English slugs"; fi
  VD57_EN=$(printf '%s' "$VD57_SJS" | grep -o 'rb-en_ns_analysisResults-[A-Za-z0-9_-]*\.js' | head -1)
  if [ -z "$VD57_EN" ]; then echo "FAIL  the Success chunk ($VD57_SUCC) imports no English analysisResults strings chunk: the bundle layout moved"
  else
    VD57_ENJS=$(curl -s -m 30 "$SITE/assets/$VD57_EN")
    if printf '%s' "$VD57_ENJS" | grep -qF 'data_engineering:"Data Engineering"' && printf '%s' "$VD57_ENJS" | grep -qF 'scaleup:"Scale-up"'; then echo "PASS  the published English strings ($VD57_EN) carry the report's fixed-choice labels (Data Engineering, Scale-up)"
    else echo "FAIL  the published English strings ($VD57_EN) carry no analysisResults.enum labels: the frontend publish has not happened"; fi
  fi
fi
