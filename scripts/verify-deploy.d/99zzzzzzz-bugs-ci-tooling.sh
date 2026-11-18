# shellcheck shell=bash
# ── 99zzzzzzz-bugs-ci-tooling. THE BUG ROUND, PART A, LANE CI-TOOLING (branch
# bugs/a-ci-tooling): S14X-094, S14X-140 and NB-13. No function, no
# migration: the lane changes section 40 and the test harnesses. What it
# proves live is that the checks it changed run and can fail.
#
# Named 99zzzzzzz so it sorts after every 99zzzzzz- file in byte order and
# under a collating locale (verify-deploy.d/README.md).
#
# THE CLAIMS, one tagged line each. None FAILs on today's production before
# the merge: S14X-094's and NB-13's lines read the section this checkout
# carries, and the CI line is INFO until main has run the guard.
#   S14X-094  the live census counts no client-callable definer outside the
#             lists, or section 40's census block, run on the live answer,
#             prints a FAIL for those it counts (it printed INFO until this
#             round, so two stayed unnamed and every run was green). The names
#             are the owner's read: admin-ops client_callable_unlisted_names.
#   S14X-140a checkout_resume_refs refuses the publishable key live: the
#             property the converted webhook-log harness now proves.
#   S14X-140b no pglite harness in this checkout creates the client roles
#             holding nothing and asserts a refusal (helpers/bare-role-
#             harnesses.ts, the guard's own scan, read through tsx; with no
#             tsx, a plain grep). No exception is made here for the harness
#             another lane converts: on a checkout without its conversion this
#             line FAILs, as it should.
#   S14X-140c the latest CI run on main that carries the guard ran its Tests
#             step green. INFO before main carries it, or without gh; when the
#             step failed, a FAIL only if its log names the guard's file.
#   NB-13     section 40 read every table the checkout's migrations create as
#             a stranger (its table sweep wrote one answer per table to
#             /tmp/vd_40_tables.tsv in this run); its own lines judge the rows
#             and the new open tables. The count still private only because of
#             row level security is INFO here.
#
# READ-ONLY. One anon read RPC (client_callable_census), one anon GET of a
# closed table, local reads of the checkout (tsx), and GitHub reads through
# gh (one run list, one run view, one file lookup, a job log only when the
# Tests step failed). Nothing is posted.
echo "== 99zzzzzzz. bug round A, ci-tooling: the census line can fail, the harnesses start from Supabase's grants, every table read as a stranger =="

rm -f /tmp/vd_bct_census.json /tmp/vd_bct_s40.sh /tmp/vd_bct_c40.json /tmp/vd_bct_harness.json /tmp/vd_bct_ci.json /tmp/vd_bct_jobs.json /tmp/vd_bct_log.txt

# S14X-094. Section 40's census block, cut from this checkout, run on the live answer.
R client_callable_census > /tmp/vd_bct_census.json
sed -n '/^R client_callable_census/,/^$/p' scripts/verify-deploy.d/40-db-exposure.sh \
  | sed "s#/tmp/vd_40_census.json#/tmp/vd_bct_c40.json#g; s#^R client_callable_census > .*#cp /tmp/vd_bct_census.json /tmp/vd_bct_c40.json#" > /tmp/vd_bct_s40.sh
VDBCT_UNL=$(node -e 'try{const c=JSON.parse(require("fs").readFileSync("/tmp/vd_bct_census.json","utf8"));process.stdout.write(typeof c.unlisted_client_callable==="number"?String(c.unlisted_client_callable):"unreadable")}catch{process.stdout.write("unreadable")}')
VDBCT_S40=$(bash /tmp/vd_bct_s40.sh 2>&1 | grep -E 'client-callable definer function' | head -1)
if [ "$VDBCT_UNL" = "unreadable" ]; then echo "FAIL  S14X-094 client_callable_census did not answer a count as anon: $(head -c 160 /tmp/vd_bct_census.json)"
elif [ "$VDBCT_UNL" = "0" ]; then echo "PASS  S14X-094 the live census counts no client-callable definer outside the lists"
elif printf '%s' "$VDBCT_S40" | grep -q '^FAIL'; then
  echo "PASS  S14X-094 section 40 FAILs on the $VDBCT_UNL client-callable definer(s) the live census counts outside the lists, where it printed INFO"
  echo "INFO  S14X-094 the owner names them with admin-ops client_callable_unlisted_names (the admin key, a read); each is closed by a revoke or listed with its caller by a census re-issue"
