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
  remote: boolean;
  department: string | null;
  /** ISO date, null when the ATS doesn't expose one in the list payload. */
  postedAt: string | null;
  /** Deterministic field bucket (department-first, title fallback). */
  category: JobCategory;
  /** Freeform salary summary when the feed provides one; null otherwise. */
  salary: string | null;
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
export const POSTED_AT_MAX_AGE_MS = 3 * 365 * 24 * 60 * 60_000; // ~3 years

// A posted_at is trustworthy only if it parses and sits in a sane window: not
// in the future (small clock-skew grace) and not absurdly old. Garbage dates
// collapse to null — so effective_posted falls back to first-seen for sorting
// and the card shows no date instead of "posted 6000 days ago". The board's
// freshness signal is only as honest as the dates feeding it.
export function sanePostedAt(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso || typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t > now + 2 * 86_400_000) return null;        // future beyond clock-skew grace
  if (t < now - POSTED_AT_MAX_AGE_MS) return null;  // absurdly old
  return iso;
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
      remote: looksRemote(location) || looksRemote(j.title ?? ""),
      department: j.departments?.[0]?.name ?? null,
      postedAt: j.first_published ?? j.updated_at ?? null,
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
      remote: j.workplaceType === "remote" || looksRemote(location),
      department: j.categories?.team ?? null,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
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
        remote: j.isRemote === true || looksRemote(location),
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
  location?: { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string };
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
        remote: p.location?.remote === true || looksRemote(location),
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
        remote: j.telecommuting === true || looksRemote(location),
        department: j.department ?? null,
        postedAt: posted ? new Date(posted).toISOString() : null,
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
        remote: j.isRemote === true || looksRemote(location) || looksRemote(j.jobOpeningName ?? ""),
        department: j.departmentLabel ?? null,
        postedAt: null, // the list feed carries no dates
        category: categorize(j.jobOpeningName ?? "", j.departmentLabel),
        salary: null,
        applyUrl: safeUrl(`https://${token}.bamboohr.com/careers/${j.id}`),
      };
    })
    .filter((j) => j.applyUrl !== "");
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
