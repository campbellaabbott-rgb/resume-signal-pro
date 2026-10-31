# shellcheck shell=bash
# ── 52b. THE CHANGELOG OF THE ONE DEPLOY (land/all): the seventeen entries of
# the R1 hotfix, the SEO round, wave 4, JPMorgan Chase, the trusted pages,
# trust round 3, the SPA job-markup gate (PR #51) and the homepage and
# pricing switch-over (PR #54). They do NOT ride in the deploy's merge:
# merging into main publishes the frontend by itself, ahead of the functions
# (land/all final recheck, 2026-10-31), and the owner's rule is that entries
# follow a verified deploy, dated the day its change went live. They wait in
# docs/changelog-pending/one-deploy.json, and the changelog step (deploy notes,
# after verify and --record-deploy) applies them with
# scripts/apply-pending-changelog.mjs in a frontend-only publish.
# With the twelve entries section 52 judges (17, 18 and 25 October) they are
# 29 of the newest 30 entries the crawler copy of /changelog lists, so each
# title must be on that page. Section 52 has no fallback for a title pushed
# past the newest 30: one more entry above these (an 18th) is the most the
# page can take before section 52 FAILs.
#
# BEFORE AND AFTER THAT PUBLISH. The US English changelog chunk the browser
# loads (scripts/verify-us-english.sh, never en-GB) tells the two apart: it
# is found by a key every recent publish carries
# (workdayCompanyPagesLostTheirFacts), and once it carries this batch's first
# key (theHomePageIsTheJobSearch) the publish has happened. Before it, every
# line below is INFO; after it, a missing title or a broken precondition of
# an entry's text is FAIL.
#
# THE DATE. Once published, the entries' date must lie between 2026-10-31
# (land/all's last change: nothing in it went live earlier) and the day
# docs/deploy-ledger.json verifiedDeploys recorded the deploy that serves
# job-board 2026-09-09.96 or later (the record follows the verify, which
# follows the day the change went live). Published with no such record is a
# FAIL: the entries went out before the deploy was verified. VD52B_LEDGER
# names another policy file (the tests' fixture).
#
# THE ENTRIES' PRECONDITIONS, judged after the publish, because the text is
# only true when they hold: the crawler /pricing prints no gate note
# ("Not on sale yet") and no "open soon" (the pricing and Pro entries say the
# Full Analysis and Pro are sold, and sales stay on: the owner, 2026-10-27);
# neither /pricing nor the changelog speaks of an EU/EEA/UK/India checkout
# refusal (land/all removed it, so the pricing entry was landed with
# --drop-territory: the owner, 2026-10-27, "Keep selling as today");
# agent_sender_public_status answers false (the retirement and
# apply-yourself entries say the agent is switched off and Resume Booster
# sends no application); and the functions whose behaviour the entries
# describe as live "from this update" serve those builds or later.
#
# Read-only: crawler GETs of /changelog and /pricing, GETs of the entry
# script and its chunks, one PostgREST GET of a reader (a read-only
# transaction), OPTIONS preflights (no function logic runs) and a read of the
# local docs/deploy-ledger.json. Nothing is sent, bought or written.
echo "== 52b. changelog of the one deploy (17 entries) on the crawler copy of /changelog =="
rm -f /tmp/vd_52b_agent.json
VD52B_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
VD52B_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VD52B_US=""
VD52B_CH=""
for CH in $(bash scripts/verify-us-english.sh "$SITE$VD52B_MAIN"); do
  VD52B_TRY=$(curl -s -m 30 "$SITE/assets/$CH")
  printf '%s' "$VD52B_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  VD52B_US=$VD52B_TRY
  VD52B_CH=$CH
  break
done
VD52B_PUB=0
if [ -z "$VD52B_US" ]; then
  echo "FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts (the frontend is not serving, or the bundle layout moved): nothing below can tell a published batch from an unpublished one"
elif printf '%s' "$VD52B_US" | grep -q "theHomePageIsTheJobSearch"; then
  VD52B_PUB=1
  echo "PASS  the US English changelog chunk ($VD52B_CH) carries this deploy's entries: the frontend publish has happened, so every line below is judged"
else
  echo "INFO  the US English changelog chunk ($VD52B_CH) does not carry this deploy's entries yet: the changelog step after the deploy verifies has not been published, so every line below is INFO"
fi

# Every title, on the crawler page.
while IFS= read -r T; do
  [ -n "$T" ] || continue
  if printf '%s' "$VD52B_CL" | grep -qF "$T"; then echo "PASS  /changelog serves crawlers \"$T\""
  elif [ "$VD52B_PUB" = 1 ] && printf '%s' "$VD52B_US" | grep -qF "$T"; then echo "FAIL  the US English changelog strings carry \"$T\", but the crawler copy of /changelog does not (the prerender did not rebuild, or newer entries pushed it past the newest 30)"
  elif [ "$VD52B_PUB" = 1 ]; then echo "FAIL  this deploy's entries are published, but neither /changelog nor the US English changelog strings carry \"$T\" (an entry was dropped or retitled when it landed)"
  else echo "INFO  /changelog does not serve \"$T\" yet (the changelog step after the deploy verifies has not been published)"; fi
