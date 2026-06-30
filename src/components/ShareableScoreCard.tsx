import { useTranslation } from "react-i18next";
import { useState, useRef } from "react";
import { Download, Linkedin, Check, Loader2, ImageIcon, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
// html2canvas (~99KB gzipped) is only needed when the user actually exports an
// image, so it's dynamically imported in generateImage() below instead of being
// bundled into the main chunk that every visitor downloads on page load.

interface ShareableScoreCardProps {
  candidateName?: string | null;
  atsScore: number;
  formatGrade: string;
  industry: string;
  experienceLevel: string;
  topStrength: string;
  improvementPotential: number;
}

// Track share/download events
const trackShareEvent = async (
  action: 'download' | 'copy' | 'linkedin_share',
  atsScore: number,
  industry: string
) => {
  try {
    const visitorId = localStorage.getItem('funnel_visitor_id') || crypto.randomUUID();
    
    await supabase.functions.invoke('track-ab-event', {
      body: {
        testName: 'share_scorecard',
        variant: action,
        eventType: 'conversion',
        visitorId,
        metadata: {
          action,
          atsScore,
          industry,
          timestamp: new Date().toISOString(),
          page: window.location.pathname,
        }
      }
    });
    
    console.log(`[Share] Tracked ${action} event`);
  } catch (error) {
    console.debug('Share tracking failed:', error);
  }
};

export function ShareableScoreCard({
  const { t } = useTranslation();
  candidateName,
  atsScore,
  formatGrade,
  industry,
  experienceLevel,
  topStrength,
  improvementPotential
}: ShareableScoreCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const getScoreColor = (score: number) => {
    if (score >= 70) return "#22c55e";
    if (score >= 50) return "#eab308";
    return "#ef4444";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 85) return t('shareableCard.excellent');
    if (score >= 70) return t('shareableCard.good');
    if (score >= 50) return t('shareableCard.needsImprovement');
    return t('shareableCard.poor');
  };

  const generateImage = async (): Promise<string | null> => {
    if (!cardRef.current) {
      toast({
        title: t('shareableCard.errorGen'),
        description: t('shareableCard.tryAgain'),
        variant: "destructive"
      });
      return null;
    }
    
    setIsGenerating(true);
    
    try {
      // Wait for any pending renders
      await new Promise(r => setTimeout(r, 100));

      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#0f172a",
        scale: 2,
        logging: false,
        useCORS: true,
        allowTaint: true,
        width: 600,
        height: cardRef.current.scrollHeight,
      });
      
      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error("Failed to generate image:", error);
      toast({
        title: t('shareableCard.failedGen'),
        description: t('shareableCard.tryAgain'),
        variant: "destructive"
      });
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    const dataUrl = await generateImage();
    if (!dataUrl) return;
    
    // Create and trigger download
    const link = document.createElement("a");
    link.download = `resume-score-${atsScore}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Track the download
    trackShareEvent('download', atsScore, industry);
    
    // Show success state
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
    
    toast({
      title: t('shareableCard.scoreCardDownloaded'),
      description: t('shareableCard.shareLinkedIn')
    });
  };

  const handleCopyImage = async () => {
    const dataUrl = await generateImage();
    if (!dataUrl) return;
    
    try {
      // Convert data URL to blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      
      // Try clipboard API
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
        
        // Track the copy
        trackShareEvent('copy', atsScore, industry);
        
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        
        toast({
          title: t('shareableCard.imageCopied'),
          description: t('shareableCard.pasteAnywhere')
        });
      } else {
        // Fallback for browsers without ClipboardItem support
        throw new Error("Clipboard API not supported");
      }
    } catch (error) {
      console.error("Copy failed, downloading instead:", error);
      // Fallback: download instead
      toast({
        title: t('shareableCard.copyNotSupported'),
        description: t('shareableCard.downloadingInstead'),
      });
      handleDownload();
    }
  };

  const handleShareLinkedIn = async () => {
    // Download image first for user
    await handleDownload();
    
    // Track the share
    trackShareEvent('linkedin_share', atsScore, industry);
    
    // Open LinkedIn share dialog
    const shareUrl = encodeURIComponent(window.location.origin);
    const shareText = encodeURIComponent(
      `Just scored ${atsScore}/100 on my resume ATS scan! 📊\n\n` +
      `Industry: ${industry}\n` +
      `Top Strength: ${topStrength}\n\n` +
      `Get your free resume score → resumescanner.ai\n\n` +
      `#resume #jobsearch #career #ATS`
    );
    
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`,
      "_blank",
      "width=600,height=600,menubar=no,toolbar=no"
    );
    
    toast({
      title: t('shareableCard.imageDownloaded'),
      description: t('shareableCard.uploadLinkedIn')
    });
  };

  const displayName = candidateName || "Your";
  const scoreColor = getScoreColor(atsScore);

  // The actual card content that gets rendered for both capture and preview
  const CardContent = () => (
    <div 
      className="w-[600px] p-8"
      style={{ 
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        fontFamily: "system-ui, -apple-system, sans-serif"
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "14px", marginBottom: "4px" }}>Resume ATS Score</p>
          <h2 style={{ color: "#fff", fontSize: "24px", fontWeight: "bold", margin: 0 }}>
            {displayName}&apos;s Results
          </h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", margin: 0 }}>Powered by</p>
          <p style={{ color: "#fff", fontWeight: "600", margin: 0 }}>resumescanner.ai</p>
        </div>
      </div>

      {/* Score circle */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px" }}>
        <div 
          style={{ 
            position: "relative",
            width: "160px",
            height: "160px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `conic-gradient(${scoreColor} ${atsScore * 3.6}deg, #334155 0deg)`,
            boxShadow: `0 0 40px ${scoreColor}40`
          }}
        >
          <div 
            style={{ 
              position: "absolute",
              inset: "12px",
              borderRadius: "50%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "#0f172a"
            }}
          >
            <span style={{ fontSize: "48px", fontWeight: "bold", color: scoreColor }}>
              {atsScore}
            </span>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "14px" }}>/100</span>
          </div>
        </div>
      </div>

      {/* Score label */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <span 
          style={{ 
            display: "inline-block",
            padding: "6px 16px",
            borderRadius: "9999px",
            fontSize: "14px",
            fontWeight: "600",
            background: `${scoreColor}20`,
            color: scoreColor
          }}
        >
          {getScoreLabel(atsScore)}
        </span>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        <div style={{ padding: "16px", borderRadius: "12px", background: "rgba(255,255,255,0.05)" }}>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", marginBottom: "4px" }}>Industry</p>
          <p style={{ color: "#fff", fontWeight: "600", margin: 0 }}>{industry}</p>
        </div>
        <div style={{ padding: "16px", borderRadius: "12px", background: "rgba(255,255,255,0.05)" }}>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", marginBottom: "4px" }}>Experience</p>
          <p style={{ color: "#fff", fontWeight: "600", margin: 0 }}>{experienceLevel}</p>
        </div>
        <div style={{ padding: "16px", borderRadius: "12px", background: "rgba(255,255,255,0.05)" }}>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", marginBottom: "4px" }}>Format Grade</p>
          <p style={{ color: "#fff", fontWeight: "600", fontSize: "18px", margin: 0 }}>{formatGrade}</p>
        </div>
        <div style={{ padding: "16px", borderRadius: "12px", background: "rgba(255,255,255,0.05)" }}>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "12px", marginBottom: "4px" }}>Improvement</p>
          <p style={{ color: "#fff", fontWeight: "600", margin: 0 }}>+{improvementPotential} pts</p>
        </div>
      </div>

      {/* Top strength */}
      <div 
        style={{ 
          padding: "16px",
          borderRadius: "12px",
          marginBottom: "24px",
          background: "rgba(34, 197, 94, 0.1)",
          borderLeft: "3px solid #22c55e"
        }}
      >
        <p style={{ color: "#22c55e", fontSize: "12px", fontWeight: "500", marginBottom: "4px" }}>Top Strength</p>
        <p style={{ color: "#fff", margin: 0 }}>{topStrength}</p>
      </div>

      {/* Footer CTA */}
      <div style={{ textAlign: "center", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "14px", margin: 0 }}>
          Get your free resume score at <span style={{ color: "#fff", fontWeight: "600" }}>resumescanner.ai</span>
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={isGenerating}
          className="gap-2 text-xs sm:text-sm"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : downloaded ? (
            <Check className="w-4 h-4 text-success" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {downloaded ? t('shareableCard.downloaded') : t('shareableCard.download')}
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyImage}
          disabled={isGenerating}
          className="gap-2 text-xs sm:text-sm"
        >
          {copied ? (
            <Check className="w-4 h-4 text-success" />
          ) : (
            <ImageIcon className="w-4 h-4" />
          )}
          {copied ? t('shareableCard.copied') : t('shareableCard.copy')}
        </Button>
        
        <Button
          size="sm"
          onClick={handleShareLinkedIn}
          disabled={isGenerating}
          className="gap-2 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white text-xs sm:text-sm"
        >
          <Linkedin className="w-4 h-4" />
          LinkedIn
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPreview(!showPreview)}
          className="gap-1.5 text-xs text-muted-foreground ml-auto"
        >
          {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showPreview ? t('shareableCard.hide') : t('shareableCard.preview')}
        </Button>
      </div>

      {/* Hidden card for image generation - positioned off-screen but rendered */}
      <div 
        style={{
          position: "fixed",
          left: "-9999px",
          top: "0",
          opacity: 1,
          pointerEvents: "none",
          zIndex: -1
        }}
        aria-hidden="true"
      >
        <div ref={cardRef}>
          <CardContent />
        </div>
      </div>

      {/* Visible preview */}
      {showPreview && (
        <div className="rounded-xl overflow-hidden border border-border shadow-lg animate-fade-in">
          <div className="overflow-x-auto bg-slate-900">
            <div 
              className="transform origin-top-left"
              style={{ 
                transform: "scale(0.5)",
                width: "200%",
                height: "auto"
              }}
            >
              <CardContent />
            </div>
          </div>
          <div className="bg-muted/30 px-3 py-2 text-xs text-muted-foreground text-center border-t">
            Preview of your downloadable score card
          </div>
        </div>
      )}
    </div>
  );
}
