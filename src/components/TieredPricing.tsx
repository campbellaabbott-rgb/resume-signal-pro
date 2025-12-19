import { Check, Crown, Sparkles, FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TieredPricingProps {
  onSelectBasic: () => void;
  onSelectFull: () => void;
  onSelectPremium: () => void;
  isLoading?: boolean;
}

export function TieredPricing({ 
  onSelectBasic, 
  onSelectFull, 
  onSelectPremium,
  isLoading 
}: TieredPricingProps) {
  const tiers = [
    {
      id: 'basic',
      name: 'Basic Fix',
      price: 10,
      description: 'Quick keyword fixes',
      icon: FileText,
      features: [
        'Missing keyword list',
        'Top 10 keywords to add',
        'Industry suggestions'
      ],
      cta: 'Get Keywords',
      onClick: onSelectBasic,
      popular: false,
    },
    {
      id: 'full',
      name: 'Full Analysis',
      price: 25,
      description: 'Complete optimization',
      icon: Sparkles,
      features: [
        'ATS score breakdown',
        'Bullet-by-bullet rewrites',
        'Priority action plan',
        'PDF export'
      ],
      cta: 'Get Full Report',
      onClick: onSelectFull,
      popular: true,
    },
    {
      id: 'premium',
      name: 'Premium Package',
      price: 59,
      originalPrice: 87,
      description: 'Everything + rewritten resume',
      icon: Crown,
      features: [
        'Everything in Full Analysis',
        'AI-rewritten resume',
        'Custom cover letter',
        'Before/after comparison'
      ],
      cta: 'Get Premium',
      onClick: onSelectPremium,
      popular: false,
      badge: 'Best Value'
    }
  ];

  return (
    <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-card to-card/50 p-6">
      <div className="text-center mb-6">
        <h3 className="text-xl font-bold mb-2">Choose Your Fix</h3>
        <p className="text-sm text-muted-foreground">
          Select the level of optimization that fits your needs
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          return (
            <div 
              key={tier.id}
              className={cn(
                "relative flex flex-col rounded-xl border p-4 transition-all hover:shadow-md",
                tier.popular 
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20" 
                  : "border-border bg-card hover:border-primary/30"
              )}
            >
              {/* Badge */}
              {tier.badge && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  {tier.badge}
                </Badge>
              )}
              {tier.popular && !tier.badge && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  Most Popular
                </Badge>
              )}

              {/* Header */}
              <div className="text-center mb-4">
                <div className={cn(
                  "w-10 h-10 rounded-lg mx-auto mb-3 flex items-center justify-center",
                  tier.popular ? "bg-primary/20" : "bg-accent"
                )}>
                  <Icon className={cn(
                    "w-5 h-5",
                    tier.popular ? "text-primary" : "text-muted-foreground"
                  )} />
                </div>
                <h4 className="font-bold">{tier.name}</h4>
                <p className="text-xs text-muted-foreground">{tier.description}</p>
              </div>

              {/* Price */}
              <div className="text-center mb-4">
                <div className="flex items-baseline justify-center gap-1">
                  {tier.originalPrice && (
                    <span className="text-sm text-muted-foreground line-through">
                      ${tier.originalPrice}
                    </span>
                  )}
                  <span className="text-3xl font-bold">${tier.price}</span>
                </div>
                {tier.originalPrice && (
                  <span className="text-xs text-success font-medium">
                    Save ${tier.originalPrice - tier.price}
                  </span>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-2 mb-4 flex-1">
                {tier.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className={cn(
                      "w-4 h-4 flex-shrink-0 mt-0.5",
                      tier.popular ? "text-primary" : "text-muted-foreground"
                    )} />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Button 
                onClick={tier.onClick}
                disabled={isLoading}
                className={cn(
                  "w-full gap-2",
                  tier.popular 
                    ? "bg-primary hover:bg-primary/90" 
                    : "bg-secondary hover:bg-secondary/80 text-secondary-foreground"
                )}
              >
                {tier.cta}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        One-time payment • Instant results • Secure checkout via Stripe
      </p>
    </div>
  );
}
