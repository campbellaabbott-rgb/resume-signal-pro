# shellcheck shell=bash
# ── 99zzzzzz-cost-ci-edge. COST WAVE, LANE CI-EDGE (branch cost/ci-edge; cost
# audit 2026-11-08: Do first #10, Worth doing "small sequential hops"). No
# migration. Fifty-five browser-called functions carry a new build: each
# answers its CORS preflight with Access-Control-Max-Age 7200, so a browser
# asks once per two hours per function instead of before every call more than
# five seconds after the last; check-subscription also reads a signed-in
# caller's plan rows beside the cache row (not for a fresh: true request,
# which goes live; a row found too old costs its live check one more read, a
# stated trade), and get-account-data its bound one-offs beside the mailbox
# proof.
#
# Named 99zzzzzz so it sorts after 99zzzzz-free-scan-wave-recheck.sh.
#
# THE CLAIMS, one line each:
#   B  each of the fifty-five serves its cost-wave build or a later one on its
#      preflight. While none does, an older build is INFO (not deployed yet).
#      Once any does, each one still older or unstamped is a FAIL: a partial
#      deploy;
#   M  each one serving its cost-wave build says Access-Control-Max-Age 7200
#      on that preflight. A function still on an older build is not judged
#      here (B says so).
#   F  what ships with the frontend and in CI, which no request here can see
#      (INFO, with the test that proves each).
#
# WHAT THIS SECTION CANNOT SEE. The two hops need a signed-in member; they are
# proven on the shipped handlers by
# src/test/a-signed-in-check-and-the-account-page-ask-their-independent-reads-together.test.ts.
#
# READ-ONLY. Fifty-five OPTIONS preflights. Nothing is posted.
echo "== 99zzzzzz. cost wave ci-edge: builds, and every preflight cacheable for two hours =="

