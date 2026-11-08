/**
 * THE OWNER'S STOP SWITCH FOR GOOGLE FOR JOBS (owner decision 2026-11-07,
 * option A; SEO/GEO audit 2026-11-07, B01).
 *
 * The site keeps JobPosting markup on its posting pages while the share of
 * baked postings their employers have already closed stays small. The bake
 * reads each posting's employer endpoint with GET requests and retires one the
 * employer closed (scripts/employer-reads.mjs), and a daily GET-only check
 * measures the closed share of the live posting pages
 * (scripts/posting-closure-check.mjs, .github/workflows/posting-closure.yml).
 *
 * THE RULE, in the owner's words made exact: "twice" is two consecutive daily
 * checks whose closed share is over 5% (counting only postings with a definite
 * employer answer, and only when no more than 20% of the answers are unknown),
 * or any manual action from Google. Then this switch is set to false and
 * committed, and the next publish turns every JobPosting block off at once:
 * the static file the bake writes, the React posting page and the board's
 * detail pane all ask postingJsonLd, which answers null while this is false.
 * The pages, their titles and their indexing stay exactly as they are.
 *
 * Static hosting cannot change a served file between publishes, so the switch
 * takes effect when someone publishes. The daily check names the day it fired.
 */
export const JOB_POSTING_MARKUP = true;
