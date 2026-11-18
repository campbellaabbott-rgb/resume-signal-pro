# shellcheck shell=bash
# ── 99zzzzzzz-bugs-mail. THE BUG ROUND OF 2026-11-08, PART A, LANE mail
# (branch bugs/a-mail): the scheduled mails and the account page's mail
# controls. Four functions at 2026-11-12.1 (the integrator's stamp):
# send-search-digest, send-agent-digest, send-market-pulse, account-settings.
# Three migrations in 20261112160000-169999: the pulse's calendar-month claim
# and the daily mail-lists-prune job (S14X-238, S14X-102), the agent kick's
# clock (NB-14), and the saved-search column grants (NB-2). The Account page,
# the pulse confirm page and the mail string shard publish with the round.
#
# THE STAGES, read from production, never assumed:
#   functions  any of the four serves 2026-11-12.1 or later: the paste is
#              live. Until then an older build is INFO; from then on a function
#              left behind, or a migration whose trace is missing, is a FAIL.
#   frontend   the published Account chunk or the pulse confirm chunk carries
#              any of the lane's marks, or the entry loads the mail shard: the
#              round published. Until then every mark is INFO; from then on a
#              missing mark is a FAIL. A chunk that cannot be found, or is not
#              the page it is named for, is a FAIL either way.
#   owner      S14X-012, D9 and S14X-234 print INFO owner pending until
#              docs/deploy-ledger.json reservations['bug-round'].ownerDecided
#              names them (the integrator writes it); then each is judged.
#
# THE CLAIMS, one line each:
#   B          each of the four functions serves 2026-11-12.1 or later.
#   S14X-062   both digests check every address against the do-not-mail list.
#   S14X-107   account-settings says an address is off our mail, and the
#              Account chunk reads mailStopped.
#   S14X-102   get_cron_health lists mail-lists-prune, active, with its own
#              statement_timeout, and both stops serve the new build.
#   S14X-237   the pulse prints the newest score or none.
#   S14X-238   the two-argument claim exists (a read-only GET as anon answers
#              42501, not PGRST202), the pulse keeps one or two schedules, and
#              the confirm page says when the next pulse comes.
#   S14X-239   the pulse keeps the language it was asked in.
#   S14X-171   a possible-fit alert is not called strong.
#   S14X-172   a digest dates a posting by its calendar day.
#   S14X-252/mail-handoff  a digest prints no age for a re-dating system.
#   RC-S13-083 the Account chunk writes digest_cadence.
#   NB-21      the Account chunk prints the capped new-posting headline.
#   S1         the English mail strings ride with the account page (the Account
#              chunk or a chunk it imports; the entry, in a build from before
#              the bug round's review moved them) and the entry names 8 more.
#   S14X-012-mail  (owner) option B: send-scan-report serves 2026-11-12.1 or
#              later; option A: get_cron_health lists a transactional drain.
#   D9         (owner) the Account chunk asks account-settings mail_resume.
#   S14X-234-verify  (owner) _dmarc.notify.resumebooster.work says
#              p=quarantine or p=reject, or is absent so the apex's policy
#              applies. The owner's DNS step, not the paste's: while
#              ownerDecided does not name S14X-234 it prints INFO owner pending
#              with what dig read ('v=DMARC1; p=none' on 2026-11-16), so no run
#              before or after the paste is red for it; once named, PASS or
#              FAIL.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite and listed in one INFO
# line: the run stamps (job_board_meta, which anon cannot read), the column
# grants and the kick clock (no read-only probe sees a column privilege or a
# trigger), the clip of a typed name, the fit score's owner check, the reader's
# own day for a posting age, and what the prune deletes.
#
# READ-ONLY. Four OPTIONS preflights (five when S14X-012 is decided B), one
# anon GET of get_cron_health, one anon GET of the claim (PostgREST runs a GET
# in a read-only transaction, and anon is refused before it runs), the site's
# page, entry, two chunks and the mail shard chunks, and one DNS lookup.
# Nothing is posted, mailed or written.
echo "== 99zzzzzzz. bug round part A, mail: four builds, the prune job, the pulse's claim and schedules, the account page's marks, the mail shard, three owner gates (the notify DMARC among them) =="

