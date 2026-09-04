// Deterministic field/category mapping so a nurse, an accountant, or a
// warehouse lead can filter straight to their lane. Department is the
// primary signal (ATS departments are human-curated); title keywords refine
// or fill in. Pure module — unit-tested from vitest.

// Bump on EVERY rules change: a completed refresh pass compares this
// against the version stamped in job_board_meta and, on mismatch, sweeps
// the stored "other" rows through the current rules — so categorization
// improvements reach the existing corpus, not just newly inserted rows
// (the insert-only refresh never rewrites them otherwise).
// v9 (2026-08-23): the ~400-term residue audit, survivors only. Every term
// shipped with a live count inside category=other, a mapped category argued
// against every other reading, and 8+ hand-judged real matches; ambiguity
// resolved toward NOT adding. Two tiers: an English block of \b-anchored
// role terms, and a compound/non-English tier extending the v8 unanchored
// tail across DE/FR/NL/PL/FI/NO/SE/DK/ES/IT/PT. Measured recovery: 22,382
// unique postings (22,807 raw minus 425 live-counted cross-rule overlaps),
// 15.3% of the 145,973-row servable "other" pile as of 2026-08-23.
//   EXCLUDED, measured and named — do not re-propose: a researcher fallback
//   extension (head-noun genuinely mixed, no guard list reaches the bar);
//   bare counselor, attendant, handler, helfer, assistenz, berater, adviseur,
//   pedagog, butik/butikk, police, safety, survey, chargé, hoitaja — each
//   splits across fields or marks an employer, not a role; and capital
//   markets, the one precision-check survivor with hard wrong-field errors
//   (2/17 fresh-draw rows were law-firm capital-markets associates —
//   pulled at assembly, ambiguity resolves toward not adding). Known 1-row
//   soft spots accepted without guards: one precision-optics manufacturing
//   row under the optician stem (545/546), one records-custodian row under
//   the custodial family.
//   AFTER THIS PASS, RULES GROWTH STOPS: 56% of the remaining residue is
//   singleton title forms — the next 40 points of recovery cost an order of
//   magnitude more per posting than these did.
// v8 (2026-08-23): the audit's stratified re-measurement, applied. Two classes:
//   * WORD-BOUNDARY MISSES in rules that already name the concept: bare "Audit
//     Manager" (838 board titles unfiltered — the rule required auditOR/ING;
//     the replacement excludes "audition"), "Team/Shift Leader" (1,132 — the
//     rule stopped at "lead"), project/program(me) MANAGEMENT and -leader
//     forms (483), plural "Operators" (56 — \b does not fall between r and s).
//   * COMPOUND AND NON-ENGLISH stems, each sized live before inclusion and
//     appended AFTER the English rules so first-match-wins keeps precedence:
//     técnico 577, techniker 304, pfleg 190 (Pflegefachkraft — the missing-
//     boundary shape v7 fixed for therapist), logistik 159, säljare 141,
//     opérateur 139, ingenieur-in-compound 138, sachbearbeiter 120, myyjä 38,
//     recepcionista 28, vendedor 13, zahnmedizin 9.
//   EXCLUDED, measured and named: bare leiter/charge/berater/responsable/
//   fachkraft/kaufmann — real words with no field in them; "Responsable" is
//   "Manager" in French, and manager is the pile's biggest word for a reason.
//   ALSO A CORRECTION: v7's header claimed 6.5% recovery. A properly
//   stratified sample (per-source allocation, 36 keyset buckets, <=4-row
//   chunks) measures v7 at 4.27% +/- 0.28 — the 3,000-row sample was company-
//   clustered, the exact bias that made "career fair" look 30x too common in
//   another draw from this table. ~6,740 postings, essentially all healthcare,
//   still real.
// v7 (2026-08-22): allied-health compounds, clinical credentials and named
// clinical roles, from a 3,000-row live sample of the 159,153-row "other" pile.
// Measured recovery on that sample: 6.5%, essentially all healthcare — roughly
// 10,300 postings board-wide moving from unfilterable into a field. Three
// distinct causes, not one:
//   * COMPOUNDS the \b anchor cannot reach. "Physiotherapist" and
//     "Ultrasonographer" contain therapist and sonograph with no word boundary
//     in front of them, so rules that already name those terms never fired.
//   * CREDENTIALS a clinician actually types: RN alone was 3,267 rows of the
//     bucket, LPN 574, CNA 373.
//   * NAMED ROLES the list simply lacked — Technologist 1,711, Surgical 565,
//     Dentist (the rule said "dental", which does not match "Dentist").
// EXCLUDED ON PURPOSE, having measured them: bare PRN, which marks a healthcare
// EMPLOYER rather than a healthcare role and dragged in "Food Service Worker |
// PRN" and "Scheduling Specialist PRN"; and EMT, which put "Firefighter EMT -
// Wilmington Fire Dept" in healthcare. A credential does not decide the job.
// v6 (2026-07-26): grocery/retail floor roles + Spanish title anchors, from a
// 1,000-row live sample of the 164k-row "other" pile. The dominant unclaimed
// clusters were grocery floor titles (clerk 69, stocker 21, deli 19, meat 17,
// produce 16, team member ~53, shopper 13), single-word "Salesperson" (18 —
// \bsales\b never matches inside the compound), delivery associates, and
// Spanish-language titles (ejecutivo 16). "Other" outnumbered engineering.
export const CATEGORIZE_VERSION = 9;

