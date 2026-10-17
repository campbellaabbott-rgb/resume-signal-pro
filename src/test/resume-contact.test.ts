/**
 * EXTRACTION THAT WOULD RATHER SAY NOTHING.
 *
 * Every value this module produces ends up on a real application to a real
 * employer under somebody's name. So these tests spend far more effort on what
 * it must REFUSE to extract than on what it finds — a missing field costs one
 * tap later, and a wrong field is a lie told on somebody's behalf that they may
 * never see.
 *
 * The traps below are the realistic ones: a referee's phone number, a former
 * employer's website, and a document heading sitting where a name should be.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveContact, fillGaps } from "../lib/resumeContact";

const CV = `Jane Okonkwo
jane.okonkwo@example.com | +44 7700 900123
London, UK
linkedin.com/in/jane-okonkwo
janeokonkwo.dev

PROFESSIONAL SUMMARY
Senior platform engineer with nine years building payment systems.

EXPERIENCE
Acme Payments Ltd (acmepayments.co.uk), London — 2021 to present
Reduced settlement latency by 40%. Team of 6.
Reachable via the switchboard on +44 20 7946 0958.

REFERENCES
Dr Alan Whitfield, alan.whitfield@oldcompany.com, +44 161 496 0111
`;

describe("it reads what a CV actually states", () => {
  const d = deriveContact(CV);

  it("finds the email", () => {
    expect(d.email).toEqual({ value: "jane.okonkwo@example.com", confidence: "high" });
  });

  it("finds the LinkedIn profile and normalises it to a URL", () => {
    // Stored as a URL so the worker can put it straight into a URL field
    // without every vendor adapter re-implementing the same normalisation.
    expect(d.linkedin?.value).toBe("https://www.linkedin.com/in/jane-okonkwo");
    expect(d.linkedin?.confidence).toBe("high");
  });

  it("finds the phone number from the header", () => {
    expect(d.phone?.value).toBe("+44 7700 900123");
  });

  it("finds the name but never claims certainty about it", () => {
    // A confidently wrong name is the worst thing this module could produce, so
    // the name is ALWAYS low — the UI shows it for confirmation.
    expect(d.full_name).toEqual({ value: "Jane Okonkwo", confidence: "low" });
  });
});

describe("what it must refuse to extract", () => {
  it("does NOT take a phone number from the body of the CV", () => {
    // Two other numbers appear below the header: a former employer's
    // switchboard and a referee's mobile. Either one on an application form is
    // a real-world embarrassment, and the candidate would never know.
    const d = deriveContact(CV);
    expect(d.phone?.value).not.toContain("7946");
    expect(d.phone?.value).not.toContain("496");
  });

  it("does NOT take a former employer's website as the candidate's", () => {
    const d = deriveContact(CV);
    expect(d.website?.value ?? "").not.toContain("acmepayments");
  });

  it("does not mistake a document heading for a name", () => {
    for (const heading of ["CURRICULUM VITAE", "Resume", "Personal Details", "Profile"]) {
      const d = deriveContact(`${heading}\nsomebody@example.com\n+44 7700 900123\n`);
      expect(d.full_name, `"${heading}" was read as a name`).toBeUndefined();
    }
  });

  it("does not mistake a job title for a name", () => {
    // "Senior engineer" is two words but fails the every-word-capitalised rule.
    const d = deriveContact("Senior engineer\nhi@example.com\n");
    expect(d.full_name).toBeUndefined();
  });

  it("does not read a 'Name | Title' header line as a bare name", () => {
    const d = deriveContact("Jane Okonkwo | Platform Engineer\nhi@example.com\n");
    expect(d.full_name).toBeUndefined();
  });

  it("does not read a year range as a phone number", () => {
    const d = deriveContact("Jane Okonkwo\nAcme Ltd 2019 - 2024\nhi@example.com\n");
    expect(d.phone).toBeUndefined();
  });

  it("rejects digit runs that are too short or too long to be a number", () => {
    expect(deriveContact("Jane Okonkwo\n12345678\n").phone).toBeUndefined();
    expect(deriveContact("Jane Okonkwo\n1234567890123456789\n").phone).toBeUndefined();
  });

  it("NEVER derives a legal or personal declaration", () => {
    // Work authorisation, sponsorship, salary, start date and consent cannot be
    // inferred from prose, and a wrong guess is a false declaration on a legal
    // form. They are asked at the moment a form needs them, never inferred.
    const d = deriveContact(
      "Jane Okonkwo\nhi@example.com\nAuthorised to work in the UK. No sponsorship needed. " +
      "Salary expectation 85000. Available immediately. I consent to data processing.\n",
    ) as Record<string, unknown>;
    for (const forbidden of [
      "work_authorized", "requires_sponsorship", "salary_expectation",
      "earliest_start", "consent_to_processing",
    ]) {
      expect(d[forbidden], `${forbidden} must never be inferred`).toBeUndefined();
    }
  });
});

describe("it fails quietly rather than badly", () => {
  it("empty, null and undefined input yield nothing, not a crash", () => {
    for (const bad of ["", "   ", null, undefined, "hi"]) {
      expect(deriveContact(bad as string | null | undefined)).toEqual({});
    }
  });

  it("a CV with no contact details yields nothing rather than guesses", () => {
    const d = deriveContact("EXPERIENCE\nDid some things.\nAnd some other things.\n");
    expect(d.email).toBeUndefined();
    expect(d.phone).toBeUndefined();
  });

  it("strips trailing punctuation off an email rather than storing it", () => {
    expect(deriveContact("Jane Okonkwo\nWrite to me at jane@example.com.\n").email?.value)
      .toBe("jane@example.com");
  });
});

describe("what somebody typed themselves always wins", () => {
  it("fills only the empty fields, and only with what is sure", () => {
    const { next, filled, suggested } = fillGaps(
      { full_name: "", email: "typed@example.com", phone: null },
      deriveContact(CV),
    );
    expect(next.email).toBe("typed@example.com");   // untouched
    expect(next.phone).toBe("+44 7700 900123");      // was empty, and high
    // The name is never sure, so it is offered, not written (S11-045).
    expect(next.full_name).toBe("");
    expect(suggested.full_name).toBe("Jane Okonkwo");
    expect(filled).not.toContain("full_name");
    expect(filled).not.toContain("email");
  });

  it("treats whitespace as empty, so a stray space does not block a fill", () => {
    const { next } = fillGaps({ phone: "   " }, deriveContact(CV));
    expect(next.phone).toBe("+44 7700 900123");
  });

  it("RE-UPLOADING A CV NEVER REVERTS A HAND-CORRECTION", () => {
    // The bug this prevents: somebody fixes a mis-parsed phone number, uploads a
    // corrected CV, and watches their fix silently disappear. That is how people
    // stop trusting a product they cannot see the internals of.
    const corrected = { phone: "+44 7700 900999", full_name: "Jane Okonkwo-Smith" };
    const { next, filled } = fillGaps(corrected, deriveContact(CV));
    // The corrected values survive untouched...
    expect(next.phone).toBe("+44 7700 900999");
    expect(next.full_name).toBe("Jane Okonkwo-Smith");
    expect(filled).not.toContain("phone");
    expect(filled).not.toContain("full_name");
    // ...while fields they never filled in are still picked up, which is the
    // whole point. "Do not revert my edits" is not "do not help me again".
    expect(filled).toContain("email");
  });
});

/**
 * Sweep S11-045. findName is always `low`, and fillGaps ignored confidence,
 * so the upload saved whatever heading won into the mandate's full_name and
 * apply-broker sent it as the candidate's name, first name and last name. A
 * comma, a pipe or an en dash on the real name line, or column headings that
 * come first, made a heading win.
 */
