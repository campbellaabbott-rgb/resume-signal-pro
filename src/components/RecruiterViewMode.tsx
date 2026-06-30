import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  Eye, Loader2, User, Mail, Phone, MapPin, Briefcase, GraduationCap,
  AlertTriangle, CheckCircle, XCircle, Clock, Brain, MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface RecruiterViewModeProps {
  resumeText: string;
  industry?: string;
  currentRole?: string;
}

interface ParsedFields {
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  yearsExperience: string | null;
  education: string | null;
  skills: string[];
  parseErrors: string[];
  parseScore: number;
}

interface HeatmapItem {
  section: string;
  viewOrder: number;
  timeSpent: string;
  attention: "high" | "medium" | "low" | "skipped";
  recruiterThought: string;
}

interface CandidateRanking {
  estimatedRank: string;
  competitivePosition: string;
  strengthSignals: string[];
  weaknessSignals: string[];
  dealBreakers: string[];
}

interface RecruiterNotes {
  firstImpression: string;
  wouldInterview: boolean;
  interviewProbability: string;
  reasoningChain: string[];
  internalNotes: string;
}

interface ScreeningDecision {
  decision: "ADVANCE" | "MAYBE" | "REJECT";
  confidence: string;
  keyFactors: string[];
  improvementToAdvance: string;
}

interface RecruiterViewData {
  atsParsedFields: ParsedFields;
  recruiterHeatmap: HeatmapItem[];
  candidateRanking: CandidateRanking;
  recruiterNotes: RecruiterNotes;
  screeningDecision: ScreeningDecision;
}

const attentionColors = {
  high: "border-l-4 border-l-green-500 bg-green-500/5",
  medium: "border-l-4 border-l-yellow-500 bg-yellow-500/5",
  low: "border-l-4 border-l-orange-500 bg-orange-500/5",
  skipped: "border-l-4 border-l-red-500 bg-red-500/5 opacity-60",
};

