# The new homepage (branch `hp/home`, from `origin/design/integration`)

Built from the corrected spec in `reports/homepage-pricing-design-2026-10-17.md`
(sections 3 and 4, problems P1 to P30, owner decisions of 2026-10-17) and the
board-first mockups in `keep/home-pricing-design/final/`. "/" becomes the job
search with live postings; the free résumé scanner moves to `/resume-checker`.

**This round creates new files only.** Nothing existing is edited: App.tsx,
Index.tsx, the locales, the Header, the Footer, the bake and the shard
registry are changed at switch-over, listed exactly below. Until then the page
is reachable only through the preview.

## Files

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

## Preview

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

## What the page does, against the corrected spec

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

### Where the build differs from the mockup or the spec, and why

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

## Measured (preview, fixture data unless marked live)

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
| Live rows (data=live) | Bass Pro (lap_proven) printed no feed-read time; four full_read boards did (the curve the page received was logged) |

## Tests (`npx vitest run --maxWorkers=2 src/test/hp-home-*`)

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
  every five-figure count inside an element that names its time; FAQ answers
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

## Switch-over plan (exact changes to existing files)

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
    the 340 kB gz cap (spec 8); the measured home chunk is below.
