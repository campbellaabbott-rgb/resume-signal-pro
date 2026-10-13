// Rationale: docs/job-board-index-notes.md#n1096-export-const-categorize_version

// Rationale: docs/job-board-index-notes.md#n1097-export-const-categorize_version
export const CATEGORIZE_VERSION = 10;

// Shared with public-api via ../_shared/board-domains.ts — see that file.
export { JOB_CATEGORIES } from "../_shared/board-domains.ts";
import { JOB_CATEGORIES } from "../_shared/board-domains.ts";

export type JobCategory = (typeof JOB_CATEGORIES)[number];

// Rationale: docs/job-board-index-notes.md#n1098-const-rules-array-jobcategory-regexp
const RULES: Array<[JobCategory, RegExp]> = [
  ["healthcare", /\b(nurs(e|ing)\w*|clinic\w*|physician\w*|doctor|psychiatr\w*|therap(ist|y)|pharmac\w*|medical|dental|veterinar\w*|care (manager|coordinator|navigator|team)|behavio(u?r)(al)? (technician|analyst|specialist)|\brbt\b|\bbcba\b|patient|case manager|direct support (professional|worker|staff)|mental health|hospice|caregiver|home health|midwife|paramedic|phlebotom\w*|optometr\w*|optician\w*|neuropsycholog\w*|audiolog\w*|radiolog\w*|sonograph\w*|chiropract\w*|podiatr\w*|orthodont\w*|hygienist\w*|krankenpfleg\w*|verpleegkundig\w*|enfermer\w*|infirmier\w*|arzt|médic\w*)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1099-healthcare-physio-tele-radio-hydro-chemo
  ["healthcare", /(?:physio|tele|radio|hydro|chemo|onco|psycho|massage)?therap(?:ist|y)|sonograph|ultrasound/i],
  // CLINICAL CREDENTIALS. Two- and three-letter, so every one is \b-anchored
  // and each was checked against the live bucket for collisions.
  ["healthcare", /\b(?:rn|lpn|lvn|cna|cma|hha|crna|dnp|bsn|cota|ota|pta)\b/i],
  // NAMED CLINICAL ROLES AND SETTINGS.
  ["healthcare", /\b(?:technologist|surgical|perioperative|dietit\w*|nutritionist|respiratory|anesthe\w*|radiograph\w*|mammograph\w*|telemetry|icu|nicu|picu|acute care|long term care|assisted living|skilled nursing|urgent care|home care|dentist\w*|hospitalist|pathologist|obgyn|ob\/gyn|speech language|occupational therapy|physical therapy|sonographer|perfusionist|orthopa?edic\w*)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1100-data_ai-b-data-scien-w-machine
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
  // Rationale: docs/job-board-index-notes.md#n1101-operations-b-cdl-truck-ing-driver
  ["operations", /\b(cdl|truck(ing)? driver|owner[- ]operator|flatbed|reefer|otr\b|dispatcher|superintendent|construction (manager|superintendent|supervisor)|oil change|body shop|auto body|workshop|auto(motive)? (tech\w*|service)|lube tech\w*|tire tech\w*|crew member|general laborer|labou?rer|foreman|journey(man|person|woman)|electrician|plumb(er|ing)|welder|carpenter|hvac|pipefitter|millwright|machinist|equipment operator|heavy equipment|operators?\b|excavat\w*|scaffold\w*|glazier|roofer|mason\b|concrete|restoration (crew|tech\w*)|installer)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1102-hospitality_retail-b-barista-server-chef
  ["hospitality_retail", /\b(barista|server|chef|cook|kitchen|coffee shop|store (manager|associate|lead|team)|retail|restaurant|hotel|housekeep\w*|front desk|(shift|team) (lead(er)?|supervisor)|cashier|merchandis\w*|kellner\w*|vendeur\w*|vendeuse\w*|koch|kok\b|team member|clerk\b|stocker|bagger|deli\b|meat (cutter|clerk|manager|associate)|produce (clerk|manager|associate|team)|bakery|grocery|shopper|busser|dishwasher|host(ess)?\b|barback|cajer\w*|reponedor\w*|dependient\w*|vendedor\w*)\b/i],
  ["operations", /\b(project ?(manager\w*|management|coordinator|lead(er)?|director|officer)|operat(ions|ional)\w*|continuous improvement|supply chain|logistics|warehouse|fulfil?lment|drivers?|courier|dispatch\w*|fleet|facilities|manufacturing|production (planner|supervisor|technician)|quality (assurance|control)|buyer|sourcing|procurement|field (ops|service|technician)|maintenance|mechanic\w*|\w*monteur\w*|\w*mitarbeiter\w*|\w*medewerker\w*|fahrer\w*|chauffeur\w*|lagermitarbeiter\w*|magazijn\w*|produktionsmitarbeiter\w*|reinigung\w*|einkauf\w*|district manager\w*|district management|almacén|entrepôt)\b/i],
  ["engineering", /\b(engineer\w*|developer\w*|software|devops|sre|infrastructure|frontend|backend|full[- ]?stack|mobile|ios|android|platform|architect\w*|qa\b|sdet|(it|network|electronics|desktop|datacenter|data center) technician|information technology|service desk|helpdesk|help desk|desktop support|it (administrator|support|manager|specialist|analyst)|entwickler\w*|ingenieur\w*|ingenier\w*|ingénieur\w*|développeur\w*)\b/i],
  ["security", /\b(\w*security\w*|cyber\w*|soc analyst|threat|incident response|penetration|infosec|trust (and|&) safety|fraud (analyst\w*|investigator\w*)|investigat\w*)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1103-operations-btechnician-b-i
  ["operations", /\btechnician\b/i],
  // Rationale: docs/job-board-index-notes.md#n1104-healthcare-pfleg-zahnmedizin-l-a-hihoita
  ["healthcare", /pfleg|zahnmedizin|l[äa]hihoitaja|sairaanhoitaja/i],
  ["engineering", /ingenieur/i],
  ["operations", /techniker|t[ée]cnico\b|op[ée]rateur\w*|pr[eé]parateur|logistik/i],
  ["admin", /sachbearbeiter|\brecepcionista\w*\b/i],
  ["sales", /\b(myyj[äa]\w*|vendedor\w*)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1105-healthcare-bsocial-work-w-b-bpeer
  ["healthcare", /\bsocial work\w*\b|\bpeer (support|specialist|recovery|counsel(l?or)?)s?\b|\bathletic trainers?\b|\b(addictions?|substance abuse|drug and alcohol|licensed professional|licensed clinical|guidance|crisis|pastoral) counsel(l?or)?s?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1106-education-b-admissions-camp-counsel-l
  ["education", /\b(admissions?|camp) counsel(l?or)?s?\b|\b(faculty|adjunct|lecturers?)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1107-people_hr-bhris-b-bhrm-adviseur-i
  ["people_hr", /\bhris\b|\bhrm?[- ]?adviseur/i],
  // Rationale: docs/job-board-index-notes.md#n1108-data_ai-bbusiness-systems-analysts-b-i
  ["data_ai", /\bbusiness (systems )?analysts?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1109-science-b-bio-statisticians-biostatist-w
  ["science", /\b((bio)?statisticians?|biostatist\w*|statistical programm\w*)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1110-marketing-b-media-events-wedding-planner
  ["marketing", /\b(media|events?|wedding) planners?\b|\beditors?\b|\bpaid (social|media|search)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1111-sales-b-account-development-sales-develo
  ["sales", /\b(account development|sales development) (rep\w*|associate|manager)s?\b|\bleasing\b|\binsurance (agents?|advisors?|agency|producers?|brokers?|sales)\b/i],
  // Rationale: docs/job-board-index-notes.md#n1112-hospitality_retail-bbeauty-advisors-b-b
  ["hospitality_retail", /\bbeauty advisors?\b|\b(stylists?|salon|barbers?|cosmetolog\w*|nail tech\w*|esthetician)\b|\b(lifeguards?|aquatics?)\b|\b(room|concession|f&b|food|beverage|guest|golf|cart|pool|recreation|spa|lobby) attendants?\b|\bkokki?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1113-engineering-bsystems-analysts-b-i
  ["engineering", /\bsystems? analysts?\b/i],
  ["engineering", /\b(sap|salesforce|netsuite|servicenow|peoplesoft|dynamics 365|d365|erp|workday|sharepoint)\b|\b(?:systems?|database|network|linux|unix|windows) administrators?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1114-finance-bbanking-b-bloans-b-binsurance
  ["finance", /\bbanking\b|\bloans?\b|\binsurance\b/i],
  // legal: data protection 36 — companion to the privacy (counsel|officer)
  // term.
  ["legal", /\bdata protection\b/i],
  // Rationale: docs/job-board-index-notes.md#n1115-security-bpolice-officer-chief-lieutenan
  ["security", /\bpolice (officer|chief|lieutenant|sergeant|captain|cadet|deputy)s?\b|\b(asset protection|loss prevention)\b/i],
  // customer: professional services 109 — post-sales implementation family.
  ["customer", /\bprofessional services\b/i],
  // Rationale: docs/job-board-index-notes.md#n1116-operations-binspectors-b-bestimat-or-ors
  ["operations", /\binspectors?\b|\bestimat(or|ors|ing)\b|\bsurveyors?\b|\bschedulers?\b/i],
  // EHS family 1243. The role-noun requirement after "safety" is the point:
  // bare safety pulls AI-safety research titles, live in the pile.
  ["operations", /\b(health (and|&) safety|ehs|hse|fire safety|process safety|food safety|life safety|safety (manager|specialist|coordinator|advisor|officer|supervisor|technician|lead|director|professional|rep|representative))s?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1117-operations-bbranch-manager-management-b
  ["operations", /\bbranch (manager|management)\b|\bshipping\b|\b(material|package|freight|baggage|cargo|mail|order) handl\w*|\bassemblers?\b|\binventory\b|\bpurchasing\b|\b(packers?|pickers?|loaders?|forklift)\b|\bporters?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1118-operations-b-custodian-w-janitor-w
  ["operations", /\b(custodian\w*|janitor\w*|cleaners?|cleaning|groundskeep\w*|landscap\w*|sanitation)\b|\b(car wash|parking|building|laundry|fuel|lot|toll|dock|yard|wash bay) attendants?\b|\b(service|parts) advisors?\b|\bpilots?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1119-operations-bplanners-b-i
  ["operations", /\bplanners?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1120-healthcare-optiker-arzt-rzt-aide-soignan
  ["healthcare", /optiker|arzt|ärzt|aide[- ]soignant|farmacista|sk[öo]tersk|verpleeg|apotek|(ty[öo]terveys|terveyden|hammas|osaston|opetus)hoitaja/i],
  // Rationale: docs/job-board-index-notes.md#n1121-legal-anwalt-anw-lt-babogad-w
  ["legal", /anwalt|anwält|\babogad\w*|\bavocate?s?\b/i],
  // Rationale: docs/job-board-index-notes.md#n1122-finance-buchhalt-steuerfach-steuerberat
  ["finance", /buchhalt|steuerfach|steuerberat|steuerassist|steuerrecht|steuerrefer|(umsatz|einkommen|ertrag|lohn)steuer|\bsteuern\b|comptable|\bcontable\b|gestion de patrimoine|\bsinistres?\b|\bpaie\b/i],
  // Rationale: docs/job-board-index-notes.md#n1123-sales-verkauf-conseill-e-re-s
  ["sales", /verkauf|conseill[eè]?re?\S*\s+(?:de (?:la )?|aux |à la |a la )?ventes?\b|verkoop|verkoper|selger|s[äa]ljare|(pharma|medizinprodukte)berater/i],
  // Rationale: docs/job-board-index-notes.md#n1124-customer-kundenberater-conseill-aux-reto
  ["customer", /kundenberater|conseill[^,–-]{0,10}aux retours?|charg[ée]e?\S*\s+de\s+client[èe]le|\b(?:service|relations?) (?:à la |a la )?client|(kundtj[äa]nst|kundservice|kundlojalitet|support)medarb/i],
  // Rationale: docs/job-board-index-notes.md#n1125-hospitality_retail-filialleit-butikk-but
  ["hospitality_retail", /filialleit|(butikk|butiks|ferskvare|kj[øo]kken|kafe|kantine|restaurang|service)medarb|butik[ks]{1,2}(sjef|chef|leder|konsulent)|cuisini[eè]r|\bserveu(?:r|se)/i],
  // Rationale: docs/job-board-index-notes.md#n1126-education-erzieher-l-a-rare-i
  ["education", /erzieher|l[äa]rare/i],
  // Rationale: docs/job-board-index-notes.md#n1127-operations-bezorg-i
  ["operations", /bezorg/i],
  ["healthcare", /(?<!be)zorg/i],
  ["education", /pedagogisch|specialpedagog/i],
  // Rationale: docs/job-board-index-notes.md#n1128-security-ochron-w-rodowisk-i
  ["security", /ochron(?!\w* środowisk)/i],
  // Engineering stem: PT engineers 49, joins the ingenieur stem family.
  ["engineering", /engenheir/i],
  // Rationale: docs/job-board-index-notes.md#n1129-operations-mecha-nik-tronik-er-elektroni
  ["operations", /mecha(nik|tronik)er|elektroniker|elektriker|bauleiter|projektleit/i],
  // Rationale: docs/job-board-index-notes.md#n1130-operations-hochbau-tiefbau-lager-montage
  ["operations", /hochbau|tiefbau|lager|(montage|produktions|inventur|lager|bau|werkstatt)helfer|fahrer|(geräte|maschinen|anlagen?|lok(rangier)?|kran|bagger|stapler|kolonnen|schicht|triebfahrzeug)führer/i],
  // Rationale: docs/job-board-index-notes.md#n1131-operations-chauffeur-sj-a-f-o
  ["operations", /chauffeur|sj[åa]f[øo]r|kierowc|magazyn|kuljettaja|(varasto|tuotanto|rakennus|purku|metalli|logistiikka|betoni|kokoonpano|ahtaus|infra|huolto)ty[öo]ntekij|(lager|produksjons|produktions|terminal|industri) ?medarb/i],
  // Rationale: docs/job-board-index-notes.md#n1132-operations-apotek-support-servicedesk-or
  ["operations", /(?<!apotek)(?<!support)(?<!servicedesk)(?<!ortoped)(?<!tand)(?<!\bit[- ])tekniker/i],
  // Rationale: docs/job-board-index-notes.md#n1133-admin-industriekauf-mann-frau-leute-b
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
// Rationale: docs/job-board-index-notes.md#n1134-the-basis-every-proposal-from-this

/** The basis every proposal from this file carries. */
export const RULE_BASIS = "rule" as const;
/**
 * A rule proposal's confidence. A term or a normalisation replay is a
 * deterministic match, not a probability — the audit bar for a rule key is
 * 8 judged / 0 wrong (shadow.ts PROMOTE_MIN_JUDGED_PER_KEY, PROMOTE_MAX_WRONG),
 * so the confidence column carries 1 and the judged figures live in the audit.
 */
export const RULE_CONFIDENCE = 1;

/**
 * Title normalisation, replayed against the FROZEN rules. Three stages, tried
 * in order, each cumulative on the last; the first stage at which the v9 rules
 * fire names the proposal's key so an audit and a revert stay per stage.
 *   norm_nfkc       NFKC, `&amp;` -> `&`, whitespace collapse (the escaped
 *                   ampersand is live in titles: "Press &amp; Content").
 *   norm_underscore `_` -> ` ` (PwC "IN_Senior Associate_SAP ABAP_…": 35 of
 *                   the sample's 47 structural moves; `_` is a \w character,
 *                   so every \b-anchored rule is blind to it).
 *   norm_plural     plural -> singular for the EXACT rule nouns below, no
 *                   others (12 sample moves: "Cashiers - Seasonal", "Process
 *                   Technicians", "CT Technologists"). NOT "Tech" ->
 *                   "Technician": withheld (Rad/ER/CT/Med Tech would fall to
 *                   the bare-technician operations fallback). NOT the
 *                   Mgr/Svc/Dir abbreviation expansion: withheld (7 sample
 *                   rows, 5/7, both misses known misfire classes — "Program
 *                   Mgr Wholesale Digital" -> product, "CUSTOMER SVC/DEPT
 *                   MANAGER" -> customer).
 * Provenance: mechC-gate.ts / mechC-gate.txt (2026-09-10). The noun list is
 * the gate's PLURAL alternation verbatim.
 */
const PLURAL_RULE_NOUNS =
  /\b(scientists|technologists|chefs|cooks|hosts|cashiers|servers|tellers|bankers|receptionists|clerks|stockers|dishwashers|electricians|plumbers|welders|carpenters|machinists|dispatchers|installers|buyers|teachers|instructors|professors|paralegals|attorneys|lawyers|adjusters|artists|physicians|doctors|nurses|services|technicians)\b/gi;

export type NormalisationStage = "norm_nfkc" | "norm_underscore" | "norm_plural";

export const NORMALISATION_STAGES: ReadonlyArray<[NormalisationStage, (t: string) => string]> = [
  ["norm_nfkc", (t) => t.normalize("NFKC").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()],
  ["norm_underscore", (t) => t.replace(/_/g, " ").replace(/\s+/g, " ").trim()],
  ["norm_plural", (t) => t.replace(PLURAL_RULE_NOUNS, (m) => m.replace(/s$/i, ""))],
];

/** The fully normalised title (all three stages) — the input the v10 terms see. */
export function normalizeTitle(title: string): string {
  return NORMALISATION_STAGES.reduce((t, [, step]) => step(t), title);
}

/**
 * THE 19 GATE-PASSING TERMS, regexes verbatim from mechC-gate.ts PASS. Each
 * carries its own category_key so promotion, audit and revert are per term.
 * mechC-gate.ts listed 24; five of its own PASS entries fail the criterion its
 * header states (>= 8 sample matches, >= 2 employers) and are WITHHELD here --
 * see the end of this comment.
 *
 * Figures per term are "sample n / distinct employers" from mechC-gate.txt
 * (the 2,576-row stratified sample, every match counted whether or not an
 * earlier term claimed the row) and then the hand-judged employer-page rows
 * in judgments.json (src/test/fixtures/other-bucket-judgments.json) that the
 * term fires on. Both are RECOMPUTED by the v10 test from the fixtures; the
 * numbers here are for the reader.
 *
 * hospitality_retail — commis 27/3 (53 judged); guest service/services/
 *   relations/experience/arrival/environment 27/9 (20 judged); F&B / food
 *   and beverage 16/3 (13 judged); banquet 8/3 (5 judged); bartender 18/10
 *   (17 judged); food runner 30/2 (61 judged); food service worker/
 *   assistant/supervisor/aide 9/4 (6 judged); dietary aide 14/7 (5 judged;
 *   house convention role-not-setting: the food-service role files here,
 *   the hospital is the setting, not the job — cf. the refuted UHS default);
 *   valet 8/6 (4 judged; the v9 "(parking) attendant" precedent read as a
 *   guest-facing hotel role, per mechC-gate.ts); stock(ing) associate 15/5
 *   (12 judged); selling advisor/assistant/associate 24/2 (24 judged — a
 *   convention split with sales: retail floor selling files retail, and the
 *   embed basis says sales for the same Saks rows, which the resolver stamps
 *   as a conflict, not a move); beauty consultant/lead/manager/counter
 *   manager 33/2 (33 judged); baker 11/3 (12 judged); store supervisor/
 *   director/assistant/administrator 9/5 (3 judged + 1 ambiguous "Store
 *   Administrator" -> A:admin).
 * sales — representante (de) ventas/vendas 23/2 (AutoZone counter reps and
 *   Sherwin-Williams field reps; the employer-page judge filed AutoZone's
 *   under its retail default, 17 rows, and Sherwin-Williams' as sales, 6 —
 *   the term files the ROLE, sales, the house convention every "Sales
 *   Associate" already follows).
 * healthcare — behavioral health 12/4 (11 judged); medication aide/
 *   assistant + med tech 12/7 (0 employer-page judged: tail-only, senior-
 *   living employers); modality tech 31/6 (19 judged: Rad/CT/X-Ray/Echo/ER/
 *   ED/Monitor/Endoscopy/Sterile Process/OR Room/Pulmonary Function/
 *   Cardiovascular Invasive — enumerated on purpose, bare Tech is NOT
 *   expanded); NP/PA, PMHNP, advanced practice 9/3 (23 judged; bare "app" is
 *   a refuted term and is not in the alternation).
 *
 * WITHHELD (in mechC-gate.ts PASS, but under the gate's own bar -- the v10
 * test asserts every shipped term clears RULE_TERM_MIN_JUDGED and
 * RULE_TERM_MIN_EMPLOYERS and that these five get NO proposal):
 *   cake decorator 8/1 (Albertsons only), caissier/caissière 10/1 (Myview
 *   only), repartidor 9/1 (AutoZone only), controlador de inventario 7/1
 *   (AutoZone only; also one below RULE_TERM_MIN_JUDGED), and épicerie 0/0 --
 *   the gate's spelling `\b[ée]picerie\b` cannot match a title that starts
 *   with É (no ASCII word boundary before a non-ASCII letter), so it claimed
 *   no sample row; a re-spelled regex is an unmeasured regex. Each would need
 *   a second employer (or, for épicerie, a fresh measurement) before it is
 *   admitted; "Épicerie Commis" still files by commis.
 *
 * Order within the list is the mechC-gate.ts order; every term is tried only
 * AFTER the frozen rules have declined the normalised title, so no v9 claim
 * can shift. Cross-term overlaps ("Banquet Bartender", "Épicerie Commis")
 * share a target.
 */
export interface RuleTerm {
  /** category_key for rows this term proposes; unique per term. */
  key: string;
  target: Exclude<JobCategory, "other">;
  re: RegExp;
}

export const V10_TERMS: ReadonlyArray<RuleTerm> = [
  { key: "commis", target: "hospitality_retail", re: /\bcommis\b/i },
  { key: "guest_facing", target: "hospitality_retail", re: /\bguest (service|services|relations|experience|arrival|environment)s?\b/i },
  { key: "f_and_b", target: "hospitality_retail", re: /\bf ?& ?b\b|\bfood (and|&) (beverage|drinks?)\b/i },
  { key: "banquet", target: "hospitality_retail", re: /\bbanquets?\b/i },
  { key: "bartender", target: "hospitality_retail", re: /\bbartenders?\b/i },
  { key: "food_runner", target: "hospitality_retail", re: /\bfood runners?\b/i },
  { key: "food_service_worker", target: "hospitality_retail", re: /\bfood services? (worker|assistant|supervisor|aide)s?\b/i },
  { key: "dietary_aide", target: "hospitality_retail", re: /\bdietary aides?\b/i },
  { key: "valet", target: "hospitality_retail", re: /\bvalets?\b/i },
  { key: "stock_associate", target: "hospitality_retail", re: /\bstock(ing)? associates?\b/i },
  { key: "selling_advisor", target: "hospitality_retail", re: /\bselling (advisor|assistant|associate)s?\b/i },
  { key: "beauty_consultant", target: "hospitality_retail", re: /\bbeauty (consultant|lead|manager|counter manager)s?\b/i },
  { key: "baker", target: "hospitality_retail", re: /\bbakers?\b/i },
  { key: "store_supervisor", target: "hospitality_retail", re: /\bstore (supervisor|director|assistant|administrator)s?\b|\bmulti-store supervisor\b|\bassistant store director\b/i },
  { key: "representante_ventas", target: "sales", re: /\brepresentante (de )?(ventas|vendas)\b/i },
  { key: "behavioral_health", target: "healthcare", re: /\bbehaviou?ral health\b/i },
  { key: "medication_aide", target: "healthcare", re: /\bmedication (aide|assistant)s?\b|\bmed tech\b/i },
  { key: "modality_tech", target: "healthcare", re: /\b(rad|ct|x-?ray|echo|er|ed|pet\/ct|monitor|endoscopy|or room|sterile process(ing)?|pulmonary function|cardiovascular invasive) techs?\b|\btech - (er|monitor|mh\/bh)\b/i },
  { key: "advanced_practice", target: "healthcare", re: /\bnp\/pa\b|\bnp or pa\b|\bpmhnp\b|\badvanced? practi(ce|tioner)\b/i },
];

/**
 * A rule-basis proposal for a row the frozen rules leave in "other". The
 * shape is the shadow proposal shadow.ts resolves (basis / key / target /
 * confidence) plus the rules version that produced it.
 */
export interface RuleProposal {
  basis: typeof RULE_BASIS;
  /** A normalisation stage name or a V10_TERMS key. */
  key: NormalisationStage | string;
  target: Exclude<JobCategory, "other">;
  confidence: typeof RULE_CONFIDENCE;
  /** The rules version that produced the proposal. */
  version: number;
}

/**
 * The v10 proposal path. Returns null whenever categorize() already has an
 * answer (the frozen rules keep first claim — callers must never call this
 * for a row that is not stored as "other") and null when nothing in v10
 * fires. It never returns "other" and never writes anything: the result is a
 * proposal for the shadow columns, resolved against the employer and embed
 * mechanisms by shadow.ts.
 */
export function proposeCategory(title: string, department?: string | null): RuleProposal | null {
  const raw = title ?? "";
  if (categorize(raw, department) !== "other") return null;
  // Stage replays against the frozen rules: the first stage that makes them
  // fire names the key.
  let t = raw;
  for (const [stage, step] of NORMALISATION_STAGES) {
    t = step(t);
    const cat = categorize(t, department);
    if (cat !== "other") return { basis: RULE_BASIS, key: stage, target: cat, confidence: RULE_CONFIDENCE, version: CATEGORIZE_VERSION };
  }
  // Only now the 19 terms, over the fully normalised title.
  for (const term of V10_TERMS) {
    if (term.re.test(t)) return { basis: RULE_BASIS, key: term.key, target: term.target, confidence: RULE_CONFIDENCE, version: CATEGORIZE_VERSION };
  }
  return null;
}
