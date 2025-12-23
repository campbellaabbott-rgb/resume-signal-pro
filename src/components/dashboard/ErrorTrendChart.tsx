import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subHours, startOfHour } from 'date-fns';

interface ErrorTelemetry {
  id: string;
  error_type: string;
  error_code: string;
  error_message: string | null;
  created_at: string;
  visitor_id: string | null;
  function_name: string | null;
  http_status: number | null;
}

interface ErrorTrendChartProps {
  errors: ErrorTelemetry[];
  hoursBack?: number;
}

export function ErrorTrendChart({ errors, hoursBack = 24 }: ErrorTrendChartProps) {
  const chartData = useMemo(() => {
    const now = new Date();
    const buckets: { [hour: string]: { rate_limit: number; api: number; client: number; total: number } } = {};
    
    // Initialize buckets for the last N hours
    for (let i = hoursBack; i >= 0; i--) {
      const hourKey = format(startOfHour(subHours(now, i)), 'HH:mm');
      buckets[hourKey] = { rate_limit: 0, api: 0, client: 0, total: 0 };
    }
    
    // Fill buckets with error data
    errors.forEach(error => {
      const errorTime = new Date(error.created_at);
      const hourKey = format(startOfHour(errorTime), 'HH:mm');
      
      if (buckets[hourKey]) {
        buckets[hourKey].total++;
        if (error.error_type === 'rate_limit') {
          buckets[hourKey].rate_limit++;
        } else if (error.error_type === 'api') {
          buckets[hourKey].api++;
        } else {
          buckets[hourKey].client++;
        }
      }
    });
    
    return Object.entries(buckets).map(([hour, counts]) => ({
      hour,
      ...counts
    }));
  }, [errors, hoursBack]);

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          Error Trend (Last {hoursBack} Hours)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorRateLimit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorApi" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorClient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="hour" 
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 10 }}
              />
              <YAxis 
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 10 }}
                allowDecimals={false}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Area
                type="monotone"
                dataKey="rate_limit"
                name="Rate Limit"
                stackId="1"
                stroke="hsl(var(--chart-1))"
                fill="url(#colorRateLimit)"
              />
              <Area
                type="monotone"
                dataKey="api"
                name="API Error"
                stackId="1"
                stroke="hsl(var(--chart-2))"
                fill="url(#colorApi)"
              />
              <Area
                type="monotone"
                dataKey="client"
                name="Client Error"
                stackId="1"
                stroke="hsl(var(--chart-3))"
                fill="url(#colorClient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-center gap-6 mt-4">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: 'hsl(var(--chart-1))' }} />
            <span className="text-sm text-muted-foreground">Rate Limit</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: 'hsl(var(--chart-2))' }} />
            <span className="text-sm text-muted-foreground">API Error</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: 'hsl(var(--chart-3))' }} />
            <span className="text-sm text-muted-foreground">Client Error</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
