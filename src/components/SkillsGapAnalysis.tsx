// Skills Gap Analysis - Compares resume skills against role requirements
import { AlertTriangle, CheckCircle2, Target, TrendingUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { type RoleConfig } from "@/config/personalization";

interface SkillsGapAnalysisProps {
  roleConfig: RoleConfig;
  detectedSkills: string[];
  className?: string;
}

export function SkillsGapAnalysis({ 
  roleConfig, 
  detectedSkills, 
  className 
}: SkillsGapAnalysisProps) {
  const normalizedDetected = detectedSkills.map(s => s.toLowerCase().trim());
  
  // Check which required skills are present/missing
  const skillAnalysis = roleConfig.keySkills.map(skill => {
    const isPresent = normalizedDetected.some(detected => 
      detected.includes(skill.toLowerCase()) || 
      skill.toLowerCase().includes(detected)
    );
    return { skill, isPresent };
  });
  
  // Check which keywords are present/missing
  const keywordAnalysis = roleConfig.mustHaveKeywords.map(keyword => {
    const isPresent = normalizedDetected.some(detected => 
      detected.includes(keyword.toLowerCase()) || 
      keyword.toLowerCase().includes(detected)
    );
    return { keyword, isPresent };
  });
  
  const presentSkills = skillAnalysis.filter(s => s.isPresent);
  const missingSkills = skillAnalysis.filter(s => !s.isPresent);
  const presentKeywords = keywordAnalysis.filter(k => k.isPresent);
  const missingKeywords = keywordAnalysis.filter(k => !k.isPresent);
  
  const skillMatchRate = Math.round((presentSkills.length / skillAnalysis.length) * 100);
  const keywordMatchRate = Math.round((presentKeywords.length / keywordAnalysis.length) * 100);
  const overallMatchRate = Math.round((skillMatchRate + keywordMatchRate) / 2);
  
  const getScoreColor = (rate: number) => {
    if (rate >= 75) return "text-success";
    if (rate >= 50) return "text-amber-500";
    return "text-destructive";
  };
  
  const getScoreLabel = (rate: number) => {
    if (rate >= 75) return "Strong Match";
    if (rate >= 50) return "Partial Match";
    return "Needs Improvement";
  };

  return (
    <div className={cn("p-4 rounded-xl bg-card border border-border", className)}>
      <h4 className="font-semibold text-foreground flex items-center gap-2 mb-4">
        <Target className="w-5 h-5 text-primary" />
        Skills Gap Analysis for {roleConfig.name}
      </h4>
      
      {/* Overall Score */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Role Match Score</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-xl font-bold", getScoreColor(overallMatchRate))}>
            {overallMatchRate}%
          </span>
          <span className={cn("text-xs px-2 py-0.5 rounded-full", 
            overallMatchRate >= 75 ? "bg-success/10 text-success" :
            overallMatchRate >= 50 ? "bg-amber-500/10 text-amber-600" :
            "bg-destructive/10 text-destructive"
          )}>
            {getScoreLabel(overallMatchRate)}
          </span>
        </div>
      </div>
      
      {/* Skills Breakdown */}
      <div className="space-y-4">
        {/* Key Skills Section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Key Skills</span>
            <span className={cn("text-xs font-medium", getScoreColor(skillMatchRate))}>
              {presentSkills.length}/{skillAnalysis.length} matched
            </span>
          </div>
          
          {/* Present Skills */}
          {presentSkills.length > 0 && (
            <div className="mb-2">
              <div className="flex flex-wrap gap-1.5">
                {presentSkills.map(({ skill }, i) => (
                  <span 
                    key={i} 
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-success/10 text-success text-xs font-medium"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Missing Skills */}
          {missingSkills.length > 0 && (
            <div>
              <p className="text-xs text-destructive font-medium mb-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Missing skills to add:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missingSkills.map(({ skill }, i) => (
                  <span 
                    key={i} 
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-destructive/10 text-destructive text-xs font-medium border border-destructive/20 border-dashed"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Keywords Section */}
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">ATS Keywords</span>
            <span className={cn("text-xs font-medium", getScoreColor(keywordMatchRate))}>
              {presentKeywords.length}/{keywordAnalysis.length} found
            </span>
          </div>
          
          {/* Present Keywords */}
          {presentKeywords.length > 0 && (
            <div className="mb-2">
              <div className="flex flex-wrap gap-1.5">
                {presentKeywords.map(({ keyword }, i) => (
                  <span 
                    key={i} 
                    className="px-2 py-0.5 rounded bg-success/10 text-success text-xs"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Missing Keywords */}
          {missingKeywords.length > 0 && (
            <div>
              <p className="text-xs text-amber-600 font-medium mb-1.5 flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Add these keywords to boost ATS score:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {missingKeywords.map(({ keyword }, i) => (
                  <span 
                    key={i} 
                    className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 text-xs border border-amber-500/20 border-dashed"
                  >
                    + {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Priority Actions */}
      {(missingSkills.length > 0 || missingKeywords.length > 0) && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-xs font-semibold text-foreground mb-2">🎯 Priority Actions:</p>
          <div className="space-y-1.5">
            {missingSkills.slice(0, 2).map(({ skill }, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                • Add "{skill}" to your skills section or demonstrate it in your experience bullets
              </p>
            ))}
            {missingKeywords.slice(0, 2).map(({ keyword }, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                • Include "{keyword}" in your achievement bullets with specific metrics
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
