/**
 * Why the agent did not send this one — in the candidate's language.
 *
 * THE GAP THIS CLOSES, measured 2026-08-02. `decideRelease` produces ten
 * distinct refusal codes, each with a written human reason, and apply-agent
 * stores the code on every packet in `agent_submissions.release_refusal`.
 * ApplyQueuePanel reads that exact table — and never selected the column. So a
 * packet held back because our sender was offline, one held back because the
 * fit was under the candidate's own floor, and one held back because they had
 * already applied all rendered as the identical grey "blocked" row.
 *
 * That is the same failure that has run through this whole system: a state that
 * was carefully computed and then displayed as silence. Worse here than
 * elsewhere, because the person is waiting on it and the obvious reading of
 * "nothing happened" is "this product does not work".
 *
 * THE SEVERITY AXIS IS THE POINT, not decoration. Four of these ten are not
 * problems at all — `already-submitted` and `duplicate` are the dedupe guard
 * doing precisely its job, and telling someone that looks like a fault would
 * teach them to distrust a correct refusal. Two are OUR fault and must say so
 * rather than implying the candidate forgot something. Only three are actually
 * theirs to fix, and those are the ones that get an action.
 *
 * A panel that shouts about all ten equally is no more useful than one that
 * shows none of them.
 */

export type RefusalCode =
  | "review-mode"
  | "not-ready"
  | "vendor-not-allowed"
  | "vendor-needs-human"
  | "daily-cap"
  | "already-submitted"
  | "duplicate"
  | "fit-below-floor"
  | "fit-unknown"
  | "sender-offline"
  | "held-for-review"
  | "cancelled-by-you";

export type RefusalSeverity =
  /** The candidate can clear it, and it is worth clearing. */
  | "needs-you"
  /** Ours. Nothing for them to do; saying otherwise would be dishonest. */
  | "on-us"
  /** Working exactly as configured. Informational, never alarming. */
  | "by-design";

/** Where the fix lives, so the UI can offer one rather than describe a problem. */
export type RefusalFix = "profile" | "mode" | "sources" | "fit-floor" | "cap" | null;

export type RefusalFace = {
  code: RefusalCode;
  severity: RefusalSeverity;
  /** i18n key + English fallback, matching this codebase's t(key, fallback). */
  key: string;
  fallback: string;
  fix: RefusalFix;
};

const F = (
  code: RefusalCode, severity: RefusalSeverity, fallback: string, fix: RefusalFix = null,
): RefusalFace => ({ code, severity, key: `applyRefusal.${code}`, fallback, fix });

const FACES: Record<RefusalCode, RefusalFace> = {
  // --- ours ---------------------------------------------------------------
  "sender-offline": F(
    "sender-offline", "on-us",
    "Our sender is offline, so nothing went out. This is queued and goes as soon as it is back — you do not need to do anything.",
  ),

  // NOT a fault and NOT something to fix — the on-ramp is the product being
  // careful on purpose, and phrasing it as a problem would teach a new
  // subscriber to distrust the thing that is protecting them.
  "held-for-review": F(
    "held-for-review", "by-design",
    "Your first few go out with your approval so you can see exactly what we send. Approve it and it goes straight away.",
  ),
  // Their own act. Reported back plainly so the row does not look like a
  // failure they need to investigate.
  "cancelled-by-you": F(
    "cancelled-by-you", "by-design",
    "You cancelled this one before it went out. Nothing was sent.",
  ),
  "fit-unknown": F(
    "fit-unknown", "on-us",
    "We could not score this one against your résumé, so we did not send it unattended. You can still send it yourself.",
  ),

  // --- theirs to clear ----------------------------------------------------
  "not-ready": F(
    "not-ready", "needs-you",
    "This employer asks something we will not answer for you. Open it and fill the gaps.",
    "profile",
  ),
  "review-mode": F(
    "review-mode", "needs-you",
    "Ready and waiting for you to press send — your agent is in review mode, so it never sends on its own.",
    "mode",
  ),
  "vendor-not-allowed": F(
    "vendor-not-allowed", "needs-you",
    "You have not switched on unattended applying for this job site.",
    "sources",
  ),

  // --- working as configured ----------------------------------------------
  "already-submitted": F(
    "already-submitted", "by-design",
    "Already sent. We never send the same application twice.",
  ),
  "duplicate": F(
    "duplicate", "by-design",
    "You have already applied to this posting, so we left it alone.",
  ),
  "fit-below-floor": F(
    "fit-below-floor", "by-design",
    "Below the fit floor you set. Lower the floor if you want borderline roles sent too.",
    "fit-floor",
  ),
  "daily-cap": F(
    "daily-cap", "by-design",
    "Today's limit is used up. This goes out tomorrow, or raise your daily cap.",
    "cap",
  ),
  "vendor-needs-human": F(
    "vendor-needs-human", "by-design",
    "This job site needs a step only a person can do — usually a checkbox we will not tick on your behalf.",
  ),
};

/**
 * NO REFUSAL AND AN UNRECOGNISED REFUSAL ARE DIFFERENT ANSWERS.
 *
 * A new refusal code shipped in an edge function reaches production before any
 * frontend that knows about it — the two deploy separately, routinely. This used
 * to return null for both cases, and the queue renders null as NOTHING: the
 * packet sat there refused, with no reason on screen at all.
 *
 * That is the silent no this whole file exists to abolish. The header of
 * apply-release says it in as many words — "a silent no is indistinguishable
 * from a broken cron" — and the unknown branch was quietly reintroducing it.
 * The comment here even claimed "the caller falls back to the plain status";
 * the caller fell back to blank space.
 *
 * So an unrecognised code now gets a face that says exactly that. Note this is
 * NOT the guess the old comment rightly refused: inventing "your fit was too
 * low" for an unknown code states a false reason, whereas naming the code and
 * admitting we cannot describe it states a true one. Severity is `on-us`,
 * because a reason we cannot render is our gap and never the candidate's.
 */
export function refusalFace(code: string | null | undefined): RefusalFace | null {
  // Genuinely nothing to report. Not a refusal, so not a message.
  if (!code || !String(code).trim()) return null;
  const known = FACES[code as RefusalCode];
  if (known) return known;
  return {
    code: code as RefusalCode,
    severity: "on-us",
    // Keyed on the literal code so translators can add one later without a
    // code change, and so two different unknown codes never share a message.
    key: `applyRefusal.${code}`,
    fallback:
      `Not sent, and we cannot describe why yet — the reason our agent recorded ("${code}") ` +
      `is newer than this page. Nothing was sent, and this is our gap to close, not yours.`,
    fix: null,
  };
}

/** Every code, for tests and for the settings-page legend. */
export const ALL_REFUSAL_CODES = Object.keys(FACES) as RefusalCode[];

/**
 * Does this queue warrant a nudge at the top of the panel?
 *
 * Only "needs-you" counts. A queue that is entirely dedupe guards and fit-floor
 * skips is a HEALTHY queue, and badging it would train people to ignore the
 * badge by the time something genuinely needed them.
 */
export function actionableCount(codes: Array<string | null | undefined>): number {
  return codes.reduce<number>((n, c) => n + (refusalFace(c)?.severity === "needs-you" ? 1 : 0), 0);
}
