# shellcheck shell=bash
# ── 66. WAVE 2, PUBLIC API (branch wave2/public-api, builds of 2026-10-08).
# Sourced by scripts/verify-deploy.sh; J R probe build_ge $B $K $SITE $UA $RB
# are in scope. Deploy note: docs/wave2/public-api.md.
#
# THE CLAIMS:
#   - /v1/changes leaves suspect closure batches out by default; include_suspect
#     =true returns them, each marked suspectBatch:true; anything but true/false
#     is a 400; the response says which feed it is (suspectBatchesIncluded) and
#     the API version is 2026-10-08.1 (register 1.70 / L13-56); a closure
#     written before the collector assessed its batches is suspectBatch:null,
#     never false (public-api.2026-10-08.2);
#   - free-keyword-scan-stream clamps the improvement promise to the score gap
#     on fresh and cached reports (register L5-15, ported from the primary);
#   - the owner can read the NAMES of the client-callable definers the census
#     only counts, through admin-ops with the ADMIN_API_KEY, and the publishable
#     key cannot (20261008141000);
#   - the takedown ticker's catalogue description no longer says the feed counts
#     higher (20261008140000);
#   - /data-api's crawler copy states both closure windows and the opt-in.
#
# READ-ONLY. OPTIONS preflights run no function logic. The /v1 index answers
# before any key check. The keyed /v1/changes reads use the owner's own free
# key (RB_API_KEY in .env.local) and cost three calls of its quota; without it
# they are INFO. client_callable_unlisted_names is a pure catalogue reader, so
# its refusal probe is harmless even if the revoke had not landed. admin-ops is
# called WITHOUT the admin key, which it refuses before building a client. No
# scan is run: a scan spends a model call and the rate budget, so the clamp is
# proved by src/test/the-scan-fallback-promised-more-points-than-the-score-could-gain.test.ts.
echo "== 66. wave 2 public-api: /v1/changes leaves doubted batches out, the fallback's promise is bounded, the owner can read the census's names =="

for PAIR in "public-api|2026-10-08|2" "free-keyword-scan-stream|2026-10-08|1" "admin-ops|2026-10-08|1"; do
  W66_FN=${PAIR%%|*}; W66_REST=${PAIR#*|}; W66_D=${W66_REST%%|*}; W66_N=${W66_REST#*|}
  W66_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$W66_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$W66_H" ]; then echo "FAIL  $W66_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$W66_FN" "$W66_H" "$W66_D" "$W66_N"; then echo "PASS  $W66_FN preflight x-fn-build = $W66_H ($W66_FN.$W66_D.$W66_N or later)"
  else echo "FAIL  $W66_FN preflight x-fn-build = $W66_H (want $W66_FN.$W66_D.$W66_N or later: the previous bundle is still serving)"; fi
done

# The /v1 index answers without a key; its apiVersion moves with a narrowing.
W66_ROOT=$(curl -s -m 30 "$B/functions/v1/public-api/v1" -H "apikey: $K" -H "Authorization: Bearer $K")
W66_VER=$(printf '%s' "$W66_ROOT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).apiVersion||"none")}catch{console.log("unparsed")}})')
case "$W66_VER" in
  2026-10-08.1) echo "PASS  /v1 apiVersion = $W66_VER (the default closed[] narrowing is a version)";;
  *) echo "FAIL  /v1 apiVersion = $W66_VER (want 2026-10-08.1; 2026-09-30.1 = public-api not deployed)";;
esac

if [ -z "${RB:-}" ]; then
  echo "INFO  RB_API_KEY missing from .env.local -- the keyed /v1/changes reads (default walk, include_suspect=true, include_suspect=yes) are skipped"
else
  W66_SINCE=$(date -u -v-2d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '2 days ago' +%Y-%m-%dT00:00:00Z)
  curl -s -m 60 -o /tmp/vd_66_def.json "$B/functions/v1/public-api/v1/changes?since=$W66_SINCE&limit=100" -H "Authorization: Bearer $RB" -H "apikey: $K"
  curl -s -m 60 -o /tmp/vd_66_all.json "$B/functions/v1/public-api/v1/changes?since=$W66_SINCE&limit=100&include_suspect=true" -H "Authorization: Bearer $RB" -H "apikey: $K"
  W66_BAD=$(curl -s -m 30 -o /tmp/vd_66_bad.json -w '%{http_code}' "$B/functions/v1/public-api/v1/changes?since=$W66_SINCE&limit=1&include_suspect=yes" -H "Authorization: Bearer $RB" -H "apikey: $K")
  W66_BAD="$W66_BAD" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const d=rd("/tmp/vd_66_def.json"), a=rd("/tmp/vd_66_all.json"), b=rd("/tmp/vd_66_bad.json");
