import { FileText, Zap, Target, AlertTriangle } from "lucide-react";

const features = [
  { icon: FileText, label: "ATS-optimized bullets" },
  { icon: Zap, label: "Stronger action verbs" },
  { icon: Target, label: "Keyword suggestions" },
  { icon: AlertTriangle, label: "Red flag detection" },
];

export function Hero() {
  return (
    <section className="relative py-20 md:py-32">
      {/* Background glow effect */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="container relative">
        <div className="max-w-3xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm text-primary mb-8 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Recruiter-grade analysis
          </div>
          
          {/* Heading */}
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            Stop guessing what{" "}
            <span className="text-gradient-primary">recruiters see</span>
          </h1>
          
          {/* Subheading */}
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 animate-fade-in" style={{ animationDelay: "0.2s" }}>
            Upload your resume. Get direct, no-BS feedback on what's working and what's killing your chances. Written like a recruiter, not a career coach.
          </p>
          
          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-3 mb-12 animate-fade-in" style={{ animationDelay: "0.3s" }}>
            {features.map((feature, index) => (
              <div
                key={feature.label}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-sm"
              >
                <feature.icon className="w-4 h-4 text-primary" />
                <span className="text-foreground">{feature.label}</span>
              </div>
            ))}
          </div>
          
          {/* Price indicator */}
          <div className="animate-fade-in" style={{ animationDelay: "0.4s" }}>
            <div className="inline-flex items-baseline gap-1 text-muted-foreground">
              <span className="text-3xl font-bold text-foreground">$25</span>
              <span className="text-sm">one-time</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">No subscriptions. No upsells.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
