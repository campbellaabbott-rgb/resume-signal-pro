// @vitest-environment node
/**
 * THE SECTION AUDIT COUNTS ONLY WHOLE-LINE HEADINGS (bug audit NB-19; with
 * NB-6, the audit in the résumé's own language).
 *
 * The Section Length Audit opened a section at any short line that held a
 * section word: an employer named "University Hospital" became the Education
 * section and a "Tools:" line inside a role became Skills, so an ordinary
 * English CV's experience was cut short and its education padded. A
 * Spanish CV had no English words at all and every section read missing.
 * A heading is now a whole line that is a heading phrase, in English or in
 * the résumé's own language (resume-structure.ts headingSectionOf); a CV in
 * a language the table does not hold gets no audit rather than a wrong one.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { loadScanners, resetWorld, scanPrimary } from "./helpers/free-scan-world";
import { headingSectionOf } from "../../supabase/functions/free-keyword-scan/resume-structure";
import { NURSE } from "./fixtures/one-cv-in-several-languages";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const CV = [
  "Chris Okafor | chris.okafor@example.com | (617) 555-0142 | Boston, MA",
  "SUMMARY",
  "Clinical operations analyst with seven years in hospital scheduling, capacity planning and reporting for nursing leadership.",
  "EXPERIENCE",
  "Operations Analyst",
  "University Hospital",
  "Jan 2021 - Present",
  "- Built a bed-capacity forecast that cut weekend diversions by 30%",
  "- Automated the daily staffing report used by 14 unit managers",
  "Tools: Excel, SQL, Tableau",
  "- Ran the quarterly length-of-stay review with finance and nursing",
  "Scheduling Coordinator, Mercy Clinic, Jun 2017 - Dec 2020",
  "- Scheduled 40 clinicians across three sites every week",
  "EDUCATION",
  "BSc Health Administration, Boston University, 2017",
  "SKILLS",
  "Capacity planning, forecasting, SQL, Excel, Tableau, stakeholder reporting",
].join("\n");

/** Words from a heading line through the line before the next heading, as the audit counts them. */
function blockWords(text: string, heading: string, next: string | null): number {
  const lines = text.split("\n");
  const from = lines.indexOf(heading);
  const to = next ? lines.indexOf(next) : lines.length;
  return lines.slice(from, to).join(" ").split(/\s+/).filter(Boolean).length;
}

describe("a heading is a whole line", () => {
  it("an employer's name and a tools line inside a role open no section; real headings do", () => {
    expect(headingSectionOf("University Hospital")).toBeNull();
    expect(headingSectionOf("Tools: Excel, SQL, Tableau")).toBeNull();
    expect(headingSectionOf("EDUCATION")).toBe("education");
    expect(headingSectionOf("Technical Skills:")).toBe("skills");
    expect(headingSectionOf("PERSONAL STATEMENT")).toBe("summary");
    expect(headingSectionOf("Experiencia laboral", "es")).toBe("experience");
    expect(headingSectionOf("Experiencia laboral")).toBeNull();
  });
});

describe("the primary's Section Length Audit", () => {
  let primary: EdgeHandler;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => { ({ primary } = await loadScanners(["primary"])); }, 240_000);
  beforeEach(() => {
    resetWorld();
    for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

  it("counts an English CV's experience to its end and its education alone", async () => {
    const { json } = await scanPrimary(primary, { resumeText: CV });
    const counts = json.sectionWordCounts as Record<string, { current: number }>;
    expect(counts.experience.current).toBe(blockWords(CV, "EXPERIENCE", "EDUCATION"));
    expect(counts.education.current).toBe(blockWords(CV, "EDUCATION", "SKILLS"));
    expect(counts.skills.current).toBe(blockWords(CV, "SKILLS", null));
  });

  it("NB-6: a Spanish CV's four sections are counted under its own headings", async () => {
    const { json } = await scanPrimary(primary, { resumeText: String(NURSE.texts.es) });
    const counts = json.sectionWordCounts as Record<string, { current: number }>;
    for (const s of ["summary", "experience", "education", "skills"]) expect(counts[s].current, s).toBeGreaterThan(0);
  });

  it("NB-6: a CV in a language the heading table does not hold gets no audit, not one that calls every section missing", async () => {
    const polish = [
      "Anna Kowalska | anna.kowalska@example.com | +48 600 123 456 | Kraków",
      "Podsumowanie zawodowe",
      "Księgowa z ośmioletnim doświadczeniem w rozliczeniach podatkowych i sprawozdawczości finansowej dla średnich firm produkcyjnych.",
      "Doświadczenie zawodowe",
      "Główna księgowa, Fabryka Mebli Wawel, styczeń 2020 - obecnie",
      "- Przygotowywałam miesięczne zamknięcia ksiąg i sprawozdania dla zarządu oraz banku finansującego",
      "- Skróciłam czas zamknięcia miesiąca z dziesięciu do sześciu dni roboczych dzięki nowym procedurom",
      "Księgowa, Biuro Rachunkowe Kraków, marzec 2016 - grudzień 2019",
      "- Prowadziłam pełną księgowość dla dwudziestu klientów i rozliczenia podatku VAT",
      "Wykształcenie",
      "Magister ekonomii, Uniwersytet Ekonomiczny w Krakowie, 2016",
      "Umiejętności",
      "Rachunkowość, podatki, Excel, SAP, Comarch ERP, sprawozdawczość finansowa",
    ].join("\n");
    const { json } = await scanPrimary(primary, { resumeText: polish });
    expect(json.sectionWordCounts).toBeUndefined();
  });
});
