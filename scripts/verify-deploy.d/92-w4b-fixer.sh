# shellcheck shell=bash
# ── 92. WAVE 4 ROUND 2, THE FIXER: the review's confirmed findings and minors
# (branch w4b-fix onto wave4/integration; docs/wave4/README.md "Fixes after the
# review").
#
# THE CLAIMS, one line each below:
#   - every function the fixes changed serves this round's fixer build:
#     2026-10-11.30 (generate-career-path, generate-application-answers,
#     generate-apply-package, free-keyword-scan-stream, stripe-webhook,
#     check-subscription, agent-mcp, public-api, apply-agent, scan-heartbeat)
#     or 2026-10-14.30 (get-account-data, free-keyword-scan, account-order);
#   - generate-application-answers answers a signed-out cover-note request 401
#     sign_in_required (the writing tools' account gate; asked only once the
#     build shows the gate, so an older bundle is never asked to write);
#   - job-board (it keeps 2026-09-09.93): "nurse not night shift in Boston"
#     excludes "night", origin/main's one word (the phrase rule left wave 4
#     in the descope of 2026-10-25), and keeps Boston as the place; "nurse
#     jobs not in Texas" names placeExclusion in ignoredFilters; and an
#     anonymous browse paged by a keyset cursor past 10,000 is served, not
#     refused (judged only once the round-2 board code serves, by the same
#     offset tell section 92 job-board reads).
# INFO only: the two migrations (20261011210000, 20261011211000) are proved
# by their own self-checks; the owner's reads are printed.
#
# READ-ONLY. OPTIONS preflights, job-board list reads on the probe budget, and
# one cover-note POST that the gate refuses before any count or model call.
echo "== 92. w4b fixer: the review's findings, by build and by behaviour =="

for VD92F_PAIR in generate-career-path:2026-10-11 generate-application-answers:2026-10-11 generate-apply-package:2026-10-11 \
  free-keyword-scan-stream:2026-10-11 stripe-webhook:2026-10-11 check-subscription:2026-10-11 agent-mcp:2026-10-11 \
  public-api:2026-10-11 apply-agent:2026-10-11 scan-heartbeat:2026-10-11 \
  get-account-data:2026-10-14 free-keyword-scan:2026-10-14 account-order:2026-10-14; do
  VD92F_FN=${VD92F_PAIR%%:*}; VD92F_D=${VD92F_PAIR#*:}
  VD92F_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD92F_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD92F_H" ]; then echo "FAIL  $VD92F_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$VD92F_FN" "$VD92F_H" "$VD92F_D" "30"; then echo "PASS  $VD92F_FN x-fn-build = $VD92F_H ($VD92F_FN.$VD92F_D.30 or later: the review's fixes)"
  else echo "FAIL  $VD92F_FN x-fn-build = $VD92F_H (want $VD92F_FN.$VD92F_D.30 or later: the review's fixes are not serving)"; fi
  [ "$VD92F_FN" = "generate-application-answers" ] && VD92F_GAA="$VD92F_H"
done

if build_ge generate-application-answers "${VD92F_GAA:-}" "2026-10-11" "30"; then
  VD92F_CN=$(curl -s -m 30 -o /tmp/vd_92f_cover.json -w '%{http_code}' -X POST "$B/functions/v1/generate-application-answers" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -d '{"mode":"cover-note","resumeText":"verify-deploy section 92 fixer: a signed-out caller asking for a cover note, which the account gate refuses before anything is counted.","jobTitle":"Engineer","jobCompany":"Acme","jobDescription":"verify-deploy probe","language":"en"}')
  if [ "$VD92F_CN" = "401" ] && grep -q '"sign_in_required"' /tmp/vd_92f_cover.json; then echo "PASS  a signed-out cover-note request answers 401 sign_in_required (the writing tools' account gate)"
  else echo "FAIL  a signed-out cover-note request answers $VD92F_CN $(head -c 140 /tmp/vd_92f_cover.json) (want 401 sign_in_required)"; fi
else
  echo "INFO  the cover-note gate is not asked: generate-application-answers is older than 2026-10-11.30, and an older bundle would write the note"
fi

# The round-2 board code's tell (S12-122), as section 92 job-board reads it.
VD92F_OFF=$(curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","q":"nurse","offset":10001,"limit":1}')
J '{"action":"list","q":"nurse not night shift in Boston","limit":20}' > /tmp/vd_92f_boston.json
J '{"action":"list","q":"nurse jobs not in Texas","limit":20}' > /tmp/vd_92f_tx.json
J '{"action":"list","country":"US","offset":10020,"cursor":{"ep":"2026-01-01T00:00:00.000+00:00","id":"greenhouse:zz:0","k":"ep"},"limit":20}' > /tmp/vd_92f_cursor.json
VD92F_OFF="$VD92F_OFF" node -e '
const fs=require("fs");const r2=process.env.VD92F_OFF==="400";
const ok=(c,m)=>console.log((r2?(c?"PASS":"FAIL"):"INFO")+"  "+m+(r2?"":" (not judged: the round-2 board code is not serving)"));
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const b=rd("/tmp/vd_92f_boston.json")||{};
ok(JSON.stringify(b.excludedTerms||[])==="[\"night\"]"&&/boston/i.test(JSON.stringify(b.intentFilters||[])),"q \"nurse not night shift in Boston\" excludes "+JSON.stringify(b.excludedTerms||null)+" (want [\"night\"], origin/main\x27s one word) and lifts "+JSON.stringify(b.intentFilters||null)+" (want Boston)");
const t=rd("/tmp/vd_92f_tx.json")||{};
ok((t.ignoredFilters||[]).includes("placeExclusion")&&!/texas/i.test(JSON.stringify(t.intentFilters||[])),"q \"nurse jobs not in Texas\" names placeExclusion ("+JSON.stringify(t.ignoredFilters||null)+") and lifts no Texas ("+JSON.stringify(t.intentFilters||null)+")");
const c=rd("/tmp/vd_92f_cursor.json")||{};
ok(c.error!=="offset_too_deep"&&Array.isArray(c.jobs),"a browse past 10,000 paged by a keyset cursor is served ("+(Array.isArray(c.jobs)?c.jobs.length+" rows":JSON.stringify(c).slice(0,120))+"), not refused offset_too_deep");'

echo "INFO  owner, service role: SELECT count(*) FROM pg_trigger WHERE tgname = '\''affiliate_commission_revoked'\'' must be 1 (20261011211000); SELECT prosrc LIKE '\''%purchased_content%'\'' FROM pg_proc WHERE proname = '\''account_erase_personal_data'\'' must be true (20261011210000)"
