# shellcheck shell=bash
# ── 99zzzzzz-hotfix-privacy. THE 2026-11-10 HOTFIX, PRIVACY LANE (branch
# hotfix/privacy): H6 (M-S14-021, C-S14-009), H7 (M-S14-001), M-S14-064 and
# M-S14-040. One function at 2026-11-10.1 (free-keyword-scan-stream), one
# migration (20261110160000), and two frontend files published by the merge
# itself (src/hooks/use-affiliate-auth.ts, src/index.css).
#
# Named 99zzzzzz so it sorts after 99zzzzz-free-scan-wave-recheck.sh in byte
# order ("-" before "z") and under a locale that ignores the dash ("99zzzzzf"
# before "99zzzzzz").
#
# THE CLAIMS, one line each. None FAILs on today's production, before the
# merge and the paste: each reads INFO until what it judges has shipped, and
# can FAIL from then on.
#   P1  the published affiliate hook (the chunk carrying track_affiliate_click)
#       holds a ?ref= code until analytics are allowed: it carries the held
#       referral's debug line and the consent listener, and no longer stores
#       the code the moment it reads it. The old hook alone is INFO (the merge
#       has not published); the held line beside the old store, or neither
#       shape, is a FAIL.
#   P2  the published stylesheet hides the analytics banner while a dialog
#       locks the page (body[data-scroll-locked] [data-consent-banner]). Its
#       absence is INFO while P1 reads the old hook, and a FAIL once P1 shows
#       the merge published: both ship in that one publish.
#   F1  free-keyword-scan-stream serves 2026-11-10.1 or later: its cache key is
#       the whole text (v8). Older is INFO until M1 shows the paste applied
#       this lane's migration, then a FAIL (section 49 lists the gap either
#       way); no build header at all is a FAIL.
#   M1  20261110160000 landed: layoff_filing_rollup has superseded_n,
#       amendment_n, rescinded_n and non_workforce_n, closed to anon (a GET of
#       each column answers 42501, where a missing column answers 42703 before
#       the permission check). Missing is INFO before 2026-12-01 and a FAIL
#       from that day: the 'layoff-rollup-retention' run at 04:20 UTC deletes
#       a month's rows under the old count. A readable table is a FAIL.
#   M2  roll_up_and_prune_layoff_filings still answers anon 42501. A
#       REGRESSION GUARD, NOT PROOF OF THIS DEPLOY: it has been closed since
#       20260918100900.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the referral stored and
# logged only after a yes (an-affiliate-link-stores-and-logs-nothing-until-
# analytics-are-allowed), the banner off the phone sheet's buttons and back
# when it closes (the-analytics-banner-gives-way-to-the-phone-posting-sheet),
# two people's résumés never sharing a key (two-peoples-chinese-resumes-never-
# share-the-backup-scanners-cached-report, the shipped handler), and every
# pruned row in one column (a-pruned-layoff-filing-is-counted-once-in-the-
# column-its-status-names, pglite); the migration's own DO block fails its
# apply if the definition or the grants are wrong.
#
# READ-ONLY. GETs of the homepage, its entry script, one chunk and the
# stylesheet; one OPTIONS preflight; five anon GETs of a closed table (each
# selects one named column; RLS and the revoke answer before any row); one GET
# probe of a revoked writer (read-only transaction). Nothing is posted.
echo "== 99zzzzzz. hotfix, privacy lane: the referral waits for a yes, the banner gives way to the phone sheet, the backup scanner's key, the layoff prune's columns =="

rm -f /tmp/vd_hpv_home.html /tmp/vd_hpv_entry.js /tmp/vd_hpv_aff.js /tmp/vd_hpv_css.css
VDPV_TODAY="${VDPV_TODAY:-$(date -u +%F)}"

