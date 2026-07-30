import { describe, expect, it } from "vitest";
import {
  buildPacket,
  type PacketQuestion,
  type Profile,
  type StandingAnswers,
} from "../../supabase/functions/_shared/submission-packet.ts";

const profile: Profile = {
  fullName: "Alex Rivera",
  email: "alex@example.com",
  phone: "+1 555 0100",
  linkedin: "linkedin.com/in/alexrivera",
  city: "Austin",
  country: "US",
  resumeFileUrl: "https://files.example.com/alex.pdf",
};
const standing: StandingAnswers = {
  workAuthorized: true,
  requiresSponsorship: false,
  salaryExpectation: "$120,000",
  earliestStart: "2 weeks",
  willingToRelocate: false,
};
const Q = (label: string, required = true, fieldType?: string): PacketQuestion =>
  ({ label, required, fieldType });

const build = (questions: PacketQuestion[], o: Partial<Parameters<typeof buildPacket>[0]> = {}) =>
  buildPacket({ questions, profile, standing, drafted: [], automationTier: "auto", ...o });

describe("the agent fills what it has", () => {
  it("fills identity from the profile without asking", () => {
    const p = build([Q("Full name"), Q("Email"), Q("Phone"), Q("LinkedIn Profile")]);
    expect(p.blockers).toEqual([]);
    expect(p.ready).toBe(true);
    expect(p.fields.map((f) => f.value)).toEqual([
      "Alex Rivera", "alex@example.com", "+1 555 0100", "linkedin.com/in/alexrivera",
    ]);
    expect(new Set(p.fields.map((f) => f.source))).toEqual(new Set(["profile"]));
  });

  it("matches identity questions by intent, not by exact wording", () => {
    // "Full name", "Your name" and "Name" are the same box on three vendors.
    for (const label of ["Full name", "Your Name", "Name", "Candidate name"]) {
      expect(build([Q(label)]).fields[0]?.value, label).toBe("Alex Rivera");
    }
    for (const label of ["Email", "E-mail address", "Your email"]) {
      expect(build([Q(label)]).fields[0]?.value, label).toBe("alex@example.com");
    }
  });

  it("answers factual questions from what the candidate configured once", () => {
    const p = build([
      Q("Are you legally authorized to work in the United States?"),
      Q("Will you now or in the future require sponsorship?"),
      Q("Salary expectation"),
      Q("Earliest start date"),
    ]);
    expect(p.blockers).toEqual([]);
    expect(p.fields.map((f) => f.value)).toEqual(["Yes", "No", "$120,000", "2 weeks"]);
    expect(new Set(p.fields.map((f) => f.source))).toEqual(new Set(["standing"]));
  });

  it("attaches the résumé for a file question", () => {
    const p = build([Q("Resume/CV", true, "file")]);
    expect(p.fields[0]?.source).toBe("resume");
    expect(p.ready).toBe(true);
  });
});

describe("the agent stops rather than inventing", () => {
  // THE LINE THIS MODULE EXISTS TO HOLD.
  it("blocks — never sends — when the résumé does not support an answer", () => {
    const p = build([Q("Describe your production Kubernetes experience")], {
      drafted: [{
        label: "Describe your production Kubernetes experience",
        answer: "",
        supported: false,
        note: "your résumé shows no Kubernetes work",
      }],
    });
    expect(p.ready, "an unsupported answer must never be submittable").toBe(false);
    expect(p.blockers[0].kind).toBe("unsupported-answer");
    expect(p.blockers[0].detail).toMatch(/Kubernetes/);
    // and crucially: nothing was written into the form for that question.
    expect(p.fields.find((f) => /Kubernetes/.test(f.key))).toBeUndefined();
  });

  it("sends a drafted answer only when it is grounded", () => {
    const label = "What interests you about this role?";
    const grounded = build([Q(label)], {
      drafted: [{ label, answer: "Six years building dialysis care software.", supported: true }],
    });
    expect(grounded.ready).toBe(true);
    expect(grounded.fields[0].source).toBe("drafted");
  });

  it("blocks on a missing factual answer instead of guessing", () => {
    // A wrong sponsorship answer can void an application. Guessing here is not a
    // smaller sin than inventing experience.
    const p = build([Q("Will you require visa sponsorship?")], { standing: {} });
    expect(p.ready).toBe(false);
    expect(p.blockers[0].kind).toBe("missing-standing");
    expect(p.blockers[0].detail).toMatch(/set this once/i);
  });

  it("blocks when a required file is missing", () => {
    const p = build([Q("Upload resume", true, "file")], { profile: { ...profile, resumeFileUrl: "" } });
    expect(p.ready).toBe(false);
    expect(p.blockers[0].kind).toBe("missing-file");
  });

  it("does not block on OPTIONAL fields it cannot fill", () => {
    // Optional means optional. Blocking a whole application over a blank
    // "portfolio URL" would strand people who simply have no portfolio.
    const p = build([Q("Full name"), Q("Portfolio URL", false), Q("Cover letter", false)]);
    expect(p.blockers).toEqual([]);
    expect(p.ready).toBe(true);
  });
});

