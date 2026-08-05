/**
 * THE MANDATE FORM IS BLANK, AND THE ANSWER IS ALREADY IN THE FILE THEY UPLOADED.
 *
 * `AgentSetupChecklist` says setup is one step — upload a CV — and it is right
 * that everything a FORM needs is lifted out of that file (see resumeContact).
 * But the very next thing the checklist asks for is "tell it what you're looking
 * for", and that is an empty text box on a page whose whole promise is that it
 * already read your CV. Somebody who has just handed over a document listing
 * "Product Manager" four times is being asked to type "Product Manager".
 *
 * THE RULE THIS FILE INHERITS from resumeContact.ts: it is better to propose
 * nothing than to propose something wrong. The difference is that nothing here
 * reaches an employer — a bad proposal costs a wrong search for one night, not
 * a false statement under somebody's name — so the bar is lower than that file's
 * and much higher than a generic keyword extractor's:
 *
 *   - Every proposed title is a substring of a line the CV actually contains,
 *     and the line is returned with it. The UI shows the evidence, because
 *     "we read this off your CV" is only trustworthy if you can see where.
 *   - Nothing is ever saved without the person pressing save. This produces a
 *     PRE-FILL, never a mandate. A search that runs tonight because we guessed
 *     is the agent doing something nobody asked for.
 *   - A category is proposed only when a title maps unambiguously. "Any field"
 *     is a perfectly good answer and a wrong category silently hides most of
 *     the board, which is the expensive failure here — invisible, and it looks
 *     like "there are no jobs".
 *
 * THE ONE DELIBERATE TRANSFORMATION, stated because it is not obvious: the
 * SENIORITY PREFIX IS STRIPPED. agent-runner matches `title ILIKE %term%`, so
 * a mandate of "Senior Product Manager" matches only postings whose title
 * contains that exact phrase and misses every "Product Manager (Senior)",
 * "Product Manager II" and "Lead Product Manager" on the board. Proposing the
 * core title is the difference between a search that works and one that returns
 * nothing on a corpus of half a million postings. It is stripped only when what
 * remains is still recognisably a role, and the original line is shown, so the
 * person can see what happened and put it back.
 */
import { adjacentRoles } from "@/lib/role-adjacency";
import { BOARD_CATEGORY_SLUGS, type BoardCategorySlug } from "@/lib/job-board-categories";

export type Proposal = {
  /** What would go into the mandate field. */
  value: string;
  /**
   * The line of the CV it came from, verbatim. Empty for `adjacent` titles,
   * which are suggestions ABOUT the CV rather than readings OF it — and the UI
   * must label those differently, because presenting a suggestion as a quote is
   * the same class of lie as a fabricated answer on a form.
   */
  evidence: string;
};

export type MandateProposal = {
  /** Roles read off the CV, most recent first. */
  titles: Proposal[];
  /**
   * Career-adjacent roles for the top title, from the curated map. NOT from the
   * CV — offered separately and labelled as such.
   */
  adjacent: string[];
  /** Places read off the header block. */
  locations: Proposal[];
  /** Only when a title maps unambiguously; otherwise null, meaning "any field". */
  category: { slug: BoardCategorySlug; evidence: string } | null;
};

export const EMPTY_PROPOSAL: MandateProposal = {
  titles: [], adjacent: [], locations: [], category: null,
};

/**
 * Words that make a line a job title rather than a bullet, a heading or a
 * company name. A line with none of these is never proposed, whatever else it
 * looks like — that single rule does most of the work here.
 *
 * `head`, `chief`, `vp` and `president` are included so "Head of Product" and
 * "VP of Engineering" survive; without them the most senior CVs propose nothing.
 */