# P1. The entry names the hook's chunk; the chunk is the one that logs clicks.
curl -s -m 30 "$SITE/" > /tmp/vd_hpv_home.html
VDPV_MAIN=$(grep -o '/assets/index-[^"]*\.js' /tmp/vd_hpv_home.html | head -1)
VDPV_CSS=$(grep -o '/assets/index-[^"]*\.css' /tmp/vd_hpv_home.html | head -1)
[ -n "$VDPV_MAIN" ] && curl -s -m 60 "$SITE$VDPV_MAIN" > /tmp/vd_hpv_entry.js
VDPV_AFFN=$( { [ -f /tmp/vd_hpv_entry.js ] && grep -o 'use-affiliate-auth-[A-Za-z0-9_-]*\.js' /tmp/vd_hpv_entry.js; } | head -1)
[ -n "$VDPV_AFFN" ] && curl -s -m 30 "$SITE/assets/$VDPV_AFFN" > /tmp/vd_hpv_aff.js
VDPV_H6=unknown
if [ -z "$VDPV_MAIN" ]; then echo "FAIL  P1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDPV_AFFN" ] || ! grep -qF 'track_affiliate_click' /tmp/vd_hpv_aff.js 2>/dev/null; then
  echo "FAIL  P1 the entry $VDPV_MAIN names no use-affiliate-auth chunk that logs track_affiliate_click (${VDPV_AFFN:-none named}): the bundle layout moved, so the referral hook cannot be judged"
else
  VDPV_HELD=no; VDPV_OLD=no; VDPV_LISTEN=no
  grep -qF 'Affiliate referral held until analytics are allowed' /tmp/vd_hpv_aff.js && VDPV_HELD=yes
  grep -qE 'get\("ref"\);if\([A-Za-z_$][A-Za-z0-9_$]*\)\{const [A-Za-z_$][A-Za-z0-9_$]*=Date\.now\(\)' /tmp/vd_hpv_aff.js && VDPV_OLD=yes
  grep -qF 'addEventListener(' /tmp/vd_hpv_aff.js && VDPV_LISTEN=yes
  if [ "$VDPV_HELD" = yes ] && [ "$VDPV_OLD" = no ] && [ "$VDPV_LISTEN" = yes ]; then
    VDPV_H6=live; echo "PASS  P1 the published referral hook ($VDPV_AFFN) holds a ?ref= code until analytics are allowed and releases it on the consent event (H6)"
  elif [ "$VDPV_HELD" = yes ]; then
    VDPV_H6=live; echo "FAIL  P1 the published referral hook ($VDPV_AFFN) carries the held-referral line but $([ "$VDPV_OLD" = yes ] && echo 'still stores the code the moment it reads it' || echo 'listens for no consent event'): a referral is stored before a yes, or never after one"
  elif [ "$VDPV_OLD" = yes ]; then
    VDPV_H6=old; echo "INFO  P1 the published referral hook ($VDPV_AFFN) still stores ?ref= and logs the click before any answer: the merge carrying H6 has not published yet"
  else
    echo "FAIL  P1 the published referral hook ($VDPV_AFFN) is neither the old shape nor the held one, so H6 cannot be judged: read the chunk"
  fi
fi

# P2. The stylesheet. The floating help's rule is the control that this is the real one.
[ -n "$VDPV_CSS" ] && curl -s -m 30 "$SITE$VDPV_CSS" > /tmp/vd_hpv_css.css
if [ -z "$VDPV_CSS" ]; then echo "FAIL  P2 the homepage names no /assets/index-*.css stylesheet: the published styles cannot be read"
elif ! grep -qF 'body[data-scroll-locked] [data-floating-help]' /tmp/vd_hpv_css.css 2>/dev/null; then
  echo "FAIL  P2 the stylesheet $VDPV_CSS has no rule for the floating help under a locked page either, so it is not the site's stylesheet or the rule moved: H7 cannot be judged"
elif grep -qE 'body\[data-scroll-locked\] \[data-consent-banner\][^{]*\{[^}]*display:none' /tmp/vd_hpv_css.css; then
  echo "PASS  P2 the published stylesheet ($VDPV_CSS) hides the analytics banner while a dialog locks the page, so the phone sheet's Apply and Check my fit are on top (H7)"
elif [ "$VDPV_H6" = live ]; then
  echo "FAIL  P2 the published stylesheet ($VDPV_CSS) has no rule hiding the banner under a locked page, though the same merge's referral hook is live: the banner still covers the phone sheet's buttons"
else
  echo "INFO  P2 the published stylesheet ($VDPV_CSS) does not hide the banner under a locked page yet: the merge carrying H7 has not published"
fi

