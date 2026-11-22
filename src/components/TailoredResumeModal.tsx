import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download, FileText, Sparkles, CheckCircle2, Copy, Loader2,
  Briefcase, Target, Lightbulb, PenLine, Circle, ArrowRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
// The scanner's own presence test (register S13-004, checked against 908 real
// postings): a term counts only where it stands as a word of its own, so
// "Java" is not found in "JavaScript" nor "Excel" in "excellence".
import { resumeHasTerm } from "../../supabase/functions/free-keyword-scan/term-presence";
// jspdf (~51KB gzipped) is only needed when the user exports a PDF, so it's
// dynamically imported in generatePDF() below instead of shipping in the main chunk.

interface ExperienceHighlight {
  original: string;
  tailored: string;
  keywordsInjected: string[];
}

export interface TailoredResumeContent {
  professionalSummary: string;
  keySkills: string[];
  experienceHighlights: ExperienceHighlight[];
  keywordsRequired?: string[];
  keywordGaps?: string[];
  matchScoreDelta?: number;
  suggestedJobTitle: string;
  coverLetterOpening: string;
  applicationTips: string[];
  jobTitle: string;
  jobCompany?: string;
  /** The posting was longer than the writer reads, so its end was not read (S14X-270). */
  postingTruncated?: boolean;
}

interface TailoredResumeModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: TailoredResumeContent | null;
  isLoading?: boolean;
  /** The candidate's name as the scan read it; the file carries no name line without one. */
  originalName?: string | null;
}

/**
 * WHICH OF THE POSTING'S KEYWORDS THIS TEXT HOLDS (S10-138). The card used to
 * colour every required keyword green unless the writer's own short list of
 * gaps named it, and the tailored text was never read: a keyword the writer
 * forgot to list showed as covered though it was nowhere in the summary, the
 * skills or the bullets. A keyword is now found only when one of those holds
 * it, by the scanner's presence test; everything else is "not in the text",
 * whatever the writer said. The writer's gaps are keywords too, so they are
 * read the same way. The parts are joined with a separator no keyword
 * crosses, so "SQL" in one skill and "Server" in the next is not "SQL Server".
 */
export function keywordCoverage(
  content: Pick<TailoredResumeContent, "professionalSummary" | "keySkills" | "experienceHighlights" | "keywordsRequired" | "keywordGaps">,
): Array<{ keyword: string; found: boolean }> {
  const parts = [
    content.professionalSummary,
    ...(content.keySkills ?? []),
    ...(content.experienceHighlights ?? []).map((h) => h?.tailored),
  ].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  const text = parts.join(" | ");
  const seen = new Set<string>();
  const out: Array<{ keyword: string; found: boolean }> = [];
  for (const raw of [...(content.keywordsRequired ?? []), ...(content.keywordGaps ?? [])]) {
    const keyword = typeof raw === "string" ? raw.trim() : "";
    if (!keyword || seen.has(keyword.toLowerCase())) continue;
    seen.add(keyword.toLowerCase());
    out.push({ keyword, found: text !== "" && resumeHasTerm(text, keyword) });
  }
  return out;
}

function highlightKeywords(text: string, keywords: string[]): React.ReactNode {
  if (!keywords.length) return text;
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    keywords.some(k => k.toLowerCase() === part.toLowerCase())
      ? <mark key={i} className="bg-green-100 text-green-800 rounded px-0.5 font-medium not-italic">{part}</mark>
      : part
  );
}

