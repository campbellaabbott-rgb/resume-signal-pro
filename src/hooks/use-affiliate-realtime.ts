import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * NEW CLICKS AND SALES, BY ASKING (register L3-10).
 *
 * This hook subscribed to Supabase Realtime on affiliate_clicks and
 * affiliate_conversions. Realtime applies RLS, both tables are FOR ALL USING
 * (false), and an affiliate is a custom session on the anon role -- so nothing
 * ever arrived, while the page promised "instant toast notifications". The
 * page's inline callbacks also changed every render, so the channel was torn
 * down and re-opened on each one.
 *
 * Now it re-reads the dashboard the affiliate's own session already reads
 * (get_affiliate_dashboard) every POLL_MS while the page is open and visible,
 * and announces what grew since the last read. The callbacks live in refs, so
 * the timer is set up once.
 */
export const AFFILIATE_POLL_MS = 30_000;

interface AffiliateStatsLike {
  total_clicks?: number;
  total_conversions?: number;
  pending_payout?: number;
}

interface UseAffiliateUpdatesOptions {
  enabled: boolean;
  /** The latest stats the page holds. */
  stats: AffiliateStatsLike | null | undefined;
  /** Re-read the dashboard (the page's fetchDashboard). */
  refresh: () => Promise<unknown>;
  intervalMs?: number;
}

const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export function useAffiliateUpdates({ enabled, stats, refresh, intervalMs = AFFILIATE_POLL_MS }: UseAffiliateUpdatesOptions) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const last = useRef<AffiliateStatsLike | null>(null);

  // Announce growth between two reads. The first read sets the baseline.
  useEffect(() => {
    if (!stats) return;
    const prev = last.current;
    last.current = { ...stats };
    if (!prev) return;
    const clicks = (stats.total_clicks ?? 0) - (prev.total_clicks ?? 0);
    const sales = (stats.total_conversions ?? 0) - (prev.total_conversions ?? 0);
    const earned = (stats.pending_payout ?? 0) - (prev.pending_payout ?? 0);
    if (clicks > 0) {
      toast.success(clicks === 1 ? 'New click on your affiliate link!' : `${clicks} new clicks on your affiliate link!`, { icon: '🖱️', duration: 5000 });
    }
    if (sales > 0 && earned > 0) {
      toast.success(`You earned ${usd(earned)}!`, { description: 'New conversion from your referral', icon: '💰', duration: 8000 });
    }
  }, [stats]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refreshRef.current().catch(() => { /* the next tick tries again */ });
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
