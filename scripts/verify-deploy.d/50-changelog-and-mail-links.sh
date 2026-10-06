# The 2026-10-06 deploy: nine changelog entries (PR #19), three mailers
# rebuilt, llms.txt corrected, generate-resume-roast's stamp, and the closure
# ledger migration Lovable never applied. Sourced by scripts/verify-deploy.sh.
# Read-only: crawler GETs of public pages, OPTIONS preflights (no function
# logic runs), and git reads of origin/main. Nothing is sent, bought or written.
echo "== 50. changelog of 3-5 October, the mailers' links, and the closure ledger kept =="

CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
for T in "Big Workday employers were missing many of their jobs" \
         "A PDF résumé reached our scanner as one long line" \
         "What we keep, for how long, and an address that reaches us" \
         "Paid tools that took payment and delivered nothing" \
         "Nine employers whose job lists were too big for us to read"; do
  if printf '%s' "$CL" | grep -qF "$T"; then echo "PASS  /changelog serves crawlers \"$T\""
  else echo "FAIL  /changelog does not serve \"$T\" (frontend not published, or the prerender did not rebuild)"; fi
done
if printf '%s' "$CL" | grep -qF "Correction, 5 October 2026"; then echo "PASS  /changelog carries the dated corrections to the two never-stored entries"
else echo "FAIL  /changelog has no dated correction on freeAccounts / savedVersions"; fi

# Each rebuilt function names the build that carries the change.
for PAIR in "send-scan-report|2026-10-06|1" "send-product-email|2026-10-06|1" "send-analysis-email|2026-10-06|1" "generate-resume-roast|2026-10-05|1"; do
  FN=${PAIR%%|*}; REST=${PAIR#*|}; D=${REST%%|*}; N=${REST#*|}
  H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build"
  elif build_ge "$FN" "$H" "$D" "$N"; then echo "PASS  $FN preflight x-fn-build = $H ($FN.$D.$N or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.$D.$N or later: the previous bundle is still serving)"; fi
done

LL=$(curl -s -m 30 -A "$UA" "$SITE/llms.txt" | grep -F "REAL screening questions")
if [ -z "$LL" ]; then echo "INFO  /llms.txt has no real-screening-questions line"
elif printf '%s' "$LL" | grep -q "Teamtailor"; then echo "FAIL  /llms.txt still lists Teamtailor among the real-question vendors (status.questionVendors does not)"
else echo "PASS  /llms.txt real-question vendors match status.questionVendors (no Teamtailor)"; fi

# The closure ledger's keep-forever migration was skipped by every Lovable
# apply through 2026-10-05; job_board_exits starts deleting 90-day-old rows
# around 2026-10-24 without it. Its only anon-visible trace is Lovable's own
# applied stub. 20260928003117 must stay UNAPPLIED: 20261002121843 re-issued
# the same function later, and applying the older file would revert it.
git fetch -q origin 2>/dev/null
STUBS=$(git ls-tree --name-only origin/main drizzle/migrations/ 2>/dev/null)
if printf '%s' "$STUBS" | grep -q "20261001090000\|the_closure_ledger_is_the_asset"; then echo "PASS  Lovable applied 20261001090000 (the closure ledger is no longer pruned)"
else echo "FAIL  20261001090000 has no applied stub in drizzle/migrations: job_board_exits still deletes rows past 90 days (first loss ~2026-10-24)"; fi
if printf '%s' "$STUBS" | grep -q "20260928003117\|raised_where_the_cron_pays"; then echo "FAIL  20260928003117 was applied AFTER 20261002121843: get_category_fill_curve is back on its pre-watch-floor body -- re-apply 20261002121843"
else echo "PASS  20260928003117 stays unapplied (superseded by 20261002121843)"; fi
