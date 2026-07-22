// Pure normalization + filtering for the job board. No Deno APIs — this
// module is unit-tested by vitest against REAL payload fixtures captured
// from each ATS's public API (src/test/job-board.test.ts).

import type { JobSourceKind } from "./sources.ts";
import { categorize, type JobCategory } from "./categories.ts";

export interface JobPosting {
  /** `${source}:${token}:${externalId}` — stable across refreshes. */
  id: string;
  source: JobSourceKind;
  /** Board token — needed for the detail lookup. */
  token: string;
  company: string;
  title: string;
  location: string;
  /** True only when workMode is definitively "remote" (kept for filters/stats). */
  remote: boolean;
  /** Definitive work mode: vendor structured field first, explicit title/location
      text second, null when the posting doesn't say — and the UI shows nothing. */
  workMode: "remote" | "hybrid" | "onsite" | null;
  department: string | null;
  /** ISO date, null when the ATS doesn't expose one in the list payload. */
  postedAt: string | null;
  /** Deterministic field bucket (department-first, title fallback). */
  category: JobCategory;
  /** Freeform salary summary when the feed provides one; null otherwise. */
  salary: string | null;
  /** ISO-3166 alpha-2 when the FEED states it structurally (Rippling does);
      absent → ingest falls back to detectCountry(location). */
  country?: string | null;
  /** The company's own posting/application page — where Apply goes. */
  applyUrl: string;
}

