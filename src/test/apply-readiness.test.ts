/**
 * The readiness model, tested in both directions.
 *
 * The severity ladder is the whole point: "blocks-everything" and
 * "blocks-some" must not blur together, because the actions they imply are
 * different. A missing CV means nothing can be sent at all. A missing postcode
 * means SOME employers stop and others do not. Telling someone the second is
 * the first makes the tool cry wolf; telling them the first is the second lets
 * them believe applications are going out when none are.
 */
import { describe, it, expect } from "vitest";
import { applyReadiness, worstSeverity, type ProfileLike } from "@/lib/applyReadiness";

/** Everything the dry run had when Pinpoint dropped from 5 blockers to 1. */
const COMPLETE: ProfileLike = {
  full_name: "Alex Morgan", email: "alex@example.com", phone: "+447700900123",
  city: "Leeds", country: "United Kingdom", address: "14 Wellington Street",
  postcode: "LS1 4AP", resume_file_url: "resumes/alex.pdf",
  salary_expectation: "55000", earliest_start: "Four weeks",
  cover_note: "Eight years running operations teams.",
  linkedin: "https://www.linkedin.com/in/alex-morgan-ops",
  work_authorized: true, requires_sponsorship: false, willing_to_relocate: true,
  consent_to_processing: true,
};

describe("a complete profile", () => {
  it("has no gaps and can send unattended", () => {
    const r = applyReadiness(COMPLETE);
    expect(r.gaps).toEqual([]);
    expect(r.ready).toBe(r.total);
    expect(r.canSendUnattended).toBe(true);
    expect(worstSeverity(r)).toBeNull();
  });
});

describe("an empty profile", () => {
  const r = applyReadiness({});

  it("reports the CV as blocking everything", () => {
    const cv = r.gaps.find((g) => g.field === "resume_file_url");
    expect(cv?.severity).toBe("blocks-everything");
    expect(cv?.consequence).toMatch(/cannot send anything/i);
  });

  it("cannot send unattended", () => {
    expect(r.canSendUnattended).toBe(false);
    expect(worstSeverity(r)).toBe("blocks-everything");
  });

  it("puts the most severe gap first", () => {
    // The UI shows the first gap as the next action; ordering IS the feature.
    expect(r.gaps[0].severity).toBe("blocks-everything");
  });
});

describe("the trinaries are respected, not coerced", () => {
  it("treats a stated false as answered", () => {
    // requires_sponsorship: false is a real answer and must not read as a gap.
    const r = applyReadiness({ ...COMPLETE, requires_sponsorship: false });
    expect(r.gaps.find((g) => g.field === "requires_sponsorship")).toBeUndefined();
  });

  it("treats null as not stated, and says what that costs", () => {
    const r = applyReadiness({ ...COMPLETE, work_authorized: null });
    const g = r.gaps.find((g) => g.field === "work_authorized");
    expect(g?.severity).toBe("blocks-some");
    // The point the candidate needs: silence means those postings are skipped,
    // and skipped looks exactly like "no matching jobs" from outside.
    expect(g?.consequence).toMatch(/skipped/i);
  });
});

describe("severity is not blurred", () => {
  it("a missing postcode blocks SOME, not everything", () => {
    const r = applyReadiness({ ...COMPLETE, postcode: "" });
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].severity).toBe("blocks-some");
    expect(r.canSendUnattended).toBe(false);
  });

  it("a missing cover note reduces quality but still sends", () => {
    const r = applyReadiness({ ...COMPLETE, cover_note: "" });
    expect(r.gaps[0].severity).toBe("reduces-quality");
    expect(r.canSendUnattended).toBe(true);
  });

  it("consent left off is a blocker, because the tick is required", () => {
    const r = applyReadiness({ ...COMPLETE, consent_to_processing: false });
    expect(r.gaps[0].field).toBe("consent_to_processing");
    expect(r.gaps[0].severity).toBe("blocks-some");
  });
});

describe("every consequence names a real form behaviour", () => {
  it("no gap ships without one", () => {
    for (const g of applyReadiness({}).gaps) {
      expect(g.consequence.length, `${g.field} has no consequence`).toBeGreaterThan(20);
    }
  });

  it("reproduces the measured Pinpoint result", () => {
    // The live dry run: an EMPTY standing profile blocked on city, postcode,
    // salary, consent and one open question. Four of those five are modelled
    // here; the fifth is an employer-specific question no profile can answer.
    const r = applyReadiness({ ...COMPLETE, city: "", postcode: "", salary_expectation: "", consent_to_processing: false });
    const fields = r.gaps.map((g) => g.field).sort();
    expect(fields).toEqual(["city", "consent_to_processing", "postcode", "salary_expectation"]);
    expect(r.gaps.every((g) => g.severity === "blocks-some")).toBe(true);
  });
});
