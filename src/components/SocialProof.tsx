import { useTranslation } from "react-i18next";
import { Quote, Briefcase, GraduationCap, Code } from "lucide-react";

const testimonialKeys = ["engineer", "pm", "graduate"];
const testimonialIcons = [Code, Briefcase, GraduationCap];

export function SocialProof() {
  const { t } = useTranslation();

  const stats = [
    { value: "10K+", labelKey: "socialProof.stats.analyzed" },
    { value: "89%", labelKey: "socialProof.stats.betterResults" },
    { value: "30s", labelKey: "socialProof.stats.deliveryTime" },
  ];

  return (
    <section className="py-20 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-transparent pointer-events-none" />
      
      <div className="container relative">
        {/* Stats */}
        <div className="flex flex-wrap justify-center gap-8 md:gap-16 mb-16">
          {stats.map((stat) => (
            <div key={stat.labelKey} className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{t(stat.labelKey)}</div>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {testimonialKeys.map((key, index) => {
            const Icon = testimonialIcons[index];
            return (
              <div
                key={key}
                className="relative p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/20 transition-colors group"
              >
                <Quote className="w-8 h-8 text-primary/20 mb-4 group-hover:text-primary/30 transition-colors" />
                <p className="text-foreground/90 mb-6 leading-relaxed">
                  "{t(`socialProof.testimonials.${key}.quote`)}"
                </p>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-sm text-muted-foreground">{t(`socialProof.testimonials.${key}.role`)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trust message */}
        <p className="text-center text-sm text-muted-foreground mt-12 max-w-md mx-auto">
          {t('socialProof.trustMessage')}
        </p>
      </div>
    </section>
  );
}
