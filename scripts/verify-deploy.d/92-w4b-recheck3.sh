# shellcheck shell=bash
# ── 92. WAVE 4, RECHECK 3 OF THE MERGED BRANCH (2026-10-26): an employer the
# board carries is never named as one it does not carry (docs/wave4/README.md,
# "Recheck 3"), and the crawler is offered what checkout sells (sales stay on,
# owner 2026-10-27, which replaced recheck 3's closed-shop /pricing).
#
# THE CLAIMS, one line each below:
#   - layoff-filings serves 2026-10-11.2 or later (its catalogue copy no
#     longer labels twelve employers' own boards as staffing agencies');
#   - job-board answers companies:["State Farm"] from State Farm's own board
#     (jobs.statefarm.com), never total 0 with State Farm in unknownCompanies;
#   - the crawler's /pricing (Googlebot) carries an Offer at a price above zero
#     (the AggregateOffer up to Pro: the checkouts sell the Full Analysis and
#     Pro with no seller named) and never says "Purchases open soon";
#   - llms.txt never says "Purchases open soon".
# The rest of this round (the experience rule, the success-page repair, the
# cut products' sentence, the trialing retired plan, the test-mode webhook,
# the report mail's sealed copy, the board's writing refusals, the account
# page's resend language) is proved by its tests: each needs a purchase, a
# mail or a signed-in session to read live.
#
# READ-ONLY. One OPTIONS preflight, two GETs and one job-board list read on
# the probe budget.
echo "== 92. w4b recheck 3: layoff-filings, a carried employer by name, and /pricing and llms.txt offering what checkout sells =="

VD92R3_LF=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/layoff-filings" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VD92R3_LF" ]; then echo "FAIL  layoff-filings preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
elif build_ge layoff-filings "$VD92R3_LF" "2026-10-11" "2"; then echo "PASS  layoff-filings x-fn-build = $VD92R3_LF (layoff-filings.2026-10-11.2 or later: the catalogue copy labels no employer's own board an agency's)"
else echo "FAIL  layoff-filings x-fn-build = $VD92R3_LF (want layoff-filings.2026-10-11.2 or later)"; fi

rm -f /tmp/vd_92r3_sf.json /tmp/vd_92r3_pricing.html /tmp/vd_92r3_llms.txt
curl -s -m 60 -o /tmp/vd_92r3_sf.json -X POST "$B/functions/v1/job-board" -H "Content-Type: application/json" -H "x-rb-budget: probe" -H "apikey: $K" -H "Authorization: Bearer $K" -d '{"action":"list","companies":["State Farm"],"limit":10}'
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
const pr=rd("/tmp/vd_92r3_pricing.html");
const lds=[...pr.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m)=>{try{return JSON.parse(m[1])}catch{return null}}).filter(Boolean);
const priced=(v,seen=new Set())=>{if(!v||typeof v!=="object"||seen.has(v))return false;seen.add(v);if(Array.isArray(v))return v.some((x)=>priced(x,seen));const t=String(v["@type"]||"");if(/Offer$/.test(t)&&[v.price,v.highPrice,v.lowPrice].map(Number).some((n)=>Number.isFinite(n)&&n>0))return true;return Object.values(v).some((x)=>priced(x,seen));};
const text=pr.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"\x27").replace(/\s+/g," ");
const soon=/Purchases open soon/.test(text);
if (pr.length<500) line("FAIL","the crawler /pricing answered no page ("+pr.length+" bytes)");
else line(priced(lds)&&!soon?"PASS":"FAIL","the crawler /pricing "+(priced(lds)?"offers what checkout sells (an Offer above zero)":"offers nothing at a price, though checkout sells the Full Analysis and Pro")+(soon?", and still says Purchases open soon (wave 4\x27s closed shop; sales stay on, owner 2026-10-27): publish the frontend":" and never says Purchases open soon"));
const ll=rd("/tmp/vd_92r3_llms.txt");
if (ll.length<1000) line("FAIL","/llms.txt answered no document ("+ll.length+" bytes)");
else { const has=/Purchases open soon/i.test(ll); line(has?"FAIL":"PASS","/llms.txt "+(has?"still says Purchases open soon (wave 4\x27s closed shop; sales stay on, owner 2026-10-27)":"never says Purchases open soon")); }
'
