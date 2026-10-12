# Design upgrade: pass A and the listing and company groups (branch `design/integration`)

Owner goal of 2026-10-11: upgrade the company pages, check every job listing
on the board, and upgrade the site's design, with bug checks before and after.

This integration merges three branches onto `profiles/integration`
(`823da0c4`, company profiles phases 0 to 2), built 2026-10-12. It is
**frontend only**: nothing under `supabase/`, `job-board`, `scripts/`,
`public/` or the `index.html` head changes.

| Merge | Branch (tip) | Group |
|---|---|---|
| `46f1434f` | `design/design-system` (`1fe14994`) | G1 pass A: tokens, primitives, data parts, shared modules, string shards, filter row, header |
| `f0bed7d7` | `design/job-listings` (`c21048e9`) | G2: the listing vocabulary and the shared card, pane, phone sheet and posting-page components |
| `1c806282` | `design/company-page` (`6fe27fe0`) | G3: the company lander model and its regions |

The groups' file sets are disjoint: no file is changed by two groups and the
merges had no conflicts. A review of `3ebdcbb2` (three lenses: honesty and
data, accessibility/i18n/mobile, regressions) found 30 defects; all 30 were
reproduced, 28 are fixed with a test and two are fixed in part (the light
theme's legacy contrast and the legacy landers' layout shift; see "Review
fixes" below). The integration needed two fixes of its own:

- `2d6f11a7`: `src/lib/format.test.ts` wrote a literal no-break space inside a
  regex, which fails eslint's `no-irregular-whitespace`. It now writes the
  escape ` `.
- `38482b30`: G1's shard guard
  (`every-shard-string-is-loaded-translated-and-scanned.test.ts`) demanded
  identical leaf keys in all nine languages. Its own next check, and the
  plural guard, require Spanish, French and Portuguese to carry a `_many`
  form that English does not use. So both real shards failed it the moment
  they landed. The guard now counts a plural group as one key, the rule the
  main-locale parity test (`src/i18n/index.test.ts`) already uses. Three gaps
  planted as a negative control each still fail it: a missing German key, a
  missing German plural group and a missing Spanish `_many`.

## Deploy procedure: read this first

1. **Not before company profiles 0 to 2.** This branch rides on
   `profiles/integration`, which is not on main yet. Profiles merges first and
   is deployed and verified ([its README](../company-profiles/README.md): verify
   sections 80, 91, 40 and 49, then its held migration released). Until it is
   live the perk reader `get_employer_perks` does not exist, and the lander
   asks for it and gets a 404 (measured on this build; the perk block renders
   nothing then, so seekers see no error). Main then thaws
   (docs/DEPLOY-LEDGER.md section 2).
2. **Take main first.** Main (`e75945fe`, PR #32, when this was built) is not
   an ancestor of this branch, and profiles will have merged by then. Merge
   `origin/main` into `design/integration`, re-run the typecheck and the full
   suite, and push. A merge conflict here means a group stepped outside
   its files: give the file to its owner.
3. **Merge through an integration PR whose full suite passed.** Then main
   freezes until the deploy below verifies.
4. **Frontend publish only.** No function, migration or job-board version
   changes here. Run `node scripts/deploy-ledger.mjs --message` at the merged
   commit. It must list no function and no migration that this branch added.
   If it lists any, they belong to another workstream, and that workstream's
   deploy goes first. The Lovable publish rebuilds the SPA and the prerender
   bake; the frontend goes live within minutes of the publish.
5. **Verify** with the after-audit checklist below and
   `bash scripts/verify-deploy.sh`. One verifier line is expected to fail:
   see "Decisions" below.

## What changed

### Live on the first publish

- **Tokens (G1).** The Ledger palette in `src/index.css` and
  `tailwind.config.ts`. Dark is served to everyone. Light is QA-only through
  `?theme=light`, remembered as `rb_theme`; `?theme=dark` forgets it. main.tsx
  writes `data-theme` before React mounts and nothing reads
  `prefers-color-scheme` (`SYSTEM_DEFAULT_ENABLED = false`). Static Inter with
  a metric-matched fallback; Space Grotesk is gone. One radius scale, flat
  surfaces, three motion speeds, z layers (header 40, sheets 50, toasts 60).
  Targets: every pointer gets a 24px floor on buttons, ARIA controls,
  selects and box-laid links (an inline link in a sentence keeps its line);
  a coarse pointer gets 44px on buttons, tabs, menu items and selects. Links
  and controls that size themselves (a `min-h-6` utility wins over the base
  layer) stay at 24px or the spacing WCAG 2.5.8 allows; they are not 44px
  under touch. The fixed header sets `scroll-padding-top` (3.5rem, 4rem from
  lg). Tailwind scans `index.html`, so the skip link's focus styles exist.
  Glow, gradients and press-scale are
  removed from the design system's own files. Legacy pages keep theirs until
  they are cleaned: a ratchet in `design-no-raw-palette.test.ts` lets their
  counts only fall.
- **Primitives and chrome (G1).** Button, Chip, Sheet, IconButton,
  Disclosure, OverflowMenu, EmptyState, ErrorState, skeletons, Monogram,
  and the AsOf, Fact and Stat data parts. The header names every control and
  cannot clip its call to action: at lg and up it shows Jobs, Companies, For
  AI chats, Pricing, More, the language and the account. Under lg it shows the
  logo, a named credits button, Start and a Menu sheet. The footer's resource
  links are translated. The help, upload and sticky bars lose gradients and
  bounce. One sonner toast stack sits behind the old toast API. Sonner
  (1.7.4) has one live region, `aria-live="polite"`, so every toast, an
  error included, is announced politely, as the Radix toaster's
  `role="status"` toasts were; on a phone the stack sits at the bottom (Radix
  sat at the top). `the-toast-note-says-how-sonner-announces.test.ts` reads
  sonner's bundle, so an upgrade that changes this fails loudly. Legacy
  heroes keep the phone rule holding `blur-[150px]`/`[100px]`/`[80px]` at
  50px until they are cleaned.
- **String shards (G1, G2, G3).** `src/i18n/shards/<group>/<lng>.json` merge
  into the one namespace. English rides in the bundle (so the prerender bake
  reads it); other languages load in the same request as their main file.
  `listing` has 68 keys and `companyProfile` 132, in all nine locales.
- **The posting page (G2).** `/jobs/posting/...` now prints the shared
  listing components: a breadcrumb; a status line that says only what its
  stamp supports, "Employer's feed read N ago" (a read of the whole board,
  never a claim that this posting was in it; a gone posting reads "first
  missing from its feed {date}", our detection date); one filled Apply
  naming the employer's site and the system it opens; "Check my fit, free"
  second; facts that each name their basis ("as the employer's system states
  it", "from the employer's feed" under the employer's own figure, our annual
  estimate on its own line as "our estimate (× 2,080 hours)", the employer's
  minimum years or our seniority reading without a range and marked as ours);
  and the employer's own description, with "our copy may stop short" where a
  stored copy stops mid-sentence under the cap. A posting the board still
  serves as live but which has no date renders, instead of reading as gone.
  "More roles at {employer}" loads its code and its one list call only when
  it nears the viewport, is never mounted on a token two hiring systems share
  or on USAJOBS, prints only rows from the posting's own system under the
  posting's own employer name, and drops its see-all link when the reply held
  anyone else's row. The "never an aggregator" note is left off USAJOBS rows
  as it was off agency rows. The employer-context panel prints money and
  dates in the reader's notation.
- **Company page pieces already mounted (G3).** CompanyPerks opens its count
  and quote on activation (tap, click, Enter, Space), never on focus, with a
  check only at half the postings or more (`PERK_CHECK_MIN_SHARE`).
  Its quotes carry `lang="en"`. Filings print localized dates. The SEC card
  carries its load date. Similar companies print counts only with `as_of`.
  An absent collision count reads "count not available". `/companies` is
  localized, says whose systems its boards are (employers', labelled agency
  boards, and USAJOBS as the federal listing site) instead of "no
  aggregators, no reposts", and prints its counts only under the board's
  last count time ("Counts from the board's last count, 40 min ago").
- **Legacy board fixes the token pass made necessary.** The sticky search
  row and AccountNav follow the header's heights (`top-14 lg:top-16`); the
  industry row clips to its pills' height (30px, 44px under touch); the
  orientation box holds its pill row open; the "Try:" starting points ask
  the history as it stood on arrival (the board's own auto-opened posting
  hid them mid-visit); the pane's employer link is underlined; four
  opacity-dimmed texts moved to the measured `subtle-foreground` token.

### Built, but dormant until G1 pass B wires `src/pages/Jobs.tsx`

- **G3's lander** (`src/components/jobs/company/CompanyLander.tsx` and its
  regions: header, collision, USAJOBS hub, agency banner, About rail and
  phone accordion, hiring record, pay, hiring mix, public records, empty
  states), decided once by `src/lib/company/lander-model.ts` (variant, one
  open-roles figure with the basis of its date, "read" or "counted", a name
  from data, the sections each variant may show; the "Actively hiring" chip
  only on a standard page with open roles above zero). A figure with no date
  prints no line; pass B passes `listAnsweredAt` so the list's figure is
  dated even when the board's read stamp is missing.
  Jobs.tsx still mounts the legacy lander, so `/jobs/company/:token` looks as
  before apart from the tokens and header.
- **G2's card, pane and phone sheet** on the board (`JobCard`,
  `PostingDetail`, `PostingSheet`). The board still renders its own.
- **G1's FilterBar and FilterSheet** (one filter row, Filters (n), work mode
  trinary, counts only where measured, a company variant that cannot filter
  the company off its own page and wraps its row; focus stays in the row
  when a chip or "Clear all" is pressed; the hidden submit is no Tab stop).

