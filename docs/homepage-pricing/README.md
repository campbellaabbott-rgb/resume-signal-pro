# Homepage and pricing redesign (branches `hp/*`)

Built from the corrected spec, `reports/homepage-pricing-design-2026-10-17.md`
(the 30 review problems, the revised owner decisions and section 4), and the
final board-first mockups (`keep/home-pricing-design/final/`).

This round creates new files only. Nothing existing is edited: `App.tsx`,
`Pricing.tsx`, `Index.tsx`, `products.ts`, the locales, `merge-shards.ts`,
`PurchaseTerms.tsx` and the bake all keep their current owners. Every change
an existing file needs is listed under "Switch-over" with the exact edit.

Each builder writes its own section below. (Home and pricing both add this
file; the integrator keeps both sections.)

## Pricing (branch `hp/pricing`)

### What is on the branch

| Path | What |
|---|---|
| `src/pages/pricing/PricingPage.tsx` | the route page: SEO head, JSON-LD, Header, Footer, one data read (the open-postings figure), the sale gates |
| `src/components/pricing/PricingView.tsx` | the body, top to bottom: head, Before you buy, three plan cards, what the $5 adds, Builder and licence, the limits table, the FAQ |
| `src/components/pricing/PricingHead.tsx` | H1, the summary that leads with what is free, jump links (under lg) |
| `src/components/pricing/BeforeYouBuy.tsx` | all sales final; the region refusal and what checkout checks; US dollars and Pro's renewal |
| `src/components/pricing/PlanCards.tsx` | Free, Full Analysis, Pro |
| `src/components/pricing/BuyBlock.tsx` | the seller-gated buy controls, the final-sale and region line, the Pro renewal box, the gate notes |
| `src/components/pricing/FreeVsFullAnalysis.tsx` | the free report against the Full Analysis |
| `src/components/pricing/BuilderAndLicence.tsx` | the planned Builder API card (sells nothing) and the data licence |
| `src/components/pricing/PlanLimitsTable.tsx` | what each plan allows: a table from 768px, labelled lines under it |
| `src/components/pricing/PricingFaq.tsx` | seven questions, native `<details>`, answers in the DOM |
| `src/components/pricing/plan-facts.ts` | every number the page prints, each a mirror of the constant that decides it |
| `src/components/pricing/pro-perks-mirror.ts` | Pro's perks: the one typed source (stands in for wave 4's `PRO_PERK_ITEMS`) |
| `src/components/pricing/sale-gates.ts` | G1 (seller), G2 (Full Analysis delivery), G2b (Pro watched); the preview-only open state |
| `src/components/pricing/pricing-jsonld.ts` | offers only what is on sale |
| `src/components/pricing/use-pricing-strings.ts` | the interim strings loader (deleted at switch-over) |
| `src/components/pricing/strings/<lng>.json` | the pricing strings, nine languages, root key `pricingPlans` |
| `src/components/pricing/{RichText,format-utc,use-media}.ts(x)` | small helpers |
| `preview-pricing.html`, `src/preview/pricing.tsx`, `src/preview/pricing-network.ts` | the development preview |
| `src/test/hp-pricing-decisions.test.tsx` | every owner decision, mounted |
| `src/test/hp-pricing-strings.test.ts` | shard rules, house rules in nine languages, design rules, the loader |
| `src/test/hp-pricing-mirrors.test.ts` | each mirror against the constant that decides it |

### Seeing it

The page is not routed yet. Vite's dev server serves the preview directly:

```
npx vite --port 8193            # or any dev server on this tree
open http://localhost:8193/preview-pricing.html
```

| Query | Shows |
|---|---|
| (none) | the shipped state: `src/config/seller.ts` as it is, so no buy button and "purchases open soon" on both paid cards |
| `?state=open` | the buy buttons, labelled "Preview only" in each buy block and in the bar. Not the shipped state; no seller value is invented; Go Pro and Buy start nothing |
| `?lng=de` | any of the nine languages |
| `?fixture=1` | the mockup's count (1,040,488, counted 17 Oct 2026 22:45 UTC) instead of the live read |
| `?bare=1` | no preview bar |

