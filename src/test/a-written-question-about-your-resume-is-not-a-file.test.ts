/**
 * A WRITTEN QUESTION ABOUT YOUR RESUME IS NOT A FILE (connect W4, APPLY-1107-07).
 *
 * srs-merchandising's Breezy form asks, in a required paragraph box, "What
 * merchandising or vendor companies have you worked for ... that are not
 * listed on your resume?". The word "resume" made it your_documents, so the
 * AI told the person to attach a file to a question that wants sentences.
 * Workable paragraphs that say "(Please do not paste your resume)" and a
 * Breezy text box asking for a portfolio LINK went the same way, and a yes/no
 * control mentioning "email" or "phone" read as a contact field.
 *
 * The rule now: when the hiring system says what the control is, and it is
 * not a file input, a file word in its label never makes it a document, and a
 * contact word never makes a yes/no control a contact field.
 *
 * Held to the corpus rule: 563 real labels with their control types, read by
 * the real readers from recorded employer forms (src/test/fixtures/
 * form-labels-2026-11.json; main's marks recorded beside each, so no git
 * history is read). Never worse than main on any: nothing main left to the
 * person is drafted, nothing main marked "you" moves, and every row that
 * changes moves toward the person.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { whoAnswers, type SelfApplyQuestion } from "../../supabase/functions/_shared/self-apply";

type Row = {
  vendor: string; posting: string; label: string; type: string; required: boolean; options?: string[]; hint?: string; screens?: true;
  main: { answeredBy: SelfApplyQuestion["answeredBy"]; topic?: string; cvMayHelp?: true; voluntary?: true };
};
const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/form-labels-2026-11.json"), "utf8")) as { rows: Row[] };
const now = (r: Row): SelfApplyQuestion =>
  whoAnswers({ label: r.label, required: r.required, type: r.type, ...(r.options ? { options: r.options } : {}), ...(r.hint ? { hint: r.hint } : {}), ...(r.screens ? { screens: true } : {}) }, 1);
const marked = CORPUS.rows.map((r) => ({ r, q: now(r) }));
const changed = marked.filter(({ r, q }) => r.main.answeredBy !== q.answeredBy || (r.main.topic ?? null) !== (q.topic ?? null) || !!r.main.cvMayHelp !== !!q.cvMayHelp);

describe("a written question that mentions a CV is the person's to write, never a file", () => {
  it("srs-merchandising's paragraph about companies not listed on your resume is answered by the person", () => {
    const rows = marked.filter(({ r }) => r.posting.startsWith("breezy:srs-merchandising:") && /not listed on your resume/i.test(r.label));
    expect(rows.length).toBeGreaterThan(0);
    for (const { r, q } of rows) {
      expect(r.type).toBe("paragraph");
      expect(q.answeredBy, r.label).toBe("you");
    }
  });

  it("a Workable paragraph that says not to paste a resume, and a portfolio link box, are written answers", () => {
    const rows = marked.filter(({ r }) => (r.vendor === "workable" && r.type === "paragraph" && /resume/i.test(r.label)) || /portfolio you'd like to share/i.test(r.label));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const { r, q } of rows) expect(q.answeredBy, r.label).toBe("you");
  });

  it("a yes/no control that mentions email or a phone is a question, not a contact field", () => {
    const rows = marked.filter(({ r }) => r.vendor === "breezy" && r.main.answeredBy === "your_details" && r.options?.length === 2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const { r, q } of rows) expect(q.answeredBy, r.label).toBe("you");
  });

  it("a real file input still asks for a document", () => {
    const files = marked.filter(({ r }) => /file|upload|attachment/i.test(r.type) && r.main.answeredBy === "your_documents");
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const { r, q } of files) expect(q.answeredBy, r.label).toBe("your_documents");
  });
});

describe("never worse than main, on 563 real labels", () => {
  it("the corpus is real and large enough", () => {
    expect(CORPUS.rows.length).toBeGreaterThanOrEqual(300);
    expect(new Set(CORPUS.rows.map((r) => r.vendor)).size).toBeGreaterThanOrEqual(8);
  });

  it("nothing main left to the person is drafted from a CV", () => {
    const drafted = marked.filter(({ r, q }) => q.answeredBy === "draft_from_your_cv" && r.main.answeredBy !== "draft_from_your_cv").map(({ r }) => r.label);
    expect(drafted).toEqual([]);
  });

  it("everything main marked 'you' is still the person's", () => {
    const moved = marked.filter(({ r, q }) => r.main.answeredBy === "you" && q.answeredBy !== "you").map(({ r }) => r.label);
    expect(moved).toEqual([]);
  });

  it("every row that changes moves toward the person: off a document or a contact field onto 'you', or a consent or a how-heard question losing its CV hint", () => {
    for (const { r, q } of changed) {
      const offDocument = r.main.answeredBy === "your_documents" && q.answeredBy === "you";
      const offDetails = r.main.answeredBy === "your_details" && q.answeredBy === "you";
      const settled = r.main.answeredBy === "you" && q.answeredBy === "you" && !q.cvMayHelp && (q.topic === "consent" || q.topic === "how_you_found_us");
      expect(offDocument || offDetails || settled, `${r.vendor}: ${r.label}`).toBe(true);
    }
    expect(changed.length).toBe(28);
  });
});
