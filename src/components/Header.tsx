import { FileText } from "lucide-react";

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <span className="font-semibold text-lg">Signal Booster</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Recruiter-grade feedback
          </div>
        </div>
      </div>
    </header>
  );
}
