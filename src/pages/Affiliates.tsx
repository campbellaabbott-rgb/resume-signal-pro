import { useState, useEffect } from 'react';
import { useAffiliateAuth } from '@/hooks/use-affiliate-auth';
import { useAffiliateRealtime } from '@/hooks/use-affiliate-realtime';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  BarChart3,
  LineChart as LineChartIcon,
  ArrowUpRight,
  Palette,
  Link2,
  Wallet,
  Bell
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { MarketingKit } from '@/components/affiliate/MarketingKit';
import { AdvancedLinkTools } from '@/components/affiliate/AdvancedLinkTools';
import { PayoutRequest } from '@/components/affiliate/PayoutRequest';

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

  // Real-time notifications for clicks and conversions
  useAffiliateRealtime({
    affiliateId: dashboardData?.affiliate?.id || null,
    enabled: isAuthenticated,
    onNewClick: () => {
      // Refresh dashboard when new click arrives
      fetchDashboard().catch(console.error);
    },
    onNewConversion: () => {
      // Refresh dashboard when new conversion arrives
      fetchDashboard().catch(console.error);
    },
  });
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
            {/* Commission disclosure */}
            <div className="mt-4 p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center justify-center gap-2 mb-2">
                <DollarSign className="h-5 w-5 text-primary" />
                <span className="font-bold text-lg text-primary">$5 per sale</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Earn <span className="font-semibold text-foreground">25-100% commission</span> on every referral
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                30-day cookie • No minimum payout threshold to start
              </p>
            </div>
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
        {/* Commission Banner */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">Your Commission Rate</p>
              <p className="text-sm text-muted-foreground">$5 per sale (25-100% depending on product)</p>
            </div>
          </div>
          <Badge variant="secondary" className="text-primary border-primary/30">
            30-day cookie
          </Badge>
        </div>

        {/* Referral Link Card */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold mb-1">Your Referral Link</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Share this link to earn <span className="font-semibold text-primary">$5</span> per sale (30-day attribution window)
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

        {/* Main Dashboard Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="links" className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Link Tools
            </TabsTrigger>
            <TabsTrigger value="payouts" className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Payouts
            </TabsTrigger>
            <TabsTrigger value="marketing" className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Marketing
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-8">

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
              <Tabs defaultValue="chart" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="chart" className="flex items-center gap-2">
                    <LineChartIcon className="h-4 w-4" />
                    Chart View
                  </TabsTrigger>
                  <TabsTrigger value="table" className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Table View
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="chart">
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={[...clickHistory].reverse()}
                        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="click_date"
                          tickFormatter={(value) => {
                            const date = new Date(value);
                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          }}
                          className="text-xs fill-muted-foreground"
                        />
                        <YAxis className="text-xs fill-muted-foreground" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                          }}
                          labelFormatter={(value) => {
                            const date = new Date(value);
                            return date.toLocaleDateString('en-US', { 
                              weekday: 'short', 
                              month: 'short', 
                              day: 'numeric' 
                            });
                          }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="click_count"
                          name="Clicks"
                          stroke="hsl(var(--primary))"
                          fillOpacity={1}
                          fill="url(#colorClicks)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  
                  {/* Summary stats below chart */}
                  <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t">
                    <div className="text-center">
                      <p className="text-2xl font-bold">
                        {clickHistory.reduce((sum, d) => sum + d.click_count, 0)}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Clicks</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold">
                        {Math.round(clickHistory.reduce((sum, d) => sum + d.click_count, 0) / Math.max(clickHistory.length, 1))}
                      </p>
                      <p className="text-sm text-muted-foreground">Avg/Day</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold">
                        {Math.max(...clickHistory.map(d => d.click_count), 0)}
                      </p>
                      <p className="text-sm text-muted-foreground">Best Day</p>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="table">
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
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
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>

        {/* Conversion Rate Chart */}
        {(stats?.total_clicks || 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Conversion Funnel
              </CardTitle>
              <CardDescription>
                From clicks to conversions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { stage: 'Clicks', value: stats?.total_clicks || 0, fill: 'hsl(var(--primary))' },
                      { stage: 'Conversions', value: stats?.total_conversions || 0, fill: 'hsl(142 76% 36%)' },
                    ]}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs fill-muted-foreground" />
                    <YAxis type="category" dataKey="stage" className="text-sm fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-2 mt-4 p-3 bg-muted/50 rounded-lg">
                <span className="text-muted-foreground">Conversion Rate:</span>
                <span className="text-2xl font-bold text-primary">{stats?.conversion_rate || 0}%</span>
                {(stats?.conversion_rate || 0) >= 5 ? (
                  <Badge variant="default" className="bg-green-500">
                    <ArrowUpRight className="h-3 w-3 mr-1" />
                    Great
                  </Badge>
                ) : (stats?.conversion_rate || 0) > 0 ? (
                  <Badge variant="secondary">
                    Room to grow
                  </Badge>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}

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
          </TabsContent>

          <TabsContent value="links" className="space-y-6">
            <AdvancedLinkTools 
              referralLink={getReferralLink() || ''} 
              referralCode={session?.referralCode || ''} 
            />
          </TabsContent>

          <TabsContent value="payouts" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <PayoutRequest
                pendingPayout={stats?.pending_payout || 0}
                totalPaidOut={stats?.paid_out || 0}
              />
              
              {/* Payout History */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Payout History
                  </CardTitle>
                  <CardDescription>
                    Your previous payouts
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(stats?.paid_out || 0) === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No payouts yet. Keep promoting to earn commissions!
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">Initial Payout</p>
                          <p className="text-sm text-muted-foreground">Completed</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-green-600">
                            {formatCurrency(stats?.paid_out || 0)}
                          </p>
                          <Badge variant="default" className="text-xs">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Paid
                          </Badge>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Real-time notification info */}
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Bell className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-medium">Real-time Notifications</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      You'll receive instant toast notifications when someone clicks your link or makes a purchase.
                      Keep this page open to see updates in real-time!
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="marketing">
            <MarketingKit 
              referralLink={getReferralLink() || ''} 
              referralCode={session?.referralCode || ''} 
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
