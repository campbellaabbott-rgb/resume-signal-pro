



import type { JobSourceKind } from "./sources.ts";
import { categorize, type JobCategory } from "./categories.ts";

export interface JobPosting {
  
  id: string;
  source: JobSourceKind;
  
  token: string;
  company: string;
  title: string;
  location: string;
  
  remote: boolean;
  

  workMode: "remote" | "hybrid" | "onsite" | null;
  department: string | null;
  
  postedAt: string | null;
  
  category: JobCategory;
  
  salary: string | null;
  

  country?: string | null;
  
  applyUrl: string;
  




  employmentType?: EmploymentType | null;
}

export type EmploymentType = "full_time" | "part_time" | "contract" | "temporary" | "internship";













export function normalizeEmploymentType(raw: unknown): EmploymentType | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!v) return null;
  if (/^(fulltime|permanent|regular|cdi|festanstellung|fullorparttime)$/.test(v)) return "full_time";
  if (/^(parttime|minijob|casual)$/.test(v)) return "part_time";
  if (/^(contract|contractor|fixedterm|cdd|freelance|b2b)$/.test(v)) return "contract";
  if (/^(temporary|temp|seasonal|interim)$/.test(v)) return "temporary";
  if (/^(intern|internship|trainee|apprentice|apprenticeship|workingstudent|werkstudent)$/.test(v)) return "internship";
  return null;
}




const safeUrl = (u: unknown): string => {
  if (typeof u !== "string") return "";
  if (/^https:\/\
  if (/^http:\/\
  return "";
};














export const POSTED_AT_GARBAGE_FLOOR_MS = Date.parse("2010-01-01T00:00:00Z");







export function sanePostedAt(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso || typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t > now + 2 * 86_400_000) return null;      
  
  
  
  
  
  
  
  
  
  
  
  if (t > now) return new Date(now).toISOString();
  if (t < POSTED_AT_GARBAGE_FLOOR_MS) return null; 
  return iso;
}








export function normalizeCloseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[([{][^)\]}]*\d[^)\]}]*[)\]}]/g, " ")          
    .replace(/\s*[-–—#·|]\s*(?:req|job|id|jr)?[\s#:-]*\d{3,}\s*$/i, " ") 
    .replace(/\s+/g, " ")
    .trim();
}








export function safeIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}





export function isDatedBefore(sanitizedPostedAt: string | null, cutoffMs: number): boolean {
  return sanitizedPostedAt !== null && Date.parse(sanitizedPostedAt) < cutoffMs;
}





const unescapeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    
    
    
    
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; })
    .replace(/&#(\d+);/g, (_, d) => { const c = parseInt(d, 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; })
    .replace(/&nbsp;/g, " ")
    
    
    
    
    
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&(rsquo|apos);/gi, "'")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rdquo;/gi, "\u201d")
    .replace(/&ldquo;/gi, "\u201c")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&(bull|middot);/gi, "\u00b7")
    .replace(/&amp;/g, "&"); 

export function htmlToText(html: string): string {
  const unescaped = unescapeEntities(unescapeEntities(html));
  return unescaped
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

const looksRemote = (s: string) => /\bremote\b/i.test(s);







const P_HYBRID = /\bhybrid\b|\bhybride\b|\bh[íi]brido?\b/i;
const P_REMOTE = /\bremote\b|\bwork from home\b|\bwfh\b|\bt[ée]l[ée]travail\b|\bhome\s?office\b|\bremoto\b|\bthuiswerken\b|\bteletrabajo\b/i;
const P_ONSITE = /\bon-?site\b|\bin-?office\b|\bvor ort\b|\bpresencial\b|\bsur site\b/i;
export function detectWorkMode(...parts: Array<string | null | undefined>): "remote" | "hybrid" | "onsite" | null {
  const s = parts.filter(Boolean).join(" · ");
  if (!s) return null;
  if (P_HYBRID.test(s)) return "hybrid";
  if (P_REMOTE.test(s)) return "remote";
  if (P_ONSITE.test(s)) return "onsite";
  return null;
}














const VENDOR_MODE = new Map<string, "remote" | "hybrid" | "onsite">([
  ["remote", "remote"], ["hybrid", "hybrid"], ["onsite", "onsite"], ["on_site", "onsite"],
  
  ["ora_remote", "remote"], ["ora_hybrid", "hybrid"], ["ora_onsite", "onsite"],
  ["ora_on_site", "onsite"], ["ora_office", "onsite"],
  
  ["fully_remote", "remote"], ["remote_working", "remote"], ["work_from_home", "remote"],
  ["telecommute", "remote"], ["in_office", "onsite"], ["in_person", "onsite"],
  ["office", "onsite"], ["flexible", "hybrid"], ["partially_remote", "hybrid"],
]);

export function vendorWorkMode(v: string | null | undefined): "remote" | "hybrid" | "onsite" | null {
  if (typeof v !== "string") return null;
  return VENDOR_MODE.get(v.toLowerCase().replace(/[\s-]+/g, "_")) ?? null;
}






const COUNTRY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:united states|u\.?s\.?a\.?|estados unidos)\b/i, "US"],
  
  
  
  
  
  
  
  [/\b(?:united kingdom|england|scotland|(?<!new south )wales|northern ireland)\b|\bUK\b/i, "GB"],
  [/\b(?:germany|deutschland)\b/i, "DE"],
  [/\bcanada\b/i, "CA"],
  [/\bfrance\b/i, "FR"],
  [/\b(?:netherlands|nederland)\b/i, "NL"],
  [/\bindia\b/i, "IN"],
  [/\b(?:australia|new south wales)\b/i, "AU"],
  [/\b(?:poland|polska)\b/i, "PL"],
  [/\b(?:spain|españa)\b/i, "ES"],
  
  
  
  
  [/\b(?<!new )(?:mexico|méxico)\b/i, "MX"],
  [/\b(?:brazil|brasil)\b/i, "BR"],
  [/\bphilippines\b/i, "PH"],
  [/\b(?:sweden|sverige)\b/i, "SE"],
  [/\b(?:denmark|danmark)\b/i, "DK"],
  [/\b(?:norway|norge)\b/i, "NO"],
  [/\b(?:switzerland|schweiz|suisse)\b/i, "CH"],
  [/\b(?:austria|österreich)\b/i, "AT"],
  [/\bireland\b/i, "IE"],
  [/\b(?:belgium|belgië|belgique)\b/i, "BE"],
  [/\bportugal\b/i, "PT"],
  [/\b(?:italy|italia)\b/i, "IT"],
  [/\bjapan\b/i, "JP"],
  [/\bsingapore\b/i, "SG"],
  [/\bnew zealand\b/i, "NZ"],
  [/\bczech(?:ia)?\b/i, "CZ"],
  [/\bromania\b/i, "RO"],
  [/\bhungary\b/i, "HU"],
  [/\b(?:finland|suomi)\b/i, "FI"],
  [/\bgreece\b/i, "GR"],
  [/\bisrael\b/i, "IL"],
  [/\b(?:united arab emirates|uae|dubai|abu dhabi)\b/i, "AE"],
  [/\bsaudi arabia\b/i, "SA"],
  [/\bsouth africa\b/i, "ZA"],
  [/\bargentina\b/i, "AR"],
  [/\bcolombia\b/i, "CO"],
  [/\bchile\b/i, "CL"],
  [/\bperu\b/i, "PE"],
  [/\bviet\s?nam\b/i, "VN"],
  [/\bindonesia\b/i, "ID"],
  [/\bmalaysia\b/i, "MY"],
  [/\bthailand\b/i, "TH"],
  [/\b(?:south korea|korea)\b/i, "KR"],
  [/\b(?:turkey|türkiye)\b/i, "TR"],
  [/\bukraine\b/i, "UA"],
  [/\bcosta rica\b/i, "CR"],
  
  
  
  
  
  [/\bchina\b/i, "CN"],
  [/\bpakistan\b/i, "PK"],
  [/\btaiwan\b/i, "TW"],
  [/\bbulgaria\b/i, "BG"],
  [/\bcroatia\b/i, "HR"],
  [/\bslovakia\b/i, "SK"],
  [/\bserbia\b/i, "RS"],
  [/\bslovenia\b/i, "SI"],
  [/\begypt\b/i, "EG"],
  [/\bmorocco\b/i, "MA"],
  [/\btunisia\b/i, "TN"],
  [/\bkenya\b/i, "KE"],
  [/\becuador\b/i, "EC"],
  [/\buruguay\b/i, "UY"],
];


