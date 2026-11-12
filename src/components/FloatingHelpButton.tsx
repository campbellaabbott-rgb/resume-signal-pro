import { useState } from "react";
import { HelpCircle, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useStickyBarVisible } from "@/lib/sticky-bar";

/** How far the homepage's sticky bar lifts the button: bottom-28 less its resting bottom-6. */
export const STICKY_BAR_LIFT = "5.5rem";

/**
 * Where the button is drawn above its resting place (bottom-6): above the
 * analytics banner while it is open (ConsentBanner sets --consent-banner-h),
 * so neither the banner nor focus hides it, and above the homepage's sticky
 * bar while it shows, so the bar's dismiss button is reachable.
 *
 * A TRANSFORM, NOT A MARGIN OR A BOTTOM (PERF-05, SEO/GEO audit 2026-11-07).
 * The button rose by margin-bottom when the banner opened, 2.5-3.9 s into
 * every first visit: a layout shift of 0.019 on every page the lab read, a
 * fifth of the 0.1 CLS budget, and all of the field lander's CLS. A transform
 * moves only the pixels, so it is never counted as a layout shift; the button
 * lands where it did before.
 */
export function helpButtonLift(barVisible: boolean): string {
  return `translateY(calc(-1 * (var(--consent-banner-h, 0px) + ${barVisible ? STICKY_BAR_LIFT : "0px"})))`;
}

export function FloatingHelpButton() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const barVisible = useStickyBarVisible();

  return (
    <div data-floating-help="" style={{ transform: helpButtonLift(barVisible) }} className="fixed bottom-6 right-4 z-help flex flex-col items-end gap-3 transition-transform duration-base sm:right-6">
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
