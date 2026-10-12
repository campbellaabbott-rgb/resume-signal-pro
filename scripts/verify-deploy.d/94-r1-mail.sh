# shellcheck shell=bash
# ── 94. R1 MAIL (critical-path R1, plan group CP-A). Sourced by
# scripts/verify-deploy.sh just before "done."; $B $K $SITE $UA and the helpers
# J R probe build_ge are in scope.
#
# READ-ONLY. DNS is read over DNS-over-HTTPS (dns.google). Builds are read from
# OPTIONS preflights. get_cron_health is read with a GET (PostgREST runs it in
# a read-only transaction). The two POSTs write nothing on the build they are
# sent to, and are sent only once that build serves: an unsigned event to
# resend-webhook (refused before any database access: 503 while
# RESEND_WEBHOOK_SECRET is unset, 401 once it is), and the publishable key to
# process-email-queue (refused 403 before any database access: the drain
# answers the service role and the cron key only).
echo "== 94. R1 mail: the sending DNS, the hook/queue/webhook builds, the drain job, the anon refusals =="

vd94_dns() { curl -s -m 20 "https://dns.google/resolve?name=$1&type=$2" -H 'accept: application/dns-json'; }

# The DNS lines: SPF on Resend's return path (every include must resolve), the
# Resend DKIM key, DMARC, and Lovable's notify delegation and verification.
VD94_SEND=$(vd94_dns send.resumebooster.work TXT)
VD94_SPF_INCLUDES=$(printf '%s' "$VD94_SEND" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const t=(j.Answer||[]).map(a=>String(a.data||"").replace(/^"|"$/g,"").replace(/" "/g,"")).find(x=>/^v=spf1\b/i.test(x))||"";process.stdout.write((t?"SPF "+t:"NOSPF")+"\n");for(const m of t.matchAll(/\binclude:([^\s]+)/gi))console.log(m[1])}catch{console.log("UNREADABLE")}})')
VD94_SPF=$(printf '%s\n' "$VD94_SPF_INCLUDES" | head -1)
case "$VD94_SPF" in
  "SPF "*)
    VD94_BAD=""
    for INC94 in $(printf '%s\n' "$VD94_SPF_INCLUDES" | tail -n +2); do
      ST94=$(vd94_dns "$INC94" TXT | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const ok=j.Status===0&&(j.Answer||[]).some(a=>/v=spf1/i.test(String(a.data||"")));console.log(ok?"OK":"STATUS"+j.Status)}catch{console.log("UNREADABLE")}})')
      [ "$ST94" = "OK" ] || VD94_BAD="$VD94_BAD $INC94($ST94)"
    done
    if [ -n "$VD94_BAD" ]; then echo "FAIL  send.resumebooster.work SPF includes a name with no SPF record:$VD94_BAD (a permerror; OWNER: set the TXT 'send' to v=spf1 include:amazonses.com ~all, then re-verify in Resend). Record: ${VD94_SPF#SPF }"
    else echo "PASS  send.resumebooster.work SPF resolves through every include: ${VD94_SPF#SPF }"; fi;;
  *) echo "FAIL  send.resumebooster.work has no SPF TXT record ($VD94_SPF): Resend's return path fails SPF";;
esac

vd94_has() { vd94_dns "$1" "$2" | node -e 'const re=new RegExp(process.argv[1],"i");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const a=(j.Answer||[]).map(x=>String(x.data||"")).filter(x=>re.test(x));console.log(a.length?"YES "+a[0].slice(0,90):"NO status "+j.Status)}catch{console.log("NO unreadable")}})' "$3"; }
for P94 in 'resend._domainkey.resumebooster.work|TXT|p=|Resend DKIM key' \
           '_dmarc.resumebooster.work|TXT|^"?v=DMARC1|DMARC policy' \
           'notify.resumebooster.work|NS|lovable\.cloud|notify delegated to Lovable' \
           '_lovable.resumebooster.work|TXT|lovable_verify=|Lovable domain verification'; do
  N94=${P94%%|*}; R94=${P94#*|}; T94=${R94%%|*}; R94=${R94#*|}; RE94=${R94%%|*}; WHAT94=${R94#*|}
  A94=$(vd94_has "$N94" "$T94" "$RE94")
  case "$A94" in YES*) echo "PASS  $WHAT94: $N94 $T94 ${A94#YES }";; *) echo "FAIL  $WHAT94: $N94 $T94 missing (${A94#NO })";; esac
