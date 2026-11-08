# shellcheck shell=bash
# ── 99zzzzzz. S14 HOTFIX, LANE SPEND (branch hotfix/spend): no signed-out
# stranger spends a model call through the screening answers, the freelance
# profile importer or the AI diagnostic, and a purchase claim opens only the
# product it bought.
#
# THE CLAIMS, one line each below:
#   - the thirteen functions whose code moved serve 2026-11-10.1 or later:
#     generate-application-answers (M-S14-009), import-freelance-profile
#     (M-S14-058), test-ai-fallback (M-S14-056), and the ten that bundle
#     _shared/paid-session.ts, which now refuses an unnamed claim unless it
#     may be an older buyer's (M-S14-057). Before the deploy no function
#     serves it, and the section says so in INFO lines; once any of the
#     thirteen does, every one left behind is a FAIL;
#   - generate-application-answers answers a visitor with the publishable
#     key 401 sign_in_required, and drafts nothing;
#   - import-freelance-profile answers a caller with no purchase 402
#     requiresPurchase, and extracts nothing;
#   - test-ai-fallback answers a caller with no admin key 401, runs no model,
#     and its preflight allows the x-admin-key header.
# Not provable from outside, so proved in the suite: who passes each gate (a
# signed-in session, our servers, a Freelance Boost claim or Pro grant, the
# owner's key), the unnamed-claim rule, and 20261110140000's naming. That
# migration's counts are kept where only the service role reads them; the
# INFO line at the end says where.
#
# READ-ONLY. Preflights run no function logic. A function is POSTed only once
# its preflight shows this lane's build, which refuses each of these callers
# before it counts, reads or writes anything: the answers before the spend
# gate, the importer before any lookup (no session is sent), the diagnostic
# before its limiter. An older bundle would spend a model call, so it is
# never asked.
echo "== 99zzzzzz. S14 hotfix, spend: the answers, the profile importer and the AI diagnostic refuse a stranger; a claim opens only what it bought =="

VDSP_FNS="generate-application-answers import-freelance-profile test-ai-fallback generate-apply-package generate-ats-defense generate-career-path generate-career-snapshot generate-cover-letter-stream generate-graduate-gameplan generate-interview-coach generate-keyword-fix generate-premium-package generate-premium-package-stream"
VDSP_NEW=" "
VDSP_SEEN=""
for VDSP_FN in $VDSP_FNS; do
  rm -f "/tmp/vd_sp_hdr_$VDSP_FN"
  curl -s -m 30 -D "/tmp/vd_sp_hdr_$VDSP_FN" -o /dev/null -X OPTIONS "$B/functions/v1/$VDSP_FN" -H "apikey: $K" -H "Authorization: Bearer $K"
  VDSP_H=$(tr -d '\r' < "/tmp/vd_sp_hdr_$VDSP_FN" 2>/dev/null | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  VDSP_SEEN="$VDSP_SEEN$VDSP_FN=$VDSP_H
"
  if [ -n "$VDSP_H" ] && build_ge "$VDSP_FN" "$VDSP_H" "2026-11-10" "1"; then VDSP_NEW="$VDSP_NEW$VDSP_FN "; fi
done

vdsp_carries() { # $1 fn -> what its 2026-11-10.1 build carries
  case "$1" in
    generate-application-answers) echo "screening answers for a website session or our servers only";;
    import-freelance-profile) echo "imports only for a Freelance Boost purchase";;
    test-ai-fallback) echo "the diagnostic answers only the admin key or our servers";;
    *) echo "the purchase gate that refuses an unnamed claim unless it may be an older buyer's";;
  esac
}

if [ "$VDSP_NEW" = " " ]; then
  printf '%s' "$VDSP_SEEN" | while IFS='=' read -r VDSP_FN VDSP_H; do
    [ -n "$VDSP_FN" ] || continue
    if [ -z "$VDSP_H" ]; then echo "FAIL  $VDSP_FN preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
    else echo "INFO  $VDSP_FN preflight x-fn-build = $VDSP_H: this lane (2026-11-10.1) is not deployed yet, so its refusals are not asked"; fi
  done
