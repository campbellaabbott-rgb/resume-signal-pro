import jsPDF from 'jspdf';
import { reportTone, shapeCareerSnapshot, shapeGamePlan, type CareerSnapshotShape, type GamePlanShape } from '@/lib/career-report-shape';
import { unsupportedPdfCharacters } from '@/lib/pdf-text-support';

// Both exports take the report in whatever shape it was stored and shape it
// first (sweep S8-073): a missing list prints nothing instead of throwing.

const COLORS = {
  primary: [59, 130, 246] as [number, number, number],
  success: [34, 197, 94] as [number, number, number],
  warning: [234, 179, 8] as [number, number, number],
  destructive: [239, 68, 68] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  dark: [15, 23, 42] as [number, number, number],
};

const addHeader = (doc: jsPDF, title: string, subtitle: string) => {
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, 210, 40, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 20, 25);
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(subtitle, 20, 33);
  
  return 50;
};

const addSectionTitle = (doc: jsPDF, title: string, y: number): number => {
  if (y > 260) {
    doc.addPage();
    y = 20;
  }
  
  doc.setFillColor(...COLORS.primary);
  doc.roundedRect(15, y - 5, 180, 10, 2, 2, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 20, y + 2);
  
  return y + 15;
};

const addText = (doc: jsPDF, text: string, y: number, options?: { 
  indent?: number; 
  maxWidth?: number; 
  color?: [number, number, number];
  bold?: boolean;
}): number => {
  const indent = options?.indent || 20;
  const maxWidth = options?.maxWidth || 170;
  const color = options?.color || COLORS.dark;
  
  doc.setTextColor(...color);
  doc.setFontSize(10);
  doc.setFont('helvetica', options?.bold ? 'bold' : 'normal');
  
  const lines = doc.splitTextToSize(text, maxWidth);
  const lineHeight = 5;
  
  lines.forEach((line: string, index: number) => {
    if (y + (index * lineHeight) > 280) {
      doc.addPage();
      y = 20 - (index * lineHeight);
    }
    doc.text(line, indent, y + (index * lineHeight));
  });
  
  return y + (lines.length * lineHeight) + 3;
};

const addBulletPoint = (doc: jsPDF, text: string, y: number, bulletColor?: [number, number, number]): number => {
  if (y > 275) {
    doc.addPage();
    y = 20;
  }
  
  doc.setFillColor(...(bulletColor || COLORS.primary));
  doc.circle(23, y - 1, 1.5, 'F');
  
  return addText(doc, text, y, { indent: 28, maxWidth: 162 });
};


// TEXT jsPDF CANNOT DRAW GOES TO THE PRINT DIALOG (RC-S12-029). Both reports
// were drawn in helvetica whatever they held, so a Hindi, Russian, Chinese or
// Polish report came out as letter-spaced garbage after a warning toast. A
// report with a character the built-in fonts cannot draw is now printed by the
// browser instead ("Save as PDF"), which draws every script with the system's
// fonts, as the Interview and Career Path guides already are.

export type PdfExportDeps = { print?: (html: string) => void; lang?: string };
export type PdfExportMethod = { method: 'pdf' | 'print' };

/** Every string the shaped report holds, at any depth. */
const reportStrings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => reportStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => reportStrings(v, out));
  return out;
};
const needsPrint = (shaped: unknown) => unsupportedPdfCharacters(reportStrings(shaped).join('\n')).length > 0;

/** True when jsPDF's fonts cannot draw some character of this Career Snapshot. */
export const careerSnapshotNeedsPrint = (stored: unknown): boolean => needsPrint(shapeCareerSnapshot(stored).data);

/** True when jsPDF's fonts cannot draw some character of this Game Plan. */
export const gamePlanNeedsPrint = (stored: unknown): boolean => needsPrint(shapeGamePlan(stored).data);

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const items = (list: unknown[]) => list.map((v) => `<li>${esc(v)}</li>`).join('');
const pageLang = (deps: PdfExportDeps) =>
  deps.lang ?? (typeof document !== 'undefined' ? document.documentElement.lang || 'en' : 'en');

