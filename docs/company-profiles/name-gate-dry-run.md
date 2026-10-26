# Name gate dry run: pages indexable today that a stricter rule would drop

Bake of 2026-10-25 (the SEO round's last pass before landing, seo-merge-main at fd507af1, a git-archive export with live reads), facets from rpc; 486 company pages indexable on the live site that day. Written by `scripts/prerender-name-gate-report.mjs` from the bake's `PRERENDER_NAME_GATE_REPORT` file.

Owner decision D7: no page indexable today drops out without the owner's sign-off. **Every page in the first table keeps its index in this round.** Sign the rows that may drop; the next round makes the gate act on the signed rows only.

## 1. Indexable today, and a stricter rule would drop it

| Page | Kind | Name printed | Why | What the rule would do | Sign (drop? yes/no) |
| --- | --- | --- | --- | --- | --- |
| `/jobs/posting/ukg/recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522/238cdd44-9089-429c-a963-8de91422a9af` | posting | Axia Logo Horizontal | logo or image text | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/smartrecruiters/ThePlace1/744000154839819` | posting | The Place | the location ends in another country's name than the row's (US) | be marked noindex (its job markup is already withheld) |  |
| `/jobs/posting/workday/bristolmyerssquibb~wd5~BMS/R1607072-1` | posting | Bristol Myers Squibb | the location ends in another country's name than the row's (CA) | be marked noindex (its job markup is already withheld) |  |
| `/jobs/company/talent.reyesholdings.com` | company | Reyes Beverage Group | same text as /jobs/company/jobportal.martinbrower.com once names and numbers are out | be marked noindex (a different employer name: no canonical) |  |
| `/jobs/company/icfcjb~ocs~CX_1` | company | Aerospace | generic word | be marked noindex |  |
| `/jobs/company/eexs~us2~CX_3001` | company | All | generic word | be marked noindex |  |

### Notes on table 1

- `Axia Logo Horizontal` is logo text kept under D7: since the SEO round's review the page keeps its index but not the name. Its JobPosting is withheld and its head and its own sentences say "the employer" (a `company_name_overrides` row naming the employer would restore both).
- `Aerospace` may be The Aerospace Corporation, which calls itself "Aerospace" on its own careers site, and `All` is a career-site label: a name override (the job-board group's `company_name_overrides`) would repair either instead of a drop.
- `/jobs/company/talent.reyesholdings.com` and `/jobs/company/jobportal.martinbrower.com` carry one feed under two employer names (SEO-036). The bake keeps one member of the group indexable and never canonicalises between two differently named employers; which member the rule would drop follows the open counts (the integration bake named Martin Brower, this bake Reyes Beverage Group). Dropping either needs the owner's sign-off, and a catalogue override naming the shared feed is the better fix.
- `smartrecruiters/ThePlace1` is filed as a US job while its location ends in Nigeria (SEO-035). Its job markup is withheld already; the row itself is fixed by the wave-4 country-reader hand-off in docs/seo-round/README.md.
- `bristolmyerssquibb~wd5~BMS/R1607072-1` is filed under CA while its location reads "New Brunswick - NJ - US". Its job markup is withheld already, as for ThePlace1. The merge review's bake also listed Unilever R-1189545 ("Ho Chi Minh City, Vietnam", filed VN) here. That was the country reader misreading Vietnam as the withdrawn code VD, not the row. Since the last pass before landing, the reader reads it as VN, and the page carries its JobPosting with no ledger flag.

## 2. Names repaired (printed differently, index unchanged)

| Page | Stored name | Printed name | Indexable today | One word: check it names the employer |
| --- | --- | --- | --- | --- |
| `/jobs/company/epyc~us2~CX_1` | Clean Harbors External | Clean Harbors | yes |  |
| `/jobs/company/fa-espx-saasfaprod1~ocs~CX_1006` | Cummins All Functions | Cummins | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/fa-ewjt-saasfaprod1~ocs~CX_1` | EXL Talent Acquisition Team | EXL | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/fa-euwp-saasfaprod1~ocs~CX_1` | Mayo Career Site US | Mayo | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/recruiting2~BIG1003BIGC~63b1fe5f-a895-49e4-afdc-7059fb08eea2` | Big 5 Sporting Goods Opt 1 | Big 5 Sporting Goods | yes |  |
| `/jobs/company/recruiting2~AUS1003AUIN~611d5a38-76c4-4f66-a55f-2bc012d98024` | Austin External | Austin | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/eedu~em3~CX_1003` | WTW External | WTW | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/recruiting2~AUS1003AUIN~76c6c58c-a4d3-4a7c-b7a4-8640fc76a703` | Austin External | Austin | no | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/eqtm~us2~CX_1` | FMOL Health Career Portal | FMOL Health | yes |  |
| `/jobs/company/fa-ewgu-saasfaprod1~ocs~CX_2001` | Chubb External | Chubb | yes | yes (add an override if it reads as a place or another employer) |

## 3. New pages refused (never indexable before this bake)

None in this bake.

## 4. Compared with the live sitemap (2026-10-25)

From the SEO round's fixer bake (seo-fix at 847e430f, a git-archive export, live reads, 2026-10-25 UTC). The live sitemap (the 2026-10-18 publish) lists 485 company pages; **this bake keeps all 485 indexable** and adds 3 new ones (`dinebrands~wd503~RestaurantCareerSite`, `thirdchannel-inc`, `recruiting2~BUI1005BABW~621885b8-8801-434c-83f1-c5e38d84ac03`), 488 in all. No company page indexable today loses its index or its canonical.

Two rules hold that, both in `selectLanders` (scripts/prerender-pages.mjs), and both answer the integration bake's 24-board rotation at the 500-board ceiling (which this section listed for sign-off before the review):

- **The ceiling keeps today's boards near the cut.** A board indexable today keeps its place while its open roles are at least half the cut's; it displaces the lowest-ranked new boards, never another of today's and never a board of an employer that has one, so the set stays at 500. In this bake 24 boards indexable today were kept that way, and 24 boards new to the index made way (refusing a page new to the index is what D7 allows): `nyuhs~wd12~nyuhscareers1`, `recruiting2~EDD1000EBLLC~6fb5a475-cea1-435e-89f4-fdc9d00253c1`, `bakertilly~wd5~btcareers`, `shm~wd5~Summit_CityMD`, `rochester~wd5~UR_Staff`, `mcgill~wd3~McGill_Careers`, `iawmqy~ocs~CX_1`, `speechify`, `fa-exvn-saasfaprod1~ocs~CX_1`, `SIXT`, `skilledwoundcare`, `aisle_and_abroad`, `eswt~us6~CX_1`, `jobs.footlocker.com`, `careers.keysight.com`, `papajohns~wd1~PapaJohnsCareers`, `townepark~wd5~ext`, `marmon~wd501~Marmon_Careers`, `virtua~wd1~Virtua_Health_External_Career_Site`, `fa-ewgu-saasfaprod1~ocs~CX_2001`, `hubinternational~wd1~HUBInternational`, `aptiv~wd5~APTIV_CAREERS`, `accenturefederalservices`, `AllianceAnimalHealth` (each under /jobs/company/; none was indexable on the live site).
- **Today's page stays its employer's canonical page.** When a sibling board grows past it, the page indexable today keeps the canonical and the pooled count: PwC's `crm_experienced_careers_site` (indexable today) would otherwise have canonicalised to its larger `Global_Experienced_Careers` board.

Posting pages are not company pages: 226 posting URLs in the live sitemap leave this bake's, each because the posting closed or left its window (a closed posting gets a noindex "gone" page, as Google requires of expired jobs; the integration bake spot-checked three with the read-only API).

The figures move with the board: Lovable's publish re-reads the counts, so its own list will differ by a few boards at the cut.

## How the gate decides (`scripts/prerender-names.mjs`)

1. **Repair first.** A career-site label at the end of a stored name comes off: External, Career Site [US], Career Portal, All Functions, Talent Acquisition [Team], Opt N. The name in front of it is printed.
2. **Refuse narrowly.** A name is refused only when it cannot be anyone's: a file name or logo text (CMYK, "Screenshot at", or two words that describe an image file), a careers or jobs subdomain used as a name, or a bare generic word after the repair (All, Aerospace, Default, Careers...). A stored name that is a label as a whole ("Only External Postings") is judged whole and printed as stored. Domain-shaped names (Booking.com, Crypto.com) and names ending in Global or Business (Abt Global) are never refused.
3. **What a refusal does in this round.** A page indexable today keeps its index and is listed in table 1. A page new to the index is marked noindex, and a new posting of such a board gets no page.
