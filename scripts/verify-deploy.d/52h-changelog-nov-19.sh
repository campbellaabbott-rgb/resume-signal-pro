# shellcheck shell=bash
# ── 52h. THE CHANGELOG OF 19 NOVEMBER: two entries for main at f3d7859a1 (PR
# #78), which went live and verified on 19 November: "Add to Claude" on the
# Connect your agent page, with the Claude steps naming the authentication
# choice, and Ashby's application form no longer read by the connector or the
# data API, nor asked for by the website. They were written after that deploy
# verified and ship in the frontend publish that follows. Each claim was read
# against the live site and the code at main on 19 November, read-only: the
# live /agents page and the chunks it loads (the install link carries
# modal=add-custom-connector, connectorName and connectorUrl, and the flag is
# on), the live board chunk (no ashby: among the question prefixes, the stop
# list read by the kit and by How applying works), the English and German
# string bundles (the kit's new note), the verify run's OD14-ASHBY-1,
# OD14-ASHBY-2 and HO-1 PASS lines with the two functions' builds, and Ashby's
# robots file. No sign-in, purchase, scan, model call or mail.
#
# BEFORE AND AFTER THAT PUBLISH. The US English changelog chunk the browser
# loads (scripts/verify-us-english.sh, never en-GB) tells the two apart, found
# as section 52g finds it; once it carries this batch's first key the publish
# has happened. Before it, every line is INFO.
#
# THE TITLES AND THEIR DATE. After the publish each title is on the crawler
# page dated 2026-11-19. A later batch can push a title past the newest 30
# entries that page lists: then the US chunk must carry it and the page must
# list 30 entries, none older than 2026-11-19. A bake from before them, or a
# title lost from the list, still FAILs.
#
# THE NEWEST ENTRY. After the publish, the page description's "Latest (<date>)"
# must be 2026-11-19 or later. The bake clamps that description at 160
# characters and this batch's first title is long enough to be cut: only the
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
# US one is) must carry both keys. These chunks are read only after the
# publish, and never in place of the US one.
#
# Its own names only: every variable here starts VD52H_, because the sections
# share one shell and K, RB, B, SITE and UA belong to every section after it.
#
# Read-only: crawler GETs of /changelog and the home page, and GETs of the entry
# script and its chunks. Nothing is sent, bought or written.
echo "== 52h. changelog of 19 November on the crawler copy of /changelog =="
VD52H_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
VD52H_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD52H_US=""
VD52H_CH=""
for VD52H_CX in $(bash scripts/verify-us-english.sh "$SITE$VD52H_MAIN"); do
  VD52H_TRY=$(curl -s -m 30 "$SITE/assets/$VD52H_CX")
  printf '%s' "$VD52H_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  VD52H_US=$VD52H_TRY
  VD52H_CH=$VD52H_CX
  break
done
VD52H_PUB=0
if [ -z "$VD52H_US" ]; then
  echo "FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts (the frontend is not serving, or the bundle layout moved): nothing below can tell a published batch from an unpublished one"
elif printf '%s' "$VD52H_US" | grep -q "addToClaudeOpensClaudesConnectorDialogFilledIn"; then
  VD52H_PUB=1
  echo "PASS  the US English changelog chunk ($VD52H_CH) carries the 19 November entries: the frontend publish has happened, so every line below is judged"
else
  echo "INFO  the US English changelog chunk ($VD52H_CH) does not carry the 19 November entries yet: their frontend publish has not happened, so every line below is INFO"
fi

