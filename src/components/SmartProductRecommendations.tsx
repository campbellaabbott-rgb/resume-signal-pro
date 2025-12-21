import { usePersonalization } from '@/hooks/use-personalization';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ArrowRight, Target, FileText, Briefcase, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SmartProductRecommendationsProps {
  onSelectProduct?: (productId: string) => void;
  className?: string;
}

const productDetails: Record<string, {
  name: string;
  icon: React.ReactNode;
  description: string;
  price: string;
}> = {
  'keyword-optimizer': {
    name: 'Keyword Optimizer',
    icon: <Target className="h-5 w-5" />,
    description: 'Boost your ATS score with targeted keyword optimization',
    price: '$12',
  },
  'tailored-resume': {
    name: 'Tailored Resume',
    icon: <FileText className="h-5 w-5" />,
    description: 'Get a resume customized for your target job',
    price: '$19',
  },
  'cover-letter': {
    name: 'Cover Letter',
    icon: <Briefcase className="h-5 w-5" />,
    description: 'Professional cover letter that complements your resume',
    price: '$15',
  },
  'premium-package': {
    name: 'Premium Package',
    icon: <Star className="h-5 w-5" />,
    description: 'Complete resume overhaul + cover letter + optimization',
    price: '$49',
  },
  'linkedin-optimizer': {
    name: 'LinkedIn Optimizer',
    icon: <Sparkles className="h-5 w-5" />,
    description: 'Optimize your LinkedIn profile to match your resume',
    price: '$18',
  },
};

export function SmartProductRecommendations({ onSelectProduct, className }: SmartProductRecommendationsProps) {
  const { profile, getProductRecommendations, hasProfile } = usePersonalization();
  
  if (!hasProfile) {
    return null;
  }
  
  const recommendations = getProductRecommendations();
  
  if (recommendations.length === 0) {
    return null;
  }
  
  // Take top 3 recommendations
  const topRecommendations = recommendations.slice(0, 3);
  
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" />
        <span>
          Personalized for you
          {profile.industry && <span className="text-foreground"> • {profile.industry}</span>}
          {profile.experienceLevel && (
            <span className="text-foreground"> • {profile.experienceLevel.charAt(0).toUpperCase() + profile.experienceLevel.slice(1)}-level</span>
          )}
        </span>
      </div>
      
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {topRecommendations.map((rec) => {
          const product = productDetails[rec.productId];
          if (!product) return null;
          
          return (
            <Card 
              key={rec.productId}
              className={cn(
                "relative overflow-hidden transition-all hover:shadow-md cursor-pointer group",
                rec.priority === 'high' && "ring-1 ring-primary/50"
              )}
              onClick={() => onSelectProduct?.(rec.productId)}
            >
              {rec.priority === 'high' && (
                <Badge 
                  className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs"
                >
                  Recommended
                </Badge>
              )}
              
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    {product.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-foreground">{product.name}</h4>
                    <p className="text-sm text-muted-foreground line-clamp-2">{product.description}</p>
                  </div>
                </div>
                
                <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">
                  {rec.reason}
                </p>
                
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-primary">{product.price}</span>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="gap-1 group-hover:bg-primary/10"
                  >
                    Get it
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {profile.atsScore && profile.atsScore < 50 && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" />
          Your ATS score of {profile.atsScore}% is below average. Keyword optimization could significantly improve your visibility.
        </p>
      )}
    </div>
  );
}
