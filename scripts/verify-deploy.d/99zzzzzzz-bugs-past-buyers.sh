# shellcheck shell=bash
# ── 99zzzzzzz-bugs-past-buyers. BUG ROUND A, LANE PAST-BUYERS (branch bugs/a-past-buyers).
# What a past buyer of a retired product keeps: a copy the recovery form
# makes is saved, recorded and mailed once; a refused delivery lease says why
# (take_delivery_lease_status, 20261112151000), so a closed order with no copy
# is said to be closed, never "still being made"; a spent Pro grant lives as
# long as its saved copy (20261112150000); a run-out Agent Pass is closed and
# settled, now and daily (agent-pass-close, 20261112152000); the success page
# hands the Coach and the Career Path their saved copy, downloads the letter,
# seeds the builder without touching the scan, labels its upload, shows an
# ATS Defense report's saved checks, and sends a report jsPDF cannot draw to
# the print dialog; the owner's re-delivery invents no figure.
#
# THE CLAIMS, one line each:
#   B   each function this lane changes, directly or through
#       _shared/past-buyer-copy.ts or _shared/career-report-shape.ts, serves
#       2026-11-12.1 or later on its preflight. While none does, INFO (not
#       pasted yet); once any does, each one older or unstamped is a FAIL;
#   M1  take_delivery_lease_status exists and anon may not run it (a GET:
#       42501). PGRST202 before the paste is INFO, after it a FAIL; a function
#       anon can run is a FAIL either way;
#   M2  the job 'agent-pass-close' (get_cron_health) is listed, active, sets
#       its statement_timeout in its command, and its last run succeeded;
#       absent before the paste INFO, after it a FAIL;
#   M3  guard: 'scan-cache-and-telemetry-purge', whose pro_grants clause
#       20261112150000 rewrites, is still listed, active, timed, and its last
#       run did not fail (before the paste a failure is INFO: not this lane's);
#   F   the published ProductSuccess chunk, with the chunks it imports, holds
#       the builder seed, the labelled upload, the letter's file, the saved
#       copy prop, the closed answer, the saved parse checks, the print path
#       and the Spanish and Hindi ready verdicts, and that chunk, one it
#       imports or the entry (a build from before the bug round's review
#       moved them to the page) the English past-buyers strings. Before the
#       paste INFO, after it a FAIL;
#   R   the checked-out repo: the five recovery-form writers keep their copy,
#       the re-delivery runs the figure and contact checks and asks for no
#       inferred figure, the ATS Defense generator's simulator is the page's
#       file byte for byte, and _shared/paid-session.ts is untouched;
#   O   the owner-gated keys (S14X-143, S14X-225) print INFO owner pending
#       until docs/deploy-ledger.json reservations['bug-round'].ownerDecided
#       names them; then each judges what its decision ships.
#
# WHAT THIS SECTION CANNOT SEE: every write the lane changed needs a paid
# order, a model call or the service role. Those are proven on the shipped
# handlers and in pglite by the lane's tests, and the owner's read-only SQL is
# printed below as INFO.
#
# READ-ONLY. OPTIONS preflights, GETs of two read RPCs (one refused by name),
# the site's entry and chunks, and files of the checked-out repo. Nothing is
# posted.
echo "== 99zzzzzzz. bug round A past-buyers: builds, the lease that says why, the pass closer, the success page, owner gates =="

vdpb_build() {
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g'
}
VDPB_FNS="generate-keyword-fix generate-cover-letter generate-premium-package generate-career-snapshot generate-graduate-gameplan generate-ats-defense generate-freelance-boost admin-regenerate-delivery verify-product-purchase send-product-email"
VDPB_NEW=""
VDPB_OLD=""
for VDPB_F in $VDPB_FNS; do
  VDPB_H=$(vdpb_build "$VDPB_F")
  if [ -n "$VDPB_H" ] && build_ge "$VDPB_F" "$VDPB_H" 2026-11-12 1; then VDPB_NEW="$VDPB_NEW $VDPB_F=$VDPB_H"
  else VDPB_OLD="$VDPB_OLD $VDPB_F=${VDPB_H:-none}"; fi