rm -f /tmp/vd_bm_cron.json /tmp/vd_bm_claim.txt /tmp/vd_bm_home.html /tmp/vd_bm_entry.js /tmp/vd_bm_account.js /tmp/vd_bm_pulse.js /tmp/vd_bm_shard.js /tmp/vd_bm_en.js /tmp/vd_bm_cand.js

vdbm_build() {
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" \
    | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g'
}
VDBM_SSD=$(vdbm_build send-search-digest)
VDBM_SAD=$(vdbm_build send-agent-digest)
VDBM_SMP=$(vdbm_build send-market-pulse)
VDBM_ACS=$(vdbm_build account-settings)
vdbm_new() { [ -n "$2" ] && build_ge "$1" "$2" 2026-11-12 1; }
VDBM_LIVE=0
vdbm_new send-search-digest "$VDBM_SSD" && VDBM_LIVE=1
vdbm_new send-agent-digest "$VDBM_SAD" && VDBM_LIVE=1
vdbm_new send-market-pulse "$VDBM_SMP" && VDBM_LIVE=1
vdbm_new account-settings "$VDBM_ACS" && VDBM_LIVE=1

# B.
for VDBM_P in "send-search-digest=$VDBM_SSD" "send-agent-digest=$VDBM_SAD" "send-market-pulse=$VDBM_SMP" "account-settings=$VDBM_ACS"; do
  VDBM_F=${VDBM_P%%=*}; VDBM_H=${VDBM_P#*=}
  if [ -z "$VDBM_H" ]; then echo "FAIL  B $VDBM_F preflight carries no x-fn-build (want $VDBM_F.2026-11-12.1 or later): the function is not deployed, or its preflight does not answer"
  elif vdbm_new "$VDBM_F" "$VDBM_H"; then echo "PASS  B $VDBM_F x-fn-build = $VDBM_H (2026-11-12.1 or later)"
  elif [ "$VDBM_LIVE" = 1 ]; then echo "FAIL  B $VDBM_F x-fn-build = $VDBM_H while the lane's other functions serve 2026-11-12.1: a partial paste (want $VDBM_F.2026-11-12.1 or later)"
  else echo "INFO  B $VDBM_F x-fn-build = $VDBM_H: the part-A paste with 2026-11-12.1 has not landed (section 49 lists the gap)"; fi
done

# vdbm_key KEY WHAT FN=HEADER...: PASS when every named function serves the
# round's build; FAIL when the paste is live without one of them; INFO before.
vdbm_key() {
  local key="$1" what="$2" pair f h behind=""
  shift 2
  for pair in "$@"; do f=${pair%%=*}; h=${pair#*=}; vdbm_new "$f" "$h" || behind="$behind $f=${h:-none}"; done
  if [ -z "$behind" ]; then echo "PASS  $key $what"
  elif [ "$VDBM_LIVE" = 1 ]; then echo "FAIL  $key the paste is live but$behind does not serve 2026-11-12.1, so this is not true yet: $what"
  else echo "INFO  $key waits for the part-A paste ($behind ): $what"; fi
}
vdbm_key S14X-062 "send-search-digest and send-agent-digest read the do-not-mail list for the addresses they mail, and mail nobody when it cannot be read" "send-search-digest=$VDBM_SSD" "send-agent-digest=$VDBM_SAD"
vdbm_key S14X-237 "send-market-pulse prints the newest scan's score, or none" "send-market-pulse=$VDBM_SMP"
vdbm_key S14X-239 "send-market-pulse keeps the language a pulse was asked in, on whichever device it is confirmed" "send-market-pulse=$VDBM_SMP"
vdbm_key S14X-171 "send-search-digest calls an alert strong only for a fit bar of 20 or more" "send-search-digest=$VDBM_SSD"
vdbm_key S14X-172 "send-search-digest dates a posting by whole calendar days" "send-search-digest=$VDBM_SSD"
vdbm_key S14X-252/mail-handoff "send-search-digest prints no age for a posting from a system that moves its date" "send-search-digest=$VDBM_SSD"

# The cron reader (a GET: PostgREST runs it in a read-only transaction) and
# the claim, asked as anon with a GET: 42501 means the two-argument claim
# exists and anon is refused before it runs; PGRST202 means it does not exist.
curl -s -m 60 "$B/rest/v1/rpc/get_cron_health?p_hours=24" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_bm_cron.json
curl -s -m 30 "$B/rest/v1/rpc/market_pulse_claim_batch?p_limit=1&p_now=2000-01-01T00:00:00Z" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_bm_claim.txt

vdbm_decided() {
  node -e 'let l={};try{l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch{}
const d=((l.reservations||{})["bug-round"]||{}).ownerDecided||{};const v=d[process.argv[2]];
process.stdout.write(v==null?"":typeof v==="object"?String(v.choice??v.option??JSON.stringify(v)):String(v))' "${VDBM_LEDGER:-docs/deploy-ledger.json}" "$1"
}
VDBM_O012=$(vdbm_decided S14X-012)
VDBM_OD9=$(vdbm_decided D9)
[ -z "$VDBM_OD9" ] && VDBM_OD9=$(vdbm_decided S14X-107)
VDBM_SMPNEW=0; vdbm_new send-market-pulse "$VDBM_SMP" && VDBM_SMPNEW=1
VDBM_ACSNEW=0; vdbm_new account-settings "$VDBM_ACS" && VDBM_ACSNEW=1
VDBM_LIVE=$VDBM_LIVE VDBM_SMPNEW=$VDBM_SMPNEW VDBM_ACSNEW=$VDBM_ACSNEW VDBM_O012=$VDBM_O012 node -e '
const fs=require("fs");const e=process.env;const live=e.VDBM_LIVE==="1";
const say=(v,m)=>console.log(v.padEnd(5)+" "+m);
let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_bm_cron.json","utf8"))}catch{}
const rows=Array.isArray(j)?j.filter((r)=>r&&typeof r==="object"&&typeof r.ch_jobname==="string"):null;
const cronOk=!!(rows&&rows.length);
// S14X-102.
if(!cronOk)say("FAIL","S14X-102 get_cron_health as anon answered no jobs ("+JSON.stringify(j).slice(0,140)+"), so the mail-lists-prune job cannot be read");
else{const p=rows.find((r)=>r.ch_jobname==="mail-lists-prune");const fns=e.VDBM_SMPNEW==="1"&&e.VDBM_ACSNEW==="1";
  if(!p){if(live)say("FAIL","S14X-102 the paste is live but get_cron_health lists no mail-lists-prune job among "+rows.length+": migration 20261112160000 did not apply (re-apply it under a fresh stamp)");
    else say("INFO","S14X-102 no mail-lists-prune job among "+rows.length+" yet: the part-A paste has not landed");}
  else if(p.ch_timeout==null||String(p.ch_timeout).trim()==="")say("FAIL","S14X-102 mail-lists-prune is scheduled ("+p.ch_schedule+") without a statement_timeout of its own, so pg_cron caps it at the session default");
  else if(p.ch_active===false)say("FAIL","S14X-102 mail-lists-prune is scheduled but switched off");
  else if(p.ch_last_status==="failed")say("FAIL","S14X-102 mail-lists-prune last ran and failed ("+p.ch_failed+" of "+p.ch_runs+" runs in 24 hours)");
  else if(fns)say("PASS","S14X-102 mail-lists-prune runs "+p.ch_schedule+" with statement_timeout "+p.ch_timeout+" (last: "+(p.ch_last_status||"not run yet")+"), and both stops serve 2026-11-12.1: a stopped pulse keeps no score, language or field");
  else if(live)say("FAIL","S14X-102 mail-lists-prune is scheduled, but send-market-pulse or account-settings does not serve 2026-11-12.1, so a stop still keeps the score and the language");
  else say("INFO","S14X-102 mail-lists-prune is scheduled ("+p.ch_schedule+", timeout "+p.ch_timeout+"); the stops wait for the functions");}
// S14X-238: the claim, then the schedules.
const claim=fs.readFileSync("/tmp/vd_bm_claim.txt","utf8");let cj=null;try{cj=JSON.parse(claim)}catch{}
const code=cj&&typeof cj==="object"?String(cj.code??""):"";
if(code==="42501"){
  const n=cronOk?rows.filter((r)=>/^send-market-pulse/.test(r.ch_jobname)):null;
  if(n&&n.length===0)say("FAIL","S14X-238 the calendar-month claim exists but no send-market-pulse job is scheduled: no pulse goes at all");
  else if(n&&n.length>2)say("FAIL","S14X-238 "+n.length+" send-market-pulse jobs are scheduled ("+n.map((r)=>r.ch_jobname+" "+r.ch_schedule).join("; ")+")");
  else if(e.VDBM_SMPNEW!=="1"&&live)say("FAIL","S14X-238 the calendar-month claim exists but send-market-pulse does not serve 2026-11-12.1, so it never says when the next pulse comes");
  else if(e.VDBM_SMPNEW!=="1")say("INFO","S14X-238 the two-argument claim exists (anon refused, 42501); send-market-pulse waits for the paste");
  else say("PASS","S14X-238 the two-argument claim exists (anon refused, 42501), so one address gets one pulse a calendar month whichever of "+(n?n.map((r)=>r.ch_jobname).join(" and "):"the schedules")+" runs it"+(n&&n.length===2?" (the second schedule is the owner step C-S14-080, harmless now)":""));
}else if(code==="PGRST202"){
  if(live)say("FAIL","S14X-238 the paste is live but there is no market_pulse_claim_batch(p_limit, p_now): migration 20261112160000 did not apply, and the 28-day rule still sends two pulses in some months");
  else say("INFO","S14X-238 market_pulse_claim_batch takes p_limit alone yet (PGRST202 for p_now): the part-A paste has not landed");
}else if(code==="25006")say("FAIL","S14X-238 anon reached market_pulse_claim_batch: only the read-only transaction stopped it writing. Revoke EXECUTE from anon");
else say("FAIL","S14X-238 the claim probe answered "+claim.slice(0,160)+" (want 42501 for a two-argument claim anon may not run)");
// S14X-012 option A: a drain for transactional_emails.
const o=e.VDBM_O012;
if(o&&/^A/i.test(o)){
  const d=cronOk?rows.find((r)=>/transactional/i.test(r.ch_jobname)):null;
  if(d&&d.ch_last_status!=="failed"&&d.ch_timeout)say("PASS","S14X-012-mail decided ("+o+"): "+d.ch_jobname+" drains transactional_emails "+d.ch_schedule+" with statement_timeout "+d.ch_timeout);
  else if(d)say("FAIL","S14X-012-mail decided ("+o+"): "+d.ch_jobname+" is scheduled but "+(d.ch_timeout?"its last run failed":"carries no statement_timeout of its own"));
  else if(live)say("FAIL","S14X-012-mail decided ("+o+"): the paste is live but no job drains transactional_emails, so the fix-plan drip is still promised and never sent");
  else say("INFO","S14X-012-mail decided ("+o+"): no drain job yet; the paste has not landed");
}
'

# S14X-012-mail: option B, or pending.
if [ -z "$VDBM_O012" ]; then echo "INFO  S14X-012-mail owner pending: the fix-plan drip is promised and never sent; option A drains it, option B stops offering it (the owner decides; ownerDecided names S14X-012 when the integrator records it)"
elif printf '%s' "$VDBM_O012" | grep -qi '^B'; then
  VDBM_SSR=$(vdbm_build send-scan-report)
  if [ -z "$VDBM_SSR" ]; then echo "FAIL  S14X-012-mail decided ($VDBM_O012): send-scan-report's preflight carries no x-fn-build"
  elif vdbm_new send-scan-report "$VDBM_SSR"; then echo "PASS  S14X-012-mail decided ($VDBM_O012): send-scan-report serves $VDBM_SSR, which offers no fix-plan sequence and answers a press of an old button with withdrawn, queueing nothing"
  elif [ "$VDBM_LIVE" = 1 ]; then echo "FAIL  S14X-012-mail decided ($VDBM_O012): the paste is live but send-scan-report serves $VDBM_SSR, so the drip is still offered and never sent"
  else echo "INFO  S14X-012-mail decided ($VDBM_O012): send-scan-report serves $VDBM_SSR; the paste has not landed"; fi
elif ! printf '%s' "$VDBM_O012" | grep -qi '^A'; then echo "FAIL  S14X-012-mail ownerDecided names S14X-012 as '$VDBM_O012', which is neither option A nor option B"
fi

# The published app: the page's entry, the Account chunk (the three mail
# cards live in it) and the pulse confirm chunk.
curl -s -m 30 "$SITE/account" > /tmp/vd_bm_home.html
VDBM_MAIN=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_bm_home.html | head -1)
[ -n "$VDBM_MAIN" ] && curl -s -m 60 "$SITE$VDBM_MAIN" > /tmp/vd_bm_entry.js
VDBM_ACN=$( { [ -f /tmp/vd_bm_entry.js ] && grep -oE 'assets/Account-[A-Za-z0-9_-]+\.js' /tmp/vd_bm_entry.js; } | head -1 | sed 's#^assets/##')
VDBM_PCN=$( { [ -f /tmp/vd_bm_entry.js ] && grep -oE 'assets/MarketPulseConfirm-[A-Za-z0-9_-]+\.js' /tmp/vd_bm_entry.js; } | head -1 | sed 's#^assets/##')
[ -n "$VDBM_ACN" ] && curl -s -m 60 "$SITE/assets/$VDBM_ACN" > /tmp/vd_bm_account.js
[ -n "$VDBM_PCN" ] && curl -s -m 60 "$SITE/assets/$VDBM_PCN" > /tmp/vd_bm_pulse.js

VDBM_READ=yes
if [ -z "$VDBM_MAIN" ]; then VDBM_READ=no; echo "FAIL  F0 /account names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDBM_ACN" ] || ! grep -qF 'data-mail-card' /tmp/vd_bm_account.js 2>/dev/null; then VDBM_READ=no; echo "FAIL  F0 the entry $VDBM_MAIN names no Account chunk holding the Email preferences card (${VDBM_ACN:-none named}): the bundle layout moved, so the account page cannot be judged"
elif [ -z "$VDBM_PCN" ] || ! grep -qF 'pulseConfirm.' /tmp/vd_bm_pulse.js 2>/dev/null; then VDBM_READ=no; echo "FAIL  F0 the entry $VDBM_MAIN names no MarketPulseConfirm chunk holding the pulse confirm page (${VDBM_PCN:-none named}): the bundle layout moved"
fi