export function RecruiterViewMode({ resumeText, industry, currentRole }: RecruiterViewModeProps) {
  const { t } = useTranslation();

  const attentionLabels = {
    high: { text: t('recruiterView.highFocus'), color: "text-green-600" },
    medium: { text: t('recruiterView.glanced'), color: "text-yellow-600" },
    low: { text: t('recruiterView.barelySeen'), color: "text-orange-600" },
    skipped: { text: t('recruiterView.skipped'), color: "text-red-600" },
  };

  const decisionStyles = {
    ADVANCE: { bg: "bg-green-500/10 border-green-500/30", text: "text-green-700", icon: CheckCircle, label: t('recruiterView.advance') },
    MAYBE: { bg: "bg-yellow-500/10 border-yellow-500/30", text: "text-yellow-700", icon: Clock, label: t('recruiterView.maybe') },
    REJECT: { bg: "bg-red-500/10 border-red-500/30", text: "text-red-700", icon: XCircle, label: t('recruiterView.screenedOut') },
  };
  const [data, setData] = useState<RecruiterViewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const generate = async () => {
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("generate-recruiter-view", {
        body: { resumeText, industry, jobTitle: currentRole },
      });
      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || "Generation failed");
      setData(result.data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to generate recruiter view", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  if (!data) {
    return (
      <div className="text-center py-6 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-xs mb-2">
          <Eye className="w-3.5 h-3.5" />
          See your resume through a recruiter's eyes
        </div>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Watch your resume get parsed by an ATS, scanned by a recruiter in 6 seconds, and see their screening decision.
        </p>
        <Button onClick={generate} disabled={isLoading} size="sm" className="gap-2">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          {isLoading ? t('recruiterView.simulating') : t('recruiterView.runSim')}
        </Button>
      </div>
    );
  }

  const { atsParsedFields, recruiterHeatmap, candidateRanking, recruiterNotes, screeningDecision } = data;
  const decisionStyle = decisionStyles[screeningDecision.decision] || decisionStyles.MAYBE;
  const DecisionIcon = decisionStyle.icon;

  return (
    <div className="space-y-5">
      {/* Screening Decision Banner */}
      <div className={cn("rounded-xl border-2 p-4", decisionStyle.bg)}>
        <div className="flex items-center gap-3 mb-2">
          <DecisionIcon className={cn("w-6 h-6", decisionStyle.text)} />
          <div>
            <p className={cn("text-sm font-bold tracking-wide", decisionStyle.text)}>{decisionStyle.label}</p>
            <p className="text-[11px] text-muted-foreground">Confidence: {screeningDecision.confidence}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-lg font-bold text-foreground">{recruiterNotes.interviewProbability}</p>
            <p className="text-[10px] text-muted-foreground">Interview Chance</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground italic">"{recruiterNotes.firstImpression}"</p>
      </div>

      {/* ATS Parsed Fields */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5" /> Step 1: ATS Parsing
          <span className={cn(
            "ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium",
            atsParsedFields.parseScore >= 80 ? "bg-green-500/10 text-green-700" :
            atsParsedFields.parseScore >= 60 ? "bg-yellow-500/10 text-yellow-700" :
            "bg-red-500/10 text-red-700"
          )}>
            {atsParsedFields.parseScore}% parsed
          </span>
        </h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { icon: User, label: t('recruiterView.fieldName'), value: atsParsedFields.name },
            { icon: Mail, label: t('recruiterView.fieldEmail'), value: atsParsedFields.email },
            { icon: Phone, label: t('recruiterView.fieldPhone'), value: atsParsedFields.phone },
            { icon: MapPin, label: t('recruiterView.fieldLocation'), value: atsParsedFields.location },
            { icon: Briefcase, label: t('recruiterView.fieldTitle'), value: atsParsedFields.currentTitle },
            { icon: GraduationCap, label: t('recruiterView.fieldEducation'), value: atsParsedFields.education },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-lg",
              value ? "bg-muted/30" : "bg-red-500/5 border border-red-500/20"
            )}>
              <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">{label}:</span>
              <span className={cn("truncate font-medium", !value && "text-red-600 italic")}>
                {value || t('recruiterView.notFound')}
              </span>
            </div>
          ))}
        </div>
        {atsParsedFields.skills?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {atsParsedFields.skills.slice(0, 12).map((skill, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {skill}
              </span>
            ))}
          </div>
        )}
        {atsParsedFields.parseErrors?.length > 0 && (
          <div className="mt-2 space-y-1">
            {atsParsedFields.parseErrors.map((err, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[11px] text-red-600">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>{err}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recruiter Heatmap */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5" /> Step 2: 6-Second Recruiter Scan
        </h4>
        <div className="space-y-1.5">
          {recruiterHeatmap
            ?.sort((a, b) => a.viewOrder - b.viewOrder)
            .map((item, i) => {
              const attnLabel = attentionLabels[item.attention] || attentionLabels.low;
              return (
                <div key={i} className={cn("rounded-lg px-3 py-2", attentionColors[item.attention])}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-foreground">{item.section}</span>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-muted-foreground">{item.timeSpent}</span>
                      <span className={cn("font-semibold", attnLabel.color)}>{attnLabel.text}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground italic">💭 "{item.recruiterThought}"</p>
                </div>
              );
            })}
        </div>
      </div>

      {/* Candidate Ranking */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Briefcase className="w-3.5 h-3.5" /> Step 3: Candidate Ranking
        </h4>
        <div className="flex items-center gap-3 mb-3">
          <div className="text-center px-3 py-2 rounded-lg bg-primary/10">
            <p className="text-lg font-bold text-primary">{candidateRanking.estimatedRank}</p>
            <p className="text-[10px] text-muted-foreground">{candidateRanking.competitivePosition}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-green-700 uppercase">Strengths</p>
            {candidateRanking.strengthSignals?.map((s, i) => (
              <div key={i} className="flex items-start gap-1 text-[11px]">
                <CheckCircle className="w-3 h-3 text-green-600 shrink-0 mt-0.5" />
                <span className="text-foreground">{s}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-orange-700 uppercase">Weaknesses</p>
            {candidateRanking.weaknessSignals?.map((s, i) => (
              <div key={i} className="flex items-start gap-1 text-[11px]">
                <AlertTriangle className="w-3 h-3 text-orange-600 shrink-0 mt-0.5" />
                <span className="text-foreground">{s}</span>
              </div>
            ))}
          </div>
        </div>
        {candidateRanking.dealBreakers?.length > 0 && (
          <div className="mt-2 p-2 rounded-lg bg-red-500/5 border border-red-500/20">
            <p className="text-[10px] font-semibold text-red-700 uppercase mb-1">⚠️ Deal Breakers</p>
            {candidateRanking.dealBreakers.map((d, i) => (
              <p key={i} className="text-[11px] text-red-700">{d}</p>
            ))}
          </div>
        )}
      </div>

      {/* Recruiter's Internal Notes */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" /> Step 4: Recruiter's Internal Notes
        </h4>
        <div className="bg-muted/20 rounded-xl p-3 border border-border/50 space-y-2">
          <div className="font-mono text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed">
            {recruiterNotes.internalNotes}
          </div>
          <div className="border-t border-border/30 pt-2">
            <p className="text-[10px] font-semibold text-muted-foreground mb-1">Decision Chain:</p>
            {recruiterNotes.reasoningChain?.map((step, i) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                {i + 1}. {step}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* What Would Change the Decision */}
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-3">
        <p className="text-xs font-semibold text-primary mb-1">🎯 #1 Change to Improve Your Chances</p>
        <p className="text-xs text-foreground">{screeningDecision.improvementToAdvance}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {screeningDecision.keyFactors?.map((f, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
