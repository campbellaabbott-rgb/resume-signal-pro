# Résumé matching, phase 0 (2026-10-16): resume-match behind no UI and the
# four 20261016 migrations (geo_places, metro_ring, match_candidates with its
# builder and the timing gate's explain, job_posting_requirements). docs/resume-match-deploy-notes.md lists the
# claims; each one has a line here. Sourced by scripts/verify-deploy.sh.
#   - an OPTIONS preflight: the build resume-match serves;
#   - GET probes of the four new functions and GET reads of the two new tables
#     as anon, each selecting a real column, so the answer is the permission
#     refusal (42501) and never a missing-column one;
#   - get_cron_health (a reader): the purge job sets its own timeout;
#   - two POSTs refused before any limiter or database work: résumé text from
#     the site, and the mcp surface without the service key;
#   - ten anonymous POSTs with synthetic profiles (a role, a city, and on the
#     last one canary values; never a résumé), timed by curl: three use the
#     remote lane, one relocates anywhere in the country; then one widening
#     follow-up carrying the first answer's token (the step it names); then
#     the first profile again until this network's 30-an-hour bucket answers
#     429, at most 21 more. Each POST is one read of the board's probe day
#     (x-rb-budget: probe) and one count in the function's own network
#     bucket (the follow-up in the widening one), and may fill the
#     posting-keyed requirement cache, exactly as a reader's call does.
#     Nothing here signs in or calls a writer.
# A MATCHER THAT RETURNS NOTHING FAILS. These are common occupations in large
# US metros: fewer than 8 of the 10 answers with a row is a FAIL, any answer
# that missed a deadline is a FAIL (a lane that times out returns an empty
# page), and the candidates statement is judged by its slowest answer against
# its 1.2 s deadline as well as by p90 against 700 ms.
# THE MIGRATIONS ARE A PRECONDITION OF THE BUILD: once resume-match answers
# 2026-10-16.1 or later, a function or table that does not exist is a FAIL
# (every match then answers 500), not an INFO. A run within an hour of an
# earlier one finds the bucket spent: the timings are then INFO (judged on
# the next run an hour later) and the 429 line is judged at once.
echo "== 97. resume-match (phase 0): serving behind no UI, objects closed to clients, timed, tiered, rate-limited =="
VD97_FN="$B/functions/v1/resume-match"
VD97_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$VD97_FN" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization, content-type" | tr -d '\r')
VD97_BUILD=$(printf '%s\n' "$VD97_H" | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
VD97_ORIGIN=$(printf '%s\n' "$VD97_H" | grep -i '^access-control-allow-origin:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD97_BUILD" ]; then VD97_OK=0; echo "FAIL  resume-match preflight carries no x-fn-build (want resume-match.2026-10-16.1 or later; absent = the function is not deployed)"
elif build_ge resume-match "$VD97_BUILD" 2026-10-16 1; then VD97_OK=1; echo "PASS  resume-match preflight x-fn-build = $VD97_BUILD (resume-match.2026-10-16.1 or later)"
else VD97_OK=0; echo "FAIL  resume-match preflight x-fn-build = $VD97_BUILD (want resume-match.2026-10-16.1 or later)"; fi
if [ "$VD97_OK" = "1" ]; then
  case "$VD97_ORIGIN" in
    "*"|"https://resumebooster.work") echo "PASS  resume-match answers the site's origin: access-control-allow-origin = $VD97_ORIGIN";;
    *) echo "FAIL  resume-match preflight access-control-allow-origin = ${VD97_ORIGIN:-absent} (the site could not read the answer)";;
  esac
fi

