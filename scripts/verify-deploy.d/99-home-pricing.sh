# shellcheck shell=bash
# ── 99. HOME-PRICING, THE SWITCH-OVER: "/" is the board-first homepage and
# /pricing the new pricing page (docs/homepage-pricing/README.md, step 14;
# reservation home-pricing, deployOrder 5). A FRONTEND + PRERENDER deploy,
# plus the builds the reservation names, so the crawler claims are judged on
# the served documents with the Googlebot UA and the rendered claims in one
# headless browser whose writes are answered inside it.
# Sourced by scripts/verify-deploy.sh; $SITE, $UA, $B, $K and build_ge are in
# scope.
#
# THE CLAIMS:
#   C1  "/" serves the owner's H1, a <form action="/jobs" method="get"> with
#       q and location, and a count line whose figure and stamp are
#       get_board_vendor_counts' openTotal and as_of ("N open postings ·
#       counted D, T UTC"), read by this section; equal when the row has not
#       refreshed since the publish, within a tenth of it and older when it
#       has. No floored "950,000+" figure.
#   C2  "/" carries no "new · " flow pairing and no word "verified".
#   C3  Every /jobs/field/ link on "/" is one of the category list's slugs
#       (src/lib/job-board-categories.ts), never retail or hospitality.
#   C4  "/pricing" says all sales are final, names the EU, the EEA, the UK and
#       India, and names the currency and the time-zone checks, never a
#       billing address, an IP address or a lookup (W5); "/" the same for its
#       territory line.
#   C5  While this checkout's src/config/seller.ts names no seller: no Offer
#       at a price in the JSON-LD of "/" or "/pricing", no buy control in the
#       baked HTML, and the /pricing description names no price.
#   C6  The builds home-pricing carries: free-keyword-scan 2026-10-25.2 (H0),
#       send-scan-report and send-search-digest 2026-10-25.1, send-market-pulse
#       2026-10-25.2 (the scanner's own address in their links), and
#       create-subscription-checkout 2026-10-26.1 (Pro's list says packages)
#       and create-product-checkout 2026-10-26.1 (it bundles that list), each
#       that build or a later one.
#   C7  The page React renders: the homepage's own chunk (named in the served
#       "/") carries its sentences and none of the retired homepage hero's
#       strings, and the entry every page loads does not carry them (they ride
#       with the page since the review round of 2026-10-26).
#   C8  (headless) "/#upload" lands on /resume-checker at its uploader (the
#       scanner scrolls to #upload and then clears the hash, as it always has),
#       and /resume-checker still renders the scanner's uploader.
#   C9  (headless, the rendered "/" and "/pricing", header and footer
#       included) no Freelance Boost, Transition Pro, Premium, Scan Pack or
#       "unlimited" anywhere, and exactly one filled button across header
#       and main.
#   C10 The apply agent is retired (agent_sender_public_status false, or
#       /trust says it is switched off); while neither holds, "/" and
#       "/pricing" carry no "never submit".
#   C11 (owner decision 2026-10-25) "/pricing" says Pro is billed in US
#       dollars and how the Full Analysis is charged, "/" its strip's
#       currency line for the rows it shows; neither page puts both products
#       in one currency or promises "your local currency"; a Full Analysis
#       Offer anywhere carries pricingPlans.fa.currency as its description.
#   G4  (W6, a ledger precondition) is printed as a note.
#
# READ-ONLY: GETs of the site and of two anon RPCs (PostgREST runs a GET in a
# read-only transaction), OPTIONS preflights, and one headless browser whose
# every non-GET request is answered inside it (an RPC is re-sent as a GET, a
# job-board list read carries x-rb-budget: probe). Before the deploy C1-C9
# and C11 FAIL by design. VD99_RENDER=0 skips the browser (INFO).
echo "== 99. home-pricing: the board-first homepage and the new pricing page =="

