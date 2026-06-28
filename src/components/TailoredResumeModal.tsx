import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { 
  Download, FileText, Sparkles, CheckCircle2, Copy, Loader2, 
  Briefcase, Target, Lightbulb, PenLine
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
// jspdf (~51KB gzipped) is only needed when the user exports a PDF, so it's
// dynamically imported in generatePDF() below instead of shipping in the main chunk.

interface TailoredResumeContent {
  professionalSummary: string;
  keySkills: string[];
  experienceHighlights: { original?: string; tailored: string }[];
  suggestedJobTitle: string;
  coverLetterOpening: string;
  applicationTips: string[];
  jobTitle: string;
  jobCompany?: string;
}

interface TailoredResumeModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: TailoredResumeContent | null;
  isLoading?: boolean;
  originalName?: string;
}

export function TailoredResumeModal({ 
  isOpen, 
  onClose, 
  content, 
  isLoading,
  originalName = "Your Name"
}: TailoredResumeModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const copyToClipboard = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
      toast({
        title: t('tailoredResumeModal.copiedTitle'),
        description: t('tailoredResumeModal.copiedDescription', { section }),
      });
    } catch (err) {
      toast({
        title: t('tailoredResumeModal.copyFailedTitle'),
        description: t('tailoredResumeModal.copyFailedDescription'),
        variant: "destructive",
      });
    }
  };

  const generatePDF = async () => {
    if (!content) return;
    
    setIsGeneratingPdf(true);
    
    try {
      const { default: jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });
      
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let yPos = margin;
      
      // Helper function to add text with word wrap
      const addWrappedText = (text: string, fontSize: number, isBold = false, color: [number, number, number] = [50, 50, 50]) => {
        pdf.setFontSize(fontSize);
        pdf.setFont("helvetica", isBold ? "bold" : "normal");
        pdf.setTextColor(...color);
        const lines = pdf.splitTextToSize(text, contentWidth);
        
        // Check if we need a new page
        const lineHeight = fontSize * 0.4;
        if (yPos + lines.length * lineHeight > 280) {
          pdf.addPage();
          yPos = margin;
        }
        
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
      
      // Header - Name and Target Position
      pdf.setFontSize(24);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(30, 30, 30);
      pdf.text(originalName, margin, yPos);
      yPos += 10;
      
      // Target position
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(80, 80, 80);
      const targetText = `Targeting: ${content.suggestedJobTitle}${content.jobCompany ? ` at ${content.jobCompany}` : ''}`;
      pdf.text(targetText, margin, yPos);
      yPos += 8;
      
      // Professional Summary
      addSection("Professional Summary");
      addWrappedText(content.professionalSummary, 10, false);
      
      // Key Skills
      addSection("Key Skills");
      const skillsText = content.keySkills.join("  •  ");
      addWrappedText(skillsText, 10, false);
      
      // Experience Highlights
      addSection("Tailored Experience Highlights");
      content.experienceHighlights.forEach((highlight, i) => {
        addWrappedText(`• ${highlight.tailored}`, 10, false);
        yPos += 2;
      });
      
      // Cover Letter Opening
      addSection("Cover Letter Opening");
      addWrappedText(content.coverLetterOpening, 10, false);
      
      // Application Tips
      addSection("Application Tips");
      content.applicationTips.forEach((tip, i) => {
        addWrappedText(`${i + 1}. ${tip}`, 10, false);
        yPos += 1;
      });
      
      // Footer
      yPos = 285;
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(`Generated by Resume Booster • Tailored for ${content.jobTitle}`, margin, yPos);
      
      // Save
      const filename = `Tailored_Resume_${content.jobTitle.replace(/\s+/g, '_')}_${content.jobCompany?.replace(/\s+/g, '_') || 'Application'}.pdf`;
      pdf.save(filename);
      
      toast({
        title: t('tailoredResumeModal.pdfDownloadedTitle'),
        description: t('tailoredResumeModal.pdfDownloadedDescription'),
      });
    } catch (err) {
      console.error("PDF generation error:", err);
      toast({
        title: t('tailoredResumeModal.pdfFailedTitle'),
        description: t('tailoredResumeModal.pdfFailedDescription'),
        variant: "destructive",
      });
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
            <p className="text-muted-foreground text-center">
              {t('tailoredResumeModal.tailoring')}
            </p>
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
                {content.jobCompany && (
                  <p className="text-sm text-muted-foreground">{content.jobCompany}</p>
                )}
              </div>
              <Button
                onClick={generatePDF}
                disabled={isGeneratingPdf}
                className="gap-2"
              >
                {isGeneratingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {t('tailoredResumeModal.downloadPdf')}
              </Button>
            </div>

            {/* Suggested Title */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold">{t('tailoredResumeModal.suggestedTitle')}</h4>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(content.suggestedJobTitle, t('tailoredResumeModal.sections.title'))}
                  className="h-8"
                >
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(content.professionalSummary, t('tailoredResumeModal.sections.summary'))}
                  className="h-8"
                >
                  {copiedSection === t('tailoredResumeModal.sections.summary') ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-muted-foreground leading-relaxed">{content.professionalSummary}</p>
            </div>

            {/* Key Skills */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold">{t('tailoredResumeModal.keySkills')}</h4>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(content.keySkills.join(", "), t('tailoredResumeModal.sections.skills'))}
                  className="h-8"
                >
                  {copiedSection === t('tailoredResumeModal.sections.skills') ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {content.keySkills.map((skill, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            {/* Experience Highlights */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <PenLine className="w-4 h-4 text-primary" />
                  <h4 className="font-semibold">{t('tailoredResumeModal.experienceBullets')}</h4>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(
                    content.experienceHighlights.map(h => `• ${h.tailored}`).join("\n"),
                    t('tailoredResumeModal.sections.experience')
                  )}
                  className="h-8"
                >
                  {copiedSection === t('tailoredResumeModal.sections.experience') ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <div className="space-y-3">
                {content.experienceHighlights.map((highlight, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                    <p className="text-muted-foreground">{highlight.tailored}</p>
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(content.coverLetterOpening, t('tailoredResumeModal.sections.coverLetter'))}
                  className="h-8"
                >
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
                {content.applicationTips.map((tip, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-warning font-bold text-sm">{i + 1}.</span>
                    <p className="text-muted-foreground text-sm">{tip}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-center gap-3 pt-4 border-t border-border">
              <Button
                variant="outline"
                onClick={onClose}
              >
                {t('common.close')}
              </Button>
              <Button
                onClick={generatePDF}
                disabled={isGeneratingPdf}
                className="gap-2"
              >
                {isGeneratingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {t('tailoredResumeModal.downloadPdfToSend')}
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
