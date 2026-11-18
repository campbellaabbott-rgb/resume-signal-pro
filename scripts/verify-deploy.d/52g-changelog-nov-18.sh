# shellcheck shell=bash
# ── 52g. THE CHANGELOG OF 18 NOVEMBER: twelve entries for bug round A, which
# went live and verified on 18 November (main at eda155b7: the free scan and its
# backup scanner, the board, the account and order pages, the builder and the
# tailored résumé, saved-search alerts and the market pulse, the data pages,
# company pages, the Full Analysis page, Shortlist, the nightly clearing of log
# addresses, and the frontend with them). They were written after that deploy
# verified and ship in the frontend publish that follows. Each claim was read
# against the live site and the code at main on 18 November, read-only: the
# verify run's PASS lines, the live chunks the browser loads, crawler copies of
# the CV standards and benchmark pages, and no scan, purchase, sign-up or mail.
#
# BEFORE AND AFTER THAT PUBLISH. The US English changelog chunk the browser
# loads (scripts/verify-us-english.sh, never en-GB) tells the two apart, found
# as section 52f finds it; once it carries this batch's first key the publish
# has happened. Before it, every line is INFO.
#
# THE TITLES AND THEIR DATE. After the publish each title is on the crawler
# page dated 2026-11-18. A later batch can push a title past the newest 30
# entries that page lists: then the US chunk must carry it and the page must
# list 30 entries, none older than 2026-11-18. A bake from before them, or a
# title lost from the list, still FAILs.
#
# THE NEWEST ENTRY. After the publish, the page description's "Latest (<date>)"
# must be 2026-11-18 or later. The bake clamps that description at 160
# characters, and this batch's first title is long enough to be cut: only the
# date is read, and it comes well before the cut.
#
# THE DESCRIPTIONS. A title can stay while its description is reworded into a
# claim nobody read. After the publish the US chunk must carry, for each entry,
# the words that hold the limit its live read set (one string each, found once
# in the whole US shard, so the match is that entry's).
#
# THE OTHER EIGHT LANGUAGES. The owner's rule ships every entry in all nine.
# After the publish, each language's changelog chunk (the <lang>-<hash>.js the
# entry names that carries workdayCompanyPagesLostTheirFacts, found the way the
# US one is) must carry all twelve keys. These chunks are read only after the
# publish, and never in place of the US one.
#
# Its own names only: every variable here starts VD52G_, because the sections
# share one shell and K, RB, B, SITE and UA belong to every section after it.
#
# Read-only: crawler GETs of /changelog and the home page, and GETs of the entry
# script and its chunks. Nothing is sent, bought or written.
echo "== 52g. changelog of 18 November on the crawler copy of /changelog =="
VD52G_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
VD52G_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD52G_US=""
VD52G_CH=""
for VD52G_CX in $(bash scripts/verify-us-english.sh "$SITE$VD52G_MAIN"); do
  VD52G_TRY=$(curl -s -m 30 "$SITE/assets/$VD52G_CX")
  printf '%s' "$VD52G_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  VD52G_US=$VD52G_TRY
  VD52G_CH=$VD52G_CX
  break
done
VD52G_PUB=0
if [ -z "$VD52G_US" ]; then
  echo "FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts (the frontend is not serving, or the bundle layout moved): nothing below can tell a published batch from an unpublished one"
elif printf '%s' "$VD52G_US" | grep -q "theBoardKeepsYourFiltersAndSaysWhyAJobHasNoFitScore"; then
  VD52G_PUB=1
  echo "PASS  the US English changelog chunk ($VD52G_CH) carries the 18 November entries: the frontend publish has happened, so every line below is judged"
else
  echo "INFO  the US English changelog chunk ($VD52G_CH) does not carry the 18 November entries yet: their frontend publish has not happened, so every line below is INFO"
fi