done
VDPB_LIVE=0
[ -n "$VDPB_NEW" ] && VDPB_LIVE=1
for VDPB_P in $VDPB_NEW; do echo "PASS  B ${VDPB_P%%=*} preflight x-fn-build = ${VDPB_P#*=} (2026-11-12.1 or later)"; done
for VDPB_P in $VDPB_OLD; do
  VDPB_F=${VDPB_P%%=*}; VDPB_H=${VDPB_P#*=}
  if [ "$VDPB_LIVE" = 0 ]; then echo "INFO  B $VDPB_F preflight x-fn-build = $VDPB_H: bug round A is not pasted yet (judged once any of the lane's functions serves 2026-11-12.1)"
  elif [ "$VDPB_H" = none ]; then echo "FAIL  B $VDPB_F preflight carries no x-fn-build while others serve 2026-11-12.1 (want $VDPB_F.2026-11-12.1 or later)"
  else echo "FAIL  B $VDPB_F preflight x-fn-build = $VDPB_H while others serve 2026-11-12.1: a partial paste (want $VDPB_F.2026-11-12.1 or later)"; fi
done

vdpb_get() { curl -s -m 60 "$B/rest/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K"; }
vdpb_code() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{console.log("NONJSON");return}if(Array.isArray(j)){console.log("ROWS:"+j.length);return}if(j&&typeof j==="object"&&j.code){console.log(String(j.code));return}console.log(j&&typeof j==="object"?"OBJECT":"NONJSON")})'; }

# M1: the lease that says why. A GET runs in a read-only transaction, and a
# function anon may not run is refused before its body (42501).
rm -f /tmp/vd_bpb_lease.json
vdpb_get "rpc/take_delivery_lease_status?p_stripe_session_id=rb-verify-none&p_seen_status=rb-verify-none" > /tmp/vd_bpb_lease.json
case "$(vdpb_code < /tmp/vd_bpb_lease.json)" in
  42501) echo "PASS  M1 take_delivery_lease_status exists and anon may not run it (42501): 20261112151000 applied (S14X-111)";;
  PGRST202)
    if [ "$VDPB_LIVE" = 1 ]; then echo "FAIL  M1 take_delivery_lease_status is not there (PGRST202) while the lane's functions serve 2026-11-12.1: 20261112151000 did not apply, so a closed order is still answered 'in progress' (re-apply it under a fresh stamp)"
    else echo "INFO  M1 take_delivery_lease_status is not there yet (PGRST202): 20261112151000 has not applied (verify-product-purchase falls back to the plain lease)"; fi;;
  25006) echo "FAIL  M1 take_delivery_lease_status is CALLABLE by anon (25006: only this read-only GET stopped it taking a lease)";;
  ROWS:*) echo "FAIL  M1 take_delivery_lease_status answered anon with rows ($(head -c 160 /tmp/vd_bpb_lease.json)): an order's state is the service role's alone";;
  *) echo "FAIL  M1 take_delivery_lease_status as anon -> $(head -c 160 /tmp/vd_bpb_lease.json) (want 42501, or PGRST202 before the paste)";;
esac
rm -f /tmp/vd_bpb_lease.json

