import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Activity, Database, Zap, CreditCard, ArrowLeft, BarChart3, Clock, FileSearch, AlertOctagon, Mail, ShieldAlert, Ban, DollarSign, Webhook, FileWarning, Bell, Shuffle, Shield, ShieldOff, Timer, Flame, Snowflake, Thermometer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getAllCircuitStates, resetServiceCircuit } from '@/hooks/use-circuit-breaker';
import { HealthTrendChart } from '@/components/dashboard/HealthTrendChart';
import { EmailTrendChart } from '@/components/dashboard/EmailTrendChart';
import { WebhookTrendChart } from '@/components/dashboard/WebhookTrendChart';
import { AIGenerationTrendChart } from '@/components/dashboard/AIGenerationTrendChart';
import { UserHealthTable } from '@/components/dashboard/UserHealthTable';
import { HealthHistoryChart } from '@/components/dashboard/HealthHistoryChart';
import { GeoPerformanceChart } from '@/components/dashboard/GeoPerformanceChart';

interface CheckResult {
  status: 'ok' | 'slow' | 'error';
  latency_ms: number;
  message?: string;
}

interface HealthCheckData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: CheckResult;
    ai_gateway: CheckResult;
    stripe: CheckResult;
  };
  response_time_ms: number;
  version: string;
}

interface HeartbeatRecord {
  id: string;
  created_at: string;
  status: string;
  response_time_ms: number;
  test_passed: boolean;
  function_name: string;
}

interface ProductMetrics {
  scansToday: number;
  successRate: number;
  avgLatency: number;
  recentErrors: number;
  cacheHitRate: number;
}

interface EmailHealth {
  total_emails: number;
  successful_emails: number;
  failed_emails: number;
  success_rate: number;
  recent_emails: Array<{
    id: string;
    email_type: string;
    recipient: string;
    status: string;
    error_message?: string;
    created_at: string;
  }>;
}

interface FunctionError {
  function_name: string;
  total_errors: number;
  error_types: string[];
  last_error_at: string;
  sample_message?: string;
}

interface RateLimitStats {
  total_limited: number;
  unique_ips: number;
  by_function: Array<{ function: string; count: number }>;
  recent_limits: Array<{ visitor_id: string; function: string; created_at: string }>;
}

interface PaymentHealth {
  total_attempts: number;
  successful: number;
  failed: number;
  success_rate: number;
  recent_failures: Array<{
    payment_intent_id: string;
    failure_code?: string;
    failure_message?: string;
    amount: number;
    created_at: string;
  }>;
}

interface DeliveryHealth {
  total_orders: number;
  fully_delivered: number;
  generation_failed: number;
  email_failed: number;
  pending: number;
  delivery_rate: number;
  avg_generation_time_ms: number;
  recent_failures: Array<{
    session_id: string;
    email: string;
    product: string;
    status: string;
    error: string;
    created_at: string;
  }>;
}

interface AIQualityStats {
  total_generations: number;
  successful: number;
  parse_failures: number;
  success_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  recent_errors: Array<{
    product: string;
    error: string;
    duration_ms: number;
    created_at: string;
  }>;
}

interface CheckoutFunnel {
  checkouts_started: number;
  payments_completed: number;
  content_generated: number;
  fully_delivered: number;
  checkout_to_payment_rate: number;
  payment_to_delivery_rate: number;
  end_to_end_rate: number;
}

interface WebhookHealth {
  total_received: number;
  processed_successfully: number;
  processing_failed: number;
  success_rate: number;
  avg_processing_time_ms: number;
  events_by_type: Record<string, number>;
  recent_failures: Array<{
    event_type: string;
    error: string;
    created_at: string;
  }>;
}

interface ParseFailureStats {
  total_failures: number;
  pdf_failures: number;
  docx_failures: number;
  spreadsheet_failures: number;
  common_errors: Array<{ error: string; count: number }>;
  recent_failures: Array<{
    file_type: string;
    error: string;
    created_at: string;
  }>;
}

interface AIFallbackStatus {
  success: boolean;
  mode: string;
  fallbackConfig: string[];
  fallbacksAttempted?: string[];
  modelUsed?: string;
  usedFallback?: boolean;
  totalTime?: number;
  response?: string;
  error?: string;
  results?: Array<{
    model: string;
    success: boolean;
    responseTime: number;
    statusCode?: number;
    error?: string;
  }>;
  summary?: {
    totalModels: number;
    successfulModels: number;
    failedModels: number;
    fastestModel: string | null;
    averageResponseTime: number | null;
  };
}

interface CircuitBreakerStatus {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastError?: string;
  timeUntilRetry: number | null;
}

interface WarmUpResult {
  function: string;
  status: 'warm' | 'cold' | 'error';
  latency_ms: number;
  error?: string;
}

interface WarmUpStatus {
  success: boolean;
  timestamp: string;
  duration_ms: number;
  summary: {
    warm: number;
    cold: number;
    errors: number;
    avg_latency_ms: number;
  };
  results: WarmUpResult[];
}

const statusConfig = {
  healthy: { color: 'bg-green-500', icon: CheckCircle, label: 'Healthy' },
  degraded: { color: 'bg-yellow-500', icon: AlertTriangle, label: 'Degraded' },
  unhealthy: { color: 'bg-red-500', icon: XCircle, label: 'Unhealthy' },
};

