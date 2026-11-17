# shellcheck shell=bash
# ── 99zzzzzzz-bugs-ci-tooling-b. THE BUG ROUND, PART B, LANE CI-TOOLING-B
# (branch bugs/b-ci-tooling): S14X-136, S14X-137, S14X-138, S14X-139,
# S14X-246, RC-OI-47b, RC-S13-108 and NB-33. No function, no migration: the
# lane changes CI, the Deploy workflow, the deploy ledger, the post-publish
# smoke and sections 49, 78 and 92. What it proves is that each of those now
# says what it did not check, and can fail.
#
# Named 99zzzzzzz so it sorts after every 99zzzzzz- file in byte order and
# under a collating locale (verify-deploy.d/README.md).
#
# THE CLAIMS, one tagged line each. None FAILs on today's production before
# the merge: the GitHub lines are INFO until main carries the change, and the
# rest read this checkout.
#   S14X-136a this checkout's CI runs scripts/check-functions.sh --check-only
#             in the deno-tests job, after setup-deno and before the Deno
#             tests, each step running unless the run was cancelled; the
#             script refuses any other argument.
#   S14X-136b the latest CI run on main whose ci.yml carries that step ran it
#             green (red is a function or Deno test deno check refuses).
#   S14X-137  every function's MUST BUMP anchor in the ledger's JSON is the
#             commit that last wrote its build declaration (git blame of the
#             first non-comment line holding the build), moved to a later
#             verified deploy of that build, recomputed here.
#   RC-OI-47b every pending or held migration that reads the vault is an
#             owner step, and none sits in a numbered Lovable step.
#   NB-33     the ledger lists the calls a function makes to what only an
#             unapplied migration creates, and exits 6 while one is not
#             recorded under absentTolerant (section 49 FAILs each).
#   S14X-138  this checkout's post-publish smoke, run under NO_SCAN=1 and
#             NO_INDEXNOW=1 against a stand-in for every address it reads
#             (nothing leaves this machine, and its probe row is not written),
#             prints SKIP for the three checks it did not run, never PASS,
#             and ends PARTIAL, not ALL CLEAR.
#   S14X-139a GitHub main's deploy.yml verifies through the ledger's
#             --push-verdict, not job-board's BUILD_VERSION alone (INFO while
#             main predates it; this checkout's file without gh).
#   S14X-139b the latest Deploy run on main that ran the new step: a green
#             "Deploy verified" names every function its push changed, each
#             at that commit's build or later; "No function changed" only on
#             a push that changed none.
#   S14X-246  GitHub main's deploy.yml runs no supabase db push and asks no
#             apply_migrations input (INFO while main predates this round).
#   RC-S13-108 section 92's mail-watch count is never a PASS: its cron block,
#             run on the live get_cron_health and on a fixed row of 96 runs
#             with none failed, prints INFO for what pg_cron queued.
#
# READ-ONLY. One anon read RPC (get_cron_health), the ledger's --json
# (OPTIONS preflights and git fetch origin main), the smoke against a local
# stand-in for fetch, git and file reads of this checkout, and GitHub reads
# through gh (run lists, run views, file contents, one job's annotations).
echo "== 99zzzzzzz. bug round B, ci-tooling-b: CI type-checks the functions, the ledger anchors on the declaration and stops what Lovable cannot do, the smoke and the Deploy check say what they did not check, section 92 =="

rm -f /tmp/vd_bctb_ci.json /tmp/vd_bctb_ciyml.txt /tmp/vd_bctb_jobs.json /tmp/vd_bctb_ledger.json /tmp/vd_bctb_stub.mjs /tmp/vd_bctb_requests.log /tmp/vd_bctb_smoke.txt /tmp/vd_bctb_deploy.yml /tmp/vd_bctb_dep.json /tmp/vd_bctb_depyml.txt /tmp/vd_bctb_depjobs.json /tmp/vd_bctb_ann.json /tmp/vd_bctb_s92.sh /tmp/vd_bctb_cron.json /tmp/vd_bctb_cronfix.json /tmp/vd_bctb_c92.json
rm -rf /tmp/vd_bctb_home
VDBCTB_GH=0
command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && VDBCTB_GH=1

