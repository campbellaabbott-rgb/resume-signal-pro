# shellcheck shell=bash
# ── 99zzzz-audit-rest-review. WHAT THE AUDIT-REST LANDING REVIEW CHANGED ON THE
# PUBLISHED PAGES (branch fix/audit-rest, 2026-11-05: S13-102's two pages and
# its digest language, the shared-link delete note, the purchase link's Try
# again, the analytics warning). They ship with the frontend, so these lines
# turn green at the publish, ahead of the functions.
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh in byte order and
# under a collating locale that ignores the dash.
#
# THE CLAIMS, one line each. R1 to R6 fail on the frontend live at c4a29736:
#   R1  the success page tells a shared-link reader real ways to delete, not
#       the link they are already on;
#   R2  the product page offers Try again on a purchase it could not find, so a
#       passing Stripe failure on the live function is not a dead end;
#   R3  a key asked for from the data API page carries the page's language;
#   R4  a claim made from the board carries the page's language;
#   R5  a saved search's write carries its reader's language, and a refusal
#       naming the column retries without it, so a page ahead of 20261103240000
#       still saves;
#   R6  the owner's analytics warning names the end the live function cuts.
#   G1  A REGRESSION GUARD, NOT PROOF OF THIS DEPLOY: no baked /, /trust or
#       /methodology prints a scan total. Browsers read get_scan_totals live, so
#       20261103190000 applying after the bake leaves no second figure for a
#       crawler. It passes before this deploy as well as after.
#   F   INFO only: whether the host caches a self-hosted font. Paths under
#       public/ carried an ETag and no Cache-Control on 2026-11-05, and the fonts
#       are not published until the merge, so this reads what it finds.
#
# READ-ONLY. GETs of the site, its entry script and its chunks, and one GET of
# get_scan_totals (aggregates only). Nothing is sent, bought or written.
echo "== 99zzzz. audit-rest review: the delete note, Try again, the two pages' language, a saved search's language, the analytics warning, no baked total =="

VDARV_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDARV_MAINJS=""
[ -n "$VDARV_MAIN" ] && VDARV_MAINJS=$(curl -s -m 30 "$SITE$VDARV_MAIN")
vdarv_read() { # $1 chunk name prefix -> VDARV_NAME and VDARV_JS; false when the entry names none or it reads empty
  VDARV_NAME=$(printf '%s' "$VDARV_MAINJS" | grep -o "\"\./$1-[A-Za-z0-9_-]*\.js\"" | head -1 | tr -d '"' | sed 's|^\./||')
  VDARV_JS=""
  [ -n "$VDARV_NAME" ] && VDARV_JS=$(curl -s -m 30 "$SITE/assets/$VDARV_NAME")
  [ -n "$VDARV_JS" ]
}
vdarv_nochunk() { echo "FAIL  the served entry (${VDARV_MAIN:-none found}) names no readable $1 chunk: the frontend is not serving, or the bundle layout moved"; }

# R1
if ! vdarv_read Success; then vdarv_nochunk Success
else
  case "$VDARV_JS" in
    *"this shared link cannot"*) echo "PASS  the published success page ($VDARV_NAME) tells a shared-link reader the real ways to delete";;
    *) echo "FAIL  the published success page ($VDARV_NAME) does not say this shared link cannot delete and name the real ways: an old-mail buyer is sent back to the link they are on";;
  esac
fi

# R2
if ! vdarv_read ProductSuccess; then vdarv_nochunk ProductSuccess
else
  if grep -qE 'not_found:(!0|true)' <<<"$VDARV_JS"; then
    case "$VDARV_JS" in
      *"If you just paid, wait a moment and try again"*) echo "PASS  the published product page ($VDARV_NAME) offers Try again on a purchase it could not find";;
      *) echo "FAIL  the published product page ($VDARV_NAME) retries not_found but no longer says to try again";;
    esac
  else
    echo "FAIL  the published product page ($VDARV_NAME) offers no Try again on not_found: a passing Stripe failure on the live function reads as a dead link";
  fi
fi

# R3
if ! vdarv_read DataApi; then vdarv_nochunk DataApi
elif grep -qE '"api-key-request",\{body:\{[^}]*language:' <<<"$VDARV_JS"; then echo "PASS  the published data API page ($VDARV_NAME) asks for a key in the language the page is read in"
else echo "FAIL  the published data API page ($VDARV_NAME) sends no language with a key request: the mail takes the browser's language, not the page's (S13-102)"; fi

# R4, R5: both live in or under the board's chunk.
if ! vdarv_read Jobs; then vdarv_nochunk Jobs
else
  VDARV_JOBS=$VDARV_NAME
  VDARV_JOBSJS=$VDARV_JS
  if grep -qE '"company-claim",\{body:\{[^}]*language:' <<<"$VDARV_JOBSJS"; then echo "PASS  the published board ($VDARV_JOBS) asks for a claim mail in the language the page is read in"
  else echo "FAIL  the published board ($VDARV_JOBS) sends no language with a claim: the mail, and the verified notice after it, take the browser's language (S13-102)"; fi
  VDARV_SAVED=""
  case "$VDARV_JOBSJS" in *"/locale/.test("*) VDARV_SAVED=$VDARV_JOBS;; esac
  if [ -z "$VDARV_SAVED" ]; then
    for VDARV_DEP in $(grep -oE '"\./[A-Za-z0-9._-]+\.js"' <<<"$VDARV_JOBSJS" | tr -d '"' | sed 's|^\./||' | sort -u); do
      case "$(curl -s -m 30 "$SITE/assets/$VDARV_DEP")" in *"/locale/.test("*) VDARV_SAVED=$VDARV_DEP; break;; esac
    done
  fi
  if [ -n "$VDARV_SAVED" ]; then echo "PASS  the published board writes a saved search's language and retries without it on a refusal naming the column ($VDARV_SAVED)"
  else echo "FAIL  neither the published board ($VDARV_JOBS) nor a chunk it imports retries a saved search without its language: the digest stays English, or a page ahead of 20261103240000 cannot save (S13-102)"; fi
