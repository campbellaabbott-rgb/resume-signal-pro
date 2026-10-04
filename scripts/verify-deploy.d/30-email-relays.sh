# shellcheck shell=bash
# ── 30. THE MAIL DOORS OF 2026-10-04 (defect sweep 1.15, 1.43, 1.59, 2.08, 2.23).
# send-product-email, send-analysis-email and send-affiliate-commission-email
# answer only the service-role key; send-market-pulse's batch answers only the
# cron key (x-email-cron) or the service role, and its sign-up sends a
# confirmation instead of subscribing; api-key-request mails a link and mints
# only when the link is opened; send-scan-report counts per network, per inbox
# and per day (mail_door_take), prints a report's sentences only under the
# scan's seal (free-keyword-scan reportMeta.mailSeal), and no longer writes the
# pulse list. Migration 20261004100000 carries the SQL.
#
# READ-ONLY. OPTIONS preflights (and the webhook's GET, which answers 405) run
# no function logic and send nothing. Every function here that can send mail
# or mint is NEVER called -- its refusal is proved in the vitest suite
# (an-internal-mailer-answers-only-our-own-servers, a-pulse-goes-only-to-an-
# address-that-clicked, a-key-nobody-can-get-is-not-a-product, a-report-mail-
# counts-the-inbox-not-the-header). mail_door_take is a counter, so it is never
# called here either, not even to watch it refuse. The table
# probes are selects that a revoked grant refuses; the two RPC probes are pure
# readers (a boolean key match and an IMMUTABLE string fold) that write nothing
# even if their revoke had not landed.
echo "== 30. the mail doors: internal mailers, the pulse opt-in, keys behind a mailbox (20261004100000) =="

# Build markers: date part 2026-10-04 or later (a later deploy of the same
# function from main carries this change too).
vd30_build_ok() { # $1 fn, $2 header value
  case "$2" in "$1".20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].*) ;; *) return 1;; esac
  local d="${2#"$1".}"; d="${d%%.*}"
  [ "$d" \> "2026-10-03" ] || return 1
  # send-scan-report's .1 of 2026-10-04 predates the mail seal: it still
  # printed a caller's sentences. The seal arrived in .2.
  if [ "$1" = send-scan-report ] && [ "$d" = "2026-10-04" ] && [ "${2##*.}" = 1 ]; then return 1; fi
  return 0
}
for FN in send-product-email send-analysis-email send-affiliate-commission-email send-market-pulse api-key-request send-scan-report verify-product-purchase retry-failed-deliveries analyze-resume; do
  H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
  if [ -z "$H" ]; then echo "FAIL  $FN preflight carries no x-fn-build (the previous bundle is still serving)"
  elif vd30_build_ok "$FN" "$H"; then echo "PASS  $FN preflight x-fn-build = $H (2026-10-04 or later)"
  else echo "FAIL  $FN preflight x-fn-build = $H (want $FN.2026-10-04.N or later)"; fi
done
WH30=$(curl -s -m 30 -D - -o /dev/null "$B/functions/v1/stripe-webhook" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')
if vd30_build_ok stripe-webhook "$WH30"; then echo "PASS  stripe-webhook GET carries x-fn-build = $WH30 (2026-10-04 or later)"
else echo "FAIL  stripe-webhook GET x-fn-build = '${WH30}' (want stripe-webhook.2026-10-04.N or later)"; fi
echo "INFO  ORDER: the four callers (stripe-webhook, verify-product-purchase, retry-failed-deliveries, analyze-resume) must serve 2026-10-04+ no later than the three internal mailers, or purchase mail is refused (401) in between"
echo "INFO  send-scan-report prints a report's sentences only under free-keyword-scan's reportMeta.mailSeal; deploy free-keyword-scan with it, or every emailed report carries the numbers only. A scan costs money, so the seal is proven only by 'npm run verify:deploy:scan' (its 'scan emits current fields' line names mailSeal when missing)"
echo "INFO  7f pins the callers' builds to exactly 2026-10-01.1; after this deploy those lines read FAIL by construction -- this section's 'or later' lines supersede them"

# The tables: closed to anon BY NAME (42501), present (not PGRST205), and the
# pulse table carries the opt-in column (42501 on the column, not 42703).
vd30_code() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})'; }
for Q in "api_key_requests?select=*" "mail_door_counts?select=*" "market_pulse_subscribers?select=*" "market_pulse_subscribers?select=confirmed_at,confirm_token_hash"; do
  C=$(curl -s -m 30 "$B/rest/v1/$Q&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | vd30_code)
  case "$C" in
    42501) echo "PASS  anon GET ${Q} -> 42501 (exists, revoked by name)";;
    PGRST205) echo "FAIL  ${Q%%\?*} does not exist (20261004100000 not applied)";;
    42703) echo "FAIL  ${Q}: a column is missing (20261004100000 not applied)";;
    ROWS:*) echo "FAIL  anon GET ${Q} -> ${C} (the REVOKE did not land: the grant still answers, even if RLS empties it)";;
    *) echo "FAIL  anon GET ${Q} -> ${C}";;
  esac
done
NC30=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/api_key_requests_never_existed?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
[ "$NC30" = "404" ] && echo "PASS  negative control api_key_requests_never_existed -> 404 (so a 42501 above means present)" || echo "FAIL  negative control -> HTTP $NC30"

# Pure readers only: a key match that returns a boolean, and a string fold.
probe email_cron_key_matches '{"p_key":"0000000000000000000000000000000000000000000000000000000000000000"}'
probe api_key_mailbox '{"p_email":"probe+tag@example.org"}'

# The pulse schedule still runs (its command is not readable here; the
# migration's self-check asserted the x-email-cron header when it applied).
R get_cron_health '{"p_hours":48}' > /tmp/vd_30_cron.json
node -e '
const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync("/tmp/vd_30_cron.json","utf8"))}catch{j=null}
if(!Array.isArray(j)){console.log("INFO  get_cron_health unreadable: "+JSON.stringify(j).slice(0,140));process.exit(0)}
const r=j.find((x)=>x.ch_jobname==="send-market-pulse");
if(!r){console.log("FAIL  no send-market-pulse cron job (the reschedule in 20261004100000 did not run)");process.exit(0)}
console.log((r.ch_schedule==="47 15 * * *"&&r.ch_active?"PASS":"FAIL")+"  send-market-pulse cron: schedule "+r.ch_schedule+", active "+r.ch_active);
console.log("INFO  send-market-pulse last 48h: runs "+r.ch_runs+", failed "+r.ch_failed+", last "+r.ch_last_status+" at "+r.ch_last_start+" (a run is net.http_post queuing the call; whether the function accepted the key shows only in its own logs: a 200 {sent,skipped}, never a 401)");'
echo "INFO  OWNER: the pulse list restarts at zero confirmed subscribers -- rows enrolled by the pre-ticked box are kept but never mailed until their owner confirms"
echo "INFO  OWNER: free keys minted before this deploy were never mailbox-verified and still work; review them (api_keys where user_id is null and created_at < the deploy) before deciding to revoke any"
