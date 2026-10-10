# Wave 3 — seo-content (branch `wave3/seo-content`)

What crawlers, answer engines and visitors are told: employer names, the
pages the publish keeps, the company and data pages, the methodology, the
headline claims, the legal pages and the seller. Sources: the 2026-10-04
register (`fix_group` seo-content-i18n), the S8 sweep of 2026-10-08 (same
group), the SEO & GEO report of 2026-10-08 (sections 2, 3 and 6), owner
decision 2 of 2026-10-08 and the commercial-readiness plan items 8–10.

## What ships

| | |
|---|---|
| Edge functions | **none changed**, so no `FN_BUILD` moves. `supabase/functions/_shared/employer-names.ts` is NEW here but imported by no function (the bake and the app read it); it is a byte-for-byte copy of the job-board group's file (see Handoffs). |
| Migrations | **none** |
| Frontend | one Lovable publish of this branch; the prerender bake (`scripts/prerender-seo.mjs`, run by the vite plugin) does the crawler half |
| Verifier | `scripts/verify-deploy.d/76-wave3-seo-content.sh` |

## Item by item

| Id | Fix | Commit |
|---|---|---|
| SEO F1 | Employers named by the name they use everywhere a page names one: posting title, meta description, `hiringOrganization` and `identifier` (`postingEmployer` in `src/components/jobs/posting-page.ts`, shared by the bake and the React posting page), company-page titles/H1/meta/JSON-LD, `/companies`, the data-page employer columns. `possessive()` ends "Domino's's". A compound-token board still named by its tenant code (`isCodeShapedName`, case-folded so "SHM" and "PFG", which `companyDisplayName` uppercased from "Shm" and "Pfg", count too; an allowlist of real names that equal their code) gets a **noindex** page and its postings no page, and so do its "no longer listed" stubs' names (`postingStubEntry`). The bake log lists them (25 on the committed snapshot: uoflhealth, rhe, iff, agecare, alliancewd, jcrew~…Madewell, nationwidechildrens, synnex, oshkoshcorporation, ironmountain, r1rcm, capitalhealth, blackrock, erm, loganhealth, abercrombie, fogo, onelineage, gohealthuc, sasllc, shm, pfg, wnc, snc, plus any the live facets add). The bake's two F1 call sites are `bakeLanders` and `postingRowEligible` (tested with the app's own modules). The React company lander names the board with `boardName` and its four possessive strings take `{{companyPossessive}}`. | 83fe6dd3, d66e5706, 588d096e, 24f24ecb, 6a79c2c1 |
| SEO F2a, L13-36, L13-34 | The carry base is what the LIVE site published: the bake GETs `https://resumebooster.work/sitemap.xml` and the new `/prerender-ledger.json` (committed copies as fallback). Every carried posting URL is re-checked with **no cap**; one the board no longer lists keeps a noindex "no longer listed on this board" page for 60 days (`POSTING_STUB_KEEP_DAYS`), one it did not answer for a noindex "could not re-check" page. A path the ledger names in any state is never re-added from a sitemap, and once the live ledger is read the committed sitemap is not carried at all (`carrySitemaps`): an expired gone path was re-read from the stale committed sitemap on every bake. All board reads are counted against `BAKE_BOARD_CALL_BUDGET` (721, the old sum): 621 for the posting block (its ceiling cut from 600 to 500 live pages to fit) and 100 for the company pages' listings. Neither posting page (bake or React, nine locales) claims it drops "the moment" a feed stops. Not done (no runtime to do it in; the zone is DNS-only): a 410 for a dead posting between publishes. | d66e5706, 1998f809, 0f7cdeba |
| SEO F2b, L1-04 | Company-page set chosen before the posting loop; a link or breadcrumb names a company page only when this bake writes it, else `/jobs?company=<token>`. | d66e5706 |
| SEO F2c, L1-10 | Every company href and JSON-LD url through `publicHref` (the React half was wave 2). | d66e5706 |
| SEO F2d | The homepage file carries `<link rel="canonical" href="https://resumebooster.work/">`; its inline script removes it on any other path. | d66e5706 |
| SEO S1, L4-12 | Company pages list the employer's own openings: its posting pages first, then its board listing (one company-filtered list read, newest ten, each linked to `/jobs?job=<id>`), read for `LANDER_OPENINGS_READS` = 100 employers a bake (never-read first, then oldest) and carried in the ledger's `openings` for 14 days, so every primary page has a listing after about five bakes. Places and fields (`get_company_intel`) are still printed but no longer make a page its own: an answered listing with fewer than three openings is noindex, and so is a page whose text matches another page's once names and numbers are out (`duplicateSkeletons`); the two rules together never noindex more than a quarter of the pages (`landerBreakers`), so a cold cache or a broken read cannot trip the sitemap ratchet. The bake logs the distinct indexable count against the report's bar of 400. The capitalised "THE COUNT'S BASIS" annotation is prose. `/companies` lists only indexable pages and says the board carries more; llms-full says the same, counted. | d66e5706, 722d2f8d, 1f219a1d, d61d8b67 |
| SEO S2 | `/ghost-job-index` prints "Daily re-check: X% of N decided sample postings still live at the source (date)" from `get_audit_result`; the four data pages are `Dataset` markup with `dateModified` from their own payload stamp; `DATA_LICENSE` is an empty owner TODO (no license named until chosen); "fill" wording gone; field codes print as labels ("other" as "Roles we could not sort into a field"). | d66e5706 |
| SEO S3 | Each sitemap entry's `lastmod` is the day its content fingerprint (date stamps blinded) last changed, carried in the ledger; guides carry their own `updated`. `post-publish-smoke.mjs` runs `indexnow-ping.mjs --changed` on every clean pass: the pages dated the publish day plus the posting URLs retired that day (`NO_INDEXNOW=1` skips). | d66e5706, 2e1674fc |
| SEO S4, L4-05 | `/methodology` renders from `src/config/score-method.ts`, a mirror of the scorer held to `free-keyword-scan/index.ts` by a test: the four audit parts (35/30/25/10), the 12-point AI band, the six systems the scan names. No "50+", "+40 more", "90% of the job market", market shares, "monthly updates", "recruiter feedback" or outcome validation. | 2e110ecf |
| Owner decision 2; plan items 8–9 | "Zero Ghost Jobs" → "live jobs straight from employers' own hiring systems" in the shell, the SPA head, the bake, the hero (nine locales), manifest, llms.txt. Gone: "Every job here is real", "never scraped", "never an aggregator or a scrape" (llms.txt, React /ghost-job-index and /entry-level-index), "proven methodology", "bank-level encryption", the typed "0 Data Breaches" and "30s" tiles, the GDPR badges, "Pay once, use forever", "Save $6", "Priority processing", "Included Free" (LinkedIn, beside a Paid badge), "no resume stored", the typed board sizes. | b447872a |
| S8-012, L4-08 | The free report's final button renders `priceDisplay`; the five typed $25/£20 keys are deleted; the comparison table and `/vs` print `oneTimePriceRangeUsd()` ($2–$59). | b447872a |
| S8-114 | "~10 seconds", "~90 seconds", "about 60 seconds", "Results in 30 seconds", the Trust "30s" tile and "join thousands" are gone (live p50 21 s, 1,110 scans). "24 distinct checks" is untouched. | b447872a |
| S8-115 | The outcome prompt no longer says answers sharpen published benchmarks. The mails saying it are email-ops' (Handoffs). | b447872a |
| S8-113 | Review is the default and auto a switch you turn on, in the /agent crawler copy, `accountPage.bridgeBlurb`, `applyAgent.control` and the saved-job toast `jobsPage.savedMilestoneDesc` (nine locales). | 02e51d6d, 13ba154e |
| L1-08 | The homepage apply-agent `Service` carries two priced Offers ($99/month, $29 pass). | b447872a |
| L1-09 | `TERMS_LAST_UPDATED` / `PRIVACY_LAST_UPDATED` literals replace `new Date()`; the bake writes `/terms` and `/privacy` (title, date, section headings, contact; seller when set). `/v1` has no SPA route; it falls back to the homepage file, which now names `/` canonical. | 121cdaf0 |
| Plan item 10 | `src/config/seller.ts` holds the seller's legal name and postal address, **empty**; `<SellerIdentity>` renders nothing until both are set, then the footer, the Terms party and the Privacy controller (and the bake's footer). Three keys, nine locales. | 121cdaf0 |
| L4-03 | Snapshot and board-function rung name `openTotal` and the tracked total separately; a snapshot without `openTotal` states no board total; the llms-full corpus line needs live facets. | d66e5706, 121cdaf0 |
| L4-06 | The banner places a score in the industry's scanned distribution (20+ scans) or says it is no pass mark (`src/lib/score-banner.ts`); the `/resume-score` FAQ points at the live benchmarks. Banner and FAQ say *major ATS platforms* do not reject on a score (was "no ATS"), matching the guide. | 02e51d6d, 0832d181 |
| L4-09 | `/industries` renders its own count; the homepage drops the industry number; `LANGUAGE_COUNT` (8) replaces "10 languages". | 02e51d6d |
| L4-10 | `/guides` intro is one constant (`GUIDES_INTRO`) shared with the page; benchmark card baked. The `/data-api` 72-hour line was already fixed by wave 2 (public-api). | d66e5706 |
| L4-11 | llms.txt: absolute links naming the domain, the agent links `/agent`, "taken down" not "filled", `/companies` described truly, counts as floors, registry name, uncategorised wording; `/data-api` "fills" → takedowns. | b447872a, e1a0423e |
| L4-13 | `og-image.png` and `favicon.png` are real PNGs (share image 1200x675, declared); alt text updated. | b447872a |
| L4-14 | i18next plurals (`_one`/`_other`) for the four upsell bullets in nine locales. | 863f6ac2 |
| L4-15 | `useDocumentLang` keeps `<html lang>` on the translated CV pages and `/es/industrias/*`. The English breadcrumb on CvStandards is not localised. | 863f6ac2 |
| L1-05 | `onetForRole` cites the industry's O*NET occupation on a role page only when it names the role. The intro, both list headings and the JSON-LD description come from `roleListCopy` in both renderers ("Keywords from the Aviation tables"). Duplicate role meta descriptions are not addressed. | 8d6c5c60, 005acd68 |
| L9-11 | The free-key sentence scopes the pass to the MCP server and denies it on `/v1`. | 02e51d6d |
| L13-37 | Field-lander titles take `plusClaim`'s churn margin. | d66e5706 |
| GEO | `work.resumebooster/jobs` named on the baked `/agents` and in llms-full. | c0124f5f |