const ROLE_NOUNS = [
  "engineer", "developer", "programmer", "architect", "scientist", "analyst",
  "manager", "director", "lead", "head", "chief", "vp", "president", "partner",
  "designer", "researcher", "consultant", "specialist", "coordinator",
  "administrator", "assistant", "associate", "executive", "officer",
  "representative", "strategist", "writer", "editor", "accountant",
  "controller", "supervisor", "technician", "nurse", "physician", "doctor",
  "therapist", "pharmacist", "teacher", "lecturer", "professor", "tutor",
  "paralegal", "solicitor", "attorney", "lawyer", "counsel", "recruiter",
  "buyer", "planner", "auditor", "actuary", "chef", "driver", "electrician",
  "plumber", "carpenter", "technologist", "operator", "advisor", "adviser",
  "agent", "clerk", "receptionist", "cashier", "bartender", "barista",
  "salesperson", "surveyor", "translator", "librarian", "curator", "producer",
  "marketer", "copywriter", "steward", "paramedic", "midwife", "dentist",
  "veterinarian", "psychologist", "economist", "statistician", "mathematician",
];
const ROLE_NOUN_RE = new RegExp(`(?:^|[^a-z])(?:${ROLE_NOUNS.join("|")})s?(?:[^a-z]|$)`, "i");

/**
 * Prefixes that describe a LEVEL rather than a job. Stripped only when the
 * remainder is still a role — "Director of Engineering" must not become
 * "Engineering", which is a department, not a search.
 */
const SENIORITY_RE =
  /^(?:senior|sr\.?|snr\.?|junior|jr\.?|lead|principal|staff|interim|acting|trainee|graduate|entry[- ]level|global|regional|group|deputy)\s+/i;

/** Section headings that sit directly above a title and are not one. */
const HEADINGS = new Set([
  "experience", "work experience", "professional experience", "employment",
  "employment history", "career history", "work history", "education",
  "skills", "summary", "profile", "objective", "projects", "certifications",
  "references", "interests", "achievements", "publications", "volunteering",
]);

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * One title maps to one category, and only where the mapping is not arguable.
 *
 * Order matters: the FIRST hit wins, so the more specific token has to come
 * first. "data engineer" must reach data_ai and not engineering, and it only
 * does because "data" is tested before "engineer".
 */
const CATEGORY_HINTS: ReadonlyArray<readonly [RegExp, BoardCategorySlug]> = [
  [/\b(?:data|machine learning|ml|ai|analytics|statistic)/i, "data_ai"],
  [/\b(?:security|infosec|cyber|penetration)/i, "security"],
  [/\b(?:designer|design|ux|ui)\b/i, "design"],
  [/\bproduct (?:manager|owner|lead|director)\b/i, "product"],
  [/\b(?:marketing|brand|growth|seo|content|copywriter)\b/i, "marketing"],
  [/\b(?:sales|account executive|business development|bdr|sdr)\b/i, "sales"],
  [/\b(?:customer|support|success|client services)\b/i, "customer"],
  [/\b(?:finance|financial|account(?:ant|ing)|audit|actuar|controller|treasur)/i, "finance"],
  [/\b(?:legal|lawyer|solicitor|attorney|paralegal|counsel)\b/i, "legal"],
  [/\b(?:hr|human resources|recruit|talent|people)\b/i, "people_hr"],
  [/\b(?:nurse|physician|doctor|clinical|medical|midwife|paramedic|pharmacist|dentist|therapist)\b/i, "healthcare"],
  [/\b(?:teacher|lecturer|professor|tutor|education|curriculum)\b/i, "education"],
  [/\b(?:research scientist|laboratory|biolog|chemist|physicist)\b/i, "science"],
  [/\b(?:chef|barista|bartender|retail|hospitality|waiter|steward)\b/i, "hospitality_retail"],
  [/\b(?:operations|supply chain|logistics|warehouse|manufacturing|procurement)\b/i, "operations"],
  [/\b(?:administrator|administrative|receptionist|office manager|clerk|secretary)\b/i, "admin"],
  // LAST, deliberately. "engineer" appears inside sales engineer, data engineer
  // and customer engineer, so it can only be trusted once every more specific
  // rule above has declined.
  [/\b(?:engineer|developer|programmer|architect|devops|sre)\b/i, "engineering"],
];

