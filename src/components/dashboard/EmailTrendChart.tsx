import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mail, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
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
  total_emails: number;
  successful_emails: number;
  failed_emails: number;
  success_rate: number;
}

interface EmailTrendChartProps {
  className?: string;
}

type TimeRange = '24h' | '7d';

export function EmailTrendChart({ className }: EmailTrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [data, setData] = useState<HourlyMetric[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const hoursBack = timeRange === '24h' ? 24 : 168;
      const { data: metrics, error } = await supabase.rpc('get_email_metrics_hourly', {
        p_hours_back: hoursBack
      });
      
      if (error) throw error;
      
      const sorted = (metrics || []).sort((a: HourlyMetric, b: HourlyMetric) => 
        new Date(a.hour_bucket).getTime() - new Date(b.hour_bucket).getTime()
      );
      
      setData(sorted);
    } catch (e) {
      console.error('Failed to fetch email trends:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeRange]);

  const totalEmails = data.reduce((sum, d) => sum + d.total_emails, 0);
  const totalFailed = data.reduce((sum, d) => sum + d.failed_emails, 0);
  const avgSuccessRate = totalEmails > 0 
    ? ((totalEmails - totalFailed) / totalEmails * 100).toFixed(1) 
    : '0.0';

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
            <span className="font-mono">{entry.value}</span>
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
            <Mail className="h-5 w-5" />
            Email Delivery Trends
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
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{totalEmails}</p>
            <p className="text-xs text-muted-foreground">Total Emails</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className={`text-2xl font-bold ${parseFloat(avgSuccessRate) >= 95 ? 'text-green-500' : 'text-yellow-500'}`}>
              {avgSuccessRate}%
            </p>
            <p className="text-xs text-muted-foreground">Success Rate</p>
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
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="hour_bucket" tickFormatter={formatXAxis} tick={{ fontSize: 11 }} interval={timeRange === '24h' ? 3 : 23} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Area type="monotone" dataKey="successful_emails" name="Sent" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.3} />
              <Area type="monotone" dataKey="failed_emails" name="Failed" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No email data for this period</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
