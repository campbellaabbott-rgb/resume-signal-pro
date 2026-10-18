# The board-first homepage and the new pricing page (branches `hp/*`)

Built from the corrected spec, `reports/homepage-pricing-design-2026-10-17.md`
(the 30 review problems, the revised owner decisions and section 4), and the
final board-first mockups in `keep/home-pricing-design/final/`. "/" becomes
the job search with live postings, the free résumé scanner moves to
`/resume-checker`, and `/pricing` leads with what is free.

**Nothing live changes until the switch-over.** This round adds new files
only. App.tsx, Index.tsx, Pricing.tsx, products.ts, the locales,
merge-shards.ts, the Header, the Footer, PurchaseTerms.tsx and the bake keep
their current owners (wave 4, the profiles/design train, hp/honesty). The two
pages are reachable only through the preview pages below. Every change an
existing file needs is in [the switch-over plan](#the-switch-over-plan).

| Branch | Head | What |
|---|---|---|
| `hp/home` | 7a30bc23 | the homepage (Appendix A) |
| `hp/pricing` | 50de7209 | the pricing page (Appendix B) |
| `hp/integration` | this branch | both, merged onto `origin/design/integration` (dee9743d), plus the cross-page fixes below |

`git diff --name-only origin/design/integration...hp/integration` lists 79
paths, every one of them added (status A). No existing file is modified.

## What was built

**Homepage** (`src/pages/home/HomePage.tsx`, default export, ready for `lazy()`):
the owner's headline "Live jobs, straight from employers' own hiring
systems", a real `GET /jobs` search form (`q`, `location`; "Remote" becomes
`mode=remote`), try chips, and the one open-postings figure (`openTotal` from
`get_board_vendor_counts` with "counted {date}, {time} UTC"). Then up to five
live postings in the board's own `JobCard` (no Save, no Check fit, no menu;
employer-dated within 7 days; never Paylocity, Breezy or UKG; the feed-read
stamp only where `feedReadStatable` passes), the board rail (boards, p50/p95
from `get_freshness_stats` with its time; no 24-hour flow figure), field
links from the category list, the free-account strip, the scan section with
one sample report, "use it from your AI" (Claude, ChatGPT, Claude Code), the
sources table, the plan strip (no buy control) and the FAQ. "Search jobs" is
the only filled button. At most four data calls; nothing reads
`get_board_flow`.

**Pricing page** (`src/pages/pricing/PricingPage.tsx`): H1 and a summary that
leads with what is free; "Before you buy" above the cards (all sales final;
not sold in the EU, the EEA, the UK or India, naming the currency, time-zone
and IP checks; Pro renews monthly), the Free, Full Analysis ($5, the only
one-off) and Pro ($45) cards, "What the $5 adds", the Builder API (planned,
$49, "Proposed: 5,000 calls a day; set before launch") and data licence
cards, the limits table and a seven-question FAQ. "Create a free account" is
the only filled button. Buy buttons render only when `src/config/seller.ts`
carries the seller's legal name and postal address; until then each paid card
says "Not on sale yet. Purchases open soon, once the seller's name and
address are published on this page." Pro carries a separate, unchecked,
required renewal box (AB 2863). Pro is the writing tools (5 of each a day, 60
a month) plus the included Full Analysis (shown only once G2 passes) and "No
daily cap on scans"; Freelance Boost, Transition Pro and every other cut
product appear nowhere.