# The functions answer only service_role. A GET is read-only even if a revoke
# regressed. Missing is INFO only while the build is absent.
vd97_probe() {
  local line; line=$(probe "$1" "$2")
  case "$line" in
    "INFO  "*PGRST202*)
      if [ "$VD97_OK" = "1" ]; then echo "FAIL  $1 -> PGRST202 while resume-match serves its phase-0 build: the 20261016 migrations are not applied, so every match answers 500 (apply them before anything calls resume-match)"
      else echo "$line (judged once resume-match serves 2026-10-16.1)"; fi;;
    *) echo "$line";;
  esac
}
vd97_probe match_candidates '{"p_q_en":"nurse","p_q_simple":"nurse","p_fresh_cutoff":"2026-01-01T00:00:00Z","p_countries":["US"],"p_ring":["Chicago"],"p_remote":false,"p_regions":["IL"],"p_country_lane":false}'
vd97_probe match_candidates_query '{"p_q_en":"nurse","p_q_simple":"nurse","p_countries":["US"],"p_ring":["Chicago"],"p_remote":false,"p_regions":["IL"],"p_country_lane":false}'
vd97_probe match_candidates_explain '{"p_q_en":"nurse","p_q_simple":"nurse","p_fresh_cutoff":"2026-01-01T00:00:00Z","p_countries":["US"],"p_ring":["Chicago"],"p_remote":false,"p_regions":["IL"],"p_country_lane":false}'
vd97_probe metro_ring '{"p_city":"Columbus","p_region":"OH","p_country":"US","p_km":40,"p_max":20}'

# The tables answer no client role. Each read selects a real column.
VD97_REQ_TABLE=absent
for VD97_TSEL in geo_places:geonameid job_posting_requirements:posting_id; do
  VD97_T=${VD97_TSEL%%:*}; VD97_COL=${VD97_TSEL#*:}
  VD97_TC=$(curl -s -m 30 -o /tmp/vd_97_table.json -w '%{http_code}' "$B/rest/v1/$VD97_T?select=$VD97_COL&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
  VD97_TCODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_97_table.json","utf8"));process.stdout.write(Array.isArray(j)?"ROWS:"+j.length:String(j.code??"NOCODE"))}catch{process.stdout.write("NONJSON")}')
  case "$VD97_TCODE" in
    42501) echo "PASS  $VD97_T as anon -> $VD97_TC 42501 (closed to client roles)"; [ "$VD97_T" = "job_posting_requirements" ] && VD97_REQ_TABLE=present;;
    PGRST205|42P01)
      if [ "$VD97_OK" = "1" ]; then echo "FAIL  $VD97_T as anon -> $VD97_TC $VD97_TCODE while resume-match serves its phase-0 build: the table does not exist, the 20261016 migrations are not applied"
      else echo "INFO  $VD97_T as anon -> $VD97_TC $VD97_TCODE (not applied yet; judged once resume-match serves 2026-10-16.1)"; fi;;
    ROWS:*) echo "FAIL  $VD97_T is READABLE as anon -> $VD97_TC $VD97_TCODE"; [ "$VD97_T" = "job_posting_requirements" ] && VD97_REQ_TABLE=present;;
    *) echo "FAIL  $VD97_T as anon -> $VD97_TC $VD97_TCODE (want 42501)";;
  esac
done

# The requirement cache's daily purge: its COMMAND sets the timeout, because
# a function's SET never bounds a pg_cron run (20261003220000).
R get_cron_health '{"p_hours":48}' > /tmp/vd_97_cron.json
VD97_REQ_TABLE="$VD97_REQ_TABLE" node -e '
const fs=require("fs");let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_97_cron.json","utf8"))}catch{}
if(!Array.isArray(j)||!j.length){console.log("INFO  get_cron_health unreadable or empty: "+JSON.stringify(j).slice(0,140));process.exit(0)}
const r=j.find((x)=>x.ch_jobname==="purge-job-posting-requirements");
if(!r){console.log(process.env.VD97_REQ_TABLE==="present"?"FAIL  purge-job-posting-requirements is not scheduled though job_posting_requirements exists: the cache would keep every read posting forever (20261016103000 schedules it)":"INFO  purge-job-posting-requirements is not scheduled (20261016103000 not applied yet)");process.exit(0)}
console.log((r.ch_timeout?"PASS":"FAIL")+"  purge-job-posting-requirements sets its own timeout in the command: "+(r.ch_timeout||"none (capped at the session two minutes)")+", schedule "+r.ch_schedule+(r.ch_last_status?", last run "+r.ch_last_status:", not run yet"));'

