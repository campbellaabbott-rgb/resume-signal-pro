/**
 * A LINK IS NOT A JOB DESCRIPTION (sweep S11-032, owner decision 2026-10-11:
 * "the server ignores a URL-only JD").
 *
 * The scanner's "Job URL" tab sent "[Job URL: <link>]" as the job
 * description: 57-99 characters, so the free scan (which reads anything over
 * 50 characters as a posting) asked the model for a Job Match Score against a
 * link, and the $5 analysis framed its whole report around one. The tab now
 * fetches the posting (fetch-job-posting), but a browser still running the
 * old bundle, or anyone calling the functions directly, can send the old
 * shape. So every function that scores against a posting reads it through
 * this: the old wrapper is dropped, and what is left is no posting at all
 * when it is links and fewer than URL_ONLY_MAX_LETTERS letters of anything
 * else. Text with no link in it is returned as it came.
 *
 * Mirrored for the browser in src/lib/job-description-input.ts; a test
 * walks both over the same inputs.
 */

/** A link plus fewer letters than this is a link, not a description. */
export const URL_ONLY_MAX_LETTERS = 30;

const WRAPPER = /\[Job URL:[^\]\n]*\]/gi;
const LINK = String.raw`(?:\bhttps?:\/\/|\bwww\.)\S+`;

/** The job description a scan may score against: "" for a link, the text otherwise. */
export function scannableJobDescription(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const unwrapped = raw.replace(WRAPPER, " ").trim();
  const wrapped = unwrapped !== raw.trim();
  if (!wrapped && !new RegExp(LINK, "i").test(unwrapped)) return raw;
  const letters = (unwrapped.replace(new RegExp(LINK, "gi"), " ").match(/\p{L}/gu) ?? []).length;
  return letters < URL_ONLY_MAX_LETTERS ? "" : unwrapped;
}
