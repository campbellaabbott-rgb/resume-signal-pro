// APPLY YOURSELF, THROUGH YOUR OWN AI: WHAT apply_myself ANSWERS.
//
// Owner decision 2026-10-11 (the apply pivot): the server-side apply agent is
// switched off, and the only apply path is the person's own AI helping them
// fill in the employer's own form. We never submit anything. This module turns
// one posting and its form read (_shared/application-form.ts) into the answer
// the tool returns (spec §5.1), and into the markdown packet a person can work
// from when their AI has no browser.
//
// The form is DATA: every label is the employer's text, cleaned of markup and
// passed through, and every question carries who answers it
// (_shared/self-apply.ts, default-deny: a question is marked for the AI only
// when it reads as about work done or one of a short list of motivation
// questions; every other question is marked for the person. The marking reads
// words, so it can mark a question about the person, even a plainly worded
// one, for the AI, and the packet says so under the drafting heading). The rules the AI follows live in the server instructions,
// the tool description and the apply_myself prompt, never in this result.
//
// Pure: the caller hands in the posting, the read and the route, so the Node
// suite runs it on recorded forms.

import type { FormRead } from "../_shared/application-form.ts";
import { selfApplyRoute, whoAnswersEach, type SelfApplyQuestion, type SelfApplyRoute } from "../_shared/self-apply.ts";

/** The posting as the board served it, reduced to what the answer prints. */
export type ApplyPosting = {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  pay: string | null;
  postedAt: string | null;
  applyUrl: string | null;
  siteUrl: string;
};

export type FormSource = "employer-published" | "not-published" | "not-read-on-this-surface" | "unreachable";

export type ApplyMyselfAnswer = ApplyPosting & {
  jobId: string;
  state: "open";
  form: {
    source: FormSource;
    vendor: string;
    readAt: string | null;
    questions: SelfApplyQuestion[];
    documents: { name: string; required: boolean }[];
    alsoOnForm: string[];
    note?: string;
  };
  /** null where the hiring system was never measured: an unmeasured system is not claimed free of either obstacle. */
  route: SelfApplyRoute;
  /** Skills and terms the posting uses, without its equal-opportunity and benefits boilerplate. Not the form's questions. */
  postingTerms: string[];
  /** The posting's own lines on how to apply and what it requires (the employer's words), so no second call is needed. */
  postingExcerpt: string[];
};

/** Said wherever postingTerms stand in for a form nobody read. */
const TERMS_ARE_NOT_QUESTIONS = "postingTerms are skills and terms the posting uses, not the form's questions.";

/** The hiring systems whose form opens only after a sign-in, by the name a person sees. */
const ACCOUNT_FIRST_NAMES = new Map([["workday", "Workday"], ["icims", "iCIMS"], ["ukg", "UKG"]]);

/**
 * The note for a posting whose form was not read, one per reason (connect W4,
 * APPLY-1107-06). None blames the employer for a form we did not read: an
 * account-first system shows it behind a sign-in, and a system we have no
 * reader for shows it where we do not look.
 */
function noteFor(read: Exclude<FormRead, { kind: "read" }>): string {
  switch (read.kind) {
    case "no-reader": {
      if (selfApplyRoute(read.vendor).needsEmployerAccount === true) {
        const name = ACCOUNT_FIRST_NAMES.get(read.vendor);
        return `${name ? `This employer's hiring system (${name})` : "This hiring system"} asks you to sign in or make an account with the employer before its form opens, so the form cannot be read in advance. Open applyUrl, sign in or make the account, and read the form there. ${TERMS_ARE_NOT_QUESTIONS}`;
      }
      return `We don't read this hiring system's form yet. Open applyUrl to see the form. ${TERMS_ARE_NOT_QUESTIONS}`;
    }
    case "absent":
      return `We could not read a form for this posting from the employer's hiring system (it may have closed or moved). Open applyUrl and read the form there. ${TERMS_ARE_NOT_QUESTIONS}`;
    case "withheld":
      return `This employer's form is not read through this connection. Open applyUrl to see the form. ${TERMS_ARE_NOT_QUESTIONS}`;
    case "unreachable":
    default:
      return "The employer's hiring system did not answer just now. Try again later, or open applyUrl and read the form there.";
  }
}

/** An apply page that answered with no question this reader found. */
const PAGE_READ_NOTE =
  "We read the employer's application page and found no questions beyond your details and CV, or could not read them. Open applyUrl to check the form before you apply; attach your CV there.";

/** What such a page still asks for when it showed nothing else: the CV, whose requirement the page did not show us. */
const PAGE_READ_DOCUMENTS = [{ name: "Resume / CV", required: false }];

/**
 * What applying needs from the person on this hiring system: the measured
 * route (_shared/self-apply.ts selfApplyRoute, which /v1 shares). A system
 * nobody measured (Taleo, say) answers null (sweep S12-174).
 */
export function routeFor(vendor: string): SelfApplyRoute {
  return selfApplyRoute(vendor);
}

/** The answer for a posting the board serves, from its form read. */
export function applyMyselfAnswer(posting: ApplyPosting, read: FormRead, postingTerms: string[], postingExcerpt: string[] = []): ApplyMyselfAnswer {
  const vendor = read.vendor;
  const base = { ...posting, jobId: posting.id, state: "open" as const, route: routeFor(vendor), postingTerms: postingTerms.slice(0, 30), postingExcerpt: postingExcerpt.slice(0, 8) };
  if (read.kind === "read") {
    return {
      ...base,
      form: {
        source: "employer-published",
        vendor,
        readAt: read.readAt,
        questions: whoAnswersEach(read.form.questions),
        documents: read.form.documents,
        alsoOnForm: read.form.alsoOnForm,
      },
    };
  }
  const source: FormSource = read.kind === "withheld" ? "not-read-on-this-surface" : read.kind === "unreachable" ? "unreachable" : "not-published";
  const page = read.kind === "absent" && read.pageRead === true ? read : null;
  return {
    ...base,
    form: {
      source,
      vendor,
      readAt: read.kind === "absent" ? read.readAt : null,
      questions: [],
      documents: page ? (page.documents?.length ? page.documents : PAGE_READ_DOCUMENTS).map((d) => ({ ...d })) : [],
      alsoOnForm: page?.alsoOnForm ? [...page.alsoOnForm] : [],
      note: page ? PAGE_READ_NOTE : noteFor(read),
    },
  };
}

