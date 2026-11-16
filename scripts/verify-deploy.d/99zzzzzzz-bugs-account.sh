# shellcheck shell=bash
# ── 99zzzzzzz-bugs-account. THE BUG ROUND OF 2026-11-08, LANE ACCOUNT
# (branch bugs/a-account): RC-S12-185, S14X-100, S14X-108, S14X-165,
# S14X-166, S14X-198, S14X-199, S14X-200, S14X-201, S14X-202, S14X-203,
# S14X-204, S14X-221, S14X-222, S14X-223, S14X-230, S14X-254, S14X-258, and
# the account halves of S14X-255 and S14X-285. Two functions at 2026-11-12.1
# (get-account-data, account-order; the integrator stamps them), no
# migration, and the account page, the agent page's panels and a new
# translation shard (src/i18n/shards/account), published by the merge itself.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE STAGES, read from production, never assumed:
#   functions  each function answers 2026-11-12.1 or later: the round's paste
#              is live. Until then an older build is INFO; one function at the
#              round's build while the other is older is a FAIL (one paste
#              carries both).
#   frontend   the published Account chunk, or the chunk the Agent page takes
#              its panels from, carries any of the lane's marks below: the
#              merge published. Until then every mark is INFO; from then on a
#              missing mark is a FAIL.
# No line waits on an owner: no key of this lane is owner-gated.
#
# THE CLAIMS, one line each:
#   F1  get-account-data serves 2026-11-12.1 or later: a Pro inclusion is one
#       order under its pro_ reference (S14X-108), statuses read what the
#       writers store and a product run on its own page reads 'open it to
#       run' (S14X-221), a granted Agent Pass leaves the orders list
#       (S14X-223), and the export action answers the rows only the server
#       can read (S14X-100).
#   F2  account-order serves 2026-11-12.1 or later: it opens a pro_ reference
#       (S14X-108) and mails a Full Analysis again through the analysis mail
#       (S14X-222).
#   A1  S14X-258: a failed read of scans or applications says so, with a
#       retry, instead of an empty tracker (accountView.trackerLoadFailed).
#   A2  S14X-203: a tracked posting with no closure answer reads 'not checked
#       yet', never 'still open' (accountView.lifecycleNotChecked).
#   A3  S14X-204: the fit check names its hourly limit on a 429
#       (accountView.fitCheckHourly).
#   A4  S14X-230: a refused delete renders the billing link the server
#       returned (portalLoginUrl).
#   A5  RC-S12-185: the reply-window chip quotes a share only on the employer
#       page's fill basis (ceilingBasis compared with "fills").
#   A6  S14X-166: the save-this-resume answer is kept per resume text, not per
#       tab (the rb_last_resume_decided_by_text: key).
#   A7  S14X-223: a past Agent Pass reads as retired with the way to a refund
#       (accountView.passRetired).
#   A8  S14X-221: the orders list knows the open_to_run status.
#   A9  S14X-100: 'Download all my data' reads the server's records
#       (serverRecords).
#   A10 S14X-285 (account half): the gap report's hand-off to the builder
#       names the resume it was made for (a fingerprint in rb_scan_fixes).
#   Q1  S14X-165: leftover packets read 'not sent, the agent is switched off'
#       (accountView.queueRetired, in the agent panels chunk).
#   Q2  S14X-199: the agent settings tab shows what is stored and deletes it,
#       taking no CV upload while the agent is off
#       (accountView.agentProfileRetired, in the agent panels chunk).
#   D1  S14X-255 (account half): the Account chunk lets the browser pick the
#       language of at most 3 dates or counts (ProSubscriptionCard's,
#       ConnectedAIsCard's and SavedSearchesCard's, other lanes' files; 18 on
#       2026-11-15), and the agent panels chunk of none (3 on 2026-11-15).
#   S1  S14X-254: the entry names the English account shard and eight lazy
#       account-shard chunks, each carrying the tracker's follow-up draft,
#       posting, interview and agent strings.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: a posting that came down
# offers no 'Apply now' and is counted closed only when it came down
# (S14X-198, S14X-200, S14X-201: the-tracker-offers-no-apply-on-a-posting-
# that-came-down), a local scan the cloud already holds is not offered again
# (S14X-202: w4b-fix-the-account-asks-before-it-takes-this-browsers-scans-
# and-offers-the-last-resume), and each function's behaviour behind its
# build (download-all-my-data-includes-what-only-the-server-can-read,
# w4b-an-order-answers-only-the-account-that-owns-it, w4b-fix-a-plan-is-not-
# an-order-and-a-price-names-its-currency, a-pass-buyer-read-no-purchases-
# and-more-credits-led-to-a-page-selling-none).
#
# READ-ONLY. Two OPTIONS preflights; GETs of the homepage, its entry, the
# Account and Agent chunks, the chunks the Agent page imports and the eight
# account-shard chunks. Nothing is posted.
echo "== 99zzzzzzz-bugs-account. bug round, account lane: orders say what they are, the tracker says only what it knows, the account strings exist in nine languages =="

