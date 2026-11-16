import type { BuilderResume } from "@/types/resume-builder";
import { sanitizeExportText, unsupportedPdfCharacters } from "@/lib/pdf-text-support";
import { educationEntryHasContent, experienceEntryHasContent } from "@/lib/builder-import";
import { resumeSectionLabels, type SectionLabels } from "@/lib/resume-section-labels";

// The headings live in their own module so the page's preview reads the same
// ones without importing this file (S14X-187); re-exported for the callers
// and tests that have always found them here.
export { resumeSectionLabels };
export type { SectionLabels };

/**
 * WHY AN EXPORT IS REFUSED (S12-006, S12-030).
 *
 *   - missing_name: a résumé with no name went out headed "Your Name", in
 *     English, over whatever language the résumé was written in. A résumé an
 *     employer reads needs the person's own name, so the export asks for it.
 *   - unsupported_characters: jsPDF's built-in fonts draw only Windows-1252
 *     (WinAnsi). "Łukasz Wójcik" came out as "A u k a s z", letter-spaced and
 *     cut off, on the document an employer reads. No embedded font ships yet,
 *     so the PDF is not drawn at all; exportResumeBuilderPDF saves the Word
 *     file instead (Word draws every character) and says why.
 */
export class ResumeExportError extends Error {
  constructor(public code: "missing_name" | "unsupported_characters", public chars: string[] = []) {
    super(code === "missing_name" ? "The résumé has no name." : `The PDF font cannot draw: ${chars.join(" ")}`);
    this.name = "ResumeExportError";
  }
}

const text = (v: unknown): string => sanitizeExportText(typeof v === "string" ? v : "");
/** A field printed on one line: a pasted line break is a space. */
const oneLine = (v: unknown): string => text(v).replace(/[ \t]*(?:\r\n|\r|\n)+[ \t]*/g, " ");
/** A field that may hold lines (the summary, a bullet, a school's details): breaks are "\n". */
const lines = (v: unknown): string => text(v).replace(/\r\n|\r/g, "\n");
const blank = (s: string) => !s.trim();

/**
 * THE RÉSUMÉ AN EXPORT DRAWS (S14X-034, S14X-035).
 *
 * Every string passes through sanitizeExportText (pdf-text-support): a pasted
 * soft line break is a line break, the invisible format characters are gone,
 * ligatures and Unicode hyphens are their letters. Before, each one alone
 * made the PDF refuse the résumé and save a Word file instead, and U+000B
 * went into that Word file raw, which Word then refused to open.
 *
 * An entry with nothing in it is left out, and so is a blank skill or
 * certification: a new résumé starts with one blank job and one blank
 * school, and the exports printed EXPERIENCE over nothing.
 */
export function exportableResume(resume: BuilderResume): BuilderResume {
  const c = resume.contact ?? ({} as BuilderResume["contact"]);
  return {
    contact: {
      fullName: oneLine(c.fullName), title: oneLine(c.title), email: oneLine(c.email), phone: oneLine(c.phone),
      location: oneLine(c.location), linkedIn: oneLine(c.linkedIn), website: oneLine(c.website),
    },
    summary: lines(resume.summary),
    experience: (resume.experience ?? [])
      .map((e) => ({
        ...e,
        company: oneLine(e.company), title: oneLine(e.title), location: oneLine(e.location),
        startDate: oneLine(e.startDate), endDate: oneLine(e.endDate),
        bullets: (e.bullets ?? []).map(lines).filter((b) => !blank(b)),
      }))
      .filter(experienceEntryHasContent),
    education: (resume.education ?? [])
      .map((e) => ({
        ...e,
        school: oneLine(e.school), degree: oneLine(e.degree), field: oneLine(e.field),
        startDate: oneLine(e.startDate), endDate: oneLine(e.endDate), details: lines(e.details),
      }))
      .filter(educationEntryHasContent),
    skills: (resume.skills ?? []).map(oneLine).filter((s) => !blank(s)),
    certifications: (resume.certifications ?? []).map(oneLine).filter((s) => !blank(s)),
  };
}

