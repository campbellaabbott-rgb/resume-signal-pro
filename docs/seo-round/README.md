# The SEO round: every open SEO/GEO item, fixed and checked as Googlebot sees it

Branch `seo/integration`, built on `origin/main` at 8a6561c4 (company profiles, the Ledger design and pass B, deployed by the owner through Lovable on 2026-10-18 as PR #36, plus R1). It merges `seo/bake` (9cb5b453), `seo/react` (ebb0be8d) and `seo/speed` (77607ce3) and the integration work below. No file conflicted in the three merges; two semantic conflicts were resolved by hand (see "Integration fixes"). The round's review (2026-10-24) found six major and twenty minor defects in that integration; the fixer's commits on top (branch `seo-fix`, pushed to `seo/integration`) are listed under "Review fixes".

Sources: the spec `reports/seo-geo-spec-2026-10-12.md` (SEO-001..048), the S12 items routed to profiles/design (`~/.config/resumebooster/platform-debug-2026-10-12-s12/pd-followup.json`), the S13 register (`~/.config/resumebooster/platform-debug-2026-10-12-s13/register.json`), the profiles+design after-audit residuals of 2026-10-18 and the image follow-ups.

Binding owner decisions this round keeps: D7 (no page indexable today loses its index without sign-off; names are repaired, only new pages are refused, would-be drops are listed in `docs/company-profiles/name-gate-dry-run.md`); the headline "live jobs straight from employers' own hiring systems"; never "verified" about jobs and never "zero ghost jobs"; every number names its date basis; seeker pages name only Claude, ChatGPT and Claude Code; JobPosting carries no baseSalary; the Organization carries no legalName, address or contactPoint; IndexNow resubmission is built and dry-run only.

## Last pass before landing (2026-10-25, branch `seo-merge-main`)

The recheck of the merge review found two more majors and one minor. This pass fixes them on `seo-merge-main`, merges main 3cd6fb77 (PR #44, the profiles+design deploy verified, and PR #45, the changelog for 17 to 25 October), and pushes to `seo/integration`. Nothing was merged to main. Each fix has a test that failed first.

- **The country reader misread five countries (SEO-035, major).** `countryTable` in `src/components/jobs/posting-page.ts` builds its names from Intl's region names. Intl names a withdrawn code after the country that holds the current code, and the A-Z walk kept the first code it met. So it read Vietnam as VD, Zimbabwe as RH, Vanuatu as NH, Benin as DY and Burkina Faso as HV. `postingCountryMismatch` then filed "Ho Chi Minh City, Vietnam"/VN and every "Harare, Zimbabwe"/ZW row as another country, and withheld their JobPosting in the bake and in `JobPosting.tsx`. On the live board (job-board list, `x-rb-budget: probe`), the old reader flagged 28 of 60 sampled VN rows and all 8 ZW rows. The fixed reader flags 0 of the same 60 VN rows and 0 of 8 ZW rows. The reader now keeps a code only when `Intl.getCanonicalLocales` files the region under that same code. Its fixed list of withdrawn codes also names DY, HV, NH, RH, UK, VD and CQ, for a runtime that does not canonicalise regions. On Node 25.6.1 (ICU 78.2) the table maps 298 names to exactly 249 codes: the 248 current ISO 3166-1 codes other than UM, plus Kosovo's XK. `seo-bake-posting-markup` gains three cases, and all three fail on the old reader ("Vietnam: expected 'VD' to be 'VN'"):
  - the five countries are not mismatches and get their markup;
  - every name in the table maps to a current ISO 3166-1 code that Intl does not file under another, checked against a fixed 249-code list;
  - with `getCanonicalLocales` stubbed to change nothing, the fixed list alone reads the codes in use.
- **Main's two new changelog loops read their own chunk list (major).** PR #45 added a loop to section 50 (CL_US, for the titles the crawler page no longer lists) and a new section 52. Both built their candidate list from the entry's en-* chunk names. The merge sends both through `scripts/verify-us-english.sh`, so neither can read en-GB, which spells "A calmer design, in one dark colour scheme". `the-verifier-read-the-british-strings-for-the-us-copy` now holds 52 to the same rule, and both sections fail it with main's loops. New cases run both sections on three layouts: the split build, the live publish, and one with only British strings left. On the first two, 50 passes its five past titles from the US changelog shard, and 52 tells a prerender that did not rebuild from no publish at all. On the third, both FAIL. Neither fetches a British chunk on any layout.
- (minor) L9-11's clause splitter also splits at " with ", " versus ", " vs ", a slash and an opening bracket. A bracket that holds only the price stays with the name before it, so "Freelance Boost ($29) takes a guided project intake ..." still prints nothing. "Freelance Boost with six uncapped agent hours costs $29." now prints as INFO. $295 and $29.99 still print nothing.

**Proved on a bake of the merge head** (`git archive` of fd507af1, `vite build` through the machine gate, 262 s). The bake read live data through the read-only fetch guard: 1,123 requests, 0 refused. Company intel was read for 489 of 489 employers.

- 3,632 pages written. The sitemap has 1,370 URLs, 500 of them posting pages. 497 of those 500 carry their JobPosting.
- Three carried pages are kept indexable with markup withheld, each flagged in the ledger: ThePlace1 744000154839819 (country: "Lagos, LA, Nigeria" on a US row), UKG REG1001RWHM (name: "Axia Logo Horizontal") and Bristol Myers Squibb R1607072-1 (country: "New Brunswick - NJ - US" on a CA row). The merge review's bake had four. **Unilever R-1189545 now carries its JobPosting** (addressCountry VN, Ho Chi Minh City) and has no ledger flag. The other VN posting pages in the set, FedEx RC784915-1 and RC787210-1, carry theirs too.
- Built-output suites (CI's file list): 7 files, 89 tests pass. The cap allows max(5, 2% of 500) = 10 withheld pages, and 3 are used. Removing the three flags fails all three pages. Stripping Unilever's markup, now unflagged, fails its page. Both files were restored after the mutation runs.
- Sections 50 and 52, served Lovable-style from this bake (J, R and MC stubbed, every curl write refused, none attempted): 50 gives 12 PASS, 1 INFO and 0 FAIL, and its five past titles PASS from the US changelog shard because this bake's crawler page lists the newest 30. 52 gives 12 PASS.
- Against production: 50 gives 12 PASS. 52 FAILs all twelve titles as "the frontend has not been published since the changelog for 17 to 25 October merged". That is true: production's US changelog shard (en-BgrSJevg.js) carries 50's key and not 52's, and the crawler page lists none of the twelve.
- Section 76 gives 30 PASS and 0 FAIL on this bake, with L9-11 and S2 passing. Against production it gives 29 PASS; the one FAIL is SEO-005 on /jobs/company/dominos, which this round fixes and has not published.
- `node scripts/deploy-ledger.mjs --draft` exits 0. Its one step is migration 20261012111000, released by main, then publish the frontend. `--overlap HEAD origin/r1/hotfix-s13 origin/wave4/integration origin/hp/integration` exits 0, with 31 shared files, all declared, and 0 functions. No other open branch changes section 52.

**Still open, for the owner (D7).** Table 1 of `docs/company-profiles/name-gate-dry-run.md` now lists what this bake keeps: the three posting pages above (ThePlace1, UKG REG1001RWHM, BMS R1607072-1) and three company pages (talent.reyesholdings.com, icfcjb~ocs~CX_1 "Aerospace", eexs~us2~CX_3001 "All"). This pass adds the BMS row and one repaired name (Chubb External printed as Chubb). If the owner refuses a posting row, its page becomes a noindex stub, and the guard's `markupWithheld` exception goes unused for it. Until the owner signs, the guard honours D7 through the ledger flag.

**Still to do after PR #40 merges, documented and not pre-resolved.** This branch merges main once more, for the ledger only. `docs/deploy-ledger.json` conflicts in two places:
- `_sharedFilesNote`: keep R1's 2026-10-24 paragraph, then this round's paragraphs.
- R1's critical-path `sharedFiles` entries above `public/llms.txt`, six of them with the three pglite test files: keep R1's where R1 put them, drop this branch's copies at the end of `sharedFiles` (a JSON object must not repeat a key), and keep `public/llms.txt` as seo-round.

Pre-resolving this would mean merging R1's code into PR #42. The same merge brings main's `signInEmailsHaveASecondSender` changelog entry together with R1's process-email-queue 2026-10-14.2. That entry's last sentence ("One case still waits: ...") becomes false once R1's function serves. Correcting it is R1's closeout step (PR #40), not this branch's.

## Merged main 5a90daa4 (2026-10-25)

`seo-merge-main` (from `seo/integration` 9edd7748) merged `origin/main` 5a90daa4, the profiles+design hotfix (PR #41), and was pushed to `seo/integration`. Nothing was merged to main.

**Textual conflicts, two.** `docs/deploy-ledger.json` keeps both sides: main's hotfix paragraphs and company-profiles entries, and this round's `seo-round` reservation (seo/ branches, verify section 98, deployOrder 2.5) with its 2026-10-24 paragraph; section 76 passes to seo-round, which merges next, and a 2026-10-25 paragraph records the merge. `public/llms.txt` keeps this round's text: main's only change to it since 8a6561c4 removed the committed "485" from the /companies line, which this round's line already did, so no dated figure needed re-deriving.

**The semantic merge.** Fourteen files are changed by both sides (CompanyEmptyState.tsx, CompanyHeader.tsx, Jobs.tsx, the nine company shards and two tests). Git merged them without a conflict, and both behaviours are kept: main's zero branch in `landerSeo` (zeroPageHead, "{X} jobs" and "{X}: no roles are listed on this page right now.") ahead of `companyBoardHead`; the polite live region's `a11yEmpty` (companyProfile.zero.answer on a zero page); `watchCompany(promise)` without the toast's emailing line where the model makes no promise; companyProfile.zero.body only under `model.watchPromise`; `siteDedupedToken` withholding on every Oracle site and every Workday site of the 511 multi-site tenants; the older/fullRead keys gone from every shard. And this round's 160-character heads (`board-heads.ts`), the baked head kept only for an indexable page of its own (`baked-head.ts`), profile links through `companyProfileLink`, the field-line reserve, the rewritten `jobsPage.sourceNote` and `companySeoPossessiveIts`. Two places where the merged sides disagreed were fixed, each with a test that failed on the merge:

- **A zero page kept a baked head that counted roles.** `preferBakedHead` kept "Acme jobs: 40 open roles from their own hiring system" over main's zero head on a company page loaded from its baked file after the board went to zero. Jobs.tsx now keeps a baked head on every variant but zero (`a-company-pages-title-and-heading-match-its-variant`).
- **Section 81j could not read this round's bake.** It counted only main's fact line ("... on this board:"); this round's bake names the scope it read (S13-116: "across Domino's hiring system:", "across USAJOBS:"), so 81j would have FAILed 0 of 24 on a bake that wrote every page's facts. It counts either wording; a line with no scope or no colon counts for nothing.

**Follow-ups, each with a test that failed first.**

- (a) The zero-page title test waited for a title containing "Acme jobs", which the interim employer head also contains (the GitHub CI race in run 40161219561). It now waits for the exact title and the zero description together, within the file's 4-second wait and 30-second test budget (src/test/helpers/mount-budget.ts allows 15 s and 30 s). A new case holds the list reply back; the old wait failed it every time.
- (b) Section 81c reads round 4's Workday arm in the served bundle. The probe marks where each chunk begins; a new line PASSes only when the chunk holding the site rule (the one with its Oracle site pattern) exec's the tenant-capturing Workday pattern and tests the capture against a Set built from a string list holding akumincorp and boeing. The Akumin ADG and Boeing PRIDE watch lines print INFO until it PASSes. On real bundles: the live publish (57815de9, entry index-CVlj-9LZ.js) FAILs with no site rule, a build with round 3's model (474dca30) FAILs with no Workday arm, and this merge's bake (`lander-model-CoB36VZT.js`, 511 tenants) and pd/hotfix's round 4 head PASS.
- (c) Section 76 L9-11's $29 backstop: the lookahead is `(?!\d|[,.]\d)`, so "$295" is no longer read as $29 ($29, $29.00, "$29," and 29 USD still are). A sentence now prints as INFO when one of its clauses, split at a comma or semicolon followed by a space or at " and ", prices something at $29 without naming Freelance Boost; before, any sentence naming Freelance Boost was skipped whole. **What passes with no INFO:** a sentence whose only $29 sits in a clause that names Freelance Boost ("Freelance Boost ($29) takes a guided project intake ...", today's live llms-full) and a sentence with no exact $29. "Freelance Boost, our guided one-time profile rewrite for freelancers, costs $29 and ..." now prints, since its price has a clause of its own; it still PASSes. A paraphrase that names no price is still not shown.

**The merged build, proved.** Baked from a `git archive` export of the merge head (16ef0483; the commits after it change only verify scripts, tests and docs) with `vite build` and live production reads, 3 min 51 s:

- 3,497 pages (1,252 indexable, 2,245 noindex) plus the homepage fallback and llms-full; sitemap 1,240 URLs (488 company, 368 posting, 17 field), every URL written, indexable and self-canonical; `/landers.json` names 500 of 500 chosen boards.
- Duplicate titles: 0 groups among the 1,240 indexable self-canonical pages. The pairs that fail main's built-output job are distinct here: Tapestry JR18327 "Temporary Sales Support Associate — Tapestry" and JR17352 "... — Tapestry JR17352" (the requisition key), and UKG ONEAL's second copy is a stub canonical to its twin ("This posting no longer has a page of its own — ...").
- JSON-LD: 0 parse errors; 366 JobPosting blocks on 368 sitemap posting pages (ThePlace1's country mismatch and REG1001RWHM's refused name keep their pages with the markup withheld, D7), 0 baseSalary, 0 TELECOMMUTE; the bake's retired-claim, source-sentence and job-markup checks clean; 1 title took a requisition key.
- Company intel read for 24 of 490 employers: production still runs 20261012135000's reader (Workday tokens answer 500 57014 after 15 s) until the owner applies 20261012137000.
- Section 98, served the way Lovable serves it (SITE the production origin, every request answered by a local static server shaped like Lovable's host): 45 of 45 PASS (98-seo-round 32, 98-seo-speed 13).
- Section 81 against the same bake (live database reads): every 81c served-bundle line PASSes, the zero head keys, the watch gate and the new Workday arm line included, and the BASS ABA, Delaney, Akumin and Boeing lines PASS. The FAILs are database-side only: 81i (the 137000 reader), 81j 0 of 24 (the same timeout; its dominos control counts 2 fact lines in this round's wording) and 81c Stripe (FAIL by decision).
- The built-output guards on that dist (`RB_REQUIRE_DIST=1`, the CI job's file list): `sitemap-prerender-parity` and `the-sitemap-never-advertises-a-posting-url-with-no-page` pass (33 tests); 82 of 83 pass in all. The one failure is the one `seo/integration` already had in GitHub CI (run 40159605066): `a-posting-is-addressable-as-its-own-page` wants JobPosting markup on every sitemap posting page, and the two D7 pages above carry none. Not changed here: it needs a decision between the guard and D7 (a ledger flag for withheld markup that the guard reads, or noindexing those two pages).

**Renders on the merged bake** (Chromium, 1280 px, the local server; the job-board list with `x-rb-budget: probe` and the four company readers the verifier already reads as GET RPCs; every other request answered 503, so nothing was written):

| Page | Title | Description | Live region | Watch promise |
| --- | --- | --- | --- | --- |
| Delaney at the Green `eexs~us2~CX_19005` (Oracle sub-site, feed states 3) | Roles on the “eexs~us2~CX_19005” board | No roles are listed on this page right now. | No roles are listed on this page right now. | not printed |
| Boeing PRIDE `boeing~wd1~PRIDE` (Workday, 5-site tenant, no stated total) | Roles on the “boeing~wd1~PRIDE” board | same | same | not printed |
| BASS ABA `bassabatherapy` (Greenhouse, read in full, no stated total) | Roles on the “bassabatherapy” board | same | same | printed |
| Akumin ADG `akumincorp~wd5~adgcareers` (Workday, 2-site tenant, stated 5 at a read in state empty) | Roles on the “akumincorp~wd5~adgcareers” board | same | same | not printed |
| Exact Sciences `exactsciences~wd1~Exact_Sciences` (single-site Workday tenant, read in full, no stated total) | Roles on the “exactsciences~wd1~Exact_Sciences” board | same | same | printed |
| Domino's (baked, indexable) | Domino's jobs: 29,163 open roles from their own hiring system (the baked head) | 29,163 open roles at Domino's, read from Domino's own hiring system. ... | 60 openings shown. | n/a |
| CVS Health `cvshealth~wd1~CVS_Health_Careers` (baked, indexable) | CVS Health jobs: 12,710 open roles from their own hiring system (the baked head) | 12,710 open roles at CVS Health, ... | 210 openings shown. | n/a |
| Stripe (baked file is a noindex stub) | Stripe jobs: 217 open roles from their own hiring system (React's head over the stub's) | 217 open roles at Stripe, ... | 63 openings shown. | n/a |

Each page carried one title. The five zero pages name no employer because a first visit to a board with no listed row has no name to print; a page that knows the name prints "{X} jobs" (the tests cover it). Every zero page offers Watch.

**Gate.** Typecheck through the machine gate before the push; the full suite ran once in the pre-push hook (`git push origin seo-merge-main:seo/integration`, through `~/.config/resumebooster/heavy.sh`). The targeted runs before it: every pd-hotfix-* and seo-* file, the zero-page corpus tests, the screen-reader test and the two company-page tests, `--maxWorkers=1`.

## Merge review fixes (2026-10-25, branch `seo-merge-main`)

The review of the merge found three major defects and three minor ones. Each is fixed on `seo-merge-main` (pushed to `seo/integration`) with a test that failed first. Nothing was merged to main.

- **Section 76 S2 failed a correct page.** Its pattern wanted the date right after "still live at the source (", and SEO-009 writes "(n = 117, 95% interval 96.8–100%, 2026-10-25)". S2 now accepts that wording and the date alone (production's wording until this publish), and the n must equal the decided count the sentence names. A test cuts S2's pattern and 76's own text reader out of the section and runs them on what the builder writes (`the-ghost-job-index-never-printed-its-daily-re-check`).
- **Sections 50, 62, 65, 72 and 74 read the British strings.** Each took the first `./en-*.js` chunk holding its key. After SEO-040 moved en.json out of the entry, that chunk was the en-GB locale file, so 72's "Re-analyze to scan again" FAILed a correct page and the other English lines PASSed on British copy. 62, 65 and 74 never tried the entry, so they read en-GB on the live publish already. Each section now takes its candidates from `scripts/verify-us-english.sh`: the `rb-en_all` chunk the entry names (the whole of en.json), then the entry, then the US en-* shards, and never an en-GB chunk. When no US chunk holds a section's key, the section FAILs. `the-verifier-read-the-british-strings-for-the-us-copy` runs all five sections on three layouts: a real build of 29eecfa1, the live publish, and one where the US strings left every chunk the entry names.
- **The posting-page guard failed the pages D7 keeps.** The bake now writes `markupWithheld` ("name" or "country") on the posting ledger entry of each carried page it writes without JobPosting. `a-posting-is-addressable-as-its-own-page` accepts a page with no job markup only when its entry says so, the page was carried, it serves no JobPosting at all, and, for a refused name, it prints "The employer". At most 2% of posting pages (at least 5) may be kept this way. The per-page rule is a pure function with unit cases, so it is tested on every run, not only in the built-output job. **This keeps D7 as the round decided it, and the owner's sign-off on table 1 of `docs/company-profiles/name-gate-dry-run.md` still decides it:** if the owner refuses, those pages become noindex stubs and the flag goes unused.
- (minor) L9-11's clause splitter also splits at " or " and " plus ". "Freelance Boost or a six-hour unlimited agent window costs $29." now prints as INFO. Live llms-full's " — or a pasted platform profile — " sentence still prints nothing.
- (minor) On a page for a board we do not read, the polite live region now says the page's heading ("We don't read a board called “anduril” yet"), not "No openings match these filters.".
- (minor) The PD fix3/fix4 hand-off is taken. Off the zero page, `watchPromise` is now `!siteDedupedToken(token)`, so the watch toast makes no "We'll email you when they post new roles" promise on any page of an Oracle site or of a Workday site whose tenant has another catalogued site. The zero page's rule is unchanged.

**Proved on a bake of this branch** (`git archive` of 6b61831b with `vite build`, 19 min 23 s on a loaded machine). The bake made live reads through a read-only fetch guard: RPCs were sent as GETs, the job-board API only with `x-rb-budget: probe`, and the guard refused 0 requests. Results:

- 3,584 pages; sitemap 1,323 URLs. 453 live posting pages (369 carried, 84 new). Four carried pages are kept indexable with markup withheld and say so in the ledger: ThePlace1 744000154839819 (country), UKG REG1001RWHM (name), Unilever R-1189545 and Bristol Myers Squibb R1607072-1 (country). The last two are country mismatches in today's data, and the name-gate dry run lists all four.
- Built-output suites (CI's file list, `RB_REQUIRE_DIST=1`): 7 files, 89 tests pass. The previous guard, run on the same dist, fails on exactly those four pages.
- Sections 50, 62, 65, 72, 74 and 76, run on that dist the way Lovable serves it (J, R and MC stubbed, every curl write refused): 189 PASS and 2 FAIL. Both FAILs come from the harness: 50's stub check needs a git checkout, and 74's withdraw-subscription POST was refused on purpose. The pre-fix 72 and 76 on the same dist FAIL "Re-analyze to scan again" and S2. Against production the same sections give 188 PASS; the one extra FAIL is SEO-005, which this round fixes.
- Renders on the bake (Chromium, signed in with a local session, the watch insert answered locally): /jobs/company/anduril's live region reads its heading. The Domino's watch toast keeps its promise. eexs~us2~CX_3001 (Oracle, 591 roles) and strayer~wd1~SEI (multi-site Workday, 23 roles) say only "Watching All" and "Watching Strayer".

**Merging.** Both branches merge onto main 5a90daa4 without a conflict, R1 (`r1/hotfix-s13`) and this one. After PR #40 merges, this branch's `docs/deploy-ledger.json` conflicts with main in the two places `origin/seo/integration` already did. The first is the shared-files note: keep R1's 2026-10-24 paragraph, then this round's. The second is the critical-path entries R1 adds above `public/llms.txt`. There are six with the fixer pass's three pglite test files: keep R1's, drop this branch's copies at the end of sharedFiles (an object must not repeat a key), and keep `public/llms.txt` as seo-round.

**Test budgets.** Two pglite files ran past vitest's 5-second default on a loaded machine, failed PR #40's CI and blocked a push: `a-fill-share-counts-only-roles-the-board-was-watched-for` and `a-headcount-says-the-day-it-was-true`. Both now have the repository's pglite budget, and the identical commit is on `r1/hotfix-s13`. Two render races also fail CI at random: `a-buy-button-named-no-terms-no-renewal-and-sent-no-referral` clicks Go Pro while the button is still disabled for the subscription check, and `the-result-screen-still-sold-a-premium-package-under-an-auto-rejected-banner` pays the lazy report chunk's compile inside its 15-second wait. wave4/integration owns the second and already fixes it (`clickWhenEnabled` and an early import of the report chunk), so neither is changed here. On GitHub they show up as a red `test` job whose failures are those cases only.

## Deploy procedure

1. Merge only after the profiles+design deploy of 2026-10-18 is verified (sections 81, 83, 87, 91 of `scripts/verify-deploy.sh`), and before wave 4 (the ledger now reserves `seo-round` at deployOrder 2.5, between company profiles and wave 4).
2. This round changes no function and no migration: the Lovable step is "publish the frontend". Regenerate the message at the merge commit on main with `node scripts/deploy-ledger.mjs --message`. At the branch head after the last pass (fd507af1, on main 3cd6fb77) the draft exits 0. Its steps are main's: apply 20261012111000, then publish the frontend. The earlier exit 2 (`employer-profiles` MUST BUMP) is gone: the draft now reads employer-profiles as already answering employer-profiles.2026-10-12.2.
   `pd/hotfix` (PR #41) merged to main as 5a90daa4 and this branch has merged it (below), so the 14 files both changed are resolved here and keep company-profiles as their owner. `node scripts/deploy-ledger.mjs --overlap origin/seo/integration origin/r1/hotfix-s13 origin/wave4/integration origin/hp/integration` exits 0 (31 shared files after the last pass, all declared, 0 functions; sections 65 and 74 pass to seo-round).
3. After the publish, run `bash scripts/verify-deploy.sh` and read section 98, which is this round's (two files): `scripts/verify-deploy.d/98-seo-round.sh` (32 lines) and `scripts/verify-deploy.d/98-seo-speed.sh` (13 lines). Against this branch's own bake served the way Lovable serves it (SITE set to the production origin, every request answered by a local Lovable-shaped server), all 45 PASS (2026-10-25). Against production today most of them FAIL, by design: they read the defects this round fixes. After the publish, also run `node scripts/seo-lab-font-check.mjs https://resumebooster.work` (one headless browser): every repeat load must paint the h1 in Inter.
4. The owner's changelog rule applies after the verified deploy (entries in 9 locales, shipped in the next frontend publish).
5. Then, with the owner's go-ahead only, the IndexNow resubmission (below).

The Workday company-intel timeout (get_company_intel, migration 20261012135000) is a database bug fixed on `pd/hotfix`; this branch does not touch it. Until it ships, a bake reads intel for few employers (22 of 489 in this round's bake) and every employer page is still written, stating no places or fields.

## Integration fixes (this branch, on top of the three builders)

- **A company page whose intel read timed out is still baked.** Lovable's 2026-10-18 commit put a 90-second deadline and an 18-failure stop on the get_company_intel phase. Both are kept exactly, now run through `readCompanyIntel` in `scripts/prerender-pages.mjs`, and `src/test/seo-integration-a-skipped-intel-read-still-bakes-the-page.test.ts` runs the deadline path and bakes the page with no intel. The offline bake in `seo-bake-crawler-output.test.ts` reads intel for nobody and checks every page `/landers.json` names is written with its own title and canonical.
- **The /jobs/company/anduril report.** That address was never published: Anduril's token is `andurilindustries`, which serves its own page ("Anduril Industries jobs: 801 open roles from their own hiring system", Googlebot, 2026-10-24 23:12Z). `/jobs/company/anduril` is an unknown token, so the static host serves the homepage shell; the app renders the uncarried page over it with noindex and "Did you mean" (S12-129). A static host cannot serve a stub for every unknown path; that optional item is not done further.
- **Live sample, 2026-10-24.** 20 company pages from the live sitemap as Googlebot at 17:46 EDT and 20 more at 23:12Z: 0 of 40 serve the homepage title. 20 once-published, off-sitemap company paths: 0 of 20 (each serves its own noindex stub).
- **No two posting pages share a title.** `postingPageTitleAvoiding` (posting-page.ts): a page that would repeat a title the bake already wrote takes its requisition key. In this round's live bake one title needed it; 372 sitemap posting pages carry 372 titles. The React posting page keeps the baked title of a live posting (`preferBakedHead`).
- **React keeps a baked head only for an indexable page of its own** (`baked-head.ts` `indexable`, `SEO.tsx`): a stub or a duplicate pointing at its twin no longer titles the live page rendered over it.
- **The React company head builds its description to 160 characters the way the bake does** (`board-heads.ts`): the merged builders disagreed for long names (seo/bake's OBS-2 snippet budget against seo/react's single sentence); `seo-react-one-head-per-address` failed on the merge and passes now, in all nine languages.
- **One re-check sentence.** The bake's clause now states the board's rule: "asks the employer's system again when you open a posting whose feed it last read more than 6 hours ago, where that system allows it" (`RECHECK_AFTER_HOURS` held equal to React's `VERIFY_ON_VIEW_AFTER_HOURS`). React's own banned list refused the bake's old wording.
- **The board's sources note** (`jobsPage.sourceNote`, on /jobs and every company and field page after hydration, 9 locales) no longer says "official public job-board APIs" or that a taken-down posting "disappears on the next pass".
- **/pay-transparency in the app** says "Most transparent large job boards", one row per board, and names the population its table holds (S13-049, S13-088, React half).
- **/data-api** builds its API address with the bake's `publicApiBase` (SEO-015 React half).
- **Fonts: font-display optional.** Measured on this branch's build (lab, local Lovable-shaped server, board reads live with `x-rb-budget: probe`, everything else 503; phone = 4x CPU, 150 ms, 1.6 Mbps; median of 3): with swap, Domino's company page CLS 0.155 on a phone (0.136 of it the late swap to Inter re-wrapping the prerendered text) and /jobs 0.146 on desktop. With optional: Domino's 0.018 phone / 0.012 desktop, /jobs 0.021 / 0.066, /jobs/field/engineering 0.002 / 0.030. All under 0.1. **Corrected by the review:** the integration said a late face "is used from the next page load on"; with the font CSS applied by a media swap after the first paint that was false, and Inter rendered on no load at all. The faces are now declared in the head itself (see "Review fixes").
- **/about left the parity test's fallback list** in the same merge, as the test asked.
- **Stub titles** collapse an employer's double space ("Quality  (QA) Technician").
- **Section 98 P1** compares validThrough with the date the employer states, which the page prints; datePosted is that date clamped to the bake's day, so a stated "tomorrow" read one day short and failed a correct page.

## Review fixes (branch `seo-fix`, 2026-10-24/25)

The round's review read this integration's bake, its lab numbers and its React pages, and confirmed six major defects and twenty minor ones. Each fix below has a test that failed before it; the bake, section 98 and the lab were re-run on a `git archive` export of the fixer's head (847e430f, live reads, 2026-10-25).

Major:

- **SEO-003, the junk localities.** `USA-REMOTE` shipped `addressLocality: "USA-"` (a US remote job as a town called "USA-"), and `Movie Park Germany, Warner Allee 1, 46244 Bottrop-Kirchhellen, Germany` shipped "Movie Park Germany". posting-page.ts trims punctuation from each word and segment before reading it (`USA-REMOTE` is now remote in the US naming no place), refuses a locality carrying a country's whole name as a word ("Panama City", "Mexico City", "West Jordan" stay), and takes the town from a "<postal code> <town>" segment (Bottrop-Kirchhellen, 46244). One rule, `localityProblem`, is read by the producer, the bake's markup guard and (independently, with the runtime's country names) section 98 P1. Bake: 0 junk localities in 370 JobPosting blocks.
- **/companies, the blanket source claim.** Its title counted USAJOBS among "companies ... from their own hiring systems" and its body said "Every posting comes from the company's own hiring system" over a list holding USAJOBS and a staffing agency. The count is employers only ("486 Companies Hiring Now", 488 rows), USAJOBS and agency rows are labelled "(the federal listing site)" / "(a staffing agency)", the body states the board's source sentence, both blanket sentences are banned on every page the bake writes, and section 98 G3 reads /companies. React's /companies head says the same in nine languages.
- **The homepage's chunks on every fallback address.** dist/index.html is also what Lovable serves for /auth, /account and every unbaked path, and it preloaded the homepage's twelve route chunks (about 103 KB gzip). Its static head now names Footer only, and an inline script adds the homepage's chunks on "/" alone (`fallbackPreloadHtml`). Section 98 P3 reads /, /auth and an unknown path.
- **Inter never rendered.** The faces are now declared inline in the head (13 `@font-face` rules: Inter 400-700 in seven subsets, JetBrains Mono 400 in six, font-display optional, the woff2 files Google's own CSS names) and the Inter latin file is preloaded; no font stylesheet is requested. Lab (`scripts/seo-lab-font-check.mjs`, local server): every repeat load paints the h1 in Inter (/, /jobs, Domino's, /pricing, a posting page); first loads paint Inter or the fallback, never a swap. Self-hosting the files stays the owner's item below.
- **Profile links opened the generic board.** "Full Snowflake hiring profile" and "+N more on the employer page" pointed at /jobs?company= for the ~31,300 boards with no written page. A link that promises the profile (that one, the layoff line, the employer's name on a card, a posting header and the posting page, and similar employers) now opens the written page when /landers.json names one and the profile address with `rel="nofollow"` otherwise (`companyProfileLink`), never /jobs?company=.
- **The field-line reserve collapsed.** /jobs/field/education measured CLS 0.112 when the reserve came off for a field that cannot state a rate. The slot keeps its height whatever the read returns. Lab, phone: education 0.002, engineering 0.002, Domino's 0.018, /jobs 0.007.

Minor:

- **D7 at the ceiling.** The 24 boards that rotated out at the 500-board cut keep their place: a board indexable today stays while its open roles are at least half the cut's, displacing the lowest-ranked new boards (never another of today's, never a board of an employer that has one), and a page indexable today stays its employer's canonical page when a sibling grows past it (PwC's crm board). Against the live sitemap: 485 company pages indexable today, all 485 indexable in the bake, 3 new. `docs/company-profiles/name-gate-dry-run.md` section 4 has the lists.
- **One re-check rule.** React's posting note adds "where that system allows it" in nine languages, and llms.txt states the bake's rule (opening a posting whose feed was read more than 6 hours ago) instead of "re-checked when you apply". The board's own Apply also re-checks (verifyJob); the subtitle and badge saying so stay.
- **TELECOMMUTE only on a vendor flag** (SEO-003's own guard). A place-free remote label ("Remote - US", "China - Remote") is marked up as its country. The board carries no vendor flag yet, so no page says TELECOMMUTE until wave 4's `work_mode_source` ships; the bake guard and P1 fail on any TELECOMMUTE without it.
- **validThrough from the clamped day.** Counted from the day datePosted states, so no markup spans 31 days; P1 now compares the markup's own two dates.
- **CJK descriptions** are read by script (zh, ja, ko) for `<html lang>` and og:locale. JobPosting `inLanguage` is not added: schema.org defines it on CreativeWork, and JobPosting is not one.
- **A logo-text name kept under D7** (Axia Logo Horizontal) keeps its page and index, not its name: no JobPosting, "the employer" in its head and own sentences. React's posting body still prints the stored name (residual below).
- **The MCP SoftwareApplication** carries `offers` (price 0). No rating is claimed, so Search Console may still warn on it, as on / and /builder.
- **SEO-037's copy** says "another board under the same name, which we cannot tie to this one, has a page of its own".
- **Certification names** in the industry FAQ (visible and FAQPage) print as names ("Certified Administrative Professional, CAP Certification"), and "an administrative resume".
- **Workday's stray "undefined" line** is dropped from the baked page, the markup's description and the React posting page (the data fix is a wave-4 hand-off).
- **/dev/checkout-test**: robots.txt no longer disallows /dev/, and the bake writes a noindex page there.
- **/about's description** says "What resumebooster.work is" (no operator is named until SEO-045), in the bake, nine locales and both llms files.
- **A non-English reader** gets React's localized head over a baked page; the baked English head is kept for English readers (crawlers included).
- **The free-scan card** maps the stream scanner's slugs (software_engineering, human_resources, nursing, ...) to board fields again (`SCAN_INDUSTRY_TO_CATEGORY`).
- **/v1 and its paths** render the API's address in React (a page, noindex) instead of NotFound.
- **Section 98** checks /landers.json (C4), /favicon.ico's type, the touch icon's 30 KB bound, the inline faces, and finds PwC's page through /landers.json (its primary moves with the counts).

Not changed, with the reason:

- **Releasing the baked page on a route-ready marker** (SEO-021 follow-up). Holding the baked nodes past React's first commit needs React's tree hidden until then, or its skeleton sits above the baked page and moves it; hiding it breaks components that measure on mount. Not a regression (#root still never empties on most pages); it needs its own change with a lab check.
- **CLS on the data pages** (/entry-level-index 0.455/0.412, /hiring-trends 0.277, /ghost-job-index desktop 0.336, /pay-transparency desktop 0.232, /research/ats-score-benchmarks 0.257): the same on main; reserving the figure grids' heights while the data loads is a follow-up.
- **The homepage's desktop LCP** (React's larger H1 replaces the baked one): handed to the homepage redesign below.

## Every item

Fixed = in this branch, with the evidence named. Owner = only the owner can act. Wave 4 = the data change lives in `supabase/functions/job-board` or migrations, which wave 4 owns; the bake and markup side is fixed here and the exact change is in "Hand-offs".

| Item | Status | Evidence |
| --- | --- | --- |
| SEO-001 retired agent offers in the bake | Fixed (pd/bake, on main) | Bake self-check "no written page ... sells or describes a retired product"; audit: 0 retired claims outside /changelog, whose entries describe the removals |
| SEO-002 once-published URLs | Fixed (pd/bake, on main) | Bake: 1,018 carried company paths (26 noindex pages, 992 stubs); live: 0 of 20 off-sitemap paths serve the homepage title |
| SEO-003 TELECOMMUTE on in-store jobs | Fixed (seo/bake, review fixes); job-board half to wave 4 | TELECOMMUTE only on a vendor flag (none yet: 0 in the bake); 0 junk localities; P1 |
| SEO-004 validThrough past the employer's end date | Bake rule fixed (seo/bake); data to wave 4 | validThrough = min(posted+30, missing_since, employer end date); Workday endDate not stored yet |
| SEO-005 company openings linking /jobs?job= | Fixed (seo/bake) | 0 `?job=` links on company pages; section 98 C1 |
| SEO-006 employer names | Fixed (pd/bake, repair-first; review fixes) | Dry run regenerated from the fixer's bake: 5 rows in table 1, 9 repairs, 0 new pages refused; a carried logo-text posting prints no name |
| SEO-007 React overwrote baked heads | Fixed (seo/react + integration) | One head per address; baked head kept only on indexable pages; React description budget. Residual below |
| SEO-008 unsupported claims | Fixed (pd/bake, seo/bake, seo/react) | Bake source-sentence check clean; audit: 0 banned phrases in pages and llms files |
| SEO-009 daily re-check figure | Bake fixed (seo/bake); sample allocation to wave 4 | n, 95% interval and the sampling caveat printed on /ghost-job-index and in llms.txt |
| SEO-010 links to pages never written | Fixed (seo/react, integration, review fixes) | `/landers.json`: 500 of 500 chosen boards name a page; profile links to an unwritten page carry rel=nofollow; section 98 C4 |
| SEO-011 Organization, @id graph, /about | Fixed (seo/bake, seo/react); legal identity is owner | Section 98 G1: #org on every sampled page, WebSite published by it, MCP SoftwareApplication on /agents, /about in the sitemap |
| SEO-012 IndexNow resubmission | Tool and dry run built; sending is owner, after the deploy | Dry run below; nothing was sent |
| SEO-013 Bing Webmaster | Owner | - |
| SEO-014 MCP address in llms files | Fixed (seo/bake) | Section 98 G2 |
| SEO-015 API host, /v1 pages | Fixed (seo/bake, integration) | Section 98 G2: /v1 and /v1/jobs noindex pages naming the API host |
| SEO-016 JobPosting completeness | Fixed (seo/bake); vendor employment types to wave 4 | 0 baseSalary in 371 JobPosting blocks |
| SEO-017 fresh reserve | Fixed (seo/bake) | Log: fresh budget 122 (carried live 278, ceiling 500) |
| SEO-018 field pages | Fixed (seo/bake, integration) | All 16 siblings linked, employers, newest postings, dated shares; the "next pass" sentence is gone from the bake and from React's sources note. Per-field remote share and top places: no data, not printed |
| SEO-019 keyword pages | Fixed (seo/react + integration) | /industries/hr is "HR Resume Keywords"; no WIND/SPAY/SOPS chips; keyword-page descriptions unique (crawler-output test) |
| SEO-020 render-blocking fonts | Fixed (seo/speed, review fixes); self-hosting is owner | No @import, no font stylesheet; faces inline with display optional, Inter latin preloaded; repeat loads paint Inter (lab). Self-hosting needs the OFL woff2 files downloaded, which needs the owner's go-ahead |
| SEO-021 blank screen on boot | Fixed (seo/speed) | The prerendered page stays until React's first commit |
| SEO-022 CLS on /jobs | Fixed (seo/react, integration, review fixes) | Lab, phone: /jobs 0.007, Domino's 0.018, field pages 0.002 (education included) |
| SEO-023 preload hints | Fixed (seo/bake, review fixes) | Section 98 P3: posting pages preload JobPosting, not Jobs; /pricing its chunk; / adds Index from a "/"-only script; /auth and unknown paths preload Footer only |
| SEO-024 image weights | Fixed (main #35, seo/speed) | Section 98 I1: og-image 1200x630 122.3 KB, favicon.png 96x96 2.7 KB, apple-touch-icon 180x180 7.0 KB, favicon.ico 5.4 KB |
| SEO-025 lastmod on count changes | Fixed (pd/bake, on main) | Sitemap: 6 distinct lastmod dates over 1,241 URLs |
| SEO-026 dated board figures | Fixed (seo/bake); homepage body clause to the homepage redesign | "(as of 2026-10-18)" in llms.txt and every board page |
| SEO-027 llms lists | Fixed (seo/bake) | Section 98 G3: all 52 llms.txt URLs in the sitemap |
| SEO-028 Dataset markup | Fixed (seo/bake); license is owner | Section 98 G4 |
| SEO-029 legal text for crawlers | Fixed (seo/bake) | Section 98 G4: /terms 10,218 and /privacy 10,931 characters, refund section present |
| SEO-030 og:url on dotted pages | Fixed (earlier round, verified) | composeHtml builds og:url and twitter:url through publicHref |
| SEO-031 duplicate JSON-LD after hydration | Fixed (seo/react + integration) | No HowTo on /methodology; React renders no JSON-LD on baked routes |
| SEO-032 CV-standards FAQ | Fixed (seo/react + integration) | Both questions visible on both renderers from one array (`cvStandardsFaqs`) |
| SEO-033 home-only JSON-LD on fallback URLs | Fixed (pd/bake, on main) | - |
| SEO-034 international signals | Fixed (seo/bake, review fixes) | Section 98 G4: /fr/normes-cv/france og:locale fr_FR, content-language fr; CJK descriptions read (zh 1 page in the bake). JobPosting inLanguage deliberately not added (not a JobPosting property) |
| SEO-035 Nigerian job as Louisiana | Bake fixed (seo/bake, last pass: Vietnam, Zimbabwe, Vanuatu, Benin and Burkina Faso read as their current codes); row repair to wave 4 | Markup withheld on 2 carried pages for their country (ThePlace1, BMS R1607072-1), both on the dry run; Unilever R-1189545 carries its markup again |
| SEO-036 duplicate groups | Fixed (pd/bake, on main) | Bake: kept 2 of 2 groups |
| SEO-037 name-sharing boards | Fixed (seo/bake) | Section 98 C2: UR_Staff self-canonical and noindex |
| SEO-038 posting ceiling guard | Fixed (pd/bake, on main) | - |
| SEO-039 duplicate stub canonical | Fixed (seo/bake) | Duplicate stubs canonical to their twin |
| SEO-040 entry size | Fixed (seo/speed) | Entry 205 KB gzip (was 293 KB); the bake still reads the whole main locale |
| SEO-041 homepage below-fold chunks | Homepage redesign | Index.tsx belongs to the homepage+pricing redesign; hand-off below |
| SEO-042 install repo README | Fixed (earlier) | README names the registry listing (checked 2026-10-24) |
| SEO-043 install repo homepage, topics | Fixed (owner, earlier) | Homepage https://resumebooster.work/agents; topics include mcp, mcp-server, job-search, jobs-api |
| SEO-044 data license | Owner | DATA_LICENSE stays empty |
| SEO-045 seller identity, contact | Owner | Organization and /about name no legal name, address or contact point |
| SEO-046 www 302 to 301 | Owner (Lovable domain setting) | - |
| SEO-047 brotli, 304, cache headers | Owner (Lovable support) | - |
| SEO-048 Search Console Core Web Vitals | Owner | Lab figures above are no substitute |
| S12-021 one employer's boards pooled | Fixed (seo/bake; React labels the pooled mix) | Section 98 C2: "PwC jobs: 2,997 open roles across 3 hiring-system boards" |
| S12-129 uncarried slug of a carried employer | Fixed (seo/react) | "Did you mean" boards on /jobs/company/intel |
| S12-131 lander links to /jobs?job= | Fixed (seo/bake) | As SEO-005 |
| S12-133 /affiliates percentage | Fixed (seo/bake) | Section 98 G4: "Earn $5 per Referred Tool Sale" |
| S12-135 en-GB brand name | Fixed (seo/react) | - |
| S13-047 tombstone for a carried employer | Fixed (seo/bake) | Section 98 C3 |
| S13-049 pay table per token | Labels fixed (bake, integration); per-employer SQL to wave 4 | - |
| S13-050 benchmark mixes fallback scores | Wave 4 (free-keyword-scan-stream) | Crawler page reads the data as stored |
| S13-087 "completed scans" | Research page fixed (seo/bake); homepage body to the redesign; count SQL to wave 4 | - |
| S13-088 pay page population | Fixed (bake, integration) | - |
| S13-089 letter case | Fixed (seo/react + integration) | - |
| S13-090 entry-level heading | Fixed (seo/react) | - |
| S13-105 "POST /v1/fit (paid)" | Wave 4 | True on production until wave 4 makes fit free; wave 4's llms.txt rewrites the line |
| S13-116 tenant-wide hiring mix | Wording fixed (bake, React); per-token SQL to wave 4 | Company pages say "across X's hiring system" |
| S13-117 collided token head | Fixed (seo/bake) | - |
| S13-120 USAJOBS in similar companies | React filter fixed (seo/react); SQL to wave 4 | - |
| S13-127 Resume Builder SEO title in English | Wave 4 (w4b/generators owns ResumeBuilder.tsx) | - |
| S13-131 /dev/checkout-test indexable | Fixed (seo/react noindex, integration robots) | robots.txt disallows /dev/ in all 16 groups |
| S13-132 industry-to-field slugs | Fixed (seo/react) | /industries/hr links /jobs/field/people_hr |
| S13-133 legal text | Fixed (seo/bake) | As SEO-029 |
| After-audit (1) withheld clause repeated | Fixed (seo/react) | "we hold a closure record for this employer: {{why}}" |
| After-audit (2) collision placeholder | Fixed (seo/react) | "Search {{n}} roles on boards named “{{token}}”" |
| After-audit (3) agency SPA title | Fixed (seo/react) | board-heads agency branch, equal to the bake |
| After-audit (4) LiveMatches defaults | Fixed (seo/react) | Keys in 9 locales, "live openings" |
| After-audit (5) aggregator and repost claims | Fixed (seo/bake, seo/react) | 0 in pages and llms files |
| After-audit (6) unconditional re-check | Fixed (seo/bake, integration, review fixes) | One conditional sentence: bake, React's posting note (9 locales), llms.txt |
| After-audit (7) IDE hosts on /agents | Fixed (seo/bake, seo/react) | Section 98 G3 |
| After-audit (8) USAJOBS placeholder | Fixed (seo/react) | "Search {{n}} federal openings listed on USAJOBS" |
| After-audit (9) Domino's CLS | Fixed (seo/react, integration) | 0.018 phone / 0.012 desktop |
| Image follow-ups | Fixed (seo/speed) | og:image 1200x630 with og:image:height 630 in the same commit, 180 px apple-touch-icon link, 96 px favicon, live checks in section 98 |

### Residuals, said plainly

- SPA navigation (not a page load) to a pooled, name-shared or collided company page prints React's employer head, not the bake's pooled or board-labelled one: React holds no pooled board totals or name-shared flag. Every crawler fetch is a page load, which keeps the baked head.
- An unbaked `/jobs/company/*` path is served the homepage shell to crawlers that run no script; the app noindexes an uncarried token after render.
- The scanner copy "verified output" and "every resume quote is verified" (llms.txt, /vs/* descriptions, homepage components) is about the scan's quote check, not jobs. It was left as is; the owner may extend the "never verified" rule to it.
- D7 and the 500-board ceiling: resolved by the review fixes. Against the live sitemap the fixer's bake keeps all 485 company pages indexable today and adds 3 (`docs/company-profiles/name-gate-dry-run.md` section 4). Lovable's publish re-reads the counts, so a few boards at the cut may differ; the rule keeps today's boards whatever the counts.
- React's posting page still prints a stored employer name the bake withholds (Axia Logo Horizontal): the gate lives in the bake. A `company_name_overrides` row is the fix for that employer.
- The SoftwareApplication nodes on /agents, / and /builder carry offers but no rating; Search Console may list them as items with a warning. No honest rating exists.

## Hand-offs

**Wave 4 / job-board** (exact changes):

- SEO-003: add `job_board_postings.work_mode_source text`; set `'vendor'` only from Workday `jobPostingInfo.remoteType` (index.ts ~7031-7051) or the Greenhouse, Lever and SmartRecruiters structured remote fields, `'label'` when the mode comes from a location label; never set `work_mode='remote'` from a "<Region> Remote" label when `remoteType` is null; return `workModeSource` on list and get rows beside `work_mode: r.work_mode ?? null` (~index.ts:2460). `posting-page.ts` already reads `job.workModeSource === 'vendor'`.
- SEO-004: in the Workday detail reader (index.ts ~7031, `jobPostingInfo?: {jobDescription; startDate; remoteType; endDate?; timeType?}`), store `jobPostingInfo.endDate` as `employer_valid_through` (date column, migration); map `timeType` "Full time" to `full_time` and "Part time" to `part_time`; return `employerValidThrough` on list and get rows; re-read `startDate` on detail passes. `postingValidThrough` already clamps to it.
- SEO-035: check a full country-name table before US state codes so a trailing country word wins; carry SmartRecruiters' stated country; tests for "City, LA, Nigeria", "City, GA, Ghana" and two more; repair US rows whose location ends in another country's name (live now: `smartrecruiters:ThePlace1:744000154839819`, "Lagos, LA, Nigeria").
- SEO-009: allocate the audit's headline sample by each vendor's share of served postings at uniform offsets, keep the even per-vendor draw as a secondary table; then drop the caveat from the bake (`weighting` in prerender-seo.mjs) and llms.txt line 3.
- SEO-016 / S9-009: employment_type from Workday `timeType`, Lever and Greenhouse commitment, SmartRecruiters `typeOfEmployment`; expose Lever lists/additional on the detail response so the bake can append them at render time (D3(a)).
- Migrations: S13-049 per-employer aggregation in the pay-transparency SQL; S13-087 a scan count of completions only; S13-116 a per-token arm of get_company_intel; S13-120 get_similar_companies excluding `usajobs` and name-collided tokens.
- S13-050: keep the fallback scanner's scores out of the public benchmark's population (free-keyword-scan-stream).
- S13-105: wave 4's llms.txt and /agents carry the fit-is-free wording when fit becomes free; this branch keeps "(paid)", true on production today.
- S13-127: Resume Builder's SEO title and labels through i18n (w4b/generators owns ResumeBuilder.tsx).
- The Workday description assembly writes a literal line "undefined" where a section it joins is missing (zeissgroup 1054265, nike R-94383; the read-only detail API returns "...processes.\nundefined\nThis role..."). In the Workday detail reader, skip an undefined or null part instead of interpolating it. The bake and React already drop the line (`jdText`).
- SEO-003 now depends on `work_mode_source` for any TELECOMMUTE at all: until it ships, remote postings are marked up as their country.

**Homepage + pricing redesign:**

- The homepage's desktop LCP is React's text-6xl H1, larger than the baked hero H1 (lab, 1280: baked paragraph at 184 ms, React's H1 at 783-1,128 ms). Give the baked hero H1 the size and classes of Index.tsx's, so the baked paint stays the LCP element.
- The bake's homepage body (prerender-seo.mjs, the `isFallback` write): remove the "… roles tracked in all, including the ones we have watched close" clause (SEO-026), and say "scans logged" instead of "completed scans" / "has completed N scans" (S13-087).
- SEO-041: `lazy()` the homepage's below-fold sections inside LazySection and defer the checkout hooks to interaction (Index.tsx).
- React's /pricing title replaces the baked one: pass `preferBakedHead` to Pricing.tsx's `<SEO>`, or use the bake's title.
- src/pages/Index.tsx `homeAgent.passLine` says "Resume Booster never submits an application for you" while the server-side apply agent is live; the bake's /about and llms.txt no longer say it.

**Owner:**

- SEO-013 Bing Webmaster Tools; SEO-044 data license; SEO-045 seller identity and one public contact address; SEO-046 www 302 to 301 (Lovable domain setting); SEO-047 brotli, 304 and cache headers (Lovable support); SEO-048 read Search Console Core Web Vitals (mobile) before and after the publish.
- SEO-020 self-hosting: download Inter 400/500/600/700 and JetBrains Mono 400 woff2 (latin, latin-ext) into `public/fonts/`, add `@font-face` rules to `src/index.css`, preload Inter 400 and 600 from `index.html` after R1's script, drop the fonts.gstatic.com preconnect, and update `fontProblems()` and section 98-seo-speed to the self-hosted form. Keep `font-display: optional`.
- D7: sign or refuse the rows in `docs/company-profiles/name-gate-dry-run.md`, including the 24-board rotation at the ceiling (section 4).
- IndexNow resubmission, after the deploy is verified and the stubs are live (section 98 C3 passing):
  `node scripts/indexnow-ping.mjs --urls scripts/seo-seed/indexnow-historical-urls.txt --dry-run` lists without sending (run 2026-10-24: 2,925 URLs, 5 other pages, 1,513 company pages, 1,407 posting pages; one submission fits Bing's 10,000 limit; nothing was sent). Without `--dry-run` it submits; that needs the owner's OK.

## The bake writes committed files

`scripts/prerender-seo.mjs` writes `public/sitemap.xml`, `public/prerender-ledger.json`, `public/llms.txt` and `scripts/board-facets-snapshot.json` when `PRERENDER_OUT` is unset, and Lovable's publish sandbox commits them back to main (91608042 did). They should stay committed, and the default should stay as it is: the committed sitemap is the sitemap ratchet's base and the carry's fallback when the live sitemap cannot be read, the committed ledger is the carry's fallback when the live ledger cannot be read, and the snapshot is the facets fallback. Writing elsewhere by default would change what a later Lovable publish produces. Two rules follow: never bake inside a worktree (use a `git archive` export or `PRERENDER_OUT`), and do not commit a local bake's sitemap or ledger (they would claim pages that were never live). This branch carries main's versions of the generated files untouched. `public/llms.txt` is also a source template: its `/companies` line names no count (the bake fills it at build time; a test requires the committed line count-free), the same text as `r1/hotfix-s13` (bdeb81b9) and 57815de9.

## Measured on this branch's bake (2026-10-24)

The fixer's bake (2026-10-25, a `git archive` export of 847e430f, `vite build` with the bake reading production, 3 min 45 s): 3,500 pages written; sitemap 1,244 URLs (488 company, 372 posting); every URL written, indexable and self-canonical; 0 duplicate-title groups; 0 JSON-LD parse errors; 370 JobPosting blocks, none missing a required property, 0 baseSalary, 0 TELECOMMUTE, 0 junk localities, no window over 30 days; R1's stash script still first in the head; 13 inline font faces, no font stylesheet; the fallback's static head preloads Footer only; retired-claim, source-sentence and job-markup checks clean; section 98 45 of 45 PASS. The integration's bake, for comparison:

A `git archive` export of the branch, `vite build` with the bake reading production (4 min 0 s):

- 3,498 HTML pages written; 1,253 indexable, 2,245 noindex (stubs, carried noindex pages, /v1 pages, the duplicate and gone posting stubs).
- Sitemap 1,241 URLs (485 company, 372 posting, 17 field, /about new); every URL has a file, none is noindex, none canonicalises elsewhere; 0 duplicate-title groups.
- JSON-LD: 0 parse errors; 371 JobPosting blocks, none missing a required property, 0 baseSalary.
- 0 non-home pages with the homepage title; 0 descriptions cut (the bake logged no truncation); og:image:height 630, apple-touch-icon linked, R1's stash script still first in the head.
- Retired claims: 0 outside /changelog (whose entries describe the removals). Banned source phrases: 0 in pages and both llms files ("Cursor pagination" in the API line is the API's paging, not the IDE).
- Section 98 against this bake served like Lovable: 41 of 41 PASS. The dist-reading parity tests (`sitemap-prerender-parity`, `the-sitemap-never-advertises-a-posting-url-with-no-page`) pass on it.
- Company intel read for 22 of 489 employers (the Workday timeout, pd/hotfix); all 485 indexable employer pages written.
