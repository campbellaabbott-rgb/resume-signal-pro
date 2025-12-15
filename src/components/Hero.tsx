import { FileText, Zap, Target, AlertTriangle, Shield, Clock, Star } from "lucide-react";

const features = [
  { icon: FileText, label: "ATS-optimized bullets", description: "Beat the robots" },
  { icon: Zap, label: "Stronger action verbs", description: "Stand out instantly" },
  { icon: Target, label: "Keyword suggestions", description: "Match job descriptions" },
  { icon: AlertTriangle, label: "Red flag detection", description: "Fix deal-breakers" },
];

const trustBadges = [
  { icon: Shield, label: "Secure & Private" },
  { icon: Clock, label: "Results in 30 seconds" },
  { icon: Star, label: "Recruiter-approved" },
];

export function Hero() {
  return (
    <section className="relative py-24 md:py-36 overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/8 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 right-0 w-[300px] h-[300px] bg-accent/5 rounded-full blur-[80px]" />
      </div>
      
      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />
      
      <div className="container relative">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm text-primary mb-8 animate-fade-in backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            AI-Powered Resume Analysis
          </div>
          
          {/* Heading */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            Stop guessing.{" "}
            <span className="text-gradient-primary block md:inline">Start landing interviews.</span>
          </h1>
          
          {/* Subheading */}
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 animate-fade-in leading-relaxed" style={{ animationDelay: "0.2s" }}>
            Get brutally honest, recruiter-grade feedback on your resume. 
            No fluff, no sugar-coating — just actionable fixes that get you hired.
          </p>
          
          {/* Feature cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-12 animate-fade-in" style={{ animationDelay: "0.3s" }}>
            {features.map((feature) => (
              <div
                key={feature.label}
                className="group relative p-4 rounded-xl bg-card/50 border border-border/50 backdrop-blur-sm hover:border-primary/30 hover:bg-card/80 transition-all duration-300"
              >
                <div className="flex flex-col items-center text-center gap-2">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                    <feature.icon className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{feature.label}</span>
                  <span className="text-xs text-muted-foreground hidden md:block">{feature.description}</span>
                </div>
              </div>
            ))}
          </div>
          
          {/* Price + CTA */}
          <div className="animate-fade-in space-y-6" style={{ animationDelay: "0.4s" }}>
            <div className="inline-flex flex-col items-center p-6 rounded-2xl bg-gradient-to-b from-card/80 to-card/40 border border-border/50 backdrop-blur-sm">
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl md:text-5xl font-bold text-foreground">$25</span>
                <span className="text-muted-foreground">one-time</span>
              </div>
              <p className="text-sm text-muted-foreground">No subscriptions • No hidden fees • Instant results</p>
            </div>
            
            {/* Trust badges */}
            <div className="flex flex-wrap justify-center gap-6 pt-4">
              {trustBadges.map((badge) => (
                <div key={badge.label} className="flex items-center gap-2 text-muted-foreground">
                  <badge.icon className="w-4 h-4 text-primary/70" />
                  <span className="text-sm">{badge.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce hidden md:block">
        <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex justify-center pt-2">
          <div className="w-1 h-2 rounded-full bg-muted-foreground/50" />
        </div>
      </div>
    </section>
  );
}