### Pass B must also

- Swap G3's stand-ins for G1's modules: `src/lib/company/format.ts` for
  `src/lib/format.ts`, and `src/components/jobs/company/parts.tsx`
  (CompanyChip, ProfileSection, WhyDisclosure, ValueBar) for Chip, Surface
  and Disclosure. `lander-model.ts` follows `display-name.ts` by hand.
- Swap G2's seams: `listingEmployer` (src/lib/listing/employer.ts) for
  `displayEmployer`, and `durationSince`, `formatListingDate` and
  `formatAmount` for `format.ts`.
- Reconcile G2's prop types with `src/components/jobs/contracts.ts`. Menu
  handlers take `(job, ...)`, are optional and add `reported`/`compared`.
  The pane's `fit` is `slots.fit`. New slots: howApplying, decision,
  payContext, similar, fieldChip, siblings.
- Pass `recheckOnApply` true only where Apply calls `verifyJob` (the board's
  pane, card and drawer); JobPosting runs no verify and keeps it false.
- Add the shard guard's "both shards exist" assertion (its header names
  pass B for it), now that both are on disk.

## Review fixes (2026-10-12, on top of `3ebdcbb2`)

Each finding was reproduced first (live data from the read-only job-board
API, a headless preview of `3ebdcbb2`, or a harness mounting the dormant
components), then fixed with a test, or measured and fixed in part.