// Feeds are official vendor APIs, but a posting URL still passes through us
// into an <a href> — http gets upgraded to https (One Medical ships http://
// apply URLs), anything that isn't http(s) becomes "" and the posting drops.
const safeUrl = (u: unknown): string => {
  if (typeof u !== "string") return "";
  if (/^https:\/\//i.test(u)) return u;
  if (/^http:\/\//i.test(u)) return "https://" + u.slice(7);
  return "";
};

// Oldest posted_at we'll trust from a feed. Beyond this it's almost certainly
// bad data (some feeds return epoch-ish or decade-old timestamps — e.g. a
// Palantir role dated 2009) or an evergreen pipeline req that shouldn't wear a
// stale date. Kept here so ingestion and any date-hygiene share one bound.
// Garbage-date floor: only dates before this are feed junk (epoch zeros,
// mis-parsed typos, the live 2009 Palantir date — Lever didn't exist yet).
// A REAL old date — a 3.5-year-old evergreen Lever req — must SURVIVE
// sanitization so the freshness cap can drop the posting. The previous
// ~3-year "absurdly old → null" rule laundered exactly those evergreens into
// undated-KEPT postings (live incident: a 1,295-day-old req served on a board
// that promises nothing older than 30 days; 42% of Lever rows were undated
// this way). 2010 predates every ATS we ingest, so anything earlier cannot be
// a real posting date.
export const POSTED_AT_GARBAGE_FLOOR_MS = Date.parse("2010-01-01T00:00:00Z");

// A posted_at is trustworthy only if it parses and sits in a sane window: not
// in the future (small clock-skew grace) and not pre-2000 junk. Garbage dates
// collapse to null — so effective_posted falls back to first-seen for sorting
// and the card shows no date instead of "posted 6000 days ago". Real-but-old
// dates pass through untouched: the ingestion freshness cap is what drops
// those postings, and nulling them would keep the posting alive undated.
export function sanePostedAt(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso || typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t > now + 2 * 86_400_000) return null;      // future beyond clock-skew grace
  if (t < POSTED_AT_GARBAGE_FLOOR_MS) return null; // epoch-zero / typo junk
  return iso;
}

// Closure "superseded" detection compares a vanished posting's title against
// the board's still-live titles — but companies decorate reposts with req-id
// noise ("Behavior Technician (R-48213)", "Nurse - #10422"), so exact-string
// matching under-detects relisting churn and inflates fill-rate stats. Strip
// only id-shaped noise: bracketed segments containing digits and trailing
// req/id numbers. NEVER strip words (a Senior Engineer closing while Engineer
// stays live is not automatically a repost).
export function normalizeCloseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[([{][^)\]}]*\d[^)\]}]*[)\]}]/g, " ")          // (R-48213), [Req 10422]
    .replace(/\s*[-–—#·|]\s*(?:req|job|id|jr)?[\s#:-]*\d{3,}\s*$/i, " ") // trailing "- 10422" / "#10422"
    .replace(/\s+/g, " ")
    .trim();
}

// Convert a feed's raw date value (epoch number, ISO/date string, whatever the
// vendor sends) to an ISO string — WITHOUT throwing. `new Date(x).toISOString()`
// raises a RangeError on an invalid date, and a normalizer that throws fails its
// ENTIRE board upstream (fetchBoard swallows it → the board silently stops
// ingesting, the same class as a fetch timeout). A non-empty garbage date string
// is exactly the input that trips this. Bad or absent values collapse to null;
// window-sanity (future/too-old) stays a separate concern for sanePostedAt.
export function safeIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Freshness-cap decision: a posting is dropped on age ONLY when it carries a
// trustworthy date older than the cutoff. A null (undated or garbage-dated,
// per sanePostedAt) posting is never dropped on age — we can't prove it's old,
// and the vast majority of feeds do date their postings anyway.
export function isDatedBefore(sanitizedPostedAt: string | null, cutoffMs: number): boolean {
  return sanitizedPostedAt !== null && Date.parse(sanitizedPostedAt) < cutoffMs;
}

// Greenhouse escapes the HTML it returns (&lt;p&gt;…) — and entities INSIDE
// that HTML arrive double-escaped (&amp;nbsp;), so unescape must run twice:
// once to recover the markup, once to recover the text's own entities.
// Two passes are a no-op on plain text.
const unescapeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // last, so &amp;lt; needs the second pass, not this one

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

// Trinary work-mode detection from explicit title/location text — the same
// precision bar as looksRemote (clear words only; descriptions are never
// inferred from). Hybrid outranks remote ("Hybrid remote" is hybrid); onsite
// needs the explicit phrase. null = the posting doesn't say, and the board
// shows nothing rather than a guess. Multilingual: the board carries DE/FR/
// ES/NL/PT postings.
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
const VENDOR_MODE: Record<string, "remote" | "hybrid" | "onsite"> = {
  remote: "remote", hybrid: "hybrid", onsite: "onsite", on_site: "onsite",
};
/** Map a vendor's workplace enum (any casing, ON_SITE variants) to our trinary. */
export function vendorWorkMode(v: string | null | undefined): "remote" | "hybrid" | "onsite" | null {
  if (typeof v !== "string") return null;
  return VENDOR_MODE[v.toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}

// Country from free-text location — deterministic and CONSERVATIVE: an explicit
// country name, a comma-prefixed US state / Canadian province code, or a full
// state/province name. No city geocoding, no guessing: a location we can't
// place stays NULL and is simply excluded from the country filter (disclosed),
// because "London" could be Ontario and "Georgia" could be Tbilisi.
const COUNTRY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:united states|u\.?s\.?a\.?|estados unidos)\b/i, "US"],
  [/\b(?:united kingdom|england|scotland|wales|northern ireland)\b|\bUK\b/i, "GB"],
  [/\b(?:germany|deutschland)\b/i, "DE"],
  [/\bcanada\b/i, "CA"],
  [/\bfrance\b/i, "FR"],
  [/\b(?:netherlands|nederland)\b/i, "NL"],
  [/\bindia\b/i, "IN"],
  [/\baustralia\b/i, "AU"],
  [/\b(?:poland|polska)\b/i, "PL"],
  [/\b(?:spain|españa)\b/i, "ES"],
  [/\b(?:mexico|méxico)\b/i, "MX"],
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
];
// Comma-prefixed uppercase state/province codes only — "Austin, TX" yes,
// stray "in" or "or" inside words no.
const P_US_STATE_CODE = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?![A-Za-z])/;
const P_CA_PROV_CODE = /,\s*(ON|QC|BC|AB|MB|SK|NS|NB|PE|NL|YT|NT|NU)(?![A-Za-z])/;
const P_US_STATE_NAME = /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
const P_CA_PROV_NAME = /\b(?:ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland)\b/i;
export function detectCountry(location: string | null | undefined): string | null {
  if (!location) return null;
  const s = String(location).slice(0, 300);
  for (const [re, code] of COUNTRY_PATTERNS) if (re.test(s)) return code;
  if (P_US_STATE_CODE.test(s) || P_US_STATE_NAME.test(s)) return "US";
  if (P_CA_PROV_CODE.test(s) || P_CA_PROV_NAME.test(s)) return "CA";
  if (/\bUS\b/.test(s)) return "US"; // "Remote - US", "US Remote" — after state codes so ", USA" paths won
  return null;
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

export function normalizeGreenhouse(raw: { jobs?: GreenhouseJob[] }, company: string, token: string): JobPosting[] {
  return (raw.jobs ?? []).map((j) => {
    const location = j.location?.name ?? "";
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
      // first_published only — updated_at re-stamps on any edit, so using it
      // as a posting date silently biases every age stat young. Undated is
      // honest; mis-dated is not.
      postedAt: j.first_published ?? null,
      category: categorize(j.title ?? "", j.departments?.[0]?.name),
      salary: null,
      applyUrl: safeUrl(j.absolute_url),
    };
  }).filter((j) => j.applyUrl !== "");
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number; // epoch ms
  workplaceType?: string;
  categories?: { location?: string; team?: string; allLocations?: string[] };
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
  workplaceType?: string; // "Remote" | "Hybrid" | "Onsite"
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
        // The public posting page is deterministic from company identifier + id.
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
        postedAt: null, // the list feed carries no dates
        category: categorize(j.jobOpeningName ?? "", j.departmentLabel),
        salary: null,
        applyUrl: safeUrl(`https://${token}.bamboohr.com/careers/${j.id}`),
      };
    })
    .filter((j) => j.applyUrl !== "");
}