describe("demographic questions are declined, not answered and not blocking", () => {
  it("declines by default and still lets the application go", () => {
    const p = build([Q("Full name"), Q("Race/Ethnicity", false), Q("Gender", false)]);
    expect(p.ready, "EEO questions are voluntary and must never block a send").toBe(true);
    const dec = p.fields.filter((f) => f.source === "declined");
    expect(dec.length).toBe(2);
    expect(dec[0].value).toMatch(/decline/i);
  });

  it("stays silent when the candidate opted in to sharing", () => {
    // Opting in means their own answers get used elsewhere; the agent does not
    // invent a demographic identity for them either way.
    const p = build([Q("Gender", false)], { standing: { ...standing, shareDemographics: true } });
    expect(p.fields.find((f) => f.source === "declined")).toBeUndefined();
  });
});

describe("automation tier feeds the blockers honestly", () => {
  it("a CAPTCHA vendor is never marked ready", () => {
    const p = build([Q("Full name")], { automationTier: "click" });
    expect(p.ready).toBe(false);
    expect(p.blockers[0].kind).toBe("captcha");
  });

  it("an unmeasured form never claims it can be completed unattended", () => {
    // Workday and anything we have not sampled. Silence about a form is not
    // evidence the form is easy.
    const p = build([Q("Full name")], { automationTier: "unknown" });
    expect(p.ready).toBe(false);
    expect(p.blockers[0].kind).toBe("unknown-form");
  });

  it("a measured zero-CAPTCHA vendor with everything present is ready", () => {
    const p = build([Q("Full name"), Q("Email"), Q("Resume", true, "file")], { automationTier: "auto" });
    expect(p.ready).toBe(true);
    expect(p.blockers).toEqual([]);
  });
});

describe("ready is a claim about the whole form", () => {
  it("one blocker anywhere makes the whole packet not ready", () => {
    const p = build([
      Q("Full name"), Q("Email"), Q("Resume", true, "file"),
      Q("Describe your Rust experience"),
    ], {
      drafted: [{ label: "Describe your Rust experience", answer: "", supported: false }],
    });
    expect(p.fields.length).toBe(3);      // the rest still got filled
    expect(p.ready).toBe(false);          // but nothing is sent
    expect(p.autoFilled).toBe(3);
    expect(p.total).toBe(4);
  });

  it("an empty form is never ready", () => {
    // A form we could not read is not a form with nothing to fill.
    expect(build([]).ready).toBe(false);
  });

  it("reports how much it did unaided, for a number that can be checked", () => {
    const p = build([Q("Full name"), Q("Email"), Q("Phone"), Q("Gender", false)]);
    expect(p.autoFilled).toBe(4);
    expect(p.total).toBe(4);
  });
});

describe("regression: a name box is never treated as an essay prompt", () => {
  // Found by wiring the packet builder to the live classifier, not by review.
  // "Candidate name" fell through to `draftable`, which means the agent would
  // have asked the answer generator to write a SENTENCE where a person's name
  // belongs — and on a required field that sentence would have been submitted.
  it("autofills short labels ending in 'name'", () => {
    for (const label of ["Candidate name", "Applicant Name", "Employee name", "Legal name"]) {
      const p = build([Q(label)]);
      expect(p.fields[0]?.value, label).toBe("Alex Rivera");
      expect(p.fields[0]?.source, label).toBe("profile");
    }
  });

  it("still leaves a genuine prompt draftable", () => {
    // The guard this fix had to avoid breaking: "name" as a verb.
    const label = "Name a project you're proud of";
    const p = build([Q(label)], {
      drafted: [{ label, answer: "Rebuilt the dialysis scheduler.", supported: true }],
    });
    expect(p.fields[0]?.source).toBe("drafted");
  });

  it("does not autofill a long prompt that merely ends on the word name", () => {
    const label = "If you could work under any professional pseudonym what would be your name";
    const p = build([Q(label)], { drafted: [{ label, answer: "x", supported: true }] });
    expect(p.fields[0]?.source).toBe("drafted");
  });
});
