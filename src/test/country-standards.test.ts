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

  it("flags a missing RODO clause in Poland as a warning, not a legal bar, and accepts a present one", () => {
    const missing = evaluateCountryStandards(BASE_RESUME, "PL");
    expect(missing?.advisories.some((a) => a.check === "rodo_pl" && a.severity === "warning")).toBe(true);
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

// ── Bug round 2026-11-12, lane free-scan-engine ──────────────────────────
const checksOf = (text: string, iso: string) => evaluateCountryStandards(text, iso)?.advisories ?? [];
const severityOf = (text: string, iso: string, check: string) => checksOf(text, iso).find((a) => a.check === check)?.severity;

describe("S14X-027: each personal-data field a minimal-data market leaves out is named", () => {
  it.each([
    ["DOB: 01/02/1990", "dob_present"],
    ["Age: 34", "age_present"],
    ["Born 1990", "dob_present"],
    ["Nationality: Indian", "nationality_present"],
    ["Gender: Female", "gender_present"],
  ])("on a US résumé, %s is flagged as %s", (line, check) => {
    expect(checksOf(`${BASE_RESUME}\n${line}`, "US").some((a) => a.check === check)).toBe(true);
  });

  it("in Germany, where the Lebenslauf carries it, a Geburtsdatum line is not flagged", () => {
    const de = checksOf(`${BASE_RESUME}\nGeburtsdatum: 04.12.1991`, "DE");
    expect(de.some((a) => a.check === "dob_present")).toBe(false);
  });

  it("control: a plain US résumé raises none of them", () => {
    const us = checksOf(BASE_RESUME, "US").map((a) => a.check);
    for (const c of ["dob_present", "age_present", "nationality_present", "gender_present"]) expect(us).not.toContain(c);
  });
});

describe("S14X-029: Italy's consent line is read by what it says, and its absence is information", () => {
  it.each([
    "Acconsento al trattamento dei dati personali ai sensi del Regolamento UE 2016/679",
    "Consenso al trattamento dei dati ai sensi del GDPR 2016/679",
    "I authorise the processing of my personal data",
  ])("'%s' counts as present", (line) => {
    expect(checksOf(`${BASE_RESUME}\n${line}`, "IT").some((a) => a.check === "privacy_consent_it")).toBe(false);
  });

  it("a CV with none gets an info line, and the conventions no longer say CVs are filtered out", () => {
    expect(severityOf(BASE_RESUME, "IT", "privacy_consent_it")).toBe("info");
    expect(COUNTRY_STANDARDS.IT.conventions.join(" ")).not.toMatch(/filtered out/i);
  });
});

describe("S14X-030: Poland's consent clause is a clause, not three letters inside a bank's name", () => {
  it("'Narodowy Bank Polski' alone does not stand in for the clause", () => {
    const cv = `${BASE_RESUME}\nAnalyst, Narodowy Bank Polski (2016-2019)`;
    expect(checksOf(cv, "PL").some((a) => a.check === "rodo_pl")).toBe(true);
  });

  it.each([
    "I hereby agree to the processing of my personal data for the purposes of recruitment.",
    "Zgadzam się na przetwarzanie moich danych osobowych w celu rekrutacji.",
  ])("'%s' passes", (line) => {
    expect(checksOf(`${BASE_RESUME}\n${line}`, "PL").some((a) => a.check === "rodo_pl")).toBe(false);
  });

  it("the missing clause is a warning, and the conventions state no legal bar", () => {
    expect(severityOf(BASE_RESUME, "PL", "rodo_pl")).toBe("warning");
    expect(COUNTRY_STANDARDS.PL.conventions.join(" ")).not.toMatch(/cannot process/i);
  });
});

describe("S14X-031: a qualified references heading is a references section", () => {
  it("the Philippines' 'CHARACTER REFERENCES' and South Africa's 'Professional References' satisfy the check", () => {
    const ph = `${BASE_RESUME}\nCHARACTER REFERENCES\nMaria Cruz, HR Manager, Acme Manila, +63 917 000 0000`;
    const za = `${BASE_RESUME}\nProfessional References\nThabo Nkosi, Engineering Lead, Acme Johannesburg, +27 82 000 0000`;
    expect(checksOf(ph, "PH").some((a) => a.check === "references_expected")).toBe(false);
    expect(checksOf(za, "ZA").some((a) => a.check === "references_expected")).toBe(false);
  });
});

describe("S14X-130: Spain's DNI and NIE are information there; a US SSN is still critical", () => {
  it.each(["DNI: 12345678Z", "NIE: X1234567L"])("ES '%s' reads as a national ID at info", (line) => {
    expect(severityOf(`${BASE_RESUME}\n${line}`, "ES", "national_id_present")).toBe("info");
  });

  it("US 'SSN: 123-45-6789' stays critical", () => {
    expect(severityOf(`${BASE_RESUME}\nSSN: 123-45-6789`, "US", "national_id_present")).toBe("critical");
  });
});

describe("S14X-131: a Gulf visa status is read however it is written", () => {
  it.each(["Residence Visa (Transferable)", "Own sponsorship", "Dependent Visa", "Visa: Employment"])("AE '%s' raises no visa warning", (line) => {
    expect(checksOf(`${BASE_RESUME}\n${line}`, "AE").some((a) => a.check === "visa_status_gulf")).toBe(false);
  });

  it("a CV with none still warns", () => {
    expect(severityOf(BASE_RESUME, "AE", "visa_status_gulf")).toBe("warning");
  });
});
