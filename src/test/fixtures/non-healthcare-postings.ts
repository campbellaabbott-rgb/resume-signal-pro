/**
 * Real-shaped job postings outside healthcare (register S11-007), written the
 * way employers write them: an all-caps "WHAT YOU'LL DO" heading, "internal",
 * "document", "support", "report", "important", part-time and overtime
 * notes, and a Maryland office. Each one once scored highest for healthcare
 * because 'rn', 'do', 'pt' and 'ot' matched inside ordinary words.
 */
export const NON_HEALTHCARE_POSTINGS: Record<string, { expect: string; text: string }> = {
  software: {
    expect: "technology",
    text: `Senior Software Engineer, Platform
Baltimore, MD (Hybrid) | Full-time

About the role
We are looking for a Senior Software Engineer to join our internal platform team. You will design, build and support the services every product team depends on.

WHAT YOU'LL DO
- Design and document APIs used by internal and external developers
- Support production systems and take part in the on-call rotation
- Report on reliability and drive important improvements to our CI/CD pipelines
- Mentor engineers and review code; we do not ship without tests

What you bring
- 5+ years building distributed systems in Go, Java or Python
- Experience with Kubernetes, AWS and PostgreSQL
- A record of shipping software that customers rely on
- Comfort with overtime (OT) during major launches is not required`,
  },
  marketing: {
    expect: "marketing",
    text: `Digital Marketing Manager
Remote, US | FT/PT considered

WHAT YOU WILL DO
Own our paid and organic marketing channels. Report weekly on campaign performance, document what works, and support the sales team with content.

Responsibilities
- Plan and run campaigns across paid search, paid social and email marketing
- Build the content calendar and manage SEO for the blog and landing pages
- Run A/B tests and report on conversion rate and customer acquisition cost
- Partner with internal stakeholders on brand and product marketing launches

Requirements
- 4+ years in digital marketing, demand generation or growth marketing
- Hands-on with Google Ads, HubSpot and Google Analytics
- It is important that you can turn data into a clear story`,
  },
  accounting: {
    expect: "finance",
    text: `Staff Accountant
Chicago, IL | Full-time

WHAT YOU'LL DO
- Prepare journal entries, account reconciliations and the month-end close
- Support the annual audit and document internal controls (SOX)
- Report variances to the controller and do the accounts payable review
- Maintain the general ledger and prepare financial statements

Requirements
- Bachelor's degree in accounting; CPA or CPA track preferred
- 2+ years of public or corporate accounting experience
- Strong Excel and NetSuite skills; GAAP knowledge is important`,
  },
  sales: {
    expect: "sales",
    text: `Account Executive, Mid-Market
New York, NY | Full-time, base plus commission

WHAT YOU'LL DO
- Own a quota and a book of mid-market accounts from prospecting to close
- Run discovery calls and product demos, and document every opportunity in Salesforce
- Support customer success on renewals and report pipeline to sales leadership
- Partner with internal solutions engineers on complex deals

What you bring
- 3+ years of B2B SaaS sales, with a record of exceeding quota
- Strong negotiation and cold outreach skills
- It is not a remote role; we work from the office three days a week`,
  },
};

export const NURSING_POSTING = `Registered Nurse (RN), Medical-Surgical Unit
Baltimore, MD | Full-time, nights

WHAT YOU'LL DO
- Deliver patient care to adult medical-surgical patients
- Administer medications, document assessments in Epic and coordinate care with physicians
- Educate patients and families at discharge

Requirements
- Active RN license in Maryland; BLS and ACLS certification
- 1+ year of acute care nursing experience`;
