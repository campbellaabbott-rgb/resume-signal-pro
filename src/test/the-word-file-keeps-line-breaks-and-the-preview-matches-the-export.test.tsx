/**
 * THE WORD FILE KEEPS LINE BREAKS, AND THE PREVIEW MATCHES THE EXPORT
 * (S14X-187: M-S14-164, C-S14-139, C-S14-140).
 *
 * C-S14-139. A summary typed on two lines went into the Word file as one run
 * holding a raw newline, which Word shows as a space: the two lines ran
 * together. Each line break is now a Word break (<w:br/>).
 *
 * C-S14-140. The exports head a résumé in its own language, but knew no Hindi
 * or Tagalog, so a Devanagari résumé went out under "EXPERIENCE". And the
 * preview beside the editor headed every résumé in the reader's interface
 * language, so a German résumé read "EXPERIENCE" in the preview and
 * "BERUFSERFAHRUNG" in the file it downloaded. Both now take their headings
 * from resumeSectionLabels; when the résumé's language is not clear they use
 * the reader's language, but never one written in another script.
 *
 * M-S14-164. The preview headed an entry with no title "Role", in English,
 * where the exports head it by its company.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import JSZip from "jszip";
import { Packer } from "docx";
import i18n from "@/i18n";
import { buildResumeDocxDocument, resumeSectionLabels } from "@/lib/resume-builder-export";
import { ResumePreview } from "@/components/builder/ResumePreview";
import type { BuilderResume } from "@/types/resume-builder";

const resume = (over: Partial<BuilderResume> = {}): BuilderResume => ({
  contact: { fullName: "Jordan Probe", title: "Analyst", email: "", phone: "", location: "", linkedIn: "", website: "" },
  summary: "",
  experience: [{ id: "e1", company: "Acme", title: "Analyst", location: "", startDate: "2020", endDate: "2024", bullets: ["Built a report."] }],
  education: [],
  skills: [],
  certifications: [],
  ...over,
});

const GERMAN = resume({
  summary: "Ich bin eine erfahrene Pflegefachkraft mit fünf Jahren Erfahrung auf der Intensivstation und arbeite gerne im Team mit den Kolleginnen.",
  experience: [{ id: "g1", company: "Charité", title: "Pflegefachkraft", location: "Berlin", startDate: "2019", endDate: "heute", bullets: ["Betreuung von Patienten auf der Intensivstation und Zusammenarbeit mit dem ärztlichen Dienst"] }],
});

const HINDI = resume({
  contact: { fullName: "Jordan Probe", title: "विश्लेषक", email: "", phone: "", location: "", linkedIn: "", website: "" },
  summary: "मेरे पास डेटा विश्लेषण में पाँच साल का अनुभव है और मैंने टीम के साथ काम किया है।",
  experience: [{ id: "h1", company: "Acme", title: "वरिष्ठ विश्लेषक", location: "", startDate: "2020", endDate: "2024", bullets: ["साप्ताहिक रिपोर्ट बनाई और समय आधा किया।"] }],
});

const TAGALOG = resume({
  summary: "Ako ay isang analyst na may limang taon ng karanasan sa pagsusuri ng datos para sa mga kumpanya at sa aming koponan.",
  experience: [{ id: "t1", company: "Acme", title: "Analyst", location: "", startDate: "2020", endDate: "2024", bullets: ["Gumawa ng lingguhang ulat para sa koponan at pinabilis ang trabaho ng mga kasama."] }],
});

/** A résumé whose few words name no language. */
const TERSE = resume({ contact: { fullName: "Jordan Probe", title: "", email: "", phone: "", location: "", linkedIn: "", website: "" }, experience: [{ id: "x1", company: "Acme", title: "Analyst", location: "", startDate: "", endDate: "", bullets: ["SQL dashboards"] }] });

