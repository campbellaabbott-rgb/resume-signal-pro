/**
 * A LINK IS NOT A JOB DESCRIPTION (sweep S11-032): the browser's copy of
 * supabase/functions/_shared/job-description-input.ts, the rule the scan
 * servers apply. The scanner checks with it before sending, so a pasted link
 * is never sent as the posting the scan scores against; the servers ignore
 * one anyway. src/test/a-link-is-not-a-job-description.test.ts walks both
 * copies over the same inputs.
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

/** Does this look like a link someone pasted, rather than text? */
export function looksLikeLink(raw: string): boolean {
  const s = raw.trim();
  return /^(?:https?:\/\/|www\.)\S+$/i.test(s) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$/i.test(s);
}
