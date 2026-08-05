/**
 * WHY A FORM FILL FAILED, IN A SHAPE SOMETHING CAN COUNT.
 *
 * Every refusal in apply.ts already carries a good sentence. All seventeen of
 * them then land in the same place — `blockers: [{ kind: "worker", detail }]` —
 * one kind for every cause, and free text underneath it. That is the exact
 * defect this codebase has fixed in five other places: one value standing for
 * many states, so nothing downstream can tell them apart.
 *
 * The consequence is the one `agent_confirmation_gaps` was built to end. When
 * 19 of 60 attempted fills refuse, the sentence that would tell you WHICH
 * nineteen is sitting in a jsonb column nobody aggregates, and the field maps
 * and label patterns that caused them stay guesses. `confirmed.ts` says it
 * outright: "EVERY PHRASE HERE IS A GUESS". So does `match.ts`'s label
 * matching. The fix that worked for confirmations was not a cleverer guess, it
 * was making the failures name themselves — this is the same move applied to
 * the other half of the run.
 *
 * WHAT MAKES IT SAFE TO AGGREGATE, which is the whole design constraint.
 * `agent_confirmation_gaps` is readable without a session because its
 * projection provably carries no user, no posting and no URL. This has to clear
 * the same bar, and it clears it EARLIER — the worker decides here what may be
 * published, rather than a SQL function trying to strip a free-text sentence
 * after the fact. Three rules, and rule 3 is the one that matters:
 *
 *   1. `stage` is drawn from a closed list. It cannot carry surprise text.
 *   2. `wording` is the EMPLOYER'S question label or OUR OWN field keys —
 *      public form text either way, exactly like a confirmation page's words.
 *   3. A refusal whose text we do not fully control emits NO wording at all.
 *      `driver error: ...` is arbitrary exception text and can contain a URL or
 *      the staged résumé's filename, which is the candidate's own name on most
 *      CVs. It is counted and never quoted. So is anything unrecognised: an
 *      allow-list, because the default of a deny-list is to publish.
 */

/**
 * The closed list. Derived from the return sites in apply.ts, one stage per
 * distinct cause rather than per sentence — two sentences describing the same
 * failure should aggregate together, or the counts are wrong in the direction
 * that hides a pattern.
 */
export type RefusalStage =
  | "vendor-not-drivable"     // no adapter, or a vendor we refuse on principle
  | "form-not-found"          // the apply URL did not resolve to a form
  | "posting-closed"
  | "captcha"                 // on a vendor measured clean — worth knowing about
  | "resume-missing"          // the form wants a CV and the profile has none
  | "resume-attach-failed"    // setFile did not throw and the file is not there
  | "questions-unreadable"    // enumerateQuestions returned null
  | "no-standing-answers"     // questions asked, nothing on file to answer with
  | "question-unanswerable"   // THE ONE THAT MATTERS: a question we cannot answer
  | "control-refused"         // we had an answer; the control would not take it
  | "partial-fill"            // too few mapped fields placed to submit honestly
  | "required-empty"          // the vendor's own required attribute says no
  | "step-stuck"              // no way forward found on a multi-step form
  | "max-steps"               // still unfinished after the step ceiling
  | "submit-not-taken"        // clicked, and the form is still showing
  | "driver-error"            // an exception; never quoted
  | "submit-uncertain"        // reaches agent_mark_uncertain today; see below
  | "unclassified";           // a sentence this file has not learned yet

export interface RefusalFacts {
  stage: RefusalStage;
  /**
   * Employer form text or our own field keys, or "" when nothing may be
   * published. Never a URL, never anything the candidate typed.
   */
  wording: string;
}

/** What apply.ts hands back alongside a question refusal. */
export interface BlockedLike {
  label?: string;
  category?: string;
}

const MAX_WORDING = 200;

/**
 * Last line of defence on anything about to be published.
 *
 * Everything reaching this should already be employer text by construction. It
 * is scrubbed anyway, because "should already be" is the assumption that put a
 * candidate's apply URL in a public projection in the first place — and the
 * cost of a redundant scrub is nothing next to the cost of being wrong once.
 */
export function scrubWording(raw: string): string {
  return String(raw ?? "")
    .replace(/https?:\/\/\S+/gi, " ")                          // any URL
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, " ")      // any email
    .replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, " ")             // any phone
    .replace(/[/\\][^\s]*\.(?:pdf|docx?|txt|rtf|pages)\b/gi, " ") // any file path
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_WORDING);
}

/** `could not answer "Are you an Internal Applicant?": …` -> the label. */
const QUOTED = /could not answer\s+"([^"]{1,200})"/i;
/** `only placed 3/6 fields (missing: email, phone) — …` -> the keys. */
const MISSING = /\(missing:\s*([^)]{1,200})\)/i;