/**
 * Trim a raw CV line down to the title on it, or return null.
 *
 * CV title lines carry a lot of freight — "Senior Product Manager | Acme Ltd |
 * 2021–Present". Everything after the first separator is the employer or the
 * dates, never more of the title, so the first segment is taken and the rest
 * discarded rather than parsed.
 */
function titleFromLine(raw: string): string | null {
  let l = clean(raw);
  if (!l) return null;

  // Bullets are achievements, not titles: "• Led the migration of ..." would
  // otherwise pass every test below on the strength of the word "Led".
  if (/^[-•*·▪]/.test(l)) return null;

  l = l.replace(/^[\d.)\s]+/, "");                       // "1. " list numbering
  // Cut at the first separator, and at " at " / " @ " which introduce employers.
  l = l.split(/\s*[|/•·—–]\s*|\s+@\s+|\s+\bat\b\s+/i)[0] ?? "";
  l = l.split(",")[0] ?? "";                              // "Product Manager, Payments"
  // Dates in any of the shapes CVs use, plus anything after them.
  l = l.replace(/\(?\b(?:19|20)\d{2}\b.*$/, "");
  l = l.replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:19|20)?\d{2}.*$/i, "");
  l = clean(l).replace(/[–—:;.\s]+$/, "");

  if (l.length < 3 || l.length > 60) return null;
  if (HEADINGS.has(l.toLowerCase())) return null;
  const words = l.split(" ");
  if (words.length > 7) return null;                      // a sentence, not a title
  if (!ROLE_NOUN_RE.test(l)) return null;
  // A line that is mostly digits or symbols is a date range or an address.
  if ((l.replace(/[^A-Za-z ]/g, "").length / l.length) < 0.7) return null;
  return l;
}

/** "Senior Product Manager" -> "Product Manager". Refuses when it would gut the title. */
function stripSeniority(title: string): string {
  const stripped = clean(title.replace(SENIORITY_RE, ""));
  if (stripped.length < 3) return title;
  if (!ROLE_NOUN_RE.test(stripped)) return title;         // "Director of Engineering"
  return stripped;
}

/**
 * Two-letter US state codes, so "Austin, TX" is recognised as a place and
 * "Design, UX" is not. Kept explicit rather than matching /[A-Z]{2}/, which
 * would read "Marketing, EU" and "Engineering, AI" as locations.
 */
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);
const COUNTRY_WORDS = new Set([
  "uk", "u.k.", "usa", "u.s.a.", "us", "u.s.", "england", "scotland", "wales",
  "ireland", "canada", "australia", "germany", "france", "spain", "italy",
  "netherlands", "sweden", "norway", "denmark", "finland", "poland", "portugal",
  "india", "singapore", "japan", "brazil", "mexico", "switzerland", "belgium",
  "austria", "new zealand", "south africa", "uae", "united kingdom",
  "united states", "czechia", "romania", "greece", "türkiye", "turkey",
]);

/** How many leading non-empty lines count as the header — same rule as resumeContact. */
const HEADER_LINES = 12;

/**
 * A place, from the header block ONLY.
 *
 * The body of a CV is full of employer locations, university towns and
 * conference cities. Proposing one of those as where somebody wants to work is
 * the location equivalent of listing a former employer's website as your own,
 * which is exactly why resumeContact restricts its reads the same way.
 *
 * Only the CITY is proposed. The mandate matches `location ILIKE %term%`, so
 * "London" hits every London posting while "London, UK" hits only postings
 * whose location string happens to carry the country too — and a comma inside
 * the value would be re-read as the multi-term separator anyway.
 */
