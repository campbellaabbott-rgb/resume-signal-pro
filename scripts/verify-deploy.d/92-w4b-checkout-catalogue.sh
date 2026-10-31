# shellcheck shell=bash
# ── 92. WAVE 4 ROUND 2, CHECKOUT AND CATALOGUE (branch w4b/checkout-catalogue):
# the product line's cut is enforced by the server, a checkout names its
# signed-in buyer, and a Pro grant has a cap (owner decisions 2026-10-12;
# S12-059, S12-067, S12-070, S12-076, S12-099, S12-168, S12-170; critical-path
# CP-022, CP-025, CP-033, CP-037; D7, D8). And the owner's decisions of
# 2026-10-17: Freelance Boost and Transition Pro are cut too, Pro needs its
# own renewal box, and Pro is the writing tools, the Full Analysis and no
# daily cap on scans. SALES STAY ON (owner, 2026-10-27, overriding the
# 2026-10-17 decisions D3 and D4): nothing waits for the seller's legal name
# and postal address, so the three checkouts serve the build that dropped
# that wait, and no page says purchases open soon. AND THE EU, THE EEA, THE UK
# AND INDIA KEEP BUYING AS TODAY (owner, 2026-10-27): wave 4's territory
# refusal (S12-059's 451, India's with it) is gone, so the GET says no
# territory is refused and no page says sales there wait.
#
# THE CLAIMS, one line each below:
#   - the checkouts and the plan readers serve the round-2 builds:
#     create-scan-pack-checkout, create-test-checkout and check-subscription
#     2026-10-11.23 or later; create-portal-session 2026-10-14.23 or later
#     (R1 stamped it on that later day); create-checkout,
#     create-product-checkout and create-subscription-checkout 2026-10-31.1
#     or later (sales stay on, and nobody is refused for where they are;
#     section 99's C6 asks for the two later builds that also carry the
#     homepage switch-over's Pro line, 2026-10-31.2);
#   - create-checkout's public GET answers the EU/UK switch (euUkSales false)
#     and refuses no territory (no territoryRefused true: wave 4's refusal of
#     the EU, the EEA, the UK and India is not serving), and reports no closed
#     shop (no purchasesOpen false: wave 4's seller gate is not serving);
#   - create-product-checkout answers a purchase of each cut product with 410
#     (retired, cut, the product, a sentence naming the 90 days a past buyer
#     keeps, and no Stripe url), Freelance Boost and Transition Pro included,
#     and create-scan-pack-checkout and create-test-checkout answer 410 too;
#   - the published Pricing page carries Pro's renewal box, and neither the
#     purchases-open-soon line, nor the region note that hid Go Pro from the
#     EU, the EEA, the UK and India, nor the old perk naming the cut products;
#     the published Freelance Boost page
#     says it is no longer sold and offers no buy button;
#   - 20261011150000 applied: checkout_buyers exists and refuses anon by name,
#     with a negative control; 20261011151000 applied: pro_auto_renew_consents
#     exists and refuses anon by name;
#   - what no read here can prove is INFO: the cap (the migration's own
#     self-check exercises it), the buyer binding, the refusal of a token minted for a connected app, the renewal
#     box's refusal of a POST, and the owner's steps.
#
# READ-ONLY. Preflights run no function logic. A checkout is POSTed only once
# its preflight shows the round-2 build, whose cut and switched-off answers
# come before the rate limiter, a token read, a grant or Stripe: nothing is
# counted or written. No POST is sent that could reach a limiter.
echo "== 92. w4b checkout and catalogue: the cut is enforced, sales do not wait for a named seller, the EU, the EEA, the UK and India buy as today, checkouts name their buyer =="

vd92_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}