/**
 * Read a refusal into something countable.
 *
 * `blocked` is preferred over the sentence wherever it exists: apply.ts builds
 * the sentence by truncating the same list to three entries and flattening it
 * to prose, so parsing the prose back out would be reconstructing a lossy copy
 * of a structure that is right there.
 */
export function classifyRefusal(reason: string, blocked?: BlockedLike[]): RefusalFacts {
  const r = String(reason ?? "");
  const say = (stage: RefusalStage, wording = ""): RefusalFacts =>
    ({ stage, wording: scrubWording(wording) });

  // ORDER IS LOAD-BEARING in two places. `driver error:` is first because an
  // exception message can contain any of the phrases below — a Playwright
  // timeout quoting the page would otherwise be filed as whatever it quoted,
  // and filed WITH its text, which is precisely the case that must never quote.
  if (/^driver error:/i.test(r)) return say("driver-error");

  // THE TWO SENTENCES THAT DO NOT COME HERE TODAY, handled anyway.
  //
  // An `uncertain` outcome goes to agent_mark_uncertain, which parks the row —
  // it never reaches refusalBlocker. But both sentences carry the landing URL
  // and the page's own text, so if a future refactor ever routes them through
  // here, "unclassified" would be right about the stage and the wording would
  // still be empty only by luck. Named explicitly so the answer does not depend
  // on which branch of the ladder they happen to miss.
  if (/no confirmation recognised after submit|the page never settled/i.test(r)) {
    return say("submit-uncertain");
  }

  if (/has no adapter|no recon has been done/i.test(r)) return say("vendor-not-drivable");
  if (/could not find the application form/i.test(r)) return say("form-not-found");
  if (/posting is closed/i.test(r)) return say("posting-closed");
  if (/captcha appeared/i.test(r)) return say("captcha");
  if (/r[ée]sum[ée] did not attach/i.test(r)) return say("resume-attach-failed");
  if (/wants a r[ée]sum[ée] and none is attached/i.test(r)) return say("resume-missing");
  if (/could not read this form's questions/i.test(r)) return say("questions-unreadable");
  if (/no standing answers are on file/i.test(r)) return say("no-standing-answers");

  // The two stages that carry evidence, and the reason this file exists.
  if (/required question\(s\) the agent cannot answer/i.test(r)) {
    // The labels are the harvest. A category alone ("identity-document") says
    // the refusal was correct and nothing about which question caused it, and
    // it is the LABEL that a pattern has to be written against.
    const labels = (blocked ?? [])
      .map((b) => String(b?.label ?? "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ");
    if (labels) return say("question-unanswerable", labels);
    // No structured list — fall back to the CATEGORIES in the sentence, which
    // apply.ts formats as `category: why`. Never the whole sentence: `why` is
    // written by the matcher and is not text this file controls.
    const cats = [...r.matchAll(/(?:—|;)\s*([a-z][a-z-]{2,40}):/g)].map((m) => m[1]);
    return say("question-unanswerable", cats.length ? `categories: ${[...new Set(cats)].join(", ")}` : "");
  }
  if (QUOTED.test(r)) return say("control-refused", r.match(QUOTED)![1] ?? "");

  if (/refusing to submit a partial application/i.test(r)) {
    const m = r.match(MISSING);
    return say("partial-fill", m ? `missing: ${m[1]}` : "");
  }
  if (/required field\(s\) the packet could not answer/i.test(r)) return say("required-empty");
  if (/^stopped at step/i.test(r)) return say("step-stuck");
  if (/still unfinished after/i.test(r)) return say("max-steps");
  if (/submit did not take/i.test(r)) return say("submit-not-taken");

  // A vendor's own blocked-reason string, which is written by us in
  // vendors/index.ts. Checked LAST because it is the loosest test here.
  if (/^[a-z0-9_-]+:\s/.test(r)) return say("vendor-not-drivable");

  // ALLOW-LIST, NOT DENY-LIST. An unrecognised sentence is counted and never
  // quoted, so adding a new refusal to apply.ts can cost us a blind spot in the
  // aggregate but can never leak text through a rule nobody updated.
  return say("unclassified");
}

/**
 * The blocker row the worker writes.
 *
 * `kind` stays "worker" and `detail` stays the full sentence: packetState reads
 * kind, ApplyQueuePanel renders detail to the candidate, and both are correct
 * as they are. This is strictly additive — the new fields are for the aggregate,
 * and the candidate's own view of their own row is unchanged.
 */
export function refusalBlocker(
  reason: string,
  source: string,
  blocked?: BlockedLike[],
): { kind: "worker"; detail: string; stage: RefusalStage; wording: string; source: string } {
  const facts = classifyRefusal(reason, blocked);
  return {
    kind: "worker",
    detail: reason,
    stage: facts.stage,
    wording: facts.wording,
    // The vendor, which is a fact about a public ATS and not about anybody.
    // Without it the aggregate says a label pattern is failing and not where,
    // and every adapter's field map is vendor-specific.
    source: String(source ?? "").toLowerCase().slice(0, 40),
  };
}
