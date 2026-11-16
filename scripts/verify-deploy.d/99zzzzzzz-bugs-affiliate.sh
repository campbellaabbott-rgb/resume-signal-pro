# shellcheck shell=bash
# ── 99zzzzzzz-bugs-affiliate. THE BUG ROUND OF 2026-11-08, LANE AFFILIATE
# (branch bugs/a-affiliate): RC-S13-063, S14X-021, S14X-085 (the display half;
# the approval rule is owner-gated), S14X-092, S14X-093, S14X-115, S14X-116,
# S14X-212, S14X-226 and S14X-227. Two functions at 2026-11-12.1
# (affiliate-payout-request, and affiliate-account, new), three migrations
# (20261112120000 sign-in, 20261112121000 click privacy, 20261112122000 money
# and display; the integrator sets the final stamps), and the affiliate page,
# its hooks and track-transport, published by the merge itself.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE STAGES, read from production, never assumed:
#   functions  affiliate-payout-request answers 2026-11-12.1 or later: the
#              round's paste is live. Until then a missing affiliate-account
#              and every missing column are INFO; from then on, a FAIL (the
#              round applies its migrations before its functions).
#   frontend   the published Affiliates chunk reads stats_by_range: the merge
#              published. Until then the old page and the old hook are INFO.
#   owner      a line that depends on an owner's answer prints INFO 'owner
#              pending' until reservations['bug-round'].ownerDecided in
#              docs/deploy-ledger.json names its key: S14X-021 (approved-full
#              in plan.json 2026-11-15; the integrator copies it) and S14X-085
#              (the approval rule; no answer yet).
#
# THE CLAIMS, one line each:
#   F1  affiliate-payout-request serves 2026-11-12.1 or later (S14X-093,
#       S14X-115, S14X-116, RC-S13-063: token hash, proven address, flagged
#       rows never requested, the refusal named in the body).
#   F2  affiliate-account answers its preflight at 2026-11-12.1 or later
#       (S14X-115, S14X-093, S14X-021: reset, confirm, email change, sign out
#       everywhere, export, erase).
#   M1  affiliate_sessions.token_hash exists and the table is closed to anon
#       (S14X-093). A GET of one named column answers 42501 when it exists
#       and is refused, 42703 when it is missing; [] means anon kept a grant
#       the migration revokes.
#   M2  affiliates.email_confirmed_at exists (S14X-115).
#   M3  affiliate_conversions.review_flags and .currency exist (RC-S13-063,
#       S14X-227).
#   M4  client_write_budget_left is closed to anon (S14X-092): 42501.
#   M5  affiliate_returning_pro_customer is closed to anon (S14X-226): 42501.
#   M6  affiliate_click_days and affiliate_hash_keys exist and give anon
#       nothing (S14X-021). A hash key table that answers rows is a FAIL
#       whatever the stage.
#   C1  the 'affiliate-clicks-prune' job is scheduled daily ('23 4 * * *')
#       and its last run succeeded (S14X-021).
#   K1  the census still finds every affiliate function the page calls open
#       to it (login_affiliate, register_affiliate, track_affiliate_click,
#       get_affiliate_dashboard, get_affiliate_clicks, logout_affiliate are
#       not in allowlisted_not_callable): S14X-092 and S14X-093 changed no
#       anon signature.
#   P1  the published Affiliates chunk reads stats_by_range, names the
#       awaiting-approval tile, the payout requests and affiliate-account, and
#       no longer draws 'Initial Payout' (S14X-212, S14X-085, S14X-116,
#       S14X-115).
#   P2  the published referral hook builds no fingerprint: no
#       getTimezoneOffset, no p_ip_hash (S14X-021).
#   P3  the chunk holding forgetVisitorIds (the one that removes the ab_ keys)
#       also clears the affiliate_ref cookie (S14X-021).
#   O1  the approval job (S14X-085, owner-gated): once the owner answers, it
#       is scheduled and its last run succeeded.
#   H1  INFO only: the /affiliates bake's 'any date range you pick', which
#       the data-pages lane rewrites to the four ranges (its section judges).
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the hashed session and
# its end with the account (an-affiliate-session-is-stored-hashed-and-ends-
# with-the-account), the lock-out and the network cap (a-stranger-cannot-lock-
# an-affiliate-out-or-close-sign-up), the keyed click hash and the rollup
# (an-affiliate-click-keeps-a-keyed-address-hash-for-ninety-days), the network
# flag (a-sale-from-the-affiliates-own-network-is-flagged-for-review), the
# alias test (a-returning-pro-customer-under-an-alias-earns-the-affiliate-
# nothing), revenue per currency (affiliate-revenue-is-summed-per-currency),
# the reset mail (an-affiliate-resets-a-password-by-mail-and-proves-the-
# address), and the page (the four RTL files named for S14X-085, -116, -212
# and -115). Each migration's own DO block fails its apply if a definition or
# a grant is wrong.
#
# READ-ONLY. GETs of the homepage, its entry and two chunks, and the
# /affiliates bake; two OPTIONS preflights; anon GETs that select one named
# column of a closed table (the revoke answers before any row); two GET probes
# of revoked functions (a read-only transaction); GETs of two anon readers
# (get_cron_health, client_callable_census). Nothing is posted.
echo "== 99zzzzzzz-bugs-affiliate. bug round, affiliate lane: hashed sessions, a reset by mail, a keyed click hash for ninety days, each currency, each period, what awaits approval =="

