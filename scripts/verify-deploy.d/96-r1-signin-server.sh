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
#     and GET reads of the two new tables as anon, each selecting a real
#     column, so the answer is the permission refusal (42501) and never a
#     missing-column one.
# THE MIGRATION IS A PRECONDITION OF THE BUILD (lead decision A, third fixer
# round): once auth-signed-in answers 2026-10-14.1 or later, a definer that
# does not exist (PGRST202) or a table that does not exist (PGRST205, 42P01)
# is a FAIL, not an INFO. With the tables missing every guard call answers
# 503, the reset never shows its password form, and a member without a
# password is locked out (S12-057) while the section read as passing. The
# INFO stays only while the build is absent, when nothing yet depends on it.
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

# The definers answer only service_role (GET: read-only even if a revoke
# regressed). A definer that does not exist is INFO only while the build is
# absent; once auth-signed-in serves its R1 build it is a FAIL.
vd96_probe() {
  local line; line=$(probe "$1" "$2")
  case "$line" in
    "INFO  "*PGRST202*)
      if [ "$VD96_ASI_OK" = "1" ]; then echo "FAIL  $1 -> PGRST202 while auth-signed-in serves its R1 build: 20261014110000 is not applied, so every guard call answers 503, the reset never shows its password form, and a member without a password is locked out (apply the migration before the frontend)"
      else echo "$line (judged once auth-signed-in serves its R1 build)"; fi;;
    *) echo "$line";;
  esac
}
vd96_probe auth_changed_since '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_since":"2026-01-01T00:00:00Z"}'
vd96_probe auth_sign_in_addresses '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_at":"2026-01-01T00:00:00Z"}'
vd96_probe auth_user_has_password '{"p_user_id":"00000000-0000-0000-0000-000000000000"}'

# The tables answer no client role. Each read selects a real column of its
# table (user_id, session_id), so a closed table answers the permission
# refusal and never a missing-column one.
for VD96_TSEL in account_mailbox_proofs:user_id account_password_clears:session_id; do
  VD96_T=${VD96_TSEL%%:*}; VD96_COL=${VD96_TSEL#*:}
  VD96_TC=$(curl -s -m 30 -o /tmp/vd_96_table.json -w '%{http_code}' "$B/rest/v1/$VD96_T?select=$VD96_COL&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  VD96_TCODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_96_table.json","utf8"));process.stdout.write(Array.isArray(j)?"ROWS:"+j.length:String(j.code??"NOCODE"))}catch{process.stdout.write("NONJSON")}')
  case "$VD96_TCODE" in
    42501) echo "PASS  $VD96_T as anon -> $VD96_TC 42501 (closed to client roles)";;
    PGRST205|42P01)
      if [ "$VD96_ASI_OK" = "1" ]; then echo "FAIL  $VD96_T as anon -> $VD96_TC $VD96_TCODE while auth-signed-in serves its R1 build: the table does not exist, 20261014110000 is not applied, so every guard call answers 503 and the reset dead-ends (apply the migration before the frontend)"
      else echo "INFO  $VD96_T as anon -> $VD96_TC $VD96_TCODE (the table does not exist yet: 20261014110000 not applied; judged once auth-signed-in serves its R1 build)"; fi;;
    ROWS:*) echo "FAIL  $VD96_T is READABLE as anon -> $VD96_TC $VD96_TCODE";;
    *) echo "FAIL  $VD96_T as anon -> $VD96_TC $VD96_TCODE (want 42501)";;
  esac
done
