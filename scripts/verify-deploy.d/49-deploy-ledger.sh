# The deploy ledger after a deploy: anything main carries that production does
# not answer is a FAIL. Read-only: OPTIONS preflights, `git fetch origin main`
# and git/file reads (scripts/deploy-ledger.mjs; rules in docs/DEPLOY-LEDGER.md).
# A function whose preflight did not answer is a FAIL too: it was not checked,
# and with every preflight failing the ledger used to list 0 to deploy and this
# section printed PASS (S11-048).
echo "== 49. deploy ledger: main vs production =="
L49=$(node scripts/deploy-ledger.mjs --json 2>/dev/null)
if [ -z "$L49" ]; then echo "FAIL  the deploy ledger did not run (node scripts/deploy-ledger.mjs --json)"; else
printf '%s' "$L49" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j;try{j=JSON.parse(s)}catch{console.log("FAIL  the deploy ledger printed no JSON");return}
  const unreachable=j.unreachable||j.rows.filter(r=>r.state==="unreachable");
  if(j.checkout&&j.checkout.refusal) console.log("FAIL  the ledger ran from a checkout that is not GitHub main ("+j.checkout.refusal+"): the lines below judge this checkout, not what Lovable deployed");
  if(!j.toDeploy.length&&!unreachable.length) console.log("PASS  every function with a build marker answers the build main carries ("+j.rows.length+" functions)");
  for(const r of j.toDeploy) console.log("FAIL  "+r.fn+" answers "+(r.have||"no x-fn-build")+"; main carries "+r.want);
  for(const r of unreachable) console.log("FAIL  "+r.fn+": could not check, its preflight did not answer twice (main carries "+r.want+") -- re-run");
  for(const r of j.unbumped) console.log("FAIL  "+r.fn+": code changed after its live stamp "+r.want+" -- bump FN_BUILD and deploy");
  for(const r of j.sharedOnly) console.log("INFO  "+r.fn+": a _shared import changed after its live stamp ("+r.changedSinceStamp.map(p=>p.split("/").pop()).join(", ")+")");
  if(!j.migrations.pending.length) console.log("PASS  no migration on main is missing from the staged-runner record");
  for(const f of j.migrations.pending) console.log("FAIL  migration not applied: "+f);
  for(const f of j.migrations.hold) console.log("INFO  held until its prerequisites verify: "+f);
  for(const e of ((j.phases||{}).errors||[])) console.log("FAIL  migration order rule cannot be met: "+e);
  for(const v of (j.late||[])) console.log("FAIL  late stamp: "+v.pending+" touches "+v.objects.join(", ")+", which the later, applied "+v.applied+" defines -- applying it would put the older definition back");
  for(const r of (j.liveAhead||[])) console.log("FAIL  "+r.fn+" answers "+r.have+", later than the "+r.want+" main carries: main is behind production, and a deploy from it would roll this back");
  if(j.noMarker.length) console.log("INFO  no build marker, so not verifiable: "+j.noMarker.map(r=>r.fn).join(", "));
});'
fi
