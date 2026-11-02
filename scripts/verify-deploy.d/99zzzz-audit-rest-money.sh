# shellcheck shell=bash
# ── 99zzzz. AUDIT-REST MONEY (branch fix/audit-rest-money; audit 2026-10-31,
# items S13-028, -040, -043, -059, -060, -061, -062, -063, -069, -074, -081,
# -096 and -109; builds 2026-11-03.1; migrations 20261103100000,
# 20261103110000 and 20261103120000).
#
# Named 99zzzz so it sorts after 99zzz-trust-round-3.sh in byte order ("-"
# sorts before "z") and under a collating locale that ignores the dash.
#
# THE CLAIMS, one line each below:
#   B   stripe-webhook, verify-product-purchase, create-checkout,
#       create-test-coupon, analyze-resume, reconcile-stripe, mail-watch,
#       scan-heartbeat and notify-owner serve 2026-11-03.1 or later (each
#       preflight's x-fn-build): the decline and abandon mail rules and the
#       affiliate's commission mail (S13-059, S13-060), the place refusal gone
#       (S13-061), the owner's test-mode rehearsal (S13-043), the coupon code
#       nobody can guess (S13-062), the orphan re-delivery (S13-028), R2 by
#       each order's own mail and R10 for every scheduled job (S13-109,
#       S13-081), the heartbeat's run budget (S13-069) and the keyless
#       allowance note (S13-040);
#   M1  20261103100000 applied: affiliate_address_key exists and anon may not
#       run it (a GET: PostgREST runs it read-only);
#   M3  20261103120000 applied: cron_disarmed_jobs and
#       cron_command_secret_names exist and anon may not run them;
#   C   what mail-watch's R10 will ring for on its first run, from the anon
#       cron aggregate section 7m already reads (INFO: the jobs failing or
#       switched off in the last 26 hours, so the first R10 mail is expected);
#   what no read here can prove is INFO: 20261103110000 (the owner's read of
#   api_key_check's body), the re-delivery's first use (reconcile-stripe's
#   run stamp), the rehearsal's secrets, and that no country header refuses
#   a sale (proving it would mint a live Stripe session).
#
# READ-ONLY. Preflights run no function logic; the migration probes are GETs
# PostgREST runs read-only; get_cron_health is the anon aggregate. No
# function is POSTed, nothing is written, Stripe is never reached.
echo "== 99zzzz. audit-rest money: payment-failure mail, affiliate mail and alias, test-mode rehearsal, orphan re-delivery, mail-watch R2/R10, heartbeat budget, allowance note =="

vdm_build() { # $1 fn -> the x-fn-build its preflight answers (stripe-webhook answers its 405 with it)
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

for VDM_FN in stripe-webhook verify-product-purchase create-checkout create-test-coupon analyze-resume reconcile-stripe mail-watch scan-heartbeat notify-owner; do
  VDM_H=$(vdm_build "$VDM_FN")
  if [ -z "$VDM_H" ]; then echo "FAIL  $VDM_FN preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
  elif build_ge "$VDM_FN" "$VDM_H" "2026-11-03" "1"; then echo "PASS  $VDM_FN preflight x-fn-build = $VDM_H ($VDM_FN.2026-11-03.1 or later)"
  else echo "FAIL  $VDM_FN preflight x-fn-build = $VDM_H (want $VDM_FN.2026-11-03.1 or later: the build before the audit-rest money round is serving)"; fi
done

# A migration's function, asked by a GET: 42501 means PostgREST found it and
# anon may not run it (applied, closed); PGRST202 means it does not exist.
vdm_applied() { # $1 fn  $2 query string  $3 migration
  local code
  code=$(curl -s -m 60 "$B/rest/v1/rpc/$1${2:+?$2}" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)||typeof j==="string"||typeof j==="boolean"||j===null?"RAN":(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
  case "$code" in
    42501) echo "PASS  $1 exists and anon may not run it ($3 applied)" ;;
    PGRST202) echo "FAIL  $1 does not exist: $3 has not applied" ;;
    RAN) echo "FAIL  $1 ran for anon: $3 must leave it to the service role" ;;
    *) echo "FAIL  $1 probe -> $code (want 42501)" ;;
  esac
}
vdm_applied affiliate_address_key "p_email=probe%40example.invalid" 20261103100000
vdm_applied cron_command_secret_names "p_command=probe" 20261103120000
vdm_applied cron_disarmed_jobs "" 20261103120000

rm -f /tmp/vd_99zzzz_cron.json
R get_cron_health '{"p_hours":26}' > /tmp/vd_99zzzz_cron.json
node -e '
const fs=require("fs");let rows=null;try{rows=JSON.parse(fs.readFileSync("/tmp/vd_99zzzz_cron.json","utf8"))}catch{}
if(!Array.isArray(rows)||rows.length===0){console.log("INFO  get_cron_health unreadable or empty: what R10 will ring for cannot be read here");process.exit(0)}
const failing=[],off=[];
for(const j of rows){const runs=Number(j.ch_runs||0),failed=Number(j.ch_failed||0);
  if(j.ch_last_status==="failed"&&runs>=1&&(runs===1||failed*2>=runs))failing.push(j.ch_jobname+" ("+failed+" of "+runs+")");
  if(j.ch_active===false&&runs>0)off.push(j.ch_jobname);}
if(!failing.length&&!off.length)console.log("INFO  mail-watch R10 has nothing to ring for in the last 26 hours ("+rows.length+" jobs): no job failing at half its runs, none switched off after running");
else console.log("INFO  mail-watch R10 will ring on its first run, as it should: "+(failing.length?"failing "+failing.join(", "):"")+(failing.length&&off.length?"; ":"")+(off.length?"switched off after running "+off.join(", "):""));'

echo "INFO  20261103110000 (an unused pass is started only by the tool it was sold for) is proven by the owner's read: select position('''/mcp/request_application''' in pg_get_functiondef('public.api_key_check(text,text)'::regprocedure)) > 0 (true)"
echo "INFO  reconcile-stripe 2026-11-03.1 re-delivers each paid session the webhook missed through stripe-webhook and stamps redelivered in job_board_meta reconcile_stripe_run (the owner's read: select v from job_board_meta where k = 'reconcile_stripe_run'; v.buildVersion 2026-11-03.1 carries a redelivered count)"
echo "INFO  the owner's Full Analysis rehearsal: an sk_test_ STRIPE_TEST_SECRET_KEY and STRIPE_TEST_WEBHOOK_SECRET, then create-checkout with x-admin-key and {\"testMode\":true}; a visitor's testMode is ignored (proven in src/test/the-owner-can-rehearse-a-full-analysis-in-stripe-test-mode.test.ts, never here: it would mint a session)"
echo "INFO  no country header refuses a Full Analysis sale (S13-061): proven in the sales-stay-on tests, never here, since a probe would mint a live Stripe session"
