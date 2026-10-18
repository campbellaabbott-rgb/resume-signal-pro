# The deploy ledger after a deploy: anything main carries that production does
# not answer is a FAIL. Read-only: OPTIONS preflights, one anon GET of
# get_cron_health (a migration's behaviour proof), `git fetch origin main` and
# git/file reads (scripts/deploy-ledger.mjs; rules in docs/DEPLOY-LEDGER.md).
# A function whose preflight did not answer is a FAIL too: it was not checked,
# and with every preflight failing the ledger used to list 0 to deploy and this
# section printed PASS (S11-048). A held migration whose every condition is
# live is a FAIL until it is released (S12-032); a declared rollback is a
# deploy like any other (S12-161); a migration with no stub that production
# shows applied is INFO, not "not applied" (S12-162).
echo "== 49. deploy ledger: main vs production =="
L49=$(node scripts/deploy-ledger.mjs --json 2>/dev/null)
if [ -z "$L49" ]; then echo "FAIL  the deploy ledger did not run (node scripts/deploy-ledger.mjs --json)"; else
printf '%s' "$L49" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j;try{j=JSON.parse(s)}catch{console.log("FAIL  the deploy ledger printed no JSON");return}
  const unreachable=j.unreachable||j.rows.filter(r=>r.state==="unreachable");
  const mig=j.migrations||{};
  if(j.checkout&&j.checkout.refusal) console.log("FAIL  the ledger ran from a checkout that is not GitHub main ("+j.checkout.refusal+"): the lines below judge this checkout, not what Lovable deployed");
  if(!j.toDeploy.length&&!unreachable.length) console.log("PASS  every function with a build marker answers the build main carries ("+j.rows.length+" functions)");
  for(const r of j.toDeploy) console.log("FAIL  "+r.fn+" answers "+(r.have||"no x-fn-build")+"; main carries "+r.want+(r.rollbackFrom?" (a declared rollback: deploy main\x27s build)":""));
  for(const r of unreachable) console.log("FAIL  "+r.fn+": could not check, its preflight did not answer twice (main carries "+r.want+") -- re-run");
  for(const r of j.unbumped) console.log("FAIL  "+r.fn+": code changed after its live stamp "+r.want+" -- bump FN_BUILD and deploy (or, if the deploy of this very commit verified, record it: node scripts/deploy-ledger.mjs --record-deploy)");
  for(const r of j.sharedOnly) console.log("INFO  "+r.fn+": a _shared import changed after its live stamp ("+r.changedSinceStamp.map(p=>p.split("/").pop()).join(", ")+")");
  const why=new Map((mig.unproven||[]).map(u=>[u.file,u.why]));
  if(!mig.pending.length) console.log("PASS  no migration on main is missing from the staged-runner record or its behaviour proof");
  for(const f of mig.pending) console.log("FAIL  migration not applied: "+f+(why.has(f)?" (its behaviour proof: "+why.get(f)+")":""));
  for(const p of (mig.appliedByBehaviour||[])) console.log("INFO  applied by behaviour, no stub: "+p.file+" (get_cron_health lists "+p.jobs.join(", ")+" active)");
  const holds=Array.isArray(j.holds)?j.holds:null;
  if(holds){
    for(const h of holds){
      const cs=(h.conditions||[]).map(c=>c.fn+" "+(c.met?"answers "+c.have:"answers "+(c.have||"nothing")+", wants "+c.need+" or later")).join("; ");
      if(h.releasable) console.log("FAIL  held migration "+h.file+" is RELEASABLE: every condition it names is live ("+cs+"). Confirm what only you can check ("+(h.until||"its hold")+"), release it in docs/deploy-ledger.json and send its message");
      else console.log("INFO  held until its conditions are live: "+h.file+" ("+(cs||"no condition the ledger can check")+")");
    }
  } else for(const f of mig.hold||[]) console.log("INFO  held until its prerequisites verify: "+f);
  for(const st of (j.staleHolds||[])) console.log("INFO  holdUntilVerified names "+st+", which is no pending migration (applied, or no such file): remove the entry");
  for(const e of ((j.phases||{}).errors||[])) console.log("FAIL  migration order rule cannot be met: "+e);
  for(const v of (j.late||[])) console.log("FAIL  late stamp: "+v.pending+" touches "+v.objects.join(", ")+", which the later, applied "+v.applied+" defines -- applying it would put the older definition back");
  for(const r of (j.liveAhead||[])) console.log("FAIL  "+r.fn+" answers "+r.have+", later than the "+r.want+" main carries: main is behind production, and a deploy from it would roll this back (merge what is live, or declare the rollback under rollbacks in docs/deploy-ledger.json)");
  for(const x of (j.staleRollbacks||[])) console.log("INFO  docs/deploy-ledger.json rollbacks names "+x.fn+" from "+x.from+", which it no longer answers ahead of main: remove the entry");
  if(j.noMarker.length) console.log("INFO  no build marker, so not verifiable: "+j.noMarker.map(r=>r.fn).join(", "));
});'
fi
