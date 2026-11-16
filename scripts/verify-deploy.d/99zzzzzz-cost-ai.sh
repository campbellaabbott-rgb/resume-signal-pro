# shellcheck shell=bash
# ── 99zzzzzz. COST AUDIT 2026-11-08, LANE AI (branch cost/ai): the model
# endpoints nothing called are retired, the full warm-up is the owner's, the
# board's search parse has eight seconds and a memory, the free tools fall
# back to the cheap models, and every parsed reply logs its token counts.
#
# THE CLAIMS, one line each below:
#   - the 28 functions whose code moved (directly, or through
#     _shared/ai-fallback.ts) serve this lane's build or later. Before the
#     deploy no function serves it, and the section says so in INFO lines;
#     once any of the 28 does, every one left behind is a FAIL;
#   - each of the seven retired endpoints answers 410 code "retired", and
#     nothing else, once its retired build serves;
#   - warm-up answers a full warm-up asked with the publishable key 200,
#     success false, admin_key_required, with nothing warmed (not 401: the
#     keyless warm-up cron would leave a refusal in pg_net every ten minutes,
#     which scan-heartbeat and mail-watch R9 count), a target off its list
#     400 unknown_target, and its preflight allows the x-admin-key header;
#   - the preflights of warm-up, nl-search, the product preview, the
#     screening answers and the profile importer carry
#     Access-Control-Max-Age 7200 through the platform's gateway.
# Not provable from outside without a model call, so proved in the suite
# (the INFO lines at the end name the tests): nl-search's eight seconds, its
# chain and its memory; the free tools' chain; the usage line's content.
#
# READ-ONLY. Preflights run no function logic. A function is POSTed only once
# its preflight shows this lane's build, which answers each of these requests
# before it counts, reads, writes or invokes anything: a retired endpoint
# reads nothing at all, and the warm-up answers before its first invocation.
# An older warm-up would invoke every function on its list, and an older
# retired endpoint would spend a model call, so neither is ever asked.
echo "INFO  == 99zzzzzz. cost audit, lane ai: retired endpoints, the owner's warm-up, the search parse's eight seconds, the free tools' chain, the usage line =="

# fn|day|n: the cost wave's build of each function: this lane's, or the
# integration's next sequence where another lane stamped the same build on
# code of its own (fix/cost-wave; DEPLOY-LEDGER §3).
VDCA_WANT="warm-up|2026-11-09|2 nl-search|2026-11-09|1 generate-product-preview|2026-11-09|1
generate-application-answers|2026-11-10|2 import-freelance-profile|2026-11-10|2
generate-summary|2026-11-09|1 generate-resume-roast|2026-11-09|1 generate-recruiter-view|2026-11-09|1
generate-elevator-pitch|2026-11-09|1 analyze-linkedin-profile|2026-11-09|1
generate-cover-letter-stream|2026-11-10|2 generate-premium-package-stream|2026-11-10|2
admin-regenerate-delivery|2026-11-09|1 analyze-resume|2026-11-10|4 free-keyword-scan|2026-11-09|2
generate-apply-package|2026-11-10|4 generate-ats-defense|2026-11-10|3 generate-career-path|2026-11-10|3
generate-career-snapshot|2026-11-10|3 generate-cover-letter|2026-11-09|2 generate-freelance-boost|2026-11-10|3
generate-graduate-gameplan|2026-11-10|3 generate-interview-coach|2026-11-10|3 generate-keyword-fix|2026-11-10|3
generate-premium-package|2026-11-10|3 generate-tailored-resume|2026-11-09|2 parse-resume-structured|2026-11-09|2
test-ai-fallback|2026-11-10|3"
VDCA_RETIRED="generate-summary generate-resume-roast generate-recruiter-view generate-elevator-pitch analyze-linkedin-profile generate-cover-letter-stream generate-premium-package-stream"

vdca_hdr() { # $1 fn, $2 header name -> its value from the saved preflight
  tr -d '\r' < "/tmp/vd_ca_hdr_$1" 2>/dev/null | grep -i "^$2:" | head -1 | sed -E 's/^[^:]+: *//'
}

