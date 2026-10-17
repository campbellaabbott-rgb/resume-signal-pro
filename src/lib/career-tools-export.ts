// jspdf is dynamically imported inside each export function so it doesn't add
// weight to whichever chunk InterviewCoach/CareerPathSimulator ship in.
import { unsupportedPdfCharacters } from "@/lib/pdf-text-support";

interface InterviewQuestion {
  category: string;
  question: string;
  whyAsked: string;
  strongAnswerTips: string[];
  redFlags: string[];
  sampleOpener: string;
  modelAnswer?: string;
  difficulty: string;
}

interface InterviewExportData {
  interviewProfile: { targetRole: string; difficulty: string; interviewType: string };
  questions: InterviewQuestion[];
  interviewTips: { beforeInterview: string[]; duringInterview: string[]; closingQuestions: string[] };
}

interface CareerPathStep {
  year: string;
  role: string;
  company: string;
  salaryRange: string;
  keyMove: string;
}

interface CareerPathExportEntry {
  name: string;
  description: string;
  timeline: CareerPathStep[];
  requiredSkills: string[];
  riskLevel: string;
  probability: string;
  actionPlan90Days?: string[];
}

interface CareerPathExportData {
  currentPosition: { title: string; level: string; strengths: string[]; gaps: string[] };
  paths: CareerPathExportEntry[];
  immediateNextStep: string;
}

const escapeHtml = (s: unknown) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Every text the interview-prep guide prints. */
function interviewTexts(data: InterviewExportData): string[] {
  return [
    data.interviewProfile?.targetRole, data.interviewProfile?.difficulty, data.interviewProfile?.interviewType,
    ...(data.questions ?? []).flatMap((q) => [q.category, q.question, q.whyAsked, q.sampleOpener, q.modelAnswer ?? "", ...(q.strongAnswerTips ?? []), ...(q.redFlags ?? [])]),
    ...(data.interviewTips?.beforeInterview ?? []), ...(data.interviewTips?.duringInterview ?? []), ...(data.interviewTips?.closingQuestions ?? []),
  ].filter((s): s is string => typeof s === "string");
}

/**
 * True when jsPDF's built-in fonts cannot draw the guide (S12-029): a Hindi
 * guide came out as raw bytes in helvetica. Such a guide is printed by the
 * browser instead, which draws every script with the system's own fonts.
 */
export function interviewPrepNeedsPrint(data: InterviewExportData): boolean {
  return unsupportedPdfCharacters(interviewTexts(data).join("\n")).length > 0;
}