/** A standalone printable page, marked data-rb-print, every value escaped. */
const printPage = (title: string, subtitle: string, body: string, lang: string) =>
  `<!doctype html><html lang="${esc(lang)}" data-rb-print><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,"Noto Sans","Noto Sans Devanagari","Noto Sans SC",sans-serif;margin:18mm;color:#111;font-size:11pt;line-height:1.45}h1{font-size:18pt;margin:0 0 2mm}h2{font-size:13pt;margin:7mm 0 2mm;border-top:1px solid #ccc;padding-top:2mm}h3{font-size:11pt;margin:3mm 0 1mm}.muted{color:#555}</style>
</head><body><h1>${esc(title)}</h1><p class="muted">${esc(subtitle)}</p>${body}</body></html>`;

/** The Career Snapshot as a printable page. */
export function careerSnapshotHtml(stored: unknown, lang = 'en'): string {
  const d: CareerSnapshotShape = shapeCareerSnapshot(stored).data;
  const s = d.careerSignalScore;
  const signals = [
    ['Performance Signal', s.performanceSignal.score, s.performanceSignal.summary],
    ['Trajectory Signal', s.trajectorySignal.score, s.trajectorySignal.summary],
    ['Credibility Signal', s.credibilitySignal.score, s.credibilitySignal.summary],
    ['Seniority Alignment', s.seniorityAlignment.targetFit, s.seniorityAlignment.summary],
  ].map(([label, score, summary]) => `<h3>${esc(label)}: ${esc(score)}</h3><p class="muted">${esc(summary)}</p>`).join('');
  const p = d.positioningGuidance;
  const body = `<h2>Career Signal Score</h2><p><strong>Overall: ${esc(s.overall)}</strong></p>${signals}
<h2>Recruiter Perception</h2><p>“${esc(d.recruiterPerception.summary)}”</p>
<h2>Top Strengths</h2>${d.topStrengths.map((x) => `<h3>${esc(x.strength)}</h3><p class="muted">${esc(x.evidence)}</p>`).join('')}
<h2>Career Risks &amp; Mitigation</h2>${d.careerRisks.map((r, i) => `<h3>${i + 1}. ${esc(r.risk)}</h3><p class="muted">Recruiter may ask: “${esc(r.recruiterQuestion)}”</p><p>How to address: ${esc(r.mitigation)}</p>`).join('')}
<h2>Positioning Guidance</h2><p><strong>${esc(p.idealPositioning)}</strong></p><h3>Roles to Target</h3><ul>${items(p.rolesToTarget)}</ul><h3>Roles to Avoid</h3><ul>${items(p.rolesToAvoid)}</ul><h3>Ideal Company Stages</h3><p>${esc(p.companyStages.join(', '))}</p><h3>Story Framing</h3><p>${esc(p.storyFraming)}</p>
<h2>Priority Fixes</h2>${d.priorityFixes.map((f, i) => `<h3>${i + 1}. ${esc(f.fix)}</h3><p class="muted">Impact: ${esc(f.impact)} · Time: ${esc(f.timeEstimate)}</p>`).join('')}`;
  return printPage('Career Snapshot Report', 'Your complete career signal analysis', body, lang);
}

