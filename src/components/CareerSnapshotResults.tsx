import { useState } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  Target,
  CheckCircle2,
  Clock,
  Briefcase,
  Shield,
  Award,
  Copy,
  Check
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CareerSignalScore {
  overall: 'Strong' | 'Mixed' | 'Risky';
  performanceSignal: { score: string; summary: string };
  trajectorySignal: { score: string; summary: string };
  credibilitySignal: { score: string; summary: string };
  seniorityAlignment: { currentLevel: string; targetFit: string; summary: string };
}

interface CareerRisk {
  risk: string;
  recruiterQuestion: string;
  mitigation: string;
}

interface Strength {
  strength: string;
  evidence: string;
}

interface PriorityFix {
  fix: string;
  impact: string;
  timeEstimate: string;
}

interface CareerSnapshotData {
  careerSignalScore: CareerSignalScore;
  recruiterPerception: { summary: string };
  topStrengths: Strength[];
  careerRisks: CareerRisk[];
  positioningGuidance: {
    idealPositioning: string;
    rolesToTarget: string[];
    rolesToAvoid: string[];
    companyStages: string[];
    storyFraming: string;
  };
  priorityFixes: PriorityFix[];
}

interface CareerSnapshotResultsProps {
  data: CareerSnapshotData;
}

const SignalGauge = ({ label, score, icon: Icon }: { label: string; score: string; icon: React.ElementType }) => {
  const getScoreColor = (score: string) => {
    const positiveScores = ['Strong', 'High', 'Growth', 'Aligned'];
    const neutralScores = ['Mixed', 'Medium', 'Stable', 'Stretch'];
    if (positiveScores.includes(score)) return 'text-success';
    if (neutralScores.includes(score)) return 'text-warning';
    return 'text-destructive';
  };

  const getProgressValue = (score: string) => {
    const positiveScores = ['Strong', 'High', 'Growth', 'Aligned'];
    const neutralScores = ['Mixed', 'Medium', 'Stable', 'Stretch'];
    if (positiveScores.includes(score)) return 100;
    if (neutralScores.includes(score)) return 60;
    return 30;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <Badge variant="outline" className={cn("font-semibold", getScoreColor(score))}>
          {score}
        </Badge>
      </div>
      <Progress value={getProgressValue(score)} className="h-2" />
    </div>
  );
};

