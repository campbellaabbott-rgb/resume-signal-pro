import { Link } from "react-router-dom";
import { Crown, FileText, Package, ArrowRight, Sparkles, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const featuredProducts = [
  {
    id: 'premiumPackage',
    name: 'Premium Package',
    price: 59,
    description: 'Full analysis + AI rewrite',
    icon: Crown,
    highlight: false,
  },
  {
    id: 'atsDefense',
    name: 'ATS Defense',
    price: 69,
    description: 'Multi-role ATS optimization',
    icon: ShieldCheck,
    highlight: true,
    badge: 'Most Comprehensive',
  },
  {
    id: 'careerBundle',
    name: 'Career Bundle',
    price: 150,
    description: '75 full analyses',
    icon: Package,
    highlight: false,
    badge: 'Best Value',
  },
];

export function MiniPricingCards() {
  return (
    <section className="py-16 border-t border-border/50">
      <div className="container">
        <div className="text-center mb-10">
          <Badge variant="outline" className="mb-3 text-xs px-3 py-1 rounded-full border-primary/30 text-primary">
            <Sparkles className="w-3 h-3 mr-1" />
            One-time payments
          </Badge>
          <h2 className="text-2xl md:text-3xl font-bold mb-2">
            Choose Your Resume Boost
          </h2>
          <p className="text-muted-foreground">
            From quick fixes to complete career packages
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
          {featuredProducts.map((product) => {
            const Icon = product.icon;
            return (
              <Link
                key={product.id}
                to="/pricing"
                className={cn(
                  "group relative p-5 rounded-xl border-2 bg-card transition-all hover:shadow-lg hover:-translate-y-1",
                  product.highlight
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/50"
                )}
              >
                {product.badge && (
                  <span className={cn(
                    "absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs font-medium px-2.5 py-0.5 rounded-full",
                    product.highlight
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-accent-foreground"
                  )}>
                    {product.badge}
                  </span>
                )}
                
                <div className="flex items-center gap-3 mb-3">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center",
                    product.highlight ? "bg-primary/20" : "bg-accent"
                  )}>
                    <Icon className={cn(
                      "w-5 h-5",
                      product.highlight ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{product.name}</h3>
                    <p className="text-xs text-muted-foreground">{product.description}</p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold">${product.price}</span>
                  <span className="text-xs text-primary group-hover:translate-x-1 transition-transform flex items-center gap-1">
                    View details <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="text-center mt-8">
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Compare all packages
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