VD92_LIVE=" "
for VD92_PAIR in "create-checkout|2026-10-31|1" "create-product-checkout|2026-10-31|1" "create-subscription-checkout|2026-10-31|1" \
  "create-scan-pack-checkout|2026-10-11|23" "create-test-checkout|2026-10-11|23" "check-subscription|2026-10-11|23" \
  "create-portal-session|2026-10-14|23"; do
  VD92_FN=${VD92_PAIR%%|*}; VD92_REST=${VD92_PAIR#*|}; VD92_DAY=${VD92_REST%%|*}; VD92_N=${VD92_REST#*|}
  VD92_H=$(vd92_build "$VD92_FN")
  if [ -z "$VD92_H" ]; then echo "FAIL  $VD92_FN preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
  elif build_ge "$VD92_FN" "$VD92_H" "$VD92_DAY" "$VD92_N"; then echo "PASS  $VD92_FN preflight x-fn-build = $VD92_H ($VD92_FN.$VD92_DAY.$VD92_N or later)"; VD92_LIVE="$VD92_LIVE$VD92_FN "
  else echo "FAIL  $VD92_FN preflight x-fn-build = $VD92_H (want $VD92_FN.$VD92_DAY.$VD92_N or later: the round-2 checkout build, or for the three checkouts the build that sells with no seller named and refuses nobody for where they are, is not serving)"; fi
done

VD92_GET=$(curl -s -m 30 "$B/functions/v1/create-checkout" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$VD92_GET" in
  *'"territoryRefused":true'*) echo "FAIL  create-checkout GET -> ${VD92_GET:0:160} (territoryRefused true: wave 4's territory refusal is serving, so a buyer in the EU, the EEA, the UK or India is refused the Full Analysis and Pro; the owner, 2026-10-27: keep selling as today)";;
  *'"euUkSales":false'*) echo "PASS  create-checkout GET: euUkSales false and no territory refused (a buyer in the EU, the EEA, the UK or India checks out as on main)";;
  *'"euUkSales":true'*) echo "INFO  create-checkout says the EU/UK switch is ON: the waiver and tax apply there, which is correct only after the VAT registration";;
  *) echo "FAIL  create-checkout GET -> ${VD92_GET:0:160} (want JSON with euUkSales)";;
esac
case "$VD92_GET" in
  *'"purchasesOpen":false'*) echo "FAIL  create-checkout GET -> ${VD92_GET:0:160} (purchasesOpen false: wave 4's seller gate is serving, so every checkout refuses 409 while no seller is named; sales stay on, owner 2026-10-27)";;
  '{'*) echo "PASS  create-checkout GET reports no closed shop (no purchasesOpen false: the Full Analysis and Pro are sold with no seller named, as on main)";;
  *) echo "FAIL  create-checkout GET -> ${VD92_GET:0:160} (want a JSON answer)";;
esac

vd92_cut() { # $1 fn, $2 body, $3 expected product type, $4 Accept-Language, $5 a phrase the sentence must hold
  case "$VD92_LIVE" in
    *" $1 "*) ;;
    *) echo "INFO  $1 was not asked: its round-2 build is not serving (above), and an older bundle would reach its purchase code"; return;;
  esac
  local out
  out=$(curl -s -m 30 -w '\n%{http_code}' -X POST "$B/functions/v1/$1" -H "Content-Type: application/json" -H "apikey: $K" -H "Authorization: Bearer $K" -H "Accept-Language: $4" -d "$2")
  printf '%s' "$out" | VD92_FN="$1" VD92_PRODUCT="$3" VD92_PHRASE="$5" node -e '
let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{
  const lines=s.split("\n");const code=lines.pop();const raw=lines.join("\n");
  const {VD92_FN:fn,VD92_PRODUCT:product,VD92_PHRASE:phrase}=process.env;
  let j=null;try{j=JSON.parse(raw)}catch{}
  const why=[];
  if(code!=="410")why.push("HTTP "+code);
  if(!j||typeof j!=="object")why.push("no JSON body");
  else{
    if(j.retired!==true)why.push("retired is "+JSON.stringify(j.retired));
    if(product&&j.cut!==true)why.push("cut is "+JSON.stringify(j.cut));
    if(product&&j.product!==product)why.push("product "+JSON.stringify(j.product)+" (want "+product+")");
    if(phrase&&(typeof j.error!=="string"||!j.error.includes(phrase)))why.push("the sentence lacks \""+phrase+"\"");
    if("url" in j)why.push("it carries a Stripe url");
  }
  if(why.length)console.log("FAIL  "+fn+" did not refuse the purchase: "+why.join("; ")+" -- "+raw.slice(0,200));
  else console.log("PASS  "+fn+" answers 410"+(product?" for "+product+", cut,":"")+" with no Stripe session"+(phrase?" (\""+phrase+"\")":""));
});'
}
for VD92_P in basicKeywordFix:basic_keyword_fix coverLetter:cover_letter premiumPackage:premium_package atsDefense:ats_defense \
  careerSnapshot:career_snapshot graduateGamePlan:graduate_gameplan interviewCoach:interview_coach careerPathSimulator:career_path_simulator scanPack:scan_pack \
  freelanceBoost:freelance_boost freelanceTransitionPro:freelance_transition_pro; do
  vd92_cut create-product-checkout "{\"productId\":\"${VD92_P%%:*}\",\"language\":\"en\"}" "${VD92_P#*:}" "en" "90 days"
done
vd92_cut create-product-checkout '{"productId":"coverLetter","language":"de"}' cover_letter "en" "nicht mehr verkauft"
vd92_cut create-scan-pack-checkout '{"creditAmount":10}' scan_pack "en" "no longer sold"
vd92_cut create-test-checkout '{"productId":"x","productName":"x","priceUsd":1}' "" "en" ""

