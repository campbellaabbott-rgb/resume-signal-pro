// THE RÉSUMÉS THE FIT PATH IS PROVED WITH — one copy, read by two harnesses.
//
// scripts/fit-path-probe.mjs sends these to the DEPLOYED extractor and scorer
// (job-fit, live) and src/test/a-probe-that-scored-the-copy-the-site-no-longer-
// calls.test.ts runs them through the LOCAL fit-score.ts. The same bytes on
// both sides is what makes "the deployed extractor answers what the source
// says it should" a measurement: a fixture that drifted between the two files
// would let the probe pass on a rule the repo no longer carries, or fail on
// one it does.
//
// Each fixture is long enough (300+ chars) that the headline window —
// max(400 chars, 20% of the document) — is a real window and not the whole
// document; a fixture short enough to be all headline silently disables the
// rule that stops a body mention from outranking the title line.

/**
 * A title the vocabulary CARRIES ("chief of staff" is in TITLE_VOCAB), on the
 * second headline line, and stated once more in the employment history. The
 * body is deliberately free of any other vocabulary title: the check is that
 * the extractor reads the headline, not that it wins a contest.
 */
export const CHIEF_OF_STAFF = `Sam Rivera
Chief of Staff
Portland, OR — sam.rivera@example.com

Chief of Staff, Northwind Robotics 2021-2026. Ran the CEO's operating cadence: weekly leadership agenda, quarterly planning, board materials, and the annual budget cycle. Owned OKR rollout across four departments and the hiring plan for 60 new roles. Stood up the company's first all-hands and internal communications rhythm.
Strategy and Operations, Northwind Robotics 2019-2021. Cross-functional planning, vendor negotiations, and the metrics pack the executive team reads every Monday.
SKILLS: strategic planning, OKRs, budgeting, board communications, stakeholder management, cross-functional leadership, executive communications
BA Economics, Reed College 2018.`;

/**
 * A title the vocabulary does NOT carry as a phrase. "reporter" is a standalone
 * title with zero compounds built on it, so a modifier in front of it names an
 * occupation the dictionary does not model, and the headline rule coins the
 * two-word phrase — but only because it appears again in the history. The
 * expected answer is the coined phrase FIRST and the bare vocabulary word
 * SECOND: the guess leads, the fallback chip follows.
 */
export const COURT_REPORTER = `Helen Marsh, RPR — Court Reporter
Sacramento, CA — helen.marsh@example.com

Court Reporter, Freelance 2014-2026. Verbatim stenographic record of depositions, arbitrations and hearings for civil litigation firms across Northern California; certified transcripts delivered within statutory deadlines; realtime feeds for counsel on request.
Deposition Officer, Capitol Legal Services 2011-2014. Scheduling, exhibit handling, transcript production and certification.
SKILLS: CAT software (Eclipse), realtime writing at 225 wpm, transcript proofreading, legal terminology, medical terminology, exhibit management
Registered Professional Reporter (NCRA). California CSR license 2011.`;

/** The first two terms the extractor must answer for COURT_REPORTER, in order. */
export const COURT_REPORTER_EXPECTED = ["court reporter", "reporter"];

/**
 * A two-year software résumé for the reach check. Its only date range is
 * 2024-2026, so resumeYears reads 2; the SAME text with one more line carrying
 * "2010-2026" reads 16, and nothing else about the document changes — no
 * dictionary term is added, because a year range is not a term. Against a
 * posting that states a minimum of eight years, the two-year copy is short by
 * 8 - 2 - REACH_MARGIN(3) = 3, so its keyword score is multiplied by 0.54; the
 * sixteen-year copy keeps the whole score.
 */
export const TWO_YEAR_ENGINEER = `Priya Shah - Software Engineer, Austin TX
Software Engineer, Cloudline 2024-2026. Backend services in TypeScript and Go; REST and GraphQL APIs; PostgreSQL schema design; Kubernetes deployments on AWS; CI/CD pipelines; on-call rotation; code review.
SKILLS: TypeScript, Go, Python, React, Node.js, PostgreSQL, Redis, Kubernetes, Docker, AWS, Terraform, distributed systems, microservices, API design, unit testing, agile, git
BS Computer Science, University of Texas at Austin 2024`;

/** The one line that turns two years into sixteen and changes nothing else. */
export const SENIOR_RANGE_LINE = "\nSoftware Engineer, earlier roles 2010-2026.";

export const SIXTEEN_YEAR_ENGINEER = TWO_YEAR_ENGINEER + SENIOR_RANGE_LINE;

/** What the reach check needs from a listed row before it can use it. */
export const REACH_MIN_YEARS = 8;
