# shellcheck shell=bash
# ── 80. COMPANY PROFILES, PHASE 1: THE PERK ENGINE (builds of 2026-10-12).
# Sourced by scripts/verify-deploy.sh; J R probe build_ge $B $K $SITE $UA are
# in scope. Deploy note: docs/company-profiles/perks-engine.md.
#
# THE CLAIMS:
#   - employer-profiles serves employer-profiles.2026-10-12.1 or later, and its
#     preflight allows the cron's key header and the owner's;
#   - a POST holding neither key is refused before any work (401);
#   - the reader get_employer_perks answers the publishable key with an object
#     -- perks, withheld, collision, the 45-day expiry -- and every perk it
#     shows is one of the nine candidate keys (none at all until a key passes
#     its row audit: every key ships unpublished);
#   - the perk tables refuse the publishable key outright, and the owner's
#     status reader and the cron-key check refuse it by name (42501).
#
# READ-ONLY. The OPTIONS preflight runs no function logic; the keyless POST is
# refused before its body is read; get_employer_perks is a pure reader; the
# two refusal probes are GETs of pure readers. The sweep's own progress (run
# rows, the queue, the rollup lap) is private: the owner reads it with
#   node scripts/perk-audit.mjs status
# which asks employer-profiles with the ADMIN_API_KEY.
echo "== 80. company profiles: the perk engine (20261012110000-111000, employer-profiles) =="

W80_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/employer-profiles" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-admin-key,x-employer-profiles-cron,content-type" | tr -d '\r')
W80_B=$(printf '%s\n' "$W80_H" | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$W80_B" ]; then echo "FAIL  employer-profiles preflight carries no x-fn-build (the function is not deployed)"
elif build_ge employer-profiles "$W80_B" 2026-10-12 1; then echo "PASS  employer-profiles preflight x-fn-build = $W80_B (employer-profiles.2026-10-12.1 or later)"
else echo "FAIL  employer-profiles preflight x-fn-build = $W80_B (want employer-profiles.2026-10-12.1 or later)"; fi
W80_A=$(printf '%s\n' "$W80_H" | grep -i '^access-control-allow-headers:' | head -1 | tr 'A-Z' 'a-z')
case "$W80_A" in *x-employer-profiles-cron*x-admin-key*|*x-admin-key*x-employer-profiles-cron*) echo "PASS  employer-profiles preflight allows x-employer-profiles-cron and x-admin-key";;
  *) echo "FAIL  employer-profiles preflight does not allow both key headers: ${W80_A:-(no header)}";; esac

W80_S=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/employer-profiles" -H "Content-Type: application/json" -d '{"action":"audit_status"}')
[ "$W80_S" = "401" ] && echo "PASS  employer-profiles refuses a POST holding neither key (401, before any work)" || echo "FAIL  employer-profiles answered a keyless POST with $W80_S (want 401)"

for W80_T in ramp tailscale spotify; do
  R get_employer_perks "{\"p_token\":\"$W80_T\"}" > /tmp/vd_80_perks.json
  W80_T="$W80_T" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const t=process.env.W80_T;let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_80_perks.json","utf8"))}catch{}
if(!j||typeof j!=="object"||Array.isArray(j)||!Array.isArray(j.perks)){ok(false,"get_employer_perks("+t+") as anon -> "+JSON.stringify(j).slice(0,200)+" (PGRST202 = 20261012110000 not applied)");process.exit(0)}
const CANDIDATES=["health","dental","vision","life_dis","retire","pto","parental","equity","visa_not_offered"];
const off=j.perks.filter((p)=>!CANDIDATES.includes(p.perk));
ok(off.length===0&&j.expiry_days===45&&Array.isArray(j.withheld)&&typeof j.collision==="boolean","get_employer_perks("+t+") answers the publishable key in shape, with no key off the candidate list ("+j.perks.length+" published rows, withheld "+JSON.stringify(j.withheld).slice(0,120)+")");
if(!j.perks.length)info("get_employer_perks("+t+"): no published rows -- every key ships unpublished until it passes its 60-row audit (scripts/perk-audit.mjs)");
for(const p of j.perks){if(!(p.n>=5&&p.k>=2&&p.k*10>=p.n&&p.quote))ok(false,t+" "+p.country+" "+p.perk+" breaks the published-row rule: k "+p.k+" of n "+p.n+", quote "+JSON.stringify(p.quote))}'
done

W80_P=$(curl -s -m 30 "$B/rest/v1/employer_perk_postings?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$W80_P" in *42501*|*"permission denied"*) echo "PASS  employer_perk_postings refuses the publishable key (42501)";;
  *PGRST205*|*"does not exist"*) echo "FAIL  employer_perk_postings not found: 20261012110000 has not applied";;
  *) echo "FAIL  employer_perk_postings answered the publishable key: ${W80_P:0:160}";; esac
W80_R=$(curl -s -m 30 "$B/rest/v1/employer_perk_rollups?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$W80_R" in *42501*|*"permission denied"*) echo "PASS  employer_perk_rollups refuses the publishable key (42501)";;
  *) echo "FAIL  employer_perk_rollups answered the publishable key: ${W80_R:0:160}";; esac
probe employer_perk_audit_status '{}'
probe employer_profiles_cron_key_matches '{"p_key":"verify-deploy-probe-0000000000000000000000"}'
echo "INFO  the sweep's progress is private: node scripts/perk-audit.mjs status (ADMIN_API_KEY) prints the run rows, the queue and the rollup lap"