# checkout_buyers exists and refuses anon by name: a refusal, not rows, and
# not a 404 -- with a control table that never existed.
VD92_CB=$(curl -s -m 30 "$B/rest/v1/checkout_buyers?select=stripe_session_id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$VD92_CB" in
  42501) echo "PASS  anon GET checkout_buyers -> 42501 (20261011150000 applied; revoked by name)";;
  PGRST205) echo "FAIL  checkout_buyers does not exist (migration 20261011150000 not applied: no grant cap, no buyer binding, no cancel flag)";;
  ROWS:*) echo "FAIL  anon GET checkout_buyers -> $VD92_CB (readable: which account bought what)";;
  *) echo "FAIL  anon GET checkout_buyers -> $VD92_CB";;
esac
VD92_NC=$(curl -s -m 30 "$B/rest/v1/checkout_buyers_never_existed?select=*&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).code||"NOCODE")}catch{console.log("NONJSON")}})')
[ "$VD92_NC" = "PGRST205" ] && echo "PASS  negative control checkout_buyers_never_existed -> PGRST205" || echo "FAIL  negative control -> $VD92_NC (the 42501 above cannot be read as presence)"
VD92_RC=$(curl -s -m 30 "$B/rest/v1/pro_auto_renew_consents?select=stripe_session_id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(Array.isArray(j)?"ROWS:"+j.length:(j.code||"NOCODE"))}catch{console.log("NONJSON")}})')
case "$VD92_RC" in
  42501) echo "PASS  anon GET pro_auto_renew_consents -> 42501 (20261011151000 applied; revoked by name)";;
  PGRST205) echo "FAIL  pro_auto_renew_consents does not exist (migration 20261011151000 not applied: every Pro checkout would fail to record its renewal consent and answer 503)";;
  ROWS:*) echo "FAIL  anon GET pro_auto_renew_consents -> $VD92_RC (readable: who agreed to renew, and when)";;
  *) echo "FAIL  anon GET pro_auto_renew_consents -> $VD92_RC";;
esac

