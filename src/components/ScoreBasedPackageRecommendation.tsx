import { Link } from "react-router-dom";
import { Crown, FileText, Sparkles, ArrowRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScoreBasedPackageRecommendationProps {
  atsScore: number;
}

export function ScoreBasedPackageRecommendation({ atsScore }: ScoreBasedPackageRecommendationProps) {
  // Determine recommendation based on score
  const getRecommendation = () => {
    if (atsScore < 50) {
      return {
        urgency: "high",
        title: "Your resume needs significant improvements",
        subtitle: "We recommend the Premium Package for a complete overhaul",
        recommended: {
          id: "premiumPackage",
          name: "Premium Package",
          price: 35,
          icon: Crown,
          reason: "Complete rewrite + ATS optimization + LinkedIn profile",
          estimatedGain: "30-40 points",
        },
        alternative: {
          id: "basicKeywordFix",
          name: "Keyword Fix",
          price: 10,
          reason: "Quick ATS keyword optimization",
        },
      };
    } else if (atsScore < 70) {
      return {
        urgency: "medium",
        title: "Your resume has room for improvement",
        subtitle: "A targeted fix could boost your score significantly",
        recommended: {
          id: "basicKeywordFix",
          name: "Keyword Fix",
          price: 10,
          icon: FileText,
          reason: "Add missing keywords + improve bullet points",
          estimatedGain: "15-25 points",
        },
        alternative: {
          id: "premiumPackage",
          name: "Premium Package",
          price: 35,
          reason: "For a complete professional overhaul",
        },
      };
    } else {
      return {
        urgency: "low",
        title: "Your resume is already strong!",
        subtitle: "Fine-tune it for specific job applications",
        recommended: {
          id: "fullAnalysis",
          name: "Full Analysis",
          price: 25,
          icon: Sparkles,
          reason: "Get detailed rewrites + job-specific tailoring",
          estimatedGain: "5-15 points",
        },
        alternative: {
          id: "coverLetter",
          name: "Cover Letter",
          price: 15,
          reason: "Complete your application package",
        },
      };
    }
  };

  const recommendation = getRecommendation();
  const RecommendedIcon = recommendation.recommended.icon;

  return (
    <div className="mt-8 p-6 rounded-2xl bg-gradient-to-br from-primary/5 via-accent/50 to-primary/5 border border-primary/20">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-full bg-primary/10">
          <TrendingUp className="w-5 h-5 text-primary" />
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
          recommendation.urgency === "high"
            ? "border-primary bg-primary/5 hover:bg-primary/10"
            : "border-border bg-card hover:border-primary/50"
        )}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <RecommendedIcon className="w-5 h-5 text-primary" />
            <span className="font-semibold">{recommendation.recommended.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              Recommended
            </span>
          </div>
          <span className="text-xl font-bold">${recommendation.recommended.price}</span>
        </div>
        <p className="text-sm text-muted-foreground mb-2">{recommendation.recommended.reason}</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-primary font-medium flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Estimated gain: {recommendation.recommended.estimatedGain}
          </span>
          <span className="text-sm text-primary flex items-center gap-1">
            View details <ArrowRight className="w-3 h-3" />
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
          className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
        >
          Compare all packages <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
