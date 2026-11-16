# shellcheck shell=bash
# ── 99zzzzzzz-bugs-site-shell. BUG ROUND A, LANE SITE-SHELL (branch bugs/a-site-shell).
# A landing seen before the analytics yes is sent once after it (S14X-040);
# the claim mails link the slashed company page and skip bounced inboxes
# (S14X-061); a claim link's token leaves the address before any script
# records it (S14X-103); a returning buyer's second purchase is its own row,
# and a stranger cannot ask which checkout ids exist (S14X-153,
# ab_purchase_known in 20261112140517); an event the site never sends is
# refused and a purchase conversion is recorded only for a checkout we minted
# (S14X-154); verified purchases keep their own hour and IPv6 is grouped by
# /64 (S14X-155); a crash in one page stays in that page (NB-40); an old tab
# after a deploy loads the new version and files no crash (NB-41); a page
# with no title of its own gets its route's (NB-43); the 404 page speaks the
# reader's language and offers a way on (NB-44).
#
# THE CLAIMS, one line each:
#   B   company-claim and track-ab-event serve 2026-11-12.1 or later on their
#       preflight. While neither does, INFO (not pasted yet); once either
#       does, the other older or unstamped is a FAIL (a partial paste);
#   M1  ab_purchase_known exists and anon is refused it by name (42501).
#       Missing (PGRST202) is INFO before the paste and a FAIL after it; an
#       answer to anon is a FAIL either way. A negative control (a name that
#       never existed) must answer PGRST202, or 42501 proves nothing;
#   L1  the company page the fixed claim mail links (slashed, with its
#       claim_verify token) is a page: 200 and more than 10,000 bytes;
#   H1  the first script in the served head moves claim_verify and its path
#       into the stash (S14X-103);
#   F1  the published entry carries the landing held for the yes (S14X-040),
#       the chunk-load test and the new-version screen (NB-41), the crash
#       screen's homepage link (NB-40) and the route titles (NB-43); the
#       NotFound chunk the board and pricing links and no console error
#       (NB-44). Before the paste INFO, after it a FAIL;
#   O   SEO-F10 prints INFO owner pending until docs/deploy-ledger.json
#       reservations['bug-round'].ownerDecided names it; then it judges what
#       the decision ships.
#
# WHAT THIS SECTION CANNOT SEE: the claim mail's suppression read, the
# writer's purchase rule, the event list, the purchase hour and the /64 need
# a request that sends mail or writes a row. They are proven on the shipped
# code by the a-*.test.ts files and budget_test.ts, and the owner's read-only
# SQL is printed below as INFO.
#
# READ-ONLY. OPTIONS preflights, two GET RPC probes, the site's entry and one
# chunk, and three pages. Nothing is posted.
echo "== 99zzzzzzz. bug round A site-shell: builds, ab_purchase_known, the claim page and stash, the published shell, owner gate =="

VDBS_NEW=""
VDBS_OLD=""
for VDBS_F in company-claim track-ab-event; do
  VDBS_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDBS_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -n "$VDBS_H" ] && build_ge "$VDBS_F" "$VDBS_H" 2026-11-12 1; then VDBS_NEW="$VDBS_NEW $VDBS_F=$VDBS_H"
  else VDBS_OLD="$VDBS_OLD $VDBS_F=${VDBS_H:-none}"; fi
