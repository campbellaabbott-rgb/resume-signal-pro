# shellcheck shell=bash
# ── 92. WAVE 4 ROUND 2, CHECKOUT AND CATALOGUE (branch w4b/checkout-catalogue):
# the product line's cut is enforced by the server, a buyer in the EU, the EEA
# or the UK is refused until the VAT registration, a checkout names its
# signed-in buyer, and a Pro grant has a cap (owner decisions 2026-10-12;
# S12-059, S12-067, S12-070, S12-076, S12-099, S12-168, S12-170; critical-path
# CP-022, CP-025, CP-033, CP-037; D7, D8).
#
# THE CLAIMS, one line each below:
#   - the checkouts and the plan readers serve the round-2 builds:
#     create-checkout, create-product-checkout, create-subscription-checkout,
#     create-scan-pack-checkout, create-test-checkout and check-subscription
#     2026-10-11.23 or later; create-portal-session 2026-10-14.23 or later
#     (R1 stamped it on that later day);
#   - create-checkout's public GET says the territory is refused while the
#     EU/UK switch is off (territoryRefused true beside euUkSales false);
#   - create-product-checkout answers a purchase of each cut product with 410
#     (retired, cut, the product, a sentence naming the 90 days a past buyer
#     keeps, and no Stripe url), and create-scan-pack-checkout and
#     create-test-checkout answer 410 too;
#   - 20261011150000 applied: checkout_buyers exists and refuses anon by name,
#     with a negative control;
#   - what no read here can prove is INFO: the cap (the migration's own
#     self-check exercises it), the territory refusal of a POST, the buyer
#     binding, and the owner's Stripe steps.
#
# READ-ONLY. Preflights run no function logic. A checkout is POSTed only once
# its preflight shows the round-2 build, whose cut and switched-off answers
# come before the rate limiter, a token read, a grant or Stripe: nothing is
# counted or written. No POST is sent that could reach a limiter (the
# territory refusal is judged from the GET and the tests, never by a POST).
echo "== 92. w4b checkout and catalogue: the cut is enforced, the EU/UK territory is refused until VAT, checkouts name their buyer =="

vd92_build() { # $1 fn -> the x-fn-build its preflight answers
  curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$1" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//'
}

VD92_LIVE=" "
for VD92_PAIR in "create-checkout|2026-10-11|23" "create-product-checkout|2026-10-11|23" "create-subscription-checkout|2026-10-11|23" \
  "create-scan-pack-checkout|2026-10-11|23" "create-test-checkout|2026-10-11|23" "check-subscription|2026-10-11|23" \
  "create-portal-session|2026-10-14|23"; do
  VD92_FN=${VD92_PAIR%%|*}; VD92_REST=${VD92_PAIR#*|}; VD92_DAY=${VD92_REST%%|*}; VD92_N=${VD92_REST#*|}
  VD92_H=$(vd92_build "$VD92_FN")
  if [ -z "$VD92_H" ]; then echo "FAIL  $VD92_FN preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"
  elif build_ge "$VD92_FN" "$VD92_H" "$VD92_DAY" "$VD92_N"; then echo "PASS  $VD92_FN preflight x-fn-build = $VD92_H ($VD92_FN.$VD92_DAY.$VD92_N or later)"; VD92_LIVE="$VD92_LIVE$VD92_FN "
  else echo "FAIL  $VD92_FN preflight x-fn-build = $VD92_H (want $VD92_FN.$VD92_DAY.$VD92_N or later: the round-2 checkout build is not serving)"; fi
done

VD92_GET=$(curl -s -m 30 "$B/functions/v1/create-checkout" -H "apikey: $K" -H "Authorization: Bearer $K")
case "$VD92_GET" in
  *'"euUkSales":false'*'"territoryRefused":true'*|*'"territoryRefused":true'*'"euUkSales":false'*) echo "PASS  create-checkout GET: euUkSales false and territoryRefused true (a buyer in the EU, the EEA or the UK is refused until the VAT registration)";;
  *'"euUkSales":true'*) echo "INFO  create-checkout says the EU/UK switch is ON (territoryRefused false): correct only after the VAT registration";;
  *'"euUkSales":false'*) echo "FAIL  create-checkout GET -> ${VD92_GET:0:160} (no territoryRefused: the round-2 build is not serving, and the territory is not refused)";;
  *) echo "FAIL  create-checkout GET -> ${VD92_GET:0:160} (want JSON with euUkSales and territoryRefused)";;
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
  careerSnapshot:career_snapshot graduateGamePlan:graduate_gameplan interviewCoach:interview_coach careerPathSimulator:career_path_simulator scanPack:scan_pack; do
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

echo "INFO  not provable read-only: the grant cap (10 a day, 60 a month per account; 20261011150000's own self-check inserts ten grants, is refused the eleventh and rolls back, so an applied migration proves it ran), the territory refusal of a POST (it comes after the rate limiter, which counts), a signed-in buyer's client_reference_id and checkout_buyers row, the cancel flag on pro_subscribers, and the 503 when a grant cannot be minted -- each is run in src/test/w4b-*.test.ts"
echo "INFO  owner, in Stripe: (1) expire any open checkout session for a cut product (Premium Package, ATS Defense, Career Snapshot, Graduate Game Plan, Career Path, Keyword Fix, Cover Letter, Interview Coach, scan packs): they live 24 hours and a payment on one still delivers; (2) archive their dashboard Prices (price_1Sgv32HBplUUV1CgAdw6PnV3 Premium, price_1Sgv3LHBplUUV1CgpCF5pDLO ATS Defense, price_1SibLiHBplUUV1CgHmRy7ayi Snapshot, price_1SibRNHBplUUV1CgEj5L8eH1 Game Plan, price_1T8u4NHBplUUV1CggBvfeDT0 Career Path, price_1Sgv2hHBplUUV1Cgjdqw9kHi Keyword Fix, price_1Sgv2tHBplUUV1CgoXHF6GjD Cover Letter, price_1T8u3pHBplUUV1CgN5CDJGEF Interview Coach, price_1Sgv2THBplUUV1CgntHsXlDK scan pack); (3) as a backstop for a buyer no signal placed, a Radar block rule on :card_country: (and :ip_country:) for the EU-27, IS, LI, NO and GB, if the plan allows custom rules; (4) count live Pro subscriptions: any that exist were promised every paid tool and should be emailed the new perk list with a cancel link"
