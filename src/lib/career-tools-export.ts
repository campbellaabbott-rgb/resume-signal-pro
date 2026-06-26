// jspdf is dynamically imported inside each export function so it doesn't add
// weight to whichever chunk InterviewCoach/CareerPathSimulator ship in.

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

export async function exportInterviewPrepPDF(data: InterviewExportData): Promise<void> {
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

export async function exportCareerPathPDF(data: CareerPathExportData): Promise<void> {
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
