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
 */

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

/** The registrable domain of a host ("careers.savills.co.uk" -> "savills.co.uk"), or "" for something that is not one. */
export function registrableDomain(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes(".")) return "";
  const labels = h.split(".").filter(Boolean);
  if (labels.length < 2 || labels.some((l) => l.length > 63)) return "";
  const n = labels.length;
  const take = n >= 3 && labels[n - 1].length === 2 && SECOND_LEVEL.has(labels[n - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** The employer's own registrable domains, from the board's apply URLs for one company. */
export function employerDomains(applyUrls: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const u of applyUrls) {
    if (typeof u !== "string" || !u) continue;
    let host = "";
    try { host = new URL(u).hostname; } catch { continue; }
    const d = registrableDomain(host);
    if (d && !VENDOR_DOMAINS.has(d)) out.add(d);
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