const P_US_STATE_CODE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?![A-Za-z])/;
const P_CA_PROV_CODE = /,\s*(ON|QC|BC|AB|MB|SK|NS|NB|PE|NL|YT|NT|NU)(?![A-Za-z])/;













const P_US_STATE_CODE_LEADING =
  /^(AK|AR|AZ|CT|FL|IA|KS|KY|MN|NC|ND|NH|NJ|NM|NV|NY|RI|SD|TN|TX|UT|VT|WI|WV|WY|IL|MO)\s*[-–—]?\s+[A-Za-z]/;
const P_US_STATE_NAME = /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
const P_CA_PROV_NAME = /\b(?:ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland)\b/i;











export const COUNTRY_MAP_VERSION = 5;
const CITY_COUNTRY = new Map<string, string>([
  ["aarhus", "DK"],
  ["aberdeen", "GB"],
  ["abu dhabi", "AE"],
  ["abuja", "NG"],
  ["adelaide", "AU"],
  ["ahmedabad", "IN"],
  ["al khobar", "SA"],
  ["albuquerque", "US"],
  ["alexandria", "EG"],
  ["amsterdam", "NL"],
  ["ankara", "TR"],
  ["antwerp", "BE"],
  ["antwerpen", "BE"],
  ["atlanta", "US"],
  ["auckland", "NZ"],
  ["austin", "US"],
  ["baltimore", "US"],
  ["bandung", "ID"],
  ["bangalore", "IN"],
  ["bangkok", "TH"],
  ["barcelona", "ES"],
  ["barranquilla", "CO"],
  ["basel", "CH"],
  ["beijing", "CN"],
  ["belfast", "GB"],
  ["belo horizonte", "BR"],
  ["bengaluru", "IN"],
  ["bergen", "NO"],
  ["berlin", "DE"],
  ["bern", "CH"],
  ["bilbao", "ES"],
  ["bogota", "CO"],
  ["boise", "US"],
  ["bologna", "IT"],
  ["bordeaux", "FR"],
  ["boston", "US"],
  ["braga", "PT"],
  ["brasilia", "BR"],
  ["bremen", "DE"],
  ["brighton", "GB"],
  ["brisbane", "AU"],
  ["bristol", "GB"],
  ["brno", "CZ"],
  ["brooklyn", "US"],
  ["brussels", "BE"],
  ["bruxelles", "BE"],
  ["buenos aires", "AR"],
  ["buffalo", "US"],
  ["busan", "KR"],
  ["cairo", "EG"],
  ["calgary", "CA"],
  ["cali", "CO"],
  ["cambridge", "GB"],
  ["campinas", "BR"],
  ["canberra", "AU"],
  ["cape town", "ZA"],
  ["cardiff", "GB"],
  ["cdmx", "MX"],
  ["cebu", "PH"],
  ["cebu city", "PH"],
  ["chandigarh", "IN"],
  ["charlotte", "US"],
  ["chengdu", "CN"],
  ["chennai", "IN"],
  ["chiang mai", "TH"],
  ["chicago", "US"],
  ["christchurch", "NZ"],
  ["cincinnati", "US"],
  ["ciudad de mexico", "MX"],
  ["cleveland", "US"],
  ["coimbatore", "IN"],
  ["cologne", "DE"],
  ["columbus", "US"],
  ["copenhagen", "DK"],
  ["cork", "IE"],
  ["coventry", "GB"],
  ["curitiba", "BR"],
  ["cyberjaya", "MY"],
  ["da nang", "VN"],
  ["dallas", "US"],
  ["dammam", "SA"],
  ["delhi", "IN"],
  ["den haag", "NL"],
  ["denver", "US"],
  ["des moines", "US"],
  ["detroit", "US"],
  ["doha", "QA"],
  ["dortmund", "DE"],
  ["dresden", "DE"],
  ["dubai", "AE"],
  ["dublin", "IE"],
  ["duesseldorf", "DE"],
  ["durban", "ZA"],
  ["dusseldorf", "DE"],
  ["edinburgh", "GB"],
  ["edmonton", "CA"],
  ["eindhoven", "NL"],
  ["el paso", "US"],
  ["espoo", "FI"],
  ["essen", "DE"],
  ["firenze", "IT"],
  ["florence", "IT"],
  ["fort worth", "US"],
  ["fortaleza", "BR"],
  ["frankfurt", "DE"],
  ["fukuoka", "JP"],
  ["galway", "IE"],
  ["gdansk", "PL"],
  ["geneva", "CH"],
  ["geneve", "CH"],
  ["gent", "BE"],
  ["ghent", "BE"],
  ["glasgow", "GB"],
  ["gold coast", "AU"],
  ["goteborg", "SE"],
  ["gothenburg", "SE"],
  ["graz", "AT"],
  ["grenoble", "FR"],
  ["guadalajara", "MX"],
  ["guangzhou", "CN"],
  ["gurgaon", "IN"],
  ["gurugram", "IN"],
  ["haifa", "IL"],
  ["hamburg", "DE"],
  ["hangzhou", "CN"],
  ["hannover", "DE"],
  ["hanoi", "VN"],
  ["helsinki", "FI"],
  ["heredia", "CR"],
  ["herzliya", "IL"],
  ["ho chi minh city", "VN"],
  ["hong kong", "HK"],
  ["honolulu", "US"],
  ["houston", "US"],
  ["hsinchu", "TW"],
  ["hyderabad", "IN"],
  ["incheon", "KR"],
  ["indianapolis", "US"],
  ["indore", "IN"],
  ["istanbul", "TR"],
  ["izmir", "TR"],
  ["jaipur", "IN"],
  ["jakarta", "ID"],
  ["jeddah", "SA"],
  ["jersey city", "US"],
  ["jerusalem", "IL"],
  ["johannesburg", "ZA"],
  ["johor bahru", "MY"],
  ["kansas city", "US"],
  ["kaohsiung", "TW"],
  ["karlsruhe", "DE"],
  ["katowice", "PL"],
  ["kobenhavn", "DK"],
  ["kochi", "IN"],
  ["koeln", "DE"],
  ["kolkata", "IN"],
  ["krakow", "PL"],
  ["kuala lumpur", "MY"],
  ["kuwait city", "KW"],
  ["kyoto", "JP"],
  ["lagos", "NG"],
  ["las vegas", "US"],
  ["lausanne", "CH"],
  ["leeds", "GB"],
  ["leicester", "GB"],
  ["leipzig", "DE"],
  ["lille", "FR"],
  ["lima", "PE"],
  ["limerick", "IE"],
  ["linz", "AT"],
  ["lisboa", "PT"],
  ["lisbon", "PT"],
  ["liverpool", "GB"],
  ["lodz", "PL"],
  ["london", "GB"],
  ["los angeles", "US"],
  ["louisville", "US"],
  ["lucknow", "IN"],
  ["lyon", "FR"],
  ["madrid", "ES"],
  ["makati", "PH"],
  ["malaga", "ES"],
  ["malmo", "SE"],
  ["manama", "BH"],
  ["manchester", "GB"],
  ["manila", "PH"],
  ["mannheim", "DE"],
  ["marseille", "FR"],
  ["medellin", "CO"],
  ["melbourne", "AU"],
  ["memphis", "US"],
  ["mexico city", "MX"],
  ["miami", "US"],
  ["milan", "IT"],
  ["milano", "IT"],
  ["milton keynes", "GB"],
  ["milwaukee", "US"],
  ["minneapolis", "US"],
  ["mississauga", "CA"],
  ["monterrey", "MX"],
  ["montevideo", "UY"],
  ["montpellier", "FR"],
  ["montreal", "CA"],
  ["muenchen", "DE"],
  ["mumbai", "IN"],
  ["munich", "DE"],
  ["muscat", "OM"],
  ["mysuru", "IN"],
  ["nagoya", "JP"],
  ["nagpur", "IN"],
  ["nairobi", "KE"],
  ["nanjing", "CN"],
  ["nantes", "FR"],
  ["naples", "IT"],
  ["napoli", "IT"],
  ["nashville", "US"],
  ["new delhi", "IN"],
  ["new york", "US"],
  ["new york city", "US"],
  ["newark", "US"],
  ["nice", "FR"],
  ["noida", "IN"],
  ["nottingham", "GB"],
  ["nuernberg", "DE"],
  ["nuremberg", "DE"],
  ["nyc", "US"],
  ["oklahoma city", "US"],
  ["omaha", "US"],
  ["orlando", "US"],
  ["osaka", "JP"],
  ["oslo", "NO"],
  ["ottawa", "CA"],
  ["oxford", "GB"],
  ["paris", "FR"],
  ["pasig", "PH"],
  ["penang", "MY"],
  ["perth", "AU"],
  ["petaling jaya", "MY"],
  ["philadelphia", "US"],
  ["phoenix", "US"],
  ["pittsburgh", "US"],
  ["portland", "US"],
  ["porto", "PT"],
  ["porto alegre", "BR"],
  ["poznan", "PL"],
  ["prague", "CZ"],
  ["praha", "CZ"],
  ["pretoria", "ZA"],
  ["pune", "IN"],
  ["queretaro", "MX"],
  ["quezon city", "PH"],
  ["raleigh", "US"],
  ["reading", "GB"],
  ["recife", "BR"],
  ["rennes", "FR"],
  ["rio de janeiro", "BR"],
  ["riyadh", "SA"],
  ["roma", "IT"],
  ["rome", "IT"],
  ["rosario", "AR"],
  ["rotterdam", "NL"],
  ["sacramento", "US"],
  ["saint louis", "US"],
  ["salt lake city", "US"],
  ["salzburg", "AT"],
  ["san antonio", "US"],
  ["san diego", "US"],
  ["san francisco", "US"],
  ["sandton", "ZA"],
  ["santiago", "CL"],
  ["sao paulo", "BR"],
  ["seattle", "US"],
  ["seoul", "KR"],
  ["sevilla", "ES"],
  ["seville", "ES"],
  ["shanghai", "CN"],
  ["sharjah", "AE"],
  ["sheffield", "GB"],
  ["shenzhen", "CN"],
  ["singapore", "SG"],
  ["southampton", "GB"],
  ["st. louis", "US"],
  ["stavanger", "NO"],
  ["stockholm", "SE"],
  ["strasbourg", "FR"],
  ["stuttgart", "DE"],
  ["surabaya", "ID"],
  ["suzhou", "CN"],
  ["sydney", "AU"],
  ["taguig", "PH"],
  ["taichung", "TW"],
  ["taipei", "TW"],
  ["tampa", "US"],
  ["tampere", "FI"],
  ["tel aviv", "IL"],
  ["the hague", "NL"],
  ["thiruvananthapuram", "IN"],
  ["tianjin", "CN"],
  ["tijuana", "MX"],
  ["tokyo", "JP"],
  ["torino", "IT"],
  ["toronto", "CA"],
  ["toulouse", "FR"],
  ["trondheim", "NO"],
  ["tucson", "US"],
  ["turin", "IT"],
  ["utrecht", "NL"],
  ["vadodara", "IN"],
  ["vancouver", "CA"],
  ["vienna", "AT"],
  ["warsaw", "PL"],
  ["warszawa", "PL"],
  ["washington dc", "US"],
  ["wellington", "NZ"],
  ["wien", "AT"],
  ["winnipeg", "CA"],
  ["wroclaw", "PL"],
  ["wuhan", "CN"],
  ["yokohama", "JP"],
  ["zaragoza", "ES"],
  ["zuerich", "CH"],
  ["zurich", "CH"],
]);


