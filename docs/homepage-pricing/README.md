# The board-first homepage and the new pricing page (branches `hp/*`)

Built from the corrected spec, `reports/homepage-pricing-design-2026-10-17.md`
(the 30 review problems, the revised owner decisions and section 4), and the
final board-first mockups in `keep/home-pricing-design/final/` (the scratchpad
`keep/` tree was emptied on 2026-10-23; a copy of the mockups made on
2026-10-17 is in `~/.config/resumebooster/keep-backup-2026-10-17/home-pricing-design/final/`). "/" becomes
the job search with live postings, the free résumé scanner moves to
`/resume-checker`, and `/pricing` leads with what is free.

**The switch-over is built: `hp/switch-over` routes "/" to the homepage and
`/pricing` to the new pricing page.** Nothing live changes until that branch
is merged and published after wave 4; [the switch-over
record](#the-switch-over-record-2026-10-26) says what each step did, where it
departed from the plan, what was measured and what is still open, and [the
owner's decisions and the report sweep](#the-owners-decisions-and-the-report-sweep-2026-10-27)
replace step 15's two speed targets and take the configured figures out of the
free report, and [the review of the sweep](#the-review-of-the-report-sweep-2026-10-27)
fixes what that round left (predictions, a placement among scans, hand-typed
lists shown as current, the speed gate's margin and consequence). The
sections from "What was built" to "The switch-over plan" are the record of
the branches it merged, kept as written; where they say the pages are
reachable only through the previews, that was true before the switch-over.

**On land/all (merged 2026-10-31), sales stay on and no place is refused.**
[Landing on land/all](#landing-on-landall-2026-10-31) says what the merge
changed in this branch's design: the owner's rules of 2026-10-27 (no sales
pause; the EU, the EEA, the UK and India buy as today) win over the closed
states and the region lines described below, so where a section below says a
page shows "purchases open soon", names the territory or waits for the
seller's name, that is the record of `hp/switch-over`, not what land/all
ships.

| Branch | Head | What |
|---|---|---|
| `hp/home` | 7a30bc23 | the homepage (Appendix A) |
| `hp/pricing` | 50de7209 | the pricing page (Appendix B) |
| `hp/integration` | a7a11712 | both, the integration (70e4e525), the fix round of 2026-10-18 and the rounds of 2026-10-24 and 2026-10-25 below |
| `hp/honesty` | 5c74e112 | the quiet Header, the Footer without Freelance Boost, `src/config/sales-gate.ts`, PurchaseTerms' final-sale and region lines, H0 |
| `hp/scanner` | e7040d18 | Index delete-only, the scanner's old addresses, every buy control's gate, the mail links to `/resume-checker` |
| `hp/switch-over` | this branch | cut from `hp/honesty`, merges `hp/scanner` and `hp/integration`, then the switch-over steps 1-15 and [the review round](#the-review-round-2026-10-26) |

`origin/design/integration` is merged into main (PR #36, 57815de9) and was
deployed on 2026-10-18, so the PR (#38, base `design/integration`) now reads
against a branch main already holds. **The switch-over starts from main**:
cut the switch-over branch from `origin/main`, merge `hp/integration` into
it, and read every line number below by its text on main. Main has moved
20 commits past `design/integration` (most of them Lovable's, up to
8a6561c4 on 2026-10-18); of the files the switch-over edits, only
`scripts/prerender-seo.mjs` differs (a deadline on the company-intel phase,
11 lines added near line 2496, so the `/pricing` block of step 10 sits 11
lines lower). This branch has not merged main, by decision. `git diff --name-status origin/design/integration...hp/integration`
lists 92 paths, every one of them added (status A). No existing file is
modified.

## The switch-over record (2026-10-26)

`hp/switch-over` is cut from `origin/hp/honesty` 5c74e112 and merges
`origin/hp/scanner` e7040d18 and `origin/hp/integration` a7a11712, all three
on wave 4's f4ccfeae. The draft PR's base is `wave4/integration`, which ships
first. One commit per step, in this order:

| Step | Commit | What is now true |
|---|---|---|
| 9 (the page lines) | 61865c37 | Both pages render `<Header variant="quiet" />`. Before App.tsx routed either page, `HP_ASSUME_ROUTED=1` ran hp-fix-switch-over-gate 5 of 5 (W7). |
| 1 | c37ae761 | One swap: "/" is `<ScannerAddressRedirect><HomePage /></ScannerAddressRedirect>` (HomePage lazy, the redirect eager), `/pricing` imports `pages/pricing/PricingPage`. `SCANNER_AT_ROOT` is deleted with its test. |
| 2 | 92bacb81 | `src/i18n/shards/home` ("home") and `src/i18n/shards/pricing` ("pricingPlans") are in `SHARD_ROOT_KEYS`. Both pages wait on `useLocaleReady`, which opens once the reader's main locale (now carrying the shards) has landed, or after 6 s. |
| 3 | 3608f5d0 | The plan's lighter alternative: the bake reads the two English shards directly, as it reads the company shard. No string moves into the nine main locales. |
| 4 | 7f53ee64 | `src/pages/Pricing.tsx` and its `pricingPage` strings are deleted in nine languages, with the test that read the old page. |
| 5 | baa0ca80 | `SALE_SWITCHES` and `resolveSaleGates` read `FULL_ANALYSIS_ON_SALE`, `PRO_ON_SALE` and `DIGEST_MAIL_CLASS` from `src/config/sales-gate.ts` when they are called. |
| 6 | 8b496cfa | Pro's card lists wave 4's `PRO_PERK_ITEMS`. The noun is "packages": `proPlan.perks.writingToolsPackages` exists in nine languages, and the "sets" key is gone. create-subscription-checkout carries 2026-10-26.1, because its Stripe description is built from that list. |
| 7 | 29d3a387 | The writing allowance and the Builder price are imported. The Builder card prints /data-api's own strings. |
| 8 | a770c9d3 | PurchaseTerms' own box is the only renewal box. It sits above Go Pro, is bound to its label by id, and is marked `aria-invalid` and `aria-describedby` the alert when Go Pro is pressed with the box empty. |
| 10 | 3608f5d0 | The bake writes "/" and "/pricing" from the same facts and gates React reads. The offers on "/" come from `pricingJsonLd(resolveSaleGates()).offers`, and while no seller is named that is one free Offer. `/pricing` is count-bearing. The baked H1 is the size React renders, so the desktop LCP element stays the baked H1. |
| 11 | 935a37b4, c20f793e | Every link that meant the scanner opens `/resume-checker` (or `/resume-checker#upload`). Logo, breadcrumb and "back home" links stay on "/". The first commit read only `src/pages` and `src/components`, and missed four guides' scan pills (`src/data/guides.ts`), every company page's "free resume scan" link (`prerender-pages.mjs`) and the CV-standards button (`prerender-seo.mjs`); the review round points them at `/resume-checker`, with a guard over every link to "/" in `src/pages`, `src/components`, `src/data` and both prerender scripts. The last mail link, send-product-email's "try again" button for a failed Full Analysis payment, opens `/resume-checker` since the round of 2026-10-27 (send-product-email 2026-10-27.1). |
| 12 | 592655e7 | No change: free-keyword-scan already carries H0's 2026-10-25.2. |
| 13 | 592655e7 | `/pricing` keeps the old page's scroll-depth and time-on-page events under "pricing". "/" adds none. |
| 14 | 8940ac33, 67749eeb | Verify section 99 and its headless half, `scripts/verify-home-pricing-rendered.mjs`. A fake-curl test proves each line can PASS, FAIL and INFO. |
| SEO-041 | 8d9f90b8, 82ff0d93 | The posting cards load in their own chunk once the list is asked for. Three sentences render through `TaggedText` instead of `Trans`. The field links read `home.rail.fields.*`, so the board's string namespace loads with the cards. The list's box constants live in `rows-box.ts`, and the AI illustration's place is written out. |
| ledger | 1b032918, 3ea934fb, 72c793b9 | Every file shared with an in-flight branch has one owner. Section 92 now reads the `PricingPage` chunk. create-product-checkout carries 2026-10-26.1. |

**Where it departs from the plan**

- **Step 3** takes the lighter alternative. It costs about 6.6 KB gzip in the bake's data entry and nothing in the browser.
- **Step 4** keeps the two previews as development tools. `vite build` builds `index.html` only.
- **Step 6** also re-stamps create-product-checkout. Its bundle imports `_shared/pro-perks.ts`, so its code differs from wave 4's under the same stamp, and `deploy-ledger --against origin/wave4/integration` refused that (exit 3). Nothing it does changed.
- **Step 7 is partial.** The scan allowance, the free-key quota, the fit allowance, the withheld systems and the API proposal are still mirrors, each held by its test. No small frontend module holds them yet, and "/" never imports `mcp-tools`.
- **Step 13** keeps the pricing page's two events, so the pricing funnel reads on and the visitor budget counts what it counted before.
- **Sections that judged the old pages** now judge the new ones: 72, 73, 74, 83 and 98. 92's checkout-catalogue section reads `PricingPage` (before this change, `Pricing`), and counts the paid cards' `pricingPlans.buy.gateSeller` as its purchases-open-soon line.
- **SEO-041** was done inside the switch-over (above).

**Measured.** The method:

- Production builds of `git archive` exports, base `origin/hp/honesty` 5c74e112 and after 82ff0d93. No frontend file changed after 82ff0d93.
- Each was baked under the read-only fetch guard and served the way Lovable resolves paths.
- Playwright 1.62.1 ran through heavy.sh.
- Production was read only. GETs passed, an RPC was re-sent as a GET, and a job-board read carried `x-rb-budget: probe`. Every other write was answered inside the browser: 0 on every run.
- Measurement files and pictures are in `~/.config/resumebooster/home-pricing-switch-over-2026-10-26/`, with `before/`, `after/`, `verify/` and `tools/`.

| What | Before (old "/") | After (82ff0d93) |
|---|---|---|
| "/" static closure (entry plus route chunk, gzip) | 85 files, 420,753 B | 38 files, 299,675 B |
| "/" JS loaded once the page settles (cards and consent banner included) | 88 files, 423,506 B | 58 files, 350,608 B |
| `/pricing` static closure | 37 files, 282,649 B | 36 files, 290,681 B |
| `/pricing` JS loaded | 43 files, 287,040 B | 42 files, 295,080 B |
| LCP, desktop 1280x800, first visit (3 runs) | baked H1, 167-177k px², 1.44-2.78 s | baked H1, 56-58k px², 0.28-0.56 s |
| LCP, desktop, consent already chosen | baked H1, 0.44-1.96 s | baked H1, 0.12-0.18 s |
| LCP, phone 375x812 at 4x CPU, first visit, network unthrottled | baked count line, 89k px², 1.02-1.11 s | the consent banner's text, 30k px², 1.36-1.58 s (not baked) |
| LCP, phone, consent already chosen, network unthrottled | baked count line, 0.40-0.58 s | baked "Posted in the last 7 days" line, 25k px², 0.23-0.27 s |

These phone rows named no network profile and were taken on an unthrottled
local network, so they understated the regression. The review round re-measured
under the Lighthouse mobile profile (150 ms RTT, 1.6 Mbps, 4x CPU): this build
was 5.66-5.69 s on a first visit against the old page's 2.18-2.38 s, and the
claimed gain with consent chosen did not reproduce (2.25-2.27 s against
2.18-2.19 s). [The review round](#the-review-round-2026-10-26) closes the
regression and has the current numbers.

**The layout matrix.** It covered 320, 360, 390, 414, 768, 1024, 1280 and 1440 px, light and dark, EN, DE, HI and TL, on both pages: 128 cells. No cell had horizontal overflow, with `<details>` closed or open. None had clipped text or overlapping controls or headings.

**The first screen at 375x812** (both themes, the same):

- the H1 at 76-166 px;
- the search field at 282-326 px;
- Search jobs at 408-452 px;
- the first posting starts at 718 px, so it is cut off at the fold.

Pictures: `after/shots/` (138) and `before/shots/` (16).

**Verify against the local after build** (sections 50, 52, 83, 99, 92-*, 76 and 98, served locally with writes stubbed):

- Section 99 passes every frontend claim: C1-C5, C7-C11.
- C6 fails only because the six functions are not deployed yet.
- Every other FAIL also fails on the base build, served the same way. Those are wave 4's functions and migrations not yet deployed, plus canonical-host artifacts of serving on 127.0.0.1.

Against production today, section 99 fails C1-C9 and C11, as it should before the publish. C10 passes.

**Open after the switch-over** (as of the review round; the round's own list is below)

1. The phone first-visit LCP regression is closed (the review round).
2. The Full Analysis text is still not written from a watched delivery (P18). Both cards stay gated.
3. Per-language register (German "du" against "Sie", Hindi's two spellings): hp/i18n's single pass.
4. The phone list now ends at its last packed row (the review round); with today's tall rows a phone shows two or three.
5. The publish still waits on the WHEN list below. W2: wave 4 must be merged and verified. W3: production still answers `agent_sender_public_status` true. Section 99's C10 now also reads `/llms.txt` and the FAQ `/resume-checker` renders, both of which say we never submit an application, so C10 fails until W3 holds.

**The deploy step.** Run it once wave 4 is deployed and verified:

1. Deploy the eight functions `deploy-ledger --against origin/wave4/integration` names (six since the review round; the round of 2026-10-27 re-stamps free-keyword-scan and adds free-keyword-scan-stream and send-product-email; the review of that round re-stamps both scan functions 2026-10-31.1):
   - free-keyword-scan 2026-10-31.1;
   - free-keyword-scan-stream 2026-10-31.1;
   - send-scan-report 2026-10-25.1;
   - send-search-digest 2026-10-25.1;
   - send-market-pulse 2026-10-25.2;
   - create-subscription-checkout 2026-10-26.1;
   - create-product-checkout 2026-10-26.1;
   - send-product-email 2026-10-27.1.
2. Publish the frontend once. No migration.
3. Run `bash scripts/verify-deploy.sh` and read section 99, then 83, 92 and 98.
4. Regenerate the Lovable message at the merge commit on main with `node scripts/deploy-ledger.mjs --message`.

## The review round (2026-10-26)

A review of the switch-over (layout, terms, crawler and route lenses, each
finding re-verified) confirmed 37 findings. This round fixes them on
`hp/switch-over`, test first: each commit's test failed on the code before it.
No edge function changed in this round; the round of 2026-10-27 changes three (the deploy step above names them).

| Finding | What is now true | Commit |
|---|---|---|
| Scan links to "/" (guides, company pages, CV-standards, manifest) | They open `/resume-checker`; the manifest's shortcut opens `/resume-checker#upload` and its description drops "matched to your resume"; a guard reads every link to "/" | c20f793e |
| The free report predicted outcomes and ranked the reader (the comparison vocabulary mismatch told every reader "below") | The report opens with its score and findings; the verdict sentence, the placement among scans, "How You Compare", callback multipliers, the recruiter line, the peer percentile and pass-rate cards, the spotlight percentile, the PDF line, the share card's percentile, the personalised section's configured average and "resumes that get interviews" are gone; the mail payload carries no percentile or pass rate, so the mail prints none | d13885b9, 396f2bae |
| The share card named resumescanner.ai | It names Resume Booster and `resumebooster.work/resume-checker`, in the reader's language | 8f0fdde0 |
| The scanner FAQ sold both products and printed a delivery time; the closing grid sold retired features; the hero printed an undated floored count and "matched to your resume" | The FAQ follows the sale gates (closed, Full Analysis only, both); the grid, the interview badge, "Instant results" and the interview arithmetic are gone; the hero has no count and ends with a free check against any posting | d785adb2 |
| "Ask for your résumé." as a blanket promise; "works everywhere"; French "pack"; the 69-character title; "planned" twice | "Ask for your résumé to search the board."; "still work there"; "lot"; every "/" title 60 characters or fewer; the Builder price says no "planned" (on `/data-api` too) | 6955350f |
| Go Pro and the Full Analysis link shown to a refused territory; Pro's Claude Code fit printed 25; two spellings of $45; Pro could go on sale before the Full Analysis | The time-zone notice replaces both buy controls there (members keep Manage); Pro's cell says 1,000 a day with a key on a Pro account; PurchaseTerms uses `money()`; `sales-gate.ts` orders the switches and its test fails on the other order | ffcba0fb |
| `/pricing#pro` ended at the footer; `/auth` back to `#pro` and `/data-api#builder` opened at the top | `scroll-to-fragment` lands every fragment on React's element; the baked cards carry no id | db581c20 |
| A 150-170 px hole under three phone rows | `packRows` ends the box at its last row whenever its new bottom stays at or below the fold | ea7da4fd |
| The banner hid focused controls (WCAG 2.2 SC 2.4.11); its text was the phone LCP; the baked header overflowed 320 px | While open: bottom scroll padding, body end room and `--consent-banner-h` for the help button; its body is two paragraphs; the headline starts at 30 px on phones; the baked nav wraps | 74a85bcd, 90ff2212, 8d8113ed |
| llms.txt followed the seller alone; llms-full.txt called the root the scanner | llms.txt follows the pages' gates (`llms-lines.ts`); llms-full.txt leads with the board and names `/resume-checker` | 0d22493c |
| Any `?ref=` went to the scanner; the fallback's scripts showed and preloaded the homepage on a scanner address and left its JSON-LD on the scanner; `/resume-checker` preloaded no route chunk | Only a 12-hex code redirects; the fallback's scripts read the route's rule (cleared page, scanner preloads); the redirect removes the home-only blocks; the landings preload `Index` | c78cfcd8 |
| The two shards rode in every page's entry | They load with their pages (`home-strings.ts`, `pricing-strings.ts`); section 99's C7 reads the HomePage chunk | f3d4513d |
| The dashboard labelled the scanner's events "Home" | "Scanner pages" | 8545d7fc |
| Section 99 missed the query-carrying addresses, the fragment landing and three never-submit surfaces | C8 opens the rescan link, `/?ref=<12-hex>` and `/?ref=producthunt`; C12 opens `/pricing#pro`; C10 reads `/resume-checker`, `/llms.txt` and the FAQ | 7609f92d |
| The "/" JS gate's meaning was unstated | Decided below; the homepage no longer imports `posting-page.ts` | 1c2e5374 |

**Measured** (production builds of `git archive` exports, baked under the
read-only fetch guard, served the way Lovable resolves paths, Playwright
1.62.1 through heavy.sh, 0 writes answered on every run). Before = the old
"/" (wave 4, `hp/honesty` 5c74e112); first build = 82ff0d93 (0364bdd7's
frontend); now = 8d8113ed. Files are in
`~/.config/resumebooster/home-pricing-switch-over-2026-10-26/fix-round/`.

| What | Before | First build | Now |
|---|---|---|---|
| Entry chunk, gzip | 205,726 B | 212,466 B | 207,144 B |
| "/" static closure | 85 files, 420,753 B | 38 files, 299,675 B | 38 files, 287,049 B |
| "/" JS loaded once the cards render | 88 files, 423,506 B | 58 files, 350,608 B | 58 files, 349,482 B |
| `/pricing` static closure | 37 files, 282,649 B | 36 files, 290,681 B | 36 files, 289,594 B |
| `/jobs` static closure | 78 files, 482,925 B | 86 files, 493,719 B | 86 files, 488,137 B |
| A posting page's static closure | 39 files, 327,040 B | 44 files, 337,065 B | 44 files, 331,501 B |
| LCP, phone 375x812, Lighthouse mobile profile, first visit (3 runs) | baked count line, 89k px², 2.18-2.21 s | consent text, 30k px², 5.66-5.69 s | baked H1, 37k px², 2.22-2.34 s |
| the same, consent chosen | 2.17-2.19 s | 2.25-2.27 s | 2.22-2.23 s |
| the same at 320x640 and 414x896, first visit | 2.17-2.19 s | not measured | baked H1, 2.22-2.24 s (31k and 45k px²) |
| LCP, phone 375 at 4x CPU, network unthrottled, first visit / consent chosen | 0.23-0.26 / 0.22-0.24 s | 0.30 / 0.24 s | 0.22-0.25 / 0.21-0.22 s |
| LCP, desktop 1280x800, first visit / consent chosen | baked H1, 0.44-0.46 / 0.44-0.45 s | 0.12-0.14 s | baked H1, 0.13-0.20 / 0.11-0.12 s |

The first build's columns are the reviewers' measurements; "before" and "now"
were measured together on one machine.

- **Fragments** (fresh loads, 375 px at 4x CPU and 150 ms RTT, and 1280 px):
  `#free`, `#full-analysis`, `#pro`, `#pricing-limits` and `#pricing-faq`
  each end with their element's top at 56 px (375) or 64 px (1280), one pixel
  above the header's bottom edge, never at the page's end.
- **The list**: six languages (en, de, es, fr, hi, tl) at 320, 360, 375, 390,
  414 and 768 px, 740 and 812 px tall, live rows: the blank under the last row
  is 0-2 px in all 66 cells (the first build: up to 170 px). Today's rows are
  tall, so phones show two or three of five.
- **Focus under the banner** (Tab walk, judged after scrolling settles, five
  points per control): 0 fully hidden stops on "/" and `/pricing`, at
  1280x800 and 390x740, forward and back (the first build: 34 of 77 and 34 of
  63 on "/"). With consent chosen, 0 as before.
- **The first screen at 375x812**: the H1 at 76-191 px, search at 307-351,
  Search jobs at 433-477, the first posting from 743 px (cut at the fold).
- **No JavaScript at 320 and 360 px**: no sideways scroll on "/" or `/pricing`
  (the first build: 13 and 10 px at 320).

**README step 15's gates, judged on these numbers**

- *First-load JS of "/" 340 kB gzip or less.* The gate's words are "first-load
  JS", and its prediction (Appendix A: entry, CSS, home chunk and the listing
  chunk) counted what loads for the first view, cards included. So it judges
  the JavaScript loaded once the cards render, the stricter reading: **349,482
  B, 9.5 kB over: FAIL.** (The static closure, 287,049 B, would pass; the
  stylesheet, 19,960 B, is not JavaScript.) Removing the homepage's own import
  of `posting-page.ts` took 11 kB off the static closure but not the loaded
  set, because the cards load the same employer-name code. The excess is the
  board's own card: the `jobsPage` string namespace (22,765 B), the
  employer-name tables (12,021 B) and `PostingMenu` (6,717 B), which the cards
  never render. A lighter home card or a JobCard split is the listing owner's
  change; until then this gate fails, and the owner decides whether to publish
  with it.
- *LCP at 375 throttled, 1.2 s or less.* The gate names no profile. Under
  Lighthouse's mobile profile the new "/" measures 2.22-2.34 s and the old one
  2.18-2.21 s on the same machine (the network carries the HTML and the
  stylesheet first); with the network unthrottled both are 0.21-0.26 s. The
  regression is closed; the 1.2 s line passes on the unthrottled reading and
  fails on Lighthouse's, for the old page and the new. Name the profile before
  the +1 day check.
- *Decided by the owner on 2026-10-27*: "/" ships with this JavaScript and
  the 340 kB target is retired (slimming the job card is a later change); the
  speed gate is never slower than the old "/" on both profiles, with the old
  build's measurement as the baseline in the repo. Step 15 now says so; the
  two verdicts above stay as the record.

**Still open after the review round**

1. ~~The first-load JS gate~~: decided by the owner on 2026-10-27 ("/" ships as measured; the card's slimming is a later listing change).
2. ~~send-product-email's "buy again" link~~: opens `/resume-checker` (2026-10-27.1).
3. ~~The free report's configured figures~~: swept on 2026-10-27, with a guard ([below](#the-owners-decisions-and-the-report-sweep-2026-10-27)).
4. W3, P18, the register pass and step 7's five mirrors, as listed above.
5. Thirteen undeclared overlaps among the other in-flight branches (trust/round3, trust/census-tools, trust/pages, oh/integration, wave4/integration); none involves hp/switch-over.

**Gate** (this round): the frontend typecheck on every commit (pre-commit,
through heavy.sh); every new and touched test; the full battery at the push
(pre-push); worker tsc and `scripts/check-functions.sh` through heavy.sh;
`deploy-ledger --draft` exit 0; `--against origin/wave4/integration` 6
functions, 0 violations; `--overlap` exit 0 over both required lists.

## The owner's decisions and the report sweep (2026-10-27)

**The owner's decisions, 2026-10-27.**

1. "/" ships with the first-load JavaScript it has: 349,482 B gzip once the
   cards render, a 287,049 B static closure (measured 2026-10-26). The 340 kB
   target is retired; slimming the shared job card is a later change.
2. The speed gate is "never slower than today": on the Lighthouse mobile
   profile and on the unthrottled 4x-CPU profile, the new "/" LCP is no worse
   than the old "/". It holds today (step 15 has the numbers and the rule).
   Real visitors' Core Web Vitals in Search Console are read before the
   publish and about 28 days after it, an owner step.

**What this round made true** (test first: each new or changed test failed
on the code before it; the failing runs are in
`~/.config/resumebooster/hp-switch-over-2026-10-26/owner-decisions-round/`).

| What | Now | Commit |
|---|---|---|
| Step 15's speed targets | Step 15, section 99 (its header and an INFO line), the PR and this README state the owner's decisions. `docs/homepage-pricing/speed-baseline.json` holds the old build's runs (the baseline) and the switch-over build's, with the method; `scripts/home-speed-gate.mjs` judges them and any re-measure; `src/test/hp-speed-the-new-home-is-never-slower-than-the-old.test.ts` holds the rule. The earlier measurements stay as the record (the review round, above) | b00d8fcf |
| The free report printed configured figures as measurements | None is printed (the list below); a guard reads the report's strings in nine locales, every module it imports, the scan's printed data and a rendered report | b767dadd |
| send-product-email's "try again" button for a failed Full Analysis payment opened "/" | It opens `/resume-checker` (2026-10-27.1) | da381a07 |
| The deploy step named six functions | It names eight: free-keyword-scan and free-keyword-scan-stream 2026-10-27.1 and send-product-email 2026-10-27.1 join the five others, and section 99's C6 asks for all eight | b00d8fcf |

**The configured figures that are gone** from the free report the
switch-over links to, in all nine languages:

- *The role card* (`CompetitorBenchmark`, under the personalized tips): the
  share of "top candidates" with a portfolio, a certification or a quantified
  bullet, an average bullet count, all hand-set per role in
  `src/config/personalization.ts`, and a "competitive standing" read from
  three props the report never passed, so every reader saw 0% and the same
  checklist. It now says what résumés for the role usually include, with no
  figure; the role's configured weights only decide which guideline shows.
- *"Keywords that appear in 70%+ of top-quartile resumes"*, for a list typed
  into free-keyword-scan (`COMPETITIVE_KEYWORDS`, seven fields by level, with
  technology's list standing in for every other field): the card is
  "Keywords Expected at Your Level", says the list is chosen by hand and
  names no field (for most fields it is technology's), and prints "N% of this
  list", the share the reader's own résumé uses.
- *"You vs. a Top-Quartile Candidate"*: eight quantified bullets, three
  leadership verbs and 70% keyword coverage, literals in free-keyword-scan.
  Not printed.
- *"Industry median"* beside the two-field comparison (a configured table).
  Not printed.
- *The market card's salary line*: twelve typed salary ranges, two with
  percentage gaps, no source. Not printed.
- *The ATS tooltip's "98% of Fortune 500 companies"* and two tooltips' "6
  seconds" and "6-7 seconds": reworded without the figures.
- *Dead copy that would have printed figures*: `freeResults.ctaCopy` ("Beat
  87% of Applicants", "3x more interview callbacks"), the unmounted
  `PeerBenchmark` (a percentile from configured averages) with its strings,
  and the share card's dormant "Better than N% of peers". Deleted.
- *The local-standards card's photo notes* for Germany (about 80% of
  applicants, about 19% of recruiters), Italy (60-70% of CVs) and Taiwan (a
  survey's "3×" interview chances). The 52-country review they came from is
  not in this repository, so the notes say what is usual without the numbers.
  The notes live in free-keyword-scan's `country-standards.ts` and its stream
  fork's copy (byte for byte), so both functions carry 2026-10-27.1. The
  CV-standards pages read the same module; the German page's hand
  translation (`src/data/cv-standards-content.ts`) says the same, and its
  render test reads the new sentence.

Kept, each named in the guard's allowlist with where its number comes from:
the reader's own shares (keyword coverage, quantified bullets, readability,
bullet impact, the posting match, the parse simulator's confidence, the
industry blend, the fit badge) and two example bullet rewrites shown only
when the résumé gave none to quote. The guard is
`src/test/the-free-report-prints-no-configured-figure-as-a-measurement.test.tsx`;
a new % or × figure fails it until the allowlist says which of the reader's
numbers it is.

**What "/" loads shrank a little.** The report's English strings
(`freeResults` and the rest of `en.json`) ride in the entry every page
loads, "/" included: `src/main.tsx` imports `src/i18n`, which imports
`en.json` eagerly (the other eight languages load with the reader's locale).
Each of the nine locale files lost the deleted strings (`gzip -9` of the
file read from stdin: English 103,633 to 102,725 B, so the entry "/" loads is
about 0.9 kB lighter; German 118,887 to 117,750, Hindi 137,031 to 135,847),
and nothing grew. The first-load figure in step 15 (349,482 B) was measured
on 2026-10-26, before this round, so it is slightly high now. The speed
record in step 15 was not re-measured for this round. (This paragraph first
said the report's strings ride with the scanner's chunk, not with "/"; the
review of 2026-10-27 found that wrong.)

**Not changed here:** the scanner page's hero still says "Over 98% of Fortune
500 companies use them" (`hero.atsTooltip`, `hero.atsExplainerRest`, outside
the report); the local-standards card still credits "our 52-country standards
review (July 2026)", which is not in the repository; the scan still sends
`competitorSilhouette`, `benchmarkMedian` and `salaryContext` (the data
contract), and the market data's `salaryContext` still reaches the scan's
prompt; nothing prints them. (The review of the sweep, below, took
`salaryContext` out of the prompt.)

**The ledger.** Six files and functions this round shares with wave 4 take
wave4 (ReportInsightCards.tsx, free-keyword-scan-stream and send-product-email
with their index.ts files, and the purchase-mail test); the switch-over
re-applies its hunks on wave 4's versions.

**Gate** (this round): the frontend typecheck (pre-commit on every src
commit and standalone, through heavy.sh); `scripts/check-functions.sh`
through heavy.sh (every edge function typechecks, the Deno tests pass;
`deno.lock` restored); the new guard (20 tests), the speed test (10),
section 99's test (19), and 281 targeted files over the report, its
components, the locales, the scan, the CV-standards pages, the purchase
mail, the hp suite and the 17 ledger tests, run after the last change
(4,476 tests pass, 6 skipped); `deploy-ledger --draft` exit 0; `--against origin/wave4/integration`
8 functions differ, 0 violations; `--overlap` exit 0 over both required
lists, and over every in-flight branch no undeclared file involves
hp/switch-over (13 among the others, as before); the full battery at the
push of f4ca2057 (pre-push, through heavy.sh): 1,320 test files and 20,488
tests pass (1 file and 32 tests skipped), plus the frontend typecheck and the
deno check.

## The review of the report sweep (2026-10-27)

A review of the round above found eleven things still wrong in what the free
report prints and in step 15: five major, six minor. All are fixed here, each
with a test that failed on the code before it (the failing run, 23 tests in
four files, is
`~/.config/resumebooster/hp-switch-over-2026-10-26/review-fix-round/before.txt`).

| Finding | What is now true | Commit |
|---|---|---|
| The keyword heat map said its bars were "how often this keyword appears in job postings", read from a hand-set table in free-keyword-scan that names no dataset and matched by substring ("digital payments" took "git"'s weight) | The card is gone. `getKeywordFrequencyWeight` matches whole words and only orders the gaps; the table's comment calls it a hand-set priority | e6ed61ab |
| Skills Freshness matched by substring (a nurse's "storage" and "NHS Foundation Trust" read as "rag" and "rust"), gave technology's lists to every field, and said "high demand 2025"; the market card called hand-typed lists "Hot skills right now" and "Rising keywords in job postings" | Whole-word matching; only the five fields with lists of their own (technology, data science, data engineering, marketing, finance) get the card; no N/100 (it started every résumé at 70 and moved by hand-set steps); the labels say "on our list"; both cards print their basis, hand-compiled and last updated mid-2025 (`MARKET_DATA_AS_OF`, which the scan now sends as `listsAsOf`) | e6ed61ab |
| The score header predicted what an ATS would do (three thresholds the module said had no data behind them, nine locales), the two-field line said recruiters in both fields would consider the reader, and the recruiter panel's first persona carried a pass badge | The header says what the score reads ("Scored on this resume's keywords, sections, format and measurable results", nine locales); `src/lib/score-outcome-message.ts`, its test and its strings are deleted; the two-field line and the badge are gone, and the panel says its three readers are written by AI. H0's test reads text nodes joined by spaces and renders scores of 57 and 64 (a nurse, a marketer, a technology reader) | e6ed61ab |
| The ATS banner placed technology readers among 2,472 of this site's scans ("Above the median of 62…", "Top quarter: 65+") under "Needs improvement to compete", without naming the 180-day window, and a benchmark badge said the report's comparisons were measured against those scans | The owner's call, taken the way H0 reads (the report ranks the reader against no one): under 75 the banner says "Room to raise this score" and the no-pass-mark line, for everyone; the median and top-quarter lines, the badge and the "at risk / to compete" headings are gone in nine locales (`src/lib/score-banner.ts` is deleted). The scan still sends `realBenchmark` (the data contract). If the owner wants the placement back, it returns with its window named in the line | e6ed61ab |
| Step 15's speed gate had lost its consequence when it moved out of the lab-checks bullet | "A re-measure that fails is a fix before anything else ships", and a slower new "/" on either gated profile at the re-measure is a rollback trigger; the speed test asserts both | 8605e2f1 |
| "6-Second" headings and a "6-second scan friendly" subtext, "flagged by many ATS systems", "recruiters like 2+ years per role", "ATS systems screening hundreds of applicants per role" | Reworded without the figures (the tenure line in nine locales; the filter phrase is deleted with the outcome tiers). The scan's prompt no longer asks for a recruiter's 6-second scan or a pass/fail verdict, and its fallback summary no longer says the résumé would survive or is at risk. The guard bans durations and "N+ years" claims in the report's strings in every language, and these phrases in its modules | e6ed61ab |
| The fix plan's minutes and points, fixed per kind of fix, were printed as a forecast ("this is the score a rescan should land near", "→ score ~77", "estimated 83") | Every place that adds them up names the basis: a rough guide (the AI's estimate per fix, or fixed points per kind of fix), not a forecast of the next scan (`src/lib/report-basis.ts`) | e6ed61ab |
| The canvas share card sent readers to the bare domain, which is the job search since the switch-over | It draws and shares `resumebooster.work/resume-checker` (`SHARE_SITE`); the share-card test covers it | e6ed61ab |
| Rounding each median to a tenth made the speed verdict depend on the rounding edges | The owner's reading stays the verdict; the judge prints the unrounded difference, each median's distance from the nearer edge, the shift that flips the verdict and the runs' spread, and a re-measure takes five runs a case (step 15, "The margin") | 8605e2f1 |
| This README said the report's strings ride with the scanner's chunk, not with "/" | They ride in the entry "/" loads, which the sweep made about 0.9 kB gzip lighter; the first-load figure is dated 2026-10-26 | 8605e2f1 |
| A latent salary path: the prompt still asked for "realistic salary ranges" beside the typed ranges, and the card printed any range the AI added | The salary card and the prompt's career-insights lines are gone, and the typed salary ranges no longer reach the prompt; the guard's rendered report carries a salary range and fails if it prints | e6ed61ab |

The expected-keywords share ("N% of this list") counts whole words too: "api"
no longer matches "rapid", nor "rest" "interest". The market module changed
in free-keyword-scan and in the stream fork's copy (byte for byte, and the
guard now checks that). This paragraph first said both stayed at 2026-10-27.1
because neither is deployed; a build string names one bundle, so both now
carry 2026-10-31.1 (below), and the deploy step still names eight functions.

**What "/" loads.** `en.json`, which the entry carries, shrank again:
102,725 to 102,336 B (`gzip -9` from stdin; the other eight locale files
shrank by 389-520 B each). The new `src/lib/report-basis.ts` is imported only
by the report's components, which load with the scanner.

**Not changed here:** `RecruiterViewMode.tsx` still says "6-Second Recruiter
Scan", but nothing imports it; the locked career-strategy preview still lists
salary guidance, but it renders only when `diagnosticLayout` is false, and it
is always true; send-market-pulse's own market module
(`supabase/functions/_shared/market-intelligence.ts`) keeps substring matching
and its salary line (another function, another deploy); the prompt's
readability rubric still says "6 seconds" as an anchor for the AI, which the
report does not print.

**Gate** (this round): the frontend typecheck (standalone and pre-commit on both commits,
through heavy.sh); `scripts/check-functions.sh` through heavy.sh (every edge
function typechecks, the Deno tests pass; `deno.lock` restored); 23 tests in
the four changed test files failed first, and those files and the rewritten
score-banner test pass after (102 tests); 252 targeted files over
the report, its components, the locales, the scan, the market module, the
speed gate, section 99, the ledger and every test that reads this README:
3,885 tests pass and 6 skipped, with the one failure (the speed test reading
a wrapped sentence) fixed after and its file re-run (13 of 13);
`deploy-ledger --draft` exit 0; `--against origin/wave4/integration` 8
functions differ, 0 violations; `--overlap` exit 0 over both required lists,
and over every in-flight branch no undeclared file involves hp/switch-over
(the same 13 among the others). The pre-push battery's result is in PR #54.

## The restamp and a second look (2026-10-31)

The review fixes above (e6ed61ab, 8605e2f1, 340c80ff) were not pushed on
2026-10-27: the pre-push battery failed in twelve files (eleven tests and one
hook), nine on timeouts on a loaded machine and three in verify-section tests
(sections 99, 96 and 92) that pass when their files run alone, as they do in
this round's targeted runs. Before pushing them, this round:

- **Re-stamps both scan functions 2026-10-31.1.** 2026-10-27.1 had already
  named the sweep's bundle on `origin/hp/switch-over`, and the review changed
  both bundles again (the market module, the prompt, `listsAsOf`), so the
  same string would have named two bundles. free-keyword-scan and
  free-keyword-scan-stream are 2026-10-31.1; section 99's C6 asks for that
  build or a later one, and fails on 2026-10-27.1. The stream fork reads only
  the module's country detection, which did not change, so what it answers is
  the same. send-product-email stays 2026-10-27.1 (unchanged).
- **Names the basis of the minutes too.** The fix plan's minutes are set the
  way its points are (the AI's time estimate per quick win, or 15 and 10
  minutes per kind of fix), so the plan says "Minutes and points are a rough
  guide … not a forecast of your next scan" (`FIX_PLAN_BASIS`). The PDF
  summary printed "→ 83 after fixes" and each step's minutes and points with
  no basis; it now says "about 83 after fixes, a rough guide" and prints the
  same basis under the plan.
- **Removes two predictions the review did not list.** The AI-ATS score
  card's subtext read "Keyword gaps may hide you from searches" (60-79) and
  "Likely invisible in recruiter searches" (under 60), chosen by two score
  thresholds: it now says what the score reads ("Gaps to close: see the fixes
  below"). The career-change card opened with how career changers get
  filtered, a claim with no source: it now says what transfers and what to
  reword. The guard bans all three phrases in the report's modules and the
  first two in the rendered report.

Each change failed a test first
(`~/.config/resumebooster/hp-switch-over-2026-10-26/restamp-round-2026-10-31/`,
`before.txt` and `before-2.txt`: six tests in three files).

**Gate** (this round): the frontend typecheck (standalone and pre-commit on
both src commits, through heavy.sh); `scripts/check-functions.sh` through
heavy.sh (every edge function typechecks, the Deno tests pass; `deno.lock`
restored); 271 targeted files over the report, its components, the locales,
the scan, the market module, the speed gate, section 99, the ledger, every hp
test and the section 96 and 92 tests, through heavy.sh: 4,196 tests pass, 6
skipped; `deploy-ledger --draft` exit 0 (free-keyword-scan and
free-keyword-scan-stream 2026-10-31.1, send-product-email 2026-10-27.1);
`--against origin/wave4/integration` 8 functions differ, 0 violations;
`--against origin/hp/switch-over` 2 functions differ, 0 violations (at
340c80ff it found both scan functions reusing 2026-10-27.1 on different
code); `--overlap` exit 0 over both required lists and over HEAD with
`origin/land/all`. The pre-push battery's result is in PR #54.

## What was built

**Homepage** (`src/pages/home/HomePage.tsx`, default export, ready for `lazy()`):
the owner's headline "Live jobs, straight from employers' own hiring
systems", a real `GET /jobs` search form (`q`, `location`; "Remote" becomes
`mode=remote`), try chips, and the one open-postings figure (`openTotal` from
`get_board_vendor_counts` with "counted {date}, {time} UTC"). Then up to five
live postings in the board's own `JobCard` (no Save, no Check fit, no menu;
employer-dated within 7 days; never Paylocity, Breezy or UKG; the feed-read
stamp only where `feedReadStatable` passes, and never on a board name two
hiring systems share), the board rail (job boards we read with a live
posting, p50/p95 from `get_freshness_stats` with its day and time; no
24-hour flow figure), field links from the category list, the free-account
strip, the scan section with one sample report, "use it from your AI"
(Claude, ChatGPT, Claude Code), the sources table, the plan strip (no buy
control) and the FAQ. "Search jobs" is the only filled button. At most four
data calls; nothing reads `get_board_flow`.

**Pricing page** (`src/pages/pricing/PricingPage.tsx`): H1 and a summary that
leads with what is free; "Before you buy" above the cards (all sales final;
not sold in the EU, the EEA, the UK or India, naming the currency and
time-zone checks; Pro billed in US dollars and renewing monthly, the Full
Analysis priced in US dollars and charged at about that value in the
currency of the device's time zone when the hook recognizes the zone and
checkout supports its currency, in US dollars otherwise), the Free, Full
Analysis ($5, the only
one-off) and Pro ($45) cards, "What the $5 adds", the Builder API (planned,
$49, "Proposed: 5,000 calls a day; set before launch") and data licence
cards, the limits table and a seven-question FAQ. "Create a free account" is
the only filled button. Buy buttons render only when `src/config/seller.ts`
carries the seller's legal name and postal address; until then each paid card
says "Not on sale yet. Purchases open soon, once the seller's name and
address are published on this page." Pro carries one unchecked, required
renewal box in wave 4's words (AB 2863; a stand-in until wave 4's
PurchaseTerms box arrives, switch-over step 8). Pro is the writing tools (5
of each a day, 60 a month) plus the included Full Analysis (shown only once
G2 passes) and "No daily cap on scans"; Freelance Boost, Transition Pro and
every other cut product appear nowhere in the pages' own content. The title
and description name only the prices on sale.

**Shared**: both pages read the count through the same hook
(`useBoardVendorCounts`), so one `as_of` serves both, and both read one sale
switch and one alerts answer (G6). FAQ answers, the sources table, the sample
report, "Before you buy" and the comparison sit in native `<details>`
elements, so their text stays in the DOM (for Google's phone render and a
reader's Find) while closed; the Disclosure primitive is not used or edited.
Both pages wait for the reader's strings before their first render (header
at once, page and footer together), and keep page, footer and focus mounted
through a later language change.

## What the integration changed

The two builders worked on separate branches with separate gate modules,
facts mirrors and strings. Reading the two pages side by side found five
places where they disagreed; each is fixed and held by
`src/test/hp-integration-one-voice.test.ts`:

1. **One switch for both pages.** The pricing stand-ins for G2 and G2b read
   the homepage's `SALE_SWITCHES`; the test walks seller by both switches.
2. **The homepage's seller-gate sentence** says purchases open soon, once the
   seller's name and address are published on the pricing page.
3. **One name for the $5 report** in every language ("Vollanalyse",
   "Buong Pagsusuri").
4. **One final-sale sentence and one delivery sentence per language.**
5. **Wording one page's guard bans**: no French stem of "verified"; the
   Spanish FAQ uses "¿Se postulan…?", never a vosotros form.

## What the fix round changed (2026-10-18)

Three review lenses (honesty; design, accessibility and i18n; data and plan)
read `hp/integration` 70e4e525. Every confirmed finding is fixed here, each
with a test that was run red first. The branch also took the moved PR base
twice (`design/integration` d823aae4, then 74439737).

| Finding | Fix | Held by |
|---|---|---|
| Blocker: both pages said "We never submit an application" (board note, never-list, homepage FAQ) and the pricing FAQ answered "No, on any plan", while `agent_sender_public_status` answered true | the board note ends at "You apply on the employer's own site"; the never-list keeps its other two items; both FAQs ask "How do I apply?" and answer without "No"; all nine languages | `hp-fix-never-submit` (strings in nine languages, and the four sections rendered) |
| Blocker: the shared Footer's "Freelance Boost" (and the Header's filled Start) render on both pages | a gate that goes live the moment App.tsx imports either page: then the whole rendered page names no cut product, the header has no filled button and main has one; before that it holds the pages' own content | `hp-fix-switch-over-gate`; `HP_ASSUME_ROUTED=1` runs it early (fails today on the Footer) |
| Pricing printed "alerts" in four places whatever G6 said | `resolveSaleGates` carries the homepage's `alertsStatable`; no-alerts forms of `head.sub`, `free.saved`, `limits.rowSaved`, `faq.regionA` in nine languages | `hp-integration-one-voice` (seller by digest), `hp-fix-alerts-one-answer` (both pages rendered per case) |
| Two renewal boxes after wave 4 merges; hp's box recorded a version the server never reads | hp's box is a stand-in: wave 4's exact sentence (translated), `data-auto-renew-box`, no version or record of its own; step 8 deletes it when wave 4's PurchaseTerms box lands | `hp-fix-renewal-box` (exactly one box; red with a second box, checked) |
| 44 px under a finger never applied to links (`a[href]` beats a single-class `min-h-*`) | important floors on link-buttons and chips (`!min-h-10 coarse:!min-h-11`, chips `!min-h-8 coarse:!min-h-11`, `LINK_TARGET_44`) | `hp-fix-coarse-targets`; measured below under a real coarse pointer |
| Homepage first rendered in English, then swapped (CLS 0.18 in de/es/fr) | the first render waits for the reader's strings; the footer waits with it | `hp-fix-language-swap`; CLS measured below |
| Pricing unmounted its content and footer on a language change (focus to body) | only the first render waits (`useStickyReady`); the pricing loader stops waiting for the main locale after 6 s | `hp-fix-language-swap` (focus stays in the footer) |
| Fill-curve call and stamp on board names two systems share | `curveTokens` drops `isCollidedToken`; such rows get no stamp | `hp-home-rows` |
| README: G3, G4, the agent's retirement, hp/honesty and hp/scanner missing from WHEN; steps 4, 6, 8, 10, 11, 12 and C1/C4/C6 stale against wave 4 and the bake | rewritten below against the branches as of 2026-10-18 | this document |

Cheap minors also fixed (all in `hp-fix-minors`): the scan lede says
"within 90 seconds" in nine languages; the rail names its day and says "job
boards we read, with a live posting"; the homepage FAQ names all three exits;
no "Min.." in German or Tagalog; the AI illustration prints
`displayLocation("US - Cambridge Kendall SQ - MA")`; translated chip labels
wrap (`WRAP_CHIP`); the pricing title and description follow the gates
(`pricingMetaKeys`) and name the EEA; the Builder price is `money()`'s and
en-GB says "licence"; the list call has an 8 s deadline and a curve that
misses its 2.5 s wait is aborted; the G2 rule also hides wave 4's
`proPlan.perks.fullAnalysisIncluded`; both H1s break a word only when it
cannot fit a line (`[overflow-wrap:anywhere]`): the German headline's
"Bewerbungssystemen" widened the page by 7 px under WCAG 1.4.12 text
spacing. A first attempt with automatic hyphenation (`hyphens-auto`) split
the owner's English headline on a 375 px phone ("em-" ending line one) and
left the reserved third line empty; the H1s no longer hyphenate (held by
`hp-fix-minors`, and measured below: English is three lines at 320 and
375 px, as in the mockup).

Not changed here, with the reason: the phone list packs four rows where the
spec says three (the builder's measured box; recorded in Appendix A item 2);
the field chips print the long category names (no short label key exists;
the switch-over string move may add one); German "du" on the homepage and
"Sie" on pricing, and Hindi's two spellings of one CTA (hp/i18n's single
pass); the translated try chips run English queries (Appendix A item 8).

## What changed on 2026-10-25

- **Each product is said in its own currency (owner decision 2026-10-25).**
  Both pages said every price was in US dollars (`before.renewalTitle`,
  `before.renewalBody`, `home.plans.termUsd`), and only Pro is:
  `create-subscription-checkout` bills it with `price_data.currency: "usd"`.
  The Full Analysis is charged in the currency the scanner page picks from
  the device's time zone (`src/hooks/use-currency.ts`, sent as
  `currency: currency.code` by `Index.tsx`'s checkout; a zone the hook does
  not list reads as the US, so its language fallback never runs);
  `create-checkout` prices it from `CURRENCY_RATES` (30 currencies) and in
  US dollars when the table lacks the one asked for (`calculateAmount`'s
  fallback: 72 of the hook's currencies, CNY, TRY or KES among them). With wave 4,
  a currency of the EU, the EEA, the UK or India (EUR, GBP, SEK, DKK, NOK,
  PLN, CZK, HUF, RON and INR in that table) is refused by
  `_shared/sales-territory.ts`, which leaves USD, CAD, AUD, NZD, JPY, KRW,
  HKD, SGD, TWD, THB, MYR, IDR, PHP, ILS, AED, ZAR, CHF, MXN, BRL and UYU.
  Checkout is unchanged. In all nine languages the copy now says (the
  review round's wording, below):
  - pricing, "Before you buy": the title "Pro: US dollars, renews monthly."
    and the body "Pro is billed in US dollars and renews every month at
    {{proPrice}} until you cancel, … The Full Analysis is one payment that
    never renews, priced in US dollars and charged at about the same value
    in the currency of your device's time zone when we recognize the zone
    and support its currency, or in US dollars otherwise.";
  - the homepage plan strip: `home.plans.termUsd` is gone. `termCurrency`
    ("Pro is billed in US dollars. The Full Analysis is priced in US dollars
    and charged at about the same value in the currency of your device's
    time zone when we recognize the zone and support its currency, or in US
    dollars otherwise.") shows while the Pro row does, and `termCurrencyFa`
    (its second sentence alone) while it does not, so the strip never names
    Pro's currency without Pro;
  - the pricing page's Full Analysis buy block: `pricingPlans.fa.currency`
    (the same sentence) under "One payment, never renews.", beside "Buy the
    Full Analysis, $5", while the Full Analysis is on sale;
  - the structured data: the Full Analysis offer keeps `price: "5"` and
    `priceCurrency: "USD"` (the list price every local amount is computed
    from) and gains `description`, the English `pricingPlans.fa.currency`.
    Pro's offer is unchanged;
  - the dollar-sign icon beside both currency lines is a banknote.
- **The review round (2026-10-25) made the Full Analysis sentence true for
  every buyer.** Its first wording, "charged in your local currency where we
  support it, and in US dollars elsewhere", was false twice:
  - the hook reads a fixed list of time zones, and a zone not on it reads
    as the US (`tzToCountry[timezone] || "US"`, and "US" is in
    `CURRENCY_MAP`, so the language fallback never runs). Only Toronto and
    Vancouver map to CAD, only Sydney and Melbourne to AUD: a buyer in
    Calgary, Winnipeg, Halifax, Brisbane, Perth, Adelaide, Monterrey or
    Fortaleza, whose currency `create-checkout` supports, is charged US
    dollars. The sentence now names the mechanism: the currency of the
    device's time zone when we recognize the zone and support its currency
    (German "wenn wir die Zeitzone kennen", French "quand nous reconnaissons
    ce fuseau", and so on). The test pins the hook's answers for Toronto
    (CAD), Sydney (AUD), Edmonton, Brisbane and Monterrey (USD). Mapping
    every zone of each supported country instead is a separate decision: it
    would also change which buyers the territory check refuses;
  - with "Prices in US dollars" gone, nothing said the printed "$5" was US
    dollars, and en, hi and tl print `money(5, "USD")` as "$5" (de "5 $"),
    which a buyer whose currency is also written with "$" (CAD, AUD, NZD,
    SGD, HKD, MXN) reads as their own five dollars while `calculateAmount`
    charges five times the rate (CAD 7.00, AUD 7.90, NZD 8.75, SGD 6.75, HKD
    39.00, MXN 101.00). Every Full Analysis currency sentence now says it is
    priced in US dollars and charged at about the same value, and the
    pricing page's buy block says so beside the price.
  `hp-fix-currency-per-product` holds both (71 of its 89 tests failed on the
  first wording): in every language no string carries the old phrase, every
  sentence that says how the Full Analysis is charged says it is priced in
  US dollars, the strip with the Full Analysis on sale shows "$5" with "The
  Full Analysis is priced in US dollars", the buy block carries the
  sentence exactly while the Full Analysis is on sale, and the JSON-LD
  description names both.

  Held by `hp-fix-currency-per-product`, run red first (62 of its 66 tests
  failed on the old strings): in every language and over every string
  either page carries, a sentence that names dollars names exactly one
  product, a sentence that puts the Full Analysis in dollars also names the
  local currency, a sentence that names the local currency names the Full
  Analysis and not Pro, and each page says both; rendered in English in all
  eight sale states, the same holds for the text on screen and the strip
  picks its line by the Pro row; the JSON-LD description; no hp source file
  types a dollar word; and the checkout facts the sentences rest on (Pro's
  only `price_data` currency is usd, `CURRENCY_RATES` has more than one
  currency and falls back to usd, the page that sells the Full Analysis
  sends `currency.code` from `useCurrency`), so a checkout that moves fails
  there before the copy goes false. No other hp test pinned the old
  sentences; the 19 hp files pass.
  Not re-measured, and so not claimed: the renewal title changed length in
  every language (old to new, in characters: en 31 to 32, en-GB 31 to 32,
  de 41 to 42, es 49 to 50, fr 50 to 48, nl 51 to 52, pt 42 to 41, hi 44 to
  49, tl 43 to 40), within two characters except Hindi (+5) and Tagalog
  (-3), so the 375 px first screen in those two languages may move by a
  line; at 1280, where the renewal body shows in full, the body is a clause
  longer, so the cards may start below 436 px; the strip's currency line,
  below the fold, is two or three lines longer; the Full Analysis buy block
  gains one line of fine print while it is on sale. The next `measure.cjs`
  run (hi at 375 px among its cases) measures all four. The live `/pricing`
  bake (`AggregateOffer` in USD, the old page's) states no currency sentence
  and is replaced in step 10.

## What changed on 2026-10-24

- **W5 is decided: the IP clause is gone.** The owner dropped it rather
  than wait on `IPINFO_API_KEY` and the Radar rule (switch-over plan, W5).
  Both pages now describe only the two checks checkout always runs, the
  currency and the time zone: `home.plans.termTerritory`,
  `pricingPlans.before.regionBody`, `faq.regionA` and `faq.regionANoAlerts`,
  in all nine languages (English: "…from the currency and the time zone your
  device reports."). `hp-fix-no-ip-lookup`, run red first in every language,
  holds three things: no string either page carries names an IP address, the
  lookup service or (in English) a lookup; the four sentences still name the
  currency and the time zone in each language; and no hp source file writes
  such a literal, comments stripped. The five tests that pinned the old
  clause (`hp-home-strings`, `hp-pricing-strings`, `hp-home-page`,
  `hp-integration-one-voice`, `hp-pricing-decisions`) now refuse it.
- **Both headlines break only a word too long for a line**
  (`[overflow-wrap:anywhere]`, above), and every measurement below was re-run
  on the head after both changes.
- **The plan is re-read against the branches of 2026-10-24**: it starts from
  main; wave 4 is pinned at `origin/wave4/integration` 9af3c783, whose new
  `w4b-fix2-the-homepage-stores-nothing-for-analytics-before-a-choice` test
  joins step 4; the apply agent still answered true at 2026-10-25 01:02 UTC
  (W3).

## How to preview

```
npx vite --port 5197            # in this worktree; Ctrl-C when done
open http://localhost:5197/preview-home.html
open http://localhost:5197/preview-pricing.html
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

## What was measured (fix round, re-run 2026-10-24)

The fix round measured on 2026-10-18; the scratchpad's `keep/` tree was
emptied on 2026-10-23 and took the tools, data and shots with it, so every
check below was re-run on 2026-10-24 (01:04 UTC on the 25th) on this
branch's head, after the headline change and W5's shorter territory
sentences. One Vite dev server, one headless Chromium (Playwright from
`worker/node_modules`; axe 4.12.1 from
`~/Documents/GitHub/vibemarket/node_modules/axe-core/axe.min.js`), closed
when done. Fixture data (home default; pricing `?fixture=1&bare=1`). The
tools live outside the scratchpad now:
`~/.config/resumebooster/home-pricing-2026-10-18/tools/measure.cjs`
(shots, axe, filled buttons, first screen, coarse targets, CLS) and
`probe-spacing.cjs` (headline lines and overflow in nine languages, with and
without text spacing), with `data/checks.json`, `data/probe-spacing.json` and
`shots/` beside them; a copy of all three is in
`keep/home-pricing-design/build/final/`.

| Check | Homepage | Pricing |
|---|---|---|
| 375x812 first screen | search box 282-326 px; first posting card from 710 px, its title 727-751 px | H1 80-116 px, summary, jump links and "Before you buy"; Free card from 664 px (684 before W5 shortened the region sentence by a line) |
| 1280x800 first screen | search box 244-288 px; first posting card from 505 px, its title 522-546 px | H1 112-152 px, summary, "Before you buy"; cards from 436 px (456 before W5) |
| Filled buttons in main | one: "Search jobs" (375 and 1280) | one: "Create a free account" (gated and preview-open, 375 and 1280) |
| axe 4.12.1, WCAG 2.0/2.1/2.2 A and AA | 0 violations at 375 and 1280 | 0 violations at 375 and 1280, gated and preview-open |
| axe "needs review" | `aria-valid-attr-value` on today's Header (Radix `aria-controls`) | the same Header item; `th-has-data-cells` on the limits table's group rows |
| Targets under a coarse pointer (touch emulation, `pointer: coarse` true), 375 px | 26 buttons, link-buttons, chips and summaries: none under 44 px. Text links keep the 24 px AA floor: the posting title and employer links inside the board's own JobCard (design's file), "Set up Claude Code", the methodology link and "See pricing and limits" | 14 gated, 17 open: none under 44 px (the renewal label included) |
| CLS, cold load in the browser's locale, scroll at 400 ms, before the data answers (2026-10-24; the 2026-10-18 ranges over three runs per case in brackets) | en 0.0004 (list answering after 2.5 s: 0.0004) [0.0004-0.0005]; de 0.0002; es 0.0006 [0.0006-0.0008]; fr 0.0008 [0.0008-0.0015]; de at 1280 0.0002 [0.0001-0.0012] (was 0.18 in de, es and fr before the fix) | en 0; de 0; es 0 [0-0.007]; fr 0 (0.0008 in the run before W5) [0.00003-0.0008]; de at 1280 0.0137 [0.001-0.015] (the plan cards settling when the count lands) |
| Horizontal overflow, every `<details>` open | none: nine languages at 320 and 375 | the same (36 runs across both pages, plus 8 shot runs at 320 in de/fr/es/pt) |
| WCAG 1.4.12 text spacing, de, fr, es, pt, 320 px | no overflow (was 7 px in German: the H1's "Bewerbungssystemen") | no overflow |
| H1 lines (no hyphenation) | en and en-GB 3 at 320 and 375, filling the reserved `3lh`; de, es, fr, pt, nl 4 at 320 (nl and pt also at 375); 1 at 1280 | one line everywhere |

Screenshots (2026-10-24, W5's wording in every one):
`shots/home.{375,1280}.{first-screen,full}.png`,
`shots/pricing-gated.{375,1280}.{first-screen,full}.png`,
`shots/pricing-open.*` (the same four), and
`shots/i18n.{home,pricing-gated}.{de,fr,es,pt}.320.full.png` (every
`<details>` open). The whole-page text of every run still carries "Freelance
Boost": today's Footer, the switch-over gate's job (W4, step 9); the pages'
own `<main>` names no cut product in any run.

Measured by the builders and not re-run here: the home chunk was 15.7 kB
gzip. The fix round adds `src/lib/board-collisions.ts` (139 rows, about 2 kB
gzip) and the small gate modules to the home chunk, and the switch-over adds
the pricing strings to the eager English bundle (3.7 kB gzip), so the
predicted first load of "/" is about 331 kB against the 340 kB cap (measured
at the switch-over: 349,482 B; the owner retired the cap on 2026-10-27, step
15). No production build of the real routes and no LCP figure yet: lab gates
at +1 day (step 15).

## Gate (fix round)

- Frontend typecheck (`tsc -p tsconfig.app.json --noEmit`): passed at every
  commit (the pre-commit hook, run under `~/.config/resumebooster/heavy.sh`
  since 2026-10-24).
- The hp tests, targeted (`npx vitest run --maxWorkers=1 src/test/hp-`):
  19 files (`hp-fix-currency-per-product` the newest), 396 tests, all
  passing on the head.
- The full suite: the pre-push hook's run under the heavy-command lock, no
  other suite running: on b8863552, 1,049 files passed and 1 skipped
  (13,501 tests passed, 23 skipped) in 372.6 s; the frontend typecheck
  passed in the same hook.

## Open problems

As they stood before the switch-over. Items 1, 2, 3, 6, 8 and 10 are
closed by it, item 9 stands by decision (step 13), and item 7 is W3; what is still open is listed in [the
switch-over record](#the-switch-over-record-2026-10-26).

1. **Strings are not in `src/i18n/shards/` yet** (switch-over step 2): an
   unregistered shard directory fails the shard guard, and `SHARD_ROOT_KEYS`
   is in an existing file.
2. **Pro's list: wave 4's is trimmed but worded differently.**
   `origin/w4b/checkout-catalogue` (2c4aec7b) already ships the owner's
   definition in `supabase/functions/_shared/pro-perks.ts` (re-exported by
   `src/config/pro-perks.ts`, and the Stripe description is built from it):
   no Freelance, no Transition, no "unlimited",
   `PRO_INCLUDED_PRODUCT_IDS = ["fullAnalysis"]`. Its keys are
   `proPlan.perks.*` (translated in `wave4/integration`'s locales), its text
   is literal ("up to 5 sets a day and 60 a month", "The $5 Full Analysis
   included", "Cancel anytime from your account"), and it says "sets" where
   the owner's decision and this page say "packages". Step 6 adopts wave 4's
   list; the noun is the one thing to agree first.
3. **Renewal consent: wave 4 ships the server side** (G7).
   `create-subscription-checkout` refuses a body without
   `autoRenewConsent: true` (400 `auto_renew_consent_required`), which
   `purchaseTerms()` sends only when PurchaseTerms' own box was ticked, and
   records `AUTO_RENEW_CONSENT_VERSION` "2026-10-17" with the time. On this
   base PurchaseTerms has no box, so the Pro block's box is a stand-in in
   wave 4's words that sends nothing; step 8 deletes it. Wave 4's box
   renders its English default in every language (`purchaseTerms.autoRenewConsent`
   has no locale entries on either wave-4 branch): wave 4 to translate it,
   for example from this page's `pricingPlans.pro.consent`.
4. **The Full Analysis text is not written from a watched delivery (P18).**
   Both cards are gated; the bullets and `home.plans.faBody` must be
   rewritten from the G2 purchase before G2 opens.
5. **German register and other per-language wording**: "du" on the
   homepage, "Sie" on pricing; Hindi spells one CTA two ways; no native
   review yet. hp/i18n's single pass.
6. **Chrome owned by others.** Today's Header (Start, credits) and Footer
   (Freelance Boost) render on both pages; the switch-over gate refuses to
   route either page until hp/honesty's changes land (step 9).
7. **The apply agent is live.** The pages no longer promise never to submit;
   wave 4 restores the sentence, with its own test, once its retirement is
   live (WHEN, W3).
8. **No production build, no LCP** until the switch-over build (step 15; the speed gate became "never slower than the old '/'" on 2026-10-27).
9. **No scroll-depth or time-on-page events on the new "/"**: adding them
   took the visitor-budget journey to 69 events against 60 (step 13).
10. **Links that mean the scanner**: 16 `/#upload` links, `ResumeBuilder.tsx`'s
    `/?rescan=1#upload`, and Header's Start on "/" (step 11).
11. **The fixture's first row shows a raw Workday tenant name**
    ("Shhotelsandresorts"); the homepage prints the board's names as they
    are.
12. **The phone list packs four rows** where the spec says three, and the
    field chips print long category names (above, "Not changed here").

## The switch-over plan

**Start from main.** `design/integration` reached main through PR #36 and
was deployed on 2026-10-18, so the switch-over branch is cut from
`origin/main` and takes `hp/integration` by merge; `hp/integration` itself
does not merge main first. Line numbers are as of `origin/design/integration`
74439737 (the same lines on main, except the bake's `/pricing` block, 11
lines lower), wave 4 as of `origin/wave4/integration` 9af3c783 (2026-10-24
19:18 -0400; of the files this plan cites, only free-keyword-scan changed
since 518afef1, step 12, and 9af3c783 adds one test that mounts `Index` at
"/", step 4) and
`origin/w4b/checkout-catalogue` db74b6c8; wave 4 edits App.tsx, Pricing.tsx
and the Header, so find each line by its text. Run `node scripts/deploy-ledger.mjs --overlap` before merging.
The ledger has no `home-pricing` reservation yet (`docs/deploy-ledger.json`
on main lists wave2, wave3, critical-path, company-profiles, wave4,
company-profiles-phase3 and next), so the switch-over's first commit adds
one, before `"next"` in `reservations`:
```json
"home-pricing": {
  "branches": ["hp/"],
  "migrations": "none",
  "jobBoard": "none",
  "fnBuildDate": "<switch-over day> (free-keyword-scan only, H0)",
  "verifySections": ["99-home-pricing.sh"],
  "status": "the board-first homepage and the new pricing page: new files plus the switch-over edits in docs/homepage-pricing/README.md; verify section 99",
  "deployOrder": 5
}
```
(deployOrder 5 follows phase 3's 4 by number only: phase 3 is not a
precondition, and the owner may deploy this first.)

### WHEN: every one of these, in ledger order (owner decision 8)

- **W1. The profiles/design train is merged and verified.**
  `design/integration` (PR #36, deployed 2026-10-18), `pd/wire` (73aecb4a),
  `pd/bake` (0fd722b2) and `pd/accuracy` (da3aa29b) are all on main as of
  2026-10-24. Still owed: their `verifiedDeploys` entry in
  `docs/deploy-ledger.json` (main's last entry is R1's, 9c991052).
- **W2. Wave 4 is merged and verified**: `wave4/integration` and every
  `w4b/*` branch (account-compliance, agents-api, base, checkout-catalogue,
  generators, job-board, ops-email-tests, payments-delivery).
- **W3. The apply agent is retired.** `agent_sender_public_status` answers
  false (it answered true on 2026-10-18 and again at 2026-10-25 01:02 UTC),
  or wave 4's retirement sentence is served on /trust. Verify claim C10.
- **W4. hp/honesty and hp/scanner exist on origin and are merged.** Neither
  does today (`git ls-remote --heads origin 'hp/*'` lists hp/home,
  hp/pricing, hp/integration). hp/honesty owns the Footer edit (step 9), the
  quiet Header, `src/config/sales-gate.ts`, PurchaseTerms' final-sale and
  region lines and H0; hp/scanner owns Index (delete-only) and the
  ResumeUploader gate.
- **W5. G3: DECIDED 2026-10-24, the IP clause is dropped; no longer a
  precondition.** Without `IPINFO_API_KEY`, `_shared/sales-territory.ts`
  `ipinfoLookup()` returns null and "a lookup that cannot answer refuses
  nobody", so a sentence naming the IP lookup could be false on the day it
  ships. The owner chose the second branch of G3: both pages describe only
  the currency and time-zone checks. Done on this branch:
  `home.plans.termTerritory`, `pricingPlans.before.regionBody`,
  `faq.regionA` and `faq.regionANoAlerts` no longer name the lookup in any
  of the nine languages, held by `hp-fix-no-ip-lookup` (no string either
  page carries names an IP address or the lookup service). Nothing waits on
  the key or the Stripe Radar rule for the publish. If the owner later
  confirms both, bringing the clause back is its own change, made together
  with that test.
- **W6. G4: R1 is a verified deploy.** Its `verifiedDeploys` entry is on main
  (ea8acb5e, PR #37: 950 PASS; section 94 passes except the owner's SPF
  record and the Resend webhook secret). Re-read sections 94-96 before the
  publish.
- **W7. The gate passes early**: on the merged tree, before App.tsx is
  edited, `HP_ASSUME_ROUTED=1 npx vitest run src/test/hp-fix-switch-over-gate.test.tsx`
  is green (no cut product anywhere on either page, no filled button in the
  header). After step 1 the same test runs live in every suite.

G1, G2, G2b and G6 are not preconditions: the pages show their closed states
until each opens. G7's server side is wave 4's and ships with W2.

### 1. Routes (src/App.tsx)

- Line 4: `import { BrowserRouter, Routes, Route } from "react-router-dom";`
  becomes `import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";`
- After `const Index = lazy(() => import("./pages/Index"));` add:
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
- `<Route path="/" element={<Index />} />` becomes
  `<Route path="/" element={<HomeRoute />} />`. The `/resume-checker`
  route (`<Index landing={TOOL_LANDINGS["resume-checker"]} />`) and the
  other tool landings stay.
- `const Pricing = lazy(() => import("./pages/Pricing"));` becomes
  `const Pricing = lazy(() => import("./pages/pricing/PricingPage"));`.
- From this commit `hp-fix-switch-over-gate` is live (it reads App.tsx).
- Add `src/test/hp-routes.test.tsx`: "/" renders the homepage's H1;
  "/#upload" and "/?x=1#upload" land on `/resume-checker` with search and
  hash kept, without importing `pages/home/HomePage`; "/pricing" renders
  `pricing-h1`; "/resume-checker" still renders the scanner; the Header's
  Start on "/" lands on `/resume-checker#upload` (step 11).

### 2. Strings become shards, and the first-render gate reads the main locale

- `git mv src/lib/home/strings src/i18n/shards/home` and
  `git mv src/components/pricing/strings src/i18n/shards/pricing`.
- `src/i18n/merge-shards.ts`, `SHARD_ROOT_KEYS`: add `home: "home",` and
  `pricing: "pricingPlans",`.
- Registering the shards does not remove the English first frame by itself:
  before a German main locale lands, `t()` falls back to English. So the
  first-render gate moves to the main locale (which now carries the shards).
  Create `src/lib/home/use-locale-ready.ts`:
  ```ts
  import { useEffect, useState } from "react";
  import { useTranslation } from "react-i18next";
  /** How long to wait for a main locale that may never load. */
  export const MAIN_WAIT_MS = 6000;
  /** True once the reader's main locale (and with it every shard) has landed, or after MAIN_WAIT_MS. */
  export function useLocaleReady(): boolean {
    const { i18n } = useTranslation();
    const lng = i18n.language || "en";
    const has = () => lng === "en" || i18n.hasResourceBundle(lng, "translation");
    const [late, setLate] = useState<string | null>(null);
    useEffect(() => {
      if (has()) return;
      const timer = setTimeout(() => setLate(lng), MAIN_WAIT_MS);
      const onAdded = (l: string) => { if (l === lng) setLate(lng); };
      i18n.store.on("added", onAdded);
      return () => { clearTimeout(timer); i18n.store.off("added", onAdded); };
    }, [lng, i18n]);
    return has() || late === lng;
  }
  ```
  In `src/pages/home/HomePage.tsx` replace
  `import { useHomeStrings } from "@/lib/home/strings";` with
  `import { useLocaleReady } from "@/lib/home/use-locale-ready";` and
  `const shown = useStickyReady(useHomeStrings());` with
  `const shown = useStickyReady(useLocaleReady());`. In
  `src/pages/pricing/PricingPage.tsx` the same for
  `usePricingStrings` (import line and `const shown = useStickyReady(usePricingStrings());`).
  Delete `src/lib/home/strings.ts` and `src/components/pricing/use-pricing-strings.ts`,
  and in `src/components/pricing/PricingView.tsx` delete
  `import "./use-pricing-strings";`.
- Tests: every hp test that reads a string file switches its path:
  `../lib/home/strings/` becomes `../i18n/shards/home/` and
  `../components/pricing/strings/` becomes `../i18n/shards/pricing/` in
  `hp-home-strings`, `hp-pricing-strings`, `hp-integration-one-voice`,
  `hp-fix-never-submit`, `hp-fix-alerts-one-answer`, `hp-fix-minors`,
  `hp-fix-language-swap`, `hp-fix-no-ip-lookup` (its `HOME_DIR` and
  `PRICING_DIR`), `hp-fix-currency-per-product` (its `HOME_DIR`,
  `PRICING_DIR` and the two English reads) and `hp-pricing-decisions` (its
  `en` import);
  `hp-fix-renewal-box` imports `@/i18n/shards/pricing/en.json`. Delete the
  "home strings loader" block in `hp-home-search-and-strings.test.tsx`, the
  "interim loader" block in `hp-pricing-strings.test.ts`, and the "pricing
  loader has a deadline" block in `hp-fix-language-swap.test.tsx` (its
  first-render and language-change blocks stay and now exercise
  `useLocaleReady`). Remove the `import "@/lib/home/strings";` and
  `import "@/components/pricing/use-pricing-strings";` lines from
  `hp-fix-never-submit`, `hp-fix-alerts-one-answer`, `hp-fix-minors` and
  `hp-fix-currency-per-product`. `src/components/pricing/pricing-jsonld.ts`
  imports `./strings/en.json` for the Full Analysis offer's description;
  it becomes `@/i18n/shards/pricing/en.json`.
  In `every-shard-string-is-loaded-translated-and-scanned.test.ts` ("both
  shards exist") add `"home"` and `"pricing"` to the expected names.

### 3. Strings crawlers must see

The bake reads the main locale (`EN_LOCALE`), so a shard key never reaches it.
Move these keys out of each language's shard file into the same language's
main file, `src/i18n/locales/<lng>.json`, in all nine languages. A move, not a
copy: a key in both fails the shard guard's collision rule.

- Homepage (`home.*`): `seo.*`; `hero.title`, `sub`, `qLabel`,
  `qPlaceholder`, `locationLabel`, `locationPlaceholder`, `submit`,
  `tryLabel`, `try.*`, `count_*`, `counted`, `scanLead`, `scanLink`;
  `board.title`, `note`, `total_*`, `seeAll`, `applyNote`; `rail.title`,
  `boards_*`, `readBasis`, `fieldsTitle`, `allFields`; `account.*`; `scan.*`;
  `sample.*`; `ai.title`, `lede`, `neverTitle`, `never2Lead`, `never2`,
  `never3Lead`, `never3`, `claude`, `chatgpt`, `claudeCode`, `reach`;
  `sources.*`; `plans.*`; `faq.*`. They stay in the shard: `hero.formLabel`,
  `hero.remoteWord`, `board.loading`, `ai.figure*`.
- Pricing (`pricingPlans.*`): `meta.*` (all six: `title`, `titleNoPro`,
  `description`, `descriptionFa`, `descriptionPro`, `descriptionClosed`),
  `head.*`, `before.*`, `buy.finalSale`, `buy.region`, `buy.gateSeller`,
  `buy.gateFaDelivery`, `buy.gateProWatched`, `free.*`, `fa.name`, `fa.unit`,
  `fa.what`, `fa.b1`-`fa.b5`, `fa.how`, `pro.name`, `pro.unit`, `pro.what`,
  `pro.step*`, `pro.perks.*`, `pro.review`, `pro.statusTitle`,
  `pro.statusBody`, `adds.*`, `b2b.*`, `limits.*`, `faq.*`. They stay in the
  shard: `fa.cta`, `fa.fine`, `fa.currency` (rendered by `FullAnalysisBuy`
  while the Full Analysis is on sale, and read from the English shard by
  `pricing-jsonld.ts` for the structured data), `pro.consent`,
  `pro.consentError`, `pro.cta`,
  `pro.fine`, `pro.memberActive`, `pro.manage`, `pro.owing`,
  `pro.updatePayment` (none renders while the gates are closed).
- Lighter alternative, with a precedent: the bake already reads one shard
  directly (`export { default as EN_COMPANY_SHARD } from
  "../src/i18n/shards/company/en.json";`, line 246). Adding
  `EN_HOME_SHARD` and `EN_PRICING_SHARD` the same way needs no string move.
  Whoever owns the bake picks one; the steps below assume the move.

### 4. Retire the old pages, and the tests that read them

- `src/pages/Index.tsx` (hp/scanner, delete-only): every Index route then
  carries a `landing`, so the `!landing && !freeKeywordResult` block that
  renders `<HomeHero agentOffer={<AgentOfferStrip />} />`, `AgentOfferStrip`,
  `homeTotals`, `homeTitle`, `homeDescription` and their SEO fallbacks, and
  the then-unused imports go. The `#upload` hash handling stays.
- Delete `src/components/HomeHero.tsx`, and in the tests that read it:
  `agent-hallmark.test.ts` (HERO, the `<HomeHero` checks; the h1-exclusivity
  check becomes "Hero owns the h1 on every Index route"),
  `pd-fix-section-83-reads-what-react-renders-and-every-title-form.test.ts`
  line 62, `a-company-count-that-names-both-of-its-numbers.test.ts` line 318
  and `the-headline-promised-zero-ghost-jobs-the-data-cannot-prove.test.ts`
  line 83: point each at `src/components/home/HomeSearchHero.tsx` where the
  rule still applies, otherwise drop the line.
- `src/test/a-pass-number-on-a-page-is-a-placeholder.test.tsx`
  (design/integration):
  - line 291 `import Index, { AgentOfferStrip } from "../pages/Index";`
    becomes `import Index from "../pages/Index";`;
  - the describe "the agent offer on the homepage" (it mounts `<Index />` at
    "/" and `<AgentOfferStrip />`, line 573, and holds the d823aae4 refusal)
    is deleted: its never-submit refusal now lives in `hp-fix-never-submit`
    over the new pages, and the allowance digits are the AI section's
    (`home.ai.reach`, interpolated);
  - line 588's `<HomeHero agentOffer=…>` expectation is deleted;
  - lines 593-599 ("teeth"): the anchor `export function AgentOfferStrip(`
    becomes `export default Index;` (line 2601), so the spelled-pass-number
    teeth keep reading Index;
  - lines 643-660: the slices of the bake's `path: "/",` block keep
    `not.toContain("AGENT_OFFER.pass")` and `spelledPassNumbers(home) === []`,
    and drop the three `toContain` lines (`${esc(AGENT_OFFER.connect)}`,
    `${esc(APPLY_YOURSELF_LINE)}`, `<a href="/agents"`): the new "/" block
    prints the AI section, whose links are `/agents#claude`,
    `/agents#chatgpt` and `/agents#claude-code`. Assert those three instead.
    The llms-full assertion (line 649) and the /agents block's
    `APPLY_YOURSELF_LINE` (line 171) stay.
- Delete `src/pages/Pricing.tsx` and its now-unread `pricingPage.*` keys in
  all nine main locales. That orphans `src/components/AddOnsShowcase.tsx`
  and `src/components/AgentSubscriptionCard.tsx` (and its five tests) unless
  wave 4 has already removed them. Then:
  - `design-no-raw-palette.test.ts` line 112 (`"src/pages/Pricing.tsx": 0,`),
    `the-ats-defense-roles-promise-is-shown-in-the-readers-language.test.ts`
    line 52 (design) / line 63 (wave 4) and
    `a-link-in-a-sentence-is-underlined-at-rest-on-the-money-path.test.ts`
    line 19: read `src/components/pricing/*.tsx` instead of
    `src/pages/Pricing.tsx`.
  - `pricing-truth.test.ts` (line numbers: design 174-205, wave 4 164-195):
    drop `["pricingPage", "noSubscriptions"]` from `KEYS`; replace
    `["pricingPage", "metaDescription"]` with
    `["pricingPlans", "meta", "description"]`; the test
    "pricingPage.metaDescription interpolates prices instead of stating
    them" becomes "pricingPlans.meta descriptions interpolate prices": each
    of `description`, `descriptionFa`, `descriptionPro` carries its
    `{{faPrice}}`/`{{proPrice}}` exactly once and no typed money
    (`/[$£€₹]\s?\d/`), and `descriptionClosed` carries neither.
  - `a-pass-number-on-a-page-is-a-placeholder.test.tsx` line 60 (design; 70 and 102 on wave 4)
    (the `pricingPage.pass*` scan) and `a-buy-button-quoted-25-dollars-for-a-5-dollar-product.test.ts`
    line 53 (`"pricingPage.heroBadgeLine"`, wave 4): drop the
    `pricingPage` namespace from both.
  - wave 4's `pricing-offers-pro-and-no-retired-product.test.tsx` (line 40)
    and `w4b-the-pricing-page-sells-what-is-sold.test.tsx` (line 54) import
    `../pages/Pricing`: re-point both to `../pages/pricing/PricingPage`.
    Keep their "no cut or retired product", "no buy button while no seller
    is named" (both cards say purchases open soon; with TEST SELLER and the
    switches the buttons return), "structured data quotes no retired price"
    and "starts no checkout on load" cases; drop the cases about the old
    page's ladder and Agent plan card (the new page has neither), which
    `hp-pricing-decisions` tests 1, 3 and 12 cover. In
    `w4b-the-pricing-page-sells-what-is-sold.test.tsx` line 132 and
    `w4b-pro-is-the-writing-tools-the-full-analysis-and-no-daily-scan-cap.test.ts`
    line 117 (107 on checkout-catalogue), replace `"src/pages/Pricing.tsx"`
    with `"src/components/pricing/PlanCards.tsx"`.
- wave 4's `w4b-fix2-the-homepage-stores-nothing-for-analytics-before-a-choice.test.tsx`
  (9af3c783, line 90) mounts `<Index />` at "/" as "the homepage". After
  step 1 "/" is `HomePage`: re-point that case to
  `import HomePage from "@/pages/home/HomePage";` mounted at "/" (it stores
  nothing: the new "/" mounts no scroll or time hook, step 13), and keep the
  `Index` mount as a second case at "/resume-checker" with
  `landing={TOOL_LANDINGS["resume-checker"]}`, where the scanner's hooks
  now run.
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
  (use hp/honesty's actual export name for the digest ruling, G6). Both
  pages read `SALE_SWITCHES`, so both follow, alerts included
  (`resolveSaleGates` takes `alertsStatable` from `saleGates`).
- `hp-home-gates.test.ts`'s first case then reads the real switches, and
  `hp-pricing-mirrors.test.ts` ("the sale gates' stand-ins …") compares them
  with `sales-gate.ts`.

### 6. Pro's perks are wave 4's list

- Agree the noun first: the owner's decision and this page say "packages"
  ("5 packages a day, 60 a month"; `pro.stepProAmount`, the FAQ's "What is a
  package?"); wave 4's `proPlan.perks.writingTools` says "up to 5 sets a day
  and 60 a month", and that text is also the Stripe description
  (`proStripeDescription`). Wave 4's rule is that a changed line gets a new
  key. Either wave 4 adds `proPlan.perks.writingToolsPackages` ("… up to 5
  packages a day and 60 a month") in nine languages and points
  `PRO_PERK_ITEMS` at it, or this page's three "package" strings change to
  "set". One noun on the page, the FAQ and Stripe.
- `src/components/pricing/pro-perks-mirror.ts`: delete the local
  `ProPerk` interface and `PRO_PERK_ITEMS` literal, and write
  `export { PRO_PERK_ITEMS, type ProPerk } from "@/config/pro-perks";`.
  `INCLUDED_FULL_ANALYSIS_KEYS`, `PRO_PERK_REQUIRES` and `visibleProPerks`
  stay: they already key the G2 rule on both `pricingPlans.pro.perks.includedFullAnalysis`
  and wave 4's `proPlan.perks.fullAnalysisIncluded` (held by `hp-fix-minors`),
  so the included Full Analysis keeps hiding while G2 is closed. The card
  renders `t(p.key, { defaultValue: p.text })`, which reads wave 4's
  translated `proPlan.perks.*`.
- Delete `pricingPlans.pro.perks.*` from the pricing strings (nine files).
- `src/test/hp-pricing-mirrors.test.ts`, "Pro's card says what wave 4's
  PRO_PERK_ITEMS says": drop the early return and the placeholder
  expectations; assert that `PRO_PERK_ITEMS` is wave 4's export (identity),
  that its English texts have no "unlimited", "all-access", "now and
  future", Freelance or Transition, that one line reads "No daily cap on
  scans", that exactly one item is gated on `fullAnalysisOnSale`, and that
  `proStripeDescription()` equals the page's English list joined the same
  way (P6). In `hp-pricing-decisions` test 2, the "every mirror key is a
  shard key" case reads the main locale instead.
- `hp-integration-one-voice`'s Pro check matches
  `INCLUDED_FULL_ANALYSIS_KEYS.includes(p.key)` instead of
  `p.key.endsWith("includedFullAnalysis")`.

### 7. Mirrors become imports

- `src/lib/home/board-figures.ts` `HOME_WITHHELD_SOURCES` and
  `src/components/pricing/plan-facts.ts` `WITHHELD_SOURCES`: import
  `MCP_WITHHELD_SOURCES` from `@/config/mcp-withheld` once wave 4 moves it
  out of mcp-tools.ts (P13); never import mcp-tools on "/".
- `src/lib/home/facts.ts` and `plan-facts.ts`: the scan allowance from
  `src/config/scan-allowance.ts`, the writing allowance from wave 4's
  `src/config/writing-allowance.ts` `WRITING_ALLOWANCE`, the Builder price
  and proposal from `@/config/builder-plan` and `BUILDER_PROPOSED`. The
  mirror tests and `hp-integration-one-voice` keep pinning both pages to one
  set of facts.
- Builder strings: `BuilderAndLicence` prefers wave 4's
  `dataApiPage.builderName`, `builderBody`, `builderNotYet` and `builderCta`
  once they are in the main locales; delete those four from
  `pricingPlans.b2b`. The price stays this page's key until wave 4's
  `dataApiPage.builderPrice` drops its typed "$" (today `"${{price}} a month,
  planned"` in all nine languages, which reads "$49" beside money()'s "45 $"
  in German) and takes `{{price}}` = `money(49, "USD", { lng })`; ask wave 4
  for that and for "licence" in en-GB `dataApiPage.builderBody`.
  `hp-pricing-mirrors` already compares the two with exactly those two
  differences normalised.

### 8. Renewal consent: delete the stand-in, keep the behaviour

Wave 4's contract (w4b/checkout-catalogue db74b6c8):
`PurchaseTerms kind="subscription" plan="pro"` renders its own required box
(`[data-auto-renew-box]`, "I agree that Pro renews automatically every month
at {{price}} until I cancel, and that I can cancel any time from my
account."), reports it through `onAutoRenewChange`, and `purchaseTerms()`
sends `autoRenewConsent: true` from the line containing the pressed button;
`subscribe(emailOverride)` takes no consent argument. When this merges,
`hp-fix-renewal-box` finds two boxes. In `src/components/pricing/BuyBlock.tsx`
`ProBuyBlock`:

- delete the stand-in `<div … data-renewal-consent="">` block (its label,
  checkbox and the `pricingPlans.pro.consent` text);
- keep `agreed`, `missing` and the press logic, fed by wave 4's box:
  ```tsx
  const block = useRef<HTMLDivElement>(null);
  const onAutoRenewChange = useCallback((ticked: boolean) => { setAgreed(ticked); if (ticked) setMissing(false); }, []);
  const press = () => {
    if (!agreed) {
      setMissing(true);
      block.current?.querySelector<HTMLInputElement>("[data-auto-renew-box] input")?.focus();
      return;
    }
    onGoPro();
  };
  ```
  with `ref={block}` on the `data-buy-block="pro"` div, the error
  paragraph (`pricingPlans.pro.consentError`, `role="alert"`) kept under
  PurchaseTerms, and
  `<PurchaseTerms kind="subscription" plan="pro" onAutoRenewChange={onAutoRenewChange} className="mt-1 text-subtle-foreground" />`
  moved above Go Pro (the box must sit above the button);
- `ProBuyConnected` keeps `void subscribe(user.email ?? undefined)`: the
  consent travels in `purchaseTerms()`.
- `hp-fix-renewal-box` stays as written (exactly one box, wave 4's
  sentence); `hp-pricing-decisions` test 6 reads the box through
  `[data-auto-renew-box] input` instead of `label[for]`. Delete
  `pricingPlans.pro.consent` from the pricing strings.
- If hp/honesty puts the final-sale and region lines into PurchaseTerms,
  delete `SaleTermsLine` from `BuyBlock.tsx` (`hp-pricing-decisions` test 4
  fails on a duplicate final-sale line). Wave 4's PurchaseTerms also shows
  its own `RegionNotice` to a browser in the territory, beside this block's
  region line: one of the two goes, by hp/honesty's choice.

### 9. Chrome (hp/honesty, a precondition: W4)

- `src/components/Footer.tsx` line 30: delete
  `{ to: "/freelance-boost", key: "footer.links.freelanceBoost", fallback: "Freelance Boost" },`
  and the `footer.links.freelanceBoost` key in the nine main locales
  (wave4/integration's Footer carries the same link at line 51 as a literal
  `<Link to="/freelance-boost" …>Freelance Boost</Link>`: whichever Footer
  survives the merge loses it).
- `src/pages/home/HomePage.tsx` and `src/pages/pricing/PricingPage.tsx`:
  `<Header />` becomes `<Header variant="quiet" />` once hp/honesty ships
  the variant (Sign in moves into the Menu sheet when the row does not fit,
  never at a fixed 360 px; no filled button).
- `hp-fix-switch-over-gate` refuses step 1 until both hold.
- For design: the comment at `src/index.css` line 272 says "a utility like min-h-6 wins
  over this base layer"; for links it does not (`a[href]` is 0,1,1). Correct
  the comment, or lower the rule to `:where(a[href])`.

### 10. The bake (scripts/prerender-seo.mjs)

- The data entry (line 214 onward) adds
  `export { pricingJsonLd } from "../src/components/pricing/pricing-jsonld";`,
  `export { pricingMetaKeys } from "../src/components/pricing/pricing-meta";`,
  `export { resolveSaleGates } from "../src/components/pricing/sale-gates";`,
  `export { saleGates, homePlanRows } from "../src/lib/home/sale-gates";` and
  `export { HOME_FIELD_SLUGS, fieldPath } from "../src/lib/home/fields";`.
- **The count crawlers read is D1's.** Today the bake's `BOARD_TOTAL` comes
  from `get_job_board_facets` (line 344), else the list's
  `totalAllCompanies` (line 407), else a committed snapshot, and prints as a
  0.93-floored "950,000+" with `COUNTS_BASIS` ("counted {TODAY}, when this
  page was built", line 1679). The "/" and "/pricing" blocks instead read
  `rpc/get_board_vendor_counts` (anon, read-only) and print the exact
  `openTotal` with "counted {date}, {time} UTC" from its `as_of`, or no
  figure at all when the call fails. Never `BOARD_TOTAL` on these two pages.
- The `path: "/"` block (line 1684): title and description from
  `home.seo.*`; the body prints the H1 and sub, the `GET /jobs` form
  (`q`, `location`), the count line above, the board note, field links from
  `HOME_FIELD_SLUGS` through the same slugs as `CATEGORY_LANDERS` (line
  1124; `hospitality_retail`, never `retail` or `hospitality`), the scan, AI
  (with the three `/agents#…` links), sources and plan text with no offer
  while G1, G2 or G2b is closed (the currency line is `plans.termCurrency`
  when `homePlanRows(saleGates()).pro` is non-null, else
  `plans.termCurrencyFa`), and the FAQ inside open `<details>`. No
  flow figure; no never-submit sentence while W3 is open. JSON-LD offers:
  the Full Analysis only when
  `homePlanRows(saleGates()).fullAnalysis.state === "onSale"`, Pro only when
  `.pro` is non-null, each one the offer of the same name in
  `pricingJsonLd(resolveSaleGates()).offers`, never built by hand, so the
  Full Analysis offer on "/" carries the same `price`, `priceCurrency` and
  `description` (the English `pricingPlans.fa.currency`, how the US-dollar
  list price is charged) as on "/pricing". `checkRetired` already covers
  "/" (line 1296).
- The `path: "/pricing"` block (line 3453): title and description from
  `pricingMetaKeys(resolveSaleGates())` (closed today: `meta.titleNoPro`,
  `meta.descriptionClosed`); the body prints the gated page from the
  main-locale strings of step 3 (Before you buy, the three cards with their
  gate sentences, the comparison and FAQ inside open `<details>`, the limits
  table), with the no-alerts sentences while `alertsStatable` is false;
  JSON-LD is `pricingJsonLd(resolveSaleGates())` beside the breadcrumb.
- `preloadFor` (line 1088): add the HomePage chunk for path "/" and the
  PricingPage chunk for "/pricing" (`chunkFor("HomePage")`,
  `chunkFor("PricingPage")`), as the Jobs chunk is for "/jobs": the LCP
  gate depends on it.

### 11. Links that meant the scanner

- `src/components/Header.tsx` `scrollToUpload` (design lines 61-74;
  wave4/integration lines 40-58): replace
  ```ts
  if (location.pathname !== "/") {
    navigate("/#upload");
    return;
  }
  window.scrollTo({ top: window.innerHeight, behavior: "smooth" });
  ```
  with `navigate("/resume-checker#upload");`. On the new "/" there is no
  `#upload`, and the old branch would scroll one screen down the board
  instead of opening the scanner. `hp-routes` holds it (step 1).
- `src/pages/ResumeBuilder.tsx` line 327
  `window.location.href = "/?rescan=1#upload";` becomes
  `"/resume-checker?rescan=1#upload"`, and
  `the-builder-opened-an-old-draft-for-a-new-scan-and-one-rewrite-replaced-several-bullets.test.tsx`
  line 153 expects `["/resume-checker?rescan=1#upload"]`.
- The 16 `/#upload` links become `/resume-checker#upload` (ProductPreview.tsx
  52, account/SetupChecklist.tsx 35, JobPosting.tsx 316, Account.tsx
  815/907/925/1360, Jobs.tsx 5059/5084/5497/7015/8201/10842; the Header's is
  above; the two in Pricing.tsx go with the file). Then read each
  `to="/"`, `href="/"` and `navigate("/")` in `src/pages` and
  `src/components` (about 40 in 23 files): a logo or "home" link stays; a
  scan call to action becomes `/resume-checker`.

### 12. free-keyword-scan stamp (H0)

hp/honesty's H0 removes the free report's 21 probability references and the
Scan Pack offer; its only server part is a re-stamp of free-keyword-scan
after every wave-4 stamp. Today: `w4b/payments-delivery` .2026-10-14.22,
`w4b/generators` .2026-10-14.24, `wave4/integration` .2026-10-14.30 (fa66a031; it was .29 at 518afef1)
(`supabase/functions/free-keyword-scan/index.ts`, `const FN_BUILD`). H0's
stamp is `"free-keyword-scan.<switch-over day>.1"`, a day later than all of
them.

### 13. Analytics

`landing_view` keeps firing on "/" (VisitSource, for every route), and the
board and posting events (`job_board`, `job_page`) are untouched. Before
adding `useScrollDepth("home")` and `useTimeOnPage("home")` to HomePage,
re-derive `VISITOR_BUDGET_PER_HOUR` in
`supabase/functions/track-ab-event/budget.ts` and the journey in
`src/test/a-budget-that-charged-the-office-for-one-visitors-loop.test.ts`.

### 14. Verify section 99 (`scripts/verify-deploy.d/99-home-pricing.sh`)

The SEO round took section 98 (`98-seo-round.sh` and `98-seo-speed.sh`, its
`seo-round` reservation on `seo/integration`), so the switch-over's section
is 99. A frontend and prerender deploy; read-only GETs with the Googlebot UA, one
headless run for the rendered claims, in the shape of section 83. Every
claim FAILs before the deploy by design.

- C1 "/" serves the owner's H1, a `<form action="/jobs" method="get">` with
  `name="q"` and `name="location"`, and a count line whose figure and stamp
  equal `get_board_vendor_counts`' `openTotal` and `as_of` (exact figure,
  "counted {date}, {time} UTC"), read by the section itself; no "950,000+"
  style floor.
- C2 "/" carries no "new · " flow pairing and no word "verified".
- C3 every `/jobs/field/` link on "/" is one of the category list's slugs;
  none is `/jobs/field/retail` or `/jobs/field/hospitality`.
- C4 "/pricing" serves "All sales are final", names the EU, the EEA, the UK
  and India, and names the currency and time-zone checks, without "billing
  address" and without "IP address" or "lookup" (W5); "/" the same for its
  territory line.
- C5 while `sellerIdentity(SELLER)` is null in this checkout: no Offer for
  the Full Analysis or Pro in the JSON-LD of "/" or "/pricing", no buy
  control in the baked HTML, and the /pricing description names no price.
- C6 the free-keyword-scan preflight's `x-fn-build` is H0's own stamp:
  `build_ge free-keyword-scan "$H99" <switch-over day> 1`.
- C7 the page React renders: the served entry and the English chunks carry
  the homepage H1 and not the retired homepage hero's strings.
- C8 "/#upload" in a browser lands on `/resume-checker#upload`, and
  "/resume-checker" still serves the scanner.
- C9 (headless, the rendered DOM of "/" and "/pricing", footer and header
  included): no "Freelance Boost", "Transition Pro", "Premium", "Scan Pack"
  or "unlimited" anywhere on either page, and exactly one filled button
  across header and main.
- C10 the apply agent is retired: `rpc/agent_sender_public_status` answers
  false, or /trust serves wave 4's retirement sentence; while neither holds,
  "/" and "/pricing" carry no "never submit".
- C11 (owner decision 2026-10-25, review round the same day) "/pricing"
  says "Pro is billed in US dollars" and "priced in US dollars and charged
  at about the same value in the currency of your device's time zone when
  we recognize the zone and support its currency, or in US dollars
  otherwise", and "/" its strip's currency line for the rows it shows;
  neither page carries a sentence that puts both products in one currency
  ("Prices in US dollars", "Prices are in US dollars") or promises "your
  local currency"; wherever "/" or "/pricing" publishes a Full Analysis
  Offer, its `description` is `pricingPlans.fa.currency`.
- G4 (W6) is a ledger precondition; the section prints it as a note, not a
  claim. G3 (W5) was decided on 2026-10-24 (the IP clause dropped), so C4
  holds the page to that decision instead.

### 15. Before and after

The speed gate and the JavaScript budget below are the owner's decisions of
2026-10-27. They replace the two targets this step was first written with:
a first-load JavaScript cap for "/" and an LCP ceiling "at 375 throttled"
that named no network profile. The switch-over build was measured against
both (the review round, above): the cap failed by 9.5 kB on the shared job
card, and the ceiling passed with the network unthrottled and failed on
Lighthouse's mobile profile, for the old page and the new alike. Those
measurements stay the record, in the review round and in
`docs/homepage-pricing/speed-baseline.json`.

- **Baseline (the day before):** run
  `~/.config/resumebooster/home-pricing-2026-10-18/tools/measure.cjs` against
  the live "/" and "/pricing" (`PAGES_HOME=https://resumebooster.work/`
  `PAGES_PRICING=https://resumebooster.work/pricing ONLY=shots,checks,coarse,cls`),
  plus a Googlebot curl of both, and save the numbers. The speed baseline is
  not a live reading: it is the old build measured beside the switch-over
  build in the lab, below. (The spec's "1.12 s at 375" named no network
  profile, so nothing is compared with it.)
- **The speed gate: never slower than today** (owner decision 2026-10-27).
  On the Lighthouse mobile profile (150 ms RTT, 1.6 Mbps down, 750 kbps up,
  4x CPU, applied through the DevTools protocol) and on the unthrottled
  4x-CPU profile, the new "/" LCP is no worse than the old "/": for every
  case measured (375, 320 and 414 px; a first visit and a visit with consent
  already chosen), the new build's median, rounded to the 0.1 s Lighthouse
  prints, is no more than the old build's (three runs a case in the stored
  baseline, five runs a case in a re-measure). A re-measure that fails is a
  fix before anything else ships.
  - *The baseline* is the old build's measurement, stored in the repo:
    `docs/homepage-pricing/speed-baseline.json` holds the old "/" (5c74e112)
    and the switch-over's "/" (8d8113ed), three runs a case, measured
    together on one machine on 2026-10-26, with the method and both profiles
    written out. `node scripts/home-speed-gate.mjs` judges it, and
    `src/test/hp-speed-the-new-home-is-never-slower-than-the-old.test.ts`
    holds the rule and the stored runs.
  - *Today it holds.* Lighthouse mobile profile, 375 px: 2.2 s against
    2.2 s on a first visit (medians 2,236 ms and 2,180 ms) and with consent
    chosen (2,232 and 2,172 ms); at 320 and 414 px, 2.2 s against 2.2 s. The
    new page is 36-60 ms slower by median there, inside the tenth of a second
    the rule reads. Unthrottled 4x CPU: 0.2 s against 0.2 s (228 and 244 ms;
    220 and 220 ms with consent chosen). Desktop, kept as the record and not
    gated: 0.1 s against 0.5 s (136 and 456 ms).
  - *The margin* (the review of 2026-10-27). Read in tenths, the rule passes
    a regression of up to 99 ms when both medians sit inside one tenth, and
    fails on a shift of a few ms across a rounding edge. So
    `scripts/home-speed-gate.mjs` prints, beside each verdict, the unrounded
    difference, each median's distance from the nearer edge of its tenth,
    the shift in one median that flips the verdict, and the runs' own
    spread. On the stored runs the closest case is the 375 px first visit on
    the Lighthouse mobile profile: +56 ms by median, the new median 14 ms
    below the 2.25 s edge, so a 14 ms shift flips it, which is inside that
    case's 128 ms spread of runs (one new run took 2,344 ms). The other gated
    cases flip at 18-31 ms (Lighthouse mobile) and 22-30 ms (unthrottled).
    That is why a re-measure takes five runs a case: one slow run moves a
    median of five less than a median of three.
  - *A re-measure* (at +1 day, or after any change to "/") builds and
    measures BOTH commits again, on one machine, the same way, five runs a
    case of each (the script refuses fewer; the method is in the baseline
    file; the tool is
    `~/.config/resumebooster/home-pricing-switch-over-2026-10-26/fix-round/tools/lcp2.cjs`),
    and judges the probe's output with
    `node scripts/home-speed-gate.mjs --new <new runs> --old <old runs>`.
    Absolute LCP moves with the machine, so the stored runs are the record,
    not a target for another machine's numbers; judged against them alone,
    the script says the verdict is indicative.
- **First-load JavaScript** (owner decision 2026-10-27): "/" ships with the
  JavaScript it has, 349,482 B gzip once the cards render and a 287,049 B
  static closure (2026-10-26; `firstLoadJs` in the baseline file). The
  earlier 340 kB target is retired. Slimming the shared job card (the
  `jobsPage` strings, the employer-name tables and `PostingMenu`, which the
  home cards never render) is a later change.
- **Real visitors (owner step):** read Search Console's Core Web Vitals
  report, mobile, for "/" and "/pricing" before the publish and again about
  28 days after it (the report reads Chrome's field data over a trailing 28
  days, so the second reading is the first that covers only the new pages).
  Note LCP, INP and CLS with each reading's date. Where Search Console shows
  no data for a page (too few Chrome visits), write that down; a lab number
  never stands in for it.
- **Lab checks at +1 day, on production:** LCP at 1280 2.5 s or less; CLS
  0.02 or less with a scroll started before the list answers, in English
  AND in a cold German and Spanish load at 375 (browser locale, as
  `measure.cjs`'s CLS cases do); axe 0 violations; 44 px targets under a
  coarse pointer (CDP touch emulation); no horizontal overflow at 320, 360
  and 375 px in the nine languages with every `<details>` open, and none
  under text spacing in German at 320; the search box and first posting on
  the 375x812 first screen; at most four Supabase data calls on "/" (vendor
  counts, freshness, list, fill curve) plus analytics; mcp-tools, the Index
  chunk, ResumeUploader and use-product-checkout not loaded on "/". Any
  check failing is a fix before anything else ships.
- **Funnel at +7 and +28 days**, deduplicated by visitor, against the 28
  days before: sessions landing on "/" (`landing_view`, `landingPage` "/"),
  the share that reach the board (`job_board`) and a posting page
  (`job_page` `posting_view`), employer apply clicks (`job_board`
  `apply_click`), uploads site-wide and from `/resume-checker`
  (`upload_started`, `upload_completed`), accounts created, `/pricing`
  views, and `checkout_started` (zero while the gates are closed). Report
  referred traffic (referral, social, organic) apart from direct: the 30-day
  funnel of 2026-10-01 was 131,336 direct against 22 referral and 15
  social.
- **Rollback triggers:** the board's anonymous-budget refusals rise;
  uploads site-wide fall by half or more at +7 with no recovery at +28;
  errors on "/" rise in the error dashboard; the new "/" slower than the
  old on either gated profile at the re-measure.

## Appendix A. The homepage builder's notes (`hp/home`)

The builder's own record, kept for detail. Where it and the sections above
differ, the sections above are current: the switch-over plan replaces the
builder's, the integration and the fix round changed the sentences listed
under "What the integration changed" and "What the fix round changed" (no
never-submit sentence, the rail's wording and day, the three exits, "within"
for the scan time), and the fix round's numbers supersede the builder's.

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
  it can place there, from the currency and the browser's time zone." (the
  IP-lookup clause the builder wrote was dropped by owner decision W5,
  2026-10-24) · the currency line (owner decision 2026-10-25, review round
  the same day): "Pro is billed in US dollars. The Full Analysis is priced
  in US dollars and charged at about the same value in the currency of your
  device's time zone when we recognize the zone and support its currency,
  or in US dollars otherwise." while the Pro row shows, its second sentence
  alone while it does not.
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
   phone usually shows three or four rows. (Since the review round of
   2026-10-26 the box ends at its last row whenever its new bottom stays at
   or below the fold, so that band is gone where nobody can see it move.)
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

Screenshots and data were in `keep/home-pricing-design/build/home/`
(`shots/`, `data/checks.*.json`), emptied on 2026-10-23; the current
measurements are in "What was measured" above.

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
| Home chunk (`lazy(HomePage)`'s own code, English strings included; every other module external), gzip -9 | 15.7 kB (63.3 kB raw), built from an archive export of 37310bdb in the scratch directory; each other language's strings 3.8 to 5.0 kB, loaded with the page. Predicted first load of "/": design entry 279.3 + CSS 18.9 + home 15.7 + shared listing chunk 13.5 = 327.4 kB, under the 340 kB cap; confirm on the switch-over build (measured there: 349,482 B once the cards render; the cap was retired on 2026-10-27, step 15) |
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
| `src/components/pricing/BeforeYouBuy.tsx` | all sales final; the region refusal and what checkout checks; each product's currency and Pro's renewal |
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
| Not sold in the EU, EEA, UK or India, said before any click, naming the currency and time-zone checks (never a billing address; the IP lookup dropped by owner decision W5, 2026-10-24) | `BeforeYouBuy.tsx` (the region item is always open), the FAQ | decisions 5; `hp-fix-no-ip-lookup` |
| Pro's separate, unchecked, required renewal box (AB 2863) | `ProBuyBlock` | decisions 6 |
| Each product in its own currency (2026-10-25): Pro billed in US dollars; the Full Analysis priced in US dollars and charged at about that value in the currency of the device's time zone when `use-currency.ts` recognizes the zone and `create-checkout` prices its currency, in US dollars otherwise; no sentence gives both one currency or promises "your local currency" | `BeforeYouBuy.tsx` (the renewal item), `HomePlanStrip.tsx`, `BuyBlock.tsx` (`FullAnalysisBuy`), `pricing-jsonld.ts` | `hp-fix-currency-per-product` |
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
- Screenshots, compare sheets and the JSON were in
  `keep/home-pricing-design/build/pricing/{shots,data,tools}`, emptied on
  2026-10-23; the current measurements are in "What was measured" above.

## Landing on land/all (2026-10-31)

`hp/switch-over` at 1890d7c7 is merged into `land/all` (wave 4, JPMorgan,
trusted pages, trust round 3, the SPA markup gate and the census tools, with
sales staying on), for the one deploy. The owner's rules of 2026-10-27 bind
the merge: no sales pause (every product main sells stays sellable wherever
main sells it, a gate defaults to today's live behaviour, and no seller
identity is invented), and on the EU, the EEA, the UK and India, "Keep
selling as today". What that changed here:

| What `hp/switch-over` had | On land/all |
|---|---|
| `src/config/sales-gate.ts` shipped `FULL_ANALYSIS_ON_SALE` and `PRO_ON_SALE` false (G2, G2b) | Both true: the $5 Full Analysis and Pro are on sale, as on main. `DIGEST_MAIL_CLASS` stays "unruled" |
| G1: every buy control, both pages and the bake waited for the seller's name and address (`purchasesOpen()`, the "seller" gate, `gateSeller`, `faGatedSeller`) | Gone. `src/lib/purchases-open.ts` keeps `fullAnalysisOnSale()` (G2) and `proOnSale()` (G2b) and reads no seller; `saleGates` and `resolveSaleGates` read the switches alone. The seller line still prints only once the owner fills `src/config/seller.ts` |
| A switched-off control said purchases open soon | It shows no button (the comparison and the closing call to action offer the free scan); no sentence in nine languages promises a sale soon, the closed descriptions and the FAQ's closed answer included |
| G6: "alerts" only with a transactional ruling or the seller's name | Alerts are named unless the digest is ruled marketing mail while the seller is unknown: send-search-digest sends whatever the seller's state, as on main, and no mail waits for the seller on land/all |
| The region line in PurchaseTerms and under the Full Analysis, the "Before you buy" region notice, the pricing FAQ's region question, the homepage's territory term, the pricing descriptions' "not sold in the EU, the EEA, the UK or India yet", the buy blocks' time-zone notice | Removed in nine languages; `checkout/RegionNotice.tsx` stays deleted. "Before you buy" says all sales are final and how each product is charged |
| Index's checkout handler refused while the Full Analysis was off sale | No switch read: the checkouts sell what main sells (land/all's handler) |
| llms.txt committed in the closed form, `llms-lines.ts` wrote "opens for purchase soon" | llms.txt keeps land/all's open form; `llms-lines.ts` names only what the pages sell and never a later opening |
| Builds: create-product-checkout and create-subscription-checkout 2026-10-26.1, send-market-pulse 2026-10-25.2, send-scan-report 2026-10-25.1, send-product-email 2026-10-27.1 | Each takes a build past both branches: 2026-10-31.2 for the two checkouts, 2026-10-31.1 for the three senders (send-product-email was 2026-10-27.1 on both branches, on different code). free-keyword-scan, its stream fork (2026-10-31.1) and send-search-digest (2026-10-25.1) are this branch's builds unchanged |
| Section 99: C4 asked both pages to name the territory and the two checks; C5 asked for no priced offer while no seller is named; C6 asked for this branch's builds | C4 fails a page that names a place as unsold or drops "All sales are final"; C5 fails a page that offers no Full Analysis or Pro at a price, prints a gate note, drops a price from the /pricing description or says purchases open soon, seller named or not; C6 asks for the merged builds, and each branch's own earlier build of those five fails |
| The old `src/pages/Pricing.tsx` | Retired, as this branch retired it; land/all's tests that mounted it mount `PricingPage` |

The tests that held the closed shop or the territory now prove both gone
(every-buy-control, the scanner's G2 test, hp-home-gates, hp-pricing-decisions,
hp-integration-one-voice, hp-fix-alerts-one-answer, hp-bake-home-and-pricing,
the section 99 test, the buy-line test, now named
`the-buy-line-says-all-sales-are-final-and-names-no-place-it-does-not-sell`);
`the-currency-signal-turns-away-no-buyer-outside-the-territory`, whose refusal
no longer exists, is removed (its Montenegro and Kosovo prices in US dollars
stay in `use-currency.ts`).
