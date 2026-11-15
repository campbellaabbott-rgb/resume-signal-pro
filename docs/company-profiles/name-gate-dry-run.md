# Name gate dry run: pages indexable today that a stricter rule would drop

Made 2026-11-08 for the SEO/GEO audit of 2026-11-07 (B02 and B05) WITHOUT a bake: a bake reads the live board with POSTs marked as a build, which this round may not send. Instead the bake's own name rules (`bakeEmployerName`, `postingNameVerdict`, `postingFreshNameReason` at this commit) were run over every page the live sitemap named that day (490 company pages, 463 posting pages, each name from the live `prerender-ledger.json`, read as Googlebot) and over the 600 newest postings the board listed. Written by `scripts/prerender-name-gate-report.mjs` from a file of the bake's `PRERENDER_NAME_GATE_REPORT` shape. Two of a bake's checks need its live reads and are not here: duplicate company pages and a location in another country; the next bake with `PRERENDER_NAME_GATE_REPORT` set lists them.

Owner decision D7: no page indexable today drops out without the owner's sign-off. **Every page in the first table keeps its index in this round.** Sign the rows that may drop; the next round makes the gate act on the signed rows only.

## 1. Indexable today, and a stricter rule would drop it

| Page | Kind | Name printed | Why | What the rule would do | Sign (drop? yes/no) |
| --- | --- | --- | --- | --- | --- |
| `/jobs/posting/adp/07372372-77a5-45e9-8573-f67327c3c3ec/9207315772373_1` | posting | Group withMVSB wtag | logo or image text | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/adp/07372372-77a5-45e9-8573-f67327c3c3ec/9207365068817_1` | posting | Group withMVSB wtag | logo or image text | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/personio/deag-deutsche-entertainment-ag/2859520` | posting | https://www.deag.de/navi-bottom/investors/karriere.html?t=1 | web address | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/personio/deag-deutsche-entertainment-ag/2859515` | posting | https://www.deag.de/navi-bottom/investors/karriere.html?t=1 | web address | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/adp/566efbd3-0446-4f82-a192-39a723b842bb/9201576856792_1` | posting | CASES Gold+Coral+Burgundy BurgundyText | colour caption | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/adp/566efbd3-0446-4f82-a192-39a723b842bb/9201576860154_1` | posting | CASES Gold+Coral+Burgundy BurgundyText | colour caption | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/adp/d8eedab5-d750-47d2-ba1f-8bfec4820a1f/9200956687618_19` | posting | Klipboard No Strapline Full (1) | logo or image text | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/adp/6f74cd61-a82f-44c6-a153-7c21d5d0536d/9202028877944_1` | posting | VHB Email Signature | logo or image text | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/adp/6f74cd61-a82f-44c6-a153-7c21d5d0536d/9202028882126_1` | posting | VHB Email Signature | logo or image text | be marked noindex (its job markup is already withheld and its head names no employer) |  |
| `/jobs/posting/adp/b52bf164-681e-4815-aa6b-9ef065341ad3/9201152544202_9` | posting | AVITA Health Systems unstacked | logo or image text | be marked noindex (its job markup is already withheld and its head names no employer) |  |

## 2. Names repaired (printed differently, index unchanged)

