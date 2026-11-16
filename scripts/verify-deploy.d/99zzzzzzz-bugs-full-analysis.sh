# shellcheck shell=bash
# ── 99zzzzzzz. BUG ROUND, LANE FULL-ANALYSIS (branch bugs/a-full-analysis;
# RC-S13-024, RC-S13-048, RC-S13-051, RC-S13-110, S14X-041, S14X-110,
# S14X-112, S14X-178, S14X-209, S14X-219, S14X-220, and S14X-042's claim
# half; builds 2026-11-12.1; migration 20261112130000).
#
# Named 99zzzzzzz-bugs-* so it sorts after the 99zzzzzzz-board-102-* sections
# ("bu" after "bo") in byte order and under a collating locale.
#
# THE CLAIMS, one line each below:
#   BF1 analyze-resume, send-analysis-email, retry-failed-deliveries and
#       verify-scan-pack-purchase serve 2026-11-12.1 or later (each
#       preflight's x-fn-build). An older build is INFO (not pasted yet) while
#       none of the four is on the round's build, and FAIL once one is (a
#       partial paste); a missing header is FAIL.
#   BF2 20261112130000 applied: product_deliveries.notice_owed exists, read as
#       the client role (a GET: [] or 42501, both answered only by a column
#       that exists). Missing (42703) is INFO until retry-failed-deliveries
#       serves 2026-11-12.1, then FAIL; rows answered to anon are FAIL.
#   BF3 the published success page (its chunk): a section the analysis went
#       out without is named (sections-missing, S14X-041); a refusal is read
#       by its code (purchase_refunded, RC-S13-048); a busy service says so
#       (paidAnalysis.busy, S14X-110); an empty canvas is caught (data:,,
#       S14X-112); the requirement filter reads words that name something
#       (its word list, RC-S13-051); the page prints its words from keys and
#       sets its own head (paidAnalysis.page.seoTitle, and none of four
#       English literals, S14X-178). Each missing is INFO until analyze-resume
#       serves 2026-11-12.1, then FAIL. No Success chunk is FAIL.
#   BF4 what no read here can prove is INFO: each needs a POST to a function,
#       a purchase, a model call or a mail.
#
# READ-ONLY. Preflights run no function logic; the column read is a GET the
# client role either sees no rows of or is refused; the site reads are GETs of
# its entry and one chunk. No function is POSTed, nothing is written, no mail
# is sent and Stripe is never reached.
echo "== 99zzzzzzz. bug round, full analysis: the mail resent, a refusal said, a busy model asked again, a refused notice owed, a PDF a phone can draw =="

vdbf_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

# BF1: read all four first, so an old build is judged against the others.
VDBF_ANY=0; VDBF_AR=0; VDBF_RFD=0; VDBF_OLD=""
for VDBF_FN in analyze-resume send-analysis-email retry-failed-deliveries verify-scan-pack-purchase; do
  VDBF_H=$(vdbf_build "$VDBF_FN")
  if [ -z "$VDBF_H" ]; then echo "FAIL  BF1 $VDBF_FN preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
  elif build_ge "$VDBF_FN" "$VDBF_H" "2026-11-12" "1"; then
    echo "PASS  BF1 $VDBF_FN preflight x-fn-build = $VDBF_H ($VDBF_FN.2026-11-12.1 or later)"
    VDBF_ANY=1
    [ "$VDBF_FN" = analyze-resume ] && VDBF_AR=1
    [ "$VDBF_FN" = retry-failed-deliveries ] && VDBF_RFD=1
  else VDBF_OLD="$VDBF_OLD $VDBF_FN=$VDBF_H"; fi
done
for VDBF_PAIR in $VDBF_OLD; do
  VDBF_FN=${VDBF_PAIR%%=*}; VDBF_H=${VDBF_PAIR#*=}
  if [ "$VDBF_ANY" = 1 ]; then echo "FAIL  BF1 $VDBF_FN preflight x-fn-build = $VDBF_H while another of this lane's functions serves 2026-11-12.1: the round's paste is partial"
  else echo "INFO  BF1 $VDBF_FN preflight x-fn-build = $VDBF_H: the round's build ($VDBF_FN.2026-11-12.1) is not pasted yet"; fi
done

# BF2: the column the sweep writes a refused notice to, read as the client
# role. A missing column is answered 42703 before any permission is checked.
rm -f /tmp/vd_99zzzzzzz_bf_notice.json
curl -s -m 30 "$B/rest/v1/product_deliveries?select=notice_owed&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_99zzzzzzz_bf_notice.json
VDBF_COL=$(node -e 'let s="";try{s=require("fs").readFileSync(process.argv[1],"utf8")}catch{}try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON:"+s.slice(0,80).replace(/\s+/g," "))}' /tmp/vd_99zzzzzzz_bf_notice.json)
case "$VDBF_COL" in
  ROWS:0) echo "PASS  BF2 product_deliveries.notice_owed exists and anon sees no order (20261112130000 applied)" ;;
  42501) echo "PASS  BF2 product_deliveries.notice_owed exists and anon is refused the table (20261112130000 applied)" ;;
  42703|PGRST204)
    if [ "$VDBF_RFD" = 1 ]; then echo "FAIL  BF2 product_deliveries.notice_owed does not exist while retry-failed-deliveries serves 2026-11-12.1: 20261112130000 has not applied, so a refused alarm about a spent order is lost again"
    else echo "INFO  BF2 product_deliveries.notice_owed does not exist yet: 20261112130000 has not applied (it goes before retry-failed-deliveries 2026-11-12.1)"; fi ;;
  ROWS:*) echo "FAIL  BF2 product_deliveries answered anon with rows ($VDBF_COL): buyers' orders are readable by anyone" ;;
  *) echo "FAIL  BF2 product_deliveries?select=notice_owed as anon -> $VDBF_COL (want [] or 42501)" ;;
