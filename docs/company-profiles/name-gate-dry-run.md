# Name gate dry run: pages indexable today that a stricter rule would drop

Bake of 2026-10-18, facets from rpc; 484 company pages indexable on the live site that day. Written by `scripts/prerender-name-gate-report.mjs` from the bake's `PRERENDER_NAME_GATE_REPORT` file.

Owner decision D7: no page indexable today drops out without the owner's sign-off. **Every page in the first table keeps its index in this round.** Sign the rows that may drop; the next round makes the gate act on the signed rows only.

## 1. Indexable today, and a stricter rule would drop it

| Page | Kind | Name printed | Why | What the rule would do | Sign (drop? yes/no) |
| --- | --- | --- | --- | --- | --- |
| `/jobs/posting/ukg/recruiting2~AME1104ANBT~9474d2f8-2ad2-46f8-bbe3-f435f50628bd/9e54289b-0ce2-47a2-95f1-85b41182a706` | posting | CMYK-WHT midnight background | logo or image text | lose its JobPosting markup and be marked noindex |  |
| `/jobs/posting/ukg/recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522/238cdd44-9089-429c-a963-8de91422a9af` | posting | Axia Logo Horizontal | logo or image text | lose its JobPosting markup and be marked noindex |  |
| `/jobs/company/eexs~us2~CX_3001` | company | All | generic word | be marked noindex |  |
| `/jobs/company/icfcjb~ocs~CX_1` | company | Aerospace | generic word | be marked noindex |  |

`Aerospace` may be The Aerospace Corporation, which calls itself "Aerospace" on its own careers site: a name override (the job-board group's `company_name_overrides`) would repair it instead of a drop. The same is the better fix for the other three, where the override can name the employer.

## 2. Names repaired (printed differently, index unchanged)

| Page | Stored name | Printed name | Indexable today | One word: check it names the employer |
| --- | --- | --- | --- | --- |
| `/jobs/company/epyc~us2~CX_1` | Clean Harbors External | Clean Harbors | yes |  |
| `/jobs/company/fa-espx-saasfaprod1~ocs~CX_1006` | Cummins All Functions | Cummins | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/fa-ewjt-saasfaprod1~ocs~CX_1` | EXL Talent Acquisition Team | EXL | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/fa-euwp-saasfaprod1~ocs~CX_1` | Mayo Career Site US | Mayo | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/recruiting2~BIG1003BIGC~63b1fe5f-a895-49e4-afdc-7059fb08eea2` | Big 5 Sporting Goods Opt 1 | Big 5 Sporting Goods | yes |  |
| `/jobs/company/eedu~em3~CX_1003` | WTW External | WTW | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/recruiting2~AUS1003AUIN~611d5a38-76c4-4f66-a55f-2bc012d98024` | Austin External | Austin | yes | yes (add an override if it reads as a place or another employer) |
| `/jobs/company/eqtm~us2~CX_1` | FMOL Health Career Portal | FMOL Health | yes |  |
| `/jobs/company/recruiting2~AUS1003AUIN~76c6c58c-a4d3-4a7c-b7a4-8640fc76a703` | Austin External | Austin | no | yes (add an override if it reads as a place or another employer) |

The last column is new (2026-10-18 review): a repair that leaves one word can read as a place or as a different employer. `Austin` reads as the city (the UKG tenant is Austin Industries: "Austin jobs: 382 open roles from their own hiring system"), and `Mayo` is Mayo Clinic. A `company_name_overrides` row for each ("Austin Industries", "Mayo Clinic") is the fix; `Cummins`, `EXL` and `WTW` are the employers' own short names. The bake's report file now carries `singleWord` per repair and the report script prints this column; the rows above are this bake's, marked by that rule.

## 3. New pages refused (never indexable before this bake)

None in this bake.

Regenerated on the integration branch (`design/integration` with main merged) by the bake of 2026-10-18 UTC (2026-10-17 local), from a fresh build of the branch with live read-only data. The table of 2026-10-12 had five rows: its two other rows (the UKG posting `.../7a287614-...` and `/jobs/posting/greenhouse/notexternal/8272003`) are not on this list (the list moves with the live postings), and a second UKG posting (`.../238cdd44-...`, "Axia Logo Horizontal") now does. The same bake logs 3 company pages still named by a tenant code (`abercrombie~wd108~anf`, `shm~wd5~Summit_CityMD`, `synnex~wd5~tdsynnexcareers`), not about 36: main's name rule keeps the rest indexable, as section 4 predicted.

## 4. Also indexable today and not after this bake, by rules this round did not add (comparison of 2026-10-12)

(Sections 1-3 are the report script's output; this section compares the live sitemap with the bake's sitemap by hand.)

Compared with the live sitemap of 2026-10-12 (484 company pages), the bake above (from `pd/bake` at its head, with origin/main's name rule laid over it, which is what the integration runs once main is merged) makes 485 company pages indexable: 4 gained, 3 lost. None of the 3 is the name gate's doing:

| Page | After this bake | Why (an existing rule, on that day's live counts) |
| --- | --- | --- |
| `/jobs/company/disney~wd5~disneycareerdc` | canonical to a larger Disney board | one employer's boards share one page: the board with the most open roles carries it |
| `/jobs/company/hpe~wd5~Jobsathpe` | canonical to a larger HPE board | the same rule |
| `/jobs/company/nvent~wd5~nVent` | noindex, follow (its own page, from its cached listing) | it fell out of the top 500 by open roles; such a page used to fall back to the homepage copy, and now keeps a page of its own (SEO-002) |

Without main's name rule (the S11-013 fix main already carries in `src/lib/company-display.ts`), the same bake also marked 32 pages indexable today noindex as "still named by a tenant code" (Intel, Mastercard, Medtronic, Cigna, Tapestry and 27 more). That rule is on main, so merging main first keeps them indexable. After the merge, the bake log should read "4 still named by a tenant code", not about 36.

## How the gate decides (`scripts/prerender-names.mjs`)

1. **Repair first.** A career-site label at the end of a stored name comes off: External, Career Site [US], Career Portal, All Functions, Talent Acquisition [Team], Opt N. The name in front of it is printed.
2. **Refuse narrowly.** A name is refused only when it cannot be anyone's: a file name or logo text (CMYK, "Screenshot at", or two words that describe an image file), a careers or jobs subdomain used as a name, or a bare generic word after the repair (All, Aerospace, Default, Careers...). A stored name that is a label as a whole ("Only External Postings") is judged whole and printed as stored. Domain-shaped names (Booking.com, Crypto.com) and names ending in Global or Business (Abt Global) are never refused.
3. **What a refusal does in this round.** A page indexable today keeps its index and is listed in table 1. A page new to the index is marked noindex, and a new posting of such a board gets no page.