**Not done, and why**

- **L4-02** — already fixed live (SEO report, 2026-10-08: `/changelog` serves 30 entries). Close it.
- **L4-07** (Terms §4, the bots clause, renewal terms) and **S8-112** (shortlist retention) — owner/legal decisions; only the seller line and the literal date were done here.
- **L4-16** (~140 inline-only keys, hi/tl/en-GB English values, a parity test that scans `t()` literals) — too large for this pass; untouched.
- **Owner decision 1 beyond the $25** (the invented "Premium Only" issues, the resetting 48-hour countdown, the hidden $3 product) — not in this group's list; this branch only removed the $25, "Save $6" and "Priority processing" lines inside that offer stack.
- From SEO report §6 not attempted: Organization `@id` graph in `index.html` and the research Dataset, hourly `baseSalary`, address cleanup ("India Remote"), duplicate JSON-LD after hydration, CV-standards FAQ markup, "VS Code and More…", dated headline counts, the install-repo README, page speed (S5), language hubs, `content-language`, Spanish title parity, Lever truncation (job-board).

## Deploy

1. **Publish** the branch through a Lovable session (frontend + bake). Nothing to apply in Supabase; no edge function to deploy.
2. **Run** `npm run verify:deploy` (it now ends with the IndexNow ping on a clean pass) and section 76: `bash scripts/verify-deploy.sh` or the section alone.
3. **Keep the sitemap** after each publish for the next verifier run: `curl -s https://resumebooster.work/sitemap.xml > ~/.config/resumebooster/seo/last-sitemap.xml`. Section 76 then checks every posting URL the previous publish named (eight at a time; without the file, every posting URL of the live sitemap).

