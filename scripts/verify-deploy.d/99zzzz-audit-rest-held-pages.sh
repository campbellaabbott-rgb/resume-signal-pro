# shellcheck shell=bash
# ── 99zzzz. AUDIT-REST, HELD PAGES: the items held while their files were being
# edited by the free-scan and board-stream rounds (branch
# fix/audit-rest-held-pages: S9-001's spend-gate line, S13-124, S12-052's letter
# and tailored-résumé half, S13-039; no migration).
#
# THE CLAIMS, one line each:
#   B   every function that bundles _shared/model-spend-gate.ts serves
#       2026-11-03.1 or later: a connected app's token, hook or no hook, is
#       counted as a stranger, never as the person (S9-001);
#   P1  the published homepage chunk no longer carries the job it invented for a
#       report with no posting, and still carries the tailored-résumé writer, so
#       the line reads the right chunk (S13-124);
#   P2  the published board chunk carries the controls that open a letter or a
#       tailored résumé already drafted and ask for another (S12-052).
# Every line FAILs on the build c4a29736 serves: the functions there are older,
# its homepage chunk carries the invented job, its board chunk has no such key.
#
# Not provable from outside, so proved in the suite:
#   a-cleared-job-description-box-buys-against-no-posting (S13-039: minified, the
#   box's expression has no literal to read; a live press would be a purchase),
#   a-connected-apps-token-is-no-one-at-the-spend-gate (needs a connector token),
#   a-tailored-resume-is-aimed-at-a-real-posting-or-not-offered,
#   reopening-prepare-opens-the-letter-and-resume-already-drafted.
#
# READ-ONLY: OPTIONS preflights (no function logic runs) and GETs of the site's
# entry script and two of its chunks. No model is called; nothing is bought.
echo "== 99zzzz. audit-rest held pages: the spend gate's connector line, the tailored résumé's posting, drafts kept per job (2026-11-03.1) =="

vdhp_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

for VDHP_FN in analyze-linkedin-profile application-fit free-keyword-scan free-keyword-scan-stream \
  generate-application-answers generate-apply-package generate-ats-defense generate-career-path \
  generate-career-snapshot generate-cover-letter generate-cover-letter-stream generate-elevator-pitch \
  generate-freelance-boost generate-graduate-gameplan generate-interview-coach generate-keyword-fix \
  generate-premium-package generate-premium-package-stream generate-product-preview generate-recruiter-view \
  generate-resume-roast generate-summary generate-tailored-resume import-freelance-profile job-fit nl-search \
  parse-resume-structured shortlist-evaluate test-ai-fallback; do
  VDHP_H=$(vdhp_build "$VDHP_FN")
  if [ -z "$VDHP_H" ]; then echo "FAIL  $VDHP_FN preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
  elif build_ge "$VDHP_FN" "$VDHP_H" "2026-11-03" "1"; then echo "PASS  $VDHP_FN x-fn-build = $VDHP_H ($VDHP_FN.2026-11-03.1 or later: the spend gate counts a connected app as no one)"
  else echo "FAIL  $VDHP_FN x-fn-build = $VDHP_H, older than $VDHP_FN.2026-11-03.1: the spend gate's connector line is not serving"; fi
done

# P1, P2: the published pages. The entry names each route's chunk.
VDHP_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDHP_MAINJS=""
[ -n "$VDHP_MAIN" ] && VDHP_MAINJS=$(curl -s -m 30 "$SITE$VDHP_MAIN")
vdhp_chunk() { # $1 chunk name prefix -> the chunk's file name from the entry
  printf '%s' "$VDHP_MAINJS" | grep -o "\"\./$1-[A-Za-z0-9_-]*\.js\"" | head -1 | tr -d '"' | sed 's|^\./||'
}

VDHP_IDX=$(vdhp_chunk Index)
if [ -z "$VDHP_IDX" ]; then echo "FAIL  the served entry (${VDHP_MAIN:-none found}) names no Index chunk: the frontend is not serving, or the bundle layout moved"
else
  VDHP_IJS=$(curl -s -m 30 "$SITE/assets/$VDHP_IDX")
  if ! printf '%s' "$VDHP_IJS" | grep -qF 'generate-tailored-resume'; then echo "FAIL  the published homepage chunk ($VDHP_IDX) names no tailored-résumé writer, so this line cannot judge it: the bundle layout moved"
  elif printf '%s' "$VDHP_IJS" | grep -qF 'requiring strong skills'; then echo "FAIL  the published homepage chunk ($VDHP_IDX) still invents a job for a report with no posting: the frontend publish with S13-124 has not happened"
  else echo "PASS  the published homepage chunk ($VDHP_IDX) sends the tailored-résumé writer only a real posting, and invents none"; fi
fi

VDHP_JOBS=$(vdhp_chunk Jobs)
if [ -z "$VDHP_JOBS" ]; then echo "FAIL  the served entry (${VDHP_MAIN:-none found}) names no Jobs chunk: the frontend is not serving, or the bundle layout moved"
else
  VDHP_JJS=$(curl -s -m 30 "$SITE/assets/$VDHP_JOBS")
  if printf '%s' "$VDHP_JJS" | grep -qF 'jobsPage.tailorResumeOpen' && printf '%s' "$VDHP_JJS" | grep -qF 'jobsPage.coverLetterOpen' && printf '%s' "$VDHP_JJS" | grep -qF 'jobsPage.tailorResumeAgain'; then echo "PASS  the published board chunk ($VDHP_JOBS) opens a letter or tailored résumé already drafted, and asks for another only when told to"
  else echo "FAIL  the published board chunk ($VDHP_JOBS) has no control for a draft already made: the frontend publish with S12-052 has not happened"; fi
fi