// ── Rung-3 vendors ──────────────────────────────────────────────────────────
// Two of these feeds are XML (Personio's official feed, Teamtailor's RSS), so a
// pair of tiny CDATA-aware helpers stands in for a parser dependency. They only
// need to handle the well-formed, machine-generated feeds these vendors emit.

/** All <tag>…</tag> block contents in document order. */
export function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** First <tag> value inside a block, CDATA unwrapped, trimmed; null if absent. */
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
        applyUrl: safeUrl(o.careers_url ?? (o.slug ? `https://${token}.recruitee.com/o/${o.slug}` : "")),
      };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "");
}

/** Personio's official XML feed ({token}.jobs.personio.de/xml). `host` is the
 *  feed host that answered (.de or .com) so Apply lands on the right domain. */
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
        salary: null, // the feed carries no compensation field
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

// ── Rippling ATS ────────────────────────────────────────────────────────────
// Rippling publishes no documented list API; the public board page embeds the
// job list as first-party structured JSON (Next.js __NEXT_DATA__, react-query
// dehydratedState). That's still the vendor's own data channel — user decision
// 2026-07-16 to include it — but it's an implementation detail that can move,
// so the vendor canary watches it and the breaker quarantines on drift.
// List items carry NO posted date and NO description (undated postings stay
// honest-undated; boards are light by nature), but DO carry structured
// country codes — better than location-text detection.
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
    workplaceType?: string; // ON_SITE | REMOTE | HYBRID
  }> | null;
}

/** Pull the job-posts page out of a Rippling board page's __NEXT_DATA__.
 *  Returns null when the payload shape isn't recognizable (drift signal —
 *  distinct from a legitimately empty items array). */