export function cityCountry(location: string): string | null {
  for (const seg of location.toLowerCase().split(/[,;·|/]+/)) {
    const t = seg.trim().replace(/\s+/g, " ");
    const hit = CITY_COUNTRY.get(t);
    if (hit) return hit;
  }
  return null;
}

export function detectCountry(location: string | null | undefined): string | null {
  if (!location) return null;
  const s = String(location).slice(0, 300);
  for (const [re, code] of COUNTRY_PATTERNS) if (re.test(s)) return code;
  if (P_US_STATE_CODE.test(s) || P_US_STATE_NAME.test(s) || P_US_STATE_CODE_LEADING.test(s)) return "US";
  if (P_CA_PROV_CODE.test(s) || P_CA_PROV_NAME.test(s)) return "CA";
  if (/\bUS\b/.test(s)) return "US"; 
  return cityCountry(s);
}

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
  departments?: Array<{ name?: string }>;
}










const COORD_SUFFIX = /\s*\|\s*-?\d{1,3}\.\d{3,}(?:\s*\|\s*-?\d{1,3}\.\d{3,})?\s*$/;
export function stripCoordinateSuffix(location: string): string {
  return location.replace(COORD_SUFFIX, "").trim();
}

export function normalizeGreenhouse(raw: { jobs?: GreenhouseJob[] }, company: string, token: string): JobPosting[] {
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const titlesPerUrl = new Map<string, Set<string>>();
  for (const j of raw.jobs ?? []) {
    const u = j.absolute_url ?? "";
    if (!u) continue;
    if (!titlesPerUrl.has(u)) titlesPerUrl.set(u, new Set());
    titlesPerUrl.get(u)!.add(j.title ?? "");
  }
  return (raw.jobs ?? []).map((j) => {
    const location = stripCoordinateSuffix(j.location?.name ?? "");
    const indexUrl = (titlesPerUrl.get(j.absolute_url ?? "")?.size ?? 0) >= 5;
    return {
      id: `greenhouse:${token}:${j.id}`,
      source: "greenhouse" as const,
      token,
      company,
      title: j.title ?? "",
      location,
      workMode: detectWorkMode(location, j.title),
      remote: detectWorkMode(location, j.title) === "remote",
      department: j.departments?.[0]?.name ?? null,
      
      
      
      postedAt: j.first_published ?? null,
      category: categorize(j.title ?? "", j.departments?.[0]?.name),
      salary: null,
      applyUrl: safeUrl(indexUrl ? `https://job-boards.greenhouse.io/${token}/jobs/${j.id}` : j.absolute_url),
    };
  }).filter((j) => j.applyUrl !== "");
}

