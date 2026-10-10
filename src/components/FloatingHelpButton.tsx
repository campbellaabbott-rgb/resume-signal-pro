import { useState } from "react";
import { HelpCircle, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useStickyBarVisible } from "@/lib/sticky-bar";
import { cn } from "@/lib/utils";

export function FloatingHelpButton() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  // Above the homepage's sticky bar while it shows, so its dismiss button is reachable.
  const barVisible = useStickyBarVisible();

  return (
    <div className={cn("fixed right-6 z-50 flex flex-col items-end gap-3 transition-[bottom]", barVisible ? "bottom-28" : "bottom-6")}>
      {isOpen && (
        <div className="bg-card border border-border rounded-lg shadow-lg p-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between gap-4 mb-2">
            <span className="text-sm font-medium">{t('floatingHelpButton.needHelp')}</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {t('floatingHelpButton.questionsOrFeedback')}
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