## Owner steps (decisions only)

- Seller: set `legalName` and `postalAddress` in `src/config/seller.ts` once the entity and a postal address exist; republish. Until then nothing renders.
- Data license: set `DATA_LICENSE` in `scripts/prerender-seo.mjs` (the report recommends CC BY 4.0) to name it in the Dataset markup.
- Bing Webmaster Tools verification and sitemap submission (SEO report §5) are still the owner's.

## What the bake now reads at build time

- `https://resumebooster.work/sitemap.xml` and `/prerender-ledger.json` (two GETs; committed copies if unreachable).
- `get_audit_result` (one anon RPC, already allowlisted for GhostJobIndex) and `get_company_intel` once per primary company page (≤ ~490, six at a time, 8 s timeout; the same read the live lander makes for every visitor).
- The job-board function: at most `BAKE_BOARD_CALL_BUDGET` = 721 reads, as before (inside `BUILD_DAILY_CAP`'s twenty bakes): 621 for the facets head and the posting block, 100 company-filtered list reads for the company pages' listings. A carried posting the budget cannot reach becomes "unchecked" (noindex), never dropped.
- The ledger (`/prerender-ledger.json`) now also carries `openings`: up to ten rows (id, title, place) per primary employer, about 0.75 MB at 470 employers.

## What to measure

- Section 76 (one line per claim). Pre-deploy on 2026-10-10: 22 FAIL as designed, 2 PASS, no crash.
- The bake log: `posting pages: carried N / live M / tombstoned K / retired R / unchecked U`, `company pages: … indexable, D distinct once names and numbers are out; noindex: … with too few openings of their own, … matching another page, … still named by a tenant code; … listings read R of 100`, the warning `only D distinct indexable pages (the bar is 400)` (expected for the first four or so bakes while the listing cache fills, then gone), `sitemap.xml regenerated: … distinct lastmod dates`, `/prerender-ledger.json written`. "unchecked" above a handful means the board refused reads (look at 429s first).
- Search Console: "Duplicate without user-selected canonical" and "Soft 404" for `/jobs/posting/…` and `/jobs/company/…` should fall over the following weeks; Job postings enhancement counts with the employer names.

## Verified locally (no production write, no production board read)

- An offline bake (committed facets snapshot, no credentials): 500 company pages, 469 indexable, 852 sitemap URLs with 4 distinct lastmods, `/terms` and `/privacy` written, the homepage canonical present.
- Two bakes against a local mock of the Supabase endpoints (the live sitemap GET real): bake 1 carried 637 published posting URLs (live 274, gone 212 as noindex "no longer listed", unchecked 212 as noindex "could not re-check"), wrote the ledger; bake 2 read that ledger, carried the 212 gone pages WITHOUT re-reading them (486 detail reads, not 698), re-checked the unchecked ones. Ms rows named Morgan Stanley, RMIT rows RMIT University, no noindex URL in the sitemap. The first run also found two defects fixed in cbf2e01e (a broken intel read noindexing every company page and tripping the ratchet; the ledger skipped when the sitemap was refused). Watch for the log line `treated as a broken read` after deploy: it means the listings answered short for most employers. After the reviewer pass (2026-10-10), three more mock bakes with a company-filtered list mock: 100 listing reads a bake, distinct indexable company pages 95 → 174 → 253, detail reads 620 then 491, the duplicate rule held back by its breaker while the cache was cold, standing sitemap URLs inside the ratchet.

## Rollback

Revert the branch's commits and republish. No data or schema to undo. The
ledger file disappears with the revert; the next publish falls back to the
committed sitemap (the old behaviour). The retired locale keys come back with
the revert.

## Handoffs (cross-group)

- **job-board** — `supabase/functions/_shared/employer-names.ts` here is a byte-identical copy of that branch's file (md5 8bfdf436… on 2026-10-10). If theirs changes before merge, take theirs. The 21 tenant-code boards above need override rows (their table and migrations); each becomes an indexable page on the first publish after.
- **frontend-board** — done here in `Jobs.tsx` (small hunks): the company lander's name is `boardName(token, stored)` and the four lander strings pass `companyPossessive`. Still open: `Companies.tsx` and the board's cards print stored names (`employerName()` names them), and the posting-level keys `jobsPage.apply`, `reportCheckedBody(Unsent)`, `reportUncheckableBody(Unsent)`, `prepSubtitle`, `trustBadgeAtsTip` still build "{{company}}'s" in en/en-GB (Domino's's on a Domino's card).
- **job-board** (second note) — `isCodeShapedName` now folds case, so shm, pfg, wnc and snc join the noindex list until override rows name them. Their `isSystemCodeName` also strips punctuation, which would flag "Driven Brands" for drivenbrands; this branch deliberately does not. `BUILD_DAILY_CAP` needs no change: the bake still makes at most 721 board reads.
- **data-pages-sql** — `PayTransparencyIndex.tsx` and `EntryLevelIndex.tsx` (React) still print stored employer names and raw field codes; the bake's tables now use `employerName` and the field labels.
- **email-ops** — `send-scan-report/index.ts:283` and the day-6/day-14 drips say answers "sharpen the public benchmarks" (S8-115); nothing public reads `scan_outcomes`.
- **scan-ai** — `src/config/score-method.ts` mirrors `scoreAudit`'s 35/30/25/10, the 12-point clamp and the six-system prompt line; changing any of them in `free-keyword-scan/index.ts` fails `the-methodology-page-described-a-scorer-that-does-not-exist.test.ts` until the mirror moves.
- **payments** — `products.ts` `premiumPackage` lost `savings` and "Priority processing" (and the modal, `/pricing` and the report stopped rendering a savings badge); `oneTimePriceRangeUsd()` is new.
- **agents-api** — the React `/agents` page does not name `work.resumebooster/jobs` (the bake does).
- **whoever owns the FreeKeywordResults offer stack (owner decision 1)** — this branch touched it in five small hunks: the savings badge, the priority line, the final button's price, the score banner, the plural bullets. Merge by hunk.
- **integrator** — locale files: keys added and retired in all nine (merge by key): retired `hero.factGdpr`, `hero.browseJobs`, `hero.headline.feedback`, `hero.price`, `hero.roi`, `finalCta.roi`, `comparison.cta`, `freeScan.cta.price`, `socialProof.trustMessage`, `preview.includedFree`, `trustIndicators.badges.{gdpr,instant}`, `trustPage.badges.gdpr`, `trustPage.stats.{avgDelivery,dataBreaches}`, `freeResults.premiumFeatures.priorityProcessing`, `freeResults.atsBanner.{require60,require75,targetScore}`, `freeResults.lockedInsights.{kwHard,kwCerts,kwTools,kwMethodology}`, `methodologyPage.{platformsAnalyzed,updatedMonthly,atsPlatforms,moreAtsPlatforms,scoringFactors}`, `methodologyPage.continuousResearch.recruiterFeedback`, `jobsPage.urgencyTipFills`. No SECURITY DEFINER function, no census change.