REPO_ROOT99="${VD99_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
rm -f /tmp/vd_99_home.html /tmp/vd_99_pricing.html /tmp/vd_99_trust.html /tmp/vd_99_vc.json /tmp/vd_99_agent.json /tmp/vd_99_entry.js /tmp/vd_99_homechunk.js
curl -s -m 30 -A "$UA" "$SITE/" > /tmp/vd_99_home.html
curl -s -m 30 -A "$UA" "$SITE/pricing" > /tmp/vd_99_pricing.html
curl -s -m 30 -A "$UA" "$SITE/trust" > /tmp/vd_99_trust.html
curl -s -m 30 -o /tmp/vd_99_vc.json "$B/rest/v1/rpc/get_board_vendor_counts" -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s -m 30 -o /tmp/vd_99_agent.json "$B/rest/v1/rpc/agent_sender_public_status" -H "apikey: $K" -H "Authorization: Bearer $K"
VD99_ENTRY=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_99_home.html | head -1)
if [ -n "$VD99_ENTRY" ]; then curl -s -m 60 "$SITE$VD99_ENTRY" > /tmp/vd_99_entry.js; fi
VD99_HOMECHUNK=$(grep -oE 'HomePage-[A-Za-z0-9_-]+\.js' /tmp/vd_99_home.html | head -1)
if [ -n "$VD99_HOMECHUNK" ]; then curl -s -m 60 "$SITE/assets/$VD99_HOMECHUNK" > /tmp/vd_99_homechunk.js; fi

# ---- C6: the builds the reservation carries ----
for VD99_PAIR in "free-keyword-scan|2026-10-25|2" "send-scan-report|2026-10-25|1" "send-search-digest|2026-10-25|1" "send-market-pulse|2026-10-25|2" "create-subscription-checkout|2026-10-26|1" "create-product-checkout|2026-10-26|1"; do
  VD99_FN="${VD99_PAIR%%|*}"; VD99_REST="${VD99_PAIR#*|}"; VD99_DAY="${VD99_REST%%|*}"; VD99_N="${VD99_REST#*|}"
  VD99_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VD99_FN" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
  if [ -z "$VD99_H" ]; then echo "FAIL  C6 $VD99_FN preflight carries no x-fn-build (not deployed, or the previous bundle is serving)"
  elif build_ge "$VD99_FN" "$VD99_H" "$VD99_DAY" "$VD99_N"; then echo "PASS  C6 $VD99_FN x-fn-build = $VD99_H ($VD99_FN.$VD99_DAY.$VD99_N or later)"
  else echo "FAIL  C6 $VD99_FN x-fn-build = $VD99_H (want $VD99_FN.$VD99_DAY.$VD99_N or later)"; fi
done

REPO_ROOT="$REPO_ROOT99" node -e '
const fs=require("fs");const rd=(f)=>{try{return fs.readFileSync(f,"utf8")}catch{return ""}};
const line=(s,m)=>console.log(s.padEnd(5)+" "+m);
const R=process.env.REPO_ROOT;
const text=(h)=>h.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&#39;/g,"\x27").replace(/&quot;/g,"\"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
const lds=(h)=>[...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m)=>{try{return JSON.parse(m[1])}catch{return null}}).filter(Boolean);
const offers=(v,out=[],seen=new Set())=>{if(!v||typeof v!=="object"||seen.has(v))return out;seen.add(v);if(Array.isArray(v)){v.forEach((x)=>offers(x,out,seen));return out}if(/Offer$/.test(String(v["@type"]||"")))out.push(v);Object.values(v).forEach((x)=>offers(x,out,seen));return out};
const priced=(o)=>[o.price,o.highPrice,o.lowPrice].map(Number).some((n)=>Number.isFinite(n)&&n>0);
let H={},P={};try{H=JSON.parse(rd(R+"/src/i18n/shards/home/en.json")).home||{}}catch{}try{P=JSON.parse(rd(R+"/src/i18n/shards/pricing/en.json")).pricingPlans||{}}catch{}
const home=rd("/tmp/vd_99_home.html"), pricing=rd("/tmp/vd_99_pricing.html"), trust=rd("/tmp/vd_99_trust.html");
const ht=text(home), pt=text(pricing);
if (home.length<500) line("FAIL","the crawler / answered no page ("+home.length+" bytes): nothing on it can be judged");
if (pricing.length<500) line("FAIL","the crawler /pricing answered no page ("+pricing.length+" bytes)");
if (!H.hero||!P.meta) line("FAIL","this checkout has no homepage or pricing strings (src/i18n/shards/home|pricing/en.json): the sentences below cannot be judged");