# Refused before any limiter or database work, so neither counts against the bucket.
VD97_TEXT="Synthetic verifier text, not a resume. Synthetic verifier text, not a resume. Synthetic verifier text, not a resume."
VD97_RT_CODE=$(curl -s -m 30 -D /tmp/vd_97_rt.h -o /tmp/vd_97_rt.json -w '%{http_code}' -X POST "$VD97_FN" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -d "{\"action\":\"match\",\"resumeText\":\"$VD97_TEXT\",\"profile\":{\"roles\":[\"Registered Nurse\"],\"home\":{\"city\":\"Chicago\",\"region\":\"IL\",\"country\":\"US\"}}}")
VD97_MCP_CODE=$(curl -s -m 30 -D /tmp/vd_97_mcp.h -o /tmp/vd_97_mcp.json -w '%{http_code}' -X POST "$VD97_FN" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -d "{\"action\":\"match\",\"surface\":\"mcp\",\"resumeText\":\"$VD97_TEXT\"}")

# Ten synthetic profiles. The tenth is the Columbus, OH ring check and carries
# the canary values (a former job, work authorisation, a licence).
VD97_P1='{"action":"match","profile":{"roles":["Registered Nurse"],"home":{"city":"Chicago","region":"IL","country":"US"},"radiusKm":40,"level":"mid","licences":[{"kind":"rn","jurisdiction":"IL"}]}}'
VD97_P2='{"action":"match","profile":{"roles":["Software Engineer"],"home":{"city":"Seattle","region":"WA","country":"US"},"radiusKm":40,"level":"senior","remote":true}}'
VD97_P3='{"action":"match","profile":{"roles":["Data Analyst"],"home":{"city":"Pittsburgh","region":"PA","country":"US"},"radiusKm":40,"level":"mid","remote":true}}'
VD97_P4='{"action":"match","profile":{"roles":["Electrician"],"home":{"city":"Philadelphia","region":"PA","country":"US"},"radiusKm":40,"level":"entry"}}'
VD97_P5='{"action":"match","profile":{"roles":["Elementary Teacher"],"home":{"city":"Sacramento","region":"CA","country":"US"},"radiusKm":40,"level":"entry"}}'
VD97_P6='{"action":"match","profile":{"roles":["Marketing Coordinator"],"home":{"city":"Boston","region":"MA","country":"US"},"radiusKm":40,"level":"entry"}}'
VD97_P7='{"action":"match","profile":{"roles":["Financial Analyst"],"home":{"city":"Charlotte","region":"NC","country":"US"},"radiusKm":40,"level":"mid","relocate":"country","remote":true}}'
VD97_P8='{"action":"match","profile":{"roles":["Store Manager"],"home":{"city":"Dallas","region":"TX","country":"US"},"radiusKm":40,"level":"senior"}}'
VD97_P9='{"action":"match","profile":{"roles":["HVAC Technician"],"home":{"city":"Houston","region":"TX","country":"US"},"radiusKm":40,"level":"entry"}}'
VD97_P10='{"action":"match","profile":{"roles":["Accountant"],"home":{"city":"Columbus","region":"OH","country":"US"},"radiusKm":40,"level":"mid","remote":false,"former":"Zqcanary Lamplighter","workAuth":{"status":"work_visa","needsSponsorship":true,"citizenOf":["NZ"]},"licences":[{"kind":"cpa","jurisdiction":"OH"}]}}'
vd97_post() { curl -s -m 30 -D "$1.h" -o "$1" -w '%{http_code} %{time_total}' -X POST "$VD97_FN" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d "$2"; }
: > /tmp/vd_97_times.txt; : > /tmp/vd_97_rl.txt
for VD97_I in 1 2 3 4 5 6 7 8 9 10; do
  eval "VD97_BODY=\$VD97_P$VD97_I"
  if [ "$VD97_OK" = "1" ]; then echo "$VD97_I $(vd97_post "/tmp/vd_97_m$VD97_I.json" "$VD97_BODY")" >> /tmp/vd_97_times.txt
  else : > "/tmp/vd_97_m$VD97_I.json"; : > "/tmp/vd_97_m$VD97_I.json.h"; fi
