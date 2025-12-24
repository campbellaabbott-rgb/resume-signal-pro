import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UseAffiliateRealtimeOptions {
  affiliateId: string | null;
  enabled?: boolean;
  onNewClick?: (data: any) => void;
  onNewConversion?: (data: any) => void;
}

export function useAffiliateRealtime({
  affiliateId,
  enabled = true,
  onNewClick,
  onNewConversion,
}: UseAffiliateRealtimeOptions) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const showClickNotification = useCallback((payload: any) => {
    const referrer = payload.new?.referrer || 'Direct';
    toast.success('New click on your affiliate link!', {
      description: `Source: ${referrer}`,
      icon: '🖱️',
      duration: 5000,
    });
    onNewClick?.(payload.new);
  }, [onNewClick]);

  const showConversionNotification = useCallback((payload: any) => {
    const commission = payload.new?.commission_amount || 0;
    const formattedCommission = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(commission / 100);

    toast.success(`You earned ${formattedCommission}!`, {
      description: `New conversion from your referral`,
      icon: '💰',
      duration: 8000,
    });
    onNewConversion?.(payload.new);
  }, [onNewConversion]);

  useEffect(() => {
    if (!affiliateId || !enabled) return;

    // Create a channel for this affiliate's events
    const channel = supabase
      .channel(`affiliate-${affiliateId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'affiliate_clicks',
          filter: `affiliate_id=eq.${affiliateId}`,
        },
        showClickNotification
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'affiliate_conversions',
          filter: `affiliate_id=eq.${affiliateId}`,
        },
        showConversionNotification
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Affiliate Realtime] Subscribed to updates');
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [affiliateId, enabled, showClickNotification, showConversionNotification]);

  return {
    isConnected: channelRef.current !== null,
  };
}
