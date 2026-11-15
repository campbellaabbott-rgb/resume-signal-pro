# shellcheck shell=bash
# ── 99zzzzzzz-bugs-privacy-retention. THE BUG ROUND (register 2026-11-08),
# PRIVACY-RETENTION LANE (branch bugs/a-privacy-retention). Seven keys:
# S14X-042, NEW-PRIVACY-RETENTION-01, S14X-181, S14X-231, S14X-097-privacy,
# S14X-021-privacy and S14X-073-privacy. One migration in the round's reserved
# 20261112100000-109999 range; no edge function; the Privacy copy is published
# by the merge itself.
#
# Named 99zzzzzzz so it sorts after 99zzzzzz-hotfix-*.sh in byte order ("-"
# before "z") and under a locale that ignores the dash ("99zzzzzzh" before
# "99zzzzzzz").
#
# THE CLAIMS, one line each. None FAILs because of this lane's own absence
# except where an OPEN HOLE already exists — PR2 FAILs today and should.
#   PR1  'privacy-retention-nightly' is scheduled, active, carries a
#        statement_timeout in its COMMAND, and once it has run has neither
#        failed nor timed out (a timed-out run means the 90-day promise was not
#        met that night). The migration carries the cron AND PR2's revokes, so
#        PR2's own answer is the stamp signal: while the writers are still
#        open the migration has not applied and a missing job is INFO; once
#        they are closed, a missing, inactive or timeout-less job is a FAIL.
#        Live 2026-11-15: 60 jobs listed, none named for these tables, and 38
#        of the 60 carry no timeout at all.
#   PR2  the four log writers are closed to anon. Two are probed by name with
#        real arguments (a GET, which PostgREST runs in a read-only
#        transaction): 42501 is PASS, 25006 is a FAIL that proves the function
#        is callable and only the read-only transaction stopped the INSERT.
#        client_callable_census's unlisted_client_callable must reach 0.
#        Live 2026-11-15: log_scan_metric and log_heartbeat_result both answer
#        25006 — anon CAN write to these log tables — and the census says 2.
#        So PR2 is a FAIL today, on purpose: it is an open hole, not a
#        pending deploy.
#   PR3  the served /privacy says what the lane ships. One GET, six sub-claims,
#        all gated on the page's own "Last updated" reaching the round's date,
#        because the copy and the date publish together:
#          a  section 11 no longer reads 'AI models and fonts' (S14X-181)
#          b  the SIGN-IN PROCESSOR LINE names Resend (S14X-181). Scoped to
#             that line, never grepped over the page: 'Resend' already appears
#             twice on today's /privacy, so a page-wide grep would pass while
#             the processor line stayed wrong — one of the four shapes of a
#             guard that looks like it works.
#          c  the ipinfo line names the emailed report (S14X-181)
#          d  the 'In Your Browser' item mentions signing out (S14X-097)
#          e  the page names the referral cookie (S14X-021) — OWNER-GATED
#          f  the Shortlist sentence states the shipped retention rule
#             (S14X-073) — OWNER-GATED
#        Live 2026-11-15: Last updated reads 2026-11-06, which predates the
#        round, so every sub-claim is INFO today; 'AI models and fonts' is
#        still present and affiliate_ref is absent, so (a) and (e) have
#        something that can fail.
#
# OWNER-GATED LINES. (e) and (f) read the bug-round reservation's ownerDecided
# in docs/deploy-ledger.json. While the key is absent they print
# INFO 'owner pending' and judge nothing; once the integrator records the
# owner's answer they are judged against the recorded rule. The answers for
# S14X-021 (the approved Affiliate-program wording) and S14X-073 (rule A:
# employer delete plus a 4-year purge) were recorded in the round register on
# 2026-11-15 and still have to be copied into the reservation when bugs/base is
# cut — until then these two lines correctly say 'owner pending'.
#
# og_decided LIVES HERE FOR NOW, DELIBERATELY. It is the first reader of
# ownerDecided in the whole verifier. It belongs beside J/R/MC/probe in
# scripts/verify-deploy.sh, but that file is not in this round's reservation,
# so the second bugs-* section to land should lift it there in one reserved
# change rather than copy it. Thirty-five sections each carrying their own copy
# is the thing to avoid.
#
# NOT PROVABLE FROM OUTSIDE, so proved elsewhere: the erase itself (S14X-231 —
# delete-account needs a real account and the table is closed), which the
# migration's own rolled-back probe RAISEs on at apply time, and whose one-day
# purge of the same rows PR1's cron line covers.
#
# READ-ONLY. One anon RPC for the cron health, one for the census, two GET
# probes of writers (read-only transaction), and one GET of /privacy with the
# crawler UA. Nothing is posted.
echo "== 99zzzzzzz. bug round, privacy-retention: the nightly purge runs, the log writers are shut, and /privacy says what shipped =="

