import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Flame, Loader2, Copy, CheckCircle, AlertTriangle, Star, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ResumeRoastProps {
  resumeText: string;
  industry?: string;
  currentRole?: string;
}

interface RoastItem {
  target: string;
  roast: string;
  reality: string;
  severity: "mild" | "medium" | "spicy" | "fire";
}

interface ActionItem {
  priority: number;
  fix: string;
  why: string;
  impact: "High" | "Medium" | "Low";
}

interface RoastData {
  roastLevel: string;
  overallRoast: string;
  spiceScore: number;
  roasts: RoastItem[];
  bestThing: { item: string; compliment: string };
  resumePersonality: { character: string; explanation: string };
  tweetableRoast: string;
  actionPlan: ActionItem[];
  finalVerdict: string;
}

const severityConfig = {
  mild: { emoji: "🌶️", bg: "bg-yellow-500/10 border-yellow-500/20", label: "Mild" },
  medium: { emoji: "🌶️🌶️", bg: "bg-orange-500/10 border-orange-500/20", label: "Medium" },
  spicy: { emoji: "🌶️🌶️🌶️", bg: "bg-red-500/10 border-red-500/20", label: "Spicy" },
  fire: { emoji: "🔥🔥🔥", bg: "bg-red-600/10 border-red-600/20", label: "FIRE" },
};

const impactColors = {
  High: "bg-red-500/10 text-red-700",
  Medium: "bg-yellow-500/10 text-yellow-700",
  Low: "bg-green-500/10 text-green-700",
};

export function ResumeRoast({
  const { t } = useTranslation(); resumeText, industry, currentRole }: ResumeRoastProps) {
  const [data, setData] = useState<RoastData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedTweet, setCopiedTweet] = useState(false);
  const { toast } = useToast();

  const generate = async () => {
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("generate-resume-roast", {
        body: { resumeText, industry, currentRole },
      });
      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || t('resumeRoast.genFailed'));
      setData(result.data);
    } catch (err: any) {
      toast({ title: t('resumeRoast.error'), description: err.message || t('resumeRoast.failed'), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const copyTweet = () => {
    if (!data?.tweetableRoast) return;
    navigator.clipboard.writeText(data.tweetableRoast);
    setCopiedTweet(true);
    toast({ title: t('resumeRoast.copied'), description: "Share your roast on social media 🔥" });
    setTimeout(() => setCopiedTweet(false), 2000);
  };

  if (!data) {
    return (
      <div className="text-center py-6 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-xs mb-2">
          <Flame className="w-3.5 h-3.5" />
          Get your resume roasted
        </div>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          A brutally honest, hilariously specific critique of your resume — with real career advice underneath every roast.
        </p>
        <Button onClick={generate} disabled={isLoading} size="sm" className="gap-2" variant="destructive">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
          {isLoading ? t('resumeRoast.preparing') : "🔥 Roast My Resume"}
        </Button>
      </div>
    );
  }

  const spiceBar = Array.from({ length: 10 }, (_, i) => i < data.spiceScore);

  return (
    <div className="space-y-5">
      {/* Spice Header */}
      <div className="rounded-xl bg-gradient-to-r from-orange-500/10 via-red-500/10 to-orange-500/10 border border-red-500/20 p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-bold text-foreground">🔥 {data.roastLevel}</p>
            <div className="flex gap-0.5 mt-1">
              {spiceBar.map((active, i) => (
                <div key={i} className={cn("w-4 h-1.5 rounded-full", active ? "bg-red-500" : "bg-muted/30")} />
              ))}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-foreground">{data.spiceScore}/10</p>
            <p className="text-[10px] text-muted-foreground">Spice Level</p>
          </div>
        </div>
        <p className="text-sm text-foreground/90 mt-2 italic leading-relaxed">"{data.overallRoast}"</p>
      </div>

      {/* Resume Personality */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/20 border border-border/50">
        <span className="text-2xl">🎭</span>
        <div>
          <p className="text-xs font-semibold text-foreground">Your resume is: <span className="text-primary">{data.resumePersonality?.character}</span></p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{data.resumePersonality?.explanation}</p>
        </div>
      </div>

      {/* Individual Roasts */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">The Roasts</h4>
        <div className="space-y-2">
          {data.roasts?.map((roast, i) => {
            const config = severityConfig[roast.severity] || severityConfig.medium;
            return (
              <div key={i} className={cn("rounded-xl border p-3", config.bg)}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-foreground">{roast.target}</span>
                  <span className="text-[10px]">{config.emoji}</span>
                </div>
                <p className="text-xs text-foreground/90 italic mb-2">"{roast.roast}"</p>
                <div className="flex items-start gap-1.5 pt-2 border-t border-border/30">
                  <AlertTriangle className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground">{roast.reality}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* The Best Thing */}
      {data.bestThing && (
        <div className="rounded-xl bg-green-500/5 border border-green-500/20 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Star className="w-3.5 h-3.5 text-green-600" />
            <span className="text-xs font-semibold text-green-700">The One Good Thing</span>
          </div>
          <p className="text-xs text-foreground font-medium">{data.bestThing.item}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 italic">"{data.bestThing.compliment}"</p>
        </div>
      )}

      {/* Shareable Tweet */}
      {data.tweetableRoast && (
        <div className="rounded-xl bg-muted/20 border border-border/50 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Shareable Roast</span>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={copyTweet}>
              {copiedTweet ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedTweet ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-foreground italic">"{data.tweetableRoast}"</p>
        </div>
      )}

      {/* Serious Action Plan */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          OK But Seriously — Fix These
        </h4>
        <div className="space-y-1.5">
          {data.actionPlan?.sort((a, b) => a.priority - b.priority).map((item, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/20">
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5",
                impactColors[item.impact] || impactColors.Medium
              )}>
                #{item.priority}
              </span>
              <div>
                <p className="text-xs font-medium text-foreground">{item.fix}</p>
                <p className="text-[11px] text-muted-foreground">{item.why}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Final Verdict */}
      <div className="text-center py-3 border-t border-border/30">
        <p className="text-sm font-semibold text-foreground italic">"{data.finalVerdict}"</p>
      </div>
    </div>
  );
}
