# shellcheck shell=bash
# ── 99zzzzzz. HOTFIX PAID (branch hotfix/paid; S14 items H2, H3, H4:
# M-S14-004, M-S14-085, M-S14-007, C-S14-003, M-S14-050, C-S14-049,
# M-S14-005, C-S14-005, C-S14-012, C-S14-010; builds 2026-11-10.1;
# migration 20261110120000).
#
# Named 99zzzzzz so it sorts after 99zzzzz-free-scan-wave-recheck.sh in byte
# order ("-" sorts before "z") and under a collating locale that ignores the
# dash.
#
# THE CLAIMS, one line each below:
#   HP1 analyze-resume, verify-scan-pack-purchase, scan-credits and
#       create-checkout serve 2026-11-10.1 or later (each preflight's
#       x-fn-build): an id that cannot be a purchase never reaches Stripe, a
#       delivered purchase is answered from our rows, every Stripe read is
#       counted under the function's own name and a count that cannot be
#       taken refuses, the paid run is not refused on the shared per-address
#       budget, one run per purchase at a time, a long posting is read up to
#       its cap, the stored inputs are read by the purchase, the buyer's
#       address is masked (verify-scan-pack-purchase, scan-credits), and the
#       checkout records what it was bought against (create-checkout).
#       An older build is INFO (not deployed yet); a missing header is FAIL.
#   HP2 20261110120000 applied: analysis_run_leases exists and anon may not
#       read it (a GET of the table: 42501). Missing is INFO until
#       analyze-resume serves 2026-11-10.1, then FAIL (the ledger applies it
#       first); rows answered to anon are FAIL.
#   HP3 the published success page: the PDF switches the page's animations
#       off in each capture and captures the quantification section, and the
#       page asks for an analysis from the copy kept at checkout (fromStored).
#       Not yet published is INFO until analyze-resume serves 2026-11-10.1
#       (the frontend publishes at the merge, before the functions), then FAIL.
#   What no read here can prove is INFO: the refusals before Stripe, the
#   counted reads, the lease's 409, the clipping, the masking and the
#   checkout's record are proven in the suite, never here (each needs a POST
#   to a function, and some a purchase).
#
# READ-ONLY. Preflights run no function logic; the table read is a GET the
# client role is refused; the site reads are GETs of its entry and one
# chunk. No function is POSTed, nothing is written, Stripe is never reached.
echo "== 99zzzzzz. hotfix paid: Stripe reads only for a purchase, one run at a time, the posting it was bought against, a PDF with every card =="

vdhp_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

VDHP_LIVE=0
for VDHP_FN in analyze-resume verify-scan-pack-purchase scan-credits create-checkout; do
  VDHP_H=$(vdhp_build "$VDHP_FN")
  if [ -z "$VDHP_H" ]; then echo "FAIL  HP1 $VDHP_FN preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
  elif build_ge "$VDHP_FN" "$VDHP_H" "2026-11-10" "1"; then
    echo "PASS  HP1 $VDHP_FN preflight x-fn-build = $VDHP_H ($VDHP_FN.2026-11-10.1 or later)"
    [ "$VDHP_FN" = analyze-resume ] && VDHP_LIVE=1
  else echo "INFO  HP1 $VDHP_FN preflight x-fn-build = $VDHP_H: the hotfix build ($VDHP_FN.2026-11-10.1) is not deployed yet"; fi
done

# HP2: the lease table, read as the client role. 42501 is the answer of a
# table that exists and is closed; PGRST205 (or 42P01) one that does not exist.
rm -f /tmp/vd_99zzzzzz_lease.json
curl -s -m 30 "$B/rest/v1/analysis_run_leases?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_99zzzzzz_lease.json
VDHP_LEASE=$(node -e 'let s="";try{s=require("fs").readFileSync(process.argv[1],"utf8")}catch{}try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}' /tmp/vd_99zzzzzz_lease.json)
case "$VDHP_LEASE" in
  42501) echo "PASS  HP2 analysis_run_leases exists and anon may not read it (20261110120000 applied)" ;;
  PGRST205|42P01)
    if [ "$VDHP_LIVE" = 1 ]; then echo "FAIL  HP2 analysis_run_leases does not exist while analyze-resume serves 2026-11-10.1: 20261110120000 has not applied, so every run goes without its lease (two tabs pay for two model runs)"
    else echo "INFO  HP2 analysis_run_leases does not exist yet: 20261110120000 has not applied (it goes before analyze-resume 2026-11-10.1)"; fi ;;
  ROWS:*) echo "FAIL  HP2 analysis_run_leases answered anon with rows ($VDHP_LEASE): anyone could read, and so lock or free, a buyer's run" ;;
  *) echo "FAIL  HP2 analysis_run_leases as anon -> $VDHP_LEASE (want 42501)" ;;
esac

# HP3: the published success page. The entry names the Success chunk, which
# holds the page, its PDF export and the report (section 57 reads it too).
VDHP_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDHP_MAINJS=""
[ -n "$VDHP_MAIN" ] && VDHP_MAINJS=$(curl -s -m 30 "$SITE$VDHP_MAIN")
VDHP_SUCC=$(printf '%s' "$VDHP_MAINJS" | grep -o '"\./Success-[A-Za-z0-9_-]*\.js"' | head -1 | tr -d '"' | sed 's|^\./||')
if [ -z "$VDHP_SUCC" ]; then
  echo "FAIL  HP3 the served entry (${VDHP_MAIN:-none found}) names no Success chunk: the frontend is not serving, or the bundle layout moved, so the published page cannot be judged"
else
  VDHP_SJS=$(curl -s -m 30 "$SITE/assets/$VDHP_SUCC")
  VDHP_MISSING=""
  printf '%s' "$VDHP_SJS" | grep -qF '{animation:none!important;transition:none!important}' || VDHP_MISSING="$VDHP_MISSING the PDF's animation switch-off;"
  printf '%s' "$VDHP_SJS" | grep -qE 'id:"quantification"' || VDHP_MISSING="$VDHP_MISSING the quantification section;"
  printf '%s' "$VDHP_SJS" | grep -qE 'fromStored:(!0|true)' || VDHP_MISSING="$VDHP_MISSING the ask from the copy kept at checkout;"
  if [ -z "$VDHP_MISSING" ]; then echo "PASS  HP3 the published success page ($VDHP_SUCC) draws its PDF with animations off and the quantification section in it, and asks for an analysis from the copy kept at checkout"
  elif [ "$VDHP_LIVE" = 1 ]; then echo "FAIL  HP3 the published success page ($VDHP_SUCC) lacks${VDHP_MISSING%;} while analyze-resume serves 2026-11-10.1: the frontend publish of this hotfix has not happened"
  else echo "INFO  HP3 the published success page ($VDHP_SUCC) lacks${VDHP_MISSING%;}: the hotfix's frontend has not published yet"; fi
fi

echo "INFO  HP4 proven in the suite, never here (each needs a POST to a function, and some a purchase): an id that cannot be a purchase is refused before Stripe, a delivered or recorded purchase is answered from our rows, every Stripe read is counted and a failed count refuses, a second run of one purchase is told analysis_in_progress, a long posting is read up to its cap, the stored inputs are read by the purchase, the buyer's address is masked, and the checkout records what it was bought against"