const dc=Array.isArray(d&&d.closed)?d.closed:null, ac=Array.isArray(a&&a.closed)?a.closed:null;
if(!dc){ok(false,"/v1/changes default walk -> "+JSON.stringify(d).slice(0,160));}
else{
  ok(d.suspectBatchesIncluded===false,"default walk says suspectBatchesIncluded=false (got "+d.suspectBatchesIncluded+"; undefined = old build)");
  ok(dc.every(c=>"suspectBatch" in c&&(c.suspectBatch===false||c.suspectBatch===null)),"every row of the default walk is suspectBatch false or null, never true or absent ("+dc.length+" rows; "+dc.filter(c=>!(c.suspectBatch===false||c.suspectBatch===null)).length+" not)");
  ok(dc.every(c=>!("batch_live_before" in c)),"no raw batch_live_before column beside the named field");
  info("default walk rows never assessed (suspectBatch null): "+dc.filter(c=>c.suspectBatch===null).length+" of "+dc.length+" (0 expected in a 2-day window: batches are stamped since 20260906090000)");
  ok(dc.every(c=>!("suspect" in c)),"no raw suspect column beside the named field");
}
if(!ac){ok(false,"/v1/changes?include_suspect=true -> "+JSON.stringify(a).slice(0,160)+" (unknown_parameter = old build)");}
else{
  ok(a.suspectBatchesIncluded===true&&ac.every(c=>typeof c.suspectBatch==="boolean"||c.suspectBatch===null),"include_suspect=true says so and marks every row ("+ac.length+" rows, "+ac.filter(c=>c.suspectBatch===true).length+" suspect, "+ac.filter(c=>c.suspectBatch===null).length+" never assessed)");
  if(dc&&dc.length===100&&ac.length===100){
    const firstDef=dc[0].event_id, firstAll=ac[0].event_id;
    info("both first pages full; first event_id default="+firstDef+" include_suspect="+firstAll+" (equal unless a suspect batch opens the window)");
  }
}
ok(process.env.W66_BAD==="400"&&b&&b.error&&b.error.code==="invalid_value","include_suspect=yes -> "+process.env.W66_BAD+" "+(b&&b.error&&b.error.code)+" (want 400 invalid_value; unknown_parameter = old build)");'
fi

# The names reader is service-role only: 42501 with the publishable key.
probe client_callable_unlisted_names '{}'
# admin-ops refuses the names call without the admin key, before any client.
W66_NOKEY=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$B/functions/v1/admin-ops" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"fn":"client_callable_unlisted_names"}')
[ "$W66_NOKEY" = "401" ] && echo "PASS  admin-ops {fn: client_callable_unlisted_names} without the admin key -> 401" || echo "FAIL  admin-ops without the admin key -> $W66_NOKEY (want 401)"
# The census still gives the publishable key the count, and only the count.
W66_C=$(R client_callable_census | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s);console.log(typeof c.unlisted_client_callable==="number"?c.unlisted_client_callable:"none")}catch{console.log("unparsed")}})')
echo "INFO  client_callable_census unlisted_client_callable = $W66_C (the names: admin-ops with the ADMIN_API_KEY, {\"fn\":\"client_callable_unlisted_names\"}; see docs/wave2/public-api.md)"
echo "INFO  20261008140000 changes only get_takedowns_today's catalogue description, which the publishable key cannot read; its own DO block proves it landed"

# /data-api's crawler copy: both closure windows and the opt-in, and not the
# old 'thirty days on a free key' sentence (wrong for closures since .30.1).
W66_DA=$(curl -s -m 30 -A "$UA" "$SITE/data-api")
if printf '%s' "$W66_DA" | grep -qF "include_suspect=true"; then echo "PASS  /data-api serves crawlers the include_suspect opt-in"
else echo "FAIL  /data-api does not mention include_suspect (frontend not published, or the prerender did not rebuild)"; fi
if printf '%s' "$W66_DA" | grep -qF "suspectBatch: null"; then echo "PASS  /data-api tells crawlers an unassessed closure is suspectBatch: null"
else echo "FAIL  /data-api does not say what suspectBatch: null means (frontend not published, or the prerender did not rebuild)"; fi
if printf '%s' "$W66_DA" | grep -qF "30 days back on a free key, 180 on a paid one"; then echo "FAIL  /data-api still says closures reach 30 days on a free key (they reach 72 hours)"
else echo "PASS  /data-api no longer says closures reach 30 days on a free key"; fi
