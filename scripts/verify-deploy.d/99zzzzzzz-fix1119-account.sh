# shellcheck shell=bash
# ── 99zzzzzzz-fix1119-account. THE 2026-11-19 RECONCILE, LANE ACCOUNT
# (branch fix/1119-account): S10-066, S10-069, S11-095, S10-160 and the
# account half of SH-07. No function, no migration: the account page, its
# saved-searches card and morning queue, and four strings in the account
# shard, published by the merge itself.
#
# Named 99zzzzzzz-* as the bug-round sections are: it sorts after every
# 99zzzzzz-* file in byte order and under a locale that ignores the dash.
#
# THE STAGE, read from production, never assumed: the published Account
# chunk carries any of the lane's marks (the tracker's exact count, its "Load
# older applications" control, a saved job dated the day it moved). Until
# then every line is INFO; from then on a missing mark, or the old read or
# write still in the chunk, is a FAIL.
#
# THE CLAIMS, one line each:
#   T1  S10-069: the tracker reads user_applications with an exact count and
#       a page at a time. FAIL while the chunk reads it with limit(100) and
#       no count option, the read that showed "100 tracked" to someone with
#       150 and left the oldest out of reach.
#   T2  S10-069: the tracker offers "Load older applications"
#       (accountView.trackerLoadMore).
#   A1  S11-095: a saved job moved on is written with its applied date. FAIL
#       while the chunk's status change writes status and status_changed_at
#       only, the write that kept the save date as the application date.
#
# NOT PROVABLE FROM OUTSIDE (the rest needs a signed-in session, which the
# verifier never has), so INFO here and proved in the suite:
#   S10-066 a-rescan-does-not-leave-the-gap-report-without-a-cv
#   S10-069 the-tracker-counts-every-application-and-reaches-the-old-ones
#   S11-095 moving-a-saved-job-to-applied-dates-it-that-day
#   S10-160 a-refused-digest-change-puts-the-switch-back
#   SH-07   an-account-text-box-is-named-by-more-than-its-placeholder
#
# READ-ONLY. GETs of the homepage, its entry and the Account chunk. Nothing
# is posted.
echo "== 99zzzzzzz-fix1119-account. reconcile lane account: the tracker counts and reaches every application, a moved job is dated the day it moved =="

rm -f /tmp/vd_f19acc_home.html /tmp/vd_f19acc_entry.js /tmp/vd_f19acc_acc.js /tmp/vd_f19acc_cand.js

curl -s -m 30 "$SITE/" > /tmp/vd_f19acc_home.html
VDF19A_MAIN=$(grep -o '/assets/index-[^"]*\.js' /tmp/vd_f19acc_home.html | head -1)
[ -n "$VDF19A_MAIN" ] && curl -s -m 60 "$SITE$VDF19A_MAIN" > /tmp/vd_f19acc_entry.js
# The Account chunk is the one that calls get-account-data (other chunks'
# names can start with Account too).
VDF19A_ACCN=""
for VDF19A_C in $( { [ -f /tmp/vd_f19acc_entry.js ] && grep -oE 'Account-[A-Za-z0-9_-]+\.js' /tmp/vd_f19acc_entry.js; } | sort -u); do
  rm -f /tmp/vd_f19acc_cand.js
  curl -s -m 30 "$SITE/assets/$VDF19A_C" > /tmp/vd_f19acc_cand.js
  if grep -qF 'get-account-data' /tmp/vd_f19acc_cand.js; then VDF19A_ACCN=$VDF19A_C; cp /tmp/vd_f19acc_cand.js /tmp/vd_f19acc_acc.js; break; fi
done

if [ -z "$VDF19A_MAIN" ]; then
  echo "FAIL  T1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDF19A_ACCN" ]; then
  echo "FAIL  T1 the entry $VDF19A_MAIN names no Account chunk that calls get-account-data: the bundle layout moved, so the account page cannot be judged"
