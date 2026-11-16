# shellcheck shell=bash
# ── 99zzzzzzz-bugs-board-ui. THE BUG ROUND OF 2026-11-08, LANE BOARD-UI
# (branch bugs/a-board-ui): RC-OI-42, RC-S12-021, RC-S12-033, S14X-014,
# S14X-015, S14X-052, S14X-053, S14X-054, S14X-161, S14X-173, S14X-174,
# S14X-175, S14X-196, S14X-244, S14X-252, S14X-291, S14X-292, S14X-293,
# S14X-294, S14X-295, S14X-296, NB-3, NB-4, NB-23, NB-24, NB-25, NB-26,
# S11-094, and the board's halves of NB-21, NB-22 and NB-45. Two functions at
# 2026-11-12.1 (job-fit, nl-search; the integrator stamps them), no
# migration, and the board, the free report's matches and a new translation
# shard (src/i18n/shards/board-ui), published by the merge itself.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE STAGES, read from production, never assumed:
#   functions job-fit and nl-search answer 2026-11-12.1 or later: the round's
#             paste is live. Until then an older build is INFO. The page never
#             waits on them: without fit-batch's `unscored` map a null score
#             reads as before, and nl-search's refusals are read either way.
#   frontend  the published Jobs chunk (with every chunk it imports) or the
#             free report's matches chunk carries any of the lane's marks
#             below: the merge published. Until then every mark is INFO; from
#             then on a missing mark, or a retired spelling still present, is
#             a FAIL.
# No line waits on an owner: no key of this lane is owner-gated.
#
# THE CLAIMS, one line each:
#   F1  job-fit serves 2026-11-12.1 or later: fit-batch names why each
#       unscored posting was not scored (S14X-052).
#   F2  nl-search serves 2026-11-12.1 or later: an unreadable tool reply goes
#       on down the model chain, an empty answer is not remembered (NB-23), and
#       a gateway refusal answers its status and a fixed reason (NB-24).
#   P1  S14X-014: a filtered employer page keeps its own address and its pool.
#   P2  S14X-015: the board-wide posted-today count is marked as the board's.
#   P3  RC-S12-021: a search saved on a pooled page stores every board.
#   P4  S14X-052: the board reads fit-batch's unscored reasons.
#   P5  S14X-053: a résumé on a filtered page ranks that page, filters kept.
#   P6  S14X-054: a withheld system's posting is not handed to the connector.
#   P7  S14X-161: a pooled page's hiring record names the board it reads.
#   P8  S14X-173: a saved posting's bookmark opens the tracker's pipeline.
#   P9  S14X-174: the claude:// link waits for a pick, never on a touch screen.
#   P10 S14X-175: the compare sheet is a dialog.
#   P11 S14X-252: the compare sheet's age is the card's.
#   P12 S14X-244: a lap-read board's opened posting is verified.
#   P13 S14X-292: a parsed newest sort with a query is newest-first.
#   P14 S14X-293: an unavailable plain-language search says so.
#   P15 NB-23: a sentence that bound no filter changes none, and says so.
#   P16 S14X-294: the board names the hourly fit allowance.
#   P17 S14X-295: a pay floor between the select's steps is shown as itself.
#   P18 NB-3: a click a sign-in interrupted is kept and done once.
#   P19 NB-4: a different search under a taken name is saved, numbered.
#   P20 NB-21: the saved-search badge counts by the digest's new-since rule.
#   P21 NB-22: the pane's age is the card's.
#   P22 NB-25: a search over several employers is named for all of them.
#   P23 NB-26: the shortcuts card keeps its keys to itself.
#   P24 NB-45: the board's keyword box has a name.
#   P25 S11-094: similar openings carry the reader's own filters.
#   M1  S14X-294: the free report's matches name the hourly allowance.
#   M2  S14X-296: the report's matches say the occupation found nothing.
#   N1  S14X-196: the Jobs chunk holds no "$" + revenue/1e9 template.
#   N2  S14X-252: the Jobs chunk asks for no jobsPage.postedDaysAgo.
#   N3  S14X-291: no board chunk asks for jobsPage.matchCoverage.
#   S1  the entry carries the English board-ui shard and names eight lazy
#       board-ui shard chunks, each holding every one of the lane's strings.
#   I1  INFO only: whether the names track's Orbital Engineering row is live
#       (RC-OI-42's other half).
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the empty search that
# takes the board's own pick with it (RC-S12-033, a-posting-the-board-opened-
# by-itself-is-not-one-the-reader-chose), the zero page named from the
# override map (a-zero-page-names-the-employer-from-the-override-map), the
# similar lookup's own words in any script (similar-openings-stay-where-the-
# reader-is-looking), the failed-note retry and un-held ids
# (a-posting-we-cannot-read-is-not-one-we-hold-no-description-for), and the
# function halves of NB-23 and NB-24 (a-parse-that-read-nothing-clears-no-
# filter-and-is-not-remembered), because fit-batch and nl-search spend from
# the caller's allowance and are never called here.
#
# READ-ONLY. Two OPTIONS preflights; GETs of the homepage, its entry, the
# Jobs chunk and every chunk it imports, the chunk holding the free report's
# matches, and the eight board-ui shard chunks. Nothing is posted.
echo "== 99zzzzzzz-bugs-board-ui. bug round, board-ui lane: the board keeps what the reader chose, says why a posting went unscored, and names what it withholds; the board-ui strings exist in nine languages =="

