# shellcheck shell=bash
# ── 52c. THE CHANGELOG OF 2 NOVEMBER: seven entries for the deploy whose
# functions went live that day, written after it verified and shipped in the
# frontend publish that follows. Each claim was read against the live site on
# 5 November.
#
# BEFORE AND AFTER THAT PUBLISH. The US English changelog chunk the browser
# loads (scripts/verify-us-english.sh, never en-GB) tells the two apart: it is
# found by a key every recent publish carries
# (workdayCompanyPagesLostTheirFacts), and once it carries this batch's first
# key the publish has happened. Before it, every line is INFO.
#
# THE TITLES AND THE DATE. After the publish each title is on the crawler page,
# dated 2026-11-02, the day the functions went live. A later batch can push it
# past the newest 30 entries that page lists: then the US chunk must carry it
# and the page must list 30 entries, none older than that day. A bake from
# before them, or a title lost from the list, still FAILs.
#
# THE CORRECTION. The served entry of 2026-10-31 says results for four
# employers still show the old label. True that day and false now, so the
# names entry has to say those results now carry the new name.
#
# Read-only: crawler GETs of /changelog and the home page, and GETs of the entry
# script and its chunks. Nothing is sent, bought or written.
echo "== 52c. changelog of 2 November on the crawler copy of /changelog =="
VD52C_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
VD52C_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD52C_US=""
VD52C_CH=""
for CH in $(bash scripts/verify-us-english.sh "$SITE$VD52C_MAIN"); do
  VD52C_TRY=$(curl -s -m 30 "$SITE/assets/$CH")
  printf '%s' "$VD52C_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  VD52C_US=$VD52C_TRY
  VD52C_CH=$CH
  break
done
VD52C_PUB=0
if [ -z "$VD52C_US" ]; then
  echo "FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts (the frontend is not serving, or the bundle layout moved): nothing below can tell a published batch from an unpublished one"
elif printf '%s' "$VD52C_US" | grep -q "truistGeicoAndNordstromJoinTheBoard"; then
  VD52C_PUB=1
  echo "PASS  the US English changelog chunk ($VD52C_CH) carries the 2 November entries: the frontend publish has happened, so every line below is judged"
else
  echo "INFO  the US English changelog chunk ($VD52C_CH) does not carry the 2 November entries yet: their frontend publish has not happened, so every line below is INFO"
fi

VD52C_DATES=$(printf '%s' "$VD52C_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2' | cut -c1-10)
VD52C_N=$(printf '%s' "$VD52C_DATES" | grep -c '^[0-9]')
VD52C_OLDEST=$(printf '%s\n' "$VD52C_DATES" | sort | head -1)
VD52C_PAST=0
if [ "$VD52C_N" -ge 30 ] && [ ! "$VD52C_OLDEST" \< "2026-11-02" ]; then VD52C_PAST=1; fi
while IFS= read -r T; do
  [ -n "$T" ] || continue
  VD52C_ROW=$(printf '%s' "$VD52C_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2[^>]*>[^<]*<' | grep -F ">$T<" | head -1 | cut -c1-10)
  if [ -n "$VD52C_ROW" ] && [ "$VD52C_ROW" = "2026-11-02" ]; then echo "PASS  /changelog serves crawlers \"$T\", dated 2026-11-02"
  elif [ "$VD52C_PUB" != 1 ]; then echo "INFO  /changelog does not serve \"$T\" yet (the frontend publish after this deploy's record has not happened)"
  elif [ -n "$VD52C_ROW" ]; then echo "FAIL  /changelog dates \"$T\" $VD52C_ROW, want 2026-11-02, the day its functions went live"
  elif ! printf '%s' "$VD52C_US" | grep -qF "$T"; then echo "FAIL  the 2 November entries are published, but neither /changelog nor the US English changelog strings carry \"$T\" (an entry was dropped or retitled when it landed)"
  elif [ "$VD52C_PAST" = 1 ]; then echo "PASS  \"$T\" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it"
  else echo "FAIL  the US English changelog strings carry \"$T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"; fi
done <<'VD52C_TITLES'
Jobs at Truist, Geico, Nordstrom and Wawa join the board
Jobs an employer took down now leave our biggest boards
Job searches that read what you typed
Job details that read what the employer stated
Search results for Honeywell Aerospace, LCS and others now carry the new name
The job board stays put while you read
The free report's numbers and labels now agree
VD52C_TITLES

if [ "$VD52C_PUB" != 1 ]; then echo "INFO  the correction of the 31 October entry is judged after the publish"
elif printf '%s' "$VD52C_US" | grep -qF "those results now carry the new name"; then echo "PASS  the US English changelog says those results now carry the new name, correcting the entry of 2026-10-31"
else echo "FAIL  the US English changelog does not say those results now carry the new name, so the served entry of 2026-10-31 stands uncorrected"; fi
