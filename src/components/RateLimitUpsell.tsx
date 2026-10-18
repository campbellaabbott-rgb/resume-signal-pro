import { Clock, AlertCircle, UserPlus, Crown } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PRO_SUMMARY } from "@/config/pro-perks";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";

interface RateLimitUpselProps {
  onClose: () => void;
  /**
   * Hours until the daily limit resets, AS THE SERVER COUNTS THEM (its
   * rolling window), or null when the answer did not say: then no reset time
   * is printed rather than a guessed one (S8-119).
   */
  resetHours?: number | null;
  /** The visitor is signed in: the free-account line is not offered again. */
  signedIn?: boolean;
}

/**
 * WHAT A VISITOR IS OFFERED WHEN THE DAILY FREE SCANS RUN OUT. A Radix dialog
 * (S8-119).
 *
 * SCAN PACKS ARE NO LONGER SOLD (the product line, 2026-10-12): this dialog
 * sold a pack of credits, and create-scan-pack-checkout now answers 410. It
 * points to what is still offered instead: a free account (more scans a day)
 * for a signed-out visitor, and Pro, summarised from the one list of what
 * Pro is (src/config/pro-perks.ts, owner decision 2026-10-17).
 */
export function RateLimitUpsell({ onClose, resetHours = null, signedIn = false }: RateLimitUpselProps) {
  const { t } = useTranslation();
  const { trackButtonClick } = useConversionTracking();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-full max-w-md p-0 gap-0 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="bg-gradient-to-r from-amber-500/90 to-orange-500/90 px-6 py-4 text-white">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-white/20 rounded-full shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-bold text-lg">{t('rateLimitUpsell.title')}</DialogTitle>
              <DialogDescription className="text-white/90 text-sm mt-1">
                {t('rateLimitUpsell.subtitleLimit', "You've used today's free scans.")}
              </DialogDescription>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Reset timer info: the server's count, or nothing. */}
          {resetHours !== null && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 rounded-lg px-4 py-3">
              <Clock className="w-4 h-4 shrink-0" />
              <span>
                {t('rateLimitUpsell.resetIn')} <strong className="text-foreground">{t('rateLimitUpsell.hour', { count: resetHours })}</strong>
              </span>
            </div>
          )}

          {!signedIn && (
            <div className="rounded-xl border border-border p-4" data-offer="free-account">
              <p className="flex items-center gap-2 font-semibold"><UserPlus className="w-4 h-4 text-primary" />{t('rateLimitUpsell.freeAccountTitle', 'Create a free account')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('rateLimitUpsell.freeAccountBody', 'A free account scans more each day, and keeps your score and checklist.')}</p>
              <Button asChild className="mt-3 w-full">
                <Link to={`/auth?next=${encodeURIComponent('/#upload')}`} onClick={() => trackButtonClick('free_account', 'rate_limit_upsell')}>
                  {t('rateLimitUpsell.freeAccountCta', 'Create a free account')}
                </Link>
              </Button>
            </div>
          )}

          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4" data-offer="pro">
            <p className="flex items-center gap-2 font-semibold"><Crown className="w-4 h-4 text-primary" />{t('rateLimitUpsell.proTitle', 'Pro')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t(PRO_SUMMARY.key, PRO_SUMMARY.text)}</p>
            <Button asChild variant="outline" className="mt-3 w-full">
              <Link to="/pricing" onClick={() => trackButtonClick('pro', 'rate_limit_upsell')}>
                {t('rateLimitUpsell.proCta', 'See Pro')}
              </Link>
            </Button>
          </div>

          <div className="text-center pt-2 border-t border-border/50">
            <button
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('rateLimitUpsell.noThanks')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
