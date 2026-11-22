import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { Loader2, Brain, FileText, Sparkles, Check, Zap } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type GenerationStage = 
  | 'analyzing'
  | 'optimizing'
  | 'generating'
  | 'finalizing'
  | 'complete';

// Every word below is a key into aiGenerationProgress (nine locales), so the
// overlay speaks the reader's language. None names a model (CW2-AI7): which
// model answers changes on the AI gateway's schedule, not ours, so a name
// typed here goes false without a line of ours changing. The English literals
// this replaced named one, and were never translated.
interface GenerationStep {
  id: GenerationStage;
  labelKey: string;
  descriptionKey: string;
  icon: React.ElementType;
  duration: number; // estimated duration in ms
}

const steps: GenerationStep[] = [
  { 
    id: 'analyzing', 
    labelKey: 'aiGenerationProgress.steps.analyzingTitle',
    descriptionKey: 'aiGenerationProgress.steps.analyzingDesc',
    icon: Brain,
    duration: 3000
  },
  { 
    id: 'optimizing', 
    labelKey: 'aiGenerationProgress.steps.optimizingTitle',
    descriptionKey: 'aiGenerationProgress.steps.optimizingDesc',
    icon: Zap,
    duration: 4000
  },
  { 
    id: 'generating', 
    labelKey: 'aiGenerationProgress.steps.generatingTitle',
    descriptionKey: 'aiGenerationProgress.steps.generatingDesc',
    icon: FileText,
    duration: 5000
  },
  { 
    id: 'finalizing', 
    labelKey: 'aiGenerationProgress.steps.finalizingTitle',
    descriptionKey: 'aiGenerationProgress.steps.finalizingDesc',
    icon: Sparkles,
    duration: 2000
  },
];

interface AIGenerationProgressProps {
  isVisible: boolean;
  productName?: string;
  onComplete?: () => void;
}

export function AIGenerationProgress({ 
  isVisible, 
  productName = "your content",
  onComplete 
}: AIGenerationProgressProps) {
  const { t } = useTranslation();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isVisible) {
      setCurrentStepIndex(0);
      setProgress(0);
      return;
    }

    // The clock starts when the generation does (S10-151), not when the
    // overlay mounted: the recovery form keeps it mounted, hidden, while the
    // buyer fills it in, and a buyer who took 14 s or more saw 95%
    // "Finalizing" the moment they pressed generate.
    const startedAt = Date.now();
    // Simulate progress through steps
    const totalDuration = steps.reduce((acc, step) => acc + step.duration, 0);

    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const newProgress = Math.min((elapsed / totalDuration) * 100, 95); // Cap at 95% until actually complete
      setProgress(newProgress);

      // Determine which step we're on based on elapsed time
      let accumulated = 0;
      for (let i = 0; i < steps.length; i++) {
        accumulated += steps[i].duration;
        if (elapsed < accumulated) {
          setCurrentStepIndex(i);
          break;
        }
        if (i === steps.length - 1) {
          setCurrentStepIndex(steps.length - 1);
        }
      }
    }, 100);

    return () => clearInterval(progressInterval);
  }, [isVisible]);

  if (!isVisible) return null;

  const currentStep = steps[currentStepIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="text-center space-y-6 p-8 max-w-lg w-full mx-4">
        {/* Main Icon Animation */}
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="relative h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center ring-4 ring-primary/30">
            <Brain className="h-10 w-10 text-primary animate-pulse" />
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <h3 className="text-2xl font-bold text-foreground">
            {t('aiGenerationProgress.title')}
          </h3>
          <p className="text-muted-foreground">
            {t('aiGenerationProgress.generating', { productName })}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={progress} className="h-3" />
          <p className="text-sm text-muted-foreground">
            {t('aiGenerationProgress.complete', { progress: Math.round(progress) })}
          </p>
        </div>

        {/* Current Step */}
        <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
          <div className="flex items-center gap-3 justify-center">
            <currentStep.icon className="h-5 w-5 text-primary animate-pulse" />
            <div className="text-left">
              <p className="font-medium text-foreground">{t(currentStep.labelKey)}</p>
              <p className="text-sm text-muted-foreground">{t(currentStep.descriptionKey)}</p>
            </div>
          </div>
        </div>

        {/* Step Indicators */}
        <div className="flex justify-center gap-2 pt-2">
          {steps.map((step, index) => {
            const isComplete = index < currentStepIndex;
            const isCurrent = index === currentStepIndex;
            const StepIcon = step.icon;
            
            return (
              <div
                key={step.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-all duration-300",
                  isComplete && "bg-primary/20 text-primary",
                  isCurrent && "bg-primary text-primary-foreground",
                  !isComplete && !isCurrent && "bg-muted text-muted-foreground"
                )}
              >
                {isComplete ? (
                  <Check className="h-3 w-3" />
                ) : isCurrent ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <StepIcon className="h-3 w-3" />
                )}
                <span className="hidden sm:inline">{t(step.labelKey)}</span>
              </div>
            );
          })}
        </div>

        {/* Tips */}
        <div className="pt-4 text-xs text-muted-foreground space-y-1">
          <p>⚡ {t('aiGenerationProgress.quality')}</p>
          <p>🔒 {t('aiGenerationProgress.secure')}</p>
        </div>
      </div>
    </div>
  );
}