export function TailoredResumeModal({
  isOpen,
  onClose,
  content,
  isLoading,
  originalName,
}: TailoredResumeModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [expandedBullets, setExpandedBullets] = useState<Set<number>>(new Set());

  const copyToClipboard = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
      toast({ title: t('tailoredResumeModal.copiedTitle'), description: t('tailoredResumeModal.copiedDescription', { section }) });
    } catch {
      toast({ title: t('tailoredResumeModal.copyFailedTitle'), description: t('tailoredResumeModal.copyFailedDescription'), variant: "destructive" });
    }
  };

  const toggleBullet = (i: number) => {
    setExpandedBullets(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const generatePDF = async () => {
    if (!content) return;
    setIsGeneratingPdf(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let yPos = margin;

      const addWrappedText = (text: string, fontSize: number, isBold = false, color: [number, number, number] = [50, 50, 50]) => {
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", isBold ? "bold" : "normal");
        pdf.setTextColor(...color);
        const lines = pdf.splitTextToSize(text, contentWidth);
        const lineHeight = fontSize * 0.4;
        if (yPos + lines.length * lineHeight > 280) { pdf.addPage(); yPos = margin; }
        pdf.text(lines, margin, yPos);
        yPos += lines.length * lineHeight + 3;
      };

      const addSection = (title: string) => {
        yPos += 5;
        pdf.setDrawColor(52, 73, 94);
        pdf.setLineWidth(0.5);
        pdf.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 6;
        addWrappedText(title.toUpperCase(), 11, true, [44, 62, 80]);
        yPos += 2;
      };

      // TAILORING NOTES, NOT A RÉSUMÉ TO SEND (S10-063, owner decision 13 of
      // 2026-11-21). The file was headed with a placeholder name (the page
      // never passed one), had no contact details or work history, and carried the
      // private cover-letter opening and application tips, under a button
      // that said to send it. It now carries the scan's name, or no name line
      // when the scan read none, and only the parts meant for the résumé:
      // the opening and the tips stay on screen to copy.
      const name = (originalName ?? "").trim();
      if (name) {
        pdf.setFontSize(24);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(30, 30, 30);
        pdf.text(name, margin, yPos);
        yPos += 10;
      }

      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(80, 80, 80);
      pdf.text(`Targeting: ${content.suggestedJobTitle}${content.jobCompany ? ` at ${content.jobCompany}` : ''}`, margin, yPos);
      yPos += 8;

      addSection("Professional Summary");
      addWrappedText(content.professionalSummary, 10);
      addSection("Key Skills");
      addWrappedText(content.keySkills.join("  •  "), 10);
      addSection("Tailored Experience Highlights");
      content.experienceHighlights.forEach(h => { addWrappedText(`• ${h.tailored}`, 10); yPos += 2; });

      yPos = 285;
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(`Generated by Resume Booster • Tailored for ${content.jobTitle}`, margin, yPos);

      const filename = `Tailoring_Notes_${content.jobTitle.replace(/\s+/g, '_')}_${content.jobCompany?.replace(/\s+/g, '_') || 'Application'}.pdf`;
      pdf.save(filename);
      toast({ title: t('homeScan.tailoringNotes.downloadedTitle'), description: t('homeScan.tailoringNotes.downloadedBody') });
    } catch {
      toast({ title: t('tailoredResumeModal.pdfFailedTitle'), description: t('tailoredResumeModal.pdfFailedDescription'), variant: "destructive" });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {t('tailoredResumeModal.title')}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full border-4 border-primary/20 animate-pulse" />
              <Loader2 className="w-8 h-8 text-primary animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-muted-foreground text-center">{t('tailoredResumeModal.tailoring')}</p>
            <p className="text-xs text-muted-foreground/70">{t('tailoredResumeModal.tailoringEta')}</p>
          </div>
        ) : content ? (
          <div className="space-y-6 py-4">
            {/* Header */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
              <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Target className="w-4 h-4" />
                  {t('tailoredResumeModal.tailoredFor')}
                </div>
                <h3 className="font-bold text-foreground">{content.jobTitle}</h3>
                {content.jobCompany && <p className="text-sm text-muted-foreground">{content.jobCompany}</p>}
              </div>
              <Button onClick={generatePDF} disabled={isGeneratingPdf} className="gap-2">
                {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t('homeScan.tailoringNotes.download')}
              </Button>
            </div>

            {content.postingTruncated && (
              <p data-testid="tailor-posting-truncated" className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 px-3 py-2">
                {t('writingTools.postingTruncated', "This job posting was very long, so only its first part was read. Check its last requirements yourself.")}
              </p>
            )}

            {/* The writer's own "+N% better match" guess is not shown
                (S10-138): nothing measured it. The card below says what the
                text holds, counted from the text. */}
            {(() => {
              const coverage = keywordCoverage(content);
              if (coverage.length === 0) return null;
              const found = coverage.filter((c) => c.found).length;
              const missing = coverage.length - found;
              return (
                <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-keyword-coverage>
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    {t('homeScan.keywordCoverage.title')}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {t('homeScan.keywordCoverage.summary', { found, total: coverage.length })}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {coverage.map((c) => (
                      <li
                        key={c.keyword}
                        data-keyword-found={c.found ? "true" : "false"}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.found ? 'bg-green-50 text-green-700 border-green-200' : 'bg-muted/40 text-muted-foreground border-border'}`}
                      >
                        {c.found ? <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> : <Circle className="w-3 h-3" aria-hidden="true" />}
                        {c.keyword}
                        <span className="sr-only">
                          {' '}({c.found ? t('homeScan.keywordCoverage.found') : t('homeScan.keywordCoverage.notFoundLabel')})
                        </span>
                      </li>
                    ))}
                  </ul>
                  {missing > 0 && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lightbulb className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {t('homeScan.keywordCoverage.notFound', { n: missing })}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Suggested Title */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold">{t('tailoredResumeModal.suggestedTitle')}</h4>
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(content.suggestedJobTitle, t('tailoredResumeModal.sections.title'))} className="h-8">
                  {copiedSection === t('tailoredResumeModal.sections.title') ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-foreground font-medium">{content.suggestedJobTitle}</p>
            </div>

            {/* Professional Summary */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold">{t('tailoredResumeModal.professionalSummary')}</h4>
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(content.professionalSummary, t('tailoredResumeModal.sections.summary'))} className="h-8">
                  {copiedSection === t('tailoredResumeModal.sections.summary') ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                {highlightKeywords(content.professionalSummary, content.keywordsRequired || [])}
              </p>
            </div>

            {/* Key Skills */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold">{t('tailoredResumeModal.keySkills')}</h4>
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(content.keySkills.join(", "), t('tailoredResumeModal.sections.skills'))} className="h-8">
                  {copiedSection === t('tailoredResumeModal.sections.skills') ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(content.keySkills ?? []).map((skill, i) => (
                  <span key={i} className={`px-3 py-1 rounded-full text-sm font-medium ${
                    content.keywordsRequired?.some(k => k.toLowerCase() === skill.toLowerCase())
                      ? 'bg-green-100 text-green-800 border border-green-200'
                      : 'bg-primary/10 text-primary'
                  }`}>{skill}</span>
                ))}
              </div>
            </div>

            {/* Before/After Bullets */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <PenLine className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold">{t('tailoredResumeModal.experienceBullets')}</h4>
                  <Badge variant="secondary" className="text-xs">Before → After</Badge>
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard((content.experienceHighlights ?? []).map(h => `• ${h.tailored}`).join("\n"), t('tailoredResumeModal.sections.experience'))} className="h-8">
                  {copiedSection === t('tailoredResumeModal.sections.experience') ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <div className="space-y-3">
                {(content.experienceHighlights ?? []).map((highlight, i) => (
                  <div key={i} className="rounded-lg border border-border overflow-hidden">
                    {/* Tailored (always visible) */}
                    <div className="p-3 bg-green-50/50">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-foreground flex-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 inline mr-1.5 shrink-0" />
                          {highlightKeywords(highlight.tailored, highlight.keywordsInjected || [])}
                        </p>
                        <Button variant="ghost" size="sm" className="h-6 px-2 shrink-0" onClick={() => copyToClipboard(highlight.tailored, `bullet-${i}`)}>
                          {copiedSection === `bullet-${i}` ? <CheckCircle2 className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                      {highlight.keywordsInjected?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2 pl-5">
                          {(highlight.keywordsInjected ?? []).map((kw, j) => (
                            <span key={j} className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 font-medium">+{kw}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Original (expandable) */}
                    {highlight.original && (
                      <button
                        onClick={() => toggleBullet(i)}
                        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 text-xs text-muted-foreground hover:bg-muted/50 transition-colors border-t border-border"
                      >
                        <ArrowRight className={`w-3 h-3 transition-transform ${expandedBullets.has(i) ? 'rotate-90' : ''}`} />
                        {expandedBullets.has(i) ? 'Hide original' : 'See original'}
                      </button>
                    )}
                    {expandedBullets.has(i) && highlight.original && (
                      <div className="px-3 py-2 bg-muted/20 border-t border-border">
                        <p className="text-xs text-muted-foreground italic">• {highlight.original}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Cover Letter Opening */}
            <div className="rounded-xl border border-success/30 bg-success/5 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-success" />
                  <h4 className="font-semibold text-success">{t('tailoredResumeModal.coverLetterOpening')}</h4>
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(content.coverLetterOpening, t('tailoredResumeModal.sections.coverLetter'))} className="h-8">
                  {copiedSection === t('tailoredResumeModal.sections.coverLetter') ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-muted-foreground leading-relaxed italic">"{content.coverLetterOpening}"</p>
            </div>

            {/* Application Tips */}
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-warning" />
                <h4 className="font-semibold">{t('tailoredResumeModal.applicationTips')}</h4>
              </div>
              <div className="space-y-2">
                {(content.applicationTips ?? []).map((tip, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-warning font-bold text-sm">{i + 1}.</span>
                    <p className="text-muted-foreground text-sm">{tip}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-center gap-3 pt-4 border-t border-border">
              <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
              <Button onClick={generatePDF} disabled={isGeneratingPdf} className="gap-2">
                {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t('homeScan.tailoringNotes.download')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            <p>{t('tailoredResumeModal.noContent')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
