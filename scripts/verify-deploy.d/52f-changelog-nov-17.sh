# shellcheck shell=bash
# ── 52f. THE CHANGELOG OF 17 NOVEMBER: six entries for the deploy that went
# live and verified on 17 November (the free scan's own-language reading, the
# board's next build and the frontend with it). They were written after that
# deploy verified and ship in the frontend publish that follows. Each claim was
# read against the live site on 17 November, read-only: the free scan's live
# build stamp with the code at that build (no scan was run), job-board probes
# of the oversize lists, the bulk boards, the kept twins and the country
# filter, the site's own company name list, and the crawler copies of a job
# page in capitals and of a staff-only posting.
#
# BEFORE AND AFTER THAT PUBLISH. The US English changelog chunk the browser
# loads (scripts/verify-us-english.sh, never en-GB) tells the two apart, found
# as section 52e finds it; once it carries this batch's first key the publish
# has happened. Before it, every line is INFO.
#
# THE TITLES AND THEIR DATE. After the publish each title is on the crawler
# page dated 2026-11-17. A later batch can push a title past the newest 30
# entries that page lists: then the US chunk must carry it and the page must
# list 30 entries, none older than 2026-11-17. A bake from before them, or a
# title lost from the list, still FAILs.
#
# THE NEWEST ENTRY. After the publish, the page description's "Latest (<date>)"
# must be 2026-11-17 or later.
#
# THE DESCRIPTIONS. A title can stay while its description is reworded into a
# claim nobody read. After the publish the US chunk must carry, for each entry,
# the words that hold the limit its live read set (one string each, found once
# in the whole US shard, so the match is that entry's).
#
# THE OTHER EIGHT LANGUAGES. The owner's rule ships every entry in all nine.
# After the publish, each language's changelog chunk (the <lang>-<hash>.js the
# entry names that carries workdayCompanyPagesLostTheirFacts, found the way the
# US one is) must carry all six keys. These chunks are read only after the
# publish, and never in place of the US one.
#
# Its own names only: every variable here starts VD52F_, because the sections
# share one shell and K, RB, B, SITE and UA belong to every section after it.
#
# Read-only: crawler GETs of /changelog and the home page, and GETs of the entry
# script and its chunks. Nothing is sent, bought or written.
echo "== 52f. changelog of 17 November on the crawler copy of /changelog =="
VD52F_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
VD52F_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD52F_US=""
VD52F_CH=""
for VD52F_CX in $(bash scripts/verify-us-english.sh "$SITE$VD52F_MAIN"); do
  VD52F_TRY=$(curl -s -m 30 "$SITE/assets/$VD52F_CX")
  printf '%s' "$VD52F_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  VD52F_US=$VD52F_TRY
  VD52F_CH=$VD52F_CX
  break
done
VD52F_PUB=0
if [ -z "$VD52F_US" ]; then
  echo "FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts (the frontend is not serving, or the bundle layout moved): nothing below can tell a published batch from an unpublished one"
elif printf '%s' "$VD52F_US" | grep -q "aResumeInAnotherLanguageIsNoLongerScoredAsEnglish"; then
  VD52F_PUB=1
  echo "PASS  the US English changelog chunk ($VD52F_CH) carries the 17 November entries: the frontend publish has happened, so every line below is judged"
else
  echo "INFO  the US English changelog chunk ($VD52F_CH) does not carry the 17 November entries yet: their frontend publish has not happened, so every line below is INFO"
fi

