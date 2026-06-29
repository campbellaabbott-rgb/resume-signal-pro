import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Briefcase, Clock, Target, ArrowRight, Sparkles, ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface ProfileQuizData {
  industry: string;
  experienceLevel: string;
  targetRole: string;
}

interface ProfileQuizModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: (data: ProfileQuizData) => void;
}

const INDUSTRIES = [
  { id: "technology", icon: "💻" },
  { id: "healthcare", icon: "🏥" },
  { id: "finance", icon: "💰" },
  { id: "marketing", icon: "📢" },
  { id: "sales", icon: "🎯" },
  { id: "engineering", icon: "⚙️" },
  { id: "education", icon: "📚" },
  { id: "hr", icon: "👥" },
  { id: "consulting", icon: "📊" },
  { id: "legal", icon: "⚖️" },
  { id: "retail", icon: "🛒" },
  { id: "other", icon: "🌐" },
];

const EXPERIENCE_LEVELS = [
  { id: "entry", icon: "🌱" },
  { id: "mid", icon: "📈" },
  { id: "senior", icon: "⭐" },
  { id: "executive", icon: "👔" },
];

const COMMON_ROLES = [
  "Software Engineer",
  "Product Manager",
  "Data Analyst",
  "Marketing Manager",
  "Sales Representative",
  "Project Manager",
  "UX Designer",
  "Business Analyst",
  "Account Manager",
  "Operations Manager",
  "HR Manager",
  "Financial Analyst",
];

export function ProfileQuizModal({ open, onClose, onComplete }: ProfileQuizModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [industry, setIndustry] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [customRole, setCustomRole] = useState("");

  const handleComplete = () => {
    onComplete({
      industry,
      experienceLevel,
      targetRole: targetRole === "custom" ? customRole : targetRole,
    });
    setStep(1);
    setIndustry("");
    setExperienceLevel("");
    setTargetRole("");
    setCustomRole("");
  };

  const handleSkip = () => {
    onComplete({
      industry: "other",
      experienceLevel: "mid",
      targetRole: "",
    });
    setStep(1);
    setIndustry("");
    setExperienceLevel("");
    setTargetRole("");
    setCustomRole("");
  };

  const canProceedStep1 = !!industry;
  const canProceedStep2 = !!experienceLevel;
  const canProceedStep3 = !!targetRole && (targetRole !== "custom" || customRole.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="w-5 h-5 text-primary" />
            {t('profileQuizModal.title')}
          </DialogTitle>
          <DialogDescription>
            {t('profileQuizModal.description')}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mt-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-all duration-300",
                s <= step ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </div>

        {/* Step 1: Industry */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Briefcase className="w-4 h-4" />
              {t('profileQuizModal.step1of3')}
            </div>
            <h3 className="text-lg font-semibold">{t('profileQuizModal.whichIndustry')}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {INDUSTRIES.map((ind) => (
                <button
                  key={ind.id}
                  onClick={() => setIndustry(ind.id)}
                  className={cn(
                    "flex items-center gap-2 p-3 rounded-xl border text-left text-sm font-medium transition-all duration-200",
                    industry === ind.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:border-primary/50 hover:bg-muted/50"
                  )}
                >
                  <span className="text-lg">{ind.icon}</span>
                  <span className="truncate">{t(`profileQuizModal.industries.${ind.id}`)}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-between pt-4">
              <Button variant="ghost" size="sm" onClick={handleSkip}>
                {t('profileQuizModal.skipForNow')}
              </Button>
              <Button onClick={() => setStep(2)} disabled={!canProceedStep1}>
                {t('profileQuizModal.next')}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Experience Level */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              {t('profileQuizModal.step2of3')}
            </div>
            <h3 className="text-lg font-semibold">{t('profileQuizModal.experienceLevel')}</h3>
            <div className="grid grid-cols-2 gap-3">
              {EXPERIENCE_LEVELS.map((exp) => (
                <button
                  key={exp.id}
                  onClick={() => setExperienceLevel(exp.id)}
                  className={cn(
                    "flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition-all duration-200",
                    experienceLevel === exp.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50 hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{exp.icon}</span>
                    <span className="font-semibold">{t(`profileQuizModal.levels.${exp.id}`)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{t(`profileQuizModal.levels.${exp.id}Desc`)}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-between pt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t('profileQuizModal.back')}
              </Button>
              <Button onClick={() => setStep(3)} disabled={!canProceedStep2}>
                {t('profileQuizModal.next')}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Target Role */}
        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="w-4 h-4" />
              {t('profileQuizModal.step3of3')}
            </div>
            <h3 className="text-lg font-semibold">{t('profileQuizModal.targetRole')}</h3>
            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
              {COMMON_ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => {
                    setTargetRole(role);
                    setCustomRole("");
                  }}
                  className={cn(
                    "p-2.5 rounded-lg border text-left text-sm font-medium transition-all duration-200 truncate",
                    targetRole === role
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:border-primary/50 hover:bg-muted/50"
                  )}
                >
                  {role}
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder={t('profileQuizModal.typeYourRole')}
                value={customRole}
                onChange={(e) => {
                  setCustomRole(e.target.value);
                  setTargetRole("custom");
                }}
                onFocus={() => setTargetRole("custom")}
                className={cn(
                  "w-full p-3 rounded-xl border bg-card text-sm transition-all duration-200",
                  targetRole === "custom" && customRole
                    ? "border-primary ring-1 ring-primary/20"
                    : "border-border focus:border-primary focus:ring-1 focus:ring-primary/20"
                )}
              />
            </div>
            <div className="flex justify-between pt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t('profileQuizModal.back')}
              </Button>
              <Button onClick={handleComplete} disabled={!canProceedStep3} className="gap-2">
                <Sparkles className="w-4 h-4" />
                {t('profileQuizModal.getPersonalized')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
