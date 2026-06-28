import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2,
  XCircle,
  Target,
  Briefcase,
  MessageSquare,
  Calendar,
  Copy,
  Check,
  Linkedin,
  Users,
  BookOpen,
  Sparkles,
  ArrowRight,
  Download
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { exportGraduateGamePlanPDF } from '@/lib/pdf-export';
import { hasUnsupportedPdfCharacters } from '@/lib/pdf-text-support';

interface ResumeReadinessGate {
  verdict: 'Ready to Apply' | 'Fix These First';
  confidence: 'High' | 'Medium';
  summary: string;
  quickFixes: string[];
}

interface PriorityRole {
  title: string;
  whyFit: string;
}

interface RoleToAvoid {
  title: string;
  reason: string;
}

interface ApplicationChannel {
  channel: string;
  priority: 'High' | 'Medium' | 'Low';
  tip: string;
}

interface StoryPrompt {
  type: string;
  prompt: string;
}

interface WeekPlan {
  focus: string;
  tasks: string[];
}

interface GraduateGamePlanData {
  resumeReadinessGate: ResumeReadinessGate;
  roleTargetingMap: {
    summary: string;
    priorityRoles: PriorityRole[];
    rolesToAvoid: RoleToAvoid[];
  };
  applicationStrategy: {
    weeklyTarget: string;
    whereToApply: ApplicationChannel[];
    whatToAvoid: string[];
    keyInsight: string;
  };
  networkingPlaybook: {
    approach: string;
    outreachScript: {
      scenario: string;
      script: string;
    };
    linkedInTips: string[];
  };
  interviewReadiness: {
    summary: string;
    storiesToPrepare: StoryPrompt[];
    whyThisRole: string;
    projectTalkingPoints: string[];
  };
  thirtyDayPlan: {
    week1: WeekPlan;
    week2: WeekPlan;
    week3: WeekPlan;
    week4: WeekPlan;
  };
}

interface GraduateGamePlanResultsProps {
  data: GraduateGamePlanData;
}

const ExpandableSection = ({ 
  title, 
  icon: Icon, 
  children, 
  defaultOpen = false,
  badge,
  accentColor = 'primary'
}: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  accentColor?: 'primary' | 'success' | 'warning' | 'destructive';
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const colorClasses = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive'
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-border/50">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-accent/50 transition-colors py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", colorClasses[accentColor])}>
                  <Icon className="w-5 h-5" />
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
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(t('graduateGamePlan.toast.copied'));
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
      {label || t('graduateGamePlan.copyDefault')}
    </Button>
  );
};

