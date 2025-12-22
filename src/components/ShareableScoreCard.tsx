import { useState, useRef } from "react";
import { Download, Linkedin, Share2, Check, Loader2, Image } from "lucide-react";
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
  const [showCard, setShowCard] = useState(false);
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
    if (!cardRef.current) return null;
    
    setIsGenerating(true);
    
    try {
      // Make card visible for capture
      setShowCard(true);
      await new Promise(r => setTimeout(r, 100)); // Wait for render
      
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#0f172a",
        scale: 2,
        logging: false,
        useCORS: true,
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
    link.click();
    
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
      // Fallback: download instead
      handleDownload();
    }
  };

  const handleShareLinkedIn = async () => {
    // Generate image first for user to copy
    await handleCopyImage();
    
    // Open LinkedIn post composer
    const text = encodeURIComponent(
      `Just scored ${atsScore}/100 on my resume ATS scan! 📊\n\n` +
      `Industry: ${industry}\n` +
      `Top Strength: ${topStrength}\n\n` +
      `Get your free resume score at resumescanner.ai 🚀\n\n` +
      `#resume #jobsearch #career #ATS`
    );
    
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.origin)}`,
      "_blank",
      "width=600,height=600"
    );
    
    toast({
      title: "Image copied to clipboard!",
      description: "Paste it in your LinkedIn post"
    });
  };

  const displayName = candidateName || "Your";
  const scoreColor = getScoreColor(atsScore);

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={isGenerating}
          className="gap-2"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Download Score Card
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyImage}
          disabled={isGenerating}
          className="gap-2"
        >
          {copied ? (
            <Check className="w-4 h-4 text-success" />
          ) : (
            <Image className="w-4 h-4" />
          )}
          {copied ? "Copied!" : "Copy Image"}
        </Button>
        
        <Button
          size="sm"
          onClick={handleShareLinkedIn}
          disabled={isGenerating}
          className="gap-2 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white"
        >
          <Linkedin className="w-4 h-4" />
          Share on LinkedIn
        </Button>
      </div>

      {/* Hidden card for image generation */}
      <div 
        className={cn(
          "fixed -left-[9999px] top-0",
          showCard ? "opacity-100" : "opacity-0"
        )}
        aria-hidden="true"
      >
        <div 
          ref={cardRef}
          className="w-[600px] p-8"
          style={{ 
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
            fontFamily: "system-ui, -apple-system, sans-serif"
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-white/60 text-sm mb-1">Resume ATS Score</p>
              <h2 className="text-white text-2xl font-bold">
                {displayName}'s Results
              </h2>
            </div>
            <div className="text-right">
              <p className="text-white/40 text-xs">Powered by</p>
              <p className="text-white font-semibold">resumescanner.ai</p>
            </div>
          </div>

          {/* Score circle */}
          <div className="flex items-center justify-center mb-8">
            <div 
              className="relative w-40 h-40 rounded-full flex items-center justify-center"
              style={{ 
                background: `conic-gradient(${scoreColor} ${atsScore * 3.6}deg, #334155 0deg)`,
                boxShadow: `0 0 40px ${scoreColor}40`
              }}
            >
              <div 
                className="absolute inset-3 rounded-full flex flex-col items-center justify-center"
                style={{ background: "#0f172a" }}
              >
                <span 
                  className="text-5xl font-bold"
                  style={{ color: scoreColor }}
                >
                  {atsScore}
                </span>
                <span className="text-white/60 text-sm">/100</span>
              </div>
            </div>
          </div>

          {/* Score label */}
          <div className="text-center mb-8">
            <span 
              className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
              style={{ 
                background: `${scoreColor}20`,
                color: scoreColor
              }}
            >
              {getScoreLabel(atsScore)}
            </span>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div 
              className="p-4 rounded-xl"
              style={{ background: "rgba(255,255,255,0.05)" }}
            >
              <p className="text-white/40 text-xs mb-1">Industry</p>
              <p className="text-white font-semibold">{industry}</p>
            </div>
            <div 
              className="p-4 rounded-xl"
              style={{ background: "rgba(255,255,255,0.05)" }}
            >
              <p className="text-white/40 text-xs mb-1">Experience</p>
              <p className="text-white font-semibold">{experienceLevel}</p>
            </div>
            <div 
              className="p-4 rounded-xl"
              style={{ background: "rgba(255,255,255,0.05)" }}
            >
              <p className="text-white/40 text-xs mb-1">Format Grade</p>
              <p className="text-white font-semibold text-lg">{formatGrade}</p>
            </div>
            <div 
              className="p-4 rounded-xl"
              style={{ background: "rgba(255,255,255,0.05)" }}
            >
              <p className="text-white/40 text-xs mb-1">Improvement Potential</p>
              <p className="text-white font-semibold">+{improvementPotential} pts</p>
            </div>
          </div>

          {/* Top strength */}
          <div 
            className="p-4 rounded-xl mb-6"
            style={{ background: "rgba(34, 197, 94, 0.1)", borderLeft: "3px solid #22c55e" }}
          >
            <p className="text-[#22c55e] text-xs font-medium mb-1">Top Strength</p>
            <p className="text-white">{topStrength}</p>
          </div>

          {/* Footer CTA */}
          <div className="text-center pt-4 border-t border-white/10">
            <p className="text-white/60 text-sm">
              Get your free resume score at <span className="text-white font-semibold">resumescanner.ai</span>
            </p>
          </div>
        </div>
      </div>

      {/* Preview toggle */}
      <button
        onClick={() => setShowCard(!showCard)}
        className="text-xs text-muted-foreground hover:text-foreground underline"
      >
        {showCard ? "Hide preview" : "Preview score card"}
      </button>

      {/* Visible preview */}
      {showCard && (
        <div className="rounded-xl overflow-hidden border border-border shadow-lg max-w-md mx-auto">
          <div 
            className="p-6 scale-[0.6] origin-top-left w-[166%]"
            style={{ 
              background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)"
            }}
          >
            {/* Simplified preview */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-white/60 text-xs mb-0.5">Resume ATS Score</p>
                <h2 className="text-white text-lg font-bold">{displayName}'s Results</h2>
              </div>
              <div className="text-right">
                <p className="text-white/40 text-[10px]">Powered by</p>
                <p className="text-white text-sm font-semibold">resumescanner.ai</p>
              </div>
            </div>

            <div className="flex items-center justify-center mb-4">
              <div 
                className="relative w-24 h-24 rounded-full flex items-center justify-center"
                style={{ 
                  background: `conic-gradient(${scoreColor} ${atsScore * 3.6}deg, #334155 0deg)`,
                }}
              >
                <div 
                  className="absolute inset-2 rounded-full flex flex-col items-center justify-center"
                  style={{ background: "#0f172a" }}
                >
                  <span className="text-3xl font-bold" style={{ color: scoreColor }}>{atsScore}</span>
                  <span className="text-white/60 text-[10px]">/100</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
                <p className="text-white/40">Industry</p>
                <p className="text-white font-medium">{industry}</p>
              </div>
              <div className="p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
                <p className="text-white/40">Format</p>
                <p className="text-white font-medium">{formatGrade}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