fi

# R6
if ! vdarv_read AnalyticsDashboard; then vdarv_nochunk AnalyticsDashboard
else
  case "$VDARV_JS" in
    *"which reads oldest first"*) echo "PASS  the published analytics page ($VDARV_NAME) names the newest days as the ones a live read cuts";;
    *) echo "FAIL  the published analytics page ($VDARV_NAME) has no sentence for the live function, which reads oldest first: its warning names the wrong end of the range";;
  esac
fi

# G1. Any number beside the three labels, or today's total alone in an element.
VDARV_TOTAL=$(curl -s -m 30 "$B/rest/v1/rpc/get_scan_totals" -H "apikey: $K" -H "Authorization: Bearer $K" | sed -nE 's/.*"total_scans": *([0-9]+).*/\1/p' | head -1)
VDARV_TOTALC=""
[ -n "$VDARV_TOTAL" ] && VDARV_TOTALC=$(node -e 'console.log(Number(process.argv[1]).toLocaleString("en-US"))' "$VDARV_TOTAL")
VDARV_PRINTED=""
VDARV_UNREAD=""
for VDARV_P in / /trust /methodology; do
  VDARV_HTML=$(curl -s -m 30 -A "$UA" "$SITE$VDARV_P")
  if [ -z "$VDARV_HTML" ]; then VDARV_UNREAD="$VDARV_UNREAD $VDARV_P"; continue; fi
  VDARV_HIT=$(grep -oE '[0-9][0-9,.]* *([Rr]esumes [Aa]nalyzed|[Rr]esumes [Aa]nalysed|[Rr]esumes [Pp]rocessed|Resumes)|completed [0-9][0-9,.]* scans' <<<"$VDARV_HTML" | head -1)
  if [ -z "$VDARV_HIT" ] && [ -n "$VDARV_TOTAL" ]; then VDARV_HIT=$(grep -oE ">($VDARV_TOTAL|$VDARV_TOTALC)<" <<<"$VDARV_HTML" | head -1); fi
  [ -n "$VDARV_HIT" ] && VDARV_PRINTED="$VDARV_PRINTED $VDARV_P ($VDARV_HIT)"
done
if [ -n "$VDARV_PRINTED" ]; then echo "FAIL  a baked page now prints a scan total:$VDARV_PRINTED. A crawler can read a different figure from a browser until the next publish, so 20261103190000 needs a re-bake after it applies"
elif [ -n "$VDARV_UNREAD" ]; then echo "INFO  could not read$VDARV_UNREAD, so whether a baked page prints a scan total is not judged for them"
else echo "PASS  regression guard, true before this deploy as well: the baked /, /trust and /methodology print no scan total, so 20261103190000 leaves no second figure for a crawler"; fi

# F
VDARV_FONT=$(curl -s -m 30 -D - -o /dev/null "$SITE/fonts/inter-latin.woff2" | tr -d '\r')
VDARV_FONT_TYPE=$(grep -i '^content-type:' <<<"$VDARV_FONT" | head -1 | sed -E 's/^[^:]*: *//')
VDARV_FONT_CC=$(grep -i '^cache-control:' <<<"$VDARV_FONT" | head -1 | sed -E 's/^[^:]*: *//')
VDARV_FONT_CODE=$(head -1 <<<"$VDARV_FONT" | sed -E 's/^[^ ]+ ([0-9]+).*/\1/')
case "$VDARV_FONT_CODE:$VDARV_FONT_TYPE" in
  200:|200:*html*|200:text/*|[!2]*|"":*|:*) echo "INFO  /fonts/inter-latin.woff2 is not a font here (HTTP ${VDARV_FONT_CODE:-none}, ${VDARV_FONT_TYPE:-no type}): the self-hosted fonts are not published yet, so their caching cannot be read";;
  *) if [ -z "$VDARV_FONT_CC" ]; then echo "INFO  /fonts/inter-latin.woff2 carries no Cache-Control, so a repeat load revalidates and font-display: optional can show the system font for that view. Cosmetic: accept it, or move the fonts through the bundler for hashed names";
     else echo "INFO  /fonts/inter-latin.woff2 carries Cache-Control: $VDARV_FONT_CC"; fi;;
esac

echo "INFO  S13-083 first match is proved in the suite (a-zero-result-alert-says-we-found-it-when-the-first-match-arrives.test.ts), since it needs a real send"
echo "INFO  S13-102 on every saved-search writer is proved in the suite (a-saved-search-keeps-the-language-its-owner-reads-the-site-in.test.tsx)"
echo "INFO  S12-078 the Terms wait for the mailbox guard: proved in the suite (a-google-account-records-the-terms-it-was-shown.test.tsx), since it needs a real sign-up"
echo "INFO  S9-001 the owner's catalogue read before the OAuth server is proved against a skipped table in the suite (a-token-minted-for-a-connected-app-works-only-at-the-connector.test.ts), since the policies are not readable from here"
