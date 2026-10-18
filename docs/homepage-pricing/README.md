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

## Homepage (branch `hp/home`)


Built from the corrected spec in `reports/homepage-pricing-design-2026-10-17.md`
(sections 3 and 4, problems P1 to P30, owner decisions of 2026-10-17) and the
board-first mockups in `keep/home-pricing-design/final/`. "/" becomes the job
search with live postings; the free résumé scanner moves to `/resume-checker`.

**This round creates new files only.** Nothing existing is edited: App.tsx,
Index.tsx, the locales, the Header, the Footer, the bake and the shard
registry are changed at switch-over, listed exactly below. Until then the page
is reachable only through the preview.

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
  Full Analysis: "Not on sale yet. Sales open once the seller's name and
  address are published on this page." (G1) or "… We are checking that the
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

### Switch-over plan (exact changes to existing files)

Order: after the pd/wire train and wave 4 are merged and verified (decision
8), with hp/honesty, hp/pricing and hp/scanner.

1. **Strings into the shard directory.**
   - `git mv src/lib/home/strings/*.json src/i18n/shards/home/`
   - `src/i18n/merge-shards.ts`, `SHARD_ROOT_KEYS`: add `home: "home",` (and
     hp/pricing's `pricing: "pricing",`).
   - Delete `src/lib/home/strings.ts`; in `src/pages/home/HomePage.tsx` remove
     `import { useHomeStrings } from "@/lib/home/strings";` and the
     `useHomeStrings();` line.
   - `src/test/hp-home-strings.test.ts`: `DIR` becomes
     `resolve(__dirname, "../i18n/shards/home")`; delete the "home strings
     loader" block from `hp-home-search-and-strings.test.tsx`.
   - `every-shard-string-is-loaded-translated-and-scanned.test.ts` then
     covers them (optionally add `"home"` to its "both shards exist" list).
2. **Strings the bake must print go into `src/i18n/locales/en.json`** (the
   bake reads the main locale): `home.seo.*`; `home.hero.title`, `sub`,
   `qLabel`, `qPlaceholder`, `locationLabel`, `locationPlaceholder`, `submit`,
   `tryLabel`, `try.*`, `count_*`, `counted`, `scanLead`, `scanLink`;
   `home.board.title`, `note`, `total_*`, `seeAll`, `applyNote`;
   `home.rail.title`, `boards_*`, `readBasis`, `fieldsTitle`, `allFields`;
   `home.account.*`; `home.scan.*`; `home.sample.*`; `home.ai.title`, `lede`,
   `neverTitle`, `never*`, `claude`, `chatgpt`, `claudeCode`, `reach`;
   `home.sources.*`; `home.plans.*`; `home.faq.*`. Not needed by the bake:
   `home.hero.formLabel`, `remoteWord`, `home.board.loading`,
   `home.ai.figure*` (desktop illustration).
3. **`src/App.tsx`.** Keep `Index` for the scanner routes; add the homepage
   and change the "/" route:
   ```tsx
   const HomePage = lazy(() => import("./pages/home/HomePage"));
   function HomeRoute() {
     const location = useLocation();
     if (location.hash === "#upload") return <Navigate to={`/resume-checker${location.search}#upload`} replace />;
     return <HomePage />;
   }
   // …
   <Route path="/" element={<HomeRoute />} />
   ```
   (`Navigate`, `useLocation` from react-router-dom; `/resume-checker` keeps
   `<Index landing=… />`; the JD handoff is sessionStorage, nothing to carry.)
4. **Header**: in `HomePage.tsx`, `<Header />` becomes `<Header variant="quiet" />`
   once hp/honesty ships the variant (Sign in moves into the Menu sheet when
   the row does not fit).
5. **Sale gates**: in `src/lib/home/sale-gates.ts`, replace the
   `SALE_SWITCHES` literal with `FULL_ANALYSIS_ON_SALE`, `PRO_ON_SALE` and the
   digest mail-class ruling from `src/config/sales-gate.ts` (hp/honesty); keep
   `hp-home-gates.test.ts` (its first case then reads the real switches).
6. **Mirrors to imports** when the modules exist:
   `HOME_WITHHELD_SOURCES` → `import { MCP_WITHHELD_SOURCES } from "@/config/mcp-withheld"`
   (wave 4, P13); the scan allowance → `src/config/scan-allowance.ts`; the
   writing allowance → wave 4's `WRITING_ALLOWANCE`; the Pro row's line →
   `PRO_PERK_ITEMS` (decision 2). The Full Analysis row's sentence is
   rewritten from the G2 watched delivery (P18) before G2 opens.
7. **`scripts/prerender-seo.mjs`, the `path: "/"` block**: print the new page
   (h1, sub, `GET /jobs` form, the count line with the bake's counts basis,
   the board note, field links from `CATEGORY_LANDERS` slugs, scan, AI,
   sources table, plan strip with no offer while G1/G2/G2b are closed, the FAQ
   in open `<details>`); no flow figure; JSON-LD offers per spec 6.
8. **Verify section 98** (spec 6): "/" has no "new · " pairing; no
   `/jobs/field/` link outside the category list; the free-keyword-scan stamp
   is later than 2026-10-14.22.
9. **Analytics**: if "/" should send scroll-depth and time-on-page events,
   re-derive `VISITOR_BUDGET_PER_HOUR` in `supabase/functions/track-ab-event/budget.ts` and the
   journey in `a-budget-that-charged-the-office-for-one-visitors-loop.test.ts`
   first; then add `useScrollDepth("home")` and `useTimeOnPage("home")` to
   HomePage.
10. **Preview files**: keep `preview-home.html` and `src/preview/**` as a dev
    tool, or delete them; neither is built.
11. **Bundle**: measure the first load of "/" on the switch-over build against
    the 340 kB gz cap (spec 8); the home chunk measured 15.7 kB gz (above).


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
