import { FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Header() {
  const scrollToUpload = () => {
    document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/60 backdrop-blur-xl border-b border-border/50">
      <div className="container">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Resume Booster</span>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              Recruiter-grade AI feedback
            </span>
            <Button 
              variant="default" 
              size="sm" 
              onClick={scrollToUpload}
              className="gap-2 shadow-lg shadow-primary/20"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Get Started</span>
              <span className="sm:hidden">Start</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