export function extractRipplingJobPosts(html: string): { items: RipplingJobItem[]; totalPages: number } | null {
  const m = html.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as {
      props?: { pageProps?: { dehydratedState?: { queries?: Array<{ queryKey?: unknown[]; state?: { data?: { items?: unknown[]; totalPages?: number } } }> } } };
    };
    const queries = data.props?.pageProps?.dehydratedState?.queries ?? [];
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
// a RELATIVE posting age ("Posted 5 Days Ago"); we never store that as a date
// (it would pollute the company-stated median), but we DO honor it as a
// freshness filter — Workday's own statement that a posting is 30+ days old is
// authority to drop it. Kept postings are honest-undated (like BambooHR).
export interface WorkdayListItem {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

/** Relative Workday age → days, or null when unparseable. "Posted Today"=0,
 *  "Posted Yesterday"=1, "Posted N Days Ago"=N, "Posted 30+ Days Ago"=31. */
export function workdayPostedDays(postedOn: string | null | undefined): number | null {
  if (!postedOn) return null;
  const s = postedOn.toLowerCase();
  if (/posted\s+today/.test(s)) return 0;
  if (/posted\s+yesterday/.test(s)) return 1;
  const plus = s.match(/posted\s+(\d+)\+\s*days?\s+ago/);
  if (plus) return Number(plus[1]) + 1; // "30+ Days Ago" → 31 (past the cap)
  const n = s.match(/posted\s+(\d+)\s+days?\s+ago/);
  if (n) return Number(n[1]);
  return null;
}

export function normalizeWorkday(items: WorkdayListItem[], company: string, token: string): JobPosting[] {
  // token = tenant~dc~site
  const [tenant, dc, site] = token.split("~");
  if (!tenant || !dc || !site) return [];
  const base = `https://${tenant}.${dc}.myworkdayjobs.com/en-US/${site}`;
  return (Array.isArray(items) ? items : [])
    .map((j) => {
      const path = String(j.externalPath ?? "");
      // Requisition id: the `_JR…` suffix on the path, else the first bulletField.
      const reqId = path.split("_").pop() || (Array.isArray(j.bulletFields) ? j.bulletFields[0] : "") || "";
      const loc = String(j.locationsText ?? "").trim();
      // "2 Locations" is a multi-site placeholder, not a place — keep it as
      // display text but it won't resolve to a country (honest).
      const days = workdayPostedDays(j.postedOn);
      const stale = days !== null && days > 30; // Workday says it's past our cap
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
        // Workday's list states a relative age ("Posted 3 Days Ago") — that IS
        // the company's stated date, at day precision. Convert to absolute
        // (fetch time − N days, ±1d) so these postings carry provenance and
        // participate in date filters and the stated-date medians. "30+ Days
        // Ago" is unbounded — never dated, dropped via _stale.
        postedAt: days !== null && days <= 30 ? new Date(Date.now() - days * 86_400_000).toISOString() : null,
        category: categorize(String(j.title ?? ""), null),
        salary: null,
        country: detectCountry(loc),
        applyUrl: safeUrl(path ? `${base}${path}` : ""),
        _stale: stale, // consumed + stripped by the fetcher's freshness filter
      } as JobPosting & { _stale?: boolean };
    })
    .filter((j) => j.applyUrl !== "" && j.title !== "" && !(j as { _stale?: boolean })._stale && j.id !== `workday:${token}:`)
    .map(({ _stale: _drop, ...j }) => j as JobPosting);
}

/** Teamtailor career-site RSS ({token}.teamtailor.com/jobs.rss). The feed is
 *  title/link/pubDate only — location isn't structured, so it stays honest-empty
 *  unless the title itself says remote. External id = the numeric slug prefix. */
export function normalizeTeamtailor(rss: string, company: string, token: string): JobPosting[] {
  return xmlBlocks(rss, "item")
    .map((item) => {
      const title = xmlValue(item, "title") ?? "";
      const link = xmlValue(item, "link") ?? "";
      const idMatch = link.match(/\/jobs\/(\d+)/);
      const externalId = idMatch ? idMatch[1] : "";
      return {
        id: `teamtailor:${token}:${externalId}`,
        source: "teamtailor" as const,
        token,
        company,
        title,
        location: "",
        workMode: detectWorkMode(title),
        remote: detectWorkMode(title) === "remote",
        department: null,
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
  /** Board tokens to include; empty/undefined = all. */
  companies?: string[];
}

// Multi-term AND across title+company+department; location is its own field
// so "engineer berlin" in q doesn't silently return nothing.
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

/** Newest first; postings without a date sink to the end. */
export function sortJobs(jobs: JobPosting[]): JobPosting[] {
  return [...jobs].sort((a, b) => {
    if (a.postedAt && b.postedAt) return b.postedAt.localeCompare(a.postedAt);
    if (a.postedAt) return -1;
    if (b.postedAt) return 1;
    return a.title.localeCompare(b.title);
  });
}