const WeekCard = ({ weekNum, plan }: { weekNum: number; plan: WeekPlan }) => {
  const { t } = useTranslation();
  const weekColors = ['bg-primary', 'bg-blue-500', 'bg-purple-500', 'bg-green-500'];

  return (
    <div className="relative">
      <div className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-full", weekColors[weekNum - 1])} />
      <div className="pl-4 py-2">
        <div className="flex items-center gap-2 mb-2">
          <Badge className={cn("text-xs", weekColors[weekNum - 1])}>{t('graduateGamePlan.week', { num: weekNum })}</Badge>
          <span className="text-sm font-medium">{plan.focus}</span>
        </div>
        <ul className="space-y-1">
          {plan.tasks.map((task, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
              {task}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export function GraduateGamePlanResults({ data }: GraduateGamePlanResultsProps) {
  const { t } = useTranslation();
  const isReady = data.resumeReadinessGate.verdict === 'Ready to Apply';

  const handleExportPDF = () => {
    try {
      // The PDF export's standard font only supports Latin-1 + common
      // punctuation — content in other scripts would otherwise render as
      // blank/missing glyphs with no explanation.
      if (hasUnsupportedPdfCharacters(JSON.stringify(data))) {
        toast.warning(t('graduateGamePlan.toast.pdfCharWarning'));
      }
      exportGraduateGamePlanPDF(data);
      toast.success(t('graduateGamePlan.toast.pdfSuccess'));
    } catch (error) {
      toast.error(t('graduateGamePlan.toast.pdfError'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Button */}
      <div className="flex justify-end">
        <Button onClick={handleExportPDF} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          {t('graduateGamePlan.downloadPdf')}
        </Button>
      </div>

      {/* Resume Readiness Gate */}
      <Card className={cn(
        "border-2",
        isReady 
          ? "border-success/30 bg-gradient-to-br from-card to-success/5" 
          : "border-warning/30 bg-gradient-to-br from-card to-warning/5"
      )}>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                isReady ? "bg-success/20" : "bg-warning/20"
              )}>
                {isReady ? (
                  <CheckCircle2 className="w-6 h-6 text-success" />
                ) : (
                  <Sparkles className="w-6 h-6 text-warning" />
                )}
              </div>
              <div>
                <CardTitle className="text-xl">{t('graduateGamePlan.readinessGate.title')}</CardTitle>
                <p className="text-sm text-muted-foreground">{t('graduateGamePlan.readinessGate.subtitle')}</p>
              </div>
            </div>
            <Badge className={cn(
              "text-sm px-4 py-1",
              isReady ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"
            )}>
              {data.resumeReadinessGate.verdict}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-foreground mb-4">{data.resumeReadinessGate.summary}</p>
          
          {data.resumeReadinessGate.quickFixes && data.resumeReadinessGate.quickFixes.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('graduateGamePlan.readinessGate.quickFixesLabel')}</p>
              {data.resumeReadinessGate.quickFixes.map((fix, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <ArrowRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                  <span>{fix}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Role Targeting Map */}
      <ExpandableSection title={t('graduateGamePlan.roleTargeting.title')} icon={Target} defaultOpen accentColor="primary">
        <p className="text-muted-foreground mb-4">{data.roleTargetingMap.summary}</p>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-sm text-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-success" />
              {t('graduateGamePlan.roleTargeting.priorityRoles')}
            </h4>
            <div className="space-y-3">
              {data.roleTargetingMap.priorityRoles.map((role, i) => (
                <div key={i} className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <p className="font-medium text-foreground">{role.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{role.whyFit}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-medium text-sm text-foreground mb-3 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-destructive" />
              {t('graduateGamePlan.roleTargeting.rolesToAvoid')}
            </h4>
            <div className="space-y-3">
              {data.roleTargetingMap.rolesToAvoid.map((role, i) => (
                <div key={i} className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <p className="font-medium text-foreground">{role.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{role.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ExpandableSection>

      {/* Application Strategy */}
      <ExpandableSection title={t('graduateGamePlan.applicationStrategy.title')} icon={Briefcase} accentColor="primary">
        <div className="space-y-6">
          <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
            <p className="font-semibold text-primary mb-2">{t('graduateGamePlan.applicationStrategy.weeklyTarget')}</p>
            <p className="text-foreground">{data.applicationStrategy.weeklyTarget}</p>
          </div>

          <div>
            <h4 className="font-medium text-sm text-foreground mb-3">{t('graduateGamePlan.applicationStrategy.whereToApply')}</h4>
            <div className="space-y-3">
              {data.applicationStrategy.whereToApply.map((channel, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-accent/50 border border-border/50">
                  <Badge variant={
                    channel.priority === 'High' ? 'default' : 
                    channel.priority === 'Medium' ? 'secondary' : 'outline'
                  } className="mt-0.5">
                    {channel.priority}
                  </Badge>
                  <div>
                    <p className="font-medium text-foreground">{channel.channel}</p>
                    <p className="text-sm text-muted-foreground mt-1">{channel.tip}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-destructive" />
              {t('graduateGamePlan.applicationStrategy.whatToAvoid')}
            </h4>
            <ul className="space-y-1">
              {data.applicationStrategy.whatToAvoid.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-accent/50 p-4 rounded-lg border border-border/50">
            <p className="text-sm font-medium text-foreground mb-1">{t('graduateGamePlan.applicationStrategy.keyInsight')}</p>
            <p className="text-sm text-muted-foreground">{data.applicationStrategy.keyInsight}</p>
          </div>
        </div>
      </ExpandableSection>

      {/* Networking Playbook */}
      <ExpandableSection title={t('graduateGamePlan.networking.title')} icon={Users} accentColor="primary">
        <div className="space-y-6">
          <p className="text-muted-foreground">{data.networkingPlaybook.approach}</p>

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="bg-accent/50 px-4 py-2 border-b border-border">
              <p className="text-sm font-medium flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                {data.networkingPlaybook.outreachScript.scenario}
              </p>
            </div>
            <div className="p-4">
              <p className="text-sm text-foreground whitespace-pre-wrap font-mono bg-accent/30 p-3 rounded">
                {data.networkingPlaybook.outreachScript.script}
              </p>
              <div className="flex justify-end mt-2">
                <CopyButton text={data.networkingPlaybook.outreachScript.script} label={t('graduateGamePlan.networking.copyScript')} />
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-medium text-sm text-foreground mb-3 flex items-center gap-2">
              <Linkedin className="w-4 h-4 text-blue-500" />
              {t('graduateGamePlan.networking.linkedinTips')}
            </h4>
            <ul className="space-y-2">
              {data.networkingPlaybook.linkedInTips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ExpandableSection>

      {/* Interview Readiness */}
      <ExpandableSection title={t('graduateGamePlan.interview.title')} icon={BookOpen} accentColor="primary">
        <div className="space-y-6">
          <p className="text-muted-foreground">{data.interviewReadiness.summary}</p>

          <div>
            <h4 className="font-medium text-sm text-foreground mb-3">{t('graduateGamePlan.interview.storiesToPrepare')}</h4>
            <div className="space-y-3">
              {data.interviewReadiness.storiesToPrepare.map((story, i) => (
                <div key={i} className="p-3 rounded-lg bg-accent/50 border border-border/50">
                  <Badge variant="outline" className="mb-2">{story.type}</Badge>
                  <p className="text-sm text-foreground">{story.prompt}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
            <h4 className="font-medium text-sm text-foreground mb-2">{t('graduateGamePlan.interview.whyThisRole')}</h4>
            <p className="text-sm text-muted-foreground">{data.interviewReadiness.whyThisRole}</p>
            <div className="flex justify-end mt-2">
              <CopyButton text={data.interviewReadiness.whyThisRole} label={t('graduateGamePlan.interview.copyAnswer')} />
            </div>
          </div>

          <div>
            <h4 className="font-medium text-sm text-foreground mb-3">{t('graduateGamePlan.interview.projectTalkingPoints')}</h4>
            <ul className="space-y-2">
              {data.interviewReadiness.projectTalkingPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">
                    {i + 1}
                  </span>
                  <span className="mt-0.5">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ExpandableSection>

      {/* 30-Day Action Plan */}
      <ExpandableSection title={t('graduateGamePlan.thirtyDay.title')} icon={Calendar} badge={t('graduateGamePlan.thirtyDay.badge')} accentColor="success">
        <div className="space-y-4">
          <Progress value={0} className="h-2 mb-6" />
          
          <WeekCard weekNum={1} plan={data.thirtyDayPlan.week1} />
          <WeekCard weekNum={2} plan={data.thirtyDayPlan.week2} />
          <WeekCard weekNum={3} plan={data.thirtyDayPlan.week3} />
          <WeekCard weekNum={4} plan={data.thirtyDayPlan.week4} />
        </div>
      </ExpandableSection>
    </div>
  );
}