/** Under the drafting heading: the marks are read from the words, so the person checks them and every answer. */
export const DRAFT_MARK_NOTE =
  "These are marked from the questions' words. If one asks about you (your status, pay, dates, history or identity), answer it yourself. Read every answer before you send.";

const ANSWERER: Record<SelfApplyQuestion["answeredBy"], string> = {
  you: "you",
  your_details: "your details",
  your_documents: "a document you attach",
  draft_from_your_cv: "your AI may draft it from your CV; you check it",
};

function questionLine(q: SelfApplyQuestion): string {
  const bits = [`${q.n}. ${q.label}${q.required ? " (required)" : ""}`];
  if (q.options?.length) bits.push(`   Options: ${q.options.join(" | ")}`);
  if (q.hint) bits.push(`   Note from the employer: ${q.hint}`);
  const extra = [
    q.topic ? `about: ${q.topic.replace(/_/g, " ")}` : "",
    q.voluntary ? "voluntary: you may decline" : "",
    q.sponsorshipSense === "inverted" ? "worded in reverse: read it twice" : "",
    q.cvMayHelp ? "your CV may help you answer" : "",
    q.screens ? "the employer screens applications on this answer" : "",
  ].filter(Boolean);
  bits.push(`   Answered by: ${ANSWERER[q.answeredBy]}${extra.length ? ` (${extra.join("; ")})` : ""}`);
  return bits.join("\n");
}

/** Where a person's saved jobs and the free tracker live on the site. */
export const TRACKER_URL = "https://resumebooster.work/account";

/** The sentence about what the person meets when they submit, from the measured route. */
export function routeSentence(r: SelfApplyRoute): string {
  const bits = ["You submit it."];
  if (r.needsEmployerAccount) bits.push("This hiring system asks you to sign in or make an account with the employer before the form.");
  if (r.captcha === "visible") bits.push("Expect a CAPTCHA, which you solve.");
  else if (r.captcha === "invisible") bits.push("It may run an invisible check; you won't see a puzzle.");
  if (r.needsEmployerAccount === null && r.captcha === null) bits.push("We have not measured whether this hiring system asks for an account or a CAPTCHA.");
  else if (r.captcha === null) bits.push("We have not measured whether it shows a CAPTCHA.");
  bits.push("Attach your files yourself.");
  return bits.join(" ");
}

/** The packet as markdown: six headings, the same facts as the JSON. */
export function applyMyselfMarkdown(a: ApplyMyselfAnswer): string {
  const yours = a.form.questions.filter((q) => q.answeredBy !== "draft_from_your_cv");
  const drafts = a.form.questions.filter((q) => q.answeredBy === "draft_from_your_cv");
  const lines: string[] = [];
  lines.push(`# Applying to ${a.title ?? "this role"}${a.company ? ` at ${a.company}` : ""}`, "");
  lines.push("## The posting", "");
  lines.push(`- Job id: ${a.jobId}`);
  if (a.location) lines.push(`- Location: ${a.location}`);
  if (a.pay) lines.push(`- Pay, as the employer states it: ${a.pay}`);
  if (a.postedAt) lines.push(`- Posted: ${a.postedAt}`);
  if (a.postingTerms.length) lines.push(`- Skills and terms the posting uses (not form questions): ${a.postingTerms.join(", ")}`);
  if (a.postingExcerpt.length) lines.push("- What the posting says about applying and requirements (the employer's words):", ...a.postingExcerpt.map((x) => `  - ${x}`));
  lines.push(`- On resumebooster.work: ${a.siteUrl}`, "");
  lines.push("## Questions you answer yourself", "");
  if (a.form.source !== "employer-published") lines.push(a.form.note ?? "", "");
  else if (!yours.length) lines.push("None on this form.", "");
  else lines.push(...yours.map(questionLine), "");
  lines.push("## Questions your AI may draft from your CV", "");
  lines.push(drafts.length ? drafts.map(questionLine).join("\n") : "None.", "");
  if (drafts.length) lines.push(DRAFT_MARK_NOTE, "");
  lines.push("## Documents to attach", "");
  if (a.form.documents.length) lines.push(...a.form.documents.map((d) => `- ${d.name}${d.required ? " (required)" : " (optional)"}`));
  else lines.push("- Your CV, unless the form says otherwise.");
  if (a.form.alsoOnForm.length) lines.push(...a.form.alsoOnForm.map((x) => `- Also on the form: ${x}`));
  lines.push("");
  lines.push("## Where to apply", "");
  lines.push(`- The employer's own form: ${a.applyUrl ?? a.siteUrl}`);
  lines.push(`- ${routeSentence(a.route)}`, "");
  lines.push("## Keep track", "");
  lines.push("- After you press Submit, add a row to your application log in this chat: date, company, title, job id and the employer's link. Your AI can re-check those jobs later with check_jobs_open.");
  lines.push(`- To keep it on resumebooster.work too, open ${a.siteUrl}, press Save and sign in: your saved jobs and the free tracker are at ${TRACKER_URL}.`);
  return lines.join("\n");
}
