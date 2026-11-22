# shellcheck shell=bash
# ── 99zzzzzzz-fix1119-payments-delivery. BUG ROUND OF 2026-11-19, LANE
# PAYMENTS-DELIVERY (branch fix/1119-payments-delivery). A refunded purchase,
# and a Pro grant its refund took back, are no longer handed back by
# recover-purchase or by analyze-resume (S9-030); the retry sweep's queue read
# claims the rows it hands out, so two runs at once no longer both mail a
# saved copy (S10-077, migration a_delivery_is_claimed_by_the_run_that_reads_it);
# reconcile-stripe reads the marker error, reads ids 100 at a time and judges
# no orphan on a failed read (S10-082); a paid analysis with no real ATS score
# is never delivered as 0/100 (S11-069); and the owner's re-delivery and the
# account deletion are held to their keys by tests (S11-128). Four functions
# at 2026-11-21.1, one migration, no frontend change.
#
# THE CLAIMS, one line each:
#   B  retry-failed-deliveries, reconcile-stripe, recover-purchase and
#      analyze-resume serve 2026-11-21.1 or later on their preflight. While
#      none does, INFO (not pasted yet); once any does, each one older or
#      unstamped is a FAIL (a partial paste);
#   M  get_failed_deliveries_for_retry, asked as anon, is refused 42501. The
#      ask is the shared probe: a GET, which PostgREST runs read-only, so a
#      selector anon could call fails 25006 and claims nothing;
#   A  a POST to admin-regenerate-delivery with no x-admin-key answers 401
#      Unauthorized. The key is the handler's first step, before the body is
#      read, and the body sent is {} (no address, no résumé), so even an open
#      gate would answer 400: no model call, no mail, no write.
#
# WHAT THIS SECTION CANNOT SEE. recover-purchase's and analyze-resume's
# refusals need a refunded purchase or a revoked grant, and the score rule a
# model call: this script makes no recover-purchase or analyze-resume call
# (the purchase and model paths). The claim itself, and reconcile-stripe's
# marker read, are inside the database and a sweep. Each is proven on the
# shipped handler by the lane's tests, and the INFO lines name them.
#
# READ-ONLY. Four OPTIONS preflights, one GET probe, one POST the owner's key
# refuses before it reads the body.
echo "== 99zzzzzzz. fix 1119 payments-delivery: four builds, the claimed retry queue closed to anon, the owner's re-delivery key =="

VDPD_FNS="retry-failed-deliveries reconcile-stripe recover-purchase analyze-resume"
VDPD_NEW=""
VDPD_OLD=""
for VDPD_F in $VDPD_FNS; do
  rm -f /tmp/vd_pd_hdr
  curl -s -m 30 -D /tmp/vd_pd_hdr -o /dev/null -X OPTIONS "$B/functions/v1/$VDPD_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST"
  VDPD_H=$(tr -d '\r' < /tmp/vd_pd_hdr 2>/dev/null | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -n "$VDPD_H" ] && build_ge "$VDPD_F" "$VDPD_H" 2026-11-21 1; then VDPD_NEW="$VDPD_NEW $VDPD_F=$VDPD_H"
  else VDPD_OLD="$VDPD_OLD $VDPD_F=${VDPD_H:-none}"; fi
done
VDPD_LIVE=0
[ -n "$VDPD_NEW" ] && VDPD_LIVE=1
for VDPD_P in $VDPD_NEW; do echo "PASS  B ${VDPD_P%%=*} preflight x-fn-build = ${VDPD_P#*=} (2026-11-21.1 or later)"; done
for VDPD_P in $VDPD_OLD; do
  VDPD_F=${VDPD_P%%=*}; VDPD_H=${VDPD_P#*=}
  if [ "$VDPD_LIVE" = 0 ]; then echo "INFO  B $VDPD_F preflight x-fn-build = $VDPD_H: the payments-delivery lane is not pasted yet (judged once any of its four functions serves 2026-11-21.1)"
  elif [ "$VDPD_H" = none ]; then echo "FAIL  B $VDPD_F preflight carries no x-fn-build while others serve 2026-11-21.1 (want $VDPD_F.2026-11-21.1 or later)"
  else echo "FAIL  B $VDPD_F preflight x-fn-build = $VDPD_H while others serve 2026-11-21.1: a partial paste (want $VDPD_F.2026-11-21.1 or later)"; fi
done

# M: the retry queue's selector, asked as anon with a GET (read-only).
probe get_failed_deliveries_for_retry '{"p_limit":0,"p_include_generating":false,"p_include_unmailed":false}'

# A: the owner's re-delivery without its key.
rm -f /tmp/vd_pd_ar.json
VDPD_AR=$(curl -s -m 30 -o /tmp/vd_pd_ar.json -w '%{http_code}' -X POST "$B/functions/v1/admin-regenerate-delivery" \
  -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{}')
VDPD_ARB=$(head -c 200 /tmp/vd_pd_ar.json 2>/dev/null)
if [ "$VDPD_AR" = 401 ] && printf '%s' "$VDPD_ARB" | grep -q '"Unauthorized"'; then
  echo "PASS  A admin-regenerate-delivery with no x-admin-key -> 401 Unauthorized (refused before the body is read: no model call, no mail, no write)"
else
  echo "FAIL  A admin-regenerate-delivery with no x-admin-key -> ${VDPD_AR:-no answer} $(printf '%s' "$VDPD_ARB" | tr -d '\n' | head -c 160) (want 401 Unauthorized: the owner's tool must answer only the owner's key)"
fi

echo "INFO  S9-030 (a refunded purchase or a revoked Pro grant is refused by recover-purchase and analyze-resume) needs a refunded purchase to show: no recover-purchase or analyze-resume call is made here. Proven in src/test/a-revoked-purchase-is-not-handed-back-by-recovery-or-by-a-pro-grant.test.ts"
echo "INFO  S11-069 (no paid analysis is delivered as 0/100: a reply with no score asks the next model, and none ends in a retryable 503 with nothing redeemed) needs a model call: proven in src/test/an-analysis-without-a-score-is-not-delivered-as-zero.test.ts"
echo "INFO  S10-077 (the queue read claims its rows for twenty minutes) is inside the database: the migration's self-check raises when two calls in one transaction hand out the same row, and src/test/two-runs-at-once-mail-a-saved-copy-once.test.ts runs the sweep twice at once against it"
echo "INFO  S10-082 (a failed marker read raises no orphan alarm): proven in src/test/a-marker-read-that-failed-raises-no-orphan-alarm.test.ts over 250 sessions. The owner's read after the next run: select v -> 'markerReadFailed', v -> 'orphans', v ->> 'buildVersion' from job_board_meta where k = 'reconcile_stripe_run' (false, and buildVersion 2026-11-21.1 or later)"
echo "INFO  S11-128 (the owner's re-delivery and the account deletion refuse a caller without the key) are tests only: src/test/the-owner-redelivery-and-the-account-deletion-refuse-a-caller-without-the-key.test.ts"