interface LeverJob {
  
  
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number; 
  workplaceType?: string;
  categories?: { location?: string; team?: string; allLocations?: string[]; commitment?: string };
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  descriptionPlain?: string;
  descriptionBodyPlain?: string;
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$" };
const fmtAmount = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function leverSalary(r?: { min?: number; max?: number; currency?: string; interval?: string }): string | null {
  if (!r || (!r.min && !r.max)) return null;
  const sym = CURRENCY_SYMBOL[r.currency ?? ""] ?? (r.currency ? `${r.currency} ` : "");
  const range = [r.min, r.max].filter((n): n is number => typeof n === "number" && n > 0).map(fmtAmount).join("–");
  if (!range) return null;
  const interval = r.interval ? `/${r.interval.replace(/-time|ly$/i, (m) => (m.toLowerCase() === "ly" ? "" : m))}` : "";
  return `${sym}${range}${interval ? interval.toLowerCase() : ""}`;
}

export function normalizeLever(raw: LeverJob[], company: string, token: string): JobPosting[] {
  return (Array.isArray(raw) ? raw : []).map((j) => {
    const location = j.categories?.allLocations?.join(" · ") || j.categories?.location || "";
    return {
      id: `lever:${token}:${j.id}`,
      source: "lever" as const,
      token,
      company,
      title: j.text ?? "",
      location,
      workMode: vendorWorkMode(j.workplaceType) ?? detectWorkMode(location, j.text),
      remote: (vendorWorkMode(j.workplaceType) ?? detectWorkMode(location, j.text)) === "remote",
      department: j.categories?.team ?? null,
      postedAt: safeIso(j.createdAt),
      category: categorize(j.text ?? "", j.categories?.team),
      salary: leverSalary(j.salaryRange),
      employmentType: normalizeEmploymentType(j.categories?.commitment),
      applyUrl: safeUrl(j.hostedUrl ?? j.applyUrl),
    };
  }).filter((j) => j.applyUrl !== "");
}

interface AshbyJob {
  id: string;
  title: string;
  compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
  location?: string;
  secondaryLocations?: Array<{ location?: string } | string>;
  department?: string;
  team?: string;
  isRemote?: boolean;
  workplaceType?: string;
  employmentType?: string; 
  isListed?: boolean;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
}

export function normalizeAshby(raw: { jobs?: AshbyJob[] }, company: string, token: string): JobPosting[] {
  return (raw.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const location = j.location ?? "";
      return {
        id: `ashby:${token}:${j.id}`,
        source: "ashby" as const,
        token,
        company,
        title: j.title ?? "",
        location,
        workMode: vendorWorkMode(j.workplaceType) ?? (j.isRemote === true ? "remote" : detectWorkMode(location, j.title)),
        remote: (vendorWorkMode(j.workplaceType) ?? (j.isRemote === true ? "remote" : detectWorkMode(location, j.title))) === "remote",
        department: j.department ?? j.team ?? null,
        postedAt: j.publishedAt ?? null,
        category: categorize(j.title ?? "", j.department ?? j.team),
        salary: j.compensation?.compensationTierSummary ?? j.compensation?.scrapeableCompensationSalarySummary ?? null,
        employmentType: normalizeEmploymentType(j.employmentType),
        applyUrl: safeUrl(j.jobUrl ?? j.applyUrl),
      };
    })
    .filter((j) => j.applyUrl !== "");
}

interface SmartRecruitersPosting {
  id: string | number;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  function?: { label?: string };
  department?: { label?: string };
  typeOfEmployment?: { id?: string; label?: string };
}

export function normalizeSmartRecruiters(raw: { content?: SmartRecruitersPosting[] }, company: string, token: string): JobPosting[] {
  return (raw.content ?? [])
    .map((p) => {
      const location =
        p.location?.fullLocation ||
        [p.location?.city, p.location?.region, p.location?.country?.toUpperCase()].filter(Boolean).join(", ");
      const department = p.function?.label ?? p.department?.label ?? null;
      return {
        id: `smartrecruiters:${token}:${p.id}`,
        source: "smartrecruiters" as const,
        token,
        company,
        title: p.name ?? "",
        location,
        workMode: p.location?.remote === true ? "remote" as const
          : p.location?.hybrid === true ? "hybrid" as const
          : detectWorkMode(location, p.name),
        remote: (p.location?.remote === true) || detectWorkMode(location, p.name) === "remote",
        department,
        postedAt: p.releasedDate ?? null,
        category: categorize(p.name ?? "", department),
        salary: null,
        
        employmentType: normalizeEmploymentType(p.typeOfEmployment?.id) ?? normalizeEmploymentType(p.typeOfEmployment?.label),
        
        applyUrl: safeUrl(`https://jobs.smartrecruiters.com/${token}/${p.id}`),
      };
    })
    .filter((j) => j.applyUrl !== "");
}

interface WorkableJob {
  title: string;
  shortcode: string;
  telecommuting?: boolean;
  department?: string | null;
  url?: string;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  employment_type?: string;
}

export function normalizeWorkable(raw: { jobs?: WorkableJob[] }, company: string, token: string): JobPosting[] {
  return (raw.jobs ?? [])
    .map((j) => {
      const location = [j.city, j.state, j.country].filter(Boolean).join(", ");
      const posted = j.published_on ?? j.created_at;
      return {
        id: `workable:${token}:${j.shortcode}`,
        source: "workable" as const,
        token,
        company,
        title: j.title ?? "",
        location,
        workMode: j.telecommuting === true ? "remote" as const : detectWorkMode(location, j.title),
        remote: j.telecommuting === true || detectWorkMode(location, j.title) === "remote",
        department: j.department ?? null,
        postedAt: safeIso(posted),
        category: categorize(j.title ?? "", j.department),
        salary: null,
        employmentType: normalizeEmploymentType(j.employment_type),
        applyUrl: safeUrl(j.url ?? `https://apply.workable.com/j/${j.shortcode}`),
      };
    })
    .filter((j) => j.applyUrl !== "");
}

interface BambooJob {
  id: string | number;
  jobOpeningName: string;
  departmentLabel?: string | null;
  isRemote?: boolean | null;
  location?: { city?: string | null; state?: string | null };
  atsLocation?: { country?: string | null; state?: string | null; province?: string | null; city?: string | null };
}

export function normalizeBambooHR(raw: { result?: BambooJob[] }, company: string, token: string): JobPosting[] {
  return (raw.result ?? [])
    .map((j) => {
      const location = [
        j.atsLocation?.city ?? j.location?.city,
        j.atsLocation?.state ?? j.atsLocation?.province ?? j.location?.state,
        j.atsLocation?.country,
      ].filter(Boolean).join(", ");
      return {
        id: `bamboohr:${token}:${j.id}`,
        source: "bamboohr" as const,
        token,
        company,
        title: j.jobOpeningName ?? "",
        location,
        workMode: j.isRemote === true ? "remote" as const : detectWorkMode(location, j.jobOpeningName),
        remote: j.isRemote === true || detectWorkMode(location, j.jobOpeningName) === "remote",
        department: j.departmentLabel ?? null,
        postedAt: null, 
        category: categorize(j.jobOpeningName ?? "", j.departmentLabel),
        salary: null,
        applyUrl: safeUrl(`https://${token}.bamboohr.com/careers/${j.id}`),
      };
    })
    .filter((j) => j.applyUrl !== "");
}