vdca_carries() { # $1 fn -> what this lane's build of it carries
  case "$1" in
    warm-up) echo "the full warm-up answers only the owner's key, our servers or the cron key";;
    nl-search) echo "the parse inside eight seconds, today's model then gpt-5-mini, a sentence parsed once per isolate";;
    generate-application-answers|import-freelance-profile) echo "flash, then gpt-5-mini after a failure, never pro";;
    generate-product-preview) echo "flash, then gpt-5-mini after a failure, never pro; retired to a bare 410 by the bug round (NB-10, judged in 99zzzzzzz-bugs-writing-tools.sh), never any model";;
    generate-summary|generate-resume-roast|generate-recruiter-view|generate-elevator-pitch|analyze-linkedin-profile|generate-cover-letter-stream|generate-premium-package-stream) echo "retired: answers 410 and calls nothing";;
    *) echo "the shared helper's numbers-only usage line; its own code is unchanged";;
  esac
}

VDCA_NEW=" "
VDCA_SEEN=""
for VDCA_P in $VDCA_WANT; do
  VDCA_FN=${VDCA_P%%|*}; VDCA_R=${VDCA_P#*|}; VDCA_D=${VDCA_R%%|*}; VDCA_N=${VDCA_R#*|}
  rm -f "/tmp/vd_ca_hdr_$VDCA_FN"
  curl -s -m 30 -D "/tmp/vd_ca_hdr_$VDCA_FN" -o /dev/null -X OPTIONS "$B/functions/v1/$VDCA_FN" -H "apikey: $K" -H "Authorization: Bearer $K"
  VDCA_H=$(vdca_hdr "$VDCA_FN" x-fn-build)
  VDCA_SEEN="$VDCA_SEEN$VDCA_FN=$VDCA_H=$VDCA_D.$VDCA_N
"
  if [ -n "$VDCA_H" ] && build_ge "$VDCA_FN" "$VDCA_H" "$VDCA_D" "$VDCA_N"; then VDCA_NEW="$VDCA_NEW$VDCA_FN "; fi
done

if [ "$VDCA_NEW" = " " ]; then
  printf '%s' "$VDCA_SEEN" | while IFS='=' read -r VDCA_FN VDCA_H VDCA_B; do
    [ -n "$VDCA_FN" ] || continue
    if [ -z "$VDCA_H" ]; then echo "FAIL  $VDCA_FN preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
    else echo "INFO  $VDCA_FN preflight x-fn-build = $VDCA_H: this lane ($VDCA_FN.$VDCA_B) is not deployed yet, so nothing of it is asked"; fi
  done
else
  printf '%s' "$VDCA_SEEN" | while IFS='=' read -r VDCA_FN VDCA_H VDCA_B; do
    [ -n "$VDCA_FN" ] || continue
    case "$VDCA_NEW" in
      *" $VDCA_FN "*) echo "PASS  $VDCA_FN preflight x-fn-build = $VDCA_H ($VDCA_FN.$VDCA_B or later: $(vdca_carries "$VDCA_FN"))";;
      *) if [ -z "$VDCA_H" ]; then echo "FAIL  $VDCA_FN preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
         else echo "FAIL  $VDCA_FN preflight x-fn-build = $VDCA_H: the deploy put this lane's build on other functions and left this one behind (want $VDCA_FN.$VDCA_B or later: $(vdca_carries "$VDCA_FN"))"; fi;;
    esac
  done
fi

vdca_post() { # $1 fn, $2 body -> "<json>\n<status>"
  curl -s -m 30 -w '\n%{http_code}' -X POST "$B/functions/v1/$1" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$2"
}

vdca_answers() { # $1 fn, $2 body, $3 status wanted, $4 code wanted, $5 what the line claims
  case "$VDCA_NEW" in
    *" $1 "*) ;;
    *) echo "INFO  $1 was not asked: this lane's build is not serving (the line above), and an older bundle would do the work this line proves it refuses"; return;;
  esac
  vdca_post "$1" "$2" | VDCA_FN="$1" VDCA_WANT="$3" VDCA_CODE="$4" VDCA_CLAIM="$5" node -e '