/** Every text an export of this (already exportable) résumé draws. */
function resumeTexts(resume: BuilderResume): string[] {
  const c = resume.contact;
  return [
    c.fullName, c.title, c.email, c.phone, c.location, c.linkedIn, c.website,
    resume.summary,
    ...resume.experience.flatMap((e) => [e.company, e.title, e.location, e.startDate, e.endDate, ...e.bullets]),
    ...resume.education.flatMap((e) => [e.school, e.degree, e.field, e.startDate, e.endDate, e.details]),
    ...resume.skills,
    ...resume.certifications,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
}

/**
 * The characters in this résumé the PDF's built-in fonts cannot draw (empty
 * when it can draw them all), read after sanitizing, and counting the
 * headings the PDF would print over it.
 */
export function resumePdfUnsupported(resume: BuilderResume, options: ResumeExportOptions = {}): string[] {
  const r = exportableResume(resume);
  const labels = resumeSectionLabels(r, { uiLanguage: options.uiLanguage });
  return unsupportedPdfCharacters([...resumeTexts(r), ...Object.values(labels)].join("\n"));
}

// jspdf and docx are dynamically imported inside each export function rather than
// statically here, so the Resume Builder page's own chunk doesn't carry ~550KB of
// export libraries until the user actually clicks an export button.

// Previously only replaced whitespace with underscores, leaving characters
// invalid on Windows/macOS/Linux filesystems (/ \ : * ? " < > |) untouched —
// a name like "Mary/Jane O'Brien" would produce a filename the OS either
// rejects outright or silently mangles. Strips those, collapses repeated
// underscores from adjacent stripped characters, and trims leading/trailing
// underscores so "  / Mary / " doesn't become "_Mary_".
// ── Templates ───────────────────────────────────────────────────────────────
// Three print-quality, ATS-safe single-column templates. Same structure,
// different type systems — every one is something a candidate would actually
// submit. "modern" is the default and matches the product's own look.
export type ResumeTemplate = "modern" | "classic" | "compact";

export interface ResumeExportOptions {
  template?: ResumeTemplate;
  /**
   * The reader's interface language. The headings follow the résumé's own
   * language; this is used only when that is not clear (resume-section-labels).
   */
  uiLanguage?: string;
}

interface TemplateSpec {
  pdfFont: "helvetica" | "times";
  docxFont: string;
  accentHex: string;
  accentRGB: [number, number, number];
  ruleRGB: [number, number, number];
  margin: number;
  name: number;   // pt
  heading: number;
  body: number;
  lh: number;     // mm line height for body
}

const TEMPLATES: Record<ResumeTemplate, TemplateSpec> = {
  modern: { pdfFont: "helvetica", docxFont: "Calibri", accentHex: "1F3A5F", accentRGB: [31, 58, 95], ruleRGB: [31, 58, 95], margin: 18, name: 20, heading: 12, body: 10, lh: 5 },
  classic: { pdfFont: "times", docxFont: "Georgia", accentHex: "000000", accentRGB: [0, 0, 0], ruleRGB: [70, 70, 70], margin: 20, name: 21, heading: 12.5, body: 10.5, lh: 5.2 },
  compact: { pdfFont: "helvetica", docxFont: "Calibri", accentHex: "222222", accentRGB: [34, 34, 34], ruleRGB: [150, 150, 150], margin: 14, name: 16, heading: 10.5, body: 9, lh: 4.3 },
};

export function sanitizeFilename(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "resume";
}

function formatDateRange(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return "";
  if (!startDate) return endDate;
  if (!endDate) return startDate;
  return `${startDate} – ${endDate}`;
}

// Builds the jsPDF document (no save) — kept separate from the download so the
// exact rendering can be unit-tested / rendered headless.
export async function buildResumePdf(input: BuilderResume, options: ResumeExportOptions = {}) {
  // Resolve the constructor from whichever slot the bundler/runtime exposes —
  // vite gives it on .default, Node ESM interop gives it on .jsPDF. Picking
  // the one that's actually a function works in both without surprises.
  // Refused before anything is drawn (see ResumeExportError).
  const resume = exportableResume(input);
  if (!resume.contact.fullName.trim()) throw new ResumeExportError("missing_name");
  const unsupported = resumePdfUnsupported(resume, options);
  if (unsupported.length > 0) throw new ResumeExportError("unsupported_characters", unsupported);
  const labels = resumeSectionLabels(resume, { uiLanguage: options.uiLanguage });

  const jsPDFModule = await import("jspdf");
  const jsPDF = (typeof jsPDFModule.default === "function" ? jsPDFModule.default : jsPDFModule.jsPDF) as typeof jsPDFModule.jsPDF;
  const spec = TEMPLATES[options.template ?? "modern"];
  const F = spec.pdfFont;

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = spec.margin;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (lineHeight: number) => {
    if (y + lineHeight > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  const addWrappedText = (text: string, fontSize: number, lineHeight: number, isBold = false) => {
    if (!text) return;
    pdf.setFontSize(fontSize);
    pdf.setFont(F, isBold ? "bold" : "normal");
    const lines = pdf.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, margin, y);
      y += lineHeight;
    }
  };

  // Inline list (skills, certs, contact) fitted by hand so the " • " separator
  // only ever sits BETWEEN two items on a line — never dangling at a wrap
  // boundary the way join()+splitTextToSize leaves it. An item wider than the
  // text column is wrapped on lines of its own (S14X-186): it used to be drawn
  // whole, past the right edge of the page.
  const addInlineList = (items: string[], fontSize: number, lineHeight: number, sep = "  •  ") => {
    const parts = items.filter(Boolean);
    if (parts.length === 0) return;
    pdf.setFontSize(fontSize);
    pdf.setFont(F, "normal");
    let line = "";
    const flush = () => {
      if (!line) return;
      ensureSpace(lineHeight);
      pdf.text(line, margin, y);
      y += lineHeight;
      line = "";
    };
    for (const item of parts) {
      if (pdf.getTextWidth(item) > contentWidth) {
        flush();
        for (const piece of pdf.splitTextToSize(item, contentWidth) as string[]) {
          ensureSpace(lineHeight);
          pdf.text(piece, margin, y);
          y += lineHeight;
        }
        continue;
      }
      const candidate = line ? line + sep + item : item;
      if (line && pdf.getTextWidth(candidate) > contentWidth) {
        flush();
        line = item;
      } else {
        line = candidate;
      }
    }
    flush();
  };

  // A heading keeps room for the first thing printed under it (S14X-287):
  // reserving room for itself only, it could be the last line on a page with
  // its first job on the next. HEADING_BLOCK is the heading and its rule.
  const HEADING_BLOCK = 6.5;
  const addSectionHeading = (text: string, keepWith: number) => {
    y += 2;
    ensureSpace(HEADING_BLOCK + keepWith);
    pdf.setFontSize(spec.heading);
    pdf.setFont(F, "bold");
    pdf.setTextColor(...spec.accentRGB);
    pdf.text(text.toUpperCase(), margin, y);
    pdf.setTextColor(0, 0, 0);
    y += 1.5;
    pdf.setDrawColor(...spec.ruleRGB);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 5;
  };

  // Entry header (job title / degree on the left, date range on the right).
  // The date's width is reserved FIRST so the bold left text wraps into the
  // remaining space instead of printing on top of the date — the collision
  // that turned long titles into unreadable garble.
  const addEntryHeader = (leftText: string, dateRange: string, leftSize: number) => {
    let dateW = 0;
    if (dateRange) {
      pdf.setFont(F, "normal");
      pdf.setFontSize(9);
      dateW = pdf.getTextWidth(dateRange);
    }
    pdf.setFont(F, "bold");
    pdf.setFontSize(leftSize);
    const leftAvail = contentWidth - (dateRange ? dateW + 4 : 0);
    const lines = pdf.splitTextToSize(leftText || " ", Math.max(20, leftAvail));
    ensureSpace(5);
    pdf.text(lines[0], margin, y);
    if (dateRange) {
      pdf.setFont(F, "normal");
      pdf.setFontSize(9);
      pdf.text(dateRange, pageWidth - margin, y, { align: "right" });
    }
    y += 5;
    if (lines.length > 1) {
      pdf.setFont(F, "bold");
      pdf.setFontSize(leftSize);
      for (let i = 1; i < lines.length; i++) {
        ensureSpace(5);
        pdf.text(lines[i], margin, y);
        y += 5;
      }
    }
  };

  // Header — auto-shrink the name to fit one line (a name that wraps or runs
  // off the page edge looks broken); wrap the title so a long one can't
  // overflow the right margin either.
  const nameStr = resume.contact.fullName.trim();
  let nameSize = spec.name;
  pdf.setFont(F, "bold");
  pdf.setFontSize(nameSize);
  while (nameSize > 12 && pdf.getTextWidth(nameStr) > contentWidth) {
    nameSize -= 0.5;
    pdf.setFontSize(nameSize);
  }
  pdf.setTextColor(...spec.accentRGB);
  pdf.text(nameStr, margin, y);
  pdf.setTextColor(0, 0, 0);
  y += 7;

  if (resume.contact.title) {
    pdf.setFontSize(11);
    pdf.setFont(F, "normal");
    addWrappedText(resume.contact.title, 11, 5.5);
    y += 0.5;
  }

  const contactItems = [resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedIn, resume.contact.website].filter(Boolean);
  if (contactItems.length > 0) {
    pdf.setTextColor(90, 90, 90);
    addInlineList(contactItems, 9, 4.5);
    pdf.setTextColor(0, 0, 0);
  }
  y += 2;

  // The room each section's first entry asks for before it starts.
  const JOB_BLOCK = 16;
  const SCHOOL_BLOCK = 11;

  if (resume.summary.trim()) {
    addSectionHeading(labels.summary, spec.lh);
    addWrappedText(resume.summary, spec.body, spec.lh);
  }

  if (resume.experience.length > 0) {
    addSectionHeading(labels.experience, JOB_BLOCK);
    for (const entry of resume.experience) {
      // Keep-together: never orphan a job title at the bottom of a page —
      // require room for title + company + first bullet before starting.
      ensureSpace(JOB_BLOCK);
      // No English placeholder title over a résumé in another language: an
      // entry with no title is headed by its company.
      const headed = entry.title || entry.company;
      addEntryHeader(headed, formatDateRange(entry.startDate, entry.endDate), spec.body + 0.5);

      const companyLine = [entry.title ? entry.company : "", entry.location].filter(Boolean).join(" — ");
      if (companyLine) {
        pdf.setFontSize(spec.body);
        pdf.setFont(F, "italic");
        addWrappedText(companyLine, spec.body, spec.lh);
      }

      pdf.setFont(F, "normal");
      pdf.setFontSize(spec.body - 0.5);
      for (const bullet of entry.bullets) {
        if (!bullet.trim()) continue;
        // Hanging indent: wrapped lines align under the bullet's text, not
        // under the bullet glyph.
        const bulletIndent = 4;
        const bulletLines = pdf.splitTextToSize(bullet, contentWidth - bulletIndent);
        bulletLines.forEach((line: string, i: number) => {
          ensureSpace(5);
          if (i === 0) pdf.text("•", margin + 1, y);
          pdf.text(line, margin + 1 + bulletIndent, y);
          y += spec.lh - 0.4;
        });
      }
      y += 2;
    }
  }

  if (resume.education.length > 0) {
    addSectionHeading(labels.education, SCHOOL_BLOCK);
    for (const entry of resume.education) {
      ensureSpace(6);
      const degreeLine = [entry.degree, entry.field].filter(Boolean).join(", ");
      addEntryHeader(degreeLine || entry.school, formatDateRange(entry.startDate, entry.endDate), spec.body + 0.5);
      if (degreeLine && entry.school) {
        pdf.setFontSize(10);
        pdf.setFont(F, "italic");
        addWrappedText(entry.school, 10, 5);
      }
      if (entry.details) {
        pdf.setFont(F, "normal");
        addWrappedText(entry.details, 9.5, 4.6);
      }
      y += 2;
    }
  }

  if (resume.skills.length > 0) {
    addSectionHeading(labels.skills, spec.lh);
    addInlineList(resume.skills, spec.body - 0.5, spec.lh - 0.2);
  }

  if (resume.certifications.length > 0) {
    addSectionHeading(labels.certifications, spec.lh);
    addInlineList(resume.certifications, spec.body - 0.5, spec.lh - 0.2);
  }

  return pdf;
}

/** What an export saved: the PDF, or the Word file in its place and the characters that forced it. */
export type ResumeExportResult = { format: "pdf" } | { format: "docx"; unsupported: string[] };

/**
 * Save the résumé as a PDF; when the PDF's fonts cannot draw one of its
 * characters, save the Word file instead (S12-006) and say which characters.
 * A résumé with no name is refused (ResumeExportError "missing_name").
 */
export async function exportResumeBuilderPDF(resume: BuilderResume, options: ResumeExportOptions = {}): Promise<ResumeExportResult> {
  const name = exportableResume(resume).contact.fullName;
  if (!name.trim()) throw new ResumeExportError("missing_name");
  const unsupported = resumePdfUnsupported(resume, options);
  if (unsupported.length > 0) {
    await exportResumeBuilderDocx(resume, options);
    return { format: "docx", unsupported };
  }
  const pdf = await buildResumePdf(resume, options);
  pdf.save(`${sanitizeFilename(name)}.pdf`);
  return { format: "pdf" };
}

/**
 * The Word page, set explicitly (S12-112). The docx library's default page is
 * A4, but the right tab stop was sized for US Letter (6.5" of text), so every
 * date sat 5.9 mm past the right margin. The page is A4, like the PDF, with
 * one-inch margins, and the tab stop is computed from them.
 */
export const DOCX_PAGE = Object.freeze({ width: 11906, height: 16838, margin: 1440 });
/** The right tab stop: the text width of DOCX_PAGE, in twips. */
export const DOCX_RIGHT_TAB = DOCX_PAGE.width - 2 * DOCX_PAGE.margin;

export async function buildResumeDocxDocument(input: BuilderResume, options: ResumeExportOptions = {}) {
  const resume = exportableResume(input);
  if (!resume.contact.fullName.trim()) throw new ResumeExportError("missing_name");
  const { Document, Paragraph, TextRun, BorderStyle, TabStopType } = await import("docx");
  const spec = TEMPLATES[options.template ?? "modern"];
  const labels = resumeSectionLabels(resume, { uiLanguage: options.uiLanguage });
  const fullName = resume.contact.fullName.trim();

  // Typography constants (docx sizes are half-points). One consistent scale —
  // the output should read like a professionally typeset resume, not a Word
  // default theme: black headings with a hairline rule (never Word's blue
  // built-in heading styles), right-aligned dates at the true right margin.
  const NAME_SIZE = Math.round(spec.name * 2 * 0.85);
  const TITLE_SIZE = Math.round((spec.body + 0.5) * 2);
  const HEADING_SIZE = Math.round(spec.heading * 1.75);
  const BODY_SIZE = Math.round(spec.body * 2);
  const META_SIZE = Math.round((spec.body - 1.2) * 2);
  const FONT = spec.docxFont;
  // Right tab at the right margin of the page the section declares.
  const RIGHT_TAB = DOCX_RIGHT_TAB;

  type RunStyle = { bold?: boolean; italics?: boolean; size?: number; color?: string };
  const run = (text: string, opts: RunStyle = {}) =>
    new TextRun({ text, font: FONT, size: opts.size ?? BODY_SIZE, bold: opts.bold, italics: opts.italics, color: opts.color });
  // A line break in the text is a Word break (S14X-187: C-S14-139). Written
  // raw into one run, Word showed it as a space and the lines ran together.
  const runs = (text: string, opts: RunStyle = {}) =>
    text.split(/\r\n|\r|\n/).map((line, i) =>
      new TextRun({ text: line, font: FONT, size: opts.size ?? BODY_SIZE, bold: opts.bold, italics: opts.italics, color: opts.color, ...(i > 0 ? { break: 1 } : {}) }));

  const children: InstanceType<typeof Paragraph>[] = [];

  children.push(new Paragraph({ children: [run(fullName, { bold: true, size: NAME_SIZE, color: spec.accentHex })], spacing: { after: 40 } }));

  if (resume.contact.title) {
    children.push(new Paragraph({ children: [run(resume.contact.title, { size: TITLE_SIZE, color: "444444" })], spacing: { after: 40 } }));
  }

  const contactLine = [resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedIn, resume.contact.website]
    .filter(Boolean)
    .join("  •  ");
  if (contactLine) {
    children.push(new Paragraph({ children: [run(contactLine, { size: META_SIZE, color: "595959" })], spacing: { after: 120 } }));
  }

  const addHeading = (text: string) => {
    children.push(new Paragraph({
      children: [run(text.toUpperCase(), { bold: true, size: HEADING_SIZE, color: spec.accentHex })],
      // Never the last line of a page with its section on the next (S14X-287).
      keepNext: true,
      spacing: { before: 240, after: 100 },
      border: { bottom: { color: spec.accentHex, style: BorderStyle.SINGLE, size: 4, space: 2 } },
    }));
  };

  const entryHeader = (left: string, dateRange: string) =>
    new Paragraph({
      children: [
        run(left, { bold: true, size: TITLE_SIZE }),
        ...(dateRange ? [new TextRun({ text: "\t", font: FONT }), run(dateRange, { size: META_SIZE, color: "595959" })] : []),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
      keepNext: true,
      spacing: { before: 120, after: 20 },
    });

  if (resume.summary.trim()) {
    addHeading(labels.summary);
    children.push(new Paragraph({ children: runs(resume.summary), spacing: { after: 60 } }));
  }

  if (resume.experience.length > 0) {
    addHeading(labels.experience);
    for (const entry of resume.experience) {
      children.push(entryHeader(entry.title || entry.company, formatDateRange(entry.startDate, entry.endDate)));
      const companyLine = [entry.title ? entry.company : "", entry.location].filter(Boolean).join(" — ");
      if (companyLine) {
        children.push(new Paragraph({ children: [run(companyLine, { italics: true, size: META_SIZE + 2 })], spacing: { after: 40 } }));
      }
      for (const bullet of entry.bullets) {
        if (!bullet.trim()) continue;
        children.push(new Paragraph({ children: runs(bullet), bullet: { level: 0 }, spacing: { after: 30 } }));
      }
    }
  }

  if (resume.education.length > 0) {
    addHeading(labels.education);
    for (const entry of resume.education) {
      const degreeLine = [entry.degree, entry.field].filter(Boolean).join(", ");
      children.push(entryHeader(degreeLine || entry.school, formatDateRange(entry.startDate, entry.endDate)));
      if (degreeLine && entry.school) {
        children.push(new Paragraph({ children: [run(entry.school, { italics: true, size: META_SIZE + 2 })], spacing: { after: 40 } }));
      }
      if (entry.details) {
        children.push(new Paragraph({ children: runs(entry.details, { size: META_SIZE + 2 }), spacing: { after: 40 } }));
      }
    }
  }

  if (resume.skills.length > 0) {
    addHeading(labels.skills);
    children.push(new Paragraph({ children: [run(resume.skills.join("  •  "))], spacing: { after: 60 } }));
  }

  if (resume.certifications.length > 0) {
    addHeading(labels.certifications);
    children.push(new Paragraph({ children: [run(resume.certifications.join("  •  "))], spacing: { after: 60 } }));
  }

  return new Document({
    // The file's own author and title are the person's (S12-112: Word showed
    // "Un-named" as the author of every exported résumé).
    creator: fullName,
    lastModifiedBy: fullName,
    title: fullName,
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    sections: [{
      properties: {
        page: {
          size: { width: DOCX_PAGE.width, height: DOCX_PAGE.height },
          margin: { top: DOCX_PAGE.margin, right: DOCX_PAGE.margin, bottom: DOCX_PAGE.margin, left: DOCX_PAGE.margin },
        },
      },
      children,
    }],
  });
}

export async function exportResumeBuilderDocx(resume: BuilderResume, options: ResumeExportOptions = {}): Promise<void> {
  const { Packer } = await import("docx");
  const doc = await buildResumeDocxDocument(resume, options);
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(exportableResume(resume).contact.fullName)}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