async function documentXml(r: BuilderResume): Promise<string> {
  const blob = await Packer.toBlob(await buildResumeDocxDocument(r));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file("word/document.xml")!.async("string");
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("a line break in the Word file (C-S14-139)", () => {
  it("becomes a Word break, never a raw newline Word shows as a space", async () => {
    const xml = await documentXml(resume({ summary: "First line of the summary.\nSecond line of the summary." }));
    const at = xml.indexOf("First line of the summary.");
    expect(at).toBeGreaterThanOrEqual(0);
    const near = xml.slice(at, at + 600);
    expect(near).toMatch(/<w:br\s*\/>/);
    expect(near).toContain("Second line of the summary.");
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*\n[^<]*<\/w:t>/);
  });

  it("a bullet written on two lines keeps both, one under the other", async () => {
    const xml = await documentXml(resume({ experience: [{ id: "e1", company: "Acme", title: "Analyst", location: "", startDate: "", endDate: "", bullets: ["Owned the budget\r\nacross three regions"] }] }));
    expect(xml).toMatch(/Owned the budget<\/w:t>[\s\S]{0,200}<w:br\s*\/>[\s\S]{0,200}across three regions/);
  });
});

describe("headings in the résumé's own language (C-S14-140)", () => {
  it("a Devanagari résumé gets Hindi headings", () => {
    const labels = resumeSectionLabels(HINDI);
    expect(labels.experience).not.toBe("Experience");
    expect(labels.experience).toMatch(/\p{Script=Devanagari}/u);
  });

  it("a Tagalog résumé gets Tagalog headings", () => {
    expect(resumeSectionLabels(TAGALOG).experience).not.toBe("Experience");
    expect(resumeSectionLabels(TAGALOG).experience).toMatch(/Karanasan/);
  });

  it("an unclear résumé takes the reader's language, but never one in another script", () => {
    expect(resumeSectionLabels(TERSE).experience).toBe("Experience");
    expect(resumeSectionLabels(TERSE, { uiLanguage: "de" }).experience).toBe("Berufserfahrung");
    expect(resumeSectionLabels(TERSE, { uiLanguage: "fr-CA" }).experience).toBe("Expérience professionnelle");
    expect(resumeSectionLabels(TERSE, { uiLanguage: "hi" }).experience, "Devanagari headings over a Latin résumé").toBe("Experience");
    expect(resumeSectionLabels(GERMAN, { uiLanguage: "fr" }).experience, "a clear language beats the reader's").toBe("Berufserfahrung");
  });

  it("the Word file of a Hindi résumé carries the Hindi heading", async () => {
    const xml = await documentXml(HINDI);
    expect(xml).toContain(resumeSectionLabels(HINDI).experience);
    expect(xml).not.toContain(">EXPERIENCE<");
  });
});

describe("the preview matches the export (C-S14-140, M-S14-164)", () => {
  it("a German résumé is headed in German in the preview under an English interface", () => {
    render(<ResumePreview resume={GERMAN} />);
    expect(screen.getByRole("heading", { name: "Berufserfahrung" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Experience$/i })).toBeNull();
  });

  it("an unclear résumé is headed in the reader's language", async () => {
    await i18n.changeLanguage("de");
    render(<ResumePreview resume={TERSE} />);
    expect(screen.getByRole("heading", { name: "Berufserfahrung" })).toBeTruthy();
  });

  it("an entry with no title is headed by its company, never an English 'Role'", () => {
    const { container } = render(<ResumePreview resume={resume({ experience: [{ id: "c1", company: "Charité", title: "", location: "Berlin", startDate: "2019", endDate: "", bullets: ["x"] }] })} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("Role");
    expect(screen.getByText("Charité")).toBeTruthy();
    // The company is the heading, so the line under it carries the location only, as in the export.
    expect(screen.getByText("Berlin")).toBeTruthy();
    expect(text).not.toContain("Charité — Berlin");
  });

  it("a bullet's line break shows in the preview as in the file", () => {
    render(<ResumePreview resume={resume({ experience: [{ id: "e1", company: "Acme", title: "Analyst", location: "", startDate: "", endDate: "", bullets: ["Owned the budget\nacross three regions"] }] })} />);
    const li = screen.getByText(/Owned the budget/);
    expect(li.className).toMatch(/whitespace-pre-wrap/);
  });
});