rm -f /tmp/vd_baf_home.html /tmp/vd_baf_entry.js /tmp/vd_baf_page.js /tmp/vd_baf_hook.js /tmp/vd_baf_cron.json /tmp/vd_baf_census.json /tmp/vd_baf_bake.html
VDAF_LEDGER="${VDAF_LEDGER:-docs/deploy-ledger.json}"

# Owner answers, from the ledger the integrator writes.
vdaf_owner() { # $1 key -> yes | no
  VDAF_K="$1" node -e 'const fs=require("fs");let d=null;try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{}const o=d&&d.reservations&&d.reservations["bug-round"]&&d.reservations["bug-round"].ownerDecided;console.log(o&&typeof o==="object"&&Object.prototype.hasOwnProperty.call(o,process.env.VDAF_K)?"yes":"no")' "$VDAF_LEDGER"
}
VDAF_O021=$(vdaf_owner S14X-021)
VDAF_O085=$(vdaf_owner S14X-085)

# One named column of a table, as anon: 42501 | 42703 | 42P01 | PGRST205 | ROWS:n | EMPTY | NONJSON:...
vdaf_col() { # $1 table $2 column
  curl -s -m 30 "$B/rest/v1/$1?select=$2&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j=null;try{j=JSON.parse(s)}catch{}if(Array.isArray(j)){console.log(j.length?"ROWS:"+j.length:"EMPTY");return}if(j&&typeof j==="object"&&j.code){console.log(String(j.code));return}console.log("NONJSON:"+JSON.stringify(s.slice(0,100)))})'
}
# A revoked function, by GET (a read-only transaction): 42501 | PGRST202 | 25006 | VALUE | NONJSON
vdaf_fn() { # $1 function $2 query string
  curl -s -m 30 "$B/rest/v1/rpc/$1?$2" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{console.log("NONJSON");return}if(j&&typeof j==="object"&&!Array.isArray(j)&&j.code){console.log(String(j.code));return}console.log("VALUE")})'
}
vdaf_build() { # $1 function -> the x-fn-build header, or empty
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

# F1 sets the functions stage.
VDAF_FNS=pending
VDAF_PB=$(vdaf_build affiliate-payout-request)
if [ -z "$VDAF_PB" ]; then echo "FAIL  F1 affiliate-payout-request preflight carries no x-fn-build (want affiliate-payout-request.2026-11-12.1 or later)"
elif build_ge affiliate-payout-request "$VDAF_PB" 2026-11-12 1; then VDAF_FNS=live; echo "PASS  F1 affiliate-payout-request x-fn-build = $VDAF_PB (2026-11-12.1 or later): the session is found by its hash, an unproven address is refused, a flagged conversion is never requested, and every refusal names itself"
else echo "INFO  F1 affiliate-payout-request x-fn-build = $VDAF_PB: the round's paste with 2026-11-12.1 has not landed (section 49 lists the gap)"; fi

# F2.
VDAF_AB=$(vdaf_build affiliate-account)
if [ -n "$VDAF_AB" ] && build_ge affiliate-account "$VDAF_AB" 2026-11-12 1; then echo "PASS  F2 affiliate-account x-fn-build = $VDAF_AB: a lost password, the address proof, the email change, sign-out everywhere, export and erase have a server"
elif [ -n "$VDAF_AB" ]; then echo "FAIL  F2 affiliate-account x-fn-build = $VDAF_AB, older than 2026-11-12.1 (it was born at 2026-11-12.1)"
elif [ "$VDAF_FNS" = live ]; then echo "FAIL  F2 affiliate-account answers no x-fn-build though affiliate-payout-request is at $VDAF_PB from the same paste: the new function was not deployed, so the reset link, the confirm banner and the account card all answer 'something went wrong'"
else echo "INFO  F2 affiliate-account is not deployed yet (no x-fn-build): it arrives with the round's paste"; fi

# Missing evidence: INFO before the round's functions are live, FAIL after.
vdaf_missing() { # $1 claim $2 what
  if [ "$VDAF_FNS" = live ]; then echo "FAIL  $1 $2, though the round's functions are live (affiliate-payout-request $VDAF_PB): the migration did not apply, so the functions are running their fallbacks"
  else echo "INFO  $1 $2: the round's migration has not applied yet"; fi
}

# M1-M3: one column each, with a control column the table has always had.
vdaf_columns() { # $1 claim $2 table $3 control $4 why, then the new columns
  local claim="$1" table="$2" ctrl="$3" why="$4"; shift 4
  local c a have=0 miss=0 odd="" ctl
  ctl=$(vdaf_col "$table" "$ctrl")
  case "$ctl" in ROWS:*) echo "FAIL  $claim $table answered rows to the publishable key ($ctrl: $ctl): it is readable by anyone"; return;; 42501|EMPTY) ;; *) echo "FAIL  $claim the control column $table.$ctrl answered $ctl, not 42501 or [], so a missing column cannot be told from a refused one"; return;; esac
  for c in "$@"; do
    a=$(vdaf_col "$table" "$c")
    case "$a" in
      42501|EMPTY) have=$((have + 1));;
      42703) miss=$((miss + 1));;
      *) odd="$odd $c=$a";;
    esac
  done
  if [ -n "$odd" ]; then echo "FAIL  $claim $table's new columns answered$odd (want 42501 or [] for each)"
  elif [ "$have" = "$#" ]; then echo "PASS  $claim $table has $* ($why)"
  elif [ "$have" -gt 0 ]; then echo "FAIL  $claim $table has $have of the $# new columns ($*): the migration applied in part (retyped?), read its stub"
  else vdaf_missing "$claim" "$table has none of $*"; fi
}

