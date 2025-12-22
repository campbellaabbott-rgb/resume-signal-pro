import { Shield, Lock, Clock, CloudOff, BookOpen, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

export function TrustIndicators() {
  const securityBadges = [
    {
      icon: Lock,
      label: "256-bit SSL Encryption",
      description: "Bank-level security"
    },
    {
      icon: Clock,
      label: "Auto-deleted in 24h",
      description: "Your data, your control"
    },
    {
      icon: Shield,
      label: "GDPR Compliant",
      description: "Privacy first"
    },
    {
      icon: CloudOff,
      label: "No storage",
      description: "Processed & discarded"
    }
  ];

  return (
    <section className="py-12 border-y border-border/30 bg-muted/20">
      <div className="container">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
          {/* Security Badges */}
          <div className="flex flex-wrap justify-center lg:justify-start gap-6">
            {securityBadges.map((badge) => (
              <div
                key={badge.label}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card/50 border border-border/50"
              >
                <badge.icon className="w-4 h-4 text-primary" />
                <div className="text-left">
                  <div className="text-xs font-medium text-foreground">{badge.label}</div>
                  <div className="text-[10px] text-muted-foreground">{badge.description}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Methodology Link */}
          <Link
            to="/methodology"
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 hover:border-primary/30 transition-colors group"
          >
            <BookOpen className="w-4 h-4 text-primary" />
            <div className="text-left">
              <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                See Our Methodology
              </div>
              <div className="text-xs text-muted-foreground">
                Transparent AI scoring explained
              </div>
            </div>
            <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>
        </div>
      </div>
    </section>
  );
}