rm -f /tmp/vd_bpr_cron.json /tmp/vd_bpr_census.json /tmp/vd_bpr_privacy.html

LEDGER="docs/deploy-ledger.json"

# Prints the recorded choice for a key, or nothing when it is not recorded.
og_decided() {
  [ -f "$LEDGER" ] || return 0
  node -e '
    const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(0)}
    const rs=j.reservations||j.entries||j;const list=Array.isArray(rs)?rs:Object.entries(rs).map(([name,v])=>({name,...v}));
    const r=list.find((x)=>String(x.name||x.id||"")==="bug-round");
    const od=r&&r.ownerDecided;if(!od||typeof od!=="object")process.exit(0);
    const v=od[process.argv[2]];if(v===undefined||v===null)process.exit(0);
    process.stdout.write(typeof v==="string"?v:(v.choice!==undefined?String(v.choice):JSON.stringify(v)));
  ' "$LEDGER" "$1" 2>/dev/null
}

# ── PR2 first: it is the stamp signal PR1 reads. ──────────────────────────
PR2_CLOSED=1
for spec in 'log_scan_metric|p_scan_type=x' \
            'log_heartbeat_result|p_function_name=x&p_status=x&p_response_time_ms=1&p_test_passed=true'; do
  fn="${spec%%|*}"; qs="${spec#*|}"
  body=$(curl -s -m 60 "$B/rest/v1/rpc/$fn?$qs" -H "apikey: $K" -H "Authorization: Bearer $K")
  code=$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).code||""))}catch{process.stdout.write("")}})')
  case "$code" in
    42501) echo "PR2 PASS  $fn is closed to anon (42501)" ;;
    25006) echo "PR2 FAIL  $fn is anon-CALLABLE: it answered 25006, so only the read-only GET transaction stopped the INSERT. A POST would write. Revoke EXECUTE from PUBLIC, anon and authenticated on every overload in pg_proc and grant service_role"; PR2_CLOSED=0 ;;
    PGRST202) echo "PR2 FAIL  $fn has no overload matching the probed arguments ($qs): the probe no longer reaches the function it is meant to judge, so this line proves nothing. Re-read the signature in pg_proc and fix the probe"; PR2_CLOSED=0 ;;
    "")    echo "PR2 FAIL  $fn answered no JSON code (a gateway body, or an empty answer). The probe cannot be read, so the writer is unjudged"; PR2_CLOSED=0 ;;
    *)     echo "PR2 FAIL  $fn answered $code, which is neither 42501 (closed) nor 25006 (callable). Read it before trusting either verdict"; PR2_CLOSED=0 ;;
  esac
done

census=$(curl -s -m 60 -X POST "$B/rest/v1/rpc/client_callable_census" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{}')
printf '%s' "$census" > /tmp/vd_bpr_census.json
ucc=$(printf '%s' "$census" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const r=Array.isArray(j)?j[0]:j;const v=r&&r.unlisted_client_callable;process.stdout.write(v===undefined||v===null?"":String(v))}catch{process.stdout.write("")}})')
if [ -z "$ucc" ]; then
  echo "PR2 FAIL  client_callable_census did not answer unlisted_client_callable; the census cannot confirm the revokes"