**Shared**: both pages read the count through the same hook
(`useBoardVendorCounts`), so one `as_of` serves both. FAQ answers, the sources
table, the sample report, "Before you buy" and the comparison sit in native
`<details>` elements, so their text stays in the DOM (for Google's phone
render and a reader's Find) while closed; the Disclosure primitive is not
used or edited.

## What the integration changed

The two builders worked on separate branches with separate gate modules,
facts mirrors and strings. Reading the two pages side by side found five
places where they disagreed; each is fixed and held by
`src/test/hp-integration-one-voice.test.ts` (34 tests):

1. **One switch for both pages.** Each page had its own stand-in for G2 and
   G2b (`SALE_SWITCHES` in `src/lib/home/sale-gates.ts`;
   `FULL_ANALYSIS_DELIVERY_WATCHED` and `PRO_SUBSCRIPTION_WATCHED` in
   `src/components/pricing/sale-gates.ts`). Flipping one would have put the
   Full Analysis on sale on one page and not the other. The pricing stand-ins
   now read the homepage's switches. The test walks every combination of
   seller (none or a fake TEST SELLER) and both switches and checks that the
   pages agree on what is on sale, why it is closed, and whether Pro says it
   includes the Full Analysis.
2. **The homepage's seller-gate sentence.** It said the seller's name and
   address would be "published on this page", which is false on the
   homepage, and did not say purchases open soon. It now reads "Not on sale
   yet. Purchases open soon, once the seller's name and address are published
   on the pricing page." in all nine languages.
3. **One name for the $5 report.** The German and Tagalog homepage strings
   left it as "Full Analysis"; the pricing page and the site's own catalogue
   (`tieredPricing.products.fullAnalysis.name`, the uploader's buy button) say
   "Vollanalyse" and "Buong Pagsusuri". The homepage now uses those.
4. **One final-sale sentence and one delivery sentence per language.** They
   differed in de, es, fr and pt (for example "Todas las ventas son finales"
   against "definitivas") and in de, fr, hi and tl. Each language now has
   one wording, used by both pages.
5. **Wording one page's guard bans.** The pricing strings guard bans the
   French stem of "verified" (house rule); the homepage's French used it twice
   ("Nous vérifions", "Vérifiez chaque chiffre"). Both now use "contrôler".
   The pricing FAQ's Spanish "¿Postuláis…?" (a vosotros form the site never
   uses) is now "¿Se postulan…?".

Each test was shown to fail on a mutation (the stand-in set to true, the
German name reverted, the French stem restored, the Spanish sentence
reverted) and the files were restored.

## How to preview

```
npx vite --port 5193            # in this worktree; Ctrl-C when done
open http://localhost:5193/preview-home.html
open http://localhost:5193/preview-pricing.html
```

| Page | Query | Shows |
|---|---|---|
| home | (none) or `data=fixture` | the page's four reads answered from a recorded read-only capture of the live board (2026-10-18 02:06 UTC), every stamp moved forward to now |
| home | `data=live` | production, read-only: the calls a visitor's browser makes |
| home | `rows=loading`, `rows=hidden`, `rows=slow`, `rows=worst` | the list in flight, refused, answering after 2.5 s, or every card field filled (measurement only) |
| home | `gates=open` | the plan strip with every gate open (booleans; no seller is invented) |
| pricing | (none) | the shipped state: `seller.ts` as it is, so no buy button and "purchases open soon" |
| pricing | `state=open` | the buy buttons, labelled "Preview only"; checkout, portal and subscription-check requests are answered inside the browser, so nothing can reach a checkout |
| pricing | `fixture=1`, `bare=1` | the mockup's count instead of the live read; no preview bar |
| both | `lng=de` (any of en, en-GB, de, es, fr, hi, nl, pt, tl) | the interface language |

The previews are standalone pages Vite's dev server serves directly; nothing
in the app imports `src/preview/**`, and `vite build` builds `index.html`
only, so neither preview ships.

## What was measured (integration run, 2026-10-18)

One Vite dev server, one headless Chromium (Playwright from
`worker/node_modules`), closed when done. Fixture data unless marked live.
Script and data: `keep/home-pricing-design/build/integration/{tools,data,shots}`;
side-by-sides with the final mockups: `keep/home-pricing-design/build/compare/`.

| Check | Homepage | Pricing |
|---|---|---|
| 375x812 first screen | search box 282-326 px; first posting card 710-816 px, its title 727-751 px: both on the first screen. Live data (`data=live`): the same positions, five live rows, count "1,022,573 open postings · counted 18 Oct 2026, 06:07 UTC" | H1 80-116 px, "Before you buy" 388-688 px with the region line open (457-642 px); the Free card starts at 708 px |
| 1280x800 first screen | search box 244-288 px; first posting title 522-546 px | H1, summary, "Before you buy" (258-432 px); cards from 456 px |
| Filled buttons | one: "Search jobs" (375 and 1280) | one: "Create a free account" (gated and preview-open, 375 and 1280) |
| axe 4.12.1, WCAG 2.0/2.1/2.2 A and AA | 0 violations at 375 and 1280, fixture and live | 0 violations at 375 and 1280, gated and preview-open |
| axe "needs review" | `aria-valid-attr-value` on today's Header (Radix `aria-controls`), not these pages | the same Header item, and `th-has-data-cells` on the limits table's full-width group rows (`scope="rowgroup"`) |
| CLS, navigation plus a scroll started before the data answers | 0.0004 at 375, 0.00004 at 1280; with the list answering after 2.5 s (`rows=slow`): 0.0004 and 0.0002 | 0 at 375, 0.00007 at 1280, gated and open |
| Horizontal overflow, every `<details>` open | none in any of the 9 languages at 320, 360 and 375 px (27 runs) | none in any of the 9 languages at 320, 360 and 375 px, gated and open (54 runs) |
| Pointer targets under 24 px (inline links in a sentence excepted) | none | none; the renewal checkbox is 20 px, but its `<label>` is the target (275x44 at 375 under a coarse pointer, 337x40 at 1280) and a click on the label's text ticks the box |

Measured by the builders and not re-run here: the home chunk is 15.7 kB gzip
(built from an archive export), so the predicted first load of "/" is
279.3 + 18.9 + 15.7 + 13.5 = 327.4 kB against the 340 kB cap. There is no
production build of the real routes yet and no LCP figure; both are lab gates
at +1 day (below).

**Side-by-sides** (`build/compare/compare.*.png`, mockup left, build right):
home 375 and 1280 first screens (fixture and live) and full pages; pricing
375 and 1280 first screens and full pages. The build matches the mockups'
structure. Where it differs, it follows the corrected spec, which the mockups
predate: no "new · gone" flow figure, no Save buttons, no Paylocity row or
"posted 7 days ago" on a re-dating system, no `/jobs/field/retail` or
`/hospitality` links (Hospitality & Retail instead), the longer board note
naming the full-read rule, the EU/EEA/UK/India line naming what checkout
checks, and Pro's card read from the perk list. The Header and Footer are
today's (Start and credits; the Footer still lists Freelance Boost) until
hp/honesty ships the quiet Header and the Footer fix.

## Gate

- Frontend typecheck (`tsc -p tsconfig.app.json --noEmit`): passed after
  both merges and after the integration commit.
- The hp tests, targeted (`npx vitest run --maxWorkers=2 src/test/hp-*`): 10
  files, 170 tests, all passing (home 65, pricing 71, integration 34).
- The guards changed on `design/integration` since the builders branched
  (27 files) plus the src-wide guards (published-claims, design-no-raw-palette,
  the 24px-target guard, every-shard-string, the visitor budget, the two
  seller guards): 34 files, 1,048 tests, all passing.
- The full suite runs once, in the pre-push hook, when this branch is pushed.

## Open problems

1. **Strings are not in `src/i18n/shards/` yet.** Both builders kept them
   beside their pages (`src/lib/home/strings/`,
   `src/components/pricing/strings/`) with interim loaders, because a shard
   directory whose root key is not in `SHARD_ROOT_KEYS` (merge-shards.ts, an
   existing file) fails the shard guard and blocks the pre-push suite.
   Switch-over step 2 moves them.
2. **Pro's perks disagree with wave 4.** `origin/w4b/checkout-catalogue`'s
   `PRO_PERK_ITEMS` still lists Freelance Boost and Transition Pro,
   "Unlimited scans" and batch application prep, and
   `create-subscription-checkout` sends that list as the Stripe description;
   `origin/wave4/integration`'s `PRO_PERKS` still says "Unlimited scans" and
   "Every paid tool included … and all future tools". Wave 4 trims it before
   the switch-over (step 6); `hp-pricing-mirrors.test.ts` fails the day the
   export exists and still disagrees.
3. **Renewal consent is client-only.** The box gates the press, but
   `create-subscription-checkout` does not yet refuse without it or record
   the terms version and time (G7, wave 4's).
4. **The Full Analysis text is not written from a watched delivery (P18).**
   The pricing card's bullets ("A PDF, and a private link kept 90 days") and
   the homepage's `home.plans.faBody` describe a delivery nobody has watched.
   Both cards are gated, so nothing is sold on them, but the text must be
   rewritten from the G2 purchase before G2 opens.
5. **German register.** The homepage addresses the reader as "du" (31 forms,
   matching most of the board's strings); the pricing page as "Sie" (61 forms,
   no "du"). Other shared sentences also differ in wording between the pages
   (the bracket sentence in de, es, hi, nl, pt, tl; the unit words; "Create a
   free account" in nl). None of the eight translations has been reviewed by
   a native speaker. This is hp/i18n's: pick one register and one wording per
   sentence, in one pass over both string sets.
6. **Chrome owned by others.** Today's Header (no `variant="quiet"`, Start and
   credits) and Footer (Freelance Boost) render on both pages until hp/honesty
   ships its changes; axe's one Header "needs review" item comes with it.
7. **No production build, no LCP.** The 340 kB first-load cap and the LCP
   targets (375 throttled 1.2 s or less, 1280 2.5 s or less) are unmeasured
   until the switch-over build.
8. **No scroll-depth or time-on-page events on the new "/".** Adding
   `useScrollDepth("home")` and `useTimeOnPage("home")` pushed the visitor
   budget guard to 69 events per journey against its ceiling of 60 (step 13).
9. **Links that mean the scanner.** 16 places link to `/#upload` (Header,
   Jobs.tsx, JobPosting, Account, SetupChecklist, ProductPreview, Pricing);
   the router redirect keeps them working, at the cost of a hop. About 40
   `to="/"` / `navigate("/")` links in 23 files were written when "/" was the
   scanner; most are logo or "home" links, but a scan call to action among
   them would now land on the board (step 11 audits them).
10. **The fixture shows a raw Workday tenant name.** The recorded capture's
    first homepage row is "Shhotelsandresorts" (the board's own employer name
    for that token). The homepage prints the board's name as is; a bad name
    on the first row of "/" is more visible than on the board.

## The switch-over plan

Do this once the profiles/design train (`origin/pd/wire`: profiles 0-2,
design/integration, pd/bake, pd/accuracy, pass B) and wave 4
(`wave4/integration` and every `w4b/*` branch) are merged to main and
verified, together with hp/honesty (sales-gate.ts, the quiet Header, the
Footer without Freelance Boost, PurchaseTerms, H0) and hp/scanner (Index
delete-only, the ResumeUploader gate), in ledger order (owner decision 8).
Run `node scripts/deploy-ledger.mjs --overlap` before merging. The
reservation is `home-pricing`: branches `hp/`, no migration, no job-board
change, verify section 98, and free-keyword-scan's `fnBuildDate` (H0 only).

Line numbers are as of `origin/design/integration` dee9743d; wave 4 edits
App.tsx and Pricing.tsx, so find each line by its text.

### 1. Routes (src/App.tsx)

- Line 4: `import { BrowserRouter, Routes, Route } from "react-router-dom";`
  becomes `import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";`
- After line 24 (`const Index = lazy(() => import("./pages/Index"));`) add:
  ```tsx
  const HomePage = lazy(() => import("./pages/home/HomePage"));
  // "/#upload" was the scanner's address; the scanner lives at /resume-checker.
  // The redirect sits here, before lazy(HomePage), so a board "Check my fit"
  // costs no homepage chunk (spec P27). The job-description handoff is
  // sessionStorage (writeJdHandoff/takeJdHandoff), so nothing is carried.
  function HomeRoute() {
    const location = useLocation();
    if (location.hash === "#upload") return <Navigate to={`/resume-checker${location.search}#upload`} replace />;
    return <HomePage />;
  }
  ```
- Line 110: `<Route path="/" element={<Index />} />` becomes
  `<Route path="/" element={<HomeRoute />} />`. Line 192
  (`/resume-checker` → `<Index landing={TOOL_LANDINGS["resume-checker"]} />`)
  and the other tool landings stay.
- Line 47: `const Pricing = lazy(() => import("./pages/Pricing"));` becomes
  `const Pricing = lazy(() => import("./pages/pricing/PricingPage"));`. The
  `/pricing` route element (line 155) stays `<Pricing />`.
- Add `src/test/hp-routes.test.tsx`: "/" renders the homepage's H1; "/#upload"
  and "/?x=1#upload" land on `/resume-checker` with the search and hash kept,
  without importing `pages/home/HomePage`; "/pricing" renders
  `pricing-h1`; "/resume-checker" still renders the scanner.

### 2. Strings become shards

- `git mv src/lib/home/strings src/i18n/shards/home` and
  `git mv src/components/pricing/strings src/i18n/shards/pricing`.
- `src/i18n/merge-shards.ts`, `SHARD_ROOT_KEYS`: add `home: "home",` and
  `pricing: "pricingPlans",` (the pricing root key is `pricingPlans`, not
  `pricing`).
- Delete `src/lib/home/strings.ts`. In `src/pages/home/HomePage.tsx` delete
  line 10 (`import { useHomeStrings } from "@/lib/home/strings";`) and line
  45 (`useHomeStrings();`).
- Delete `src/components/pricing/use-pricing-strings.ts`. In
  `src/components/pricing/PricingView.tsx` delete line 17
  (`import "./use-pricing-strings";`). In `src/pages/pricing/PricingPage.tsx`
  delete line 27 and line 37 (`const ready = usePricingStrings();`) and
  render the three `ready ? … : …` branches (lines 49, 55, 59) as their
  ready forms.
- Tests: in `src/test/hp-home-strings.test.ts` set `DIR` to
  `resolve(__dirname, "../i18n/shards/home")`; delete the "home strings
  loader" describe block in `src/test/hp-home-search-and-strings.test.tsx`;
  in `src/test/hp-pricing-strings.test.ts` point `STRINGS` at
  `src/i18n/shards/pricing` and delete its "interim loader" block; in
  `src/test/hp-integration-one-voice.test.ts` replace `../lib/home/strings/`
  with `../i18n/shards/home/` and `../components/pricing/strings/` with
  `../i18n/shards/pricing/`. In
  `src/test/every-shard-string-is-loaded-translated-and-scanned.test.ts`
  ("both shards exist") add `"home"` and `"pricing"` to the expected names.

### 3. Strings crawlers must see

The bake reads the main locale (`EN_LOCALE`), so a shard key never reaches it.
Move these keys out of each language's shard file into the same language's
main file, `src/i18n/locales/<lng>.json`, in all nine languages. It must be a
move, not a copy: a key in both fails the shard guard's collision rule, and
the main files must keep identical key sets.

- Homepage (`home.*`): `seo.*`; `hero.title`, `sub`, `qLabel`,
  `qPlaceholder`, `locationLabel`, `locationPlaceholder`, `submit`,
  `tryLabel`, `try.*`, `count_*`, `counted`, `scanLead`, `scanLink`;
  `board.title`, `note`, `total_*`, `seeAll`, `applyNote`; `rail.title`,
  `boards_*`, `readBasis`, `fieldsTitle`, `allFields`; `account.*`; `scan.*`;
  `sample.*`; `ai.title`, `lede`, `neverTitle`, `never*`, `claude`, `chatgpt`,
  `claudeCode`, `reach`; `sources.*`; `plans.*`; `faq.*`. They stay in the
  shard: `hero.formLabel`, `hero.remoteWord`, `board.loading`, `ai.figure*`.
- Pricing (`pricingPlans.*`): `meta.*`, `head.*`, `before.*`,
  `buy.finalSale`, `buy.region`, `buy.gateSeller`, `buy.gateFaDelivery`,
  `buy.gateProWatched`, `free.*`, `fa.name`, `fa.unit`, `fa.what`,
  `fa.b1`-`fa.b5`, `fa.how`, `pro.name`, `pro.unit`, `pro.what`, `pro.step*`,
  `pro.perks.*`, `pro.review`, `pro.statusTitle`, `pro.statusBody`, `adds.*`,
  `b2b.*`, `limits.*`, `faq.*`. They stay in the shard: `fa.cta`, `fa.fine`,
  `pro.consent`, `pro.consentError`, `pro.cta`, `pro.fine`,
  `pro.memberActive`, `pro.manage`, `pro.owing`, `pro.updatePayment` (none
  renders while the gates are closed).
- Lighter alternative, with a precedent: the bake already reads one shard
  directly (`export { default as EN_COMPANY_SHARD } from
  "../src/i18n/shards/company/en.json";` in its data entry). Adding
  `EN_HOME_SHARD` and `EN_PRICING_SHARD` the same way would need no string
  move. Whoever owns the bake picks one; the steps below assume the move.

### 4. Retire the old pages

- `src/pages/Index.tsx` (hp/scanner, delete-only): with "/" routed away,
  every Index route carries a `landing`, so the `!landing && !freeKeywordResult`
  block that renders `<HomeHero agentOffer={<AgentOfferStrip />} />` (line
  2081 onward), `AgentOfferStrip` (line 418), `homeTotals`, `homeTitle` and
  `homeDescription` (lines 457-466) and their fallbacks in the SEO props
  (lines 2052-2054), and the then-unused imports (`HomeHero`,
  `useBoardTotals`/`roundedFloor` if nothing else reads them) are deleted. The
  `#upload` hash handling (lines 747-766) stays: the scanner is still reached
  at `/resume-checker#upload`.
- Delete `src/components/HomeHero.tsx`, and in the tests that read it:
  `agent-hallmark.test.ts` (HERO, the `<HomeHero` checks; the h1-exclusivity
  check becomes "Hero owns the h1 on every Index route"),
  `a-pass-number-on-a-page-is-a-placeholder.test.tsx` line 584,
  `pd-fix-section-83-reads-what-react-renders-and-every-title-form.test.ts`
  line 62, `a-company-count-that-names-both-of-its-numbers.test.ts` line 318
  and `the-headline-promised-zero-ghost-jobs-the-data-cannot-prove.test.ts`
  line 83: point each at `src/components/home/HomeSearchHero.tsx` where the
  rule still applies to the homepage's hero, otherwise drop the line.
- Delete `src/pages/Pricing.tsx` and its now-unread `pricingPage.*` keys in
  all nine main locales. That orphans `src/components/AddOnsShowcase.tsx` and
  `src/components/AgentSubscriptionCard.tsx` (and its five tests) unless wave
  4 has already removed them with the agent plan. Re-point the three guards
  that list `src/pages/Pricing.tsx`: `design-no-raw-palette.test.ts` (line
  112), `the-ats-defense-roles-promise-is-shown-in-the-readers-language.test.ts`
  (line 52) and `a-link-in-a-sentence-is-underlined-at-rest-on-the-money-path.test.ts`
  (line 19) read `src/components/pricing/*.tsx` instead.
- Delete `preview-home.html`, `preview-pricing.html`, `src/preview/home.tsx`,
  `src/preview/pricing.tsx`, `src/preview/pricing-network.ts` and
  `src/preview/preview-data.ts` with its fixture, or keep the home preview as
  a dev tool; neither is built.

### 5. Sale gates read hp/honesty's switches

- `src/lib/home/sale-gates.ts`: replace the `SALE_SWITCHES` literal with
  ```ts
  import { FULL_ANALYSIS_ON_SALE, PRO_ON_SALE, DIGEST_MAIL_CLASS } from "@/config/sales-gate";
  export const SALE_SWITCHES = { fullAnalysisOnSale: FULL_ANALYSIS_ON_SALE, proOnSale: PRO_ON_SALE, digestMailClass: DIGEST_MAIL_CLASS } as const;
  ```
  (use hp/honesty's actual export name for the digest ruling, G6). The pricing
  page's stand-ins already read `SALE_SWITCHES`, so both pages follow; the
  pricing README's alternative (re-export from sales-gate directly in
  `src/components/pricing/sale-gates.ts`) is equivalent.
- `hp-home-gates.test.ts`'s first case then reads the real switches, and
  `hp-pricing-mirrors.test.ts` ("the sale gates' stand-ins …") compares them
  with `sales-gate.ts`.

### 6. Pro's perks pinned to wave 4

- Wave 4 trims `src/config/pro-perks.ts` `PRO_PERK_ITEMS` to the owner's
  definition before it merges: "Everything in a free account"; the writing
  tools at 5 of each a day and 60 of each a month (a package is one of each);
  the $5 Full Analysis included; "No daily cap on scans"; cancel online.
  `includedOneOffs` (Freelance Boost, Transition Pro) and batch prep go;
  `PRO_INCLUDED_PRODUCT_IDS` becomes `["fullAnalysis"]`; the
  `create-subscription-checkout` description is built from the same list.
- `src/components/pricing/pro-perks-mirror.ts`: `PRO_PERK_ITEMS` and `ProPerk`
  become `export { PRO_PERK_ITEMS, type ProPerk } from "@/config/pro-perks";`;
  `PRO_PERK_REQUIRES` and `visibleProPerks` stay, keyed by wave 4's key for
  the included-Full-Analysis line.
- `src/test/hp-pricing-mirrors.test.ts`, "Pro's card says what wave 4's
  PRO_PERK_ITEMS says": drop the early return and assert instead that
  `PRO_PERK_ITEMS` is wave 4's export (identity), that its English texts have
  no "unlimited", "all-access", "now and future", Freelance or Transition,
  that one line reads "No daily cap on scans", that the writing line carries
  `{{perDay}}`/`{{perMonth}}` filled with `WRITING_ALLOWANCE` (5, 60), and
  that exactly one item is gated on `fullAnalysisOnSale`. Add the same
  assertions over the Stripe description `create-subscription-checkout`
  builds, so the page and the checkout cannot disagree again (P6).

### 7. Mirrors become imports

- `src/lib/home/board-figures.ts` `HOME_WITHHELD_SOURCES` and
  `src/components/pricing/plan-facts.ts` `WITHHELD_SOURCES`: import
  `MCP_WITHHELD_SOURCES` from `@/config/mcp-withheld` once wave 4 moves it out
  of mcp-tools.ts (P13); never import mcp-tools on "/".
- `src/lib/home/facts.ts` and `plan-facts.ts`: the scan allowance from
  `src/config/scan-allowance.ts`, the writing allowance from wave 4's
  `WRITING_ALLOWANCE`, the Builder price and proposal from
  `@/config/builder-plan` and `BUILDER_PROPOSED` where they exist. The
  mirror tests (and `hp-integration-one-voice`) keep pinning both pages to
  one set of facts.
- Once wave 4's `dataApiPage.builder*` keys are in the main locales, delete
  `pricingPlans.b2b.builderName`, `builderPrice`, `builderBody`,
  `builderNotYet` and `builderCta` from the pricing strings (BuilderAndLicence
  already prefers wave 4's keys).

### 8. Renewal consent on the server (G7, wave 4)

`create-subscription-checkout` refuses without `renewalConsent: true` and
records `renewalConsentVersion` (`"2026-10-17"`) and the time;
`useProSubscription().subscribe(email, consent)` sends the record. In
`src/components/pricing/BuyBlock.tsx` `ProBuyConnected`, `onGoPro={() => …}`
becomes `onGoPro={(consent) => …}` and calls
`subscribe(user.email ?? undefined, consent)`. If hp/honesty puts the
final-sale line, the region line and the G7 box into `PurchaseTerms.tsx`,
delete `SaleTermsLine` and the renewal box from `BuyBlock.tsx`
(`hp-pricing-decisions` test 4 fails on a duplicate final-sale line).

### 9. Chrome

`src/pages/home/HomePage.tsx` line 57 and `src/pages/pricing/PricingPage.tsx`
line 53: `<Header />` becomes `<Header variant="quiet" />` once hp/honesty
ships the variant (Sign in moves into the Menu sheet when the row does not
fit, never at a fixed 360 px). The Footer drops Freelance Boost in
hp/honesty.

### 10. The bake (scripts/prerender-seo.mjs)

- The data entry (line 214 onward) adds
  `export { pricingJsonLd } from "../src/components/pricing/pricing-jsonld";`,
  `export { resolveSaleGates } from "../src/components/pricing/sale-gates";`,
  `export { saleGates, homePlanRows } from "../src/lib/home/sale-gates";` and
  `export { HOME_FIELD_SLUGS, fieldPath } from "../src/lib/home/fields";`.
- The `path: "/"` block (line 1682): title and description from
  `home.seo.*`; the body prints the H1 and sub, the `GET /jobs` form
  (`q`, `location`), the count line with the bake's `COUNTS_BASIS`, the board
  note, field links from `HOME_FIELD_SLUGS` through the same slugs as
  `CATEGORY_LANDERS` (line 1124; `hospitality_retail`, never `retail` or
  `hospitality`), the scan, AI, sources and plan text with no offer while G1,
  G2 or G2b is closed, and the FAQ inside open `<details>`. No flow figure.
  JSON-LD offers follow spec 6: the Full Analysis only when
  `homePlanRows(saleGates()).fullAnalysis.state === "onSale"`, Pro only when
  `.pro` is non-null. `checkRetired` already covers "/" (line 1296).
- The `path: "/pricing"` block (line 3452): title and description from
  `pricingPlans.meta.*`; the body prints the gated page from the main-locale
  strings of step 3 (Before you buy, the three cards with their gate
  sentences, the comparison and FAQ inside open `<details>`, the limits
  table); JSON-LD is `pricingJsonLd(resolveSaleGates())` beside the
  breadcrumb, replacing the AggregateOffer built from every paid product
  (which would advertise prices that are not on sale).

### 11. Links that meant the scanner

Change the 16 `/#upload` links to `/resume-checker#upload` (Header.tsx line
70, ProductPreview.tsx 52, account/SetupChecklist.tsx 35, JobPosting.tsx 316,
Account.tsx 815/907/925/1360, Jobs.tsx 5059/5084/5497/7015/8201/10842; the two
in Pricing.tsx go with the file), so no visitor takes the redirect hop. Then
read each `to="/"`, `href="/"` and `navigate("/")` in `src/pages` and
`src/components` (about 40 in 23 files): a logo or "home" link stays; a scan
call to action becomes `/resume-checker`.

### 12. free-keyword-scan stamp (H0)

hp/honesty's H0 removes the free report's 21 probability references and the
Scan Pack offer; its only server part is a re-stamp of free-keyword-scan
after both `w4b/generators` and `w4b/payments-delivery` have stamped it:
`supabase/functions/free-keyword-scan/index.ts` line 470,
`const FN_BUILD = "free-keyword-scan.2026-10-14.1";`, becomes
`"free-keyword-scan.<switch-over day>.1"`, which reads later than
2026-10-14.22.

### 13. Analytics

`landing_view` keeps firing on "/" (VisitSource, for every route), and the
board and posting events (`job_board`, `job_page`) are untouched. Before
adding `useScrollDepth("home")` and `useTimeOnPage("home")` to HomePage,
re-derive `VISITOR_BUDGET_PER_HOUR` in
`supabase/functions/track-ab-event/budget.ts` and the journey in
`src/test/a-budget-that-charged-the-office-for-one-visitors-loop.test.ts`.

### 14. Verify section 98 (`scripts/verify-deploy.d/98-home-pricing.sh`)

A frontend and prerender deploy; read-only GETs with the Googlebot UA, in the
shape of section 83. Claims (every one FAILs before the deploy by design):

- C1 "/" serves the owner's H1 "Live jobs, straight from employers' own
  hiring systems", a `<form action="/jobs" method="get">` with `name="q"`
  and `name="location"`, and a count line that names its date basis.
- C2 "/" carries no "new · " flow pairing and no word "verified".
- C3 every `/jobs/field/` link on "/" is one of the category list's slugs
  (read from this checkout); none is `/jobs/field/retail` or
  `/jobs/field/hospitality`.
- C4 "/pricing" serves "All sales are final", names the EU, the EEA, the UK
  and India, and names the currency, time zone and IP checks, without
  "billing address"; it names neither Freelance Boost nor Transition Pro and
  prints no "unlimited".
- C5 while `sellerIdentity(SELLER)` is null in this checkout: no Offer for
  the Full Analysis or Pro in the JSON-LD of "/" or "/pricing", and no buy
  control in the baked HTML.
- C6 the free-keyword-scan preflight's `x-fn-build` is later than
  2026-10-14.22: `build_ge free-keyword-scan "$H98" 2026-10-14 23`.
- C7 the page React renders: the served entry and the English chunks carry
  the homepage H1 and do not carry the retired homepage hero's strings.
- C8 "/#upload" in a browser lands on `/resume-checker#upload` (one headless
  run, read-only), and "/resume-checker" still serves the scanner.

### 15. Before and after

- **Baseline (the day before):** run
  `keep/home-pricing-design/build/integration/tools/measure.cjs` against the
  live "/" and "/pricing" (point `PAGES` at production), plus a Googlebot
  curl of both, and save the numbers: live LCP is 1.12 s at 375 per the spec.
- **Lab gates at +1 day, on production:** LCP at 375 throttled 1.2 s or
  less, at 1280 2.5 s or less; CLS 0.02 or less with a scroll started before
  the list answers; axe 0 violations; no horizontal overflow at 320, 360 and
  375 px in the nine languages with every `<details>` open; the search box
  and first posting on the 375x812 first screen; first-load JS of "/" 340 kB
  gzip or less on the build; at most four Supabase data calls on "/"
  (vendor counts, freshness, list, fill curve) plus analytics; mcp-tools, the
  Index chunk, ResumeUploader and use-product-checkout not loaded on "/".
  Any gate failing is a fix before anything else ships.
- **Funnel at +7 and +28 days**, deduplicated by visitor (the funnel fixed on
  2026-10-01), against the 28 days before: sessions landing on "/"
  (`landing_view`, `landingPage` "/"), the share that reach the board
  (`job_board` events) and a posting page (`job_page` `posting_view`),
  employer apply clicks (`job_board` `apply_click`), uploads site-wide and
  from `/resume-checker` (`upload_started`, `upload_completed`), accounts
  created, `/pricing` views, and `checkout_started` (zero while the gates are
  closed). Report referred traffic (referral, social, organic) apart from
  direct: the 30-day funnel of 2026-10-01 was 131,336 direct against 22
  referral and 15 social, so the direct line says little about people.
- **Rollback triggers:** the board's anonymous-budget refusals rise (the list
  call cannot starve upload or checkout; they have their own counters);
  uploads site-wide fall by half or more at +7 with no recovery at +28;
  errors on "/" rise in the error dashboard.

## Appendix A. The homepage builder's notes (`hp/home`)

The builder's own record, kept for detail. Where it and the sections above
differ, the sections above are current: the switch-over plan replaces the
builder's, the integration changed the shared sentences listed under "What
the integration changed", and the integration run's numbers supersede the
builder's.

### Files

| Path | What it is |
|---|---|
| `src/pages/home/HomePage.tsx` | The page: head, Header, the sections, Footer. Default export, ready for `lazy()`. |
| `src/components/home/*` | `HomeSearchHero`, `HomeBoardRows`, `HomeBoardRail`, `HomeAccountStrip`, `HomeScanSection` + `SampleReport`, `HomeAiSection`, `HomeSources`, `HomePlanStrip`, `HomeFaq`, and `HomeDetails` (a `<details>` disclosure whose content stays in the DOM). |
| `src/lib/home/rows.ts` | Which live rows may show (`selectHomeRows`), the feed-read gate (`applyFeedReadGate`), the list call body, the reserved list box sizes. |
| `src/lib/home/use-home-rows.ts` | After first paint, never for a crawler or a driven browser: one list call, one fill-curve call, one commit. |
| `src/lib/home/use-board-freshness.ts` | `get_freshness_stats`, parsed; no figure without `computed_at`. |
| `src/lib/home/board-figures.ts` | The sources table, the FAQ's named systems, the AI line's reach; the withheld-systems mirror. |
| `src/lib/home/sale-gates.ts` | G1 (seller identity), G2, G2b, G6 and what the plan strip may say. |
| `src/lib/home/facts.ts` | Prices (products.ts), retention, scan time, scan allowance and writing allowance. |
| `src/lib/home/fields.ts` | Field links, typed against `BoardCategorySlug`. |
| `src/lib/home/stamps.ts` | UTC "counted {date}, {time} UTC", short durations, list joins. |
| `src/lib/home/search.ts`, `list-box.ts`, `automation.ts`, `use-min-width.ts`, `strings.ts` | The search address, the card context and row packing, the crawler check, a width hook, the strings loader. |
| `src/lib/home/strings/<lng>.json` | The home strings in all nine languages, under the root key `home`. |
| `preview-home.html`, `src/preview/home.tsx`, `src/preview/preview-data.ts`, `src/preview/fixtures/home-board-2026-10-18.json` | The standalone preview and its recorded board reads. |
| `src/test/hp-home-*.test.ts(x)` | Six test files, 65 tests (below). |

### Preview

```
npx vite --port 5181          # in the worktree; stop it afterwards
open http://localhost:5181/preview-home.html
```

| Query | Effect |
|---|---|
| (none) / `data=fixture` | The page's four reads answered from a read-only capture of the live board (2026-10-18 02:06 UTC), every stamp moved forward by the time since capture. |
| `data=live` | The real client: production, read-only, the calls a visitor's browser makes. |
| `rows=loading`, `rows=hidden`, `rows=slow`, `rows=worst` | The list in flight, refused, answering after 2.5 s, or with every card field filled (measurement only). |
| `lng=de` (any of the nine) | The interface language. |
| `gates=open` | The plan strip once every sale gate is open. No seller identity is invented: the gates are passed as booleans. |

The preview patches the shared Supabase client object in the preview page
only (the `functions` getter builds a new client per read, so the getter is
replaced). Nothing in the app imports `src/preview/**`; `vite build` builds
`index.html` only, so the preview never ships.

### What the page does, against the corrected spec

- **4.1 Hero.** The owner's headline word for word; one filled button on the
  whole page, "Search jobs". The form is a real `GET /jobs` with `q` and
  `location` (Jobs.tsx reads both); "Remote" as the place, in English or the
  reader's own word, becomes `mode=remote`. Try chips Nurse, Data analyst,
  Remote (+ Accountant, Warehouse from 480px). The count line is
  `openTotal` from `get_board_vendor_counts` with its `as_of` in UTC, and its
  height is reserved while the count is in flight. Scan link to
  `/resume-checker#upload`.
- **4.2 Board rows (P2, P4, P12, P24).** The board's own `JobCard`, ctx
  `{surface:"board", density:"comfortable"}`, href the posting page, no
  `onCheckFit`, no `onToggleSave`, no `menu`, inside a `<ul>`. Rows: up to five,
  distinct employers, employer-dated within 7 days, not gone, not agency, and
  never Paylocity, Breezy or UKG. One `get_company_fill_curve` call for the
  kept boards: a row keeps `recheckedAt` only where `feedReadStatable` passes;
  before the curve answers (2.5 s), no stamp, and a late curve is ignored. On
  error the list goes; "See all postings" and the field links stay.
- **Rail (P1, P3).** "{boards} job boards with an open posting", with "Half had
  a read in the {p50} before {time} UTC; 95% within {p95}. For the largest
  boards, a read is one part of the board." The flow figure is **removed**
  (D11): nothing reads `get_board_flow`.
- **Field links (P11).** healthcare, engineering, sales, finance, education,
  hospitality_retail, labelled with the board's own category names
  (`jobsPage.categories.<slug>`, already in nine languages), and All fields
  (`/explore`). A card from 1024px; a `<details>` under it.
- **Account strip (P5, P14, G6).** Saved searches, the tracker, "Your résumé,
  saved: Fit on any device, without dropping it again", writing tools one of
  each a day; "Fit is a word match. It does not predict interviews or offers."
  "and alerts" is printed only once the digest's mail class is ruled
  transactional or the seller is known (today: "Saved searches"). Hidden for a
  signed-in reader.
- **4.3 Scan + SampleReport (P9, P19).** One SampleReport inside a
  `<details>`: closed under 1024px with its text in the DOM, the right-hand
  column from 1024px. Foot: "Brackets mark facts only you know. Check every
  figure before you use it."
- **4.4 Your AI (P15, P16, P20).** The corrected lede ("Free on our side, with
  no account, within a shared daily allowance. In ChatGPT, your plan must allow
  custom connectors."), the never-list with the keyless wording, Claude /
  ChatGPT buttons and the Claude Code link (`/agents#…`), and "Your AI searches
  {aiSearchable} of the {openTotal} open postings: USAJOBS and SmartRecruiters
  postings ({withheld}) stay on this website. Counted …". Only Claude, ChatGPT
  and Claude Code are named.
- **4.5 Sources (P28).** The corrected lede (incl. "or when we stop reading
  that board"), the table (six largest systems, USAJOBS on its own row with its
  note, "{n} more systems ({sum})" computed), caption "… {openTotal} in all,
  the same count as above" only when the rows add up to `openTotal`.
- **4.6 Plan strip (G1, G2, G2b, P6, P17).** No buy control. Free leads
  ("Search, scans, fit and your AI, with no account" + the free account line).
  Full Analysis: "Not on sale yet. Purchases open soon, once the seller's
  name and address are published on the pricing page." (G1; the wording the
  integration settled) or "… We are checking that the
  report reaches buyers." (G2). Pro only with G1 and G2b; "5 of each a day and
  60 of each a month (a package is one of each), and no daily cap on scans",
  plus "The Full Analysis is included." only once G2 has passed. Terms before
  any click: "All sales are final." · "Not yet sold in the EU, the EEA, the UK
  or India, until we are registered for tax there. Checkout turns away buyers
  it can place there, from the currency, the browser's time zone and a lookup
  of the IP address." · "Prices in US dollars."
- **4.7 FAQ (P3, P5).** Five questions, answers in the DOM while closed; the
  corrected "How current is a posting?"; fit "free, with no account, in the
  browser where you scanned or dropped your résumé"; systems named from the
  same read.

#### Where the build differs from the mockup or the spec, and why

1. **Strings at `src/lib/home/strings/`, not `src/i18n/shards/home/`.** The
   shard loader globs every `src/i18n/shards/*/`, and
   `every-shard-string-is-loaded-translated-and-scanned.test.ts` fails on a
   directory whose root is not in `SHARD_ROOT_KEYS` (src/i18n/merge-shards.ts,
   an existing file). The pre-push hook runs the full suite, so a shard
   directory would block the push. The loader merges them exactly as a shard
   (deep, under main), English on module load, other languages only after
   their main file has arrived (`loadLocale` skips a language that already has
   a bundle). `hp-home-strings.test.ts` holds them to the shard guard's rules
   meanwhile. Switch-over step 1 moves them.
2. **The list box packs rows instead of hiding rows 4 and 5 under 640px.** The
   box is reserved before any row arrives (three rows of 11rem under 640px,
   the spec's 175px; five rows of 7.5rem from 640px, from 177 live rows
   measured on 2026-10-18: median card 106px from 768px, 90th percentile 132 to
   150px) and never changes height: a layout effect shows the leading rows
   that fit whole and hides the rest before paint. So the box can neither grow
   nor shrink, and the empty band under a short list is at most one card. A
   phone usually shows three or four rows.
3. **Header and Footer are today's** (`Header` with Start and credits; the
   Footer still lists Freelance Boost). The quiet header and the Footer fix are
   hp/honesty's; the HomePage switches to them at switch-over.
