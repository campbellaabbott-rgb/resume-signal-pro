# Résumé privacy (register 1.21 / 1.55; migration 20261004150000).
# Sourced by scripts/verify-deploy.sh. Read-only: build headers (OPTIONS
# preflights, which run no function logic, and a GET the webhook answers 405 to
# before it reads anything), one anon reader (get_cron_health), one anon GET of
# a table that must refuse it (with a negative control), and public pages
# fetched as a crawler. Never a checkout, never a webhook event, never a write.
# Baseline 2026-10-04 before deploy: analyze-resume.2026-10-01.1,
# create-product-checkout.2026-09-27.2, verify-product-purchase.2026-10-01.1,
# stripe-webhook.2026-10-01.1, checkout_resume_refs -> PGRST205 (no table).
# A merge with another change may carry a later build string for the same
# function; a FAIL naming a newer build is then judged by reading that build.

echo "== resume privacy: no résumé text to Stripe; every copy on its published clock =="

RP_CC=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/create-checkout" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
# A build dated after 2026-10-04 came from main, which carries the fix and the
# tests that pin it (src/test, the résumé-privacy suite).
if [ -z "$RP_CC" ]; then echo "FAIL  create-checkout preflight carries no x-fn-build"
elif build_ge create-checkout "$RP_CC" 2026-10-04 no-resume-metadata; then echo "PASS  create-checkout preflight x-fn-build = $RP_CC (the no-résumé-metadata build or later)"
else echo "FAIL  create-checkout preflight x-fn-build = $RP_CC (want create-checkout.2026-10-04.no-resume-metadata or later)"; fi

RP_WH=$(curl -s -m 30 -D - -o /dev/null -X GET "$B/functions/v1/stripe-webhook" | tr -d '\r')
RP_WB=$(printf '%s' "$RP_WH" | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
if [ -z "$RP_WB" ]; then echo "FAIL  stripe-webhook GET carries no x-fn-build"
elif build_ge stripe-webhook "$RP_WB" 2026-10-04 no-resume-in-stripe; then echo "PASS  stripe-webhook x-fn-build = $RP_WB (stores no résumé text; finds a product's résumé by the session id)"
else echo "FAIL  stripe-webhook x-fn-build = $RP_WB (want stripe-webhook.2026-10-04.no-resume-in-stripe or later)"; fi

# The three other functions this change rebuilt, each on its preflight.
for RP_PAIR in \
  "create-product-checkout|create-product-checkout.2026-10-04.resume-ref|writes no temporary-store id to Stripe" \
  "verify-product-purchase|verify-product-purchase.2026-10-04.resume-ref|finds a product's résumé by the session id" \
  "analyze-resume|analyze-resume.2026-10-04.no-paid-cache|keeps no copy of a paid analysis in the AI cache"; do
  RP_FN=${RP_PAIR%%|*}; RP_REST=${RP_PAIR#*|}; RP_WANT=${RP_REST%%|*}; RP_WHY=${RP_REST#*|}
  RP_GOT=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$RP_FN" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  RP_TAG=${RP_WANT#"$RP_FN".2026-10-04.}
  if [ -z "$RP_GOT" ]; then echo "FAIL  $RP_FN preflight carries no x-fn-build"
  elif build_ge "$RP_FN" "$RP_GOT" 2026-10-04 "$RP_TAG"; then echo "PASS  $RP_FN preflight x-fn-build = $RP_GOT ($RP_WHY)"
  else echo "FAIL  $RP_FN preflight x-fn-build = $RP_GOT (want $RP_WANT or later)"; fi
done

# checkout_resume_refs exists and refuses anon by name: a refusal, not rows,
# and not a 404 -- with a control table that never existed.
RP_REF=$(curl -s -m 30 "$B/rest/v1/checkout_resume_refs?select=stripe_session_id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
RP_REFCODE=$(printf '%s' "$RP_REF" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$RP_REFCODE" in
  42501) echo "PASS  anon GET checkout_resume_refs -> 42501 (revoked by name)";;
  PGRST205) echo "FAIL  checkout_resume_refs does not exist (migration 20261004150000 not applied)";;
  ROWS:*) echo "FAIL  anon GET checkout_resume_refs -> $RP_REFCODE (readable: a bearer key to every buyer's résumé)";;
  *) echo "FAIL  anon GET checkout_resume_refs -> $RP_REFCODE";;