# S14X-136a. This checkout's CI and its gate.
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const code=rd(".github/workflows/ci.yml").split("\n").filter((l)=>!/^\s*#/.test(l));
const start=code.findIndex((l)=>/^  deno-tests:\s*$/.test(l));
let end=code.length;for(let i=start+1;start>=0&&i<code.length;i++){if(/^  [A-Za-z0-9_-]+:\s*$/.test(code[i])){end=i;break}}
const job=start<0?[]:code.slice(start,end);
const at=(re)=>job.findIndex((l)=>re.test(l));
const stepOf=(i)=>{if(i<0)return "";let s=i;while(s>0&&!/^\s*- /.test(job[s]))s--;let e=i+1;while(e<job.length&&!/^\s*- /.test(job[e]))e++;return job.slice(s,e).join("\n")};
const deno=at(/uses:\s*denoland\/setup-deno/),check=at(/bash scripts\/check-functions\.sh --check-only/),tests=at(/bash scripts\/deno-tests\.sh/);
const gate=rd("scripts/check-functions.sh");
const why=[];
if(start<0)why.push("ci.yml has no deno-tests job");
else if(check<0)why.push("the deno-tests job runs no check-functions.sh --check-only");
else{if(!(deno>=0&&deno<check))why.push("the check runs before setup-deno");if(!(tests>check))why.push("the Deno tests do not follow the check");
  if(!/!cancelled\(\)/.test(stepOf(check)))why.push("the check step can be skipped by an earlier failure");
  if(tests>=0&&!/!cancelled\(\)/.test(stepOf(tests)))why.push("the tests step can be skipped by the check");}
if(!/--check-only\) CHECK_ONLY=1/.test(gate))why.push("scripts/check-functions.sh has no --check-only");
if(!/unknown argument[^\n]*exit 2/.test(gate))why.push("scripts/check-functions.sh does not refuse an unknown argument");
ok(why.length===0,why.length?"S14X-136a CI does not type-check every edge function as this round set it: "+why.join("; "):"S14X-136a CI type-checks every edge function and its Deno tests (check-functions.sh --check-only) after setup-deno and before the tests, and neither step is skipped by the other");'

