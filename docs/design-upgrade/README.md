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
merges had no conflicts. The integration needed two fixes of its own:

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
  surfaces, three motion speeds, z layers (header 40, sheets 50, toasts 60),
  44px targets under a coarse pointer. Glow, gradients and press-scale are
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
  bounce. One sonner toast stack sits behind the old toast API.
- **String shards (G1, G2, G3).** `src/i18n/shards/<group>/<lng>.json` merge
  into the one namespace. English rides in the bundle (so the prerender bake
  reads it); other languages load in the same request as their main file.
  `listing` has 68 keys and `companyProfile` 132, in all nine locales.
- **The posting page (G2).** `/jobs/posting/...` now prints the shared
  listing components: a breadcrumb, a status led by where the posting stands
  at its source ("Live at source, feed read N ago"), one filled Apply naming
  the employer's site and the system it opens, "Check my fit, free" second,
  facts that each name their basis ("as the employer's system states it",
  "from the employer's feed"), and the employer's own description. A posting
  the board still serves as live but which has no date renders, instead of
  reading as gone. Four more roles at the employer load in one lazy call.
  The employer-context panel prints money and dates in the reader's notation.
- **Company page pieces already mounted (G3).** CompanyPerks opens its count
  and quote on activation (tap, click, Enter, Space), never on focus, with a
  check only at half the postings or more (`PERK_CHECK_MIN_SHARE`).
  Filings print localized dates. The SEC card carries its load date. Similar
  companies print counts only with `as_of`. An absent collision count reads
  "count not available". `/companies` is localized.

### Built, but dormant until G1 pass B wires `src/pages/Jobs.tsx`

- **G3's lander** (`src/components/jobs/company/CompanyLander.tsx` and its
  regions: header, collision, USAJOBS hub, agency banner, About rail and
  phone accordion, hiring record, pay, hiring mix, public records, empty
  states), decided once by `src/lib/company/lander-model.ts` (variant, one
  open-roles figure, a name from data, the sections each variant may show).
  Jobs.tsx still mounts the legacy lander, so `/jobs/company/:token` looks as
  before apart from the tokens and header.
- **G2's card, pane and phone sheet** on the board (`JobCard`,
  `PostingDetail`, `PostingSheet`). The board still renders its own.
- **G1's FilterBar and FilterSheet** (one filter row, Filters (n), work mode
  trinary, counts only where measured, a company variant that cannot filter
  the company off its own page).

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

## Checks run on this branch (2026-10-12)

| Check | Result |
|---|---|
| Frontend-only limit (`git diff --name-only origin/profiles/integration..HEAD`) | nothing under supabase/, scripts/, public/, job-board, worker/, index.html, package files |
| `npm run typecheck` | clean |
| eslint on the 170 changed .ts/.tsx files | 14 errors, 13 already in the base (Jobs.tsx, SavedSearchPills, textarea, published-claims, the moved `require` in tailwind.config.ts); the one new error fixed in `2d6f11a7` |
| Full vitest suite | first run: 2 failed (the shard guard), fixed in `38482b30`, and 3 of the 905 files never started (fork workers timed out under load). The push gate's run at `2a58e804`: 905 files, 11,817 passed, 23 skipped, 0 failed |
| `npm run build` | built in 36s; the bake wrote 1,672 pages. The bake also rewrites `public/sitemap.xml`, `public/llms.txt` and `scripts/board-facets-snapshot.json` and writes `public/prerender-ledger.json` in the working tree; those were restored or removed and are not committed |

**Bundle size against the base** (`823da0c4` built without the bake; only
`dist/assets` compared, gzip -9):