4. **Corrections the mockup still shows**: no flow figure, no Paylocity row,
   no Save buttons, no `/jobs/field/retail` or `/hospitality`, no "posted 7 days
   ago" on a re-dating system.
5. **The board total line names its basis** ("… open postings in all ·
   counted {date}, {time} UTC"), as every count must.
6. **The AI illustration prints its row's date** ("posted 16 Oct 2026") rather
   than an age that goes stale; it is desktop-only and the first thing to shed
   if the bundle is tight (P13).
7. **No scroll-depth or time-on-page events on "/".**
   `a-budget-that-charged-the-office-for-one-visitors-loop.test.ts` counts the
   call sites in `src/pages` against the visitor budget; adding them took a
   journey to 69 events against a 60 ceiling. Decide at switch-over (below).
8. **Try chips are translated; their queries stay English** (`q=nurse`):
   the board's postings are mostly English.
9. **Prices** come from `src/config/products.ts`; the scan allowance is a
   mirror of free-keyword-scan's constants and the withheld systems a mirror
   of `MCP_WITHHELD_SOURCES`, each held by a test.

### Measured (preview, fixture data unless marked live)

Screenshots and data: `keep/home-pricing-design/build/home/` (`shots/`,
`data/checks.*.json`).

| Check | Result |
|---|---|
| 375x812 first screen | search box bottom 326px, first posting title 727 to 751px (both on the first screen); live data the same |
| 1280x800 first screen | search box 244 to 288px, first posting title 522 to 546px |
| Filled buttons | one, "Search jobs" (375 and 1280) |
| axe 4.12.1 (WCAG 2.0/2.1/2.2 A+AA) | 0 violations at 375 and 1280; one "incomplete", `aria-valid-attr-value` on today's Header dropdown (Radix `aria-controls`) |
| CLS | 0 at 375, 0.0002 at 1280; with a scroll started before the list answers (`rows=slow`): 0 and 0.0002 |
| Overflow at 320, 360, 375, every `<details>` open | none in en, en-GB, de, es, fr, hi, nl, pt, tl (`checks.i18n.json`) |
| Targets under 24px, text under 12px | none |
| Copy sweep on the rendered page | only "Freelance" (today's Footer) |
| Home chunk (`lazy(HomePage)`'s own code, English strings included; every other module external), gzip -9 | 15.7 kB (63.3 kB raw), built from an archive export of 37310bdb in the scratch directory; each other language's strings 3.8 to 5.0 kB, loaded with the page. Predicted first load of "/": design entry 279.3 + CSS 18.9 + home 15.7 + shared listing chunk 13.5 = 327.4 kB, under the 340 kB cap; confirm on the switch-over build |
| Live rows (data=live) | Bass Pro (lap_proven) printed no feed-read time; four full_read boards did (the curve the page received was logged) |

### Tests (`npx vitest run --maxWorkers=2 src/test/hp-home-*`)

- `hp-home-rows.test.ts` (11): REDATING_SOURCES and undated rows dropped (also
  by id when the source column is empty), window, gone, agency, one row per
  employer, five at most; the feed-read gate on the pd/wire two-board fixture
  (Acme full_read, Domino's lap_proven), every lap bucket, a failed feed, a
  missing curve row, and no stamp before the curve.
- `hp-home-page.test.tsx` (16): rendered page with the board's reads mocked:
  headline, one filled button, the count line in UTC with its `<time>`; the
  stamp only on the full-read card; no re-dating or undated row; no
  Save/Check fit/menu; at most four data calls and no `get_board_flow`; no
  "new · gone" text; list hidden on refusal; no list call for a driven browser;
  every count of 1,000 or more inside an element that names its time; FAQ answers
  and sources table in the DOM while closed; field links only from the
  category list; plan strip with G1 closed, G2 closed, all open; account strip
  without "and alerts".
- `hp-home-strings.test.ts` (19): nine files, root key, no collision, key
  parity with plurals as one key, plural categories, no empty value,
  placeholder and tag parity; the headline; per language no "verified", ghost
  jobs, "unlimited", hiring odds, another AI host, retired product or price,
  billing-address check; "chances" only in the never-list; no typed number.
- `hp-home-mirrors.test.ts` (7): withheld systems = `MCP_WITHHELD_SOURCES`;
  scan allowance = free-keyword-scan; no import of mcp-tools, Index,
  ResumeUploader, use-product-checkout, Pricing or Jobs; no flow read; job-board
  only through `invokeJobBoard`; JobCard mounted without save, fit or menu.
- `hp-home-gates.test.ts` (5) and `hp-home-search-and-strings.test.tsx` (7).

Negative controls (each mutation turned the named tests red, files restored):
REDATING filter and the dated-age check removed; stamp passed without the
gate; "unbegrenzte Scans" in German; a typed "90 secondes"; `onToggleSave` on
the home card; an unfiltered "retail" field; Pro on sale without a seller.

## Appendix B. The pricing builder's notes (`hp/pricing`)

The same rule: the sections above are current where they differ.

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