esac

# BF3: the published success page. The entry names the Success chunk, which
# holds the page, its PDF export, the report and the run helper; the English
# shards ride in the entry, so an English sentence in this chunk is a literal.
VDBF_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDBF_MAINJS=""
[ -n "$VDBF_MAIN" ] && VDBF_MAINJS=$(curl -s -m 30 "$SITE$VDBF_MAIN")
VDBF_SUCC=$(printf '%s' "$VDBF_MAINJS" | grep -o '"\./Success-[A-Za-z0-9_-]*\.js"' | head -1 | tr -d '"' | sed 's|^\./||')
vdbf_page() { # $1 claim, $2 PASS text, $3 missing text, $4 1 when present
  if [ "$4" = 1 ]; then echo "PASS  BF3 $1 the published success page ($VDBF_SUCC) $2"
  elif [ "$VDBF_AR" = 1 ]; then echo "FAIL  BF3 $1 the published success page ($VDBF_SUCC) $3 while analyze-resume serves 2026-11-12.1: the round's frontend has not published"
  else echo "INFO  BF3 $1 the published success page ($VDBF_SUCC) $3: the round's frontend has not published yet"; fi
}
if [ -z "$VDBF_SUCC" ]; then
  echo "FAIL  BF3 the served entry (${VDBF_MAIN:-none found}) names no Success chunk: the frontend is not serving, or the bundle layout moved, so the published page cannot be judged"
else
  VDBF_SJS=$(curl -s -m 30 "$SITE/assets/$VDBF_SUCC")
  VDBF_HAS=0; printf '%s' "$VDBF_SJS" | grep -qF 'sections-missing' && VDBF_HAS=1
  vdbf_page "S14X-041" "names a section the analysis went out without (sections-missing)" "carries no note for a section the analysis went out without (sections-missing)" "$VDBF_HAS"
  VDBF_HAS=0; printf '%s' "$VDBF_SJS" | grep -qF 'purchase_refunded' && VDBF_HAS=1
  vdbf_page "RC-S13-048" "reads a refusal by its code (purchase_refunded)" "does not read a refusal's code (purchase_refunded)" "$VDBF_HAS"
  VDBF_HAS=0; printf '%s' "$VDBF_SJS" | grep -qF 'paidAnalysis.busy' && VDBF_HAS=1
  vdbf_page "S14X-110" "says a busy service is busy (paidAnalysis.busy)" "has no words for a busy service (paidAnalysis.busy)" "$VDBF_HAS"
  VDBF_HAS=0; printf '%s' "$VDBF_SJS" | grep -qF 'data:,' && VDBF_HAS=1
  vdbf_page "S14X-112" "catches a canvas the device could not draw (data:,)" "does not catch a canvas the device could not draw (data:,)" "$VDBF_HAS"
  VDBF_HAS=0; printf '%s' "$VDBF_SJS" | grep -qF '"familiarity"' && VDBF_HAS=1
  vdbf_page "RC-S13-051" "leaves a requirement worded apart from a missing one out of the green list (its word list)" "compares the posting's requirements with the missing ones only as written (no word list)" "$VDBF_HAS"
  # Each as a whole quoted string, the form a JSX literal takes: a sentence of
  # the trust page's that names a button inside it is not the button's label.
  VDBF_EN=""
  for VDBF_L in 'Scroll to view results' 'Clear Browser Data' 'Delete Server Data' 'Yes, delete my data'; do
    printf '%s' "$VDBF_SJS" | grep -qF "\"$VDBF_L\"" && VDBF_EN="$VDBF_EN \"$VDBF_L\","
  done
  VDBF_HAS=0; [ -z "$VDBF_EN" ] && printf '%s' "$VDBF_SJS" | grep -qF 'paidAnalysis.page.seoTitle' && VDBF_HAS=1
  if [ -n "$VDBF_EN" ]; then VDBF_WHY="still prints${VDBF_EN%,} in English whatever the buyer's language"; else VDBF_WHY="sets no head of its own (paidAnalysis.page.seoTitle)"; fi
  vdbf_page "S14X-178" "prints its words from keys and sets its own head (paidAnalysis.page.seoTitle, no English literal)" "$VDBF_WHY" "$VDBF_HAS"
fi

echo "INFO  BF4 proven in the suite, never here (each needs a POST to a function, a purchase, a model call or a mail): a Marathi, Nepali or Polish résumé gets its rewrites in its own language (RC-S13-024); the analysis mail waits for the provider, a refused one leaves the order email_failed and the sweep resends the stored analysis through send-analysis-email (S14X-220); a refused spent-order alarm or buyer notice is owed and sent by a later run (RC-S13-110); each refusal carries its code and a busy gateway is a 503 with retryable (RC-S13-048, S14X-110); the mail names the level as the page does and shows the posting's score (S14X-219, S14X-209); a missing section is named in the analysis and the mail (S14X-041); a named purchase claim stores no address (S14X-042)"
