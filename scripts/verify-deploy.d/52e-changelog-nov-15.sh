# shellcheck shell=bash
# ── 52e. THE CHANGELOG OF 15 NOVEMBER: six entries for the deploy whose
# migrations and functions went live on 15 November, the same day the frontend
# of that round was published. They were written after the deploy verified and
# ship in the frontend publish that follows. Each claim was read against the
# live site on 15 November: the crawler copy of a closed posting's page, four
# company pages, /agents and /pay-transparency, and the browser's own footer,
# Ghost Job Index and connect-page strings in all nine languages.
#
# BEFORE AND AFTER THAT PUBLISH. The US English changelog chunk the browser
# loads (scripts/verify-us-english.sh, never en-GB) tells the two apart, found
# as section 52d finds it; once it carries this batch's first key the publish
# has happened. Before it, every line is INFO.
#
# THE TITLES AND THEIR DATE. After the publish each title is on the crawler
# page dated 2026-11-15. A later batch can push a title past the newest 30
# entries that page lists: then the US chunk must carry it and the page must
# list 30 entries, none older than 2026-11-15. A bake from before them, or a
# title lost from the list, still FAILs.
#
# THE NEWEST ENTRY. After the publish, the page description's "Latest (<date>)"
# must be 2026-11-15 or later.
#
# Read-only: crawler GETs of /changelog and the home page, and GETs of the entry
# script and its chunks. Nothing is sent, bought or written.
echo "== 52e. changelog of 15 November on the crawler copy of /changelog =="
VD52E_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
VD52E_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD52E_US=""
VD52E_CH=""
for CH in $(bash scripts/verify-us-english.sh "$SITE$VD52E_MAIN"); do
  VD52E_TRY=$(curl -s -m 30 "$SITE/assets/$CH")
  printf '%s' "$VD52E_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  VD52E_US=$VD52E_TRY
  VD52E_CH=$CH
  break
done
VD52E_PUB=0
if [ -z "$VD52E_US" ]; then
  echo "FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts (the frontend is not serving, or the bundle layout moved): nothing below can tell a published batch from an unpublished one"
elif printf '%s' "$VD52E_US" | grep -q "aJobPageSaysWhenItsEmployerClosedThePosting"; then
  VD52E_PUB=1
  echo "PASS  the US English changelog chunk ($VD52E_CH) carries the 15 November entries: the frontend publish has happened, so every line below is judged"
else
  echo "INFO  the US English changelog chunk ($VD52E_CH) does not carry the 15 November entries yet: their frontend publish has not happened, so every line below is INFO"
fi

VD52E_DATES=$(printf '%s' "$VD52E_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2' | cut -c1-10)
VD52E_N=$(printf '%s' "$VD52E_DATES" | grep -c '^[0-9]')
VD52E_OLDEST=$(printf '%s\n' "$VD52E_DATES" | sort | head -1)
while IFS='|' read -r VD52E_D T; do
  [ -n "$T" ] || continue
  VD52E_ROW=$(printf '%s' "$VD52E_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2[^>]*>[^<]*<' | grep -F ">$T<" | head -1 | cut -c1-10)
  if [ -n "$VD52E_ROW" ] && [ "$VD52E_ROW" = "$VD52E_D" ]; then echo "PASS  /changelog serves crawlers \"$T\", dated $VD52E_D"
  elif [ "$VD52E_PUB" != 1 ]; then echo "INFO  /changelog does not serve \"$T\" yet (the frontend publish after this deploy's record has not happened)"
  elif [ -n "$VD52E_ROW" ]; then echo "FAIL  /changelog dates \"$T\" $VD52E_ROW, want $VD52E_D, the day its deploy went live"
  elif ! printf '%s' "$VD52E_US" | grep -qF "$T"; then echo "FAIL  the 15 November entries are published, but neither /changelog nor the US English changelog strings carry \"$T\" (an entry was dropped or retitled when it landed)"
  elif [ "$VD52E_N" -ge 30 ] && [ ! "$VD52E_OLDEST" \< "$VD52E_D" ]; then echo "PASS  \"$T\" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it"
  else echo "FAIL  the US English changelog strings carry \"$T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"; fi
done <<'VD52E_TITLES'
2026-11-15|A job page says when the employer has closed the posting
2026-11-15|Company pages use the name the employer uses
2026-11-15|The “Connect your agent” page says more about Claude and ChatGPT
2026-11-15|The Ghost Job Index no longer calls a role taken down “filled”
2026-11-15|The Pay Transparency Index names each hiring system properly
2026-11-15|The footer links our data pages and ATS benchmarks
VD52E_TITLES

VD52E_LATEST=$(printf '%s' "$VD52E_CL" | grep -oE 'Latest \([0-9]{4}-[0-9]{2}-[0-9]{2}\)' | head -1 | cut -c9-18)
if [ "$VD52E_PUB" != 1 ]; then echo "INFO  the date of the newest entry the page describes is judged after the publish"
elif [ -z "$VD52E_LATEST" ]; then echo "FAIL  /changelog's description names no newest entry (the bake fell back to its no-entries sentence, or its markup moved)"
elif [ "$VD52E_LATEST" \< "2026-11-15" ]; then echo "FAIL  /changelog's description names an entry of $VD52E_LATEST as the newest, older than this batch's 2026-11-15 (the prerender did not rebuild)"
else echo "PASS  /changelog's description names an entry of $VD52E_LATEST as the newest, no older than this batch's 2026-11-15"; fi