| # | Finding | Result | Held by |
|---|---|---|---|
| 1 | "More roles at {employer}" printed another employer's roles (clear: a BambooHR "Clear" internship under "CLEAR - Corporate"; USAJOBS: Army and Marine Corps roles under NIH) | Fixed: not mounted on a collided token or USAJOBS; same-system, same-employer rows only; see-all link dropped on a mixed reply | `more-roles-never-prints-another-employers-roles.test.tsx` (the live clear and usajobs replies) |
| 2 | "Live at source" claimed the posting was in a board-level stamp; tip promised removal at the next read; gone chip called our detection date a takedown date | Fixed: "Employer's feed read {ago}" in a neutral line; "first missing from its feed {date}"; tip reworded; the duplicate Feed read fact removed; nine locales | `PostingDetail.test.tsx` |
| 3 | Zero page could show "Actively hiring" and "Live jobs straight from…" | Fixed: chip needs the standard variant and open roles above zero; no subtitle on zero | `an-empty-company-page-offers-a-way-out.test.tsx` |
| 4 | Our annual estimate disclosed only in a title | Fixed: basis line under the employer's figure, "≈ $62K–$79K/yr, our estimate (× 2,080 hours)" on its own line; the card says "(our estimate)" | `PostingDetail.test.tsx`, `JobCard.test.tsx` |
| 5 | "Mid level (3–5 yrs) · 5+ yrs" | Fixed: the employer's minimum when stated, else our bucket without a range, marked as ours | `PostingDetail.test.tsx` |
| 6 | Header figures without a date (bare count, pay share, work-mode split) | Fixed: undated figures print no line; pay share and split carry their read | `one-open-roles-number-per-company-page.test.ts` |
| 7 | /companies "no aggregators, no reposts" above USAJOBS; undated counts; USAJOBS posting note | Fixed: intro names employers, agency boards and USAJOBS; counts only under the board's count time; note left off USAJOBS rows | `the-directory-dates-its-counts-and-says-whose-systems-they-are.test.tsx`, test 1 |
| 8 | Share button 48x16.5 and "Open there" link 160x16.5 at 1280 (2.5.8) | Fixed: 24px floor for every pointer; measured 48x24 and 160x24 | `every-pointer-gets-a-24px-target-and-the-header-never-hides-focus.test.ts` |
| 9 | Desktop CTA's es/pt name did not contain "Comenzar"/"Começar" | Fixed: aria-label removed; AX name is the visible word | `the-header-names-every-icon-button-and-never-clips-its-cta.test.tsx` |
| 10 | Skip link invisible on focus (classes never generated) | Fixed: Tailwind scans index.html; focused link at [16,16], z 50, on top | `the-skip-link-is-visible-when-it-has-focus.test.ts` |
| 11 | Removing a chip or "Clear all" sent focus to body | Fixed: next chip, else previous, else Filters | `removing-a-filter-chip-keeps-keyboard-focus-in-the-filter-row.test.tsx` |
| 12 | 1x1 hidden submit was a Tab stop | Fixed: tabIndex -1 | same |
| 13 | Company variant location box 50px at 1024 | Fixed: row wraps; 258px at 1024, 514px at 1280 | same |
| 14 | "Check fit" name did not contain its label in six locales | Fixed: "Check fit: {{title}}" pattern in nine | `JobCard.test.tsx` |
| 15 | Fixed header covered focus moved backwards | Fixed: scroll-padding-top; "free scan" now lands at y 424, not 0..20 | test 8 |
| 16, 27 | Industry row showed a 6px sliver of its second row | Fixed: pills h-[30px], window sm:max-h-[30px], 44px under touch; 7 half-clipped pills to 0 | `the-legacy-board-follows-the-new-header-and-pill-heights.test.ts` |
| 17 | English perk quote without lang | Fixed: lang="en" on both quotes | `a-perk-check-opens-on-activation-never-on-focus.test.tsx` |
| 18 | Light theme: 60-65 contrast nodes per legacy page | Fixed in part: the bulk was the industry-pill counts (opacity-70); those and four other dimmed texts moved to `subtle-foreground`; light nodes across 24 light runs 655 to 10, all on the legacy home; Hero, AtsCoverage and FinalCTA joined the ratchet; light stays QA-only until every ratchet is 0 | `design-no-raw-palette.test.ts` |
| 19 | README promised 44px for everything under touch | Corrected (and the 24px floor added) | this file |
| 20 | Facts squeezed in Tagalog at 375 | Fixed: stacked below sm; value column 223px to 343px | `PostingDetail.test.tsx` |
| 21 | Report reasons in an unnamed group | Fixed: group labelled by "Report" | `JobCard.test.tsx` |
| 22 | Fill-curve count printed as "read 1 hr ago" beside "this board read 46 min ago" | Fixed: every figure carries basis "read" or "counted" | test 6 |
| 23 | A description cut mid-word under the cap said nothing | Fixed: "Our copy may stop short of the full posting." with the employer link, for a prose last line without sentence punctuation | `a-capped-description-says-it-continues.test.tsx` |
| 24 | Pricing's in-text links marked by colour alone | Fixed: `.link`; also the home benchmark links and the board pane's employer link | `a-link-in-a-sentence-is-underlined-at-rest-on-the-money-path.test.ts` |
| 25 | /jobs CLS over 0.1; landers worse | /jobs fixed (median 0.104 to 0.046; base 0.057). Landers fixed in part: unchanged at 0.154 and 0.163 (3ebdcbb2 0.156 and 0.165, base 0.136 and 0.146): the legacy Hiring Health card mounting above the list at ~1s is 0.12-0.13 in all three builds and leaves with pass B's CompanyLander | test 16 |
| 26 | Sticky search row 7px below the h-14 header | Fixed in Jobs.tsx and AccountNav: gap 7 to -1 at 375 and 768 | test 16 |
| 28 | Posting page carried the More-roles section in its first load | Fixed: section and card are a 4.8 kB chunk fetched near view; JobPosting chunk 16.4 to 14.7 kB | measured below |
| 29 | Toast note claimed assertive announcement | Corrected: sonner is polite only, as Radix's role=status was | `the-toast-note-says-how-sonner-announces.test.ts` |
| 30 | Phone blur override dropped | Restored for the legacy heroes: blur(150px) to blur(50px) at 375 | test 8 |

