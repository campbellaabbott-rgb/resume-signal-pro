import jsPDF from 'jspdf';

interface CareerSnapshotData {
  careerSignalScore: {
    overall: string;
    performanceSignal: { score: string; summary: string };
    trajectorySignal: { score: string; summary: string };
    credibilitySignal: { score: string; summary: string };
    seniorityAlignment: { currentLevel: string; targetFit: string; summary: string };
  };
  recruiterPerception: { summary: string };
  topStrengths: { strength: string; evidence: string }[];
  careerRisks: { risk: string; recruiterQuestion: string; mitigation: string }[];
  positioningGuidance: {
    idealPositioning: string;
    rolesToTarget: string[];
    rolesToAvoid: string[];
    companyStages: string[];
    storyFraming: string;
  };
  priorityFixes: { fix: string; impact: string; timeEstimate: string }[];
}

interface GraduateGamePlanData {
  resumeReadinessGate: {
    verdict: string;
    confidence: string;
    summary: string;
    quickFixes: string[];
  };
  roleTargetingMap: {
    summary: string;
    priorityRoles: { title: string; whyFit: string }[];
    rolesToAvoid: { title: string; reason: string }[];
  };
  applicationStrategy: {
    weeklyTarget: string;
    whereToApply: { channel: string; priority: string; tip: string }[];
    whatToAvoid: string[];
    keyInsight: string;
  };
  networkingPlaybook: {
    approach: string;
    outreachScript: { scenario: string; script: string };
    linkedInTips: string[];
  };
  interviewReadiness: {
    summary: string;
    storiesToPrepare: { type: string; prompt: string }[];
    whyThisRole: string;
    projectTalkingPoints: string[];
  };
  thirtyDayPlan: {
    week1: { focus: string; tasks: string[] };
    week2: { focus: string; tasks: string[] };
    week3: { focus: string; tasks: string[] };
    week4: { focus: string; tasks: string[] };
  };
}

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

export const exportCareerSnapshotPDF = (data: CareerSnapshotData): void => {
  const doc = new jsPDF();
  let y = addHeader(doc, 'Career Snapshot Report', 'Your complete career signal analysis');
  
  // Overall Score Section
  y = addSectionTitle(doc, 'Career Signal Score', y);
  
  const overallColor = data.careerSignalScore.overall === 'Strong' ? COLORS.success : 
                       data.careerSignalScore.overall === 'Mixed' ? COLORS.warning : COLORS.destructive;
  
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
};

export const exportGraduateGamePlanPDF = (data: GraduateGamePlanData): void => {
  const doc = new jsPDF();
  let y = addHeader(doc, 'Graduate Game Plan', 'Your personalized 30-day career launch guide');
  
  // Resume Readiness
  y = addSectionTitle(doc, 'Resume Readiness', y);
  
  const isReady = data.resumeReadinessGate.verdict === 'Ready to Apply';
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
};