# M2, M3 and the S14X-225 owner line read one cron listing.
rm -f /tmp/vd_bpb_cron.json
vdpb_get "rpc/get_cron_health?p_hours=48" > /tmp/vd_bpb_cron.json
VDPB_LIVE="$VDPB_LIVE" node - /tmp/vd_bpb_cron.json <<'VDPB_JS'
const fs = require("fs");
const live = process.env.VDPB_LIVE === "1";
let j = null; try { j = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { /* judged below */ }
if (!Array.isArray(j)) {
  console.log("FAIL  M2 get_cron_health did not answer a list (" + String(JSON.stringify(j)).slice(0, 120) + "): the pass closer and the purge cannot be judged");
  process.exit(0);
}
const job = (n) => j.find((r) => r && r.ch_jobname === n);
const close = job("agent-pass-close");
if (!close) {
  console.log((live ? "FAIL" : "INFO") + "  M2 no job 'agent-pass-close' among " + j.length + " jobs" + (live ? " while the lane's functions serve 2026-11-12.1: 20261112152000 did not apply, so a run-out pass waits for its buyer to settle (S14X-083)" : ": 20261112152000 has not applied (S14X-083)"));
} else if (close.ch_active !== true) {
  console.log("FAIL  M2 'agent-pass-close' is listed but not active: no run-out pass is closed (S14X-083)");
} else if (!close.ch_timeout) {
  console.log("FAIL  M2 'agent-pass-close' sets no statement_timeout in its command (S14X-083)");
} else if (close.ch_last_status && close.ch_last_status !== "succeeded") {
  console.log("FAIL  M2 'agent-pass-close' last run " + close.ch_last_status + " at " + close.ch_last_start + " (" + close.ch_failed + " of " + close.ch_runs + " runs failed in 48 hours): run-out passes are not being closed (S14X-083)");
} else {
  console.log("PASS  M2 'agent-pass-close' is scheduled (" + close.ch_schedule + "), active, with statement_timeout " + close.ch_timeout + " in its command" + (Number(close.ch_runs) > 0 ? ", last run succeeded" : "") + " (S14X-083)");
  if (!(Number(close.ch_runs) > 0)) console.log("INFO  M2 'agent-pass-close' has not run in the last 48 hours yet (it runs daily at 03:41 UTC)");
}
const purge = job("scan-cache-and-telemetry-purge");
const purgeBad = !purge ? "is not listed" : purge.ch_active !== true ? "is not active" : !purge.ch_timeout ? "sets no statement_timeout in its command"
  : (purge.ch_last_status && purge.ch_last_status !== "succeeded") ? "last ran " + purge.ch_last_status + " at " + purge.ch_last_start : "";
if (!purgeBad) console.log("PASS  M3 guard: 'scan-cache-and-telemetry-purge', whose pro_grants clause 20261112150000 rewrites, is active, timed (" + purge.ch_timeout + ") and its last run " + (purge.ch_last_status || "has not happened in 48 hours"));
else console.log((live ? "FAIL" : "INFO") + "  M3 'scan-cache-and-telemetry-purge' " + purgeBad + (live ? " after 20261112150000 rewrote its pro_grants clause (S14X-104)" : ": not this lane's yet (the round is not pasted)"));
VDPB_JS

# F: the published success page.
VDPB_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDPB_MAINJS=""
[ -n "$VDPB_MAIN" ] && VDPB_MAINJS=$(curl -s -m 30 "$SITE$VDPB_MAIN")
VDPB_PS=$(printf '%s' "$VDPB_MAINJS" | grep -oE "(\./|assets/)ProductSuccess-[A-Za-z0-9_-]+\.js" | head -1 | sed -E 's#^(\./|assets/)##')
VDPB_PSJS=""
if [ -z "$VDPB_MAINJS" ] || [ -z "$VDPB_PS" ]; then
  echo "FAIL  F the served entry (${VDPB_MAIN:-none found}) names no ProductSuccess chunk: the frontend is not serving, or the bundle layout moved, so the success page cannot be judged"
else
  VDPB_PSJS=$(curl -s -m 30 "$SITE/assets/$VDPB_PS")
  # The chunks it imports (the report shape rides in one of them).
  for VDPB_D in $(printf '%s' "$VDPB_PSJS" | grep -oE '"\./[A-Za-z0-9_.-]+\.js"' | tr -d '"' | sed 's#^\./##' | grep -v '^index-' | sort -u | head -150); do
    VDPB_PSJS="$VDPB_PSJS
$(curl -s -m 30 "$SITE/assets/$VDPB_D")"
  done
  VDPB_CLOSED=$(node -e 'try{process.stdout.write(String(require(process.argv[1]).pastBuyers.closedNoCopy).slice(0,41))}catch{}' "$PWD/src/i18n/shards/past-buyers/en.json")
  VDPB_MISSING=""
  printf '%s' "$VDPB_PSJS" | grep -qF 'rb_builder_seed' || VDPB_MISSING="$VDPB_MISSING the builder's one-shot seed (RC-S12-110);"
  printf '%s' "$VDPB_PSJS" | grep -qE 'setItem\("rb_resume_text",[^)]{0,80}rewrittenResume' && VDPB_MISSING="$VDPB_MISSING an 'Open in builder' that leaves the scanned résumé alone (RC-S12-110: the rewrite still goes to rb_resume_text);"
  printf '%s' "$VDPB_PSJS" | grep -qF 'product-success-recovery-file' || VDPB_MISSING="$VDPB_MISSING the labelled recovery upload (S14X-180);"
  printf '%s' "$VDPB_PSJS" | grep -qF 'cover-letter.txt' || VDPB_MISSING="$VDPB_MISSING the letter's download (RC-S12-043);"
  printf '%s' "$VDPB_PSJS" | grep -qF 'savedCopy' || VDPB_MISSING="$VDPB_MISSING the Coach's and the Career Path's saved copy (RC-S12-042);"
  printf '%s' "$VDPB_PSJS" | grep -qF 'closedNoCopy' || VDPB_MISSING="$VDPB_MISSING the closed-order answer (S14X-111);"
  printf '%s' "$VDPB_PSJS" | grep -qF 'data-rb-saved-parse-simulation' || VDPB_MISSING="$VDPB_MISSING the ATS Defense report's saved checks (RC-S12-031);"
  printf '%s' "$VDPB_PSJS" | grep -qF 'data-rb-print' || VDPB_MISSING="$VDPB_MISSING the print path for text jsPDF cannot draw (RC-S12-029);"
  { printf '%s' "$VDPB_PSJS" | grep -qF 'listo para postularte' && printf '%s' "$VDPB_PSJS" | grep -qF 'आवेदन करने के लिए तैयार'; } || VDPB_MISSING="$VDPB_MISSING the Spanish and Hindi ready verdicts (RC-S12-113);"
  { [ -n "$VDPB_CLOSED" ] && printf '%s\n%s' "$VDPB_MAINJS" "$VDPB_PSJS" | grep -qF "$VDPB_CLOSED"; } || VDPB_MISSING="$VDPB_MISSING the English past-buyers strings (with the success page or in the entry);"
  if [ -z "$VDPB_MISSING" ]; then echo "PASS  F the published success page ($VDPB_PS and what it imports) seeds the builder, labels its upload, downloads the letter, hands the widgets their saved copy, answers a closed order, shows saved parse checks, prints what jsPDF cannot draw and reads the Spanish and Hindi verdicts"
  elif [ "$VDPB_LIVE" = 1 ]; then echo "FAIL  F the published success page lacks${VDPB_MISSING%;} while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened"
  else echo "INFO  F the published success page lacks${VDPB_MISSING%;}: the round's frontend has not published yet"; fi
fi

# R: the checked-out repo.
VDPB_KEEP=""
for VDPB_F in generate-keyword-fix generate-cover-letter generate-premium-package generate-career-snapshot generate-graduate-gameplan; do
  grep -q 'keepPastBuyerCopy(' "supabase/functions/$VDPB_F/index.ts" 2>/dev/null || VDPB_KEEP="$VDPB_KEEP $VDPB_F"
done
if [ -z "$VDPB_KEEP" ]; then echo "PASS  R1 the five recovery-form writers keep the copy they make for a buyer (keepPastBuyerCopy, RC-S12-007)"
else echo "FAIL  R1 these recovery-form writers do not keep the copy they make:$VDPB_KEEP (RC-S12-007)"; fi
VDPB_REGEN=supabase/functions/admin-regenerate-delivery/index.ts
if [ ! -f "$VDPB_REGEN" ]; then echo "FAIL  R2 $VDPB_REGEN is not in this checkout"
elif grep -qiE 'infer reasonable metrics|experiences with metrics' "$VDPB_REGEN"; then echo "FAIL  R2 the owner's re-delivery still asks the model to infer figures (RC-S12-106)"
elif ! grep -q 'rewrittenResumeFigureIssues(' "$VDPB_REGEN" || ! grep -q 'validateProseClaims(' "$VDPB_REGEN" || ! grep -q 'stripInventedContact(' "$VDPB_REGEN"; then echo "FAIL  R2 the owner's re-delivery does not run the figure and contact checks before it mails (RC-S12-106)"
else echo "PASS  R2 the owner's re-delivery asks for no figure the résumé does not state, and runs the figure and contact checks before it mails (RC-S12-106)"; fi
if [ -f supabase/functions/generate-ats-defense/ats-parse-simulator.ts ] && cmp -s supabase/functions/generate-ats-defense/ats-parse-simulator.ts src/lib/ats-parse-simulator.ts; then
  echo "PASS  R3 generate-ats-defense's simulator is src/lib/ats-parse-simulator.ts byte for byte, so the checks saved with a report are the page's (RC-S12-031)"
else echo "FAIL  R3 supabase/functions/generate-ats-defense/ats-parse-simulator.ts is missing or differs from src/lib/ats-parse-simulator.ts: copy the page's file across (RC-S12-031)"; fi
VDPB_PSHA=$(node -e 'try{process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))}catch{}' supabase/functions/_shared/paid-session.ts)
if [ "$VDPB_PSHA" = cc4a74bb8877354392732d040e8b78d684921fa7d91cddef733a5ee72597023a ]; then echo "PASS  R4 guard: _shared/paid-session.ts is the hotfix's file, unchanged (it rides in analyze-resume, create-checkout, retry-failed-deliveries and stripe-webhook)"
else echo "FAIL  R4 _shared/paid-session.ts changed (sha ${VDPB_PSHA:-unreadable}): this lane never edits it, and four other functions bundle it"; fi

echo "INFO  owner read-only SQL after the paste (each needs the service role, which this script never holds): S14X-083 SELECT count(*) FROM agent_passes WHERE closed_at IS NULL AND coalesce(expires_at, shelf_expires_at) < now() - interval '1 day' -- 0; S14X-083 SELECT count(*) FROM agent_passes WHERE closed_at IS NOT NULL AND settled_at IS NULL -- 0; S14X-104 SELECT count(*) FROM purchased_content c WHERE c.stripe_session_id LIKE 'pro\\_%' AND (c.expires_at IS NULL OR c.expires_at > now()) AND NOT EXISTS (SELECT 1 FROM pro_grants g WHERE 'pro_' || g.id::text = c.stripe_session_id) -- no higher than the migration's NOTICE; RC-S12-104 SELECT count(*) FROM product_deliveries WHERE product_type = 'freelance_boost' AND generation_success = false AND generation_error IS NULL AND created_at > :paste -- 0"
echo "INFO  proven in the suite, never here (each needs a paid order, a model call or the service role): a recovery-form copy kept, recorded and mailed once; a closed order answered closedNoCopy and a refunded one 402; a purged grant's saved copy opening; a gateway out of credits answered 503 ai_unavailable; a failed Freelance Boost written on its order; a scan order mailed again with its credits; the re-delivery refusing an invented figure; the pass settlement giving back a released packet"

# O: the owner-gated keys. ownerDecided maps key -> choice (a string, or an
# object with a choice), written by the integrator alone.
vdpb_decided() {
  node -e 'let l={};try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
const rs=(l&&l.reservations)||{};const r=Array.isArray(rs)?rs.find((x)=>x&&x.name==="bug-round"):rs["bug-round"];
const d=(r&&r.ownerDecided)||{};const v=d[process.argv[2]];
process.stdout.write(v==null||v===false||v===""?"":typeof v==="object"?String(v.choice??v.option??JSON.stringify(v)):String(v))' "${VDPB_LEDGER:-docs/deploy-ledger.json}" "$1" 2>/dev/null
}
VDPB_O143=$(vdpb_decided S14X-143)
case "$VDPB_O143" in
  "") echo "INFO  S14X-143 owner pending: the 90-day past-buyer window is promised by the cut-product sentence and enforced nowhere; the owner picks A (enforce it) or B (drop the promise)";;
  A|A\ *|a|a\ *)
    VDPB_WIN=""
    [ -f supabase/functions/_shared/past-buyer-window.ts ] || VDPB_WIN=" _shared/past-buyer-window.ts;"
    for VDPB_F in generate-keyword-fix generate-cover-letter generate-premium-package generate-career-snapshot generate-graduate-gameplan generate-ats-defense generate-career-path generate-freelance-boost import-freelance-profile; do
      grep -q 'past-buyer-window\.ts' "supabase/functions/$VDPB_F/index.ts" 2>/dev/null || VDPB_WIN="$VDPB_WIN $VDPB_F;"
    done
    if [ -n "$VDPB_WIN" ]; then echo "FAIL  S14X-143 decided ($VDPB_O143), but this checkout lacks the window in:${VDPB_WIN%;}"
    elif printf '%s' "$VDPB_PSJS" | grep -qF 'past_buyer_window_closed'; then echo "PASS  S14X-143 decided ($VDPB_O143): the nine writers read _shared/past-buyer-window.ts and the published success page answers a closed window"
    elif [ "$VDPB_LIVE" = 1 ]; then echo "FAIL  S14X-143 decided ($VDPB_O143), but the published success page never names past_buyer_window_closed while the lane's functions serve 2026-11-12.1"
    else echo "INFO  S14X-143 decided ($VDPB_O143): the writers read the window in this checkout; the success page has not published"; fi
    for VDPB_F in generate-career-path import-freelance-profile; do
      VDPB_H=$(vdpb_build "$VDPB_F")
      if [ -n "$VDPB_H" ] && build_ge "$VDPB_F" "$VDPB_H" 2026-11-12 1; then echo "PASS  S14X-143 $VDPB_F preflight x-fn-build = $VDPB_H (2026-11-12.1 or later)"
      elif [ "$VDPB_LIVE" = 1 ]; then echo "FAIL  S14X-143 $VDPB_F preflight x-fn-build = ${VDPB_H:-none} while the lane's functions serve 2026-11-12.1 (want 2026-11-12.1 or later: it enforces the window)"
      else echo "INFO  S14X-143 $VDPB_F preflight x-fn-build = ${VDPB_H:-none}: not pasted yet"; fi
    done;;
  B|B\ *|b|b\ *)
    if grep -qE 'pastBuyers:.*PAST_BUYER_DAYS' supabase/functions/_shared/product-cuts.ts 2>/dev/null; then echo "FAIL  S14X-143 decided ($VDPB_O143), but _shared/product-cuts.ts still promises the link for PAST_BUYER_DAYS days in a pastBuyers sentence"
    elif ! grep -qE 'pastBuyers:' supabase/functions/_shared/product-cuts.ts 2>/dev/null; then echo "FAIL  S14X-143 decided ($VDPB_O143), but _shared/product-cuts.ts has no pastBuyers sentence to judge"
    else echo "PASS  S14X-143 decided ($VDPB_O143): no cut-product sentence promises a day count nothing enforces"; fi
    for VDPB_F in create-product-checkout create-scan-pack-checkout; do
      VDPB_H=$(vdpb_build "$VDPB_F")
      if [ -n "$VDPB_H" ] && build_ge "$VDPB_F" "$VDPB_H" 2026-11-12 1; then echo "PASS  S14X-143 $VDPB_F preflight x-fn-build = $VDPB_H (2026-11-12.1 or later: it answers the new sentence)"
      elif [ "$VDPB_LIVE" = 1 ]; then echo "FAIL  S14X-143 $VDPB_F preflight x-fn-build = ${VDPB_H:-none} while the lane's functions serve 2026-11-12.1 (want 2026-11-12.1 or later: it bundles product-cuts.ts)"
      else echo "INFO  S14X-143 $VDPB_F preflight x-fn-build = ${VDPB_H:-none}: not pasted yet"; fi
    done;;
  *) echo "FAIL  S14X-143 ownerDecided reads '$VDPB_O143', neither A (enforce) nor B (drop the promise): nothing says what must ship";;
