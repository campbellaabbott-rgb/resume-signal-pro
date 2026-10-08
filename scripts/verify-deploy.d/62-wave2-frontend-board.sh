# Wave 2, frontend-board (branch wave2/frontend-board): the board, the posting
# page, /explore, /companies and the saved-search pills. A FRONTEND-ONLY deploy
# -- no edge function, no migration -- so every claim is judged in the bundle
# the browser loads: the main entry names each lazy page chunk, and each chunk
# is fetched and searched for a string literal the fix introduced (literals and
# object keys survive minification; local names do not). Fixes that are pure
# logic with no literal of their own ride the same chunk as a marker that is,
# and are named on the chunk's line. Sourced by scripts/verify-deploy.sh.
# Read-only: GETs of public pages and static assets. Nothing is sent or written.
echo "== 62. wave 2 frontend-board: board, posting page, explore, companies =="

FB_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
FB_MAINJS=$(curl -s -m 30 "$SITE$FB_MAIN")
fb_chunk() { printf '%s' "$FB_MAINJS" | grep -o "\"\./$1-[A-Za-z0-9_-]*\.js\"" | head -1 | tr -d '"' | sed 's|^\./||'; }
FB_JOBS=$(fb_chunk Jobs); FB_POST=$(fb_chunk JobPosting); FB_EXPL=$(fb_chunk Explore); FB_COMP=$(fb_chunk Companies)
if [ -z "$FB_MAIN" ] || [ -z "$FB_JOBS" ]; then
  echo "FAIL  could not locate the board chunk from the live entry ($FB_MAIN) -- nothing below can be judged"
