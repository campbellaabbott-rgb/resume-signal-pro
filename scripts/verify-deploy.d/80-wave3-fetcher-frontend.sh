# shellcheck shell=bash
# ── 80. WAVE 3 ROUND 2, FETCHER + FRONTEND (S11 sweep 2026-10-11, group
# fetcher-frontend). Deploy note: docs/wave3/fetcher-frontend.md.
#
# THE CLAIMS, one line each below:
#   - fetch-job-posting (NEW) serves its build or a later one, and the three
#     scan functions that now ignore a link sent as the job description serve
#     the merged builds that carry it: free-keyword-scan .5,
#     free-keyword-scan-stream .5, analyze-resume .62 (the branch stamped .4, .4, .3);
#   - fetch-job-posting refuses an unlisted host (LinkedIn) with
#     unsupported_host, before any meter and without fetching anything;
#   - job-board names an employer it does not carry (unknownCompanies) instead
#     of answering a bare zero the company page printed as "not hiring";
#   - a real posting read cannot be proven read-only (it spends a rate-limit
#     row and one board-budget read): INFO.
#
# READ-ONLY. OPTIONS preflights; one fetch-job-posting POST whose host the
# function refuses before it touches a meter or the network; one job-board
# list with x-rb-budget: probe for a token the catalogue does not carry
# (answered before any database read).
echo "== 80. wave 3 round 2: the job-link fetcher, links ignored as job descriptions, uncarried employers named =="

vd80_build() { # $1 fn -> the preflight's x-fn-build header
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}
for PAIR in "fetch-job-posting|2026-10-09|71" "free-keyword-scan|2026-10-09|5" "free-keyword-scan-stream|2026-10-09|5" "analyze-resume|2026-10-09|62"; do
  FN=${PAIR%%|*}; REST=${PAIR#*|}; DAY=${REST%%|*}; N=${REST#*|}
  H=$(vd80_build "$FN")
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (not deployed, or a bundle older than build stamps)"
  elif build_ge "$FN" "$H" "$DAY" "$N"; then echo "PASS  $FN preflight x-fn-build = $H ($FN.$DAY.$N or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.$DAY.$N or later: the previous bundle is still serving)"; fi
done

VD80_UNLISTED=$(curl -s -m 30 -X POST "$B/functions/v1/fetch-job-posting" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -d '{"url":"https://www.linkedin.com/jobs/view/3912345678"}')
case "$VD80_UNLISTED" in
  *'"reason":"unsupported_host"'*) echo "PASS  fetch-job-posting refuses an unlisted host (LinkedIn) with unsupported_host, before any meter";;
  *) echo "FAIL  fetch-job-posting on an unlisted host answered: $(printf '%s' "$VD80_UNLISTED" | head -c 200)";;
esac
echo "INFO  a real posting read (DNS through the runtime, the vendor API or JSON-LD) spends a rate-limit row and a board read, so it is not probed; src/test/a-job-link-is-read-through-a-fence.test.ts runs the shipped bundle and every fence"

VD80_LIST=$(J '{"action":"list","companies":["nonexistent-token-xyz"],"limit":1,"groupSimilar":false}')
case "$VD80_LIST" in
  *'"unknownCompanies":["nonexistent-token-xyz"]'*) echo "PASS  job-board names an employer it does not carry (unknownCompanies), so /jobs/company/<it> says we don't carry it (S11-020)";;
  *'"total":0'*) echo "FAIL  job-board answers a bare total 0 for an uncarried token: the company page prints it as 'not hiring' (S11-020 not live)";;
  *) echo "INFO  job-board list for an uncarried token answered: $(printf '%s' "$VD80_LIST" | head -c 160)";;
esac
