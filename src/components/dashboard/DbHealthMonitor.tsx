/**
 * Database Health Monitor Component
 * Displays real-time database connection health and query metrics
 */

import { useDbHealth } from '@/hooks/use-db-health';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Database,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Activity,
  Zap,
  RotateCcw,
} from 'lucide-react';

export function DbHealthMonitor() {
  const {
    health,
    metrics,
    performHealthCheck,
    refreshMetrics,
    clearMetrics,
  } = useDbHealth({ autoCheck: true, checkIntervalMs: 30000 });

  const getHealthBadge = () => {
    if (health.checking) {
      return (
        <Badge variant="secondary" className="gap-1">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Checking
        </Badge>
      );
    }
    if (health.healthy) {
      return (
        <Badge className="bg-green-500/20 text-green-600 gap-1">
          <CheckCircle className="h-3 w-3" />
          Healthy
        </Badge>
      );
    }
    if (health.consecutiveFailures >= 3) {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Unhealthy
        </Badge>
      );
    }
    return (
      <Badge className="bg-yellow-500/20 text-yellow-600 gap-1">
        <AlertTriangle className="h-3 w-3" />
        Degraded
      </Badge>
    );
  };

  const getLatencyColor = (latency: number | null) => {
    if (!latency) return 'text-muted-foreground';
    if (latency < 200) return 'text-green-600';
    if (latency < 500) return 'text-yellow-600';
    return 'text-red-600';
  };

  const formatTime = (date: Date | null) => {
    if (!date) return 'Never';
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
    return `${Math.round(diff / 60000)}m ago`;
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Connection Health Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Connection Health
            </div>
            {getHealthBadge()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Latency
              </p>
              <p className={`text-2xl font-bold ${getLatencyColor(health.latencyMs)}`}>
                {health.latencyMs ? `${health.latencyMs}ms` : '—'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Activity className="h-3 w-3" />
                Last Check
              </p>
              <p className="text-lg font-medium">
                {formatTime(health.lastCheck)}
              </p>
            </div>
          </div>

          {health.consecutiveFailures > 0 && (
            <div className="flex items-center gap-2 text-sm text-yellow-600 bg-yellow-500/10 px-3 py-2 rounded-md">
              <AlertTriangle className="h-4 w-4" />
              <span>{health.consecutiveFailures} consecutive failure(s)</span>
            </div>
          )}

          {health.error && (
            <div className="text-sm text-red-600 bg-red-500/10 px-3 py-2 rounded-md">
              {health.error}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={performHealthCheck}
            disabled={health.checking}
            className="w-full"
          >
            {health.checking ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Check Now
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Query Metrics Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Query Metrics
            </div>
            <Badge variant="secondary">
              {metrics.successRate.toFixed(1)}% success
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Success Rate</span>
              <span className="font-medium">{metrics.successRate.toFixed(1)}%</span>
            </div>
            <Progress value={metrics.successRate} className="h-2" />
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="space-y-1">
              <p className="text-2xl font-bold text-green-600">
                {metrics.successfulQueries}
              </p>
              <p className="text-xs text-muted-foreground">Successful</p>
            </div>
            <div className="space-y-1">
              <p className="text-2xl font-bold text-red-600">
                {metrics.failedQueries}
              </p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
            <div className="space-y-1">
              <p className="text-2xl font-bold text-yellow-600">
                {metrics.totalRetries}
              </p>
              <p className="text-xs text-muted-foreground">Retries</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-sm">
              <span className="text-muted-foreground">Avg Latency: </span>
              <span className="font-medium">
                {metrics.avgLatencyMs > 0 ? `${Math.round(metrics.avgLatencyMs)}ms` : '—'}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={clearMetrics}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