The preview answers every checkout, portal and subscription-check request in
the browser (`src/preview/pricing-network.ts`), so it can never reach a
checkout. The live reads the shipped page already makes
(`get_board_vendor_counts`, the header's credit balance) go out unchanged.

### Owner decisions, and where each one is held

| Decision | Where | Test |
|---|---|---|
| Pro $45 = the writing tools (5 a day, 60 a month) + the $5 Full Analysis included; "no daily cap on scans", never the banned word | `pro-perks-mirror.ts`, `PlanLimitsTable.tsx` | decisions 2, 7; strings "never the banned word" |
| Freelance Boost, Transition Pro and every other cut product never shown | nothing imports or names them; prices on the page are only $0, $5, $45, $49 | decisions 1; strings "name no product the owner cut" |
| The Full Analysis is the only one-off; Builder API (planned), $49, "Proposed: 5,000 calls a day; set before launch" | `PlanCards.tsx`, `BuilderAndLicence.tsx` (wave 4's `dataApiPage.builder*` words) | decisions 13 ("sells nothing"); mirrors |
| Buy buttons only with the seller's name AND address in `seller.ts`; until then "purchases open soon" | `sale-gates.ts`, `BuyBlock.tsx` | decisions 3 |
| "All sales are final" beside every buy control | `SaleTermsLine` in each buy block | decisions 4 |
| Not sold in the EU, EEA, UK or India, said before any click, naming currency, time zone and IP lookup (never a billing address) | `BeforeYouBuy.tsx` (the region item is always open), the FAQ | decisions 5 |
| Pro's separate, unchecked, required renewal box (AB 2863) | `ProBuyBlock` | decisions 6 |
| One open-postings figure (openTotal from `get_board_vendor_counts`, with its `as_of`) | `FreeCard`, through the existing `useBoardVendorCounts` | decisions 10 |
| Fit is free without an account | Free card ("No account needed"), the table, the FAQ | decisions 9 |
| Each closed gate gives its own reason (G1, G2, G2b); Pro's included Full Analysis hides with G2; no delivery time printed | `sale-gates.ts`, `pro-perks-mirror.ts` | decisions 8 |
| Crawlers and Find read the FAQ and the comparison while closed | native `<details>`; one copy of each responsive section in the DOM | decisions 11 |
| JSON-LD offers follow G1, G2 and G2b separately | `pricing-jsonld.ts` | decisions 12 |
| House rules: never "verified", no probability, every number with its date basis, only Claude, ChatGPT and Claude Code named | the strings | strings "house rules" |

### Measured (2026-10-17, Vite dev preview, headless chromium, `?fixture=1`)

- axe (wcag2a/aa, 2.1 aa, 2.2 aa, best practice): **0 violations** at 375 and
  1280, gated and open. Two "needs review" items: the Header's Radix
  `aria-controls` (not this branch's) and `th-has-data-cells` on the limits
  table's group rows (`scope="rowgroup"`).
- Horizontal overflow: **0 px** in all nine languages at 320, 360 and 375,
  every `<details>` open, gated and open (54 runs).
- Pointer targets: none under 24px at 375 or 1280 (inline links in a
  sentence excepted, per WCAG 2.5.8). Summaries, jump links and buttons are
  44px under a coarse pointer.
- CLS from navigation, with a scroll started before the data answers: 0.009
  at 375, 0.0006 at 1280; with the count answering 1.5 s late
  (tools/cls-slow.cjs), 0 at 375 and 0.00007 at 1280.
- Phone first screen (375x812): H1, the summary, the jump links and Before you
  buy (the region line open). The Free card starts at 708px.
- Screenshots, compare sheets and the JSON:
  `keep/home-pricing-design/build/pricing/{shots,data,tools}` (tools/shoot.cjs
  re-runs everything with one browser).

### Switch-over (exact changes to existing files)

Do these after wave 4, hp/honesty and the pd/wire train have merged (spec
section 2), in this order.

1. **Route.** `src/App.tsx` line 47:
   `const Pricing = lazy(() => import("./pages/Pricing"));` becomes
   `const Pricing = lazy(() => import("./pages/pricing/PricingPage"));`.
   The `/pricing` route element stays `<Pricing />`. Then delete
   `src/pages/Pricing.tsx` (wave 4's) and its now-unread `pricingPage.*` keys.
2. **Strings become a shard.**
   - `git mv src/components/pricing/strings src/i18n/shards/pricing`
   - `src/i18n/merge-shards.ts` `SHARD_ROOT_KEYS`: add `pricing: "pricingPlans",`
   - delete `src/components/pricing/use-pricing-strings.ts`; remove
     `import "./use-pricing-strings";` from `PricingView.tsx`; in
     `PricingPage.tsx` remove `usePricingStrings` and treat `ready` as `true`
     (the shard merges at start-up, English in the bundle).
   - `src/test/hp-pricing-strings.test.ts`: point `STRINGS` at
     `src/i18n/shards/pricing` and delete its "interim loader" block (the
     shard guard then covers the folder too).
3. **Strings crawlers must see move to the main locale** (the bake reads
   `src/i18n/locales/en.json`, so a shard key never reaches it). Move these
   `pricingPlans` keys out of the shard into all nine main locale files (the
   main-locale parity test wants nine): `meta.*`, `head.*`, `before.*`,
   `buy.finalSale`, `buy.region`, `buy.gateSeller`, `buy.gateFaDelivery`,
   `buy.gateProWatched`, `free.*`, `fa.name`, `fa.unit`, `fa.what`,
   `fa.b1`-`fa.b5`, `fa.how`, `pro.name`, `pro.unit`, `pro.what`,
   `pro.step*`, `pro.perks.*` (or wave 4's `proPlan.perks.*`, step 4),
   `pro.review`, `pro.statusTitle`, `pro.statusBody`, `adds.*`, `b2b.*`,
   `limits.*`, `faq.*`. They stay in the shard: `fa.cta`, `fa.fine`,
   `pro.consent`, `pro.consentError`, `pro.cta`, `pro.fine`,
   `pro.memberActive`, `pro.manage`, `pro.owing`, `pro.updatePayment` (none
   renders while the gates are closed).
4. **Pro's perks pinned to wave 4.** Wave 4's `src/config/pro-perks.ts`
   `PRO_PERK_ITEMS` must say what `pro-perks-mirror.ts` says: drop
   `includedOneOffs` (Freelance Boost, Transition Pro) for a Full Analysis
   line, `PRO_INCLUDED_PRODUCT_IDS` becomes `["fullAnalysis"]`, rename
   `unlimitedScans` to a "No daily cap on scans" line, and decide `batchPrep`
   (not in the owner's definition; the mirror leaves it out). Then
   `pro-perks-mirror.ts` becomes
   `export { PRO_PERK_ITEMS, type ProPerk } from "@/config/pro-perks";` plus
   `PRO_PERK_REQUIRES`/`visibleProPerks`, with the included-Full-Analysis key
   renamed to wave 4's. `hp-pricing-mirrors.test.ts` fails while the two
   lists disagree (it compares them the day `PRO_PERK_ITEMS` exists).
5. **Sale gates.** `src/components/pricing/sale-gates.ts`: replace the two
   stand-ins with
   `export { FULL_ANALYSIS_ON_SALE as FULL_ANALYSIS_DELIVERY_WATCHED, PRO_ON_SALE as PRO_SUBSCRIPTION_WATCHED } from "@/config/sales-gate";`
   (hp/honesty's file). The mirrors test pins them meanwhile.
6. **Renewal consent (G7, wave 4's server).** `create-subscription-checkout`
   refuses without `renewalConsent: true` and records
   `renewalConsentVersion` (`RENEWAL_CONSENT_VERSION`, `2026-10-17`) and the
   time; `useProSubscription().subscribe(email, consent)` spreads it into the
   body; in `BuyBlock.tsx` `ProBuyConnected`, `onGoPro={() => …}` becomes
   `onGoPro={(consent) => …}` and calls `subscribe(user.email ?? undefined, consent)`.
7. **PurchaseTerms.** If hp/honesty adds the final-sale and region lines and
   the G7 box to `PurchaseTerms.tsx`, delete `SaleTermsLine` and the renewal
   box from `BuyBlock.tsx` (decisions test 4 counts exactly one final-sale
   line per buy block, so a duplicate fails it).
8. **Mirrors to imports, where light.** `plan-facts.ts`: `WRITING` from
   `@/config/writing-allowance`, `BUILDER_PRICE_USD` from
   `@/config/builder-plan`. Keep `FREE_KEY_DAILY_QUOTA`,
   `MCP_FIT_FREE_PER_DAY` and `WITHHELD_SOURCES` mirrored (mcp-tools.ts is
   about 1,200 lines) or read them from `src/config/mcp-withheld.ts` once
   wave 4 splits it out (spec P13). The mirrors test pins every one.
9. **Builder strings.** Once wave 4's `dataApiPage.builder*` keys are in the
   main locales, delete `pricingPlans.b2b.builderName`, `builderPrice`,
   `builderBody`, `builderNotYet` and `builderCta` from the shard
   (`BuilderAndLicence.tsx` already reads wave 4's keys first; the mirrors
   test holds the copies byte-identical until then).
10. **Chrome.** The Footer still links Freelance Boost and the Header has no
    `variant="quiet"` (hp/honesty's). The decisions test renders the route
    with the real Header and Footer but does not hold the footer's links.
11. **G6.** If the saved-search digest is ruled marketing mail and paused
    until the seller identity exists, drop "email alerts" from `head.sub`,
    `free.saved`, `limits.rowSaved` and `faq.regionA` until it is set.
12. **The bake** (`scripts/prerender-seo.mjs`, hp/home's block for
    `/pricing`): print the gated state from the main-locale strings of step
    3, the FAQ and comparison open, and the JSON-LD from
    `pricingJsonLd(resolveSaleGates())`.
13. **Delete the preview**: `preview-pricing.html`, `src/preview/pricing.tsx`
    and `src/preview/pricing-network.ts`.
