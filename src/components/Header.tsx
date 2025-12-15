import { FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header() {
  const scrollToUpload = () => {
    document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header 
      className="fixed top-0 left-0 right-0 z-50 bg-background/60 backdrop-blur-xl border-b border-border/50"
      role="banner"
    >
      <div className="container">
        <nav className="flex items-center justify-between h-16" aria-label="Main navigation">
          <a 
            href="/" 
            className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
            aria-label="Resume Booster - Home"
          >
            <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10" aria-hidden="true">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Resume Booster</span>
          </a>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block" aria-hidden="true">
              Recruiter-grade AI feedback
            </span>
            <Button 
              variant="default" 
              size="sm" 
              onClick={scrollToUpload}
              className="gap-2 shadow-lg shadow-primary/20 min-h-[44px] min-w-[44px] touch-manipulation"
              aria-label="Get started - scroll to upload section"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Get Started</span>
              <span className="sm:hidden">Start</span>
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
