import type { BuilderResume } from "@/types/resume-builder";

// jspdf and docx are dynamically imported inside each export function rather than
// statically here, so the Resume Builder page's own chunk doesn't carry ~550KB of
// export libraries until the user actually clicks an export button.

// Previously only replaced whitespace with underscores, leaving characters
// invalid on Windows/macOS/Linux filesystems (/ \ : * ? " < > |) untouched —
// a name like "Mary/Jane O'Brien" would produce a filename the OS either
// rejects outright or silently mangles. Strips those, collapses repeated
// underscores from adjacent stripped characters, and trims leading/trailing
// underscores so "  / Mary / " doesn't become "_Mary_".
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

export async function exportResumeBuilderPDF(resume: BuilderResume): Promise<void> {
  const { default: jsPDF } = await import("jspdf");

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
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
    pdf.setFont("helvetica", isBold ? "bold" : "normal");
    const lines = pdf.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, margin, y);
      y += lineHeight;
    }
  };

  const addSectionHeading = (text: string) => {
    y += 2;
    ensureSpace(8);
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text(text.toUpperCase(), margin, y);
    y += 1.5;
    pdf.setDrawColor(180, 180, 180);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 5;
  };

  // Header
  pdf.setFontSize(18);
  pdf.setFont("helvetica", "bold");
  pdf.text(resume.contact.fullName || "Your Name", margin, y);
  y += 7;

  if (resume.contact.title) {
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.text(resume.contact.title, margin, y);
    y += 6;
  }

  const contactLine = [resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedIn, resume.contact.website]
    .filter(Boolean)
    .join("  •  ");
  if (contactLine) {
    pdf.setFontSize(9);
    pdf.setTextColor(90, 90, 90);
    addWrappedText(contactLine, 9, 4.5);
    pdf.setTextColor(0, 0, 0);
  }
  y += 2;

  if (resume.summary) {
    addSectionHeading("Summary");
    addWrappedText(resume.summary, 10, 5);
  }

  if (resume.experience.length > 0) {
    addSectionHeading("Experience");
    for (const entry of resume.experience) {
      ensureSpace(6);
      pdf.setFontSize(10.5);
      pdf.setFont("helvetica", "bold");
      pdf.text(entry.title || "Role", margin, y);
      const dateRange = formatDateRange(entry.startDate, entry.endDate);
      if (dateRange) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text(dateRange, pageWidth - margin, y, { align: "right" });
      }
      y += 5;

      const companyLine = [entry.company, entry.location].filter(Boolean).join(" — ");
      if (companyLine) {
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "italic");
        addWrappedText(companyLine, 10, 5);
      }

      pdf.setFont("helvetica", "normal");
      for (const bullet of entry.bullets) {
        if (!bullet.trim()) continue;
        const bulletLines = pdf.splitTextToSize(`•  ${bullet}`, contentWidth - 3);
        for (const line of bulletLines) {
          ensureSpace(5);
          pdf.setFontSize(9.5);
          pdf.text(line, margin + 1, y);
          y += 4.6;
        }
      }
      y += 2;
    }
  }

  if (resume.education.length > 0) {
    addSectionHeading("Education");
    for (const entry of resume.education) {
      ensureSpace(6);
      pdf.setFontSize(10.5);
      pdf.setFont("helvetica", "bold");
      const degreeLine = [entry.degree, entry.field].filter(Boolean).join(", ");
      pdf.text(degreeLine || entry.school, margin, y);
      const dateRange = formatDateRange(entry.startDate, entry.endDate);
      if (dateRange) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text(dateRange, pageWidth - margin, y, { align: "right" });
      }
      y += 5;
      if (degreeLine && entry.school) {
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "italic");
        addWrappedText(entry.school, 10, 5);
      }
      if (entry.details) {
        pdf.setFont("helvetica", "normal");
        addWrappedText(entry.details, 9.5, 4.6);
      }
      y += 2;
    }
  }

  if (resume.skills.length > 0) {
    addSectionHeading("Skills");
    addWrappedText(resume.skills.join("  •  "), 9.5, 4.8);
  }

  if (resume.certifications.length > 0) {
    addSectionHeading("Certifications");
    addWrappedText(resume.certifications.join("  •  "), 9.5, 4.8);
  }

  const fileName = `${sanitizeFilename(resume.contact.fullName || "resume")}.pdf`;
  pdf.save(fileName);
}

export async function exportResumeBuilderDocx(resume: BuilderResume): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const children: InstanceType<typeof Paragraph>[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: resume.contact.fullName || "Your Name", bold: true, size: 32 })],
    })
  );

  if (resume.contact.title) {
    children.push(new Paragraph({ children: [new TextRun({ text: resume.contact.title, size: 22 })] }));
  }

  const contactLine = [resume.contact.email, resume.contact.phone, resume.contact.location, resume.contact.linkedIn, resume.contact.website]
    .filter(Boolean)
    .join("  •  ");
  if (contactLine) {
    children.push(new Paragraph({ children: [new TextRun({ text: contactLine, size: 18, color: "595959" })] }));
  }

  const addHeading = (text: string) => {
    children.push(new Paragraph({ text: "" }));
    children.push(new Paragraph({ text: text.toUpperCase(), heading: HeadingLevel.HEADING_2 }));
  };

  if (resume.summary) {
    addHeading("Summary");
    children.push(new Paragraph({ children: [new TextRun({ text: resume.summary, size: 21 })] }));
  }

  if (resume.experience.length > 0) {
    addHeading("Experience");
    for (const entry of resume.experience) {
      const dateRange = formatDateRange(entry.startDate, entry.endDate);
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: entry.title || "Role", bold: true, size: 22 }),
            ...(dateRange ? [new TextRun({ text: `\t${dateRange}`, size: 18, color: "595959" })] : []),
          ],
          tabStops: [{ type: "right" as const, position: 9000 }],
        })
      );
      const companyLine = [entry.company, entry.location].filter(Boolean).join(" — ");
      if (companyLine) {
        children.push(new Paragraph({ children: [new TextRun({ text: companyLine, italics: true, size: 21 })] }));
      }
      for (const bullet of entry.bullets) {
        if (!bullet.trim()) continue;
        children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
      }
    }
  }

  if (resume.education.length > 0) {
    addHeading("Education");
    for (const entry of resume.education) {
      const degreeLine = [entry.degree, entry.field].filter(Boolean).join(", ");
      const dateRange = formatDateRange(entry.startDate, entry.endDate);
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: degreeLine || entry.school, bold: true, size: 22 }),
            ...(dateRange ? [new TextRun({ text: `\t${dateRange}`, size: 18, color: "595959" })] : []),
          ],
          tabStops: [{ type: "right" as const, position: 9000 }],
        })
      );
      if (degreeLine && entry.school) {
        children.push(new Paragraph({ children: [new TextRun({ text: entry.school, italics: true, size: 21 })] }));
      }
      if (entry.details) {
        children.push(new Paragraph({ children: [new TextRun({ text: entry.details, size: 20 })] }));
      }
    }
  }

  if (resume.skills.length > 0) {
    addHeading("Skills");
    children.push(new Paragraph({ children: [new TextRun({ text: resume.skills.join("  •  "), size: 20 })] }));
  }

  if (resume.certifications.length > 0) {
    addHeading("Certifications");
    children.push(new Paragraph({ children: [new TextRun({ text: resume.certifications.join("  •  "), size: 20 })] }));
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(resume.contact.fullName || "resume")}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
