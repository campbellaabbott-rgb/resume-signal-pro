# The four changelog entries dated 2026-10-08 (frontend publish only).
# Read-only: one crawler GET of /changelog.
echo "== 51. changelog of 8 October on the crawler copy of /changelog =="
CL51=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
for T in "jobs are back, and a list too big for us is now read" \
         "Quotes from a résumé in another alphabet are now checked properly" \
         "Two emails sent you to a different website, and one said your résumé was never stored" \
         "What AI assistants could read about us"; do
  if printf '%s' "$CL51" | grep -qF "$T"; then echo "PASS  /changelog serves crawlers \"$T\""
  else echo "FAIL  /changelog does not serve \"$T\" (frontend not published since PR #24)"; fi
done
