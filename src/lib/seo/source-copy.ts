/**
 * WHAT THE BOARD MAY SAY ABOUT WHERE A POSTING CAME FROM (R5, R6, SEO-008).
 *
 * Every posting page and the bake said the role came "never [from] an
 * aggregator, never a repost", and /jobs and the field pages said "No
 * aggregators" — while the same board carries the federal listing site,
 * staffing agencies' boards (labeled as such) and a caution when an employer
 * re-posts a role. And 1,002 baked company pages and the posting page said
 * "the board re-checks a posting when you open it" with no condition, when
 * the live board asks the employer's system again only on opening a posting
 * whose feed was last read more than VERIFY_ON_VIEW_AFTER_HOURS ago (and the
 * standalone posting page asks nothing).
 *
 * The true sentences live in the main locale (boardSource.*,
 * jobPostingPage.sourceNote, jobsPage.subtitle), which the bake reads too;
 * this module holds the one number they name and the phrases no rendered
 * page may print (seo-react-source-claims-are-true.test.tsx).
 */

/** The live board re-checks a posting it opens only when our last read of its feed is older than this. */
export const VERIFY_ON_VIEW_AFTER_HOURS = 6;

/** Claims the board cannot stand behind, in any rendered page or crawler copy. */
export const BANNED_SOURCE_CLAIMS: readonly RegExp[] = [
  /never an aggregator/i,
  /\bno aggregators?\b/i,
  /never a repost/i,
  /re-?checks a posting when you open it/i,
  /\bverified openings\b/i,
  // B09 / GEO-1107-04: a takedown is logged when a later read of the feed
  // finds the posting gone, never at the instant it happens; and a takedown
  // is never called a fill or a hire.
  /\bthe moment (?:a|an|the) (?:company|employer)s? (?:takes|took|removes|pulls)\b/i,
  /\bthe moment (?:a|an|the) (?:posting|role|job) (?:comes|came|goes|went) down\b/i,
  /\b(?:actually|truly) (?:fill|fills|filled) (?:roles|the role|positions)\b/i,
  /\broles are actually filled\b/i,
];