describe("a CV upload never saves a guessed name", () => {
  const upload = (text: string) => fillGaps({ full_name: "", email: "", phone: "" }, deriveContact(text));

  it.each([
    ["a name line with post-nominals", "JANE DOE, RN\nRegistered Nurse\njane@example.com | +44 7700 900123\n"],
    ["a name line with an en-dash title", "Jane Doe – Senior Nurse\nProfessional Summary\njane@example.com\n"],
    ["a two-column layout whose headings come first", "Key Skills\nJane Doe\njane@example.com\n"],
    ["a job title in title case above the name", "Registered Nurse\nJane Doe\njane@example.com\n"],
  ])("%s leaves full_name empty and offers a suggestion", (_n, text) => {
    const { next, filled } = upload(text);
    expect(next.full_name).toBe("");
    expect(filled).not.toContain("full_name");
  });

  it.each([
    ["JANE DOE, RN\nRegistered Nurse\njane@example.com\n", "JANE DOE"],
    ["Jane Doe – Senior Nurse\nProfessional Summary\njane@example.com\n", "Jane Doe"],
    ["Key Skills\nJane Doe\njane@example.com\n", "Jane Doe"],
  ])("what it offers is the name, never the heading: %j", (text, name) => {
    expect(upload(text).suggested.full_name).toBe(name);
  });

  it("the upload shows the suggestions for a yes and saves only what fillGaps filled", () => {
    const panel = readFileSync(resolve(__dirname, "../components/account/ApplyProfilePanel.tsx"), "utf8");
    expect(panel).toMatch(/const \{ next, filled, suggested: unsure \} = fillGaps\(\{ \.\.\.p, resume_file_url: path \}, derived\);\s*setSuggested\(unsure\);/);
    expect(panel).toMatch(/const decideSuggestion = useCallback\(async \(k: ContactField, use: boolean\)/);
  });

  it("a section heading is never offered as a name", () => {
    for (const heading of ["Professional Summary", "Key Skills", "Work Experience", "Core Competencies"]) {
      expect(deriveContact(`${heading}\nsomebody@example.com\n`).full_name, heading).toBeUndefined();
    }
  });
});

describe("a LinkedIn profile is read from the header only", () => {
  it("a referee's profile in the body is not the candidate's", () => {
    const text = "Jane Okonkwo\njane@example.com\n\n" + "Experience line.\n".repeat(15) +
      "REFERENCES\nDr Alan Whitfield, linkedin.com/in/alan-whitfield\n";
    expect(deriveContact(text).linkedin).toBeUndefined();
  });
});
