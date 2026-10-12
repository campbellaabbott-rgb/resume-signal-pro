# shellcheck shell=bash
# ── 93. WAVE 4, RETIRE: the server-side apply agent is switched off, and the
# Agent plan and the Agent Pass are no longer sold (owner decision 2026-10-11,
# the apply pivot; branch w4/retire).
#
# THE CLAIMS, one line each below:
#   - the seven functions serve 2026-10-11.13 or later: the two checkouts,
#     agent-pass-status, agent-access, apply-agent, apply-broker, agent-runner;
#   - create-agent-checkout and create-pass-checkout answer a purchase with
#     410 product_retired: the sentence says nothing was charged and names
#     applying yourself, in the buyer's language, links /agents, and carries no
#     Stripe url;
#   - create-product-checkout serves 2026-10-11.1 or later and answers a
#     purchase of the Apply Assistant (one row of its shared product table,
#     wired by the wave-4 integration) with the same 410;
#   - 20261011130000 applied: get_cron_health lists neither apply-agent-hourly
#     nor agent-runner-nightly, while agent-queue-retention (left on purpose)
#     is still listed in the same read;
#   - the apply worker's workflow on main has workflow_dispatch and no schedule;
#   - what no read here can prove is INFO: the switched-off answers behind the
#     maintenance key and the worker secret, and the Stripe steps for buyers.
#
# READ-ONLY. Preflights run no function logic. Each checkout is POSTed only
# once its preflight shows the retired build, which answers before reading the
# token, the rate limiter or Stripe; an older bundle is never asked. The cron
# read is the anon aggregate section 7m already calls (no command, no message).
echo "== 93. wave 4 retire: the apply agent is off, the Agent plan and the Agent Pass are not sold, the agent's schedules are gone =="

vd93_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}

VD93_LIVE=" "
for VD93_FN in create-agent-checkout create-pass-checkout agent-pass-status agent-access apply-agent apply-broker agent-runner; do
  VD93_H=$(vd93_build "$VD93_FN")
  if [ -z "$VD93_H" ]; then echo "FAIL  $VD93_FN preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
  elif build_ge "$VD93_FN" "$VD93_H" "2026-10-11" "13"; then echo "PASS  $VD93_FN preflight x-fn-build = $VD93_H ($VD93_FN.2026-10-11.13 or later: the retired build)"; VD93_LIVE="$VD93_LIVE$VD93_FN "
  else echo "FAIL  $VD93_FN preflight x-fn-build = $VD93_H (want $VD93_FN.2026-10-11.13 or later: the agent is still on, or its product still sold, in the bundle serving)"; fi
done
# The Apply Assistant's checkout is the shared product checkout, stamped by the
# integration rather than the retire branch, so its floor is its own.
VD93_H=$(vd93_build create-product-checkout)
if [ -z "$VD93_H" ]; then echo "FAIL  create-product-checkout preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
elif build_ge create-product-checkout "$VD93_H" "2026-10-11" "1"; then echo "PASS  create-product-checkout preflight x-fn-build = $VD93_H (create-product-checkout.2026-10-11.1 or later: the Apply Assistant is retired)"; VD93_LIVE="${VD93_LIVE}create-product-checkout "
else echo "FAIL  create-product-checkout preflight x-fn-build = $VD93_H (want create-product-checkout.2026-10-11.1 or later: the Apply Assistant is still sold in the bundle serving)"; fi

vd93_buy() { # $1 fn, $2 product, $3 body, $4 Accept-Language, $5 expected language, $6 a phrase of that language's free sentence
  case "$VD93_LIVE" in
    *" $1 "*) ;;
    *) echo "INFO  $1 was not asked to sell: its retired build is not serving (the line above), and an older bundle would reach its purchase code"; return;;
  esac
  local out
  out=$(curl -s -m 30 -w '\n%{http_code}' -X POST "$B/functions/v1/$1" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -H "Accept-Language: $4" -d "$3")
  printf '%s' "$out" | VD93_FN="$1" VD93_PRODUCT="$2" VD93_LANG="$5" VD93_PHRASE="$6" node -e '
let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
  const lines=s.split("\n");const code=lines.pop();const raw=lines.join("\n");
  const {VD93_FN:fn,VD93_PRODUCT:product,VD93_LANG:lang,VD93_PHRASE:phrase}=process.env;
  let j=null;try{j=JSON.parse(raw)}catch{}
  const why=[];
  if(code!=="410")why.push("HTTP "+code);
  if(!j||typeof j!=="object"){why.push("no JSON body");}
  else{
    if(j.retired!==true)why.push("retired is "+JSON.stringify(j.retired));
    if(j.reason!=="product_retired")why.push("reason "+JSON.stringify(j.reason));
    if(j.product!==product)why.push("product "+JSON.stringify(j.product)+" (want "+product+")");
    if(j.language!==lang)why.push("language "+JSON.stringify(j.language)+" (want "+lang+")");
    if(typeof j.error!=="string"||!j.error.includes(phrase))why.push("the sentence lacks \""+phrase+"\"");
    if(typeof j.error==="string"&&!/resumebooster\.work\/agents/.test(j.error))why.push("the sentence names no /agents");
    if(typeof j.applyYourself!=="string"||!/^https:\/\/[^/]+\/agents$/.test(j.applyYourself))why.push("applyYourself "+JSON.stringify(j.applyYourself));
    if("url" in j)why.push("it carries a Stripe url");
  }
  if(why.length)console.log("FAIL  "+fn+" did not refuse the purchase as retired: "+why.join("; ")+" -- "+raw.slice(0,200));
  else console.log("PASS  "+fn+" answers a purchase 410 product_retired in "+lang+", naming applying yourself and "+j.applyYourself+", with no Stripe session");
});'
}
vd93_buy create-agent-checkout agent_plan '{"language":"de"}' "en" de "Selbst bewerben ist kostenlos"
vd93_buy create-pass-checkout agent_pass '{}' "nl-NL,nl;q=0.9" nl "Zelf solliciteren is gratis"
vd93_buy create-product-checkout apply_assistant '{"productId":"applyAssistant","language":"fr"}' "en" fr "Postuler vous-même est gratuit"