done
# One widening follow-up: the first profile again, at the step its answer
# offers, with the token that answer issued for that step.
: > /tmp/vd_97_follow.txt; : > /tmp/vd_97_f1.json
if [ "$VD97_OK" = "1" ] && grep -qE '^1 200 ' /tmp/vd_97_times.txt; then
  VD97_FBODY=$(VD97_P1="$VD97_P1" node -e 'const fs=require("fs");let a={};try{a=JSON.parse(fs.readFileSync("/tmp/vd_97_m1.json","utf8"))}catch{};const b=JSON.parse(process.env.VD97_P1);if(typeof a.followUp==="string"&&Number.isInteger(a.nextWiden)){b.widen=a.nextWiden;b.followUp=a.followUp;process.stdout.write(JSON.stringify(b))}')
  if [ -n "$VD97_FBODY" ]; then echo "$(vd97_post /tmp/vd_97_f1.json "$VD97_FBODY")" > /tmp/vd_97_follow.txt; fi
fi
# Then the first profile again until the bucket answers, at most 21 more
# (10 + 21 = 31 calls in one hour from one network).
if [ "$VD97_OK" = "1" ] && ! grep -qE '^[0-9]+ 429 ' /tmp/vd_97_times.txt && ! grep -qvE '^[0-9]+ 200 ' /tmp/vd_97_times.txt; then
  VD97_N=0
  while [ "$VD97_N" -lt 21 ]; do
    VD97_N=$((VD97_N + 1))
    VD97_RL=$(vd97_post /tmp/vd_97_rl.json "$VD97_P1")
    echo "$VD97_N $VD97_RL" >> /tmp/vd_97_rl.txt
    case "$VD97_RL" in "200 "*) ;; *) break;; esac
  done
fi