done
VDBS_LIVE=0
[ -n "$VDBS_NEW" ] && VDBS_LIVE=1
for VDBS_P in $VDBS_NEW; do echo "PASS  B ${VDBS_P%%=*} preflight x-fn-build = ${VDBS_P#*=} (2026-11-12.1 or later)"; done
for VDBS_P in $VDBS_OLD; do
  VDBS_F=${VDBS_P%%=*}; VDBS_H=${VDBS_P#*=}
  if [ "$VDBS_LIVE" = 0 ]; then echo "INFO  B $VDBS_F preflight x-fn-build = $VDBS_H: bug round A is not pasted yet (judged once either of the lane's functions serves 2026-11-12.1)"
  elif [ "$VDBS_H" = none ]; then echo "FAIL  B $VDBS_F preflight carries no x-fn-build while the lane's other function serves 2026-11-12.1 (want $VDBS_F.2026-11-12.1 or later)"
  else echo "FAIL  B $VDBS_F preflight x-fn-build = $VDBS_H while the lane's other function serves 2026-11-12.1: a partial paste (want $VDBS_F.2026-11-12.1 or later)"; fi
done

# M1: ab_purchase_known, read by GET as anon, beside a name that never existed.
vdbs_rpc() {
  local vdbs_out vdbs_code vdbs_body
  vdbs_out=$(curl -s -m 30 -w '\n%{http_code}' "$B/rest/v1/rpc/$1?p_session_id=cs_test_rbverify" -H "apikey: $K" -H "Authorization: Bearer $K")
  vdbs_code=$(printf '%s' "$vdbs_out" | tail -n 1)
  vdbs_body=$(printf '%s' "$vdbs_out" | sed '$d')
  if printf '%s' "$vdbs_body" | grep -q '"42501"'; then echo "42501"
  elif printf '%s' "$vdbs_body" | grep -q '"PGRST202"'; then echo "PGRST202"
  else echo "$vdbs_code $(printf '%s' "$vdbs_body" | head -c 120)"; fi
}
VDBS_CTL=$(vdbs_rpc rb_verify_never_a_function)
VDBS_APK=$(vdbs_rpc ab_purchase_known)
if [ "$VDBS_CTL" != PGRST202 ]; then
  echo "FAIL  M1 the negative control (rpc/rb_verify_never_a_function) answered $VDBS_CTL, not PGRST202: the API is not answering by name, so ab_purchase_known's answer ($VDBS_APK) cannot be read"
else
  case "$VDBS_APK" in
    42501) echo "PASS  M1 ab_purchase_known exists (20261112140517, S14X-153/154) and anon is refused it by name (42501); the negative control answers PGRST202" ;;
    PGRST202)
      if [ "$VDBS_LIVE" = 1 ]; then echo "FAIL  M1 ab_purchase_known does not exist while the lane's functions serve 2026-11-12.1: 20261112140517 did not apply, so track-ab-event records every purchase conversion as unverified (re-apply it under a fresh stamp)"
      else echo "INFO  M1 ab_purchase_known does not exist yet: 20261112140517 is not applied (bug round A is not pasted)"; fi ;;
    200*) echo "FAIL  M1 ab_purchase_known answered anon ($VDBS_APK): a stranger can ask which checkout ids exist; it must be the service role's alone" ;;
    *) echo "FAIL  M1 ab_purchase_known as anon -> $VDBS_APK (want 42501, or PGRST202 before the paste)" ;;
  esac
fi

# L1: the address the fixed claim mail builds for a dotted token. The file is
# removed first, so a failed fetch never reads an earlier run's page.
rm -f /tmp/vd_bugs_site_shell_lander.html
VDBS_L=$(curl -s -m 30 -o /tmp/vd_bugs_site_shell_lander.html -w '%{http_code}' "$SITE/jobs/company/careers.ulta.com/?claim_verify=00000000-0000-0000-0000-000000000000")
VDBS_LB=$(wc -c < /tmp/vd_bugs_site_shell_lander.html 2>/dev/null | tr -d '[:space:]')
if [ "$VDBS_L" = 200 ] && [ "${VDBS_LB:-0}" -gt 10000 ]; then echo "PASS  L1 /jobs/company/careers.ulta.com/?claim_verify=... (the slashed address the claim mail now links, S14X-061) answers 200 with $VDBS_LB bytes"
else echo "FAIL  L1 /jobs/company/careers.ulta.com/?claim_verify=... answered ${VDBS_L:-nothing} with ${VDBS_LB:-0} bytes (want 200 and more than 10,000): the company page the claim mail links is not a page"; fi

# H1: the served head's first script stashes the claim token (S14X-103).
VDBS_HEAD=$(curl -s -m 30 -A "$UA" "$SITE/jobs/company/careers.ulta.com/" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
const h=(s.match(/<head[^>]*>([\s\S]*?)<\/head>/i)||["",""])[1]; const m=h.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
const code=m?m[1].replace(/\/\*[\s\S]*?\*\//g,""):""; if(!m){console.log("noscript");return;}
console.log((/get\("claim_verify"\)/.test(code)?"token":"notoken")+" "+(/claim_verify_path\s*=\s*P\b/.test(code)?"path":"nopath"))})')
case "$VDBS_HEAD" in
  "token path") echo "PASS  H1 the served head's first script moves claim_verify and its path into the stash before any other script reads the address (S14X-103)" ;;
  noscript) echo "FAIL  H1 /jobs/company/careers.ulta.com/ as served has no inline script in its head: the stash script that must run first is gone" ;;
  *)
    if [ "$VDBS_LIVE" = 1 ]; then echo "FAIL  H1 the served head's first script does not stash the claim token ($VDBS_HEAD) while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened"
    else echo "INFO  H1 the served head's first script does not stash the claim token yet ($VDBS_HEAD): the round's frontend has not published"; fi ;;
esac

# F1: the published shell.
VDBS_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDBS_MAINJS=""
[ -n "$VDBS_MAIN" ] && VDBS_MAINJS=$(curl -s -m 30 "$SITE$VDBS_MAIN")
VDBS_NF=$(printf '%s' "$VDBS_MAINJS" | grep -oE '(\./|assets/)NotFound-[A-Za-z0-9_-]+\.js' | head -1 | sed -E 's#^(\./|assets/)##')
if [ -z "$VDBS_MAINJS" ] || [ -z "$VDBS_NF" ]; then
  echo "FAIL  F1 the served entry (${VDBS_MAIN:-none found}) names no NotFound chunk: the frontend is not serving, or the bundle layout moved, so the published shell cannot be judged"