# The published frontend: the entry, the pricing page's chunk (PricingPage
# since the switch-over, Pricing before it) and Freelance Boost's, and the
# chunks the pricing chunk imports (the Pro card, the Terms line). Neither the
# old purchases-open-soon line nor the new page's seller gate key may ship
# (sales stay on, owner 2026-10-27), and no region line or note may either.
VD92_ENTRY=$(curl -s -m 30 -A "$UA" "$SITE/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
if [ -z "$VD92_ENTRY" ]; then
  echo "FAIL  the site's shell names no /assets/index-*.js entry: the published pages cannot be judged"
else
  curl -s -m 60 -A "$UA" "$SITE$VD92_ENTRY" > /tmp/vd_92cc_entry.js
  vd92_chunk() { # $1 page name -> that lazy chunk's file name; its text in /tmp/vd_92cc_<name>.js
    local f; f=$(grep -oE "\"\./$1-[A-Za-z0-9_-]+\.js\"" /tmp/vd_92cc_entry.js | head -1 | tr -d '"' | sed 's#^\./##')
    : > "/tmp/vd_92cc_$1.js"
    [ -n "$f" ] && curl -s -m 60 -A "$UA" "$SITE/assets/$f" > "/tmp/vd_92cc_$1.js"
    printf '%s' "$f"
  }
  VD92_PN=PricingPage
  VD92_PRICING=$(vd92_chunk "$VD92_PN")
  if [ -z "$VD92_PRICING" ]; then VD92_PN=Pricing; VD92_PRICING=$(vd92_chunk "$VD92_PN"); fi
  if [ -z "$VD92_PRICING" ]; then echo "FAIL  the live entry names no PricingPage or Pricing chunk: the pricing page cannot be judged"
  else
    cat /tmp/vd_92cc_entry.js "/tmp/vd_92cc_$VD92_PN.js" > /tmp/vd_92cc_pricing_all.js
    for VD92_DEP in $(grep -oE '\./[A-Za-z0-9_-]+\.js' "/tmp/vd_92cc_$VD92_PN.js" | sort -u | head -40); do
      curl -s -m 60 -A "$UA" "$SITE/assets/${VD92_DEP#./}" >> /tmp/vd_92cc_pricing_all.js
    done
    VD92_MISS=""
    grep -q 'purchaseTerms.autoRenewConsent' /tmp/vd_92cc_pricing_all.js || VD92_MISS="$VD92_MISS the renewal box;"
    grep -q 'proPlan.perks.noDailyScanCap' /tmp/vd_92cc_pricing_all.js || VD92_MISS="$VD92_MISS Pro's no-daily-cap line;"
    if [ -n "$VD92_MISS" ]; then echo "FAIL  the published Pricing page ($VD92_PRICING) lacks:$VD92_MISS the 2026-10-17 frontend is not published"
    elif grep -q 'proPlan.perks.includedOneOffs' /tmp/vd_92cc_pricing_all.js; then echo "FAIL  the published Pricing page ($VD92_PRICING) still carries the old Pro perk that included Freelance Boost and Transition Pro"
    elif grep -q -e 'checkoutGate.purchasesOpenSoon' -e 'pricingPlans.buy.gateSeller' /tmp/vd_92cc_pricing_all.js; then echo "FAIL  the published Pricing page ($VD92_PRICING) still says purchases open soon where the buy buttons go (wave 4's seller gate; sales stay on, owner 2026-10-27): publish the frontend"
    elif grep -q -e 'checkoutGate.regionNoticeTimeZone' -e 'data-region-notice' -e 'purchaseTerms.regionLine' -e 'pricingPlans.before.regionBody' /tmp/vd_92cc_pricing_all.js; then echo "FAIL  the published Pricing page ($VD92_PRICING) still carries the region line, or the region note that hides Go Pro from a browser in the EU, the EEA, the UK or India (wave 4's territory refusal; the owner, 2026-10-27: keep selling as today): publish the frontend"
    else echo "PASS  the published Pricing page ($VD92_PRICING) offers the buy buttons with no purchases-open-soon line and no region note, carries Pro's own renewal box, and reads Pro's perks from the one list"; fi
  fi
  VD92_FB=$(vd92_chunk FreelanceBoost)
  if [ -z "$VD92_FB" ]; then echo "FAIL  the live entry names no FreelanceBoost chunk: the page a past buyer's link opens cannot be judged"
  elif grep -q 'freelanceBoost.noLongerSoldTitle' "/tmp/vd_92cc_FreelanceBoost.js" && ! grep -q 'Boost my experience' "/tmp/vd_92cc_FreelanceBoost.js"; then echo "PASS  the published Freelance Boost page ($VD92_FB) says it is no longer sold and offers no buy button"
  else echo "FAIL  the published Freelance Boost page ($VD92_FB) still sells, or does not say it is no longer sold"; fi
fi

echo "INFO  not provable read-only: the grant cap (10 a day, 60 a month per account; 20261011150000's own self-check inserts ten grants, is refused the eleventh and rolls back, so an applied migration proves it ran), a buyer in the EU, the EEA, the UK or India reaching Stripe by currency, time zone, country header or address (a POST comes after the rate limiter, which counts; src/test/sales-stay-on-a-buyer-in-the-eu-the-uk-or-india-checks-out-as-on-main.test.ts), a signed-in buyer's client_reference_id and checkout_buyers row, the cancel flag on pro_subscribers, the 503 when a grant cannot be minted, the 401 for a connected app's token (or one for another audience) on the four money functions, which no anon probe can mint, Pro's 400 without its renewal box (it comes after a rate limiter), the Full Analysis and Pro reaching Stripe with no seller named (src/test/sales-stay-on-the-checkouts-sell-with-no-seller-named.test.ts), and the consent row a Pro checkout writes -- each is run in src/test/w4b-*.test.ts"
echo "INFO  owner, in Stripe: (1) expire any open checkout session for a cut product (Premium Package, ATS Defense, Career Snapshot, Graduate Game Plan, Career Path, Keyword Fix, Cover Letter, Interview Coach, scan packs, and since 2026-10-17 Freelance Boost and Transition Pro, whose sessions use inline prices): they live 24 hours and a payment on one still delivers; (2) archive their dashboard Prices (price_1Sgv32HBplUUV1CgAdw6PnV3 Premium, price_1Sgv3LHBplUUV1CgpCF5pDLO ATS Defense, price_1SibLiHBplUUV1CgHmRy7ayi Snapshot, price_1SibRNHBplUUV1CgEj5L8eH1 Game Plan, price_1T8u4NHBplUUV1CggBvfeDT0 Career Path, price_1Sgv2hHBplUUV1Cgjdqw9kHi Keyword Fix, price_1Sgv2tHBplUUV1CgoXHF6GjD Cover Letter, price_1T8u3pHBplUUV1CgN5CDJGEF Interview Coach, price_1Sgv2THBplUUV1CgntHsXlDK scan pack); (3) add no Radar rule that blocks the EU-27, IS, LI, NO, GB or IN by card or address country, and remove one if it was added for wave 4: those buyers are sold to as today (owner, 2026-10-27); (4) count live Pro subscriptions: any that exist were promised every paid tool (and Freelance Boost) and should be emailed the new perk list (the writing tools, the Full Analysis, no daily cap on scans) with a cancel link"