| | base | this branch | change |
|---|---|---|---|
| entry chunk | 281.1 kB | 279.0 kB | -2.1 kB |
| CSS | 17.9 kB | 18.6 kB | +0.7 kB |
| first load (entry + CSS) | 299.0 kB | 297.6 kB | -1.4 kB |
| JobPosting chunk | 3.7 kB | 16.4 kB | +12.7 kB (the listing components) |
| Jobs chunk | 97.8 kB | 97.6 kB | -0.3 kB |
| all JS, 225 to 254 files | 3,052.9 kB | 3,120.0 kB | +67.1 kB (+2.2%), mostly the 16 lazy shard files and the dormant components |

The bake adds a modulepreload hint for the Footer chunk to the baked home
page. That hint is the bake's (`scripts/prerender-seo.mjs`), not this branch's.

## Screenshots

Taken headless (Playwright chromium) from `vite preview` of this branch's
baked `dist/`, with live data, at 1280x800 and 375x812 (phone, touch), in
dark and in `?theme=light`. Saved under the session scratchpad
(`scratchpad/keep/design-upgrade/shots/`, with `shoot.mjs` and `probe.mjs`
beside them). The before set is the 2026-10-11 design audit
(`scratchpad/design-audit/before/`).

| Page | Files | What it shows |
|---|---|---|
| Home `/` | `home.{1280,375}.{dark,light}.png` | new header (phone: logo, credits, Start, Menu); the hero is legacy (gradient text, glow button, counts without a date) |
| Board `/jobs`, `/jobs?q=nurse` | `jobs*.{1280,375}.{dark,light}.png` | new header and tokens on the legacy board (pass B swaps in the card, pane and filter row) |
| Company `/jobs/company/andurilindustries` | `company.{1280,375}.{dark,light}.png` | legacy lander on the new tokens (pass B mounts CompanyLander) |
| Directory `/companies` | `companies.{1280,375}.{dark,light}.png` | localized directory |
| Pricing `/pricing` | `pricing.{1280,375}.{dark,light}.png` | tokens and header |
| Posting `/jobs/posting/workday/rmit~wd3~RMIT_Careers/JR50855` | `probe/posting.{1280,375}.png` | the new posting page: status, one Apply, fit check, dated facts |

Measured on every page: no horizontal page scroll at 375px in either theme,
no visible button or link without a name, `data-theme` dark by default and
light only under the flag, no page error. One failed request: the perk
reader's 404 on the company page (step 1 above). The posting page has no text
under 12px. The legacy home, board and lander still print 9 to 11px text
(`text-[10px]`, `text-[11px]`), which pass B and the ratchet remove.

## Decisions for the owner

1. **Verify section 77 will fail one line after this deploys.**
   `scripts/verify-deploy.d/77-wave3-board-data-ingest.sh` (line 60 here)
   wants `jobPostingPage.scoreCta` in the JobPosting chunk. This build's
   JobPosting chunk no longer carries it; it carries
   `listing.actions.checkFit` ("Check my fit, free", the spec's label), and
   the page still offers the free score beside Apply. The fix is one string:
   look for `listing.actions.checkFit` instead. It is not made here because
   main and wave 4 already carry a newer section 77 (`e9946e47`), so the
   owner of `scripts/verify-deploy.d` should make it on main. The other
   choice is to keep the old label on the posting page.
2. **Section 62 may fail after pass B.** Lines 56 and 60 want
   `jobPostingPage.noPayFound` and `jobPostingPage.unlistedMeta` in the
   JobPosting chunk. Both are there in this build. Once Jobs.tsx imports the
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
   belong to the SEO group and to pass B's copy.
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
   USAJOBS): status line, one Apply naming the system it opens, the fit
   check, every date naming its basis, no age on an undated posting, the
   description or our own missing-description line.
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
    search, a posting page and Pricing; visible focus; 24px minimum targets
    (44px under touch); text contrast from the measured tokens.
12. Changelog: entries in all nine locales for what seekers can see (the
    posting page, the header, the theme), each read against production, in
    the next frontend publish.
13. Record the verified deploy in `docs/deploy-ledger.json`
    `verifiedDeploys` (the merged commit, no functions).
