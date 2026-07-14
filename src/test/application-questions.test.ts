// The apply agent's honesty guardrails: it may only draft substantive, resume-
// grounded free-text answers. It must NEVER draft demographics, work-authorization/
// salary/status facts (not in a resume), identity fields, or file uploads.
import { describe, it, expect } from "vitest";
import { classifyQuestion, selectDraftable } from "../../supabase/functions/_shared/application-questions";

describe("classifyQuestion", () => {
  it("routes identity/contact fields to autofill (not AI)", () => {
    for (const l of ["First Name", "Last Name", "Email", "Phone", "LinkedIn Profile", "Personal Website", "City"]) {
      expect(classifyQuestion(l, "input_text")).toBe("identity");
    }
  });

  it("routes file uploads to 'file'", () => {
    expect(classifyQuestion("Resume/CV", "input_file")).toBe("file");
    expect(classifyQuestion("Cover Letter", "input_file")).toBe("file");
    expect(classifyQuestion("Anything", "input_file")).toBe("file"); // type wins
  });

  it("NEVER drafts protected/voluntary self-ID questions", () => {
    for (const l of [
      "Gender", "Race/Ethnicity", "Are you Hispanic or Latino?", "Veteran status",
      "Disability status", "Sexual orientation", "What are your pronouns?", "Date of birth",
    ]) {
      expect(classifyQuestion(l, "multi_value_single_select")).toBe("demographic");
    }
  });

  it("NEVER drafts factual/status questions a resume can't establish", () => {
    for (const l of [
      "Are you legally authorized to work in the US?",
      "Will you now or in the future require visa sponsorship?",
      "What are your salary expectations?",
      "Desired compensation",
      "What is your notice period?",
      "When can you start?",
      "Are you willing to relocate?",
      "Are you at least 18 years of age?",
    ]) {
      expect(classifyQuestion(l, "input_text")).toBe("factual");
    }
  });

  it("drafts substantive free-text questions grounded in the resume", () => {
    for (const l of [
      "Why do you want to work at Stripe?",
      "Describe a time you led a cross-functional project.",
      "What interests you about this role?",
      "Tell us about your most impactful achievement.",
      "Who is your current or previous employer?",
      "What is your current or previous job title?",
    ]) {
      expect(classifyQuestion(l, "textarea")).toBe("draftable");
    }
  });

  it("selectDraftable keeps only the draftable questions", () => {
    const qs = [
      { label: "First Name", type: "input_text" },
      { label: "Resume/CV", type: "input_file" },
      { label: "Gender", type: "select" },
      { label: "Are you authorized to work in the US?", type: "input_text" },
      { label: "Why do you want to join our team?", type: "textarea" },
      { label: "Describe your leadership style.", type: "textarea" },
    ];
    expect(selectDraftable(qs).map((q) => q.label)).toEqual([
      "Why do you want to join our team?",
      "Describe your leadership style.",
    ]);
  });
});