const ExpandableSection = ({ 
  title, 
  icon: Icon, 
  children, 
  defaultOpen = false,
  badge
}: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-border/50">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-accent/50 transition-colors py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{title}</CardTitle>
                {badge && (
                  <Badge variant="secondary" className="text-xs">{badge}</Badge>
                )}
              </div>
              {isOpen ? (
                <ChevronUp className="w-5 h-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

const CopyButton = ({ text, label }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-8 px-2 text-xs"
    >
      {copied ? (
        <Check className="w-3 h-3 mr-1 text-success" />
      ) : (
        <Copy className="w-3 h-3 mr-1" />
      )}
      {label || 'Copy'}
    </Button>
  );
};

export function CareerSnapshotResults({ data }: CareerSnapshotResultsProps) {
  const getOverallColor = (overall: string) => {
    if (overall === 'Strong') return 'bg-success/20 text-success border-success/30';
    if (overall === 'Mixed') return 'bg-warning/20 text-warning border-warning/30';
    return 'bg-destructive/20 text-destructive border-destructive/30';
  };

  return (
    <div className="space-y-6">
      {/* Overall Career Signal Score */}
      <Card className="border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                <Target className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-xl">Career Signal Score</CardTitle>
                <p className="text-sm text-muted-foreground">How recruiters perceive your career</p>
              </div>
            </div>
            <Badge className={cn("text-lg px-4 py-1 border", getOverallColor(data.careerSignalScore.overall))}>
              {data.careerSignalScore.overall}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SignalGauge 
            label="Performance Signal" 
            score={data.careerSignalScore.performanceSignal.score}
            icon={TrendingUp}
          />
          <p className="text-sm text-muted-foreground pl-6">{data.careerSignalScore.performanceSignal.summary}</p>
          
          <SignalGauge 
            label="Trajectory Signal" 
            score={data.careerSignalScore.trajectorySignal.score}
            icon={TrendingUp}
          />
          <p className="text-sm text-muted-foreground pl-6">{data.careerSignalScore.trajectorySignal.summary}</p>
          
          <SignalGauge 
            label="Credibility Signal" 
            score={data.careerSignalScore.credibilitySignal.score}
            icon={Shield}
          />
          <p className="text-sm text-muted-foreground pl-6">{data.careerSignalScore.credibilitySignal.summary}</p>
          
          <SignalGauge 
            label="Seniority Alignment" 
            score={data.careerSignalScore.seniorityAlignment.targetFit}
            icon={Award}
          />
          <p className="text-sm text-muted-foreground pl-6">
            Current: {data.careerSignalScore.seniorityAlignment.currentLevel} • {data.careerSignalScore.seniorityAlignment.summary}
          </p>
        </CardContent>
      </Card>

      {/* Recruiter Perception */}
      <ExpandableSection title="Recruiter Perception" icon={Briefcase} defaultOpen>
        <div className="bg-accent/50 rounded-lg p-4 border border-border/50">
          <p className="text-foreground leading-relaxed italic">
            "{data.recruiterPerception.summary}"
          </p>
        </div>
        <div className="flex justify-end mt-2">
          <CopyButton text={data.recruiterPerception.summary} label="Copy summary" />
        </div>
      </ExpandableSection>

      {/* Top Strengths */}
      <ExpandableSection title="Top Strengths" icon={Award} badge={`${data.topStrengths.length} identified`}>
        <div className="space-y-4">
          {data.topStrengths.map((strength, index) => (
            <div key={index} className="flex gap-3 p-3 rounded-lg bg-success/5 border border-success/20">
              <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">{strength.strength}</p>
                <p className="text-sm text-muted-foreground mt-1">{strength.evidence}</p>
              </div>
            </div>
          ))}
        </div>
      </ExpandableSection>

      {/* Career Risks */}
      <ExpandableSection title="Career Risks & Questions" icon={AlertTriangle} badge={`${data.careerRisks.length} risks`}>
        <div className="space-y-4">
          {data.careerRisks.map((risk, index) => (
            <div key={index} className="p-4 rounded-lg bg-destructive/5 border border-destructive/20 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-1" />
                <p className="font-medium text-foreground">{risk.risk}</p>
              </div>
              <div className="ml-6 space-y-2">
                <div className="bg-card p-3 rounded border border-border/50">
                  <p className="text-xs text-muted-foreground mb-1">Recruiter will ask:</p>
                  <p className="text-sm italic">"{risk.recruiterQuestion}"</p>
                </div>
                <div className="bg-success/5 p-3 rounded border border-success/20">
                  <p className="text-xs text-muted-foreground mb-1">How to address:</p>
                  <p className="text-sm">{risk.mitigation}</p>
                </div>
                <div className="flex justify-end">
                  <CopyButton text={risk.mitigation} label="Copy response" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </ExpandableSection>

      {/* Positioning Guidance */}
      <ExpandableSection title="Positioning Guidance" icon={Target}>
        <div className="space-y-6">
          <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
            <p className="font-medium text-foreground">{data.positioningGuidance.idealPositioning}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success" />
                Roles to Target
              </h4>
              <ul className="space-y-1">
                {data.positioningGuidance.rolesToTarget.map((role, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    {role}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-destructive" />
                Roles to Avoid
              </h4>
              <ul className="space-y-1">
                {data.positioningGuidance.rolesToAvoid.map((role, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                    {role}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <h4 className="font-medium text-sm text-foreground mb-2">Ideal Company Stages</h4>
            <div className="flex flex-wrap gap-2">
              {data.positioningGuidance.companyStages.map((stage, i) => (
                <Badge key={i} variant="secondary">{stage}</Badge>
              ))}
            </div>
          </div>

          <div className="bg-accent/50 p-4 rounded-lg border border-border/50">
            <h4 className="font-medium text-sm text-foreground mb-2">Story Framing</h4>
            <p className="text-sm text-muted-foreground">{data.positioningGuidance.storyFraming}</p>
            <div className="flex justify-end mt-2">
              <CopyButton text={data.positioningGuidance.storyFraming} label="Copy story" />
            </div>
          </div>
        </div>
      </ExpandableSection>

      {/* Priority Fixes */}
      <ExpandableSection title="Priority Fixes" icon={Clock} badge="Action items">
        <div className="space-y-3">
          {data.priorityFixes.map((fix, index) => (
            <div key={index} className="flex items-start gap-4 p-4 rounded-lg bg-accent/50 border border-border/50">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary">{index + 1}</span>
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{fix.fix}</p>
                <p className="text-sm text-muted-foreground mt-1">{fix.impact}</p>
                <Badge variant="outline" className="mt-2 text-xs">
                  <Clock className="w-3 h-3 mr-1" />
                  {fix.timeEstimate}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </ExpandableSection>
    </div>
  );
}
