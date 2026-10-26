/**
 * WHICH HIRING SYSTEM A POSTING CAME FROM, AND WHICH ONE ITS APPLY LINK OPENS.
 *
 * Two different questions (audit JL15). A posting is READ from the system in
 * its `source` column; its apply link can open somewhere else entirely — a
 * Workday-read posting whose employer routes applications through its own
 * careers site, an aggregator-style "apply" host, a Phenom front end. The card
 * names the system we read; the pane's "Apply link opens on …" row names the
 * host the link will actually open, read off the URL itself, so a seeker is
 * never told "Workday" and handed somebody else's form.
 *
 * NEVER A RAW VALUE. A source we hold no label for, and a host we cannot name,
 * fall back to the hostname the browser will show anyway — a fact the reader
 * can check — never to a column value such as "adp_wfn".
 */
import { ALL_BOARD_SOURCES } from "@/config/ats-vendors";

const SOURCE_LABEL_BY_KEY: ReadonlyMap<string, string> = new Map(ALL_BOARD_SOURCES.map((v) => [v.key, v.label]));

/** The vendor's own name for a `source`, or null. (Jobs.tsx sourceLabel, on a Map so "constructor" is not a key.) */
export function systemLabel(source: string | null | undefined): string | null {
  if (typeof source !== "string") return null;
  return SOURCE_LABEL_BY_KEY.get(source.trim().toLowerCase()) ?? null;
}

/**
 * Hosts we can name. The value is a board source key where the system is one
 * we carry (so the label is the vendor table's own spelling), or a literal
 * label for a system we do not carry. Matched on the registrable suffix.
 */
const HOST_SYSTEMS: ReadonlyArray<{ suffix: string; source?: string; label?: string }> = [
  { suffix: "myworkdayjobs.com", source: "workday" },
  { suffix: "myworkdaysite.com", source: "workday" },
  { suffix: "workdayjobs.com", source: "workday" },
  { suffix: "greenhouse.io", source: "greenhouse" },
  { suffix: "lever.co", source: "lever" },
  { suffix: "ashbyhq.com", source: "ashby" },
  { suffix: "smartrecruiters.com", source: "smartrecruiters" },
  { suffix: "breezy.hr", source: "breezy" },
  { suffix: "oraclecloud.com", source: "oracle" },
  { suffix: "teamtailor.com", source: "teamtailor" },
  { suffix: "personio.de", source: "personio" },
  { suffix: "personio.com", source: "personio" },
  { suffix: "pinpointhq.com", source: "pinpoint" },
  { suffix: "bamboohr.com", source: "bamboohr" },
  { suffix: "workable.com", source: "workable" },
  { suffix: "rippling.com", source: "rippling" },
  { suffix: "rippling-ats.com", source: "rippling" },
  { suffix: "recruitee.com", source: "recruitee" },
  { suffix: "icims.com", source: "icims" },
  { suffix: "usajobs.gov", source: "usajobs" },
  { suffix: "paylocity.com", source: "paylocity" },
  { suffix: "ultipro.com", source: "ukg" },
  { suffix: "ukg.net", source: "ukg" },
  { suffix: "adp.com", source: "adp" },
  { suffix: "applytojob.com", source: "jazzhr" },
  { suffix: "jazzhr.com", source: "jazzhr" },
  { suffix: "taleo.net", label: "Taleo" },
  { suffix: "successfactors.com", label: "SAP SuccessFactors" },
  { suffix: "successfactors.eu", label: "SAP SuccessFactors" },
  { suffix: "jobvite.com", label: "Jobvite" },
];

function hostOf(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const endsWithHost = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

export interface ApplySystem {
  /** A board source key when the host is a system we carry, else null. */
  source: string | null;
  /** What to print: the vendor's name, or the hostname when the system has no name we hold. */
  label: string;
  /** True when `label` is a named system rather than a bare hostname. */
  named: boolean;
}

/** The system an apply link opens, read off the link alone. Null for a link that is not an http(s) URL. */
export function applySystem(applyUrl: string | null | undefined): ApplySystem | null {
  const host = hostOf(applyUrl);
  if (!host) return null;
  for (const h of HOST_SYSTEMS) {
    if (!endsWithHost(host, h.suffix)) continue;
    const label = h.source ? systemLabel(h.source) : h.label ?? null;
    if (label) return { source: h.source ?? null, label, named: true };
  }
  return { source: null, label: host, named: false };
}

/**
 * The apply URL a button opens. ONE vendor rewrite (design spec 4.4): a
 * Workday link ending in "/apply" opens the application step rather than the
 * posting, so on myworkdayjobs.com only, a trailing "/apply" (with or without
 * its slash) is removed and the link opens the posting, which carries
 * Workday's own Apply button. Every other host is returned untouched — on
 * Greenhouse, Lever and the rest "/apply" can BE the form — and a per-vendor
 * table test pins each one.
 */
export function cleanApplyUrl(applyUrl: string | null | undefined): string | null {
  if (typeof applyUrl !== "string" || !applyUrl.trim()) return null;
  const url = applyUrl.trim();
  const host = hostOf(url);
  // Only an http(s) address is a link we hand a seeker: a "javascript:" or
  // "mailto:" value from a feed renders no Apply button at all.
  if (!host) return null;
  if (!endsWithHost(host, "myworkdayjobs.com")) return url;
  try {
    const u = new URL(url);
    const stripped = u.pathname.replace(/\/apply\/?$/i, "");
    if (stripped === u.pathname || !stripped) return url;
    u.pathname = stripped;
    return u.toString();
  } catch {
    return url;
  }
}