// ---- C1: the headline, the form, the one figure ----
if (home.length>=500) {
  const h1=((home.match(/<h1\b[^>]*>([^<]*)<\/h1>/)||[])[1]||"").replace(/&#39;/g,"\x27").trim();
  const want="Live jobs, straight from employers\x27 own hiring systems.";
  const form=(home.match(/<form\b[^>]*action="\/jobs"[^>]*method="get"[\s\S]*?<\/form>/i)||[""])[0];
  const formOk=/name="q"/.test(form)&&/name="location"/.test(form);
  line(h1===want&&formOk?"PASS":"FAIL","C1 / serves the H1 \""+h1.slice(0,70)+"\""+(h1===want?"":" (want \""+want+"\")")+(formOk?" and a GET /jobs form with q and location":", and no GET /jobs form with q and location"));
  const floor=ht.match(/\b\d{1,3}(?:,\d{3})*,000\+/);
  if (floor) line("FAIL","C1 / prints a floored figure \""+floor[0]+"\": the count must be the exact openTotal with its moment");
  const cl=(home.match(/data-home-count="">([\s\S]*?)<\/p>/)||[])[1];
  let vc=null;try{vc=JSON.parse(rd("/tmp/vd_99_vc.json"))}catch{}
  const live=vc&&typeof vc==="object"&&!Array.isArray(vc)?{total:Number(vc.openTotal),at:Date.parse(String(vc.as_of||""))}:null;
  if (cl===undefined) line("FAIL","C1 / carries no count line (data-home-count): the homepage is not the one this section judges");
  else {
    const fig=Number(((text(cl).match(/^([\d,]+) open postings? · counted /)||[])[1]||"").replace(/,/g,""));
    const iso=(cl.match(/<time datetime="([^"]+)"/)||[])[1]||"";
    const at=Date.parse(iso);
    const stampText=(text(cl).match(/counted (\d{1,2} \w{3} \d{4}), (\d\d:\d\d) UTC/)||[]);
    if (!text(cl)) line(live&&Number.isFinite(live.total)?"FAIL":"INFO","C1 / prints no open-postings figure (the bake could not read the board"+(live&&Number.isFinite(live.total)?"; the board answers "+live.total+" now: republish":", and neither can this section")+")");
    else if (!Number.isFinite(fig)||!fig||!Number.isFinite(at)||!stampText.length) line("FAIL","C1 / count line is not \"N open postings · counted D, T UTC\" with its <time datetime>: \""+text(cl).slice(0,90)+"\"");
    else if (!live||!Number.isFinite(live.total)||!Number.isFinite(live.at)) line("INFO","C1 / prints "+fig.toLocaleString("en-US")+" counted "+iso+"; get_board_vendor_counts answered no row to compare ("+rd("/tmp/vd_99_vc.json").slice(0,80)+")");
    else if (at===live.at) line(fig===live.total?"PASS":"FAIL","C1 / prints "+fig.toLocaleString("en-US")+" open postings counted "+iso+", and the row says "+live.total.toLocaleString("en-US")+" at the same moment");
    else if (at<live.at&&Math.abs(fig-live.total)<=live.total*0.1) line("PASS","C1 / prints "+fig.toLocaleString("en-US")+" open postings counted "+iso+" (the read the publish made); the row has refreshed since, to "+live.total.toLocaleString("en-US")+" at "+new Date(live.at).toISOString()+", within a tenth of it");
    else line("FAIL","C1 / prints "+fig.toLocaleString("en-US")+" counted "+iso+" against the row\x27s "+live.total.toLocaleString("en-US")+" at "+new Date(live.at).toISOString()+(at>live.at?": a moment later than the row itself":": more than a tenth apart"));
  }
}

// ---- C2: no flow pairing, never verified ----
if (home.length>=500) {
  const bad=[/new · /.test(ht)&&"a \"new · \" flow pairing", (/verified/i.test(ht)||/verified/i.test(JSON.stringify(lds(home))))&&"the word verified"].filter(Boolean);
  line(bad.length?"FAIL":"PASS","C2 / "+(bad.length?"carries "+bad.join(" and "):"carries no flow pairing and no \"verified\", prose or structured data"));
}

// ---- C3: field links from the category list ----
if (home.length>=500) {
  const cat=rd(R+"/src/lib/job-board-categories.ts");
  const slugs=new Set([...((cat.match(/BOARD_CATEGORY_SLUGS[^=]*=\s*\[([\s\S]*?)\]/)||[])[1]||"").matchAll(/"([a-z_]+)"/g)].map((m)=>m[1]));
  const links=[...home.matchAll(/href="\/jobs\/field\/([^"/?#]+)"/g)].map((m)=>m[1]);
  const stray=links.filter((s)=>!slugs.has(s)||s==="retail"||s==="hospitality");
  if (!slugs.size) line("FAIL","C3 this checkout\x27s category list (src/lib/job-board-categories.ts BOARD_CATEGORY_SLUGS) could not be read");
  else if (!links.length) line("FAIL","C3 / links no field page");
  else line(stray.length?"FAIL":"PASS","C3 / links "+links.length+" field pages"+(stray.length?", "+stray.length+" outside the category list: "+stray.join(", "):", every one a category slug ("+links.join(", ")+")"));
}

// ---- C4: the territory, said before any click ----
{
  const terr=(t)=>({final:/All sales are final/.test(t),names:/EU/.test(t)&&/EEA/.test(t)&&/\bUK\b/.test(t)&&/India/.test(t),checks:/currency/.test(t)&&/time zone/.test(t),bad:(t.match(/billing address|IP address|\blook-?up\b/i)||[])[0]});
  if (pricing.length>=500) { const a=terr(pt); line(a.final&&a.names&&a.checks&&!a.bad?"PASS":"FAIL","C4 /pricing "+[a.final?"says all sales are final":"never says all sales are final",a.names?"names the EU, the EEA, the UK and India":"does not name the EU, the EEA, the UK and India",a.checks?"names the currency and time-zone checks":"does not name the currency and time-zone checks"].join(", ")+(a.bad?", and names \""+a.bad+"\"":"")); }
  if (home.length>=500) { const a=terr(ht); line(a.final&&a.names&&a.checks&&!a.bad?"PASS":"FAIL","C4 / "+[a.final?"says all sales are final":"never says all sales are final",a.names?"names the EU, the EEA, the UK and India":"does not name the EU, the EEA, the UK and India",a.checks?"names the currency and time-zone checks":"does not name the currency and time-zone checks"].join(", ")+(a.bad?", and names \""+a.bad+"\"":"")); }
}

// ---- C5: nothing offered while no seller is named ----
{
  const seller=rd(R+"/src/config/seller.ts");
  const val=(k)=>((seller.match(new RegExp(k+":\\s*\"([^\"]*)\""))||[])[1]);
  const name=val("legalName"), addr=val("postalAddress");
  if (name===undefined||addr===undefined) line("INFO","C5 this checkout\x27s src/config/seller.ts could not be read: the closed state is not judged");
  else if (name.trim()&&addr.trim()) line("INFO","C5 this checkout names a seller: purchases may be open, and the offers are judged by section 92 (recheck 3)");
  else if (home.length>=500&&pricing.length>=500) {
    const bad=[];
    for (const [p,h] of [["/",home],["/pricing",pricing]]) for (const o of offers(lds(h))) if (priced(o)) bad.push(p+" offers "+(o.name||o["@type"])+" at "+(o.price??o.highPrice));
    if (/<button\b/i.test(pricing)||/Buy the Full Analysis|Go Pro, \$/.test(pt)) bad.push("/pricing bakes a buy control");
    const desc=((pricing.match(/<meta name="description" content="([^"]*)"/)||[])[1]||"");
    if (/\$\s?\d/.test(desc)) bad.push("the /pricing description names a price (\""+desc.slice(0,80)+"\")");
    line(bad.length?"FAIL":"PASS","C5 no seller is named, and "+(bad.length?bad.join("; "):"neither page offers anything at a price, /pricing bakes no buy control and its description names no price"));
  }
}

// ---- C7: what React renders ----
{
  const entry=rd("/tmp/vd_99_entry.js"), chunk=rd("/tmp/vd_99_homechunk.js");
  if (entry.length<1000) line("FAIL","C7 the served / names no readable /assets/index-*.js entry ("+entry.length+" bytes): the React strings were not read");
  else {
    const both=entry+"\n"+chunk;
    const ours=both.includes("Search postings from employers")&&both.includes("own job boards and USAJOBS");
    const inEntry=entry.includes("Search postings from employers");
    const old=["Apply yourself, with your own AI","Live job board + your own AI","Scan your CV for free, search the board here or from Claude or ChatGPT"].filter((x)=>both.includes(x));
    const where=chunk.length?"the homepage\x27s chunk":"the React entry (the served / names no HomePage chunk)";
    line(ours&&!old.length&&!inEntry?"PASS":"FAIL","C7 "+where+" "+(ours?"carries the homepage\x27s sentences":"does not carry the homepage\x27s sentences (home.hero.sub)")+(inEntry?", and the entry every page loads still carries them":", the entry every page loads does not")+(old.length?", and the retired hero\x27s "+old.map((x)=>"\""+x+"\"").join(", ")+" are still served":", and none of the retired hero\x27s"));
  }
}

// ---- C10: the apply agent, and the never-submit promise ----
{
  const a=rd("/tmp/vd_99_agent.json").trim();
  const off=a==="false", on=a==="true";
  const trustOff=/The apply agent is switched off/.test(text(trust));
  const promise=["/","/pricing"].filter((p)=>/never submit/i.test(p==="/"?ht:pt));
  if (off||trustOff) line("PASS","C10 the apply agent is retired ("+(off?"agent_sender_public_status answers false":"/trust says it is switched off")+")"+(promise.length?"; "+promise.join(" and ")+" may say it never submits":""));
  else if (!on) line("INFO","C10 agent_sender_public_status answered "+(a.slice(0,60)||"nothing")+" and /trust does not say the agent is off: "+(promise.length?promise.join(" and ")+" say never submit":"neither page says never submit"));
  else line(promise.length?"FAIL":"PASS","C10 the apply agent is live (agent_sender_public_status true), and "+(promise.length?promise.join(" and ")+" still promise never to submit":"neither / nor /pricing promises never to submit"));
}

// ---- C11: each product in its own currency ----
if (H.plans&&P.fa&&pricing.length>=500&&home.length>=500) {
  const one=/Prices (?:are )?in US dollars|your local currency/i;
  const proBilled=/Pro is billed in US dollars/.test(pt);
  const faWay=pt.includes("priced in US dollars and charged at about the same value in the currency of your device\x27s time zone when we recognize the zone and support its currency, or in US dollars otherwise");
  const proRow=/data-plan="pro"/.test(home);
  const strip=ht.includes(text(proRow?H.plans.termCurrency:H.plans.termCurrencyFa));
  const lone=[one.test(pt)&&"/pricing puts both products in one currency or promises your local currency", one.test(ht)&&"/ puts both products in one currency or promises your local currency"].filter(Boolean);
  const faOffers=[...offers(lds(home)),...offers(lds(pricing))].filter((o)=>/Full Analysis/.test(String(o.name||"")));
  const badOffer=faOffers.filter((o)=>o.description!==P.fa.currency);
  const ok=proBilled&&faWay&&strip&&!lone.length&&!badOffer.length;
  line(ok?"PASS":"FAIL","C11 "+(proBilled&&faWay?"/pricing says Pro is billed in US dollars and how the Full Analysis is charged":"/pricing does not say "+[!proBilled&&"Pro is billed in US dollars",!faWay&&"how the Full Analysis is charged"].filter(Boolean).join(" or "))+"; / "+(strip?"says its strip\x27s currency line for the rows it shows ("+(proRow?"Pro and the Full Analysis":"the Full Analysis")+")":"does not say its strip\x27s currency line")+(lone.length?"; "+lone.join("; "):"")+(faOffers.length?(badOffer.length?"; "+badOffer.length+" Full Analysis Offer(s) without the currency sentence":"; every Full Analysis Offer carries the currency sentence"):"; no Full Analysis Offer is published"));
}
'

# ---- C8, C9: the rendered pages, in one headless browser ----
if [ "${VD99_RENDER:-1}" = "0" ]; then echo "INFO  C8 C9 the headless run is skipped (VD99_RENDER=0): hp-routes and hp-fix-switch-over-gate hold both in the suite"
elif [ ! -f "$REPO_ROOT99/scripts/verify-home-pricing-rendered.mjs" ]; then echo "FAIL  C8 C9 this checkout has no scripts/verify-home-pricing-rendered.mjs: the rendered pages were not read"
else SITE="$SITE" REPO_ROOT="$REPO_ROOT99" node "$REPO_ROOT99/scripts/verify-home-pricing-rendered.mjs" || echo "FAIL  C8 C9 the headless run exited with an error"; fi

echo "INFO  G4 (W6): R1 is a verified deploy (its verifiedDeploys entry, ea8acb5e); sections 94-96 read it again"
