import { ArrowRight, Sparkles, XCircle, CheckCircle } from "lucide-react";

const examples = [
  {
    before: "Responsible for managing team projects and deliverables",
    after: "Led 8-person cross-functional team to deliver $2.4M project 3 weeks ahead of schedule",
    improvement: "Added metrics + leadership language"
  },
  {
    before: "Helped with customer service and handled complaints",
    after: "Resolved 150+ customer escalations monthly, achieving 94% satisfaction rate",
    improvement: "Quantified impact + action verb"
  },
  {
    before: "Worked on improving sales processes",
    after: "Redesigned sales pipeline reducing close time by 40%, generating $380K additional revenue",
    improvement: "Specific results + business impact"
  }
];

export const ResumeBeforeAfter = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h5 className="font-semibold text-sm text-foreground">See the AI Difference</h5>
      </div>
      
      <div className="space-y-3">
        {examples.map((example, index) => (
          <div key={index} className="rounded-xl bg-background/50 border border-border/50 p-3 space-y-2">
            {/* Before */}
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-[10px] uppercase tracking-wider text-destructive/70 font-medium">Before</span>
                <p className="text-xs text-muted-foreground line-through decoration-destructive/30">{example.before}</p>
              </div>
            </div>
            
            {/* Arrow */}
            <div className="flex justify-center">
              <ArrowRight className="w-3 h-3 text-muted-foreground/50 rotate-90" />
            </div>
            
            {/* After */}
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-[10px] uppercase tracking-wider text-success/70 font-medium">After</span>
                <p className="text-xs text-foreground font-medium">{example.after}</p>
              </div>
            </div>
            
            {/* Improvement tag */}
            <div className="flex justify-end">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {example.improvement}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      <p className="text-xs text-center text-muted-foreground">
        Your entire resume gets this transformation
      </p>
    </div>
  );
};
