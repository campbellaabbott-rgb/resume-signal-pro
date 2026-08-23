// Deterministic field/category mapping so a nurse, an accountant, or a
// warehouse lead can filter straight to their lane. Department is the
// primary signal (ATS departments are human-curated); title keywords refine
// or fill in. Pure module — unit-tested from vitest.

// Bump on EVERY rules change: a completed refresh pass compares this
// against the version stamped in job_board_meta and, on mismatch, sweeps
// the stored "other" rows through the current rules — so categorization
// improvements reach the existing corpus, not just newly inserted rows
// (the insert-only refresh never rewrites them otherwise).
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
export const CATEGORIZE_VERSION = 7;

export const JOB_CATEGORIES = [
  "engineering",
  "data_ai",
  "design",
  "product",
  "marketing",
  "sales",
  "customer",
  "finance",
  "legal",
  "people_hr",
  "operations",
  "healthcare",
  "science",
  "education",
  "hospitality_retail",
  "security",
  "admin",
  "other",
] as const;

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
  ["product", /\b(product manager\w*|product management|product owner|product lead|technical program manager\w*|program manager\w*|product operations)\b/i],
  ["marketing", /\b(marketing|growth|seo|sem\b|content (strategist|writer|marketer|lead)|copywrit\w*|communications|public relations|social media|brand (manager|lead)|demand gen\w*|lifecycle|events? (manager|coordinator)|comunica\w*|kommunikation\w*|communicatie)\b/i],
  ["sales", /\b(sales\b|salesperson|account (executive|manager|director)|business development|partnerships?|revenue|solutions? (architect|consultant|engineer)|pre-?sales|customer acquisition|gtm|vertrieb\w*|verkäufer\w*|commercial\w*|ejecutivo\/?a? de (ventas|cuentas)|asesor\w* (comercial|de ventas))\b/i],
  ["customer", /\b(customer (success|support|experience|service|care)|client servic\w*|technical support|support (engineer\w*|specialist|agent)|community (manager|lead)|implementation (manager|specialist)|onboarding|kundenservice|klantenservice|premium support|community support)\b/i],
  ["finance", /\b(teller|banker|personal banker|relationship banker|loan officer|mortgage \w+|collections? (manager|specialist|analyst|agent|representative|officer)|claims (\w+ )?(adjuster|officer|examiner|consultant|specialist|representative|manager|processor)|subrogation|adjuster|financ\w*|accountant\w*|accounting|accounts (payable|receivable)|bookkeep\w*|controller|treasury|fp&a|tax|payroll|billing|audit(or|ing)\w*|underwrit\w*|actuar\w*|credit (risk|analyst)|trad(er|ing)\w*|portfolio manager\w*|investment\w*|broker\w*|investor relations|buchhalt\w*)\b/i],
  ["legal", /\b(legal|counsel|attorney|lawyer|solicitor|barrister|paralegal|compliance|regulatory|privacy (counsel|officer)|contracts? (manager|specialist)|jurist\w*)\b/i],
  ["people_hr", /\b(recruit\w*|talent|people( (ops|operations|partner|team|experience))?|human resources|hrbp|hr (manager\w*|generalist\w*|specialist\w*|business)|total rewards|compensation|benefits (analyst|manager|specialist)|l&d|workplace|personalreferent\w*)\b/i],
  ["admin", /\b(administrative|executive assistant|office (manager|coordinator|administrator)|receptionist|executive operations)\b/i],
  // Skilled trades & field services — MUST precede hospitality_retail, or
  // "Part-Time Oil Change Team Member" matches "team member" and lands in
  // retail. Derived from a 1,250-row sample of the uncategorised pile
  // (2026-07-24), which was 35% of the board.
  ["operations", /\b(cdl|truck(ing)? driver|owner[- ]operator|flatbed|reefer|otr\b|dispatcher|superintendent|construction (manager|superintendent|supervisor)|oil change|body shop|auto body|workshop|auto(motive)? (tech\w*|service)|lube tech\w*|tire tech\w*|crew member|general laborer|labou?rer|foreman|journey(man|person|woman)|electrician|plumb(er|ing)|welder|carpenter|hvac|pipefitter|millwright|machinist|equipment operator|heavy equipment|operator\b|excavat\w*|scaffold\w*|glazier|roofer|mason\b|concrete|restoration (crew|tech\w*)|installer)\b/i],
  // Grocery/retail floor roles sit AFTER the trades rule on purpose: "Oil
  // Change Team Member" must keep landing in operations before "team member"
  // is claimed here.
  ["hospitality_retail", /\b(barista|server|chef|cook|kitchen|coffee shop|store (manager|associate|lead|team)|retail|restaurant|hotel|housekeep\w*|front desk|shift (lead|supervisor)|cashier|merchandis\w*|kellner\w*|vendeur\w*|vendeuse\w*|koch|kok\b|team member|clerk\b|stocker|bagger|deli\b|meat (cutter|clerk|manager|associate)|produce (clerk|manager|associate|team)|bakery|grocery|shopper|busser|dishwasher|host(ess)?\b|barback|cajer\w*|reponedor\w*|dependient\w*|vendedor\w*)\b/i],
  ["operations", /\b(project (manager|coordinator|lead|director)|operat(ions|ional)\w*|continuous improvement|supply chain|logistics|warehouse|fulfil?lment|drivers?|courier|dispatch\w*|fleet|facilities|manufacturing|production (planner|supervisor|technician)|quality (assurance|control)|buyer|sourcing|procurement|field (ops|service|technician)|maintenance|mechanic\w*|\w*monteur\w*|\w*mitarbeiter\w*|\w*medewerker\w*|fahrer\w*|chauffeur\w*|lagermitarbeiter\w*|magazijn\w*|produktionsmitarbeiter\w*|reinigung\w*|einkauf\w*|district manager\w*|district management|almacén|entrepôt)\b/i],
  ["engineering", /\b(engineer\w*|developer\w*|software|devops|sre|infrastructure|frontend|backend|full[- ]?stack|mobile|ios|android|platform|architect\w*|qa\b|sdet|(it|network|electronics|desktop|datacenter|data center) technician|information technology|service desk|helpdesk|help desk|desktop support|it (administrator|support|manager|specialist|analyst)|entwickler\w*|ingenieur\w*|ingenier\w*|ingénieur\w*|développeur\w*)\b/i],
  ["security", /\b(\w*security\w*|cyber\w*|soc analyst|threat|incident response|penetration|infosec|trust (and|&) safety|fraud (analyst\w*|investigator\w*)|investigat\w*)\b/i],
  // Bare "technician" is the single most common word in the uncategorised pile
  // (431 of a 3,000-row sample). It sits HERE, after healthcare, engineering
  // and security, so "Patient Care Technician", "Pharmacy Technician" and
  // "IT Technician" keep the homes they already had; only the field/service
  // technicians nothing else claims land in operations.
  ["operations", /\btechnician\b/i],
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
