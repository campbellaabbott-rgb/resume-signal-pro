# shellcheck shell=bash
# ── 92. WAVE 4, SECOND ROUND, ACCOUNT-COMPLIANCE (branch w4b/account-compliance):
# the account home, account deletion, the legal notice, the marketing pause,
# analytics consent, the Privacy page and Shortlist (S12 account-compliance
# items; critical-path plan CP-F, CP-G, CP-H, CP-J's account functions).
#
# THE CLAIMS, one line each below:
#   - send-agent-digest, send-market-pulse, send-scan-report, send-search-digest
#     and shortlist-evaluate serve 2026-10-11.25 or later, and so do
#     stripe-webhook and withdraw-subscription, which bundle the legal notice
#     that is now rendered once and resent with that body (S12-102); delete-account,
#     get-account-data and the new account-order and account-settings serve
#     2026-10-14.25 or later (they import _shared/mailbox-proof.ts, which R1
#     stamped 2026-10-14.1 and deploys first);
#   - MARKETING MAIL IS SENT ONLY WITH A SELLER IDENTITY (S12-010): each
#     marketing sender's preflight says x-marketing-mail. While it says
#     paused_no_seller_identity this is a FAIL that only the owner can clear,
#     by putting the seller's legal name and postal address in
#     src/config/seller.ts and supabase/functions/_shared/seller-identity.ts;
#     a missing header on a current build is a FAIL too;
#   - 20261011170000 applied: account_erase_personal_data exists and anon may
#     not run it (a GET probe: PostgREST runs it read-only);
#   - the published frontend carries this round: the consent banner chunk and
#     the analytics consent key (our analytics wait for a yes, S12-011), the
#     account chunk with the connected-AIs card, account-settings and each
#     order's Report a problem, the
#     Privacy chunk naming Mailgun and ipinfo among the processors (S12-049),
#     and a Shortlist chunk that asks for the uploader's attestation and reads
#     no demographics table (D14);
#   - what no read here can prove is INFO: 20261011171000's revoked writes
#     (the owner's read below), and the host's own analytics script (owner
#     decision D5).
#
# READ-ONLY. OPTIONS preflights run no function logic; the RPC probe is a GET,
# which PostgREST runs in a read-only transaction; the rest are GETs of public
# pages and static assets. Nothing is signed in, sent or written.
echo "== 92. w4b account-compliance: the account home, deletion, the legal notice, the marketing pause, analytics consent, Privacy and Shortlist =="

vd92ac_head() { # $1 fn -> the preflight's response headers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r'
}
vd92ac_hdr() { # $1 headers, $2 name -> that header's value
  printf '%s\n' "$1" | grep -i "^$2:" | head -1 | sed -E 's/^[^:]+: *//'
}

for VD92AC_FN in send-agent-digest send-market-pulse send-scan-report send-search-digest shortlist-evaluate stripe-webhook withdraw-subscription; do
  VD92AC_H=$(vd92ac_head "$VD92AC_FN")
  VD92AC_BUILD=$(vd92ac_hdr "$VD92AC_H" x-fn-build)
  if build_ge "$VD92AC_FN" "$VD92AC_BUILD" "2026-10-11" "25"; then
    echo "PASS  $VD92AC_FN preflight x-fn-build = $VD92AC_BUILD ($VD92AC_FN.2026-10-11.25 or later)"
    case "$VD92AC_FN" in
      send-agent-digest|send-market-pulse|send-scan-report)
        VD92AC_MAIL=$(vd92ac_hdr "$VD92AC_H" x-marketing-mail)
        case "$VD92AC_MAIL" in
          on) echo "PASS  $VD92AC_FN x-marketing-mail = on (the seller's legal name and postal address are set, so its marketing mail carries them)" ;;
          paused_no_seller_identity) echo "FAIL  $VD92AC_FN x-marketing-mail = paused_no_seller_identity: its marketing mail is paused because the seller's legal name and postal address are empty (S12-010). OWNER: put both in src/config/seller.ts and supabase/functions/_shared/seller-identity.ts; they are never invented" ;;
          *) echo "FAIL  $VD92AC_FN carries no x-marketing-mail on build $VD92AC_BUILD (want on or paused_no_seller_identity): the pause cannot be read" ;;
        esac ;;
    esac
  else
    echo "FAIL  $VD92AC_FN preflight x-fn-build = ${VD92AC_BUILD:-none} (want $VD92AC_FN.2026-10-11.25 or later)"
  fi
done

for VD92AC_FN in delete-account get-account-data account-order account-settings; do
  VD92AC_H=$(vd92ac_head "$VD92AC_FN")
  VD92AC_BUILD=$(vd92ac_hdr "$VD92AC_H" x-fn-build)
  if build_ge "$VD92AC_FN" "$VD92AC_BUILD" "2026-10-14" "25"; then echo "PASS  $VD92AC_FN preflight x-fn-build = $VD92AC_BUILD ($VD92AC_FN.2026-10-14.25 or later: R1's day, this round's sequence)"
  else echo "FAIL  $VD92AC_FN preflight x-fn-build = ${VD92AC_BUILD:-none} (want $VD92AC_FN.2026-10-14.25 or later)"; fi
done

