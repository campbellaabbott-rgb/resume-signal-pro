/**
 * A WORK EMAIL PROVES AN EMPLOYER ONLY AT THE DOMAIN THE BOARD ALREADY LINKS
 * TO (register L13-06, the residue of 1.16).
 *
 * company-claim auto-verified a claim when the email domain's label and the
 * board's token or name were substrings of each other, in either direction,
 * with a three-character floor. Any cheap domain passed: x@nth.io for
 * Anthropic, hr@anthropic-careers.com for Anthropic, hr@dbank.xyz and
 * x@careers.io for TD Bank (td~wd3~TD_Bank_Careers). Verification puts a
 * "Verified employer" badge on the company page, so that was a ready-made
 * job-scam funnel.
 *
 * Now the email's REGISTRABLE domain must equal the registrable domain of a
 * host the board itself links to for that company -- an apply URL on the
 * employer's own site (careers.savills.com -> savills.com) -- and never an
 * applicant-tracking or hosting domain, whose mailboxes belong to the vendor.
 * Everything else goes to the owner's manual review (email_confirmed).
 *
 * S13-071: the registrable domain is read from the full Public Suffix List
 * (public-suffix-list.ts). The short list of second-level labels below was the
 * whole rule before, so an employer under any shared suffix it did not name
 * (me.uk, id.au, waw.pl, k12.ca.us, uk.com) collapsed to that suffix, and
 * anyone holding a mailbox under the same suffix matched it. The list's answer
 * is taken unless the old rule kept more labels, so no host is read as more
 * shared than before; a host that is itself a public suffix has no
 * registrable domain at all.
 */
import { PUBLIC_SUFFIX_RULES } from "./public-suffix-list.ts";

/** Second-level labels under a two-letter country code that are not themselves registrable (co.uk, com.au). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "ne", "or", "gob", "nic", "mil", "sch", "gv", "go", "nhs"]);

/**
 * Domains whose hosts serve many employers' job pages. A mailbox at one of
 * them is the vendor's, so an apply URL there proves nothing about who may
 * speak for the employer.
 */
export const VENDOR_DOMAINS: ReadonlySet<string> = new Set([
  "greenhouse.io", "lever.co", "ashbyhq.com", "smartrecruiters.com", "workable.com", "bamboohr.com",
  "recruitee.com", "teamtailor.com", "personio.de", "personio.com", "breezy.hr", "rippling.com",
  "rippling-ats.com", "myworkdayjobs.com", "myworkdaysite.com", "workday.com", "pinpointhq.com",
  "oraclecloud.com", "oracle.com", "taleo.net", "icims.com", "usajobs.gov", "paylocity.com",
  "ultipro.com", "ukg.com", "ukg.net", "adp.com", "jazzhr.com", "applytojob.com", "jobvite.com",
  "successfactors.com", "successfactors.eu", "sapsf.com", "sapsf.eu", "avature.net", "phenompeople.com",
  "eightfold.ai", "dayforcehcm.com", "paycomonline.net", "linkedin.com", "indeed.com", "glassdoor.com",
  "google.com", "notion.site", "github.io", "gem.com", "comeet.com", "join.com", "homerun.co",
  "recruiterbox.com", "freshteam.com", "zohorecruit.com", "trakstar.com", "careerplug.com",
  "hirehive.com", "polymer.co", "wellfound.com", "ycombinator.com", "typeform.com", "salesforce.com",
  "force.com", "site.com", "jobs.net", "brassring.com", "resumebooster.work",
]);

let suffixRules: Set<string> | null = null;
let suffixExceptions: Set<string> | null = null;

/**
 * How many trailing labels are the public suffix, by the list's own
 * algorithm: an exception rule wins (its suffix drops the leftmost label),
 * then the longest matching rule, wildcards included, then the bare TLD.
 */
export function publicSuffixLabels(labels: readonly string[]): number {
  if (!suffixRules || !suffixExceptions) {
    suffixRules = new Set();
    suffixExceptions = new Set();
    for (const r of PUBLIC_SUFFIX_RULES.split("\n")) {
      if (r.startsWith("!")) suffixExceptions.add(r.slice(1));
      else suffixRules.add(r);
    }
  }
  const n = labels.length;
  for (let i = 0; i < n; i++) if (suffixExceptions.has(labels.slice(i).join("."))) return n - i - 1;
  for (let i = 0; i < n; i++) {
    const rest = labels.slice(i + 1).join(".");
    if (suffixRules.has(labels.slice(i).join(".")) || (rest && suffixRules.has(`*.${rest}`))) return n - i;
  }
  return 1;
}

/** The registrable domain of a host ("careers.savills.co.uk" -> "savills.co.uk"), or "" for something that is not one. */
export function registrableDomain(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes(".")) return "";
  const labels = h.split(".").filter(Boolean);
  if (labels.length < 2 || labels.some((l) => l.length > 63)) return "";
  const n = labels.length;
  const listed = publicSuffixLabels(labels);
  if (n <= listed) return "";
  const older = n >= 3 && labels[n - 1].length === 2 && SECOND_LEVEL.has(labels[n - 2]) ? 3 : 2;
  return labels.slice(-Math.max(listed + 1, older)).join(".");
}

/** True when the host is a vendor domain or any host under one. */
export function vendorHost(host: string): boolean {
  const labels = host.trim().toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) if (VENDOR_DOMAINS.has(labels.slice(i).join("."))) return true;
  return false;
}

/** The employer's own registrable domains, from the board's apply URLs for one company. */
export function employerDomains(applyUrls: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const u of applyUrls) {
    if (typeof u !== "string" || !u) continue;
    let host = "";
    try { host = new URL(u).hostname; } catch { continue; }
    const d = registrableDomain(host);
    // By suffix, not by equality: a vendor domain that is itself a public
    // suffix (notion.site, github.io) makes every tenant its own registrable.
    if (d && !vendorHost(host)) out.add(d);
  }
  return out;
}

/** True only when the email's registrable domain is one of the employer's own. */
export function domainProven(email: string, domains: Set<string>): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const d = registrableDomain(email.slice(at + 1));
  return !!d && domains.has(d);
}
