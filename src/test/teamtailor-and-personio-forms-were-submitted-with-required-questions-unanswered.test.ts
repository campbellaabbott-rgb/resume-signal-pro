import { describe, expect, it, beforeEach } from "vitest";
import { ENUMERATE_JS, type DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";
import { planAnswers, type StandingAnswers } from "../../worker/src/questions/match.js";
import { teamtailor } from "../../worker/src/vendors/teamtailor.js";
import { personio } from "../../worker/src/vendors/personio.js";

/**
 * Sweep S8-046. Teamtailor and Personio state requiredness in the LABEL
 * ("...?*Required", "(erforderlich)", a trailing "*") and set the attribute on
 * almost nothing. The DOM enumerator read requiredness only from attributes and
 * stripped the trailing "*", and the pre-submit guard is skipped on both
 * vendors because their attribute is untrustworthy. planAnswers saw answerable
 * 0, blocking 0, and the incomplete form was submitted; the "submit did not
 * take" block that followed is not a question, so the candidate was never
 * asked.
 *
 * The enumerator runs here against a vendor-shaped DOM, exactly as
 * page.evaluate runs it.
 */
const A: StandingAnswers = {
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "",
  city: "Berlin", country: "Germany", address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: null,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
};

function enumerate(html: string): DomQuestion[] {
  document.body.innerHTML = html;
  // eslint-disable-next-line no-eval
  return (0, eval)(ENUMERATE_JS) as DomQuestion[];
}

describe("a required question stated in words blocks the send", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("Teamtailor: '*Required' in the label", () => {
    const qs = enumerate(`
      <form>
        <div><label for="q1">Do you hold a valid forklift certificate?*Required</label>
          <input id="q1" name="candidate[answers][1]" type="text"></div>
        <div><label for="q2">I agree to the privacy policy*</label>
          <input id="q2" name="candidate[consent]" type="checkbox"></div>
        <div><label for="q3">Anything else you would like to add?</label>
          <textarea id="q3" name="candidate[answers][2]"></textarea></div>
      </form>`);
    const byName = Object.fromEntries(qs.map((q) => [q.name, q]));
    expect(byName["candidate[answers][1]"]!.required).toBe(true);
    expect(byName["candidate[consent]"]!.required).toBe(true);
    expect(byName["candidate[answers][2]"]!.required).toBe(false);

    const plan = planAnswers(qs, A, teamtailor.mappedNames);
    expect(plan.blocking.map((b) => b.q.name).sort()).toEqual(["candidate[answers][1]", "candidate[consent]"]);
  });

  it("Personio: '(erforderlich)' in the label", () => {
    const qs = enumerate(`
      <form>
        <div><label for="g">Geschlecht (erforderlich)</label>
          <select id="g" name="gender"><option>Bitte wählen</option><option>Weiblich</option><option>Männlich</option></select></div>
        <div><label for="s">Staplerschein vorhanden? (erforderlich)</label>
          <input id="s" name="custom_1" type="text"></div>
      </form>`);
    expect(qs.every((q) => q.required)).toBe(true);
    const plan = planAnswers(qs, A, personio.mappedNames);
    expect(plan.blocking.map((b) => b.q.name)).toContain("custom_1");
  });

  it("the marker is still stripped from the question text", () => {
    const [q] = enumerate(`<div><label for="x">Gender*</label><input id="x" name="g" type="text"></div>`);
    expect(q).toMatchObject({ label: "Gender", required: true });
  });

  it("a label that merely mentions the word is not marked", () => {
    const [q] = enumerate(`<div><label for="x">Which certifications are required for your current role? Tell us.</label><input id="x" name="c" type="text"></div>`);
    expect(q!.required).toBe(false);
  });
});
