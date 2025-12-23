import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Activity, Database, Zap, CreditCard, ArrowLeft, BarChart3, Clock, FileSearch, AlertOctagon, Mail, ShieldAlert, Ban, DollarSign } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

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

        {/* Two Column Layout: Uptime History + Recent Incidents */}
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