VD97_OK="$VD97_OK" VD97_RT_CODE="$VD97_RT_CODE" VD97_MCP_CODE="$VD97_MCP_CODE" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};const js=(f)=>{try{return JSON.parse(rd(f))}catch{return null}};
const hdr=(f,h)=>((new RegExp("^"+h+":\\s*(\\S+)","im")).exec(rd(f))||[])[1]||"";
const isOurs=(b)=>/^resume-match\.\d{4}-\d\d-\d\d\./.test(b);
const built=process.env.VD97_OK==="1";
// Refused before any work.
const rt=js("/tmp/vd_97_rt.json")||{};const mcp=js("/tmp/vd_97_mcp.json")||{};
const rtB=hdr("/tmp/vd_97_rt.h","x-fn-build"),mcpB=hdr("/tmp/vd_97_mcp.h","x-fn-build");
if(!built){info("resume-match refusals judged once 2026-10-16.1 serves: resume text from the site -> "+process.env.VD97_RT_CODE+", mcp surface without the service key -> "+process.env.VD97_MCP_CODE)}
else{
  ok(process.env.VD97_RT_CODE==="400"&&rt.error==="resume_text_refused"&&isOurs(rtB),"resume text from a site caller -> "+process.env.VD97_RT_CODE+" "+(rt.error||"no error")+" from "+(rtB||"no build")+" (want 400 resume_text_refused: the matcher takes only the confirmed profile from the site)");
  ok(process.env.VD97_MCP_CODE==="403"&&mcp.error==="server_surface"&&isOurs(mcpB),"the mcp surface without the service key -> "+process.env.VD97_MCP_CODE+" "+(mcp.error||"no error")+" from "+(mcpB||"no build")+" (want 403 server_surface)");
}
if(!built){info("ten timed matches, tiers, the canary, the Columbus ring, wording and the 429: judged once resume-match serves 2026-10-16.1");process.exit(0)}
const timed=rd("/tmp/vd_97_times.txt").split("\n").filter(Boolean).map((l)=>{const p=l.split(" ");return {i:Number(p[0]),code:p[1],t:Number(p[2])}});
const bodies=timed.filter((x)=>x.code==="200").map((x)=>({i:x.i,b:js("/tmp/vd_97_m"+x.i+".json"),h:"/tmp/vd_97_m"+x.i+".json.h"})).filter((x)=>x.b&&typeof x.b==="object");
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.max(0,Math.ceil(p*s.length)-1)]:null};
const limitedOnly=timed.every((x)=>x.code==="200"||(x.code==="429"&&(js("/tmp/vd_97_m"+x.i+".json")||{}).error==="rate_limited"));
const bad=timed.filter((x)=>x.code!=="200"&&x.code!=="429");
for(const x of bad){const b=js("/tmp/vd_97_m"+x.i+".json")||{};ok(false,"timed match "+x.i+" -> "+x.code+" "+(b.error||"")+" "+String(b.message||"").slice(0,100)+" (a 500 with the probes above failing = the migrations are missing; 503 = a limiter cannot answer)")}
// Timing (nearest rank over the ten, wall time as curl saw it, cold start included).
if(timed.length===10&&bodies.length===10){
  const t=bodies.map((x)=>timed.find((y)=>y.i===x.i).t);const p50=pct(t,0.5),p90=pct(t,0.9);
  ok(p50<=2.5,"ten synthetic profiles: wall p50 = "+p50.toFixed(2)+" s (gate 2.5 s)");
  ok(p90<=4,"ten synthetic profiles: wall p90 = "+p90.toFixed(2)+" s (gate 4 s)");
  const cand=bodies.map((x)=>Number((x.b.phaseMs||{}).candidates));const c90=pct(cand,0.9);
  ok(Number.isFinite(c90)&&c90<=700,"phaseMs.candidates p90 = "+c90+" ms (gate 700 ms; over it, set RESUME_MATCH_ORDER=recent or cut the ring to 12 places, docs/resume-match.md)");
  // The slowest answer, not the nearest-rank p90 (which drops it): the remote lane is one profile in three.
  const cmax=Math.max(...cand);
  ok(Number.isFinite(cmax)&&cmax<=1200,"phaseMs.candidates max = "+cmax+" ms over the ten (the statement deadline is 1,200 ms; profile "+bodies[cand.indexOf(cmax)].i+")");
  const cpu=bodies.map((x)=>Number(x.b.cpuMs));
  ok(cpu.every((c)=>Number.isFinite(c))&&Math.max(...cpu)<=2000,"cpuMs p50 "+pct(cpu,0.5)+", p90 "+pct(cpu,0.9)+", max "+Math.max(...cpu)+" ms (cap 2,000 ms)");
  // A matcher that returns nothing is not a pass: these are common occupations in large metros.
  const empty=bodies.filter((x)=>!(Array.isArray(x.b.rows)&&x.b.rows.length>0));
  ok(empty.length<=2,(10-empty.length)+" of the 10 answers carry at least one row (gate 8)"+(empty.length?"; no rows for profile "+empty.map((x)=>x.i).join(", "):""));
}else if(bad.length===0){info("only "+bodies.length+" of 10 timed matches answered: "+(limitedOnly?"this network spent its 30 an hour on an earlier run within the hour":"the board meter refused this address")+", so the timings are judged on a later run")}
if(!bodies.length){info("no match answered 200, so the tiers, the canary, the Columbus ring and the wording could not be read");}
else{
  const phases=["anon","ring","candidates","requirements","terms","total"];
  const shapeBad=bodies.filter((x)=>!(x.b.phaseMs&&phases.every((k)=>typeof x.b.phaseMs[k]==="number")&&typeof x.b.cpuMs==="number"&&x.b.build===hdr(x.h,"x-fn-build")&&isOurs(x.b.build)));
  ok(shapeBad.length===0,bodies.length+" answers carry phaseMs {"+phases.join(", ")+"}, cpuMs, and a build equal to their x-fn-build"+(shapeBad.length?" (missing on match "+shapeBad.map((x)=>x.i).join(", ")+")":""));
  const rows=bodies.flatMap((x)=>(Array.isArray(x.b.rows)?x.b.rows:[]));
  const tiers=new Set(["strong","good","stretch"]);const off=rows.filter((r)=>!tiers.has(r.tier));
  if(!rows.length)info("the "+bodies.length+" answers returned no rows, so the tiers could not be judged");
  else ok(off.length===0,rows.length+" rows over "+bodies.length+" answers, every one tiered strong, good or stretch (others: "+JSON.stringify([...new Set(off.map((r)=>r.tier))])+")");
  const unread=rows.filter((r)=>r.requirements==="not read");
  const capBad=unread.filter((r)=>r.tier==="strong"||!(Array.isArray(r.gaps)&&r.gaps.includes("requirements not read")));
  const strayLabel=rows.filter((r)=>r.requirements!=="not read"&&Array.isArray(r.gaps)&&r.gaps.includes("requirements not read"));
  if(!unread.length&&!strayLabel.length)info("no row came back with its requirements unread, so the cap at Good could not be judged ("+rows.length+" rows read)");
  else ok(capBad.length===0&&strayLabel.length===0,unread.length+" of "+rows.length+" rows have requirements not read: each capped at good and labelled requirements not read ("+capBad.length+" not, "+strayLabel.length+" labelled though read)");
  // The canary (match 10): none of its profile values comes back.
  const c=bodies.find((x)=>x.i===10);
  if(!c)info("the canary match did not answer 200, so the echo could not be read");
  else{
    const text=JSON.stringify(c.b);const keys=new Set();const walk=(v)=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==="object")for(const [k,x] of Object.entries(v)){keys.add(k);walk(x)}};walk(c.b);
    const leaked=["workAuth","citizenOf","needsSponsorship","former","licences","clearance"].filter((k)=>keys.has(k));
    ok(!/zqcanary/i.test(text)&&leaked.length===0,"the canary profile (a former job, work authorisation, a licence) is not echoed: former job text "+(/zqcanary/i.test(text)?"FOUND":"absent")+", reader keys "+JSON.stringify(leaked));
    // The Columbus, OH ring.
    const s=c.b.searched||{};const places=Array.isArray(s.places)?s.places:[];const crow=Array.isArray(c.b.rows)?c.b.rows:[];
    const ga=crow.filter((r)=>/,\s*GA\b|\bGeorgia\b/i.test(String(r.location||"")));
    if(s.ringSource==="geonames")ok(places.some((p)=>/^westerville$/i.test(String(p)))&&ga.length===0,"Columbus, OH ring ("+places.length+" places) contains Westerville: "+places.some((p)=>/^westerville$/i.test(String(p)))+"; rows in Georgia: "+ga.length);
    else info("Columbus, OH ring source = "+(s.ringSource||"absent")+" ("+places.join(", ")+"): the GeoNames seed is not applied, so the commute ring is the city itself (docs/resume-match-deploy-notes.md)");
    if(crow.length)ok(ga.length===0,"Columbus, OH: "+crow.length+" rows, "+ga.length+" in Georgia (the place arm reads the state, never the city name alone)");
    else info("Columbus, OH returned no rows, so Columbus, GA could not be told apart");
  }
  // Our own sentences carry no banned word. The list is read from the source.
  const src=rd("supabase/functions/_shared/match-tiers.ts");const m=/export const BANNED_MATCH_WORDS[^=]*=\s*\[([\s\S]*?)\];/.exec(src);
  let banned=[];try{banned=m?Function("return ["+m[1]+"]")():[]}catch{banned=[]}
  const sentences=[];for(const x of bodies){const b=x.b;sentences.push(b.footer,b.summary,...(b.notes||[]),...Object.values(b.setAside||{}).flatMap((v)=>[v&&v.label,v&&v.basis]),...(b.steps||[]).map((v)=>v&&v.label));for(const r of (b.rows||[]))sentences.push(r.placeLine,r.sourceNote,...(r.gaps||[]))}
  const said=sentences.filter((v)=>typeof v==="string"&&v.trim());
  if(banned.length<10)ok(false,"could not read BANNED_MATCH_WORDS from supabase/functions/_shared/match-tiers.ts ("+banned.length+" patterns), so the wording was not checked");
  else if(!said.length)info("no served sentence to read for banned words");
  else{const hits=said.filter((v)=>banned.some((re)=>re.test(v)));ok(hits.length===0,said.length+" served match sentences hold none of the "+banned.length+" banned patterns"+(hits.length?": "+JSON.stringify(hits.slice(0,3)):""))}
}
// The widening follow-up: the step the first answer offered, paid by its token.
const fl=rd("/tmp/vd_97_follow.txt").trim();const fb=js("/tmp/vd_97_f1.json")||{};const m1=js("/tmp/vd_97_m1.json")||{};
if(!fl)info("the widening follow-up was not sent: the first match did not answer 200 with a followUp token and a nextWiden");
else{const fp=fl.split(" ");const fsteps=Array.isArray(fb.steps)?fb.steps.map((s)=>s&&s.step):[];
  ok(fp[0]==="200"&&fsteps.length===1&&fsteps[0]===m1.nextWiden&&Number(fp[1])<=4,"a widening follow-up with the token from the first answer -> "+fp[0]+" "+(fb.error?fb.error+" ":"")+"steps "+JSON.stringify(fsteps)+" (asked "+m1.nextWiden+"), "+fp[1]+" s (want 200, that one step, under 4 s)");}