done <<'VD52B_TITLES'
The home page is now the job search
A pricing page that starts with what is free
What we stopped selling, and the apply agent switched off
The writing tools count per account, and Pro is built around them
Apply yourself, with Claude or ChatGPT reading the form
Résumé fit scoring is free with a confirmed key
The free report stopped predicting outcomes and printing figures we did not measure
JPMorgan Chase's jobs join the board
Employers named by a logo file or a page label now carry their own names
Staffing-agency labels set right, and job feeds no longer listed twice
Jobs filed in the wrong country
Board searches for CVS, accountants, today's jobs and the best paid
The scanner reads more résumés and job links
Cover letters in the wrong language, and résumé files that garbled names
Your account page, safer account changes, and analytics that ask first
A second analysis in one tab, a throttled sign-in email and an expired reset link
Pages that hold still, and what search engines read
VD52B_TITLES

# The date the changelog step wrote, against the deploy's record, and the page's description, which quotes the newest title.
VD52B_LEDGER=${VD52B_LEDGER:-docs/deploy-ledger.json}
VD52B_REC=$(node -e 'let p={};try{p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{};const ok=(b)=>{const m=/^job-board\.(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(b||""));return !!m&&(m[1]>"2026-09-09"||(m[1]==="2026-09-09"&&Number(m[2])>=96))};const d=(p.verifiedDeploys||[]).filter((e)=>ok(e&&e.functions&&e.functions["job-board"])).map((e)=>String(e.date||"")).filter((x)=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();process.stdout.write(d[0]||"")' "$VD52B_LEDGER" 2>/dev/null)
if printf '%s' "$VD52B_CL" | grep -q "DATE_OF_DEPLOY"; then
  echo "FAIL  /changelog prints the placeholder DATE_OF_DEPLOY: the changelog step did not fill the entries' date"
