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
    <div data-floating-help="" className={cn("fixed right-4 z-help flex flex-col items-end gap-3 transition-[bottom] duration-base sm:right-6", barVisible ? "bottom-28" : "bottom-6")}>
      {isOpen && (
        <div className="bg-popover border border-border-strong rounded-lg shadow-overlay p-4 animate-in fade-in duration-base">
          <div className="flex items-center justify-between gap-4 mb-2">
            <span className="text-sm font-medium">{t('floatingHelpButton.needHelp')}</span>
            <button
              onClick={() => setIsOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
              aria-label={t('common.close', 'Close')}
            >
              <X aria-hidden="true" className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {t('floatingHelpButton.questionsOrFeedback')}
          </p>
          <a
            href="mailto:resumeboostersupp@gmail.com"
            className="link inline-flex items-center gap-2 text-sm font-medium"
          >
            <Mail aria-hidden="true" className="w-4 h-4" />
            resumeboostersupp@gmail.com
          </a>
        </div>
      )}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        size="icon"
        className="h-11 w-11 rounded-full shadow-overlay"
        aria-label={isOpen ? t('floatingHelpButton.closeHelp', 'Close help') : t('floatingHelpButton.getHelp', 'Get help')}
        aria-expanded={isOpen}
      >
        {isOpen ? <X aria-hidden="true" className="w-5 h-5" /> : <HelpCircle aria-hidden="true" className="w-5 h-5" />}
      </Button>
    </div>
  );
}