done

# Builds: each R1 mail function names .2026-10-14.1 or later in its preflight.
VD94_PEQ=0; VD94_RW=0
for FN94 in auth-email-hook process-email-queue resend-webhook; do
  H94=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN94" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$H94" ]; then echo "FAIL  $FN94 preflight carries no x-fn-build (want $FN94.2026-10-14.1 or later; a new function answers 404 until it is deployed)"
  elif build_ge "$FN94" "$H94" 2026-10-14 1; then echo "PASS  $FN94 x-fn-build = $H94 (2026-10-14.1 or later)"
    [ "$FN94" = process-email-queue ] && VD94_PEQ=1; [ "$FN94" = resend-webhook ] && VD94_RW=1
  else echo "FAIL  $FN94 x-fn-build = $H94 (want $FN94.2026-10-14.1 or later)"; fi
done

# The drain job (20261014100000 schedules it only where no job of that name exists).
curl -s -m 60 "$B/rest/v1/rpc/get_cron_health?p_hours=1" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_94_cron.json
node -e '
const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync("/tmp/vd_94_cron.json","utf8"))}catch{j=null}
if(!Array.isArray(j)){console.log("INFO  get_cron_health unreadable: "+JSON.stringify(j).slice(0,140));process.exit(0)}
const q=j.find((x)=>x.ch_jobname==="process-email-queue");
if(!q){console.log("FAIL  no process-email-queue cron job: queued sign-in mail is never sent (20261014100000 not applied, or the job was removed)");process.exit(0)}
const ok=q.ch_active&&Number(q.ch_runs)>0&&Number(q.ch_failed)===0;
console.log((ok?"PASS":"FAIL")+"  process-email-queue cron: schedule "+JSON.stringify(q.ch_schedule)+", active "+q.ch_active+", runs "+q.ch_runs+"/1h, failed "+q.ch_failed+", last "+q.ch_last_status+" (want active, runs > 0, failed 0; a failed run with mail waiting means the vault holds neither key)");'

# The stuck count: email_delivery_health is service-role only since 20261004110000,
# so no anonymous reader of it exists. Prove it stays closed; the count itself is
# read by scan-heartbeat (owner side).
probe email_delivery_health '{"p_hours":1}'
echo "INFO  email_delivery_health's stuck count has no anon-readable reader (service role only); scan-heartbeat reads it. resend-webhook stamps delivered/delayed on the sent row so a delivered mail never reads as stuck"

# The anon refusals, sent only to the new builds.
if [ "$VD94_RW" = 1 ]; then
  C94=$(curl -s -m 30 -o /tmp/vd_94_rw.json -w '%{http_code}' -X POST "$B/functions/v1/resend-webhook" -H "Content-Type: application/json" -d '{"type":"email.delivered","data":{"email_id":"vd94-probe"}}')
  case "$C94" in
    401) echo "PASS  resend-webhook refuses an unsigned event with 401 (RESEND_WEBHOOK_SECRET is set)";;
    503) echo "INFO  resend-webhook answers 503: RESEND_WEBHOOK_SECRET is not set, so every event is refused (OWNER: add the Resend webhook endpoint and copy its signing secret into RESEND_WEBHOOK_SECRET)";;
    *) echo "FAIL  resend-webhook answered an unsigned event with HTTP $C94: $(head -c 160 /tmp/vd_94_rw.json) (want 401, or 503 while the secret is unset)";;
  esac
else
  echo "INFO  resend-webhook is not serving 2026-10-14.1: the unsigned-event probe is not sent"
fi
if [ "$VD94_PEQ" = 1 ]; then
  C94=$(curl -s -m 30 -o /tmp/vd_94_peq.json -w '%{http_code}' -X POST "$B/functions/v1/process-email-queue" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{}')
  [ "$C94" = "403" ] && echo "PASS  process-email-queue refuses the publishable key without the cron key (403, before the queue is read)" \
    || echo "FAIL  process-email-queue answered the publishable key with HTTP $C94: $(head -c 160 /tmp/vd_94_peq.json) (want 403)"
else
  echo "INFO  process-email-queue is not serving 2026-10-14.1: the anon refusal probe is not sent"
fi