rm -f /tmp/vd_bu_home.html /tmp/vd_bu_entry.js /tmp/vd_bu_jobs.js /tmp/vd_bu_board.js /tmp/vd_bu_cand.js /tmp/vd_bu_matches.js /tmp/vd_bu_shard.js

# F1, F2: the functions' builds. The page falls back without them, so an
# older build is INFO, never a FAIL.
for VDBU_FN in job-fit nl-search; do
  if [ "$VDBU_FN" = job-fit ]; then VDBU_CL=F1; VDBU_W="S14X-052 fit-batch names why each unscored posting was not scored (no_description, no_recognised_terms)"
  else VDBU_CL=F2; VDBU_W="NB-23 an unreadable tool reply goes on down the model chain and an empty answer is not remembered; NB-24 a gateway refusal answers its status and a fixed reason, never the upstream text"; fi
  VDBU_FB=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDBU_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VDBU_FB" ]; then echo "FAIL  $VDBU_CL $VDBU_FN preflight carries no x-fn-build (want $VDBU_FN.2026-11-12.1 or later)"
  elif build_ge "$VDBU_FN" "$VDBU_FB" 2026-11-12 1; then echo "PASS  $VDBU_CL $VDBU_FN x-fn-build = $VDBU_FB (2026-11-12.1 or later): $VDBU_W"
  else echo "INFO  $VDBU_CL $VDBU_FN x-fn-build = $VDBU_FB: the round's paste with 2026-11-12.1 has not landed (section 49 lists the gap); the board reads the older answer meanwhile"; fi
done

# The published app: the entry, the Jobs chunk with every chunk it imports
# (the card, the saved-search pills and the employer names live there), and
# the chunk holding the free report's matches (LiveMatches, bundled with the
# report's other parts).
curl -s -m 30 "$SITE/" > /tmp/vd_bu_home.html
VDBU_MAIN=$(grep -o '/assets/index-[^"]*\.js' /tmp/vd_bu_home.html | head -1)
[ -n "$VDBU_MAIN" ] && curl -s -m 60 "$SITE$VDBU_MAIN" > /tmp/vd_bu_entry.js
VDBU_JOBSN=$( { [ -f /tmp/vd_bu_entry.js ] && grep -oE 'assets/Jobs-[A-Za-z0-9_-]+\.js' /tmp/vd_bu_entry.js; } | head -1 | sed 's#^assets/##')
if [ -n "$VDBU_JOBSN" ]; then
  curl -s -m 60 "$SITE/assets/$VDBU_JOBSN" > /tmp/vd_bu_jobs.js
  cp /tmp/vd_bu_jobs.js /tmp/vd_bu_board.js
  for VDBU_C in $(grep -oE 'from"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bu_jobs.js | sed -E 's/^from"\.\/(.*)"$/\1/' | sort -u); do
    case "$VDBU_C" in index-*) continue;; esac
    rm -f /tmp/vd_bu_cand.js
    curl -s -m 30 "$SITE/assets/$VDBU_C" > /tmp/vd_bu_cand.js
    { echo; cat /tmp/vd_bu_cand.js; } >> /tmp/vd_bu_board.js
  done
fi

