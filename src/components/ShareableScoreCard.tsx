import { useState, useRef, useEffect } from "react";
import { Download, Linkedin, Check, Loader2, ImageIcon, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import html2canvas from "html2canvas";

interface ShareableScoreCardProps {
  candidateName?: string | null;
  atsScore: number;
  formatGrade: string;
  industry: string;
  experienceLevel: string;
  topStrength: string;
  improvementPotential: number;
}

export function ShareableScoreCard({
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
  const cardRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const getScoreColor = (score: number) => {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#eab308";
    return "#ef4444";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Excellent";
    if (score >= 70) return "Good";
    if (score >= 60) return "Fair";
    return "Needs Work";
  };

  const generateImage = async (): Promise<string | null> => {
    if (!cardRef.current) {
      toast({
        title: "Error generating image",
        description: "Please try again",
        variant: "destructive"
      });
      return null;
    }
    
    setIsGenerating(true);
    
    try {
      // Wait for any pending renders
      await new Promise(r => setTimeout(r, 50));
      
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
        title: "Failed to generate image",
        description: "Please try again",
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
    
    const link = document.createElement("a");
    link.download = `resume-score-${atsScore}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Image downloaded!",
      description: "Share it on LinkedIn to stand out"
    });
  };

  const handleCopyImage = async () => {
    const dataUrl = await generateImage();
    if (!dataUrl) return;
    
    try {
      // Convert data URL to blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);
      
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      
      toast({
        title: "Image copied!",
        description: "Paste it anywhere"
      });
    } catch (error) {
      console.error("Copy failed, downloading instead:", error);
      // Fallback: download instead
      handleDownload();
    }
  };

  const handleShareLinkedIn = async () => {
    // Download image first for user
    await handleDownload();
    
    // Open LinkedIn share
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.origin)}`,
      "_blank",
      "width=600,height=600"
    );
    
    toast({
      title: "Image downloaded!",
      description: "Upload it to your LinkedIn post"
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
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">Download</span> Score Card
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
          {copied ? "Copied!" : "Copy"}
        </Button>
        
        <Button
          size="sm"
          onClick={handleShareLinkedIn}
          disabled={isGenerating}
          className="gap-2 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white text-xs sm:text-sm"
        >
          <Linkedin className="w-4 h-4" />
          <span className="hidden sm:inline">Share on</span> LinkedIn
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPreview(!showPreview)}
          className="gap-2 text-xs text-muted-foreground"
        >
          {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {showPreview ? "Hide" : "Preview"}
        </Button>
      </div>

      {/* Hidden card for image generation - positioned off-screen but rendered */}
      <div 
        style={{
          position: "fixed",
          left: "-9999px",
          top: "0",
          opacity: 1,
          pointerEvents: "none"
        }}
        aria-hidden="true"
      >
        <div ref={cardRef}>
          <CardContent />
        </div>
      </div>

      {/* Visible preview */}
      {showPreview && (
        <div className="rounded-xl overflow-hidden border border-border shadow-lg">
          <div className="overflow-x-auto">
            <div className="min-w-[600px] transform scale-[0.5] sm:scale-75 origin-top-left" style={{ height: "auto" }}>
              <CardContent />
            </div>
          </div>
          <div className="bg-muted/30 px-3 py-2 text-xs text-muted-foreground text-center border-t">
            This is how your score card will look when downloaded
          </div>
        </div>
      )}
    </div>
  );
}
