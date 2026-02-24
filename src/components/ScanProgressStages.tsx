import { useState, useEffect } from "react";
import { 
  FileSearch, Brain, Target, BarChart3, Sparkles, Shield, 
  CheckCircle2, Loader2, Search, Cpu
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

interface ScanStage {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  /** Progress threshold where this stage starts (0-100) */
  startAt: number;
}

const SCAN_STAGES: ScanStage[] = [
  { id: "parsing", label: "Parsing Resume", description: "Extracting text and structure", icon: FileSearch, startAt: 0 },
  { id: "industry", label: "Detecting Industry", description: "Identifying your field & role", icon: Search, startAt: 10 },
  { id: "ats", label: "Running ATS Simulation", description: "Testing against 50+ ATS systems", icon: Shield, startAt: 25 },
  { id: "keywords", label: "Analyzing Keywords", description: "Matching industry-specific terms", icon: Target, startAt: 40 },
  { id: "scoring", label: "Scoring & Benchmarking", description: "Comparing against top candidates", icon: BarChart3, startAt: 55 },
  { id: "ai", label: "AI Deep Analysis", description: "Generating personalized insights", icon: Brain, startAt: 70 },
  { id: "report", label: "Building Your Report", description: "Compiling actionable recommendations", icon: Sparkles, startAt: 85 },
];

interface ScanProgressStagesProps {
  streamingProgress?: {
    stage: string;
    message: string;
    progress: number;
  } | null;
}

export function ScanProgressStages({ streamingProgress }: ScanProgressStagesProps) {
  const [fallbackProgress, setFallbackProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tip, setTip] = useState(0);

  const tips = [
    "💡 Tip: Resumes with numbers get 40% more callbacks",
    "📊 Did you know? 75% of resumes are rejected by ATS before a human sees them",
    "🎯 Targeted keywords increase match rates by 3x",
    "⚡ Action verbs like 'drove' and 'launched' outperform 'managed' and 'helped'",
    "🔑 Most ATS systems rank keyword placement in your top third highest",
  ];

  const progress = streamingProgress?.progress ?? fallbackProgress;

  // Determine active stage based on progress
  const activeStageIndex = SCAN_STAGES.reduce((best, stage, i) => {
    return progress >= stage.startAt ? i : best;
  }, 0);

  useEffect(() => {
    if (streamingProgress) return;
    
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);
      const newProgress = Math.min(95, (1 - Math.exp(-elapsed / 40)) * 100);
      setFallbackProgress(newProgress);
    }, 300);

    return () => clearInterval(interval);
  }, [streamingProgress]);

  // Cycle tips every 8 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTip(prev => (prev + 1) % tips.length);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const remainingSeconds = Math.max(0, 90 - elapsedSeconds);
  const remainingMinutes = Math.floor(remainingSeconds / 60);
  const remainingSecondsDisplay = remainingSeconds % 60;

  return (
    <div className="w-full max-w-md mx-auto p-6 rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-background space-y-5">
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <div className="relative">
            <Cpu className="w-5 h-5 text-primary animate-pulse" />
            <div className="absolute -inset-1 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
          </div>
          <span className="text-sm font-semibold text-foreground">AI Analysis in Progress</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Using Gemini Pro for maximum accuracy
        </p>
      </div>

      {/* Main Progress Bar */}
      <div className="space-y-1.5">
        <Progress value={progress} className="h-2.5" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(progress)}% complete</span>
          {streamingProgress ? (
            <span className="text-success font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Live
            </span>
          ) : (
            <span>
              ~{remainingMinutes > 0 ? `${remainingMinutes}m ` : ''}{remainingSecondsDisplay}s
            </span>
          )}
        </div>
      </div>

      {/* Stage Steps */}
      <div className="space-y-1">
        {SCAN_STAGES.map((stage, index) => {
          const isComplete = index < activeStageIndex;
          const isActive = index === activeStageIndex;
          const isPending = index > activeStageIndex;
          const StageIcon = stage.icon;

          return (
            <div
              key={stage.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-500",
                isActive && "bg-primary/10 border border-primary/20",
                isComplete && "opacity-60",
                isPending && "opacity-30"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500",
                isComplete && "bg-success/20",
                isActive && "bg-primary/20",
                isPending && "bg-muted"
              )}>
                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                ) : isActive ? (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                ) : (
                  <StageIcon className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "text-xs font-medium truncate",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}>
                  {stage.label}
                </p>
                {isActive && (
                  <p className="text-[11px] text-muted-foreground animate-fade-in truncate">
                    {streamingProgress?.message || stage.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rotating Tips */}
      <div className="px-3 py-2.5 rounded-lg bg-muted/50 border border-border/50">
        <p className="text-xs text-muted-foreground text-center transition-all duration-300" key={tip}>
          {tips[tip]}
        </p>
      </div>

      {/* Security note */}
      <p className="text-[11px] text-muted-foreground/60 text-center">
        🔒 Your resume is analyzed securely and never stored
      </p>
    </div>
  );
}
