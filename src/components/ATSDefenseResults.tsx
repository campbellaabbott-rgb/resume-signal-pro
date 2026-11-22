import { useTranslation } from "react-i18next";
import { useState } from "react";
import { 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Target, 
  FileText, 
  Linkedin, 
  TrendingUp, 
  Copy, 
  Check,
  ChevronDown,
  ChevronUp,
  Zap,
  BookOpen,
  ListChecks,
  AlertCircle,
  Award,
  Download,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import { ATSParseSimulator } from "./ATSParseSimulator";
import { simulateAtsParse, type AtsParseSimulationResult, type ParseCheckResult } from "@/lib/ats-parse-simulator";
import { date as fmtDate } from "@/lib/format";

export interface ATSDefenseData {
  beforeScore: {
    overall: number;
    breakdown: {
      keywordDensity: number;
      formatCompliance: number;
      sectionStructure: number;
      parseability: number;
    };
  };
  afterScore: {
    overall: number;
    breakdown: {
      keywordDensity: number;
      formatCompliance: number;
      sectionStructure: number;
      parseability: number;
    };
  };
  compatibilityAudit: {
    overallGrade: string;
    criticalIssues: Array<{ issue: string; impact: string; fix: string }>;
    parsingProblems: string[];
    atsSystemsCompatibility: Array<{ system: string; compatible: boolean; issues: string[] }>;
  };
  keywordOptimization: {
    primaryRole: {
      roleName: string;
      currentKeywordMatch: number;
      targetKeywordMatch: number;
      missingKeywords: string[];
      keywordsToAdd: Array<{ keyword: string; whereToAdd: string; exampleUsage: string }>;
    };
    secondaryRoles: Array<{ roleName: string; additionalKeywords: string[]; adaptationTips: string }>;
  };
  formatRestructuring: {
    currentFormatIssues: string[];
    recommendedFormat: string;
    sectionOrder: string[];
    fontRecommendation: string;
    marginRecommendation: string;
    elementsToRemove: string[];
    elementsToKeep: string[];
  };
  industryKeywordBank: {
    industry: string;
    hardSkills: string[];
    softSkills: string[];
    certifications: string[];
    tools: string[];
    actionVerbs: string[];
  };
  linkedInAlignment: {
    headlineRecommendation: string;
    summaryKeyPoints: string[];
    skillsToFeature: string[];
    keywordConsistency: string;
  };
  optimizedResumeSections: {
    professionalSummary: string;
    coreCompetencies: string[];
    experienceBullets: Array<{ original: string; optimized: string; keywordsAdded: string[] }>;
  };
  actionPlan: Array<{ priority: number; action: string; timeEstimate: string; impact: string }>;
  redFlagsSummary: Array<{ flag: string; whyItMatters: string; howToFix: string }>;
  /** The parse checks the generator ran on the résumé and saved with the
      report (RC-S12-031); the résumé itself is never saved. Absent on
      copies saved before the checks were kept. */
  parseSimulation?: AtsParseSimulationResult;
}

/**
 * WHAT HELVETICA CAN DRAW (S10-062). jsPDF writes its standard fonts in
 * WinAnsi (Windows-1252): a character outside it is printed as other glyphs or
 * none, and the report's own status marks and arrows were four of them. Each
 * is written in ASCII where the report prints it, and the model's text passes
 * through here: a sign with an ASCII meaning becomes that, a letter with an
 * accent WinAnsi lacks loses the accent, other symbols are left out and
 * anything else is a "?". Code points, not glyphs, so the published chunk's
 * PDF writer carries none of them.
 */
const WIN_ANSI_ABOVE_LATIN1 = new Set([
  0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e, 0x0192, 0x02c6, 0x02dc, 0x2013, 0x2014, 0x2018,
  0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);
const PDF_ASCII: Readonly<Record<number, string>> = {
  0x2713: "OK", 0x2714: "OK", 0x2705: "OK", 0x2717: "X", 0x2718: "X", 0x274c: "X", 0x26a0: "!",
  0x2192: "->", 0x2190: "<-", 0x2194: "<->", 0x21d2: "=>", 0x2264: "<=", 0x2265: ">=", 0x2260: "!=", 0x2248: "~",
  0x2212: "-", 0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2015: "-", 0x2032: "'", 0x2033: "\"",
  0x2009: " ", 0x200a: " ", 0x202f: " ", 0x2007: " ", 0x2002: " ", 0x2003: " ", 0x0009: " ",
  0x2028: "\n", 0x2029: "\n",
  // Latin letters with no accent to drop: a Polish or Croatian name keeps its letters.
  0x0141: "L", 0x0142: "l", 0x0110: "D", 0x0111: "d", 0x0131: "i", 0x0126: "H", 0x0127: "h",
};
const inWinAnsi = (cp: number) => cp === 0x0a || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_ABOVE_LATIN1.has(cp);

/** `text` as helvetica can draw it. Exported for the test. */
export function pdfText(text: unknown): string {
  let out = "";
  for (const ch of String(text ?? "")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (inWinAnsi(cp)) { out += ch; continue; }
    if (PDF_ASCII[cp] !== undefined) { out += PDF_ASCII[cp]; continue; }
    const bare = ch.normalize("NFKD").replace(/\p{M}/gu, "");
    if (bare && [...bare].every((c) => inWinAnsi(c.codePointAt(0) ?? 0))) { out += bare; continue; }
    if (/[\p{S}\p{M}\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(ch)) continue;
    out += "?";
  }
  return out;
}

/** The saved checks, when the saved copy holds a readable set; null otherwise. */
export function savedParseSimulation(data: { parseSimulation?: unknown }): AtsParseSimulationResult | null {
  const sim = data.parseSimulation as Partial<AtsParseSimulationResult> | undefined;
  if (!sim || typeof sim !== "object" || !Array.isArray(sim.checks) || typeof sim.overallConfidence !== "number") return null;
  const checks = sim.checks.filter((c): c is ParseCheckResult =>
    !!c && typeof c === "object" && typeof c.label === "string" && typeof c.detail === "string"
    && (c.status === "pass" || c.status === "warning" || c.status === "fail"));
  return checks.length ? { overallConfidence: sim.overallConfidence, checks } : null;
}

const SAVED_STATUS = {
  pass: { icon: CheckCircle2, className: "text-success", bg: "bg-success/5 border-success/20" },
  warning: { icon: AlertTriangle, className: "text-warning", bg: "bg-warning/5 border-warning/20" },
  fail: { icon: AlertCircle, className: "text-destructive", bg: "bg-destructive/5 border-destructive/20" },
} as const;

/** The saved checks, drawn like the live simulation, for a tab that holds no résumé. */
function SavedParseSimulation({ simulation }: { simulation: AtsParseSimulationResult }) {
  const { t } = useTranslation();
  const { overallConfidence, checks } = simulation;
  const color = overallConfidence >= 80 ? "text-success" : overallConfidence >= 50 ? "text-warning" : "text-destructive";
  return (
    <div className="rounded-2xl border border-border bg-card p-5" data-rb-saved-parse-simulation>
      <div className="flex items-center justify-between gap-3">
        <div className="text-left">
          <h3 className="font-bold text-foreground">{t('atsParseSimulator.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('pastBuyers.parseSimulationSaved')}</p>
        </div>
        <span className={cn("text-xl font-bold tabular-nums shrink-0", color)}>{overallConfidence}%</span>
      </div>
      <div className="mt-4 space-y-2">
        {checks.map((check, i) => {
          const { icon: Icon, className, bg } = SAVED_STATUS[check.status];
          return (
            <div key={check.id || i} className={cn("rounded-xl border p-3 flex items-start gap-2.5", bg)}>
              <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", className)} />
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-semibold", className)}>{check.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ATSDefenseResultsProps {
  data: ATSDefenseData;
  // When available, renders the same deterministic ATS parse simulation shown
  // on the free scan results page — mechanical checks distinct from the AI
  // analysis in `data` above. Both are optional since some recovery paths
  // (e.g. recovering previously-generated content by email) don't have the
  // original resume text on hand.
  resumeText?: string;
  multiColumnDetected?: boolean;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-all duration-200"
    >
      {copied ? <><Check className="w-3 h-3" />Copied!</> : <><Copy className="w-3 h-3" />{label}</>}
    </button>
  );
}

function CollapsibleSection({ 
  title, 
  icon: Icon, 
  children, 
  defaultOpen = false,
  badge
}: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode; 
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <span className="font-semibold text-left">{title}</span>
          {badge}
        </div>
        {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
      </button>
      {isOpen && <div className="px-4 pb-4 pt-2 border-t border-border/50">{children}</div>}
    </div>
  );
}

function ScoreComparison({ before, after, label }: { before: number; after: number; label: string }) {
  const improvement = after - before;
  
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">{before}</span>
        <TrendingUp className="w-4 h-4 text-success" />
        <span className="text-sm font-bold text-success">{after}</span>
        <Badge variant="secondary" className="text-xs">+{improvement}</Badge>
      </div>
    </div>
  );
}

export function ATSDefenseResults({ data, resumeText, multiColumnDetected }: ATSDefenseResultsProps) {
  const { t } = useTranslation();
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const scoreImprovement = data.afterScore.overall - data.beforeScore.overall;
  // The tab's résumé runs the checks live; without it, the saved checks.
  const savedSimulation = resumeText ? null : savedParseSimulation(data);

  const generatePDF = async () => {
    setIsGeneratingPdf(true);
    
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
      let y = 20;

      const addPageIfNeeded = (neededHeight: number = 20) => {
        if (y + neededHeight > 280) {
          pdf.addPage();
          y = 20;
        }
      };

      type TextOptions = { fontSize?: number; fontStyle?: 'normal' | 'bold'; color?: [number, number, number]; maxWidth?: number };
      // The lines `text` wraps to, in the font it is drawn in, as helvetica can draw them.
      const linesOf = (text: string, options?: TextOptions): string[] => {
        const { fontSize = 10, fontStyle = 'normal', maxWidth = contentWidth } = options || {};
        pdf.setFontSize(fontSize);
        pdf.setFont('helvetica', fontStyle);
        return pdf.splitTextToSize(pdfText(text), maxWidth);
      };
      // How far down `text` reaches once wrapped: what the line after it moves by.
      const heightOf = (text: string, options?: TextOptions) => linesOf(text, options).length * ((options?.fontSize ?? 10) * 0.4);
      const addText = (text: string, x: number, yPos: number, options?: TextOptions) => {
        const { fontSize = 10, color = [0, 0, 0] } = options || {};
        const lines = linesOf(text, options);
        pdf.setTextColor(color[0], color[1], color[2]);
        pdf.text(lines, x, yPos);
        return lines.length * (fontSize * 0.4);
      };

      // Header
      pdf.setFillColor(59, 130, 246);
      pdf.rect(0, 0, pageWidth, 35, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(22);
      pdf.setFont('helvetica', 'bold');
      pdf.text('ATS Defense Complete Report', margin, 18);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      // The report is English, and helvetica draws Latin only: its date is too (S14X-255).
      pdf.text(pdfText(`Generated: ${fmtDate(new Date(), { lng: "en" })}`), margin, 28);
      y = 45;

      // Score Summary
      pdf.setFillColor(240, 240, 240);
      pdf.roundedRect(margin, y, contentWidth, 30, 3, 3, 'F');
      addText('ATS Score Improvement', margin + 5, y + 8, { fontSize: 12, fontStyle: 'bold' });
      addText(`Before: ${data.beforeScore.overall}/100`, margin + 5, y + 16, { fontSize: 11, color: [220, 38, 38] });
      addText(`After: ${data.afterScore.overall}/100`, margin + 70, y + 16, { fontSize: 11, color: [34, 197, 94] });
      addText(`+${scoreImprovement} points improvement`, margin + 130, y + 16, { fontSize: 11, fontStyle: 'bold', color: [34, 197, 94] });
      y += 40;

      // ATS Parse Simulation — mechanical checks, included in the PDF since this is
      // the deliverable the customer actually keeps and references later.
      if (resumeText || savedSimulation) {
        addPageIfNeeded(30);
        addText('ATS Parse Simulation (Mechanical Checks)', margin, y, { fontSize: 14, fontStyle: 'bold' });
        y += 8;
        const simulation = resumeText ? simulateAtsParse(resumeText, { multiColumnDetected }) : savedSimulation!;
        addText(`Overall parse confidence: ${simulation.overallConfidence}%`, margin, y, { fontSize: 10, fontStyle: 'bold' });
        y += 7;
        simulation.checks.forEach((check) => {
          const statusColor: [number, number, number] = check.status === 'pass' ? [34, 197, 94] : check.status === 'warning' ? [234, 179, 8] : [220, 38, 38];
          const head = `${check.status === 'pass' ? 'OK' : check.status === 'warning' ? '!' : 'X'} ${check.label}`;
          const headStyle: TextOptions = { fontSize: 10, fontStyle: 'bold', color: statusColor, maxWidth: contentWidth - 3 };
          const detailStyle: TextOptions = { fontSize: 9, color: [80, 80, 80], maxWidth: contentWidth - 3 };
          addPageIfNeeded(heightOf(head, headStyle) + heightOf(check.detail, detailStyle) + 5);
          y += addText(head, margin + 3, y, headStyle) + 1;
          y += addText(check.detail, margin + 3, y, detailStyle);
          y += 4;
        });
        y += 5;
      }

      // Action Plan
      addPageIfNeeded(30);
      addText('Priority Action Plan', margin, y, { fontSize: 14, fontStyle: 'bold' });
      y += 8;
      // Each line moves the next down by as far as it wrapped (S10-062): a
      // fixed 5 mm under an action that wrapped printed its time line over
      // the action's second line.
      data.actionPlan.sort((a, b) => a.priority - b.priority).forEach((action) => {
        const impactColor: [number, number, number] = action.impact === 'critical' ? [220, 38, 38] : action.impact === 'high' ? [234, 179, 8] : [100, 100, 100];
        const step = `${action.priority}. ${action.action}`;
        const when = `   Time: ${action.timeEstimate} | Impact: ${action.impact}`;
        const stepStyle: TextOptions = { fontSize: 10, maxWidth: contentWidth - 3 };
        const whenStyle: TextOptions = { fontSize: 9, color: impactColor, maxWidth: contentWidth - 3 };
        addPageIfNeeded(heightOf(step, stepStyle) + heightOf(when, whenStyle) + 5);
        y += addText(step, margin + 3, y, stepStyle) + 1;
        y += addText(when, margin + 3, y, whenStyle) + 3.4;
      });
      y += 5;

      // Keyword Optimization
      addPageIfNeeded(30);
      addText('Keyword Optimization', margin, y, { fontSize: 14, fontStyle: 'bold' });
      y += 8;
      addText(`Primary Role: ${data.keywordOptimization.primaryRole.roleName}`, margin, y, { fontSize: 11, fontStyle: 'bold' });
      y += 6;
      addText(`Current Match: ${data.keywordOptimization.primaryRole.currentKeywordMatch}% -> Target: ${data.keywordOptimization.primaryRole.targetKeywordMatch}%`, margin, y, { fontSize: 10 });
      y += 8;
      addText('Missing Keywords:', margin, y, { fontSize: 10, fontStyle: 'bold' });
      y += 5;
      const missingKws = data.keywordOptimization.primaryRole.missingKeywords.join(', ');
      y += addText(missingKws, margin, y, { fontSize: 9, color: [220, 38, 38] });
      y += 8;

      // Industry Keyword Bank
      addPageIfNeeded(30);
      addText(`Industry Keyword Bank (${data.industryKeywordBank.industry})`, margin, y, { fontSize: 14, fontStyle: 'bold' });
      y += 8;
      addText('Hard Skills:', margin, y, { fontSize: 10, fontStyle: 'bold' });
      y += 5;
      y += addText(data.industryKeywordBank.hardSkills.join(', '), margin, y, { fontSize: 9 });
      y += 5;
      addText('Soft Skills:', margin, y, { fontSize: 10, fontStyle: 'bold' });
      y += 5;
      y += addText(data.industryKeywordBank.softSkills.join(', '), margin, y, { fontSize: 9 });
      y += 5;
      addText('Tools:', margin, y, { fontSize: 10, fontStyle: 'bold' });
      y += 5;
      y += addText(data.industryKeywordBank.tools.join(', '), margin, y, { fontSize: 9 });
      y += 8;

      // Optimized Professional Summary
      addPageIfNeeded(40);
      addText('Optimized Professional Summary', margin, y, { fontSize: 14, fontStyle: 'bold' });
      y += 8;
      pdf.setFillColor(230, 255, 230);
      // Measured in the font it is drawn in, not the heading's 14 pt left set above it.
      const summaryHeight = linesOf(data.optimizedResumeSections.professionalSummary, { fontSize: 9, maxWidth: contentWidth - 10 }).length * 4 + 10;
      pdf.roundedRect(margin, y - 3, contentWidth, summaryHeight, 2, 2, 'F');
      y += addText(data.optimizedResumeSections.professionalSummary, margin + 5, y + 3, { fontSize: 9, maxWidth: contentWidth - 10 });
      y += 15;

      // Core Competencies
      addPageIfNeeded(20);
      addText('Core Competencies', margin, y, { fontSize: 14, fontStyle: 'bold' });
      y += 8;
      y += addText(data.optimizedResumeSections.coreCompetencies.join(' • '), margin, y, { fontSize: 9 });
      y += 10;

      // LinkedIn Tips
      addPageIfNeeded(30);
      addText('LinkedIn Alignment', margin, y, { fontSize: 14, fontStyle: 'bold' });
      y += 8;
      addText('Recommended Headline:', margin, y, { fontSize: 10, fontStyle: 'bold' });
      y += 5;
      y += addText(data.linkedInAlignment.headlineRecommendation, margin, y, { fontSize: 9, color: [10, 102, 194] });
      y += 8;

      // Red Flags
      if (data.redFlagsSummary.length > 0) {
        addPageIfNeeded(30);
        addText('Red Flags to Fix', margin, y, { fontSize: 14, fontStyle: 'bold', color: [220, 38, 38] });
        y += 8;
        data.redFlagsSummary.forEach((flag) => {
          const head = `! ${flag.flag}`;
          const fix = `Fix: ${flag.howToFix}`;
          const headStyle: TextOptions = { fontSize: 10, fontStyle: 'bold' };
          const fixStyle: TextOptions = { fontSize: 9, color: [34, 197, 94], maxWidth: contentWidth - 5 };
          addPageIfNeeded(heightOf(head, headStyle) + heightOf(fix, fixStyle) + 5);
          y += addText(head, margin, y, headStyle) + 1;
          y += addText(fix, margin + 5, y, fixStyle) + 4.4;
        });
      }

      // Footer on last page
      const pageCount = pdf.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`Page ${i} of ${pageCount} | ATS Defense Complete Report | resumebooster.work`, margin, 290);
      }

      pdf.save('ats-defense-report.pdf');
    } catch (error) {
      console.error('PDF generation error:', error);
    } finally {
      setIsGeneratingPdf(false);
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Download Button */}
      <div className="flex justify-end">
        <Button 
          onClick={generatePDF} 
          disabled={isGeneratingPdf}
          className="gap-2"
        >
          {isGeneratingPdf ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating PDF...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Download PDF Report
            </>
          )}
        </Button>
      </div>

      {/* Score Overview */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Before Score */}
        <div className="p-6 rounded-xl border border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <span className="font-semibold text-destructive">Before Optimization</span>
          </div>
          <div className="text-4xl font-bold text-destructive mb-2">{data.beforeScore.overall}<span className="text-lg text-muted-foreground">/100</span></div>
          <Progress value={data.beforeScore.overall} className="h-2 mb-4" />
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Keyword Density</span><span>{data.beforeScore.breakdown.keywordDensity}/25</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Format Compliance</span><span>{data.beforeScore.breakdown.formatCompliance}/25</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Section Structure</span><span>{data.beforeScore.breakdown.sectionStructure}/25</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Parseability</span><span>{data.beforeScore.breakdown.parseability}/25</span></div>
          </div>
        </div>
        
        {/* After Score */}
        <div className="p-6 rounded-xl border border-success/30 bg-success/5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <span className="font-semibold text-success">After Optimization</span>
            <Badge className="bg-success text-success-foreground">+{scoreImprovement} pts</Badge>
          </div>
          <div className="text-4xl font-bold text-success mb-2">{data.afterScore.overall}<span className="text-lg text-muted-foreground">/100</span></div>
          <Progress value={data.afterScore.overall} className="h-2 mb-4" />
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Keyword Density</span><span>{data.afterScore.breakdown.keywordDensity}/25</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Format Compliance</span><span>{data.afterScore.breakdown.formatCompliance}/25</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Section Structure</span><span>{data.afterScore.breakdown.sectionStructure}/25</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Parseability</span><span>{data.afterScore.breakdown.parseability}/25</span></div>
          </div>
        </div>
      </div>

      {/* Mechanical ATS Parse Simulation — distinct from the AI before/after scores above */}
      {resumeText ? (
        <ATSParseSimulator resumeText={resumeText} multiColumnDetected={multiColumnDetected} />
      ) : savedSimulation ? (
        <SavedParseSimulation simulation={savedSimulation} />
      ) : (
        <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground" data-rb-parse-simulation-missing>
          {t('pastBuyers.parseSimulationMissing')}
        </p>
      )}

      {/* Priority Action Plan */}
      <CollapsibleSection title={t('atsDefenseResults.priorityActionPlan')} icon={ListChecks} defaultOpen={true} badge={<Badge variant="destructive">{data.actionPlan.filter(a => a.impact === 'critical').length} Critical</Badge>}>
        <div className="space-y-3">
          {data.actionPlan.sort((a, b) => a.priority - b.priority).map((item, i) => (
            <div key={i} className={cn(
              "p-4 rounded-lg border",
              item.impact === 'critical' ? 'border-destructive/30 bg-destructive/5' :
              item.impact === 'high' ? 'border-warning/30 bg-warning/5' : 'border-border bg-muted/30'
            )}>
              <div className="flex items-start gap-3">
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                  item.impact === 'critical' ? 'bg-destructive text-destructive-foreground' :
                  item.impact === 'high' ? 'bg-warning text-warning-foreground' : 'bg-muted text-muted-foreground'
                )}>
                  {item.priority}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{item.action}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>⏱ {item.timeEstimate}</span>
                    <Badge variant="outline" className="text-xs capitalize">{item.impact} impact</Badge>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* ATS Compatibility Audit */}
      <CollapsibleSection title={t('atsDefenseResults.compatibilityAudit')} icon={ShieldCheck} badge={<Badge variant={data.compatibilityAudit.overallGrade === 'A' || data.compatibilityAudit.overallGrade === 'B' ? 'default' : 'destructive'}>Grade: {data.compatibilityAudit.overallGrade}</Badge>}>
        {/* Critical Issues */}
        {(data.compatibilityAudit.criticalIssues ?? []).length > 0 && (
          <div className="mb-4">
            <h4 className="font-medium text-destructive mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Critical Issues ({(data.compatibilityAudit.criticalIssues ?? []).length})
            </h4>
            <div className="space-y-2">
              {(data.compatibilityAudit.criticalIssues ?? []).map((item, i) => (
                <div key={i} className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <p className="font-medium text-sm">{item.issue}</p>
                  <p className="text-xs text-muted-foreground mt-1">Impact: {item.impact}</p>
                  <p className="text-xs text-success mt-1">Fix: {item.fix}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* ATS Systems Compatibility */}
        <div>
          <h4 className="font-medium mb-2">ATS Platform Compatibility</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {(data.compatibilityAudit.atsSystemsCompatibility ?? []).map((system, i) => (
              <div key={i} className={cn(
                "p-3 rounded-lg border text-center",
                system.compatible ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'
              )}>
                <div className="flex items-center justify-center gap-1 mb-1">
                  {system.compatible ? <CheckCircle2 className="w-4 h-4 text-success" /> : <AlertCircle className="w-4 h-4 text-destructive" />}
                  <span className="font-medium text-sm">{system.system}</span>
                </div>
                {!system.compatible && system.issues.length > 0 && (
                  <p className="text-xs text-muted-foreground">{system.issues[0]}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      {/* Keyword Optimization */}
      <CollapsibleSection title={t('atsDefenseResults.keywordOpt')} icon={Target} badge={<Badge variant="secondary">{data.keywordOptimization.primaryRole.roleName}</Badge>}>
        <div className="space-y-4">
          {/* Primary Role */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Primary Role: {data.keywordOptimization.primaryRole.roleName}</h4>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{data.keywordOptimization.primaryRole.currentKeywordMatch}%</span>
                <TrendingUp className="w-4 h-4 text-success" />
                <span className="font-bold text-success">{data.keywordOptimization.primaryRole.targetKeywordMatch}%</span>
              </div>
            </div>
            
            {/* Missing Keywords */}
            <div className="mb-3">
              <p className="text-sm text-muted-foreground mb-2">Missing Keywords:</p>
              <div className="flex flex-wrap gap-2">
                {(data.keywordOptimization.primaryRole?.missingKeywords ?? []).map((kw, i) => (
                  <Badge key={i} variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">{kw}</Badge>
                ))}
              </div>
            </div>
            
            {/* Keywords to Add with Context */}
            <div className="space-y-2">
              {(data.keywordOptimization.primaryRole?.keywordsToAdd ?? []).slice(0, 5).map((item, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between mb-1">
                    <Badge className="bg-primary">{item.keyword}</Badge>
                    <span className="text-xs text-muted-foreground">Add to: {item.whereToAdd}</span>
                  </div>
                  <p className="text-sm text-muted-foreground italic">"{item.exampleUsage}"</p>
                </div>
              ))}
            </div>
          </div>
          
          {/* Secondary Roles */}
          {data.keywordOptimization.secondaryRoles.length > 0 && (
            <div className="pt-4 border-t border-border">
              <h4 className="font-medium mb-3">Secondary Role Targeting</h4>
              {(data.keywordOptimization.secondaryRoles ?? []).map((role, i) => (
                <div key={i} className="mb-3 p-3 rounded-lg bg-muted/30">
                  <p className="font-medium text-sm">{role.roleName}</p>
                  <div className="flex flex-wrap gap-1 my-2">
                    {role.additionalKeywords.slice(0, 6).map((kw, j) => (
                      <Badge key={j} variant="secondary" className="text-xs">{kw}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{role.adaptationTips}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Industry Keyword Bank */}
      <CollapsibleSection title={t('atsDefenseResults.industryBank')} icon={BookOpen} badge={<Badge variant="secondary">{data.industryKeywordBank.industry}</Badge>}>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium text-sm mb-2">Hard Skills</h4>
            <div className="flex flex-wrap gap-1">
              {data.industryKeywordBank.hardSkills.map((skill, i) => (
                <Badge key={i} variant="outline" className="text-xs">{skill}</Badge>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2">Soft Skills</h4>
            <div className="flex flex-wrap gap-1">
              {data.industryKeywordBank.softSkills.map((skill, i) => (
                <Badge key={i} variant="outline" className="text-xs">{skill}</Badge>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2">Tools & Software</h4>
            <div className="flex flex-wrap gap-1">
              {data.industryKeywordBank.tools.map((tool, i) => (
                <Badge key={i} variant="outline" className="text-xs">{tool}</Badge>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-medium text-sm mb-2">Action Verbs</h4>
            <div className="flex flex-wrap gap-1">
              {data.industryKeywordBank.actionVerbs.map((verb, i) => (
                <Badge key={i} variant="outline" className="text-xs bg-primary/10">{verb}</Badge>
              ))}
            </div>
          </div>
          {data.industryKeywordBank.certifications.length > 0 && (
            <div className="md:col-span-2">
              <h4 className="font-medium text-sm mb-2 flex items-center gap-1"><Award className="w-4 h-4" /> Recommended Certifications</h4>
              <div className="flex flex-wrap gap-1">
                {data.industryKeywordBank.certifications.map((cert, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">{cert}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Optimized Resume Sections */}
      <CollapsibleSection title={t('atsDefenseResults.optimizedSections')} icon={FileText}>
        <div className="space-y-4">
          {/* Professional Summary */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Professional Summary</h4>
              <CopyButton text={data.optimizedResumeSections.professionalSummary} label={t('atsDefenseResults.copy')} />
            </div>
            <div className="p-4 rounded-lg bg-success/5 border border-success/20">
              <p className="text-sm whitespace-pre-wrap">{data.optimizedResumeSections.professionalSummary}</p>
            </div>
          </div>
          
          {/* Core Competencies */}
          <div>
            <h4 className="font-medium mb-2">Core Competencies Section</h4>
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex flex-wrap gap-2">
                {data.optimizedResumeSections.coreCompetencies.map((comp, i) => (
                  <Badge key={i} className="text-xs">{comp}</Badge>
                ))}
              </div>
            </div>
          </div>
          
          {/* Experience Bullets */}
          <div>
            <h4 className="font-medium mb-2">Optimized Experience Bullets</h4>
            <div className="space-y-3">
              {data.optimizedResumeSections.experienceBullets.map((bullet, i) => (
                <div key={i} className="p-4 rounded-lg border border-border">
                  <div className="mb-2">
                    <p className="text-xs text-muted-foreground mb-1">Original:</p>
                    <p className="text-sm line-through text-muted-foreground">{bullet.original}</p>
                  </div>
                  <div className="mb-2">
                    <p className="text-xs text-success mb-1">Optimized:</p>
                    <p className="text-sm font-medium">{bullet.optimized}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {bullet.keywordsAdded.map((kw, j) => (
                      <Badge key={j} variant="secondary" className="text-xs bg-success/10 text-success">+{kw}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* LinkedIn Alignment */}
      <CollapsibleSection title={t('atsDefenseResults.linkedIn')} icon={Linkedin}>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Recommended Headline</h4>
              <CopyButton text={data.linkedInAlignment.headlineRecommendation} label={t('atsDefenseResults.copy')} />
            </div>
            <div className="p-3 rounded-lg bg-[#0A66C2]/10 border border-[#0A66C2]/20">
              <p className="text-sm font-medium">{data.linkedInAlignment.headlineRecommendation}</p>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium mb-2">Summary Key Points</h4>
            <ul className="space-y-2">
              {data.linkedInAlignment.summaryKeyPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
          
          <div>
            <h4 className="font-medium mb-2">Skills to Feature</h4>
            <div className="flex flex-wrap gap-2">
              {data.linkedInAlignment.skillsToFeature.map((skill, i) => (
                <Badge key={i} variant="outline">{skill}</Badge>
              ))}
            </div>
          </div>
          
          <div className="p-3 rounded-lg bg-muted/50">
            <h4 className="font-medium text-sm mb-1">Keyword Consistency Tip</h4>
            <p className="text-sm text-muted-foreground">{data.linkedInAlignment.keywordConsistency}</p>
          </div>
        </div>
      </CollapsibleSection>

      {/* Red Flags */}
      {data.redFlagsSummary.length > 0 && (
        <CollapsibleSection title={t('atsDefenseResults.redFlags')} icon={AlertTriangle} badge={<Badge variant="destructive">{data.redFlagsSummary.length}</Badge>}>
          <div className="space-y-3">
            {data.redFlagsSummary.map((item, i) => (
              <div key={i} className="p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">{item.flag}</p>
                    <p className="text-sm text-muted-foreground mt-1">{item.whyItMatters}</p>
                    <p className="text-sm text-success mt-2 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      {item.howToFix}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Format Restructuring */}
      <CollapsibleSection title={t('atsDefenseResults.formatRecs')} icon={FileText}>
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <h4 className="font-medium text-sm mb-1">Recommended Format</h4>
              <p className="text-sm">{data.formatRestructuring.recommendedFormat}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <h4 className="font-medium text-sm mb-1">Font Recommendation</h4>
              <p className="text-sm">{data.formatRestructuring.fontRecommendation}</p>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium mb-2">Optimal Section Order</h4>
            <div className="flex flex-wrap gap-2">
              {data.formatRestructuring.sectionOrder.map((section, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {i + 1}. {section}
                </Badge>
              ))}
            </div>
          </div>
          
          {data.formatRestructuring.elementsToRemove.length > 0 && (
            <div>
              <h4 className="font-medium text-destructive mb-2">Elements to Remove</h4>
              <div className="flex flex-wrap gap-2">
                {data.formatRestructuring.elementsToRemove.map((el, i) => (
                  <Badge key={i} variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">✕ {el}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
