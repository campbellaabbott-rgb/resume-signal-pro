import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Mic, Copy, Check, RefreshCw, Clock, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ElevatorPitchGeneratorProps {
  resumeText: string;
  industry: string;
  currentRole?: string;
  experienceLevel?: string;
  candidateName?: string;
  className?: string;
}

interface PitchData {
  pitch: string;
  alternateOpening: string;
  keyTalkingPoints: string[];
  wordCount: number;
  estimatedSeconds: number;
}

export function ElevatorPitchGenerator({
  resumeText,
  industry,
  currentRole,
  experienceLevel,
  candidateName,
  className
}: ElevatorPitchGeneratorProps) {
  const { t } = useTranslation();
  const [pitchData, setPitchData] = useState<PitchData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();

  const generatePitch = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-elevator-pitch', {
        body: {
          resumeText,
          industry,
          currentRole,
          experienceLevel,
          candidateName
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to generate pitch');

      setPitchData({
        pitch: data.pitch,
        alternateOpening: data.alternateOpening,
        keyTalkingPoints: data.keyTalkingPoints || [],
        wordCount: data.wordCount || 0,
        estimatedSeconds: data.estimatedSeconds || 60
      });
      setIsExpanded(true);
    } catch (err: any) {
      console.error('Pitch generation error:', err);
      toast({
        title: "Couldn't generate pitch",
        description: err.message || "Please try again in a moment.",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyPitch = async () => {
    if (!pitchData) return;
    try {
      await navigator.clipboard.writeText(pitchData.pitch);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: t('elevatorPitch.copied'), description: t('elevatorPitch.pasteAnywhere') });
    } catch {
      toast({ title: t('elevatorPitch.copyFailed'), description: t('elevatorPitch.selectManually'), variant: "destructive" });
    }
  };

  if (!pitchData && !isGenerating) {
    return (
      <div className={cn("p-4 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/3 to-transparent", className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Mic className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm">60-Second Elevator Pitch</h3>
              <p className="text-xs text-muted-foreground">AI-generated pitch based on your resume highlights</p>
            </div>
          </div>
          <Button
            onClick={generatePitch}
            size="sm"
            variant="outline"
            className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-primary/20 bg-card overflow-hidden", className)}>
      {/* Header */}
      <button
        onClick={() => pitchData && setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Mic className="w-5 h-5 text-primary" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-foreground text-sm">Your Elevator Pitch</h3>
            {pitchData && (
              <div className="flex items-center gap-2 mt-0.5">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  ~{pitchData.estimatedSeconds}s • {pitchData.wordCount} words
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <RefreshCw className="w-4 h-4 text-primary animate-spin" />
          )}
          {pitchData && (
            isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Loading state */}
      {isGenerating && !pitchData && (
        <div className="px-4 pb-4">
          <div className="p-4 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-4 h-4 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Crafting your personalized pitch...</p>
            </div>
          </div>
        </div>
      )}

      {/* Pitch content */}
      {pitchData && isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Main pitch */}
          <div className="relative p-4 rounded-lg bg-muted/30 border border-border">
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-line pr-8">
              {pitchData.pitch}
            </p>
            <button
              onClick={copyPitch}
              className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-muted transition-colors"
              title={t('elevatorPitch.copy')}
            >
              {copied ? (
                <Check className="w-4 h-4 text-success" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>

          {/* Alternate opening */}
          {pitchData.alternateOpening && (
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs font-medium text-amber-600 mb-1">Alternative opening:</p>
              <p className="text-sm text-muted-foreground italic">"{pitchData.alternateOpening}"</p>
            </div>
          )}

          {/* Key talking points */}
          {pitchData.keyTalkingPoints.length > 0 && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
              <p className="text-xs font-medium text-primary mb-2">Key points to remember:</p>
              <ul className="space-y-1">
                {pitchData.keyTalkingPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="text-primary font-bold mt-px">{i + 1}.</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Regenerate button */}
          <div className="flex justify-end">
            <Button
              onClick={generatePitch}
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              disabled={isGenerating}
            >
              <RefreshCw className={cn("w-3 h-3", isGenerating && "animate-spin")} />
              Regenerate
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
