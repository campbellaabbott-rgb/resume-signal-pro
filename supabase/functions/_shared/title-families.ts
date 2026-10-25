/**
 * OCCUPATIONS AS TITLE FAMILIES: WHAT TO SEARCH, WHAT COUNTS, WHAT DOES NOT.
 *
 * Today's "For you" searched one role word and took whatever titles came back,
 * so a nurse saw "Nurse Practitioner" and "CNA" beside staff RN jobs and a
 * controller saw "Air Traffic Controller". A family names an occupation the
 * way a recruiter reads it:
 *
 *   q          3-8 title phrases OR'ed into ONE title-only query (websearch syntax)
 *   qSimple    phrases whose tokens the English index drops (IT, HR), matched on
 *              to_tsvector('simple', title)
 *   core       a title that IS the occupation (order-free: "Teacher - Elementary")
 *   near       a recognised variant (a Good, not a Strong, on title alone)
 *   not        titles that share words but are another job (licence or field), <= 400 chars
 *   headNoun   the word widening step 2 searches with the not-list
 *   onsite     the work is done on site: a "remote" row counts only when its title
 *              or location literally says remote
 *   licensed   the jurisdiction licence the occupation needs, if any
 *   levelInQuery the level is the job (staff engineer, store manager, controller):
 *              level-word gates do not apply
 *   adjacent   the next rung or a sideways move (widening step 3)
 *   assistantIsJunior "assistant" in a title is a rung below (controller, store manager)
 *
 * VERSION 1 is the 22 families the accuracy prototype was measured with
 * (match-acc-1012/proto/families.ts, written from occupational knowledge, not
 * read off the bench manifest), plus common occupations written the same way
 * and checked by the tests beside it. The spec's v1 target is about 300,
 * mined from the board's titles (scripts/match/mine-title-families.mjs) and
 * reviewed by hand; that mining needs the board's title census and is not
 * done yet. An occupation with no family falls back to the reader's own
 * titles OR'ed with a generic not-list, and the response says family: null.
 *
 * SERVER ONLY. Never shipped to the browser (it is large and changes by
 * version); the device re-tiers from the facets resume-match returns.
 */
import type { LicenceKind } from "./licence-rules.ts";
import { bandFromTitle } from "../job-board/experience.ts";

export const TITLE_FAMILIES_VERSION = "2026-10-16.1";
/** The longest not-list a family may carry (spec §6.1). */
export const NOT_MAX_CHARS = 400;

export interface TitleFamily {
  key: string;
  label: string;
  q: readonly string[];
  qSimple?: readonly string[];
  core: RegExp;
  near?: RegExp;
  not?: RegExp;
  headNoun: string;
  onsite: boolean;
  licensed?: LicenceKind;
  levelInQuery?: boolean;
  adjacent?: readonly string[];
  assistantIsJunior?: boolean;
  /** A résumé title maps to this family when it matches; defaults to core. */
  match?: RegExp;
}

/** Sales and recruiting titles share words with almost every occupation. */
export const GENERIC_NOT = /\b(sales (representative|rep|executive|consultant)|account (manager|executive)|recruiter|talent acquisition)\b/i;

const SWE_NOT = /\b(sales|support|solutions|field|test|qa|hardware|electrical|mechanical|civil|manufacturing|process|data entry|structural)\b[^,|]*\bengineer\b|\bsales\b/i;
const NURSE_NOT = /\bnurse practitioner|\bnp\b|\blpn\b|\blvn\b|licensed (practical|vocational)|\bcna\b|nursing assistant|nurse aide|\bdirector\b|anesthetist|midwife|educator|informatics|case manager|\bmedical assistant\b|\binstructor\b|\bfaculty\b/i;

/**
 * Order matters for résumé titles: the first family whose `match` (or core)
 * fits a title wins, so specific families come before general ones.
 */
