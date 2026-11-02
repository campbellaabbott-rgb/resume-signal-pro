# shellcheck shell=bash
# ── 99zzzzz. THE FREE-SCAN WAVE'S RECHECK ON A THIRD CORPUS (2026-11-01;
# registers S13-004, S13-005, S13-009, S13-010, S13-022, S13-024, S13-038,
# S13-058, S13-092, S13-094, S13-122, S10-006, S10-007).
#
# Named 99zzzzz-free-scan-wave-recheck so it sorts after 99zzzz-free-scan-
# wave-review in byte order ("-" before "z") and under a locale that ignores
# the dash ("99zzzzf" before "99zzzzz").
#
# THE CLAIMS, one line each:
#   FX1  the published app carries the recheck's English strings, read where
#        the browser gets them (the chunk holding resumeBuilder's
#        replaceWithLatestScan, as FR1 does): the hand-off offers rewrites
#        "to apply" and applies them "wherever they match your bullets"
#        (S13-038), the sign-up nudge reads the allowance from {{signedIn}}
#        and {{signedOut}} (S13-094), Improvement Potential's "Little left to
#        gain" level and Score Potential's basis (S13-058), and the findings
#        index as strings (S13-122);
#   FX2  the same chunk no longer carries the claims the recheck withdrew:
#        "rewrites applied", "rewrites already applied" and a typed
#        "15 free scans a day instead of 7";
#   FX3  INFO: the engine half (plurals read as written, version floors and
#        street numbers not metrics, apostrophe years, "o momento", agency,
#        foundation and postdoc transitions, back-end and front-end role
#        cards, Bulgarian, Serbian and Malay) needs a scan; the build is
#        judged in 99zzzz-free-scan-wave-engine.sh and the behaviour in
#        src/test/the-free-scan-holds-on-a-third-corpus.test.ts.
#
# Every probe is a GET: the homepage, its entry script, one string chunk. No
# scan, upload, vote or checkout.

rm -f /tmp/vd_fx_en.js

VDFX_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDFX_FOUND=""
if [ -n "$VDFX_MAIN" ]; then
  for VDFX_CAND in $(bash scripts/verify-us-english.sh "$SITE$VDFX_MAIN"); do
    curl -s -m 60 "$SITE/assets/$VDFX_CAND" > /tmp/vd_fx_en.js
    if grep -qF "replaceWithLatestScan" /tmp/vd_fx_en.js; then VDFX_FOUND=$VDFX_CAND; break; fi
  done
fi
if [ -z "$VDFX_MAIN" ]; then echo "FAIL  FX1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDFX_FOUND" ]; then echo "FAIL  FX1 no English chunk the entry $VDFX_MAIN names holds resumeBuilder's strings: the bundle layout moved, so the recheck's strings cannot be judged"
else
  VDFX_MISSING=""
  for VDFX_PAIR in \
    "rewrites to apply|S13-038 hand-off button" \
    "applied wherever they match your bullets|S13-038 hand-off body" \
    "get {{signedIn}} free scans a day instead of {{signedOut}}|S13-094 sign-up nudge" \
    "Little left to gain|S13-058 Improvement Potential level" \
    "the bullet and keyword steps|S13-058 Score Potential basis" \
    "screeners cannot contact you|S13-122 findings index"; do
    grep -qF "${VDFX_PAIR%%|*}" /tmp/vd_fx_en.js || VDFX_MISSING="$VDFX_MISSING, ${VDFX_PAIR#*|}"
  done
  if [ -n "$VDFX_MISSING" ]; then echo "FAIL  FX1 the English strings ($VDFX_FOUND) lack the recheck's${VDFX_MISSING#,} (the frontend publish has not happened, or an older one is serving)"
  else echo "PASS  FX1 the English strings ($VDFX_FOUND) carry the hand-off's rewrites to apply, the nudge's read allowance, the derived improvement level, the score basis and the findings index"; fi
  VDFX_STALE=""
  for VDFX_PAIR in \
    "rewrites applied →|S13-038 rewrites applied button" \
    "rewrites already applied|S13-038 already-applied body" \
    "15 free scans a day instead of 7|S13-094 typed allowance"; do
    grep -qF "${VDFX_PAIR%%|*}" /tmp/vd_fx_en.js && VDFX_STALE="$VDFX_STALE, ${VDFX_PAIR#*|}"
  done
  if [ -n "$VDFX_STALE" ]; then echo "FAIL  FX2 the English strings ($VDFX_FOUND) still carry${VDFX_STALE#,}: the claims the recheck withdrew are still served"
  else echo "PASS  FX2 the English strings ($VDFX_FOUND) carry none of the withdrawn claims (rewrites applied, already applied, a typed 15 instead of 7)"; fi
fi

echo "INFO  FX3 the engine half of the recheck needs a scan: the builds are judged in 99zzzz-free-scan-wave-engine.sh, the behaviour in src/test/the-free-scan-holds-on-a-third-corpus.test.ts"
