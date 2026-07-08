// Country resume-standards module: coverage + deterministic checks.
// The data is transcribed from the 52-country standards report (July 2026);
// these tests pin the integration-critical behaviors, not the prose.

import { describe, it, expect } from "vitest";
import {
  COUNTRY_STANDARDS,
  evaluateCountryStandards,
} from "../../supabase/functions/free-keyword-scan/country-standards";

const BASE_RESUME = `Jordan Blake
jordan@email.com | +1 555 010 0000
EXPERIENCE
Software Engineer, Acme (2020-present)
- Built data pipelines processing 2M records daily
EDUCATION
BS Computer Science, State University
SKILLS
Python, SQL, AWS`;

describe("country standards data", () => {
  it("covers all 52 report countries plus GCC aliases", () => {
    // 52 in the report + KW/QA/BH/OM mapped to the Saudi/GCC entry
    expect(Object.keys(COUNTRY_STANDARDS).length).toBe(56);
  });

  it("flags exactly the report's 11 medium-confidence markets", () => {
    const medium = Object.values(COUNTRY_STANDARDS)
      .filter((c) => c.confidence === "medium")
      .map((c) => c.iso)
      .sort();
    expect(medium).toEqual(["BE", "CL", "CO", "DK", "FI", "GR", "KE", "MY", "PE", "PK", "UA"].sort());
  });

  it("keeps the five-value photo enum and the hard-no/expected poles", () => {
    for (const c of ["US", "CA", "GB", "IE", "AU", "NZ", "SG"]) {
      expect(COUNTRY_STANDARDS[c].photo).toBe("never");
    }
    for (const c of ["JP", "CN", "KR", "TW"]) {
      expect(COUNTRY_STANDARDS[c].photo).toBe("expected");
    }
  });

  it("maps wider GCC codes to the Saudi entry", () => {
    expect(COUNTRY_STANDARDS.QA.photo).toBe(COUNTRY_STANDARDS.SA.photo);
    expect(COUNTRY_STANDARDS.KW.checks).toContain("visa_status_gulf");
  });
});

describe("evaluateCountryStandards", () => {
  it("returns null for unknown or missing countries", () => {
    expect(evaluateCountryStandards(BASE_RESUME, null)).toBeNull();
    expect(evaluateCountryStandards(BASE_RESUME, "ZZ")).toBeNull();
  });

  it("always includes a photo-norm advisory that admits text can't see photos", () => {
    const r = evaluateCountryStandards(BASE_RESUME, "us");
    expect(r?.photoNorm).toBe("never");
    const photo = r?.advisories.find((a) => a.check === "photo_norm");
    expect(photo?.severity).toBe("critical");
    expect(photo?.message).toContain("can't detect photos");
  });

  it("flags DOB and marital status in minimal-data markets only", () => {
    const withDob = `${BASE_RESUME}\nDate of Birth: 04/12/1991\nMarital Status: Single`;
    const us = evaluateCountryStandards(withDob, "US");
    expect(us?.advisories.some((a) => a.check === "dob_present" && a.severity === "critical")).toBe(true);
    expect(us?.advisories.some((a) => a.check === "marital_present")).toBe(true);
    // Germany: DOB is common — no leak flag
    const de = evaluateCountryStandards(withDob, "DE");
    expect(de?.advisories.some((a) => a.check === "dob_present")).toBe(false);
  });

  it("flags a missing RODO clause in Poland and accepts a present one", () => {
    const missing = evaluateCountryStandards(BASE_RESUME, "PL");
    expect(missing?.advisories.some((a) => a.check === "rodo_pl" && a.severity === "critical")).toBe(true);
    const withClause = `${BASE_RESUME}\nWyrażam zgodę na przetwarzanie moich danych osobowych.`;
    const ok = evaluateCountryStandards(withClause, "PL");
    expect(ok?.advisories.some((a) => a.check === "rodo_pl")).toBe(false);
  });

  it("flags a missing Italian privacy-consent line", () => {
    const missing = evaluateCountryStandards(BASE_RESUME, "IT");
    expect(missing?.advisories.some((a) => a.check === "privacy_consent_it")).toBe(true);
    const withConsent = `${BASE_RESUME}\nAutorizzo il trattamento dei miei dati personali ai sensi del D.Lgs. 196/2003.`;
    expect(evaluateCountryStandards(withConsent, "IT")?.advisories.some((a) => a.check === "privacy_consent_it")).toBe(false);
  });

  it("flags missing Gulf visa status and missing references where expected", () => {
    const ae = evaluateCountryStandards(BASE_RESUME, "AE");
    expect(ae?.advisories.some((a) => a.check === "visa_status_gulf")).toBe(true);
    const withVisa = `${BASE_RESUME}\nVisa Status: Employment Visa (Transferable)`;
    expect(evaluateCountryStandards(withVisa, "AE")?.advisories.some((a) => a.check === "visa_status_gulf")).toBe(false);
    const za = evaluateCountryStandards(BASE_RESUME, "ZA");
    expect(za?.advisories.some((a) => a.check === "references_expected")).toBe(true);
  });

  it("carries the structured-form explainer for Japan and the split-market note for India", () => {
    expect(evaluateCountryStandards(BASE_RESUME, "JP")?.structuredFormNote).toContain("rirekisho");
    expect(evaluateCountryStandards(BASE_RESUME, "IN")?.splitMarketNote).toContain("multinational");
  });

  it("softens critical photo advisories in medium-confidence markets", () => {
    const dk = evaluateCountryStandards(BASE_RESUME, "DK");
    expect(dk?.confidence).toBe("medium");
    const photo = dk?.advisories.find((a) => a.check === "photo_norm");
    expect(photo?.message).toContain("Directional guidance");
  });

  it("flags national ID patterns everywhere", () => {
    const withId = `${BASE_RESUME}\nCNIC: 35202-1234567-1`;
    expect(evaluateCountryStandards(withId, "PK")?.advisories.some((a) => a.check === "national_id_present")).toBe(true);
  });
});
