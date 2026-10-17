// @vitest-environment node
/**
 * AN EXPORTED RÉSUMÉ IS READABLE, IN ITS OWN LANGUAGE, ON THE PAGE IT DECLARES.
 *
 * S12-006: jsPDF's built-in fonts draw only Windows-1252, so "Łukasz Wójcik"
 *          exported as "A u k a s z", letter-spaced and cut off, on the
 *          document an employer reads; meanwhile €, „ and œ (which draw fine)
 *          raised the warning. The table is now the real one, and a résumé the
 *          fonts cannot draw is never drawn: the Word file is saved instead.
 * S12-030: headings were English over a German résumé, and an empty name was
 *          printed as "Your Name".
 * S12-112: the Word tab stop was sized for US Letter on an A4 page (dates
 *          5.9 mm past the margin) and the author was "Un-named".
 * S12-029: a Hindi interview-prep guide was raw bytes in helvetica; it is now
 *          handed to the browser's print dialog, which draws every script.
 */
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import {
  buildResumeDocxDocument, buildResumePdf, DOCX_PAGE, DOCX_RIGHT_TAB, ResumeExportError,
  resumePdfUnsupported, resumeSectionLabels,
} from "../lib/resume-builder-export";
import { hasUnsupportedPdfCharacters, unsupportedPdfCharacters } from "../lib/pdf-text-support";
import { careerPathHtml, careerPathNeedsPrint, exportCareerPathPDF, exportInterviewPrepPDF, interviewPrepHtml, interviewPrepNeedsPrint } from "../lib/career-tools-export";
import { normalizeBuilderResume } from "../types/resume-builder";

const resumeOf = (over: Record<string, unknown> = {}, contact: Record<string, string> = {}) => normalizeBuilderResume({
  contact: { fullName: "Alexandra Chen", title: "Product Manager", email: "a@e.com", phone: "", location: "", linkedIn: "", website: "", ...contact },
  summary: "Product leader.",
  experience: [{ company: "Datadog", title: "Product Manager", location: "", startDate: "2021", endDate: "Present", bullets: ["Shipped a thing."] }],
  education: [{ school: "Berkeley", degree: "B.S.", field: "EECS", startDate: "2010", endDate: "2014", details: "" }],
  skills: ["SQL"], certifications: [],
  ...over,
});

const GERMAN = resumeOf({
  summary: "Ich bin eine erfahrene Pflegefachkraft mit fünf Jahren Erfahrung auf der Intensivstation und arbeite gerne im Team.",
  experience: [{ company: "Charité", title: "Pflegefachkraft", location: "Berlin", startDate: "2019", endDate: "heute", bullets: ["Betreuung von Patienten auf der Intensivstation und Zusammenarbeit mit dem ärztlichen Dienst", "Einarbeitung von neuen Kolleginnen und Kollegen für das Team"] }],
}, { fullName: "Anna Schmidt", title: "Pflegefachkraft" });

async function docxParts(doc: Awaited<ReturnType<typeof buildResumeDocxDocument>>) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  return { body: await zip.file("word/document.xml")!.async("string"), core: await zip.file("docProps/core.xml")!.async("string") };
}

describe("the WinAnsi table (S12-006)", () => {
  it("draws €, „, œ, Š and the Latin-1 letters; refuses Ł, ő, ğ, ₹ and arrows", () => {
    expect(hasUnsupportedPdfCharacters("€ „Zitat“ œuvre Šárka café naïve")).toBe(false);
    expect(unsupportedPdfCharacters("Łukasz Wójcik, Erdős, Doğan, ₹500 → ok")).toEqual(["Ł", "ő", "ğ", "₹", "→"]);
  });
});

describe("a résumé the PDF fonts cannot draw is never drawn (S12-006)", () => {
  it("buildResumePdf refuses it, naming the characters", async () => {
    const polish = resumeOf({}, { fullName: "Łukasz Wójcik" });
    expect(resumePdfUnsupported(polish)).toEqual(["Ł"]);
    await expect(buildResumePdf(polish)).rejects.toMatchObject({ code: "unsupported_characters", chars: ["Ł"] });
  });

  it("a résumé with €, „ or œ still exports as a PDF", async () => {
    const pdf = await buildResumePdf(resumeOf({ summary: "Budget von 2 Mio. € „pünktlich“, chef d’œuvre." }));
    expect(pdf.output("arraybuffer").byteLength).toBeGreaterThan(1500);
  });

  it("the Word file keeps every character", async () => {
    const { body } = await docxParts(await buildResumeDocxDocument(resumeOf({}, { fullName: "Łukasz Wójcik" })));
    expect(body).toContain("Łukasz Wójcik");
  });
});

