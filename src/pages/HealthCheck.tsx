import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Activity, Database, Zap, CreditCard, ArrowLeft, BarChart3 } from 'lucide-react';
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
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchHealthCheck, 30000);
    return () => clearInterval(interval);
  }, []);

  const StatusIcon = data ? statusConfig[data.status].icon : Activity;

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="max-w-4xl mx-auto">
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
                Real-time status of backend services
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
              onClick={() => fetchHealthCheck()}
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
              
              {data && (
                <Badge variant="outline" className="text-xs">
                  v{data.version}
                </Badge>
              )}
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
        <div className="grid gap-4 md:grid-cols-3">
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

        {/* Timestamp */}
        {data && (
          <p className="text-center text-xs text-muted-foreground mt-6">
            Last checked: {new Date(data.timestamp).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