function findLocations(text: string): Proposal[] {
  const out: Proposal[] = [];
  const seen = new Set<string>();
  const header = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, HEADER_LINES);

  for (const line of header) {
    if (/@/.test(line)) {
      // A contact line can still carry a place — "jane@x.com · Leeds, UK" — so
      // it is not skipped, but the email itself must not be mined for one.
    }
    for (const m of line.matchAll(/([A-Z][A-Za-z.'’-]+(?:[ -][A-Z][A-Za-z.'’-]+){0,2})\s*,\s*([A-Za-z.][A-Za-z. ]{1,20})/g)) {
      const city = clean(m[1] ?? "");
      const region = clean(m[2] ?? "");
      const isPlace = US_STATES.has(region.toUpperCase().replace(/\./g, "")) ||
        COUNTRY_WORDS.has(region.toLowerCase());
      if (!isPlace) continue;
      if (city.length < 3 || city.length > 30) continue;
      const key = city.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: city, evidence: clean(line) });
      if (out.length >= 2) return out;
    }
  }

  // "Remote" in the header is a statement about how they want to work, and it
  // is the one location term that is never a city — so it is only taken from
  // the header, where it can only be about the candidate.
  if (out.length === 0) {
    const remote = header.find((l) => /\bremote\b/i.test(l) && l.length <= 80);
    if (remote) out.push({ value: "Remote", evidence: clean(remote) });
  }
  return out;
}

function categoryFor(title: string): BoardCategorySlug | null {
  for (const [re, slug] of CATEGORY_HINTS) {
    if (re.test(title)) return slug;
  }
  return null;
}

/**
 * Read a mandate proposal out of résumé text.
 *
 * Never throws. Unreadable input yields EMPTY_PROPOSAL, which the UI renders as
 * the blank form it has always shown — a proposal is an accelerator, and a
 * feature that fails closed to the previous behaviour is the only kind worth
 * putting in front of somebody's job hunt.
 */
export function proposeMandate(resumeText: string | null | undefined): MandateProposal {
  const text = String(resumeText ?? "");
  if (text.trim().length < 100) return EMPTY_PROPOSAL;

  const lines = text.split(/\r?\n/);
  const titles: Proposal[] = [];
  const seen = new Set<string>();

  // Document order. CVs are reverse-chronological, so the first title found is
  // the most recent role — which is the one to lead with, though it is a
  // convention rather than a guarantee, which is why all three are offered and
  // none is imposed.
  for (const line of lines) {
    const raw = titleFromLine(line);
    if (!raw) continue;
    const value = stripSeniority(raw);
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push({ value, evidence: clean(line).slice(0, 120) });
    if (titles.length >= 3) break;
  }

  const top = titles[0]?.value ?? "";
  const category = (() => {
    // Read from the first title that maps at all, not only the top one: a CV
    // whose most recent line is "Consultant" and whose next is "Data Analyst"
    // has an answer, and taking only the top would throw it away.
    for (const p of titles) {
      const slug = categoryFor(p.value);
      if (slug) return { slug, evidence: p.evidence };
    }
    return null;
  })();

  return {
    titles,
    adjacent: top ? adjacentRoles(top, 3) : [],
    locations: findLocations(text),
    category,
  };
}

/** The comma-joined value the mandate field takes, from a set of chosen terms. */
export function toMandateField(terms: string[]): string {
  // Commas are the separator, so one inside a term would silently widen the
  // search — the same reason agent-runner's splitTerms strips them rather than
  // escaping them. Stripped here too so the field never contains a value the
  // runner would read differently from the way it was shown.
  return terms
    .map((t) => t.replace(/[,()*]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12)
    .join(", ");
}

/** Every category slug this file can propose is one the board actually serves. */
export const PROPOSABLE_CATEGORIES: readonly BoardCategorySlug[] =
  CATEGORY_HINTS.map(([, slug]) => slug).filter(
    (slug, i, all) => all.indexOf(slug) === i && (BOARD_CATEGORY_SLUGS as readonly string[]).includes(slug),
  );