# M1 (read before F1, which keys its strictness on it).
vdpv_col() { # $1 column -> 42501 | 42703 | ROWS | the code or a snippet
  curl -s -m 30 "$B/rest/v1/layoff_filing_rollup?select=$1&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j=null;try{j=JSON.parse(s)}catch{}if(Array.isArray(j)){console.log("ROWS");return}if(j&&typeof j==="object"&&j.code){console.log(String(j.code));return}console.log("NONJSON:"+JSON.stringify(s.slice(0,100)))})'
}
VDPV_CTRL=$(vdpv_col filings)
VDPV_HAVE=0; VDPV_MISS=0; VDPV_ODD=""
for VDPV_C in superseded_n amendment_n rescinded_n non_workforce_n; do
  VDPV_A=$(vdpv_col "$VDPV_C")
  case "$VDPV_A" in
    42501) VDPV_HAVE=$((VDPV_HAVE + 1));;
    42703) VDPV_MISS=$((VDPV_MISS + 1));;
    *) VDPV_ODD="$VDPV_ODD $VDPV_C=$VDPV_A";;
  esac
done
VDPV_MIG=unknown
if [ "$VDPV_CTRL" = ROWS ] || printf '%s' "$VDPV_ODD" | grep -q '=ROWS'; then
  echo "FAIL  M1 layoff_filing_rollup answered rows to the publishable key (filings: $VDPV_CTRL;$VDPV_ODD): the rollup is readable by anyone"
elif [ "$VDPV_CTRL" != 42501 ]; then
  echo "FAIL  M1 the control column layoff_filing_rollup.filings answered $VDPV_CTRL, not 42501, so a missing column cannot be told from a refused one"
elif [ -n "$VDPV_ODD" ]; then
  echo "FAIL  M1 layoff_filing_rollup's new columns answered$VDPV_ODD (want 42501 for each)"
elif [ "$VDPV_HAVE" = 4 ]; then
  VDPV_MIG=applied; echo "PASS  M1 layoff_filing_rollup has superseded_n, amendment_n, rescinded_n and non_workforce_n, closed to anon: 20261110160000 landed, so the monthly prune counts each pruned row in one column"
elif [ "$VDPV_HAVE" -gt 0 ]; then
  VDPV_MIG=applied; echo "FAIL  M1 layoff_filing_rollup has $VDPV_HAVE of the four new columns: 20261110160000 applied in part (Lovable retyped it?), read its stub"
elif [ "$VDPV_TODAY" \< "2026-12-01" ]; then
  VDPV_MIG=pending; echo "INFO  M1 layoff_filing_rollup has none of the four new columns yet: 20261110160000 is not applied. It must apply before the 'layoff-rollup-retention' run at 04:20 UTC on 2026-12-01"
else
  VDPV_MIG=pending; echo "FAIL  M1 it is $VDPV_TODAY and layoff_filing_rollup has none of the four new columns: 20261110160000 is not applied, so the 1 December prune deleted (or will delete) a month's filings under the every-row count"
fi

# F1.
VDPV_FH=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/free-keyword-scan-stream" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VDPV_FH" ]; then echo "FAIL  F1 free-keyword-scan-stream preflight carries no x-fn-build (want free-keyword-scan-stream.2026-11-10.1 or later)"
elif build_ge free-keyword-scan-stream "$VDPV_FH" 2026-11-10 1; then echo "PASS  F1 free-keyword-scan-stream x-fn-build = $VDPV_FH (2026-11-10.1 or later): the backup scanner keys its cache on the whole text, so two people's non-Latin résumés never share a report"
elif [ "$VDPV_MIG" = applied ]; then echo "FAIL  F1 free-keyword-scan-stream x-fn-build = $VDPV_FH, older than 2026-11-10.1, though the paste applied this lane's migration: the cache key still deletes every letter outside A-Z"
else echo "INFO  F1 free-keyword-scan-stream x-fn-build = $VDPV_FH: the paste with 2026-11-10.1 has not landed (section 49 lists the gap)"; fi

# M2.
probe roll_up_and_prune_layoff_filings '{"p_keep_days":365}' | sed 's/^PASS  /PASS  M2 (a regression guard, closed since 20260918100900) /; s/^FAIL  /FAIL  M2 /; s/^INFO  /INFO  M2 /'
