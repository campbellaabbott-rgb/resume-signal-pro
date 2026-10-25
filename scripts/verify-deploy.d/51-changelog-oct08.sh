# The four changelog entries dated 2026-10-08 (frontend publish only).
# Read-only: one crawler GET of /changelog, and, for an entry newer ones have
# pushed past the newest 30 the crawler page lists, the US English changelog
# chunk the browser loads (never en-GB, which spells résumé as CV).
echo "== 51. changelog of 8 October on the crawler copy of /changelog =="
CL51=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
CL51_US=""
CL51_LOADED=0
for T in "jobs are back, and a list too big for us is now read" \
         "Quotes from a résumé in another alphabet are now checked properly" \
         "Two emails sent you to a different website, and one said your résumé was never stored" \
         "What AI assistants could read about us"; do
  if printf '%s' "$CL51" | grep -qF "$T"; then echo "PASS  /changelog serves crawlers \"$T\""; continue; fi
  if [ "$CL51_LOADED" = 0 ]; then
    CL51_LOADED=1
    CL51_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
    for CH in $(curl -s -m 30 "$SITE$CL51_MAIN" | grep -o '"\./en-[A-Za-z0-9_-]*\.js"' | tr -d '"' | sed 's|^\./||' | grep -v '^en-GB-' | sort -u); do
      CL51_TRY=$(curl -s -m 30 "$SITE/assets/$CH")
      printf '%s' "$CL51_TRY" | grep -q "procterAndGambleCameBack" || continue
      CL51_US=$CL51_TRY
      break
    done
  fi
  if [ -n "$CL51_US" ] && printf '%s' "$CL51_US" | grep -qF "$T"; then echo "PASS  \"$T\" is past the newest 30 entries the crawler page lists, and the English changelog strings the browser loads carry it"
  else echo "FAIL  /changelog does not serve \"$T\" (frontend not published since PR #24)"; fi
done
