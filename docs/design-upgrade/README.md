# Company profiles 0-2 and the design upgrade: one deploy (branch `design/integration`)

Owner goal of 2026-10-11: upgrade the company pages, check every job listing
on the board, and upgrade the site's design, with bug checks before and after.

Company profiles phases 0 to 2 and the design upgrade now ship **together**,
as one integration PR to main (ledger reservation `company-profiles`,
`deployOrder` 2, after R1 at 1.5). This branch carries:

- company profiles phases 0 to 2 (`profiles/integration`, `823da0c4`; what
  ships and why is in [its README](../company-profiles/README.md));
- design pass A with the listing and company groups (the 2026-10-12
  integration below);
- the last fix round, 2026-10-12 to 2026-10-17: Track 1 accuracy
  (`pd/accuracy`), the crawler bake (`pd/bake`) and pass B, which wires the
  board (`pd/wire`, which contains the other two);
- the fixer's round of 2026-10-18 (`pd-fix`) on the integration's review:
  see "The fix round of 2026-10-18" below;
- origin/main at `5464e502`: R1, the wave-3 closeout, SEO-024 and the
  disk alarm.

**The procedure below is the only deploy procedure for both.** The company
profiles README points here.

## Deploy procedure (company profiles 0-2 and the design upgrade together)

The Lovable message is generated, never copied from this file:
`node scripts/deploy-ledger.mjs --message` at the merge commit on main
(docs/DEPLOY-LEDGER.md). The tables below are there to check the generated
message against.

### 0. Before the merge

1. **R1 goes first** (`critical-path`, deployOrder 1.5). On 2026-10-17 the
   ledger at this branch still lists R1's `20261014100000` as pending, and
   it lists six R1 functions as MUST BUMP: `auth-email-hook`,
   `auth-signed-in`, `free-keyword-scan`, `get-account-data`,
   `process-email-queue` and `scan-credits`. Each still serves its
   `2026-10-14.1` stamp, but its own folder changed after the stamp (R1's
   fix rounds, `3a6f9d14` to `77811380`). This holds on origin/main
   itself, so `--message` on main exits 2 until the R1 owner bumps them or
   shows that the live code is the repo's. That is settled first. Nothing
   on this branch touches those functions.
2. **The owner signs** what is listed under "Owner sign-offs" below. The
   GD6 copy and the D7 list come before the publish. The rest can follow it.
3. **One integration PR whose full suite passed** (the pre-push gate runs
   it again). Main freezes on the merge until step 4 verifies and
   section 49 shows no gap (docs/DEPLOY-LEDGER.md section 2).

### 1. Migrations, before the functions, in this order

They go through Lovable's staged runner one at a time. Every file checks
itself (a DO block that RAISEs) and is safe to run twice. If the runner
reports a failure, **stop**. Do not let it edit the file or stage it under
another name. Read the RAISE and fix it on a branch. A migration counts as
applied when sections 80, 81 and 91 show its behaviour, not when the runner
says so.

