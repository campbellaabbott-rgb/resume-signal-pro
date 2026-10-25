/**
 * GROUND TRUTH FOR THE 24 SYNTHETIC RÉSUMÉS — what a recruiter reading the CV
 * would know, written down BEFORE any job was retrieved, so the judge cannot
 * be tuned to the pipeline's output.
 *
 * Every person here is invented. Emails are @example.com, phones are 555 /
 * Ofcom-drama / ACMA-fictional ranges. Nothing here may be sent to a model
 * endpoint or uploaded as a real CV.
 *
 * Rubric fields (applied by harness/judge.ts, then reviewed by hand):
 *   target     title patterns the candidate is SEEKING and would be shortlisted for
 *   adjacent   title patterns a recruiter would still shortlist them for
 *   related    same field, a role a recruiter would NOT shortlist them for (counts
 *              against precision, but not as "wrong field")
 *   oldCareer  a career changer's previous occupation: they could be hired for it,
 *              they are explicitly leaving it, so it is NOT a match (reported apart)
 *   tooJunior  title words that make a posting a seniority mismatch (overqualified)
 *   tooSenior  title words that make a posting a seniority mismatch (underqualified)
 *   maxMinYears the largest stated posting minimum this person clears
 *   metro      places they can commute to; "city|ST" constrains the state/region
 *   relocate   "none" | "country" | list of regions (state codes / region names)
 *   authorized ISO2 countries they can work in without sponsorship
 *   sponsorshipFuture  needs sponsorship later even where they work now (F-1 OPT)
 *   citizen    false = a "U.S. citizenship / clearance required" posting fails
 */
export type Profile = "new_grad" | "mid" | "senior" | "career_changer";
export interface ResumeTruth {
  id: string;
  file: string;
  field: "software" | "nursing" | "retail" | "finance" | "marketing" | "trades" | "education" | "data";
  profile: Profile;
  country: string;
  home: string;
  years: number;
  gap: boolean;
  target: RegExp[];
  adjacent: RegExp[];
  related: RegExp[];
  oldCareer: RegExp[];
  tooJunior: RegExp[];
  tooSenior: RegExp[];
  maxMinYears: number;
  metro: string[];
  relocate: "none" | "country" | string[];
  remoteOk: boolean;
  authorized: string[];
  sponsorshipFuture: boolean;
  citizen: boolean;
  licences: string[];
  notes: string;
}

const SWE = /\b(software|swe|full[- ]?stack|back[- ]?end|backend|front[- ]?end|frontend|web|application|mobile|ios|android|java|python|golang|go|kotlin|typescript|node(\.js)?|react)\b[^,|]*\b(engineer|developer|programmer)\b|\bdeveloper\b|\bsoftware engineering\b/i;
const SWE_ADJ = /\b(devops|site reliability|sre|platform|cloud|infrastructure|systems|distributed systems|data|qa|quality|test|automation|machine learning|ml|security|firmware|embedded)\b[^,|]*\b(engineer|developer)\b/i;
const INTERN = /\b(intern|internship|co-?op|summer student|student)\b/i;
const RN = /\b(registered nurse|rn|r\.n\.|staff nurse|clinical nurse|nurse resident|graduate nurse|new grad(uate)? nurse|nurse i|travel nurse|float nurse|icu nurse|er nurse|ed nurse|charge nurse)\b|\bnurse\b(?!.*\b(practitioner|anesthetist|midwife|aide|assistant)\b)/i;

