// Regression tests for the secondary-industry "relaxed bar" fix.
// A genuine runner-up field normally has to clear 50% of the primary's score to
// be reported. When the runner-up has its OWN evidence (a matched job title or
// the field's required anchor terms), it now surfaces at a 35% bar — catching
// cross-functional resumes whose second field is a real 35-50% of the profile.
// Skills-list noise (no title/anchor evidence) must still be suppressed.
import { describe, it, expect } from "vitest";
import { detectIndustry } from "../../supabase/functions/free-keyword-scan/industry-detection.ts";

describe("industry secondary detection — relaxed bar for evidence-backed runner-ups", () => {
  it("surfaces a dual-title runner-up sitting at ~42% (would be dropped at the old 50% bar)", () => {
    const r = detectIndustry(
      "Jordan Blake\nSales Director — previously Marketing Manager\nPROFESSIONAL EXPERIENCE\n" +
        "Sales Director, Acme (2021-present)\n- Led enterprise sales team, exceeded quota, managed pipeline in Salesforce, closed $6M ARR, negotiation and closing\n" +
        "Marketing Manager, Acme (2017-2021)\n- Ran demand generation campaigns, brand strategy, content marketing, SEO, managed social media and advertising\n" +
        "SKILLS\nsales, quota, pipeline, Salesforce, prospecting, marketing, campaigns, brand, content, SEO, advertising",
    );
    expect(r.industry).toBe("sales");
    expect(r.secondaryIndustry).toBe("marketing");
    expect(r.industryBlend).toBeTruthy();
  });

  it("does NOT invent a secondary for a clean single-industry resume", () => {
    const r = detectIndustry(
      "Jane Doe\nSenior Software Engineer\nPROFESSIONAL EXPERIENCE\n" +
        "Senior Software Engineer, Acme (2021-present)\n- Built REST API services in Python, deployed to AWS with Docker and CI/CD\n- Designed database schema in PostgreSQL, improved query performance 40%\n" +
        "SKILLS\nPython, AWS, Docker, PostgreSQL, Kubernetes",
    );
    expect(r.industry).toBe("technology");
    expect(r.secondaryIndustry).toBeUndefined();
  });

  it("surfaces ML under a role-locked healthcare primary via strong anchors (the correction-log case)", () => {
    // healthcare role-locks to ~100 while genuine ML work scores ~3 — below the
    // normal >=5 floor. The strong-anchor path (tensorflow + pytorch + deep
    // learning = field-exclusive terms) must surface it anyway.
    const r = detectIndustry(
      "Maria Lopez, RN — Registered Nurse\nPROFESSIONAL EXPERIENCE\n" +
        "Registered Nurse, ICU, Mercy Hospital (2018-present)\n- Provided direct patient care in a 6-bed ICU; medication administration, triage, vitals, charting in Epic EHR\n- Acute care nursing, clinical documentation, patient safety\n- Built machine learning models (TensorFlow, PyTorch) predicting patient deterioration; trained deep learning classifiers, model training pipelines in Python\n" +
        "SKILLS\nnursing, patient care, clinical, Epic EHR, triage, machine learning, deep learning, TensorFlow, PyTorch, model training, neural networks",
    );
    expect(r.industry).toBe("healthcare");
    expect(r.secondaryIndustry).toBe("machine_learning");
  });

  it("does NOT read 'staff training' and 'care model' as an ML secondary (loose-anchor trap)", () => {
    const r = detectIndustry(
      "James Wu, RN — Registered Nurse\nPROFESSIONAL EXPERIENCE\n" +
        "Registered Nurse, ICU, Mercy Hospital (2018-present)\n- Provided direct patient care; medication administration, triage, vitals, charting in Epic EHR\n- Led staff training programs and improved the unit's care model; training new nurses on clinical documentation\n" +
        "SKILLS\nnursing, patient care, clinical, Epic EHR, triage, staff training, mentorship",
    );
    expect(r.industry).toBe("healthcare");
    expect(r.secondaryIndustry).not.toBe("machine_learning");
  });

  it("does NOT surface a low-scoring noise runner-up that lacks title/anchor evidence", () => {
    // A sales resume whose runner-ups are incidental keyword noise (no real
    // second field, no matching title or required anchors) must stay single.
    const r = detectIndustry(
      "Senior Account Executive — Enterprise Sales\nPROFESSIONAL EXPERIENCE\n" +
        "Senior Account Executive, CloudCo (2019-present)\n- Exceeded quota 6 quarters running, closed $4M ARR, managed pipeline in Salesforce, outbound prospecting, negotiation and closing\n- Ran discovery and demos, forecasting, territory planning\n" +
        "SKILLS\nSalesforce, quota, pipeline, prospecting, closing, negotiation",
    );
    expect(r.industry).toBe("sales");
    expect(r.secondaryIndustry).toBeUndefined();
  });
});