# M1 also judges the revoke: [] for the new column means anon kept a grant.
VDAF_TH=$(vdaf_col affiliate_sessions token_hash)
case "$VDAF_TH" in
  42501) echo "PASS  M1 affiliate_sessions has token_hash and refuses anon: a session is stored only as its hash (S14X-093)";;
  42703) vdaf_missing M1 "affiliate_sessions has no token_hash";;
  EMPTY) echo "FAIL  M1 affiliate_sessions has token_hash but anon still holds a grant on it (RLS answered []): 20261112120000 revokes it";;
  ROWS:*) echo "FAIL  M1 affiliate_sessions answered rows to the publishable key ($VDAF_TH): sessions are readable by anyone";;
  *) echo "FAIL  M1 affiliate_sessions.token_hash answered $VDAF_TH (want 42501)";;
esac
vdaf_columns M2 affiliates created_at "an address is proven by a mailed link before a payout, S14X-115" email_confirmed_at
vdaf_columns M3 affiliate_conversions created_at "a conversion carries its currency and its review flags, S14X-227 and RC-S13-063" review_flags currency

# M4, M5: revoked helpers. The arguments are typed; a GET cannot write.
vdaf_closed() { # $1 claim $2 function $3 query $4 what it proves
  local a; a=$(vdaf_fn "$2" "$3")
  case "$a" in
    42501) echo "PASS  $1 $2 refuses anon (42501): $4";;
    PGRST202) vdaf_missing "$1" "$2 does not exist (PGRST202)";;
    25006) echo "FAIL  $1 $2 is CALLABLE as anon: it tried to write and only this read-only GET stopped it";;
    VALUE) echo "FAIL  $1 $2 answered anon a value: it is open to the publishable key";;
    *) echo "FAIL  $1 $2 as anon -> $a (want 42501)";;
  esac
}
vdaf_closed M4 client_write_budget_left "p_scope=verify-probe&p_per_address=1&p_ceiling=1&p_window_minutes=1" "the login reads its failure budget without charging it, so a stranger's guesses no longer lock an affiliate out (S14X-092)"
vdaf_closed M5 affiliate_returning_pro_customer "p_stripe_session_id=cs_verify_probe&p_email=probe%40example.invalid&p_user_id=00000000-0000-0000-0000-000000000000&p_before=2026-01-01T00%3A00%3A00Z" "a returning Pro customer under an alias earns the affiliate nothing (S14X-226)"

