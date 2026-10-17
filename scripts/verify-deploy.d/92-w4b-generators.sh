# shellcheck shell=bash
# ── 92. WAVE 4 ROUND 2, THE GENERATORS: the writing tools counted by account,
# the S12 sweep's generator and free-scan fixes, the scrape-linkedin and free
# Career Path retirements (branch w4b/generators; docs/wave4/README.md).
#
# THE CLAIMS, one line each below:
#   - the writing tools and every function whose code moved serve the round's
#     build (2026-10-11.24 or later; free-keyword-scan 2026-10-14.24 or later,
#     because R1 stamped it 2026-10-14.1). The model spend gate every free
#     generator imports now counts a proven account by its own name (S12-146),
#     so their bundles moved too;
#   - signed out, the tailored résumé, the cover letter and the interview-prep
#     set answer 401 sign_in_required with a sentence a person can read, and
#     never a letter (owner decision 2026-10-12);
#   - the free Career Path and scrape-linkedin answer 410 retired (S12-152);
#   - 20261011160000 applied: take_writing_tools and refund_writing_tools are
#     closed to anon by name, and writing_tool_uses is not readable by anon.
# Not provable from outside, so proved in the suite: the free and Pro
# allowances themselves (one a day; five a day and sixty a month), the
# posting's language and the résumé-only claims in letters and answers
# (S12-003, S12-071, S12-062, S12-147, S12-148), the freelance model walk
# (S12-055, S12-105, S12-107), the free scanner's network share, sealed
# sentences, synthetic secret and per-account day (S12-066, S12-068, S12-142,
# S12-143, S12-144, S12-145), and what a past buyer of a retired product still
# receives: the Premium Package's prompt asks for no invented figure and a
# draft is repaired once (CP-018), and the sweep's ATS Defense delivery skips
# the shared address bucket (CP-030). Both functions are in the build list
# below.
#
# READ-ONLY. Preflights run no function logic. A writing tool is POSTed only
# once its preflight shows this round's build, which refuses a caller with no
# account before it counts, reads or writes anything (an older bundle would
# write a letter, so it is never asked). The two retired functions answer
# before reading a body. The two RPCs are probed with a GET (read-only).
echo "== 92. wave 4 round 2, generators: writing tools by account, retired scraper and free Career Path, round builds =="

vd92g_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//'
}

VD92G_LIVE=" "
vd92g_say() { # $1 fn, $2 header, $3 verdict (ok|old), $4 floor, $5 what the build carries
  if [ -z "$2" ]; then echo "FAIL  $1 preflight carries no x-fn-build (not deployed, or its preflight does not answer)"
  elif [ "$3" = ok ]; then echo "PASS  $1 preflight x-fn-build = $2 ($1.$4 or later: $5)"; VD92G_LIVE="$VD92G_LIVE$1 "
  else echo "FAIL  $1 preflight x-fn-build = $2 (want $1.$4 or later: $5 is not serving)"; fi
}

# The writing tools, the two retirements, the freelance walk and the backup scanner.
for VD92G_FN in generate-cover-letter generate-tailored-resume generate-interview-coach generate-application-answers generate-apply-package generate-freelance-boost generate-career-path scrape-linkedin free-keyword-scan-stream; do
  VD92G_H=$(vd92g_build "$VD92G_FN"); VD92G_V=old
  if [ -n "$VD92G_H" ] && build_ge "$VD92G_FN" "$VD92G_H" "2026-10-11" "24"; then VD92G_V=ok; fi
  vd92g_say "$VD92G_FN" "$VD92G_H" "$VD92G_V" "2026-10-11.24" "this round's generators"
done
# R1 stamped the primary scanner 2026-10-14.1, so this round's build carries R1's day.
VD92G_H=$(vd92g_build free-keyword-scan); VD92G_V=old
if [ -n "$VD92G_H" ] && build_ge free-keyword-scan "$VD92G_H" "2026-10-14" "24"; then VD92G_V=ok; fi
vd92g_say free-keyword-scan "$VD92G_H" "$VD92G_V" "2026-10-14.24" "the network share, sealed-sentence scrub and per-account day"
# Every other importer of the model spend gate: their bundles carry the gate that counts a proven account by name (S12-146).
for VD92G_FN in analyze-linkedin-profile application-fit generate-ats-defense generate-career-snapshot generate-cover-letter-stream generate-elevator-pitch generate-graduate-gameplan generate-keyword-fix generate-premium-package generate-premium-package-stream generate-product-preview generate-recruiter-view generate-resume-roast generate-summary import-freelance-profile job-fit nl-search parse-resume-structured shortlist-evaluate test-ai-fallback; do
  VD92G_H=$(vd92g_build "$VD92G_FN"); VD92G_V=old
  if [ -n "$VD92G_H" ] && build_ge "$VD92G_FN" "$VD92G_H" "2026-10-11" "24"; then VD92G_V=ok; fi
  vd92g_say "$VD92G_FN" "$VD92G_H" "$VD92G_V" "2026-10-11.24" "the spend gate that counts a proven account by name"
done

vd92g_post() { # $1 fn, $2 body -> "<json>\n<status>"
  curl -s -m 30 -w '\n%{http_code}' -X POST "$B/functions/v1/$1" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$2"
}