let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
  const lines=s.split("\n");const code=lines.pop();const raw=lines.join("\n");
  const fn=process.env.VDCA_FN,want=process.env.VDCA_WANT,wantCode=process.env.VDCA_CODE,claim=process.env.VDCA_CLAIM;
  let j=null;try{j=JSON.parse(raw)}catch{}
  const why=[];
  if(code!==want)why.push("HTTP "+code);
  if(!j||typeof j!=="object"||Array.isArray(j))why.push("no JSON body");
  else{
    if(j.code!==wantCode)why.push("code "+JSON.stringify(j.code));
    if(want==="200"&&j.success!==false)why.push("success "+JSON.stringify(j.success));
    for(const k of Object.keys(j))if(!["error","code","success"].includes(k))why.push("it carries "+k);
  }
  if(why.length)console.log("FAIL  "+fn+" does not answer as "+claim+": "+why.join("; ")+" -- "+raw.slice(0,200));
  else console.log("PASS  "+fn+" answers "+code+" "+wantCode+" ("+claim+"): "+JSON.stringify(String(j.error??"").slice(0,90)));
});'
}

for VDCA_FN in $VDCA_RETIRED; do
  vdca_answers "$VDCA_FN" '{}' 410 retired "retired, nothing read or called"
done
vdca_answers warm-up '{}' 200 admin_key_required "a full warm-up asked with the publishable key, nothing warmed, and no refusal status for the monitors to count"
vdca_answers warm-up '{"target":"verifier-probe-not-a-function"}' 400 unknown_target "a target off the list warms nothing"

case "$VDCA_NEW" in
  *" warm-up "*)
    VDCA_ALLOW=$(vdca_hdr warm-up access-control-allow-headers)
    case ",$(printf '%s' "$VDCA_ALLOW" | tr 'A-Z' 'a-z' | tr -d ' ')," in
      *",x-admin-key,"*) echo "PASS  warm-up preflight allows x-admin-key: $VDCA_ALLOW";;
      *) echo "FAIL  warm-up preflight does not allow x-admin-key, so the owner's page cannot send the key as a header: '$VDCA_ALLOW'";;
    esac;;
  *) echo "INFO  warm-up's preflight headers are judged once this lane's build serves";;
esac

for VDCA_FN in warm-up nl-search generate-product-preview generate-application-answers import-freelance-profile; do
  case "$VDCA_NEW" in
    *" $VDCA_FN "*)
      VDCA_AGE=$(vdca_hdr "$VDCA_FN" access-control-max-age)
      if [ "$VDCA_AGE" = "7200" ]; then echo "PASS  $VDCA_FN preflight carries Access-Control-Max-Age 7200: a browser asks once per two hours"
      else echo "FAIL  $VDCA_FN preflight carries Access-Control-Max-Age '${VDCA_AGE}', not 7200: the header is not serving, or the platform's gateway drops it"; fi;;
    *) echo "INFO  $VDCA_FN's Access-Control-Max-Age is judged once this lane's build serves";;
  esac
done

echo "INFO  nl-search's eight seconds (504 timedOut, the model request stopped), its chain (today's model, then gpt-5-mini) and its bounded memory (no count, no model call on a repeat) are proved in src/test/the-board-search-parse-answers-inside-eight-seconds-and-once-per-sentence.test.ts: a live probe would spend a model call"
echo "INFO  the free tools' chain (flash, then gpt-5-mini, never pro, after the spend gate) is proved in src/test/a-free-tool-falls-back-to-flash-then-gpt-5-mini-never-to-pro.test.ts; the usage line's content in src/test/the-ai-usage-line-carries-numbers-and-identifiers-only.test.ts. In the function logs, search [AI-USAGE] for the first measured token counts (every function that parses a model reply itself prints one, src/test/every-function-that-reads-a-model-reply-itself-prints-its-usage-line.test.ts); a backup-scanner analysis line whose counts are all '-' carries none, because its streamed request asks for none"
echo "INFO  OWNER STEP: the scheduled job warm-up-edge-functions (every 10 minutes, created outside the migrations) warms nothing once this build serves, unless its command sends the service-role key or the x-email-cron key: it is answered 200 with success false (so pg_net records no refusal and neither scan-heartbeat nor mail-watch R9 turns red), and still costs 144 warm-up invocations a day. In the SQL editor, SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'warm-up-edge-functions', then unschedule it (the audit measured at most ~90 ms of warming gain) or give it a key to keep warming. The scan button's warm of one named function needs neither"
echo "INFO  the /health-check page's Warm Up button sends the stored admin key as the body's adminKey from this merge on (src/test/the-health-pages-warm-up-hands-the-owners-key-in-the-body.test.tsx); without a stored key this build answers success false and the page shows no warm-up"
