# R1 sign-in server (2026-10-14): auth-signed-in and the masked buyer address
# in verify-product-purchase, migration 20261014110000. Sourced by
# scripts/verify-deploy.sh. Read-only:
#   - OPTIONS preflights on auth-signed-in and verify-product-purchase (the
#     build each one serves);
#   - two POSTs to auth-signed-in that are refused before anything is read or
#     written: one with no token (the platform's verify_jwt refuses it), one
#     with the publishable key (the function's own website-session check
#     refuses it, which proves the shipped code is the one answering);
#   - GET probes of the three new definers (PostgREST runs a GET read-only)
#     and GET reads of the two new tables as anon.
# Nothing here signs in, calls verify-product-purchase with a session id, or
# writes. Every secret stays in variables; nothing echoes $K.
echo "== 96. R1 sign-in server: auth-signed-in serving, the buyer's address masked, proofs closed to clients =="
VD96_ASI_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/auth-signed-in" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization, content-type" | tr -d '\r')
VD96_ASI=$(printf '%s\n' "$VD96_ASI_H" | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD96_ASI_ORIGIN=$(printf '%s\n' "$VD96_ASI_H" | grep -i '^access-control-allow-origin:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD96_ASI" ]; then VD96_ASI_OK=0; echo "FAIL  auth-signed-in preflight carries no x-fn-build (want auth-signed-in.2026-10-14.1 or later; absent = the function is not deployed)"
elif build_ge auth-signed-in "$VD96_ASI" 2026-10-14 1; then VD96_ASI_OK=1; echo "PASS  auth-signed-in preflight x-fn-build = $VD96_ASI (auth-signed-in.2026-10-14.1 or later)"
else VD96_ASI_OK=0; echo "FAIL  auth-signed-in preflight x-fn-build = $VD96_ASI (want auth-signed-in.2026-10-14.1 or later)"; fi
if [ "$VD96_ASI_OK" = "1" ]; then
  if [ "$VD96_ASI_ORIGIN" = "https://resumebooster.work" ]; then echo "PASS  auth-signed-in answers the site's origin: access-control-allow-origin = $VD96_ASI_ORIGIN"
  else echo "FAIL  auth-signed-in preflight access-control-allow-origin = ${VD96_ASI_ORIGIN:-absent} (want https://resumebooster.work: the site could not read the answer)"; fi
fi
VD96_VPP=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/verify-product-purchase" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD96_VPP" ]; then echo "FAIL  verify-product-purchase preflight carries no x-fn-build (want verify-product-purchase.2026-10-14.1 or later)"
elif build_ge verify-product-purchase "$VD96_VPP" 2026-10-14 1; then echo "PASS  verify-product-purchase preflight x-fn-build = $VD96_VPP (2026-10-14.1 or later: the buyer's address is masked unless the caller proved that mailbox)"
else echo "FAIL  verify-product-purchase preflight x-fn-build = $VD96_VPP (want verify-product-purchase.2026-10-14.1 or later: the previous build shows the full address to anyone holding the link)"; fi

# Refused before any work: no token at all, then the publishable key.
VD96_NOAUTH=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/auth-signed-in" -H "apikey: $K" -H "Content-Type: application/json" -d '{}')
VD96_ANON_H=$(curl -s -m 30 -D - -o /tmp/vd_96_anon.json -X POST "$B/functions/v1/auth-signed-in" -H "apikey: $K" -H "Authorization: Bearer $K" -H "Content-Type: application/json" -d '{}' | tr -d '\r')
VD96_ANON_CODE=$(printf '%s\n' "$VD96_ANON_H" | head -1 | awk '{print $2}')
VD96_ANON_BUILD=$(printf '%s\n' "$VD96_ANON_H" | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD96_ANON_REASON=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_96_anon.json","utf8"));process.stdout.write(String(j.reason??""))}catch{}')
if [ "$VD96_NOAUTH" = "401" ]; then echo "PASS  auth-signed-in POST with no token -> 401"
else echo "FAIL  auth-signed-in POST with no token -> ${VD96_NOAUTH:-no answer} (want 401)"; fi
if [ "$VD96_ASI_OK" != "1" ]; then echo "INFO  auth-signed-in POST with the publishable key -> ${VD96_ANON_CODE:-no answer} (judged once 2026-10-14.1 serves)"
elif [ "$VD96_ANON_CODE" = "401" ] && [ "$VD96_ANON_REASON" = "not_signed_in" ] && build_ge auth-signed-in "$VD96_ANON_BUILD" 2026-10-14 1; then
  echo "PASS  auth-signed-in POST with the publishable key -> 401 reason not_signed_in from $VD96_ANON_BUILD (the function's own website-session check answered)"
else echo "FAIL  auth-signed-in POST with the publishable key -> ${VD96_ANON_CODE:-no answer} reason ${VD96_ANON_REASON:-none} build ${VD96_ANON_BUILD:-none} (want 401 not_signed_in from auth-signed-in.2026-10-14.1 or later)"; fi

# The definers answer only service_role (GET: read-only even if a revoke regressed).
probe auth_changed_since '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_since":"2026-01-01T00:00:00Z"}'
probe auth_sign_in_addresses '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_at":"2026-01-01T00:00:00Z"}'
probe auth_user_has_password '{"p_user_id":"00000000-0000-0000-0000-000000000000"}'

# The tables answer no client role.
for VD96_T in account_mailbox_proofs account_password_clears; do
  VD96_TC=$(curl -s -m 30 -o /tmp/vd_96_table.json -w '%{http_code}' "$B/rest/v1/$VD96_T?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  VD96_TCODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_96_table.json","utf8"));process.stdout.write(Array.isArray(j)?"ROWS:"+j.length:String(j.code??"NOCODE"))}catch{process.stdout.write("NONJSON")}')
  case "$VD96_TCODE" in
    42501) echo "PASS  $VD96_T as anon -> $VD96_TC 42501 (closed to client roles)";;
    PGRST205|42P01) echo "INFO  $VD96_T as anon -> $VD96_TC $VD96_TCODE (the table does not exist yet: 20261014110000 not applied)";;
    ROWS:*) echo "FAIL  $VD96_T is READABLE as anon -> $VD96_TC $VD96_TCODE";;
    *) echo "FAIL  $VD96_T as anon -> $VD96_TC $VD96_TCODE (want 42501)";;
  esac
done
