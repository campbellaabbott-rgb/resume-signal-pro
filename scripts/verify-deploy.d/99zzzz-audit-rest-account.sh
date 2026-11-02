# shellcheck shell=bash
# ── 99zzzz. AUDIT-REST, ACCOUNT: the fonts served from this site, the Google
# account's Terms, the gap report against the matching résumé, the pulse in
# the reader's language, the owner's dashboard reading its whole range, the
# public scan total counting completed analyses (branch
# fix/audit-rest-account: S12-011, S12-078, S12-185, S13-070, S13-083,
# S13-084, S13-086, S13-087, S13-093, S13-100, S13-102, S13-105, S13-118;
# migrations 20261103190000 and 20261103191000; send-market-pulse and
# get-analytics 2026-11-03.1).
#
# Named 99zzzz-audit-rest-account so it sorts after 99zzz-trust-round-3.sh
# in byte order and under a collating locale that ignores the dash.
#
# THE CLAIMS, one line each:
#   A1  send-market-pulse serves 2026-11-03.1 or later (the confirmation in
#       the asking page's language, the monthly pulse in the stored one);
#   A2  get-analytics serves 2026-11-03.1 or later (pages newest first and
#       reads the whole range, says where a run that ran out of time stopped);
#   F1  the homepage names no Google font host, and its faces point at /fonts/;
#   F2  /fonts/inter-latin.woff2 is served as a woff2 file (a site that
#       answers the path with its HTML fallback would print every face blank);
#   D1  market_pulse_subscribers.locale exists (a GET that names the column:
#       42703 means migration 20261103191000 has not run), and anon reads no
#       row of the table;
#   P1  the published entry holds the Google Terms mark and the gap report's
#       per-tab key (AuthContext lives in the entry);
#   P2  the published /agents chunk says the read tools need no key;
#   P3  the published pulse confirmation page offers the curated keywords and
#       sends its language.
#   INFO the public scan total, printed for the record: that it counts only
#       completed rows is proved by the migration's own self-check, not from
#       outside.
# Not provable from outside, so proved in the suite: the Google return writing
# the Terms, the gap report's re-measurement and its denominator, the co-pilot
# toasts, the unlinked Pro plan, the daily/weekly copy, the saved-search badge,
# the tracked employer chip, the dashboard's paging and rollup.
#
# READ-ONLY: OPTIONS preflights (no function logic runs), GETs of the site's
# HTML, one font file, the entry script and two chunks, one PostgREST GET of a
# table (RLS, no public policy) and one GET of an aggregate RPC. Nothing is
# sent, bought or written.
echo "== 99zzzz. audit-rest account: self-hosted fonts, Google Terms, the gap report, the pulse's language, the dashboard's range (2026-11-03.1) =="

vdara_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

for VDARA_FN in send-market-pulse get-analytics; do
  VDARA_H=$(vdara_build "$VDARA_FN")
  if [ -z "$VDARA_H" ]; then echo "FAIL  $VDARA_FN preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
  elif build_ge "$VDARA_FN" "$VDARA_H" "2026-11-03" "1"; then echo "PASS  $VDARA_FN x-fn-build = $VDARA_H ($VDARA_FN.2026-11-03.1 or later)"
  else echo "FAIL  $VDARA_FN x-fn-build = $VDARA_H, older than $VDARA_FN.2026-11-03.1: this branch's change to it is not serving"; fi
done

# F1, F2: the fonts. The home page's head, then the latin file it preloads.
VDARA_HOME=$(curl -s -m 30 -A "${UA:-verify-deploy}" "$SITE/")
if [ -z "$VDARA_HOME" ]; then echo "FAIL  the homepage answered nothing: the font head cannot be read"
elif printf '%s' "$VDARA_HOME" | grep -qE 'fonts\.(gstatic|googleapis)\.com'; then echo "FAIL  the homepage still names Google's font host: a visit asks it for files before any consent (S12-011)"
elif printf '%s' "$VDARA_HOME" | grep -qF 'url(/fonts/inter-latin.woff2)'; then echo "PASS  the homepage names no Google font host and its faces point at /fonts/ on this site (S12-011)"
else echo "FAIL  the homepage names no Google font host but declares no face at /fonts/inter-latin.woff2: the font head moved, or the frontend publish has not happened (S12-011)"; fi
VDARA_MAGIC=$(curl -s -m 30 -A "${UA:-verify-deploy}" "$SITE/fonts/inter-latin.woff2" | head -c 4)
if [ "$VDARA_MAGIC" = "wOF2" ]; then echo "PASS  /fonts/inter-latin.woff2 is served as a woff2 file (S12-011)"
else echo "FAIL  /fonts/inter-latin.woff2 did not answer a woff2 file (first bytes: $(printf '%s' "$VDARA_MAGIC" | od -An -c | tr -s ' ' | head -c 40)): the faces would fall back (S12-011)"; fi