VD52H_DATES=$(printf '%s' "$VD52H_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2' | cut -c1-10)
VD52H_N=$(printf '%s' "$VD52H_DATES" | grep -c '^[0-9]')
VD52H_OLDEST=$(printf '%s\n' "$VD52H_DATES" | sort | head -1)
while IFS='|' read -r VD52H_D VD52H_T; do
  [ -n "$VD52H_T" ] || continue
  VD52H_ROW=$(printf '%s' "$VD52H_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2[^>]*>[^<]*<' | grep -F ">$VD52H_T<" | head -1 | cut -c1-10)
  if [ -n "$VD52H_ROW" ] && [ "$VD52H_ROW" = "$VD52H_D" ]; then echo "PASS  /changelog serves crawlers \"$VD52H_T\", dated $VD52H_D"
  elif [ "$VD52H_PUB" != 1 ]; then echo "INFO  /changelog does not serve \"$VD52H_T\" yet (the frontend publish after this deploy's record has not happened)"
  elif [ -n "$VD52H_ROW" ]; then echo "FAIL  /changelog dates \"$VD52H_T\" $VD52H_ROW, want $VD52H_D, the day its deploy went live"
  elif ! printf '%s' "$VD52H_US" | grep -qF "$VD52H_T"; then echo "FAIL  the 19 November entries are published, but neither /changelog nor the US English changelog strings carry \"$VD52H_T\" (an entry was dropped or retitled when it landed)"
  elif [ "$VD52H_N" -ge 30 ] && [ ! "$VD52H_OLDEST" \< "$VD52H_D" ]; then echo "PASS  \"$VD52H_T\" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it"
  else echo "FAIL  the US English changelog strings carry \"$VD52H_T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"; fi
done <<'VD52H_TITLES'
2026-11-19|Add to Claude opens Claude's connector dialog with our name and address filled in
2026-11-19|Our connector and data API no longer read Ashby application forms, and our site no longer asks for them
VD52H_TITLES

VD52H_LATEST=$(printf '%s' "$VD52H_CL" | grep -oE 'Latest \([0-9]{4}-[0-9]{2}-[0-9]{2}\)' | head -1 | cut -c9-18)
if [ "$VD52H_PUB" != 1 ]; then echo "INFO  the date of the newest entry the page describes is judged after the publish"
elif [ -z "$VD52H_LATEST" ]; then echo "FAIL  /changelog's description names no newest entry (the bake fell back to its no-entries sentence, or its markup moved)"
elif [ "$VD52H_LATEST" \< "2026-11-19" ]; then echo "FAIL  /changelog's description names an entry of $VD52H_LATEST as the newest, older than this batch's 2026-11-19 (the prerender did not rebuild)"
else echo "PASS  /changelog's description names an entry of $VD52H_LATEST as the newest, no older than this batch's 2026-11-19"; fi

while IFS='|' read -r VD52H_K VD52H_M; do
  [ -n "$VD52H_M" ] || continue
  if [ "$VD52H_PUB" != 1 ]; then echo "INFO  the description of $VD52H_K is judged after the publish"
  elif printf '%s' "$VD52H_US" | grep -qF "$VD52H_M"; then echo "PASS  the US English changelog strings describe $VD52H_K with \"$VD52H_M\""
  else echo "FAIL  the US English changelog strings carry no \"$VD52H_M\" for $VD52H_K: its description is not the one read live on 19 November"; fi
done <<'VD52H_MUST'
addToClaudeOpensClaudesConnectorDialogFilledIn|then you check both and add the connector yourself
ashbyApplicationFormsAreNoLongerReadOrAskedFor|when you apply yourself with Claude or Claude Code through our connector
VD52H_MUST

VD52H_KEYS="addToClaudeOpensClaudesConnectorDialogFilledIn ashbyApplicationFormsAreNoLongerReadOrAskedFor"
if [ "$VD52H_PUB" != 1 ]; then
  echo "INFO  the other eight languages' changelog strings are judged after the publish"
else
  VD52H_ENTRY=$(curl -s -m 60 "$SITE$VD52H_MAIN")
  for VD52H_L in en-GB de es fr hi nl pt tl; do
    VD52H_LC=""
    VD52H_LCH=""
    for VD52H_LCX in $(printf '%s' "$VD52H_ENTRY" | grep -oE "\"\\./$VD52H_L-[A-Za-z0-9_-]+\\.js\"" | tr -d '"' | sed 's|^\./||' | sort -u); do
      VD52H_TRY=$(curl -s -m 30 "$SITE/assets/$VD52H_LCX")
      printf '%s' "$VD52H_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
      VD52H_LC=$VD52H_TRY
      VD52H_LCH=$VD52H_LCX
      break
    done
    if [ -z "$VD52H_LC" ]; then echo "FAIL  no $VD52H_L changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 19 November entries cannot be shown in $VD52H_L"; continue; fi
    VD52H_MISS=""
    for VD52H_K in $VD52H_KEYS; do printf '%s' "$VD52H_LC" | grep -q "$VD52H_K" || VD52H_MISS="$VD52H_MISS $VD52H_K"; done
    if [ -z "$VD52H_MISS" ]; then echo "PASS  the $VD52H_L changelog strings ($VD52H_LCH) carry both 19 November entries"
    else echo "FAIL  the $VD52H_L changelog strings ($VD52H_LCH) lack$VD52H_MISS: the publish did not ship the 19 November entries in $VD52H_L"; fi
  done
fi
