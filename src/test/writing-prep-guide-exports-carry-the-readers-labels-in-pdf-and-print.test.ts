/**
 * THE PREP GUIDE AND THE ROADMAP EXPORT IN THE READER'S LANGUAGE, AND THE
 * PRINT COPY CARRIES EVERY LABEL THE PDF DRAWS (RC-S12-114, S14X-167).
 *
 * The exported Interview Prep Guide and Career Roadmap drew their headings
 * and labels in English ("Why they ask:", "Questions to Ask Them", "Skills to
 * develop:") inside an otherwise translated guide, and the browser-print copy
 * (used when jsPDF's fonts cannot draw the script) left several of them out.
 * The labels now come from the page, translated, and both copies print the
 * same labels.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import DE from "@/i18n/shards/writing-tools/de.json";
import { EN_LABELS, labelsFrom } from "./helpers/export-labels";

const drawn = vi.hoisted(() => [] as string[]);
vi.mock("jspdf", async (importOriginal) => {
  const real = await importOriginal<typeof import("jspdf")>();
  const Real = real.default as unknown as new (...a: unknown[]) => { text: (...a: unknown[]) => unknown };
  function Recording(this: unknown, ...args: unknown[]) {
    const doc = new Real(...args);
    const text = doc.text.bind(doc);
    doc.text = (t: unknown, ...rest: unknown[]) => { drawn.push(...[t].flat().map(String)); return text(t, ...rest); };
    return doc;
  }
  return { ...real, default: Recording, jsPDF: Recording };
});

import { careerPathHtml, exportCareerPathPDF, exportInterviewPrepPDF, interviewPrepHtml } from "@/lib/career-tools-export";

const GERMAN = labelsFrom(DE as never);
const ENGLISH_PREP = ["Interview Prep Guide", "Why they ask:", "Strong opener:", "Model Answer", "Tips:", "Avoid:", "Before the Interview", "During the Interview", "Questions to Ask Them"];
const ENGLISH_PATH = ["Career Roadmap", "Current:", "Skills to develop:", "90-Day Action Plan:", "Do This Week"];

const PREP = {
  interviewProfile: { targetRole: "Senior-Softwareentwickler", difficulty: "Schwer", interviewType: "Technisch" },
  questions: [{
    category: "Verhalten", question: "Erzählen Sie von einem Konflikt im Team.", whyAsked: "Zeigt, wie Sie zusammenarbeiten.",
    strongAnswerTips: ["STAR verwenden"], redFlags: ["Anderen die Schuld geben"], sampleOpener: "In meiner Rolle bei Acme",
    modelAnswer: "Eine vollständige Musterantwort.", difficulty: "Mittel",
  }],
  interviewTips: { beforeInterview: ["Das Unternehmen recherchieren"], duringInterview: ["Rückfragen stellen"], closingQuestions: ["Wie sieht Erfolg aus?"] },
};
const PATH = {
  currentPosition: { title: "Softwareentwickler", level: "Mittel", strengths: ["Grundlagen"], gaps: ["Führung"] },
  paths: [{
    name: "Fachlaufbahn", description: "Weiter als Fachkraft.", timeline: [{ year: "2026", role: "Senior", company: "Aktuell", salaryRange: "70-80k", keyMove: "Projekt leiten" }],
    requiredSkills: ["Systemdesign"], riskLevel: "Niedrig", probability: "Hoch", actionPlan90Days: ["Ein Projekt leiten"],
  }],
  immediateNextStep: "Um ein Stretch-Projekt bitten.",
};

const page = () => drawn.join(" ").replace(/\s+/g, " ");

beforeEach(() => {
  drawn.length = 0;
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("a German reader's exports", () => {
  it("the prep guide's PDF draws the German labels and no English one", async () => {
    expect(await exportInterviewPrepPDF(PREP as never, GERMAN.prep, { lang: "de" })).toEqual({ method: "pdf" });
    const text = page();
    for (const label of Object.values(GERMAN.prep)) expect(text, label).toContain(label);
    for (const english of ENGLISH_PREP) expect(text).not.toContain(english);
  });

  it("the roadmap's PDF draws the German labels and no English one", async () => {
    expect(await exportCareerPathPDF(PATH as never, GERMAN.path, { lang: "de" })).toEqual({ method: "pdf" });
    const text = page();
    for (const label of [GERMAN.path.title, GERMAN.path.current, GERMAN.path.skills, GERMAN.path.actionPlan, GERMAN.path.thisWeek, GERMAN.path.odds("Hoch", "Niedrig")]) {
      expect(text, label).toContain(label);
    }
    for (const english of ENGLISH_PATH) expect(text).not.toContain(english);
  });
});

describe("the print copy is the same document (S14X-167)", () => {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  for (const [name, labels] of [["English", EN_LABELS], ["German", GERMAN]] as const) {
    it(`${name}: every label the prep guide's PDF draws is in its print copy`, async () => {
      await exportInterviewPrepPDF(PREP as never, labels.prep);
      const text = page();
      const html = interviewPrepHtml(PREP as never, labels.prep, "de");
      const drawnLabels = Object.values(labels.prep).filter((l) => text.includes(l));
      expect(drawnLabels.length).toBe(Object.values(labels.prep).length);
      for (const label of drawnLabels) expect(html, label).toContain(escape(label));
    });

    it(`${name}: every label the roadmap's PDF draws is in its print copy`, async () => {
      await exportCareerPathPDF(PATH as never, labels.path);
      const text = page();
      const html = careerPathHtml(PATH as never, labels.path, "de");
      const all = [labels.path.title, labels.path.current, labels.path.skills, labels.path.actionPlan, labels.path.thisWeek, labels.path.odds("Hoch", "Niedrig")];
      for (const label of all) {
        expect(text, label).toContain(label);
        expect(html, label).toContain(escape(label));
      }
    });
  }
});