else echo "FAIL  S14X-094 the live census counts $VDBCT_UNL unlisted client-callable definer(s) and section 40 printed: ${VDBCT_S40:-nothing}"; fi

# S14X-140a. The table the webhook-log harness guards, read as a stranger.
VDBCT_CODE=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/rest/v1/checkout_resume_refs?select=stripe_session_id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
{ [ "$VDBCT_CODE" = "401" ] || [ "$VDBCT_CODE" = "403" ]; } && echo "PASS  S14X-140a checkout_resume_refs refuses the publishable key ($VDBCT_CODE): the refusal the webhook-log harness now proves from Supabase's grants" \
  || echo "FAIL  S14X-140a checkout_resume_refs answered the publishable key $VDBCT_CODE (want 401: its REVOKE is missing live)"

# S14X-140b. The guard's own scan of this checkout, without its exception.
npx --no-install tsx -e '
import("./src/test/helpers/bare-role-harnesses.ts").then((m)=>{
  const h=m.scan(process.cwd());
  process.stdout.write(JSON.stringify({via:"tsx",refusing:h.filter((x)=>x.bare&&x.refuses).map((x)=>x.file),bare:h.filter((x)=>x.bare&&!x.refuses).length,overHelper:h.filter((x)=>!x.bare&&x.refuses&&x.bareVia.length>0).length,seen:h.length}));
}).catch(()=>{});' > /tmp/vd_bct_harness.json 2>/dev/null
if ! node -e 'JSON.parse(require("fs").readFileSync("/tmp/vd_bct_harness.json","utf8"))' 2>/dev/null; then
  VDBCT_REF=""
  for VDBCT_F in $(grep -rlE 'CREATE ROLE (IF NOT EXISTS )?anon' src/test 2>/dev/null); do
    grep -qE 'ALTER DEFAULT PRIVILEGES|helpers/(agent-db|supabase-defaults)' "$VDBCT_F" && continue
    grep -qE 'permission denied|42501|has_[a-z_]+_privilege' "$VDBCT_F" && VDBCT_REF="$VDBCT_REF $VDBCT_F"
  done
  VDBCT_REF="$VDBCT_REF" node -e 'const r=(process.env.VDBCT_REF||"").split(" ").filter(Boolean);process.stdout.write(JSON.stringify({via:"grep",refusing:r,bare:null,overHelper:null,seen:null}))' > /tmp/vd_bct_harness.json