export function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}


export function xmlValue(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  const v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return v || null;
}

interface RecruiteeOffer {
  id: string | number;
  slug?: string | null;
  title?: string | null;
  department?: string | null;
  city?: string | null;
  country?: string | null;
  location?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  on_site?: boolean | null;
  careers_url?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  employment_type_code?: string | null;
  salary?: { min?: string | number | null; max?: string | number | null; type?: string | null; currency?: string | null } | null;
}

export function normalizeRecruitee(raw: { offers?: RecruiteeOffer[] }, company: string, token: string): JobPosting[] {
  return (raw.offers ?? [])
    .map((o) => {
      const location = o.location || [o.city, o.country].filter(Boolean).join(", ");
      const sal = o.salary;
      const salary = sal && sal.min && sal.max
        ? `${sal.currency ? sal.currency + " " : ""}${sal.min} - ${sal.max}${sal.type ? ` ${sal.type}` : ""}`.trim()
        : null;
      return {
        id: `recruitee:${token}:${o.id}`,
        source: "recruitee" as const,
        token,
        company,
        title: o.title ?? "",
        location,
        workMode: o.remote === true ? "remote" as const
          : o.hybrid === true ? "hybrid" as const
          : o.on_site === true ? "onsite" as const
          : detectWorkMode(location, o.title),
        remote: o.remote === true || detectWorkMode(location, o.title) === "remote",
        department: o.department ?? null,
        postedAt: safeIso(o.published_at ?? o.created_at),
        category: categorize(o.title ?? "", o.department),
        salary,
        
        
        
        
        
        
        
        
        employmentType: normalizeEmploymentType(o.employment_type_code),
        applyUrl: safeUrl(o.slug ? `https://${token}.recruitee.com/o/${o.slug}` : (o.careers_url ?? "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "");
}



export function normalizePersonio(xml: string, company: string, token: string, host: string): JobPosting[] {
  return xmlBlocks(xml, "position")
    .map((block) => {
      const id = xmlValue(block, "id") ?? "";
      const title = xmlValue(block, "name") ?? "";
      const office = xmlValue(block, "office") ?? "";
      const department = xmlValue(block, "department");
      const schedule = xmlValue(block, "schedule") ?? "";
      return {
        id: `personio:${token}:${id}`,
        source: "personio" as const,
        token,
        company,
        title,
        location: office,
        workMode: detectWorkMode(office, title, schedule),
        remote: detectWorkMode(office, title, schedule) === "remote",
        department,
        postedAt: safeIso(xmlValue(block, "createdAt")),
        category: categorize(title, department),
        salary: null, 
        
        
        employmentType: normalizeEmploymentType(schedule),
        applyUrl: id ? safeUrl(`https://${token}.${host}/job/${id}`) : "",
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "");
}

interface BreezyPosition {
  id?: string | null;
  friendly_id?: string | null;
  name?: string | null;
  published_date?: string | null;
  creation_date?: string | null;
  location?: { name?: string | null; is_remote?: boolean | null } | null;
  department?: string | null;
  url?: string | null;
}

export function normalizeBreezy(raw: BreezyPosition[], company: string, token: string): JobPosting[] {
  return (Array.isArray(raw) ? raw : [])
    .map((p) => {
      const externalId = p.friendly_id || p.id || "";
      const location = p.location?.name ?? "";
      return {
        id: `breezy:${token}:${externalId}`,
        source: "breezy" as const,
        token,
        company,
        title: p.name ?? "",
        location,
        workMode: p.location?.is_remote === true ? "remote" as const : detectWorkMode(location, p.name),
        remote: p.location?.is_remote === true || detectWorkMode(location, p.name) === "remote",
        department: p.department ?? null,
        postedAt: safeIso(p.published_date ?? p.creation_date),
        category: categorize(p.name ?? "", p.department),
        salary: null,
        applyUrl: safeUrl(p.url ?? (externalId ? `https://${token}.breezy.hr/p/${externalId}` : "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `breezy:${token}:`);
}
















export interface IcimsJobData {
  req_id?: string | number | null;
  title?: string | null;
  description?: string | null;
  posted_date?: string | null;
  create_date?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  country_code?: string | null;
  full_location?: string | null;
  short_location?: string | null;
  location_type?: string | null;
  category?: string[] | string | null;
  department?: string | null;
  employment_type?: string | null;
  salary_min_value?: number | string | null;
  salary_max_value?: number | string | null;
  salary_value?: number | string | null;
  hiring_organization?: string | null;
  apply_url?: string | null;
  slug?: string | null;
}
export interface IcimsJobItem { data?: IcimsJobData | null }




function icimsSalary(d: IcimsJobData): string | null {
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const lo = num(d.salary_min_value), hi = num(d.salary_max_value), one = num(d.salary_value);
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (lo && hi && hi >= lo) return lo === hi ? `$${fmt(lo)}` : `$${fmt(lo)} - $${fmt(hi)}`;
  if (lo) return `$${fmt(lo)}`;
  if (hi) return `$${fmt(hi)}`;
  if (one) return `$${fmt(one)}`;
  return null;
}

export function normalizeIcims(raw: IcimsJobItem[], company: string, token: string): JobPosting[] {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => {
      const d = (item?.data ?? {}) as IcimsJobData;
      const externalId = String(d.req_id ?? d.slug ?? "").trim();
      const location = String(
        d.full_location || d.short_location || [d.city, d.state, d.country].filter(Boolean).join(", ") || "",
      ).trim();
      const dept = typeof d.department === "string" && d.department.trim() ? d.department.trim() : null;
      const cat = Array.isArray(d.category) ? d.category.filter(Boolean).map((c) => String(c).trim()).join(", ")
        : typeof d.category === "string" ? d.category.trim() : "";
      
      
      const lt = String(d.location_type ?? "").toLowerCase();
      const structuredMode = lt.includes("remote") ? "remote" as const
        : lt.includes("hybrid") ? "hybrid" as const
        : lt.includes("onsite") || lt.includes("on-site") || lt.includes("office") ? "onsite" as const
        : null;
      const workMode = structuredMode ?? detectWorkMode(location, d.title, cat);
      return {
        id: `icims:${token}:${externalId}`,
        source: "icims" as const,
        token,
        company,
        title: String(d.title ?? "").trim(),
        location,
        workMode,
        remote: workMode === "remote",
        department: dept ?? (cat || null),
        postedAt: safeIso(d.posted_date ?? d.create_date),
        category: categorize(String(d.title ?? ""), dept ?? cat),
        salary: icimsSalary(d),
        
        
        country: /^[A-Za-z]{2}$/.test(String(d.country_code ?? "")) ? String(d.country_code).toUpperCase() : null,
        
        
        
        
        
        employmentType: normalizeEmploymentType(d.employment_type),
        applyUrl: safeUrl(String(d.apply_url ?? (externalId ? `https://${token}/jobs/${externalId}/job` : "")).replace(/\/login$/, "/job")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}










export interface RipplingJobItem {
  id?: string | number;
  name?: string;
  url?: string;
  department?: { name?: string } | null;
  locations?: Array<{
    name?: string;
    country?: string;
    countryCode?: string;
    city?: string;
    workplaceType?: string; 
  }> | null;
}




export function extractRipplingJobPosts(html: string): { items: RipplingJobItem[]; totalPages: number } | null {
  const m = html.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as {
      props?: { pageProps?: { dehydratedState?: { queries?: Array<{ queryKey?: unknown[]; state?: { data?: { items?: unknown[]; totalPages?: number } } }> } } };
    };
    const dehydrated = data.props?.pageProps?.dehydratedState;
    const queries = dehydrated?.queries ?? [];
    // A BOARD WITH NO OPEN ROLES IS NOT A BROKEN PARSER.
    //
    // Rippling renders a perfectly healthy page for an employer that is not
    // hiring: dehydratedState is present and `queries` is an EMPTY ARRAY,
    // because there was nothing to prefetch. The old code could not tell that
    // from shape drift and returned null for both, so the caller threw
    // "rippling payload shape unrecognized" and the board was published to the
    // operator as a vendor failure.
    //
    // Measured 2026-08-25 over 198 of 1,051 rippling boards: 2 hit this (1%),
    // matching the 6 standing failures in the live failure list. Both
    // whistler-platinum-jobs and elevationcapital return 157KB of valid page
    // with dehydratedState present, queries [], zero occurrences of
    // "job-posts", and the words "No open" in the rendered text. Neither is
    // broken; neither is hiring.
    //
    // The drift signal is KEPT and made sharper: queries present but carrying
    // no job-posts key still returns null, because that is what a real shape
    // change looks like. Only the empty array is read as an honest zero — the
    // same distinction the personio empty-feed fix drew earlier.
    if (dehydrated && queries.length === 0) return { items: [], totalPages: 1 };
    const q = queries.find((x) => Array.isArray(x.queryKey) && x.queryKey[2] === "job-posts");
    if (!q?.state?.data || !Array.isArray(q.state.data.items)) return null;
    return { items: q.state.data.items as RipplingJobItem[], totalPages: Number(q.state.data.totalPages) || 1 };
  } catch {
    return null;
  }
}

export function normalizeRippling(items: RipplingJobItem[], company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const locs = Array.isArray(j.locations) ? j.locations : [];
      const first = locs[0] ?? {};
      const location = [first.name, locs.length > 1 ? `+${locs.length - 1} more` : ""].filter(Boolean).join(" ");
      const cc = typeof first.countryCode === "string" && /^[A-Z]{2}$/.test(first.countryCode) ? first.countryCode : null;
      return {
        id: `rippling:${token}:${j.id ?? ""}`,
        source: "rippling" as const,
        token,
        company,
        title: j.name ?? "",
        location,
        workMode: locs.some((l) => l.workplaceType === "REMOTE") ? "remote" as const
          : locs.some((l) => l.workplaceType === "HYBRID") ? "hybrid" as const
          : locs.length > 0 && locs.every((l) => l.workplaceType === "ON_SITE") ? "onsite" as const
          : detectWorkMode(location, j.name),
        remote: locs.some((l) => l.workplaceType === "REMOTE") || detectWorkMode(location, j.name) === "remote",
        department: j.department?.name ?? null,
        postedAt: null, // the board payload carries no dates — undated is honest
        category: categorize(j.name ?? "", j.department?.name),
        salary: null,
        country: cc,
        applyUrl: safeUrl(j.url ?? ""),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `rippling:${token}:`);
}

// ── Paylocity ─────────────────────────────────────────────────────────────
// Paylocity publishes no documented list API; the public board page at
// recruiting.paylocity.com/recruiting/jobs/All/{token} embeds the FULL job
// list as first-party JSON in a page-global pageData assignment. A
// Rippling-class source — the vendor's own data channel, but an
// implementation detail that can move, so the extractor's null is a drift
// signal and never an empty board. Live-captured shape 2026-08-30 across
// three boards (24 + 21 + 17 postings): items carry JobId, JobTitle,
// LocationName, a real PublishedDate (ISO with offset), HiringDepartment,
// a structured IsRemote boolean, and a JobLocation whose Country is a
// "USA"-style word, not ISO-2. IndeedRemoteType also rides along but its
// enum is unmeasured (2 on every observed row, remote or not) — only
// IsRemote is trusted, per the trinary-or-nothing work-mode contract.
export interface PaylocityJobItem {
  JobId?: string | number;
  JobTitle?: string;
  LocationName?: string;
  PublishedDate?: string;
  HiringDepartment?: string | null;
  IsInternal?: boolean;
  IsRemote?: boolean;
  JobLocation?: {
    City?: string | null;
    State?: string | null;
    Zip?: string | null;
    Country?: string | null;
  } | null;
}

/** Pull the embedded job list out of a Paylocity board page.
 *  Returns null when the payload isn't recognizable (drift — the caller must
 *  treat the board as FAILED, not empty). A parsed payload whose Jobs array
 *  is empty is an employer not hiring: an honest zero, same distinction the
 *  personio and rippling fixes drew. Jobs ABSENT or non-array stays null,
 *  because that is what a real shape change looks like — a detail page
 *  carries the same page-global assignment with entirely different keys, and
 *  reading it as an empty board would zero a live employer. */
export function extractPaylocityPageData(html: string): { items: PaylocityJobItem[]; moduleTitle: string | null } | null {
  const m = html.match(/window\.pageData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as { Jobs?: unknown; ModuleTitle?: unknown };
    if (!Array.isArray(data.Jobs)) return null;
    return {
      items: data.Jobs as PaylocityJobItem[],
      // The board's self-chosen display name — census tooling reads it so a
      // token never has to ship with a guessed employer name.
      moduleTitle: typeof data.ModuleTitle === "string" && data.ModuleTitle.trim() ? data.ModuleTitle.trim() : null,
    };
  } catch {
    return null;
  }
}

export function normalizePaylocity(items: PaylocityJobItem[], company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    // The public payload can embed internal-only postings; their Details page
    // sits behind a login wall, and verify-all already refuses to count them —
    // ingest and verify must agree on what a posting is.
    .filter((j) => j.IsInternal !== true)
    .map((j) => {
      const loc = j.JobLocation ?? {};
      const location = String(j.LocationName ?? "").trim() || [loc.City, loc.State].filter(Boolean).join(", ").trim();
      const title = String(j.JobTitle ?? "").trim();
      const dept = typeof j.HiringDepartment === "string" && j.HiringDepartment.trim() ? j.HiringDepartment.trim() : null;
      const externalId = String(j.JobId ?? "").trim();
      // IsRemote is the vendor's structured field; text detection only fills
      // in when the feed doesn't state one (never guessed from prose).
      const workMode = j.IsRemote === true ? "remote" as const : detectWorkMode(location, title, dept);
      const rawCountry = String(loc.Country ?? "").trim();
      return {
        id: `paylocity:${token}:${externalId}`,
        source: "paylocity" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: dept,
        // The feed states a real publish date; the shared ingest window drops
        // anything older, so no pre-filtering here.
        postedAt: safeIso(j.PublishedDate),
        category: categorize(title, dept),
        // The list payload's Description is a ~110-char teaser, not the JD —
        // storing it would hand salary mining and the fit scan a stub that
        // looks like a document. Null is honest; the detail page carries the
        // full text if a sweep ever wants it.
        salary: null,
        // Country arrives structurally but as a word ("USA"), not ISO-2 — map
        // the stated value, and fall back to text detection over the whole
        // location for anything unrecognized.
        country: /^(?:usa|us|u\.s\.a?\.?|united states(?: of america)?)$/i.test(rawCountry)
          ? "US"
          : /^[A-Za-z]{2}$/.test(rawCountry)
            // The one two-letter word people write that is NOT its ISO code.
            ? (rawCountry.toUpperCase() === "UK" ? "GB" : rawCountry.toUpperCase())
            : detectCountry([location, loc.City, loc.State, rawCountry].filter(Boolean).join(", ")),
        applyUrl: externalId ? `https://recruiting.paylocity.com/recruiting/jobs/Details/${externalId}` : "",
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}

// ── Pinpoint ──────────────────────────────────────────────────────────────
// Documented public first-party JSON: https://{token}.pinpointhq.com/postings.json
// → { data: [...] }. Structured compensation (min/max/currency/frequency,
// gated by compensation_visible) and a workplace_type enum; NO posted date —
// undated is honest, like BambooHR. Live-captured shape 2026-07-17
// (agencyanalytics).
export interface PinpointPosting {
  id?: string | number;
  title?: string;
  url?: string;
  workplace_type?: string; // "onsite" | "hybrid" | "remote"
  employment_type_text?: string;
  compensation_visible?: boolean;
  compensation_minimum?: number | string | null;
  compensation_maximum?: number | string | null;
  compensation_currency?: string | null;
  compensation_frequency?: string | null; // "annually" | "monthly" | "hourly"
  location?: { name?: string; city?: string; province?: string; country?: string } | null;
  job?: { department?: { name?: string } | null } | null;
}

const PINPOINT_FREQ: Record<string, string> = { annually: "per year", monthly: "per month", hourly: "per hour" };
function pinpointSalary(j: PinpointPosting): string | null {
  if (!j.compensation_visible) return null;
  const min = Number(j.compensation_minimum);
  const max = Number(j.compensation_maximum);
  if (!Number.isFinite(min) || min <= 0) return null;
  const cur = typeof j.compensation_currency === "string" && /^[A-Z]{3}$/.test(j.compensation_currency) ? j.compensation_currency : "";
  const rawFreq = String(j.compensation_frequency ?? "");
  const freq = PINPOINT_FREQ[rawFreq] ?? (rawFreq ? `per ${rawFreq}` : "");
  // A small figure with NO stated frequency ("31.25") is almost certainly an
  // hourly rate we can't prove — displaying it bare would be ambiguous and
  // the salary parser could mis-annualize it. When in doubt, leave it out.
  if (!freq && min < 1_000) return null;
  const range = Number.isFinite(max) && max > min ? `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}` : min.toLocaleString("en-US");
  return [cur, range, freq].filter(Boolean).join(" ") || null;
}

export function normalizePinpoint(items: PinpointPosting[], company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const loc = j.location ?? {};
      const location = String(loc.name || [loc.city, loc.province].filter(Boolean).join(", ") || "").trim();
      // Detect from ALL location fields — the display name alone often lacks
      // the province/country ("Hybrid - Toronto").
      const locFull = [loc.name, loc.city, loc.province, loc.country].filter(Boolean).join(", ");
      const title = String(j.title ?? "").trim();
      const dept = j.job?.department?.name ?? null;
      return {
        id: `pinpoint:${token}:${j.id ?? ""}`,
        source: "pinpoint" as const,
        token,
        company,
        title,
        location,
        workMode: vendorWorkMode(j.workplace_type) ?? detectWorkMode(location, title),
        remote: (vendorWorkMode(j.workplace_type) ?? detectWorkMode(location, title)) === "remote",
        department: dept,
        postedAt: null, // no date in the payload — undated is honest
        category: categorize(title, dept),
        salary: pinpointSalary(j),
        employmentType: normalizeEmploymentType(j.employment_type_text),
        country: detectCountry(locFull),
        applyUrl: safeUrl(String(j.url ?? "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `pinpoint:${token}:`);
}

// ── Workday CXS ───────────────────────────────────────────────────────────
// Workday hosts a large share of enterprise employers. Each tenant's own
// career site is powered by a public first-party JSON endpoint
// (POST /wday/cxs/{tenant}/{site}/jobs) — the same data the tenant serves its
// own applicants, no auth, no scraping. Undocumented (a Rippling-class source:
// vendor canary + breaker watch the shape). Token is a compound
// `tenant~dc~site` (three pieces the URL needs). The LIST payload carries only
// a RELATIVE posting age ("Posted 5 Days Ago").
//
// CORRECTED 2026-07-28. This header used to say we "never store that as a














export interface WorkdayListItem {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}



























const WD_TODAY = /\b(today|hoy|aujourd'?hui|heute|vandaag|hoje|oggi|i dag|idag|今天|本日)\b|ausgeschrieben heute/i;
const WD_YESTERDAY = /\b(yesterday|ayer|hier|gestern|gisteren|ontem|ieri|i går|igår|昨天)\b/i;
// Day nouns across the locales Workday serves. Chinese/Japanese carry no word
// boundaries, so they are matched as bare characters.
const WD_DAY_WORD = /\b(days?|d[ií]as?|jours?|tagen?|tage|dagen?|dagar?|giorni?|giorno|päivää?)\b|[天日]/i;
// "more than N" in the same locales, plus Workday's own "N+" shorthand and

const WD_MORE_THAN = /\+|\bm[áa]s de\b|\bplus de\b|\bmehr als\b|\bmeer dan\b|\bmais de\b|\bpi[uù] di\b|\bover\b|\bou plus\b|\boder mehr\b|\bo m[áa]s\b|\bof meer\b|\bou mais\b|超過|超过|以上/i;

export function workdayPostedDays(postedOn: string | null | undefined): number | null {
  if (!postedOn) return null;
  const s = String(postedOn).toLowerCase();
  if (WD_TODAY.test(s)) return 0;
  if (WD_YESTERDAY.test(s)) return 1;
  
  
  if (!WD_DAY_WORD.test(s)) return null;
  const num = s.match(/(\d{1,4})/);
  if (!num) return null;
  const n = Number(num[1]);
  if (!Number.isFinite(n) || n < 0 || n > 3650) return null;
  
  
  return WD_MORE_THAN.test(s) ? n + 1 : n;
}

export function normalizeWorkday(items: WorkdayListItem[], company: string, token: string): JobPosting[] {
  
  const [tenant, dc, site] = token.split("~");
  if (!tenant || !dc || !site) return [];
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const fetchedAt = Date.now();
  const base = `https://${tenant}.${dc}.myworkdayjobs.com/en-US/${site}`;
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const path = String(j.externalPath ?? "");
      
      const reqId = path.split("_").pop() || (Array.isArray(j.bulletFields) ? j.bulletFields[0] : "") || "";
      const loc = String(j.locationsText ?? "").trim();
      
      
      const days = workdayPostedDays(j.postedOn);
      const stale = days !== null && days > 30; 
      return {
        id: `workday:${token}:${reqId}`,
        source: "workday" as const,
        token,
        company,
        title: String(j.title ?? "").trim(),
        location: loc,
        workMode: detectWorkMode(loc, String(j.title ?? "")),
        remote: detectWorkMode(loc, String(j.title ?? "")) === "remote",
        department: null,
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        postedAt: days !== null ? new Date(fetchedAt - days * 86_400_000).toISOString() : null,
        category: categorize(String(j.title ?? ""), null),
        salary: null,
        country: detectCountry(loc),
        applyUrl: safeUrl(path ? `${base}${path}` : ""),
        _stale: stale, 
      } as JobPosting & { _stale?: boolean };
    })
    
    
    
    
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `workday:${token}:`)
    .map(({ _stale: _drop, ...j }) => j as JobPosting);
}
















export interface OracleReq {
  Id?: number | string;
  Title?: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  WorkplaceTypeCode?: string;
  JobFamily?: string;
  ShortDescriptionStr?: string;
}

export function normalizeOracle(items: OracleReq[], company: string, token: string): JobPosting[] {
  const [tenant, region, site] = token.split("~");
  if (!tenant || !region || !site) return [];
  const base = `https://${tenant}.fa.${region}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${site}`;
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const title = String(j.Title ?? "").trim();
      const location = String(j.PrimaryLocation ?? "").trim();
      const id = String(j.Id ?? "").trim();
      
      
      const posted = /^\d{4}-\d{2}-\d{2}/.test(String(j.PostedDate ?? ""))
        ? new Date(`${String(j.PostedDate).slice(0, 10)}T00:00:00Z`).toISOString()
        : null;
      const mode = vendorWorkMode(j.WorkplaceTypeCode) ?? detectWorkMode(location, title);
      const dept = j.JobFamily ? String(j.JobFamily).trim() || null : null;
      return {
        id: `oracle:${token}:${id}`,
        source: "oracle" as const,
        token,
        company,
        title,
        location,
        workMode: mode,
        remote: mode === "remote",
        department: dept,
        postedAt: posted,
        category: categorize(title, dept),
        salary: null, 
        
        
        country: (typeof j.PrimaryLocationCountry === "string" && /^[A-Za-z]{2}$/.test(j.PrimaryLocationCountry))
          ? j.PrimaryLocationCountry.toUpperCase()
          : detectCountry(location),
        applyUrl: safeUrl(id ? `${base}/job/${id}` : ""),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && j.id !== `oracle:${token}:`);
}




























export function normalizeTeamtailor(rss: string, company: string, token: string): JobPosting[] {
  return xmlBlocks(rss, "item")
    .map((item) => {
      const title = xmlValue(item, "title") ?? "";
      const link = xmlValue(item, "link") ?? "";
      const idMatch = link.match(/\/jobs\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : "";
      
      
      
      const city = xmlValue(item, "tt:city");
      const country = xmlValue(item, "tt:country");
      const location = [city, country].filter(Boolean).join(", ");
      const status = (xmlValue(item, "remoteStatus") ?? "").toLowerCase();
      const statedMode = status === "hybrid" ? "hybrid" as const
        : status === "fully" ? "remote" as const
        : status === "onsite" ? "onsite" as const
        : null;
      const workMode = statedMode ?? detectWorkMode(title, location);
      return {
        id: `teamtailor:${token}:${externalId}`,
        source: "teamtailor" as const,
        token,
        company,
        title,
        location,
        workMode,
        remote: workMode === "remote",
        department: xmlValue(item, "tt:department"),
        postedAt: safeIso(xmlValue(item, "pubDate")),
        category: categorize(title, null),
        salary: null,
        applyUrl: safeUrl(link),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}

export interface JobFilter {
  q?: string;
  location?: string;
  remote?: boolean;
  category?: string;
  
  companies?: string[];
}



export function filterJobs(jobs: JobPosting[], f: JobFilter): JobPosting[] {
  const terms = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const loc = (f.location ?? "").toLowerCase().trim();
  const companies = f.companies?.length ? new Set(f.companies) : null;
  return jobs.filter((j) => {
    if (companies && !companies.has(j.token)) return false;
    if (f.category && j.category !== f.category) return false;
    if (f.remote && !j.remote) return false;
    if (loc && !j.location.toLowerCase().includes(loc)) return false;
    if (terms.length) {
      const hay = `${j.title} ${j.company} ${j.department ?? ""}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}


export function sortJobs(jobs: JobPosting[]): JobPosting[] {
  return [...jobs].sort((a, b) => {
    if (a.postedAt && b.postedAt) return b.postedAt.localeCompare(a.postedAt);
    if (a.postedAt) return -1;
    if (b.postedAt) return 1;
    return a.title.localeCompare(b.title);
  });
}


















interface UsajobsRemuneration { MinimumRange?: unknown; MaximumRange?: unknown }
interface UsajobsDescriptor {
  PositionID?: unknown; PositionTitle?: unknown; OrganizationName?: unknown; DepartmentName?: unknown;
  PositionLocation?: Array<{ LocationName?: unknown }>; PositionLocationDisplay?: unknown;
  RemoteIndicator?: unknown; TeleworkEligible?: unknown; PublicationStartDate?: unknown;
  PositionRemuneration?: UsajobsRemuneration[]; JobCategory?: Array<{ Name?: unknown }>;
  PositionSchedule?: Array<{ Name?: unknown }>;
  ApplyURI?: unknown[]; PositionURI?: unknown;
}
interface UsajobsItem { MatchedObjectId?: unknown; MatchedObjectDescriptor?: UsajobsDescriptor }

export function normalizeUsajobs(items: UsajobsItem[], _company: string, token: string): JobPosting[] {
  return (Array.isArray(items) ? items : [])
    .map((wrap) => {
      const d = (wrap?.MatchedObjectDescriptor ?? {}) as UsajobsDescriptor;
      const externalId = String(wrap?.MatchedObjectId ?? d.PositionID ?? "").trim();
      const title = String(d.PositionTitle ?? "").trim();
      
      
      const agency = String(d.OrganizationName ?? d.DepartmentName ?? "").trim();
      const loc = Array.isArray(d.PositionLocation) && d.PositionLocation.length
        ? String(d.PositionLocation[0]?.LocationName ?? "").trim()
        : String(d.PositionLocationDisplay ?? "").trim();
      
      
      const stated = d.RemoteIndicator === true ? "remote" as const
        : String(d.TeleworkEligible ?? "").toLowerCase() === "true" ? "hybrid" as const
        : null;
      const mode = stated ?? detectWorkMode(loc, title);
      const posted = safeIso(d.PublicationStartDate);
      const pay = Array.isArray(d.PositionRemuneration) ? d.PositionRemuneration[0] : null;
      const min = Number(pay?.MinimumRange) || 0;
      const max = Number(pay?.MaximumRange) || 0;
      const salary = min > 0 && max > 0
        ? `$${Math.round(min).toLocaleString("en-US")} - $${Math.round(max).toLocaleString("en-US")}`
        : null;
      return {
        id: `usajobs:${token}:${externalId}`,
        source: "usajobs" as const,
        token,
        company: agency || "U.S. Federal Government",
        title,
        location: loc,
        workMode: mode,
        remote: mode === "remote",
        department: String(d.JobCategory?.[0]?.Name ?? "").trim() || null,
        postedAt: posted,
        category: categorize(title, String(d.JobCategory?.[0]?.Name ?? "")),
        salary,
        
        employmentType: normalizeEmploymentType(String(d.PositionSchedule?.[0]?.Name ?? "")),
        
        country: "US",
        applyUrl: safeUrl(String(d.ApplyURI?.[0] ?? d.PositionURI ?? "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !j.id.endsWith(":"));
}
