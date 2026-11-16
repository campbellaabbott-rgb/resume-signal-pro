# shellcheck shell=bash
# ── 99zzzzzzz-hotfix-nb1. HOTFIX NB-1 (branch hotfix/nb1-non-english-score;
# bug audit 2026-11-15, register NB-1). The free scan's rule-based score, which
# holds the AI's reading to within 12 points and draws the score band, reads
# a résumé in Spanish, French, German, Portuguese, Dutch, Italian, Hindi or
# Tagalog in its own language when the résumé carries that language's own
# section words. Before it, the same strong CV scored about 25 points lower in
# Spanish or German than in English, whatever the AI read. One function,
# free-keyword-scan, at 2026-11-15.1. No migration, no frontend change.
#
# Named 99zzzzzzz so it sorts after the 99zzzzzz- hotfix and cost sections.
#
# THE CLAIM:
#   B  free-keyword-scan serves 2026-11-15.1 or later on its preflight. An
#      older build is INFO (not deployed yet: with one function there is no
#      partial deploy to tell apart, and section 49 FAILs main ahead of
#      production once this is on main); a preflight with no x-fn-build is a
#      FAIL.
#
# WHAT THIS SECTION CANNOT SEE. The score itself: only a scan shows it, and a
# scan spends a model call and writes a report and a metric, so this script
# never runs one. It is proven on the module the function imports by
# src/test/a-cv-in-spanish-or-german-is-scored-like-the-same-cv-in-english.test.ts.
# After the deploy, a Spanish or German scan's function log shows it on its
# rule score line (the INFO line below says what to read).
#
# READ-ONLY. One OPTIONS preflight. Nothing is posted.
echo "== 99zzzzzzz. hotfix NB-1: the free scan's rule score reads a résumé in its own language =="

rm -f /tmp/vd_nb1_hdr
curl -s -m 30 -D /tmp/vd_nb1_hdr -o /dev/null -X OPTIONS "$B/functions/v1/free-keyword-scan" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST"
VDNB1_H=$(tr -d '\r' < /tmp/vd_nb1_hdr 2>/dev/null | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
if [ -z "$VDNB1_H" ]; then
  echo "FAIL  B free-keyword-scan preflight carries no x-fn-build (not deployed, or its preflight does not answer; want free-keyword-scan.2026-11-15.1 or later)"
elif build_ge free-keyword-scan "$VDNB1_H" 2026-11-15 1; then
  echo "PASS  B free-keyword-scan preflight x-fn-build = $VDNB1_H (2026-11-15.1 or later: the rule score reads a résumé in its own language)"
else
  echo "INFO  B free-keyword-scan preflight x-fn-build = $VDNB1_H: hotfix NB-1 (2026-11-15.1) is not deployed yet"
fi
echo "INFO  NB-1's score is not read here: a scan spends a model call and writes a report. The suite proves it on the module. After the deploy, a Spanish or German scan's free-keyword-scan log prints its rule score line with 'language es, read own-language' (or de): a strong CV's rule score there is within 5 of the same CV in English, where it was about 25 below"
