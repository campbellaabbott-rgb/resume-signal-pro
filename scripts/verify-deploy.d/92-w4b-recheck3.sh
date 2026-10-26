# shellcheck shell=bash
# ── 92. WAVE 4, RECHECK 3 OF THE MERGED BRANCH (2026-10-26): an employer the
# board carries is never named as one it does not carry, and nothing is
# offered to a crawler before it can be bought (docs/wave4/README.md,
# "Recheck 3").
#
# THE CLAIMS, one line each below:
#   - layoff-filings serves 2026-10-11.2 or later (its catalogue copy no
#     longer labels twelve employers' own boards as staffing agencies');
#   - job-board answers companies:["State Farm"] from State Farm's own board
#     (jobs.statefarm.com), never total 0 with State Farm in unknownCompanies;
#   - while create-checkout's GET says purchasesOpen false, the crawler's
#     /pricing (Googlebot) carries no Offer at a price above zero and says
#     "Purchases open soon"; once it says true, an AggregateOffer is expected;
#   - llms.txt says "Purchases open soon" exactly while purchases are closed.
# The rest of this round (the experience rule, the success-page repair, the
# cut products' sentence, the trialing retired plan, the test-mode webhook,
# the report mail's sealed copy, the marketing pause on the page, the board's
# writing refusals, the account page's resend language) is proved by its
# tests: each needs a purchase, a mail or a signed-in session to read live.
#
# READ-ONLY. One OPTIONS preflight, three GETs and one job-board list read on
# the probe budget.
echo "== 92. w4b recheck 3: layoff-filings, a carried employer by name, /pricing and llms.txt while purchases are closed =="

VD92R3_LF=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/layoff-filings" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD92R3_LF" ]; then echo "FAIL  layoff-filings preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge layoff-filings "$VD92R3_LF" "2026-10-11" "2"; then echo "PASS  layoff-filings x-fn-build = $VD92R3_LF (layoff-filings.2026-10-11.2 or later: the catalogue copy labels no employer's own board an agency's)"
else echo "FAIL  layoff-filings x-fn-build = $VD92R3_LF (want layoff-filings.2026-10-11.2 or later)"; fi

rm -f /tmp/vd_92r3_sf.json /tmp/vd_92r3_cc.json /tmp/vd_92r3_pricing.html /tmp/vd_92r3_llms.txt
curl -s -m 60 -o /tmp/vd_92r3_sf.json -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","companies":["State Farm"],"limit":10}'
curl -s -m 30 -o /tmp/vd_92r3_cc.json "$B/functions/v1/create-checkout" -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s -m 30 -A "$UA" "$SITE/pricing" > /tmp/vd_92r3_pricing.html
curl -s -m 60 -A "$UA" "$SITE/llms.txt" > /tmp/vd_92r3_llms.txt
node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const line=(s,m)=>console.log(s.padEnd(5)+" "+m);
let sf=null;try{sf=JSON.parse(rd("/tmp/vd_92r3_sf.json"))}catch{}
if (!sf) line("FAIL","job-board companies:[\"State Farm\"] answered no JSON");
else {
  const unk=Array.isArray(sf.unknownCompanies)&&sf.unknownCompanies.includes("State Farm");
  const res=Array.isArray(sf.companiesResolved)?sf.companiesResolved.find((r)=>r&&r.asked==="State Farm"):null;
  const toks=res&&Array.isArray(res.tokens)?res.tokens:[];
  const total=Number(sf.total);
  line(!unk&&toks.includes("jobs.statefarm.com")&&total>0?"PASS":"FAIL","job-board companies:[\"State Farm\"] serves "+(sf.total??"?")+" rows"+(toks.length?" from "+toks.join(","):"")+(unk?", and names State Farm in unknownCompanies":"")+" (want State Farm\x27s own board, jobs.statefarm.com, and never unknownCompanies)");
}
let cc=null;try{cc=JSON.parse(rd("/tmp/vd_92r3_cc.json"))}catch{}
const open=cc&&typeof cc.purchasesOpen==="boolean"?cc.purchasesOpen:null;
const pr=rd("/tmp/vd_92r3_pricing.html");
const lds=[...pr.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m)=>{try{return JSON.parse(m[1])}catch{return null}}).filter(Boolean);
const priced=(v,seen=new Set())=>{if(!v||typeof v!=="object"||seen.has(v))return false;seen.add(v);if(Array.isArray(v))return v.some((x)=>priced(x,seen));const t=String(v["@type"]||"");if(/Offer$/.test(t)&&[v.price,v.highPrice,v.lowPrice].map(Number).some((n)=>Number.isFinite(n)&&n>0))return true;return Object.values(v).some((x)=>priced(x,seen));};
const text=pr.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"\x27").replace(/\s+/g," ");
const soon=/Purchases open soon/.test(text);
if (open===null) line("FAIL","create-checkout GET carries no purchasesOpen ("+(rd("/tmp/vd_92r3_cc.json").slice(0,80)||"no answer")+"), so the /pricing offer cannot be judged");
else if (pr.length<500) line("FAIL","the crawler /pricing answered no page ("+pr.length+" bytes)");
else if (!open) line(!priced(lds)&&soon?"PASS":"FAIL","purchases are closed (create-checkout purchasesOpen false) and the crawler /pricing "+(priced(lds)?"still offers a price in its structured data":"offers nothing at a price")+(soon?" and says Purchases open soon":", but never says Purchases open soon"));
else line(priced(lds)&&!soon?"PASS":"INFO","purchases are open (create-checkout purchasesOpen true); the crawler /pricing "+(priced(lds)?"offers what is sold":"offers no price yet (republish the frontend)")+(soon?", but still says Purchases open soon":""));
const ll=rd("/tmp/vd_92r3_llms.txt");
if (ll.length<1000) line("FAIL","/llms.txt answered no document ("+ll.length+" bytes)");
else if (open!==null) { const has=/Purchases open soon/.test(ll); line(has===!open?"PASS":"FAIL","/llms.txt "+(has?"says":"does not say")+" Purchases open soon while purchases are "+(open?"open":"closed")); }
'