elif [ "$VD52B_PUB" = 1 ]; then
  VD52B_DATE=$(printf '%s' "$VD52B_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2[^>]*>The home page is now the job search<' | head -1 | cut -c1-10)
  if [ -z "$VD52B_DATE" ]; then echo "FAIL  /changelog lists no date beside \"The home page is now the job search\""
  elif [ -z "$VD52B_REC" ]; then echo "FAIL  /changelog carries this deploy's entries (dated $VD52B_DATE), but $VD52B_LEDGER verifiedDeploys records no deploy serving job-board 2026-09-09.96 or later: the entries went out before the deploy was verified and recorded"
  elif [ "$VD52B_DATE" \< "2026-10-31" ]; then echo "FAIL  /changelog dates this deploy's entries $VD52B_DATE, before land/all's last change (2026-10-31): nothing they describe was live then"
  elif [ "$VD52B_DATE" \> "$VD52B_REC" ]; then echo "FAIL  /changelog dates this deploy's entries $VD52B_DATE, after the deploy was recorded ($VD52B_REC): an entry is dated by the day its change went live, which comes before the record"
  else echo "PASS  /changelog dates this deploy's entries $VD52B_DATE (the deploy was recorded $VD52B_REC)"; fi
  if printf '%s' "$VD52B_CL" | grep -qE 'Latest \([0-9]{4}-[0-9]{2}-[0-9]{2}\): The home page is now the job search\.'; then echo "PASS  /changelog's description names the newest entry, \"The home page is now the job search\""
  else echo "FAIL  /changelog's description does not name \"The home page is now the job search\" as the newest entry (another entry sits above it in changelog.ts, or the bake did not rebuild)"; fi
else
  echo "INFO  the entries' date and the page description are judged after the publish"
fi

# Preconditions of the entries' text.
VD52B_PR=$(curl -s -m 30 -A "$UA" "$SITE/pricing")
if [ "$VD52B_PUB" = 1 ]; then
  if [ -z "$VD52B_PR" ]; then echo "FAIL  the crawler copy of /pricing answered nothing, so the sale claims cannot be checked"
  elif printf '%s' "$VD52B_PR" | grep -q 'data-gate='; then echo "FAIL  the crawler /pricing prints a not-on-sale note ($(printf '%s' "$VD52B_PR" | grep -o 'data-gate="[a-zA-Z]*"' | sort -u | tr '\n' ' ')), but the pricing and Pro entries say the Full Analysis and Pro are sold: open FULL_ANALYSIS_ON_SALE and PRO_ON_SALE (src/config/sales-gate.ts) or correct both entries"
  elif printf '%s' "$VD52B_PR" | grep -qi 'open soon'; then echo "FAIL  the crawler /pricing says purchases open soon, but the changelog says the Full Analysis and Pro are sold"
  else echo "PASS  the crawler /pricing prints no not-on-sale note and no purchases-open-soon line, as the pricing and Pro entries say"; fi
  VD52B_PT=0; VD52B_CT=0
  printf '%s' "$VD52B_PR" | grep -q 'the EU, the EEA, the UK or India' && VD52B_PT=1
  printf '%s' "$VD52B_US" | grep -q 'Checkout now turns away buyers it places in the EU, the EEA, the UK or India' && VD52B_CT=1
  if [ "$VD52B_PT$VD52B_CT" = "00" ]; then echo "PASS  neither /pricing nor the changelog speaks of an EU/EEA/UK/India refusal: a buyer there checks out as on main (the owner, 2026-10-27: keep selling as today)"
  else
    [ "$VD52B_PT" = 1 ] && echo "FAIL  the crawler /pricing names the EU, the EEA, the UK or India as places checkout does not sell to, but land/all removed that refusal (the owner, 2026-10-27: keep selling as today): the switch-over's region copy is serving"
    [ "$VD52B_CT" = 1 ] && echo "FAIL  the changelog's pricing entry says checkout turns away buyers in the EU, the EEA, the UK or India, but that refusal does not ship: republish the entry without that sentence (apply-entries.py --drop-territory)"
  fi
else
  echo "INFO  the sale and territory claims are judged after the publish"
fi

curl -s -m 30 -o /tmp/vd_52b_agent.json "$B/rest/v1/rpc/agent_sender_public_status" -H "apikey: $K" -H "Authorization: Bearer $K"
VD52B_AG=$(tr -d ' \n\r' < /tmp/vd_52b_agent.json 2>/dev/null | head -c 80)
if [ "$VD52B_PUB" != 1 ]; then echo "INFO  agent_sender_public_status answers ${VD52B_AG:-nothing} (judged after the publish: the changelog says the apply agent is switched off)"
elif [ "$VD52B_AG" = "false" ]; then echo "PASS  agent_sender_public_status answers false, as the retirement and apply-yourself entries say (the agent is switched off and sends no application)"
elif [ "$VD52B_AG" = "true" ]; then echo "FAIL  agent_sender_public_status answers true, but the changelog says the apply agent is switched off and Resume Booster sends no application for anyone"
else echo "INFO  agent_sender_public_status answered ${VD52B_AG:-nothing}, neither true nor false: section 99 C10 judges the agent's switch"; fi

# The functions the entries describe as live from this update, at the build that does it or later.
for PAIR in "process-email-queue|2026-10-14|2|a throttled sign-in or reset email goes out through the second mail service at once" \
            "agent-mcp|2026-10-11|38|keyless tools, the 20,000-a-day allowance, applying yourself and free fit" \
            "job-board|2026-09-09|96|JPMorgan Chase, the names, the agency labels, the feeds, the countries and the board searches" \
            "public-api|2026-10-11|37|fit scoring free on a confirmed key" \
            "free-keyword-scan|2026-10-31|1|scans counted per account, the 60-an-hour visitors' allowance, and a report that asks the AI for no pass verdict, salary range or 6-second scan" \
            "create-subscription-checkout|2026-10-27|1|the unticked renewal box" \
            "delete-account|2026-10-14|25|deletion finds the plan after an address change and revokes keys" \
            "generate-cover-letter|2026-10-11|24|letters in the posting's language, checked against the résumé" \
            "parse-pdf|2026-10-11|26|spaced-out headings read as words" \
            "fetch-job-posting|2026-10-11|27|the job links the scanner now reads"; do
  FN=${PAIR%%|*}; REST=${PAIR#*|}; D=${REST%%|*}; REST=${REST#*|}; N=${REST%%|*}; WHY=${REST#*|}
  H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  if [ -z "$H" ]; then
    if [ "$VD52B_PUB" = 1 ]; then echo "FAIL  $FN preflight carries no x-fn-build, and the changelog describes $WHY as live"; else echo "INFO  $FN preflight carries no x-fn-build (judged after the publish)"; fi
  elif build_ge "$FN" "$H" "$D" "$N"; then echo "PASS  $FN x-fn-build = $H ($FN.$D.$N or later: $WHY)"
  elif [ "$VD52B_PUB" = 1 ]; then echo "FAIL  $FN x-fn-build = $H, older than $FN.$D.$N, but the published changelog describes $WHY as live"
  else echo "INFO  $FN x-fn-build = $H: $FN.$D.$N is not serving yet (the changelog step comes only after it serves and verifies)"; fi
done