describe("headings follow the résumé's language, and no placeholder name is printed (S12-030)", () => {
  it("a German résumé is headed in German, in the PDF and the Word file", async () => {
    expect(resumeSectionLabels(GERMAN)).toMatchObject({ summary: "Profil", experience: "Berufserfahrung", education: "Ausbildung" });
    const { body } = await docxParts(await buildResumeDocxDocument(GERMAN));
    expect(body).toContain("BERUFSERFAHRUNG");
    expect(body).not.toContain("EXPERIENCE");
  });

  it("an English résumé keeps English headings", () => {
    expect(resumeSectionLabels(resumeOf({ summary: "I lead the product team and work with engineers and designers on our roadmap for the year." })).experience).toBe("Experience");
  });

  it("a résumé with no name is refused, never printed as 'Your Name'", async () => {
    const nameless = resumeOf({}, { fullName: "  " });
    await expect(buildResumePdf(nameless)).rejects.toBeInstanceOf(ResumeExportError);
    await expect(buildResumeDocxDocument(nameless)).rejects.toMatchObject({ code: "missing_name" });
  });

  it("an entry with no title is headed by its company, not an English 'Role'", async () => {
    const r = resumeOf({ experience: [{ company: "Charité", title: "", location: "", startDate: "2019", endDate: "", bullets: ["x"] }] });
    const { body } = await docxParts(await buildResumeDocxDocument(r));
    expect(body).toContain("Charité");
    expect(body).not.toMatch(/>Role</);
  });
});

describe("the Word page and tab stop agree, and the file names its author (S12-112)", () => {
  it("declares A4 with one-inch margins, and the right tab stop sits on the right margin", async () => {
    const { body, core } = await docxParts(await buildResumeDocxDocument(resumeOf()));
    expect(body).toMatch(new RegExp(`<w:pgSz w:w="${DOCX_PAGE.width}" w:h="${DOCX_PAGE.height}"`));
    expect(body).toMatch(new RegExp(`w:left="${DOCX_PAGE.margin}"`));
    expect(DOCX_RIGHT_TAB).toBe(DOCX_PAGE.width - 2 * DOCX_PAGE.margin);
    expect(body).toMatch(new RegExp(`<w:tab w:val="right" w:pos="${DOCX_RIGHT_TAB}"`));
    expect(core).toContain("<dc:creator>Alexandra Chen</dc:creator>");
    expect(core).not.toContain("Un-named");
  });
});

describe("a Hindi interview-prep guide is printed by the browser (S12-029)", () => {
  const guide = (q: string) => ({
    interviewProfile: { targetRole: "डेटा विश्लेषक", difficulty: "Mid", interviewType: "Mixed" },
    questions: [{ category: "Behavioral", question: q, whyAsked: "x", strongAnswerTips: [], redFlags: [], sampleOpener: "y", difficulty: "Easy" }],
    interviewTips: { beforeInterview: [], duringInterview: [], closingQuestions: [] },
  });

  it("hands the guide to the print dialog with the Devanagari intact, escaped", async () => {
    const data = guide("अपनी सबसे बड़ी उपलब्धि के बारे में बताइए <script>");
    expect(interviewPrepNeedsPrint(data)).toBe(true);
    const print = vi.fn();
    expect(await exportInterviewPrepPDF(data, { print, lang: "hi" })).toEqual({ method: "print" });
    const html = print.mock.calls[0][0] as string;
    expect(html).toContain("अपनी सबसे बड़ी उपलब्धि");
    expect(html).toContain('lang="hi"');
    expect(html).not.toContain("<script>");
  });

  it("an English guide is still drawn as a PDF", () => {
    const data = guide("Tell me about a time you led a project.");
    data.interviewProfile.targetRole = "Data Analyst";
    expect(interviewPrepNeedsPrint(data)).toBe(false);
    expect(interviewPrepHtml(data)).toContain("Tell me about a time you led a project.");
  });
});

describe("a past buyer's Hindi career roadmap is printed by the browser too (S12-029)", () => {
  const roadmap = (name: string) => ({
    currentPosition: { title: "Analyst", level: "Mid", strengths: [], gaps: [] },
    paths: [{ name, description: "d", timeline: [{ year: "2027", role: "Lead", company: "Acme", salaryRange: "$90k", keyMove: "Ship" }], requiredSkills: ["SQL"], riskLevel: "Low", probability: "High", actionPlan90Days: ["Start"] }],
    immediateNextStep: "Update the résumé",
  });

  it("hands a Devanagari roadmap to the print dialog, escaped", async () => {
    const data = roadmap("प्रबंधन की ओर <b>");
    expect(careerPathNeedsPrint(data)).toBe(true);
    const print = vi.fn();
    expect(await exportCareerPathPDF(data, { print, lang: "hi" })).toEqual({ method: "print" });
    const html = print.mock.calls[0][0] as string;
    expect(html).toContain("प्रबंधन की ओर");
    expect(html).not.toContain("<b>");
  });

  it("an English roadmap is still drawn as a PDF", () => {
    expect(careerPathNeedsPrint(roadmap("Toward management"))).toBe(false);
    expect(careerPathHtml(roadmap("Toward management"))).toContain("Toward management");
  });
});