else
  VDBS_NFJS=$(curl -s -m 30 "$SITE/assets/$VDBS_NF")
  VDBS_MISSING=""
  printf '%s' "$VDBS_MAINJS" | grep -qF 'Funnel landing after consent failed:' || VDBS_MISSING="$VDBS_MISSING the landing held for the analytics yes (S14X-040);"
  printf '%s' "$VDBS_MAINJS" | grep -qF 'Importing a module script failed' || VDBS_MISSING="$VDBS_MISSING the chunk-load test the boundaries read (NB-41);"
  printf '%s' "$VDBS_MAINJS" | grep -qF 'Loading the new version' || VDBS_MISSING="$VDBS_MISSING the new-version screen's English string (NB-41);"
  printf '%s' "$VDBS_MAINJS" | grep -qF 'siteShell.crashHome' || VDBS_MISSING="$VDBS_MISSING the crash screen's homepage link (NB-40);"
  printf '%s' "$VDBS_MAINJS" | grep -qF 'siteShell.titles.' || VDBS_MISSING="$VDBS_MISSING the route titles (NB-43);"
  printf '%s' "$VDBS_NFJS" | grep -qF 'siteShell.notFound.jobs' || VDBS_MISSING="$VDBS_MISSING the 404 page's board and pricing links (NB-44);"
  printf '%s' "$VDBS_NFJS" | grep -qF '404 Error: User attempted' && VDBS_MISSING="$VDBS_MISSING a 404 page without its console error (NB-44);"
  if [ -z "$VDBS_MISSING" ]; then echo "PASS  F1 the published entry carries the held landing, the chunk-load test and new-version screen, the crash screen's homepage link and the route titles, and the 404 chunk ($VDBS_NF) offers the board and pricing with no console error"
  elif [ "$VDBS_LIVE" = 1 ]; then echo "FAIL  F1 the published site lacks${VDBS_MISSING%;} while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened"
  else echo "INFO  F1 the published site lacks${VDBS_MISSING%;}: the round's frontend has not published yet"; fi
fi

echo "INFO  owner read-only SQL after the paste (each needs the service role, which this script never holds): S14X-153 SELECT metadata->>'stripeSessionId', count(*) FROM ab_test_events WHERE test_name='product_conversion' AND event_type='conversion' AND created_at > :paste GROUP BY 1 HAVING count(*) > 1 -- no rows; S14X-154 SELECT test_name, count(*) FROM ab_test_events WHERE created_at > :paste GROUP BY 1 ORDER BY 2 DESC -- every name is on supabase/functions/track-ab-event/allowlist.ts; S14X-061 SELECT count(*) FROM company_claims c JOIN suppressed_emails s ON lower(s.email)=lower(c.work_email) WHERE c.created_at > :paste AND s.created_at < c.created_at AND s.reason IN ('bounce','complaint') -- 0 (a claim from an inbox already suppressed is never written)"
echo "INFO  proven in the suite, never here (each would send mail or write a row): the claim mail's slashed links and its bounced-inbox skip, the second purchase recorded and the repeat refused, an unknown event refused before any read, a forged purchase answered unverified, the purchase hour, the /64 address bucket, the landing sent once after the yes"

# O: SEO-F10. ownerDecided maps key -> choice (a string, or an object with a
# choice), written by the integrator alone.
vdbs_decided() {
  node -e 'let l={};try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
const d=((l.reservations||{})["bug-round"]||{}).ownerDecided||{};const v=d[process.argv[2]];
process.stdout.write(v==null?"":typeof v==="object"?String(v.choice??v.option??JSON.stringify(v)):String(v))' "${VDBS_LEDGER:-docs/deploy-ledger.json}" "$1"
}
VDBS_OF10=$(vdbs_decided SEO-F10)
if [ -z "$VDBS_OF10" ]; then echo "INFO  SEO-F10 owner pending: an address with no baked page (an unbaked live posting) is served the fallback shell, whose robots say index, follow; noindex on the fallback for every path but / waits for the owner (branch bugs/a-site-shell-owner)"
elif printf '%s' "$VDBS_OF10" | grep -qi 'noindex'; then
  VDBS_FB=$(curl -s -m 30 -A "$UA" "$SITE/rb-verify-no-baked-page-here" | grep -c 'data-fallback-noindex')
  if [ "${VDBS_FB:-0}" -ge 1 ]; then echo "PASS  SEO-F10 decided ($VDBS_OF10): the fallback shell served for an address with no baked page carries the script that says noindex on every path but /"
  elif [ "$VDBS_LIVE" = 1 ]; then echo "FAIL  SEO-F10 decided ($VDBS_OF10), but the fallback shell served for an address with no baked page carries no noindex script while the lane's functions serve 2026-11-12.1: the owner half did not publish"
  else echo "INFO  SEO-F10 decided ($VDBS_OF10); the fallback shell does not carry the noindex script yet: the round has not published"; fi
else echo "INFO  SEO-F10 decided ($VDBS_OF10): the fallback keeps index, follow, as today; nothing ships"; fi