VD52G_DATES=$(printf '%s' "$VD52G_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2' | cut -c1-10)
VD52G_N=$(printf '%s' "$VD52G_DATES" | grep -c '^[0-9]')
VD52G_OLDEST=$(printf '%s\n' "$VD52G_DATES" | sort | head -1)
while IFS='|' read -r VD52G_D VD52G_T; do
  [ -n "$VD52G_T" ] || continue
  VD52G_ROW=$(printf '%s' "$VD52G_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2[^>]*>[^<]*<' | grep -F ">$VD52G_T<" | head -1 | cut -c1-10)
  if [ -n "$VD52G_ROW" ] && [ "$VD52G_ROW" = "$VD52G_D" ]; then echo "PASS  /changelog serves crawlers \"$VD52G_T\", dated $VD52G_D"
  elif [ "$VD52G_PUB" != 1 ]; then echo "INFO  /changelog does not serve \"$VD52G_T\" yet (the frontend publish after this deploy's record has not happened)"
  elif [ -n "$VD52G_ROW" ]; then echo "FAIL  /changelog dates \"$VD52G_T\" $VD52G_ROW, want $VD52G_D, the day its deploy went live"
  elif ! printf '%s' "$VD52G_US" | grep -qF "$VD52G_T"; then echo "FAIL  the 18 November entries are published, but neither /changelog nor the US English changelog strings carry \"$VD52G_T\" (an entry was dropped or retitled when it landed)"
  elif [ "$VD52G_N" -ge 30 ] && [ ! "$VD52G_OLDEST" \< "$VD52G_D" ]; then echo "PASS  \"$VD52G_T\" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it"
  else echo "FAIL  the US English changelog strings carry \"$VD52G_T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"; fi
done <<'VD52G_TITLES'
2026-11-18|The board keeps the filters you chose, and says why a job has no fit score
2026-11-18|A free scan that fails no longer counts against your day, and more countries can be chosen
2026-11-18|More of the free scan is in your language, and more résumé files are read
2026-11-18|Saved-search alerts no longer call a possible match strong, and the pulse comes once a month
2026-11-18|Company pages show a listed company's total revenue, and wage and layoff filings are corrected
2026-11-18|Weekly Hiring Trends, the Ghost Job Index and the ATS score benchmarks count the way they say
2026-11-18|The résumé builder says why an import failed, and the tailored résumé is checked against yours
2026-11-18|More error messages come in your language, and a tab open during an update loads the new version
2026-11-18|Signing out asks before it deletes work kept in this browser, and each order is listed once
2026-11-18|The Full Analysis page says why a purchase cannot open, and when the service is busy
2026-11-18|Shortlist hides personal details in more languages, and employers can delete candidates and roles
2026-11-18|The 90-day limit the Privacy page sets on log data is now enforced
VD52G_TITLES

VD52G_LATEST=$(printf '%s' "$VD52G_CL" | grep -oE 'Latest \([0-9]{4}-[0-9]{2}-[0-9]{2}\)' | head -1 | cut -c9-18)
if [ "$VD52G_PUB" != 1 ]; then echo "INFO  the date of the newest entry the page describes is judged after the publish"
elif [ -z "$VD52G_LATEST" ]; then echo "FAIL  /changelog's description names no newest entry (the bake fell back to its no-entries sentence, or its markup moved)"
elif [ "$VD52G_LATEST" \< "2026-11-18" ]; then echo "FAIL  /changelog's description names an entry of $VD52G_LATEST as the newest, older than this batch's 2026-11-18 (the prerender did not rebuild)"
else echo "PASS  /changelog's description names an entry of $VD52G_LATEST as the newest, no older than this batch's 2026-11-18"; fi

while IFS='|' read -r VD52G_K VD52G_M; do
  [ -n "$VD52G_M" ] || continue
  if [ "$VD52G_PUB" != 1 ]; then echo "INFO  the description of $VD52G_K is judged after the publish"
  elif printf '%s' "$VD52G_US" | grep -qF "$VD52G_M"; then echo "PASS  the US English changelog strings describe $VD52G_K with \"$VD52G_M\""
  else echo "FAIL  the US English changelog strings carry no \"$VD52G_M\" for $VD52G_K: its description is not the one read live on 18 November"; fi
done <<'VD52G_MUST'
theBoardKeepsYourFiltersAndSaysWhyAJobHasNoFitScore|if you sign in within the hour it finishes that click once
aFreeScanThatFailsNoLongerCountsAgainstYourDay|When our backup scanner turns a scan away because too many requests came from your connection
moreOfTheFreeScanIsInYourLanguageAndMoreFilesAreRead|the page says how many pages had no text
savedSearchAlertsNoLongerCallAPossibleMatchStrong|once the page can check that the address is yours
companyPagesShowTotalRevenueAndCorrectedFilings|this applies to filings we read from now on
ourDataPagesCountTheWayTheySay|only when at least 25 scans scored that high
theBuilderSaysWhyAnImportFailedAndTheTailoredResumeIsChecked|The check looks only for those kinds of claims and cannot catch every one
errorMessagesComeInYourLanguageAndAnOpenTabLoadsTheNewVersion|a message our server writes in its own words can still arrive in English
signingOutAsksBeforeItDeletesWorkAndEachOrderIsListedOnce|if you chose to sign out everywhere, it says your other devices may still be signed in
theFullAnalysisPageSaysWhyAPurchaseCannotOpen|your purchase is still unused
shortlistHidesPersonalDetailsInMoreLanguagesAndEmployersCanDelete|a detail written in words its rules do not know can still reach the model
theNinetyDayLimitOnLogDataIsNowEnforced|so clearing them can take more than one night
VD52G_MUST

VD52G_KEYS="theBoardKeepsYourFiltersAndSaysWhyAJobHasNoFitScore aFreeScanThatFailsNoLongerCountsAgainstYourDay moreOfTheFreeScanIsInYourLanguageAndMoreFilesAreRead savedSearchAlertsNoLongerCallAPossibleMatchStrong companyPagesShowTotalRevenueAndCorrectedFilings ourDataPagesCountTheWayTheySay theBuilderSaysWhyAnImportFailedAndTheTailoredResumeIsChecked errorMessagesComeInYourLanguageAndAnOpenTabLoadsTheNewVersion signingOutAsksBeforeItDeletesWorkAndEachOrderIsListedOnce theFullAnalysisPageSaysWhyAPurchaseCannotOpen shortlistHidesPersonalDetailsInMoreLanguagesAndEmployersCanDelete theNinetyDayLimitOnLogDataIsNowEnforced"
if [ "$VD52G_PUB" != 1 ]; then
  echo "INFO  the other eight languages' changelog strings are judged after the publish"
else
  VD52G_ENTRY=$(curl -s -m 60 "$SITE$VD52G_MAIN")
  for VD52G_L in en-GB de es fr hi nl pt tl; do
    VD52G_LC=""
    VD52G_LCH=""
    for VD52G_LCX in $(printf '%s' "$VD52G_ENTRY" | grep -oE "\"\\./$VD52G_L-[A-Za-z0-9_-]+\\.js\"" | tr -d '"' | sed 's|^\./||' | sort -u); do
      VD52G_TRY=$(curl -s -m 30 "$SITE/assets/$VD52G_LCX")
      printf '%s' "$VD52G_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
      VD52G_LC=$VD52G_TRY
      VD52G_LCH=$VD52G_LCX
      break
    done
    if [ -z "$VD52G_LC" ]; then echo "FAIL  no $VD52G_L changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 18 November entries cannot be shown in $VD52G_L"; continue; fi
    VD52G_MISS=""
    for VD52G_K in $VD52G_KEYS; do printf '%s' "$VD52G_LC" | grep -q "$VD52G_K" || VD52G_MISS="$VD52G_MISS $VD52G_K"; done
    if [ -z "$VD52G_MISS" ]; then echo "PASS  the $VD52G_L changelog strings ($VD52G_LCH) carry all twelve 18 November entries"
    else echo "FAIL  the $VD52G_L changelog strings ($VD52G_LCH) lack$VD52G_MISS: the publish did not ship the 18 November entries in $VD52G_L"; fi
  done
fi
