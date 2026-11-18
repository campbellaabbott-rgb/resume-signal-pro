import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { 
  DollarSign, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  ArrowRight,
  Wallet
} from 'lucide-react';

/**
 * What the server answered a payout request: recorded ('requested'), recorded
 * but the note to the owner did not send ('requested_unnotified'), or one was
 * already open ('already'). Any other answer is thrown with its reason.
 */
export type PayoutOutcome = 'requested' | 'requested_unnotified' | 'already';

/** The open request the dashboard returns (payout_requests, status requested). */
export interface OpenPayoutRequest {
  amount_cents: number;
  requested_at: string;
}

interface PayoutRequestProps {
  pendingPayout: number;
  totalPaidOut: number;
  minimumPayout?: number;
  /** Commission earned and not yet payable (the dashboard's awaiting_approval). */
  awaitingApproval?: number;
  /**
   * The request the server already holds open. It replaces the button, so a
   * reload no longer offers the same balance again (S14X-116).
   */
  openRequest?: OpenPayoutRequest | null;
  /** Files the request on the server; throws with the reason when it was not recorded. */
  onRequestPayout?: () => Promise<PayoutOutcome>;
}

export function PayoutRequest({ 
  pendingPayout, 
  totalPaidOut,
  minimumPayout = 2500, // $25 minimum
  awaitingApproval = 0,
  openRequest = null,
  onRequestPayout 
}: PayoutRequestProps) {
  const { t } = useTranslation();
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestedHere, setRequestedHere] = useState(false);
  const hasOpenRequest = requestedHere || !!openRequest;

  const canRequestPayout = pendingPayout >= minimumPayout && !hasOpenRequest;
  const progressToMinimum = Math.min((pendingPayout / minimumPayout) * 100, 100);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  // A REQUEST IS SAID TO BE MADE ONLY WHEN THE SERVER MADE IT (register
  // L13-63). This toasted "submitted, payment within 5-7 business days" with
  // no handler at all -- nothing was recorded and nobody was told. The card
  // promises no payment date now: nothing keeps one (S14X-116).
  const handleRequestPayout = async () => {
    if (!canRequestPayout || !onRequestPayout) return;

    setIsRequesting(true);
    try {
      const outcome = await onRequestPayout();
      setRequestedHere(true);
      if (outcome === 'already') toast.info(t('affiliates.payout.already', 'A payout request is already open. We will email you about it.'));
      else {
        toast.success(t('affiliates.payout.received', 'Payout request received. We will email you to arrange payment.'));
        // The request is recorded either way; the affiliate is told when the
        // owner's note did not go out, rather than shown the same success.
        if (outcome === 'requested_unnotified') toast.warning(t('affiliateProgram.payout.notNotified'));
      }
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('affiliates.payout.failed', 'Could not request the payout. Please try again.'));
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Payout Center
        </CardTitle>
        <CardDescription>
          Request payouts when you reach the minimum threshold
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Balance Overview */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-yellow-500/10 rounded-lg p-4">
            <div className="flex items-center gap-2 text-yellow-600 mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">Pending</span>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(pendingPayout)}</p>
          </div>
          <div className="bg-green-500/10 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-600 mb-1">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Paid Out</span>
            </div>
            <p className="text-2xl font-bold">{formatCurrency(totalPaidOut)}</p>
          </div>
        </div>

        {/* Progress to Minimum */}
        {pendingPayout < minimumPayout && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress to minimum payout</span>
              <span className="font-medium">{formatCurrency(pendingPayout)} / {formatCurrency(minimumPayout)}</span>
            </div>
            <Progress value={progressToMinimum} className="h-2" />
            <p className="text-xs text-muted-foreground">
              Earn {formatCurrency(minimumPayout - pendingPayout)} more to request a payout
            </p>
          </div>
        )}

        {awaitingApproval > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('affiliateProgram.payout.awaitingNote', { amount: formatCurrency(awaitingApproval) })}
          </p>
        )}

        {/* Payout Request Button */}
        <div className="space-y-3">
          {hasOpenRequest ? (
            <div className="flex items-center gap-2 p-3 bg-blue-500/10 rounded-lg text-blue-600">
              <CheckCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">{t('affiliates.payout.requestedTitle', 'Payout requested')}</p>
                {openRequest && (
                  <p className="text-sm opacity-80">
                    {t('affiliateProgram.payout.openSince', { date: new Date(openRequest.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), amount: formatCurrency(openRequest.amount_cents) })}
                  </p>
                )}
                <p className="text-sm opacity-80">{t('affiliates.payout.requestedBody', 'We will email you to arrange payment.')}</p>
              </div>
            </div>
          ) : canRequestPayout ? (
            <Button 
              className="w-full" 
              size="lg"
              onClick={handleRequestPayout}
              disabled={isRequesting}
            >
              {isRequesting ? (
                <>Processing...</>
              ) : (
                <>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Request Payout ({formatCurrency(pendingPayout)})
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          ) : (
            <Button className="w-full" size="lg" disabled>
              <AlertCircle className="h-4 w-4 mr-2" />
              Minimum {formatCurrency(minimumPayout)} required
            </Button>
          )}
        </div>

        {/* Payout Info */}
        <div className="border-t pt-4 space-y-2">
          <h4 className="font-medium text-sm">Payout Details</h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">Minimum</Badge>
              {formatCurrency(minimumPayout)}
            </li>
            <li className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">Method</Badge>
              PayPal or Bank Transfer
            </li>
            <li className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">Timing</Badge>
              {t('affiliateProgram.payout.timing')}
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
