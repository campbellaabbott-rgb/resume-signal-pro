/**
 * THE SENTENCES "EMAIL MY REPORT" SENDS ARE THE MAIL COPY, NOT THE PAGE'S
 * (recheck 3 of wave 4, 2026-10-26; S12-068).
 *
 * The free scanner seals the sentences a report mail may print, after taking
 * out any quoted résumé line and any run of digits someone could dial
 * (supabase/functions/free-keyword-scan/seal-safe.ts). That scrub used to run
 * on the report itself, so the page's red flags and fix steps lost every
 * bullet they quoted ("bullets like read as duties"). The page now shows its
 * sentences whole, as main does, and the scanner returns the scrubbed copy
 * beside them in reportMeta.mailSentences. This puts that copy where
 * send-scan-report reads the sentences: the first three issues, the first
 * eight steps and the occupation, the exact span the seal covers. A report
 * without the copy (one made before this build) sends its own sentences, and
 * the mailer prints them only if they match the seal.
 */

export type MailSentences = { issues: string[]; steps: string[]; occupation: string };

type Payload = {
  redFlags: Array<{ issue: string }>;
  fixRoadmap: { steps: Array<{ step: string }> } | null;
  keywordSource?: { occupation?: string } | null;
};

const isCopy = (m: unknown): m is MailSentences => {
  const c = m as MailSentences | null;
  return !!c && Array.isArray(c.issues) && Array.isArray(c.steps) && typeof c.occupation === "string"
    && c.issues.every((x) => typeof x === "string") && c.steps.every((x) => typeof x === "string");
};

/** The payload with the mail copy's sentences in the sealed span, or unchanged when there is no copy. */
export function withMailSentences<P extends Payload>(payload: P, mail: MailSentences | null | undefined): P {
  if (!isCopy(mail)) return payload;
  const fr = payload.fixRoadmap;
  return {
    ...payload,
    redFlags: payload.redFlags.map((f, i) => (i < mail.issues.length ? { ...f, issue: mail.issues[i] } : f)),
    fixRoadmap: fr ? { ...fr, steps: fr.steps.map((s, i) => (i < mail.steps.length ? { ...s, step: mail.steps[i] } : s)) } : fr,
    keywordSource: payload.keywordSource ? { ...payload.keywordSource, occupation: mail.occupation } : payload.keywordSource,
  };
}
