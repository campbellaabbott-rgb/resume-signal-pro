# Name gate dry run: pages indexable today that a stricter rule would drop

Bake of 2026-10-24, facets from rpc; 485 company pages indexable on the live site that day. Written by `scripts/prerender-name-gate-report.mjs` from the bake's `PRERENDER_NAME_GATE_REPORT` file.

Owner decision D7: no page indexable today drops out without the owner's sign-off. **Every page in the first table keeps its index in this round.** Sign the rows that may drop; the next round makes the gate act on the signed rows only.

## 1. Indexable today, and a stricter rule would drop it

| Page | Kind | Name printed | Why | What the rule would do | Sign (drop? yes/no) |
| --- | --- | --- | --- | --- | --- |
| `/jobs/posting/ukg/recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522/238cdd44-9089-429c-a963-8de91422a9af` | posting | Axia Logo Horizontal | logo or image text | lose its JobPosting markup and be marked noindex |  |
| `/jobs/posting/smartrecruiters/ThePlace1/744000154839819` | posting | The Place | the location ends in another country's name than the row's (US) | be marked noindex (its job markup is already withheld) |  |
| `/jobs/company/jobportal.martinbrower.com` | company | Martin Brower | same text as /jobs/company/talent.reyesholdings.com once names and numbers are out | be marked noindex (a different employer name: no canonical) |  |
| `/jobs/company/icfcjb~ocs~CX_1` | company | Aerospace | generic word | be marked noindex |  |
| `/jobs/company/eexs~us2~CX_3001` | company | All | generic word | be marked noindex |  |

### Notes on table 1

- `Aerospace` may be The Aerospace Corporation, which calls itself "Aerospace" on its own careers site, and `All` is a career-site label: a name override (the job-board group's `company_name_overrides`) would repair either instead of a drop.
- `/jobs/company/jobportal.martinbrower.com` and `/jobs/company/talent.reyesholdings.com` carry one feed under two employer names (SEO-036). The bake keeps one member of the group indexable and never canonicalises between two differently named employers; dropping Martin Brower needs the owner's sign-off, and a catalogue override naming the shared feed is the better fix.
- `smartrecruiters/ThePlace1` is filed as a US job while its location ends in Nigeria (SEO-035). Its job markup is withheld already; the row itself is fixed by the wave-4 country-reader hand-off in docs/seo-round/README.md.

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
| `/jobs/company/fa-ewgu-saasfaprod1~ocs~CX_2001` | Chubb External | Chubb | no | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/eqtm~us2~CX_1` | FMOL Health Career Portal | FMOL Health | yes |  |

## 3. New pages refused (never indexable before this bake)

None in this bake.

## 4. Compared with the live sitemap (2026-10-24)

This list is from the SEO round's integration bake (seo/integration, a git-archive export, live reads, 2026-10-24). The live sitemap that day (the 2026-10-18 publish) listed 485 company pages; this bake also makes 485 indexable: 24 gained and 24 lost. **None of the 24 is the name gate's doing.** Each fell below the 500-board ceiling's cut by open roles (every lost board carries about 200-310 open roles, the band at the cut), and each keeps a noindex page of its own from its cached listing (SEO-002) instead of falling back to the homepage copy. All 24 were first indexable at the 2026-10-18 publish, so this is rotation at the boundary of the existing ceiling rule, which main runs on every publish whatever this round ships. Under D7 they are listed for the owner: sign the rotation, or ask for a hysteresis rule (a page indexable today keeps its index until it falls some way below the cut), which would let the indexable count run a little past 500.

Lost (noindex, follow, own page): `ejgk~em2~CX_3`, `pinson`, `egug~us2~CX_1`, `recruiting2~SCH1015SALS~c9383a65-0ac1-43cb-93e6-1b4baa2974be`, `brightli~wd5~BrightliTalent`, `careers.gmr.net`, `ecwl~us2~CX_1`, `NBCUniversal3`, `fa-euxc-saasfaprod1~ocs~CX_1`, `ssctech~wd1~ssctechnologies`, `fa-evmr-saasfaprod1~ocs~CX_1`, `mufgub~wd3~MUFG-Careers`, `rosendin~wd1~Careers`, `ryder~wd5~RyderCareers`, `surge`, `card~wd5~Search`, `coxhealth~wd5~CoxHealth_External`, `egua~us2~CX_1`, `nyp~wd1~nypcareers`, `essentiahealth~wd1~Essentia_Health`, `careers.royalfarms.com`, `FrasersGroup`, `nxp~wd3~careers`, `5bbc401b-c24d-40ad-9c08-241bf939d60b` (each under /jobs/company/).

Gained: `dinebrands~wd503~RestaurantCareerSite`, `thirdchannel-inc`, `recruiting2~BUI1005BABW~621885b8-8801-434c-83f1-c5e38d84ac03`, `bakertilly~wd5~btcareers`, `nyuhs~wd12~nyuhscareers1`, `recruiting2~EDD1000EBLLC~6fb5a475-cea1-435e-89f4-fdc9d00253c1`, `mcgill~wd3~McGill_Careers`, `iawmqy~ocs~CX_1`, `speechify`, `fa-exvn-saasfaprod1~ocs~CX_1`, `SIXT`, `skilledwoundcare`, `aisle_and_abroad`, `eswt~us6~CX_1`, `virtua~wd1~Virtua_Health_External_Career_Site`, `jobs.footlocker.com`, `townepark~wd5~ext`, `hubinternational~wd1~HUBInternational`, `marmon~wd501~Marmon_Careers`, `papajohns~wd1~PapaJohnsCareers`, `carilionclinic~wd12~External_Careers`, `fa-ewgu-saasfaprod1~ocs~CX_2001`, `aptiv~wd5~APTIV_CAREERS`, `fa-evdi-saasfaprod1~ocs~CX_1`.

The figures move with the board: Lovable's publish re-reads the counts, so its own list will differ by a few boards at the cut.

## How the gate decides (`scripts/prerender-names.mjs`)

1. **Repair first.** A career-site label at the end of a stored name comes off: External, Career Site [US], Career Portal, All Functions, Talent Acquisition [Team], Opt N. The name in front of it is printed.
2. **Refuse narrowly.** A name is refused only when it cannot be anyone's: a file name or logo text (CMYK, "Screenshot at", or two words that describe an image file), a careers or jobs subdomain used as a name, or a bare generic word after the repair (All, Aerospace, Default, Careers...). A stored name that is a label as a whole ("Only External Postings") is judged whole and printed as stored. Domain-shaped names (Booking.com, Crypto.com) and names ending in Global or Business (Abt Global) are never refused.
3. **What a refusal does in this round.** A page indexable today keeps its index and is listed in table 1. A page new to the index is marked noindex, and a new posting of such a board gets no page.