/** The Graduate Game Plan as a printable page. */
export function gamePlanHtml(stored: unknown, lang = 'en'): string {
  const d: GamePlanShape = shapeGamePlan(stored).data;
  const g = d.resumeReadinessGate;
  const a = d.applicationStrategy;
  const n = d.networkingPlaybook;
  const iv = d.interviewReadiness;
  const weeks = [d.thirtyDayPlan.week1, d.thirtyDayPlan.week2, d.thirtyDayPlan.week3, d.thirtyDayPlan.week4]
    .map((w, i) => `<h3>Week ${i + 1}: ${esc(w.focus)}</h3><ul>${items(w.tasks)}</ul>`).join('');
  const body = `<h2>Resume Readiness</h2><p><strong>${esc(g.verdict)}</strong></p><p>${esc(g.summary)}</p>${g.quickFixes?.length ? `<h3>Quick Fixes</h3><ul>${items(g.quickFixes)}</ul>` : ''}
<h2>Role Targeting Map</h2><p class="muted">${esc(d.roleTargetingMap.summary)}</p><h3>Priority Roles</h3><ul>${d.roleTargetingMap.priorityRoles.map((r) => `<li><strong>${esc(r.title)}</strong>: ${esc(r.whyFit)}</li>`).join('')}</ul><h3>Roles to Avoid</h3><ul>${d.roleTargetingMap.rolesToAvoid.map((r) => `<li><strong>${esc(r.title)}</strong>: ${esc(r.reason)}</li>`).join('')}</ul>
<h2>Application Strategy</h2><p><strong>Weekly Target: ${esc(a.weeklyTarget)}</strong></p><h3>Where to Apply</h3><ul>${a.whereToApply.map((c) => `<li>[${esc(c.priority)}] ${esc(c.channel)}: ${esc(c.tip)}</li>`).join('')}</ul><h3>What to Avoid</h3><ul>${items(a.whatToAvoid)}</ul><p class="muted">Key Insight: ${esc(a.keyInsight)}</p>
<h2>Networking Playbook</h2><p class="muted">${esc(n.approach)}</p><h3>Outreach Script (${esc(n.outreachScript.scenario)})</h3><p>${esc(n.outreachScript.script)}</p><h3>LinkedIn Tips</h3><ul>${items(n.linkedInTips)}</ul>
<h2>Interview Readiness</h2><p class="muted">${esc(iv.summary)}</p><h3>Stories to Prepare (STAR Method)</h3><ul>${iv.storiesToPrepare.map((x) => `<li>${esc(x.type)}: ${esc(x.prompt)}</li>`).join('')}</ul><h3>How to answer “Why this role?”</h3><p>${esc(iv.whyThisRole)}</p><h3>Project Talking Points</h3><ol>${items(iv.projectTalkingPoints)}</ol>
<h2>30-Day Action Plan</h2>${weeks}`;
  return printPage('Graduate Game Plan', 'Your personalized 30-day career launch guide', body, lang);
}

/** Print an HTML page through a hidden frame, so the browser's "Save as PDF" draws it. */
function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) { frame.remove(); throw new Error('print frame unavailable'); }
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60_000);
}

/**
 * The Career Snapshot as a PDF: drawn by jsPDF when its fonts can draw every
 * character, else handed to the browser's print dialog. Answers which way it
 * went, so the page can say so.
 */