// Shared with public-api via ../_shared/board-domains.ts — see that file.
export { JOB_CATEGORIES } from "../_shared/board-domains.ts";
import { JOB_CATEGORIES } from "../_shared/board-domains.ts";

export type JobCategory = (typeof JOB_CATEGORIES)[number];

// Order matters: first match wins. More specific fields come before
// engineering so "Clinical Research Nurse" or "Data Scientist" don't get
// swallowed by broad tech terms; engineering precedes security so
// "Security Engineer" lands in engineering while "SOC Analyst" lands in
// security.
const RULES: Array<[JobCategory, RegExp]> = [
  ["healthcare", /\b(nurs(e|ing)\w*|clinic\w*|physician\w*|doctor|psychiatr\w*|therap(ist|y)|pharmac\w*|medical|dental|veterinar\w*|care (manager|coordinator|navigator|team)|behavio(u?r)(al)? (technician|analyst|specialist)|\brbt\b|\bbcba\b|patient|case manager|direct support (professional|worker|staff)|mental health|hospice|caregiver|home health|midwife|paramedic|phlebotom\w*|optometr\w*|optician\w*|neuropsycholog\w*|audiolog\w*|radiolog\w*|sonograph\w*|chiropract\w*|podiatr\w*|orthodont\w*|hygienist\w*|krankenpfleg\w*|verpleegkundig\w*|enfermer\w*|infirmier\w*|arzt|médic\w*)\b/i],
  // ALLIED-HEALTH COMPOUNDS. Sits after the rule above and matches WITHOUT a
  // leading \b, because that is precisely what the rule above cannot do:
  // "physiotherapist" and "ultrasonographer" have no boundary before the part
  // that names the profession.
  ["healthcare", /(?:physio|tele|radio|hydro|chemo|onco|psycho|massage)?therap(?:ist|y)|sonograph|ultrasound/i],
  // CLINICAL CREDENTIALS. Two- and three-letter, so every one is \b-anchored
  // and each was checked against the live bucket for collisions.
  ["healthcare", /\b(?:rn|lpn|lvn|cna|cma|hha|crna|dnp|bsn|cota|ota|pta)\b/i],
  // NAMED CLINICAL ROLES AND SETTINGS.
  ["healthcare", /\b(?:technologist|surgical|perioperative|dietit\w*|nutritionist|respiratory|anesthe\w*|radiograph\w*|mammograph\w*|telemetry|icu|nicu|picu|acute care|long term care|assisted living|skilled nursing|urgent care|home care|dentist\w*|hospitalist|pathologist|obgyn|ob\/gyn|speech language|occupational therapy|physical therapy|sonographer|perfusionist|orthopa?edic\w*)\b/i],
  // Ahead of science on purpose: bare "scientist" in the science rule was
  // catching "Data Scientist", which belongs with the data roles users
  // actually look for.
  ["data_ai", /\b(data scien\w*|machine learning scientist|research scientist, (ai|ml))\b/i],
  ["science", /\b(scientist|research associate|laborator\w*|lab (tech\w*|manager|operations)|biolog\w*|chemist\w*|genomic\w*|bioinformatic\w*|microbiolog\w*|toxicolog\w*|r&d)\b/i],
  ["education", /\b(teachers?|teaching|instructor|tutor\w*|curriculum|professor|educator|instructional|preschool|school|learning designer|lehrer\w*|leraar|profesor\w*|enseignant\w*)\b/i],
  ["data_ai", /\b(data (& |and )?ai|data platform|data (scien\w*|engineer\w*|analyst\w*|analytics)|machine learning|ml engineer\w*|ai\b.{0,20}(specialist|engineer|research\w*|scientist|automation)|artificial intelligence|research (scientist|engineer)|analytics engineer\w*|business intelligence|quant(itative)? (research\w*|analyst\w*|trad\w*|developer)|datenanalyst\w*)\b/i],
  ["design", /\b(artist|design(er|ers)|design (lead|manager|director)|ux|ui|user experience|user research\w*|creative director|art director|graphic design\w*|illustrator|brand design\w*|motion design\w*)\b/i],
  ["product", /\b(product manager\w*|product management|product owner|product lead|technical program manager\w*|program(me)? (manager\w*|management|lead(er)?|officer)|program(me)?[\w &-]{0,20}management|product operations)\b/i],
  ["marketing", /\b(marketing|growth|seo|sem\b|content (strategist|writer|marketer|lead)|copywrit\w*|communications|public relations|social media|brand (manager|lead)|demand gen\w*|lifecycle|events? (manager|coordinator)|comunica\w*|kommunikation\w*|communicatie)\b/i],
  ["sales", /\b(sales\b|salesperson|account (executive|manager|director)|business development|partnerships?|revenue|solutions? (architect|consultant|engineer)|pre-?sales|customer acquisition|gtm|vertrieb\w*|verkäufer\w*|commercial\w*|ejecutivo\/?a? de (ventas|cuentas)|asesor\w* (comercial|de ventas))\b/i],
  ["customer", /\b(customer (success|support|experience|service|care)|client servic\w*|technical support|support (engineer\w*|specialist|agent)|community (manager|lead)|implementation (manager|specialist)|onboarding|kundenservice|klantenservice|premium support|community support)\b/i],
  ["finance", /\b(teller|banker|personal banker|relationship banker|loan officer|mortgage \w+|collections? (manager|specialist|analyst|agent|representative|officer)|claims (\w+ )?(adjuster|officer|examiner|consultant|specialist|representative|manager|processor)|subrogation|adjuster|financ\w*|accountant\w*|accounting|accounts (payable|receivable)|bookkeep\w*|controller|treasury|fp&a|tax|payroll|billing|audit(?!ion)\w*|underwrit\w*|actuar\w*|credit (risk|analyst)|trad(er|ing)\w*|portfolio manager\w*|investment\w*|broker\w*|investor relations|buchhalt\w*)\b/i],
  ["legal", /\b(legal|counsel|attorney|lawyer|solicitor|barrister|paralegal|compliance|regulatory|privacy (counsel|officer)|contracts? (manager|specialist)|jurist\w*)\b/i],
  ["people_hr", /\b(recruit\w*|talent|people( (ops|operations|partner|team|experience))?|human resources|hrbp|hr (manager\w*|generalist\w*|specialist\w*|business)|total rewards|compensation|benefits (analyst|manager|specialist)|l&d|workplace|personalreferent\w*)\b/i],
  ["admin", /\b(administrative|executive assistant|office (manager|coordinator|administrator)|receptionist|executive operations)\b/i],
  // Skilled trades & field services — MUST precede hospitality_retail, or
  // "Part-Time Oil Change Team Member" matches "team member" and lands in
  // retail. Derived from a 1,250-row sample of the uncategorised pile
  // (2026-07-24), which was 35% of the board.
  ["operations", /\b(cdl|truck(ing)? driver|owner[- ]operator|flatbed|reefer|otr\b|dispatcher|superintendent|construction (manager|superintendent|supervisor)|oil change|body shop|auto body|workshop|auto(motive)? (tech\w*|service)|lube tech\w*|tire tech\w*|crew member|general laborer|labou?rer|foreman|journey(man|person|woman)|electrician|plumb(er|ing)|welder|carpenter|hvac|pipefitter|millwright|machinist|equipment operator|heavy equipment|operators?\b|excavat\w*|scaffold\w*|glazier|roofer|mason\b|concrete|restoration (crew|tech\w*)|installer)\b/i],
  // Grocery/retail floor roles sit AFTER the trades rule on purpose: "Oil
  // Change Team Member" must keep landing in operations before "team member"
  // is claimed here.
  ["hospitality_retail", /\b(barista|server|chef|cook|kitchen|coffee shop|store (manager|associate|lead|team)|retail|restaurant|hotel|housekeep\w*|front desk|(shift|team) (lead(er)?|supervisor)|cashier|merchandis\w*|kellner\w*|vendeur\w*|vendeuse\w*|koch|kok\b|team member|clerk\b|stocker|bagger|deli\b|meat (cutter|clerk|manager|associate)|produce (clerk|manager|associate|team)|bakery|grocery|shopper|busser|dishwasher|host(ess)?\b|barback|cajer\w*|reponedor\w*|dependient\w*|vendedor\w*)\b/i],
  ["operations", /\b(project ?(manager\w*|management|coordinator|lead(er)?|director|officer)|operat(ions|ional)\w*|continuous improvement|supply chain|logistics|warehouse|fulfil?lment|drivers?|courier|dispatch\w*|fleet|facilities|manufacturing|production (planner|supervisor|technician)|quality (assurance|control)|buyer|sourcing|procurement|field (ops|service|technician)|maintenance|mechanic\w*|\w*monteur\w*|\w*mitarbeiter\w*|\w*medewerker\w*|fahrer\w*|chauffeur\w*|lagermitarbeiter\w*|magazijn\w*|produktionsmitarbeiter\w*|reinigung\w*|einkauf\w*|district manager\w*|district management|almacén|entrepôt)\b/i],
  ["engineering", /\b(engineer\w*|developer\w*|software|devops|sre|infrastructure|frontend|backend|full[- ]?stack|mobile|ios|android|platform|architect\w*|qa\b|sdet|(it|network|electronics|desktop|datacenter|data center) technician|information technology|service desk|helpdesk|help desk|desktop support|it (administrator|support|manager|specialist|analyst)|entwickler\w*|ingenieur\w*|ingenier\w*|ingénieur\w*|développeur\w*)\b/i],
  ["security", /\b(\w*security\w*|cyber\w*|soc analyst|threat|incident response|penetration|infosec|trust (and|&) safety|fraud (analyst\w*|investigator\w*)|investigat\w*)\b/i],
  // Bare "technician" is the single most common word in the uncategorised pile
  // (431 of a 3,000-row sample). It sits HERE, after healthcare, engineering
  // and security, so "Patient Care Technician", "Pharmacy Technician" and
  // "IT Technician" keep the homes they already had; only the field/service
  // technicians nothing else claims land in operations.
  ["operations", /\btechnician\b/i],
  // ── v8 COMPOUND AND NON-ENGLISH STEMS ─────────────────────────────────────
  // Appended after the English rules on purpose: first match wins, so
  // "Tecnico Commerciale" is claimed by the sales rule's commercial\w* before
  // the técnico fallback can file it under operations.
  ["healthcare", /pfleg|zahnmedizin|l[äa]hihoitaja|sairaanhoitaja/i],
  ["engineering", /ingenieur/i],
  ["operations", /techniker|t[ée]cnico\b|op[ée]rateur\w*|pr[eé]parateur|logistik/i],
  ["admin", /sachbearbeiter|\brecepcionista\w*\b/i],
  ["sales", /\b(myyj[äa]\w*|vendedor\w*)\b/i],
  // ── v9 ENGLISH RESIDUE TERMS ──────────────────────────────────────────────
  // Survivors of the ~400-term audit; counts are live inside category=other
  // (2026-08-23). First match wins, so the intra-block order below is part
  // of the correctness argument, not style.
  // Healthcare: social work 292, peer-support family 77 ("peer review"
  // cannot fire — reviewer is not in the alternation), athletic trainer 145
  // (licensed allied-health; gym "Personal Trainer" stays excluded), the
  // clinical-counselor qualifiers 39. Bare counselor stays excluded — it
  // splits school/camp/clinical.
  ["healthcare", /\bsocial work\w*\b|\bpeer (support|specialist|recovery|counsel(l?or)?)s?\b|\bathletic trainers?\b|\b(addictions?|substance abuse|drug and alcohol|licensed professional|licensed clinical|guidance|crisis|pastoral) counsel(l?or)?s?\b/i],
  // Education: admissions/camp counselor 59 — AFTER the clinical-counselor
  // rule, and BEFORE the platform rule below (a student-assistance-program
  // acronym collides with an ERP vendor name; ordering is the guard).
  // faculty/adjunct/lecturer 479.
  ["education", /\b(admissions?|camp) counsel(l?or)?s?\b|\b(faculty|adjunct|lecturers?)\b/i],
  // people_hr: HRIS 88 — MUST precede the platform rule or Workday-HRIS
  // hybrids drift to engineering. Dutch HR adviseur 23 rides along; bare
  // adviseur stays excluded (five-category split, measured).
  ["people_hr", /\bhris\b|\bhrm?[- ]?adviseur/i],
  // data_ai: business (systems) analyst 894 — MUST precede the systems-
  // analyst and banking rules below; data_ai is the board's home for
  // BI/data analysts.
  ["data_ai", /\bbusiness (systems )?analysts?\b/i],
  // science: clinical-trials statistics 135; the stem form catches a live
  // typo'd spelling. Statistical programmers are new recovery — nothing
  // claims bare "programmer".
  ["science", /\b((bio)?statisticians?|biostatist\w*|statistical programm\w*)\b/i],
  // marketing: media/event/wedding planners 34 — MUST precede the bare-
  // planner operations rule at the end of this block (it is that rule's
  // carve-out). editors 356 (content production, same family as
  // copywriters). paid social/media/search 216 (only the three channel
  // nouns can follow "paid", so Paid Training cannot fire).
  ["marketing", /\b(media|events?|wedding) planners?\b|\beditors?\b|\bpaid (social|media|search)\b/i],
  // sales: account/sales-development family 33, leasing 544 (residential
  // property), insurance SELLING roles 249 — MUST precede the bare-insurance
  // finance rule below: it carves the selling lane out of 688 raw rows
  // first.
  ["sales", /\b(account development|sales development) (rep\w*|associate|manager)s?\b|\bleasing\b|\binsurance (agents?|advisors?|agency|producers?|brokers?|sales)\b/i],
  // hospitality_retail: beauty advisor 261, stylist/salon family 313,
  // lifeguard/aquatics 193, guest-facing attendants 427 — bare "attendant"
  // (2,000+ rows) stays excluded, it has no field in it. kokk/kokki 15
  // (NO/FI cook; both anchors load-bearing so the Finnish city name cannot
  // fire).
  ["hospitality_retail", /\bbeauty advisors?\b|\b(stylists?|salon|barbers?|cosmetolog\w*|nail tech\w*|esthetician)\b|\b(lifeguards?|aquatics?)\b|\b(room|concession|f&b|food|beverage|guest|golf|cart|pool|recreation|spa|lobby) attendants?\b|\bkokki?\b/i],
  // engineering: systems analyst 333 (AFTER business-analyst above —
  // ordering resolves the shared three-word shape), then the platform/ERP
  // tier 1743, the largest single recovery in the batch. Sits AFTER the
  // HRIS and admissions-counselor rules, BEFORE banking (ERP-finance
  // consultants are platform roles first).
  ["engineering", /\bsystems? analysts?\b/i],
  ["engineering", /\b(sap|salesforce|netsuite|servicenow|peoplesoft|dynamics 365|d365|erp|workday|sharepoint)\b|\b(?:systems?|database|network|linux|unix|windows) administrators?\b/i],
  // finance: banking 680 (after the analyst/platform rules claim the
  // hybrids), loans 219 (lending back office), bare insurance 439 (688 raw
  // minus the 249 the sales carve-out claims first).
  ["finance", /\bbanking\b|\bloans?\b|\binsurance\b/i],
  // legal: data protection 36 — companion to the privacy (counsel|officer)
  // term.
  ["legal", /\bdata protection\b/i],
  // security: sworn police ranks 82 — bare "police" stays excluded, an
  // employer marker (the same trap as PRN). asset protection / loss
  // prevention 177 (the data-loss-prevention analyst rows are cyber, which
  // is security anyway).
  ["security", /\bpolice (officer|chief|lieutenant|sergeant|captain|cadet|deputy)s?\b|\b(asset protection|loss prevention)\b/i],
  // customer: professional services 109 — post-sales implementation family.
  ["customer", /\bprofessional services\b/i],
  // operations, the long tail — construction, logistics, facilities,
  // transport. Counts: inspectors 892, estimators 651, surveyors 368 (bare
  // "survey" stays out), schedulers 341.
  ["operations", /\binspectors?\b|\bestimat(or|ors|ing)\b|\bsurveyors?\b|\bschedulers?\b/i],
  // EHS family 1243. The role-noun requirement after "safety" is the point:
  // bare safety pulls AI-safety research titles, live in the pile.
  ["operations", /\b(health (and|&) safety|ehs|hse|fire safety|process safety|food safety|life safety|safety (manager|specialist|coordinator|advisor|officer|supervisor|technician|lead|director|professional|rep|representative))s?\b/i],
  // branch manager 407 (unit-site P&L leadership, the district-manager
  // precedent — bank branches included), shipping 217, qualified handlers
  // 673 (bare "handler" stays out — claims/complaint handlers), assemblers
  // 681, inventory 580, purchasing 197, packers/pickers/loaders/forklift
  // 418, porters 278 (leading boundary verified — transporter and reporter
  // cannot match).
  ["operations", /\bbranch (manager|management)\b|\bshipping\b|\b(material|package|freight|baggage|cargo|mail|order) handl\w*|\bassemblers?\b|\binventory\b|\bpurchasing\b|\b(packers?|pickers?|loaders?|forklift)\b|\bporters?\b/i],
  // custodial/grounds family 939, non-guest attendants 507 (qualifier list
  // disjoint from the retail attendant rule above), automotive service lane
  // 247, pilots 128 (aircraft/marine; program-manager pilots are claimed
  // upstream).
  ["operations", /\b(custodian\w*|janitor\w*|cleaners?|cleaning|groundskeep\w*|landscap\w*|sanitation)\b|\b(car wash|parking|building|laundry|fuel|lot|toll|dock|yard|wash bay) attendants?\b|\b(service|parts) advisors?\b|\bpilots?\b/i],
  // Bare planner 881 raw, ~847 net of the marketing carve above. Weakest
  // term in the block (~89-94%); designated FIRST TO DROP if the post-sweep
  // precision audit tightens.
  ["operations", /\bplanners?\b/i],
  // ── v9 COMPOUND AND NON-ENGLISH STEMS ────────────────────────────────────
  // Healthcare stems: optiker 546 (DE/Nordic opticians; one wrong-field row
  // board-wide, noted in the v9 header, not worth a guard — MUST precede
  // filialleit below), arzt/ärzt 73 (physician compounds the v8 anchored
  // form cannot reach; both umlaut forms load-bearing), aide-soignant 23,
  // farmacista 52, Swedish nurse compounds 124 (no leading boundary on
  // purpose), verpleeg 16 (catches a live typo the anchored v8 rule
  // misses), apotek 11 (NO pharmacy — MUST precede the Nordic tekniker rule
  // below; the German spelling with an h cannot match), Finnish -hoitaja
  // prefix whitelist 11 (bare hoitaja stays excluded: hotel-housekeeping
  // compounds).
  ["healthcare", /optiker|arzt|ärzt|aide[- ]soignant|farmacista|sk[öo]tersk|verpleeg|apotek|(ty[öo]terveys|terveyden|hammas|osaston|opetus)hoitaja/i],
  // Legal stems: anwalt/anwält 61 — MUST precede the assistenz rule at the
  // end of this tier (legal-office assistant compounds are claimed here
  // first; the collision row is live). abogado family 33, avocat 26 (the
  // fruit reading does not occur in titles).
  ["legal", /anwalt|anwält|\babogad\w*|\bavocate?s?\b/i],
  // Finance stems: buchhalt 52 (unanchored — accounting compounds beyond
  // the v8 anchored reach), the tax enumeration 71 (enumerated on purpose:
  // it refuses the steering/control reading, and MUST precede the assistenz
  // rule), comptable/contable 149, gestion de patrimoine 93, sinistres 40
  // (FR insurance claims — MUST precede the client-relations fragment
  // below), paie 30 (anchor verified against the payment noun).
  ["finance", /buchhalt|steuerfach|steuerberat|steuerassist|steuerrecht|steuerrefer|(umsatz|einkommen|ertrag|lohn)steuer|\bsteuern\b|comptable|\bcontable\b|gestion de patrimoine|\bsinistres?\b|\bpaie\b/i],
  // Sales stems: verkauf 108 (MUST precede kundenberater, the warehouse
  // stem and the assistenz rule), FR retail sales advisors 238 (MUST
  // precede the client-relations fragment; escaped-class accents because JS
  // \w misses them), NL verkoop/verkoper 51 (MUST precede the Dutch care
  // stem — the care-sales hybrid rows are live), NO selger 50, SE säljare
  // 104 (MOVED here from the v8 anchored group), pharma/medical-device
  // field reps 30 (a selling role, not a treating one; bare berater stays
  // excluded).
  ["sales", /verkauf|conseill[eè]?re?\S*\s+(?:de (?:la )?|aux |à la |a la )?ventes?\b|verkoop|verkoper|selger|s[äa]ljare|(pharma|medizinprodukte)berater/i],
  // Customer stems: kundenberater 109 (after verkauf; bank/wealth advisors
  // resolve to customer on the kundenservice precedent), FR returns-desk
  // advisors 137, chargé de clientèle 20 (paired form only — bare chargé
  // stays excluded), FR/CA service & client relations 100 (AFTER the sales
  // and sinistres fragments — both collision shapes are live; plural
  // "Services Client" and reversed order cannot fire), Nordic customer-
  // service medarbetare 8 — MUST precede the shop-floor medarbetare rule
  // below; the ordering is the point.
  ["customer", /kundenberater|conseill[^,–-]{0,10}aux retours?|charg[ée]e?\S*\s+de\s+client[èe]le|\b(?:service|relations?) (?:à la |a la )?client|(kundtj[äa]nst|kundservice|kundlojalitet|support)medarb/i],
  // Retail/hospitality stems: filialleit 40 (39/40 store leadership; one
  // live bank-branch row noted), Nordic shop-floor medarbetare 96, butikk
  // leadership/consultants 40 (bare butik/butikk stays excluded — the
  // store-name and controller traps), cuisinier 35, serveur/serveuse 18
  // (the computer reading does not occur, 0/18).
  ["hospitality_retail", /filialleit|(butikk|butiks|ferskvare|kj[øo]kken|kafe|kantine|restaurang|service)medarb|butik[ks]{1,2}(sjef|chef|leder|konsulent)|cuisini[eè]r|\bserveu(?:r|se)/i],
  // Education stems: erzieher 11 (Kita — the preschool-teacher twin),
  // lärare 29 (vocational-subject rows teach the subject; same call as
  // lehrer/leraar).
  ["education", /erzieher|l[äa]rare/i],
  // Dutch care block — order load-bearing: delivery-round compounds 20 land
  // in operations FIRST; then the care stem 200 (~98%: the sales rule above
  // claims the care-sales hybrids; fixed-length lookbehind, Deno-safe);
  // then pedagogic roles 21 AFTER the care stem (the live disability-care
  // rows must be claimed as care first). Bare pedagog stays excluded.
  ["operations", /bezorg/i],
  ["healthcare", /(?<!be)zorg/i],
  ["education", /pedagogisch|specialpedagog/i],
  // Security stem: PL guard posts 55. The lookahead excludes the genitive
  // environmental-protection tail — 4 live rows are environmental
  // specialists, wrong field.
  ["security", /ochron(?!\w* środowisk)/i],
  // Engineering stem: PT engineers 49, joins the ingenieur stem family.
  ["engineering", /engenheir/i],
  // Operations stems — trades and logistics across DE/NL/PL/FI/NO/SE/DK.
  // mechaniker/mechatroniker 337 (skilled trades, the electrician
  // precedent), elektroniker/elektriker 220 — ONE merged rule covers the
  // German and Scandinavian lanes; the substring is identical and summing
  // the lanes double-counts. bauleiter 62 and projektleit 127 — both MUST
  // precede the hochbau/tiefbau rule, whose 63 raw rows they claim ~29 of.
  ["operations", /mecha(nik|tronik)er|elektroniker|elektriker|bauleiter|projektleit/i],
  // hochbau/tiefbau ~34 net (the only home for the umlauted purchasing
  // compounds the v8 stem cannot reach), lager 100 (after verkauf; subsumes
  // the warehouse-helper and Nordic warehouse-medarbetare rows — do not sum
  // the three counts), the enumerated -helfer compounds 45 (bare helfer
  // stays excluded — the split is measured), fahrer 63 (every driver files
  // in operations, house convention), the enumerated -führer machine/train
  // operators 70 (the enumeration refuses the managing-director compound —
  // 4 live rows, correctly left behind).
  ["operations", /hochbau|tiefbau|lager|(montage|produktions|inventur|lager|bau|werkstatt)helfer|fahrer|(geräte|maschinen|anlagen?|lok(rangier)?|kran|bagger|stapler|kolonnen|schicht|triebfahrzeug)führer/i],
  // chauffeur-compounds 16 (unanchored duplicate of the anchored English
  // term; first-match keeps bare chauffeur where it already lands), sjåfør
  // 13, kierowc 18, magazyn 66 (the English magazine cannot match — vowel
  // differs), kuljettaja 29 (always a compound tail), FI blue-collar
  // -työntekijä prefix whitelist 35 (the double-i logistics spelling is
  // here because the v8 stem breaks on it), Nordic warehouse/production
  // medarbetare 27 (optional space verified live).
  ["operations", /chauffeur|sj[åa]f[øo]r|kierowc|magazyn|kuljettaja|(varasto|tuotanto|rakennus|purku|metalli|logistiikka|betoni|kokoonpano|ahtaus|infra|huolto)ty[öo]ntekij|(lager|produksjons|produktions|terminal|industri) ?medarb/i],
  // Nordic tekniker 93 — AFTER the pharmacy stem above; the fixed-length
  // lookbehind set excludes the pharmacy, IT-support/servicedesk, orthotics
  // and dental prefixes (the orthotics compound is live and the English
  // orthopedic rule can never claim it — the Swedish spelling has no h).
  // One known 1-row IT-infrastructure leak stands, accepted.
  ["operations", /(?<!apotek)(?<!support)(?<!servicedesk)(?<!ortoped)(?<!tand)(?<!\bit[- ])tekniker/i],
  // Admin stems: the enumerated commercial office clerks 57 — bare kaufmann
  // stays excluded, the measured v8 decision stands. The enumerated
  // assistenz heads 48 sit LAST of the German rules on purpose: legal, tax,
  // sales and physician compounds are claimed by their field rules above (a
  // live legal-office row proves the ordering). Bare assistenz stays
  // excluded (~88% measured, splits healthcare/science/education).
  ["admin", /industriekauf(mann|frau|leute)|bürokauf(mann|frau)|kauf(mann|frau) .{0,12}für büromanagement/i],
  ["admin", /(team|büro|projekt|vorstands|bereichs|abteilungs|management|kaufmännische)[ -]?assistenz|assistenz der (geschäftsführung|geschäftsleitung|niederlassung|standortleitung)/i],
  // Fallback tier: only reached when nothing above matched — bare
  // "Research" departments land in science instead of Other.
  ["science", /\bresearch\b/i],
];

export function categorize(title: string, department?: string | null): JobCategory {
  // Department first — it's curated. Exact-ish department names map hard.
  const dept = (department ?? "").trim();
  if (dept) {
    for (const [cat, re] of RULES) if (re.test(dept)) return cat;
  }
  for (const [cat, re] of RULES) if (re.test(title)) return cat;
  return "other";
}
