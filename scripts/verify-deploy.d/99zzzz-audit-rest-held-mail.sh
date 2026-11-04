# shellcheck shell=bash
# ── 99zzzz. AUDIT-REST HELD MAIL (branch fix/audit-rest-held-mail; audit
# 2026-10-31, items S13-067, -068, -083, -098, -102 and the digest half of
# -118, plus the recheck's run clock on reconcile-stripe; builds 2026-11-03.1;
# migration 20261103240000).
#
# THE CLAIMS, one line each below:
#   B   send-search-digest, send-scan-report, save-lead and reconcile-stripe
#       serve 2026-11-03.1 or later (each preflight's x-fn-build). All four
#       fail on the deploy before this round;
#   D1  20261103240000 applied: user_job_searches.locale exists (a GET naming
#       the column: 42703 means it has not run), and anon reads no saved search;
#   G   20261103165000 applied: mail_door_give exists and anon may not run it,
#       or send-scan-report's counts cannot go back and a refused send still
#       locks a report out;
#   what no read here can prove is INFO, proven in the suite: each of those
#   needs a real mail, a real lead or a real Stripe list, and this section sends
#   none of them.
#
# READ-ONLY. Preflights run no function logic; the two probes are GETs PostgREST
# runs read-only. No function is POSTed, nothing is written, no mail is sent.
echo "== 99zzzz. audit-rest held mail: digest and report mail languages, the first-match subject, refused sends handed back, the lead alert's ceiling, the reconcile run's clock =="

vdhm_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

for VDHM_FN in send-search-digest send-scan-report save-lead reconcile-stripe; do
  VDHM_H=$(vdhm_build "$VDHM_FN")
  if [ -z "$VDHM_H" ]; then echo "FAIL  $VDHM_FN preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
  elif build_ge "$VDHM_FN" "$VDHM_H" "2026-11-03" "1"; then echo "PASS  $VDHM_FN preflight x-fn-build = $VDHM_H ($VDHM_FN.2026-11-03.1 or later)"
  else echo "FAIL  $VDHM_FN preflight x-fn-build = $VDHM_H (want $VDHM_FN.2026-11-03.1 or later: the build before the audit-rest held mail round is serving)"; fi
done

# D1: the search's locale column, by naming it. PostgREST resolves the column
# before it checks a grant, so a missing column answers 42703 whatever anon may
# read; a present one answers [] (RLS, the owner's rows only) or 42501.
VDHM_LOC=$(curl -s -m 30 "$B/rest/v1/user_job_searches?select=locale&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
VDHM_LOC_V=$(printf '%s' "$VDHM_LOC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(Array.isArray(j))console.log(j.length?"ROWS":"EMPTY");else console.log(String(j&&j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$VDHM_LOC_V" in
  EMPTY|42501) echo "PASS  user_job_searches.locale exists and anon reads no saved search ($VDHM_LOC_V) (S13-102, 20261103240000)";;
  42703) echo "FAIL  user_job_searches has no locale column (42703): migration 20261103240000 has not run, so every digest stays English (S13-102)";;
  ROWS) echo "FAIL  anon read a user_job_searches row: saved searches are exposed";;
  *) echo "FAIL  the locale probe answered $VDHM_LOC_V  $(printf '%s' "$VDHM_LOC" | head -c 160)";;
esac

# G: the function a refused send hands its counts back through.
VDHM_GIVE=$(curl -s -m 60 "$B/rest/v1/rpc/mail_door_give?p_door=probe&p_bucket=probe&p_window_minutes=1" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)||typeof j==="string"||typeof j==="boolean"||j===null?"RAN":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$VDHM_GIVE" in
  42501) echo "PASS  mail_door_give exists and anon may not run it (20261103165000 applied): a refused report mail can hand its counts back (S13-098)";;
  PGRST202) echo "FAIL  mail_door_give does not exist: 20261103165000 has not applied, so a report mail the provider refused still counts against its report (S13-098)";;
  RAN) echo "FAIL  mail_door_give ran for anon: 20261103165000 must leave it to the service role";;
  *) echo "FAIL  mail_door_give probe -> $VDHM_GIVE (want 42501)";;
esac

echo "INFO  a first match on a zero-result alert gets the We-found-it subject, keyed on whether a match was ever mailed, not on the last run's stamp (S13-083): proven in src/test/a-zero-result-alert-says-we-found-it-when-the-first-match-arrives.test.ts, since a read here would need a real mail"
echo "INFO  a search saved with the old agent-ready flag is no longer narrowed (S13-118, the digest half): proven in the same test file; the board builder's migration strips the flag from the rows"
echo "INFO  the digest, the report mail and the four fix-plan mails are written in the reader's language, all nine (S13-102): proven in src/test/the-report-and-digest-mails-are-written-in-the-readers-language.test.ts"
echo "INFO  a refused or failed report send hands its counts back (S13-098), an unsubscribe never lowers a bounce or a complaint (S13-068): proven in src/test/a-report-mail-the-provider-refused-does-not-lock-the-report-out.test.ts"
echo "INFO  the lead alert's two doors and the country lookup behind the limit (S13-067): proven in src/test/a-lead-alert-has-a-ceiling-and-the-lookup-waits-for-the-limit.test.ts. The owner's read after a day: select door, bucket, count(*) from mail_door_counts where door like 'save-lead:%' group by 1,2 limit 5"
echo "INFO  the reconcile run's clock (no re-delivery past 90 s, the mail and the stamp always happen): proven in src/test/a-reconcile-run-out-of-time-still-mails-and-stamps.test.ts. The owner's read: select v -> 'deferred', v -> 'listCut' from job_board_meta where k = 'reconcile_stripe_run'"
