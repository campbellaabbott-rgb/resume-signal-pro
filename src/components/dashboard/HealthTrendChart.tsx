import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, Activity, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

interface HourlyMetric {
  hour_bucket: string;
  total_scans: number;
  completed_scans: number;
  failed_scans: number;
  avg_duration_ms: number;
  cache_hit_rate: number;
}

interface HealthTrendChartProps {
  className?: string;
}

type TimeRange = '24h' | '7d';

export function HealthTrendChart({ className }: HealthTrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [data, setData] = useState<HourlyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const hoursBack = timeRange === '24h' ? 24 : 168;
      const { data: metrics, error: fetchError } = await supabase.rpc('get_scan_metrics_hourly', {
        p_hours_back: hoursBack
      });
      
      if (fetchError) throw fetchError;
      
      const sorted = (metrics || []).sort((a: HourlyMetric, b: HourlyMetric) => 
        new Date(a.hour_bucket).getTime() - new Date(b.hour_bucket).getTime()
      );
      
      setData(sorted);
    } catch (e) {
      console.error('Failed to fetch trend data:', e);
      setError(e instanceof Error ? e.message : 'Failed to load trends');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeRange]);

  // Calculate trend indicators
  const calculateTrend = () => {
    if (data.length < 2) return { direction: 'flat' as const, percentage: 0 };
    
    const midpoint = Math.floor(data.length / 2);
    const firstHalf = data.slice(0, midpoint);
    const secondHalf = data.slice(midpoint);
    
    const avgFirst = firstHalf.reduce((sum, d) => sum + d.total_scans, 0) / (firstHalf.length || 1);
    const avgSecond = secondHalf.reduce((sum, d) => sum + d.total_scans, 0) / (secondHalf.length || 1);
    
    if (avgFirst === 0) return { direction: 'up' as const, percentage: 100 };
    
    const change = ((avgSecond - avgFirst) / avgFirst) * 100;
    
    if (change > 5) return { direction: 'up' as const, percentage: Math.round(change) };
    if (change < -5) return { direction: 'down' as const, percentage: Math.abs(Math.round(change)) };
    return { direction: 'flat' as const, percentage: 0 };
  };

  const trend = calculateTrend();
  
  // Calculate summary stats
  const totalScans = data.reduce((sum, d) => sum + d.total_scans, 0);
  const totalFailed = data.reduce((sum, d) => sum + d.failed_scans, 0);
  const avgSuccessRate = totalScans > 0 
    ? ((totalScans - totalFailed) / totalScans * 100).toFixed(1) 
    : '0.0';
  const avgLatency = data.length > 0
    ? Math.round(data.reduce((sum, d) => sum + d.avg_duration_ms, 0) / data.length)
    : 0;

  // Format x-axis labels - simplified
  const formatXAxis = (value: string) => {
    const date = new Date(value);
    if (timeRange === '24h') {
      return date.toLocaleTimeString([], { hour: 'numeric' });
    }
    return date.toLocaleDateString([], { weekday: 'short' });
  };

  // Custom tooltip - simplified and cleaner
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const date = new Date(label);
    const timeStr = timeRange === '24h' 
      ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    
    return (
      <div className="bg-background/95 backdrop-blur border border-border rounded-lg shadow-xl p-3 min-w-[140px]">
        <p className="text-xs text-muted-foreground mb-2">{timeStr}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span 
                className="w-2.5 h-2.5 rounded-full" 
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}</span>
            </span>
            <span className="font-semibold tabular-nums">
              {entry.name.includes('Latency') ? `${Math.round(entry.value / 1000)}s` : entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const TrendIcon = trend.direction === 'up' 
    ? TrendingUp 
    : trend.direction === 'down' 
      ? TrendingDown 
      : Minus;

  const trendColor = trend.direction === 'up' 
    ? 'text-green-500' 
    : trend.direction === 'down' 
      ? 'text-red-500' 
      : 'text-muted-foreground';

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            Scan Activity
          </CardTitle>
          
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`${trendColor} border-current text-xs`}>
              <TrendIcon className="h-3 w-3 mr-1" />
              {trend.direction === 'flat' ? 'Stable' : `${trend.percentage}%`}
            </Badge>
            
            <div className="flex rounded-md border border-border overflow-hidden">
              <Button
                variant={timeRange === '24h' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-xs rounded-none"
                onClick={() => setTimeRange('24h')}
              >
                24h
              </Button>
              <Button
                variant={timeRange === '7d' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-xs rounded-none"
                onClick={() => setTimeRange('7d')}
              >
                7d
              </Button>
            </div>
            
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={fetchData}
              disabled={loading}
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        {/* Summary stats - compact */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="text-center p-2 rounded-md bg-muted/30">
            <p className="text-lg font-bold tabular-nums">{totalScans}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Scans</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/30">
            <p className={`text-lg font-bold tabular-nums ${parseFloat(avgSuccessRate) >= 95 ? 'text-green-500' : parseFloat(avgSuccessRate) >= 80 ? 'text-yellow-500' : 'text-red-500'}`}>
              {avgSuccessRate}%
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Success</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/30">
            <p className="text-lg font-bold tabular-nums">{(avgLatency / 1000).toFixed(1)}s</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Latency</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/30">
            <p className={`text-lg font-bold tabular-nums ${totalFailed === 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalFailed}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Failed</p>
          </div>
        </div>

        {error && (
          <div className="text-center py-6 text-destructive text-sm">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={fetchData} className="mt-2">
              Retry
            </Button>
          </div>
        )}

        {loading && !error && (
          <div className="flex items-center justify-center py-10">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && !error && data.length > 0 && (
          <div className="space-y-4">
            {/* Scan volume chart */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Volume</p>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis 
                    dataKey="hour_bucket" 
                    tickFormatter={formatXAxis}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={timeRange === '24h' ? 5 : 'preserveStartEnd'}
                  />
                  <YAxis 
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone"
                    dataKey="completed_scans" 
                    name="Completed" 
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={2}
                    fill="url(#colorCompleted)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Latency chart */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Response Time</p>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis 
                    dataKey="hour_bucket" 
                    tickFormatter={formatXAxis}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    interval={timeRange === '24h' ? 5 : 'preserveStartEnd'}
                  />
                  <YAxis 
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                    tickFormatter={(v) => `${(v/1000).toFixed(0)}s`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="avg_duration_ms" 
                    name="Latency"
                    stroke="hsl(var(--chart-2))" 
                    strokeWidth={2}
                    fill="url(#colorLatency)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No data available</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
