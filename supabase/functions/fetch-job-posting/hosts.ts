/**
 * THE HOSTS THIS FETCHER WILL ASK, AND NOTHING ELSE (sweep S11-032, owner
 * decision 2026-10-11).
 *
 * The scanner's "Job URL" tab used to send the link itself as the job
 * description. The owner chose a safe fetcher over removing the tab, on two
 * conditions this file is the first half of: https only, and only hosts we
 * know -- the applicant-tracking vendors the job board reads, and an
 * employer's own careers subdomain OF those vendors (acme.recruitee.com,
 * acme.wd5.myworkdayjobs.com). An employer's own domain
 * (careers.acme.com) is not on the list even when a vendor serves it: we
 * cannot tell it from any other host, so the person is asked to paste the
 * text. So is LinkedIn, Indeed and every other site.
 *
 * Every URL the fetcher touches passes through here: the one the person
 * pasted, the vendor API URL derived from it, and every redirect hop.
 */

/** A DNS label: letters, digits and inner hyphens, at most 63 characters. */
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";

/** Vendor hosts, exactly. The board's vendors, their hosted job pages and their public APIs. */
const EXACT: Readonly<Record<string, string>> = {
  "boards.greenhouse.io": "greenhouse",
  "job-boards.greenhouse.io": "greenhouse",
  "boards.eu.greenhouse.io": "greenhouse",
  "job-boards.eu.greenhouse.io": "greenhouse",
  "boards-api.greenhouse.io": "greenhouse",
  "jobs.lever.co": "lever",
  "jobs.eu.lever.co": "lever",
  "api.lever.co": "lever",
  "api.eu.lever.co": "lever",
  "jobs.ashbyhq.com": "ashby",
  "jobs.smartrecruiters.com": "smartrecruiters",
  "careers.smartrecruiters.com": "smartrecruiters",
  "api.smartrecruiters.com": "smartrecruiters",
  "apply.workable.com": "workable",
  "jobs.workable.com": "workable",
  "ats.rippling.com": "rippling",
  "api.rippling.com": "rippling",
  "recruiting.paylocity.com": "paylocity",
  "workforcenow.adp.com": "adp",
  "www.usajobs.gov": "usajobs",
  "usajobs.gov": "usajobs",
};

/** An employer's careers subdomain of a vendor: one employer label (two for Workday's data-centre form). */
const SUBDOMAIN: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`^${LABEL}\\.recruitee\\.com$`), "recruitee"],
  [new RegExp(`^${LABEL}\\.teamtailor\\.com$`), "teamtailor"],
  [new RegExp(`^${LABEL}\\.jobs\\.personio\\.(?:de|com)$`), "personio"],
  [new RegExp(`^${LABEL}\\.breezy\\.hr$`), "breezy"],
  [new RegExp(`^${LABEL}\\.bamboohr\\.com$`), "bamboohr"],
  [new RegExp(`^${LABEL}\\.pinpointhq\\.com$`), "pinpoint"],
  [new RegExp(`^${LABEL}\\.applytojob\\.com$`), "jazzhr"],
  [new RegExp(`^${LABEL}\\.icims\\.com$`), "icims"],
  [new RegExp(`^${LABEL}\\.(?:wd\\d{1,3}\\.)?myworkdayjobs\\.com$`), "workday"],
  [/^wd\d{1,3}\.myworkdaysite\.com$/, "workday"],
  [/^recruiting\d{0,2}\.ultipro\.com$/, "ukg"],
  [new RegExp(`^${LABEL}\\.fa(?:\\.${LABEL})?\\.oraclecloud\\.com$`), "oracle"],
];

/** The vendor a host belongs to, or null when the fetcher must not ask it. */
export function vendorOfHost(rawHost: string): string | null {
  const host = rawHost.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  // An address is never a vendor, whatever it serves.
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  if (Object.prototype.hasOwnProperty.call(EXACT, host)) return EXACT[host];
  for (const [re, vendor] of SUBDOMAIN) if (re.test(host)) return vendor;
  return null;
}

export type UrlRefusal = "bad_url" | "not_https" | "unsupported_host";

/**
 * A URL the fetcher may request: https, port 443, no credentials, a vendor
 * host. Used on every hop, so a redirect is held to the same rule as the link
 * the person pasted.
 */
export function checkFetchUrl(u: URL): { ok: true; vendor: string } | { ok: false; reason: UrlRefusal } {
  if (u.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (u.username || u.password) return { ok: false, reason: "bad_url" };
  if (u.port && u.port !== "443") return { ok: false, reason: "bad_url" };
  const vendor = vendorOfHost(u.hostname);
  return vendor ? { ok: true, vendor } : { ok: false, reason: "unsupported_host" };
}

/**
 * The link a person pasted, read the way they meant it: surrounding spaces
 * dropped, a missing scheme taken as https, and http upgraded to https (the
 * fetcher never asks over http). Then the same rule as every hop.
 */
export function parseJobUrl(raw: unknown): { ok: true; url: URL; vendor: string } | { ok: false; reason: UrlRefusal } {
  if (typeof raw !== "string") return { ok: false, reason: "bad_url" };
  let s = raw.trim();
  if (!s || s.length > 2048 || /\s/.test(s)) return { ok: false, reason: "bad_url" };
  if (/^http:\/\//i.test(s)) s = `https://${s.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  const checked = checkFetchUrl(u);
  if (checked.ok === false) return { ok: false, reason: checked.reason };
  return { ok: true, url: u, vendor: checked.vendor };
}