| Page | Stored name | Printed name | Indexable today | One word: check it names the employer |
| --- | --- | --- | --- | --- |
| `/jobs/company/epyc~us2~CX_1` | Clean Harbors External | Clean Harbors | yes |  |
| `/jobs/company/fa-ewjt-saasfaprod1~ocs~CX_1` | EXL Talent Acquisition Team | EXL | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/fa-euwp-saasfaprod1~ocs~CX_1` | Mayo Career Site US | Mayo | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/fa-espx-saasfaprod1~ocs~CX_1006` | Cummins All Functions | Cummins | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/recruiting2~BIG1003BIGC~63b1fe5f-a895-49e4-afdc-7059fb08eea2` | Big 5 Sporting Goods Opt 1 | Big 5 Sporting Goods | yes |  |
| `/jobs/company/eedu~em3~CX_1003` | WTW External | WTW | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/fa-ewgu-saasfaprod1~ocs~CX_2001` | Chubb External | Chubb | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/eqtm~us2~CX_1` | FMOL Health Career Portal | FMOL Health | yes |  |

## 3. New pages refused (never indexable before this bake)

The 600 newest postings of 2026-11-08: 590 pass rule 1 and 576 of those may still get a new page. A posting whose name is the board's own code title-cased ("unreviewed tenant name", B02) gets none until an override or a reading names it; B05 named the Workday tenants among them (before its names the count was 60).

| Page | Name | Why |
| --- | --- | --- |
| `/jobs/posting/greenhouse/torq/6252220004` | Torq | unreviewed tenant name |
| `/jobs/posting/ashby/terac/3d362f56-b614-44fe-9c4f-c1f28bbb6819` | Terac | unreviewed tenant name |
| `/jobs/posting/ashby/terac/cfd7da23-3740-411c-b862-faf1ccabb418` | Terac | unreviewed tenant name |
| `/jobs/posting/smartrecruiters/Wabtec/3743990016719376` | Wabtec | unreviewed tenant name |
| `/jobs/posting/breezy/deep-end-talent-strategies/5c7043b43ba9-director-of-public-services-at-hussey-mayfield-memorial-public-library` | Deep End Talent Strategies | unreviewed tenant name |
| `/jobs/posting/greenhouse/datadog/8351509` | Datadog | unreviewed tenant name |
| `/jobs/posting/bamboohr/alstonco/1411` | Alstonco | unreviewed tenant name |
| `/jobs/posting/workable/continuum-resource-network/CF95035152` | Continuum Resource Network | unreviewed tenant name |
| `/jobs/posting/ashby/renuity/6377714f-5b1e-4944-bc69-5c157823e337` | Renuity | unreviewed tenant name |
| `/jobs/posting/greenhouse/rackner/4752442005` | Rackner | unreviewed tenant name |
| `/jobs/posting/ashby/liquid-ai/288e7be0-5547-4fe5-b8db-fca0a9ae663f` | Liquid Ai | unreviewed tenant name |
| `/jobs/posting/greenhouse/rackner/4752440005` | Rackner | unreviewed tenant name |
| `/jobs/posting/greenhouse/waymo/8357613` | Waymo | unreviewed tenant name |
| `/jobs/posting/adp/07372372-77a5-45e9-8573-f67327c3c3ec/9206144106450_1` | Group withMVSB wtag | logo or image text |

## 4. Carried posting pages whose name nobody reviewed (INFO, not a drop)

74 of the 463 sitemap posting pages, on 44 boards, print a name that is the board's own code with a capital letter. B02 refuses such a name only for a NEW page; a carried page keeps its page and its markup (S11-013: most are real names, as Intel, Tapestry and Alcoa are), and falls out as its posting closes. A reading of the employer's own site moves a real one into `REAL_TENANT_NAMES` (src/lib/company-display.ts) and a wrong one gets an override.

| Board token | Name printed | Pages |
| --- | --- | --- |
| `tapestry~wd108~Tapestry_Careers` | Tapestry | 8 |
| `alcoa~wd5~Careers` | Alcoa | 7 |
| `leidos~wd5~External` | Leidos | 5 |
| `payoneer` | Payoneer | 3 |
| `suddath~wd5~Suddath` | Suddath | 3 |
| `ryder~wd5~RyderCareers` | Ryder | 3 |
| `agilent~wd5~Agilent_Careers` | Agilent | 3 |
| `dyson~wd3~dyson_careers` | Dyson | 2 |
| `americaatwork` | Americaatwork | 2 |
| `tide` | Tide | 2 |
| `ameriprise~wd5~Ameriprise` | Ameriprise | 2 |
| `terac` | Terac | 2 |
| `aristocrat~wd3~aristocratexternalcareerssite` | Aristocrat | 1 |
| `menasha~wd12~MenashaCorp` | Menasha | 1 |
| `hcsc~wd1~HCSC_External` | HCSC | 1 |
| `coupang` | Coupang | 1 |
| `cinemark~wd1~cinemark` | Cinemark | 1 |
| `databricks` | Databricks | 1 |
| `swisscom~wd103~SwisscomExternalCareers` | Swisscom | 1 |
| `purple~wd1~purplecareers` | Purple | 1 |
| `nexperia~wd3~careers` | Nexperia | 1 |
| `cambro~wd5~Cambro_Careers` | Cambro | 1 |
| `ameresco~wd5~Ameresco` | Ameresco | 1 |
| `revantage~wd1~Revantage` | Revantage | 1 |
| `montage~wd1~Montage_International` | Montage | 1 |
| `capco` | Capco | 1 |
| `lnw~wd5~LightWonderExternalCareers` | LNW | 1 |
| `Wise` | Wise | 1 |
| `rasan` | Rasan | 1 |
| `tamara` | Tamara | 1 |
| `similarweb` | Similarweb | 1 |
| `copeland~wd5~Copeland_External_Careers_Page` | Copeland | 1 |
| `dow~wd1~ExternalCareers` | Dow | 1 |
| `Konecranes` | Konecranes | 1 |
| `mechanism-ventures` | Mechanism Ventures | 1 |
| `boostlingo` | Boostlingo | 1 |
| `zoetis~wd5~zoetis_intl` | Zoetis | 1 |
| `vermeer~wd5~externalcareersite` | Vermeer | 1 |
| `fnz~wd3~fnz_careers` | FNZ | 1 |
| `svha~wd3~SVHA_SVHA` | Svha | 1 |
| `litera~wd12~Litera_Careers` | Litera | 1 |
| `creatoriq` | Creatoriq | 1 |
| `alkegen~wd5~alkegen` | Alkegen | 1 |
| `Wabtec` | Wabtec | 1 |

## 5. What B02 and B05 changed in this list

- Table 1 is new in this round: the ten posting pages the gate now refuses carry a web address (`personio/deag-deutsche-entertainment-ag`), a logo file's caption (four ADP boards: "VHB Email Signature", "Group withMVSB wtag", "AVITA Health Systems unstacked", "Klipboard No Strapline Full (1)") or a caption listing colours ("CASES Gold+Coral+Burgundy BurgundyText"). Under D7 each keeps its index this round, without job markup and with "the employer" in its head; the owner signs which may drop. Their employers' own names (DEAG Deutsche Entertainment AG, Villas of Holly Brook) are bare tokens, which no override can name: they are renamed in job-board's catalogue at job-board .102 (~/.config/resumebooster/seo-connect-build/corpora/bare-token-renames-for-job-board-102-2026-11-08.json).
- The gate's new rules were run over every stored catalogue name (44,523 boards) against main's: fourteen names moved from printable to refused, all URLs or logo captions, and nothing main refused became printable (~/.config/resumebooster/seo-connect-build/corpora/name-gate-catalogue-before-after-2026-11-08.json).
- B05 (migration 20261108100000) names 59 boards by the name their employer uses, read on the employer's own Workday site: the company pages the audit saw titled by a code (nyuhs is United Health Services, papajohns Papa John's, signetjewelers Signet Jewelers, wvumedicine WVU Medicine, ssctech SS&C Technologies, bakertilly Baker Tilly US, ensemblehp Ensemble Health Partners, globalfoundries GlobalFoundries, hubinternational HUB International, ivyrehab Ivy Health, pyebarkerfire Pye-Barker Fire & Safety), the four that named the wrong company (starfish is Torch Technologies, stars Stars Behavioral Health Group, aaregional's site Piedmont Airlines, djeholdings' sites Edelman and Zeno Group), and the posting and table employers. 35 of the 463 sitemap posting pages print a different name because of it.
- `/jobs/company/emqk~ca3~CX_1` keeps "HealthCareersInSask.ca", the site's own name: its requisitions name two employers (the Saskatchewan Health Authority and the Saskatchewan Cancer Agency), so no one override is true of all of them.
- The previous dry run (the bake of 2026-10-25, whose table 1 held the six D7 pages that the trust round of 2026-10-25 made trusted: Axia Women's Health, The Place, Bristol Myers Squibb, Reyes Beverage Group, Honeywell Aerospace and LCS) is this file as of commit fff09397; the tests and verify section 99zz that cite "table 1" mean that list.

