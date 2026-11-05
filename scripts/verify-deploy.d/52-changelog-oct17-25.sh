# The twelve changelog entries dated 2026-10-17 (R1), 2026-10-18 (company
# profiles and the design upgrade) and 2026-10-25 (the company-page hotfix).
# They ship in the next frontend publish. Read-only: one crawler GET of
# /changelog, and the US English changelog chunk the browser loads (never
# en-GB), which tells a publish whose prerender did not rebuild apart from no
# publish at all.
#
# PAST THE NEWEST 30. The crawler page lists only the newest 30 entries, so the
# seven of 2 November pushed some of these off it. A title the page does not
# list passes only when the US chunk carries it and the page really lists 30
# entries that are all at least as new as it: a bake from before the title, or
# a title lost from the middle of the list, leaves older entries on the page
# and still FAILs.
echo "== 52. changelog of 17, 18 and 25 October on the crawler copy of /changelog =="
CL52=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
CL52_BODY=""
CL52_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
for CH in $(bash scripts/verify-us-english.sh "$SITE$CL52_MAIN"); do
  CL52_TRY=$(curl -s -m 30 "$SITE/assets/$CH")
  printf '%s' "$CL52_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  CL52_BODY=$CL52_TRY
  break
done
CL52_DATES=$(printf '%s' "$CL52" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2' | cut -c1-10)
CL52_N=$(printf '%s' "$CL52_DATES" | grep -c '^[0-9]')
CL52_OLDEST=$(printf '%s\n' "$CL52_DATES" | sort | head -1)
while IFS='|' read -r CL52_D CL52_T; do
  [ -n "$CL52_T" ] || continue
  if printf '%s' "$CL52" | grep -qF "$CL52_T"; then echo "PASS  /changelog serves crawlers \"$CL52_T\""
  elif [ -n "$CL52_BODY" ] && printf '%s' "$CL52_BODY" | grep -qF "$CL52_T"; then
    if [ "$CL52_N" -ge 30 ] && [ ! "$CL52_OLDEST" \< "$CL52_D" ]; then echo "PASS  \"$CL52_T\" is past the newest 30 entries the crawler page lists, and the English changelog strings the browser loads carry it"
    else echo "FAIL  the English changelog strings the browser loads carry \"$CL52_T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"; fi
  else echo "FAIL  /changelog does not serve \"$CL52_T\" (the frontend has not been published since the changelog for 17 to 25 October merged)"; fi
done <<'CL52_TITLES'
2026-10-25|Workday company pages were missing their facts for a week
2026-10-25|What a company page says when it lists no roles
2026-10-18|Company pages lead with the jobs, and their figures say what they count
2026-10-18|A posting's own page says what each fact rests on
2026-10-18|The top of our home page, and the copy crawlers and AI assistants read, stopped saying an agent applies for you
2026-10-18|A calmer design, in one dark color scheme
2026-10-17|is on the sign-in page
2026-10-17|Sign in with Google, and a guard against accounts set up with your address
2026-10-17|The magic-link button is gone, and an emailed link waits for your click
2026-10-17|Sign-in and reset emails have a second sender
2026-10-17|Three privacy gaps around sign-in and purchases
2026-10-17|A lighter tab icon and share picture
CL52_TITLES
