import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { CheckCircle2, Circle, Sparkles, TrendingUp, Clock, Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChecklistItem, useScanHistory } from "@/hooks/use-scan-history";
import { Progress } from "@/components/ui/progress";

interface InteractiveChecklistProps {
  entryId: string;
  items: ChecklistItem[];
  candidateName?: string | null;
}

const categoryLabels: Record<ChecklistItem['category'], { label: string; color: string }> = {
  quick_win: { label: "Quick Win", color: "bg-success/10 text-success" },
  format: { label: "Format", color: "bg-primary/10 text-primary" },
  content: { label: "Content", color: "bg-warning/10 text-warning" },
  keywords: { label: "Keywords", color: "bg-info/10 text-info" },
};

export function InteractiveChecklist({
  const { t } = useTranslation(); entryId, items, candidateName }: InteractiveChecklistProps) {
  const { updateChecklist } = useScanHistory();
  const [localItems, setLocalItems] = useState<ChecklistItem[]>(items);
  const [showConfetti, setShowConfetti] = useState(false);
  
  // Sync with props
  useEffect(() => {
    setLocalItems(items);
  }, [items]);
  
  const completedCount = localItems.filter(item => item.completed).length;
  const totalCount = localItems.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  
  const handleToggle = (itemId: string) => {
    const item = localItems.find(i => i.id === itemId);
    if (!item) return;
    
    const newCompleted = !item.completed;
    
    // Update local state immediately for responsiveness
    setLocalItems(prev => 
      prev.map(i => i.id === itemId ? { ...i, completed: newCompleted } : i)
    );
    
    // Persist to localStorage
    updateChecklist(entryId, itemId, newCompleted);
    
    // Show celebration when completing an item
    if (newCompleted) {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1500);
    }
  };
  
  // Get motivational message based on progress
  const getMotivationalMessage = () => {
    if (completedCount === 0) return t('interactiveChecklist.motivStart');
    if (progressPercent < 33) return t('interactiveChecklist.motivGreat');
    if (progressPercent < 66) return t('interactiveChecklist.motivExcellent');
    if (progressPercent < 100) return t('interactiveChecklist.motivAlmost');
    return "🎉 All done! Your resume is optimized!";
  };
  
  if (totalCount === 0) return null;
  
  const displayName = candidateName || "Your";
  
  return (
    <div className="rounded-2xl bg-card border border-border p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-lg">
              {displayName}'s Optimization Checklist
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {getMotivationalMessage()}
          </p>
        </div>
        
        {/* Progress badge */}
        <div className="flex flex-col items-end gap-1">
          <div className={cn(
            "px-3 py-1 rounded-full text-sm font-medium",
            progressPercent === 100 
              ? "bg-success/10 text-success" 
              : "bg-muted text-muted-foreground"
          )}>
            {completedCount}/{totalCount} done
          </div>
          {progressPercent === 100 && (
            <Award className="w-5 h-5 text-success animate-bounce" />
          )}
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="space-y-2">
        <Progress value={progressPercent} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            ~{Math.ceil((totalCount - completedCount) * 3)} min remaining
          </span>
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            +{Math.round(completedCount * 2)} pts potential
          </span>
        </div>
      </div>
      
      {/* Checklist items */}
      <div className="space-y-2">
        {localItems.map((item, index) => {
          const catInfo = categoryLabels[item.category];
          
          return (
            <button
              key={item.id}
              onClick={() => handleToggle(item.id)}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all duration-200",
                "hover:bg-muted/50 active:scale-[0.99]",
                item.completed && "opacity-60"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Checkbox */}
              <div className={cn(
                "mt-0.5 flex-shrink-0 transition-all duration-300",
                item.completed && "scale-110"
              )}>
                {item.completed ? (
                  <CheckCircle2 className={cn(
                    "w-5 h-5 text-success",
                    showConfetti && "animate-pulse"
                  )} />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground/40" />
                )}
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "text-sm font-medium transition-all duration-200",
                  item.completed && "line-through text-muted-foreground"
                )}>
                  {item.label}
                </p>
                <span className={cn(
                  "inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium",
                  catInfo.color
                )}>
                  {catInfo.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Completion celebration */}
      {progressPercent === 100 && (
        <div className="text-center py-4 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20">
            <Award className="w-5 h-5 text-success" />
            <span className="font-medium text-success">Checklist Complete!</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Re-scan your resume to see your improved score
          </p>
        </div>
      )}
    </div>
  );
}
