# The deploy ledger after a deploy: anything main carries that production does
# not answer is a FAIL. Read-only: OPTIONS preflights and git/file reads
# (scripts/deploy-ledger.mjs; rules in docs/DEPLOY-LEDGER.md).
echo "== 49. deploy ledger: main vs production =="
L49=$(node scripts/deploy-ledger.mjs --json 2>/dev/null)
if [ -z "$L49" ]; then echo "FAIL  the deploy ledger did not run (node scripts/deploy-ledger.mjs --json)"; else
printf '%s' "$L49" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const j=JSON.parse(s);
  if(!j.toDeploy.length) console.log("PASS  every function with a build marker answers the build main carries ("+j.rows.length+" functions)");
  for(const r of j.toDeploy) console.log("FAIL  "+r.fn+" answers "+(r.have||"no x-fn-build")+"; main carries "+r.want);
  for(const r of j.unbumped) console.log("FAIL  "+r.fn+": code changed after its live stamp "+r.want+" -- bump FN_BUILD and deploy");
  for(const r of j.sharedOnly) console.log("INFO  "+r.fn+": a _shared import changed after its live stamp ("+r.changedSinceStamp.map(p=>p.split("/").pop()).join(", ")+")");
  if(!j.migrations.pending.length) console.log("PASS  no migration on main is missing from the staged-runner record");
  for(const f of j.migrations.pending) console.log("FAIL  migration not applied: "+f);
  for(const f of j.migrations.hold) console.log("INFO  held until its prerequisites verify: "+f);
  if(j.noMarker.length) console.log("INFO  no build marker, so not verifiable: "+j.noMarker.map(r=>r.fn).join(", "));
});'
fi