else
  JOBSJS=$(curl -s -m 30 "$SITE/assets/$FB_JOBS")
  POSTJS=$(curl -s -m 30 "$SITE/assets/$FB_POST")
  EXPLJS=$(curl -s -m 30 "$SITE/assets/$FB_EXPL")
  COMPJS=$(curl -s -m 30 "$SITE/assets/$FB_COMP")
  fb_has() { printf '%s' "$1" | grep -qF -- "$2"; }

  # L2-17: the board stamps its own history entries and remounts on navigation.
  # Same chunk carries L2-01 (lander answer), L2-02 (field count), L2-03 (facet
  # race), L2-12 (chip name), L8-08 (folded typeahead), L12-05 (order claim).
  if fb_has "$JOBSJS" "rbBoard"; then echo "PASS  $FB_JOBS stamps board history entries (rbBoard): links between board pages load the new board"
  else echo "FAIL  $FB_JOBS has no rbBoard stamp: the wave-2 board bundle is not serving (in-app links still leave the old board on screen)"; fi

  # L2-18 / L2-16: a 404 is 'no longer listed on this board'; a failed read retries.
  if fb_has "$JOBSJS" "jobsPage.unlistedLink" && fb_has "$JOBSJS" "jobsPage.deepLinkFailed"; then echo "PASS  dead ?job= links say 'no longer listed on this board' and a failed read offers a retry"
  else echo "FAIL  the board chunk lacks jobsPage.unlistedLink / deepLinkFailed: dead links still claim 'filled or taken down'"; fi

  # L2-15: a failed verify is our failure, and 'logged' only when the report landed.
  if fb_has "$JOBSJS" "jobsPage.reportCheckFailedTitle" && fb_has "$JOBSJS" "jobsPage.reportUnsentTitle"; then echo "PASS  a gone report names our own failed check and never calls an unsent report logged"
  else echo "FAIL  the board chunk lacks reportCheckFailedTitle / reportUnsentTitle"; fi

  # L2-13: the palette's scan entry goes to the uploader's anchor.
  if fb_has "$JOBSJS" '/#scan'; then echo "FAIL  the board chunk still sends the palette's scan entry to /#scan"
  else echo "PASS  the palette's scan entry no longer targets /#scan"; fi

  # L4-04: a secondary-board lander passes the bake's primary as its canonical.
  if fb_has "$JOBSJS" "canonicalPath"; then echo "PASS  the board passes canonicalPath to its head: secondary-board landers keep one canonical"
  else echo "FAIL  the board chunk has no canonicalPath: secondary-board landers still render two canonicals"; fi

  # The discovery-order label and its claims name both halves of the order.
  if fb_has "$JOBSJS" "jobsPage.sortDiscovered2" && ! fb_has "$JOBSJS" '"jobsPage.sortDiscovered"'; then echo "PASS  the discovery sort is labelled by what it orders (sortDiscovered2), the 'Recently found by us' key is gone"
  else echo "FAIL  the board chunk still reads jobsPage.sortDiscovered ('Recently found by us')"; fi

  # L2-19 / L2-07 / L2-20: the posting page.
  if [ -z "$FB_POST" ]; then echo "FAIL  no JobPosting chunk named by the live entry"
  elif fb_has "$POSTJS" "jobPostingPage.noPayFound"; then echo "PASS  $FB_POST says WE found no pay figure (never 'this employer states no pay'); the 404 and gone-only-on-gone fixes ride this chunk"
  else echo "FAIL  $FB_POST still reads jobPostingPage.noPay: the posting-page fixes (404 as gone, head kept while loading) are not serving"; fi

  # L2-04 / L2-05 / L2-09: /explore. The old employer-check link was a template
  # literal for tokens[0]'s lander ("/jobs/company/${...}?from=explore"); the
  # new one is built per scope and leaves no such template in the chunk.
  if [ -z "$FB_EXPL" ]; then echo "FAIL  no Explore chunk named by the live entry"
  elif fb_has "$EXPLJS" '?from=explore&back='; then echo "FAIL  $FB_EXPL still links the employer check to tokens[0]'s lander: the check's count does not survive the click"
  else echo "PASS  $FB_EXPL builds the employer check's links per scope (group-scoped board for multi-board employers); closure-read release and budget notice ride this chunk"; fi

  # L2-09: /companies and /explore render the board's own budget notice on a
  # refusal. The notice is its own chunk; a page that renders it imports it.
  if [ -z "$FB_COMP" ]; then echo "FAIL  no Companies chunk named by the live entry"
  elif fb_has "$COMPJS" '"./BoardBudgetNotice-'; then echo "PASS  $FB_COMP imports the board-budget notice: a refusal reads as the board's pause, not an empty list"
  else echo "FAIL  $FB_COMP does not import the board-budget notice: a refused /companies still renders an empty list"; fi
  if [ -n "$FB_EXPL" ] && fb_has "$EXPLJS" '"./BoardBudgetNotice-'; then echo "PASS  $FB_EXPL imports the board-budget notice: a refusal is not called 'our measurement failing'"
  else echo "FAIL  $FB_EXPL does not import the board-budget notice: a refused /explore still blames itself and re-fires probes"; fi

  # The English strings the browser loads carry the retired-and-reminted keys.
  FB_EN_OK=0
  for CH in $(printf '%s' "$FB_MAINJS" | grep -o '"\./en-[A-Za-z0-9_-]*\.js"' | tr -d '"' | sed 's|^\./||' | sort -u); do
    FB_EN=$(curl -s -m 30 "$SITE/assets/$CH")
    printf '%s' "$FB_EN" | grep -q "sortDiscovered2" || continue
    if printf '%s' "$FB_EN" | grep -q "Newest, undated by our date" && ! printf '%s' "$FB_EN" | grep -q "Recently found by us"; then FB_EN_OK=1; fi
    break
  done
  if [ "$FB_EN_OK" = 1 ]; then echo "PASS  the English strings name the discovery order truthfully ('Newest, undated by our date')"
  else echo "FAIL  the English strings the browser loads still say 'Recently found by us' (or carry no sortDiscovered2)"; fi
fi

# What a bake cannot show: the pages' crawler HTML is the prerender's, which
# this deploy does not change (the bake's own no-pay sentence and its dotted
# company hrefs belong to seo-content-i18n).
echo "INFO  frontend-board ships no edge function and no migration; the bake's no-pay sentence and dotted-token hrefs are seo-content-i18n's half"