export const TITLE_FAMILIES: readonly TitleFamily[] = [
  // ---- nursing and health (specific before general)
  {
    key: "ward_manager", label: "Ward manager", onsite: true, levelInQuery: true, headNoun: "manager", licensed: "nmc",
    q: ["ward manager", "ward sister", "senior sister", "matron", "clinical nurse manager", "senior charge nurse", "unit manager nurse"],
    core: /\bward (manager|sister)\b|\bsenior sister\b|\bmatron\b|\bsenior charge nurse\b|\bclinical nurse manager\b|\bdeputy ward manager\b/i,
    near: /\b(nurse|nursing) (unit )?manager\b|\bunit manager\b[^,|]*\b(ward|nurs)/i,
    not: /\bward (st|street|road|ave)\b|\bassistant manager\b|\bstore\b|\bhealthcare assistant\b/i,
    adjacent: ["nurse manager", "senior staff nurse", "clinical nurse lead", "outpatient manager", "theatre manager", "deputy ward manager"],
  },
  {
    key: "rn_icu", label: "ICU registered nurse", onsite: true, headNoun: "nurse", licensed: "rn",
    // A specialty searches its parent occupation too: an experienced ICU nurse is
    // shortlisted for most staff RN posts, and a title-only query for ICU words
    // alone never sees them. ICU titles stay core; the rest are near (Good).
    q: ["icu nurse", "critical care nurse", "registered nurse icu", "intensive care unit registered nurse", "registered nurse critical care", "icu registered nurse", "registered nurse", "staff nurse"],
    core: /\b(icu|intensive care|critical care|micu|sicu|cvicu|ccu)\b[^,|]*\b(nurse|rn)\b|\b(registered nurse|rn)\b[^,|]*\b(icu|intensive care|critical care|micu|sicu|cvicu|ccu)\b/i,
    near: /\bregistered nurse\b|\b(rn)\b|\bstaff nurse\b|\b(progressive care|step[- ]?down|pcu|emergency|ed|er)\b[^,|]*\bnurse\b/i,
    not: NURSE_NOT,
    adjacent: ["registered nurse", "progressive care nurse", "emergency department nurse"],
  },
  {
    key: "nurse_practitioner", label: "Nurse practitioner", onsite: true, headNoun: "practitioner", licensed: "np",
    q: ["nurse practitioner", "family nurse practitioner", "psychiatric nurse practitioner", "aprn", "advanced practice registered nurse"],
    core: /\bnurse practitioner\b|\baprn\b|\b(fnp|pmhnp|agnp|agacnp)\b/i,
    not: /\b(faculty|professor|instructor|student|recruiter)\b/i,
  },
  {
    key: "lpn", label: "Licensed practical nurse", onsite: true, headNoun: "nurse", licensed: "lpn",
    q: ["licensed practical nurse", "lpn", "licensed vocational nurse", "lvn"],
    core: /\b(lpn|lvn|licensed (practical|vocational) nurse)\b/i,
    not: /\b(instructor|faculty|manager|director)\b/i,
  },
  {
    key: "cna", label: "Nursing assistant", onsite: true, headNoun: "assistant",
    q: ["certified nursing assistant", "cna", "nursing assistant", "nurse aide", "patient care technician", "patient care assistant"],
    core: /\b(cna|certified nursing assistant|nursing assistant|nurse aide|patient care (tech(nician)?|assistant)|pct)\b/i,
    not: /\b(manager|director|instructor|registered nurse|rn)\b/i,
  },
  {
    key: "rn", label: "Registered nurse", onsite: true, headNoun: "nurse", licensed: "rn",
    q: ["registered nurse", "new graduate nurse", "nurse resident", "graduate nurse", "staff nurse", "rn"],
    core: /\bregistered nurse\b|\b(rn|r\.n\.)\b|\bstaff nurse\b|\bnurse resident\b|\bgraduate nurse\b|\bnew grad(uate)? (registered )?nurse\b/i,
    near: /\b(clinical|med[- ]?surg|telemetry|float|icu|er|ed|emergency|pediatric|labor and delivery|oncology|surgical)\b[^,|]*\bnurse\b/i,
    not: /\bnurse practitioner|\bnp\b|\blpn\b|\blvn\b|licensed (practical|vocational)|\bcna\b|nursing assistant|nurse aide|\bmanager\b|\bdirector\b|anesthetist|midwife|educator|informatics|case manager|\bmedical assistant\b|\binstructor\b/i,
    adjacent: ["clinical nurse", "telemetry nurse", "medical surgical nurse"],
  },
  {
    key: "medical_assistant", label: "Medical assistant", onsite: true, headNoun: "assistant",
    q: ["medical assistant", "clinical medical assistant", "certified medical assistant", "medical office assistant", "cma"],
    core: /\b(certified |clinical |registered )?medical assistant\b|\bcma\b/i,
    not: /\b(manager|director|instructor|physician assistant|nursing assistant)\b/i,
  },
  {
    key: "pharmacy_tech", label: "Pharmacy technician", onsite: true, headNoun: "technician",
    q: ["pharmacy technician", "pharmacy tech", "certified pharmacy technician", "pharmacy assistant"],
    core: /\bpharmacy (technician|tech|assistant)\b|\bcpht\b/i,
    not: /\b(manager|director|pharmacist in charge)\b/i,
  },
  {
    key: "pharmacist", label: "Pharmacist", onsite: true, headNoun: "pharmacist", licensed: "pharmacist",
    q: ["pharmacist", "clinical pharmacist", "staff pharmacist", "retail pharmacist", "pharmacist in charge"],
    core: /\bpharmacist\b/i,
    not: /\b(technician|tech|intern|student|assistant)\b/i,
  },
  {
    key: "pta", label: "Physical therapist assistant", onsite: true, headNoun: "assistant",
    q: ["physical therapist assistant", "physical therapy assistant", "pta", "physical therapy aide"],
    core: /\bphysical therap(ist|y) (assistant|aide)\b|\bpta\b/i,
  },
  {
    key: "physical_therapist", label: "Physical therapist", onsite: true, headNoun: "therapist", licensed: "pt",
    q: ["physical therapist", "physiotherapist", "outpatient physical therapist", "home health physical therapist", "travel physical therapist"],
    core: /\bphysical therapist\b|\bphysiotherapist\b/i,
    not: /\b(assistant|aide|pta|technician|tech)\b/i,
  },
  {
    key: "occupational_therapist", label: "Occupational therapist", onsite: true, headNoun: "therapist", licensed: "ot",
    q: ["occupational therapist", "occupational therapist registered", "otr", "pediatric occupational therapist"],
    core: /\boccupational therapist\b|\botr\/?l?\b/i,
    not: /\b(assistant|aide|cota)\b/i,
  },
  {
    key: "respiratory_therapist", label: "Respiratory therapist", onsite: true, headNoun: "therapist",
    q: ["respiratory therapist", "registered respiratory therapist", "rrt", "respiratory care practitioner"],
    core: /\brespiratory (therapist|care practitioner)\b|\b(rrt|crt)\b/i,
    not: /\b(manager|director|student)\b/i,
  },
  {
    key: "radiologic_tech", label: "Radiologic technologist", onsite: true, headNoun: "technologist",
    q: ["radiologic technologist", "radiology technologist", "x-ray technologist", "rad tech", "ct technologist", "mri technologist"],
    core: /\b(radiologic|radiology|x-?ray|ct|mri|imaging) (technologist|tech|technician)\b|\brad tech\b/i,
    not: /\b(manager|director|student)\b/i,
  },
  {
    key: "sonographer", label: "Sonographer", onsite: true, headNoun: "sonographer",
    q: ["diagnostic medical sonographer", "ultrasound technologist", "sonographer", "cardiac sonographer", "echocardiographer"],
    core: /\bsonographer\b|\bultrasound tech(nologist|nician)?\b|\bechocardiographer\b/i,
  },
  {
    key: "dental_hygienist", label: "Dental hygienist", onsite: true, headNoun: "hygienist",
    q: ["dental hygienist", "registered dental hygienist", "rdh", "hygienist"],
    core: /\bdental hygienist\b|\brdh\b|\bhygienist\b/i,
    not: /\b(industrial|safety|occupational)\b/i,
  },
  {
    key: "dental_assistant", label: "Dental assistant", onsite: true, headNoun: "assistant",
    q: ["dental assistant", "registered dental assistant", "certified dental assistant", "orthodontic assistant", "expanded function dental assistant"],
    core: /\b(dental|orthodontic) assistant\b/i,
  },
  {
    key: "phlebotomist", label: "Phlebotomist", onsite: true, headNoun: "phlebotomist",
    q: ["phlebotomist", "phlebotomy technician", "certified phlebotomy technician", "phlebotomy"],
    core: /\bphlebotom(ist|y)\b/i,
  },
  {
    key: "emt_paramedic", label: "EMT or paramedic", onsite: true, headNoun: "paramedic",
    q: ["paramedic", "emergency medical technician", "emt", "emt basic", "advanced emt"],
    core: /\b(paramedic|emt|emergency medical technician)\b/i,
    not: /\b(instructor|manager|director)\b/i,
  },
  {
    key: "medical_lab_scientist", label: "Medical laboratory scientist", onsite: true, headNoun: "technologist",
    q: ["medical laboratory scientist", "medical technologist", "clinical laboratory scientist", "medical lab technician", "mls", "mlt"],
    core: /\b(medical|clinical) (laboratory|lab) (scientist|technologist|technician)\b|\bmedical technologist\b|\b(mls|mlt)\b/i,
  },
  {
    key: "home_health_aide", label: "Home health aide", onsite: true, headNoun: "aide",
    q: ["home health aide", "caregiver", "personal care aide", "direct support professional", "home care aide", "personal support worker"],
    core: /\b(home health|home care|personal care) aide\b|\bcaregiver\b|\bdirect support professional\b|\bpersonal support worker\b|\bdsp\b/i,
    not: /\b(manager|director|coordinator|registered nurse)\b/i,
  },
  {
    key: "social_worker", label: "Social worker", onsite: true, headNoun: "worker",
    q: ["social worker", "licensed clinical social worker", "lcsw", "medical social worker", "school social worker", "msw"],
    core: /\bsocial worker\b|\b(lcsw|lmsw|msw)\b/i,
    not: /\b(assistant|aide|manager|director)\b/i,
  },
  {
    key: "mental_health_counselor", label: "Mental health counselor", onsite: false, headNoun: "counselor",
    q: ["mental health counselor", "licensed professional counselor", "clinical therapist", "behavioral health therapist", "lpc", "marriage and family therapist"],
    core: /\b(mental health|behavioral health|substance abuse|addiction) (counselor|therapist|clinician)\b|\b(lpc|lmhc|lcpc|lmft)\b|\bclinical therapist\b|\bmarriage and family therapist\b/i,
    not: /\b(physical|occupational|respiratory|speech|massage)\b/i,
  },
  {
    key: "case_manager", label: "Case manager", onsite: false, headNoun: "manager", levelInQuery: true,
    q: ["case manager", "care coordinator", "care manager", "case management"],
    core: /\bcase manag(er|ement)\b|\bcare (coordinator|manager)\b/i,
    not: /\b(legal|litigation|claims|insurance)\b/i,
  },

  // ---- software and data
  {
    key: "swe_staff", label: "Staff software engineer", onsite: false, levelInQuery: true, headNoun: "engineer",
    q: ["staff software engineer", "staff engineer", "principal software engineer", "principal engineer", "senior staff engineer", "distinguished engineer"],
    core: /\b(staff|principal|distinguished)\b[^,|]*\b(software|backend|back[- ]end|full[- ]?stack|platform|distributed systems|storage)\b[^,|]*\b(engineer|developer)\b|\b(staff|principal|distinguished) (software|backend|platform|storage|distributed systems) (engineer|developer)\b/i,
    near: /\bsoftware architect|engineering fellow\b|\b(staff|principal)\b[^,|]*\bengineer\b/i,
    not: /\b(sales|support|solutions|field|hardware|electrical|mechanical|civil|manufacturing|process|data entry|structural|stress|supply chain|quality|test|validation|rf|analog|asic|chemical|nuclear)\b|\bstaff (accountant|nurse|pharmacist)\b/i,
    adjacent: ["senior software engineer", "software architect", "engineering manager", "technical lead"],
  },
  {
    key: "frontend_engineer", label: "Frontend engineer", onsite: false, headNoun: "engineer",
    q: ["frontend engineer", "front end engineer", "front end developer", "frontend developer", "ui engineer", "react developer", "web developer"],
    core: /\b(front[- ]?end|ui|react|angular|vue|web)\b[^,|]*\b(engineer|developer)\b/i,
    near: /\bsoftware (engineer|developer)\b|\bfull[- ]?stack\b[^,|]*\b(engineer|developer)\b/i,
    not: SWE_NOT,
    match: /\b(front[- ]?end|ui|react|angular|vue)\b[^,|]*\b(engineer|developer)\b/i,
  },
  {
    key: "mobile_engineer", label: "Mobile engineer", onsite: false, headNoun: "engineer",
    q: ["ios engineer", "android engineer", "mobile engineer", "ios developer", "android developer", "mobile developer"],
    core: /\b(ios|android|mobile|swift|react native|flutter)\b[^,|]*\b(engineer|developer)\b/i,
    near: /\bsoftware (engineer|developer)\b/i,
    not: SWE_NOT,
  },
  {
    key: "data_engineer", label: "Data engineer", onsite: false, headNoun: "engineer",
    q: ["data engineer", "big data engineer", "etl developer", "data platform engineer", "analytics engineer", "data pipeline engineer"],
    core: /\bdata (engineer|platform engineer|pipeline engineer)\b|\betl (developer|engineer)\b|\bbig data engineer\b/i,
    near: /\banalytics engineer\b|\bdata warehouse (engineer|developer)\b/i,
    not: /\b(sales|support|data entry)\b/i,
  },
  {
    key: "devops_sre", label: "DevOps or site reliability engineer", onsite: false, headNoun: "engineer",
    q: ["devops engineer", "site reliability engineer", "sre", "platform engineer", "cloud engineer", "infrastructure engineer"],
    core: /\b(devops|dev ops|site reliability|sre|cloud|infrastructure|platform)\b[^,|]*\bengineer\b/i,
    not: /\b(sales|support|solutions|field|civil|electrical|mechanical|structural)\b/i,
  },
  {
    key: "qa_engineer", label: "QA engineer", onsite: false, headNoun: "engineer",
    q: ["qa engineer", "quality assurance engineer", "software test engineer", "sdet", "test automation engineer", "qa analyst"],
    core: /\b(qa|quality assurance|test automation|software test|automation test)\b[^,|]*\b(engineer|analyst|tester)\b|\bsdet\b/i,
    not: /\b(manufacturing|supplier|food|clinical|process)\b/i,
  },
  {
    key: "security_engineer", label: "Security engineer or analyst", onsite: false, headNoun: "analyst",
    q: ["security engineer", "cybersecurity engineer", "information security analyst", "security analyst", "soc analyst", "application security engineer"],
    core: /\b(security|cybersecurity|cyber security|infosec|information security|soc|application security|appsec|cloud security)\b[^,|]*\b(engineer|analyst|architect)\b/i,
    not: /\b(physical security|security officer|security guard|sales)\b/i,
  },
  {
    key: "swe", label: "Software engineer", onsite: false, headNoun: "engineer",
    q: ["software engineer", "software developer", "backend engineer", "back end engineer", "full stack engineer", "java developer", "platform engineer"],
    core: /\b(software|backend|back[- ]end|full[- ]?stack|java|kotlin|platform|application|web)\b[^,|]*\b(engineer|developer)\b|\bsoftware development engineer\b|\bsde\b/i,
    near: /\b(cloud|distributed systems|infrastructure|api|services)\b[^,|]*\bengineer\b/i,
    not: SWE_NOT,
    adjacent: ["platform engineer", "backend developer", "full stack developer"],
  },
  {
    key: "data_scientist", label: "Data scientist", onsite: false, headNoun: "scientist",
    q: ["data scientist", "machine learning scientist", "computational biologist", "bioinformatics scientist", "applied scientist", "machine learning engineer"],
    core: /\bdata scien(tist|ce)\b|\bmachine learning (scientist|engineer)\b|\bapplied scientist\b|\b(computational biolog|bioinformatic)\w*\b/i,
    near: /\bquantitative (analyst|scientist)\b|\bdecision scientist\b|\bml engineer\b/i,
    not: /\b(sales|research associate|lab technician)\b/i,
  },
  {
    key: "ml_engineer", label: "Machine learning engineer", onsite: false, headNoun: "engineer",
    q: ["machine learning engineer", "ml engineer", "ai engineer", "deep learning engineer", "mlops engineer", "computer vision engineer"],
    core: /\b(machine learning|ml|ai|deep learning|mlops|computer vision|nlp)\b[^,|]*\bengineer\b/i,
    near: /\bapplied scientist\b|\bdata scientist\b/i,
    not: /\b(sales|support|solutions)\b/i,
  },
  {
    key: "data_analyst", label: "Data analyst", onsite: false, headNoun: "analyst",
    q: ["data analyst", "business intelligence analyst", "analytics analyst", "reporting analyst", "bi analyst", "analytics engineer"],
    core: /\b(data|business intelligence|bi|analytics|reporting|insights?|product) analyst\b|\banalytics engineer\b/i,
    near: /\b(business|operations|marketing|healthcare|financial data) analyst\b|\bbi developer\b/i,
    not: /\b(sales|credit|financial analyst|security|soc|cyber|clinical|lab)\b/i,
  },
  {
    key: "business_analyst", label: "Business analyst", onsite: false, headNoun: "analyst",
    q: ["business analyst", "business systems analyst", "systems analyst", "it business analyst", "requirements analyst", "process analyst"],
    core: /\b(business|business systems|systems|it business|requirements|process) analyst\b/i,
    near: /\b(data|operations|reporting) analyst\b/i,
    not: /\b(financial|security|sales|credit)\b/i,
  },
  {
    key: "product_manager", label: "Product manager", onsite: false, headNoun: "manager", levelInQuery: true,
    q: ["product manager", "product owner", "technical product manager", "digital product manager", "product management"],
    core: /\bproduct (manager|owner|management)\b/i,
    not: /\bproduct marketing\b|\bproduction\b|\b(sales|product designer)\b/i,
  },
  {
    key: "project_manager", label: "Project manager", onsite: false, headNoun: "manager", levelInQuery: true,
    q: ["project manager", "program manager", "project coordinator", "technical project manager", "project management"],
    core: /\b(project|program) manag(er|ement)\b|\bproject coordinator\b/i,
    not: /\b(construction|capital|clinical research|product)\b/i,
  },
  {
    key: "ux_designer", label: "UX or product designer", onsite: false, headNoun: "designer",
    q: ["ux designer", "product designer", "ui ux designer", "user experience designer", "interaction designer", "ux researcher"],
    core: /\b(ux|ui|user experience|product|interaction|visual|service)\b[^,|]*\bdesigner\b|\bux researcher\b/i,
    not: /\b(graphic|interior|fashion|instructional|landscape|mechanical|electrical)\b/i,
  },
  {
    key: "graphic_designer", label: "Graphic designer", onsite: false, headNoun: "designer",
    q: ["graphic designer", "visual designer", "production artist", "brand designer", "digital designer", "creative designer"],
    core: /\b(graphic|visual|brand|digital|creative|production) (designer|artist)\b/i,
    not: /\b(ux|ui|product|interior|instructional)\b/i,
  },
  {
    key: "it_support", label: "IT support", onsite: true, headNoun: "technician",
    q: ["help desk technician", "desktop support technician", "service desk analyst", "technical support specialist", "desktop support"],
    qSimple: ["it support", "it technician", "it specialist", "it help desk"],
    core: /\b(it|help ?desk|desktop|service desk|technical) (support|technician|specialist|analyst)\b|\bhelp ?desk\b/i,
    not: /\b(sales|customer service representative)\b/i,
  },
  {
    key: "systems_admin", label: "Systems administrator", onsite: false, headNoun: "administrator",
    q: ["systems administrator", "system administrator", "network administrator", "sysadmin", "network engineer", "linux administrator"],
    core: /\b(systems?|network|linux|windows|database) (administrator|admin|engineer)\b|\bsysadmin\b/i,
    not: /\b(sales|electrical|civil)\b/i,
  },

  // ---- finance and business
  {
    key: "controller", label: "Controller", onsite: false, levelInQuery: true, assistantIsJunior: true, headNoun: "controller", licensed: "cpa",
    q: ["controller", "corporate controller", "vp of accounting", "chief accounting officer", "director of accounting", "vp controller"],
    core: /\b(corporate |division(al)? |plant |group )?controller\b|\bchief accounting officer\b|\b(vp|vice president|director|head)\b[^,|]*\baccounting\b/i,
    near: /\bcontrollership\b|\bfinance director\b/i,
    not: /\bassistant\b|\bsr\.? accountant\b|\baccountant\b|\b(air traffic|controls?|inventory|production|traffic|game|motion|logic|programmable|credit|project controls|document controller|cost controller|stock controller)\b/i,
    adjacent: ["assistant controller", "finance director", "accounting manager"],
  },
  {
    key: "financial_analyst", label: "Financial analyst", onsite: false, headNoun: "analyst",
    q: ["financial analyst", "fp&a analyst", "financial planning and analysis", "finance analyst", "corporate finance analyst", "budget analyst"],
    core: /\b(financial|finance|fp&a|fp and a|corporate finance|budget) analyst\b|\bfinancial planning (and|&) analysis\b/i,
    near: /\bfp&a\b|\bplanning analyst\b|\bfinance associate\b/i,
    not: /\b(credit|insurance|loan|investment banking|equity research|sales|claims|billing|accounting clerk|payroll)\b/i,
  },
  {
    key: "accountant", label: "Accountant", onsite: false, headNoun: "accountant", licensed: "cpa",
    q: ["accountant", "staff accountant", "general ledger accountant", "cost accountant", "tax accountant", "accounting specialist"],
    core: /\baccountant\b|\baccounting (specialist|associate)\b/i,
    not: /\baccounts (payable|receivable)\b|\b(controller|director|cfo|clerk|bookkeeper)\b/i,
  },
  {
    key: "bookkeeper_ap", label: "Bookkeeper or accounts payable", onsite: false, headNoun: "specialist",
    q: ["bookkeeper", "accounts payable specialist", "accounts receivable specialist", "accounting clerk", "billing specialist", "accounts payable clerk"],
    core: /\bbookkeep(er|ing)\b|\baccounts (payable|receivable)\b|\baccounting (clerk|assistant)\b|\b(ap|ar) (clerk|specialist)\b|\bbilling (specialist|clerk|coordinator)\b/i,
    not: /\b(manager|director|controller)\b/i,
  },
  {
    key: "payroll", label: "Payroll specialist", onsite: false, headNoun: "specialist",
    q: ["payroll specialist", "payroll administrator", "payroll coordinator", "payroll analyst", "payroll clerk"],
    core: /\bpayroll\b/i,
    not: /\b(manager|director)\b/i,
  },
  {
    key: "auditor", label: "Auditor", onsite: false, headNoun: "auditor",
    q: ["auditor", "internal auditor", "staff auditor", "audit associate", "it auditor", "external auditor"],
    core: /\bauditor\b|\baudit (associate|senior|analyst)\b/i,
    not: /\b(energy|clinical|quality|safety|night auditor)\b/i,
  },
  {
    key: "bank_teller", label: "Bank teller or banker", onsite: true, headNoun: "teller",
    q: ["bank teller", "teller", "universal banker", "personal banker", "relationship banker", "banking associate"],
    core: /\b(bank )?teller\b|\b(universal|personal|relationship) banker\b/i,
    not: /\b(manager|director|investment)\b/i,
  },
  {
    key: "loan_officer", label: "Loan officer or underwriter", onsite: false, headNoun: "officer",
    q: ["loan officer", "mortgage loan officer", "loan processor", "mortgage underwriter", "loan underwriter", "underwriter"],
    core: /\b(loan|mortgage) (officer|processor|underwriter|originator)\b|\bunderwriter\b/i,
  },
  {
    key: "claims_adjuster", label: "Claims adjuster", onsite: false, headNoun: "adjuster",
    q: ["claims adjuster", "claims examiner", "insurance adjuster", "claims representative", "claims specialist", "field adjuster"],
    core: /\bclaims? (adjuster|examiner|representative|specialist|analyst)\b|\binsurance adjuster\b/i,
  },
  {
    key: "hr_generalist", label: "HR generalist", onsite: false, headNoun: "generalist",
    q: ["hr generalist", "human resources generalist", "hr coordinator", "human resources coordinator", "hr business partner", "hr specialist"],
    core: /\b(hr|human resources|people (operations|partner)) (generalist|coordinator|specialist|business partner|assistant|associate|partner)\b|\bhrbp\b/i,
    not: /\b(recruiter|payroll)\b/i,
  },
  {
    key: "recruiter", label: "Recruiter", onsite: false, headNoun: "recruiter",
    q: ["recruiter", "technical recruiter", "talent acquisition specialist", "talent acquisition partner", "sourcer", "recruiting coordinator"],
    core: /\brecruit(er|ing coordinator)\b|\btalent acquisition (specialist|partner|coordinator)\b|\bsourcer\b/i,
    not: /\b(military|army|navy)\b/i,
  },
  {
    key: "executive_assistant", label: "Executive assistant", onsite: false, headNoun: "assistant",
    q: ["executive assistant", "executive administrative assistant", "personal assistant", "executive coordinator"],
    core: /\bexecutive (administrative )?assistant\b|\bpersonal assistant\b|\bexecutive coordinator\b/i,
  },
  {
    key: "admin_assistant", label: "Administrative assistant", onsite: true, headNoun: "assistant",
    q: ["administrative assistant", "office assistant", "administrative coordinator", "office administrator", "secretary", "administrative specialist"],
    core: /\b(administrative|admin|office) (assistant|coordinator|specialist|administrator|associate)\b|\bsecretary\b/i,
    not: /\b(executive assistant|medical|dental|legal|manager|director|systems|database|network)\b/i,
  },
  {
    key: "receptionist", label: "Receptionist", onsite: true, headNoun: "receptionist",
    q: ["receptionist", "front desk coordinator", "front desk agent", "front office coordinator", "patient service representative", "medical receptionist"],
    core: /\breceptionist\b|\bfront (desk|office) (coordinator|agent|associate|representative)\b|\bpatient (service|access) representative\b/i,
    not: /\b(manager|supervisor)\b/i,
  },
  {
    key: "office_manager", label: "Office manager", onsite: true, headNoun: "manager", levelInQuery: true,
    q: ["office manager", "practice manager", "office administrator", "business office manager", "front office manager"],
    core: /\b(office|practice|business office|front office) manager\b/i,
  },
  {
    key: "account_manager", label: "Account manager", onsite: false, headNoun: "manager", levelInQuery: true,
    q: ["account manager", "client success manager", "customer success manager", "key account manager", "relationship manager", "client manager"],
    core: /\b(account|customer success|client success|key account|relationship|client) manager\b/i,
    not: /\b(vp|vice president)\b/i,
  },
  {
    key: "sales_rep", label: "Sales representative", onsite: false, headNoun: "representative",
    q: ["sales representative", "account executive", "inside sales representative", "outside sales representative", "business development representative", "sales development representative"],
    core: /\b(sales|business development|sales development|inside sales|outside sales|territory sales|field sales) (representative|rep|executive|associate|consultant|specialist)\b|\baccount executive\b|\b(bdr|sdr)\b/i,
    not: /\b(retail|store|engineer|manager|director|vp)\b/i,
  },

  // ---- marketing and communications
  {
    key: "marketing_coordinator", label: "Marketing coordinator", onsite: false, headNoun: "coordinator",
    q: ["marketing coordinator", "social media coordinator", "marketing assistant", "marketing associate", "social media specialist", "marketing specialist"],
    core: /\b(marketing|social media|digital marketing|brand|content) (coordinator|assistant|associate|specialist)\b/i,
    // Order-free, as every near is: "Associate, Performance Marketing", "Event Specialist, Marketing".
    near: /\b(marketing|social media|brand|content|communications|public relations|events?)\b[^|]*\b(coordinator|assistant|associate|specialist|generalist)\b|\b(coordinator|assistant|associate|specialist|generalist)\b[^|]*\b(marketing|social media|brand|communications|public relations)\b|\bmarketing intern\b/i,
    not: /\b(sales|telemarketing|recruiter|account executive|architect|engineer|developer|consultant|automation)\b/i,
  },
  {
    key: "digital_marketing", label: "Digital marketing manager", onsite: false, headNoun: "manager",
    q: ["digital marketing manager", "performance marketing manager", "paid media manager", "growth marketing manager", "sem manager", "paid search manager"],
    core: /\b(digital marketing|performance marketing|paid (media|search|social)|growth marketing|acquisition marketing|sem|ppc|seo) (manager|lead|specialist|strategist)\b/i,
    near: /\b(digital|performance|growth|paid)\b[^,|]*\bmarketing\b|\bseo manager\b/i,
    not: /\b(sales|telemarketing|recruiter|account executive|intern)\b/i,
  },
  {
    key: "content_marketing", label: "Content marketing", onsite: false, headNoun: "writer",
    q: ["content marketing manager", "content marketing specialist", "content writer", "content strategist", "copywriter", "communications specialist"],
    core: /\bcontent (marketing|strategist|writer|manager|specialist|marketer|lead|editor)\b|\bcopywriter\b|\bcontent and communications\b/i,
    near: /\b(communications|marketing) (specialist|writer|manager)\b|\btechnical writer\b|\b(brand|editorial) (writer|manager)\b/i,
    not: /\b(sales|telemarketing|recruiter|account executive|reporter|anchor|news|journalist|intern)\b/i,
  },
  {
    key: "marketing_manager", label: "Marketing manager", onsite: false, headNoun: "manager", levelInQuery: true,
    q: ["marketing manager", "brand manager", "product marketing manager", "demand generation manager", "field marketing manager", "lifecycle marketing manager"],
    core: /\b(marketing|brand|product marketing|demand generation|field marketing|lifecycle marketing|growth) (manager|lead)\b/i,
    not: /\b(sales|telemarketing)\b/i,
  },
  {
    key: "journalist", label: "Reporter or journalist", onsite: false, headNoun: "reporter",
    q: ["reporter", "journalist", "news reporter", "staff writer", "news producer", "copy editor"],
    core: /\b(reporter|journalist|news (editor|producer|writer)|staff writer|copy editor|correspondent)\b/i,
    not: /\b(court reporter|crime scene)\b/i,
  },
  {
    key: "public_relations", label: "Public relations", onsite: false, headNoun: "specialist",
    q: ["public relations specialist", "communications specialist", "communications manager", "media relations specialist", "communications coordinator", "pr specialist"],
    core: /\b(public relations|pr|communications|media relations|corporate communications) (specialist|manager|coordinator|associate|lead|officer)\b/i,
  },

  // ---- education
  {
    key: "elementary_teacher", label: "Elementary teacher", onsite: true, headNoun: "teacher", licensed: "teacher",
    q: ["elementary teacher", "elementary school teacher", "multiple subject teacher", "kindergarten teacher", "classroom teacher elementary", "grade teacher"],
    core: /\b(elementary|primary|kindergarten|tk|transitional kindergarten|multiple subject|1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth) (grade |school )?teacher\b|\bteacher\b[^,|]*\b(elementary|kindergarten|grade [1-5k]|grades? k)\b/i,
    near: /\bclassroom teacher\b|\bteacher\b[^,|]*\bk-?[0-8]\b|\bself[- ]contained\b/i,
    not: /\b(substitute|assistant|aide|para|preschool|infant|toddler|tutor|instructional designer|music|art|pe|physical education|special education|spanish|high school|middle school)\b/i,
    adjacent: ["teacher", "transitional kindergarten teacher", "intervention teacher"],
  },
  {
    key: "math_teacher", label: "Mathematics teacher", onsite: true, headNoun: "teacher", licensed: "teacher",
    q: ["math teacher", "mathematics teacher", "middle school math teacher", "math instructor", "algebra teacher", "middle school mathematics teacher"],
    core: /\b(math|mathematics|algebra|geometry)\b[^,|]*\bteacher\b|\bteacher\b[^,|]*\b(math|mathematics)\b/i,
    near: /\bmiddle school teacher\b|\bstem teacher\b|\bmath (interventionist|specialist)\b/i,
    not: /\b(substitute|assistant|aide|tutor|professor|lecturer|adjunct|university|college)\b/i,
    adjacent: ["stem teacher", "middle school teacher", "math interventionist"],
  },
  {
    key: "special_ed_teacher", label: "Special education teacher", onsite: true, headNoun: "teacher", licensed: "teacher",
    q: ["special education teacher", "special ed teacher", "intervention specialist", "resource teacher", "sped teacher", "learning support teacher"],
    core: /\bspecial (education|ed)\b[^,|]*\bteacher\b|\bintervention specialist\b|\bsped\b|\bresource (room )?teacher\b/i,
    not: /\b(assistant|aide|para)\b/i,
  },
  {
    key: "preschool_teacher", label: "Preschool teacher", onsite: true, headNoun: "teacher",
    q: ["preschool teacher", "early childhood teacher", "pre-k teacher", "daycare teacher", "childcare teacher", "infant teacher"],
    core: /\b(preschool|pre-?k|early childhood|daycare|child ?care|infant|toddler)\b[^,|]*\bteacher\b/i,
    not: /\b(assistant|aide)\b/i,
  },
  {
    key: "teaching_assistant", label: "Teaching assistant", onsite: true, headNoun: "assistant",
    q: ["teaching assistant", "paraprofessional", "teacher aide", "instructional aide", "para educator", "classroom aide"],
    core: /\b(teaching|teacher'?s?|instructional|classroom) (assistant|aide)\b|\bparaprofessional\b|\bpara ?educator\b/i,
    not: /\b(graduate|university|college)\b/i,
  },
  {
    key: "high_school_teacher", label: "Secondary teacher", onsite: true, headNoun: "teacher", licensed: "teacher",
    q: ["high school teacher", "secondary teacher", "english teacher", "science teacher", "social studies teacher", "middle school teacher"],
    core: /\b(high school|secondary|middle school|english|ela|science|biology|chemistry|physics|history|social studies|spanish|language arts)\b[^,|]*\bteacher\b|\bteacher\b[^,|]*\b(high school|secondary|english|science|history)\b/i,
    not: /\b(substitute|assistant|aide|para|professor|lecturer|tutor|elementary|kindergarten|preschool)\b/i,
  },
  {
    key: "school_counselor", label: "School counselor", onsite: true, headNoun: "counselor",
    q: ["school counselor", "guidance counselor", "school psychologist", "academic advisor", "college counselor"],
    core: /\b(school|guidance|academic|college|career) (counselor|advisor|psychologist)\b/i,
  },
  {
    key: "instructional_designer", label: "Instructional designer", onsite: false, headNoun: "designer",
    q: ["instructional designer", "learning experience designer", "elearning developer", "curriculum developer", "learning designer", "training developer"],
    core: /\binstructional design(er)?\b|\blearning (experience )?designer\b|\be-?learning (developer|designer)\b|\bcurriculum (developer|designer)\b|\btraining (developer|designer)\b/i,
    near: /\blearning (and|&) development (specialist|designer)\b|\btraining specialist\b|\binstructional technolog/i,
    not: /\b(teacher|professor|sales)\b/i,
  },

  // ---- retail, food and hospitality
  {
    key: "store_manager", label: "Store manager", onsite: true, levelInQuery: true, assistantIsJunior: true, headNoun: "manager",
    q: ["store manager", "general manager retail", "district manager", "store director", "general store manager", "multi unit manager"],
    core: /\b(store|general store|retail store) (manager|director)\b|\bdistrict manager\b|\bgeneral manager\b|\bmulti[- ]unit\b[^,|]*\bmanager\b|\bstore leader\b/i,
    near: /\bregional (operations )?manager\b[^,|]*\b(retail|stores?)\b/i,
    not: /\bassistant\b|\bco-?manager\b|\bdeputy\b|\bassociate store\b|\bpharmacy\b|\brestaurant\b|\bhotel\b|\bdistrict sales\b|\bsales district\b|\bin training\b/i,
    adjacent: ["assistant store manager", "store operations manager", "area manager retail"],
  },
  {
    key: "retail_supervisor", label: "Retail shift supervisor", onsite: true, headNoun: "supervisor",
    q: ["shift supervisor", "retail supervisor", "assistant store manager", "key holder", "assistant manager retail", "front end supervisor"],
    core: /\b(shift|retail|store|front[- ]end|department|team) (supervisor|lead|leader)\b|\bkey ?holder\b|\bassistant (store )?manager\b|\bshift leader\b/i,
    near: /\bsupervisor\b[^,|]*\b(retail|store|sales floor|front end)\b|\bassistant store\b/i,
    not: /\b(warehouse|construction|nurse|clinical|restaurant|kitchen|security|call center|manufacturing|production|maintenance|property|bank|pharmacy technician|janitorial)\b|\bstore manager\b(?!.*assistant)|\bdistrict\b/i,
    adjacent: ["assistant store manager", "department manager retail", "operations supervisor retail"],
  },
  {
    key: "cashier", label: "Cashier or retail associate", onsite: true, headNoun: "associate",
    q: ["cashier", "customer service associate", "retail associate", "sales associate", "front end associate", "grocery clerk"],
    core: /\bcashier\b|\bfront[- ]end (associate|cashier)\b|\bcheckout\b/i,
    near: /\b(retail|sales|store|customer service|grocery|team member|crew member)\b[^,|]*\b(associate|clerk|representative|member)\b|\bstocker\b/i,
    not: /\bmanager\b|\bsupervisor\b|\bpharmacist\b|\bbank teller\b|\bcall center\b|\bremote\b|\b(insurance|inside|outside|account)\b[^,|]*\bsales\b|\bsales (representative|executive|engineer)\b|\bdriver\b/i,
  },
  {
    key: "customer_service_rep", label: "Customer service representative", onsite: false, headNoun: "representative",
    q: ["customer service representative", "customer support representative", "call center representative", "customer care representative", "client service representative", "customer service agent"],
    core: /\b(customer|client) (service|support|care|success) (representative|rep|agent|associate|specialist|advocate)\b|\bcall center (representative|agent)\b/i,
    not: /\b(manager|director|supervisor|engineer)\b/i,
  },
  {
    key: "chef", label: "Chef", onsite: true, headNoun: "chef", levelInQuery: true,
    q: ["sous chef", "chef de cuisine", "executive chef", "chef", "kitchen manager", "head chef"],
    core: /\bchef\b|\bkitchen manager\b/i,
  },
  {
    key: "line_cook", label: "Cook", onsite: true, headNoun: "cook",
    q: ["line cook", "prep cook", "cook", "kitchen staff", "grill cook", "short order cook"],
    core: /\b(line|prep|grill|short order|breakfast|banquet|fry)? ?cook\b|\bkitchen (staff|team member|assistant)\b/i,
    not: /\b(chef de cuisine|executive chef|manager|sous chef)\b/i,
  },
  {
    key: "server_bartender", label: "Server or bartender", onsite: true, headNoun: "server",
    q: ["server", "bartender", "waiter", "waitress", "food server", "barback"],
    core: /\b(server|bartender|waiter|waitress|barback|food runner|busser)\b/i,
    not: /\b(sql|server administrator|windows server|server engineer|web server|server technician|application server|linux|systems?)\b/i,
  },
  {
    key: "barista", label: "Barista", onsite: true, headNoun: "barista",
    q: ["barista", "coffee shop associate", "shift lead barista", "cafe associate"],
    core: /\bbarista\b|\bcafe (associate|team member)\b/i,
  },
  {
    key: "restaurant_manager", label: "Restaurant manager", onsite: true, headNoun: "manager", levelInQuery: true,
    q: ["restaurant manager", "general manager restaurant", "assistant restaurant manager", "food service manager", "shift manager restaurant"],
    core: /\b(restaurant|food service|cafe|dining|bar) (manager|general manager)\b|\bassistant restaurant manager\b/i,
  },
  {
    key: "hotel_front_desk", label: "Hotel front desk", onsite: true, headNoun: "agent",
    q: ["front desk agent", "guest service agent", "hotel front desk", "night auditor", "guest services representative", "concierge"],
    core: /\b(front desk|guest service|guest services) (agent|associate|representative)\b|\bnight auditor\b|\bconcierge\b/i,
  },
  {
    key: "housekeeper_janitor", label: "Housekeeping or custodial", onsite: true, headNoun: "custodian",
    q: ["housekeeper", "janitor", "custodian", "cleaner", "environmental services technician", "room attendant"],
    core: /\b(housekeep(er|ing)|janitor(ial)?|custodian|cleaner|environmental services|evs|room attendant)\b/i,
    not: /\b(manager|director|supervisor)\b/i,
  },
  {
    key: "security_guard", label: "Security officer", onsite: true, headNoun: "officer",
    q: ["security officer", "security guard", "armed security officer", "unarmed security officer", "loss prevention officer"],
    core: /\b(security|loss prevention) (officer|guard|agent)\b/i,
    not: /\b(information|cyber|chief|it|data|network)\b/i,
  },

  // ---- logistics and transport
  {
    key: "forklift_operator", label: "Forklift operator", onsite: true, headNoun: "operator",
    q: ["forklift operator", "forklift driver", "reach truck operator", "clamp operator"],
    core: /\b(forklift|reach truck|clamp|pallet jack) (operator|driver)\b/i,
  },
  {
    key: "warehouse_associate", label: "Warehouse associate", onsite: true, headNoun: "associate",
    q: ["warehouse associate", "warehouse worker", "order picker", "material handler", "package handler", "picker packer"],
    core: /\bwarehouse (associate|worker|team member|clerk|operative)\b|\b(order )?picker\b|\bpacker\b|\bmaterial handler\b|\bpackage handler\b|\bshipping (and receiving )?(clerk|associate)\b/i,
    not: /\b(manager|supervisor|director)\b/i,
  },
  {
    key: "truck_driver", label: "Truck driver (CDL)", onsite: true, headNoun: "driver", licensed: "cdl",
    q: ["cdl driver", "truck driver", "class a cdl driver", "tractor trailer driver", "delivery truck driver", "owner operator"],
    core: /\b(truck|cdl|tractor[- ]trailer|otr|class [ab]|semi|regional|local|flatbed|tanker) (truck )?driver\b|\bowner operator\b/i,
    not: /\b(manager|dispatcher|recruiter|mechanic)\b/i,
  },
  {
    key: "delivery_driver", label: "Delivery driver", onsite: true, headNoun: "driver",
    q: ["delivery driver", "courier", "van driver", "route driver", "package delivery driver", "driver helper"],
    core: /\b(delivery|van|route|courier|parcel|non-cdl) (driver|associate)\b|\bcourier\b/i,
    not: /\bcdl\b/i,
  },
  {
    key: "logistics_coordinator", label: "Logistics coordinator", onsite: false, headNoun: "coordinator",
    q: ["logistics coordinator", "dispatcher", "supply chain coordinator", "transportation coordinator", "shipping coordinator", "logistics specialist"],
    core: /\b(logistics|supply chain|transportation|shipping|freight) (coordinator|specialist|analyst|planner)\b|\bdispatcher\b/i,
    not: /\b(manager|director|911|police)\b/i,
  },
  {
    key: "buyer_purchasing", label: "Buyer or purchasing", onsite: false, headNoun: "buyer",
    q: ["buyer", "purchasing agent", "procurement specialist", "purchasing specialist", "sourcing specialist", "procurement analyst"],
    core: /\b(buyer|purchasing (agent|specialist|coordinator)|procurement (specialist|analyst|coordinator)|sourcing specialist)\b/i,
    not: /\b(media buyer|home buyer)\b/i,
  },

  // ---- trades
  {
    key: "apprentice_electrician", label: "Apprentice electrician", onsite: true, headNoun: "electrician",
    q: ["apprentice electrician", "electrician helper", "electrical apprentice", "electrician apprentice", "electrical helper", "pre-apprentice electrician"],
    core: /\b(apprentice|helper|trainee|pre[- ]apprentice)\b[^,|]*\belectric(ian|al)\b|\belectric(ian|al)\b[^,|]*\b(apprentice|helper|trainee)\b/i,
    near: /\bentry[- ]level electrician\b|\belectrical (installer|laborer)\b/i,
    not: /\bjourneyman\b|\bmaster\b|\blicensed\b|\bengineer\b|\bforeman\b|\bsupervisor\b/i,
  },
  {
    key: "electrician", label: "Electrician", onsite: true, headNoun: "electrician", licensed: "electrician",
    q: ["electrician", "electrical mechanic", "industrial electrician", "commercial electrician", "maintenance electrician", "leading hand electrician"],
    core: /\belectrician\b|\belectrical (mechanic|fitter)\b|\bsparky\b/i,
    near: /\b(electrical|instrument) (technician|tradesperson|fitter)\b|\bleading hand\b/i,
    not: /\bapprentice\b|\bengineer\b|\bsales\b|\bestimator\b|\bmanager\b|\bauto(motive)? electrician\b/i,
  },
  {
    key: "hvac_tech", label: "HVAC technician", onsite: true, headNoun: "technician", licensed: "epa608",
    q: ["hvac technician", "hvac installer", "hvac apprentice", "hvac helper", "hvac service technician", "refrigeration technician"],
    core: /\bhvac\b[^,|]*\b(technician|tech|installer|apprentice|helper|mechanic)\b|\b(refrigeration|hvac-?r) (technician|tech|mechanic)\b/i,
    near: /\b(heating|air conditioning|a\/c|mechanical service)\b[^,|]*\b(technician|installer|helper)\b|\bmaintenance technician\b[^,|]*\bhvac\b/i,
    not: /\b(sales|engineer|estimator|manager|supervisor|dispatcher)\b/i,
  },
  {
    key: "plumber", label: "Plumber", onsite: true, headNoun: "plumber",
    q: ["plumber", "journeyman plumber", "plumbing technician", "pipefitter", "apprentice plumber", "service plumber"],
    core: /\bplumb(er|ing technician)\b|\bpipe ?fitter\b/i,
    not: /\b(estimator|manager|sales|supply)\b/i,
  },
  {
    key: "welder", label: "Welder", onsite: true, headNoun: "welder",
    q: ["welder", "welder fabricator", "mig welder", "tig welder", "structural welder", "pipe welder"],
    core: /\bweld(er|ing technician)\b|\bfabricator\b/i,
    not: /\b(engineer|inspector|instructor)\b/i,
  },
  {
    key: "carpenter", label: "Carpenter", onsite: true, headNoun: "carpenter",
    q: ["carpenter", "finish carpenter", "framer", "cabinet maker", "journeyman carpenter", "carpenter apprentice"],
    core: /\bcarpent(er|ry)\b|\bframer\b|\bcabinet ?maker\b/i,
  },
  {
    key: "auto_mechanic", label: "Automotive technician", onsite: true, headNoun: "technician",
    q: ["automotive technician", "auto mechanic", "diesel mechanic", "lube technician", "fleet mechanic", "diesel technician"],
    core: /\b(automotive|auto|diesel|fleet|heavy equipment|truck) (technician|mechanic|tech)\b|\bmechanic\b|\blube tech/i,
    not: /\b(engineer|sales|service advisor|parts|electrical mechanic)\b/i,
  },
  {
    key: "maintenance_tech", label: "Maintenance technician", onsite: true, headNoun: "technician",
    q: ["maintenance technician", "maintenance mechanic", "facilities technician", "building maintenance technician", "industrial maintenance technician", "maintenance worker"],
    core: /\b(maintenance|facilities|facility|building|industrial maintenance|apartment maintenance) (technician|tech|mechanic|worker|engineer)\b/i,
    not: /\b(manager|director|aircraft|software)\b/i,
  },
  {
    key: "machinist_cnc", label: "Machinist or CNC operator", onsite: true, headNoun: "machinist",
    q: ["machinist", "cnc machinist", "cnc operator", "machine operator", "cnc programmer", "tool and die maker"],
    core: /\bmachinist\b|\bcnc\b|\bmachine operator\b|\btool and die\b/i,
  },
  {
    key: "construction_laborer", label: "Construction laborer", onsite: true, headNoun: "laborer",
    q: ["construction laborer", "general laborer", "laborer", "construction worker", "construction helper"],
    core: /\b(construction )?laborer\b|\bconstruction (worker|helper)\b|\bgeneral labor\b/i,
  },
  {
    key: "production_worker", label: "Production worker", onsite: true, headNoun: "associate",
    q: ["production worker", "assembler", "production associate", "manufacturing associate", "assembly technician", "production operator"],
    core: /\b(production|manufacturing) (worker|associate|operator|technician)\b|\bassembl(er|y (worker|technician|associate))\b/i,
  },

  // ---- engineering, legal, science
  {
    key: "mechanical_engineer", label: "Mechanical engineer", onsite: true, headNoun: "engineer",
    q: ["mechanical engineer", "mechanical design engineer", "product design engineer", "design engineer mechanical"],
    core: /\bmechanical (design )?engineer(ing)?\b|\bproduct design engineer\b/i,
    not: /\b(sales|software|technician)\b/i,
  },
  {
    key: "electrical_engineer", label: "Electrical engineer", onsite: true, headNoun: "engineer", licensed: "pe",
    q: ["electrical engineer", "electrical design engineer", "power engineer", "controls engineer", "electronics engineer", "hardware engineer"],
    core: /\b(electrical|electronics|power systems?|controls|hardware) (design )?engineer\b/i,
    not: /\b(sales|software|technician)\b/i,
  },
  {
    key: "civil_engineer", label: "Civil engineer", onsite: true, headNoun: "engineer", licensed: "pe",
    q: ["civil engineer", "structural engineer", "transportation engineer", "geotechnical engineer", "water resources engineer"],
    core: /\b(civil|structural|transportation|geotechnical|water resources|traffic) engineer\b/i,
    not: /\b(sales|software)\b/i,
  },
  {
    key: "manufacturing_engineer", label: "Manufacturing or process engineer", onsite: true, headNoun: "engineer",
    q: ["manufacturing engineer", "process engineer", "industrial engineer", "quality engineer", "production engineer", "continuous improvement engineer"],
    core: /\b(manufacturing|process|industrial|quality|production|continuous improvement) engineer\b/i,
    not: /\b(software|sales|data)\b/i,
  },
  {
    key: "paralegal", label: "Paralegal", onsite: false, headNoun: "paralegal",
    q: ["paralegal", "legal assistant", "litigation paralegal", "legal secretary", "corporate paralegal", "law clerk"],
    core: /\bparalegal\b|\blegal (assistant|secretary)\b|\blaw clerk\b/i,
  },
  {
    key: "attorney", label: "Attorney", onsite: false, headNoun: "attorney",
    q: ["attorney", "associate attorney", "lawyer", "staff attorney", "corporate counsel", "solicitor"],
    core: /\battorney\b|\blawyer\b|\b(corporate|associate|in-house|legal) counsel\b|\bsolicitor\b/i,
    not: /\b(paralegal|assistant|secretary)\b/i,
  },
  {
    key: "lab_scientist", label: "Laboratory scientist", onsite: true, headNoun: "scientist",
    q: ["research scientist", "research associate", "scientist", "laboratory technician", "biologist", "chemist"],
    core: /\b(research (associate|scientist)|scientist (i{1,3}|[123])|lab(oratory)? (technician|scientist|associate)|biochemist|biologist|chemist|postdoc(toral)?)\b/i,
    not: /\b(data scientist|computer scientist|sales|applied scientist)\b/i,
  },
];

const BY_KEY = new Map(TITLE_FAMILIES.map((f) => [f.key, f]));
export const familyByKey = (key: string | null | undefined): TitleFamily | null => (key ? BY_KEY.get(key) ?? null : null);

/** The first family a résumé title maps to, trying the titles in order. */
export function familyForTitles(titles: readonly string[]): { family: TitleFamily; title: string } | null {
  for (const title of titles) {
    const t = title.trim();
    if (!t) continue;
    for (const f of TITLE_FAMILIES) {
      // A title the family's own not-list names is another job, on a résumé as on a
      // posting: a court reporter is not a journalist (fit-score's stenographer case).
      if ((f.match ?? f.core).test(t) && !f.not?.test(t)) return { family: f, title: t };
    }
  }
  return null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * An occupation the families do not carry: the reader's own titles OR'ed,
 * each title's words in order with anything between (a title regex built
 * from what they wrote), and the generic not-list. family: null in the
 * response says so.
 */
export function fallbackFamily(titles: readonly string[]): TitleFamily | null {
  const clean = titles.map((t) => t.toLowerCase().replace(/[^a-z0-9&+' -]/g, " ").replace(/\s+/g, " ").trim()).filter((t) => t.length >= 3).slice(0, 3);
  if (!clean.length) return null;
  const core = new RegExp(clean.map((t) => t.split(" ").map((w) => `\\b${esc(w)}\\b`).join("[^,|]*")).join("|"), "i");
  const head = clean[0].split(" ").pop() ?? clean[0];
  return { key: "", label: titles[0], q: clean, core, not: GENERIC_NOT, headNoun: head, onsite: false };
}

/** websearch_to_tsquery text: quoted phrases OR'ed, or bare words for "any word order". */
export function familyQuery(phrases: readonly string[], anyOrder = false): string {
  const clean = phrases.map((p) => p.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  return clean.map((p) => (anyOrder || !p.includes(" ") ? p : `"${p}"`)).join(" or ");
}

/** 0 core, 1 near, 9 not this occupation. */
export function titleRank(f: TitleFamily, title: string): 0 | 1 | 9 {
  if (f.not?.test(title)) return 9;
  if (f.core.test(title)) return 0;
  if (f.near?.test(title)) return 1;
  return 9;
}

/** True when the not-list (not merely a miss) is why the title is out. */
export const notListed = (f: TitleFamily, title: string): boolean => !!f.not?.test(title);

/**
 * LEVEL WORDS IN A TITLE, as facets the device can re-tier from. "Staff" is a
 * rung only as the engineering rung and "lead" not beside a shift or a store
 * floor: the board's own bandFromTitle decides both (job-board/experience.ts),
 * so Staff Nurse and Shift Lead are not read as senior.
 */
export interface LevelFacets {
  intern: boolean;
  /** senior / lead / manager / director / staff rung, for entry readers. */
  aboveEntry: boolean;
  /** "II", "III", "Level 2": a rung above entry. */
  numeral: boolean;
  /** staff rung / principal / distinguished / director / VP / chief, for mid readers. */
  overreach: boolean;
  /** junior / entry-level / new grad / trainee, for senior and exec readers. */
  junior: boolean;
  assistant: boolean;
}
export function levelFacets(title: string): LevelFacets {
  const t = title ?? "";
  const band = bandFromTitle(t);
  return {
    intern: /\b(intern|internship|co-?op|summer (analyst|associate|student)|working student|werkstudent|student)\b/i.test(t),
    aboveEntry: band === "senior" || band === "expert" || /\bmanager\b/i.test(t),
    numeral: /(?:^|[\s,(-])(II|III|IV)(?:$|[\s,)-])|\blevel (2|3|ii|iii)\b/i.test(t),
    overreach: band === "expert" || /\b(principal|distinguished)\b/i.test(t) || (band === "senior" && /\bstaff\b/i.test(t)),
    junior: /\b(junior|jr\.?|entry[- ]level|new grad(uate)?|graduate|trainee)\b/i.test(t),
    assistant: /\bassistant\b/i.test(t),
  };
}