esac
RP_NC=$(curl -s -m 30 "$B/rest/v1/checkout_resume_refs_never_existed?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).code||"NOCODE")}catch{console.log("NONJSON")}})')
[ "$RP_NC" = "PGRST205" ] && echo "PASS  negative control checkout_resume_refs_never_existed -> PGRST205" || echo "FAIL  negative control -> $RP_NC (the 42501 above cannot be read as presence)"

# The four retention jobs the migration schedules, and whether they have run.
# A job with no run yet is INFO for its first hour after the apply.
R get_cron_health '{"p_hours":24}' | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let rows; try { rows = JSON.parse(s); } catch { console.log("FAIL  get_cron_health returned non-JSON"); return; }
  if (!Array.isArray(rows)) { console.log("FAIL  get_cron_health -> " + JSON.stringify(rows).slice(0, 160)); return; }
  const want = {
    "temp-resume-retention": "*/15 * * * *",
    "ai-response-cache-retention": "41 * * * *",
    "scan-report-cache-retention": "13 * * * *",
    "shared-analysis-retention": "29 * * * *",
  };
  for (const [name, schedule] of Object.entries(want)) {
    const r = rows.find((x) => x.ch_jobname === name);
    if (!r) { console.log("FAIL  cron job " + name + " is not scheduled (20261004150000 not applied?)"); continue; }
    console.log(((r.ch_active !== false && r.ch_schedule === schedule) ? "PASS" : "FAIL") + "  cron job " + name + " active=" + r.ch_active + " schedule=" + r.ch_schedule + " (want " + schedule + ")");
    const runs = Number(r.ch_runs) || 0, failed = Number(r.ch_failed) || 0;
    if (runs === 0) console.log("INFO  " + name + ": no run in the last 24h yet (expected only in the first hour after the apply)");
    else console.log((failed === 0 ? "PASS" : "FAIL") + "  " + name + ": " + runs + " run(s) in 24h, " + failed + " failed, last " + r.ch_last_status + " at " + r.ch_last_start);
  }
});'

# The served copy, as a crawler and an answer engine read it.
RP_TRUST=$(curl -s -m 30 -A "$UA" "$SITE/trust")
if printf '%s' "$RP_TRUST" | grep -q 'What we keep, where, and for how long'; then echo "PASS  /trust serves the retention table to crawlers"; else echo "FAIL  /trust does not serve the retention table (prerender not rebuilt?)"; fi
if printf '%s' "$RP_TRUST" | grep -q '{{'; then echo "FAIL  /trust serves an uninterpolated {{placeholder}}"; else echo "PASS  /trust serves numbers, not placeholders"; fi
if printf '%s' "$RP_TRUST" | grep -q 'Up to 24 hours, then deleted'; then echo "PASS  /trust lists the AI cache with its 24-hour clock"; else echo "FAIL  /trust does not list the AI cache's 24-hour clock (prerender not rebuilt?)"; fi
if printf '%s' "$RP_TRUST" | grep -q "local storage, on your device"; then echo "PASS  /trust lists what this browser keeps in local storage"; else echo "FAIL  /trust does not list the browser's local-storage copies"; fi
if printf '%s' "$RP_TRUST" | grep -q 'no reference to it'; then echo "PASS  /trust says Stripe gets no reference to the résumé"; else echo "FAIL  /trust payment row is the old one"; fi
for RP_PATH in /trust /llms.txt /llms-full.txt /data-api; do
  RP_BODY=$(curl -s -m 30 -A "$UA" "$SITE$RP_PATH")
  if [ -z "$RP_BODY" ]; then echo "INFO  $RP_PATH answered empty"; continue; fi
  RP_HITS=$(printf '%s' "$RP_BODY" | grep -o -i -E 'never stored|zero storage|processed in memory|immediately discarded|nothing kept' | sort -u | tr '\n' ',' )
  if [ -z "$RP_HITS" ]; then echo "PASS  $RP_PATH makes no categorical never-stored claim"; else echo "FAIL  $RP_PATH still says: $RP_HITS"; fi
done
