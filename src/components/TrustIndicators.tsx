import { Shield, Lock, Clock, CloudOff, BookOpen, ExternalLink, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useSafeTranslation } from "@/hooks/use-safe-translation";
import { useScanTotals } from "@/hooks/use-scan-totals";

export function TrustIndicators() {
  const { t } = useSafeTranslation();
  // This badge said "10,000+ Resumes" on the homepage while get_scan_totals
  // returned 1,052. It is now the live figure, and the badge is dropped
  // entirely until the RPC answers — an unknown count shows nothing.
  const totals = useScanTotals();

  const securityBadges = [
    ...(totals ? [{
      icon: Users,
      labelKey: "trustIndicators.badges.resumes.label",
      descriptionKey: "trustIndicators.badges.resumes.description",
      values: { total: totals.total_scans.toLocaleString() },
    }] : []),
    {
      icon: Lock,
      labelKey: "trustIndicators.badges.ssl.label",
      descriptionKey: "trustIndicators.badges.ssl.description"
    },
    {
      icon: Clock,
      labelKey: "trustIndicators.badges.autoDelete.label",
      descriptionKey: "trustIndicators.badges.autoDelete.description"
    },
    {
      icon: Shield,
      labelKey: "trustIndicators.badges.gdpr.label",
      descriptionKey: "trustIndicators.badges.gdpr.description"
    },
    {
      icon: CloudOff,
      labelKey: "trustIndicators.badges.zeroStorage.label",
      descriptionKey: "trustIndicators.badges.zeroStorage.description"
    },
    {
      icon: Zap,
      labelKey: "trustIndicators.badges.instant.label",
      descriptionKey: "trustIndicators.badges.instant.description"
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
                  key={badge.labelKey}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card/30 border border-border/30"
                >
                  <IconComponent className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-[11px] font-medium text-foreground leading-tight">{t(badge.labelKey, ((badge as { values?: Record<string, string> }).values ?? {}) as never)}</div>
                    <div className="text-[9px] text-muted-foreground leading-tight">{t(badge.descriptionKey)}</div>
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
                {t('trustIndicators.methodology.title')}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t('trustIndicators.methodology.subtitle')}
              </div>
            </div>
            <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>
        </div>
      </div>
    </section>
  );
}
