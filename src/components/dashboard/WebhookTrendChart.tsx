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
    : '100.0';
  const avgLatency = data.length > 0
    ? Math.round(data.reduce((sum, d) => sum + (d.avg_processing_time_ms || 0), 0) / data.length)
    : 0;

  const formatXAxis = (value: string) => {
    const date = new Date(value);
    if (timeRange === '24h') {
      return date.toLocaleTimeString([], { hour: 'numeric' });
    }
    return date.toLocaleDateString([], { weekday: 'short' });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    const date = new Date(label);
    const timeStr = timeRange === '24h' 
      ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    
    return (
      <div className="bg-background/95 backdrop-blur border border-border rounded-lg shadow-xl p-3 min-w-[120px]">
        <p className="text-xs text-muted-foreground mb-2">{timeStr}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-muted-foreground">{entry.name}</span>
            </span>
            <span className="font-semibold tabular-nums">
              {entry.name.includes('Time') ? `${entry.value}ms` : entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Webhook className="h-4 w-4 text-purple-500" />
            Webhooks
          </CardTitle>
          
          <div className="flex items-center gap-1">
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
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        {/* Stats row */}
        <div className="flex items-center justify-between gap-2 mb-3 py-2 border-b border-border/50">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xl font-bold tabular-nums">{totalWebhooks}</p>
              <p className="text-[10px] text-muted-foreground uppercase">Events</p>
            </div>
            <div>
              <p className={`text-xl font-bold tabular-nums ${parseFloat(avgSuccessRate) >= 95 ? 'text-green-500' : 'text-yellow-500'}`}>
                {avgSuccessRate}%
              </p>
              <p className="text-[10px] text-muted-foreground uppercase">Success</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums">{avgLatency}ms</p>
            <p className="text-[10px] text-muted-foreground uppercase">Avg Time</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : data.length > 0 ? (
          <ResponsiveContainer width="100%" height={100}>
            <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorWebhook" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis 
                dataKey="hour_bucket" 
                tickFormatter={formatXAxis} 
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                interval={timeRange === '24h' ? 5 : 'preserveStartEnd'}
              />
              <YAxis 
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                width={25}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area 
                type="monotone" 
                dataKey="successful_webhooks" 
                name="Processed" 
                stroke="hsl(var(--chart-3))" 
                strokeWidth={2}
                fill="url(#colorWebhook)"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Webhook className="h-6 w-6 mx-auto mb-2 opacity-40" />
            <p className="text-xs">No webhooks received</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