VDBU_MATCHN=""
if [ -f /tmp/vd_bu_entry.js ]; then
  VDBU_MORE=""
  for VDBU_C in $(grep -oE 'assets/(LiveMatches|ATSParseSimulator|FreeKeywordResults|ProductSuccess)-[A-Za-z0-9_-]+\.js' /tmp/vd_bu_entry.js | sed 's#^assets/##' | sort -u); do
    rm -f /tmp/vd_bu_cand.js
    curl -s -m 30 "$SITE/assets/$VDBU_C" > /tmp/vd_bu_cand.js
    if grep -qF 'freeResults.matches.loading' /tmp/vd_bu_cand.js; then VDBU_MATCHN=$VDBU_C; cp /tmp/vd_bu_cand.js /tmp/vd_bu_matches.js; break; fi
    VDBU_MORE="$VDBU_MORE $(grep -oE 'from"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bu_cand.js | sed -E 's/^from"\.\/(.*)"$/\1/' | tr '\n' ' ')"
  done
  if [ -z "$VDBU_MATCHN" ]; then
    for VDBU_C in $(printf '%s\n' $VDBU_MORE | sort -u); do
      case "$VDBU_C" in index-*) continue;; esac
      rm -f /tmp/vd_bu_cand.js
      curl -s -m 30 "$SITE/assets/$VDBU_C" > /tmp/vd_bu_cand.js
      if grep -qF 'freeResults.matches.loading' /tmp/vd_bu_cand.js; then VDBU_MATCHN=$VDBU_C; cp /tmp/vd_bu_cand.js /tmp/vd_bu_matches.js; break; fi
    done
  fi
fi

VDBU_READ=yes
if [ -z "$VDBU_MAIN" ]; then VDBU_READ=no; echo "FAIL  P1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDBU_JOBSN" ] || ! grep -qF 'jobsPage.compareTitle' /tmp/vd_bu_jobs.js 2>/dev/null; then
  VDBU_READ=no; echo "FAIL  P1 the entry $VDBU_MAIN names no Jobs chunk holding the board's compare sheet (${VDBU_JOBSN:-none named}): the bundle layout moved, so the board cannot be judged"
elif ! grep -qF 'last_seen_at' /tmp/vd_bu_board.js; then
  VDBU_READ=no; echo "FAIL  P20 neither the Jobs chunk ($VDBU_JOBSN) nor a chunk it imports reads a saved search's last_seen_at: the bundle layout moved, so the saved-search badge cannot be judged"
elif [ -z "$VDBU_MATCHN" ]; then
  VDBU_READ=no; echo "FAIL  M1 no chunk the entry names for the free report holds its matches (freeResults.matches.loading): the bundle layout moved, so the report's matches cannot be judged"
fi

if [ "$VDBU_READ" = yes ]; then
  # Each mark: FILE|ERE|claim|what it proves. Any one present means the merge published.
  VDBU_MARKS='board|\.delete\("company"\)|P1|S14X-014 a filtered employer page keeps its own address and its pool, never one board'"'"'s query
