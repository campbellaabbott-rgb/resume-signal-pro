# Résumé privacy (register 1.21 / 1.55; migration 20261004150000).
# Sourced by scripts/verify-deploy.sh. Read-only: two build headers (a
# preflight and a GET the webhook answers 405 to before it reads anything),
# one anon reader (get_cron_health), and three public pages fetched as a
# crawler. Never a checkout, never a webhook event, never a write.

echo "== resume privacy: no résumé text to Stripe; every copy on its published clock =="

RP_CC=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/create-checkout" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
case "$RP_CC" in
  "create-checkout.2026-10-04.no-resume-metadata") echo "PASS  create-checkout preflight x-fn-build = $RP_CC (the build that writes no résumé into session metadata)";;
  "") echo "FAIL  create-checkout preflight carries no x-fn-build";;
  *) echo "FAIL  create-checkout preflight x-fn-build = $RP_CC (want create-checkout.2026-10-04.no-resume-metadata; a newer build from another change is fine if it keeps the metadata fix)";;
esac

RP_WH=$(curl -s -m 30 -D - -o /dev/null -X GET "$B/functions/v1/stripe-webhook" | tr -d '\r')
RP_WB=$(printf '%s' "$RP_WH" | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
case "$RP_WB" in
  "stripe-webhook.2026-10-04.no-resume-payload") echo "PASS  stripe-webhook x-fn-build = $RP_WB (stores event payloads without résumé text)";;
  "") echo "FAIL  stripe-webhook GET carries no x-fn-build";;
  *) echo "FAIL  stripe-webhook x-fn-build = $RP_WB (want stripe-webhook.2026-10-04.no-resume-payload)";;
esac

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
for RP_PATH in /trust /llms.txt /llms-full.txt /data-api; do
  RP_BODY=$(curl -s -m 30 -A "$UA" "$SITE$RP_PATH")
  if [ -z "$RP_BODY" ]; then echo "INFO  $RP_PATH answered empty"; continue; fi
  RP_HITS=$(printf '%s' "$RP_BODY" | grep -o -i -E 'never stored|zero storage|processed in memory|immediately discarded|nothing kept' | sort -u | tr '\n' ',' )
  if [ -z "$RP_HITS" ]; then echo "PASS  $RP_PATH makes no categorical never-stored claim"; else echo "FAIL  $RP_PATH still says: $RP_HITS"; fi
done