else
  # The reads and writes, as the minifier prints them.
  VDF19A_OLDREAD='from\("user_applications"\)\.select\("\*"\)\.order\("created_at",\{ascending:!1\}\)\.limit\(100\)'
  VDF19A_NEWREAD='from\("user_applications"\)\.select\("\*",\{count:"exact"\}\)'
  VDF19A_MORE='accountView\.trackerLoadMore'
  VDF19A_OLDWRITE='\.update\(\{status:[A-Za-z_$][A-Za-z0-9_$]*,status_changed_at:[A-Za-z_$][A-Za-z0-9_$]*\}\)'
  VDF19A_NEWWRITE='\{status:[A-Za-z_$][A-Za-z0-9_$]*,applied_at:[A-Za-z_$][A-Za-z0-9_$]*\('
  VDF19A_HITS=0
  for VDF19A_R in "$VDF19A_NEWREAD" "$VDF19A_MORE" "$VDF19A_NEWWRITE"; do
    grep -qE "$VDF19A_R" /tmp/vd_f19acc_acc.js && VDF19A_HITS=$((VDF19A_HITS + 1))
  done
  VDF19A_FE=old; [ "$VDF19A_HITS" -gt 0 ] && VDF19A_FE=published

  # T1: the exact count and the page, and never the old capped read.
  VDF19A_OLDR=no; grep -qE "$VDF19A_OLDREAD" /tmp/vd_f19acc_acc.js && VDF19A_OLDR=yes
  VDF19A_NEWR=no; grep -qE "$VDF19A_NEWREAD" /tmp/vd_f19acc_acc.js && VDF19A_NEWR=yes
  if [ "$VDF19A_NEWR" = yes ] && [ "$VDF19A_OLDR" = no ]; then
    echo "PASS  T1 S10-069 the tracker reads user_applications with its exact count, a page at a time, and the capped limit(100) read is gone ($VDF19A_ACCN)"
  elif [ "$VDF19A_FE" = published ] && [ "$VDF19A_OLDR" = yes ]; then
    echo "FAIL  T1 S10-069 the Account chunk ($VDF19A_ACCN) still reads user_applications with limit(100) and no count option, though $VDF19A_HITS of the lane's marks are published: past 100 rows the header undercounts and the oldest rows are unreachable"
  elif [ "$VDF19A_FE" = published ]; then
    echo "FAIL  T1 S10-069 the Account chunk ($VDF19A_ACCN) carries $VDF19A_HITS of the lane's marks but no user_applications read with an exact count: the bundle moved or the read changed shape"
  elif [ "$VDF19A_OLDR" = yes ]; then
    echo "INFO  T1 S10-069 the Account chunk ($VDF19A_ACCN) reads the tracker with limit(100) and no count: not published yet"
  else
    echo "INFO  T1 S10-069 the Account chunk ($VDF19A_ACCN) carries neither the capped read nor the counted one, and none of the lane's marks: not published yet, or the read changed shape"
  fi

  # T2: the control that reaches the older rows.
  if grep -qE "$VDF19A_MORE" /tmp/vd_f19acc_acc.js; then
    echo "PASS  T2 S10-069 the tracker offers Load older applications ($VDF19A_ACCN)"
  elif [ "$VDF19A_FE" = published ]; then
    echo "FAIL  T2 S10-069 the tracker offers no Load older applications in $VDF19A_ACCN, though $VDF19A_HITS of the lane's marks are published"
  else
    echo "INFO  T2 S10-069 the tracker offers no Load older applications yet: not published yet ($VDF19A_ACCN)"
  fi

  # A1: a saved job moved on carries its applied date.
  VDF19A_OLDW=no; grep -qE "$VDF19A_OLDWRITE" /tmp/vd_f19acc_acc.js && VDF19A_OLDW=yes
  VDF19A_NEWW=no; grep -qE "$VDF19A_NEWWRITE" /tmp/vd_f19acc_acc.js && VDF19A_NEWW=yes
  if [ "$VDF19A_NEWW" = yes ] && [ "$VDF19A_OLDW" = no ]; then
    echo "PASS  A1 S11-095 a saved job moved to another stage is written with applied_at, and no status change writes status and status_changed_at only ($VDF19A_ACCN)"
  elif [ "$VDF19A_FE" = published ] && [ "$VDF19A_OLDW" = yes ]; then
    echo "FAIL  A1 S11-095 the Account chunk ($VDF19A_ACCN) still writes a status change as status and status_changed_at only, though $VDF19A_HITS of the lane's marks are published: a saved job moved to Applied keeps its save date"
  elif [ "$VDF19A_FE" = published ]; then
    echo "FAIL  A1 S11-095 the Account chunk ($VDF19A_ACCN) carries $VDF19A_HITS of the lane's marks but no status change that writes applied_at"
  elif [ "$VDF19A_OLDW" = yes ]; then
    echo "INFO  A1 S11-095 the Account chunk ($VDF19A_ACCN) writes a status change as status and status_changed_at only: not published yet"
  else
    echo "INFO  A1 S11-095 the Account chunk ($VDF19A_ACCN) carries neither status write the section knows, and none of the lane's marks: not published yet, or the write changed shape"
  fi
fi

echo "INFO  S1 S10-066, S10-160 and SH-07 need a signed-in session, which this verifier never has: the newest scan with its text feeds the gap report, morning queue and apply copilot (a-rescan-does-not-leave-the-gap-report-without-a-cv), a refused email-alert change puts the control back and says so (a-refused-digest-change-puts-the-switch-back), and each account text box keeps its name after typing (an-account-text-box-is-named-by-more-than-its-placeholder), all proved in the suite"
