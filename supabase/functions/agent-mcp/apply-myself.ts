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
// (_shared/self-apply.ts, default-deny: the AI drafts only questions about
// work done and a short list of motivation questions; everything factual goes
// to the person). The rules the AI follows live in the server instructions,
// the tool description and the apply_myself prompt, never in this result.
//
// Pure: the caller hands in the posting, the read and the route, so the Node
// suite runs it on recorded forms.

import { automationFor } from "../_shared/apply-automation.ts";
import type { FormRead } from "../_shared/application-form.ts";
import { whoAnswersEach, type SelfApplyQuestion } from "../_shared/self-apply.ts";

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
  route: { submitter: "you"; needsEmployerAccount: boolean; captchaLikely: boolean; attachFilesYourself: true };
  postingTerms: string[];
};

const NOTES: Record<Exclude<FormSource, "employer-published">, string> = {
  "not-published":
    "This employer's hiring system does not publish its application form where we can read it. Open applyUrl to see the form; the posting text and postingTerms say what it asks for.",
  "not-read-on-this-surface":
    "This employer's form is not read through this connection. Open applyUrl to see the form; the posting text and postingTerms say what it asks for.",
  unreachable:
    "The employer's hiring system did not answer just now. Try again later, or open applyUrl and read the form there.",
};

/** A Breezy or Pinpoint apply page that answered with no question this reader found. */
const PAGE_READ_NOTE =
  "We read the employer's application page and found no questions beyond your details and CV, or could not read them. Open applyUrl to check the form before you apply; attach your CV there.";

/** What such a page still asks for: the CV, whose requirement the page did not show us. */
const PAGE_READ_DOCUMENTS = [{ name: "Resume / CV", required: false }];

/** What applying needs from the person on this hiring system, from the measured vendor table. */
export function routeFor(vendor: string): ApplyMyselfAnswer["route"] {
  const fact = automationFor(vendor);
  return {
    submitter: "you",
    needsEmployerAccount: fact.tier === "signup" || /account\s+needed/i.test(fact.note),
    captchaLikely: fact.tier === "click",
    attachFilesYourself: true,
  };
}

/** The answer for a posting the board serves, from its form read. */
export function applyMyselfAnswer(posting: ApplyPosting, read: FormRead, postingTerms: string[]): ApplyMyselfAnswer {
  const vendor = read.vendor;
  const base = { ...posting, jobId: posting.id, state: "open" as const, route: routeFor(vendor), postingTerms: postingTerms.slice(0, 30) };
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
  const pageRead = read.kind === "absent" && read.pageRead === true;
  return {
    ...base,
    form: {
      source,
      vendor,
      readAt: read.kind === "absent" ? read.readAt : null,
      questions: [],
      documents: pageRead ? PAGE_READ_DOCUMENTS.map((d) => ({ ...d })) : [],
      alsoOnForm: [],
      note: pageRead ? PAGE_READ_NOTE : NOTES[source],
    },
  };
}

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
  ].filter(Boolean);
  bits.push(`   Answered by: ${ANSWERER[q.answeredBy]}${extra.length ? ` (${extra.join("; ")})` : ""}`);
  return bits.join("\n");
}

/** The packet as markdown: five headings, the same facts as the JSON. */
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
  if (a.postingTerms.length) lines.push(`- Terms the posting uses: ${a.postingTerms.join(", ")}`);
  lines.push(`- On resumebooster.work: ${a.siteUrl}`, "");
  lines.push("## Questions you answer yourself", "");
  if (a.form.source !== "employer-published") lines.push(a.form.note ?? "", "");
  else if (!yours.length) lines.push("None on this form.", "");
  else lines.push(...yours.map(questionLine), "");
  lines.push("## Questions your AI may draft from your CV", "");
  lines.push(drafts.length ? drafts.map(questionLine).join("\n") : "None.", "");
  lines.push("## Documents to attach", "");
  if (a.form.documents.length) lines.push(...a.form.documents.map((d) => `- ${d.name}${d.required ? " (required)" : " (optional)"}`));
  else lines.push("- Your CV, unless the form says otherwise.");
  if (a.form.alsoOnForm.length) lines.push(...a.form.alsoOnForm.map((x) => `- Also on the form: ${x}`));
  lines.push("");
  lines.push("## Where to apply", "");
  lines.push(`- The employer's own form: ${a.applyUrl ?? a.siteUrl}`);
  lines.push(`- You submit it. ${a.route.needsEmployerAccount ? "This hiring system asks you to make an account with the employer first. " : ""}${a.route.captchaLikely ? "Expect a CAPTCHA, which you solve. " : ""}Attach your files yourself.`);
  return lines.join("\n");
}