# M6 (S14X-021). The key table answering rows is a FAIL at any stage.
VDAF_HK=$(vdaf_col affiliate_hash_keys purpose)
VDAF_CD=$(vdaf_col affiliate_click_days day)
VDAF_CLICKS=pending
case "$VDAF_HK" in ROWS:*|EMPTY) echo "FAIL  M6 affiliate_hash_keys answered the publishable key $VDAF_HK: the table holding the click and network keys must refuse anon (42501)";; esac
if [ "$VDAF_HK" = 42501 ] && [ "$VDAF_CD" = 42501 ]; then VDAF_CLICKS=applied; fi
if [ "$VDAF_O021" != yes ]; then echo "INFO  M6 owner pending: reservations['bug-round'].ownerDecided does not name S14X-021 (affiliate_hash_keys $VDAF_HK, affiliate_click_days $VDAF_CD)"
else
  case "$VDAF_CD" in
    42501) if [ "$VDAF_HK" = 42501 ]; then echo "PASS  M6 affiliate_click_days and affiliate_hash_keys exist and refuse anon: a click keeps a keyed address hash, and clicks older than ninety days become daily counts (S14X-021)"
           else case "$VDAF_HK" in ROWS:*|EMPTY) ;; PGRST205|42P01) echo "FAIL  M6 affiliate_click_days exists but affiliate_hash_keys does not ($VDAF_HK): 20261112121000 applied without 20261112120000's key table";; *) echo "FAIL  M6 affiliate_hash_keys answered $VDAF_HK (want 42501)";; esac; fi;;
    PGRST205|42P01) vdaf_missing M6 "affiliate_click_days does not exist ($VDAF_CD)";;
    EMPTY) echo "FAIL  M6 affiliate_click_days answered [] to anon: the rollup kept a grant 20261112121000 revokes";;
    ROWS:*) echo "FAIL  M6 affiliate_click_days answered rows to the publishable key ($VDAF_CD)";;
    *) echo "FAIL  M6 affiliate_click_days answered $VDAF_CD (want 42501)";;
  esac
fi