const checkStatusConfig = {
  ok: { color: 'text-green-500', bgColor: 'bg-green-500/10', label: 'OK' },
  slow: { color: 'text-yellow-500', bgColor: 'bg-yellow-500/10', label: 'Slow' },
  error: { color: 'text-red-500', bgColor: 'bg-red-500/10', label: 'Error' },
};

const serviceIcons = {
  database: Database,
  ai_gateway: Zap,
  stripe: CreditCard,
};

const serviceLabels = {
  database: 'Database',
  ai_gateway: 'AI Gateway',
  stripe: 'Stripe',
};

export default function HealthCheck() {
  const [data, setData] = useState<HealthCheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [heartbeats, setHeartbeats] = useState<HeartbeatRecord[]>([]);
  const [productMetrics, setProductMetrics] = useState<ProductMetrics | null>(null);
  const [recentIncidents, setRecentIncidents] = useState<HeartbeatRecord[]>([]);
  
  // New monitoring states
  const [emailHealth, setEmailHealth] = useState<EmailHealth | null>(null);
  const [functionErrors, setFunctionErrors] = useState<FunctionError[]>([]);
  const [rateLimitStats, setRateLimitStats] = useState<RateLimitStats | null>(null);
  const [paymentHealth, setPaymentHealth] = useState<PaymentHealth | null>(null);
  
  // Delivery & AI quality states
  const [deliveryHealth, setDeliveryHealth] = useState<DeliveryHealth | null>(null);
  const [aiQuality, setAIQuality] = useState<AIQualityStats | null>(null);
  const [checkoutFunnel, setCheckoutFunnel] = useState<CheckoutFunnel | null>(null);
  
  // New monitoring states
  const [webhookHealth, setWebhookHealth] = useState<WebhookHealth | null>(null);
  const [parseFailures, setParseFailures] = useState<ParseFailureStats | null>(null);
  
  // AI Fallback monitoring
  const [aiFallbackStatus, setAIFallbackStatus] = useState<AIFallbackStatus | null>(null);
  const [aiFallbackLoading, setAIFallbackLoading] = useState(false);
  
  // Circuit breaker monitoring
  const [circuitBreakers, setCircuitBreakers] = useState<Record<string, CircuitBreakerStatus>>({});
  
  // Warm-up monitoring
  const [warmUpStatus, setWarmUpStatus] = useState<WarmUpStatus | null>(null);
  const [warmUpLoading, setWarmUpLoading] = useState(false);

  const fetchCircuitBreakerStatus = () => {
    const states = getAllCircuitStates();
    setCircuitBreakers(states);
  };

  const fetchProductMetrics = async () => {
    try {
      const { data: successData } = await supabase.rpc('get_scan_success_rate', { p_hours_back: 24 });
      const { data: todayCount } = await supabase.rpc('get_today_scan_count');
      
      if (successData && successData[0]) {
        setProductMetrics({
          scansToday: todayCount || 0,
          successRate: successData[0].success_rate || 0,
          avgLatency: successData[0].avg_duration_ms || 0,
          recentErrors: successData[0].failed_scans || 0,
          cacheHitRate: successData[0].cache_hit_rate || 0,
        });
      }
    } catch (e) {
      console.error('Failed to fetch product metrics:', e);
    }
  };

  const fetchHeartbeats = async () => {
    try {
      const { data: hbData } = await supabase
        .from('heartbeat_results')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (hbData) {
        setHeartbeats(hbData);
        setRecentIncidents(hbData.filter(h => !h.test_passed).slice(0, 5));
      }
    } catch (e) {
      console.error('Failed to fetch heartbeats:', e);
    }
  };

  const fetchEmailHealth = async () => {
    try {
      const { data } = await supabase.rpc('get_email_health', { p_hours_back: 24 });
      if (data && data[0]) {
        setEmailHealth({
          ...data[0],
          recent_emails: data[0].recent_emails as EmailHealth['recent_emails'],
        });
      }
    } catch (e) {
      console.error('Failed to fetch email health:', e);
    }
  };

  const fetchFunctionErrors = async () => {
    try {
      const { data } = await supabase.rpc('get_function_error_rates', { p_hours_back: 24 });
      if (data) {
        setFunctionErrors(data as FunctionError[]);
      }
    } catch (e) {
      console.error('Failed to fetch function errors:', e);
    }
  };

  const fetchRateLimitStats = async () => {
    try {
      const { data } = await supabase.rpc('get_rate_limit_stats', { p_hours_back: 24 });
      if (data && data[0]) {
        setRateLimitStats({
          ...data[0],
          by_function: data[0].by_function as RateLimitStats['by_function'],
          recent_limits: data[0].recent_limits as RateLimitStats['recent_limits'],
        });
      }
    } catch (e) {
      console.error('Failed to fetch rate limit stats:', e);
    }
  };

  const fetchPaymentHealth = async () => {
    try {
      const { data } = await supabase.rpc('get_payment_health', { p_hours_back: 24 });
      if (data && data[0]) {
        setPaymentHealth({
          ...data[0],
          recent_failures: data[0].recent_failures as PaymentHealth['recent_failures'],
        });
      }
    } catch (e) {
      console.error('Failed to fetch payment health:', e);
    }
  };

  const fetchDeliveryHealth = async () => {
    try {
      const { data } = await supabase.rpc('get_delivery_health', { p_hours_back: 24 });
      if (data && data[0]) {
        setDeliveryHealth({
          ...data[0],
          recent_failures: data[0].recent_failures as DeliveryHealth['recent_failures'],
        });
      }
    } catch (e) {
      console.error('Failed to fetch delivery health:', e);
    }
  };

  const fetchAIQuality = async () => {
    try {
      const { data } = await supabase.rpc('get_ai_quality_stats', { p_hours_back: 24 });
      if (data && data[0]) {
        setAIQuality({
          ...data[0],
          recent_errors: data[0].recent_errors as AIQualityStats['recent_errors'],
        });
      }
    } catch (e) {
      console.error('Failed to fetch AI quality:', e);
    }
  };

  const fetchCheckoutFunnel = async () => {
    try {
      const { data } = await supabase.rpc('get_checkout_funnel', { p_hours_back: 24 });
      if (data && data[0]) {
        setCheckoutFunnel(data[0] as CheckoutFunnel);
      }
    } catch (e) {
      console.error('Failed to fetch checkout funnel:', e);
    }
  };

  const fetchWebhookHealth = async () => {
    try {
      const { data } = await supabase.rpc('get_webhook_health', { p_hours_back: 24 });
      if (data && data[0]) {
        setWebhookHealth({
          ...data[0],
          events_by_type: data[0].events_by_type as Record<string, number>,
          recent_failures: data[0].recent_failures as WebhookHealth['recent_failures'],
        });
      }
    } catch (e) {
      console.error('Failed to fetch webhook health:', e);
    }
  };

  const fetchParseFailures = async () => {
    try {
      const { data } = await supabase.rpc('get_parse_failure_stats', { p_hours_back: 24 });
      if (data && data[0]) {
        setParseFailures({
          ...data[0],
          common_errors: data[0].common_errors as ParseFailureStats['common_errors'],
          recent_failures: data[0].recent_failures as ParseFailureStats['recent_failures'],
        });
      }
    } catch (e) {
      console.error('Failed to fetch parse failures:', e);
    }
  };

  const fetchAIFallbackStatus = async (mode: 'quick' | 'all' = 'quick') => {
    setAIFallbackLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-ai-fallback', {
        body: { mode }
      });
      if (error) throw error;
      setAIFallbackStatus(data);
    } catch (e) {
      console.error('Failed to fetch AI fallback status:', e);
      setAIFallbackStatus({
        success: false,
        mode,
        fallbackConfig: [],
        error: e instanceof Error ? e.message : 'Failed to test AI fallback'
      });
    } finally {
      setAIFallbackLoading(false);
    }
  };

  const fetchWarmUpStatus = async () => {
    setWarmUpLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('warm-up');
      if (error) throw error;
      setWarmUpStatus(data as WarmUpStatus);
    } catch (e) {
      console.error('Failed to fetch warm-up status:', e);
      setWarmUpStatus(null);
    } finally {
      setWarmUpLoading(false);
    }
  };

  const fetchHealthCheck = async (retries = 3) => {
    setLoading(true);
    setError(null);
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const { data: result, error: fnError } = await supabase.functions.invoke('health-check');
        
        if (fnError) {
          throw fnError;
        }
        
        setData(result);
        setLastRefresh(new Date());
        setError(null);
        setLoading(false);
        return;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Failed to send a request to the Edge Function';
        
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
          continue;
        }
        
        setError(`${errorMessage} (after ${retries} attempts)`);
      }
    }
    
    setLoading(false);
  };

  const refreshAll = () => {
    fetchHealthCheck();
    fetchProductMetrics();
    fetchHeartbeats();
    fetchEmailHealth();
    fetchFunctionErrors();
    fetchRateLimitStats();
    fetchPaymentHealth();
    fetchDeliveryHealth();
    fetchAIQuality();
    fetchCheckoutFunnel();
    fetchWebhookHealth();
    fetchParseFailures();
    fetchAIFallbackStatus('quick');
    fetchCircuitBreakerStatus();
  };

  useEffect(() => {
    refreshAll();
    
    const interval = setInterval(refreshAll, 30000);
    return () => clearInterval(interval);
  }, []);

  const StatusIcon = data ? statusConfig[data.status].icon : Activity;

  const getUptimePercentage = () => {
    if (heartbeats.length === 0) return 100;
    const passed = heartbeats.filter(h => h.test_passed).length;
    return Math.round((passed / heartbeats.length) * 100);
  };

  const maskEmail = (email: string) => {
    const [local, domain] = email.split('@');
    if (!domain) return email;
    return `${local.slice(0, 2)}***@${domain}`;
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to="/errors">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">System Health</h1>
              <p className="text-muted-foreground text-sm">
                Real-time status of backend services & product metrics
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Link to="/scan-metrics">
              <Button variant="outline" size="sm">
                <BarChart3 className="h-4 w-4 mr-2" />
                Scan Metrics
              </Button>
            </Link>
            {lastRefresh && (
              <span className="text-xs text-muted-foreground">
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={refreshAll}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Overall Status */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${data ? statusConfig[data.status].color : 'bg-muted'}`}>
                  <StatusIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    {loading ? 'Checking...' : data ? statusConfig[data.status].label : 'Unknown'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {data ? `Response time: ${data.response_time_ms}ms` : 'Fetching status...'}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-500">{getUptimePercentage()}%</p>
                  <p className="text-xs text-muted-foreground">Uptime (recent)</p>
                </div>
                {data && (
                  <Badge variant="outline" className="text-xs">
                    v{data.version}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <Card className="mb-6 border-destructive">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 text-destructive">
                <XCircle className="h-5 w-5" />
                <span>{error}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Service Checks */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          {data && (Object.entries(data.checks) as [keyof typeof data.checks, CheckResult][]).map(([service, check]) => {
            const Icon = serviceIcons[service];
            const config = checkStatusConfig[check.status];
            
            return (
              <Card key={service} className={config.bgColor}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-5 w-5 ${config.color}`} />
                      <CardTitle className="text-base">{serviceLabels[service]}</CardTitle>
                    </div>
                    <Badge variant="outline" className={`${config.color} border-current`}>
                      {config.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Latency</span>
                      <span className="font-mono font-medium">{check.latency_ms}ms</span>
                    </div>
                    {check.message && (
                      <p className="text-xs text-muted-foreground truncate" title={check.message}>
                        {check.message}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Product Health Metrics */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5" />
              Product Health (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold">{productMetrics?.scansToday || 0}</p>
                <p className="text-xs text-muted-foreground">Scans Today</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className={`text-2xl font-bold ${(productMetrics?.successRate || 0) >= 95 ? 'text-green-500' : (productMetrics?.successRate || 0) >= 80 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {(productMetrics?.successRate || 0).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">Success Rate</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold">{Math.round(productMetrics?.avgLatency || 0)}ms</p>
                <p className="text-xs text-muted-foreground">Avg Latency</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className={`text-2xl font-bold ${(productMetrics?.cacheHitRate || 0) >= 50 ? 'text-green-500' : 'text-yellow-500'}`}>
                  {(productMetrics?.cacheHitRate || 0).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">Cache Hit Rate</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className={`text-2xl font-bold ${(productMetrics?.recentErrors || 0) === 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {productMetrics?.recentErrors || 0}
                </p>
                <p className="text-xs text-muted-foreground">Failed Scans</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Health History with Multiple Views */}
        <HealthHistoryChart />

        {/* Scan Activity Trends */}
        <HealthTrendChart className="mb-6 mt-6" />

        {/* Additional Trend Charts */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-6">
          <EmailTrendChart />
          <WebhookTrendChart />
          <AIGenerationTrendChart />
        </div>

        {/* Geographic Performance */}
        <GeoPerformanceChart />

        {/* Warm-Up Status */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Thermometer className="h-5 w-5 text-orange-500" />
                Edge Function Warm-Up
              </div>
              <div className="flex items-center gap-2">
                {warmUpStatus && (
                  <>
                    {warmUpStatus.summary.warm === warmUpStatus.results.length ? (
                      <Badge variant="default" className="bg-green-500/20 text-green-600">
                        <Flame className="h-3 w-3 mr-1" />
                        All Warm
                      </Badge>
                    ) : warmUpStatus.summary.cold > 0 ? (
                      <Badge variant="secondary" className="bg-blue-500/20 text-blue-600">
                        <Snowflake className="h-3 w-3 mr-1" />
                        {warmUpStatus.summary.cold} Cold
                      </Badge>
                    ) : warmUpStatus.summary.errors > 0 ? (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        {warmUpStatus.summary.errors} Errors
                      </Badge>
                    ) : null}
                  </>
                )}
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={fetchWarmUpStatus}
                  disabled={warmUpLoading}
                >
                  {warmUpLoading ? (
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Flame className="h-3 w-3 mr-1" />
                  )}
                  Warm Up
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!warmUpStatus ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Click "Warm Up" to ping edge functions and reduce cold start latency.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="text-center p-2 rounded-lg bg-green-500/10">
                    <p className="text-xl font-bold text-green-600">{warmUpStatus.summary.warm}</p>
                    <p className="text-xs text-muted-foreground">Warm</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-blue-500/10">
                    <p className="text-xl font-bold text-blue-600">{warmUpStatus.summary.cold}</p>
                    <p className="text-xs text-muted-foreground">Cold</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-red-500/10">
                    <p className="text-xl font-bold text-red-600">{warmUpStatus.summary.errors}</p>
                    <p className="text-xs text-muted-foreground">Errors</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-muted/50">
                    <p className="text-xl font-bold">{warmUpStatus.summary.avg_latency_ms}ms</p>
                    <p className="text-xs text-muted-foreground">Avg Latency</p>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {warmUpStatus.results.map((result) => {
                    const statusStyles = {
                      warm: { bg: 'bg-green-500/10', text: 'text-green-600', icon: Flame },
                      cold: { bg: 'bg-blue-500/10', text: 'text-blue-600', icon: Snowflake },
                      error: { bg: 'bg-red-500/10', text: 'text-red-600', icon: XCircle },
                    };
                    const style = statusStyles[result.status];
                    const StatusIcon = style.icon;
                    
                    return (
                      <div 
                        key={result.function}
                        className={`p-2 rounded-lg ${style.bg} flex items-center justify-between`}
                      >
                        <div className="flex items-center gap-2">
                          <StatusIcon className={`h-4 w-4 ${style.text}`} />
                          <span className="text-sm font-medium">{result.function}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-mono">{result.latency_ms}ms</span>
                          <Badge variant="outline" className={`${style.text} text-xs`}>
                            {result.status}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                <p className="text-xs text-muted-foreground text-center mt-3">
                  Last warm-up: {new Date(warmUpStatus.timestamp).toLocaleTimeString()} ({warmUpStatus.duration_ms}ms total)
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Circuit Breaker Status */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-500" />
                Circuit Breaker Status
              </div>
              <div className="flex items-center gap-2">
                {Object.values(circuitBreakers).some(cb => cb.state === 'open') ? (
                  <Badge variant="destructive">
                    <ShieldOff className="h-3 w-3 mr-1" />
                    Circuits Open
                  </Badge>
                ) : Object.values(circuitBreakers).some(cb => cb.state === 'half-open') ? (
                  <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600">
                    <Timer className="h-3 w-3 mr-1" />
                    Testing Recovery
                  </Badge>
                ) : Object.keys(circuitBreakers).length > 0 ? (
                  <Badge variant="default" className="bg-green-500/20 text-green-600">
                    <Shield className="h-3 w-3 mr-1" />
                    All Circuits Closed
                  </Badge>
                ) : (
                  <Badge variant="outline">No activity</Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(circuitBreakers).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No circuit breaker activity yet. Make some edge function calls to see status.
              </p>
            ) : (
              <div className="space-y-3">
                {Object.entries(circuitBreakers).map(([serviceName, status]) => {
                  const stateConfig = {
                    closed: { color: 'bg-green-500/10 border-green-500/30', textColor: 'text-green-600', label: 'Closed', icon: Shield },
                    open: { color: 'bg-red-500/10 border-red-500/30', textColor: 'text-red-600', label: 'Open', icon: ShieldOff },
                    'half-open': { color: 'bg-yellow-500/10 border-yellow-500/30', textColor: 'text-yellow-600', label: 'Half-Open', icon: Timer },
                  };
                  const config = stateConfig[status.state];
                  const StateIcon = config.icon;
                  
                  return (
                    <div 
                      key={serviceName} 
                      className={`p-3 rounded-lg border ${config.color} flex items-center justify-between`}
                    >
                      <div className="flex items-center gap-3">
                        <StateIcon className={`h-4 w-4 ${config.textColor}`} />
                        <div>
                          <p className="font-medium text-sm">{serviceName}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>Failures: {status.failures}</span>
                            <span>Total: {status.totalFailures} fail / {status.totalSuccesses} success</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {status.state === 'open' && status.timeUntilRetry && (
                          <span className="text-xs text-muted-foreground">
                            Retry in {Math.ceil(status.timeUntilRetry / 1000)}s
                          </span>
                        )}
                        <Badge variant="outline" className={config.textColor}>
                          {config.label}
                        </Badge>
                        {status.state !== 'closed' && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => {
                              resetServiceCircuit(serviceName);
                              fetchCircuitBreakerStatus();
                            }}
                            className="h-6 px-2 text-xs"
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                
                {Object.values(circuitBreakers).some(cb => cb.lastError) && (
                  <div className="mt-4 p-3 rounded bg-muted/50">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Recent Errors</p>
                    <div className="space-y-1">
                      {Object.entries(circuitBreakers)
                        .filter(([_, status]) => status.lastError)
                        .slice(0, 3)
                        .map(([serviceName, status]) => (
                          <p key={serviceName} className="text-xs text-red-500 truncate">
                            <span className="font-medium">{serviceName}:</span> {status.lastError}
                          </p>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* NEW: Four Monitoring Panels */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          
          {/* Email Delivery Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-500" />
                  Email Delivery (24h)
                </div>
                {emailHealth && (
                  <Badge variant={emailHealth.success_rate >= 95 ? 'default' : 'destructive'}>
                    {emailHealth.success_rate?.toFixed(0) || 0}% success
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!emailHealth || emailHealth.total_emails === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No emails sent in last 24h</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                    <div className="p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{emailHealth.total_emails}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                    <div className="p-2 rounded bg-green-500/10">
                      <p className="text-lg font-bold text-green-500">{emailHealth.successful_emails}</p>
                      <p className="text-xs text-muted-foreground">Sent</p>
                    </div>
                    <div className="p-2 rounded bg-red-500/10">
                      <p className="text-lg font-bold text-red-500">{emailHealth.failed_emails}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {emailHealth.recent_emails?.slice(0, 5).map((email) => (
                      <div key={email.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                        <div className="flex items-center gap-2">
                          {email.status === 'sent' ? (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500" />
                          )}
                          <span className="font-medium">{email.email_type}</span>
                        </div>
                        <span className="text-muted-foreground">{maskEmail(email.recipient)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Edge Function Error Rates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-orange-500" />
                  Function Errors (24h)
                </div>
                <Badge variant={functionErrors.length === 0 ? 'default' : 'destructive'}>
                  {functionErrors.reduce((acc, f) => acc + Number(f.total_errors), 0)} total
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {functionErrors.length === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No function errors</p>
                  <p className="text-xs text-green-500">All functions healthy</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {functionErrors.slice(0, 6).map((fn, i) => (
                    <div key={i} className="p-2 rounded bg-red-500/10 border border-red-500/20">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{fn.function_name || 'unknown'}</span>
                        <Badge variant="destructive" className="text-xs">
                          {fn.total_errors} errors
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate" title={fn.sample_message || ''}>
                        {fn.error_types?.join(', ') || 'Unknown error type'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rate Limit Alerts */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Ban className="h-5 w-5 text-yellow-500" />
                  Rate Limiting (24h)
                </div>
                <Badge variant={!rateLimitStats?.total_limited ? 'default' : 'secondary'}>
                  {rateLimitStats?.total_limited || 0} blocked
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!rateLimitStats || rateLimitStats.total_limited === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No rate limits triggered</p>
                  <p className="text-xs text-green-500">Traffic within normal bounds</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-4 text-center">
                    <div className="p-2 rounded bg-yellow-500/10">
                      <p className="text-lg font-bold text-yellow-500">{rateLimitStats.total_limited}</p>
                      <p className="text-xs text-muted-foreground">Requests Blocked</p>
                    </div>
                    <div className="p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{rateLimitStats.unique_ips}</p>
                      <p className="text-xs text-muted-foreground">Unique Users</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground mb-2">By Function:</p>
                    {rateLimitStats.by_function?.slice(0, 4).map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/30">
                        <span>{item.function || 'unknown'}</span>
                        <Badge variant="outline" className="text-xs">{item.count}</Badge>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Payment Flow Health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-500" />
                  Payment Flow (24h)
                </div>
                {paymentHealth && paymentHealth.total_attempts > 0 && (
                  <Badge variant={paymentHealth.success_rate >= 80 ? 'default' : 'destructive'}>
                    {paymentHealth.success_rate?.toFixed(0) || 0}% conversion
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!paymentHealth || paymentHealth.total_attempts === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No checkout attempts in last 24h</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                    <div className="p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{paymentHealth.total_attempts}</p>
                      <p className="text-xs text-muted-foreground">Checkouts</p>
                    </div>
                    <div className="p-2 rounded bg-green-500/10">
                      <p className="text-lg font-bold text-green-500">{paymentHealth.successful}</p>
                      <p className="text-xs text-muted-foreground">Completed</p>
                    </div>
                    <div className="p-2 rounded bg-red-500/10">
                      <p className="text-lg font-bold text-red-500">{paymentHealth.failed}</p>
                      <p className="text-xs text-muted-foreground">Dropped</p>
                    </div>
                  </div>
                  {paymentHealth.recent_failures && paymentHealth.recent_failures.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Recent Failures:</p>
                      {paymentHealth.recent_failures.slice(0, 3).map((failure, i) => (
                        <div key={i} className="p-2 rounded bg-red-500/10 border border-red-500/20 text-xs">
                          <div className="flex justify-between mb-1">
                            <span className="font-mono">${(failure.amount / 100).toFixed(2)}</span>
                            <span className="text-muted-foreground">
                              {new Date(failure.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-muted-foreground truncate">
                            {failure.failure_message || failure.failure_code || 'Unknown error'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* NEW: Delivery Tracking, AI Quality, Checkout Funnel */}
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          
          {/* Product Delivery Tracking */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-purple-500" />
                  Delivery (24h)
                </div>
                {deliveryHealth && deliveryHealth.total_orders > 0 && (
                  <Badge variant={deliveryHealth.delivery_rate >= 90 ? 'default' : 'destructive'}>
                    {deliveryHealth.delivery_rate?.toFixed(0) || 0}% delivered
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!deliveryHealth || deliveryHealth.total_orders === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No orders in last 24h</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-3 text-center">
                    <div className="p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{deliveryHealth.total_orders}</p>
                      <p className="text-xs text-muted-foreground">Total Orders</p>
                    </div>
                    <div className="p-2 rounded bg-green-500/10">
                      <p className="text-lg font-bold text-green-500">{deliveryHealth.fully_delivered}</p>
                      <p className="text-xs text-muted-foreground">Delivered</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-1.5 rounded bg-yellow-500/10">
                      <p className="font-bold text-yellow-500">{deliveryHealth.pending}</p>
                      <p className="text-muted-foreground">Pending</p>
                    </div>
                    <div className="p-1.5 rounded bg-red-500/10">
                      <p className="font-bold text-red-500">{deliveryHealth.generation_failed}</p>
                      <p className="text-muted-foreground">Gen Failed</p>
                    </div>
                    <div className="p-1.5 rounded bg-red-500/10">
                      <p className="font-bold text-red-500">{deliveryHealth.email_failed}</p>
                      <p className="text-muted-foreground">Email Failed</p>
                    </div>
                  </div>
                  {deliveryHealth.avg_generation_time_ms > 0 && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Avg gen time: {Math.round(deliveryHealth.avg_generation_time_ms)}ms
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* AI Quality Monitoring */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-blue-500" />
                  AI Quality (24h)
                </div>
                {aiQuality && aiQuality.total_generations > 0 && (
                  <Badge variant={aiQuality.success_rate >= 95 ? 'default' : 'destructive'}>
                    {aiQuality.success_rate?.toFixed(0) || 0}% valid
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!aiQuality || aiQuality.total_generations === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No AI generations in last 24h</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div className="p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{aiQuality.total_generations}</p>
                      <p className="text-xs text-muted-foreground">Total</p>
                    </div>
                    <div className="p-2 rounded bg-green-500/10">
                      <p className="text-lg font-bold text-green-500">{aiQuality.successful}</p>
                      <p className="text-xs text-muted-foreground">Valid</p>
                    </div>
                    <div className="p-2 rounded bg-red-500/10">
                      <p className="text-lg font-bold text-red-500">{aiQuality.parse_failures}</p>
                      <p className="text-xs text-muted-foreground">Parse Fail</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="p-1.5 rounded bg-muted/50">
                      <p className="font-bold">{aiQuality.avg_duration_ms || 0}ms</p>
                      <p className="text-muted-foreground">Avg Time</p>
                    </div>
                    <div className="p-1.5 rounded bg-muted/50">
                      <p className="font-bold">{aiQuality.p95_duration_ms || 0}ms</p>
                      <p className="text-muted-foreground">P95 Time</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Checkout Funnel */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-cyan-500" />
                  Funnel (24h)
                </div>
                {checkoutFunnel && checkoutFunnel.checkouts_started > 0 && (
                  <Badge variant={checkoutFunnel.end_to_end_rate >= 80 ? 'default' : 'secondary'}>
                    {checkoutFunnel.end_to_end_rate?.toFixed(0) || 0}% e2e
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!checkoutFunnel || checkoutFunnel.checkouts_started === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No checkouts in last 24h</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Checkout Started</span>
                    <span className="font-bold">{checkoutFunnel.checkouts_started}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: '100%' }}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span>Payment Complete</span>
                    <span className="font-bold">{checkoutFunnel.payments_completed}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${checkoutFunnel.checkout_to_payment_rate}%` }}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span>Content Generated</span>
                    <span className="font-bold">{checkoutFunnel.content_generated}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-purple-500 h-2 rounded-full transition-all"
                      style={{ width: `${checkoutFunnel.payments_completed > 0 ? (checkoutFunnel.content_generated / checkoutFunnel.payments_completed) * 100 : 0}%` }}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span>Fully Delivered</span>
                    <span className="font-bold text-green-500">{checkoutFunnel.fully_delivered}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-emerald-500 h-2 rounded-full transition-all"
                      style={{ width: `${checkoutFunnel.end_to_end_rate}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* NEW: Webhook Health & Parse Failures */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          
          {/* Stripe Webhook Health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Webhook className="h-5 w-5 text-indigo-500" />
                  Webhook Health (24h)
                </div>
                {webhookHealth && webhookHealth.total_received > 0 && (
                  <Badge variant={webhookHealth.success_rate >= 95 ? 'default' : 'destructive'}>
                    {webhookHealth.success_rate?.toFixed(0) || 0}% success
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!webhookHealth || webhookHealth.total_received === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No webhooks received in last 24h</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div className="p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{webhookHealth.total_received}</p>
                      <p className="text-xs text-muted-foreground">Received</p>
                    </div>
                    <div className="p-2 rounded bg-green-500/10">
                      <p className="text-lg font-bold text-green-500">{webhookHealth.processed_successfully}</p>
                      <p className="text-xs text-muted-foreground">Processed</p>
                    </div>
                    <div className="p-2 rounded bg-red-500/10">
                      <p className="text-lg font-bold text-red-500">{webhookHealth.processing_failed}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </div>
                  {webhookHealth.events_by_type && Object.keys(webhookHealth.events_by_type).length > 0 && (
                    <div className="space-y-1 mb-2">
                      <p className="text-xs font-medium text-muted-foreground">By Type:</p>
                      {Object.entries(webhookHealth.events_by_type).slice(0, 4).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between text-xs p-1 rounded bg-muted/30">
                          <span className="truncate max-w-[150px]">{type}</span>
                          <Badge variant="outline" className="text-xs">{count}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {webhookHealth.avg_processing_time_ms > 0 && (
                    <p className="text-xs text-muted-foreground text-center">
                      Avg processing: {Math.round(webhookHealth.avg_processing_time_ms)}ms
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Parse Failures */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileWarning className="h-5 w-5 text-orange-500" />
                  Parse Failures (24h)
                </div>
                <Badge variant={!parseFailures || parseFailures.total_failures === 0 ? 'default' : 'destructive'}>
                  {parseFailures?.total_failures || 0} failures
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!parseFailures || parseFailures.total_failures === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No parse failures</p>
                  <p className="text-xs text-green-500">All documents parsing successfully</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div className="p-2 rounded bg-red-500/10">
                      <p className="text-lg font-bold text-red-500">{parseFailures.pdf_failures}</p>
                      <p className="text-xs text-muted-foreground">PDF</p>
                    </div>
                    <div className="p-2 rounded bg-red-500/10">
                      <p className="text-lg font-bold text-red-500">{parseFailures.docx_failures}</p>
                      <p className="text-xs text-muted-foreground">DOCX</p>
                    </div>
                    <div className="p-2 rounded bg-red-500/10">
                      <p className="text-lg font-bold text-red-500">{parseFailures.spreadsheet_failures}</p>
                      <p className="text-xs text-muted-foreground">Other</p>
                    </div>
                  </div>
                  {parseFailures.recent_failures && parseFailures.recent_failures.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Recent:</p>
                      {parseFailures.recent_failures.slice(0, 3).map((failure, i) => (
                        <div key={i} className="p-2 rounded bg-red-500/10 border border-red-500/20 text-xs">
                          <div className="flex justify-between mb-1">
                            <Badge variant="outline" className="text-xs">{failure.file_type}</Badge>
                            <span className="text-muted-foreground">
                              {new Date(failure.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-muted-foreground truncate">{failure.error || 'Unknown error'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AI Model Fallback Status */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shuffle className="h-5 w-5 text-violet-500" />
                AI Model Fallback Chain
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => fetchAIFallbackStatus('all')}
                  disabled={aiFallbackLoading}
                >
                  {aiFallbackLoading ? (
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  Test All Models
                </Button>
                {aiFallbackStatus && (
                  <Badge variant={aiFallbackStatus.success ? 'default' : 'destructive'}>
                    {aiFallbackStatus.success ? 'Healthy' : 'Degraded'}
                  </Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!aiFallbackStatus ? (
              <div className="text-center py-4">
                <RefreshCw className="h-8 w-8 text-muted-foreground mx-auto mb-2 animate-spin" />
                <p className="text-sm text-muted-foreground">Testing AI models...</p>
              </div>
            ) : aiFallbackStatus.error ? (
              <div className="text-center py-4">
                <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
                <p className="text-sm text-red-500">{aiFallbackStatus.error}</p>
              </div>
            ) : (
              <>
                {/* Fallback chain display */}
                <div className="mb-4">
                  <p className="text-xs text-muted-foreground mb-2">Fallback Order:</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {aiFallbackStatus.fallbackConfig.map((model, i) => (
                      <div key={model} className="flex items-center gap-1">
                        <Badge 
                          variant={
                            aiFallbackStatus.modelUsed === model 
                              ? 'default' 
                              : aiFallbackStatus.results?.find(r => r.model === model)?.success 
                                ? 'outline' 
                                : 'secondary'
                          }
                          className={
                            aiFallbackStatus.modelUsed === model 
                              ? 'bg-green-500' 
                              : ''
                          }
                        >
                          {i + 1}. {model.replace('openai/', '').replace('google/', '')}
                          {aiFallbackStatus.modelUsed === model && ' ✓'}
                        </Badge>
                        {i < aiFallbackStatus.fallbackConfig.length - 1 && (
                          <span className="text-muted-foreground">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick test results */}
                {aiFallbackStatus.mode === 'quick' && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded bg-green-500/10">
                      <p className="text-lg font-bold text-green-500">{aiFallbackStatus.modelUsed?.split('/')[1] || 'N/A'}</p>
                      <p className="text-xs text-muted-foreground">Model Used</p>
                    </div>
                    <div className="p-2 rounded bg-muted/50">
                      <p className="text-lg font-bold">{aiFallbackStatus.totalTime || 0}ms</p>
                      <p className="text-xs text-muted-foreground">Response Time</p>
                    </div>
                    <div className="p-2 rounded bg-muted/50">
                      <p className={`text-lg font-bold ${aiFallbackStatus.usedFallback ? 'text-yellow-500' : 'text-green-500'}`}>
                        {aiFallbackStatus.usedFallback ? 'Yes' : 'No'}
                      </p>
                      <p className="text-xs text-muted-foreground">Used Fallback</p>
                    </div>
                  </div>
                )}

                {/* All models test results */}
                {aiFallbackStatus.mode === 'all' && aiFallbackStatus.results && (
                  <>
                    <div className="grid grid-cols-4 gap-2 mb-4 text-center">
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-lg font-bold">{aiFallbackStatus.summary?.totalModels || 0}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                      <div className="p-2 rounded bg-green-500/10">
                        <p className="text-lg font-bold text-green-500">{aiFallbackStatus.summary?.successfulModels || 0}</p>
                        <p className="text-xs text-muted-foreground">Working</p>
                      </div>
                      <div className="p-2 rounded bg-red-500/10">
                        <p className="text-lg font-bold text-red-500">{aiFallbackStatus.summary?.failedModels || 0}</p>
                        <p className="text-xs text-muted-foreground">Failed</p>
                      </div>
                      <div className="p-2 rounded bg-blue-500/10">
                        <p className="text-lg font-bold text-blue-500">{aiFallbackStatus.summary?.averageResponseTime || 0}ms</p>
                        <p className="text-xs text-muted-foreground">Avg Time</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Individual Results:</p>
                      {aiFallbackStatus.results.map((result, i) => (
                        <div 
                          key={result.model} 
                          className={`p-2 rounded border ${
                            result.success 
                              ? 'bg-green-500/10 border-green-500/20' 
                              : 'bg-red-500/10 border-red-500/20'
                          }`}
                        >
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              {result.success ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                              <span className="font-medium">{result.model}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{result.responseTime}ms</span>
                              {result.success && aiFallbackStatus.summary?.fastestModel === result.model && (
                                <Badge variant="outline" className="text-xs text-blue-500 border-blue-500">
                                  Fastest
                                </Badge>
                              )}
                            </div>
                          </div>
                          {result.error && (
                            <p className="text-xs text-red-400 mt-1 truncate">{result.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* User Health Monitor */}
        <div className="mb-6">
          <UserHealthTable />
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Uptime History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Recent Heartbeats
              </CardTitle>
            </CardHeader>
            <CardContent>
              {heartbeats.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No heartbeat data yet</p>
              ) : (
                <div className="space-y-2">
                  {heartbeats.slice(0, 6).map((hb) => (
                    <div key={hb.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                      <div className="flex items-center gap-2">
                        {hb.test_passed ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <span className="text-muted-foreground">
                          {new Date(hb.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={hb.test_passed ? 'text-green-500' : 'text-red-500'}>
                          {hb.status}
                        </Badge>
                        <span className="font-mono text-xs">{hb.response_time_ms}ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Incidents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-red-500" />
                Recent Incidents
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentIncidents.length === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No recent incidents</p>
                  <p className="text-xs text-green-500">All systems operational</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentIncidents.map((incident) => (
                    <div key={incident.id} className="p-3 rounded bg-red-500/10 border border-red-500/20">
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="destructive" className="text-xs">
                          {incident.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(incident.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {incident.function_name} failed after {incident.response_time_ms}ms
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Timestamp */}
        {data && (
          <p className="text-center text-xs text-muted-foreground">
            Last checked: {new Date(data.timestamp).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}