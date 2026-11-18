import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAffiliateAuth, type AffiliateRangeStats } from '@/hooks/use-affiliate-auth';
import { AFFILIATE_POLL_MS, useAffiliateUpdates } from '@/hooks/use-affiliate-realtime';
import { AFFILIATE_PRO_FIRST_MONTH_CENTS, formatUsd } from '@/config/affiliate-commission';
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
  Bell,
  Mail,
  Download,
  Trash2,
  ShieldAlert
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
import { PayoutRequest, type PayoutOutcome } from '@/components/affiliate/PayoutRequest';

interface ClickData {
  click_date: string;
  click_count: number;
  unique_referrers: number;
}

/** An edge function's answer body, whatever its HTTP code (supabase-js puts a non-2xx response in error.context). */
interface FunctionAnswer {
  status?: string;
  error?: string;
  ownerNotified?: boolean;
  [key: string]: unknown;
}

async function answerOf(data: unknown, error: unknown): Promise<{ ok: boolean; httpStatus: number; body: FunctionAnswer }> {
  if (!error) return { ok: true, httpStatus: 200, body: (data ?? {}) as FunctionAnswer };
  const ctx = (error as { context?: Response } | null)?.context;
  let body: FunctionAnswer = {};
  try { body = ((await ctx?.clone().json()) ?? {}) as FunctionAnswer; } catch { /* no body */ }
  return { ok: false, httpStatus: typeof ctx?.status === 'number' ? ctx.status : 0, body };
}

/**
 * A sale amount in its own currency (S14X-227). Amounts are in the currency's
 * smallest unit, as Stripe records them; a currency with no minor unit (JPY)
 * is not divided by 100.
 */
function formatMoney(minor: number, currency: string): string {
  try {
    const f = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() });
    return f.format(minor / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2));
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** A link from an affiliate mail: #reset=, #confirm= or #email= and its 64-hex token. */
const LINK_FRAGMENT = /^#(reset|confirm|email)=([0-9a-f]{64})$/i;