export const exportCareerSnapshotPDF = (stored: unknown, deps: PdfExportDeps = {}): PdfExportMethod => {
  const data = shapeCareerSnapshot(stored).data;
  if (needsPrint(data)) {
    (deps.print ?? printHtml)(careerSnapshotHtml(data, pageLang(deps)));
    return { method: 'print' };
  }
  const doc = new jsPDF();
  let y = addHeader(doc, 'Career Snapshot Report', 'Your complete career signal analysis');
  
  // Overall Score Section
  y = addSectionTitle(doc, 'Career Signal Score', y);
  
  const overallTone = reportTone(data.careerSignalScore.overall);
  const overallColor = overallTone === 'positive' ? COLORS.success :
                       overallTone === 'neutral' ? COLORS.warning :
                       overallTone === 'negative' ? COLORS.destructive : COLORS.muted;
  
  doc.setFillColor(...overallColor);
  doc.roundedRect(20, y - 3, 60, 10, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Overall: ${data.careerSignalScore.overall}`, 25, y + 4);
  y += 18;
  
  // Signal scores
  const signals = [
    { label: 'Performance Signal', score: data.careerSignalScore.performanceSignal.score, summary: data.careerSignalScore.performanceSignal.summary },
    { label: 'Trajectory Signal', score: data.careerSignalScore.trajectorySignal.score, summary: data.careerSignalScore.trajectorySignal.summary },
    { label: 'Credibility Signal', score: data.careerSignalScore.credibilitySignal.score, summary: data.careerSignalScore.credibilitySignal.summary },
    { label: 'Seniority Alignment', score: data.careerSignalScore.seniorityAlignment.targetFit, summary: data.careerSignalScore.seniorityAlignment.summary },
  ];
  
  signals.forEach(signal => {
    y = addText(doc, `${signal.label}: ${signal.score}`, y, { bold: true });
    y = addText(doc, signal.summary, y, { indent: 25, color: COLORS.muted });
    y += 2;
  });
  y += 5;
  
  // Recruiter Perception
  y = addSectionTitle(doc, 'Recruiter Perception', y);
  y = addText(doc, `"${data.recruiterPerception.summary}"`, y, { color: COLORS.muted });
  y += 8;
  
  // Top Strengths
  y = addSectionTitle(doc, 'Top Strengths', y);
  data.topStrengths.forEach(strength => {
    y = addBulletPoint(doc, strength.strength, y, COLORS.success);
    y = addText(doc, strength.evidence, y, { indent: 28, color: COLORS.muted });
    y += 2;
  });
  y += 5;
  
  // Career Risks
  y = addSectionTitle(doc, 'Career Risks & Mitigation', y);
  data.careerRisks.forEach((risk, index) => {
    y = addText(doc, `${index + 1}. ${risk.risk}`, y, { bold: true });
    y = addText(doc, `Recruiter may ask: "${risk.recruiterQuestion}"`, y, { indent: 25, color: COLORS.muted });
    y = addText(doc, `How to address: ${risk.mitigation}`, y, { indent: 25, color: COLORS.success });
    y += 4;
  });
  y += 5;
  
  // Positioning Guidance
  y = addSectionTitle(doc, 'Positioning Guidance', y);
  y = addText(doc, data.positioningGuidance.idealPositioning, y, { bold: true });
  y += 3;
  
  y = addText(doc, 'Roles to Target:', y, { bold: true, color: COLORS.success });
  data.positioningGuidance.rolesToTarget.forEach(role => {
    y = addBulletPoint(doc, role, y, COLORS.success);
  });
  y += 3;
  
  y = addText(doc, 'Roles to Avoid:', y, { bold: true, color: COLORS.destructive });
  data.positioningGuidance.rolesToAvoid.forEach(role => {
    y = addBulletPoint(doc, role, y, COLORS.destructive);
  });
  y += 3;
  
  y = addText(doc, 'Ideal Company Stages:', y, { bold: true });
  y = addText(doc, data.positioningGuidance.companyStages.join(', '), y, { color: COLORS.muted });
  y += 3;
  
  y = addText(doc, 'Story Framing:', y, { bold: true });
  y = addText(doc, data.positioningGuidance.storyFraming, y, { color: COLORS.muted });
  y += 8;
  
  // Priority Fixes
  y = addSectionTitle(doc, 'Priority Fixes', y);
  data.priorityFixes.forEach((fix, index) => {
    y = addText(doc, `${index + 1}. ${fix.fix}`, y, { bold: true });
    y = addText(doc, `Impact: ${fix.impact}`, y, { indent: 25, color: COLORS.muted });
    y = addText(doc, `Time: ${fix.timeEstimate}`, y, { indent: 25, color: COLORS.primary });
    y += 3;
  });
  
  // Footer
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Generated on ${new Date().toLocaleDateString()}`, 20, 290);
  doc.text('ResumeFixer Career Snapshot', 150, 290);
  
  doc.save('career-snapshot-report.pdf');
  return { method: 'pdf' };
};