Nothing was refuted: every finding reproduced as described.

## Checks run on this branch (2026-10-12, at the pushed head)

| Check | Result |
|---|---|
| Frontend-only limit (`git diff --name-only origin/profiles/integration..HEAD`) | nothing under supabase/, scripts/, public/, job-board, worker/, the index.html head or package files (`tailwind.config.ts` now lists `./index.html` as content; index.html itself is untouched) |
| `npm run typecheck` | clean |
| eslint on the changed files | no new error; Jobs.tsx and tailwind.config.ts keep their base errors |
| Full vitest suite | one full run at `202341d6`: 913 files, 11,892 passed, 23 skipped, 5 failed in 4 files. Three were guards pinning the industry pills' old `opacity-70` class (`a-cap-is-not-a-count-in-the-rail`, `an-uncounted-industry-is-not-an-empty-one`, `the-only-recovery-control-sent-nothing`) and one found the desktop CTA by its removed aria-label (`a-phone-had-no-menu-and-start-left-the-scanner-it-was-on`); each now reads the new spelling and the 4 files pass (18 tests). The pre-push gate runs the full suite again on the pushed commit |
| `npm run build` | built on a `git archive` export of the head (so the bake's rewrites of public/ and scripts/ never touch the worktree): vite built in 12s, the bake wrote 1,675 pages |

**Bundle size** (`dist/assets`, gzip -9; base `823da0c4`, review build
`3ebdcbb2`, this head):

| | base | 3ebdcbb2 | head |
|---|---|---|---|
| entry chunk | 281.1 kB | 279.0 kB | 279.3 kB |
| CSS | 17.9 kB | 18.6 kB | 18.9 kB |
| first load (entry + CSS) | 299.0 kB | 297.6 kB | 298.2 kB |
| JobPosting chunk | 3.7 kB | 16.4 kB | 14.7 kB |
| shared listing chunk (`age`) | - | 10.8 kB | 13.5 kB |
| MoreRolesAtEmployer (lazy) | - | - | 4.8 kB |
| Jobs chunk | 97.8 kB | 97.6 kB | 94.6 kB |
| all JS | 225 files, 3,052.9 kB | 254 files, 3,120.0 kB | 255 files, 3,127.0 kB |

Scripts requested on a live posting page at 375px: 367.7 kB in 34 files
(3ebdcbb2) and 369.4 kB in 35 (head) on the clear posting, where the new
guard brings the 139-row collision table into the first load; 465.3 kB to
369.4 kB on `greenhouse/allcareers/8882277002`, where 3ebdcbb2 also pulled
the whole Jobs chunk.

## After-audit: before (`3ebdcbb2`) vs after (this head)

Same sample, same live job-board data, both builds served by `vite preview`
side by side, headless Playwright chromium:

- **axe-core 4.10** (WCAG 2.0/2.1/2.2 A and AA), 12 pages (home, /jobs,
  /jobs?q=nurse, the same with the pane open, the Anduril lander,
  /companies, /pricing, Greenhouse, Workday, clear and USAJOBS posting
  pages, the phone menu, the More menu) at 1280 and 375, dark and light, 48
  runs: **42 violations on 698 nodes before, 4 on 18 after.** By rule:
  color-contrast 632 to 18, link-in-text-block 26 to 0, target-size 40 to 0.
  Served dark theme 43 nodes to 8, all on the legacy home (the uploader's
  "Optional" chips under an opacity-70 section, the "0 chars" counter, the
  LinkedIn button). Every posting page, /companies, /pricing, /jobs and the
  lander are clean in dark.
- **Page errors:** 0 in every run of both builds (axe runs and the 12-page
  rendering probe); no console errors.
- **Listing rendering** (live): the clear posting reads "Employer's feed
  read 3 hr 48 min ago", no More-roles section, "5+ yrs as the posting asks";
  the USAJOBS posting has no More-roles section and no "never an aggregator"
  note; the hourly fixture reads "$29.92–$38.07 (USD) · hourly rate / from
  the employer's feed / ≈ $62K–$79K/yr, our estimate (× 2,080 hours)"; the
  5-day-old read reads "Employer's feed read 5 days ago" in a neutral line.
- **Company pages** (live): /companies leads "32,081 company job boards
  hiring now", the new intro, then "Counts from the board's last count, 40
  min ago."; the legacy landers render as before (pass B swaps them).
- **Dormant components** (harness): chip removal moves focus to the next
  chip, Clear all to Filters, no 1x1 Tab stop; company FilterBar location
  50px to 258px at 1024; header "1,653 open roles · counted 1 hr ago" beside
  "this board read 46 min ago"; Check fit named "Check fit: Staff
  Accountant"; the Report group named "Report"; Tagalog facts 343px wide.
- **Layout shift** (1280, 6 runs, median): /jobs 0.104 to 0.046 (base
  0.057); Anduril lander 0.156 to 0.154; 2020 Companies lander 0.165 to
  0.163. Phone (375): /jobs 0.001-0.003 in all three builds; /companies 0.008 to 0.011.
- **Measured fixes:** skip link on top at [16,16]; es/pt CTA names
  "Comenzar"/"Começar"; sticky gap 7px to -1px at 375 and 768; industry row
  30px window with 0 half-clipped pills (44px window under touch); Share
  48x24; phone hero blur 50px.

## Screenshots

Under the session scratchpad, `scratchpad/keep/design-upgrade/after-audit-3ebd/`
(`shots/`, the scripts in `tools/`, the raw axe and perf JSON in `data/`):

| Files | What it shows |
|---|---|
| `live-post-clear.{before,after}.png` | the clear posting: green "Live at source" and a foreign BambooHR role under "More roles" before; a neutral read line and no section after |
| `live-post-usajobs.{before,after}.png` | NIH posting: Army and Marine Corps roles under "More roles at National Institutes of Health" before; none after, and no aggregator note |
| `posting-hourly.{before,after}.png` | the Pay row's basis line and the labelled estimate; Experience |
| `companies.{before,final}.png` | the directory intro and the count date |
| `{base,before,after}.jobs-sticky.{phone,tablet}.png`, `*.jobs-chiprow.desktop.png` | the 7px strip and the clipped second row, then neither |
| `skip-{before,after}-{1280,375}.png` | the focused skip link hidden, then visible |
| `{before,after}-company-{1024,1280}-{en,de}.png`, `*-board-1280-menu.png`, `*-sheet-375-tl.png` | dormant FilterBar, header, menu and phone facts |
| `axe-*.{before,after}.png` | the axe sample pages |

The earlier set (the 2026-10-11 design audit, and the first branch shots in
`scratchpad/keep/design-upgrade/shots/`) stays as it was.

## Decisions for the owner

1. **Verify section 77 will fail one line after this deploys.**
   `scripts/verify-deploy.d/77-wave3-board-data-ingest.sh` (line 60 here)
   wants `jobPostingPage.scoreCta` in the JobPosting chunk. This build's
   JobPosting chunk no longer carries it; it carries
   `listing.actions.checkFit` ("Check my fit, free", the spec's label), and
   the page still offers the free score beside Apply (re-checked on this
   head's build: the JobPosting chunk carries `listing.actions.checkFit`
   and not `jobPostingPage.scoreCta`). The fix is one string:
   look for `listing.actions.checkFit` instead. It is not made here because
   main and wave 4 already carry a newer section 77 (`e9946e47`), so the
   owner of `scripts/verify-deploy.d` should make it on main. The other
   choice is to keep the old label on the posting page.
2. **Section 62 may fail after pass B.** Lines 56 and 60 want
   `jobPostingPage.noPayFound` and `jobPostingPage.unlistedMeta` in the
   JobPosting chunk. Both are there in this head's build, after the
   More-roles split. Once Jobs.tsx imports the
   listing components, the bundler may move `noPayFound` (now read by
   PostingFacts) into a shared chunk. Re-check after pass B builds.
3. **Card changes from G2 that take effect in pass B:** at most two chips
   (agency, then layoff, then employer record, then the field note, so a
   layoff chip outranks the hiring-record chip); seniority moves from the
   card to the facts; Apply leaves the card for the pane and the sheet.
4. **Outside this workflow, seen while checking:** the company page title
   is "{company} Jobs — N Verified Openings" (the bake's
   `scripts/prerender-pages.mjs` and `jobsPage.companySeoTitle` in the main
   locale), and the legacy lander and home say "verified" open roles. These
   belong to the SEO group and to pass B's copy. The legacy lander on a
   collision token also still answers "Yes — 34 verified open roles right
   now, straight from Clear's own job board" (seen live on /jobs/company/clear
   in the after-audit, unchanged from 3ebdcbb2): G3's CollisionHeader
   replaces it when pass B mounts the new lander, which is the fix.
5. **Two gate failures after any local `npm run build` (the bake's, not this
   branch's).** With `dist/` and the bake's generated files present, the
   pre-push suite fails three tests that a clean checkout skips or passes:
   - `the-sitemap-never-advertises-a-posting-url-with-no-page.test.ts`: the
     baked sitemap advertised 454 posting URLs against the generator's stated
     cap of 400 (the bake logged "live 454 (354 carried, 100 new)"). The cap
     is not applied to carried plus new pages in `scripts/prerender-seo.mjs`.
   - `published-claims.test.ts` (two freshness sweeps): the bake bundles old
     `src/data/changelog` entries into the gitignored
     `scripts/.prerender-data.mjs`, and the sweep of `scripts/` reads that
     generated copy.
   Both belong to the SEO group. The push here ran after the build outputs
   were moved out of the worktree.

## After-audit checklist (after the publish)

1. `bash scripts/verify-deploy.sh`: every section passes except the one
   line in decision 1 (until it is re-pointed). Section 49 shows no gap.
2. The live entry is this build: the JobPosting chunk named by the live
   entry contains `listing.actions.checkFit`, and the entry contains
   `rb_theme`.
3. Theme: `<html data-theme="dark">` on a fresh visit; `?theme=light`
   switches and is remembered across pages; `?theme=dark` forgets it. A
   browser with blocked storage still renders dark.
4. Header at 375px and 1280px: no clipped call to action; the Menu sheet
   opens above the header, traps focus and returns it on close; every icon
   button has a name.
5. A posting page on each vendor family (Workday, Greenhouse, Oracle,
   USAJOBS): the status line reads "Employer's feed read N ago" (never
   "Live at source"), one Apply naming the system it opens, the fit check,
   every date naming its basis, no age on an undated posting, the
   description or our own missing-description line. On a USAJOBS posting
   and on any token in `src/lib/board-collisions.ts`, no "More roles"
   section; elsewhere its cards are the same employer's.
6. A posting the board serves as live with no date renders (no "gone" page,
   crawl directive unchanged).
7. A collision token's page (any name in `src/lib/board-collisions.ts`)
   still shows no employer facts, no perks, no SEC card and no LCA line.
8. Perks: no block on any lander until a key is published (profiles step 4);
   then a check opens on tap, click, Enter or Space, never on focus.
9. In German, Spanish, French and Hindi, the posting page and `/companies`
   read translated, with no raw key on screen; a count of a million reads
   with the `_many` form in Spanish, French and Portuguese.
10. Crawlers: `curl -A Googlebot` a baked posting page and a company page;
    the English listing strings are in the HTML (shards ride in the bundle).
11. WCAG 2.2 AA on the money and search paths: keyboard through the header,
    search, a posting page and Pricing; the first Tab shows the skip link;
    visible focus never under the header; 24px minimum targets everywhere
    (44px buttons and selects under touch); text contrast from the measured
    tokens. axe on the after-audit's sample: only the legacy home's 4.
12. Changelog: entries in all nine locales for what seekers can see (the
    posting page, the header, the theme), each read against production, in
    the next frontend publish.
13. Record the verified deploy in `docs/deploy-ledger.json`
    `verifiedDeploys` (the merged commit, no functions).