# S14X-136b. The latest CI run on main that carries the step.
if [ "$VDBCTB_GH" != 1 ]; then echo "INFO  S14X-136b gh is not installed or not signed in: whether CI on main ran the type check is not read"
else
  gh run list --workflow ci.yml --branch main --limit 1 --json databaseId,headSha,conclusion,status > /tmp/vd_bctb_ci.json 2>/dev/null
  VDBCTB_RUN=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync("/tmp/vd_bctb_ci.json","utf8"))[0]||{};process.stdout.write(String(r.databaseId||"")+" "+String(r.headSha||""))}catch{}')
  VDBCTB_ID=${VDBCTB_RUN%% *}; VDBCTB_SHA=${VDBCTB_RUN#* }
  if [ -z "$VDBCTB_ID" ] || [ -z "$VDBCTB_SHA" ]; then echo "INFO  S14X-136b the CI runs on main could not be listed"
  else
    gh api "repos/{owner}/{repo}/contents/.github/workflows/ci.yml?ref=$VDBCTB_SHA" -H "Accept: application/vnd.github.raw" > /tmp/vd_bctb_ciyml.txt 2>/dev/null
    if ! grep -q -- 'check-functions.sh --check-only' /tmp/vd_bctb_ciyml.txt; then echo "INFO  S14X-136b the latest CI run on main ($VDBCTB_ID, ${VDBCTB_SHA:0:8}) predates the type check step: judged once main carries it"
    else
      gh run view "$VDBCTB_ID" --json databaseId,jobs > /tmp/vd_bctb_jobs.json 2>/dev/null
      VDBCTB_ID="$VDBCTB_ID" VDBCTB_SHA="$VDBCTB_SHA" node -e '
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
let j={};try{j=JSON.parse(require("fs").readFileSync("/tmp/vd_bctb_jobs.json","utf8"))}catch{}
const id=process.env.VDBCTB_ID,sha=process.env.VDBCTB_SHA.slice(0,8);
if(String(j.databaseId||"")!==id){info("S14X-136b the jobs of CI run "+id+" could not be read");process.exit(0)}
const job=(j.jobs||[]).find((x)=>x.name==="deno-tests");
const step=job&&(job.steps||[]).find((s)=>/^Edge-function type check/.test(String(s.name)));
if(!job)ok(false,"S14X-136b CI run "+id+" on main ("+sha+") lists no deno-tests job, though its ci.yml carries the check");
else if(!step&&job.status!=="completed")info("S14X-136b CI run "+id+" on main ("+sha+") has not reached the type check yet ("+job.status+")");
else if(!step)ok(false,"S14X-136b CI run "+id+" on main ("+sha+"): the deno-tests job ran no type check step, though its ci.yml carries one");
else if(step.conclusion==="success")ok(true,"S14X-136b CI run "+id+" on main ("+sha+") type-checked every edge function and its Deno tests: success");
else if(step.conclusion==="failure")ok(false,"S14X-136b CI run "+id+" on main ("+sha+"): deno check refuses a function or a Deno test on main (read the deno-tests job log)");
else info("S14X-136b CI run "+id+" on main ("+sha+"): the type check step is "+(step.conclusion||step.status||"pending"));'
    fi
  fi
fi

# S14X-137, RC-OI-47b and NB-33. The ledger's JSON, read with this checkout's history.
node scripts/deploy-ledger.mjs --json > /tmp/vd_bctb_ledger.json 2>/dev/null
VDBCTB_LX=$? node -e '
const fs=require("fs");const {execFileSync}=require("child_process");
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const lx=String(process.env.VDBCTB_LX||"");
let j=null;try{j=JSON.parse(fs.readFileSync("/tmp/vd_bctb_ledger.json","utf8"))}catch{}
if(!j){for(const k of ["S14X-137","RC-OI-47b","NB-33"])ok(false,k+" the ledger printed no JSON (exit "+lx+"): not judged");process.exit(0)}
let pol={};try{pol=JSON.parse(fs.readFileSync("docs/deploy-ledger.json","utf8"))}catch{}
const git=(...a)=>execFileSync("git",a,{encoding:"utf8",stdio:["ignore","pipe","ignore"],maxBuffer:1<<28}).trim();
const anc=(a,b)=>{try{execFileSync("git",["merge-base","--is-ancestor",a,b],{stdio:"ignore"});return true}catch{return false}};
const bad=[];let n=0;
for(const r of (j.rows||[])){
  if(!r.want||!r.stampCommit)continue;
  const m=/\.(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(r.want);if(!m)continue;
  const p="supabase/functions/"+r.fn+"/index.ts";
  let src="";try{src=git("show","HEAD:"+p)}catch{continue}
  const seq=new RegExp("(?<![0-9])"+m[1]+"\\."+m[2]+"(?![0-9])");
  const i=src.split("\n").findIndex((l)=>seq.test(l)&&!/^\s*(\/\/|\*|\/\*)/.test(l));
  if(i<0)continue;
  let c="";try{c=git("blame","-L",(i+1)+","+(i+1),"--porcelain","HEAD","--",p).split(/\s/)[0]}catch{continue}
  for(const d of [...(pol.verifiedDeploys||[])].reverse()){if(!d.functions||d.functions[r.fn]!==r.want)continue;if(anc(c,d.commit))c=git("rev-parse",d.commit);break}
  n++;
  if(c.slice(0,8)!==r.stampCommit)bad.push(r.fn+" (ledger "+r.stampCommit+", declaration "+c.slice(0,8)+")");
}
ok(n>0&&bad.length===0,n===0?"S14X-137 no row of the ledger carries a stamp commit to recompute (no stampCommit, or no history in this checkout)":bad.length?"S14X-137 the MUST BUMP anchor is not the commit that wrote the build declaration for "+bad.length+" of "+n+" function(s): "+bad.slice(0,8).join(", "):"S14X-137 all "+n+" functions are anchored on the commit that wrote their build declaration (or a later verified deploy of that build), never on a comment naming it");
const mig=j.migrations||{};const files=[...(mig.pending||[]),...(mig.hold||[])];
const vault=files.filter((f)=>{try{return /\bvault\s*\.|decrypted_secrets/i.test(fs.readFileSync("supabase/migrations/"+f,"utf8"))}catch{return false}});
if(!Array.isArray(j.ownerSteps))ok(false,"RC-OI-47b the ledger JSON has no ownerSteps: a migration that reads the vault would be one of Lovable\x27s steps ("+vault.length+" pending or held read it now)");
else{const ph=j.phases||{};const inLovable=[...(ph.pre||[]),...(ph.afterFunctions||[]),...(ph.afterFrontend||[])].map((x)=>x.file);
  const miss=vault.filter((f)=>!j.ownerSteps.some((s)=>s.file===f));const listed=j.ownerSteps.map((s)=>s.file).filter((f)=>inLovable.includes(f));
  ok(!miss.length&&!listed.length,miss.length?"RC-OI-47b pending migrations read the vault and are not owner steps: "+miss.join(", "):listed.length?"RC-OI-47b owner steps sit in a numbered Lovable step: "+listed.join(", "):"RC-OI-47b every pending or held migration that reads the vault is an owner step and in no Lovable step ("+vault.length+" now; "+(mig.neverApplyPresent||[]).length+" file(s) never apply by decision)");}
const a=j.aheadOfMigration;
if(!a||!Array.isArray(a.calls))ok(false,"NB-33 the ledger JSON has no aheadOfMigration: a function calling what only an unapplied migration creates deploys unchecked");
else{const un=a.calls.filter((c)=>!c.tolerated);
  if(!un.length)ok(true,"NB-33 no function calls what only an unapplied migration creates without absentTolerant saying how it copes ("+a.calls.length+" recorded)");
  else ok(lx==="6","NB-33 "+un.length+" call(s) run ahead of their migration unrecorded, and the ledger "+(lx==="6"?"refuses the message for them (exit 6); section 49 FAILs each until absentTolerant records how the function copes":"exits "+lx+", not 6: the message is not refused"));}'

# S14X-138. The smoke, run against a stand-in for every address it reads.
cat > /tmp/vd_bctb_stub.mjs <<'VDBCTB_STUB'
import { appendFileSync, readFileSync } from "node:fs";
const E = process.env;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = String(init.method || "GET").toUpperCase();
  appendFileSync(E.VDBCTB_LOG, method + " " + url.href + "\n");
  const p = url.pathname;
  if (url.hostname === "resumebooster.work") {
    if (p === "/") return new Response("<html></html>", { status: 200 });
    if (p === "/sitemap.xml") return new Response(readFileSync(E.VDBCTB_SITEMAP, "utf8"), { status: 200 });
    if (p === "/industries/healthcare") return new Response("<html><meta name=x-prerendered></html>", { status: 200 });
    if (p === "/prerender-ledger.json") return json(200, { builtAt: "2026-11-17", pages: {}, postings: {} });
  }
  if (url.hostname.endsWith(".supabase.co")) {
    if (p.startsWith("/.well-known/")) return json(404, { error_code: "not_found" });
    if (p === "/functions/v1/agent-mcp" && method === "POST") {
      const m = JSON.parse(String(init.body || "{}"));
      if (m.method === "initialize") return json(200, { jsonrpc: "2.0", id: m.id, result: { serverInfo: { version: "stand-in" }, _meta: { [E.VDBCTB_META]: { state: "off", checkedAt: new Date().toISOString() } } } });
      return json(200, { jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: "needs a key" }] } });
    }
    const fn = p.match(/^\/functions\/v1\/([a-z0-9-]+)$/);
    if (fn && method === "OPTIONS") return new Response("ok", { status: 200 });
    if (fn && fn[1] === "create-product-checkout") return json(410, { retired: true, cut: true, product: "premium_package" });
    const rpc = p.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
    if (rpc && rpc[1] === "get_scan_health_status") return json(200, [{ last_heartbeat_status: "healthy", last_heartbeat_time: new Date(Date.now() - 300000).toISOString(), issues: [] }]);
    if (rpc && rpc[1] === "no_such_function_deploy_control") return json(404, { code: "PGRST202" });
    if (rpc && rpc[1] === "get_company_hiring_health") return json(200, [{ tracking_days: 30 }]);
    if (rpc) return json(200, []);
    if (p === "/rest/v1/job_board_postings" && url.searchParams.get("select") === "id") return json(401, { code: "42501" });
    if (p.startsWith("/rest/v1/")) return json(200, []);
  }
  throw new Error("the stand-in knows no " + method + " " + url.href);
};
VDBCTB_STUB
mkdir -p /tmp/vd_bctb_home
: > /tmp/vd_bctb_requests.log
VDBCTB_STUB_URL=$(node -e 'process.stdout.write(require("url").pathToFileURL(process.argv[1]).href)' /tmp/vd_bctb_stub.mjs)
VDBCTB_META=$(sed -n 's/^export const SIGN_IN_META_KEY = "\([^"]*\)";.*/\1/p' supabase/functions/agent-mcp/as-probe.ts | head -1)
env -u INDEXNOW_SEND -u INDEXING_SEND -u HEARTBEAT_SECRET -u SYNTHETIC_SCAN_SECRET -u SITE \
  HOME=/tmp/vd_bctb_home NO_SCAN=1 NO_INDEXNOW=1 VDBCTB_LOG=/tmp/vd_bctb_requests.log VDBCTB_SITEMAP="$PWD/public/sitemap.xml" VDBCTB_META="$VDBCTB_META" \
  node --import "$VDBCTB_STUB_URL" scripts/post-publish-smoke.mjs > /tmp/vd_bctb_smoke.txt 2>&1
