# The twelve changelog entries dated 2026-10-17 (R1), 2026-10-18 (company
# profiles and the design upgrade) and 2026-10-25 (the company-page hotfix).
# They ship in the next frontend publish, and all twelve are among the newest
# 30 entries the crawler page lists, so each must be on it. Read-only: one
# crawler GET of /changelog, and the US English changelog chunk the browser
# loads (never en-GB), which tells a publish whose prerender did not rebuild
# apart from no publish at all.
echo "== 52. changelog of 17, 18 and 25 October on the crawler copy of /changelog =="
CL52=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
CL52_BODY=""
CL52_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
for CH in $(curl -s -m 30 "$SITE$CL52_MAIN" | grep -o '"\./en-[A-Za-z0-9_-]*\.js"' | tr -d '"' | sed 's|^\./||' | grep -v '^en-GB-' | sort -u); do
  CL52_TRY=$(curl -s -m 30 "$SITE/assets/$CH")
  printf '%s' "$CL52_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  CL52_BODY=$CL52_TRY
  break
done
for T in "Workday company pages were missing their facts for a week" \
         "What a company page says when it lists no roles" \
         "Company pages lead with the jobs, and their figures say what they count" \
         "A posting's own page says what each fact rests on" \
         "Our home page, and the copy AI assistants read, stopped saying an agent applies for you" \
         "A calmer design, in one dark color scheme" \
         "is on the sign-in page" \
         "Sign in with Google, and a guard against accounts set up with your address" \
         "The magic-link button is gone, and an emailed link waits for your click" \
         "Sign-in and reset emails have a second sender" \
         "Three privacy gaps around sign-in and purchases" \
         "A lighter tab icon and share picture"; do
  if printf '%s' "$CL52" | grep -qF "$T"; then echo "PASS  /changelog serves crawlers \"$T\""
  elif [ -n "$CL52_BODY" ] && printf '%s' "$CL52_BODY" | grep -qF "$T"; then echo "FAIL  the English changelog strings the browser loads carry \"$T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"
  else echo "FAIL  /changelog does not serve \"$T\" (the frontend has not been published since the changelog for 17 to 25 October merged)"; fi
done