elif [ "$ucc" = "0" ]; then
  echo "PR2 PASS  client_callable_census: unlisted_client_callable = 0"
elif [ "$PR2_CLOSED" = "1" ]; then
  echo "PR2 FAIL  the probed writers are closed but client_callable_census still counts $ucc unlisted client-callable function(s): the migration closed the two this lane probes and left others open"
else
  echo "PR2 INFO  client_callable_census: unlisted_client_callable = $ucc, while the probes above show the revokes have not applied yet (expected until the migration lands; the probe FAILs are the live hole)"
fi

# ── PR1: the nightly purge. ───────────────────────────────────────────────
cron=$(curl -s -m 60 -X POST "$B/rest/v1/rpc/get_cron_health" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"p_hours":48}')
printf '%s' "$cron" > /tmp/vd_bpr_cron.json
PR2_CLOSED="$PR2_CLOSED" printf '%s' "$cron" | PR2_CLOSED="$PR2_CLOSED" node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j;try{j=JSON.parse(s)}catch{console.log("PR1 FAIL  get_cron_health did not answer JSON; the nightly purge is unjudged");return}
  const rows=Array.isArray(j)?j:[j];
  if(!rows.length||!rows[0]||rows[0].ch_jobname===undefined){console.log("PR1 FAIL  get_cron_health answered no job rows ("+JSON.stringify(j).slice(0,120)+")");return}
  const applied=process.env.PR2_CLOSED==="1";
  const r=rows.find((x)=>x.ch_jobname==="privacy-retention-nightly");
  if(!r){
    const msg="privacy-retention-nightly is not scheduled ("+rows.length+" jobs listed)";
    console.log(applied
      ? "PR1 FAIL  "+msg+", yet the log writers are already closed, so this lane\u0027s migration applied WITHOUT its cron: nothing purges payment, scan or lead rows at 90 days"
      : "PR1 INFO  "+msg+"; the log writers are still open, so the migration has not applied yet");
    return;
  }
  if(r.ch_active!==true){console.log("PR1 FAIL  privacy-retention-nightly exists but ch_active is "+JSON.stringify(r.ch_active)+": it never runs");return}
  if(r.ch_timeout===null||r.ch_timeout===undefined){console.log("PR1 FAIL  privacy-retention-nightly carries no statement_timeout in its COMMAND, so it is capped at the session\u0027s 2 minutes and a long night is cut short mid-purge");return}
  if(!(Number(r.ch_runs)>=1)){console.log("PR1 INFO  privacy-retention-nightly is scheduled, active and carries a timeout ("+r.ch_timeout+"), and has not run in the window yet (ch_runs "+JSON.stringify(r.ch_runs)+")");return}
  if(Number(r.ch_failed)>0){console.log("PR1 FAIL  privacy-retention-nightly failed "+r.ch_failed+" of "+r.ch_runs+" run(s); last status "+JSON.stringify(r.ch_last_status));return}
  if(Number(r.ch_timeouts)>0){console.log("PR1 FAIL  privacy-retention-nightly timed out on "+r.ch_timeouts+" of "+r.ch_runs+" run(s): the 90-day promise was not met on those nights");return}
  console.log("PR1 PASS  privacy-retention-nightly active, timeout "+r.ch_timeout+", "+r.ch_runs+" run(s), 0 failed, 0 timed out");
});'

# ── PR3: the served Privacy page. ─────────────────────────────────────────
curl -s -m 60 -A "$UA" "$SITE/privacy" -o /tmp/vd_bpr_privacy.html
OG_021="$(og_decided S14X-021)" OG_073="$(og_decided S14X-073)" node scripts/verify-deploy.d/99zzzzzzz-bugs-privacy-retention.pr3.mjs