esac
VDPB_O225=$(vdpb_decided S14X-225)
if [ -z "$VDPB_O225" ]; then echo "INFO  S14X-225 owner pending: send-agent-digest and send-agent-digest-morning stay scheduled until the owner's explicit yes (no mail is stopped without one)"
elif printf '%s' "$VDPB_O225" | grep -qiE '^(no|keep)'; then echo "INFO  S14X-225 decided ($VDPB_O225): both agent-digest jobs stay, as today; nothing ships"
else
  VDPB_DIGEST=$(node -e 'let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{process.stdout.write("UNREADABLE");process.exit(0)}if(!Array.isArray(j)){process.stdout.write("UNREADABLE");process.exit(0)}process.stdout.write(j.filter((r)=>r&&/^send-agent-digest(-morning)?$/.test(r.ch_jobname)).map((r)=>r.ch_jobname).join(" "))' /tmp/vd_bpb_cron.json)
  if [ "$VDPB_DIGEST" = UNREADABLE ]; then echo "FAIL  S14X-225 decided ($VDPB_O225), but get_cron_health did not answer a list, so the digest jobs cannot be judged"
  elif [ -z "$VDPB_DIGEST" ]; then echo "PASS  S14X-225 decided ($VDPB_O225): neither send-agent-digest nor send-agent-digest-morning is scheduled"
  elif [ "$VDPB_LIVE" = 1 ]; then echo "FAIL  S14X-225 decided ($VDPB_O225), but get_cron_health still lists $VDPB_DIGEST while the lane's functions serve 2026-11-12.1"
  else echo "INFO  S14X-225 decided ($VDPB_O225); get_cron_health still lists $VDPB_DIGEST: the round has not pasted"; fi
fi
rm -f /tmp/vd_bpb_cron.json
