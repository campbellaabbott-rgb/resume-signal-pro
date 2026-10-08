# Sourced by scripts/verify-deploy.sh (K, B and the helpers are in scope).
#
# == scan + AI wave 1 (branch claude/w1-scan-ai, 2026-10-05) ==
# THE CLAIMS:
#   - scan credits are spent only for a proven identity -- a Stripe session the
#     buyer's browser kept, the auth user id that claimed such a purchase, or
#     an address whose MAILBOX the session proved (a verified Google/Apple
#     sign-in today; an address on a session is not proof while sign-ups are
#     auto-confirmed) -- only for a delivered full report, and the credit RPCs
#     are closed to the publishable key (migration 20261005120000; defect
#     sweep 1.26, 2.06, 2.07, 2.18). Pro past the daily limit needs the same
#     mailbox proof;
#   - the header reads its balance from the new scan-credits function, which
#     answers a caller holding no proof with zero and no database read;
#   - the stream fallback holds the primary's guards and logs no résumé text
#     (2.05, 2.19), the paid tiers of Interview Coach and Career Path need a
#     purchase (1.60), get_temp_resume reads without deleting and the store is
#     bounded per address and per network with live-row ceilings one network
#     cannot fill (20261005123000), PDFs keep their lines, the paid auto-fix
#     no longer rewrites words or addresses.
#
# READ-ONLY: OPTIONS preflights, a scan-credits POST with no proof (it returns
# before touching the database), and refusal probes of PURE READERS only. The
# credit spender and the temporary store are writers and are never called
# here, not even to watch them refuse; client_callable_census (section 40) and
# the pglite tests prove them from the catalogue and by execution instead.
echo "INFO  == 45. scan + AI wave 1: each changed function answers its 2026-10-05 build =="
for FN in free-keyword-scan free-keyword-scan-stream scan-credits parse-pdf parse-docx parse-spreadsheet \
  generate-interview-coach generate-career-path generate-premium-package generate-premium-package-stream \
  generate-cover-letter generate-cover-letter-stream generate-keyword-fix analyze-linkedin-profile \
  generate-resume-roast get-account-data; do
  W1_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r')
  W1_S=$(printf '%s' "$W1_H" | head -1 | awk '{print $2}')
  W1_V=$(printf '%s' "$W1_H" | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  case "$W1_V" in
    "$FN".2026-10-0[5-9].*|"$FN".2026-1[1-2]-*) echo "PASS  $FN preflight x-fn-build = $W1_V";;
    "") echo "FAIL  $FN preflight (HTTP $W1_S) carries no x-fn-build: not deployed (scan-credits is new: 404 until published)";;
    *) echo "FAIL  $FN preflight x-fn-build = $W1_V (want $FN.2026-10-05.N or later): the previous bundle is still serving";;
  esac
done

# scan-credits: a caller with no session and no account proves nothing and is
# answered zero before any database or Stripe call.
W1_SC=$(curl -s -m 30 -X POST "$B/functions/v1/scan-credits" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{}')
case "$W1_SC" in
  *'"credits":0'*'"signedIn":false'*) echo "PASS  scan-credits answers a caller with no proof: $W1_SC";;
  *) echo "FAIL  scan-credits with no proof -> ${W1_SC:0:200}";;
esac

# The credit reader and the new readers: pure reads, so a refusal probe is
# safe even if a revoke had not landed. 42501 = closed by name.
probe get_scan_credits '{"p_email":"verify-deploy-probe@example.invalid"}'
probe scan_credit_balance '{"p_email":"verify-deploy-probe@example.invalid","p_session_hashes":null,"p_user_id":null}'
probe scan_credit_grants_bought '{"p_session_hashes":null}'
probe scan_credit_account_grants '{"p_user_id":"00000000-0000-4000-8000-000000000000"}'
echo "INFO  use_scan_credit, add_scan_credits, scan_credit_redeem/refund/grant_record/grant_claim and store_temp_resume write, so they are not called here; section 40's census and src/test/a-scan-credit-is-spent-only-by-whoever-proved-the-purchase.test.ts / a-stored-resume-can-be-read-again-and-the-store-has-a-ceiling.test.ts prove them"

# THE OWNER'S CLOSING STEP for an address as proof (mailbox-proof.ts): turn
# email confirmation on, then record that moment in the ONE switch every
# caller reads since wave 2 (section 65): UPDATE public.mailbox_proof_settings
# SET confirmation_required_since = now(). Until the auth server answers
# mailer_autoconfirm=false, only a verified Google or Apple sign-in proves an
# address, whatever the switch says. A pure read.
W1_AC=$(curl -s -m 30 "$B/auth/v1/settings" -H "apikey: $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(String(JSON.parse(s).mailer_autoconfirm))}catch{console.log("unreadable")}})')
case "$W1_AC" in
  false) echo "PASS  auth settings: mailer_autoconfirm=false -- an address confirmed after mailbox_proof_settings.confirmation_required_since now counts as proven (if that row is set)";;
  true) echo "INFO  auth settings: mailer_autoconfirm=true -- sign-ups are auto-confirmed, so a password account's address unlocks no address-pooled credits (owner step open: turn on email confirmation, then UPDATE public.mailbox_proof_settings SET confirmation_required_since = now())";;
  *) echo "INFO  auth settings unreadable ($W1_AC): the functions treat that as still auto-confirming";;
esac