vd92g_signed_out() { # $1 fn, $2 body
  case "$VD92G_LIVE" in
    *" $1 "*) ;;
    *) echo "INFO  $1 was not asked as a visitor: this round's build is not serving (the line above), and an older bundle would write for anyone"; return;;
  esac
  vd92g_post "$1" "$2" | VD92G_FN="$1" node -e '
let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
  const lines=s.split("\n");const code=lines.pop();const raw=lines.join("\n");const fn=process.env.VD92G_FN;
  let j=null;try{j=JSON.parse(raw)}catch{}
  const why=[];
  if(code!=="401")why.push("HTTP "+code);
  if(!j||typeof j!=="object")why.push("no JSON body");
  else{
    if(j.error!=="sign_in_required")why.push("error "+JSON.stringify(j.error));
    if(typeof j.message!=="string"||!/sign in/i.test(j.message))why.push("no sentence asking the visitor to sign in");
    for(const k of ["letter","coverLetter","tailoredResume","questions","resume"])if(k in j)why.push("it carries "+k);
  }
  if(why.length)console.log("FAIL  "+fn+" did not refuse a visitor with no account: "+why.join("; ")+" -- "+raw.slice(0,200));
  else console.log("PASS  "+fn+" answers a visitor with no account 401 sign_in_required: "+JSON.stringify(j.message.slice(0,90)));
});'
}
VD92G_RESUME="Verifier probe. Sam Park, data engineer. Built pipelines in Python and SQL for five years."
vd92g_signed_out generate-cover-letter "{\"resumeText\":\"$VD92G_RESUME\",\"jobTitle\":\"Data Engineer\",\"jobCompany\":\"Probe\"}"
vd92g_signed_out generate-tailored-resume "{\"resumeText\":\"$VD92G_RESUME\",\"jobTitle\":\"Data Engineer\"}"
vd92g_signed_out generate-interview-coach "{\"resumeText\":\"$VD92G_RESUME\",\"targetRole\":\"Data Engineer\"}"

vd92g_retired() { # $1 fn, $2 body
  case "$VD92G_LIVE" in
    *" $1 "*) ;;
    *) echo "INFO  $1 was not asked: its retired build is not serving (the line above)"; return;;
  esac
  vd92g_post "$1" "$2" | VD92G_FN="$1" node -e '
let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
  const lines=s.split("\n");const code=lines.pop();const raw=lines.join("\n");const fn=process.env.VD92G_FN;
  let j=null;try{j=JSON.parse(raw)}catch{}
  const why=[];
  if(code!=="410")why.push("HTTP "+code);
  if(!j||typeof j!=="object")why.push("no JSON body");
  else{
    if(j.code!=="retired")why.push("code "+JSON.stringify(j.code));
    if(typeof j.error!=="string"||!/retired/i.test(j.error))why.push("no sentence saying it is retired");
  }
  if(why.length)console.log("FAIL  "+fn+" is not retired: "+why.join("; ")+" -- "+raw.slice(0,200));
  else console.log("PASS  "+fn+" answers 410 retired: "+JSON.stringify(j.error.slice(0,90)));
});'
}
vd92g_retired generate-career-path "{\"resumeText\":\"$VD92G_RESUME\"}"
vd92g_retired scrape-linkedin '{"url":"https://www.linkedin.com/in/verifier-probe"}'

probe take_writing_tools '{"p_user_id":"00000000-0000-4000-8000-000000000000","p_tools":["letter"],"p_per_day":1,"p_per_month":60,"p_tier":"free"}'
probe refund_writing_tools '{"p_user_id":"00000000-0000-4000-8000-000000000000","p_use_ids":["00000000-0000-4000-8000-000000000001"]}'
curl -s -m 30 "$B/rest/v1/writing_tool_uses?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" > /tmp/vd_92g_uses.json
node -e '
const fs=require("fs");let raw="";try{raw=fs.readFileSync("/tmp/vd_92g_uses.json","utf8")}catch{}
let j=null;try{j=JSON.parse(raw)}catch{}
if(Array.isArray(j))console.log("FAIL  writing_tool_uses is readable by anon ("+j.length+" row(s) returned): the REVOKE in 20261011160000 did not hold");
else if(j&&j.code==="42501")console.log("PASS  writing_tool_uses as anon -> 42501 (not readable: who wrote what stays private)");
else if(j&&(j.code==="42P01"||j.code==="PGRST205"))console.log("FAIL  writing_tool_uses does not exist ("+j.code+"): 20261011160000 has not applied");
else console.log("FAIL  writing_tool_uses as anon answered "+raw.slice(0,160));'

echo "INFO  not provable from here (each needs an account, a purchase or a model call): a free account gets one tailored résumé, one letter and one prep set a UTC day and Pro five packages a day and sixty a month (429 daily_limit / monthly_limit with resetsAt); letters follow the posting's language and state only what the résumé does; the free scanner's network share, synthetic secret, per-account day and sealed-sentence scrub. The suite proves each (src/test/w4b-*)."
echo "INFO  owner: revoke FIRECRAWL_API_KEY in the function secrets once scrape-linkedin answers 410 above (no other function reads it); set SYNTHETIC_SCAN_SECRET (or rely on HEARTBEAT_SECRET) where load-test-scan.mjs and post-publish-smoke.mjs run, or their synthetic scans count as visitors'."
