







const K = 1_000;


const MONEY = String.raw`[$€£]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s?[kK]?`;

const RANGE_SEP = String.raw`\s*(?:-|–|—|to|through)\s*`;

const PERIOD = String.raw`(?:per\s+(?:hour|year|annum|month|week)|an?\s+(?:hour|year)|hourly|annually|yearly|monthly|\/\s?(?:hr|hour|yr|year|mo|month|wk|week))`;

const RANGE_RE = new RegExp(`(${MONEY})${RANGE_SEP}(${MONEY})(\\s*${PERIOD})?`, "i");
const SINGLE_RE = new RegExp(`(${MONEY})(\\s*${PERIOD})`, "i");








const NOT_PAY = /bonus|sign[- ]?on|stipend|reimburse|referral|allowance|credit|deposit|discount|401|gift|donat\w*|charit\w*|quota|revenue|bookings|funding|raised|valuation|in sales|sales target|budget\w*|grant\w*|scholarship|prize|fundrais\w*/i;

function parseMoney(raw: string): number | null {
  const k = /k\s*$/i.test(raw.trim());
  const digits = raw.replace(/[^0-9.,]/g, "");
  
  
  let normalized = digits;
  const m = digits.match(/^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/);
  if (m) normalized = m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "");
  else normalized = digits.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return k ? n * K : n;
}

function plausible(lo: number, hi: number, hourly: boolean): boolean {
  if (lo <= 0 || hi < lo) return false;
  if (hi / Math.max(lo, 1) > 5) return false; 
  if (hourly) return lo >= 7 && hi <= 500;
  
  return lo >= 10_000 && hi <= 2_000_000;
}









export interface ParsedSalary {
  min: number;
  max: number | null;
  period: "hour" | "day" | "week" | "month" | "year" | null;
  
  annualMin: number | null;
  

  annualMax: number | null;
  





  currency: string | null;
  












  annualMultiplier: number | null;
  




  partTimeSignal: string | null;
}






const P_ISO = /\b(USD|EUR|GBP|CAD|AUD|NZD|CHF|SEK|DKK|NOK|PLN|INR|SGD|JPY|BRL|MXN|PHP|HKD)\b/i;
const P_CAD = /C(?:A)?\$/;
const P_AUD = /A(?:U)?\$/;





const BARE_DOLLAR_BY_COUNTRY: Record<string, string> = {
  CA: "CAD", AU: "AUD", NZ: "NZD", MX: "MXN", SG: "SGD", HK: "HKD",
};

function detectCurrency(s: string, country?: string | null): string | null {
  const iso = s.match(P_ISO);
  if (iso) return iso[1].toUpperCase();
  if (/(?<![A-Za-z])US\$/i.test(s)) return "USD";
  if (P_CAD.test(s)) return "CAD";
  if (P_AUD.test(s)) return "AUD";
  if (/(?<![A-Za-z])NZ\$/i.test(s)) return "NZD";
  if (/(?<![A-Za-z])MX\$/i.test(s)) return "MXN";
  if (/(?<![A-Za-z])HK\$/i.test(s)) return "HKD";
  if (/(?<![A-Za-z])R\$/i.test(s)) return "BRL";
  if (/(?<![A-Za-z])S\$/i.test(s)) return "SGD";
  if (s.includes("€")) return "EUR";
  if (s.includes("£")) return "GBP";
  if (s.includes("₹")) return "INR";
  if (s.includes("₱")) return "PHP";
  if (/zł/i.test(s)) return "PLN";
  
  
  if (s.includes("$")) return BARE_DOLLAR_BY_COUNTRY[String(country ?? "").toUpperCase()] ?? "USD";
  return null;
}






const PARITY_CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SGD"]);
const PARITY_MONTHLY_MAX = 35_000;



const P_MONEY = /[$€£]?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:\.\d{1,2})?)\s?([kK])?/;
const P_RANGE = new RegExp(P_MONEY.source + String.raw`\s*(?:-|–|—|to|through)\s*` + P_MONEY.source);



const P_HOUR = /per[\s-]?hour|\/\s?hr\b|\/\s?hour|hourly|hour-?wage|\ban?\s+hour\b/i;
const P_WEEK = /per[\s-]?week|\/\s?wk\b|\/\s?week|weekly|\ba\s+week\b/i;
const P_MONTH = /per[\s-]?month|\/\s?mo\b|\/\s?month|monthly|\ba\s+month\b/i;
const P_YEAR = /per[\s-]?(?:year|annum)|\/\s?yr\b|\/\s?year|annual|yearly|year-?salary|\ba\s+year\b/i;







