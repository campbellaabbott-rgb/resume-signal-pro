import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { 
  CheckCircle2, 
  Loader2, 
  FileText,
  Crown,
  Package,
  Sparkles,
  ArrowRight,
  Mail,
  Clock,
  Upload,
  Download,
  Zap,
  Home,
  HelpCircle
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PRODUCTS, ProductId } from "@/config/products";
import { cn } from "@/lib/utils";

// Map product keys to icons
const productIcons: Record<string, React.ElementType> = {
  basicKeywordFix: FileText,
  coverLetter: FileText,
  premiumPackage: Crown,
  careerBundle: Package,
  fullAnalysis: Sparkles,
  scanPack: Zap,
};

// Product-specific next steps and how-it-works info
const productInfo: Record<string, {
  howItWorks: string[];
  nextSteps: { icon: React.ElementType; title: string; description: string }[];
  deliveryTime: string;
  deliveryMethod: string;
}> = {
  basicKeywordFix: {
    howItWorks: [
      "Upload your resume on our home page",
      "Our AI analyzes your resume against ATS requirements",
      "You'll receive a list of missing keywords and optimization suggestions",
      "Add the recommended keywords to improve your ATS score"
    ],
    nextSteps: [
      { icon: Upload, title: "Upload Your Resume", description: "Go to the home page and upload your resume to start the analysis" },
      { icon: Mail, title: "Check Your Email", description: "Your keyword report will be sent to the email you provided at checkout" },
      { icon: FileText, title: "Apply Suggestions", description: "Update your resume with the recommended keywords" }
    ],
    deliveryTime: "Within 5 minutes",
    deliveryMethod: "Email + Dashboard"
  },
  coverLetter: {
    howItWorks: [
      "Upload your resume on our home page",
      "Paste the job description you're applying for",
      "Our AI generates a personalized cover letter matching your experience to the role",
      "Download your cover letter in multiple formats"
    ],
    nextSteps: [
      { icon: Upload, title: "Upload Your Resume", description: "Provide your resume so we can match your experience" },
      { icon: FileText, title: "Add Job Description", description: "Paste the job posting to personalize your cover letter" },
      { icon: Download, title: "Download & Send", description: "Get your tailored cover letter ready to submit" }
    ],
    deliveryTime: "Within 2 minutes",
    deliveryMethod: "Instant Download"
  },
  premiumPackage: {
    howItWorks: [
      "Upload your resume and job description on our home page",
      "Our AI performs a comprehensive ATS analysis",
      "You receive a fully rewritten, ATS-optimized resume",
      "Plus a tailored cover letter matched to the specific role",
      "Compare before/after to see the improvements"
    ],
    nextSteps: [
      { icon: Upload, title: "Upload Your Resume", description: "Start by uploading your current resume" },
      { icon: FileText, title: "Add Job Description", description: "Paste the target job posting for best results" },
      { icon: Sparkles, title: "Get Your Package", description: "Receive your optimized resume + cover letter via email" }
    ],
    deliveryTime: "Within 10 minutes",
    deliveryMethod: "Email + Dashboard"
  },
  careerBundle: {
    howItWorks: [
      "You now have 75 full resume analyses in your account",
      "Each analysis includes complete ATS scoring and optimization",
      "Use them across multiple job applications",
      "Credits never expire - use at your own pace",
      "Share with friends or family if you'd like"
    ],
    nextSteps: [
      { icon: Upload, title: "Start Using Credits", description: "Upload a resume to use your first credit" },
      { icon: Mail, title: "Track Your Credits", description: "Check 'My Credits' in the header to see your balance" },
      { icon: Zap, title: "Apply to More Jobs", description: "Use credits for each job application you target" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "Credits Added to Account"
  },
  scanPack: {
    howItWorks: [
      "30 scan credits have been added to your account",
      "Each scan analyzes your resume against a specific job",
      "Compare unlimited job descriptions with your credits",
      "Credits never expire"
    ],
    nextSteps: [
      { icon: Upload, title: "Upload Your Resume", description: "Go to the home page to start scanning" },
      { icon: Zap, title: "Use Your Credits", description: "Each scan uses one credit from your balance" },
      { icon: Mail, title: "Check Balance", description: "View remaining credits in 'My Credits'" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "Credits Added to Account"
  }
};

export default function ProductSuccess() {
  const [searchParams] = useSearchParams();
  const [isVerifying, setIsVerifying] = useState(true);
  
  const sessionId = searchParams.get("session_id");
  const productKey = searchParams.get("product") as ProductId | null;
  
  // Get product details
  const product = productKey && PRODUCTS[productKey] ? PRODUCTS[productKey] : null;
  const Icon = productKey ? productIcons[productKey] || Sparkles : Sparkles;
  const info = productKey ? productInfo[productKey] : null;

  useEffect(() => {
    // Simulate verification (in reality, this could verify with Stripe)
    const timer = setTimeout(() => {
      setIsVerifying(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [sessionId]);

  if (isVerifying) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-32 pb-20">
          <div className="container max-w-2xl text-center">
            <div className="space-y-6 animate-fade-in">
              <div className="relative inline-flex items-center justify-center">
                <div className="absolute w-20 h-20 rounded-full border-2 border-primary/20" />
                <div className="absolute w-20 h-20 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">Verifying your purchase...</h1>
              <p className="text-muted-foreground">Just a moment while we confirm your payment</p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!product || !info) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-32 pb-20">
          <div className="container max-w-2xl text-center">
            <div className="space-y-6">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-muted border border-border">
                <HelpCircle className="w-10 h-10 text-muted-foreground" />
              </div>
              <h1 className="text-3xl font-bold">Purchase Details Not Found</h1>
              <p className="text-muted-foreground">
                We couldn't find details about your purchase. If you completed a payment, 
                please check your email for confirmation.
              </p>
              <Button asChild size="lg">
                <Link to="/">
                  <Home className="w-4 h-4 mr-2" />
                  Go to Home
                </Link>
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-24 pb-20">
        {/* Success Header */}
        <section className="py-12 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-success/10 rounded-full blur-[100px]" />
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-success/0 via-success to-success/0" />
          </div>

          <div className="container max-w-3xl relative">
            <div className="text-center space-y-6 animate-fade-in">
              {/* Success icon */}
              <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-success/20 to-success/5 border border-success/30">
                <CheckCircle2 className="w-12 h-12 text-success" />
              </div>

              <div>
                <Badge variant="secondary" className="mb-4 bg-success/10 text-success border-success/30">
                  Payment Successful
                </Badge>
                <h1 className="text-3xl md:text-4xl font-bold mb-3">
                  Thank You for Your Purchase!
                </h1>
                <p className="text-lg text-muted-foreground">
                  You've purchased the <span className="text-foreground font-semibold">{product.name}</span>
                </p>
              </div>

              {/* Product summary card */}
              <div className="max-w-md mx-auto p-6 rounded-2xl bg-card border border-border">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon className="w-7 h-7 text-primary" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-lg">{product.name}</h3>
                    <p className="text-sm text-muted-foreground">{product.description}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>{info.deliveryTime}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="w-4 h-4" />
                    <span>{info.deliveryMethod}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-3xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">How It Works</h2>
              <p className="text-muted-foreground">Here's what happens next with your purchase</p>
            </div>

            <div className="space-y-4">
              {info.howItWorks.map((step, index) => (
                <div 
                  key={index}
                  className="flex items-start gap-4 p-4 rounded-xl bg-card/50 border border-border/50"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                    {index + 1}
                  </div>
                  <p className="text-foreground pt-1">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-3xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">Your Next Steps</h2>
              <p className="text-muted-foreground">Get started with your purchase right away</p>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-8">
              {info.nextSteps.map((step, index) => {
                const StepIcon = step.icon;
                return (
                  <div 
                    key={index}
                    className={cn(
                      "relative p-5 rounded-2xl border transition-all hover:shadow-lg",
                      index === 0 
                        ? "bg-primary/5 border-primary/30" 
                        : "bg-card border-border"
                    )}
                  >
                    {index === 0 && (
                      <Badge className="absolute -top-2 left-4 bg-primary text-primary-foreground text-xs">
                        Start Here
                      </Badge>
                    )}
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center mb-3",
                      index === 0 ? "bg-primary/20" : "bg-accent"
                    )}>
                      <StepIcon className={cn(
                        "w-5 h-5",
                        index === 0 ? "text-primary" : "text-muted-foreground"
                      )} />
                    </div>
                    <h3 className="font-semibold mb-1">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                );
              })}
            </div>

            {/* Main CTA */}
            <div className="text-center space-y-4">
              <Button asChild size="lg" className="gap-2 shadow-lg shadow-primary/20">
                <Link to="/">
                  <Sparkles className="w-4 h-4" />
                  Get Started Now
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <p className="text-sm text-muted-foreground">
                A confirmation email has been sent to your inbox
              </p>
            </div>
          </div>
        </section>

        {/* What's Included */}
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-3xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">What's Included</h2>
              <p className="text-muted-foreground">Everything you get with {product.name}</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {product.features.map((feature, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-border/50"
                >
                  <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Help Section */}
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-2xl text-center">
            <div className="p-6 rounded-2xl bg-card border border-border">
              <HelpCircle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-2">Need Help?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                If you have any questions about your purchase or need assistance, 
                our support team is here to help.
              </p>
              <Button variant="outline" asChild>
                <a href="mailto:support@resumebooster.com">
                  <Mail className="w-4 h-4 mr-2" />
                  Contact Support
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