# C1, O1: the jobs, from the anon cron reader (by GET: it only reads).
curl -s -m 30 "$B/rest/v1/rpc/get_cron_health?p_hours=26" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_baf_cron.json
vdaf_job() { # $1 claim $2 job $3 schedule $4 stage(applied|pending) $5 what it proves
  VDAF_J="$2" VDAF_S="$3" VDAF_ST="$4" VDAF_W="$5" VDAF_C="$1" VDAF_FN="$VDAF_FNS" node -e '
const fs=require("fs");const e=process.env;const c=e.VDAF_C;
let rows=null;try{rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{}
if(!Array.isArray(rows)){console.log("FAIL  "+c+" get_cron_health is unreadable as anon ("+JSON.stringify(rows).slice(0,140)+"), so the job cannot be judged");process.exit(0)}
if(rows.length===0){console.log("FAIL  "+c+" get_cron_health listed no job at all, so a missing job cannot be told from an empty answer");process.exit(0)}
const r=rows.find((x)=>x&&x.ch_jobname===e.VDAF_J);
if(!r){
  if(e.VDAF_ST==="applied"||e.VDAF_FN==="live")console.log("FAIL  "+c+" the "+e.VDAF_J+" job is not scheduled, though "+(e.VDAF_ST==="applied"?"the migration that schedules it applied":"the functions of this round are live"));
  else console.log("INFO  "+c+" the "+e.VDAF_J+" job is not scheduled yet: its migration has not applied");
  process.exit(0)}
if(r.ch_active===false||r.ch_schedule!==e.VDAF_S){console.log("FAIL  "+c+" "+e.VDAF_J+" active="+r.ch_active+" schedule="+r.ch_schedule+" (want active, "+e.VDAF_S+")");process.exit(0)}
const runs=Number(r.ch_runs)||0,failed=Number(r.ch_failed)||0;
if(runs===0){console.log("INFO  "+c+" "+e.VDAF_J+" is scheduled ("+e.VDAF_S+") and has not run in the last 26 h: expected only on the day of the apply");process.exit(0)}
if(failed>0||r.ch_last_status!=="succeeded"){console.log("FAIL  "+c+" "+e.VDAF_J+": "+runs+" run(s) in 26 h, "+failed+" failed, last "+r.ch_last_status+" at "+r.ch_last_start);process.exit(0)}
console.log("PASS  "+c+" "+e.VDAF_J+" ran "+runs+" time(s) in 26 h, last succeeded at "+r.ch_last_start+": "+e.VDAF_W);' /tmp/vd_baf_cron.json
}
if [ "$VDAF_O021" != yes ]; then echo "INFO  C1 owner pending: reservations['bug-round'].ownerDecided does not name S14X-021 (the click prune job)"
else vdaf_job C1 affiliate-clicks-prune "23 4 * * *" "$VDAF_CLICKS" "clicks older than ninety days are rolled into daily counts and deleted, with their keyed hashes (S14X-021)"; fi
if [ "$VDAF_O085" != yes ]; then echo "INFO  O1 owner pending: reservations['bug-round'].ownerDecided does not name S14X-085 (the commission approval rule)"
else vdaf_job O1 affiliate-commission-approval "47 4 * * *" pending "a commission is approved only after its hold, with no refund, no flag and a proven address (S14X-085)"; fi

# K1: the census, by GET (an anon reader).
curl -s -m 30 "$B/rest/v1/rpc/client_callable_census" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_baf_census.json
node -e '
const fs=require("fs");let c=null;try{c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{}
if(!c||typeof c!=="object"||Array.isArray(c)||!Array.isArray(c.allowlisted_not_callable)){console.log("FAIL  K1 client_callable_census is unreadable as anon ("+JSON.stringify(c).slice(0,140)+"), so the affiliate functions cannot be shown open to the page");process.exit(0)}
const mine=["login_affiliate","register_affiliate","track_affiliate_click","get_affiliate_dashboard","get_affiliate_clicks","logout_affiliate"];
const shut=c.allowlisted_not_callable.filter((s)=>mine.some((m)=>String(s).includes(m+"(")));
if(shut.length)console.log("FAIL  K1 the census finds affiliate functions the page calls closed to it: "+JSON.stringify(shut));
else if(!(Number(c.allowlisted)>0))console.log("INFO  K1 the census lists no allowlisted functions, so nothing was compared");
else console.log("PASS  K1 every affiliate function the page calls is still open to it ("+c.allowlisted+" allowlisted, none of login, register, track, dashboard, clicks or logout among the not-callable): the round changed no anon signature");' /tmp/vd_baf_census.json

# P1-P3: the published app. The entry names both affiliate chunks.
curl -s -m 30 "$SITE/" > /tmp/vd_baf_home.html
VDAF_MAIN=$(grep -o '/assets/index-[^"]*\.js' /tmp/vd_baf_home.html | head -1)
[ -n "$VDAF_MAIN" ] && curl -s -m 60 "$SITE$VDAF_MAIN" > /tmp/vd_baf_entry.js
VDAF_PAGEN=$( { [ -f /tmp/vd_baf_entry.js ] && grep -o 'Affiliates-[A-Za-z0-9_-]*\.js' /tmp/vd_baf_entry.js; } | head -1)
VDAF_HOOKN=$( { [ -f /tmp/vd_baf_entry.js ] && grep -o 'use-affiliate-auth-[A-Za-z0-9_-]*\.js' /tmp/vd_baf_entry.js; } | head -1)
[ -n "$VDAF_PAGEN" ] && curl -s -m 30 "$SITE/assets/$VDAF_PAGEN" > /tmp/vd_baf_page.js
[ -n "$VDAF_HOOKN" ] && curl -s -m 30 "$SITE/assets/$VDAF_HOOKN" > /tmp/vd_baf_hook.js

VDAF_FE=unknown
if [ -z "$VDAF_MAIN" ]; then echo "FAIL  P1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDAF_PAGEN" ] || ! grep -qF 'get_affiliate_clicks' /tmp/vd_baf_page.js 2>/dev/null; then
  echo "FAIL  P1 the entry $VDAF_MAIN names no Affiliates chunk that reads get_affiliate_clicks (${VDAF_PAGEN:-none named}): the bundle layout moved, so the page cannot be judged"
else
  VDAF_NEW=0; VDAF_GOT=""
  for VDAF_T in stats_by_range affiliateProgram.tiles.awaitingApproval payout_requests affiliate-account; do
    if grep -qF "$VDAF_T" /tmp/vd_baf_page.js; then VDAF_NEW=$((VDAF_NEW + 1)); else VDAF_GOT="$VDAF_GOT $VDAF_T"; fi
  done
  VDAF_OLDP=no; grep -qF 'Initial Payout' /tmp/vd_baf_page.js && VDAF_OLDP=yes
  if [ "$VDAF_NEW" = 4 ] && [ "$VDAF_OLDP" = no ]; then VDAF_FE=live; echo "PASS  P1 the published Affiliates chunk ($VDAF_PAGEN) reads stats_by_range, shows what awaits approval and the payout requests the server holds, calls affiliate-account, and draws no 'Initial Payout' (S14X-212, S14X-085, S14X-116, S14X-115)"
  elif [ "$VDAF_NEW" = 0 ] && [ "$VDAF_OLDP" = yes ]; then VDAF_FE=old; echo "INFO  P1 the published Affiliates chunk ($VDAF_PAGEN) is the old page ('Initial Payout', no stats_by_range): the merge carrying the round has not published"
  else VDAF_FE=live; echo "FAIL  P1 the published Affiliates chunk ($VDAF_PAGEN) is neither page: missing$VDAF_GOT$([ "$VDAF_OLDP" = yes ] && echo "; still draws 'Initial Payout'")"; fi
fi

if [ "$VDAF_O021" != yes ]; then echo "INFO  P2 owner pending: reservations['bug-round'].ownerDecided does not name S14X-021 (the referral hook's fingerprint)"
elif [ -z "$VDAF_HOOKN" ] || ! grep -qF 'track_affiliate_click' /tmp/vd_baf_hook.js 2>/dev/null; then
  echo "FAIL  P2 the entry names no use-affiliate-auth chunk that logs track_affiliate_click (${VDAF_HOOKN:-none named}): the referral hook cannot be judged"
elif grep -qE 'getTimezoneOffset|p_ip_hash' /tmp/vd_baf_hook.js; then
  if [ "$VDAF_FE" = live ]; then echo "FAIL  P2 the published referral hook ($VDAF_HOOKN) still builds the agent/screen/time-zone fingerprint and sends p_ip_hash, though the round's page is published"
  else echo "INFO  P2 the published referral hook ($VDAF_HOOKN) still sends a page-built p_ip_hash: the merge carrying the round has not published"; fi
else echo "PASS  P2 the published referral hook ($VDAF_HOOKN) builds no fingerprint and sends no p_ip_hash: the server keys the address itself (S14X-021)"; fi

if [ "$VDAF_O021" != yes ]; then echo "INFO  P3 owner pending: reservations['bug-round'].ownerDecided does not name S14X-021 (a No forgetting the stored referral)"
elif [ ! -f /tmp/vd_baf_entry.js ] || ! grep -qF 'startsWith("ab_")' /tmp/vd_baf_entry.js; then
  echo "FAIL  P3 the entry ${VDAF_MAIN:-(none)} holds no forgetVisitorIds (the loop that removes the ab_ keys): the bundle layout moved, so a No's reach cannot be judged"
elif grep -qF 'affiliate_ref=;expires=Thu, 01 Jan 1970' /tmp/vd_baf_entry.js; then echo "PASS  P3 the published forgetVisitorIds also clears the affiliate_ref cookie and its stored copy: a No forgets a stored referral (S14X-021)"
elif [ "$VDAF_FE" = live ]; then echo "FAIL  P3 the published forgetVisitorIds does not clear the affiliate_ref cookie, though the round's page is published: a No leaves a stored referral behind"
else echo "INFO  P3 the published forgetVisitorIds does not clear affiliate_ref yet: the merge carrying the round has not published"; fi

# H1: the data-pages lane's hand-off, counted, never judged here.
curl -s -m 30 -A "$UA" "$SITE/affiliates" > /tmp/vd_baf_bake.html
VDAF_ANY=$(grep -c 'any date range you pick' /tmp/vd_baf_bake.html 2>/dev/null || true)
echo "INFO  H1 the /affiliates bake says 'any date range you pick' ${VDAF_ANY:-0} time(s): the data-pages lane rewrites it to the four ranges the page offers, and its section judges it"