# 42501: PostgREST found the eraser and anon may not run it. PGRST202: no
# function takes these arguments (20261011170000 has not applied). Rows or a
# write refused only by the read-only GET: anyone could erase an account.
VD92AC_ERASE=$(curl -s -m 60 "$B/rest/v1/rpc/account_erase_personal_data?p_user_id=00000000-0000-0000-0000-000000000000&p_email=probe%40example.invalid&p_email_proven=false" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$VD92AC_ERASE" in
  42501) echo "PASS  account_erase_personal_data exists and anon may not run it (20261011170000 applied)" ;;
  PGRST202) echo "FAIL  no account_erase_personal_data(p_user_id, p_email, p_email_proven): 20261011170000 has not applied, and delete-account 2026-10-14.25 names a missing function before every deletion" ;;
  *) echo "FAIL  account_erase_personal_data probe as anon -> $VD92AC_ERASE (want 42501: anyone could erase an account's keys and lists)" ;;
esac

# The published frontend: the entry, then the chunks it names.
VD92AC_ENTRY=$(curl -s -m 30 -A "$UA" "$SITE/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
if [ -z "$VD92AC_ENTRY" ]; then
  echo "FAIL  the site's shell names no /assets/index-*.js entry: the published frontend cannot be judged"
else
  curl -s -m 60 -A "$UA" "$SITE$VD92AC_ENTRY" > /tmp/vd_92ac_entry.js
  vd92ac_chunk() { # $1 page name -> that lazy chunk's text in /tmp/vd_92ac_<name>.js, or nothing
    local f; f=$(grep -oE "\"\./$1-[A-Za-z0-9_-]+\.js\"" /tmp/vd_92ac_entry.js | head -1 | tr -d '"' | sed 's#^\./##')
    : > "/tmp/vd_92ac_$1.js"
    [ -n "$f" ] && curl -s -m 60 -A "$UA" "$SITE/assets/$f" > "/tmp/vd_92ac_$1.js"
    printf '%s' "$f"
  }
  VD92AC_CB=$(vd92ac_chunk ConsentBanner)
  if [ -z "$VD92AC_CB" ]; then echo "FAIL  the live entry loads no ConsentBanner chunk: our analytics have no banner to wait for (S12-011)"
  elif grep -q 'rb_analytics_consent' /tmp/vd_92ac_entry.js /tmp/vd_92ac_ConsentBanner.js && grep -q 'rb:analytics-consent' /tmp/vd_92ac_entry.js /tmp/vd_92ac_ConsentBanner.js; then echo "PASS  the live entry loads $VD92AC_CB and carries the analytics consent key: no event is posted and no visitor id stored before a yes"
  else echo "FAIL  $VD92AC_CB is live but the consent key is not in the published code (S12-011)"; fi

  VD92AC_AC=$(vd92ac_chunk Account)
  if [ -z "$VD92AC_AC" ]; then echo "FAIL  the live entry names no Account chunk: the account home cannot be judged"
  elif grep -q 'account-settings' /tmp/vd_92ac_Account.js && grep -q 'accountConnected.title' /tmp/vd_92ac_Account.js && grep -q 'account-order' /tmp/vd_92ac_Account.js && grep -q 'orders.reportProblem' /tmp/vd_92ac_Account.js; then echo "PASS  $VD92AC_AC carries the connected-AIs card, account-settings, account-order and each order's Report a problem (the account home of this round)"
  else echo "FAIL  $VD92AC_AC lacks the connected-AIs card, account-settings, account-order or Report a problem: the account home of this round is not published"; fi

  VD92AC_PR=$(vd92ac_chunk Privacy)
  if [ -z "$VD92AC_PR" ]; then echo "FAIL  the live entry names no Privacy chunk"
  elif grep -q 'Mailgun' /tmp/vd_92ac_Privacy.js && grep -q 'ipinfo' /tmp/vd_92ac_Privacy.js; then echo "PASS  $VD92AC_PR names Mailgun and ipinfo among the processors (S12-049)"
  else echo "FAIL  $VD92AC_PR does not name Mailgun and ipinfo: the Privacy page still omits processors (S12-049)"; fi

  VD92AC_SL=$(vd92ac_chunk Shortlist)
  if [ -z "$VD92AC_SL" ]; then echo "FAIL  the live entry names no Shortlist chunk"
  elif grep -q 'shortlist_demographics' /tmp/vd_92ac_Shortlist.js; then echo "FAIL  $VD92AC_SL still reads or writes candidates' sex and race (D14)"
  elif grep -q 'attested' /tmp/vd_92ac_Shortlist.js; then echo "PASS  $VD92AC_SL asks for the uploader's attestation and reads no demographics table (D14)"
  else echo "FAIL  $VD92AC_SL sends no attestation: shortlist-evaluate 2026-10-11.25 refuses every evaluation from it"; fi
fi

echo "INFO  20261011171000 (no client role may write shortlist_demographics) is proven by the owner's read: select has_table_privilege('authenticated', 'public.shortlist_demographics', 'INSERT') (false); erasing the rows already recorded is the owner's choice: DELETE FROM public.shortlist_demographics"
echo "INFO  the host's own analytics script is not gated by our banner: turning it off is owner decision D5 (check that /~flock.js is gone from the page source of /auth)"