const P_DAY = /per[\s-]?day|\/\s?day\b|\bdaily\b|day-?rate|day-?wage|\ba\s+day\b|\bdiem\s+rate\b/i;








export const PERIOD_MULTIPLIER = { hour: 2080, day: 260, week: 52, month: 12, year: 1 } as const;





const LOAD_DEPENDENT = new Set<string>(["hour", "day", "week"]);






















export interface SalaryContext {
  

  title?: string | null;
  

  description?: string | null;
  

  employmentType?: string | null;
}


const PT_SHORT: RegExp[] = [
  /\bpart[\s-]?time\b/i,
  
  
  /\bcasual\b(?!\s*(?:dining|dress|attire|wear|friday))/i,
  /\bsessional\b/i,
  /\bzero[\s-]?hours?\b/i,
  /\bper[\s-]?diem\b/i,
  /\bprn\b/i,
  /\bsubstitute\b/i,
  /\bsupply\s+(?:teacher|staff|work)/i,
  /\bas[\s-]?needed\b|\bas\s+and\s+when\b|\bwhen\s+needed\b/i,
  /\bon[\s-]?call\b/i,
  /\bad[\s-]?hoc\b/i,
  /\bterm[\s-]?time\s+only\b/i,
  /\bbank\s+(?:staff|nurse|worker|shifts?|hours?|contract)\b|\bnhs\s+bank\b/i,
  /\brelief\s+(?:staff|work(?:er)?s?|shifts?|cover|basis|pool)\b/i,
];







const PT_PROSE: RegExp[] = [
  /\bpart[\s-]?time\b/i,
  /\bcasual\s+(?:hours?|basis|contract|work(?:ers?)?|staff|shifts?|position|role|employment|vacanc)/i,
  /\bzero[\s-]?hours?\s+contract\b/i,
  /\bsessional\b/i,
  /\bterm[\s-]?time\s+only\b/i,
  /\bbank\s+(?:staff|nurse|worker|shifts?|hours?|contract)\b|\bnhs\s+bank\b/i,
  /\brelief\s+(?:staff|work(?:er)?s?|shifts?|cover|basis|pool)\b/i,
];



















