import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Activity, Database, Zap, CreditCard, ArrowLeft, BarChart3, TrendingUp, TrendingDown, Clock, FileSearch, AlertOctagon } from 'lucide-react';
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

  const fetchProductMetrics = async () => {
    try {
      // Get scan success rate
      const { data: successData } = await supabase.rpc('get_scan_success_rate', { p_hours_back: 24 });
      
      // Get today's scan count
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
        // Filter for incidents (failed checks)
        setRecentIncidents(hbData.filter(h => !h.test_passed).slice(0, 5));
      }
    } catch (e) {
      console.error('Failed to fetch heartbeats:', e);
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
        return; // Success, exit
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Failed to send a request to the Edge Function';
        
        if (attempt < retries) {
          // Wait before retry (exponential backoff: 500ms, 1000ms, 2000ms)
          await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
          continue;
        }
        
        // Final attempt failed
        setError(`${errorMessage} (after ${retries} attempts)`);
      }
    }
    
    setLoading(false);
  };

  useEffect(() => {
    fetchHealthCheck();
    fetchProductMetrics();
    fetchHeartbeats();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchHealthCheck();
      fetchProductMetrics();
      fetchHeartbeats();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const StatusIcon = data ? statusConfig[data.status].icon : Activity;

  const getUptimePercentage = () => {
    if (heartbeats.length === 0) return 100;
    const passed = heartbeats.filter(h => h.test_passed).length;
    return Math.round((passed / heartbeats.length) * 100);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
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
              onClick={() => {
                fetchHealthCheck();
                fetchProductMetrics();
                fetchHeartbeats();
              }}
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
                    <Badge 
                      variant="outline" 
                      className={`${config.color} border-current`}
                    >
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