rm -f /tmp/vd_bac_home.html /tmp/vd_bac_entry.js /tmp/vd_bac_acc.js /tmp/vd_bac_agt.js /tmp/vd_bac_cand.js /tmp/vd_bac_panels.js /tmp/vd_bac_shard.js

vdbac_build() { # $1 function -> the x-fn-build header, or empty
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

# F1, F2: both builds are read before either is judged.
VDBAC_GB=$(vdbac_build get-account-data)
VDBAC_OB=$(vdbac_build account-order)
VDBAC_G=old; [ -n "$VDBAC_GB" ] && build_ge get-account-data "$VDBAC_GB" 2026-11-12 1 && VDBAC_G=live
VDBAC_O=old; [ -n "$VDBAC_OB" ] && build_ge account-order "$VDBAC_OB" 2026-11-12 1 && VDBAC_O=live
vdbac_fn() { # $1 claim $2 function $3 header $4 stage $5 the other function $6 its stage $7 what it proves
  if [ -z "$3" ]; then echo "FAIL  $1 $2 preflight carries no x-fn-build (want $2.2026-11-12.1 or later)"
  elif [ "$4" = live ]; then echo "PASS  $1 $2 x-fn-build = $3 (2026-11-12.1 or later): $7"
  elif [ "$6" = live ]; then echo "FAIL  $1 $2 x-fn-build = $3, older than 2026-11-12.1, though $5 from the same paste is at the round's build: the paste carried one and not the other"
  else echo "INFO  $1 $2 x-fn-build = $3: the round's paste with 2026-11-12.1 has not landed (section 49 lists the gap)"; fi
}
vdbac_fn F1 get-account-data "$VDBAC_GB" "$VDBAC_G" account-order "$VDBAC_O" "a Pro inclusion is one order under its pro_ reference, statuses read what the writers store, a granted pass leaves the orders list, and the export answers the server's records (S14X-108, S14X-221, S14X-223, S14X-100)"
vdbac_fn F2 account-order "$VDBAC_OB" "$VDBAC_O" get-account-data "$VDBAC_G" "a pro_ reference opens, and a Full Analysis is mailed again through the analysis mail (S14X-108, S14X-222)"

# The published app: the entry, the Account and Agent chunks, and the chunk
# the Agent page takes its panels from (the one carrying applyProfile.title).
curl -s -m 30 "$SITE/" > /tmp/vd_bac_home.html
VDBAC_MAIN=$(grep -o '/assets/index-[^"]*\.js' /tmp/vd_bac_home.html | head -1)
[ -n "$VDBAC_MAIN" ] && curl -s -m 60 "$SITE$VDBAC_MAIN" > /tmp/vd_bac_entry.js
VDBAC_ACCN=$( { [ -f /tmp/vd_bac_entry.js ] && grep -oE 'Account-[A-Za-z0-9_-]+\.js' /tmp/vd_bac_entry.js; } | head -1)
VDBAC_AGTN=$( { [ -f /tmp/vd_bac_entry.js ] && grep -oE 'Agent-[A-Za-z0-9_-]+\.js' /tmp/vd_bac_entry.js; } | head -1)
[ -n "$VDBAC_ACCN" ] && curl -s -m 30 "$SITE/assets/$VDBAC_ACCN" > /tmp/vd_bac_acc.js
[ -n "$VDBAC_AGTN" ] && curl -s -m 30 "$SITE/assets/$VDBAC_AGTN" > /tmp/vd_bac_agt.js
VDBAC_PANN=""
if [ -f /tmp/vd_bac_agt.js ]; then
  for VDBAC_C in $(grep -oE '\./[A-Za-z0-9_-]+\.js' /tmp/vd_bac_agt.js | sort -u); do
    rm -f /tmp/vd_bac_cand.js
    curl -s -m 30 "$SITE/assets/${VDBAC_C#./}" > /tmp/vd_bac_cand.js
    if grep -qF 'applyProfile.title' /tmp/vd_bac_cand.js; then VDBAC_PANN="${VDBAC_C#./}"; cp /tmp/vd_bac_cand.js /tmp/vd_bac_panels.js; break; fi
  done
fi

VDBAC_READ=yes
if [ -z "$VDBAC_MAIN" ]; then VDBAC_READ=no; echo "FAIL  A1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDBAC_ACCN" ] || ! grep -qF 'get-account-data' /tmp/vd_bac_acc.js 2>/dev/null; then
  VDBAC_READ=no; echo "FAIL  A1 the entry $VDBAC_MAIN names no Account chunk that calls get-account-data (${VDBAC_ACCN:-none named}): the bundle layout moved, so the account page cannot be judged"
