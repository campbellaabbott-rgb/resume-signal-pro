import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Activity, CheckCircle, XCircle, Clock, Database, Zap, Globe, TrendingUp, AlertTriangle, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { AdminAuthGate } from '@/components/dashboard/AdminAuthGate';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';

interface ScanSuccessRate {
  total_scans: number;
  completed_scans: number;
  failed_scans: number;
  validation_errors: number;
  success_rate: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  cache_hit_rate: number;
}

interface HourlyMetric {
  hour_bucket: string;
  total_scans: number;
  completed_scans: number;
  failed_scans: number;
  avg_duration_ms: number;
  cache_hit_rate: number;
}

interface GeoStat {
  country: string;
  total_scans: number;
  failed_scans: number;
  failure_rate: number;
}

interface HealthStatus {
  status: string;
  last_successful_scan: string | null;
  scans_last_hour: number;
  success_rate_last_hour: number;
  avg_latency_last_hour: number;
  last_heartbeat_status: string | null;
  last_heartbeat_time: string | null;
  issues: string[];
}

interface CheckResult {
  passed: boolean;
  time_ms?: number;
  error?: string;
}

interface HeartbeatResult {
  id: string;
  created_at: string;
  function_name: string;
  status: string;
  response_time_ms: number;
  test_passed: boolean;
  error_message: string | null;
  checks_passed: Record<string, CheckResult> | null;
}

