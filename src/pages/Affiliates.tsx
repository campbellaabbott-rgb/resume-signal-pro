import { useState, useEffect } from 'react';
import { useAffiliateAuth } from '@/hooks/use-affiliate-auth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  Copy, 
  LogOut, 
  DollarSign, 
  MousePointerClick, 
  TrendingUp, 
  Clock,
  CheckCircle,
  RefreshCw,
  Users,
  Calendar,
  BarChart3
} from 'lucide-react';

interface ClickData {
  click_date: string;
  click_count: number;
  unique_referrers: number;
}

export default function Affiliates() {
  const { 
    session, 
    isLoading, 
    isAuthenticated, 
    dashboardData,
    register, 
    login, 
    logout, 
    fetchDashboard,
    getReferralLink 
  } = useAffiliateAuth();
  
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState('30');
  const [clickHistory, setClickHistory] = useState<ClickData[]>([]);
  const [isLoadingClicks, setIsLoadingClicks] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      fetchDashboard().catch((err) => {
        toast.error(err.message || 'Failed to load dashboard');
      });
    }
  }, [isAuthenticated, fetchDashboard]);

  // Fetch click history when date range changes
  useEffect(() => {
    async function fetchClickHistory() {
      if (!isAuthenticated || !session?.sessionToken) return;
      
      setIsLoadingClicks(true);
      try {
        const { data, error } = await supabase.rpc('get_affiliate_clicks', {
          p_session_token: session.sessionToken,
          p_days_back: parseInt(dateRange)
        });
        
        if (error) throw error;
        setClickHistory(data || []);
      } catch (err) {
        console.error('Failed to fetch click history:', err);
      } finally {
        setIsLoadingClicks(false);
      }
    }
    
    fetchClickHistory();
  }, [isAuthenticated, session?.sessionToken, dateRange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (isLoginMode) {
        await login(email, password);
        toast.success('Welcome back!');
      } else {
        await register(email, password);
        toast.success('Account created! Welcome to the affiliate program.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = () => {
    const link = getReferralLink();
    if (link) {
      navigator.clipboard.writeText(link);
      toast.success('Referral link copied!');
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchDashboard();
      toast.success('Dashboard refreshed');
    } catch (err) {
      toast.error('Failed to refresh');
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Auth form
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">
              {isLoginMode ? 'Affiliate Login' : 'Join Our Affiliate Program'}
            </CardTitle>
            <CardDescription>
              {isLoginMode 
                ? 'Sign in to access your affiliate dashboard' 
                : 'Earn rewards for every sale you refer!'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Input
                  type="password"
                  placeholder="Password (min 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Please wait...' : isLoginMode ? 'Sign In' : 'Create Account'}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button
                onClick={() => setIsLoginMode(!isLoginMode)}
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {isLoginMode 
                  ? "Don't have an account? Sign up" 
                  : 'Already have an account? Sign in'}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Dashboard
  const stats = dashboardData?.stats;
  const affiliate = dashboardData?.affiliate;
  const conversions = dashboardData?.recent_conversions || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Affiliate Dashboard</h1>
            <p className="text-sm text-muted-foreground">{session?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4 mr-1" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* Referral Link Card */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold mb-1">Your Referral Link</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Share this link to earn rewards (30-day attribution window)
                </p>
                <code className="text-xs bg-background px-2 py-1 rounded border break-all">
                  {getReferralLink()}
                </code>
              </div>
              <Button onClick={handleCopyLink}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Link
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Date Range Filter */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Time Period:</span>
          </div>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Clicks</p>
                  <p className="text-2xl font-bold">{stats?.total_clicks || 0}</p>
                </div>
                <MousePointerClick className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Conversions</p>
                  <p className="text-2xl font-bold">{stats?.total_conversions || 0}</p>
                  <p className="text-xs text-muted-foreground">
                    {stats?.conversion_rate || 0}% rate
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending Payout</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {formatCurrency(stats?.pending_payout || 0)}
                  </p>
                </div>
                <Clock className="h-8 w-8 text-yellow-600/50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Paid</p>
                  <p className="text-2xl font-bold text-green-600">
                    {formatCurrency(stats?.paid_out || 0)}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-green-600/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Revenue Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Revenue Generated
            </CardTitle>
            <CardDescription>
              Total sales from your referrals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">{formatCurrency(stats?.total_revenue || 0)}</p>
          </CardContent>
        </Card>

        {/* Click History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Click History
            </CardTitle>
            <CardDescription>
              Daily click breakdown for the last {dateRange} days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingClicks ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            ) : clickHistory.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No clicks recorded in this period. Share your referral link to start tracking!
              </p>
            ) : (
              <div className="space-y-2">
                {clickHistory.map((day) => (
                  <div
                    key={day.click_date}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{formatDate(day.click_date)}</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-right">
                        <span className="text-muted-foreground">Clicks: </span>
                        <span className="font-semibold">{day.click_count}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-muted-foreground">Sources: </span>
                        <span className="font-semibold">{day.unique_referrers}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Conversions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Conversions</CardTitle>
            <CardDescription>Your latest referral sales</CardDescription>
          </CardHeader>
          <CardContent>
            {conversions.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No conversions yet. Share your referral link to start earning!
              </p>
            ) : (
              <div className="space-y-4">
                {conversions.map((conversion) => (
                  <div
                    key={conversion.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{conversion.product_name || 'Product'}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(conversion.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-green-600">
                        +{formatCurrency(conversion.commission_amount)}
                      </p>
                      <Badge 
                        variant={
                          conversion.status === 'paid' ? 'default' :
                          conversion.status === 'approved' ? 'secondary' :
                          conversion.status === 'rejected' ? 'destructive' : 'outline'
                        }
                      >
                        {conversion.status === 'paid' && <CheckCircle className="h-3 w-3 mr-1" />}
                        {conversion.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Help Section */}
        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                1
              </div>
              <div>
                <p className="font-medium">Share Your Link</p>
                <p className="text-sm text-muted-foreground">
                  Copy your unique referral link and share it with your audience
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                2
              </div>
              <div>
                <p className="font-medium">Track Conversions</p>
                <p className="text-sm text-muted-foreground">
                  When someone clicks your link and makes a purchase within 30 days, you earn {formatCurrency(affiliate?.commission_amount || 500)}
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                3
              </div>
              <div>
                <p className="font-medium">Get Paid</p>
                <p className="text-sm text-muted-foreground">
                  Payouts are processed monthly for approved conversions. You'll receive an email notification for each commission earned.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
