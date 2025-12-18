import { useState } from "react";
import { HelpCircle, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FloatingHelpButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {isOpen && (
        <div className="bg-card border border-border rounded-lg shadow-lg p-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between gap-4 mb-2">
            <span className="text-sm font-medium">Need Help?</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Questions or feedback? Email us:
          </p>
          <a
            href="mailto:resumeboostersupp@gmail.com"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
          >
            <Mail className="w-4 h-4" />
            resumeboostersupp@gmail.com
          </a>
        </div>
      )}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        size="icon"
        className="h-12 w-12 rounded-full shadow-lg"
        aria-label={isOpen ? "Close help" : "Get help"}
      >
        {isOpen ? <X className="w-5 h-5" /> : <HelpCircle className="w-5 h-5" />}
      </Button>
    </div>
  );
}
