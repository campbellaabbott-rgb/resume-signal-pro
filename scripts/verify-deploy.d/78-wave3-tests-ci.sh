# Sourced by scripts/verify-deploy.sh (K, B and the helpers are in scope).
#
# == wave 3, tests-ci (docs/wave3/tests-ci.md) ==
# THE CLAIMS:
#   - five functions that named no build now answer this branch's build or
#     later on the preflight (S8-124); layoff-filings' BUILD_VERSION moved with
#     it, judged from .3: the wave 3 integration build that carries both this
#     branch's .2 (the header) and wave3/board-data-ingest's .1 (the parsers).
#     job-fit and application-fit are stamped by wave3/job-board (section 71);
#   - the board's outside alarm (board-health.yml) parses, runs on its
#     schedule, and reads two fields the board publishes (L12-01);
#   - CI on main runs every check whatever an earlier one said, runs the Deno
#     tests and the guards on built output, and its `test` job can pass
#     (L12-02 interim, L12-04, L12-10, L12-11, S8-130);
#   - the bot-wall sweep and the deploy check's verify job have what they read
#     (L12-07, L12-08).
# READ-ONLY: OPTIONS preflights, one job-board status read (x-rb-budget:
# probe), and GitHub reads through `gh` (run lists and one job log). Without
# gh, or before these commits are on main, the GitHub lines are INFO/FAIL by
# design: they judge what main has run since the change.
echo "== 78. wave 3 tests-ci: stamps, the outside alarm, CI on main =="

for P78 in create-test-coupon:2 generate-cohort-report:2 scrape-linkedin:2 warm-up:2 layoff-filings:3; do
  FN=${P78%%:*}; N78=${P78#*:}
  V78=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$V78" ]; then echo "FAIL  $FN preflight carries no x-fn-build (not deployed since it was stamped; want $FN.2026-10-09.$N78 or later)"
  elif build_ge "$FN" "$V78" 2026-10-09 "$N78"; then echo "PASS  $FN preflight x-fn-build = $V78 ($FN.2026-10-09.$N78 or later)"
  else echo "FAIL  $FN preflight x-fn-build = $V78 (want $FN.2026-10-09.$N78 or later)"; fi
done

# The alarm's two inputs, read the way board-health.yml reads them: a numeric
# lastSliceAgeMin and a parseable sliceStats.workAt. Absent, the alarm fires.
J '{"action":"status"}' > /tmp/vd_78_status.json
node -e '
let j={};try{j=JSON.parse(require("fs").readFileSync("/tmp/vd_78_status.json","utf8"))}catch{}
const a=j.lastSliceAgeMin,w=(j.sliceStats||{}).workAt,wm=(Date.now()-Date.parse(w))/60000;
const ok=typeof a==="number"&&Number.isFinite(wm);
console.log((ok?"PASS":"FAIL")+"  the alarm can read both stamps: lastSliceAgeMin="+JSON.stringify(a)+", sliceStats.workAt="+JSON.stringify(w)+(ok?"":" -- board-health would raise its issue on every run"));
if(ok)console.log((a<=360&&wm<=360?"INFO":"FAIL")+"  by the alarm'"'"'s own rule the board is "+(a<=360&&wm<=360?"breathing":"NOT breathing")+": slice admitted "+a+" min ago, last slice work "+Math.round(wm)+" min ago (bar 360 each)");'

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  echo "INFO  gh is not installed or not signed in: the GitHub lines below are skipped (scheduled board-health runs, CI on main, the sweep, the deploy check)"
else
  VD78_SINCE=$(git log -1 --format=%cI -- .github/workflows/board-health.yml 2>/dev/null)
  gh run list --workflow board-health.yml --limit 30 --json event,conclusion,createdAt > /tmp/vd_78_bh.json 2>/dev/null
  gh run list --workflow ci.yml --branch main --limit 20 --json databaseId,conclusion,createdAt,headSha > /tmp/vd_78_ci.json 2>/dev/null
  gh run list --workflow botwall-sweep.yml --limit 5 --json event,conclusion,createdAt > /tmp/vd_78_bw.json 2>/dev/null
  gh run list --workflow deploy.yml --branch main --limit 1 --json databaseId,conclusion,createdAt > /tmp/vd_78_dep.json 2>/dev/null
  VD78_CI=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync("/tmp/vd_78_ci.json","utf8"));process.stdout.write(String((r[0]||{}).databaseId||""))}catch{}')
  [ -n "$VD78_CI" ] && gh run view "$VD78_CI" --json jobs > /tmp/vd_78_ci_jobs.json 2>/dev/null
  VD78_DEP=$(node -e 'try{const r=JSON.parse(require("fs").readFileSync("/tmp/vd_78_dep.json","utf8"));process.stdout.write(String((r[0]||{}).databaseId||""))}catch{}')
  [ -n "$VD78_DEP" ] && gh run view "$VD78_DEP" --log > /tmp/vd_78_dep.log 2>/dev/null
  VD78_SINCE="$VD78_SINCE" node -e '
