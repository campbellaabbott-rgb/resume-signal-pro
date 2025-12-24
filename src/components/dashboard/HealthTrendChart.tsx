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
  Legend,
  ComposedChart,
  Bar,
  Line,
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
      
      // Sort by time ascending for chart display
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

  // Format x-axis labels
  const formatXAxis = (value: string) => {
    const date = new Date(value);
    if (timeRange === '24h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const date = new Date(label);
    const timeStr = date.toLocaleString([], { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium mb-2">{timeStr}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span 
                className="w-2 h-2 rounded-full" 
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="font-mono">
              {entry.name.includes('Rate') || entry.name.includes('%') 
                ? `${entry.value.toFixed(1)}%`
                : entry.name.includes('Latency')
                  ? `${Math.round(entry.value)}ms`
                  : entry.value}
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
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Scan Activity Trends
          </CardTitle>
          
          <div className="flex items-center gap-2">
            {/* Trend indicator */}
            <Badge variant="outline" className={`${trendColor} border-current`}>
              <TrendIcon className="h-3 w-3 mr-1" />
              {trend.direction === 'flat' 
                ? 'Stable' 
                : `${trend.percentage}% ${trend.direction}`}
            </Badge>
            
            {/* Time range selector */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <Button
                variant={timeRange === '24h' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-3 rounded-none"
                onClick={() => setTimeRange('24h')}
              >
                24h
              </Button>
              <Button
                variant={timeRange === '7d' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-3 rounded-none"
                onClick={() => setTimeRange('7d')}
              >
                7d
              </Button>
            </div>
            
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={fetchData}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{totalScans}</p>
            <p className="text-xs text-muted-foreground">Total Scans</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className={`text-2xl font-bold ${parseFloat(avgSuccessRate) >= 95 ? 'text-green-500' : parseFloat(avgSuccessRate) >= 80 ? 'text-yellow-500' : 'text-red-500'}`}>
              {avgSuccessRate}%
            </p>
            <p className="text-xs text-muted-foreground">Success Rate</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{avgLatency}ms</p>
            <p className="text-xs text-muted-foreground">Avg Latency</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className={`text-2xl font-bold ${totalFailed === 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalFailed}
            </p>
            <p className="text-xs text-muted-foreground">Failed Scans</p>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="text-center py-8 text-destructive">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={fetchData} className="mt-2">
              Retry
            </Button>
          </div>
        )}

        {/* Loading state */}
        {loading && !error && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Chart */}
        {!loading && !error && data.length > 0 && (
          <div className="space-y-6">
            {/* Scan volume chart */}
            <div>
              <p className="text-sm font-medium mb-2">Scan Volume</p>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis 
                    dataKey="hour_bucket" 
                    tickFormatter={formatXAxis}
                    tick={{ fontSize: 11 }}
                    interval={timeRange === '24h' ? 3 : 23}
                    className="text-muted-foreground"
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Area 
                    type="monotone"
                    dataKey="completed_scans" 
                    name="Completed" 
                    stroke="hsl(var(--chart-1))"
                    fill="hsl(var(--chart-1))" 
                    fillOpacity={0.3}
                  />
                  <Area 
                    type="monotone"
                    dataKey="failed_scans" 
                    name="Failed" 
                    stroke="hsl(var(--destructive))"
                    fill="hsl(var(--destructive))" 
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Latency chart */}
            <div>
              <p className="text-sm font-medium mb-2">Response Time (ms)</p>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis 
                    dataKey="hour_bucket" 
                    tickFormatter={formatXAxis}
                    tick={{ fontSize: 11 }}
                    interval={timeRange === '24h' ? 3 : 23}
                    className="text-muted-foreground"
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="avg_duration_ms" 
                    name="Avg Latency"
                    stroke="hsl(var(--chart-2))" 
                    fill="hsl(var(--chart-2))" 
                    fillOpacity={0.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Cache hit rate chart */}
            <div>
              <p className="text-sm font-medium mb-2">Cache Hit Rate (%)</p>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis 
                    dataKey="hour_bucket" 
                    tickFormatter={formatXAxis}
                    tick={{ fontSize: 11 }}
                    interval={timeRange === '24h' ? 3 : 23}
                    className="text-muted-foreground"
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    domain={[0, 100]}
                    className="text-muted-foreground"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area 
                    type="monotone" 
                    dataKey="cache_hit_rate" 
                    name="Cache Hit Rate"
                    stroke="hsl(var(--chart-3))" 
                    fill="hsl(var(--chart-3))" 
                    fillOpacity={0.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && data.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No scan data available for this time period</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
