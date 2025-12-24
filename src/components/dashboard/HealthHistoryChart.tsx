import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, Legend
} from 'recharts';
import { Activity, Clock, Server, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';

interface HealthRecord {
  id: string;
  function_name: string;
  status: string;
  test_passed: boolean;
  response_time_ms: number | null;
  checks_passed: Record<string, any> | null;
  metadata: Record<string, any> | null;
  error_message: string | null;
  created_at: string;
}

interface HourlyStats {
  hour: string;
  uptime: number;
  avgLatency: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  dbLatency: number;
  aiLatency: number;
  stripeLatency: number;
}

export function HealthHistoryChart() {
  const [data, setData] = useState<HealthRecord[]>([]);
  const [hourlyStats, setHourlyStats] = useState<HourlyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [overallUptime, setOverallUptime] = useState(0);
  const [avgLatency, setAvgLatency] = useState(0);

  useEffect(() => {
    fetchHealthHistory();
  }, []);

  const fetchHealthHistory = async () => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data: records, error } = await supabase
        .from('heartbeat_results')
        .select('*')
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Debug: log raw data structure
      if (records && records.length > 0) {
        const sample = records[0] as any;
        console.log('[HealthHistoryChart] Sample record keys:', Object.keys(sample));
        console.log('[HealthHistoryChart] Sample metadata:', sample.metadata);
        console.log('[HealthHistoryChart] Sample probes:', sample.metadata?.probes);
      }

      const typedRecords = (records || []) as HealthRecord[];
      setData(typedRecords);
      
      // Calculate hourly stats
      const hourlyMap = new Map<string, HealthRecord[]>();
      
      typedRecords.forEach(record => {
        const hour = new Date(record.created_at).toISOString().slice(0, 13) + ':00';
        if (!hourlyMap.has(hour)) {
          hourlyMap.set(hour, []);
        }
        hourlyMap.get(hour)!.push(record);
      });

      const stats: HourlyStats[] = [];
      hourlyMap.forEach((hourRecords, hour) => {
        const passed = hourRecords.filter(r => r.test_passed).length;
        const total = hourRecords.length;
        const latencies = hourRecords.filter(r => r.response_time_ms).map(r => r.response_time_ms!);
        
        // Extract service-specific latencies (scheduled probe stores them in metadata.probes)
        let dbLatencies: number[] = [];
        let aiLatencies: number[] = [];
        let stripeLatencies: number[] = [];

        hourRecords.forEach(record => {
          // Legacy/alternate format: checks_passed contains nested objects with latency
          const checks = record.checks_passed as any;
          if (checks?.database?.latency_ms) dbLatencies.push(Number(checks.database.latency_ms));
          if (checks?.ai_gateway?.latency_ms) aiLatencies.push(Number(checks.ai_gateway.latency_ms));
          if (checks?.stripe?.latency_ms) stripeLatencies.push(Number(checks.stripe.latency_ms));

          // Current format: metadata.probes array
          const metadata = record.metadata as any;
          const probes = metadata?.probes;
          if (Array.isArray(probes)) {
            probes.forEach((probe: any) => {
              const service = String(probe?.service ?? probe?.name ?? '').toLowerCase();
              const latency = Number(probe?.latency_ms ?? probe?.latencyMs ?? probe?.latency);
              if (!Number.isFinite(latency) || latency <= 0) return;

              if (service === 'database') dbLatencies.push(latency);
              if (service === 'ai-gateway' || service === 'ai_gateway' || service === 'aigateway') aiLatencies.push(latency);
              if (service === 'stripe') stripeLatencies.push(latency);
            });
          }
        });

        stats.push({
          hour: new Date(hour).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          uptime: total > 0 ? Math.round((passed / total) * 100) : 0,
          avgLatency: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
          totalChecks: total,
          passedChecks: passed,
          failedChecks: total - passed,
          dbLatency: dbLatencies.length > 0 ? Math.round(dbLatencies.reduce((a, b) => a + b, 0) / dbLatencies.length) : 0,
          aiLatency: aiLatencies.length > 0 ? Math.round(aiLatencies.reduce((a, b) => a + b, 0) / aiLatencies.length) : 0,
          stripeLatency: stripeLatencies.length > 0 ? Math.round(stripeLatencies.reduce((a, b) => a + b, 0) / stripeLatencies.length) : 0,
        });
      });
      
      // Debug: log first stats entry
      if (stats.length > 0) {
        console.log('[HealthHistoryChart] First hourly stat:', stats[0]);
      }

      setHourlyStats(stats);

      // Calculate overall stats
      const totalPassed = typedRecords.filter(r => r.test_passed).length;
      const totalRecords = typedRecords.length;
      setOverallUptime(totalRecords > 0 ? Math.round((totalPassed / totalRecords) * 100) : 100);
      
      const allLatencies = typedRecords.filter(r => r.response_time_ms).map(r => r.response_time_ms!);
      setAvgLatency(allLatencies.length > 0 ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length) : 0);

    } catch (error) {
      console.error('Failed to fetch health history:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const uptimeColor = overallUptime >= 99 ? 'text-green-400' : overallUptime >= 95 ? 'text-yellow-400' : 'text-red-400';

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Health History (24h)
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Uptime</p>
              <p className={`text-xl font-bold ${uptimeColor}`}>{overallUptime}%</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Avg Latency</p>
              <p className="text-xl font-bold text-foreground">{avgLatency}ms</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="uptime" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-4">
            <TabsTrigger value="uptime" className="text-xs">
              <CheckCircle className="h-3 w-3 mr-1" />
              Uptime
            </TabsTrigger>
            <TabsTrigger value="latency" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              Latency
            </TabsTrigger>
            <TabsTrigger value="services" className="text-xs">
              <Server className="h-3 w-3 mr-1" />
              Services
            </TabsTrigger>
            <TabsTrigger value="volume" className="text-xs">
              <Activity className="h-3 w-3 mr-1" />
              Volume
            </TabsTrigger>
          </TabsList>

          <TabsContent value="uptime" className="mt-0">
            <div className="h-48">
              {hourlyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={hourlyStats}>
                    <defs>
                      <linearGradient id="uptimeGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                    />
                    <YAxis 
                      domain={[0, 100]}
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))'
                      }}
                      formatter={(value: number) => [`${value}%`, 'Uptime']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="uptime" 
                      stroke="#22c55e" 
                      strokeWidth={2.5}
                      fill="url(#uptimeGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  No health data in the last 24 hours
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="latency" className="mt-0">
            <div className="h-48">
              {hourlyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                    />
                    <YAxis 
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickFormatter={(v) => `${v}ms`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))'
                      }}
                      formatter={(value: number) => [`${value}ms`, 'Avg Latency']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="avgLatency" 
                      stroke="#f59e0b" 
                      strokeWidth={2.5}
                      dot={{ fill: '#f59e0b', strokeWidth: 0, r: 3 }}
                      activeDot={{ r: 5, fill: '#f59e0b' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  No latency data available
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="services" className="mt-0">
            <div className="h-48">
              {hourlyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                    />
                    <YAxis 
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickFormatter={(v) => `${v}ms`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))'
                      }}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '10px' }}
                      formatter={(value) => <span className="text-xs text-foreground">{value}</span>}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="dbLatency" 
                      name="Database"
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="aiLatency" 
                      name="AI Gateway"
                      stroke="#a855f7" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="stripeLatency" 
                      name="Stripe"
                      stroke="#22c55e" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  No service data available
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="volume" className="mt-0">
            <div className="h-48">
              {hourlyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                    />
                    <YAxis 
                      tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))'
                      }}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '10px' }}
                      formatter={(value) => <span className="text-xs text-foreground">{value}</span>}
                    />
                    <Bar 
                      dataKey="passedChecks" 
                      name="Passed"
                      fill="#22c55e" 
                      stackId="a"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar 
                      dataKey="failedChecks" 
                      name="Failed"
                      fill="#ef4444" 
                      stackId="a"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  No check volume data
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Recent incidents summary */}
        {data.filter(r => !r.test_passed).length > 0 && (
          <div className="mt-4 p-3 bg-destructive/10 rounded-lg border border-destructive/20">
            <p className="text-xs font-medium text-destructive flex items-center gap-2">
              <AlertTriangle className="h-3 w-3" />
              {data.filter(r => !r.test_passed).length} failed checks in last 24h
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
