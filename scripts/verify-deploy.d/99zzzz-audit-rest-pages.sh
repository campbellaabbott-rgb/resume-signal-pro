# shellcheck shell=bash
# ── 99zzzz. AUDIT-REST, PAGES: a share link reads an analysis and only its
# buyer deletes it; the analysis mail in the buyer's language with the buyer's
# own link; the owner's regeneration on the shared chain; past buyers' links
# say why they cannot open (branch fix/audit-rest-pages: S13-079, FA-1, FA-2,
# S13-048, S13-128, S13-130 and the page items; migration 20261103130000;
# send-analysis-email and admin-regenerate-delivery 2026-11-03.1).
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh in byte order ("-"
# sorts before "z") and under a collating locale that ignores the dash.
#
# THE CLAIMS, one line each:
#   B1  send-analysis-email serves 2026-11-03.1 or later (the mail in the
#       buyer's language, its button the buyer's own /success?session_id=);
#   B2  admin-regenerate-delivery serves 2026-11-03.1 or later (the shared
#       chain, no synthesised delivery, no model named to the customer);
#   D1  delete_analysis_by_share_id refuses a share id alone, with the new
#       rule's message (the old function tried to delete);
#   D2  a well-formed pair whose purchase did not redeem that analysis
#       answers false (the function reads purchased_content and deletes
#       nothing);
#   P1  the published success page sends '<share id>:<purchase>' and shows a
#       shared view no delete button (its chunk carries the note's key);
#   P2  the published product page says why a link did not open and asks a
#       link with no reference for its email link (its chunk carries the
#       refusal and no-reference keys).
# Not provable from outside, so proved in the suite: the mail's nine
# languages, the chain's order and refusals, the share-link card, the report's
# layout, the coach's per-question drafts, the writing tools' reopening time,
# the answers kept per job, and the sales that are no longer recorded twice.
#
# READ-ONLY: OPTIONS preflights (no function logic runs), two GETs of the RPC
# (PostgREST runs a GET in a READ ONLY transaction, so even the old function
# could only fail with 25006, never delete), and GETs of the site's entry
# script and two of its chunks. Nothing is sent, bought or written.
echo "== 99zzzz. audit-rest pages: buyer-only delete, the analysis mail, the regeneration chain, past buyers' links (2026-11-03.1) =="

vdarp_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

for VDARP_FN in send-analysis-email admin-regenerate-delivery; do
  VDARP_H=$(vdarp_build "$VDARP_FN")
  if [ -z "$VDARP_H" ]; then echo "FAIL  $VDARP_FN preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
  elif build_ge "$VDARP_FN" "$VDARP_H" "2026-11-03" "1"; then echo "PASS  $VDARP_FN x-fn-build = $VDARP_H ($VDARP_FN.2026-11-03.1 or later)"
  else echo "FAIL  $VDARP_FN x-fn-build = $VDARP_H, older than $VDARP_FN.2026-11-03.1: this branch's change to it is not serving"; fi
done

# D1, D2: the RPC, by GET. A share id no analysis has, so nothing could match.
VDARP_SHARE=0f0e0d0c0b0a09080706050403020100
VDARP_REF=cs_test_verifydeploy20261103pages
vdarp_rpc() { # $1 p_share_id -> the raw answer
  curl -s -m 60 "$B/rest/v1/rpc/delete_analysis_by_share_id?p_share_id=$1" -H "apikey: $K" -H "Authorization: Bearer $K"
}
VDARP_BARE=$(vdarp_rpc "$VDARP_SHARE")
VDARP_BARE_CODE=$(printf '%s' "$VDARP_BARE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j&&typeof j==="object"&&!Array.isArray(j)?(j.code||"NOCODE")+"|"+String(j.message||"").slice(0,120):"VALUE|"+JSON.stringify(j))}catch{console.log("NONJSON|")}})')
case "$VDARP_BARE_CODE" in
  *"want <share id>:<purchase reference>"*) echo "PASS  delete_analysis_by_share_id refuses a share id alone with the buyer-only rule (${VDARP_BARE_CODE%%|*})";;
  25006*) echo "FAIL  delete_analysis_by_share_id tried to delete on a share id alone (only this read-only GET stopped it): migration 20261103130000 has not run";;
  PGRST202*) echo "FAIL  delete_analysis_by_share_id(p_share_id) is not found (PGRST202): the success page's delete cannot reach it";;
  *) echo "FAIL  delete_analysis_by_share_id on a share id alone answered ${VDARP_BARE_CODE}  $(printf '%s' "$VDARP_BARE" | head -c 160)";;
esac
VDARP_PAIR=$(vdarp_rpc "$VDARP_SHARE:$VDARP_REF")
case "$(printf '%s' "$VDARP_PAIR" | tr -d '[:space:]')" in
  false) echo "PASS  delete_analysis_by_share_id answers false for a purchase that did not redeem the analysis, and deletes nothing";;
  *25006*) echo "FAIL  delete_analysis_by_share_id tried to delete for a purchase that redeemed nothing: the redemption check is not serving";;
  *) echo "FAIL  delete_analysis_by_share_id on '<share>:<unredeemed purchase>' answered $(printf '%s' "$VDARP_PAIR" | head -c 160) (want false)";;
esac

# P1, P2: the published pages. The entry names each route's chunk.
VDARP_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDARP_MAINJS=""
[ -n "$VDARP_MAIN" ] && VDARP_MAINJS=$(curl -s -m 30 "$SITE$VDARP_MAIN")
vdarp_chunk() { # $1 chunk name prefix -> the chunk's file name from the entry
  printf '%s' "$VDARP_MAINJS" | grep -o "\"\./$1-[A-Za-z0-9_-]*\.js\"" | head -1 | tr -d '"' | sed 's|^\./||'
}
VDARP_SUCC=$(vdarp_chunk Success)
if [ -z "$VDARP_SUCC" ]; then echo "FAIL  the served entry (${VDARP_MAIN:-none found}) names no Success chunk: the frontend is not serving, or the bundle layout moved"
else
  VDARP_SJS=$(curl -s -m 30 "$SITE/assets/$VDARP_SUCC")
  if printf '%s' "$VDARP_SJS" | grep -qF 'success.sharedViewDeleteNote' && printf '%s' "$VDARP_SJS" | grep -qF 'shared-computer-note'; then echo "PASS  the published success page ($VDARP_SUCC) offers a shared view no delete and says the analysis is kept for its days"
  else echo "FAIL  the published success page ($VDARP_SUCC) carries no shared-view note: the frontend publish with S13-079 and S13-027 has not happened"; fi
fi
VDARP_PROD=$(vdarp_chunk ProductSuccess)
if [ -z "$VDARP_PROD" ]; then echo "FAIL  the served entry (${VDARP_MAIN:-none found}) names no ProductSuccess chunk: the frontend is not serving, or the bundle layout moved"
else
  VDARP_PJS=$(curl -s -m 30 "$SITE/assets/$VDARP_PROD")
  if printf '%s' "$VDARP_PJS" | grep -qF 'productSuccess.refusal.refunded' && printf '%s' "$VDARP_PJS" | grep -qF 'no-purchase-reference'; then echo "PASS  the published product page ($VDARP_PROD) says why a purchase link did not open, and asks a link with no reference for the email's link"
  else echo "FAIL  the published product page ($VDARP_PROD) carries no refusal or no-reference state: the frontend publish with S13-048 and S13-128 has not happened"; fi
fi
