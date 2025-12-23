import { Link } from "react-router-dom";
import { Crown, FileText, Sparkles, ArrowRight, TrendingUp, AlertTriangle, Clock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRODUCTS } from "@/config/products";

interface ScoreBasedPackageRecommendationProps {
  atsScore: number;
}

export function ScoreBasedPackageRecommendation({ atsScore }: ScoreBasedPackageRecommendationProps) {
  // Determine recommendation based on score - use prices from products config
  const getRecommendation = () => {
    if (atsScore < 50) {
      return {
        urgency: "high",
        title: "⚠️ Your resume is being auto-rejected",
        subtitle: "ATS systems are filtering you out before recruiters see your application",
        urgencyBadge: "Critical",
        urgencyMessage: "75% of resumes with scores below 50 never reach a human recruiter",
        recommended: {
          id: "premiumPackage",
          name: PRODUCTS.premiumPackage.name,
          price: PRODUCTS.premiumPackage.priceUsd,
          icon: Crown,
          reason: "Complete rewrite + ATS optimization + cover letter",
          estimatedGain: "30-40 points",
        },
        alternative: {
          id: "basicKeywordFix",
          name: PRODUCTS.basicKeywordFix.name,
          price: PRODUCTS.basicKeywordFix.priceUsd,
          reason: "Quick ATS keyword optimization",
        },
      };
    } else if (atsScore < 70) {
      return {
        urgency: "medium",
        title: "Your resume has room for improvement",
        subtitle: "A targeted fix could boost your score significantly",
        urgencyBadge: null,
        urgencyMessage: null,
        recommended: {
          id: "basicKeywordFix",
          name: PRODUCTS.basicKeywordFix.name,
          price: PRODUCTS.basicKeywordFix.priceUsd,
          icon: FileText,
          reason: "Add missing keywords + improve bullet points",
          estimatedGain: "15-25 points",
        },
        alternative: {
          id: "premiumPackage",
          name: PRODUCTS.premiumPackage.name,
          price: PRODUCTS.premiumPackage.priceUsd,
          reason: "For a complete professional overhaul",
        },
      };
    } else {
      return {
        urgency: "low",
        title: "Your resume is already strong!",
        subtitle: "Fine-tune it for specific job applications",
        urgencyBadge: null,
        urgencyMessage: null,
        recommended: {
          id: "fullAnalysis",
          name: PRODUCTS.fullAnalysis.name,
          price: PRODUCTS.fullAnalysis.priceUsd,
          icon: Sparkles,
          reason: "Get detailed rewrites + job-specific tailoring",
          estimatedGain: "5-15 points",
        },
        alternative: {
          id: "coverLetter",
          name: PRODUCTS.coverLetter.name,
          price: PRODUCTS.coverLetter.priceUsd,
          reason: "Complete your application package",
        },
      };
    }
  };

  const recommendation = getRecommendation();
  const RecommendedIcon = recommendation.recommended.icon;
  const isHighUrgency = recommendation.urgency === "high";

  return (
    <div className={cn(
      "mt-8 p-6 rounded-2xl border",
      isHighUrgency 
        ? "bg-gradient-to-br from-destructive/10 via-destructive/5 to-warning/10 border-destructive/30" 
        : "bg-gradient-to-br from-primary/5 via-accent/50 to-primary/5 border-primary/20"
    )}>
      {/* Urgency Banner for low scores */}
      {isHighUrgency && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-destructive text-destructive-foreground animate-pulse">
                {recommendation.urgencyBadge}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> Fix before your next application
              </span>
            </div>
            <p className="text-sm text-foreground font-medium">
              {recommendation.urgencyMessage}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 mb-4">
        <div className={cn(
          "p-2 rounded-full",
          isHighUrgency ? "bg-destructive/20" : "bg-primary/10"
        )}>
          {isHighUrgency ? (
            <Zap className="w-5 h-5 text-destructive" />
          ) : (
            <TrendingUp className="w-5 h-5 text-primary" />
          )}
        </div>
        <div>
          <h3 className="font-bold text-lg">{recommendation.title}</h3>
          <p className="text-sm text-muted-foreground">{recommendation.subtitle}</p>
        </div>
      </div>

      {/* Recommended Package */}
      <Link
        to="/pricing"
        className={cn(
          "block p-4 rounded-xl border-2 mb-3 transition-all hover:shadow-lg hover:-translate-y-0.5",
          isHighUrgency
            ? "border-destructive bg-destructive/5 hover:bg-destructive/10 ring-2 ring-destructive/20"
            : recommendation.urgency === "medium"
              ? "border-primary bg-primary/5 hover:bg-primary/10"
              : "border-border bg-card hover:border-primary/50"
        )}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <RecommendedIcon className={cn("w-5 h-5", isHighUrgency ? "text-destructive" : "text-primary")} />
            <span className="font-semibold">{recommendation.recommended.name}</span>
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              isHighUrgency 
                ? "bg-destructive/20 text-destructive" 
                : "bg-primary/10 text-primary"
            )}>
              {isHighUrgency ? "Strongly Recommended" : "Recommended"}
            </span>
          </div>
          <span className="text-xl font-bold">${recommendation.recommended.price}</span>
        </div>
        <p className="text-sm text-muted-foreground mb-2">{recommendation.recommended.reason}</p>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className={cn(
            "text-sm font-medium flex items-center gap-1",
            isHighUrgency ? "text-destructive" : "text-primary"
          )}>
            <TrendingUp className="w-3 h-3" />
            Estimated gain: {recommendation.recommended.estimatedGain}
          </span>
          <span className={cn(
            "text-sm flex items-center gap-1",
            isHighUrgency ? "text-destructive" : "text-primary"
          )}>
            {isHighUrgency ? "Fix Now" : "View details"} <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </Link>

      {/* Alternative */}
      <Link
        to="/pricing"
        className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50 hover:bg-card transition-colors"
      >
        <div>
          <span className="text-sm font-medium">{recommendation.alternative.name}</span>
          <span className="text-xs text-muted-foreground ml-2">— {recommendation.alternative.reason}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold">${recommendation.alternative.price}</span>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </Link>

      {/* See all packages link */}
      <div className="mt-4 text-center">
        <Link
          to="/pricing"
          onClick={() => window.scrollTo(0, 0)}
          className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
        >
          Compare all packages <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