# function:date:sequence, the build each one ships in the cost wave: this
# lane's, or the integration's next sequence where the ai lane stamped the
# same build on code of its own, and agent-mcp's over the connect round's
# 2026-11-08.1 code (fix/cost-wave; DEPLOY-LEDGER §3).
VDCE_WANT="account-order:2026-11-09:1 account-settings:2026-11-09:1 admin-ops:2026-11-09:1 affiliate-payout-request:2026-11-09:1
agent-access:2026-11-09:1 agent-mcp:2026-11-09:2 agent-pass-status:2026-11-09:1 analyze-resume:2026-11-10:4 api-key-request:2026-11-09:1
application-fit:2026-11-09:1 auth-signed-in:2026-11-09:1 check-subscription:2026-11-10:3 company-claim:2026-11-09:1
create-agent-checkout:2026-11-10:2 create-checkout:2026-11-10:3 create-portal-session:2026-11-10:2 create-product-checkout:2026-11-10:2
create-scan-pack-checkout:2026-11-09:1 create-subscription-checkout:2026-11-10:2 create-test-checkout:2026-11-09:1 delete-account:2026-11-09:1
fetch-job-posting:2026-11-09:1 generate-apply-package:2026-11-10:4 generate-ats-defense:2026-11-10:3 generate-career-path:2026-11-10:3
generate-career-snapshot:2026-11-10:3 generate-cover-letter:2026-11-09:2 generate-freelance-boost:2026-11-10:3 generate-graduate-gameplan:2026-11-10:3
generate-interview-coach:2026-11-10:3 generate-keyword-fix:2026-11-10:3 generate-premium-package:2026-11-10:3 generate-tailored-resume:2026-11-09:2
get-account-data:2026-11-09:1 get-analytics:2026-11-09:1 get-error-telemetry:2026-11-09:1 health-check:2026-11-09:1 job-fit:2026-11-09:1
parse-docx:2026-11-09:1 parse-pdf:2026-11-09:1 parse-resume-structured:2026-11-09:2 parse-spreadsheet:2026-11-09:1 recover-purchase:2026-11-09:1
save-lead:2026-11-09:1 scan-credits:2026-11-10:2 send-agent-digest:2026-11-09:1 send-market-pulse:2026-11-09:1 send-scan-report:2026-11-09:1
send-search-digest:2026-11-09:1 shortlist-evaluate:2026-11-09:2 test-ai-fallback:2026-11-10:3 track-ab-event:2026-11-09:1
verify-product-purchase:2026-11-10:2 verify-scan-pack-purchase:2026-11-10:2 withdraw-subscription:2026-11-09:1"
VDCE_NEW=""
VDCE_OLD=""
VDCE_AGE_OK=0
VDCE_AGE_BAD=""
for VDCE_W in $VDCE_WANT; do
  VDCE_F=${VDCE_W%%:*}; VDCE_R=${VDCE_W#*:}; VDCE_D=${VDCE_R%%:*}; VDCE_N=${VDCE_R#*:}
  VDCE_HDR=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDCE_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization, apikey, content-type" | tr -d '\r')
  VDCE_H=$(printf '%s\n' "$VDCE_HDR" | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  VDCE_A=$(printf '%s\n' "$VDCE_HDR" | grep -i '^access-control-max-age:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -n "$VDCE_H" ] && build_ge "$VDCE_F" "$VDCE_H" "$VDCE_D" "$VDCE_N"; then
    VDCE_NEW="$VDCE_NEW $VDCE_F=$VDCE_H"
    if [ "$VDCE_A" = 7200 ]; then VDCE_AGE_OK=$((VDCE_AGE_OK + 1))
    else VDCE_AGE_BAD="$VDCE_AGE_BAD $VDCE_F=$VDCE_H=${VDCE_A:-none}"; fi
  else VDCE_OLD="$VDCE_OLD $VDCE_F=${VDCE_H:-none}=$VDCE_D.$VDCE_N"; fi
done
VDCE_NEWN=$(printf '%s\n' $VDCE_NEW | grep -c .)
if [ -n "$VDCE_NEW" ]; then echo "PASS  B $VDCE_NEWN of 55 functions serve their cost-wave ci-edge build or a later one"; fi
for VDCE_P in $VDCE_OLD; do
  VDCE_F=${VDCE_P%%=*}; VDCE_R=${VDCE_P#*=}; VDCE_H=${VDCE_R%%=*}; VDCE_WB=${VDCE_R#*=}
  if [ -z "$VDCE_NEW" ]; then echo "INFO  B $VDCE_F preflight x-fn-build = $VDCE_H: cost wave ci-edge is not deployed yet (want $VDCE_F.$VDCE_WB; judged once any of its 55 functions serves its build)"
  elif [ "$VDCE_H" = none ]; then echo "FAIL  B $VDCE_F preflight carries no x-fn-build while others serve their cost-wave build (want $VDCE_F.$VDCE_WB or later)"
  else echo "FAIL  B $VDCE_F preflight x-fn-build = $VDCE_H while others serve their cost-wave build: a partial deploy (want $VDCE_F.$VDCE_WB or later)"; fi
done
if [ "$VDCE_AGE_OK" -gt 0 ]; then echo "PASS  M $VDCE_AGE_OK function(s) on their cost-wave build say Access-Control-Max-Age 7200 on the preflight"; fi
for VDCE_P in $VDCE_AGE_BAD; do
  VDCE_F=${VDCE_P%%=*}; VDCE_R=${VDCE_P#*=}; VDCE_H=${VDCE_R%%=*}; VDCE_A=${VDCE_R#*=}
  echo "FAIL  M $VDCE_F serves $VDCE_H, whose preflight should say Access-Control-Max-Age 7200, and says ${VDCE_A} (a browser then asks before every call again)"
done
if [ -z "$VDCE_NEW" ]; then echo "INFO  M not judged: no function serves its cost-wave ci-edge build yet"; fi

echo "INFO  F1 the frontend publish: a scraper or driven browser on /jobs is sent the list and none of the country, takedown, benchmark, curve, growth or layoff reads, while Googlebot, Google's inspection tool, bingbot and Applebot, which index what the page draws, are sent all of them (src/test/a-crawler-on-the-board-is-sent-the-list-and-none-of-the-decoration.test.tsx); no request here can tell a crawler's render from a person's"
echo "INFO  F2 the frontend publish: /jobs prints the homepage's freshness answer when the visitor came from / under a minute ago, instead of asking again (same test)"
echo "INFO  F3 CI, from the merge on: the required test job bakes offline and fails when no dist/pricing/index.html is written; the same job then runs the guards on built output that read no live data (the entry budget, the chunk preloads, the fonts, the stylesheet order, the skip link) against that offline dist on every pull request, since merging into main publishes the frontend; built-output bakes live on every push to main and on a pull request only when it changes the bake (src/test/the-required-build-bakes-offline-and-a-pull-request-bakes-live-only-when-it-changes-the-bake.test.ts)"
echo "INFO  F4 check-subscription's plan rows for a signed-in caller are read beside the cache row: a cached view makes one read and no extra round trip; a fresh: true request reads them once, after its live check; a cached row found too old makes its live check read them twice, one RPC (at most 30 an hour an address) traded for the round trip off every cached view (src/test/a-signed-in-check-and-the-account-page-ask-their-independent-reads-together.test.ts)"