VD52F_DATES=$(printf '%s' "$VD52F_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2' | cut -c1-10)
VD52F_N=$(printf '%s' "$VD52F_DATES" | grep -c '^[0-9]')
VD52F_OLDEST=$(printf '%s\n' "$VD52F_DATES" | sort | head -1)
while IFS='|' read -r VD52F_D VD52F_T; do
  [ -n "$VD52F_T" ] || continue
  VD52F_ROW=$(printf '%s' "$VD52F_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2[^>]*>[^<]*<' | grep -F ">$VD52F_T<" | head -1 | cut -c1-10)
  if [ -n "$VD52F_ROW" ] && [ "$VD52F_ROW" = "$VD52F_D" ]; then echo "PASS  /changelog serves crawlers \"$VD52F_T\", dated $VD52F_D"
  elif [ "$VD52F_PUB" != 1 ]; then echo "INFO  /changelog does not serve \"$VD52F_T\" yet (the frontend publish after this deploy's record has not happened)"
  elif [ -n "$VD52F_ROW" ]; then echo "FAIL  /changelog dates \"$VD52F_T\" $VD52F_ROW, want $VD52F_D, the day its deploy went live"
  elif ! printf '%s' "$VD52F_US" | grep -qF "$VD52F_T"; then echo "FAIL  the 17 November entries are published, but neither /changelog nor the US English changelog strings carry \"$VD52F_T\" (an entry was dropped or retitled when it landed)"
  elif [ "$VD52F_N" -ge 30 ] && [ ! "$VD52F_OLDEST" \< "$VD52F_D" ]; then echo "PASS  \"$VD52F_T\" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it"
  else echo "FAIL  the US English changelog strings carry \"$VD52F_T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"; fi
done <<'VD52F_TITLES'
2026-11-17|The free scan no longer scores a résumé in one of eight other languages as if it were English
2026-11-17|Several employers whose job lists were too big for us now show their jobs
2026-11-17|Boards that posted jobs in bulk, and second copies of the same jobs, leave the board
2026-11-17|More jobs filed under Hong Kong, Nigeria, Kazakhstan, Jordan and Lebanon, and US pay in US dollars
2026-11-17|Job titles typed in capitals, and logo captions printed as the employer
2026-11-17|Jobs only an employer's own staff may apply for are no longer offered to search engines as openings
VD52F_TITLES

VD52F_LATEST=$(printf '%s' "$VD52F_CL" | grep -oE 'Latest \([0-9]{4}-[0-9]{2}-[0-9]{2}\)' | head -1 | cut -c9-18)
if [ "$VD52F_PUB" != 1 ]; then echo "INFO  the date of the newest entry the page describes is judged after the publish"
elif [ -z "$VD52F_LATEST" ]; then echo "FAIL  /changelog's description names no newest entry (the bake fell back to its no-entries sentence, or its markup moved)"
elif [ "$VD52F_LATEST" \< "2026-11-17" ]; then echo "FAIL  /changelog's description names an entry of $VD52F_LATEST as the newest, older than this batch's 2026-11-17 (the prerender did not rebuild)"
else echo "PASS  /changelog's description names an entry of $VD52F_LATEST as the newest, no older than this batch's 2026-11-17"; fi

while IFS='|' read -r VD52F_K VD52F_M; do
  [ -n "$VD52F_M" ] || continue
  if [ "$VD52F_PUB" != 1 ]; then echo "INFO  the description of $VD52F_K is judged after the publish"
  elif printf '%s' "$VD52F_US" | grep -qF "$VD52F_M"; then echo "PASS  the US English changelog strings describe $VD52F_K with \"$VD52F_M\""
  else echo "FAIL  the US English changelog strings carry no \"$VD52F_M\" for $VD52F_K: its description is not the one read live on 17 November"; fi
done <<'VD52F_MUST'
aResumeInAnotherLanguageIsNoLongerScoredAsEnglish|for at least two of experience, education and skills
severalEmployersWhoseListsWereTooBigNowShowTheirJobs|in a way that copes with their size
boardsThatPostedInBulkAndSecondCopiesOfJobsLeaveTheBoard|so the same job could be listed twice
moreJobsFiledInTheirOwnCountryAndUsPayInUsDollars|Nigeria, Kazakhstan, Jordan or Lebanon
jobPagesWriteCapitalsTitlesNormallyAndNoLogoNamesTheEmployer|the trail of links above the heading
jobsOnlyStaffMayApplyForAreNotOfferedToSearchEngines|and their pages still open
VD52F_MUST

VD52F_KEYS="aResumeInAnotherLanguageIsNoLongerScoredAsEnglish severalEmployersWhoseListsWereTooBigNowShowTheirJobs boardsThatPostedInBulkAndSecondCopiesOfJobsLeaveTheBoard moreJobsFiledInTheirOwnCountryAndUsPayInUsDollars jobPagesWriteCapitalsTitlesNormallyAndNoLogoNamesTheEmployer jobsOnlyStaffMayApplyForAreNotOfferedToSearchEngines"
if [ "$VD52F_PUB" != 1 ]; then
  echo "INFO  the other eight languages' changelog strings are judged after the publish"
else
  VD52F_ENTRY=$(curl -s -m 60 "$SITE$VD52F_MAIN")
  for VD52F_L in en-GB de es fr hi nl pt tl; do
    VD52F_LC=""
    VD52F_LCH=""
    for VD52F_LCX in $(printf '%s' "$VD52F_ENTRY" | grep -oE "\"\\./$VD52F_L-[A-Za-z0-9_-]+\\.js\"" | tr -d '"' | sed 's|^\./||' | sort -u); do
      VD52F_TRY=$(curl -s -m 30 "$SITE/assets/$VD52F_LCX")
      printf '%s' "$VD52F_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
      VD52F_LC=$VD52F_TRY
      VD52F_LCH=$VD52F_LCX
      break
    done
    if [ -z "$VD52F_LC" ]; then echo "FAIL  no $VD52F_L changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 17 November entries cannot be shown in $VD52F_L"; continue; fi
    VD52F_MISS=""
    for VD52F_K in $VD52F_KEYS; do printf '%s' "$VD52F_LC" | grep -q "$VD52F_K" || VD52F_MISS="$VD52F_MISS $VD52F_K"; done
    if [ -z "$VD52F_MISS" ]; then echo "PASS  the $VD52F_L changelog strings ($VD52F_LCH) carry all six 17 November entries"
    else echo "FAIL  the $VD52F_L changelog strings ($VD52F_LCH) lack$VD52F_MISS: the publish did not ship the 17 November entries in $VD52F_L"; fi
  done
fi