R get_cron_health '{"p_hours":24}' > /tmp/vd_93_cron.json
node -e '
const fs=require("fs");let rows=null;try{rows=JSON.parse(fs.readFileSync("/tmp/vd_93_cron.json","utf8"))}catch{}
if(!Array.isArray(rows)||rows.length===0){console.log("INFO  get_cron_health unreadable or empty ("+JSON.stringify(rows).slice(0,140)+"): the agent schedules cannot be judged here (section 7m reads the same function)");process.exit(0)}
const names=new Set(rows.map((r)=>r&&r.ch_jobname));
if(!names.has("agent-queue-retention")){console.log("INFO  get_cron_health ("+rows.length+" jobs) does not list agent-queue-retention either, which 20261011130000 leaves alone, so a missing agent job proves nothing here");process.exit(0)}
console.log("INFO  agent-queue-retention is still scheduled (left on purpose: it expires and prunes the queue nothing fills now)");
for(const [job,what] of [["apply-agent-hourly","apply-agent every hour at :23"],["agent-runner-nightly","agent-runner at 06:10 UTC"]]){
  if(names.has(job))console.log("FAIL  pg_cron still runs "+job+" ("+what+"): 20261011130000 has not applied");
  else console.log("PASS  "+job+" ("+what+") is unscheduled: 20261011130000 applied, read beside agent-queue-retention in the same list of "+rows.length+" jobs");
}'

VD93_WF=$(curl -s -m 30 "https://raw.githubusercontent.com/campbellaabbott-rgb/resume-signal-pro/main/.github/workflows/apply-worker.yml")
printf '%s' "$VD93_WF" | node -e '
let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
  if(!/^name:\s*Apply worker\s*$/m.test(s)){console.log("INFO  the apply worker workflow on main could not be read ("+s.length+" bytes): its triggers are not judged here");return}
  const code=s.split("\n").filter((l)=>!/^\s*#/.test(l)).join("\n");
  const scheduled=/^\s*schedule\s*:/m.test(code)||/^\s*-\s*cron\s*:/m.test(code);
  const byHand=/^\s*workflow_dispatch\s*:/m.test(code);
  if(scheduled)console.log("FAIL  the apply worker workflow on main still starts on a schedule: Actions keeps running the worker");
  else if(!byHand)console.log("FAIL  the apply worker workflow on main has no workflow_dispatch: the owner can no longer start it by hand");
  else console.log("PASS  the apply worker workflow on main starts only by hand (workflow_dispatch, no schedule)");
});'

J '{"action":"status"}' > /tmp/vd_93_status.json
node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_93_status.json","utf8"))}catch{}
const a=j&&j.applyAgent;const r=j&&j.agentRunner;
console.log("INFO  job-board status applyAgent: lastRunAt "+(a?a.lastRunAt:"?")+", lastCronAt "+(a?a.lastCronAt:"?")+", cronAgeMin "+(a?a.cronAgeMin:"?")+", scheduleProven "+(a?a.scheduleProven:"?")+" -- from this deploy scheduleProven reads false and cronAgeMin only grows: a switched-off run writes no stamp, so the last real run stays shown");
console.log("INFO  job-board status agentRunner: lastRunAt "+(r?r.lastRunAt:"?")+", lastCronAt "+(r?r.lastCronAt:"?")+" -- it stops advancing from this deploy for the same reason");'

echo "INFO  not provable from here (each needs a secret this run does not hold): an authorised apply-agent or agent-runner run answers switchedOff:true; apply-broker claim answers packet null and ping records no heartbeat; agent-access approve and retry answer 409 agent_switched_off; agent-access and agent-pass-status status reads carry agentSwitchedOff:true for a buyer"
echo "INFO  owner, in Stripe: (1) list active subscriptions at 99 USD a month named Resume Booster Apply Agent, and every paid checkout session whose metadata product_type is agent_pass or apply_assistant; (2) honour or refund each, and cancel each subscription at period end or now with a prorated refund; (3) expire any checkout session still open for the three products (they live 24 hours and a payment on one still grants); (4) there is no dashboard Price to archive: all three bill inline price_data, so archive only any Product the catalogue lists under those names"