function ScanMetricsContent() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hoursBack, setHoursBack] = useState(24);
  const [successRate, setSuccessRate] = useState<ScanSuccessRate | null>(null);
  const [hourlyMetrics, setHourlyMetrics] = useState<HourlyMetric[]>([]);
  const [geoStats, setGeoStats] = useState<GeoStat[]>([]);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [recentHeartbeats, setRecentHeartbeats] = useState<HeartbeatResult[]>([]);
  const [runningHeartbeat, setRunningHeartbeat] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      // Fetch all metrics in parallel
      const [successRateRes, hourlyRes, geoRes, healthRes, heartbeatsRes] = await Promise.all([
        supabase.rpc('get_scan_success_rate', { p_hours_back: hoursBack }),
        supabase.rpc('get_scan_metrics_hourly', { p_hours_back: hoursBack }),
        supabase.rpc('get_scan_geo_stats', { p_hours_back: hoursBack }),
        supabase.rpc('get_scan_health_status'),
        supabase.from('heartbeat_results')
          .select('*')
          .eq('function_name', 'free-keyword-scan')
          .order('created_at', { ascending: false })
          .limit(10)
      ]);

      if (successRateRes.data && successRateRes.data.length > 0) {
        setSuccessRate(successRateRes.data[0]);
      }
      
      if (hourlyRes.data) {
        setHourlyMetrics(hourlyRes.data.reverse());
      }
      
      if (geoRes.data) {
        setGeoStats(geoRes.data);
      }
      
      if (healthRes.data && healthRes.data.length > 0) {
        setHealthStatus(healthRes.data[0]);
      }
      
      if (heartbeatsRes.data) {
        setRecentHeartbeats(heartbeatsRes.data as unknown as HeartbeatResult[]);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hoursBack]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchMetrics();
  };

  const runHeartbeat = async () => {
    setRunningHeartbeat(true);
    try {
      const { data, error } = await supabase.functions.invoke('scan-heartbeat');
      if (error) throw error;
      console.log('Heartbeat result:', data);
      // Refresh metrics to show new heartbeat
      await fetchMetrics();
    } catch (error) {
      console.error('Heartbeat failed:', error);
    } finally {
      setRunningHeartbeat(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500';
      case 'degraded': return 'bg-yellow-500';
      case 'critical':
      case 'down': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy': return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Healthy</Badge>;
      case 'degraded': return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Degraded</Badge>;
      case 'critical': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Critical</Badge>;
      case 'down': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Down</Badge>;
      default: return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    return new Date(isoString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading scan metrics...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/health-check">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Scan Metrics Dashboard
              </h1>
              <p className="text-sm text-muted-foreground">Monitor free scan performance and health</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select 
              value={hoursBack} 
              onChange={(e) => setHoursBack(Number(e.target.value))}
              className="bg-background border border-border rounded px-3 py-1.5 text-sm"
            >
              <option value={1}>Last 1 hour</option>
              <option value={6}>Last 6 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={72}>Last 3 days</option>
              <option value={168}>Last 7 days</option>
            </select>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={runHeartbeat} disabled={runningHeartbeat}>
              <Heart className={`w-4 h-4 mr-2 ${runningHeartbeat ? 'animate-pulse' : ''}`} />
              Run Heartbeat
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Health Status Card */}
        <Card className={`border-2 ${healthStatus?.status === 'healthy' ? 'border-green-500/30' : healthStatus?.status === 'degraded' ? 'border-yellow-500/30' : 'border-red-500/30'}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getStatusColor(healthStatus?.status || 'unknown')} animate-pulse`} />
                System Health
              </CardTitle>
              {healthStatus && getStatusBadge(healthStatus.status)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Last Successful Scan</p>
                <p className="font-medium">{formatTime(healthStatus?.last_successful_scan || null)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Scans (Last Hour)</p>
                <p className="font-medium">{healthStatus?.scans_last_hour || 0}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Success Rate (Last Hour)</p>
                <p className="font-medium">{healthStatus?.success_rate_last_hour || 0}%</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Latency (Last Hour)</p>
                <p className="font-medium">{Math.round(healthStatus?.avg_latency_last_hour || 0)}ms</p>
              </div>
            </div>
            {healthStatus?.issues && healthStatus.issues.length > 0 && (
              <div className="mt-4 p-3 bg-destructive/10 rounded-lg">
                <p className="text-sm font-medium text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Active Issues
                </p>
                <ul className="mt-2 text-sm text-destructive/80 list-disc list-inside">
                  {healthStatus.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Scans</p>
                  <p className="text-2xl font-bold">{successRate?.total_scans || 0}</p>
                </div>
                <Database className="w-8 h-8 text-primary/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Success Rate</p>
                  <p className="text-2xl font-bold text-green-500">{successRate?.success_rate || 0}%</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500/50" />
              </div>
              <Progress value={successRate?.success_rate || 0} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Cache Hit Rate</p>
                  <p className="text-2xl font-bold text-blue-500">{successRate?.cache_hit_rate || 0}%</p>
                </div>
                <Zap className="w-8 h-8 text-blue-500/50" />
              </div>
              <Progress value={successRate?.cache_hit_rate || 0} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">P95 Latency</p>
                  <p className="text-2xl font-bold">{Math.round(successRate?.p95_duration_ms || 0)}ms</p>
                </div>
                <Clock className="w-8 h-8 text-yellow-500/50" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">P50: {Math.round(successRate?.p50_duration_ms || 0)}ms</p>
            </CardContent>
          </Card>
        </div>

        {/* Failure Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-red-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Failed Scans</p>
                  <p className="text-2xl font-bold text-red-500">{successRate?.failed_scans || 0}</p>
                </div>
                <XCircle className="w-8 h-8 text-red-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-yellow-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Validation Errors</p>
                  <p className="text-2xl font-bold text-yellow-500">{successRate?.validation_errors || 0}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-yellow-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-green-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Completed Scans</p>
                  <p className="text-2xl font-bold text-green-500">{successRate?.completed_scans || 0}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <Tabs defaultValue="trend" className="w-full">
          <TabsList>
            <TabsTrigger value="trend">Hourly Trend</TabsTrigger>
            <TabsTrigger value="geo">Geographic</TabsTrigger>
            <TabsTrigger value="heartbeats">Heartbeats</TabsTrigger>
          </TabsList>

          <TabsContent value="trend">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Scan Volume & Success Rate Over Time
                </CardTitle>
                <CardDescription>Hourly breakdown of scan metrics</CardDescription>
              </CardHeader>
              <CardContent>
                {hourlyMetrics.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={hourlyMetrics}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="hour_bucket" 
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit' })}
                      />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        labelFormatter={(v) => new Date(v).toLocaleString()}
                      />
                      <Legend />
                      <Bar dataKey="completed_scans" name="Completed" fill="hsl(142.1 76.2% 36.3%)" />
                      <Bar dataKey="failed_scans" name="Failed" fill="hsl(0 84.2% 60.2%)" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No hourly data available yet
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="geo">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  Geographic Distribution
                </CardTitle>
                <CardDescription>Scan volume and failure rates by country</CardDescription>
              </CardHeader>
              <CardContent>
                {geoStats.length > 0 ? (
                  <div className="space-y-3">
                    {geoStats.map((geo) => (
                      <div key={geo.country} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{getCountryFlag(geo.country)}</span>
                          <div>
                            <p className="font-medium">{geo.country}</p>
                            <p className="text-sm text-muted-foreground">{geo.total_scans} scans</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-medium ${geo.failure_rate > 10 ? 'text-red-500' : geo.failure_rate > 5 ? 'text-yellow-500' : 'text-green-500'}`}>
                            {geo.failure_rate}% failure
                          </p>
                          <p className="text-sm text-muted-foreground">{geo.failed_scans} failed</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No geographic data available yet
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="heartbeats">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Heart className="w-5 h-5" />
                  Recent Heartbeat Results
                </CardTitle>
                <CardDescription>Automated health checks for the free scan function</CardDescription>
              </CardHeader>
              <CardContent>
                {recentHeartbeats.length > 0 ? (
                  <div className="space-y-3">
                    {recentHeartbeats.map((hb) => (
                      <div key={hb.id} className={`p-4 rounded-lg border ${hb.test_passed ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {hb.test_passed ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                            {getStatusBadge(hb.status)}
                          </div>
                          <div className="text-right text-sm">
                            <p className="text-muted-foreground">{formatTime(hb.created_at)}</p>
                            <p className="font-mono">{hb.response_time_ms}ms</p>
                          </div>
                        </div>
                        {hb.error_message && (
                          <p className="text-sm text-red-400 mt-2">{hb.error_message}</p>
                        )}
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {Object.entries(hb.checks_passed).map(([name, check]) => (
                            <Badge 
                              key={name} 
                              variant="outline" 
                              className={check.passed ? 'border-green-500/30 text-green-400' : 'border-red-500/30 text-red-400'}
                            >
                              {check.passed ? '✓' : '✗'} {name}
                              {check.time_ms && ` (${check.time_ms}ms)`}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground flex-col gap-2">
                    <Heart className="w-8 h-8 text-muted-foreground/50" />
                    <p>No heartbeat results yet</p>
                    <Button size="sm" onClick={runHeartbeat} disabled={runningHeartbeat}>
                      Run First Heartbeat
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default function ScanMetrics() {
  return (
    <AdminAuthGate>
      <ScanMetricsContent />
    </AdminAuthGate>
  );
}

// Helper function to get country flag emoji
function getCountryFlag(countryCode: string): string {
  if (!countryCode || countryCode === 'Unknown') return '🌍';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