fi
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_bct_harness.json","utf8"))}catch{}
if(!j){ok(false,"S14X-140b the harness scan answered nothing: neither tsx nor grep could read src/test");process.exit(0)}
if(j.via==="tsx"&&!(j.seen>100)){ok(false,"S14X-140b the harness scan saw "+j.seen+" files that make or use the client roles (more than 100 on the round): it read the wrong tree");process.exit(0)}
ok(j.refusing.length===0,j.refusing.length?"S14X-140b "+j.refusing.length+" pglite harness(es) create the client roles holding nothing and assert a refusal, which then holds with the REVOKE deleted: "+j.refusing.join(", "):"S14X-140b no pglite harness creates the client roles holding nothing and asserts a refusal ("+j.via+(j.seen?", "+j.seen+" files read":"")+")");
if(j.via==="tsx")info("S14X-140b still bare and named, asserting no refusal: "+j.bare+" file(s); asserting a refusal over a bare helper (another workstream'"'"'s helpers): "+j.overHelper+" file(s); both lists only shrink");
else info("S14X-140b read with grep (no tsx): the bare files that assert no refusal and the helpers'"'"' importers are not counted");'

# S14X-140c. CI on main has run the guard.
VDBCT_GUARD=src/test/every-pglite-harness-that-creates-the-client-roles-starts-from-supabases-default-grants.test.ts
if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  echo "INFO  S14X-140c gh is not installed or not signed in: whether CI on main ran the guard is not read"
else
  gh run list --workflow ci.yml --branch main --limit 1 --json databaseId,headSha,conclusion,status > /tmp/vd_bct_ci.json 2>/dev/null
  VDBCT_RUN=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync("/tmp/vd_bct_ci.json","utf8"))[0]||{};process.stdout.write(String(r.databaseId||"")+" "+String(r.headSha||""))}catch{}')
  VDBCT_ID=${VDBCT_RUN%% *}; VDBCT_SHA=${VDBCT_RUN#* }
  if [ -z "$VDBCT_ID" ] || [ -z "$VDBCT_SHA" ]; then echo "INFO  S14X-140c the CI runs on main could not be listed"
  elif ! gh api "repos/{owner}/{repo}/contents/$VDBCT_GUARD?ref=$VDBCT_SHA" --jq .name >/dev/null 2>&1; then
    echo "INFO  S14X-140c the latest CI run on main ($VDBCT_ID, ${VDBCT_SHA:0:8}) predates the guard: judged once main carries it"
  else
    gh run view "$VDBCT_ID" --json databaseId,jobs > /tmp/vd_bct_jobs.json 2>/dev/null
    VDBCT_STEP=$(VDBCT_ID="$VDBCT_ID" node -e '
let j={};try{j=JSON.parse(require("fs").readFileSync("/tmp/vd_bct_jobs.json","utf8"))}catch{}
if(String(j.databaseId||"")!==process.env.VDBCT_ID){process.stdout.write("unread");process.exit(0)}
const t=(j.jobs||[]).find((x)=>x.name==="test");const s=t&&(t.steps||[]).find((x)=>/^Tests\b/.test(String(x.name)));
process.stdout.write(s?(s.conclusion||s.status||"pending")+" "+t.databaseId:"missing");')
    case "$VDBCT_STEP" in
      success*) echo "PASS  S14X-140c CI run $VDBCT_ID on main (${VDBCT_SHA:0:8}) carries the guard and its Tests step passed";;
      failure*) gh run view --job "${VDBCT_STEP#* }" --log > /tmp/vd_bct_log.txt 2>/dev/null
        if grep -qE "(FAIL|×).*every-pglite-harness-that-creates-the-client-roles" /tmp/vd_bct_log.txt; then echo "FAIL  S14X-140c CI run $VDBCT_ID on main (${VDBCT_SHA:0:8}): the default-grants guard failed"
        else echo "INFO  S14X-140c CI run $VDBCT_ID on main (${VDBCT_SHA:0:8}): the Tests step failed, and its log does not name the guard among the failures"; fi;;
      unread|missing) echo "INFO  S14X-140c CI run $VDBCT_ID on main: its test job or Tests step could not be read ($VDBCT_STEP)";;
      *) echo "INFO  S14X-140c CI run $VDBCT_ID on main (${VDBCT_SHA:0:8}) has not finished its Tests step (${VDBCT_STEP%% *})";;
    esac
  fi
fi

# NB-13. Section 40's table sweep, read back from this run.
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const lines=(f)=>{try{return fs.readFileSync(f,"utf8").split("\n").filter(Boolean)}catch{return null}};
const want=lines("/tmp/vd_40_tables.txt"),got=lines("/tmp/vd_40_tables.tsv");
if(!want||!got){ok(false,"NB-13 section 40 left no table sweep in this run (/tmp/vd_40_tables.txt and .tsv): it is an older section 40, or the sweep stopped");process.exit(0)}
const age=(Date.now()-fs.statSync("/tmp/vd_40_tables.tsv").mtimeMs)/3600000;
if(age>6){ok(false,"NB-13 the table sweep on disk is "+age.toFixed(1)+" h old: section 40 did not sweep in this run, and an earlier run is not this deploy");process.exit(0)}
const rows=got.map((l)=>l.split("\t"));const read=new Set(rows.map((r)=>r[0]));
const missing=want.map((l)=>l.split(" ")[0]).filter((t)=>!read.has(t));
ok(want.length>=100&&missing.length===0,want.length<100?"NB-13 section 40 parsed only "+want.length+" tables from the migrations":missing.length?"NB-13 section 40 left "+missing.length+" table(s) unread: "+missing.slice(0,10).join(", "):"NB-13 section 40 read every one of the "+want.length+" tables the migrations create as a stranger; its own lines judge rows and new open tables");
const n=(f)=>rows.filter(f).length;
info("NB-13 the sweep: "+n((r)=>r[2]==="401"||r[2]==="403")+" refused, "+n((r)=>r[2]==="200"&&r[3]==="empty")+" open with no row visible (private only because of row level security), "+n((r)=>r[2]==="200"&&r[3]==="rows")+" serving rows, "+n((r)=>r[2]==="404")+" not served");'