elif [ -z "$VDBAC_PANN" ]; then
  VDBAC_READ=no; echo "FAIL  Q1 no chunk the Agent page (${VDBAC_AGTN:-none named}) imports carries applyProfile.title: the bundle layout moved, so the agent panels cannot be judged"
fi

if [ "$VDBAC_READ" = yes ]; then
  # Each mark: FILE|ERE|claim|what it proves. Any one present means the merge published.
  VDBAC_MARKS='acc|accountView\.trackerLoadFailed|A1|S14X-258 a failed read of scans or applications says so, with a retry, instead of an empty tracker
acc|accountView\.lifecycleNotChecked|A2|S14X-203 a tracked posting with no closure answer reads not checked yet, never still open
acc|accountView\.fitCheckHourly|A3|S14X-204 the fit check names its hourly limit on a 429
acc|portalLoginUrl|A4|S14X-230 a refused delete renders the billing link the server returned
acc|ceilingBasis[!=]==?"fills"|"fills"[!=]==?[A-Za-z_$.]*ceilingBasis|A5|RC-S12-185 the reply-window chip quotes a share only on the employer page fill basis
acc|rb_last_resume_decided_by_text:|A6|S14X-166 the save-this-resume answer is kept per resume text, not per tab
acc|accountView\.passRetired|A7|S14X-223 a past Agent Pass reads as retired with the way to a refund, not not started yet
acc|open_to_run|A8|S14X-221 an order run on its own page that has not run reads open it to run, not Ready
acc|serverRecords|A9|S14X-100 Download all my data includes the rows only the server can read
acc|rb_scan_fixes",JSON\.stringify\(\{[^}]*fingerprint:|A10|S14X-285 the gap report hand-off names the resume it was made for
panels|accountView\.queueRetired|Q1|S14X-165 leftover packets read not sent, the agent is switched off
panels|accountView\.agentProfileRetired|Q2|S14X-199 the agent settings tab shows what is stored and deletes it, with no CV upload while the agent is off'
  VDBAC_HITS=0
  while IFS= read -r VDBAC_L; do
    VDBAC_F=${VDBAC_L%%|*}; VDBAC_R=${VDBAC_L#*|}; VDBAC_R=${VDBAC_R%|*|*}
    if grep -qE "$VDBAC_R" "/tmp/vd_bac_$VDBAC_F.js"; then VDBAC_HITS=$((VDBAC_HITS + 1)); fi
  done <<< "$VDBAC_MARKS"
  VDBAC_FE=old; [ "$VDBAC_HITS" -gt 0 ] && VDBAC_FE=published
  while IFS= read -r VDBAC_L; do
    VDBAC_F=${VDBAC_L%%|*}; VDBAC_R=${VDBAC_L#*|}; VDBAC_R=${VDBAC_R%|*|*}
    VDBAC_T=${VDBAC_L#*|}; VDBAC_T=${VDBAC_T#"$VDBAC_R"|}; VDBAC_CL=${VDBAC_T%%|*}; VDBAC_W=${VDBAC_T#*|}
    VDBAC_CH=$VDBAC_ACCN; [ "$VDBAC_F" = panels ] && VDBAC_CH=$VDBAC_PANN
    if grep -qE "$VDBAC_R" "/tmp/vd_bac_$VDBAC_F.js"; then echo "PASS  $VDBAC_CL $VDBAC_W ($VDBAC_CH)"
    elif [ "$VDBAC_FE" = published ]; then echo "FAIL  $VDBAC_CL $VDBAC_W: missing from $VDBAC_CH, though $VDBAC_HITS of the lane's marks are published"
    else echo "INFO  $VDBAC_CL $VDBAC_W: not published yet ($VDBAC_CH)"; fi
  done <<< "$VDBAC_MARKS"

  # D1: argument-less toLocale calls, which print in the browser's language.
  vdbac_bare() { grep -oE '\.toLocale(Date|Time)?String\(\)' "$1" | wc -l | tr -d ' '; }
  VDBAC_NA=$(vdbac_bare /tmp/vd_bac_acc.js); VDBAC_NP=$(vdbac_bare /tmp/vd_bac_panels.js)
  if [ "$VDBAC_NA" -le 3 ] && [ "$VDBAC_NP" -eq 0 ]; then echo "PASS  D1 S14X-255 the Account chunk lets the browser pick the language of $VDBAC_NA date(s) or count(s) (at most the 3 in other lanes' files) and the agent panels chunk of none"
  elif [ "$VDBAC_FE" = published ]; then echo "FAIL  D1 S14X-255 the Account chunk still prints $VDBAC_NA and the agent panels chunk $VDBAC_NP dates or counts in the browser's language, not the reader's (want at most 3 and 0)"
  else echo "INFO  D1 S14X-255 the Account chunk prints $VDBAC_NA and the agent panels chunk $VDBAC_NP dates or counts in the browser's language (18 and 3 on 2026-11-15): not published yet"; fi

  # S1: the English shard rides the entry; the other eight load on demand.
  VDBAC_SH=$(grep -oE '"\./shards/account/[A-Za-z-]+\.json":\(\)=>[A-Za-z_$]+\(\(\)=>import\("\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bac_entry.js)
  VDBAC_EN=no; grep -qF '"./shards/account/en.json":' /tmp/vd_bac_entry.js && VDBAC_EN=yes
  if [ -z "$VDBAC_SH" ] && [ "$VDBAC_EN" = no ]; then
    if [ "$VDBAC_FE" = published ]; then echo "FAIL  S1 S14X-254 the lane's page published but the entry loads no account shard, so its strings read English in every language"
    else echo "INFO  S1 S14X-254 the entry loads no account shard yet: not published yet"; fi
  else
    VDBAC_MISS=""; VDBAC_N=0
    while IFS= read -r VDBAC_L; do
      [ -n "$VDBAC_L" ] || continue
      VDBAC_LNG=$(printf '%s' "$VDBAC_L" | sed -E 's#.*shards/account/([A-Za-z-]+)\.json.*#\1#')
      VDBAC_SF=$(printf '%s' "$VDBAC_L" | grep -oE '[A-Za-z0-9_-]+\.js"$' | tr -d '"')
      rm -f /tmp/vd_bac_shard.js
      curl -s -m 30 "$SITE/assets/$VDBAC_SF" > /tmp/vd_bac_shard.js
      VDBAC_N=$((VDBAC_N + 1))
      for VDBAC_KEY in followUpDraft followUpWhen postingOpen ivOutcomeQ ivhClosedAfter ivhSinceTitle trackerLoadFailed queueRetired agentProfileRetired; do
        grep -qF "$VDBAC_KEY" /tmp/vd_bac_shard.js || VDBAC_MISS="$VDBAC_MISS $VDBAC_LNG:$VDBAC_KEY"
      done
    done <<< "$VDBAC_SH"
    if [ "$VDBAC_EN" = no ]; then echo "FAIL  S1 S14X-254 the entry names $VDBAC_N lazy account shards but not the English one it should carry"
    elif [ "$VDBAC_N" -ne 8 ]; then echo "FAIL  S1 S14X-254 the entry names $VDBAC_N non-English account shards, not 8"
    elif [ -n "$VDBAC_MISS" ]; then echo "FAIL  S1 S14X-254 account shard strings missing:$VDBAC_MISS"
    else echo "PASS  S1 S14X-254 the entry carries the English account shard and names 8 more, each with the follow-up draft, posting, interview and agent strings"; fi
  fi
fi