const fs=require("fs");const rd=(f)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return null}};
const ok=(c,m)=>console.log((c?"PASS":"FAIL")+"  "+m);const info=(m)=>console.log("INFO  "+m);
const since=Date.parse(process.env.VD78_SINCE||"");
const bh=rd("/tmp/vd_78_bh.json")||[];const sched=bh.filter((r)=>r.event==="schedule"&&(!Number.isFinite(since)||Date.parse(r.createdAt)>=since));
if(!bh.length)ok(false,"board-health has no runs GitHub can list");
else{const last=sched[0];
  ok(!!last&&Date.now()-Date.parse(last.createdAt)<=90*60000,"board-health ran on its schedule within 90 min: "+(last?last.createdAt+" ("+last.conclusion+"), "+sched.length+" scheduled run(s) since the workflow last changed":"none since "+process.env.VD78_SINCE+" -- the file on main still does not parse, or main does not carry the fix")+" (before 2026-10-10: 561 runs, every one a 0-second push failure)");
  if(last&&last.conclusion==="failure")info("the latest scheduled board-health run FAILED: the probe found the board unhealthy, and its issue (label board-health) says why");}
const ci=rd("/tmp/vd_78_ci.json")||[];
if(ci.length){const green=ci.filter((r)=>r.conclusion==="success").length;info("CI on main: "+green+" of the last "+ci.length+" runs green (5 of 20 before wave 3: of the 15 red, 14 failed on flaky render or race tests and 1 on the over-budget light-list case)");}
const jobs=((rd("/tmp/vd_78_ci_jobs.json")||{}).jobs)||[];
const job=(n)=>jobs.find((x)=>x.name===n);
if(!jobs.length)info("the latest CI run on main lists no jobs (not finished, or not readable)");
else{
  for(const n of ["test","deno-tests"]){const j=job(n);ok(!!j&&j.conclusion==="success","CI on main, latest run: job "+n+" "+(j?j.conclusion||j.status:"MISSING -- main does not carry the wave-3 ci.yml"));}
  const t=job("test");if(t&&Array.isArray(t.steps)){const skipped=t.steps.filter((s)=>s.conclusion==="skipped"&&!/^(Post |Set up job|Complete job)/.test(String(s.name))).map((s)=>s.name);ok(skipped.length===0,"no check in the test job was skipped by an earlier failure"+(skipped.length?": "+skipped.join(", "):""));}
  const b=job("built-output");info("CI on main, latest run: built-output "+(b?b.conclusion||b.status:"MISSING")+" (the guards on dist/ judge live data baked at build time; red here is a finding about the site, see docs/wave3/tests-ci.md)");
}
const bw=(rd("/tmp/vd_78_bw.json")||[]).filter((r)=>r.event==="schedule");const bl=bw[0];
if(!bl||(Number.isFinite(since)&&Date.parse(bl.createdAt)<since))info("the bot-wall sweep has not run on a schedule since this change (Mondays 06:12 UTC)"+(bl?"; last: "+bl.createdAt+" "+bl.conclusion:""));
else ok(bl.conclusion==="success","the bot-wall sweep'"'"'s latest scheduled run: "+bl.createdAt+" "+bl.conclusion+" (9 of 9 failed 2026-08-10..10-05)");
let log="";try{log=fs.readFileSync("/tmp/vd_78_dep.log","utf8")}catch{}
if(!log)info("the latest Deploy run'"'"'s log could not be read");
else if(/cannot verify what is live/.test(log))ok(false,"the latest Deploy run still ran the old verify step (no URL or key: it compared nothing)");
else if(/Deploy verified/.test(log))ok(true,"the latest Deploy run compared the live job-board build and it matched this commit or later");
else if(/Deployed code is not this commit/.test(log))info("the latest Deploy run compared and production was behind that commit at push time: re-run its verify job after the Lovable deploy");
else info("the latest Deploy run'"'"'s verify step printed neither verdict (it may have failed to read: see its log)");'
fi