const PT_BOILERPLATE = /eligib|benefits?\s+(?:package|plan|program|are|also\s+apply|apply|extend|include)|401\(?k|equal\s+opportunit|discriminat|regardless\s+of|reasonable\s+accommodat|paid\s+time\s+off|\bPTO\b|health\s+insurance|pro[\s-]?rate|employees?\s+(?:are|have|has|may|will|receive|also|with|and)/i;






const WEEKLY_HOURS = /(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?\s*(?:hours?|hrs?)\s*(?:per|a|each|\/)\s*week/gi;
const FULL_TIME_WEEKLY_HOURS = 30;

function scanShort(s: string): string | null {
  for (const re of PT_SHORT) { const m = s.match(re); if (m) return m[0].toLowerCase(); }
  return null;
}

function scanProse(s: string): string | null {
  for (const re of PT_PROSE) {
    
    
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of s.matchAll(g)) {
      const i = m.index ?? 0;
      const ctx = s.slice(Math.max(0, i - 80), i + m[0].length + 80);
      if (!PT_BOILERPLATE.test(ctx)) return m[0].toLowerCase();
    }
  }
  let maxHours = 0;
  for (const m of s.matchAll(WEEKLY_HOURS)) {
    maxHours = Math.max(maxHours, Number(m[2] ?? m[1]) || 0, Number(m[1]) || 0);
  }
  if (maxHours > 0 && maxHours < FULL_TIME_WEEKLY_HOURS) return `${maxHours} hours per week`;
  return null;
}













const FT_DECLARED = /\bfull[\s-]?time\b/i;





export function detectPartTime(ctx: SalaryContext | null | undefined): string | null {
  if (!ctx) return null;
  const short = `${ctx.title ?? ""}\n${ctx.employmentType ?? ""}`;
  
  
  const stated = scanShort(short);
  if (stated) return stated;
  if (FT_DECLARED.test(short)) return null;
  return scanProse(String(ctx.description ?? "").slice(0, 20_000));
}

export function parseSalaryStructured(
  text: string | null | undefined,
  country?: string | null,
  context?: SalaryContext | null,
): ParsedSalary | null {
  if (!text) return null;
  const s = decodeLegacyEntities(String(text).slice(0, 300));
  const num = (raw: string, k?: string): number | null => {
    const m = raw.match(/^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/);
    const base = m ? Number(m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "")) : Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(base)) return null;
    return k ? base * 1000 : base;
  };
  const period: ParsedSalary["period"] =
    P_HOUR.test(s) ? "hour" : P_WEEK.test(s) ? "week" : P_MONTH.test(s) ? "month"
    : P_YEAR.test(s) ? "year" : P_DAY.test(s) ? "day" : null;

  let min: number | null = null;
  let max: number | null = null;
  const r = s.match(P_RANGE);
  if (r) {
    min = num(r[1], r[2]);
    max = num(r[3], r[4]);
    
    if (min !== null && max !== null && max < min && r[2] && !r[4]) max *= 1000;
    if (min !== null && max !== null && min < max / 900 && !r[2] && r[4]) min *= 1000;
  } else {
    const m1 = s.match(P_MONEY);
    if (m1 && m1[1]) min = num(m1[1], m1[2]);
  }
  if (min === null || min <= 0) return null;

  const currency = detectCurrency(s, country);
  const MULT = PERIOD_MULTIPLIER;
  
  
  let annualMin: number | null = null;
  let mult: number | null = null;
  
  
  
  
  
  let basis: string | null = period;
  if (period) {
    mult = MULT[period];
    annualMin = min * mult;
    
    const lo = period === "hour" ? 7 : period === "day" ? 40 : period === "week" ? 200 : period === "month" ? 800 : 10_000;
    const hi =
      period === "hour" ? 500
      : period === "day" ? 5_000
      : period === "week" ? 20_000
      : period === "month" ? (currency && PARITY_CURRENCIES.has(currency) ? PARITY_MONTHLY_MAX : 90_000)
      : 2_000_000;
    if (min < lo || min > hi) { annualMin = null; mult = null; basis = null; }
  } else if (min >= 20_000 && min <= 2_000_000) {
    annualMin = min; 
    mult = 1;
    basis = "year";
  } else if (
    
    
    
    
    
    
    
    
    currency !== null && PARITY_CURRENCIES.has(currency) &&
    min >= 7 && (max ?? min) < 200 && (max === null || max >= min)
  ) {
    mult = MULT.hour;
    annualMin = min * mult;
    basis = "hour";
  }

  
  
  
  const partTimeSignal = detectPartTime(context);
  if (partTimeSignal && basis !== null && LOAD_DEPENDENT.has(basis)) {
    annualMin = null;
    mult = null;
  }
  
  
  
  let annualMax: number | null = null;
  if (annualMin !== null && mult !== null && max !== null && max >= min) {
    
    
    
    const am = max * mult;
    if (max / Math.max(min, 1) <= 6 && am <= 4_000_000) annualMax = am;
  }
  
  
  if (annualMin !== null) annualMin = Math.round(annualMin);
  if (annualMax !== null) annualMax = Math.round(annualMax);
  return { min, max, period, annualMin, annualMax, currency, annualMultiplier: mult, partTimeSignal };
}








const decodeLegacyEntities = (s: string) =>
  s.replace(/&mdash;/gi, "\u2014").replace(/&ndash;/gi, "\u2013").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");

export function extractSalary(text: string | null | undefined): string | null {
  if (!text) return null;
  const hay = decodeLegacyEntities(text.slice(0, 12_000)).replace(/\s+/g, " ");

  const range = hay.match(RANGE_RE);
  if (range && range.index !== undefined) {
    const ctx = hay.slice(Math.max(0, range.index - 40), range.index + range[0].length + 20);
    if (!NOT_PAY.test(ctx)) {
      const lo = parseMoney(range[1]);
      const hi = parseMoney(range[2]);
      const hourly = /hour|hr|hourly/i.test(range[3] ?? "") ||
        (lo !== null && hi !== null && lo < 1_000 && hi < 1_000 && !/[kK]\s*$/.test(range[1] + range[2]));
      if (lo !== null && hi !== null && plausible(lo, hi, hourly)) {
        return range[0].replace(/\s+/g, " ").trim().slice(0, 200);
      }
    }
    
    
    
    return null;
  }

  
  const single = hay.match(SINGLE_RE);
  if (single && single.index !== undefined) {
    const ctx = hay.slice(Math.max(0, single.index - 40), single.index + single[0].length + 20);
    if (!NOT_PAY.test(ctx)) {
      const v = parseMoney(single[1]);
      const hourly = /hour|hr|hourly/i.test(single[2]);
      if (v !== null && plausible(v, v, hourly)) {
        return single[0].replace(/\s+/g, " ").trim().slice(0, 200);
      }
    }
  }
  return null;
}