# D1: the pulse's locale column, by naming it. PostgREST resolves the column
# before it checks a grant, so a missing column answers 42703 whatever anon
# may read; a present one answers [] (RLS, no public policy) or 42501.
VDARA_LOC=$(curl -s -m 30 "$B/rest/v1/market_pulse_subscribers?select=locale&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
VDARA_LOC_V=$(printf '%s' "$VDARA_LOC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(Array.isArray(j))console.log(j.length?"ROWS":"EMPTY");else console.log(String(j&&j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$VDARA_LOC_V" in
  EMPTY|42501) echo "PASS  market_pulse_subscribers.locale exists and anon reads no subscriber row ($VDARA_LOC_V) (S13-102, 20261103191000)";;
  42703) echo "FAIL  market_pulse_subscribers has no locale column (42703): migration 20261103191000 has not run, so every pulse stays English (S13-102)";;
  ROWS) echo "FAIL  anon read a market_pulse_subscribers row: the subscriber list is exposed";;
  *) echo "FAIL  the locale probe answered $VDARA_LOC_V  $(printf '%s' "$VDARA_LOC" | head -c 160)";;
esac

# INFO: the public scan total, for the record.
VDARA_TOT=$(curl -s -m 30 "$B/rest/v1/rpc/get_scan_totals" -H "apikey: $K" -H "Authorization: Bearer $K")
VDARA_TOT_V=$(printf '%s' "$VDARA_TOT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(typeof j?.total_scans==="number"?String(j.total_scans):"NONE")}catch{console.log("NONE")}})')
if [ "$VDARA_TOT_V" = "NONE" ]; then echo "FAIL  get_scan_totals answered no total: $(printf '%s' "$VDARA_TOT" | head -c 160) (the homepage, /trust and /methodology print it)"
else echo "INFO  get_scan_totals answers total_scans = $VDARA_TOT_V (completed analyses only once 20261103190000 has run; its self-check proves the filter, S13-087)"; fi

# P1-P3: the published frontend. The entry names each route's chunk.
VDARA_MAIN=$(printf '%s' "$VDARA_HOME" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDARA_MAINJS=""
[ -n "$VDARA_MAIN" ] && VDARA_MAINJS=$(curl -s -m 30 "$SITE$VDARA_MAIN")
vdara_chunk() { # $1 chunk name prefix -> the chunk's file name from the entry
  printf '%s' "$VDARA_MAINJS" | grep -o "\"\./$1-[A-Za-z0-9_-]*\.js\"" | head -1 | tr -d '"' | sed 's|^\./||'
}
if [ -z "$VDARA_MAINJS" ]; then echo "FAIL  the homepage names no entry script (${VDARA_MAIN:-none found}): the published frontend cannot be read"
elif printf '%s' "$VDARA_MAINJS" | grep -qF 'rb_google_terms_shown' && printf '%s' "$VDARA_MAINJS" | grep -qF 'rb_gap_fits'; then echo "PASS  the published entry ($VDARA_MAIN) records a Google account's Terms and clears the gap report's measurements at sign-out (S12-078, S13-093)"
else echo "FAIL  the published entry ($VDARA_MAIN) carries no Google Terms mark or gap-report key: the frontend publish with S12-078 and S13-093 has not happened"; fi
VDARA_AG=$(vdara_chunk AgentConnect)
if [ -z "$VDARA_AG" ]; then echo "FAIL  the served entry (${VDARA_MAIN:-none found}) names no AgentConnect chunk: the frontend is not serving, or the bundle layout moved"
else
  VDARA_AGJS=$(curl -s -m 30 "$SITE/assets/$VDARA_AG")
  if printf '%s' "$VDARA_AGJS" | grep -qF 'no key needed'; then echo "PASS  the published /agents chunk ($VDARA_AG) says the read tools need no key (S13-105)"
  else echo "FAIL  the published /agents chunk ($VDARA_AG) does not say the read tools need no key: the frontend publish with S13-105 has not happened"; fi
fi
VDARA_PC=$(vdara_chunk MarketPulseConfirm)
if [ -z "$VDARA_PC" ]; then echo "FAIL  the served entry (${VDARA_MAIN:-none found}) names no MarketPulseConfirm chunk: the frontend is not serving, or the bundle layout moved"
else
  VDARA_PCJS=$(curl -s -m 30 "$SITE/assets/$VDARA_PC")
  if printf '%s' "$VDARA_PCJS" | grep -qF 'pulseConfirm.bodyCurated' && printf '%s' "$VDARA_PCJS" | grep -qF 'language:'; then echo "PASS  the published pulse confirmation page ($VDARA_PC) offers the curated keywords and sends its language (S13-100, S13-102)"
  else echo "FAIL  the published pulse confirmation page ($VDARA_PC) still promises a reading of postings or sends no language: the frontend publish with S13-100 and S13-102 has not happened"; fi
fi
