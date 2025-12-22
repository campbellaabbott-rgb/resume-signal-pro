import { Shield, Lock, Clock, CloudOff, BookOpen, ExternalLink, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";

export function TrustIndicators() {
  const securityBadges = [
    {
      icon: Users,
      label: "10,000+ Resumes",
      description: "Analyzed & improved"
    },
    {
      icon: Lock,
      label: "256-bit SSL",
      description: "Bank-level encryption"
    },
    {
      icon: Clock,
      label: "Auto-deleted 24h",
      description: "Your data, your control"
    },
    {
      icon: Shield,
      label: "GDPR Compliant",
      description: "Privacy first"
    },
    {
      icon: CloudOff,
      label: "Zero Storage",
      description: "Processed & discarded"
    },
    {
      icon: Zap,
      label: "Instant Delivery",
      description: "Results in 30 seconds"
    }
  ];

  return (
    <section id="trust-indicators" className="py-6 border-b border-border/30 bg-muted/10 scroll-mt-24">
      <div className="container">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          {/* Security Badges */}
          <div className="flex flex-wrap justify-center gap-4 lg:gap-5">
            {securityBadges.map((badge) => {
              const IconComponent = badge.icon;
              return (
                <div
                  key={badge.label}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card/30 border border-border/30"
                >
                  <IconComponent className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-[11px] font-medium text-foreground leading-tight">{badge.label}</div>
                    <div className="text-[9px] text-muted-foreground leading-tight">{badge.description}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Methodology Link */}
          <Link
            to="/methodology"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 hover:border-primary/30 transition-colors group flex-shrink-0"
          >
            <BookOpen className="w-4 h-4 text-primary" />
            <div className="text-left">
              <div className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                See Our Methodology
              </div>
              <div className="text-[10px] text-muted-foreground">
                Transparent AI scoring
              </div>
            </div>
            <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>
        </div>
      </div>
    </section>
  );
}