if [ "$VDBM_READ" = yes ]; then
  VDBM_FE=unpublished
  for VDBM_M in mailStopped 'digest_cadence:' data-cadence-select data-mail-stopped mailPrefs.newHeadlineCapped; do grep -qF "$VDBM_M" /tmp/vd_bm_account.js && VDBM_FE=published; done
  grep -qF 'data-next-pulse' /tmp/vd_bm_pulse.js && VDBM_FE=published
  grep -qF '"./shards/mail/' /tmp/vd_bm_entry.js && VDBM_FE=published
  echo "INFO  F0 reading $VDBM_ACN ($(wc -c < /tmp/vd_bm_account.js | tr -d ' ') bytes) and $VDBM_PCN: the lane's frontend is $VDBM_FE"

  # vdbm_mark KEY FILE MARK WHAT
  vdbm_mark() {
    if grep -qF "$3" "$2"; then echo "PASS  $1 $4 (the published chunk holds $3)"
    elif [ "$VDBM_FE" = published ]; then echo "FAIL  $1 the round's frontend published but the chunk holds no $3, so this is not true: $4"
    else echo "INFO  $1 the chunk holds no $3 yet: the round has not published ($4)"; fi
  }
  # S14X-107 judges both halves: the page reads it, the function answers it.
  if grep -qF 'mailStopped' /tmp/vd_bm_account.js && ! vdbm_new account-settings "$VDBM_ACS"; then
    echo "INFO  S14X-107 the Account chunk reads mailStopped, but account-settings serves ${VDBM_ACS:-none}, which never answers it: the card shows the switches as before until the paste"
  else vdbm_mark S14X-107 /tmp/vd_bm_account.js mailStopped "the Email preferences card says when an address is off our mail"; fi
  vdbm_mark RC-S13-083 /tmp/vd_bm_account.js 'digest_cadence:' "a saved search's daily or weekly rhythm can be changed where it is shown"
  vdbm_mark NB-21 /tmp/vd_bm_account.js mailPrefs.newHeadlineCapped "the new-postings headline says when a count is capped"
  vdbm_mark S14X-238 /tmp/vd_bm_pulse.js data-next-pulse "the confirm page says when the next pulse arrives"

  # S1: the English strings ride with the account page (the Account chunk or
  # a chunk it imports; the entry in a build from before the review); the
  # other eight load on demand, named by the entry.
  VDBM_KEYS="pulseDoneNextMonth pulseDoneLater stoppedUnsubscribe stoppedAccountDeleted stoppedBounce stoppedComplaint cadenceAria newHeadlineCapped"
  cat /tmp/vd_bm_entry.js /tmp/vd_bm_account.js > /tmp/vd_bm_en.js
  for VDBM_C in $(grep -oE '(from|import)"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bm_account.js | sed -E 's/^(from|import)"\.\/(.*)"$/\2/' | sort -u); do
    case "$VDBM_C" in index-*) continue;; esac
    rm -f /tmp/vd_bm_cand.js
    curl -s -m 30 "$SITE/assets/$VDBM_C" > /tmp/vd_bm_cand.js
    { echo; cat /tmp/vd_bm_cand.js; } >> /tmp/vd_bm_en.js
  done
  VDBM_SH=$(grep -oE '"\./shards/mail/[A-Za-z-]+\.json":\(\)=>[A-Za-z_$]+\(\(\)=>import\("\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bm_entry.js)
  VDBM_ENMISS=""
  for VDBM_KEY in $VDBM_KEYS; do grep -qF "$VDBM_KEY:" /tmp/vd_bm_en.js || VDBM_ENMISS="$VDBM_ENMISS en:$VDBM_KEY"; done
  if [ -z "$VDBM_SH" ]; then
    if [ "$VDBM_FE" = published ]; then echo "FAIL  S1 the round's account page published but the entry loads no mail shard, so its new sentences show as keys"
    else echo "INFO  S1 the entry loads no mail shard yet: not published yet"; fi
  else
    VDBM_MISS=""; VDBM_N=0
    while IFS= read -r VDBM_L; do
      [ -n "$VDBM_L" ] || continue
      VDBM_LNG=$(printf '%s' "$VDBM_L" | sed -E 's#.*shards/mail/([A-Za-z-]+)\.json.*#\1#')
      VDBM_SF=$(printf '%s' "$VDBM_L" | grep -oE '[A-Za-z0-9_-]+\.js"$' | tr -d '"')
      rm -f /tmp/vd_bm_shard.js
      curl -s -m 30 "$SITE/assets/$VDBM_SF" > /tmp/vd_bm_shard.js
      VDBM_N=$((VDBM_N + 1))
      for VDBM_KEY in $VDBM_KEYS; do grep -qF "$VDBM_KEY:" /tmp/vd_bm_shard.js || VDBM_MISS="$VDBM_MISS $VDBM_LNG:$VDBM_KEY"; done
    done <<< "$VDBM_SH"
    if [ -n "$VDBM_ENMISS" ]; then echo "FAIL  S1 the entry names $VDBM_N lazy mail shards but neither the Account chunk ($VDBM_ACN), a chunk it imports nor the entry carries the English strings:$VDBM_ENMISS"
    elif [ "$VDBM_N" -ne 8 ]; then echo "FAIL  S1 the entry names $VDBM_N non-English mail shards, not 8"
    elif [ -n "$VDBM_MISS" ]; then echo "FAIL  S1 mail shard strings missing:$VDBM_MISS"
    else echo "PASS  S1 the English mail strings ride with the account page ($VDBM_ACN or a chunk it imports) and the entry names 8 more languages, each with all 8 of the lane's strings"; fi
  fi

  # D9 (owner): an account lifts its own stop-all.
  if [ -z "$VDBM_OD9" ]; then echo "INFO  D9 owner pending: may an account with a proven mailbox lift its own stop-all? The card says the address is off our mail and offers no button until the owner says yes"
  elif printf '%s' "$VDBM_OD9" | grep -qiE '^(no|keep|notice|default)'; then echo "INFO  D9 decided ($VDBM_OD9): the notice alone, which S14X-107 judges"
  elif grep -qF 'mail_resume' /tmp/vd_bm_account.js && [ "$VDBM_ACSNEW" = 1 ]; then echo "PASS  D9 decided ($VDBM_OD9): the Account chunk asks account-settings mail_resume, which serves $VDBM_ACS"
  elif [ "$VDBM_FE" = published ] && [ "$VDBM_LIVE" = 1 ]; then echo "FAIL  D9 decided ($VDBM_OD9): the round published, but the Account chunk asks no mail_resume or account-settings serves ${VDBM_ACS:-none}"
  else echo "INFO  D9 decided ($VDBM_OD9): the button waits for the round to publish"; fi
fi

# S14X-234-verify: the notify subdomain's own DMARC record, the owner's DNS
# step. Until ownerDecided names S14X-234 the reading is INFO owner pending.
VDBM_O234=$(vdbm_decided S14X-234)
if ! command -v dig >/dev/null 2>&1; then echo "INFO  S14X-234-verify this machine has no dig, so _dmarc.notify.resumebooster.work cannot be read here"
else
  VDBM_DM=$(dig +short TXT _dmarc.notify.resumebooster.work 2>/dev/null | tr -d '"' | tr '\n' ' ')
  VDBM_APEX=$(dig +short TXT _dmarc.resumebooster.work 2>/dev/null | tr -d '"' | tr '\n' ' ')
  if printf '%s' "$VDBM_DM" | grep -qiE 'p=(quarantine|reject)'; then VDBM_DMV="PASS  S14X-234-verify _dmarc.notify says ${VDBM_DM% }"
  elif printf '%s' "$VDBM_DM" | grep -qi 'v=DMARC1'; then VDBM_DMV="FAIL  S14X-234-verify _dmarc.notify.resumebooster.work says '${VDBM_DM% }', which overrides the apex: mail forged from notify is delivered. The owner asks Lovable to set p=quarantine (with a report address) or remove the record"
  elif printf '%s' "$VDBM_APEX" | grep -qiE 'p=(quarantine|reject)'; then VDBM_DMV="PASS  S14X-234-verify no record at _dmarc.notify, so the apex's applies: ${VDBM_APEX% }"
  else VDBM_DMV="FAIL  S14X-234-verify no record at _dmarc.notify and the apex says '${VDBM_APEX% }': nothing tells a receiver to refuse mail forged from notify"; fi
  if [ -n "$VDBM_O234" ]; then echo "$VDBM_DMV"
  else echo "INFO  S14X-234-verify owner pending: ownerDecided does not name S14X-234 (the notify DMARC record is the owner's DNS step); dig reads: ${VDBM_DMV#?????  S14X-234-verify }"; fi
fi

echo "INFO  proven in the suite, never here (anon cannot read them): the run stamps mail-watch reads (job_board_meta mail_run:*), the saved-search column grants and the agent kick's clock (no read-only probe sees a column privilege or a trigger), the clip of a typed search name, the fit score read only from its owner's scan, a posting age counted in the reader's own day, and what mail-lists-prune deletes. Owner read-only SQL after the paste: SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'market_pulse_claim_batch' -- one row, 'p_limit integer, p_now timestamp with time zone'"