export default function Affiliates() {
  const { t } = useTranslation();
  // What the server pays (register L13-63; the affiliate re-base of
  // 2026-10-12): one flat amount on a referred customer's first paid Pro
  // month, never a percentage. The keys are new (affiliates.proCommission.*)
  // because the old values promised the cut catalogue.
  const rate = { amount: formatUsd(AFFILIATE_PRO_FIRST_MONTH_CENTS) };
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
  // Account mail and actions (S14X-115, S14X-093, S14X-021): affiliate-account.
  const [isForgotMode, setIsForgotMode] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [eraseConfirm, setEraseConfirm] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [dashboardReload, setDashboardReload] = useState(0);

  /** affiliate-account, with its answer's body whatever the HTTP code. */
  const callAccount = async (body: Record<string, unknown>) => {
    try {
      const { data, error } = await supabase.functions.invoke('affiliate-account', { body });
      return await answerOf(data, error);
    } catch {
      return { ok: false, httpStatus: 0, body: {} as FunctionAnswer };
    }
  };
  const failed = () => t('affiliateProgram.auth.failed');

  // A link from an affiliate mail. The token leaves the address bar at once;
  // a reset link opens the new-password form, the other two are spent here.
  useEffect(() => {
    const m = LINK_FRAGMENT.exec(window.location.hash);
    if (!m) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const kind = m[1].toLowerCase();
    const token = m[2].toLowerCase();
    if (kind === 'reset') { setResetToken(token); return; }
    void (async () => {
      const { ok, body } = await callAccount({ action: kind === 'confirm' ? 'confirm' : 'email-confirm', token });
      if (ok) {
        toast.success(kind === 'confirm' ? t('affiliateProgram.auth.addressConfirmed') : t('affiliateProgram.auth.emailChanged'));
        setDashboardReload((n) => n + 1);
      } else {
        toast.error(body.status === 'taken' ? t('affiliateProgram.auth.emailTaken') : body.status === 'expired' ? t('affiliateProgram.auth.linkExpired') : failed());
      }
    })();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New clicks and sales, read every 30 s while the page is open (register
  // L3-10: the Realtime subscription could never receive a row).
  useAffiliateUpdates({
    enabled: isAuthenticated,
    stats: dashboardData?.stats,
    refresh: fetchDashboard,
  });

  /**
   * Request Payout: a real server record, or an error the button shows. The
   * answer's status decides, never the HTTP code alone (S14X-116): a 409 is
   * also the settlement trigger's "your balance changed", which used to read
   * as "already open" when nothing had been recorded.
   */
  const requestPayout = async (): Promise<PayoutOutcome> => {
    if (!session?.sessionToken) throw new Error(t('affiliates.payout.failed', 'Could not request the payout. Please try again.'));
    const { data, error } = await supabase.functions.invoke('affiliate-payout-request', { body: { sessionToken: session.sessionToken } });
    const { ok, httpStatus, body } = await answerOf(data, error);
    if (ok && body.status === 'requested') {
      // The new row is what the history and the card show after this.
      fetchDashboard().catch(() => { /* the next poll reads it */ });
      return body.ownerNotified === false ? 'requested_unnotified' : 'requested';
    }
    if (body.status === 'already_requested') return 'already';
    // balance_changed, unproven_address and every other refusal carry their reason.
    if (body.error) throw new Error(body.error);
    // A bare 409 is the one-open-request rule, as the function answered it before it named its statuses.
    if (httpStatus === 409 && !body.status) return 'already';
    throw new Error(t('affiliates.payout.failed', 'Could not request the payout. Please try again.'));
  };
  useEffect(() => {
    if (isAuthenticated) {
      fetchDashboard().catch((err) => {
        toast.error(err.message || 'Failed to load dashboard');
      });
    }
  }, [isAuthenticated, fetchDashboard, dashboardReload]);

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

  /** Forgot password: the same answer whether or not the address has an account. */
  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const { ok, body } = await callAccount({ action: 'reset-request', email });
      if (ok) toast.success(t('affiliateProgram.auth.resetSent'));
      else toast.error(body.error || failed());
    } finally {
      setIsSubmitting(false);
    }
  };

  /** A #reset= link: the new password spends it and signs out every device. */
  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    setIsSubmitting(true);
    try {
      const { ok, body } = await callAccount({ action: 'reset', token: resetToken, password: newPassword });
      if (ok) {
        toast.success(t('affiliateProgram.auth.passwordChanged'));
        setResetToken(null);
        setNewPassword('');
        setIsForgotMode(false);
        setIsLoginMode(true);
        // Every session ended with the old password, this device's included.
        if (session) await logout();
      } else {
        toast.error(body.status === 'weak_password' ? t('affiliateProgram.auth.weakPassword') : body.status === 'expired' ? t('affiliateProgram.auth.linkExpired') : body.error || failed());
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Runs one signed-in account action; the caller says what success means. */
  const accountAction = async (body: Record<string, unknown>, onOk: (answer: FunctionAnswer) => Promise<void> | void) => {
    if (!session?.sessionToken) return;
    setAccountBusy(true);
    try {
      const answer = await callAccount({ ...body, sessionToken: session.sessionToken });
      if (answer.ok) await onOk(answer.body);
      else toast.error(answer.body.error || failed());
    } finally {
      setAccountBusy(false);
    }
  };

  const handleSendConfirmation = () => accountAction({ action: 'confirm-request' }, () => {
    toast.success(t('affiliateProgram.confirm.sent', { email: dashboardData?.affiliate?.email ?? session?.email ?? '' }));
  });

  const handleSignOutEverywhere = () => accountAction({ action: 'sign-out-everywhere' }, async () => {
    toast.success(t('affiliateProgram.account.signedOutEverywhere'));
    await logout();
  });

  const handleExport = () => accountAction({ action: 'export' }, (answer) => {
    const blob = new Blob([JSON.stringify(answer.export ?? {}, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'affiliate-data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(t('affiliateProgram.account.exported'));
  });

  const handleEmailChange = (e: React.FormEvent) => {
    e.preventDefault();
    const address = newEmail.trim();
    return accountAction({ action: 'email-change-request', newEmail: address }, () => {
      toast.success(t('affiliateProgram.account.changeSent', { email: address }));
      setNewEmail('');
    });
  };

  const handleErase = () => accountAction({ action: 'erase', confirm: eraseConfirm }, async () => {
    toast.success(t('affiliateProgram.account.erased'));
    setEraseConfirm('');
    await logout();
  });

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

  // A reset link, signed in or not: the new password ends every session.
  if (resetToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{t('affiliateProgram.auth.newPasswordTitle')}</CardTitle>
            <CardDescription>{t('affiliateProgram.auth.newPasswordIntro')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleNewPassword} className="space-y-4">
              <Input
                type="password"
                placeholder={t('affiliateProgram.auth.newPassword')}
                aria-label={t('affiliateProgram.auth.newPassword')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                maxLength={200}
                autoComplete="new-password"
                required
              />
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? t('affiliateProgram.auth.pleaseWait') : t('affiliateProgram.auth.savePassword')}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => { setResetToken(null); setIsForgotMode(true); }}
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {t('affiliateProgram.auth.forgot')}
              </button>
            </div>
          </CardContent>
        </Card>
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
                : t('affiliates.proCommission.tagline', 'Earn a flat {{amount}} when someone you refer pays for their first month of Pro.', rate)}
            </CardDescription>
            {/* Commission disclosure */}
            <div className="mt-4 p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center justify-center gap-2 mb-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <span className="font-bold text-lg text-primary">{t('affiliates.proCommission.headline', '{{amount}} for each referred first paid month of Pro', rate)}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('affiliates.proCommission.detail', 'Pro is $45 a month. When someone who came through your link pays for their first month of Pro, you earn {{amount}}.', rate)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('affiliates.proCommission.excludedFa', 'Other purchases (the Full Resume Analysis) earn no commission. Commissions you have already earned are paid as before.')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('affiliateProgram.cookieLine')}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {isForgotMode ? (
              <form onSubmit={handleResetRequest} className="space-y-4">
                <div>
                  <p className="font-medium">{t('affiliateProgram.auth.resetTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('affiliateProgram.auth.resetIntro')}</p>
                </div>
                <Input
                  type="email"
                  placeholder={t('affiliateProgram.auth.email')}
                  aria-label={t('affiliateProgram.auth.email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  <Mail className="h-4 w-4 mr-2" />
                  {isSubmitting ? t('affiliateProgram.auth.pleaseWait') : t('affiliateProgram.auth.sendLink')}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setIsForgotMode(false)}
                    className="text-sm text-muted-foreground hover:text-primary"
                  >
                    {t('affiliateProgram.auth.backToSignIn')}
                  </button>
                </div>
              </form>
            ) : (
            <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Input
                  type="email"
                  placeholder={t('affiliateProgram.auth.email')}
                  aria-label={t('affiliateProgram.auth.email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Input
                  type="password"
                  placeholder={t('affiliateProgram.auth.password')}
                  aria-label={t('affiliateProgram.auth.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? t('affiliateProgram.auth.pleaseWait') : isLoginMode ? 'Sign In' : 'Create Account'}
              </Button>
            </form>
            <div className="mt-4 text-center space-y-2">
              {isLoginMode && (
                <div>
                  <button
                    type="button"
                    onClick={() => setIsForgotMode(true)}
                    className="text-sm text-muted-foreground hover:text-primary"
                  >
                    {t('affiliateProgram.auth.forgot')}
                  </button>
                </div>
              )}
              <button
                onClick={() => setIsLoginMode(!isLoginMode)}
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {isLoginMode 
                  ? "Don't have an account? Sign up" 
                  : 'Already have an account? Sign in'}
              </button>
            </div>
            </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Dashboard
  const stats = dashboardData?.stats;
  const affiliate = dashboardData?.affiliate;
  const conversions = dashboardData?.recent_conversions || [];
  // The selected period's figures (S14X-212). Before the round's dashboard
  // answers stats_by_range, the tiles show all-time figures and say so.
  const rangeStats: AffiliateRangeStats | undefined = dashboardData?.stats_by_range?.[dateRange];
  const periodLabel = rangeStats ? t(`affiliateProgram.tiles.range.d${dateRange}`) : t('affiliateProgram.tiles.allTime');
  const clicksShown = rangeStats ? rangeStats.clicks : stats?.total_clicks || 0;
  const conversionsShown = rangeStats ? rangeStats.conversions : stats?.total_conversions || 0;
  const rateShown = rangeStats
    ? (rangeStats.clicks > 0 ? Math.round((rangeStats.conversions / rangeStats.clicks) * 10000) / 100 : 0)
    : stats?.conversion_rate || 0;
  // Sales per currency (S14X-227); null before the dashboard answers it.
  const revenueShown: Record<string, number> | null = rangeStats ? rangeStats.revenue_by_currency ?? {} : stats?.revenue_by_currency ?? null;
  const revenueLines = revenueShown
    ? Object.entries(revenueShown)
        .filter(([, v]) => Number(v) !== 0)
        .sort(([a], [b]) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : a.localeCompare(b)))
    : [];
  const hasAwaiting = typeof stats?.awaiting_approval === 'number';
  const payoutRequests = dashboardData?.payout_requests;
  const openRequest = payoutRequests?.find((r) => r.status === 'requested') ?? null;
  const shortDate = (iso: string | null) => (iso ? formatDate(iso) : '');

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
        {/* An unproven address earns and is paid nothing until confirmed (S14X-115). */}
        {affiliate?.email_confirmed === false && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="font-semibold">{t('affiliateProgram.confirm.bannerTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('affiliateProgram.confirm.bannerBody')}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleSendConfirmation} disabled={accountBusy}>
              <Mail className="h-4 w-4 mr-2" />
              {t('affiliateProgram.confirm.send')}
            </Button>
          </div>
        )}

        {/* Commission Banner */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">{t('affiliates.commission.bannerTitle', 'Your commission')}</p>
              <p className="text-sm text-muted-foreground">{t('affiliates.proCommission.banner', '{{amount}} per referred first paid month of Pro', rate)}</p>
              <p className="text-xs text-muted-foreground">{t('affiliates.proCommission.excludedFa', 'Other purchases (the Full Resume Analysis) earn no commission. Commissions you have already earned are paid as before.')}</p>
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
                  {t('affiliates.proCommission.linkHint', 'Share this link to earn {{amount}} on each referred first paid month of Pro, with a 30-day attribution window', rate)}
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

        {/* Stats Grid: clicks and conversions follow the period; balances say what they are. */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasAwaiting ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('affiliateProgram.tiles.clicks')}</p>
                  <p className="text-2xl font-bold">{clicksShown}</p>
                  <p className="text-xs text-muted-foreground">{periodLabel}</p>
                </div>
                <MousePointerClick className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('affiliateProgram.tiles.conversions')}</p>
                  <p className="text-2xl font-bold">{conversionsShown}</p>
                  <p className="text-xs text-muted-foreground">
                    {periodLabel} · {t('affiliateProgram.tiles.rate', { rate: rateShown })}
                  </p>
                  {rangeStats && (
                    <p className="text-xs text-muted-foreground">
                      {t('affiliateProgram.tiles.commission', { amount: formatCurrency(rangeStats.commission) })}
                    </p>
                  )}
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
                  <p className="text-xs text-muted-foreground">{t('affiliateProgram.tiles.payable')}</p>
                </div>
                <Clock className="h-8 w-8 text-yellow-600/50" />
              </div>
            </CardContent>
          </Card>

          {hasAwaiting && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('affiliateProgram.tiles.awaitingApproval')}</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(stats?.awaiting_approval || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('affiliateProgram.tiles.awaitingCount', { count: stats?.awaiting_approval_count ?? 0 })}
                    </p>
                  </div>
                  <ShieldAlert className="h-8 w-8 text-muted-foreground/50" />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t('affiliateProgram.tiles.totalPaid')}</p>
                  <p className="text-2xl font-bold text-green-600">
                    {formatCurrency(stats?.paid_out || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('affiliateProgram.tiles.allTime')}</p>
                </div>
                <DollarSign className="h-8 w-8 text-green-600/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Revenue Card: each currency on its own line (S14X-227) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Revenue Generated
            </CardTitle>
            <CardDescription>
              {t('affiliateProgram.revenue.description')} · {periodLabel}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {revenueShown === null ? (
              <p className="text-4xl font-bold">{formatCurrency(stats?.total_revenue || 0)}</p>
            ) : revenueLines.length === 0 ? (
              <p className="text-muted-foreground">{t('affiliateProgram.revenue.none')}</p>
            ) : (
              <div className="space-y-1">
                {revenueLines.map(([currency, minor]) => (
                  <p key={currency} className={revenueLines.length === 1 ? 'text-4xl font-bold' : 'text-2xl font-bold'}>
                    {currency === 'unknown'
                      ? t('affiliateProgram.revenue.unknownCurrency', { amount: (Number(minor) / 100).toFixed(2) })
                      : formatMoney(Number(minor), currency)}
                  </p>
                ))}
              </div>
            )}
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
        {clicksShown > 0 && (
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
                      { stage: 'Clicks', value: clicksShown, fill: 'hsl(var(--primary))' },
                      { stage: 'Conversions', value: conversionsShown, fill: 'hsl(142 76% 36%)' },
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
                <span className="text-2xl font-bold text-primary">{rateShown}%</span>
                {rateShown >= 5 ? (
                  <Badge variant="default" className="bg-green-500">
                    <ArrowUpRight className="h-3 w-3 mr-1" />
                    Great
                  </Badge>
                ) : rateShown > 0 ? (
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
                      {conversion.held_for_review && (
                        <p className="text-xs text-muted-foreground mt-1">{t('affiliateProgram.conversions.heldForReview')}</p>
                      )}
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
                  {t('affiliates.proCommission.howItWorks', 'When someone clicks your link and pays for their first month of Pro within 30 days, you earn {{amount}}. Other purchases earn nothing.', rate)}
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
                  {t('affiliateProgram.howItWorks.getPaid')}
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
                awaitingApproval={stats?.awaiting_approval || 0}
                openRequest={openRequest}
                onRequestPayout={requestPayout}
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
                  {payoutRequests && payoutRequests.length > 0 ? (
                    // The requests the server holds (S14X-116), newest first.
                    <div className="space-y-3">
                      {payoutRequests.map((r, i) => (
                        <div key={r.id ?? `${r.requested_at}-${i}`} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <p className="font-medium">{formatCurrency(r.amount_cents)}</p>
                            <p className="text-sm text-muted-foreground">
                              {r.status === 'paid' && r.resolved_at
                                ? t('affiliateProgram.history.paidOn', { date: shortDate(r.resolved_at) })
                                : r.status === 'rejected' && r.resolved_at
                                  ? t('affiliateProgram.history.rejectedOn', { date: shortDate(r.resolved_at) })
                                  : t('affiliateProgram.history.requestedOn', { date: shortDate(r.requested_at) })}
                            </p>
                          </div>
                          <Badge variant={r.status === 'paid' ? 'default' : r.status === 'rejected' ? 'destructive' : 'outline'} className="text-xs">
                            {r.status === 'paid' && <CheckCircle className="h-3 w-3 mr-1" />}
                            {r.status === 'paid'
                              ? t('affiliateProgram.history.paid')
                              : r.status === 'rejected'
                                ? t('affiliateProgram.history.rejected')
                                : t('affiliateProgram.history.requested')}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : !payoutRequests && (stats?.paid_out || 0) > 0 ? (
                    // Before the dashboard lists requests: the paid total, under its own name.
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <p className="font-medium">{t('affiliateProgram.history.paidToDate')}</p>
                      <p className="font-medium text-green-600">{formatCurrency(stats?.paid_out || 0)}</p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      No payouts yet. Keep promoting to earn commissions!
                    </p>
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
                    <h4 className="font-medium">{t('affiliates.updates.title', 'Updates while this page is open')}</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('affiliates.updates.body', 'This page checks for new clicks and sales every {{seconds}} seconds while it is open, and shows a notification when one arrives.', { seconds: AFFILIATE_POLL_MS / 1000 })}
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

        {/* The account itself (S14X-093, S14X-021, S14X-115): affiliate-account. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('affiliateProgram.account.title')}</CardTitle>
            <CardDescription>{t('affiliateProgram.account.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleSignOutEverywhere} disabled={accountBusy}>
                <LogOut className="h-4 w-4 mr-2" />
                {t('affiliateProgram.account.signOutEverywhere')}
              </Button>
              <Button variant="outline" onClick={handleExport} disabled={accountBusy}>
                <Download className="h-4 w-4 mr-2" />
                {t('affiliateProgram.account.export')}
              </Button>
            </div>
            <form onSubmit={handleEmailChange} className="flex flex-col sm:flex-row gap-2">
              <Input
                type="email"
                placeholder={t('affiliateProgram.account.newEmail')}
                aria-label={t('affiliateProgram.account.newEmail')}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <Button type="submit" variant="outline" disabled={accountBusy}>
                <Mail className="h-4 w-4 mr-2" />
                {t('affiliateProgram.account.sendChangeLink')}
              </Button>
            </form>
            <div className="space-y-2 border-t pt-4">
              <p className="font-medium">{t('affiliateProgram.account.eraseTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('affiliateProgram.account.eraseWarning')}</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input placeholder="ERASE" aria-label={t('affiliateProgram.account.eraseConfirmLabel')} value={eraseConfirm} onChange={(e) => setEraseConfirm(e.target.value)} autoComplete="off" />
                <Button variant="destructive" onClick={handleErase} disabled={accountBusy || eraseConfirm !== 'ERASE'}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('affiliateProgram.account.eraseButton')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
