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
# The review round of the same day added: company-claim mails only the
# board's name for a company and counts network, inbox and day; both digests
# answer only the cron key and claim their rows atomically (their crons carry
# x-email-cron); send-scan-report .3 counts sends per report id, takes its
# verdict from numbers, strips bare domains and phone numbers, and starts the
# fix-plan sequence only from a button in the mail; the free keys the old
# door minted are revoked and idle free keys retire (api-key-retire-idle).
#
# READ-ONLY. OPTIONS preflights (and the webhook's GET, which answers 405) run
# no function logic and send nothing. Every function here that can send mail
# or mint is NEVER called -- its refusal is proved in the vitest suite
# (an-internal-mailer-answers-only-our-own-servers, a-pulse-goes-only-to-an-
# address-that-clicked, a-key-nobody-can-get-is-not-a-product, a-report-mail-
# counts-the-inbox-not-the-header, a-claim-mail-names-the-company-the-board-
# knows, a-digest-is-sent-by-the-scheduler-once). mail_door_take is a counter, so it is never
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
  # Builds of 2026-10-04 that predate the review round's fixes: send-scan-report
  # .1 printed a caller's sentences and .2 let one sealed report be replayed to
  # strangers (both before .3); send-market-pulse .1 and api-key-request .1
  # predate the network shedding and (for keys) the same-answer rule.
  local n="${2##*.}"
  if [ "$d" = "2026-10-04" ]; then
    case "$1" in
      send-scan-report) [ "$n" -ge 3 ] 2>/dev/null || return 1;;
      send-market-pulse|api-key-request) [ "$n" -ge 2 ] 2>/dev/null || return 1;;
    esac
  fi
  return 0
}
for FN in send-product-email send-analysis-email send-affiliate-commission-email send-market-pulse api-key-request send-scan-report company-claim send-search-digest send-agent-digest verify-product-purchase retry-failed-deliveries analyze-resume; do
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
for Q in "api_key_requests?select=*" "mail_door_counts?select=*" "market_pulse_subscribers?select=*" "market_pulse_subscribers?select=confirmed_at,confirm_token_hash,confirm_window_start,confirm_net"; do
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
if(!r){console.log("FAIL  no send-market-pulse cron job (the reschedule in 20261004100000 did not run)")}
else{
console.log((r.ch_schedule==="47 15 * * *"&&r.ch_active?"PASS":"FAIL")+"  send-market-pulse cron: schedule "+r.ch_schedule+", active "+r.ch_active);
console.log("INFO  send-market-pulse last 48h: runs "+r.ch_runs+", failed "+r.ch_failed+", last "+r.ch_last_status+" at "+r.ch_last_start+" (a run is net.http_post queuing the call; whether the function accepted the key shows only in its own logs: a 200 {sent,skipped}, never a 401)");}
for(const n of ["send-search-digest","send-agent-digest"]){const d=j.find((x)=>x.ch_jobname===n);
if(!d){console.log("INFO  no "+n+" cron job here (20261004100000 leaves an absent digest job absent)");continue}
console.log((d.ch_active?"PASS":"FAIL")+"  "+n+" cron: schedule "+d.ch_schedule+", active "+d.ch_active+" (its command is not readable here; the self-check asserted x-email-cron when the file applied)");
console.log("INFO  "+n+" last 48h: runs "+d.ch_runs+", failed "+d.ch_failed+"; a 401 in the function log means the cron is not sending the key");}
const k=j.find((x)=>x.ch_jobname==="api-key-retire-idle");
console.log((k&&k.ch_active?"PASS":"FAIL")+"  api-key-retire-idle cron "+(k?"schedule "+k.ch_schedule+", active "+k.ch_active:"is missing (20261004100000 schedules it)"));'
echo "INFO  OWNER: the pulse list restarts at zero confirmed subscribers -- rows enrolled by the pre-ticked box are kept but never mailed until their owner confirms"
echo "INFO  OWNER: 20261004100000 REVOKED every free account-less key minted before it (each was handed to whoever typed an address). If your own RB_API_KEY in .env.local (scripts/api-contract-probe.mjs) came from /data-api, it is one of them: mint a new key at $SITE/data-api and replace it"
echo "INFO  revoked holders read the new refusal only once public-api and agent-mcp serve this branch's build (their 'revoked' text names /data-api)"
echo "INFO  ORDER: 20261004100000 must apply before (or with) these builds: the new pulse and digest builds refuse a header-less cron and call claim functions the file creates, and company-claim, send-scan-report and api-key-request count through mail_door_take; until company-claim's build serves, it still relays"
