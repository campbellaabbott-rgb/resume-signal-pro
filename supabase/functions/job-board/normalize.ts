// Pure normalization + filtering for the job board. No Deno APIs — this
// module is unit-tested by vitest against REAL payload fixtures captured
// from each ATS's public API (src/test/job-board.test.ts).

import type { JobSourceKind } from "./sources.ts";

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
  /** The company's own posting/application page — where Apply goes. */
  applyUrl: string;
}

// Greenhouse escapes the HTML it returns (&lt;p&gt;…), so unescape BEFORE
// stripping tags or every tag survives stripping.
export function htmlToText(html: string): string {
  const unescaped = html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
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
      applyUrl: j.absolute_url,
    };
  });
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number; // epoch ms
  workplaceType?: string;
  categories?: { location?: string; team?: string; allLocations?: string[] };
  descriptionPlain?: string;
  descriptionBodyPlain?: string;
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
      applyUrl: j.hostedUrl ?? j.applyUrl ?? "",
    };
  });
}

interface AshbyJob {
  id: string;
  title: string;
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
        applyUrl: j.jobUrl ?? j.applyUrl ?? "",
      };
    });
}

export interface JobFilter {
  q?: string;
  location?: string;
  remote?: boolean;
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
