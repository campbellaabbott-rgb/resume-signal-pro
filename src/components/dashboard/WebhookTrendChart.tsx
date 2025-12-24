import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Webhook, RefreshCw } from 'lucide-react';
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
} from 'recharts';

interface HourlyMetric {
  hour_bucket: string;
  total_webhooks: number;
  successful_webhooks: number;
  failed_webhooks: number;
  avg_processing_time_ms: number;
  success_rate: number;
}

interface WebhookTrendChartProps {
  className?: string;
}

type TimeRange = '24h' | '7d';

export function WebhookTrendChart({ className }: WebhookTrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [data, setData] = useState<HourlyMetric[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const hoursBack = timeRange === '24h' ? 24 : 168;
      const { data: metrics, error } = await supabase.rpc('get_webhook_metrics_hourly', {
        p_hours_back: hoursBack
      });
      
      if (error) throw error;
      
      const sorted = (metrics || []).sort((a: HourlyMetric, b: HourlyMetric) => 
        new Date(a.hour_bucket).getTime() - new Date(b.hour_bucket).getTime()
      );
      
      setData(sorted);
    } catch (e) {
      console.error('Failed to fetch webhook trends:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeRange]);

  const totalWebhooks = data.reduce((sum, d) => sum + d.total_webhooks, 0);
  const totalFailed = data.reduce((sum, d) => sum + d.failed_webhooks, 0);
  const avgSuccessRate = totalWebhooks > 0 
    ? ((totalWebhooks - totalFailed) / totalWebhooks * 100).toFixed(1) 
    : '0.0';
  const avgLatency = data.length > 0
    ? Math.round(data.reduce((sum, d) => sum + (d.avg_processing_time_ms || 0), 0) / data.length)
    : 0;

  const formatXAxis = (value: string) => {
    const date = new Date(value);
    if (timeRange === '24h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const date = new Date(label);
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium mb-2">{date.toLocaleString()}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="font-mono">
              {entry.name.includes('Time') ? `${Math.round(entry.value)}ms` : entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhook Processing Trends
          </CardTitle>
          
          <div className="flex items-center gap-2">
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{totalWebhooks}</p>
            <p className="text-xs text-muted-foreground">Total Events</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className={`text-2xl font-bold ${parseFloat(avgSuccessRate) >= 95 ? 'text-green-500' : 'text-yellow-500'}`}>
              {avgSuccessRate}%
            </p>
            <p className="text-xs text-muted-foreground">Success Rate</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{avgLatency}ms</p>
            <p className="text-xs text-muted-foreground">Avg Process Time</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className={`text-2xl font-bold ${totalFailed === 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalFailed}
            </p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data.length > 0 ? (
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="hour_bucket" tickFormatter={formatXAxis} tick={{ fontSize: 11 }} interval={timeRange === '24h' ? 3 : 23} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Area type="monotone" dataKey="successful_webhooks" name="Processed" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.3} />
                <Area type="monotone" dataKey="failed_webhooks" name="Failed" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
            
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="hour_bucket" tickFormatter={formatXAxis} tick={{ fontSize: 11 }} interval={timeRange === '24h' ? 3 : 23} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="avg_processing_time_ms" name="Avg Process Time" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Webhook className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No webhook data for this period</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