export const RESUMES: ResumeTruth[] = [
  {
    id: "sw-ng-austin", file: "sw-ng-austin.txt", field: "software", profile: "new_grad", country: "US", home: "Austin, TX",
    years: 0, gap: false,
    target: [SWE], adjacent: [SWE_ADJ], related: [/\b(solutions|sales|support|field|it)\b.*\b(engineer|specialist)\b|\bit support\b|\bhelp ?desk\b/i], oldCareer: [],
    tooJunior: [INTERN],
    tooSenior: [/\b(senior|sr\.?|staff|principal|lead|manager|director|architect|head|vp|chief|iii|iv)\b/i],
    maxMinYears: 2,
    metro: ["austin|TX", "round rock|TX", "cedar park|TX", "georgetown|TX", "san marcos|TX", "pflugerville|TX", "leander|TX", "kyle|TX", "buda|TX"],
    relocate: "country", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "New grad CS, two internships. Any US location by relocation.",
  },
  {
    id: "sw-mid-toronto", file: "sw-mid-toronto.txt", field: "software", profile: "mid", country: "CA", home: "Toronto, ON",
    years: 6, gap: false,
    target: [SWE], adjacent: [SWE_ADJ], related: [/\b(solutions|sales|support)\b.*\bengineer\b/i], oldCareer: [],
    tooJunior: [INTERN, /\b(junior|jr\.?|entry[- ]level|new grad|graduate|associate)\b|\b(engineer|developer) i\b/i],
    tooSenior: [/\b(staff|principal|distinguished|director|head|vp|chief|manager)\b/i],
    maxMinYears: 8,
    metro: ["toronto", "mississauga", "markham", "vaughan", "brampton", "north york", "scarborough", "etobicoke", "richmond hill", "oakville", "gta"],
    relocate: "none", remoteOk: true, authorized: ["CA"], sponsorshipFuture: false, citizen: false, licences: [],
    notes: "Canadian PR. US roles need sponsorship; remote must be remote-in-Canada.",
  },
  {
    id: "sw-sr-seattle", file: "sw-sr-seattle.txt", field: "software", profile: "senior", country: "US", home: "Seattle, WA",
    years: 15, gap: false,
    target: [SWE, /\b(distributed systems|infrastructure|storage|platform|backend|systems)\b[^,|]*\bengineer\b/i],
    adjacent: [SWE_ADJ, /\b(engineering manager|software architect|technical lead|tech lead)\b/i], related: [], oldCareer: [],
    tooJunior: [INTERN, /\b(junior|jr\.?|entry[- ]level|new grad|graduate|associate)\b|\b(engineer|developer) (i|ii)\b/i],
    tooSenior: [/\b(vp|vice president|chief|cto|director)\b/i],
    maxMinYears: 20,
    metro: ["seattle|WA", "bellevue|WA", "redmond|WA", "kirkland|WA", "bothell|WA", "everett|WA", "renton|WA", "issaquah|WA", "tukwila|WA", "lynnwood|WA", "kent|WA", "sammamish|WA", "woodinville|WA"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Staff engineer. A plain 'Software Engineer' title is acceptable unless the posting states <=2 years or junior wording.",
  },
  {
    id: "rn-ng-phoenix", file: "rn-ng-phoenix.txt", field: "nursing", profile: "new_grad", country: "US", home: "Phoenix, AZ",
    years: 0, gap: false,
    target: [RN], adjacent: [], related: [/\b(patient care tech|pct|cna|nursing assistant|medical assistant|lpn|lvn|nurse practitioner|crna|nurse anesthetist|midwife)\b/i], oldCareer: [],
    tooJunior: [],
    tooSenior: [/\b(charge|manager|director|supervisor|educator|coordinator|lead|chief|head|senior|sr\.?|ii|iii|specialist|navigator|case manager)\b/i],
    maxMinYears: 1,
    metro: ["phoenix|AZ", "mesa|AZ", "scottsdale|AZ", "tempe|AZ", "chandler|AZ", "glendale|AZ", "gilbert|AZ", "peoria|AZ", "surprise|AZ", "goodyear|AZ", "avondale|AZ", "buckeye|AZ"],
    relocate: ["AZ", "NM", "TX"], remoteOk: false, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: ["RN compact (AZ multistate)"],
    notes: "New grad RN. Compact licence covers AZ/NM/TX. RN jobs stating 2+ years fail.",
  },
  {
    id: "rn-mid-chicago", file: "rn-mid-chicago.txt", field: "nursing", profile: "mid", country: "US", home: "Chicago, IL",
    years: 7, gap: false,
    target: [RN], adjacent: [], related: [/\b(cna|nursing assistant|medical assistant|lpn|lvn|nurse practitioner|crna|nurse anesthetist|midwife|patient care tech)\b/i], oldCareer: [],
    tooJunior: [/\b(new grad|graduate nurse|nurse resident|residency)\b/i],
    tooSenior: [/\b(manager|director|chief|head|vp|cno)\b/i],
    maxMinYears: 9,
    metro: ["chicago|IL", "evanston|IL", "oak park|IL", "oak lawn|IL", "skokie|IL", "park ridge|IL", "des plaines|IL", "maywood|IL", "elmhurst|IL", "berwyn|IL", "cicero|IL", "evergreen park|IL", "blue island|IL", "harvey|IL", "hinsdale|IL", "downers grove|IL", "arlington heights|IL", "schaumburg|IL", "naperville|IL", "melrose park|IL", "hazel crest|IL", "olympia fields|IL", "niles|IL", "glenview|IL", "winfield|IL"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: ["RN Illinois (not compact)"],
    notes: "Experienced ICU RN: shortlisted for nearly any staff RN role; specialty roles demanding experience he lacks (L&D, OR, NICU) fail must-have.",
  },
  {
    id: "rn-sr-manchester", file: "rn-sr-manchester.txt", field: "nursing", profile: "senior", country: "GB", home: "Manchester, UK",
    years: 18, gap: false,
    target: [/\b(ward manager|ward sister|senior sister|sister\/charge nurse|charge nurse|matron|nurse manager|unit manager|clinical nurse manager|lead nurse|head of nursing|senior nurse|nursing manager|deputy director of nursing)\b/i],
    adjacent: [/\b(band 7|band 8a)\b/i], related: [/\b(staff nurse|band 5|band 6|deputy ward manager|registered nurse|healthcare assistant|nursing associate)\b/i], oldCareer: [],
    tooJunior: [/\b(band 5|staff nurse|newly qualified|preceptorship|deputy)\b/i],
    tooSenior: [/\b(chief nurse|director of nursing|chief nursing officer)\b/i],
    maxMinYears: 20,
    metro: ["manchester", "salford", "stockport", "oldham", "bolton", "bury", "rochdale", "wigan", "trafford", "tameside", "wythenshawe", "altrincham", "ashton", "stretford", "liverpool", "warrington", "preston", "blackburn", "blackpool", "lancaster", "chester", "wirral", "st helens", "burnley", "crewe", "macclesfield", "southport", "birkenhead", "north west", "greater manchester", "lancashire", "cheshire", "merseyside"],
    relocate: "none", remoteOk: false, authorized: ["GB"], sponsorshipFuture: false, citizen: true, licences: ["NMC (UK)"],
    notes: "Band 7 ward manager. Band 5/6 staff roles are overqualified (related, seniority mismatch).",
  },
  {
    id: "rt-ng-columbus", file: "rt-ng-columbus.txt", field: "retail", profile: "new_grad", country: "US", home: "Columbus, OH",
    years: 2, gap: false,
    target: [/\b(cashier|sales associate|retail associate|store associate|customer service (associate|representative|rep)|stock(er| associate)|crew member|team member|grocery clerk|courtesy clerk|front end associate|retail sales|merchandis(er|ing associate)|clerk|bagger)\b/i],
    adjacent: [/\b(barista|server|host|food service|restaurant|dishwasher|cook|deli|bakery)\b/i],
    related: [/\b(warehouse|picker|packer|driver|delivery|forklift|material handler)\b/i], oldCareer: [],
    tooJunior: [],
    tooSenior: [/\b(manager|supervisor|lead|director|key ?holder|assistant manager|specialist|pharmacist|technician|senior)\b/i],
    maxMinYears: 2,
    metro: ["columbus|OH", "whitehall|OH", "bexley|OH", "gahanna|OH", "reynoldsburg|OH", "westerville|OH", "worthington|OH", "upper arlington|OH", "grandview|OH", "hilliard|OH", "grove city|OH", "dublin|OH", "obetz|OH"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Hourly cashier, bus commuter. Driving roles fail (no car stated).",
  },
  {
    id: "rt-mid-gap-atlanta", file: "rt-mid-gap-atlanta.txt", field: "retail", profile: "mid", country: "US", home: "Atlanta, GA",
    years: 9, gap: true,
    target: [/^(?!.*\b(production|manufacturing|maintenance|forming|plant|residential|group home|clinical|rn|respiratory|crisis|security|mechanic|facility|health care|developmental|operations & maintenance|warehouse|night shift supervisor - night)\b).*\b(shift supervisor|retail supervisor|key ?holder|assistant store manager|assistant manager|department (supervisor|manager)|front end (supervisor|lead)|team lead|shift lead|supervisor|store lead|operations lead)\b/i], // refined in review: non-retail supervisors are related
    adjacent: [/\b(sales associate|cashier|retail associate|store associate|customer service|stock|team member|merchandis|clerk)\b/i],
    related: [/\b(warehouse|driver|pharmacy technician|supervisor)\b/i], oldCareer: [],
    tooJunior: [],
    tooSenior: [/\b(store manager|general manager|district|regional|director|area manager|vp)\b/i],
    maxMinYears: 8,
    metro: ["atlanta|GA", "decatur|GA", "sandy springs|GA", "marietta|GA", "smyrna|GA", "east point|GA", "college park|GA", "brookhaven|GA", "dunwoody|GA", "chamblee|GA", "doraville|GA", "tucker|GA", "stone mountain|GA", "roswell|GA", "alpharetta|GA", "kennesaw|GA", "lithonia|GA", "morrow|GA", "conyers|GA", "snellville|GA", "duluth|GA", "norcross|GA", "lawrenceville|GA"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Returner after a 2021-2024 caregiving gap. Associate roles one level down still shortlist.",
  },
  {
    id: "rt-sr-dallas", file: "rt-sr-dallas.txt", field: "retail", profile: "senior", country: "US", home: "Dallas, TX",
    years: 12, gap: false,
    target: [/\b(store manager|general manager|district manager|area manager|store director|multi-unit|market manager|store leader|retail manager)\b/i],
    adjacent: [/\b(operations manager|regional manager)\b/i], related: [/\b(assistant (store )?manager|department manager|supervisor|associate|cashier|merchandiser)\b/i], oldCareer: [],
    tooJunior: [/\b(assistant|associate|supervisor|clerk|cashier|lead|department manager|key ?holder|team member|trainee)\b/i],
    tooSenior: [/\b(vp|vice president|regional director|chief|president)\b/i],
    maxMinYears: 15,
    metro: ["dallas|TX", "garland|TX", "mesquite|TX", "plano|TX", "irving|TX", "richardson|TX", "carrollton|TX"],
    relocate: ["TX"], remoteOk: false, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Big-box store manager; relocation anywhere in Texas.",
  },
  {
    id: "fn-ng-nyc", file: "fn-ng-nyc.txt", field: "finance", profile: "new_grad", country: "US", home: "New York, NY",
    years: 0, gap: false,
    target: [/\b(financial analyst|fp&a analyst|finance analyst|investment banking analyst|corporate finance analyst|staff accountant|accountant|accounting associate|audit associate|assurance associate|finance associate|credit analyst|valuation analyst|investment analyst|financial reporting analyst|treasury analyst|tax associate)\b/i],
    adjacent: [/\b(business analyst|research analyst|analyst)\b/i], related: [/\b(accounts payable|accounts receivable|bookkeeper|billing|teller|financial advisor|payroll)\b/i], oldCareer: [],
    tooJunior: [INTERN],
    tooSenior: [/\b(senior|sr\.?|manager|director|vp|vice president|lead|head|principal|controller|ii|iii)\b/i],
    maxMinYears: 2,
    metro: ["new york|NY", "manhattan|NY", "brooklyn", "queens", "bronx", "staten island", "jersey city|NJ", "hoboken|NJ", "newark|NJ", "long island city", "white plains|NY", "yonkers|NY", "flushing", "stamford|CT", "nyc"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Entry-level finance/accounting; NYC metro only.",
  },
  {
    id: "fn-mid-charlotte", file: "fn-mid-charlotte.txt", field: "finance", profile: "mid", country: "US", home: "Charlotte, NC",
    years: 7, gap: false,
    target: [/\b(financial analyst|fp&a|financial planning|finance manager|business finance|finance business partner|budget analyst|corporate finance|finance analyst|planning analyst|financial reporting)\b/i],
    adjacent: [/\b(senior accountant|accounting manager|analyst)\b/i], related: [/\b(staff accountant|accountant|accounts payable|accounts receivable|bookkeeper|payroll|tax)\b/i], oldCareer: [],
    tooJunior: [INTERN, /\b(junior|jr\.?|entry[- ]level|associate|analyst i)\b/i],
    tooSenior: [/\b(director|vp|vice president|head|chief|cfo|controller)\b/i],
    maxMinYears: 9,
    metro: ["charlotte|NC", "concord|NC", "gastonia|NC", "huntersville|NC", "matthews|NC", "mooresville|NC", "rock hill|SC", "fort mill|SC", "cornelius|NC", "pineville|NC", "ballantyne"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "FP&A, MBA, 7 years.",
  },
  {
    id: "fn-sr-chicago", file: "fn-sr-chicago.txt", field: "finance", profile: "senior", country: "US", home: "Chicago, IL",
    years: 18, gap: false,
    target: [/\b(controller|vp,? (of )?(finance|accounting)|vice president,? (of )?(finance|accounting)|director of (accounting|finance|financial reporting)|accounting director|finance director|chief accounting officer|cao|cfo|chief financial officer|head of accounting|head of finance)\b/i],
    adjacent: [/\b(sec reporting|financial reporting) (director|manager)\b/i], related: [/\b(accountant|accounting manager|assistant controller|analyst|auditor|accounts payable|bookkeeper|tax)\b/i], oldCareer: [],
    tooJunior: [/\b(assistant controller|accountant|analyst|specialist|clerk|associate|coordinator|accounting manager|supervisor)\b/i],
    tooSenior: [],
    maxMinYears: 20,
    metro: ["chicago|IL", "schaumburg|IL", "oak brook|IL", "naperville|IL", "evanston|IL", "skokie|IL", "rosemont|IL", "des plaines|IL", "itasca|IL", "lombard|IL", "downers grove|IL", "elk grove village|IL", "northbrook|IL", "deerfield|IL", "lake forest|IL", "arlington heights|IL", "hoffman estates|IL", "lisle|IL", "aurora|IL", "westchester|IL", "oakbrook terrace|IL", "rolling meadows|IL", "bannockburn|IL", "lincolnshire|IL", "glenview|IL"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: ["CPA (Illinois)"],
    notes: "Public-company controller. Accounting manager/assistant controller are overqualified.",
  },
  {
    id: "mk-ng-boston", file: "mk-ng-boston.txt", field: "marketing", profile: "new_grad", country: "US", home: "Boston, MA",
    years: 1, gap: false,
    target: [/\b(marketing (coordinator|assistant|associate|specialist)|social media (coordinator|specialist|assistant|associate|manager)|content (coordinator|specialist|creator|associate)|communications? (coordinator|assistant|associate|specialist)|digital marketing (coordinator|assistant|associate|specialist)|email marketing (coordinator|specialist)|community (coordinator|associate)|brand (coordinator|associate|assistant)|events? coordinator|pr (coordinator|assistant))\b/i],
    adjacent: [/\b(marketing|social media|content|communications|public relations|events)\b/i], related: [/\b(sales|account executive|business development)\b/i], oldCareer: [],
    tooJunior: [INTERN],
    tooSenior: [/\b(manager|senior|sr\.?|director|head|lead|vp|vice president|chief|principal)\b/i],
    maxMinYears: 2,
    metro: ["boston|MA", "cambridge|MA", "somerville|MA", "brookline|MA", "newton|MA", "quincy|MA", "waltham|MA", "watertown|MA", "medford|MA", "malden|MA", "burlington|MA", "needham|MA", "woburn|MA", "new york|NY", "manhattan|NY", "brooklyn", "jersey city|NJ", "hoboken|NJ", "nyc"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Communication grad; Boston or NYC.",
  },
  {
    id: "mk-mid-denver", file: "mk-mid-denver.txt", field: "marketing", profile: "mid", country: "US", home: "Denver, CO",
    years: 8, gap: false,
    target: [/\b(digital marketing|performance marketing|growth marketing|paid media|paid search|paid social|sem|seo|acquisition marketing|ecommerce marketing|e-commerce marketing|demand generation|marketing manager)\b/i],
    adjacent: [/\b(marketing|growth|media buyer|marketing analytics)\b/i], related: [/\b(sales|account executive|brand ambassador)\b/i], oldCareer: [],
    tooJunior: [INTERN, /\b(coordinator|assistant|junior|jr\.?|entry[- ]level)\b/i],
    tooSenior: [/\b(vp|vice president|chief|cmo|head of marketing)\b/i],
    maxMinYears: 10,
    metro: ["denver|CO", "aurora|CO", "lakewood|CO", "englewood|CO", "littleton|CO", "boulder|CO", "broomfield|CO", "westminster|CO", "arvada|CO", "centennial|CO", "greenwood village|CO", "golden|CO", "louisville|CO", "thornton|CO", "highlands ranch|CO", "lone tree|CO"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Performance marketing manager, 8 years.",
  },
  {
    id: "mk-ch-journalist-portland", file: "mk-ch-journalist-portland.txt", field: "marketing", profile: "career_changer", country: "US", home: "Portland, OR",
    years: 11, gap: false,
    target: [/\b(content (marketing|writer|strategist|manager|specialist|marketing manager|lead)|copywriter|marketing writer|communications? (specialist|manager|coordinator|associate)|public relations|pr specialist|content designer|editorial|brand journalist|ux writer|technical writer|proposal writer|grant writer)\b/i],
    adjacent: [/\b(editor|writer|social media|marketing (specialist|manager|coordinator))\b/i], related: [/\b(sales|graphic designer)\b/i],
    oldCareer: [/\b(reporter|journalist|correspondent|news (editor|producer)|anchor)\b/i],
    tooJunior: [INTERN],
    tooSenior: [/\b(director|vp|vice president|head of|chief)\b/i],
    maxMinYears: 5,
    metro: ["portland|OR", "beaverton|OR", "hillsboro|OR", "lake oswego|OR", "tigard|OR", "gresham|OR", "vancouver|WA", "tualatin|OR", "milwaukie|OR", "wilsonville|OR"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Journalist -> content marketing. Reporter postings are his OLD career.",
  },
  {
    id: "tr-ng-hvac-houston", file: "tr-ng-hvac-houston.txt", field: "trades", profile: "new_grad", country: "US", home: "Houston, TX",
    years: 0, gap: false,
    target: [/\b(hvac|hvac-?r|refrigeration|a\/c|air conditioning|heating)\b/i],
    adjacent: [/\b(maintenance technician|building maintenance|facilities technician|maintenance mechanic|appliance (repair )?technician|maintenance helper)\b/i],
    related: [/\b(electrician|plumber|warehouse)\b/i], oldCareer: [],
    tooJunior: [],
    tooSenior: [/\b(senior|sr\.?|lead|supervisor|manager|master|foreman|iii|ii|level (2|3|ii|iii)|commercial service technician|controls technician)\b/i],
    maxMinYears: 1,
    metro: ["houston|TX", "pasadena|TX", "sugar land|TX", "katy|TX", "pearland|TX", "baytown|TX", "the woodlands|TX", "spring|TX", "humble|TX", "missouri city|TX", "cypress|TX", "stafford|TX", "bellaire|TX", "league city|TX", "tomball|TX", "conroe|TX"],
    relocate: "none", remoteOk: false, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: ["EPA 608 Universal", "TX driver's licence"],
    notes: "Trade-school HVAC grad. Postings asking 2+ years of field experience fail.",
  },
  {
    id: "tr-mid-brisbane", file: "tr-mid-brisbane.txt", field: "trades", profile: "mid", country: "AU", home: "Brisbane, QLD",
    years: 8, gap: false,
    target: [/\belectrician\b|\b(leading hand|electrical (supervisor|fitter|mechanic|tradesperson|technician))\b|\bsparky\b/i],
    adjacent: [/\b(instrument(ation)? (technician|electrician)|e&i|electrical maintenance)\b/i], related: [/\b(electrical engineer|apprentice)\b/i], oldCareer: [],
    tooJunior: [/\b(apprentice|trainee|helper|pre-?apprentice|labourer|laborer)\b/i],
    tooSenior: [/\b(manager|engineer|director|superintendent)\b/i],
    maxMinYears: 10,
    metro: ["brisbane", "gold coast", "sunshine coast", "ipswich", "logan", "redcliffe", "moreton bay", "caboolture", "maroochydore", "caloundra", "springfield", "beenleigh", "redland", "capalaba", "strathpine", "north lakes", "eagle farm", "pinkenba", "acacia ridge", "rocklea", "wacol", "toowoomba", "south east queensland", "seq"],
    relocate: "none", remoteOk: false, authorized: ["AU"], sponsorshipFuture: false, citizen: true, licences: ["QLD electrical mechanic licence"],
    notes: "Australian A-grade electrician. US/UK electrician jobs fail on licence and authorization.",
  },
  {
    id: "tr-ch-cook-to-electrician-philly", file: "tr-ch-cook-to-electrician-philly.txt", field: "trades", profile: "career_changer", country: "US", home: "Philadelphia, PA",
    years: 8, gap: false,
    target: [/\b(apprentice electrician|electrician apprentice|electrical apprentice|electrician helper|electrical helper|helper electrician|pre-?apprentice|electrical trainee|apprentice)\b/i],
    adjacent: [/\b(low voltage (technician|installer)|solar installer|maintenance helper|cable (technician|installer)|electrical (assembler|installer))\b/i],
    related: [/\belectrician\b|\b(electrical technician|maintenance technician)\b/i],
    oldCareer: [/\b(line cook|cook|chef|sous chef|prep cook|kitchen|food service|restaurant|culinary|dishwasher)\b/i],
    tooJunior: [],
    tooSenior: [/\b(journeyman|journey|master|licensed|lead|foreman|senior|sr\.?|supervisor|manager|level (2|3|ii|iii)|ii|iii|class a)\b/i],
    maxMinYears: 1,
    metro: ["philadelphia|PA", "camden|NJ", "cherry hill|NJ", "king of prussia|PA", "conshohocken|PA", "norristown|PA", "upper darby|PA", "chester|PA", "media|PA", "bensalem|PA", "bristol|PA", "levittown|PA", "ardmore|PA", "plymouth meeting|PA", "willow grove|PA", "horsham|PA", "fort washington|PA", "pennsauken|NJ", "mount laurel|NJ", "wilmington|DE"],
    relocate: "none", remoteOk: false, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: ["OSHA 30", "PA driver's licence"],
    notes: "Line cook -> apprentice electrician. A plain 'Electrician' (licensed/journeyman) job is a seniority mismatch; cook jobs are his OLD career.",
  },
  {
    id: "ed-ng-sacramento", file: "ed-ng-sacramento.txt", field: "education", profile: "new_grad", country: "US", home: "Sacramento, CA",
    years: 0, gap: false,
    // Refined during review (intent unchanged, see notes): subject specialists,
    // aides/assistants and early-childhood roles are RELATED, never target/adjacent.
    target: [/^(?!.*\b(aide|assistant|physical education|music|art|science|spanish|special education|exceptional|preschool)\b).*(\b(elementary|kindergarten|transitional kindergarten|tk|multiple subject|(1st|2nd|3rd|4th|5th|6th|first|second|third|fourth|fifth|sixth)[- ]grade)\b.*\bteacher\b|\bteacher\b.*\b(elementary|kindergarten|k-?[56]|multiple subject|grade [1-6])\b|\b(classroom teacher|general education teacher)\b)/i],
    adjacent: [/^(?!.*\b(aide|assistant|preschool|pre-?k|infant|toddler|early (learning|childhood)|daycare|special education|exceptional|high school|middle school|secondary|mathematics|math|physical education|music|art|science|spanish|english)\b).*\b(substitute teacher|intervention teacher|reading teacher|teacher)\b/i],
    related: [/\b(preschool|pre-k|early childhood|instructional aide|paraprofessional|para-?educator|tutor|teacher assistant|teacher aide|after.?school|special education|education specialist|resource specialist|high school|middle school|secondary|physical education|music|art|science|mathematics|math|spanish|english|teacher)\b/i], oldCareer: [],
    tooJunior: [],
    tooSenior: [/\b(principal|director|coordinator|coach|specialist|lead teacher|department chair|administrator)\b/i],
    maxMinYears: 1,
    metro: ["sacramento|CA", "elk grove|CA", "roseville|CA", "folsom|CA", "rancho cordova|CA", "citrus heights|CA", "west sacramento|CA", "davis|CA", "rocklin|CA", "carmichael|CA", "natomas", "fair oaks|CA", "orangevale|CA", "lincoln|CA", "el dorado hills|CA", "woodland|CA", "galt|CA"],
    relocate: "none", remoteOk: false, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: ["CA Preliminary Multiple Subject Credential"],
    notes: "New elementary teacher. Credential is California-only; single-subject (secondary) and special-ed roles need other credentials.",
  },
  {
    id: "ed-mid-gap-raleigh", file: "ed-mid-gap-raleigh.txt", field: "education", profile: "mid", country: "US", home: "Raleigh, NC",
    years: 9, gap: true,
    target: [/\b(math(ematics)?)\b.*\b(teacher|instructor|interventionist)\b|\bteacher\b.*\bmath/i],
    adjacent: [/\b(middle school teacher|high school teacher|secondary teacher|substitute teacher|instructional coach)\b/i],
    related: [/\b(teacher|tutor|teacher assistant|paraprofessional|instructional aide|elementary)\b/i], oldCareer: [],
    tooJunior: [/\b(assistant|aide|paraprofessional)\b/i],
    tooSenior: [/\b(principal|director|superintendent|administrator|dean)\b/i],
    maxMinYears: 9,
    metro: ["raleigh|NC", "durham|NC", "cary|NC", "apex|NC", "chapel hill|NC", "morrisville|NC", "wake forest|NC", "garner|NC", "holly springs|NC", "knightdale|NC", "fuquay|NC", "rolesville|NC", "wendell|NC", "zebulon|NC", "hillsborough|NC", "clayton|NC", "research triangle"],
    relocate: "none", remoteOk: false, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: ["NC Mathematics 6-9"],
    notes: "Math teacher returning after a 2019-2023 gap. Licence covers math 6-9 in NC.",
  },
  {
    id: "ed-ch-teacher-to-id-minneapolis", file: "ed-ch-teacher-to-id-minneapolis.txt", field: "education", profile: "career_changer", country: "US", home: "Minneapolis, MN",
    years: 11, gap: false,
    target: [/\b(instructional design(er)?|learning experience designer|learning designer|e-?learning (developer|designer|specialist)|curriculum (developer|designer|writer|specialist)|training (specialist|developer|designer)|learning (and|&) development (specialist|partner)|l&d specialist|instructional technologist|learning specialist|course designer|learning content)\b/i],
    adjacent: [/\b(trainer|training coordinator|lms administrator|enablement specialist|education specialist|learning (consultant|coordinator)|technical writer)\b/i],
    related: [/\b(curriculum director|training manager)\b/i],
    oldCareer: [/\b(teacher|substitute|tutor|paraprofessional|teaching assistant|instructor)\b/i],
    tooJunior: [INTERN],
    tooSenior: [/\b(director|head|vp|vice president|manager|principal|lead)\b/i],
    maxMinYears: 4,
    metro: ["minneapolis|MN", "saint paul|MN", "st. paul|MN", "st paul|MN", "bloomington|MN", "edina|MN", "eden prairie|MN", "minnetonka|MN", "plymouth|MN", "st louis park|MN", "st. louis park|MN", "roseville|MN", "maple grove|MN", "eagan|MN", "burnsville|MN", "golden valley|MN", "richfield|MN", "brooklyn park|MN", "shakopee|MN", "hopkins|MN", "arden hills|MN", "twin cities"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "Teacher -> instructional designer. Teaching postings are her OLD career.",
  },
  {
    id: "da-ng-opt-sanjose", file: "da-ng-opt-sanjose.txt", field: "data", profile: "new_grad", country: "US", home: "San Jose, CA",
    years: 1, gap: false,
    target: [/\b(data analyst|business analyst|data scientist|analytics (associate|analyst)|business intelligence analyst|bi analyst|reporting analyst|marketing analyst|product analyst|operations analyst|insights analyst|quantitative analyst|data associate)\b/i],
    adjacent: [/\b(data engineer|research analyst|analyst)\b/i], related: [/\b(software engineer|financial analyst)\b/i], oldCareer: [],
    tooJunior: [INTERN],
    tooSenior: [/\b(senior|sr\.?|lead|principal|staff|manager|director|head|vp|iii|ii)\b/i],
    maxMinYears: 2,
    metro: ["san jose|CA", "santa clara|CA", "sunnyvale|CA", "mountain view|CA", "palo alto|CA", "cupertino|CA", "milpitas|CA", "fremont|CA"],
    relocate: "country", remoteOk: true, authorized: ["US"], sponsorshipFuture: true, citizen: false, licences: [],
    notes: "F-1 STEM OPT: 'no sponsorship now or in the future' and 'US citizen / clearance' postings fail.",
  },
  {
    id: "da-mid-pittsburgh", file: "da-mid-pittsburgh.txt", field: "data", profile: "mid", country: "US", home: "Pittsburgh, PA",
    years: 6, gap: false,
    target: [/\b(data analyst|business intelligence|bi (analyst|developer|engineer)|analytics engineer|reporting analyst|analytics manager|data visualization|insights analyst|healthcare data analyst|analytics (analyst|consultant|lead))\b/i],
    adjacent: [/\b(product analyst|data engineer|data scientist|business analyst|operations analyst|analyst)\b/i], related: [/\b(software engineer|financial analyst)\b/i], oldCareer: [],
    tooJunior: [INTERN, /\b(junior|jr\.?|entry[- ]level|associate|analyst i)\b/i],
    tooSenior: [/\b(director|head|vp|vice president|chief)\b/i],
    maxMinYears: 8,
    metro: ["pittsburgh|PA", "cranberry|PA", "monroeville|PA", "mount lebanon|PA", "bethel park|PA", "wexford|PA", "canonsburg|PA", "coraopolis|PA", "moon township|PA", "sewickley|PA", "bridgeville|PA", "robinson|PA"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: false, licences: [],
    notes: "US permanent resident: citizenship or clearance-required postings fail.",
  },
  {
    id: "da-ch-biochem-to-ds-sandiego", file: "da-ch-biochem-to-ds-sandiego.txt", field: "data", profile: "career_changer", country: "US", home: "San Diego, CA",
    years: 5, gap: false,
    target: [/\b(data scientist|bioinformatics|computational biolog|machine learning scientist|research data scientist|scientific data|biostatistic|statistician|quantitative scientist)\b/i],
    adjacent: [/\b(data analyst|machine learning engineer|ml engineer|analytics|data science)\b/i], related: [/\b(data engineer|software engineer)\b/i],
    oldCareer: [/\b(scientist|research associate|assay|lab(oratory)? technician|biologist|chemist|postdoc|research technician)\b/i],
    tooJunior: [INTERN],
    tooSenior: [/\b(director|head|vp|vice president|principal|staff|lead|manager)\b/i],
    maxMinYears: 5,
    metro: ["san diego|CA", "la jolla|CA", "carlsbad|CA", "sorrento valley", "del mar|CA", "escondido|CA", "oceanside|CA", "chula vista|CA", "poway|CA", "solana beach|CA", "encinitas|CA", "torrey pines", "san marcos|CA", "vista|CA"],
    relocate: "none", remoteOk: true, authorized: ["US"], sponsorshipFuture: false, citizen: true, licences: [],
    notes: "PhD biochemist -> data scientist. Wet-lab 'Scientist' postings are his OLD career (oldCareer is checked AFTER target, so 'Data Scientist' is target).",
  },
];
