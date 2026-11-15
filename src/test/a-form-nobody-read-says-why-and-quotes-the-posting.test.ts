/**
 * A FORM NOBODY READ SAYS WHY, AND QUOTES THE POSTING (connect W4, APPLY-1107-06).
 *
 * For the postings whose form was not read (most of them: Workday, iCIMS,
 * Oracle, UKG...), apply_myself said the employer "does not publish" its
 * form and that the keyword list postingTerms "say what it asks for". Both
 * were wrong: an account-first system shows its form behind a sign-in, a
 * system we have no reader for shows it where we do not look, and
 * postingTerms are dictionary words, not questions.
 *
 * Now the note gives the reason (an account before the form; not read yet;
 * could not be read for this posting), says postingTerms are not the form's
 * questions, and the answer carries postingExcerpt: the posting's own lines
 * on how to apply and what it requires, so the AI needs no second call.
 */
import { describe, expect, it } from "vitest";
import { postingExcerptOf } from "../../supabase/functions/agent-mcp/posting-excerpt";
import { applyMyselfAnswer, applyMyselfMarkdown } from "../../supabase/functions/agent-mcp/apply-myself";
import { formBlock } from "../../supabase/functions/public-api/application";

const posting = (id: string) => ({ id, title: "Analyst", company: "Acme", location: null, pay: null, postedAt: null, applyUrl: "https://example.test/apply", siteUrl: `https://resumebooster.work/jobs?job=${id}` });
const noteOf = (vendor: string, kind: "no-reader" | "absent" = "no-reader") =>
  String(applyMyselfAnswer(posting(`${vendor}:acme:1`), kind === "absent" ? { kind, vendor, readAt: "2026-11-08T00:00:00Z", cached: false } : { kind, vendor }, []).form.note);

describe("the note says why no form was read", () => {
  it.each([["workday", "Workday"], ["icims", "iCIMS"], ["ukg", "UKG"]])("%s: the form opens after a sign-in with the employer", (vendor, name) => {
    const note = noteOf(vendor);
    expect(note).toMatch(new RegExp(`hiring system \\(${name}\\) asks you to sign in or make an account with the employer before its form opens`));
    expect(note).toMatch(/postingTerms are skills and terms the posting uses, not the form's questions\./);
  });

  it("a system we have no reader for: not read yet", () => {
    expect(noteOf("oracle")).toMatch(/^We don't read this hiring system's form yet\./);
  });

  it("a reader that found no form for this posting: could not be read, maybe closed", () => {
    expect(noteOf("greenhouse", "absent")).toMatch(/^We could not read a form for this posting/);
  });

  it("no note says the employer does not publish its form, or that postingTerms say what it asks", () => {
    for (const n of [noteOf("workday"), noteOf("oracle"), noteOf("lever", "absent"), noteOf("taleo")]) {
      expect(n).not.toMatch(/does not publish|say what it asks for/);
    }
  });

  it("/v1 gives the same reasons", () => {
    expect(formBlock({ kind: "no-reader", vendor: "icims" })?.note).toMatch(/sign in or make an account with the employer before its form opens/);
    expect(formBlock({ kind: "no-reader", vendor: "oracle" })?.note).toMatch(/not read yet: forms are read for Ashby, BambooHR, Breezy, Greenhouse, Lever, Paylocity, Pinpoint, Recruitee, Teamtailor or Workable\./);
    expect(formBlock({ kind: "absent", vendor: "lever", readAt: "2026-11-08T00:00:00Z", cached: false })?.note).toMatch(/No form could be read for this posting/);
  });
});

describe("the posting's own lines on applying and requirements", () => {
  const DESCRIPTION = [
    "<h3>About the role</h3><p>You will analyse claims data for our regional teams.</p>",
    "<h3>Requirements</h3><ul><li>Bachelor's degree in statistics or a related field</li><li>3+ years of experience with SQL</li><li>Strong written communication</li></ul>",
    "<h3>Benefits</h3><ul><li>Medical, dental and vision insurance</li><li>401(k) match</li></ul>",
    "<p>To apply, please submit your CV and a short cover letter by 30 November.</p>",
    "<p>We are an equal opportunity employer and consider all applicants without regard to race, color or veteran status.</p>",
  ].join("");

  it("picks the requirement and how-to-apply lines, in order, and leaves the boilerplate", () => {
    expect(postingExcerptOf(DESCRIPTION)).toEqual([
      "Bachelor's degree in statistics or a related field",
      "3+ years of experience with SQL",
      "Strong written communication",
      "To apply, please submit your CV and a short cover letter by 30 November.",
    ]);
  });

  it("is capped at eight lines of at most 240 characters", () => {
    const many = `<h3>Requirements</h3><ul>${Array.from({ length: 20 }, (_, i) => `<li>Requirement ${i}: ${"x".repeat(300)}</li>`).join("")}</ul>`;
    const ex = postingExcerptOf(many);
    expect(ex.length).toBeLessThanOrEqual(8);
    for (const l of ex) expect(l.length).toBeLessThanOrEqual(240);
  });

  it("rides in the answer and the packet as the employer's words", () => {
    const a = applyMyselfAnswer(posting("workday:acme:1"), { kind: "no-reader", vendor: "workday" }, ["sql"], postingExcerptOf(DESCRIPTION));
    expect(a.postingExcerpt).toHaveLength(4);
    const md = applyMyselfMarkdown(a);
    expect(md).toMatch(/What the posting says about applying and requirements \(the employer's words\):\n {2}- Bachelor's degree/);
  });

  it("an empty description gives no lines, never a guess", () => {
    expect(postingExcerptOf("")).toEqual([]);
    expect(applyMyselfAnswer(posting("workday:acme:1"), { kind: "no-reader", vendor: "workday" }, []).postingExcerpt).toEqual([]);
  });
});