// No answer missed a deadline: a lane that times out answers an empty page that looks like a thin one.
const answered=[...bodies.map((x)=>({i:String(x.i),b:x.b})),...(fl&&fl.startsWith("200 ")?[{i:"follow-up",b:fb}]:[])];
if(answered.length){const late=answered.filter((x)=>x.b.deadlineMissed);ok(late.length===0,answered.length+" answers, "+late.length+" missed a deadline"+(late.length?": "+late.map((x)=>x.i+" "+x.b.deadlineMissed).join(", "):""))}
// The network bucket: 30 an hour, then 429 from the function itself.
const extra=rd("/tmp/vd_97_rl.txt").split("\n").filter(Boolean).map((l)=>{const p=l.split(" ");return {n:Number(p[0]),code:p[1]}});
const firstTimed=timed.find((x)=>x.code==="429");
const lim=firstTimed?{b:js("/tmp/vd_97_m"+firstTimed.i+".json")||{},h:"/tmp/vd_97_m"+firstTimed.i+".json.h",at:firstTimed.i}:extra.length&&extra[extra.length-1].code==="429"?{b:js("/tmp/vd_97_rl.json")||{},h:"/tmp/vd_97_rl.json.h",at:10+extra.length}:null;
if(lim){
  const b=lim.b;const ra=hdr(lim.h,"retry-after");const fb=hdr(lim.h,"x-fn-build");
  if(b.error==="board_budget")info("call "+lim.at+" was refused by the board meter first (code "+b.code+"), so the 30-an-hour bucket could not be reached from this address");
  else ok(b.error==="rate_limited"&&b.limit===30&&b.scope==="network"&&ra==="3600"&&isOurs(fb),"call "+lim.at+" of this run -> 429 "+(b.error||"")+" limit "+b.limit+" scope "+b.scope+", Retry-After "+(ra||"absent")+", from "+(fb||"no build")+" (want rate_limited, 30, network, 3600)");
}else if(extra.length&&extra[extra.length-1].code!=="200"){const b=js("/tmp/vd_97_rl.json")||{};ok(false,"call "+(10+extra.length)+" -> "+extra[extra.length-1].code+" "+(b.error||"")+" (want 200 until the bucket is spent, then 429 rate_limited)")}
else if(extra.length===21)ok(false,"31 matches from this network in one hour and no 429: the 30-an-hour bucket is not enforced");
else if(bad.length)info("the 429 could not be judged: a timed match failed first");
else info("the 429 could not be judged ("+timed.length+" timed, "+extra.length+" more)");'