/** The Graduate Game Plan as a PDF, or the print dialog when jsPDF cannot draw it. */
export const exportGraduateGamePlanPDF = (stored: unknown, deps: PdfExportDeps = {}): PdfExportMethod => {
  const data = shapeGamePlan(stored).data;
  if (needsPrint(data)) {
    (deps.print ?? printHtml)(gamePlanHtml(data, pageLang(deps)));
    return { method: 'print' };
  }
  const doc = new jsPDF();
  let y = addHeader(doc, 'Graduate Game Plan', 'Your personalized 30-day career launch guide');
  
  // Resume Readiness
  y = addSectionTitle(doc, 'Resume Readiness', y);
  
  const isReady = reportTone(data.resumeReadinessGate.verdict) === 'positive';
  const statusColor = isReady ? COLORS.success : COLORS.warning;
  
  doc.setFillColor(...statusColor);
  doc.roundedRect(20, y - 3, 70, 10, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(data.resumeReadinessGate.verdict, 25, y + 4);
  y += 15;
  
  y = addText(doc, data.resumeReadinessGate.summary, y);
  
  if (data.resumeReadinessGate.quickFixes?.length > 0) {
    y += 3;
    y = addText(doc, 'Quick Fixes:', y, { bold: true });
    data.resumeReadinessGate.quickFixes.forEach(fix => {
      y = addBulletPoint(doc, fix, y, COLORS.warning);
    });
  }
  y += 8;
  
  // Role Targeting
  y = addSectionTitle(doc, 'Role Targeting Map', y);
  y = addText(doc, data.roleTargetingMap.summary, y, { color: COLORS.muted });
  y += 5;
  
  y = addText(doc, 'Priority Roles:', y, { bold: true, color: COLORS.success });
  data.roleTargetingMap.priorityRoles.forEach(role => {
    y = addBulletPoint(doc, role.title, y, COLORS.success);
    y = addText(doc, role.whyFit, y, { indent: 28, color: COLORS.muted });
  });
  y += 3;
  
  y = addText(doc, 'Roles to Avoid:', y, { bold: true, color: COLORS.destructive });
  data.roleTargetingMap.rolesToAvoid.forEach(role => {
    y = addBulletPoint(doc, role.title, y, COLORS.destructive);
    y = addText(doc, role.reason, y, { indent: 28, color: COLORS.muted });
  });
  y += 8;
  
  // Application Strategy
  y = addSectionTitle(doc, 'Application Strategy', y);
  y = addText(doc, `Weekly Target: ${data.applicationStrategy.weeklyTarget}`, y, { bold: true, color: COLORS.primary });
  y += 5;
  
  y = addText(doc, 'Where to Apply:', y, { bold: true });
  data.applicationStrategy.whereToApply.forEach(channel => {
    y = addBulletPoint(doc, `[${channel.priority}] ${channel.channel}`, y);
    y = addText(doc, channel.tip, y, { indent: 28, color: COLORS.muted });
  });
  y += 3;
  
  y = addText(doc, 'What to Avoid:', y, { bold: true, color: COLORS.destructive });
  data.applicationStrategy.whatToAvoid.forEach(item => {
    y = addBulletPoint(doc, item, y, COLORS.destructive);
  });
  y += 3;
  
  y = addText(doc, `Key Insight: ${data.applicationStrategy.keyInsight}`, y, { color: COLORS.muted });
  y += 8;
  
  // Networking Playbook
  y = addSectionTitle(doc, 'Networking Playbook', y);
  y = addText(doc, data.networkingPlaybook.approach, y, { color: COLORS.muted });
  y += 5;
  
  y = addText(doc, `Outreach Script (${data.networkingPlaybook.outreachScript.scenario}):`, y, { bold: true });
  y = addText(doc, data.networkingPlaybook.outreachScript.script, y, { indent: 25, color: COLORS.dark });
  y += 5;
  
  y = addText(doc, 'LinkedIn Tips:', y, { bold: true });
  data.networkingPlaybook.linkedInTips.forEach(tip => {
    y = addBulletPoint(doc, tip, y, COLORS.primary);
  });
  y += 8;
  
  // Interview Readiness
  y = addSectionTitle(doc, 'Interview Readiness', y);
  y = addText(doc, data.interviewReadiness.summary, y, { color: COLORS.muted });
  y += 5;
  
  y = addText(doc, 'Stories to Prepare (STAR Method):', y, { bold: true });
  data.interviewReadiness.storiesToPrepare.forEach(story => {
    y = addBulletPoint(doc, `${story.type}: ${story.prompt}`, y);
  });
  y += 3;
  
  y = addText(doc, 'How to answer "Why this role?":', y, { bold: true });
  y = addText(doc, data.interviewReadiness.whyThisRole, y, { color: COLORS.muted });
  y += 3;
  
  y = addText(doc, 'Project Talking Points:', y, { bold: true });
  data.interviewReadiness.projectTalkingPoints.forEach((point, i) => {
    y = addText(doc, `${i + 1}. ${point}`, y, { indent: 25 });
  });
  y += 8;
  
  // 30-Day Plan
  y = addSectionTitle(doc, '30-Day Action Plan', y);
  
  const weeks = [
    { num: 1, plan: data.thirtyDayPlan.week1 },
    { num: 2, plan: data.thirtyDayPlan.week2 },
    { num: 3, plan: data.thirtyDayPlan.week3 },
    { num: 4, plan: data.thirtyDayPlan.week4 },
  ];
  
  weeks.forEach(week => {
    y = addText(doc, `Week ${week.num}: ${week.plan.focus}`, y, { bold: true, color: COLORS.primary });
    week.plan.tasks.forEach(task => {
      y = addBulletPoint(doc, task, y);
    });
    y += 3;
  });
  
  // Footer
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Generated on ${new Date().toLocaleDateString()}`, 20, 290);
  doc.text('ResumeFixer Graduate Game Plan', 140, 290);
  
  doc.save('graduate-game-plan.pdf');
  return { method: 'pdf' };
};