else
  printf '%s' "$VDSP_SEEN" | while IFS='=' read -r VDSP_FN VDSP_H; do
    [ -n "$VDSP_FN" ] || continue
    case "$VDSP_NEW" in
      *" $VDSP_FN "*) echo "PASS  $VDSP_FN preflight x-fn-build = $VDSP_H ($VDSP_FN.2026-11-10.1 or later: $(vdsp_carries "$VDSP_FN"))";;
      *) if [ -z "$VDSP_H" ]; then echo "FAIL  $VDSP_FN preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
         else echo "FAIL  $VDSP_FN preflight x-fn-build = $VDSP_H: the deploy put 2026-11-10.1 on other functions of this lane and left this one behind (want $VDSP_FN.2026-11-10.1 or later: $(vdsp_carries "$VDSP_FN"))"; fi;;
    esac
  done
fi

vdsp_post() { # $1 fn, $2 body -> "<json>\n<status>"
  curl -s -m 30 -w '\n%{http_code}' -X POST "$B/functions/v1/$1" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$2"
}

vdsp_refuses() { # $1 fn, $2 body, $3 status wanted, $4 judge (answers|import|diagnostic)
  case "$VDSP_NEW" in
    *" $1 "*) ;;
    *) echo "INFO  $1 was not asked as a stranger: this lane's build is not serving (the line above), and an older bundle would spend a model call"; return;;
  esac
  vdsp_post "$1" "$2" | VDSP_FN="$1" VDSP_WANT="$3" VDSP_JUDGE="$4" node -e '
let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
  const lines=s.split("\n");const code=lines.pop();const raw=lines.join("\n");
  const fn=process.env.VDSP_FN,want=process.env.VDSP_WANT,judge=process.env.VDSP_JUDGE;
  let j=null;try{j=JSON.parse(raw)}catch{}
  const why=[];
  if(code!==want)why.push("HTTP "+code);
  if(!j||typeof j!=="object"||Array.isArray(j))why.push("no JSON body");
  else if(judge==="answers"){
    if(j.error!=="sign_in_required")why.push("error "+JSON.stringify(j.error));
    for(const k of ["answers","skipped","note"])if(k in j)why.push("it carries "+k);
  }else if(judge==="import"){
    if(j.requiresPurchase!==true)why.push("requiresPurchase "+JSON.stringify(j.requiresPurchase));
    if(j.success===true||"data" in j)why.push("it carries an extraction");
  }else if(judge==="diagnostic"){
    if(j.success!==false)why.push("success "+JSON.stringify(j.success));
    for(const k of ["chains","results"])if(k in j)why.push("it carries "+k+": a model ran");
  }
  if(why.length)console.log("FAIL  "+fn+" did not refuse a caller it should: "+why.join("; ")+" -- "+raw.slice(0,200));
  else console.log("PASS  "+fn+" answers a stranger "+code+" before any model call: "+JSON.stringify(String(j.error??"").slice(0,90)));
});'
}

VDSP_RESUME="Verifier probe. Sam Park, data engineer. Built pipelines in Python and SQL for five years at two companies."
vdsp_refuses generate-application-answers "{\"resumeText\":\"$VDSP_RESUME\",\"jobTitle\":\"Data Engineer\",\"jobCompany\":\"Probe\",\"jobDescription\":\"Verifier probe posting.\",\"questions\":[{\"label\":\"Why do you want to work here?\"}]}" 401 answers
vdsp_refuses import-freelance-profile "{\"profileText\":\"$VDSP_RESUME Freelance on Upwork since 2021, three client projects.\"}" 402 import
vdsp_refuses test-ai-fallback "{\"mode\":\"quick\"}" 401 diagnostic

case "$VDSP_NEW" in
  *" test-ai-fallback "*)
    VDSP_ALLOW=$(tr -d '\r' < /tmp/vd_sp_hdr_test-ai-fallback 2>/dev/null | grep -i '^access-control-allow-headers:' | head -1 | sed -E 's/^[^:]+: *//')
    case ",$(printf '%s' "$VDSP_ALLOW" | tr 'A-Z' 'a-z' | tr -d ' ')," in
      *",x-admin-key,"*) echo "PASS  test-ai-fallback preflight allows x-admin-key: $VDSP_ALLOW";;
      *) echo "FAIL  test-ai-fallback preflight does not allow x-admin-key, so a browser sending the owner's key as a header is stopped: '$VDSP_ALLOW'";;
    esac;;
  *) echo "INFO  test-ai-fallback's preflight headers are judged once this lane's build serves";;
esac

echo "INFO  20261110140000 (an unnamed purchase claim takes its product from the records that hold it) is not readable from outside: job_board_meta is service-only. In the SQL editor, SELECT v FROM public.job_board_meta WHERE k = 'paid_session_names' gives firstRun.named, firstRun.unnamedStillOpen (older claims no record names, let through rather than locked out) and firstRun.unnamedRefused; a missing row means it has not applied"
