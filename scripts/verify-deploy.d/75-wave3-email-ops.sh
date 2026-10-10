# shellcheck shell=bash
# ── 75. WAVE 3 EMAIL-OPS (docs/wave3/email-ops.md). Sourced by
# scripts/verify-deploy.sh just before "done."; $B $K $SITE $UA and the
# helpers J R probe build_ge are in scope.
#
# READ-ONLY. Builds are read from OPTIONS preflights (no function logic runs;
# stripe-webhook answers any non-POST 405 with its build). The only POSTs are
# two that write nothing on any build: recover-purchase with text that holds
# no purchase reference (the new build refuses it before any lookup; the old
# one does a read and finds nothing), and track-ab-event with oversized
# metadata, sent ONLY when the new build serves (it refuses before any RPC;
# the old build would have recorded it). Refusal probes are anon RPC calls
# a revoked grant refuses with 42501.
echo "== 75. wave 3 email-ops: undelivered-order alert, stuck-generation retry, purchase links, reply-to, pulse undo, digest clock, claims, telemetry, probes =="

# fn:N = the wave-3 integration's build on 2026-10-09 (docs/wave3/README.md). The
# branch's own .1 is not enough: payments-account and agents-api stamped several
# of these .1 on other code, so only the merged build proves the merged code.
for P75 in scan-heartbeat:2 retry-failed-deliveries:2 stripe-webhook:4 send-product-email:2 verify-product-purchase:2 \
  admin-regenerate-delivery:2 send-analysis-email:2 recover-purchase:2 process-email-queue:2 api-key-request:2 \
  company-claim:2 send-affiliate-commission-email:2 send-agent-digest:2 send-market-pulse:2 send-scan-report:2 \
  send-search-digest:2 save-lead:2 agent-pass-status:2 track-ab-event:2 get-analytics:2 \
  health-check:2 scheduled-health-probe:2; do
  FN75=${P75%%:*}; N75=${P75#*:}
  H75=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN75" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$H75" ]; then echo "FAIL  $FN75 preflight carries no x-fn-build (not deployed with this wave)"
  elif build_ge "$FN75" "$H75" 2026-10-09 "$N75"; then echo "PASS  $FN75 x-fn-build = $H75 (2026-10-09.$N75 or later)"
  else echo "FAIL  $FN75 x-fn-build = $H75 (want $FN75.2026-10-09.$N75 or later)"; fi
done

# The two probes now open to the owner's key and the cron key: their preflights must let those headers through.
for FN75 in health-check scheduled-health-probe; do
  A75=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN75" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-admin-key,x-email-cron,content-type" | tr -d '\r' | grep -i '^access-control-allow-headers:' | head -1)
  case "$(printf '%s' "$A75" | tr 'A-Z' 'a-z')" in *x-admin-key*x-email-cron*) echo "PASS  $FN75 preflight allows x-admin-key and x-email-cron (S8-061)";; *) echo "FAIL  $FN75 preflight does not allow x-admin-key/x-email-cron: ${A75:-(no header)}";; esac
done

# Migrations: each new reader exists and is closed to the publishable key (42501), not missing (PGRST202).
vd75_code() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})'; }
for P75 in 'market_pulse_confirm_unsent|{"p_email":"nobody@example.invalid","p_token_hash":"0000000000000000000000000000000000000000000000000000000000000000"}|20261009141000' \
           'cron_http_refusals|{"p_minutes":60}|20261009143000' \
           'get_failed_deliveries_for_retry|{"p_limit":1}|20261009140000'; do
  N75=${P75%%|*}; REST75=${P75#*|}; A75=${REST75%|*}; M75=${REST75##*|}
  C75=$(R "$N75" "$A75" | vd75_code)
  case "$C75" in 42501) echo "PASS  $N75 as anon -> 42501 (exists, service-role only)";; PGRST202) echo "FAIL  $N75 -> PGRST202 ($M75 has not applied)";; *) echo "FAIL  $N75 as anon -> $C75 (want 42501)";; esac
done
echo "INFO  20261009140000 cannot be read from here (its body is the service role's): the pglite test proves the 15-minute 'generating' rule; after the deploy, a row stuck in generating for 15+ min should move to delivered or generation_failed on the next retry-failed-deliveries run"

