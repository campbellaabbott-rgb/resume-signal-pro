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
# Read-only: crawler GETs of /changelog and the home page, and GETs of the entry
# script and its chunks. Nothing is sent, bought or written.
echo "== 52e. changelog of 15 November on the crawler copy of /changelog =="
VD52E_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
VD52E_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD52E_US=""
VD52E_CH=""
for CH in $(bash scripts/verify-us-english.sh "$SITE$VD52E_MAIN"); do
  VD52E_TRY=$(curl -s -m 30 "$SITE/assets/$VD52E_CH")
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

while IFS='|' read -r VD52E_K VD52E_M; do
  [ -n "$VD52E_M" ] || continue
  if [ "$VD52E_PUB" != 1 ]; then echo "INFO  the description of $VD52E_K is judged after the publish"
  elif printf '%s' "$VD52E_US" | grep -qF "$VD52E_M"; then echo "PASS  the US English changelog strings describe $VD52E_K with \"$VD52E_M\""
  else echo "FAIL  the US English changelog strings carry no \"$VD52E_M\" for $VD52E_K: its description is not the one read live on 15 November"; fi
done <<'VD52E_MUST'
aJobPageSaysWhenItsEmployerClosedThePosting|The copy of the page that search engines read also gives the day it was built.
companyPagesUseTheNameTheEmployerUses|in the page title and heading
theConnectPageSaysMoreAboutClaudeAndChatGpt|which can add one custom connector
theGhostJobIndexNoLongerCallsATakedownFilled|That heading and its explanation now come in the language you use on the site.
thePayTransparencyIndexNamesEachHiringSystem|such as iCIMS, UKG Pro Recruiting or ADP Workforce Now, instead of a short code
theFooterLinksOurDataPages|next to the Pay Transparency Index it already linked
VD52E_MUST

VD52E_KEYS="aJobPageSaysWhenItsEmployerClosedThePosting companyPagesUseTheNameTheEmployerUses theConnectPageSaysMoreAboutClaudeAndChatGpt theGhostJobIndexNoLongerCallsATakedownFilled thePayTransparencyIndexNamesEachHiringSystem theFooterLinksOurDataPages"
if [ "$VD52E_PUB" != 1 ]; then
  echo "INFO  the other eight languages' changelog strings are judged after the publish"
else
  VD52E_ENTRY=$(curl -s -m 60 "$SITE$VD52E_MAIN")
  for VD52E_L in en-GB de es fr hi nl pt tl; do
    VD52E_LC=""
    VD52E_LCH=""
    for VD52E_CH in $(printf '%s' "$VD52E_ENTRY" | grep -oE "\"\\./$VD52E_L-[A-Za-z0-9_-]+\\.js\"" | tr -d '"' | sed 's|^\./||' | sort -u); do
      VD52E_TRY=$(curl -s -m 30 "$SITE/assets/$VD52E_CH")
      printf '%s' "$VD52E_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
      VD52E_LC=$VD52E_TRY
      VD52E_LCH=$VD52E_CH
      break
    done
    if [ -z "$VD52E_LC" ]; then echo "FAIL  no $VD52E_L changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 15 November entries cannot be shown in $VD52E_L"; continue; fi
    VD52E_MISS=""
    for VD52E_K in $VD52E_KEYS; do printf '%s' "$VD52E_LC" | grep -q "$VD52E_K" || VD52E_MISS="$VD52E_MISS $VD52E_K"; done
    if [ -z "$VD52E_MISS" ]; then echo "PASS  the $VD52E_L changelog strings ($VD52E_LCH) carry all six 15 November entries"
    else echo "FAIL  the $VD52E_L changelog strings ($VD52E_LCH) lack$VD52E_MISS: the publish did not ship the 15 November entries in $VD52E_L"; fi
  done
fi
