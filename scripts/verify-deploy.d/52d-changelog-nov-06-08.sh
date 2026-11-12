# shellcheck shell=bash
# ── 52d. THE CHANGELOG OF 6 AND 8 NOVEMBER: nine entries, eight for the deploy
# whose frontend and functions went live on 6 November and one for the upkeep
# deploy of 8 November. They were written after each deploy verified and ship
# in the frontend publish that follows. Each claim was read against the live
# site on 8 November.
#
# BEFORE AND AFTER THAT PUBLISH. The US English changelog chunk the browser
# loads (scripts/verify-us-english.sh, never en-GB) tells the two apart: it is
# found by a key every recent publish carries
# (workdayCompanyPagesLostTheirFacts), and once it carries this batch's first
# key the publish has happened. Before it, every line is INFO.
#
# THE TITLES AND THEIR DATES. After the publish each title is on the crawler
# page with its own date: 2026-11-08 for the refresh entry, 2026-11-06 for the
# other eight. A later batch can push a title past the newest 30 entries that
# page lists: then the US chunk must carry it and the page must list 30
# entries, none older than that title's date. A bake from before them, or a
# title lost from the list, still FAILs.
#
# THE NEWEST ENTRY. The page's description names its newest entry, "Latest
# (<date>): <title>". Section 52b checks that it names the first entry listed,
# which a stale bake also passes. Here, after the publish, that date must be
# 2026-11-08 or later.
#
# Read-only: crawler GETs of /changelog and the home page, and GETs of the entry
# script and its chunks. Nothing is sent, bought or written.
echo "== 52d. changelog of 6 and 8 November on the crawler copy of /changelog =="
VD52D_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
VD52D_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD52D_US=""
VD52D_CH=""
for CH in $(bash scripts/verify-us-english.sh "$SITE$VD52D_MAIN"); do
  VD52D_TRY=$(curl -s -m 30 "$SITE/assets/$CH")
  printf '%s' "$VD52D_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  VD52D_US=$VD52D_TRY
  VD52D_CH=$CH
  break
done
VD52D_PUB=0
if [ -z "$VD52D_US" ]; then
  echo "FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts (the frontend is not serving, or the bundle layout moved): nothing below can tell a published batch from an unpublished one"
elif printf '%s' "$VD52D_US" | grep -q "theBoardChecksEveryMinuteForAStoppedRefresh"; then
  VD52D_PUB=1
  echo "PASS  the US English changelog chunk ($VD52D_CH) carries the 6 and 8 November entries: the frontend publish has happened, so every line below is judged"
else
  echo "INFO  the US English changelog chunk ($VD52D_CH) does not carry the 6 and 8 November entries yet: their frontend publish has not happened, so every line below is INFO"
fi

VD52D_DATES=$(printf '%s' "$VD52D_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2' | cut -c1-10)
VD52D_N=$(printf '%s' "$VD52D_DATES" | grep -c '^[0-9]')
VD52D_OLDEST=$(printf '%s\n' "$VD52D_DATES" | sort | head -1)
while IFS='|' read -r VD52D_D T; do
  [ -n "$T" ] || continue
  VD52D_ROW=$(printf '%s' "$VD52D_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2[^>]*>[^<]*<' | grep -F ">$T<" | head -1 | cut -c1-10)
  if [ -n "$VD52D_ROW" ] && [ "$VD52D_ROW" = "$VD52D_D" ]; then echo "PASS  /changelog serves crawlers \"$T\", dated $VD52D_D"
  elif [ "$VD52D_PUB" != 1 ]; then echo "INFO  /changelog does not serve \"$T\" yet (the frontend publish after this deploy's record has not happened)"
  elif [ -n "$VD52D_ROW" ]; then echo "FAIL  /changelog dates \"$T\" $VD52D_ROW, want $VD52D_D, the day its deploy went live"
  elif ! printf '%s' "$VD52D_US" | grep -qF "$T"; then echo "FAIL  the 6 and 8 November entries are published, but neither /changelog nor the US English changelog strings carry \"$T\" (an entry was dropped or retitled when it landed)"
  elif [ "$VD52D_N" -ge 30 ] && [ ! "$VD52D_OLDEST" \< "$VD52D_D" ]; then echo "PASS  \"$T\" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it"
  else echo "FAIL  the US English changelog strings carry \"$T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"; fi
done <<'VD52D_TITLES'
2026-11-08|The job board checks every minute for a stopped refresh
2026-11-06|Our fonts now come from our own site
2026-11-06|A shared link can no longer delete a paid analysis
2026-11-06|A purchase link that doesn't open now usually says why
2026-11-06|Drafts for a job reopen without being written again
2026-11-06|The Interview Coach keeps each answer apart, and tailoring needs a real job
2026-11-06|Search and report emails come in the language you used
2026-11-06|Your account page says which search emails come daily
2026-11-06|The One-click apply filter is gone from Explore
VD52D_TITLES

VD52D_LATEST=$(printf '%s' "$VD52D_CL" | grep -oE 'Latest \([0-9]{4}-[0-9]{2}-[0-9]{2}\)' | head -1 | cut -c9-18)
if [ "$VD52D_PUB" != 1 ]; then echo "INFO  the date of the newest entry the page describes is judged after the publish"
elif [ -z "$VD52D_LATEST" ]; then echo "FAIL  /changelog's description names no newest entry (the bake fell back to its no-entries sentence, or its markup moved)"
elif [ "$VD52D_LATEST" \< "2026-11-08" ]; then echo "FAIL  /changelog's description names an entry of $VD52D_LATEST as the newest, older than this batch's 2026-11-08 (the prerender did not rebuild)"
else echo "PASS  /changelog's description names an entry of $VD52D_LATEST as the newest, no older than this batch's 2026-11-08"; fi