# Cron: the layoff refresh carries its ten minutes (S8-049); the mail queue has a job at all (S8-017).
R get_cron_health '{"p_hours":48}' > /tmp/vd_75_cron.json
node -e '
const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync("/tmp/vd_75_cron.json","utf8"))}catch{j=null}
if(!Array.isArray(j)){console.log("INFO  get_cron_health unreadable: "+JSON.stringify(j).slice(0,140));process.exit(0)}
const job=(n)=>j.find((x)=>x.ch_jobname===n);
const l=job("layoff-partition-refresh");
if(!l)console.log("FAIL  no layoff-partition-refresh cron job");
else console.log((l.ch_timeout==="10min"?"PASS":"FAIL")+"  layoff-partition-refresh sets statement_timeout "+JSON.stringify(l.ch_timeout)+" (want \"10min\": 20261009142000); longest run "+l.ch_max_seconds+" s in 48h");
const ex=job("job-board-exits-rollup-retention");
if(ex)console.log((ex.ch_timeout?"PASS":"FAIL")+"  job-board-exits-rollup-retention sets statement_timeout "+JSON.stringify(ex.ch_timeout)+" (wave 2, 20261008113000)");
const q=j.find((x)=>/process-email-queue|email_queue_dispatch|email-queue/.test(String(x.ch_jobname)));
if(!q)console.log("FAIL  no cron job drains the email queue (S8-017): queued magic links, email-change mails and the fix-plan drip never leave pgmq. OWNER: re-create process-email-queue in Lovable Cloud email setup, or move auth mail to GoTrue");
else console.log((q.ch_active&&Number(q.ch_runs)>0?"PASS":"FAIL")+"  "+q.ch_jobname+" cron: active "+q.ch_active+", runs "+q.ch_runs+"/48h, last "+q.ch_last_status);'

# recover-purchase takes what the email carries (and refuses text with no reference before any lookup).
RP75=$(curl -s -m 30 -X POST "$B/functions/v1/recover-purchase" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"sessionId":"no purchase reference in this text"}')
case "$RP75" in *"order reference"*) echo "PASS  recover-purchase refuses text without a purchase reference and names what to paste (new build)";;
  *) echo "FAIL  recover-purchase answered text without a reference with: ${RP75:0:140} (want the new 400 naming the button link or order reference)";; esac

# track-ab-event: oversized metadata is refused before any write, probed only when the new build serves.
HT75=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/track-ab-event" -H "apikey: $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if build_ge track-ab-event "$HT75" 2026-10-09 2; then
  BIG75=$(node -e 'console.log(JSON.stringify({testName:"vd75_probe",variant:"probe",eventType:"view",visitorId:"00000000-0000-4000-8000-000000000075",metadata:{blob:"x".repeat(5000)}}))')
  CT75=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/track-ab-event" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$BIG75")
  [ "$CT75" = "400" ] && echo "PASS  track-ab-event refuses 5 KB of metadata with 400 before any write (S8-019)" || echo "FAIL  track-ab-event answered 5 KB of metadata with HTTP $CT75 (want 400)"
else
  echo "FAIL  track-ab-event build ${HT75:-(none)} predates the metadata cap; the oversized-body probe is not sent to a build that would record it"
fi

# stripe-webhook answers Stripe before generation: provable only with a signed event, so from the build alone.
echo "INFO  stripe-webhook 2026-10-09.4 answers checkout.session.completed before the AI writer (vitest: stripe-waited-on-the-ai-writer...); watch Stripe's webhook delivery times drop under ~2 s for product sales"
echo "INFO  scan-heartbeat 2026-10-09.2 mails the owner (subject 'Paid order(s) not delivered') once per undelivered order per day, newest 100 listed and every standing row counted, and fails check cron_http_refusals on any 401/403 cron answer in the last hour; its JSON (undeliveredOrders, undeliveredOrdersTotal, checks) is readable only with the cron key, service role or ADMIN_API_KEY"
echo "INFO  track-ab-event 2026-10-09.2 counts each address (mail_door_take door track-ab-event:address, 1,800/h) before the site's 20,000/h; mail_door_take is a counter, so it is never called here: with the service role, SELECT count(*) FROM mail_door_counts WHERE door = 'track-ab-event:address' is above 0 after an hour of traffic"
echo "INFO  send-search-digest 2026-10-09.2 restores handed-back claims when the run ends and keeps the claim's stamp for a suppressed or mailbox-less owner (vitest: searches-the-digest-handed-back-held-the-head-of-the-queue); its run answers {considered, handedBack} only to the cron"
echo "INFO  /health-check (frontend) sends the stored admin key to health-check: after the publish, the dashboard's service cards show provider messages again (an anonymous health-check answer has none)"
echo "INFO  customer mails now carry reply_to resumeboostersupp@gmail.com; OWNER: reply once to a purchase mail and to a pulse confirmation and confirm the reply lands in that inbox"
echo "INFO  the seller line in marketing footers renders nothing until _shared/seller-identity.ts is filled (both fields); OWNER: fill it when the entity and address exist, keep the frontend copy equal"