| # | Migration | What it does | Notes |
|---|---|---|---|
| 1 | `20261012100000_an_employer_is_named_by_its_hiring_system_and_its_board` | `employer_segment`, `employer_key` | service role only |
| 2 | `20261012101000_a_company_page_reads_facts_only_from_its_own_hiring_system` | intel, similar and financials pool by employer key | after 1. It refuses to replace a live reader whose body it does not recognise, and prints the hash it found |
| 3 | `20261012102000_a_headcount_says_the_day_it_was_true` | `company_profiles.as_of` | one nullable column |
| 4 | `20261012110000_a_perk_is_counted_from_the_employers_own_postings_and_shown_only_once_audited` | perk tables, sweep, rollup, audit, `get_employer_perks` | edited in place this round (never applied anywhere; main's drizzle journal has no 20261012 entry). It drops and recreates `employer_perk_sweep_take`, whose return gained `text_hash` |
| 5 | `20261012110100_the_census_lists_the_perk_reader_with_its_caller` | `client_callable_census()` lists the reader | |
| 6 | `20261012120000_a_relist_warning_never_reads_another_site` | `board_multi_site_title_share` (service role), `get_repost_index` re-issued | Track 1 A2 |
| 7 | `20261012121000_a_fill_share_counts_only_roles_the_board_was_watched_for` | `get_company_fill_curve` re-issued: delayed entry, the R(14) interval, the 21/28-day floor, eight appended columns | Track 1 A4. The live frontend ignores the new columns until the publish |
| 8 | `20261012122000_a_field_admits_a_board_by_what_it_could_see_before_the_cohort` | `get_category_fill_curve` re-issued | Track 1 A5 |
| 9 | `20261012130000_four_company_tables_are_read_through_their_readers_and_never_by_a_client` | `showcase_excluded`, `company_profiles`, `company_financials` and `company_name_overrides` closed to PUBLIC, anon and authenticated | safe before the publish: neither the live frontend nor this one reads them directly (both use the definer readers), and job-board reads two of them with the service role. Its self-check reads the catalogue only and never switches role, so it applies inside the staged runner's `_mig_exec` definer (PostgreSQL refuses a role switch there, 42501); sections 81f and 81g probe the reads over REST |
| 10 | `20261012135000_a_workday_tenant_that_hosts_another_employer_is_read_one_site_at_a_time` | `workday_site_is_own_employer`; `get_company_intel` and `get_similar_companies` rewritten from the catalogue | after 2. It refuses a live body it does not recognise (S12-130) |
| 11 | `20261012136000_a_similar_employer_is_named_by_its_board_and_the_federal_listing_site_is_not_one` | `get_similar_companies` rewritten from the catalogue: no USAJOBS row, no staffing-agency board, no board name two hiring systems share; each board named by its full-token override, else the name most of its rows carry (never `max(company)`) | after 10 (it refuses to run before it). It refuses a live body it does not recognise. Section 81h reads it |
| - | `20261012111000_the_perk_sweep_runs_every_minute_under_a_lease_and_the_rollup_nightly_under_a_budget` | the vault key and the two crons | **HELD** (`holdUntilVerified`) until step 6 |

### 2. Functions

| Function | OPTIONS must answer `x-fn-build` | Note |
|---|---|---|
| `employer-profiles` | `employer-profiles.2026-10-12.2` | new; `verify_jwt = false` from its `supabase/config.toml` block (the cron and the owner's admin key carry no JWT) |

No other function changes. The shared hiring-record gate and the perk
extractor under `supabase/functions/_shared/` are imported only by
`employer-profiles`. `--against origin/main` finds 0 violations.

### 3. Publish the frontend

Lovable rebuilds the SPA and the prerender bake. The integration's build
from live data (2026-10-17) wrote 3,388 static pages and a sitemap of
1,369 URLs (500 posting, 486 company, 383 other). The dist is 126.6 MB in 7,063 files (the base before the carry was 67.0 MB in 3,624; the bake builder measured 100.8 MB in 6,890 on 2026-10-12). Most of the growth is the once-published
pages the bake now keeps (1,013 company stubs and 713 seeded posting pages),
so the owner confirms that Lovable publishes a build of this size.

**The window until wave 4 publishes (deployOrder 3).** This publish takes
the retired products off every page it owns: the home hero, its strip, the
FAQ, the Trust page, the bake, the guide and llms.txt. Pages it may not
touch still sell them until wave 4's frontend lands: Pricing.tsx's Agent
plan card, its pass line (`pricingPage.passLine`) and its own JSON-LD (the
pass and the $99 `highPrice`), AgentConnect's pass card, `/agents/pass`, the
signed-in `/agent` console, and `atsCoverage.*` on `/` and `/pricing`
("We apply for you", shown only while the agent sender answers online).
So for that window nothing this publish writes says the agent is retired
or that its plan and pass are no longer sold: the guide at
`/guides/how-the-apply-agent-works`, the baked `/agent` and llms.txt say
how to apply with your own AI and stop there, and the FAQ names Pro and
sends the reader to the Pricing page for every plan on sale. Wave 4
restores the retirement sentences when its sale-path removal and its
checkout refusals are live. Keep the two publishes close together.

### 4. Verify (read-only)

`bash scripts/verify-deploy.sh`. The sections this deploy answers to:

| Section | File | Judges |
|---|---|---|
| 80 | `80-profiles-identity.sh`, `80-company-profiles-perks.sh` | identity and the perk engine (`employer-profiles.2026-10-12.2`, the reader answers anon, the perk tables refuse it) |
| 91 | `91-profiles-gate-and-fixes.sh` | the hiring-record gate, the LCA line, headcount, llms.txt, V3, V3b, V7, V7b (it reads the lock's 42501 on `company_profiles.as_of` as the lock) |
| 81 | `81-profiles-design-accuracy.sh` | Track 1 on named pages, the four-table lock, and (81h) no USAJOBS row in the similar-employers list of CVS Health or Eurofins |
| 83 | `83-profiles-design-bake.sh` | the crawler copy sells nothing retired (now also /trust, /privacy, /terms, and every company-title form the bake writes); once-published company URLs keep a page of their own; (C6) USAJOBS is baked as the federal listing site and Surge Staffing as an agency; (C7) the strings React renders (the entry, the English and Index chunks) carry none of the retired home, FAQ and trust sentences |
| 87 | `87-profiles-design-pass-b.sh` | the board serves the lander, card, pane and filter row; the agent pitch is gone |
| 40 | `40-db-exposure.sh` | the census shows nothing unlisted |
| 49 | `49-deploy-ledger.sh` | no gap |
| 62, 77 | re-pointed this round | the posting page's pay and fit lines, read in the shared posting chunk the posting page imports |

Before the deploy, sections 81, 83 and 87 fail on production by design
(81 on every claim except 81d's gate side and 81g). On 2026-10-18 the fixer
ran the new 83 against production: every line FAILs as designed, and C7
found all eleven retired sentences in the served bundle, which is its
positive control. 83 (7 lines) and 87 (6
lines) pass on the integration's local build, served the way the host
serves it. On 2026-10-17, 83 still failed on production, and 62 and 77,
re-pointed, still passed there. Then run the
after-audit checklist at the end of this file, and record the verified
deploy in `docs/deploy-ledger.json` `verifiedDeploys`.

### 5. Release the hold (a second, ledger-generated message)

Once section 80 passes, empty the `20261012111000` entry in
`holdUntilVerified` and send the message the ledger generates. The sweep
starts within a minute. Then watch `node scripts/perk-audit.mjs status`,
measure the perk tables' size after the top 2,000 boards, and compare
job-board's deep-cursor rate over the 2 hours before and after (V6b,
within 10%).

### 6. Perks: the AI-judge audit and the flags (D2)

For each candidate key (health, dental, vision, life_dis, retire, pto,
parental, equity, visa_not_offered), run
`node scripts/perk-audit.mjs draw --perk <key>`. It writes 60 publishable
rows, and since extractor version 2 up to a quarter of them come from a
negation stratum, each row labelled. Independent AI judges grade every row
and the owner spot-checks at least 10. Then
`node scripts/perk-audit.mjs record --file <file>`: 57 of 60 publishes the
key for 45 days, and fewer unpublishes it. Re-audit monthly. A key nobody
re-audits stops showing on day 45 by itself.

### 7. Changelog, then thaw

Entries go in all nine locales for what seekers can see, each claim read
against production, in the next frontend publish (owner rule). The perks
entry waits until a key is published and the block is seen live on a
lander. Main thaws when section 49 shows no gap.

### Owner sign-offs

- **D7, the name gate's dry run.** No page indexable today leaves the index
  this round. The integration's bake (2026-10-17) lists four pages a
  stricter rule would drop, each kept: two UKG postings whose employer name
  is logo text (`recruiting2~AME1104ANBT~…/9e54289b…`,
  `recruiting~REG1001RWHM~…/238cdd44…`), `/jobs/company/eexs~us2~CX_3001`
  ("All") and `/jobs/company/icfcjb~ocs~CX_1` ("Aerospace"). The
  signing table, `docs/company-profiles/name-gate-dry-run.md`, is
  regenerated from the integration's bake (it had five rows on 2026-10-12;
  the list moves with the live postings). Sign drop yes or no per row. A `company_name_overrides` row is the better fix for each. Pages
  leaving the index under rules that existed before this round:
  `disney~wd5~disneycareerdc` and `hpe~wd5~Jobsathpe` point their
  canonical at a larger board of the same employer, and
  `nvent~wd5~nVent` keeps a noindex page of its own instead of the
  homepage copy.
- **GD6, the copy changes.** The re-post sentence (it drops "at least" and
  keeps "came back under the same posting or"), "{{n}} roles dated in the
  last 30 days", the growth line's label, the USAJOBS hub's wording, "We
  could read only part of this board", the Ghost Job Index's "open roles
  right now", the company title "{company} jobs: N open roles from their
  own hiring system", and the bake's apply-yourself line. Added by the fix
  round of 2026-10-18: the results line's split ("Showing 10 of 10 roles: 8
  dated in the last 30 days, 2 with no date"), the lap board's withheld
  reason (the lap sentence, no count, where the zero-relist sentence quoted
  23,594), the pane's "counting every takedown" line, the field pool's
  "company job boards we read in full", the Ghost Job Index's methodology
  paragraphs (day-30 admission by takedowns in the 90 days before the
  cohort; the 14-day pool on full-read boards), the USAJOBS hub's and the
  agency board's baked pages, the collision and USAJOBS page titles, the
  nameless zero page's heading ('Roles on the "10kbi" board'), and the
  conditional re-check ("Where the employer's system allows it, we re-check
  ...").
- **GD1, GD3, GD4, GD5.** The listing-age line is not shipped (GD1). No
  takedown verdict is shown anywhere (GD3, GD4). The 90-day counts are
  refused on every lap-read board (GD5(a)).
- **The collision page's fold** (pass B decision 1): the first card is at
  594px at 375 (budget 520).
- **The dist size** (step 3).
- **IndexNow.** Nothing was submitted. Re-submitting the historical URLs
  (SEO-012) waits for the owner's go-ahead once the stubs are live.
- **`employer-profiles` keeps `employer-profiles.2026-10-12.2`**, although
  `sweep.ts` and the extractor changed this round. It has never been
  deployed, so .2 is still its first build. Bump it if a .2 build was ever
  served anywhere.
- **Left for wave 4 or the product-line owner** (read by files this round
  may not touch, or rendered by them): `agentHero.badge`, `agentHero.sub`
  and `agentHero.inventory` ("Your AI apply agent", "verified openings",
  "submit where employers allow it"), `applyAgent.badge`,
  `agentPlan.perkAutoApply` ("Applies for you automatically on ..."),
  `atsCoverage.autoTitle`, `autoBlurb`, `clickTitle`, `clickBlurb`,
  `stripLegend`, `allTitle` and `allBlurb` ("We apply for you", rendered by
  AtsCoverage on `/` and `/pricing` while the agent sender is online),
  `pricingPage.allProductsOneTime` and `pricingPage.passLine` (the pass),
  the Premium Package purchase-flow strings (`freeResults.*`,
  `productSuccess.*`, `pricingPage.premiumPackages`), Pricing.tsx's own
  JSON-LD (the pass and the $99 `highPrice`), and the retirement sentences
  this branch holds back in the guide, the baked `/agent` and llms.txt (see
  step 3's window). The home hero, its strip, `homeAgent.passLine`,
  `faq.questions.bringYourAgent` and the Trust page's agent strings are no
  longer on this list: the fix round of 2026-10-18 took wave 4's values for
  them (docs/deploy-ledger.json `_sharedFilesNote`). Wave 4 sets
  `BAKE_STILL_SELLS_THE_PASS` to false once both are merged.

## The fix round of 2026-10-18 (branch `pd-fix`, pushed as `design/integration`)

The integration's review (honesty, crawler and UX lenses) confirmed 16
defects and listed 14 minors. Every confirmed one is fixed, each with a test
that failed on the code before it; 12 minors are fixed and 2 are left with a
reason.

| Finding | Fix | Test |
|---|---|---|
| The four-table lock's self-check switched to anon (`SET LOCAL ROLE`), which PostgreSQL refuses inside the staged runner's `_mig_exec` definer (42501), so the whole lock would roll back | The self-check reads the catalogue only; 81f/81g probe the reads over REST. A guard fails any migration from the drizzle baseline on that switches role | `a-migration-the-staged-runner-executes-never-changes-role.test.ts`; `four-company-tables-...` runs the file through a `_mig_exec` stand-in, twice |
| USAJOBS baked as an employer ("Open roles at USAJOBS ... own hiring system", "is hiring in", an Organization); SPA titles said "{company} jobs: open roles from their own hiring system" for USAJOBS and collision tokens; a USAJOBS row could get a posting page | `companyLanderPage` takes `kind` ("usajobs": the hub's own words and cap, no Organization); `postingRowEligible` refuses USAJOBS rows; the SPA's title and description follow the model's variant and name; the hub's record footnote speaks of "the postings this site lists" | `pd-bake-an-agency-board-and-usajobs-are-baked-as-what-they-are.test.ts`, `a-company-pages-title-and-heading-match-its-variant.test.tsx` |
| A lap board's header and results line said "read 6 hr ago" | `landerBoardReadAt` only where `feedReadStatable` passes; otherwise the figure is "counted" | `pd-wire-the-feed-read-stamp-...` (lander cases) |
| The results line called undated roles dated | One helper (`openRolesSplit`) for the header and the results line ("Showing 10 of 10 roles: 8 dated in the last 30 days, 2 with no date") | `one-open-roles-number-per-company-page.test.ts` |
| `get_similar_companies` listed USAJOBS as "Veterans Health Administration" (max(company)) under "companies hiring from their own systems" | `20261012136000`: no USAJOBS, agency or shared-name board; names from the full-token override, else the most common name | `a-similar-employer-is-named-by-its-board-and-the-federal-listing-site-is-not-one.test.ts`; verify 81h |
| Staffing-agency boards baked as plain employers | `kind: "agency"` from the catalogue's flag (`scripts/prerender-agency.mjs`): the SPA's banner, "roles listed in", no Organization | the offline bake test reads `/jobs/company/surge`; the reader is held to the shared catalogue reader |
| A lap board's withheld reason quoted the 90-day count GD5 hides (Domino's 23,594) | The gate takes the lap sentence before the zero-relist control (same reason string, so 91 V7b still matches) | `a-board-we-have-not-proven-we-read-prints-no-pace`, `an-employer-page-prints-no-figure-...`, `a-card-and-a-detail-pane-...` |
| React's home hero, strip, FAQ and Trust page still sold the agent and the pass and said it applies for you, against this publish's own bake | Wave 4's HomeHero.tsx and locale values taken where they are the same change; the strip's pass line and link gone; the FAQ and Trust strings rewritten in nine locales; the guide, `/agent` and llms.txt hold "retired" until wave 4 (step 3's window) | `a-pass-number-on-a-page-is-a-placeholder`, `agent-hallmark`, `apply-agent-guide`, `pricing-truth`; verify 83 C7 |
| The baked `/trust` said the agent "applies to for you", and the retired-claims list missed the wording | Trust strings rewritten; `RETIRED_CLAIMS` widened (and "re-verified"); 83 C1 reads `/trust`, `/privacy`, `/terms` | `pd-bake-the-crawler-copy-...` (the `/trust` case), `pd-fix-section-83-...` |
| llms.txt said "re-verified through the day" and "re-checked live at the moment of Apply" | Both conditional and re-read; the React head description and the industry pages too | the bake's own check and C1 |
| On a collision page the pane credited one employer's postings and a pooled count to the other; the USAJOBS hub's cards named no agency | `landerOneEmployer`: only an employer's own page hides the employer; the pane links no pooled count and its back control names the boards (or USAJOBS) | `a-board-name-two-employers-share-shows-no-employer-facts.test.tsx` |
| Enter on a ⋯ menu item opened and marked applied the pane's posting; one Escape on the phone sheet ran history.back twice; Escape on a menu closed the posting | `src/lib/board-keys.ts`: the window shortcuts skip a keypress a layer took or aimed inside a menu, dialog or listbox | `a-key-pressed-inside-a-layer-belongs-to-that-layer.test.tsx` (Jobs.tsx's own handlers) |
| The zero page's H1 was a loading bar forever and its title the raw token | `model.nameSettled`: once the list answered, the heading and the title name the board ('Roles on the "10kbi" board') | `a-company-pages-title-and-heading-match-its-variant.test.tsx` |

**Minors fixed:** the conditional re-check in llms.txt and `howApply.recheck`
(nine locales); the pane's outlived line states a fill share only where the
re-post test files fills as fills, else every takedown; the Ghost Job Index
methodology describes the new admission rule and the full-read 14-day pool,
and the pool sentence counts company job boards; 83's title check accepts
every form the bake writes (one page in five gets a short one) and still
refuses "verified"; `resolveDuplicateGroups` keeps a member indexable today
before the name gate (D7); field pages, `/companies` and `/jobs` date their
counts and drop "re-checked continuously", "no reposts" and "every opening
belongs to"; one-word name repairs are flagged on the owner's report
(`docs/company-profiles/name-gate-dry-run.md`: Austin and Mayo want
overrides); the four data pages are count-bearing; og:url goes through
`publicHref`; hiding a posting from its own pane closes the pane; the layoff
filing's links are underlined at rest.

**Minors left, with the reason:**

- **SEO-003, a remote flag over a stated town (17 Dyson-type posting pages
  marked TELECOMMUTE).** The interim rule (a town plus a remote flag is a
  place) reverses a pinned decision
  (`a-posting-page-states-only-what-the-employer-stated.test.ts`: a remote
  posting with a stated town keeps TELECOMMUTE and its Place). It needs the
  SEO owner's call, and the pages are carried from the live set.
- **Layout shift on some company pages.** The review measured, at 1280 over
  10 s, Domino's 0.36, AllegisGlobalSolutions 0.39, the zero page 10kbi
  0.355 and uncarried pages 0.68 at 375 (most other landers improved). The
  CLS figures quoted earlier in this README (Anduril 0.061, 2020 Companies
  0.076) are not representative of those pages. Reserving the answer line's
  and subtitle's height and mounting rail sections in a fixed order with
  skeletons is layout work across the header and the rail, left for the next
  pass.

**Gate at `02baadf7`:**

| Check | Result |
|---|---|
| `npm run typecheck` | clean (and at pre-commit on every commit) |
| `bash scripts/check-functions.sh` | every edge function typechecks and the Deno tests beside them pass (the shared hiring-record gate changed, which `employer-profiles` imports); `deno.lock` restored |
| Full vitest suite, once, at `9f6f3fce` | 1,032 files: 1,027 passed, 4 failed, 1 skipped; 13,217 tests: 13,186 passed, 8 failed, 23 skipped (811 s, with another workflow's suite pushing the load average to 22). Six of the 8 were 5-second timeouts in two pglite files (`four-company-tables-...`, `a-fill-share-counts-only-roles-the-board-was-watched-for`) that pass re-run alone; two were real (`a-vendor-list-typed-by-hand...`: the bake and Jobs.tsx spelled the dormant source's label; `the-hiring-record-leads-with-one-line`: it pinned the lap board's count), fixed in `02baadf7`, and those files pass. The pre-push gate runs the full suite again on the pushed head |
| Targeted files for each fix | pass (each new test failed on the code before its fix) |
| `node scripts/deploy-ledger.mjs --message` | exit 5, REFUSED off origin/main by design. Its listing shows 12 pending migrations in order (this round's `20261012136000` after `135000`), the hold, `employer-profiles.2026-10-12.2` to deploy, and R1's six MUST BUMP functions with its pending `20261014100000` (step 0) |
| `--against origin/main` | exit 0: 1 function's code differs (`employer-profiles`), 0 violations |
| `--overlap HEAD origin/wave4/integration origin/r1/integration` | exit 0: 27 shared files, all declared (`src/components/HomeHero.tsx` added, owned by company-profiles), no shared function |
| Section 83 against production, 2026-10-18 | every line FAILs by design; C7 found the eleven retired sentences in the served bundle |

**Still open from the integrator's list:** R1's six MUST BUMP functions and
its pending `20261014100000` (step 0); `--message` exits 5 off main by
design; `get_company_financials` still matches on the tenant segment; the
feed-read stamp after a 'dark' or 'error' state; Account.tsx, `/v1` and
agent-runner still print a lap board's 14-day share; the dist size.

## This round's integration (2026-10-17, branch `pd-int`, pushed as `design/integration`)

| Step | Commit | What |
|---|---|---|
| fast-forward | `73aecb4a` | `origin/pd/wire`: pass B on `pd/accuracy` (`da3aa29b`) with `pd/bake` (`0fd722b2`) merged |
| merge | `c3176e7e` | `origin/main` (`5464e502`) |
| ledger | `c65b2629` | every file shared with wave 4 has an owner; sections 62 and 77 re-pointed |
| verifier | `9a484934` | section 83's C4 accepts a canonical to a larger board of the same employer |
| merge fixes | `2c41a5a6` | the four guards main's merge broke; main's sibling item on the design rules; `moreOpenings_many` |

**Conflicts with main, each resolved by ownership:**

- `docs/deploy-ledger.json`, `docs/DEPLOY-LEDGER.md` (wave3 owns the
  policy): main's version, with profiles' `20261012111000` hold re-applied
  and the `company-profiles` reservation naming `design/` and `pd/`. Main
  already carried the reservation at deployOrder 2. The branch's duplicate
  copy of it was dropped (the S12-184 guard fails on a repeated key).
- `public/llms.txt` and two hunks of `scripts/prerender-seo.mjs`
  (company-profiles owns the bake): this branch's. The import list already
  carried main's `postingFreshBudget`. Main's side added "a live Agent Pass
  or the Agent plan" and the apply tools to the MCP lines.
- `src/pages/Jobs.tsx` (seven hunks): this branch's for the legacy lander
  (the design lander replaced it and carries its own S11-020 uncarried
  variant, `landerUncarried` into the model's `carried`). Main's S11-005
  sibling fold (the postings count, "N more openings of this role", "See
  all N openings") merged into the JobCard `siblings` slot by itself. The
  folded `siblings` field moved to `src/lib/board-job.ts`, where the
  `BoardJob` type now lives. S11-037's alert path merged as it was.
- The nine locales, merged key by key with a three-way JSON merge: no key
  changed on both sides. Main's added keys are kept (the URL fetcher, the
  file-damage toasts, S11-005's `hideOpenings`, `moreOpenings` and
  `seeAllOpenings`, S11-037's `searchAlertsOn`, `atsRoles`,
  `productFeatures` and more), except `jobsPage.uncarriedH1`,
  `uncarriedSeoTitle` and `uncarriedBody`, whose only reader was the
  legacy lander. The design lander reads `companyProfile.uncarried.*`.

**Shared with wave 4** (`--overlap` exits 0; every file has an owner in
`sharedFiles`, and no function is shared). company-profiles owns all 24
files (the ledger itself stays wave3's), because it deploys first. Wave 4 takes this branch's version and
re-applies only its own hunks:

- `public/llms.txt`, the nine locales and the hand-off test (owned as wave
  4's own note already said);
- `src/data/guides.ts` and eight tests: seven that pin the retired
  products' copy, and main's S11-121 test, whose llms.txt case now reads
  that a paid key opens the scorer and that no retired product is named
  (`a-pass-paid-for-forms-the-agent-could-only-prepare`,
  `a-company-count-that-names-both-of-its-numbers`,
  `a-pass-number-on-a-page-is-a-placeholder`, `agent-hallmark`,
  `apply-agent-guide`, `pricing-truth`,
  `the-page-says-six-and-the-server-says-eleven`, `which-agent-do-you-use`);
- `src/pages/Pricing.tsx` and `src/components/AtsCoverage.tsx`: classes
  only, from pass A (two in-sentence links to `.link`, the as-of line to
  `text-subtle-foreground`);
- sections 65 and 74: the English-chunk finder keys on `sourceNote`,
  because `agentPitchCta` is gone.
- **Locale values this branch EDITED, which wave 4 must take:** 32 en values,
  the same in every locale: `hero.badge`, `hero.headline.feedbackLive`,
  `hero.headline.feedbackPlain`, `hero.browseJobsLive`,
  `hero.browseJobsPlain`, `freeResults.matches.subtitle`,
  `homeHero.statOpenings`, `accountPage.trackerEmptyCta`,
  `explore.repostWarn`, and `jobsPage.` `seoDescription`, `subtitle`,
  `companySeoTitle`, `companySeoDescription`, `openRolesTip`,
  `landerSeoDescription`, `orientTitle`, `orientTitlePlain`,
  `verdictFresh`, `verdictChurn`, `takedownEmpty`, `welcomeLine`,
  `subtitleShort`, `badgeLive`, `zeroTitle`, `zeroBody`,
  `repostTipTracked`, `verdictChurnFloor`, `verdictSlowFill`,
  `repostTipFloor`, `repostTipRoles`, `repostChipFloor` and
  `activelyHiringUnavailable`. It removed 63 superseded keys (the apply-agent
  pitch among them). None of them is a key wave 4 changed.

**Gate at `2c41a5a6` (and `9a484934` for the full run):**

| Check | Result |
|---|---|
| `npm run typecheck` | clean (and at pre-commit on every commit) |
| `bash scripts/check-functions.sh` | every edge function typechecks and the Deno tests beside them pass; `supabase/functions/deno.lock` restored |
| Full vitest suite, once, at `9a484934`, with no other suite running | 1,021 files passed, 4 failed, 1 skipped; 13,131 tests passed, 7 failed, 23 skipped (353 s). All 7 came from the merge with main: main's S11-020 page test (2), main's S11-121 llms.txt case (1), the raw-palette ratchet on main's sibling markup (1) and the `_many` plural of main's `moreOpenings` (3). Fixed in `2c41a5a6`, and the 7 files (163 tests) pass. The pre-push gate runs the full suite again on the pushed head |
| `node scripts/deploy-ledger.mjs --message` | exit 5, REFUSED, by design: the ledger generates the message only from origin/main (Lovable pulls main). `--draft` prints the 10 migrations, the hold, `employer-profiles.2026-10-12.2` and the publish, plus R1's pending `20261014100000`. On main the run would exit 2 for R1's six MUST BUMP functions (step 0) |
| `node scripts/deploy-ledger.mjs --against origin/main` | exit 0: 1 function's code differs from main (`employer-profiles`), 0 violations |
| `node scripts/deploy-ledger.mjs --overlap HEAD origin/wave4/integration origin/r1/integration` | exit 0: 25 shared files, all declared (24 owned by company-profiles, the ledger by wave3), no shared function; r1/integration is in main (0 files) |

**Bake** (vite build plus the prerender bake of a `git archive` export, with
live read-only data, 2026-10-17):

- **Pages:** 3,388 static pages (each written at `x.html` and `x/index.html`, so 6,775 html files). The company carry: 500 company pages (486 indexable, 9 canonical to a larger board of the same employer, 1 to a larger different employer under the same name, 1 with too few openings, 3 still named by a tenant code: `abercrombie~wd108~anf`, `shm~wd5~Summit_CityMD`, `synnex~wd5~tdsynnexcareers`; 9 names repaired, 0 new pages refused), plus 1,015 once-published company paths this bake did not choose (1,013 stubs, 2 noindex). Postings: 500 live (499 carried, 1 new) at a ceiling of 500, 272 gone, 3 retired, 713 seeded.
- **Sitemap:** 1,369 URLs: 500 posting, 486 company, 383 other (live site the same day: 1,367, i.e. 500, 484, 383).
- **Size:** 126.6 MB in 7,063 files.
- **Retired claims, grepped over every baked html, txt, json and xml file:** the Apply Agent's $99 plan 0; "verified openings" or "verified jobs/roles" 0; "we submit", "submits applications for you" or "applies for you" 0. The $29 pass, the Apply Assistant, the Premium package and "zero ghost" appear only in `/changelog`'s dated history (entries that say what was fixed, e.g. 2026-10-11 "Our headline promised 'Zero Ghost Jobs'"), and the pass once in a `robots.txt` comment naming its receipt path. No page offers any of them. The bake's own check: "no written page outside the employers' posting text sells or describes a retired product".
- **Verifier sections on a local copy served the way the host serves it:** 83 passes 7 of 7 (after the C4 fix), 87 passes 6 of 6, and 62 passes all 13 lines. Against production the same day, 83 fails all 7, and 62 and 77 pass.
- **The name gate's dry run** (D7): 4 pages indexable today that a stricter rule would drop, each kept (see "Owner sign-offs"). A second fresh build and bake, run to write that report (`PRERENDER_NAME_GATE_REPORT`), found the same four rows and wrote 3,389 pages and a sitemap of 1,368 URLs: the live data moved by a page between the two bakes.

## Track 1 accuracy (branch `pd/accuracy`, `da3aa29b`)

Ghost metric Track 1 (A1-A6), under owner decisions GD1-GD9:

- **A1.** The shared hiring-record gate (`src/lib/hiring-record-gate.ts`,
  byte-identical with `supabase/functions/_shared/hiring-record-gate.ts`)
  is a whitelist. The 14-day share, the median and the 30-day share need a
  `full_read` board with a watch floor. `lap_proven` keeps "lap", and
  every other bucket refuses as "unproven read". A share outside its own
  interval refuses as "interval". "Never half" needs a stated 30-day share
  whose lower bound is above one half. The 90-day counts refuse on every
  lap-read board (GD5), on an unproven read, on a reply without the
  multi-site column, and where the re-post test reads other sites.
- **A2.** The came-back caution asks the gate first and is the neutral
  sentence in nine locales. `get_repost_index` (20261012120000) leaves out
  multi-site and non-full-read boards. The Ghost Job Index leaderboard
  ranks only shares the gate passes.
- **A3.** Open-role counts say "dated in the last 30 days", split off
  undated roles and print the board's own total from its newest complete
  read. The zero page says what that read saw. The feed-read stamp shows
  only on full-read boards, and the trust tip says "Re-checked when you
  apply, where the employer's system allows it".
- **A4/A5.** 20261012121000 and 20261012122000 re-issue the company and
  category fill curves (delayed entry, the R(14) interval, the floors, the
  published pool sizes), with pglite tests.
- **A6.** A battery runs on live `get_company_fill_curve` replies recorded
  read-only on 2026-10-12 and refuses every named defect.
- **The four-table lock** (20261012130000), **S12-130** (20261012135000)
  and **S12-091/186/187/188** (perk extractor version 2, the rollup's chunk
  budget, English-only lines, the oldest read date and the text hash), each
  with a test that fails on the code before it. Verify section 81 judges
  the round on named live pages.
- **Not done here:** GD1's listing-age line (it waits for its audit), any
  takedown verdict (GD3, GD4), and `get_company_financials`, which still
  matches on the tenant segment (a hosted site such as DWS on the `db`
  tenant could still show the tenant's SEC card).

## The bake (branch `pd/bake`, `0fd722b2`)

- No baked page, JSON-LD block, guide, `llms.txt` or `llms-full.txt` offers
  the Apply Agent's plan, the pass, the Apply Assistant or the Premium
  package, or says we submit applications. `/agent` is a retirement page.
  `/`, `/agent`, `/agents` and `/pricing` carry the apply-yourself line,
  naming only Claude, ChatGPT and Claude Code. The bake checks its own
  output (`scripts/prerender-retired.mjs`).
- Company titles read "{company} jobs: N open roles from their own hiring
  system", with the count dated in the body.
- SEO-002: a published company or posting URL the bake no longer chooses
  keeps a noindex page of its own (its old page, then a stub, then a
  tombstone under 1 KB), seeded once from the sitemap history. SEO-006
  repairs names first and refuses only new pages (D7). SEO-025: lastmod
  ignores count-only changes. SEO-033: the home-only JSON-LD is dropped off
  home. SEO-036: one member of a duplicate group keeps its index.
  S12-022: the company URLs that served the homepage get their own pages.
- Posting pages never pass the stated ceiling, and the claims sweep no longer
  reads the bake's generated bundle. This closes the design README's old
  decision 5.
- Verify section 83 judges all of it as Googlebot.

## Pass A integration (2026-10-12)

This integration merged three branches onto `profiles/integration`
(`823da0c4`, company profiles phases 0 to 2) on 2026-10-12. Pass A was
**frontend only**: nothing under `supabase/`, `job-board`, `scripts/`,
`public/` or the `index.html` head changed. (The 2026-10-12 to 10-17
round added migrations, the bake and verifier sections: see above.)

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

### Built in pass A, dormant until pass B wired `src/pages/Jobs.tsx` (done: see "Pass B")

Pass B is done on branch `pd/wire` (see "Pass B" below); this section and
the next describe the state at the design branch's own head.

- **G3's lander** (`src/components/jobs/company/CompanyLander.tsx` and its
  regions: header, collision, USAJOBS hub, agency banner, About rail and
  phone accordion, hiring record, pay, hiring mix, public records, empty
  states), decided once by `src/lib/company/lander-model.ts` (variant, one
  open-roles figure with the basis of its date, "read" or "counted", a name
  from data, the sections each variant may show; the "Actively hiring" chip
  only on a standard page with open roles above zero). A figure with no date
  prints no line; pass B passes `listAnsweredAt` so the list's figure is
  dated even when the board's read stamp is missing.
  At this head Jobs.tsx still mounts the legacy lander; pass B replaces it.
- **G2's card, pane and phone sheet** on the board (`JobCard`,
  `PostingDetail`, `PostingSheet`). The board still renders its own.
- **G1's FilterBar and FilterSheet** (one filter row, Filters (n), work mode
  trinary, counts only where measured, a company variant that cannot filter
  the company off its own page and wraps its row; focus stays in the row
  when a chip or "Clear all" is pressed; the hidden submit is no Tab stop).

### Pass B must also (done: see "Pass B")

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

## Pass B (branch `pd/wire`, 2026-10-12 to 2026-10-17)

Built on `pd/accuracy` (Track 1) with `pd/bake` merged in. What is now true
on `src/pages/Jobs.tsx`:

- G3's lander in every variant (standard, collision, USAJOBS hub, agency,
  zero, uncarried), decided by `src/lib/company/lander-model.ts`; G2's
  `JobCard`, `PostingDetail` and `PostingSheet`; G1's `FilterBar` (with its
  `FilterSheet`) as the company page's filter row. The stand-ins are gone
  (`src/lib/company/format.ts` deleted for `src/lib/format.ts`; `parts.tsx`
  keeps only `WhyDisclosure` and `ValueBar` on the shared `Surface` and
  `Chip`; `listingEmployer`'s body is `displayEmployer`; age and pay read
  `format.ts`), the props match `contracts.ts`, `rechecksOnApply` is true
  only where Apply calls `verifyJob` (pane, card, drawer; the posting page
  keeps it off), and the shard guard asserts both shards exist and are read.
- The legacy answer and its `{{roleWord}}` are gone: one open-roles figure
  from the model, "{{n}} roles dated in the last 30 days" through i18next
  plurals in nine locales, printed identically in the answer line, the card
  and the detail link. A company page never auto-opens a posting at desktop
  width (the address, the canonical and the structured data stay what the
  page loaded with). The growth line is labelled as rows served on our own
  daily snapshot. The USAJOBS hub, the collision page and the phone layout
  (header, answer, three cards, then the closed "About this employer"
  accordion) are as the before-audit asked.
- The apply-agent pitch is gone with its keys and guards (wave 4's README
  list); a guard (`pd-wire-no-seeker-copy-on-the-board-says-we-submit-applications`)
  collects every string the board and its components can print and fails
  on "we submit", a retired product or price, or a fourth AI host. The bake
  builder's twelve locale requests are applied in nine locales; 57
  superseded main-locale keys are deleted (no reader outside tests and
  locales; the bake reads none).
- S12-023 (posting pages fit a 375px phone) and S12-184 (no duplicate key
  in `docs/deploy-ledger.json`; the board keeps the S11-020 gate and the
  intel blocks whichever side of a merge wins), each with a test that fails
  on the code before it.
- The feed-read stamp is said only of a board we read in full: the card and
  the pane get a read time only where the shared gate's `feedReadStatable`
  passes, and a lap-read board's pane says "We could read only part of this
  board" (`partialRead`), never that the read covers the whole board
  (`pd-wire-the-feed-read-stamp-is-said-only-of-a-board-we-read-in-full`).
  The Ghost Job Index tile, intro and method term and Hero's inline
  live-count defaults no longer call the openings "verified".
- Verify section 87 (`scripts/verify-deploy.d/87-profiles-design-pass-b.sh`)
  walks the served chunk graph from the entry through the Jobs chunk and
  its imports and judges the lander, card, pane and filter row, the absence
  of the legacy answer and the pitch, and the English chunks' title form.
  On production today every line FAILs, each naming what it found; on this
  branch's build all six PASS.

### Measured (vite build of this branch's tree from a `git archive` export, served by `vite preview`, headless Playwright chromium, live read-only data, 2026-10-17)

| Claim | Result |
|---|---|
| Phone fold budget, 375x812, 27 sample company pages (20 standard incl. Workday, Greenhouse, Oracle and SmartRecruiters boards; `clear` collision; `usajobs` hub; `10kbi` zero; AllegisGlobalSolutions, 1sp-agency) | First card top 392px on 23 standard pages, 434 (NorthwesternMedicine), 472 (USAJOBS hub): all under 520. Header, the answer, then 3 cards, then the closed accordion (`aria-expanded=false`) on every page with roles. The zero page lists no card and says "We have not read this whole board recently." **The collision page is at 594**: its header carries the two boards and their "Show only" buttons where a standard page has one answer line (an owner decision below). The answer wraps to two lines at 375 on every standard page ("{{n}} roles dated in the last 30 days · read N ago"); the budget is met with 128px to spare, so the stamp was left on the line |
| 375px overflow | `document.scrollWidth` 375 on all 27 pages. Before the fix below, AllegisGlobalSolutions scrolled to 385: the end-of-list card offered "Remove Allegis Global Solutions — 1,042,809 openings" on a 394px button |
| Auto-select on a lander at 1280 (anduril, dominos, stripe) | URL, canonical and structured data unchanged after 6s with 60 cards rendered, no pane, the About rail present. Positive control `/jobs`: the top card opens, the URL and canonical change to `?job=`, a JobPosting JSON-LD tag appears |
| Layout shift at 1280, median of 5 runs, 10s each | `/jobs` **0.049** (the design head's after-audit: 0.046; before the country-picker fix below this build measured 0.32 in ten runs); Anduril lander **0.061** (0.154 on the design head: the legacy Hiring Health card is gone; one of five runs measured 0.27, a 0.22 shift at 1.0s not seen in the other nine runs of this page); 2020 Companies lander **0.076** (0.163) |
| axe-core 4.10.2 (WCAG 2.0/2.1/2.2 A+AA) in dark at 1280: `/jobs`, dominos, clear, usajobs, `/companies`, two Paylocity posting pages | **0 violations on every page.** Before the link fix below, clear had one (`link-in-text-block`, serious, the end-of-results sentence's Ghost Job Index link) |
| S12-023: three live posting pages at 375 | `scrollWidth` 375 (the sweep measured 404); the header's Start at x=311; "Apply on {employer}'s site" wraps at 309px, "Check my fit, free" 177px, no control nowrap |
| 320px, fr/pt/tl (and en), dominos and stripe | `scrollWidth` 320, header `scrollWidth` 288, no element past the edge |
| Page errors | none; one 404 on every lander: `rpc/get_employer_perks`, which does not exist until profiles deploys (as the deploy procedure says) |

Four things the measurement found, fixed on this branch, each with a test
that fails on the board before it
(`pd-wire-the-board-holds-the-resume-slot-and-never-offers-its-own-company-as-a-filter`,
`a-link-in-a-sentence-is-underlined-at-rest-on-the-money-path`):

1. The end of a company's own list read the company as a narrowing filter:
   "End of results — 30 openings shown for these filters" with a button to
   remove the company that carried the whole board's count. The page's
   company is never a relaxation (`relaxableFilters`): the end card reads
   the board's end as broad, no count is sent with the company taken off,
   and the relaxation buttons that remain wrap their label.
2. The country picker mounted only once `get_country_facet` or the list
   reply had named a country, ~1.2s in, and wrapped the controls row onto a
   third line: 46px under every filter row and the first card, 0.27 of
   `/jobs`'s 0.32 layout shift, identical in ten runs (found by diffing the
   DOM across the shift window; the résumé strip was the first suspect and
   was not it on `/jobs`). The picker is in the row from first paint with an
   empty list until the facet has answered once; `/jobs` measures 0.049.
3. On a company page the desktop résumé drop strip arrived at ~1.3s, once
   `resolveFitResume` had answered, and moved the list (a 0.017 entry of
   the Anduril lander's 0.092). A résumé dropped this session is now known
   at first paint, and until the rest of the answer arrives the strip holds
   its place invisibly (same box, same height); the lander measures 0.061.
4. Three links inside sentences were marked by colour alone (axe
   `link-in-text-block` on the clear page's "see the live re-check ages",
   plus "Open your tracker" and the skill-unlock call to action); each now
   wears the design system's `.link`.

**Bundle** (`dist/assets`, gzip -9, this head): entry 284.3 kB (the design
head: 279.3), CSS 19.2 kB (18.9), Jobs chunk 106.4 kB (94.6: it now imports
the lander, the card, the pane and the filter row, and sheds the legacy
lander and pitch), JobPosting chunk 4.3 kB (14.7: `PostingDetail` is its own
shared chunk, 25.2 kB, imported by both JobPosting and Jobs), all JS 253
files, 3,110 kB. The bake wrote 3403 static html pages.

**Checks:** `npm run typecheck` clean (pre-commit); every touched test file
(71 files, 1,546 tests) and the new pd-wire files pass under
`--maxWorkers=2`; the pre-push gate runs the full suite.

**Screenshots and raw data:** the session scratchpad's
`keep/design-upgrade/pass-b-audit/` (`shots/` round 1 on the first build,
`shots-final/` on the fixed builds; `measure.round1.json`, `measure.round2.json`,
`measure.json` for the last fold and layout-shift pass).

### Pass B decisions for the owner

1. **The collision page's fold.** At 375 the clear page's first card is at
   594px (budget 520). The 74px are the two board rows with their "Show
   only this board's roles" buttons, which are that page's one navigation.
   Options: accept the collision variant's budget as "boards list, then
   cards"; or shorten the rows (one line per board, the button as a link).
   Nothing was changed.
2. **Sections 62 and 77 after this deploy** (decisions 1 and 2 above,
   confirmed on this build): `jobPostingPage.noPayFound` and
   `listing.actions.checkFit` are in `PostingDetail-*.js` (imported by the
   JobPosting chunk), not in `JobPosting-*.js`; `jobPostingPage.scoreCta` is
   nowhere. Section 62's `noPayFound` line and section 77's `scoreCta` line
   should read the JobPosting chunk's imports, the way section 87 walks the
   graph. Both files belong to main.
3. **`agentHero.sub`** in the main locale still says "a live board of
   verified openings" and "submit where employers allow it"; it is read by
   `src/pages/Agent*.tsx` (wave 4's file), not by the board or the bake.


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

1. **Resolved 2026-10-17: section 77 is re-pointed.** (Kept for the record.)
   **Verify section 77 will fail one line after this deploys.**
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
2. **Resolved 2026-10-17: section 62 is re-pointed** (pass B did move
   `noPayFound` into the shared `PostingDetail` chunk; the line now reads the
   posting chunk and the chunks it imports). (Kept for the record.)
   **Section 62 may fail after pass B.** Lines 56 and 60 want
   `jobPostingPage.noPayFound` and `jobPostingPage.unlistedMeta` in the
   JobPosting chunk. Both are there in this head's build, after the
   More-roles split. Once Jobs.tsx imports the
   listing components, the bundler may move `noPayFound` (now read by
   PostingFacts) into a shared chunk. Re-check after pass B builds.
3. **Card changes from G2 that take effect in pass B:** at most two chips
   (agency, then layoff, then employer record, then the field note, so a
   layoff chip outranks the hiring-record chip); seniority moves from the
   card to the facts; Apply leaves the card for the pane and the sheet.
4. **Resolved by `pd/bake` and `pd/wire`** (the title is "{company} jobs:
   N open roles from their own hiring system"; no hero, orientation, zero
   state or company string says "verified"). (Kept for the record.)
   **Outside this workflow, seen while checking:** the company page title
   is "{company} Jobs — N Verified Openings" (the bake's
   `scripts/prerender-pages.mjs` and `jobsPage.companySeoTitle` in the main
   locale), and the legacy lander and home say "verified" open roles. These
   belong to the SEO group and to pass B's copy. The legacy lander on a
   collision token also still answers "Yes — 34 verified open roles right
   now, straight from Clear's own job board" (seen live on /jobs/company/clear
   in the after-audit, unchanged from 3ebdcbb2): G3's CollisionHeader
   replaces it when pass B mounts the new lander, which is the fix. (Pass B
   did: the clear page now reads "Open roles on boards named “clear”" with
   no employer sentence; measured 2026-10-17.)
5. **Resolved by `pd/bake`** (posting pages never pass the ceiling; the
   claims sweep no longer reads `scripts/.prerender-data.mjs`). Still: build
   only from an export of the tree, never in the worktree. (Kept for the
   record.) **Two gate failures after any local `npm run build` (the bake's,
   not this branch's).** With `dist/` and the bake's generated files present, the
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

1. `bash scripts/verify-deploy.sh`: sections 80, 91, 81, 83, 87, 40, 62
   and 77 pass (step 4 of the deploy procedure). Section 49 shows no gap.
2. The live entry is this build: the JobPosting chunk named by the live
   entry imports the `PostingDetail` chunk, which contains
   `listing.actions.checkFit`, and the entry contains `rb_theme`.
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
8. Perks: no block on any lander until a key is published (step 6 of the
   deploy procedure);
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
    company pages, the posting page, the board's card and pane, the header,
    the theme, and company profiles' phase 0 fixes), each read against
    production, in the next frontend publish.
13. Record the verified deploy in `docs/deploy-ledger.json`
    `verifiedDeploys` (the merged commit, `employer-profiles`
    `2026-10-12.2`, the ten migrations; then the held one once released).
14. The company pages (pass B): on a standard lander the header, the answer
    "{{n}} roles dated in the last 30 days", then three cards, then the
    closed "About this employer" accordion at 375; nothing auto-opens at
    1280 (the address, canonical and JSON-LD stay as loaded); a lap-read
    board's pane says "We could read only part of this board"; a collision
    page has no single-employer sentence; the USAJOBS hub says federal
    openings are listed on USAJOBS.
15. Crawlers: `curl -A Googlebot` `/`, `/pricing`, `/agent`, `/agents`
    and `/llms-full.txt` show no retired product or price, and a
    once-published company URL outside the sitemap (for example
    `/jobs/company/MattelInc`) serves its own noindex page, not the
    homepage.