board|"data-board-new-today":"board"|P2|S14X-015 the posted-today count is the whole board'"'"'s and is printed only where nothing narrows the board
board|company:[A-Za-z_$]+\.length===1\?[A-Za-z_$]+\[0\]:void 0,companies:|P3|RC-S12-021 a search saved on a pooled employer page stores every board as companies
board|no_recognised_terms|P4|S14X-052 a posting fit-batch could not score says whether its description was missing or held nothing the scorer knows
board|boardUi\.fitRankedFilters|P5|S14X-053 a résumé dropped on a filtered page ranks that page by fit and keeps the filters
board|boardUi\.handoffWithheld|P6|S14X-054 a posting from a system the connector withholds is not handed to it, and the panel says why
board|boardUi\.recordOneBoard|P7|S14X-161 the hiring record on a pooled page names the one board it reads
board|/account#pipeline|P8|S14X-173 a saved posting'"'"'s bookmark opens the tracker'"'"'s pipeline
board|\(pointer: coarse\)|P9|S14X-174 the claude:// link is built only for a host the reader picked, and never on a touch screen
board|"data-compare-dialog"|P10|S14X-175 the compare sheet is a named modal dialog that returns focus to Compare
board|"data-compare-age"|P11|S14X-252 the compare sheet prints the card'"'"'s age, none for a re-dating system
board|observability_bucket[^;]{0,160}action:"verify",ids:\[|P12|S14X-244 a lap-read board'"'"'s opened posting is verified once, whatever its stamp says
board|\.sort==="newest"&&typeof|P13|S14X-292 a parsed newest-first sort with a query is served newest first
board|boardUi\.nlUnavailable|P14|S14X-293 an unavailable plain-language search says so and offers the words as keywords
board|boardUi\.nlNothingRead|P15|NB-23 a sentence that bound no filter changes no filter and says so
board|"data-fit-limited"|P16|S14X-294 the board names the hourly fit allowance instead of calling it temporary
board|boardUi\.salaryFromSearch|P17|S14X-295 a pay floor the select has no step for is shown as itself
board|rb_board_pending|P18|NB-3 a click a sign-in interrupted comes back with the page'"'"'s filters and is done once
board|<=9&&[^;]{0,60}"23505"|P19|NB-4 a different search under a taken name is saved beside it, numbered
board|newSince:[A-Za-z_$]+\.last_seen_at|P20|NB-21 the saved-search badge counts what the digest mails: dated or first seen since the last look
board|\.kind==="dated"\?[A-Za-z_$]+\.days:null|P21|NB-22 the pane'"'"'s posting age is the card'"'"'s rule
board|\+\$\{[A-Za-z_$]+\} more`|P22|NB-25 a search over several employers is named for all of them
board|"data-shortcuts-card"|P23|NB-26 the shortcuts card takes focus, and its Escape and Enter go no further
board|id:"board-search","aria-label":[A-Za-z_$]+\("filterBar\.keywordLabel"|P24|NB-45 the board'"'"'s keyword box is named, not only its placeholder
board|limit:12,includeFacets:!1,\.\.\.|P25|S11-094 similar openings carry the reader'"'"'s country, location and work mode
matches|boardUi\.fitLimited|M1|S14X-294 the free report'"'"'s matches name the hourly fit allowance
matches|boardUi\.matchesNoneForRole|M2|S14X-296 the report'"'"'s matches say the occupation was read and found no opening'
  VDBU_HITS=0
  while IFS= read -r VDBU_L; do
    VDBU_F=${VDBU_L%%|*}; VDBU_R=${VDBU_L#*|}; VDBU_R=${VDBU_R%|*|*}
    if grep -qE "$VDBU_R" "/tmp/vd_bu_$VDBU_F.js"; then VDBU_HITS=$((VDBU_HITS + 1)); fi
  done <<< "$VDBU_MARKS"
  VDBU_FE=old; [ "$VDBU_HITS" -gt 0 ] && VDBU_FE=published
  while IFS= read -r VDBU_L; do
    VDBU_F=${VDBU_L%%|*}; VDBU_R=${VDBU_L#*|}; VDBU_R=${VDBU_R%|*|*}
    VDBU_T=${VDBU_L#*|}; VDBU_T=${VDBU_T#"$VDBU_R"|}; VDBU_CL=${VDBU_T%%|*}; VDBU_W=${VDBU_T#*|}
    if [ "$VDBU_F" = board ]; then VDBU_CH="$VDBU_JOBSN and its imports"; else VDBU_CH=$VDBU_MATCHN; fi
    if grep -qE "$VDBU_R" "/tmp/vd_bu_$VDBU_F.js"; then echo "PASS  $VDBU_CL $VDBU_W ($VDBU_CH)"
    elif [ "$VDBU_FE" = published ]; then echo "FAIL  $VDBU_CL $VDBU_W: missing from $VDBU_CH, though $VDBU_HITS of the lane's marks are published"
    else echo "INFO  $VDBU_CL $VDBU_W: not published yet ($VDBU_CH)"; fi
  done <<< "$VDBU_MARKS"

  # N1-N3: spellings the lane retired, judged once the lane published.
  VDBU_GONE='jobs|revenue/1e9|N1|S14X-196 the compare sheet prints a listed employer'"'"'s revenue in its own currency, never as "$" + revenue/1e9
jobs|jobsPage.postedDaysAgo|N2|S14X-252 the compare sheet no longer dates a posting from the raw feed date
board|jobsPage.matchCoverage|N3|S14X-291 a fit score is never called a share of keywords the reader has'
  while IFS= read -r VDBU_L; do
    VDBU_F=${VDBU_L%%|*}; VDBU_S=${VDBU_L#*|}; VDBU_S=${VDBU_S%%|*}
    VDBU_T=${VDBU_L#*|}; VDBU_T=${VDBU_T#*|}; VDBU_CL=${VDBU_T%%|*}; VDBU_W=${VDBU_T#*|}
    if [ "$VDBU_F" = jobs ]; then VDBU_CH=$VDBU_JOBSN; else VDBU_CH="$VDBU_JOBSN and its imports"; fi
    if ! grep -qF "$VDBU_S" "/tmp/vd_bu_$VDBU_F.js"; then
      if [ "$VDBU_FE" = published ]; then echo "PASS  $VDBU_CL $VDBU_W: no $VDBU_S ($VDBU_CH)"
      else echo "INFO  $VDBU_CL $VDBU_W: no $VDBU_S, but the lane has not published, so nothing is proved yet ($VDBU_CH)"; fi
    elif [ "$VDBU_FE" = published ]; then echo "FAIL  $VDBU_CL $VDBU_W: $VDBU_CH still holds $VDBU_S"
    else echo "INFO  $VDBU_CL $VDBU_W: $VDBU_CH holds $VDBU_S: not published yet"; fi
  done <<< "$VDBU_GONE"

  # S1: the English shard rides the entry; the other eight load on demand.
  VDBU_KEYS="nlLabel nlRunAsKeywords nlUnavailable nlNothingRead yearsFromSearch salaryFromSearch salaryCeilingFromSearch compareDescription recordOneBoard handoffWithheld handoffWithheldSearch fitRankedFilters fitScoreTip fitNotScoredLimit fitNotScoredFailed fitLimitedHour fitLimitedDay fitLimitedPlain unscoredTerms unscoredTermsBody unscoredTermsTip matchesNoneForRole"
  VDBU_SH=$(grep -oE '"\./shards/board-ui/[A-Za-z-]+\.json":\(\)=>[A-Za-z_$]+\(\(\)=>import\("\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bu_entry.js)
  VDBU_EN=no; grep -qF '"./shards/board-ui/en.json":' /tmp/vd_bu_entry.js && VDBU_EN=yes
  if [ -z "$VDBU_SH" ] && [ "$VDBU_EN" = no ]; then
    if [ "$VDBU_FE" = published ]; then echo "FAIL  S1 the lane's board published but the entry loads no board-ui shard, so its new strings show as keys or English"
    else echo "INFO  S1 the entry loads no board-ui shard yet: not published yet"; fi
  else
    VDBU_MISS=""; VDBU_N=0
    for VDBU_KEY in $VDBU_KEYS; do grep -qF "$VDBU_KEY:" /tmp/vd_bu_entry.js || VDBU_MISS="$VDBU_MISS en:$VDBU_KEY"; done
    while IFS= read -r VDBU_L; do
      [ -n "$VDBU_L" ] || continue
      VDBU_LNG=$(printf '%s' "$VDBU_L" | sed -E 's#.*shards/board-ui/([A-Za-z-]+)\.json.*#\1#')
      VDBU_SF=$(printf '%s' "$VDBU_L" | grep -oE '[A-Za-z0-9_-]+\.js"$' | tr -d '"')
      rm -f /tmp/vd_bu_shard.js
      curl -s -m 30 "$SITE/assets/$VDBU_SF" > /tmp/vd_bu_shard.js
      VDBU_N=$((VDBU_N + 1))
      for VDBU_KEY in $VDBU_KEYS; do grep -qF "$VDBU_KEY:" /tmp/vd_bu_shard.js || VDBU_MISS="$VDBU_MISS $VDBU_LNG:$VDBU_KEY"; done
    done <<< "$VDBU_SH"
    if [ "$VDBU_EN" = no ]; then echo "FAIL  S1 the entry names $VDBU_N lazy board-ui shards but not the English one it should carry"
    elif [ "$VDBU_N" -ne 8 ]; then echo "FAIL  S1 the entry names $VDBU_N non-English board-ui shards, not 8"
    elif [ -n "$VDBU_MISS" ]; then echo "FAIL  S1 board-ui shard strings missing:$VDBU_MISS"
    else echo "PASS  S1 the entry carries the English board-ui shard and names 8 more, each with all 22 of the lane's strings"; fi
  fi

  # I1: the other half of RC-OI-42 belongs to the names track; reported, never judged.
  if grep -qF 'Orbital Engineering' /tmp/vd_bu_board.js; then echo "INFO  I1 RC-OI-42 the names track's Orbital Engineering row is live in the board's employer names"
  else echo "INFO  I1 RC-OI-42 the board's employer names hold no Orbital Engineering row yet (the names track's half; this lane's half, the zero page named from the override map, is proved in the suite)"; fi
fi