/** The guide as a standalone printable HTML page (every value escaped). */
export function interviewPrepHtml(data: InterviewExportData, lang = "en"): string {
  const list = (items: string[] | undefined) => (items ?? []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const questions = (data.questions ?? []).map((q, i) => `
    <section>
      <h2>${i + 1}. [${escapeHtml(q.category)}] ${escapeHtml(q.question)}</h2>
      <p class="why">${escapeHtml(q.whyAsked)}</p>
      <p>“${escapeHtml(q.sampleOpener)}”</p>
      ${q.modelAnswer ? `<p>${escapeHtml(q.modelAnswer)}</p>` : ""}
      ${q.strongAnswerTips?.length ? `<ul>${list(q.strongAnswerTips)}</ul>` : ""}
      ${q.redFlags?.length ? `<ul class="avoid">${list(q.redFlags)}</ul>` : ""}
    </section>`).join("");
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>Interview Prep Guide</title>
<style>body{font-family:system-ui,"Noto Sans","Noto Sans Devanagari",sans-serif;margin:18mm;color:#111;font-size:11pt;line-height:1.45}h1{font-size:18pt;margin:0 0 4mm}h2{font-size:12pt;margin:6mm 0 2mm}.why{font-style:italic;color:#444}section{border-top:1px solid #ccc;padding-top:2mm}.avoid{color:#7a1f1f}</style>
</head><body>
<h1>Interview Prep Guide</h1>
<p>${escapeHtml(data.interviewProfile?.targetRole)} • ${escapeHtml(data.interviewProfile?.difficulty)} • ${escapeHtml(data.interviewProfile?.interviewType)}</p>
${questions}
<section><ul>${list(data.interviewTips?.beforeInterview)}</ul><ul>${list(data.interviewTips?.duringInterview)}</ul><ul>${list(data.interviewTips?.closingQuestions)}</ul></section>
</body></html>`;
}

/** Print an HTML page through a hidden frame, so the browser's "Save as PDF" draws it. */
function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) { frame.remove(); throw new Error("print frame unavailable"); }
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60_000);
}

/**
 * The interview-prep guide as a PDF: drawn by jsPDF when its fonts can draw
 * every character, else handed to the browser's print dialog ("Save as PDF").
 * Answers which way it went, so the page can say so.
 */
export async function exportInterviewPrepPDF(
  data: InterviewExportData,
  deps: { print?: (html: string) => void; lang?: string } = {},
): Promise<{ method: "pdf" | "print" }> {
  if (interviewPrepNeedsPrint(data)) {
    (deps.print ?? printHtml)(interviewPrepHtml(data, deps.lang ?? (typeof document !== "undefined" ? document.documentElement.lang || "en" : "en")));
    return { method: "print" };
  }
  await drawInterviewPrepPDF(data);
  return { method: "pdf" };
}

async function drawInterviewPrepPDF(data: InterviewExportData): Promise<void> {
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

  const addWrapped = (text: string, fontSize: number, lineHeight: number, isBold = false, isItalic = false) => {
    if (!text) return;
    pdf.setFontSize(fontSize);
    pdf.setFont("helvetica", isBold ? "bold" : isItalic ? "italic" : "normal");
    const lines = pdf.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, margin, y);
      y += lineHeight;
    }
  };

  pdf.setFontSize(18);
  pdf.setFont("helvetica", "bold");
  pdf.text("Interview Prep Guide", margin, y);
  y += 8;
  addWrapped(`${data.interviewProfile.targetRole}  •  ${data.interviewProfile.difficulty}  •  ${data.interviewProfile.interviewType}`, 10, 5.5);
  y += 3;

  data.questions.forEach((q, i) => {
    ensureSpace(10);
    y += 2;
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 5;
    addWrapped(`${i + 1}. [${q.category}] ${q.question}`, 11.5, 5.8, true);
    addWrapped(`Why they ask: ${q.whyAsked}`, 9.5, 4.8, false, true);
    y += 1;
    addWrapped(`Strong opener: "${q.sampleOpener}"`, 9.5, 4.6);
    if (q.modelAnswer) {
      y += 1;
      addWrapped("Model Answer (STAR method):", 9.5, 4.6, true);
      addWrapped(q.modelAnswer, 9.5, 4.6);
    }
    if (q.strongAnswerTips?.length) {
      y += 1;
      addWrapped("Tips: " + q.strongAnswerTips.join("  •  "), 9, 4.4);
    }
    if (q.redFlags?.length) {
      addWrapped("Avoid: " + q.redFlags.join("  •  "), 9, 4.4);
    }
    y += 2;
  });

  ensureSpace(10);
  y += 2;
  addWrapped("Before the Interview", 11, 5.5, true);
  data.interviewTips.beforeInterview.forEach((t) => addWrapped(`•  ${t}`, 9.5, 4.6));
  y += 2;
  addWrapped("During the Interview", 11, 5.5, true);
  data.interviewTips.duringInterview.forEach((t) => addWrapped(`•  ${t}`, 9.5, 4.6));
  y += 2;
  addWrapped("Questions to Ask Them", 11, 5.5, true);
  data.interviewTips.closingQuestions.forEach((t) => addWrapped(`•  ${t}`, 9.5, 4.6));

  pdf.save("interview_prep_guide.pdf");
}

/** Every text the career roadmap prints. */
function careerPathTexts(data: CareerPathExportData): string[] {
  return [
    data.currentPosition?.title, data.currentPosition?.level, data.immediateNextStep,
    ...(data.paths ?? []).flatMap((p) => [
      p.name, p.description, p.probability, p.riskLevel,
      ...(p.timeline ?? []).flatMap((s) => [s.year, s.role, s.company, s.salaryRange, s.keyMove]),
      ...(p.requiredSkills ?? []), ...(p.actionPlan90Days ?? []),
    ]),
  ].filter((s): s is string => typeof s === "string");
}

/** True when jsPDF's built-in fonts cannot draw the roadmap (S12-029: a past buyer's Hindi roadmap). */
export function careerPathNeedsPrint(data: CareerPathExportData): boolean {
  return unsupportedPdfCharacters(careerPathTexts(data).join("\n")).length > 0;
}

/** The roadmap as a standalone printable HTML page (every value escaped). */
export function careerPathHtml(data: CareerPathExportData, lang = "en"): string {
  const list = (items: string[] | undefined) => (items ?? []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const paths = (data.paths ?? []).map((p) => `
    <section>
      <h2>${escapeHtml(p.name)} (${escapeHtml(p.probability)}, ${escapeHtml(p.riskLevel)})</h2>
      <p class="why">${escapeHtml(p.description)}</p>
      <ul>${(p.timeline ?? []).map((s) => `<li><strong>${escapeHtml(s.year)}: ${escapeHtml(s.role)} — ${escapeHtml(s.company)}</strong> (${escapeHtml(s.salaryRange)})<br>${escapeHtml(s.keyMove)}</li>`).join("")}</ul>
      ${p.requiredSkills?.length ? `<p>${escapeHtml(p.requiredSkills.join(", "))}</p>` : ""}
      ${p.actionPlan90Days?.length ? `<ol>${list(p.actionPlan90Days)}</ol>` : ""}
    </section>`).join("");
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>Career Roadmap</title>
<style>body{font-family:system-ui,"Noto Sans","Noto Sans Devanagari",sans-serif;margin:18mm;color:#111;font-size:11pt;line-height:1.45}h1{font-size:18pt;margin:0 0 4mm}h2{font-size:12pt;margin:6mm 0 2mm}.why{font-style:italic;color:#444}section{border-top:1px solid #ccc;padding-top:2mm}</style>
</head><body>
<h1>Career Roadmap</h1>
<p>${escapeHtml(data.currentPosition?.title)} (${escapeHtml(data.currentPosition?.level)})</p>
${paths}
<section><p>${escapeHtml(data.immediateNextStep)}</p></section>
</body></html>`;
}

/**
 * The career roadmap as a PDF: drawn by jsPDF when its fonts can draw every
 * character, else handed to the browser's print dialog ("Save as PDF").
 */
export async function exportCareerPathPDF(
  data: CareerPathExportData,
  deps: { print?: (html: string) => void; lang?: string } = {},
): Promise<{ method: "pdf" | "print" }> {
  if (careerPathNeedsPrint(data)) {
    (deps.print ?? printHtml)(careerPathHtml(data, deps.lang ?? (typeof document !== "undefined" ? document.documentElement.lang || "en" : "en")));
    return { method: "print" };
  }
  await drawCareerPathPDF(data);
  return { method: "pdf" };
}

async function drawCareerPathPDF(data: CareerPathExportData): Promise<void> {
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

  const addWrapped = (text: string, fontSize: number, lineHeight: number, isBold = false, isItalic = false) => {
    if (!text) return;
    pdf.setFontSize(fontSize);
    pdf.setFont("helvetica", isBold ? "bold" : isItalic ? "italic" : "normal");
    const lines = pdf.splitTextToSize(text, contentWidth);
    for (const line of lines) {
      ensureSpace(lineHeight);
      pdf.text(line, margin, y);
      y += lineHeight;
    }
  };

  pdf.setFontSize(18);
  pdf.setFont("helvetica", "bold");
  pdf.text("Career Roadmap", margin, y);
  y += 8;
  addWrapped(`Current: ${data.currentPosition.title} (${data.currentPosition.level})`, 10.5, 5.5, true);
  y += 1;

  data.paths.forEach((path) => {
    ensureSpace(10);
    y += 2;
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 5;
    addWrapped(`${path.name}  (${path.probability} likely, ${path.riskLevel} risk)`, 12, 6, true);
    addWrapped(path.description, 9.5, 4.8, false, true);
    y += 1;

    path.timeline.forEach((step) => {
      addWrapped(`${step.year}: ${step.role} — ${step.company}  (${step.salaryRange})`, 9.5, 4.8, true);
      addWrapped(`   ${step.keyMove}`, 9, 4.4);
    });

    if (path.requiredSkills?.length) {
      y += 1;
      addWrapped("Skills to develop: " + path.requiredSkills.join(", "), 9, 4.4);
    }

    if (path.actionPlan90Days?.length) {
      y += 1;
      addWrapped("90-Day Action Plan:", 9.5, 4.6, true);
      path.actionPlan90Days.forEach((step, i) => addWrapped(`  ${i + 1}. ${step}`, 9, 4.4));
    }
    y += 2;
  });

  ensureSpace(10);
  y += 2;
  addWrapped("Do This Week (Any Path)", 11, 5.5, true);
  addWrapped(data.immediateNextStep, 9.5, 4.8);

  pdf.save("career_roadmap.pdf");
}
