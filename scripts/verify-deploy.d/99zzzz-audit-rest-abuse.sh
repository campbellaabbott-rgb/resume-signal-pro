# shellcheck shell=bash
# ── 99zzzz-audit-rest-abuse. THE AUDIT-REST ABUSE ROUND (branch
# fix/audit-rest-abuse, 2026-11-03): S9-001 (a connector's OAuth token is a
# website session nowhere), S13-066 (parse-spreadsheet is bounded, timed and
# counted), S13-071 (domain proof reads the full Public Suffix
# List), S13-072 (a refused key-link mail stops counting), S13-073 (a
# shortlist blocklist entry is a phrase), S13-098 (a refused claim mail hands
# its counts back). Migrations 20261103160000, 20261103161000, 20261103165000
# and 20261103170000. Fifteen functions at 2026-11-03.1.
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh in byte order and
# under a collating locale that ignores the dash.
#
# THE CLAIMS, one line each:
#   B   each function this round changed serves 2026-11-03.1 or later on its
#       preflight (absent or older is a FAIL: the deploy did not land);
#   G1  mail_door_give and api_key_request_unsent exist and answer anon 42501
#       (a GET probe: read-only even if the revoke regressed). Missing
#       (PGRST202) is INFO until the function that calls it serves its
#       2026-11-03.1, and a FAIL after: from then on a refused mail would keep
#       counting, which is the bug;
#   G2  custom_access_token_hook still answers anon 42501 after its
#       redefinition (20261103160000);
#   O   the OAuth server's discovery document: INFO either way. While it
#       answers 404 feature_disabled no connector token can exist. Once it
#       answers, the access-token hook must be enabled in the dashboard
#       (Authentication > Hooks), which nothing outside can read.
#
# WHAT THIS SECTION CANNOT SEE. The hook's new body, the mcp_client role and
# the restrictive policies live where the publishable key reads nothing;
# each migration's own self-check fails its apply if any of them is wrong,
# so an applied migration is the proof. The client-side CSV changes
# (Shortlist, /errors) and the consent sentence ship in the frontend.
#
# READ-ONLY. OPTIONS preflights, three GET probes of revoked functions and one
# GET of the auth server's discovery document. Nothing is posted.
echo "== 99zzzz. audit-rest abuse round: builds, the mail give-backs closed to clients, the hook still closed, the OAuth server's state =="

VDAB_FNS="agent-access agent-connect agent-pass-status api-key-request check-subscription company-claim create-agent-checkout create-checkout create-pass-checkout create-portal-session create-product-checkout create-subscription-checkout parse-spreadsheet shortlist-evaluate withdraw-subscription"
VDAB_SERVING=" "
for VDAB_F in $VDAB_FNS; do
  VDAB_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDAB_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VDAB_H" ]; then echo "FAIL  $VDAB_F preflight carries no x-fn-build (want $VDAB_F.2026-11-03.1 or later)"
  elif build_ge "$VDAB_F" "$VDAB_H" 2026-11-03 1; then VDAB_SERVING="$VDAB_SERVING$VDAB_F "; echo "PASS  $VDAB_F preflight x-fn-build = $VDAB_H (2026-11-03.1 or later)"
  else echo "FAIL  $VDAB_F preflight x-fn-build = $VDAB_H (want $VDAB_F.2026-11-03.1 or later: the audit-rest abuse round has not deployed)"; fi
done

# G1: the give-backs. A missing one is a FAIL only once its caller serves the
# build that depends on it.
vdab_giveback() {
  local fn="$1" caller="$2" args="$3" line
  line=$(probe "$fn" "$args")
  case "$line" in
    "INFO  "*PGRST202*)
      case "$VDAB_SERVING" in
        *" $caller "*) echo "FAIL  $fn -> PGRST202 while $caller serves 2026-11-03.1: its migration is not applied, so a mail the provider refused still counts against the address";;
        *) echo "INFO  $fn -> PGRST202 (not applied yet; judged once $caller serves 2026-11-03.1)";;
      esac;;
    *) echo "$line";;
  esac
}
vdab_giveback mail_door_give company-claim '{"p_door":"verify-deploy-probe","p_bucket":"verify-deploy-probe","p_window_minutes":1}'
vdab_giveback api_key_request_unsent api-key-request '{"p_token_hash":"0000000000000000000000000000000000000000000000000000000000000000"}'

# G2: the hook, redefined, is still the auth server's alone.
probe custom_access_token_hook '{"event":{"claims":{}}}'

# O: the OAuth server. Informational: the S9-001 layers are latent until it answers.
rm -f /tmp/vd_99zzzz_oas.json
VDAB_OAS=$(curl -s -m 30 -o /tmp/vd_99zzzz_oas.json -w '%{http_code}' "$B/auth/v1/.well-known/oauth-authorization-server" -H "apikey: $K")
VDAB_OAS_CODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_99zzzz_oas.json","utf8"));process.stdout.write(String(j.error_code??j.code??(j.issuer?"issuer":"")))}catch{process.stdout.write("unparsed")}')
rm -f /tmp/vd_99zzzz_oas.json
case "$VDAB_OAS" in
  404) echo "INFO  the OAuth server's discovery answers 404 ${VDAB_OAS_CODE:-}: no connector token can be minted, so S9-001's layers are latent";;
  200) echo "INFO  the OAuth server's discovery answers 200 (${VDAB_OAS_CODE:-}): connector tokens can be minted; confirm Authentication > Hooks > Custom Access Token points at public.custom_access_token_hook, or a connector token reaches the database as role authenticated (20261103161000 still keeps it from every row)";;
  *) echo "INFO  the OAuth server's discovery answered ${VDAB_OAS:-nothing} (${VDAB_OAS_CODE:-})";;
esac
