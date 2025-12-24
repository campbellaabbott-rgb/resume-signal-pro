import { useState } from 'react';
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

interface PayoutRequestProps {
  pendingPayout: number;
  totalPaidOut: number;
  minimumPayout?: number;
  onRequestPayout?: () => Promise<void>;
}

export function PayoutRequest({ 
  pendingPayout, 
  totalPaidOut,
  minimumPayout = 2500, // $25 minimum
  onRequestPayout 
}: PayoutRequestProps) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [hasRequestedThisMonth, setHasRequestedThisMonth] = useState(false);

  const canRequestPayout = pendingPayout >= minimumPayout && !hasRequestedThisMonth;
  const progressToMinimum = Math.min((pendingPayout / minimumPayout) * 100, 100);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const handleRequestPayout = async () => {
    if (!canRequestPayout) return;
    
    setIsRequesting(true);
    try {
      if (onRequestPayout) {
        await onRequestPayout();
      }
      setHasRequestedThisMonth(true);
      toast.success('Payout request submitted! You\'ll receive payment within 5-7 business days.');
    } catch (error) {
      toast.error('Failed to request payout. Please try again.');
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

        {/* Payout Request Button */}
        <div className="space-y-3">
          {hasRequestedThisMonth ? (
            <div className="flex items-center gap-2 p-3 bg-blue-500/10 rounded-lg text-blue-600">
              <CheckCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Payout Requested</p>
                <p className="text-sm opacity-80">Processing within 5-7 business days</p>
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
              5-7 business days after request
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