node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);
let t="";try{t=fs.readFileSync("/tmp/vd_bctb_smoke.txt","utf8")}catch{}
let req="";try{req=fs.readFileSync("/tmp/vd_bctb_requests.log","utf8")}catch{}
const L=t.split("\n").filter(Boolean);
const passNotRun=L.filter((l)=>/^PASS /.test(l)&&/SKIPPED|UNVERIFIED|not run|not read/.test(l));
const skips=L.filter((l)=>/^SKIP /.test(l)).map((l)=>l.slice(6).split(" — ")[0]);
const want=["free scan end-to-end","AI generation live","engine version fresh"];
const last=L[L.length-1]||"";
const verdict=/^PARTIAL — 3 check\(s\) not run/.test(last)||/\(and 3 check\(s\) not run: /.test(t);
if(!req.trim())ok(false,"S14X-138 the smoke made no request through the stand-in, so nothing was judged: "+(L.slice(-2).join(" / ")||"no output"));
else{const why=[];
  if(passNotRun.length)why.push("a check it did not run printed PASS: "+passNotRun[0].slice(0,120));
  const missing=want.filter((n)=>!skips.includes(n));if(missing.length)why.push("no SKIP for "+missing.join(", "));
  if(/ALL CLEAR/.test(t))why.push("the verdict reads ALL CLEAR with the scan skipped");
  else if(!verdict)why.push("the verdict does not name the 3 checks it did not run: "+last.slice(0,120));
  ok(!why.length,why.length?"S14X-138 under NO_SCAN=1 the smoke "+why.join("; "):"S14X-138 under NO_SCAN=1 the smoke prints SKIP for the scan, the model and the engine, no PASS for a check it did not run, and ends: "+last.slice(0,140));}'

# S14X-139a and S14X-246. The Deploy workflow as GitHub main has it.
VDBCTB_DEPSRC="this checkout (no gh)"
cp .github/workflows/deploy.yml /tmp/vd_bctb_deploy.yml 2>/dev/null
if [ "$VDBCTB_GH" = 1 ]; then
  if gh api "repos/{owner}/{repo}/contents/.github/workflows/deploy.yml?ref=main" -H "Accept: application/vnd.github.raw" > /tmp/vd_bctb_depyml.txt 2>/dev/null && [ -s /tmp/vd_bctb_depyml.txt ]; then
    cp /tmp/vd_bctb_depyml.txt /tmp/vd_bctb_deploy.yml; VDBCTB_DEPSRC="GitHub main"
  else VDBCTB_DEPSRC="this checkout (GitHub main unread)"; fi
fi
VDBCTB_DEPSRC="$VDBCTB_DEPSRC" node -e '
const fs=require("fs");const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const src=process.env.VDBCTB_DEPSRC;
let y="";try{y=fs.readFileSync("/tmp/vd_bctb_deploy.yml","utf8")}catch{}
if(!y){ok(false,"S14X-139a deploy.yml could not be read from "+src);ok(false,"S14X-246 deploy.yml could not be read from "+src);process.exit(0)}
const code=y.split("\n").filter((l)=>!/^\s*#/.test(l)).join("\n");
const v=code.indexOf("\n  verify:");const verify=v<0?"":code.slice(v);
const pushVerdict=/node scripts\/deploy-ledger\.mjs --push-verdict/.test(verify);
const jobBoardOnly=/BUILD_VERSION = /.test(verify)||/job-board\/index\.ts/.test(verify);
const pre=src==="GitHub main"&&!pushVerdict;
if(pre)info("S14X-139a GitHub main\x27s deploy.yml predates this round: its verify job compares job-board alone; judged once main carries it");
else ok(pushVerdict&&!jobBoardOnly,"S14X-139a "+src+": the verify job "+(pushVerdict&&!jobBoardOnly?"judges every function the push changed (deploy-ledger.mjs --push-verdict)":pushVerdict?"runs --push-verdict and still reads job-board\x27s BUILD_VERSION":"does not run the ledger\x27s --push-verdict: it compares job-board alone"));
const pushes=(code.match(/supabase\s+db\s+push/g)||[]).length;const input=/apply_migrations/.test(code);
if(pre)info("S14X-246 GitHub main\x27s deploy.yml predates this round ("+pushes+" supabase db push step(s)); judged once main carries it");
else ok(pushes===0&&!input,"S14X-246 "+src+": "+(pushes===0&&!input?"no job pushes migrations (no supabase db push, no apply_migrations input)":pushes+" supabase db push step(s)"+(input?" and an apply_migrations input":"")+": a dispatch applies past neverApply, holds and order"));'

# S14X-139b. The latest Deploy run on main, by its annotations.
if [ "$VDBCTB_GH" != 1 ]; then echo "INFO  S14X-139b gh is not installed or not signed in: the latest Deploy run is not read"
else
  gh run list --workflow deploy.yml --branch main --limit 1 --json databaseId,headSha,conclusion,status > /tmp/vd_bctb_dep.json 2>/dev/null
  VDBCTB_DRUN=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync("/tmp/vd_bctb_dep.json","utf8"))[0]||{};process.stdout.write(String(r.databaseId||"")+" "+String(r.headSha||""))}catch{}')
  VDBCTB_DID=${VDBCTB_DRUN%% *}; VDBCTB_DSHA=${VDBCTB_DRUN#* }
  if [ -z "$VDBCTB_DID" ] || [ -z "$VDBCTB_DSHA" ]; then echo "INFO  S14X-139b the Deploy runs on main could not be listed"
  elif ! gh api "repos/{owner}/{repo}/contents/.github/workflows/deploy.yml?ref=$VDBCTB_DSHA" -H "Accept: application/vnd.github.raw" 2>/dev/null | grep -q -- '--push-verdict'; then
    echo "INFO  S14X-139b the latest Deploy run on main ($VDBCTB_DID, ${VDBCTB_DSHA:0:8}) predates the per-function check: judged once main runs it"
  else
    gh run view "$VDBCTB_DID" --json databaseId,jobs > /tmp/vd_bctb_depjobs.json 2>/dev/null
    VDBCTB_VJ=$(VDBCTB_DID="$VDBCTB_DID" node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_bctb_depjobs.json","utf8"));if(String(j.databaseId)!==process.env.VDBCTB_DID)process.exit(0);const v=(j.jobs||[]).find((x)=>x.name==="verify");process.stdout.write(v?String(v.databaseId)+" "+String(v.conclusion||v.status||""):"")}catch{}')
    if [ -z "$VDBCTB_VJ" ]; then echo "INFO  S14X-139b Deploy run $VDBCTB_DID lists no verify job that could be read"
    else
      gh api "repos/{owner}/{repo}/check-runs/${VDBCTB_VJ%% *}/annotations" > /tmp/vd_bctb_ann.json 2>/dev/null
      VDBCTB_DSHA="$VDBCTB_DSHA" VDBCTB_DID="$VDBCTB_DID" VDBCTB_VC="${VDBCTB_VJ#* }" node --input-type=module -e '
import { readFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; import { pathToFileURL } from "node:url";
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const sha=process.env.VDBCTB_DSHA,id=process.env.VDBCTB_DID,concl=process.env.VDBCTB_VC;
let ann=[];try{ann=JSON.parse(readFileSync("/tmp/vd_bctb_ann.json","utf8"))}catch{}
if(!Array.isArray(ann)){info("S14X-139b the verify job annotations of Deploy run "+id+" could not be read");process.exit(0)}
const find=(t)=>ann.find((a)=>a&&a.title===t);
const verified=find("Deploy verified"),none=find("No function changed"),behind=find("Deployed code is not this commit"),unread=find("Deploy not verified");
const git=(...a)=>execFileSync("git",a,{encoding:"utf8",stdio:["ignore","pipe","ignore"],maxBuffer:1<<28}).trim();
let changed=null;try{changed=[...new Set(git("diff","--name-only",sha+"^1",sha,"--","supabase/functions").split("\n").map((f)=>(/^supabase\/functions\/([^/]+)\//.exec(f)||[])[1]).filter((f)=>f&&f!=="_shared"))].sort()}catch{}
if(concl==="success"&&verified){
  const L=await import(pathToFileURL(process.cwd()+"/scripts/deploy-ledger.mjs").href);
  const builds=String(verified.message||"").replace(/^.*?or later: /,"").split(", ").filter(Boolean);
  const short=[];const listed=new Set();
  for(const b of builds){const fn=b.replace(/\.\d{4}-\d{2}-\d{2}\.\d+$/,"");listed.add(fn);let src=null;try{src=git("show",sha+":supabase/functions/"+fn+"/index.ts")}catch{}const want=L.buildOf(fn,src);if(!want||!L.buildAtLeast(b,want))short.push(b+" (that commit is "+(want||"unreadable")+")")}
  const omitted=changed===null?[]:changed.filter((f)=>!listed.has(f));
  ok(builds.length>0&&!short.length&&!omitted.length,"S14X-139b Deploy run "+id+" on main ("+sha.slice(0,8)+") said Deploy verified "+(short.length?"for builds older than its commit: "+short.join(", "):omitted.length?"without naming functions its commit changed: "+omitted.join(", "):builds.length?"for every function its push changed, each at its commit\x27s build or later: "+builds.join(", "):"naming no build"));
}else if(concl==="success"&&none){
  if(changed===null)info("S14X-139b Deploy run "+id+" said no function changed; commit "+sha.slice(0,8)+" is not in this checkout to check");
  else ok(changed.length===0,"S14X-139b Deploy run "+id+" on main ("+sha.slice(0,8)+") said no function changed"+(changed.length?", though its commit changed "+changed.join(", "):", and its commit changed none"));
}else if(behind)info("S14X-139b Deploy run "+id+" ("+concl+") compared and production was behind its commit: "+String(behind.message||"").slice(0,200)+" (re-run its verify job after the Lovable deploy)");
else if(unread)info("S14X-139b Deploy run "+id+" ("+concl+") could not compare: "+String(unread.message||"").slice(0,200));
else info("S14X-139b Deploy run "+id+" ("+concl+") carries no verdict of the per-function check");'
    fi
  fi
fi

# RC-S13-108. Section 92's cron block, on the live answer and on a fixed row.
sed -n '/^R get_cron_health/,/^$/p' scripts/verify-deploy.d/92-w4b-payments-delivery.sh \
  | sed -e 's#^R get_cron_health .*#cp "$VDBCTB_CRON" "$VDBCTB_C92"#' -e 's#"[^"]*vd_92_cron\.json"#process.env.VDBCTB_C92#g' > /tmp/vd_bctb_s92.sh
R get_cron_health '{"p_hours":24}' > /tmp/vd_bctb_cron.json
echo '[{"ch_jobname":"mail-watch","ch_schedule":"*/15 * * * *","ch_active":true,"ch_runs":96,"ch_failed":0,"ch_last_status":"succeeded"}]' > /tmp/vd_bctb_cronfix.json
VDBCTB_L92=$(VDBCTB_CRON=/tmp/vd_bctb_cron.json VDBCTB_C92=/tmp/vd_bctb_c92.json bash /tmp/vd_bctb_s92.sh 2>&1 | grep -E 'mail-watch (posts|command|ran|has not run)' | head -1)
VDBCTB_F92=$(VDBCTB_CRON=/tmp/vd_bctb_cronfix.json VDBCTB_C92=/tmp/vd_bctb_c92.json bash /tmp/vd_bctb_s92.sh 2>&1 | grep -E 'mail-watch (posts|command|ran|has not run)' | head -1)
case "$VDBCTB_F92" in
  "INFO  pg_cron queued 96 mail-watch posts"*)
    case "$VDBCTB_L92" in
      PASS*) echo "FAIL  RC-S13-108 section 92 printed a PASS from pg_cron's queue on the live answer: $VDBCTB_L92" ;;
      "") echo "PASS  RC-S13-108 section 92 prints 96 queued runs as INFO, never PASS (the live answer lists no mail-watch run line to print)" ;;
      *) echo "PASS  RC-S13-108 section 92 never passes mail-watch on pg_cron's word; live: ${VDBCTB_L92:0:150}" ;;
    esac ;;
  *) echo "FAIL  RC-S13-108 section 92, given 96 runs with none failed, printed: ${VDBCTB_F92:-nothing} (want INFO: a queued post is not what mail-watch answered)" ;;
esac
